import { randomUUID } from 'node:crypto';
import type {
  TaskAgent,
  TaskItem,
  ScriptEvent,
  ScriptEventListener,
  ScriptEventType,
  ScriptEventListeners,
} from '../types/agent.js';
import type { WorkspaceMap } from '../types/workspace-map.js';
import type { AIProvider, ProviderResult } from '../types/provider.js';
import type { InboundMessage } from '../types/message.js';
import { APIExecutor } from '../knowledge/api-executor.js';
import type { ExecuteRequest, ExecuteResult } from '../knowledge/api-executor.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('task-agent-runtime');

// ── Types ────────────────────────────────────────────────────────

/** Configuration for creating a TaskAgentRuntime */
export interface TaskAgentRuntimeOptions {
  /** The task agent data (identity, tasks, workspace reference) */
  agent: TaskAgent;
  /** Workspace map for API knowledge */
  workspaceMap?: WorkspaceMap;
  /** AI provider for processing tasks that need AI reasoning */
  provider?: AIProvider;
  /** Whether to continue executing remaining tasks after one fails (default: false) */
  continueOnFailure?: boolean;
  /** Per-task timeout in ms (default: 60000) */
  taskTimeoutMs?: number;
}

/** Result of a full task agent execution run */
export interface TaskAgentResult {
  /** The agent ID */
  agentId: string;
  /** Final agent status */
  status: 'completed' | 'failed' | 'cancelled';
  /** Number of tasks completed successfully */
  completedCount: number;
  /** Number of tasks that failed */
  failedCount: number;
  /** Number of tasks skipped (due to earlier failure when continueOnFailure=false) */
  skippedCount: number;
  /** Total tasks */
  totalCount: number;
  /** Total execution duration in ms */
  durationMs: number;
  /** Updated task list with results */
  tasks: TaskItem[];
}

/** Handler function for executing a single task */
export type TaskExecutor = (
  task: TaskItem,
  context: TaskExecutionContext,
) => Promise<string | undefined>;

/** Context provided to task executors */
export interface TaskExecutionContext {
  /** The agent running the task */
  agent: TaskAgent;
  /** API executor (if workspace map is available) */
  apiExecutor?: APIExecutor;
  /** AI provider (if available) */
  provider?: AIProvider;
  /** Workspace map (if available) */
  workspaceMap?: WorkspaceMap;
  /** Emit a progress event */
  reportProgress: (message: string, percent?: number) => void;
  /** Execute an API call via the workspace map */
  executeAPI: (request: ExecuteRequest) => Promise<ExecuteResult>;
  /** Send a message to the AI provider for reasoning */
  askProvider: (content: string) => Promise<ProviderResult>;
}

// ── Default Config ───────────────────────────────────────────────

const DEFAULT_TASK_TIMEOUT_MS = 60_000;

// ── Task Agent Runtime ───────────────────────────────────────────

export class TaskAgentRuntime {
  private readonly agent: TaskAgent;
  private readonly workspaceMap?: WorkspaceMap;
  private readonly provider?: AIProvider;
  private readonly apiExecutor?: APIExecutor;
  private readonly continueOnFailure: boolean;
  private readonly taskTimeoutMs: number;
  private readonly listeners: ScriptEventListeners = {};
  private aborted = false;

  constructor(options: TaskAgentRuntimeOptions) {
    this.agent = structuredClone(options.agent);
    this.workspaceMap = options.workspaceMap;
    this.provider = options.provider;
    this.continueOnFailure = options.continueOnFailure ?? false;
    this.taskTimeoutMs = options.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;

    if (this.workspaceMap) {
      this.apiExecutor = new APIExecutor(this.workspaceMap);
    }
  }

  /**
   * Register a listener for a specific event type.
   */
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

  /**
   * Register a listener for all events.
   */
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

  /**
   * Abort the agent execution. Current task will complete but no more tasks will start.
   */
  abort(): void {
    this.aborted = true;
    logger.info({ agentId: this.agent.id }, 'Agent execution abort requested');
  }

