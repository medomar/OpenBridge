/**
 * SwarmCoordinator (OB-1782)
 *
 * Groups workers into typed swarms — research, implement, review, test — and
 * manages the lifecycle of each swarm (pending → running → completed | failed).
 *
 * A swarm is a named collection of TaskManifest workers that share a common
 * goal and optional shared context. The coordinator is the single source of
 * truth for swarm state within a Master AI session.
 *
 * Subsequent tasks extend this coordinator:
 *   OB-1783 — Swarm handoff (research output feeds implement context)
 *   OB-1784 — Master-driven swarm composition (simple vs complex tasks) ✅
 *   OB-1785 — Parallel worker spawning within swarms
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../core/logger.js';
import type { TaskManifest, WorkerSwarm, SwarmType, SwarmWorkerResult } from '../types/agent.js';

const logger = createLogger('swarm-coordinator');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default pipeline order for swarm types.
 * Swarms with a lower index run before swarms with a higher index.
 */
export const SWARM_PIPELINE_ORDER: SwarmType[] = ['research', 'implement', 'review', 'test'];

// ---------------------------------------------------------------------------
// Task Complexity Classification (OB-1784)
// ---------------------------------------------------------------------------

/**
 * Task complexity level that drives swarm composition decisions.
 *
 * - `simple`   — Single-step tasks (questions, lookups, trivial edits).
 *                Swarms are skipped; Master handles them directly.
 * - `moderate` — Medium-scope tasks (single-function changes, bug fixes).
 *                Only an `implement` swarm is created; no research/review.
 * - `complex`  — Multi-step tasks (feature implementation, refactoring,
 *                architecture changes). Full pipeline is used.
 */
export type TaskComplexity = 'simple' | 'moderate' | 'complex';

/**
 * Result of the swarm composition planner (OB-1784).
 *
 * `skipSwarms` is `true` for simple tasks (no swarms at all).
 * `swarmTypes` lists the swarm types to create in pipeline order.
 */
export interface SwarmCompositionPlan {
  /** Assessed complexity of the task. */
  complexity: TaskComplexity;
  /** When true the caller should skip swarm creation and run directly. */
  skipSwarms: boolean;
  /** Ordered list of swarm types to create (empty when `skipSwarms` is true). */
  swarmTypes: SwarmType[];
}

// Word patterns that suggest a task is simple (information requests / trivial).
const SIMPLE_PATTERNS = [
  /\bwhat\s+is\b/i,
  /\bwhat'?s\b/i,
  /\bwhere\s+is\b/i,
  /\bshow\s+me\b/i,
  /\blist\b/i,
  /\bexplain\b/i,
  /\bdescribe\b/i,
  /\bprint\b/i,
  /\blog\b/i,
  /\becho\b/i,
  /\bdisplay\b/i,
  /\bsummariz/i,
  /\bcount\b/i,
  /\bhow\s+many\b/i,
  /\bcan\s+you\s+(tell|show|find)\b/i,
];

// Word patterns that strongly indicate a complex task.
const COMPLEX_PATTERNS = [
  /\brefactor\b/i,
  /\barchitecture\b/i,
  /\bdesign\b/i,
  /\binvestigat/i,
  /\banalyze?\b/i,
  /\bauditing?\b/i,
  /\bperformance\b/i,
  /\bsecurity\b/i,
  /\bmigrat/i,
  /\bintegrat/i,
  /\binfrastructure\b/i,
  /\boverhaul\b/i,
  /\brewrite\b/i,
  /\bscalability\b/i,
  /\boptimiz/i,
  /\bdebug.*and.*fix\b/i,
  /\bmultiple\s+(files?|modules?|components?|classes?|functions?)\b/i,
];

// Multi-step connectors — presence raises complexity.
const MULTI_STEP_PATTERNS = [/\bthen\b/i, /\bafter\s+that\b/i, /\bstep\s+\d/i, /\band\s+also\b/i];

