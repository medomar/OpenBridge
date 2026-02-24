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
    })
    .optional(),
  /** Error message (if failed or cancelled) */
  error: z.string().optional(),
  /** Number of worker-level retries attempted (distinct from AgentRunner's internal retries) */
  workerRetries: z.number().int().nonnegative().optional(),
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

// ── Worker Registry ─────────────────────────────────────────────

/**
 * Default maximum number of concurrent workers.
 * Prevents resource exhaustion when the Master spawns many workers in parallel.
 */
export const DEFAULT_MAX_CONCURRENT_WORKERS = 5;

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
   */
  public markRunning(workerId: string, pid: number): void {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found in registry`);
    }

    worker.status = 'running';
    worker.pid = pid;
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

      const onSlotFree = () => {
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
