/**
 * Worker Registry — Tracks active worker agents spawned by the Master AI.
 *
 * Enforces concurrency limits, persists worker state to .openbridge/workers.json,
 * and provides cross-restart visibility into active and completed workers.
 *
 * Mirrors OpenClaw's SubagentRunRecord pattern:
 * - Each worker gets a unique ID
 * - Task manifest, PID, status, and result are tracked
 * - Registry is persisted to disk for resume across restarts
 * - Max concurrent workers (default: 5) prevents resource exhaustion
 */

import { z } from 'zod';
import type { TaskManifest } from '../types/agent.js';
import { TaskManifestSchema } from '../types/agent.js';
import type { AgentResult } from '../core/agent-runner.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('worker-registry');

// ── Worker Record Schema ────────────────────────────────────────

/** Status of a worker execution */
export const WorkerStatusSchema = z.enum([
  'pending', // Queued but not started
  'running', // Currently executing
  'completed', // Finished successfully
  'failed', // Finished with error
  'cancelled', // Cancelled before completion
]);

export type WorkerStatus = z.infer<typeof WorkerStatusSchema>;

/**
 * A record of a single worker agent execution.
 * Stored in the registry to track active and completed workers.
 */
export const WorkerRecordSchema = z.object({
  /** Unique worker ID (e.g., 'worker-1708123456789') */
  id: z.string().min(1),
  /** The task manifest passed to this worker */
  taskManifest: TaskManifestSchema,
  /** Process ID (if running) */
  pid: z.number().int().nonnegative().optional(),
  /** When the worker started executing */
  startedAt: z.string().datetime(),
  /** When the worker finished (completed/failed/cancelled) */
  completedAt: z.string().datetime().optional(),
  /** Current status */
  status: WorkerStatusSchema,
  /** Result from AgentRunner (if completed or failed) */
  result: z
    .object({
      stdout: z.string(),
      stderr: z.string(),
      exitCode: z.number(),
      durationMs: z.number(),
      retryCount: z.number(),
      model: z.string().optional(),
      modelFallbacks: z.array(z.string()).optional(),
      turnsExhausted: z.boolean().optional(),
      turnsUsed: z.number().optional(),
      maxTurns: z.number().optional(),
      status: z.enum(['completed', 'partial', 'fix-cap-reached']).optional(),
      costUsd: z.number().optional(),
      fixIterationsUsed: z.number().optional(),
      fixCapReached: z.boolean().optional(),
    })
    .optional(),
  /** Error message (if failed or cancelled) */
  error: z.string().optional(),
  /** Number of worker-level retries attempted (distinct from AgentRunner's internal retries) */
  workerRetries: z.number().int().nonnegative().optional(),
  /** ISO timestamp of last reported progress — used by watchdog to detect stuck workers */
  lastProgressAt: z.string().datetime().optional(),
});

export type WorkerRecord = z.infer<typeof WorkerRecordSchema>;

/**
 * The workers registry stored in .openbridge/workers.json.
 */
export const WorkersRegistrySchema = z.object({
  /** All worker records keyed by ID */
  workers: z.record(z.string(), WorkerRecordSchema),
  /** When the registry was last updated */
  updatedAt: z.string().datetime(),
});

export type WorkersRegistry = z.infer<typeof WorkersRegistrySchema>;

// ── Worker Stats ────────────────────────────────────────────────

/** Breakdown stats for a profile or model */
const WorkerGroupStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgDurationMs: z.number().nonnegative(),
});

/** Aggregated worker statistics */
export const WorkerStatsSchema = z.object({
  totalWorkers: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  avgDurationMs: z.number().nonnegative(),
  byProfile: z.record(z.string(), WorkerGroupStatsSchema),
  byModel: z.record(z.string(), WorkerGroupStatsSchema),
});

export type WorkerStats = z.infer<typeof WorkerStatsSchema>;

// ── Worker Registry ─────────────────────────────────────────────

/**
 * Default maximum number of concurrent workers.
 * Prevents resource exhaustion when the Master spawns many workers in parallel.
 */
export const DEFAULT_MAX_CONCURRENT_WORKERS = 5;

/**
 * Timeout for workers stuck in pending status (5 minutes).
 * If a worker has not transitioned out of 'pending' within this window,
 * the watchdog auto-cancels it and removes it from the registry.
 */
export const PENDING_WORKER_TIMEOUT_MS = 300_000;

/**
 * WorkerRegistry tracks active and completed worker agents.
 *
 * Features:
 * - Add workers to the registry before spawning
 * - Update worker status as they progress
 * - Enforce max concurrent workers limit
 * - Persist registry to disk for cross-restart visibility
 * - Query active, completed, and failed workers
 */