/**
 * Classify a task description into a complexity tier.
 *
 * Heuristics (in order of precedence):
 * 1. Matches a simple-pattern AND no complex-pattern → `simple`
 * 2. Matches a complex-pattern OR ≥ 2 multi-step connectors → `complex`
 * 3. Word count ≥ 30 words → `complex`
 * 4. Otherwise → `moderate`
 *
 * @param taskDescription Raw text description of the task.
 */
export function classifyTaskComplexity(taskDescription: string): TaskComplexity {
  const text = taskDescription.trim();
  if (!text) return 'simple';

  const hasSimpleSignal = SIMPLE_PATTERNS.some((p) => p.test(text));
  const hasComplexSignal = COMPLEX_PATTERNS.some((p) => p.test(text));

  if (hasSimpleSignal && !hasComplexSignal) return 'simple';

  if (hasComplexSignal) return 'complex';

  const multiStepHits = MULTI_STEP_PATTERNS.filter((p) => p.test(text)).length;
  if (multiStepHits >= 2) return 'complex';

  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 30) return 'complex';

  return 'moderate';
}

/**
 * Determine which swarm types to create for a given task description.
 *
 * | Complexity | Swarms created                       |
 * |------------|--------------------------------------|
 * | simple     | none — `skipSwarms: true`            |
 * | moderate   | `implement` only                     |
 * | complex    | full pipeline: research → implement → review → test |
 *
 * @param taskDescription Raw text description of the task.
 * @returns A `SwarmCompositionPlan` that callers use to drive swarm creation.
 */
export function planSwarmComposition(taskDescription: string): SwarmCompositionPlan {
  const complexity = classifyTaskComplexity(taskDescription);

  if (complexity === 'simple') {
    return { complexity, skipSwarms: true, swarmTypes: [] };
  }

  if (complexity === 'moderate') {
    return { complexity, skipSwarms: false, swarmTypes: ['implement'] };
  }

  // complex — full pipeline
  return {
    complexity,
    skipSwarms: false,
    swarmTypes: ['research', 'implement', 'review', 'test'],
  };
}

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

/** Options for creating a new swarm. */
export interface CreateSwarmOptions {
  /** Human-readable name (defaults to `"${type}-swarm"`). */
  name?: string;
  /** Context injected into every worker prompt in this swarm. */
  sharedContext?: string;
  /**
   * When true, workers in this swarm run concurrently.
   * Defaults to false (sequential).
   */
  allowParallel?: boolean;
}

/** Result of completing a swarm's work. */
export interface SwarmCompletionResult {
  /** The swarm that finished. */
  swarm: WorkerSwarm;
  /** Combined text from all worker outputs (used for handoff). */
  combinedOutput: string;
  /** Number of workers that succeeded. */
  successCount: number;
  /** Number of workers that failed. */
  failureCount: number;
}

// ---------------------------------------------------------------------------
// SwarmCoordinator
// ---------------------------------------------------------------------------

/**
 * SwarmCoordinator — manages a collection of typed worker swarms for a single
 * Master AI session.
 *
 * Usage:
 *
 * ```ts
 * const coordinator = new SwarmCoordinator();
 *
 * // Group workers into typed swarms
 * const researchSwarm = coordinator.createSwarm('research', researchManifests);
 * const implSwarm     = coordinator.createSwarm('implement', implManifests);
 *
 * // Run a swarm
 * coordinator.startSwarm(researchSwarm.id);
 * coordinator.recordWorkerResult(researchSwarm.id, {
 *   workerId: 'w1', output: '...', success: true,
 * });
 * coordinator.completeSwarm(researchSwarm.id);
 *
 * // Read the combined output for handoff
 * const output = coordinator.getCombinedOutput(researchSwarm.id);
 * ```
 */
export class SwarmCoordinator {
  private _swarms: Map<string, WorkerSwarm> = new Map();

  // ── Swarm Creation ───────────────────────────────────────────────