  /**
   * Execute all tasks in the agent's task list sequentially.
   * Uses the provided taskExecutor for custom task logic, or the default executor.
   */
  async run(taskExecutor?: TaskExecutor): Promise<TaskAgentResult> {
    const start = Date.now();
    const executor = taskExecutor ?? this.defaultTaskExecutor.bind(this);

    // Update agent status
    this.agent.status = 'running';
    this.agent.updatedAt = new Date().toISOString();

    // Emit agent_started
    this.emit({
      id: randomUUID(),
      type: 'agent_started',
      timestamp: new Date().toISOString(),
      agentId: this.agent.id,
      payload: {
        agentName: this.agent.name,
        taskCount: this.agent.tasks.length,
      },
    });

    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let hasFailed = false;

    for (const task of this.agent.tasks) {
      // Check abort
      if (this.aborted) {
        task.status = 'skipped';
        skippedCount++;
        continue;
      }

      // Skip if earlier failure and continueOnFailure is false
      if (hasFailed && !this.continueOnFailure) {
        task.status = 'skipped';
        skippedCount++;
        continue;
      }

      // Skip non-pending tasks (already completed or failed from a previous run)
      if (task.status !== 'pending') {
        if (task.status === 'completed') completedCount++;
        if (task.status === 'failed') failedCount++;
        if (task.status === 'skipped') skippedCount++;
        continue;
      }

      // Execute the task
      const taskResult = await this.executeTask(task, executor);

      if (taskResult === 'completed') {
        completedCount++;
      } else {
        failedCount++;
        hasFailed = true;
      }
    }

    const durationMs = Date.now() - start;
    const allCompleted = failedCount === 0 && skippedCount === 0;
    const finalStatus = this.aborted ? 'cancelled' : allCompleted ? 'completed' : 'failed';

    // Update agent status
    this.agent.status = finalStatus;
    this.agent.updatedAt = new Date().toISOString();

    // Emit final event
    if (finalStatus === 'completed') {
      this.emit({
        id: randomUUID(),
        type: 'agent_done',
        timestamp: new Date().toISOString(),
        agentId: this.agent.id,
        payload: {
          completedTasks: completedCount,
          totalTasks: this.agent.tasks.length,
        },
      });
    } else {
      const failedTask = this.agent.tasks.find((t) => t.status === 'failed');
      this.emit({
        id: randomUUID(),
        type: 'agent_failed',
        timestamp: new Date().toISOString(),
        agentId: this.agent.id,
        payload: {
          error: this.aborted ? 'Agent execution was aborted' : `${failedCount} task(s) failed`,
          failedTaskId: failedTask?.id,
        },
      });
    }

    logger.info(
      {
        agentId: this.agent.id,
        status: finalStatus,
        completedCount,
        failedCount,
        skippedCount,
        durationMs,
      },
      'Agent execution finished',
    );

    return {
      agentId: this.agent.id,
      status: finalStatus,
      completedCount,
      failedCount,
      skippedCount,
      totalCount: this.agent.tasks.length,
      durationMs,
      tasks: this.agent.tasks,
    };
  }

  /**
   * Get the current agent state (deep copy).
   */
  getAgent(): TaskAgent {
    return structuredClone(this.agent);
  }

  // ── Private Helpers ──────────────────────────────────────────────