export class WorkerRegistry {
  private workers: Map<string, WorkerRecord> = new Map();
  private readonly maxConcurrentWorkers: number;
  /** FIFO queue of resolvers waiting for a worker slot to free up */
  private slotWaiters: Array<() => void> = [];
  /** Watchdog interval timer — null when not running */
  private watchdogTimer: NodeJS.Timeout | null = null;
  /** Watchdog timeout for read-only workers in milliseconds (default: 10 minutes) */
  private watchdogReadOnlyMs: number = 10 * 60 * 1000;
  /** Watchdog timeout for code-edit and full-access workers in milliseconds (default: 30 minutes) */
  private watchdogCodeEditMs: number = 30 * 60 * 1000;

  constructor(opts?: { maxConcurrentWorkers?: number }) {
    this.maxConcurrentWorkers = opts?.maxConcurrentWorkers ?? DEFAULT_MAX_CONCURRENT_WORKERS;
  }

  /**
   * Generate a unique worker ID.
   * Format: 'worker-{timestamp}-{random}'
   */
  public generateWorkerId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `worker-${timestamp}-${random}`;
  }

  /**
   * Add a new worker to the registry with 'pending' status.
   * Returns the worker ID.
   * Throws if max concurrent workers limit is reached.
   */
  public addWorker(taskManifest: TaskManifest): string {
    // Check concurrent workers limit
    const runningCount = this.getRunningWorkers().length;
    if (runningCount >= this.maxConcurrentWorkers) {
      throw new Error(
        `Max concurrent workers (${this.maxConcurrentWorkers}) reached. ` +
          `Running workers: ${runningCount}`,
      );
    }

    const id = this.generateWorkerId();
    const worker: WorkerRecord = {
      id,
      taskManifest,
      startedAt: new Date().toISOString(),
      status: 'pending',
    };

    this.workers.set(id, worker);
    return id;
  }

  /**
   * Mark a worker as running and record its PID.
   * Initializes lastProgressAt to the current time for watchdog tracking.
   */
  public markRunning(workerId: string, pid: number): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found in registry`);
    }

    worker.status = 'running';
    worker.pid = pid;
    worker.lastProgressAt = new Date().toISOString();
    this.workers.set(workerId, worker);
  }

  /**
   * Mark a worker as completed with its result.
   */
  public markCompleted(workerId: string, result: AgentResult): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found in registry`);
    }

    worker.status = 'completed';
    worker.completedAt = new Date().toISOString();
    worker.result = result;
    worker.pid = undefined; // Process no longer running
    this.workers.set(workerId, worker);
    this.notifySlotWaiters();
  }

  /**
   * Mark a worker as failed with its result and optional error message.
   */
  public markFailed(workerId: string, result: AgentResult, error?: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found in registry`);
    }

    worker.status = 'failed';
    worker.completedAt = new Date().toISOString();
    worker.result = result;
    worker.error = error;
    worker.pid = undefined; // Process no longer running
    this.workers.set(workerId, worker);
    this.notifySlotWaiters();
  }

  /**
   * Mark a worker as cancelled with an error message.
   */
  public markCancelled(workerId: string, error: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found in registry`);
    }

    worker.status = 'cancelled';
    worker.completedAt = new Date().toISOString();
    worker.error = error;
    worker.pid = undefined; // Process no longer running
    this.workers.set(workerId, worker);
    this.notifySlotWaiters();
  }

  /**
   * Wait for a worker slot to become available.
   * Returns a Promise that resolves when a running worker completes/fails/cancels.
   * Waiters are resolved in FIFO order.
   * @param timeoutMs Maximum time to wait (default: 5 minutes). Throws on timeout.
   */
  public waitForSlot(timeoutMs = 300_000): Promise<void> {
    // If already under capacity, resolve immediately
    if (!this.isAtCapacity()) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this waiter from the queue
        const idx = this.slotWaiters.indexOf(onSlotFree);
        if (idx !== -1) this.slotWaiters.splice(idx, 1);
        reject(new Error(`Timed out waiting for worker slot after ${timeoutMs}ms`));
      }, timeoutMs);

      const onSlotFree = (): void => {
        clearTimeout(timer);
        resolve();
      };

      this.slotWaiters.push(onSlotFree);
    });
  }

  /**
   * Notify the first waiter in the FIFO queue that a slot has freed up.
   */
  private notifySlotWaiters(): void {
    if (this.slotWaiters.length > 0 && !this.isAtCapacity()) {
      const waiter = this.slotWaiters.shift();
      waiter?.();
    }
  }

  /**
   * Get a worker record by ID.
   * Returns undefined if not found.
   */
  public getWorker(workerId: string): WorkerRecord | undefined {
    return this.workers.get(workerId);
  }

  /**
   * Get all worker records.
   */
  public getAllWorkers(): WorkerRecord[] {
    return Array.from(this.workers.values());
  }

  /**
   * Get all running workers.
   */
  public getRunningWorkers(): WorkerRecord[] {
    return this.getAllWorkers().filter((w) => w.status === 'running');
  }

  /**
   * Get all pending workers.
   */
  public getPendingWorkers(): WorkerRecord[] {
    return this.getAllWorkers().filter((w) => w.status === 'pending');
  }

  /**
   * Get all completed workers.
   */
  public getCompletedWorkers(): WorkerRecord[] {
    return this.getAllWorkers().filter((w) => w.status === 'completed');
  }

  /**
   * Get all failed workers.
   */
  public getFailedWorkers(): WorkerRecord[] {
    return this.getAllWorkers().filter((w) => w.status === 'failed');
  }

  /**
   * Get all cancelled workers.
   */
  public getCancelledWorkers(): WorkerRecord[] {
    return this.getAllWorkers().filter((w) => w.status === 'cancelled');
  }

  /**
   * Check if max concurrent workers limit is reached.
   */
  public isAtCapacity(): boolean {
    return this.getRunningWorkers().length >= this.maxConcurrentWorkers;
  }

  /**
   * Get the current number of running workers.
   */
  public getRunningCount(): number {
    return this.getRunningWorkers().length;
  }

  /**
   * Get the max concurrent workers limit.
   */
  public getMaxConcurrentWorkers(): number {
    return this.maxConcurrentWorkers;
  }

  /**
   * Register a worker with a specific (caller-supplied) ID.
   * Used when the worker ID is determined externally — e.g., the `-escalated` suffix
   * workers created by `respawnWorkerAfterGrant()`.
   * Enforces the same concurrency limit as `addWorker()`.
   * Throws if max concurrent workers limit is reached.
   */
  public registerWorkerWithId(id: string, taskManifest: TaskManifest): void {
    const runningCount = this.getRunningWorkers().length;
    if (runningCount >= this.maxConcurrentWorkers) {
      throw new Error(
        `Max concurrent workers (${this.maxConcurrentWorkers}) reached. ` +
          `Running workers: ${runningCount}`,
      );
    }

    const worker: WorkerRecord = {
      id,
      taskManifest,
      startedAt: new Date().toISOString(),
      status: 'pending',
    };

    this.workers.set(id, worker);
  }

  /**
   * Remove a worker from the registry.
   * Useful for cleanup after a worker is no longer needed.
   */
  public removeWorker(workerId: string): boolean {
    return this.workers.delete(workerId);
  }

  /**
   * Clear all workers from the registry.
   */
  public clear(): void {
    this.workers.clear();
  }

  /**
   * Get workers that are stuck in a non-terminal state (pending or running).
   * These are workers that have not completed, failed, or been cancelled —
   * they may be orphaned if their process has died without updating their status.
   */
  public getOrphanedWorkers(): WorkerRecord[] {
    return this.getAllWorkers().filter((w) => w.status === 'pending' || w.status === 'running');
  }

  /**
   * Compute aggregated statistics across all workers in the registry.
   * Breaks down by status, profile, and model.
   * Logs a WARNING if total workers != completed + failed + cancelled (orphans detected).
   */
  public getAggregatedStats(): WorkerStats {
    const workers = this.getAllWorkers();
    const completed = workers.filter((w) => w.status === 'completed');
    const failed = workers.filter((w) => w.status === 'failed');
    const cancelled = workers.filter((w) => w.status === 'cancelled');

    // Audit: detect orphaned workers (not in any terminal state)
    const terminalCount = completed.length + failed.length + cancelled.length;
    if (workers.length !== terminalCount) {
      const orphaned = this.getOrphanedWorkers();
      const orphanDetails = orphaned.map((w) => `${w.id}(${w.status})`).join(', ');
      logger.warn(
        {
          orphanCount: orphaned.length,
          total: workers.length,
          terminalCount,
          orphanIds: orphaned.map((w) => w.id),
        },
        `Worker state audit: ${orphaned.length} orphaned worker(s) detected [${orphanDetails}]`,
      );

      // Auto-cancel orphaned pending workers — they never started, so they cannot recover
      for (const orphan of orphaned) {
        if (orphan.status === 'pending') {
          try {
            this.markCancelled(
              orphan.id,
              'auto-cancelled: orphaned pending worker detected in stats audit',
            );
          } catch (err) {
            logger.warn(
              { workerId: orphan.id, err },
              'Worker state audit: failed to cancel orphaned pending worker',
            );
          }
          this.removeWorker(orphan.id);
        }
      }
    }

    // Average duration across completed + failed (those with results)
    const withDuration = workers.filter((w) => w.result?.durationMs !== undefined);
    const avgDurationMs =
      withDuration.length > 0
        ? withDuration.reduce((sum, w) => sum + w.result!.durationMs, 0) / withDuration.length
        : 0;

    // Group by profile
    const byProfile: Record<string, { total: number; successRate: number; avgDurationMs: number }> =
      {};
    const profileGroups = new Map<string, WorkerRecord[]>();
    for (const w of workers) {
      const profile = w.taskManifest.profile ?? 'unknown';
      const group = profileGroups.get(profile) ?? [];
      group.push(w);
      profileGroups.set(profile, group);
    }
    for (const [profile, group] of profileGroups) {
      const successes = group.filter((w) => w.status === 'completed').length;
      const withDur = group.filter((w) => w.result?.durationMs !== undefined);
      const avgDur =
        withDur.length > 0
          ? withDur.reduce((sum, w) => sum + w.result!.durationMs, 0) / withDur.length
          : 0;
      byProfile[profile] = {
        total: group.length,
        successRate: group.length > 0 ? successes / group.length : 0,
        avgDurationMs: Math.round(avgDur),
      };
    }

    // Group by model
    const byModel: Record<string, { total: number; successRate: number; avgDurationMs: number }> =
      {};
    const modelGroups = new Map<string, WorkerRecord[]>();
    for (const w of workers) {
      const model = w.taskManifest.model ?? w.result?.model ?? 'unknown';
      const group = modelGroups.get(model) ?? [];
      group.push(w);
      modelGroups.set(model, group);
    }
    for (const [model, group] of modelGroups) {
      const successes = group.filter((w) => w.status === 'completed').length;
      const withDur = group.filter((w) => w.result?.durationMs !== undefined);
      const avgDur =
        withDur.length > 0
          ? withDur.reduce((sum, w) => sum + w.result!.durationMs, 0) / withDur.length
          : 0;
      byModel[model] = {
        total: group.length,
        successRate: group.length > 0 ? successes / group.length : 0,
        avgDurationMs: Math.round(avgDur),
      };
    }

    return {
      totalWorkers: workers.length,
      completed: completed.length,
      failed: failed.length,
      cancelled: cancelled.length,
      avgDurationMs: Math.round(avgDurationMs),
      byProfile,
      byModel,
    };
  }

  /**
   * Update the last progress timestamp for a running worker.
   * Called by the caller (e.g., MasterManager) when the worker reports new output,
   * preventing the watchdog from treating it as stuck.
   */
  public updateProgress(workerId: string): void {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    worker.lastProgressAt = new Date().toISOString();
    this.workers.set(workerId, worker);
  }

  /**
   * Start the watchdog timer.
   *
   * Periodically checks all running workers. If a worker has not reported
   * progress within the configured timeout for its profile, the worker is
   * force-killed via SIGKILL and marked as failed with reason 'watchdog-timeout'.
   *
   * Timeouts:
   *  - read-only workers:              default 10 minutes
   *  - code-edit / full-access / other: default 30 minutes
   *
   * @param opts.readOnlyMs    Timeout in ms for read-only workers (overrides default)
   * @param opts.codeEditMs    Timeout in ms for code-edit/full-access workers (overrides default)
   * @param opts.intervalMs    How often the watchdog checks workers (default: 60 000 ms)
   */
  public startWatchdog(opts?: {
    readOnlyMs?: number;
    codeEditMs?: number;
    intervalMs?: number;
  }): void {
    if (this.watchdogTimer !== null) return; // already running

    if (opts?.readOnlyMs !== undefined) this.watchdogReadOnlyMs = opts.readOnlyMs;
    if (opts?.codeEditMs !== undefined) this.watchdogCodeEditMs = opts.codeEditMs;

    const intervalMs = opts?.intervalMs ?? 60_000;
    this.watchdogTimer = setInterval(() => this.runWatchdogCheck(), intervalMs);

    // Allow the Node.js process to exit even if the watchdog timer is still set
    if (typeof this.watchdogTimer.unref === 'function') {
      this.watchdogTimer.unref();
    }

    logger.info(
      {
        readOnlyMinutes: Math.round(this.watchdogReadOnlyMs / 60_000),
        codeEditMinutes: Math.round(this.watchdogCodeEditMs / 60_000),
        intervalMs,
      },
      'Worker watchdog started',
    );
  }

  /**
   * Stop the watchdog timer.
   */
  public stopWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
      logger.info('Worker watchdog stopped');
    }
  }

  /**
   * Returns true if the watchdog timer is currently running.
   */
  public isWatchdogRunning(): boolean {
    return this.watchdogTimer !== null;
  }

  /**
   * Internal watchdog check — runs on each interval tick.
   * Finds running workers whose progress has stalled beyond their timeout,
   * force-kills them, and marks them as failed.
   * Also finds pending workers stuck beyond PENDING_WORKER_TIMEOUT_MS,
   * marks them as failed, and removes them from the registry.
   */
  private runWatchdogCheck(): void {
    const now = Date.now();
    const runningWorkers = this.getRunningWorkers();

    for (const worker of runningWorkers) {
      // Use lastProgressAt if set, otherwise fall back to startedAt
      const lastProgress = worker.lastProgressAt ?? worker.startedAt;
      const elapsed = now - new Date(lastProgress).getTime();

      // Determine timeout by profile: read-only gets shorter timeout
      const profile = worker.taskManifest.profile ?? 'full-access';
      const timeoutMs = profile === 'read-only' ? this.watchdogReadOnlyMs : this.watchdogCodeEditMs;

      if (elapsed <= timeoutMs) continue;

      const elapsedMinutes = Math.round(elapsed / 60_000);
      logger.warn(
        { workerId: worker.id, profile, pid: worker.pid, elapsedMinutes },
        `Watchdog: worker exceeded ${elapsedMinutes}m without progress — force-killing`,
      );

      // Force-kill via PID
      if (worker.pid !== undefined) {
        try {
          process.kill(worker.pid, 'SIGKILL');
        } catch (err) {
          logger.warn(
            { workerId: worker.id, pid: worker.pid, err },
            'Watchdog: failed to send SIGKILL to worker process (may have already exited)',
          );
        }
      }

      // Mark as failed with watchdog-timeout reason
      try {
        this.markFailed(
          worker.id,
          {
            stdout: '',
            stderr: `Worker killed by watchdog after ${elapsedMinutes} minutes without progress`,
            exitCode: 137, // SIGKILL exit code
            durationMs: elapsed,
            retryCount: 0,
            status: 'completed',
          },
          'watchdog-timeout',
        );
      } catch (err) {
        logger.warn({ workerId: worker.id, err }, 'Watchdog: failed to mark worker as failed');
      }
    }

    // Check pending workers — auto-cancel those stuck beyond PENDING_WORKER_TIMEOUT_MS
    const pendingWorkers = this.getPendingWorkers();

    for (const worker of pendingWorkers) {
      const elapsed = now - new Date(worker.startedAt).getTime();

      if (elapsed <= PENDING_WORKER_TIMEOUT_MS) continue;

      const elapsedMinutes = Math.round(elapsed / 60_000);
      logger.warn(
        { workerId: worker.id, elapsedMinutes },
        `Watchdog: pending worker exceeded ${elapsedMinutes}m without starting — auto-cancelling`,
      );

      // Mark as failed with pending-timeout reason
      try {
        this.markFailed(
          worker.id,
          {
            stdout: '',
            stderr: `Pending worker timed out after ${elapsedMinutes} minutes without starting`,
            exitCode: -1,
            durationMs: elapsed,
            retryCount: 0,
            status: 'completed',
          },
          'pending-timeout',
        );
      } catch (err) {
        logger.warn(
          { workerId: worker.id, err },
          'Watchdog: failed to mark pending worker as failed',
        );
      }

      // Remove from registry to free the slot
      this.removeWorker(worker.id);
    }
  }

  /**
   * Serialize the registry to a WorkersRegistry object for persistence.
   */
  public toJSON(): WorkersRegistry {
    const workers: Record<string, WorkerRecord> = {};
    for (const [id, worker] of this.workers.entries()) {
      workers[id] = worker;
    }

    return {
      workers,
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Load the registry from a WorkersRegistry object.
   * Clears existing workers before loading.
   */
  public fromJSON(registry: WorkersRegistry): void {
    this.workers.clear();
    for (const [id, worker] of Object.entries(registry.workers)) {
      // Validate before loading
      const validated = WorkerRecordSchema.parse(worker);
      this.workers.set(id, validated);
    }
  }
}