  /**
   * Create a new swarm from a list of worker manifests.
   *
   * @param type    Swarm category — determines its role in the pipeline.
   * @param workers Worker manifests to assign to this swarm (at least one).
   * @param options Optional overrides for name, sharedContext, allowParallel.
   * @returns The newly created `WorkerSwarm` (status: `pending`).
   * @throws If `workers` is empty.
   */
  createSwarm(
    type: SwarmType,
    workers: TaskManifest[],
    options: CreateSwarmOptions = {},
  ): WorkerSwarm {
    if (workers.length === 0) {
      throw new Error(`SwarmCoordinator.createSwarm(): at least one worker is required`);
    }

    const id = randomUUID();
    const name = options.name ?? `${type}-swarm`;

    const swarm: WorkerSwarm = {
      id,
      name,
      type,
      status: 'pending',
      workers,
      sharedContext: options.sharedContext ?? '',
      handoffContext: '',
      allowParallel: options.allowParallel ?? false,
      results: [],
      createdAt: new Date().toISOString(),
    };

    this._swarms.set(id, swarm);
    logger.debug({ swarmId: id, type, name, workerCount: workers.length }, 'Swarm created');
    return { ...swarm, workers: [...workers], results: [] };
  }

  // ── Lifecycle ────────────────────────────────────────────────────

  /**
   * Transition a swarm from `pending` to `running`.
   *
   * @param swarmId The swarm to start.
   * @returns Snapshot of the updated swarm.
   * @throws If the swarm is not found or not in `pending` status.
   */
  startSwarm(swarmId: string): WorkerSwarm {
    const swarm = this._requireSwarm(swarmId, 'startSwarm');
    this._requireSwarmStatus(swarm, 'pending', 'startSwarm');

    swarm.status = 'running';
    logger.debug({ swarmId, type: swarm.type }, 'Swarm started');
    return this._snapshot(swarm);
  }

  /**
   * Mark a swarm as `completed` after all its workers have finished.
   *
   * Automatically propagates the combined output to all downstream swarms in
   * the pipeline so they receive it as `handoffContext` before they run.
   *
   * @param swarmId The swarm to complete.
   * @returns A `SwarmCompletionResult` with statistics and combined output.
   * @throws If the swarm is not found or not in `running` status.
   */
  completeSwarm(swarmId: string): SwarmCompletionResult {
    const swarm = this._requireSwarm(swarmId, 'completeSwarm');
    this._requireSwarmStatus(swarm, 'running', 'completeSwarm');

    swarm.status = 'completed';
    swarm.completedAt = new Date().toISOString();

    const successCount = swarm.results.filter((r) => r.success).length;
    const failureCount = swarm.results.filter((r) => !r.success).length;
    const combinedOutput = this._buildCombinedOutput(swarm);

    // Propagate output to downstream swarms so they build on prior results.
    const handoffCount = this.propagateHandoffToDownstream(swarmId);

    logger.debug(
      { swarmId, type: swarm.type, successCount, failureCount, handoffCount },
      'Swarm completed',
    );

    return { swarm: this._snapshot(swarm), combinedOutput, successCount, failureCount };
  }

  /**
   * Mark a swarm as `failed` when a critical error prevents it from finishing.
   *
   * @param swarmId The swarm to fail.
   * @param _reason Human-readable reason (logged only).
   * @returns Snapshot of the failed swarm.
   * @throws If the swarm is not found or not in `running` status.
   */
  failSwarm(swarmId: string, _reason: string): WorkerSwarm {
    const swarm = this._requireSwarm(swarmId, 'failSwarm');
    this._requireSwarmStatus(swarm, 'running', 'failSwarm');

    swarm.status = 'failed';
    swarm.completedAt = new Date().toISOString();
    logger.warn({ swarmId, type: swarm.type, reason: _reason }, 'Swarm failed');
    return this._snapshot(swarm);
  }

  // ── Worker Results ───────────────────────────────────────────────

