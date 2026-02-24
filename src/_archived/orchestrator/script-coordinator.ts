import { randomUUID } from 'node:crypto';
import type {
  ScriptEvent,
  ScriptEventType,
  ScriptEventListener,
  ScriptEventListeners,
} from '../types/agent.js';
import type { TaskAgentRuntime, TaskAgentResult, TaskExecutor } from './task-agent-runtime.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('script-coordinator');

// ── Types ────────────────────────────────────────────────────────

/** A step in a script — wraps a TaskAgentRuntime with dependency info */
export interface ScriptStep {
  /** Unique step identifier */
  id: string;
  /** Human-readable label */
  name: string;
  /** The task agent runtime to execute */
  runtime: TaskAgentRuntime;
  /** IDs of steps that must complete before this step can run */
  dependsOn: string[];
  /** Optional custom task executor */
  executor?: TaskExecutor;
}

/** Status of a step within the coordinator */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

/** Internal state tracked per step */
interface StepState {
  step: ScriptStep;
  status: StepStatus;
  result?: TaskAgentResult;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/** Configuration for the Script Coordinator */
export interface ScriptCoordinatorConfig {
  /** Maximum concurrent steps (default: 3) */
  maxConcurrent?: number;
  /** Per-step timeout in ms — aborts a step if it exceeds this (default: 300000 = 5 min) */
  stepTimeoutMs?: number;
  /** Whether to cancel remaining steps when any step fails (default: true) */
  failFast?: boolean;
}

/** Result of a full script execution */
export interface ScriptResult {
  /** Final script status */
  status: 'completed' | 'failed' | 'cancelled';
  /** Per-step results */
  steps: Array<{
    id: string;
    name: string;
    status: StepStatus;
    result?: TaskAgentResult;
    error?: string;
    durationMs: number;
  }>;
  /** Total execution duration */
  durationMs: number;
}

// ── Defaults ─────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_STEP_TIMEOUT_MS = 300_000;

// ── Script Coordinator ──────────────────────────────────────────

export class ScriptCoordinator {
  private readonly steps = new Map<string, StepState>();
  private readonly insertionOrder: string[] = [];
  private readonly listeners: ScriptEventListeners = {};
  private readonly maxConcurrent: number;
  private readonly stepTimeoutMs: number;
  private readonly failFast: boolean;
  private aborted = false;

  constructor(config: ScriptCoordinatorConfig = {}) {
    this.maxConcurrent = config.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.stepTimeoutMs = config.stepTimeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
    this.failFast = config.failFast ?? true;

    logger.info(
      {
        maxConcurrent: this.maxConcurrent,
        stepTimeoutMs: this.stepTimeoutMs,
        failFast: this.failFast,
      },
      'Script coordinator created',
    );
  }

  /** Add a step to the script */
  addStep(step: ScriptStep): void {
    if (this.steps.has(step.id)) {
      throw new Error(`Step "${step.id}" already exists`);
    }

    // Validate dependencies exist
    for (const depId of step.dependsOn) {
      if (!this.steps.has(depId)) {
        throw new Error(`Step "${step.id}" depends on unknown step "${depId}"`);
      }
    }

    this.steps.set(step.id, {
      step,
      status: 'pending',
    });
    this.insertionOrder.push(step.id);

    // Forward events from the runtime to our event bus
    step.runtime.onAny((event) => this.emit(event));

    logger.info({ stepId: step.id, dependsOn: step.dependsOn }, 'Step added to script');
  }

  /** Execute the script — runs steps respecting dependencies and concurrency */
  async run(): Promise<ScriptResult> {
    const start = Date.now();
    this.aborted = false;

    // Validate no circular dependencies
    this.validateNoCycles();

    logger.info({ stepCount: this.steps.size }, 'Script execution started');

    // Execute steps using a dependency-aware scheduler
    await this.executeSteps();

    const durationMs = Date.now() - start;
    const stepResults = this.buildStepResults();

    const hasFailure = stepResults.some((s) => s.status === 'failed');
    const status = this.aborted ? 'cancelled' : hasFailure ? 'failed' : 'completed';

    const result: ScriptResult = { status, steps: stepResults, durationMs };

    logger.info(
      {
        status,
        durationMs,
        completedSteps: stepResults.filter((s) => s.status === 'completed').length,
      },
      'Script execution finished',
    );

    return result;
  }