  private async executeTask(
    task: TaskItem,
    executor: TaskExecutor,
  ): Promise<'completed' | 'failed'> {
    const now = new Date().toISOString();
    task.status = 'in_progress';
    task.startedAt = now;

    // Emit task_started
    this.emit({
      id: randomUUID(),
      type: 'task_started',
      timestamp: now,
      agentId: this.agent.id,
      payload: {
        taskId: task.id,
        description: task.description,
      },
    });

    const context = this.buildContext(task);

    try {
      const result = await this.withTimeout(executor(task, context), this.taskTimeoutMs, task.id);

      task.status = 'completed';
      task.result = result ?? 'Task completed successfully';
      task.completedAt = new Date().toISOString();

      // Emit task_complete
      this.emit({
        id: randomUUID(),
        type: 'task_complete',
        timestamp: new Date().toISOString(),
        agentId: this.agent.id,
        payload: {
          taskId: task.id,
          result: task.result,
        },
      });

      logger.info({ agentId: this.agent.id, taskId: task.id }, 'Task completed successfully');

      return 'completed';
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      task.status = 'failed';
      task.result = errorMessage;
      task.completedAt = new Date().toISOString();

      const isTimeout = errorMessage.includes('timed out');

      // Emit task_failed
      this.emit({
        id: randomUUID(),
        type: 'task_failed',
        timestamp: new Date().toISOString(),
        agentId: this.agent.id,
        payload: {
          taskId: task.id,
          error: errorMessage,
          retryable: isTimeout,
        },
      });

      logger.error({ agentId: this.agent.id, taskId: task.id, error: errorMessage }, 'Task failed');

      return 'failed';
    }
  }

  private buildContext(task: TaskItem): TaskExecutionContext {
    return {
      agent: this.agent,
      apiExecutor: this.apiExecutor,
      provider: this.provider,
      workspaceMap: this.workspaceMap,
      reportProgress: (message: string, percent?: number): void => {
        this.emit({
          id: randomUUID(),
          type: 'task_progress',
          timestamp: new Date().toISOString(),
          agentId: this.agent.id,
          payload: { taskId: task.id, message, percent },
        });
      },
      executeAPI: async (request: ExecuteRequest): Promise<ExecuteResult> => {
        if (!this.apiExecutor) {
          return {
            ok: false as const,
            error: 'No workspace map available — cannot execute API calls',
            code: 'ENDPOINT_NOT_FOUND' as const,
            durationMs: 0,
            endpoint: { id: request.endpointId, method: 'UNKNOWN', path: 'UNKNOWN' },
            retryable: false,
          };
        }
        return this.apiExecutor.execute(request);
      },
      askProvider: async (content: string): Promise<ProviderResult> => {
        if (!this.provider) {
          throw new Error('No AI provider available');
        }
        const message: InboundMessage = {
          id: randomUUID(),
          source: 'task-agent',
          sender: `agent:${this.agent.id}`,
          rawContent: content,
          content,
          timestamp: new Date(),
          metadata: {
            agentId: this.agent.id,
            taskId: task.id,
            workspaceMap: this.workspaceMap,
          },
        };
        return this.provider.processMessage(message);
      },
    };
  }

  private async defaultTaskExecutor(
    task: TaskItem,
    context: TaskExecutionContext,
  ): Promise<string | undefined> {
    // Default executor: send task description to AI provider for reasoning
    if (context.provider) {
      const result = await context.askProvider(task.description);
      return result.content;
    }
    // No provider — just mark as completed with no result
    return undefined;
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, taskId: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task "${taskId}" timed out after ${ms}ms`));
      }, ms);

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

  private emit(event: ScriptEvent): void {
    const handlers = this.listeners[event.type];
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (handler as (event: any) => void)(event);
      } catch (err) {
        logger.error(
          { eventType: event.type, error: err instanceof Error ? err.message : String(err) },
          'Event listener threw an error',
        );
      }
    }
  }
}

// ── Factory ─────────────────────────────────────────────────────

/** Create a new TaskAgent data object with the given parameters */
export function createTaskAgent(params: {
  name: string;
  parentAgentId: string;
  parentTaskId: string;
  workspaceId: string;
  providerId: string;
  tasks: Array<{ id: string; description: string }>;
  metadata?: Record<string, unknown>;
}): TaskAgent {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: params.name,
    role: 'task',
    status: 'idle',
    workspaceId: params.workspaceId,
    providerId: params.providerId,
    parentAgentId: params.parentAgentId,
    parentTaskId: params.parentTaskId,
    tasks: params.tasks.map((t) => ({
      id: t.id,
      description: t.description,
      status: 'pending' as const,
    })),
    createdAt: now,
    updatedAt: now,
    metadata: params.metadata ?? {},
  };
}