  /**
   * Record the result of a single worker completing inside a swarm.
   *
   * @param swarmId The swarm that owns this worker.
   * @param result  The worker result to append.
   * @throws If the swarm is not found or not in `running` status.
   */
  recordWorkerResult(swarmId: string, result: SwarmWorkerResult): void {
    const swarm = this._requireSwarm(swarmId, 'recordWorkerResult');
    this._requireSwarmStatus(swarm, 'running', 'recordWorkerResult');
    swarm.results.push({ ...result });
    logger.debug(
      { swarmId, workerId: result.workerId, success: result.success },
      'Worker result recorded',
    );
  }

  // ── Output ───────────────────────────────────────────────────────

  /**
   * Build the combined output text from all worker results in a swarm.
   * Returns an empty string if no results are recorded yet.
   *
   * @param swarmId The swarm to aggregate.
   */
  getCombinedOutput(swarmId: string): string {
    const swarm = this._swarms.get(swarmId);
    if (!swarm) return '';
    return this._buildCombinedOutput(swarm);
  }

  /**
   * Build the full context string to inject into worker prompts for a swarm.
   * Merges `sharedContext` (swarm-level instructions) and `handoffContext`
   * (upstream findings propagated from prior swarms). Both sections are
   * included only when non-empty.
   *
   * @param swarmId The swarm whose context to build.
   * @returns Combined context string, or empty string if swarm not found.
   */
  buildWorkerContext(swarmId: string): string {
    const swarm = this._swarms.get(swarmId);
    if (!swarm) return '';
    const parts: string[] = [];
    if (swarm.sharedContext) parts.push(swarm.sharedContext);
    if (swarm.handoffContext) parts.push(swarm.handoffContext);
    return parts.join('\n\n');
  }

  // ── Handoff ───────────────────────────────────────────────────────

  /**
   * Propagate the combined output of a completed swarm to all downstream
   * swarms in the pipeline. "Downstream" means any swarm whose type appears
   * later in `SWARM_PIPELINE_ORDER`:
   *
   *   research → implement → review → test
   *
   * Handoff context is **cumulative**: when research completes it propagates
   * to implement, review, and test; when implement completes it propagates to
   * review and test. By the time review runs it has both research and
   * implement findings in its `handoffContext`.
   *
   * Called automatically by `completeSwarm()`. May also be called manually
   * if the caller needs explicit control.
   *
   * @param swarmId ID of the completed swarm.
   * @returns Number of downstream swarms whose `handoffContext` was updated.
   */
  propagateHandoffToDownstream(swarmId: string): number {
    const swarm = this._swarms.get(swarmId);
    if (!swarm || swarm.status !== 'completed') return 0;

    const combinedOutput = this._buildCombinedOutput(swarm);
    if (!combinedOutput) return 0;

    const fromIndex = SWARM_PIPELINE_ORDER.indexOf(swarm.type);
    if (fromIndex === -1) return 0; // custom type — no defined downstream

    const downstreamTypes = new Set(SWARM_PIPELINE_ORDER.slice(fromIndex + 1));

    let updatedCount = 0;
    for (const [, downstream] of this._swarms) {
      if (!downstreamTypes.has(downstream.type)) continue;
      // Don't overwrite swarms that already ran — they can't use the context.
      if (downstream.status === 'completed' || downstream.status === 'failed') continue;

      const header = `## Handoff from ${swarm.name} (${swarm.type})\n\n`;
      const separator = downstream.handoffContext ? '\n\n---\n\n' : '';
      downstream.handoffContext = `${downstream.handoffContext}${separator}${header}${combinedOutput}`;

      updatedCount++;
      logger.debug(
        {
          fromSwarmId: swarmId,
          fromType: swarm.type,
          toSwarmId: downstream.id,
          toType: downstream.type,
        },
        'Handoff context propagated',
      );
    }

    return updatedCount;
  }

  // ── Queries ──────────────────────────────────────────────────────