  /** Abort execution — running steps finish but no new steps start */
  abort(): void {
    this.aborted = true;
    // Abort all running runtimes
    for (const state of this.steps.values()) {
      if (state.status === 'running') {
        state.step.runtime.abort();
      }
    }
    logger.info('Script execution abort requested');
  }

  /** Get the current status of a step */
  getStepStatus(stepId: string): StepStatus | undefined {
    return this.steps.get(stepId)?.status;
  }

  /** Get all step statuses */
  getSnapshot(): Array<{ id: string; name: string; status: StepStatus }> {
    return this.insertionOrder.map((id) => {
      const state = this.steps.get(id)!;
      return { id, name: state.step.name, status: state.status };
    });
  }

  // ── Event System ────────────────────────────────────────────────

  /** Subscribe to a specific event type */
  on<K extends ScriptEventType>(
    eventType: K,
    listener: (event: Extract<ScriptEvent, { type: K }>) => void,
  ): void {
    const list = this.listeners[eventType] as
      | Array<(event: Extract<ScriptEvent, { type: K }>) => void>
      | undefined;
    if (list) {
      list.push(listener);
    } else {
      (this.listeners[eventType] as Array<(event: Extract<ScriptEvent, { type: K }>) => void>) = [
        listener,
      ];
    }
  }

  /** Subscribe to all event types */
  onAny(listener: ScriptEventListener): void {
    const allTypes: ScriptEventType[] = [
      'agent_started',
      'agent_done',
      'agent_failed',
      'task_started',
      'task_complete',
      'task_failed',
      'task_progress',
    ];
    for (const type of allTypes) {
      this.on(type, listener as (event: Extract<ScriptEvent, { type: typeof type }>) => void);
    }
  }

  // ── Private ─────────────────────────────────────────────────────

  private async executeSteps(): Promise<void> {
    const running = new Map<string, Promise<void>>();

    const trySchedule = (): void => {
      if (this.aborted) return;

      for (const id of this.insertionOrder) {
        const state = this.steps.get(id)!;
        if (state.status !== 'pending') continue;
        if (running.size >= this.maxConcurrent) break;

        // Check if all dependencies are satisfied
        const depsReady = state.step.dependsOn.every((depId) => {
          const dep = this.steps.get(depId)!;
          return dep.status === 'completed';
        });

        // If any dependency failed/cancelled/skipped, skip this step
        const depsBlocked = state.step.dependsOn.some((depId) => {
          const dep = this.steps.get(depId)!;
          return dep.status === 'failed' || dep.status === 'cancelled' || dep.status === 'skipped';
        });

        if (depsBlocked) {
          state.status = 'skipped';
          state.completedAt = new Date().toISOString();
          continue;
        }

        if (!depsReady) continue;

        // Launch this step
        state.status = 'running';
        state.startedAt = new Date().toISOString();

        const stepPromise = this.runStep(state).then(() => {
          running.delete(id);
        });
        running.set(id, stepPromise);
      }
    };

    // Main scheduling loop
    trySchedule();

    while (running.size > 0) {
      // Wait for any running step to finish
      await Promise.race(running.values());

      // Check for abort
      if (this.aborted) {
        this.cancelPendingSteps();
        if (running.size > 0) {
          await Promise.allSettled(running.values());
        }
        break;
      }

      // After a step finishes, check for failures and schedule more
      if (this.failFast && this.hasFailedStep()) {
        this.cancelPendingSteps();
        // Wait for remaining running steps to finish
        if (running.size > 0) {
          await Promise.allSettled(running.values());
        }
        break;
      }
      trySchedule();
    }

    // Cancel any remaining pending steps (e.g., after abort with no running steps)
    if (this.aborted) {
      this.cancelPendingSteps();
    }
  }

  private async runStep(state: StepState): Promise<void> {
    const { step } = state;

    logger.info({ stepId: step.id }, 'Step execution started');

    try {
      const result = await this.withStepTimeout(step.runtime.run(step.executor), step.id);

      state.result = result;
      state.completedAt = new Date().toISOString();

      if (result.status === 'completed') {
        state.status = 'completed';
        logger.info({ stepId: step.id }, 'Step completed successfully');
      } else if (result.status === 'cancelled') {
        state.status = 'cancelled';
        logger.info({ stepId: step.id }, 'Step was cancelled');
      } else {
        state.status = 'failed';
        state.error = `${result.failedCount} task(s) failed`;
        logger.error({ stepId: step.id, failedCount: result.failedCount }, 'Step failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      state.status = 'failed';
      state.error = errorMessage;
      state.completedAt = new Date().toISOString();
      logger.error({ stepId: step.id, error: errorMessage }, 'Step execution error');
    }
  }

  private async withStepTimeout(
    promise: Promise<TaskAgentResult>,
    stepId: string,
  ): Promise<TaskAgentResult> {
    return new Promise<TaskAgentResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Abort the step's runtime before rejecting
        const state = this.steps.get(stepId);
        if (state) {
          state.step.runtime.abort();
        }
        reject(new Error(`Step "${stepId}" timed out after ${this.stepTimeoutMs}ms`));
      }, this.stepTimeoutMs);

      promise
        .then((value) => {
          clearTimeout(timer);
          resolve(value);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err as Error);
        });
    });
  }

  private hasFailedStep(): boolean {
    for (const state of this.steps.values()) {
      if (state.status === 'failed') return true;
    }
    return false;
  }

  private cancelPendingSteps(): void {
    for (const state of this.steps.values()) {
      if (state.status === 'pending') {
        state.status = 'cancelled';
        state.completedAt = new Date().toISOString();
      }
    }
    // Abort running steps
    for (const state of this.steps.values()) {
      if (state.status === 'running') {
        state.step.runtime.abort();
      }
    }
  }

  private buildStepResults(): ScriptResult['steps'] {
    return this.insertionOrder.map((id) => {
      const state = this.steps.get(id)!;
      const startMs = state.startedAt ? new Date(state.startedAt).getTime() : 0;
      const endMs = state.completedAt ? new Date(state.completedAt).getTime() : 0;
      return {
        id,
        name: state.step.name,
        status: state.status,
        result: state.result,
        error: state.error,
        durationMs: startMs && endMs ? endMs - startMs : 0,
      };
    });
  }

  private validateNoCycles(): void {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const visit = (id: string): void => {
      if (inStack.has(id)) {
        throw new Error(`Circular dependency detected involving step "${id}"`);
      }
      if (visited.has(id)) return;

      inStack.add(id);
      const state = this.steps.get(id);
      if (state) {
        for (const depId of state.step.dependsOn) {
          visit(depId);
        }
      }
      inStack.delete(id);
      visited.add(id);
    };

    for (const id of this.steps.keys()) {
      visit(id);
    }
  }

  private emit(event: ScriptEvent): void {
    const handlers = this.listeners[event.type];
    if (!handlers) return;

    // Generate a new event ID to avoid collision with the runtime's event ID
    const forwardedEvent = {
      ...event,
      id: randomUUID(),
    } as ScriptEvent;

    for (const handler of handlers) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (handler as (event: any) => void)(forwardedEvent);
      } catch (err) {
        logger.error(
          { eventType: event.type, error: err instanceof Error ? err.message : String(err) },
          'Event listener threw an error',
        );
      }
    }
  }
}