  /** Retrieve a swarm by ID, or `undefined` if not found. */
  getSwarm(swarmId: string): WorkerSwarm | undefined {
    const swarm = this._swarms.get(swarmId);
    return swarm ? this._snapshot(swarm) : undefined;
  }

  /** All swarms in creation order, as snapshots. */
  get swarms(): WorkerSwarm[] {
    return Array.from(this._swarms.values()).map((s) => this._snapshot(s));
  }

  /** Swarms that have not yet started. */
  get pendingSwarms(): WorkerSwarm[] {
    return this.swarms.filter((s) => s.status === 'pending');
  }

  /** Swarms currently executing workers. */
  get runningSwarms(): WorkerSwarm[] {
    return this.swarms.filter((s) => s.status === 'running');
  }

  /** Swarms that finished successfully. */
  get completedSwarms(): WorkerSwarm[] {
    return this.swarms.filter((s) => s.status === 'completed');
  }

  /**
   * Swarms in pipeline order (research → implement → review → test).
   * Swarms with types not in the pipeline order are appended at the end
   * in creation order.
   */
  get swarmsByPipelineOrder(): WorkerSwarm[] {
    const indexed = new Map<SwarmType, WorkerSwarm[]>();
    for (const type of SWARM_PIPELINE_ORDER) {
      indexed.set(type, []);
    }
    const extras: WorkerSwarm[] = [];
    for (const swarm of this.swarms) {
      const bucket = indexed.get(swarm.type);
      if (bucket) {
        bucket.push(swarm);
      } else {
        extras.push(swarm);
      }
    }
    const ordered: WorkerSwarm[] = [];
    for (const type of SWARM_PIPELINE_ORDER) {
      ordered.push(...(indexed.get(type) ?? []));
    }
    ordered.push(...extras);
    return ordered;
  }

  /** `true` when all swarms are in a terminal state (completed or failed). */
  get isComplete(): boolean {
    if (this._swarms.size === 0) return false;
    return Array.from(this._swarms.values()).every(
      (s) => s.status === 'completed' || s.status === 'failed',
    );
  }

  /** Total number of swarms managed by this coordinator. */
  get swarmCount(): number {
    return this._swarms.size;
  }

  // ── Composition Planning (OB-1784) ───────────────────────────────

  /**
   * Decide which swarms to create for a task based on its complexity.
   *
   * Delegates to the module-level `planSwarmComposition()` so callers can
   * use either the standalone function or the instance method.
   *
   * @param taskDescription Raw text description of the task.
   * @returns A `SwarmCompositionPlan` the caller uses to drive swarm creation.
   */
  planComposition(taskDescription: string): SwarmCompositionPlan {
    return planSwarmComposition(taskDescription);
  }

  // ── Reset ────────────────────────────────────────────────────────

  /** Clear all swarms so the coordinator can be reused for a new task. */
  reset(): void {
    this._swarms.clear();
  }

  // ── Private ──────────────────────────────────────────────────────

  private _requireSwarm(swarmId: string, method: string): WorkerSwarm {
    const swarm = this._swarms.get(swarmId);
    if (!swarm) {
      throw new Error(`SwarmCoordinator.${method}(): swarm '${swarmId}' not found`);
    }
    return swarm;
  }

  private _requireSwarmStatus(
    swarm: WorkerSwarm,
    expected: WorkerSwarm['status'],
    method: string,
  ): void {
    if (swarm.status !== expected) {
      throw new Error(
        `SwarmCoordinator.${method}(): swarm '${swarm.id}' expected status '${expected}' but is '${swarm.status}'`,
      );
    }
  }

  private _buildCombinedOutput(swarm: WorkerSwarm): string {
    if (swarm.results.length === 0) return '';
    return swarm.results
      .map((r, i) => `## ${swarm.name} — Worker ${i + 1} (${r.workerId})\n\n${r.output}`)
      .join('\n\n---\n\n');
  }

  private _snapshot(swarm: WorkerSwarm): WorkerSwarm {
    return { ...swarm, workers: [...swarm.workers], results: [...swarm.results] };
  }
}
