import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  WorkerRegistry,
  DEFAULT_MAX_CONCURRENT_WORKERS,
  PENDING_WORKER_TIMEOUT_MS,
  type WorkersRegistry,
} from '../../src/master/worker-registry.js';
import type { TaskManifest } from '../../src/types/agent.js';
import type { AgentResult } from '../../src/core/agent-runner.js';

describe('WorkerRegistry', () => {
  let registry: WorkerRegistry;

  const sampleManifest: TaskManifest = {
    prompt: 'Test task',
    workspacePath: '/test/workspace',
    model: 'haiku',
    profile: 'read-only',
    maxTurns: 10,
  };

  const sampleResult: AgentResult = {
    stdout: 'Task completed successfully',
    stderr: '',
    exitCode: 0,
    durationMs: 5000,
    retryCount: 0,
    model: 'haiku',
    status: 'completed',
  };

  beforeEach(() => {
    registry = new WorkerRegistry();
  });

  describe('constructor', () => {
    it('should use default max concurrent workers', () => {
      const reg = new WorkerRegistry();
      expect(reg.getMaxConcurrentWorkers()).toBe(DEFAULT_MAX_CONCURRENT_WORKERS);
    });

    it('should accept custom max concurrent workers', () => {
      const reg = new WorkerRegistry({ maxConcurrentWorkers: 10 });
      expect(reg.getMaxConcurrentWorkers()).toBe(10);
    });
  });

  describe('generateWorkerId', () => {
    it('should generate unique worker IDs', () => {
      const id1 = registry.generateWorkerId();
      const id2 = registry.generateWorkerId();

      expect(id1).toMatch(/^worker-\d+-[a-z0-9]{6}$/);
      expect(id2).toMatch(/^worker-\d+-[a-z0-9]{6}$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('addWorker', () => {
    it('should add a worker with pending status', () => {
      const workerId = registry.addWorker(sampleManifest);

      expect(workerId).toBeDefined();
      const worker = registry.getWorker(workerId);
      expect(worker).toBeDefined();
      expect(worker?.status).toBe('pending');
      expect(worker?.taskManifest).toEqual(sampleManifest);
      expect(worker?.startedAt).toBeDefined();
      expect(worker?.pid).toBeUndefined();
      expect(worker?.completedAt).toBeUndefined();
    });

    it('should enforce max concurrent workers limit', () => {
      const reg = new WorkerRegistry({ maxConcurrentWorkers: 2 });

      // Add 2 workers and mark them as running
      const id1 = reg.addWorker(sampleManifest);
      reg.markRunning(id1, 1001);

      const id2 = reg.addWorker(sampleManifest);
      reg.markRunning(id2, 1002);

      // Attempt to add a third worker should fail
      expect(() => reg.addWorker(sampleManifest)).toThrow('Max concurrent workers (2) reached');
    });

    it('should allow adding workers if some are completed', () => {
      const reg = new WorkerRegistry({ maxConcurrentWorkers: 2 });

      // Add 2 workers, mark as running
      const id1 = reg.addWorker(sampleManifest);
      reg.markRunning(id1, 1001);

      const id2 = reg.addWorker(sampleManifest);
      reg.markRunning(id2, 1002);

      // Complete one worker
      reg.markCompleted(id1, sampleResult);

      // Should now be able to add a third worker (only 1 running)
      const id3 = reg.addWorker(sampleManifest);
      expect(id3).toBeDefined();
    });
  });

  describe('markRunning', () => {
    it('should mark a worker as running and record PID', () => {
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 12345);

      const worker = registry.getWorker(workerId);
      expect(worker?.status).toBe('running');
      expect(worker?.pid).toBe(12345);
    });

    it('should throw if worker not found', () => {
      expect(() => registry.markRunning('nonexistent', 12345)).toThrow(
        'Worker nonexistent not found',
      );
    });
  });

  describe('markCompleted', () => {
    it('should mark a worker as completed with result', () => {
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 12345);
      registry.markCompleted(workerId, sampleResult);

      const worker = registry.getWorker(workerId);
      expect(worker?.status).toBe('completed');
      expect(worker?.result).toEqual(sampleResult);
      expect(worker?.completedAt).toBeDefined();
      expect(worker?.pid).toBeUndefined();
    });

    it('should throw if worker not found', () => {
      expect(() => registry.markCompleted('nonexistent', sampleResult)).toThrow(
        'Worker nonexistent not found',
      );
    });
  });

  describe('markFailed', () => {
    const failedResult: AgentResult = {
      stdout: '',
      stderr: 'Error occurred',
      exitCode: 1,
      durationMs: 2000,
      retryCount: 3,
      model: 'haiku',
      status: 'completed',
    };

    it('should mark a worker as failed with result and error', () => {
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 12345);
      registry.markFailed(workerId, failedResult, 'Task execution failed');

      const worker = registry.getWorker(workerId);
      expect(worker?.status).toBe('failed');
      expect(worker?.result).toEqual(failedResult);
      expect(worker?.error).toBe('Task execution failed');
      expect(worker?.completedAt).toBeDefined();
      expect(worker?.pid).toBeUndefined();
    });

    it('should mark as failed without error message', () => {
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 12345);
      registry.markFailed(workerId, failedResult);

      const worker = registry.getWorker(workerId);
      expect(worker?.status).toBe('failed');
      expect(worker?.error).toBeUndefined();
    });

    it('should throw if worker not found', () => {
      expect(() => registry.markFailed('nonexistent', failedResult)).toThrow(
        'Worker nonexistent not found',
      );
    });
  });

  describe('markCancelled', () => {
    it('should mark a worker as cancelled with error', () => {
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 12345);
      registry.markCancelled(workerId, 'Worker timed out');

      const worker = registry.getWorker(workerId);
      expect(worker?.status).toBe('cancelled');
      expect(worker?.error).toBe('Worker timed out');
      expect(worker?.completedAt).toBeDefined();
      expect(worker?.pid).toBeUndefined();
    });

    it('should throw if worker not found', () => {
      expect(() => registry.markCancelled('nonexistent', 'Cancelled')).toThrow(
        'Worker nonexistent not found',
      );
    });
  });

  describe('getWorker', () => {
    it('should return worker by ID', () => {
      const workerId = registry.addWorker(sampleManifest);
      const worker = registry.getWorker(workerId);

      expect(worker).toBeDefined();
      expect(worker?.id).toBe(workerId);
    });

    it('should return undefined for nonexistent worker', () => {
      const worker = registry.getWorker('nonexistent');
      expect(worker).toBeUndefined();
    });
  });

  describe('getAllWorkers', () => {
    it('should return empty array for empty registry', () => {
      expect(registry.getAllWorkers()).toEqual([]);
    });

    it('should return all workers', () => {
      const id1 = registry.addWorker(sampleManifest);
      const id2 = registry.addWorker(sampleManifest);

      const workers = registry.getAllWorkers();
      expect(workers).toHaveLength(2);
      expect(workers.map((w) => w.id)).toContain(id1);
      expect(workers.map((w) => w.id)).toContain(id2);
    });
  });

  describe('filter methods', () => {
    beforeEach(() => {
      // Add workers in various states
      const _w1 = registry.addWorker(sampleManifest);
      // _w1 stays pending

      const w2 = registry.addWorker(sampleManifest);
      registry.markRunning(w2, 1001);

      const w3 = registry.addWorker(sampleManifest);
      registry.markRunning(w3, 1002);
      registry.markCompleted(w3, sampleResult);

      const w4 = registry.addWorker(sampleManifest);
      registry.markRunning(w4, 1003);
      registry.markFailed(w4, { ...sampleResult, exitCode: 1 }, 'Task failed');

      const w5 = registry.addWorker(sampleManifest);
      registry.markRunning(w5, 1004);
      registry.markCancelled(w5, 'Timeout');
    });

    it('should get pending workers', () => {
      const pending = registry.getPendingWorkers();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.status).toBe('pending');
    });

    it('should get running workers', () => {
      const running = registry.getRunningWorkers();
      expect(running).toHaveLength(1);
      expect(running[0]?.status).toBe('running');
    });

    it('should get completed workers', () => {
      const completed = registry.getCompletedWorkers();
      expect(completed).toHaveLength(1);
      expect(completed[0]?.status).toBe('completed');
    });

    it('should get failed workers', () => {
      const failed = registry.getFailedWorkers();
      expect(failed).toHaveLength(1);
      expect(failed[0]?.status).toBe('failed');
    });

    it('should get cancelled workers', () => {
      const cancelled = registry.getCancelledWorkers();
      expect(cancelled).toHaveLength(1);
      expect(cancelled[0]?.status).toBe('cancelled');
    });
  });

  describe('capacity checks', () => {
    it('should check if at capacity', () => {
      const reg = new WorkerRegistry({ maxConcurrentWorkers: 2 });

      expect(reg.isAtCapacity()).toBe(false);
      expect(reg.getRunningCount()).toBe(0);

      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);

      expect(reg.isAtCapacity()).toBe(false);
      expect(reg.getRunningCount()).toBe(1);

      const w2 = reg.addWorker(sampleManifest);
      reg.markRunning(w2, 1002);

      expect(reg.isAtCapacity()).toBe(true);
      expect(reg.getRunningCount()).toBe(2);

      reg.markCompleted(w1, sampleResult);

      expect(reg.isAtCapacity()).toBe(false);
      expect(reg.getRunningCount()).toBe(1);
    });
  });

  describe('removeWorker', () => {
    it('should remove a worker by ID', () => {
      const workerId = registry.addWorker(sampleManifest);

      expect(registry.getWorker(workerId)).toBeDefined();

      const removed = registry.removeWorker(workerId);
      expect(removed).toBe(true);
      expect(registry.getWorker(workerId)).toBeUndefined();
    });

    it('should return false for nonexistent worker', () => {
      const removed = registry.removeWorker('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all workers', () => {
      registry.addWorker(sampleManifest);
      registry.addWorker(sampleManifest);

      expect(registry.getAllWorkers()).toHaveLength(2);

      registry.clear();

      expect(registry.getAllWorkers()).toHaveLength(0);
    });
  });

  describe('toJSON', () => {
    it('should serialize registry to JSON', () => {
      const w1 = registry.addWorker(sampleManifest);
      registry.markRunning(w1, 1001);

      const w2 = registry.addWorker(sampleManifest);
      registry.markRunning(w2, 1002);
      registry.markCompleted(w2, sampleResult);

      const json = registry.toJSON();

      expect(json).toHaveProperty('workers');
      expect(json).toHaveProperty('updatedAt');
      expect(Object.keys(json.workers)).toHaveLength(2);
      expect(json.workers[w1]).toEqual(registry.getWorker(w1));
      expect(json.workers[w2]).toEqual(registry.getWorker(w2));
    });

    it('should serialize empty registry', () => {
      const json = registry.toJSON();

      expect(json.workers).toEqual({});
      expect(json.updatedAt).toBeDefined();
    });
  });

  describe('fromJSON', () => {
    it('should load registry from JSON', () => {
      const w1 = registry.addWorker(sampleManifest);
      registry.markRunning(w1, 1001);

      const w2 = registry.addWorker(sampleManifest);
      registry.markCompleted(w2, sampleResult);

      const json = registry.toJSON();

      // Create a new registry and load
      const newRegistry = new WorkerRegistry();
      newRegistry.fromJSON(json);

      expect(newRegistry.getAllWorkers()).toHaveLength(2);
      expect(newRegistry.getWorker(w1)).toEqual(registry.getWorker(w1));
      expect(newRegistry.getWorker(w2)).toEqual(registry.getWorker(w2));
    });

    it('should clear existing workers before loading', () => {
      const w1 = registry.addWorker(sampleManifest);
      const json1 = registry.toJSON();

      const newRegistry = new WorkerRegistry();
      const w2 = newRegistry.addWorker(sampleManifest);

      expect(newRegistry.getAllWorkers()).toHaveLength(1);

      newRegistry.fromJSON(json1);

      expect(newRegistry.getAllWorkers()).toHaveLength(1);
      expect(newRegistry.getWorker(w1)).toBeDefined();
      expect(newRegistry.getWorker(w2)).toBeUndefined();
    });

    it('should validate worker records on load', () => {
      const invalidRegistry = {
        workers: {
          'invalid-worker': {
            id: 'invalid-worker',
            // Missing required fields
          },
        },
        updatedAt: new Date().toISOString(),
      } as unknown as WorkersRegistry;

      const newRegistry = new WorkerRegistry();

      expect(() => newRegistry.fromJSON(invalidRegistry)).toThrow();
    });
  });

  describe('integration scenarios', () => {
    it('should handle full worker lifecycle', () => {
      // Add worker
      const workerId = registry.addWorker(sampleManifest);
      expect(registry.getWorker(workerId)?.status).toBe('pending');

      // Start worker
      registry.markRunning(workerId, 12345);
      expect(registry.getWorker(workerId)?.status).toBe('running');
      expect(registry.getWorker(workerId)?.pid).toBe(12345);
      expect(registry.getRunningCount()).toBe(1);

      // Complete worker
      registry.markCompleted(workerId, sampleResult);
      expect(registry.getWorker(workerId)?.status).toBe('completed');
      expect(registry.getWorker(workerId)?.result).toEqual(sampleResult);
      expect(registry.getWorker(workerId)?.pid).toBeUndefined();
      expect(registry.getRunningCount()).toBe(0);
    });

    it('should handle concurrent workers with capacity limit', () => {
      const reg = new WorkerRegistry({ maxConcurrentWorkers: 3 });

      // Add 3 workers
      const w1 = reg.addWorker(sampleManifest);
      const w2 = reg.addWorker(sampleManifest);
      const w3 = reg.addWorker(sampleManifest);

      // Mark all as running
      reg.markRunning(w1, 1001);
      reg.markRunning(w2, 1002);
      reg.markRunning(w3, 1003);

      expect(reg.isAtCapacity()).toBe(true);
      expect(reg.getRunningCount()).toBe(3);

      // Cannot add fourth
      expect(() => reg.addWorker(sampleManifest)).toThrow();

      // Complete one
      reg.markCompleted(w1, sampleResult);

      expect(reg.isAtCapacity()).toBe(false);
      expect(reg.getRunningCount()).toBe(2);

      // Can now add fourth
      const w4 = reg.addWorker(sampleManifest);
      reg.markRunning(w4, 1004);

      expect(reg.getRunningCount()).toBe(3);
      expect(reg.isAtCapacity()).toBe(true);
    });

    it('should persist and restore state across restarts', () => {
      // Simulate first session
      const session1 = new WorkerRegistry({ maxConcurrentWorkers: 5 });

      const _w1 = session1.addWorker(sampleManifest);
      session1.markRunning(_w1, 1001);

      const w2 = session1.addWorker(sampleManifest);
      session1.markRunning(w2, 1002);
      session1.markCompleted(w2, sampleResult);

      const w3 = session1.addWorker(sampleManifest);
      session1.markRunning(w3, 1003);
      session1.markFailed(w3, { ...sampleResult, exitCode: 1 }, 'Task failed');

      // Save state
      const persistedState = session1.toJSON();

      // Simulate second session (restart)
      const session2 = new WorkerRegistry({ maxConcurrentWorkers: 5 });
      session2.fromJSON(persistedState);

      // Verify state restored
      expect(session2.getAllWorkers()).toHaveLength(3);
      expect(session2.getWorker(_w1)?.status).toBe('running');
      expect(session2.getWorker(w2)?.status).toBe('completed');
      expect(session2.getWorker(w3)?.status).toBe('failed');
      expect(session2.getRunningCount()).toBe(1);
    });
  });

  describe('Backpressure — waitForSlot()', () => {
    it('should resolve immediately if under capacity', async () => {
      const reg = new WorkerRegistry({ maxConcurrentWorkers: 2 });
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);

      // Only 1 running, capacity is 2 — should resolve immediately
      await expect(reg.waitForSlot()).resolves.toBeUndefined();
    });

    it('should wait and resolve when a slot frees up', async () => {
      const reg = new WorkerRegistry({ maxConcurrentWorkers: 1 });
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);

      expect(reg.isAtCapacity()).toBe(true);

      let resolved = false;
      const waitPromise = reg.waitForSlot(5000).then(() => {
        resolved = true;
      });

      // Not resolved yet
      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);

      // Complete the worker — frees a slot
      reg.markCompleted(w1, sampleResult);

      await waitPromise;
      expect(resolved).toBe(true);
    });

    it('should resolve when a worker fails (not just completes)', async () => {
      const reg = new WorkerRegistry({ maxConcurrentWorkers: 1 });
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);

      let resolved = false;
      const waitPromise = reg.waitForSlot(5000).then(() => {
        resolved = true;
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);

      // Fail the worker — should also free a slot
      reg.markFailed(w1, { ...sampleResult, exitCode: 1 }, 'error');

      await waitPromise;
      expect(resolved).toBe(true);
    });

    it('should resolve when a worker is cancelled', async () => {
      const reg = new WorkerRegistry({ maxConcurrentWorkers: 1 });
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);

      let resolved = false;
      const waitPromise = reg.waitForSlot(5000).then(() => {
        resolved = true;
      });

      await new Promise((r) => setTimeout(r, 10));
      expect(resolved).toBe(false);

      reg.markCancelled(w1, 'cancelled by user');

      await waitPromise;
      expect(resolved).toBe(true);
    });

    it('should resolve multiple waiters in FIFO order', async () => {
      const reg = new WorkerRegistry({ maxConcurrentWorkers: 1 });
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);

      const order: number[] = [];
      const wait1 = reg.waitForSlot(5000).then(() => order.push(1));
      const wait2 = reg.waitForSlot(5000).then(() => order.push(2));

      // Complete first worker — frees slot for first waiter
      reg.markCompleted(w1, sampleResult);
      await wait1;

      // Add and complete another worker — frees slot for second waiter
      const w2 = reg.addWorker(sampleManifest);
      reg.markRunning(w2, 1002);
      reg.markCompleted(w2, sampleResult);
      await wait2;

      expect(order).toEqual([1, 2]);
    });

    it('should reject on timeout if no slot frees up', async () => {
      vi.useFakeTimers();
      try {
        const reg = new WorkerRegistry({ maxConcurrentWorkers: 1 });
        const w1 = reg.addWorker(sampleManifest);
        reg.markRunning(w1, 1001);

        const waitPromise = reg.waitForSlot(1000);

        // Advance past timeout
        vi.advanceTimersByTime(1001);

        await expect(waitPromise).rejects.toThrow('Timed out waiting for worker slot');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ── getAggregatedStats ──────────────────────────────────────────

  describe('getAggregatedStats', () => {
    it('returns zeroes for empty registry', () => {
      const stats = registry.getAggregatedStats();
      expect(stats.totalWorkers).toBe(0);
      expect(stats.completed).toBe(0);
      expect(stats.failed).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.avgDurationMs).toBe(0);
      expect(Object.keys(stats.byProfile)).toHaveLength(0);
      expect(Object.keys(stats.byModel)).toHaveLength(0);
    });

    it('counts statuses correctly with mixed workers', () => {
      const w1 = registry.addWorker(sampleManifest);
      registry.markRunning(w1, 1001);
      registry.markCompleted(w1, sampleResult);

      const w2 = registry.addWorker(sampleManifest);
      registry.markRunning(w2, 1002);
      registry.markFailed(w2, { ...sampleResult, exitCode: 1, durationMs: 3000 }, 'some error');

      const w3 = registry.addWorker(sampleManifest);
      registry.markRunning(w3, 1003);
      registry.markCancelled(w3, 'timeout');

      const stats = registry.getAggregatedStats();
      expect(stats.totalWorkers).toBe(3);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.cancelled).toBe(1);
    });

    it('computes average duration from workers with results', () => {
      const w1 = registry.addWorker(sampleManifest);
      registry.markRunning(w1, 1001);
      registry.markCompleted(w1, { ...sampleResult, durationMs: 4000 });

      const w2 = registry.addWorker(sampleManifest);
      registry.markRunning(w2, 1002);
      registry.markCompleted(w2, { ...sampleResult, durationMs: 6000 });

      const stats = registry.getAggregatedStats();
      expect(stats.avgDurationMs).toBe(5000); // (4000 + 6000) / 2
    });

    it('breaks down by profile correctly', () => {
      const readOnlyManifest: TaskManifest = {
        ...sampleManifest,
        profile: 'read-only',
      };
      const codeEditManifest: TaskManifest = {
        ...sampleManifest,
        profile: 'code-edit',
      };

      const w1 = registry.addWorker(readOnlyManifest);
      registry.markRunning(w1, 1001);
      registry.markCompleted(w1, { ...sampleResult, durationMs: 2000 });

      const w2 = registry.addWorker(readOnlyManifest);
      registry.markRunning(w2, 1002);
      registry.markFailed(w2, { ...sampleResult, exitCode: 1, durationMs: 3000 });

      const w3 = registry.addWorker(codeEditManifest);
      registry.markRunning(w3, 1003);
      registry.markCompleted(w3, { ...sampleResult, durationMs: 8000 });

      const stats = registry.getAggregatedStats();
      expect(stats.byProfile['read-only'].total).toBe(2);
      expect(stats.byProfile['read-only'].successRate).toBe(0.5); // 1/2
      expect(stats.byProfile['read-only'].avgDurationMs).toBe(2500); // (2000+3000)/2
      expect(stats.byProfile['code-edit'].total).toBe(1);
      expect(stats.byProfile['code-edit'].successRate).toBe(1); // 1/1
      expect(stats.byProfile['code-edit'].avgDurationMs).toBe(8000);
    });

    it('breaks down by model correctly', () => {
      const haikuManifest: TaskManifest = { ...sampleManifest, model: 'haiku' };
      const sonnetManifest: TaskManifest = { ...sampleManifest, model: 'sonnet' };

      const w1 = registry.addWorker(haikuManifest);
      registry.markRunning(w1, 1001);
      registry.markCompleted(w1, { ...sampleResult, durationMs: 1000 });

      const w2 = registry.addWorker(haikuManifest);
      registry.markRunning(w2, 1002);
      registry.markCompleted(w2, { ...sampleResult, durationMs: 3000 });

      const w3 = registry.addWorker(sonnetManifest);
      registry.markRunning(w3, 1003);
      registry.markFailed(w3, { ...sampleResult, exitCode: 1, durationMs: 5000 });

      const stats = registry.getAggregatedStats();
      expect(stats.byModel['haiku'].total).toBe(2);
      expect(stats.byModel['haiku'].successRate).toBe(1); // 2/2
      expect(stats.byModel['haiku'].avgDurationMs).toBe(2000); // (1000+3000)/2
      expect(stats.byModel['sonnet'].total).toBe(1);
      expect(stats.byModel['sonnet'].successRate).toBe(0); // 0/1
      expect(stats.byModel['sonnet'].avgDurationMs).toBe(5000);
    });

    it('uses "unknown" for workers without profile or model', () => {
      const bareManifest: TaskManifest = {
        prompt: 'Bare task',
        workspacePath: '/test/workspace',
      };

      const w1 = registry.addWorker(bareManifest);
      registry.markRunning(w1, 1001);
      registry.markCompleted(w1, { ...sampleResult, model: undefined, durationMs: 1000 });

      const stats = registry.getAggregatedStats();
      expect(stats.byProfile['unknown']).toBeDefined();
      expect(stats.byProfile['unknown'].total).toBe(1);
      expect(stats.byModel['unknown']).toBeDefined();
      expect(stats.byModel['unknown'].total).toBe(1);
    });

    it('logs WARNING when orphaned workers are detected', async () => {
      // Import the logger module to spy on it
      const loggerModule = await import('../../src/core/logger.js');
      const warnSpy = vi.spyOn(loggerModule, 'createLogger').mockReturnValue({
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
      } as unknown as ReturnType<typeof loggerModule.createLogger>);

      const reg = new WorkerRegistry();
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);
      reg.markCompleted(w1, sampleResult);

      // Add a worker stuck in running state (orphan)
      const w2 = reg.addWorker(sampleManifest);
      reg.markRunning(w2, 1002);

      // Add a worker stuck in pending state (orphan)
      const _w3 = reg.addWorker(sampleManifest);

      const stats = reg.getAggregatedStats();
      // total=3, terminal=1 → 2 orphans
      expect(stats.totalWorkers).toBe(3);
      expect(stats.completed).toBe(1);

      warnSpy.mockRestore();
    });

    it('does not log WARNING when all workers are in terminal states', async () => {
      const loggerModule = await import('../../src/core/logger.js');
      const mockWarn = vi.fn();
      const warnSpy = vi.spyOn(loggerModule, 'createLogger').mockReturnValue({
        warn: mockWarn,
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: vi.fn(),
      } as unknown as ReturnType<typeof loggerModule.createLogger>);

      const reg = new WorkerRegistry();
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);
      reg.markCompleted(w1, sampleResult);

      const w2 = reg.addWorker(sampleManifest);
      reg.markRunning(w2, 1002);
      reg.markFailed(w2, { ...sampleResult, exitCode: 1 }, 'error');

      const stats = reg.getAggregatedStats();
      // total=2, terminal=2 → no orphans → no warning
      expect(stats.totalWorkers).toBe(2);

      warnSpy.mockRestore();
    });
  });

  // ── OB-1647: Watchdog, escalation, /workers data, and batch stats audit ──

  describe('OB-1647 — watchdog, escalation, /workers, and batch stats audit', () => {
    it('watchdog kills worker after timeout and marks it failed', () => {
      vi.useFakeTimers();
      const killSpy = vi
        .spyOn(process, 'kill')
        .mockReturnValue(undefined as unknown as ReturnType<typeof process.kill>);

      try {
        const reg = new WorkerRegistry();
        const readOnlyManifest: TaskManifest = { ...sampleManifest, profile: 'read-only' };
        const wId = reg.addWorker(readOnlyManifest);
        reg.markRunning(wId, 99999);

        // Start watchdog with short timeout so it fires quickly
        reg.startWatchdog({ readOnlyMs: 1000, codeEditMs: 30000, intervalMs: 500 });

        // Advance past timeout (1000ms) + an additional interval tick so the check fires
        vi.advanceTimersByTime(2000);

        const worker = reg.getWorker(wId);
        expect(worker?.status).toBe('failed');
        expect(worker?.error).toBe('watchdog-timeout');
        expect(killSpy).toHaveBeenCalledWith(99999, 'SIGKILL');

        reg.stopWatchdog();
      } finally {
        vi.useRealTimers();
        killSpy.mockRestore();
      }
    });

    it('escalation timeout marks worker as cancelled and removes it from active', () => {
      const wId = registry.addWorker(sampleManifest);
      registry.markRunning(wId, 12345);

      // Simulate auto-deny on escalation timeout (OB-1644 path)
      registry.markCancelled(wId, 'escalation-timeout');

      const worker = registry.getWorker(wId);
      expect(worker?.status).toBe('cancelled');
      expect(worker?.error).toBe('escalation-timeout');
      expect(worker?.completedAt).toBeDefined();
      expect(worker?.pid).toBeUndefined();

      // Cancelled worker is no longer counted as running or orphaned
      expect(registry.getRunningWorkers()).toHaveLength(0);
      expect(registry.getOrphanedWorkers()).toHaveLength(0);
      expect(registry.getCancelledWorkers()).toHaveLength(1);
    });

    it('/workers command data: registry correctly exposes active and orphaned workers', () => {
      // running worker
      const runningId = registry.addWorker(sampleManifest);
      registry.markRunning(runningId, 1001);

      // pending worker (stuck — acts as orphan)
      const pendingId = registry.addWorker(sampleManifest);

      // completed worker (terminal — should not appear as active or orphaned)
      const completedId = registry.addWorker(sampleManifest);
      registry.markRunning(completedId, 1002);
      registry.markCompleted(completedId, sampleResult);

      // Data the /workers command uses
      const activeWorkers = registry
        .getAllWorkers()
        .filter((w) => w.status === 'pending' || w.status === 'running');
      const orphaned = registry.getOrphanedWorkers();

      expect(activeWorkers).toHaveLength(2);
      expect(activeWorkers.map((w) => w.id)).toContain(runningId);
      expect(activeWorkers.map((w) => w.id)).toContain(pendingId);
      expect(activeWorkers.map((w) => w.id)).not.toContain(completedId);

      // Orphaned == active (both pending and running are non-terminal)
      expect(orphaned).toHaveLength(2);
      expect(orphaned.map((w) => w.id)).not.toContain(completedId);
    });

    it('batch stats audit: getAggregatedStats detects orphaned workers and auto-cancels pending ones', () => {
      // Terminal workers
      const w1 = registry.addWorker(sampleManifest);
      registry.markRunning(w1, 1001);
      registry.markCompleted(w1, sampleResult);

      const w2 = registry.addWorker(sampleManifest);
      registry.markRunning(w2, 1002);
      registry.markFailed(w2, { ...sampleResult, exitCode: 1 }, 'error');

      // Non-terminal (orphaned) workers
      const w3 = registry.addWorker(sampleManifest);
      registry.markRunning(w3, 1003); // stuck in running

      registry.addWorker(sampleManifest); // stuck in pending — will be auto-cancelled

      const stats = registry.getAggregatedStats();
      const terminalCount = stats.completed + stats.failed + stats.cancelled;

      // Snapshot at call time: total (4) != terminal (2) → audit detects 2 orphans
      expect(stats.totalWorkers).toBe(4);
      expect(terminalCount).toBe(2);
      expect(stats.totalWorkers).toBeGreaterThan(terminalCount);

      // After getAggregatedStats(), the pending orphan is auto-cancelled and removed.
      // Only the running orphan (w3) remains in a non-terminal state.
      const orphaned = registry.getOrphanedWorkers();
      expect(orphaned).toHaveLength(1);
      expect(orphaned[0]!.id).toBe(w3);
      expect(orphaned[0]!.status).toBe('running');
    });
  });

  // ── Pending-worker timeout + spawn failure (OB-1266) ───────────

  describe('Pending-worker timeout and spawn failure (OB-1266)', () => {
    it('watchdog auto-cancels and removes a pending worker stuck beyond PENDING_WORKER_TIMEOUT_MS', () => {
      vi.useFakeTimers();
      try {
        const reg = new WorkerRegistry();
        const wId = reg.addWorker(sampleManifest);
        expect(reg.getWorker(wId)?.status).toBe('pending');

        // Start watchdog with 60s interval; pending timeout is PENDING_WORKER_TIMEOUT_MS (5 min)
        reg.startWatchdog({ readOnlyMs: 600_000, codeEditMs: 600_000, intervalMs: 60_000 });

        // Advance just past PENDING_WORKER_TIMEOUT_MS + one interval tick so the check fires
        vi.advanceTimersByTime(PENDING_WORKER_TIMEOUT_MS + 60_001);

        // Worker should be marked failed and then removed from the registry
        expect(reg.getWorker(wId)).toBeUndefined();
        expect(reg.getPendingWorkers()).toHaveLength(0);
        expect(reg.getAllWorkers()).toHaveLength(0);

        reg.stopWatchdog();
      } finally {
        vi.useRealTimers();
      }
    });

    it('watchdog does NOT cancel a pending worker before PENDING_WORKER_TIMEOUT_MS elapses', () => {
      vi.useFakeTimers();
      try {
        const reg = new WorkerRegistry();
        const wId = reg.addWorker(sampleManifest);
        expect(reg.getWorker(wId)?.status).toBe('pending');

        reg.startWatchdog({ readOnlyMs: 600_000, codeEditMs: 600_000, intervalMs: 60_000 });

        // Advance to just before the pending timeout threshold
        vi.advanceTimersByTime(PENDING_WORKER_TIMEOUT_MS - 1);

        // Worker should still be in the registry with pending status
        expect(reg.getWorker(wId)?.status).toBe('pending');
        expect(reg.getPendingWorkers()).toHaveLength(1);

        reg.stopWatchdog();
      } finally {
        vi.useRealTimers();
      }
    });

    it('watchdog only removes pending worker, not running worker, when pending times out', () => {
      vi.useFakeTimers();
      try {
        const reg = new WorkerRegistry();

        // A running worker (should not be affected by pending timeout logic)
        const runningId = reg.addWorker(sampleManifest);
        reg.markRunning(runningId, 9999);

        // A pending worker that will time out
        const pendingId = reg.addWorker(sampleManifest);

        reg.startWatchdog({ readOnlyMs: 600_000, codeEditMs: 600_000, intervalMs: 60_000 });

        vi.advanceTimersByTime(PENDING_WORKER_TIMEOUT_MS + 60_001);

        // Pending worker removed; running worker still present
        expect(reg.getWorker(pendingId)).toBeUndefined();
        expect(reg.getWorker(runningId)).toBeDefined();
        expect(reg.getWorker(runningId)?.status).toBe('running');

        reg.stopWatchdog();
      } finally {
        vi.useRealTimers();
      }
    });

    it('removeWorker() on spawn failure removes the pending worker from the registry', () => {
      const reg = new WorkerRegistry();
      const wId = reg.addWorker(sampleManifest);
      expect(reg.getWorker(wId)?.status).toBe('pending');
      expect(reg.getPendingWorkers()).toHaveLength(1);

      // Simulate spawn failure: master-manager calls removeWorker() in the catch block
      const removed = reg.removeWorker(wId);

      expect(removed).toBe(true);
      expect(reg.getWorker(wId)).toBeUndefined();
      expect(reg.getPendingWorkers()).toHaveLength(0);
      expect(reg.getAllWorkers()).toHaveLength(0);
    });

    it('removeWorker() on spawn failure leaves other pending workers intact', () => {
      const reg = new WorkerRegistry();
      const failedId = reg.addWorker(sampleManifest);
      const otherId = reg.addWorker(sampleManifest);

      expect(reg.getPendingWorkers()).toHaveLength(2);

      // Only the failed worker is removed
      reg.removeWorker(failedId);

      expect(reg.getWorker(failedId)).toBeUndefined();
      expect(reg.getWorker(otherId)?.status).toBe('pending');
      expect(reg.getPendingWorkers()).toHaveLength(1);
    });
  });

  // ── getOrphanedWorkers ──────────────────────────────────────────

  describe('getOrphanedWorkers', () => {
    it('returns empty array when registry is empty', () => {
      expect(registry.getOrphanedWorkers()).toEqual([]);
    });

    it('returns pending and running workers as orphans', () => {
      const w1 = registry.addWorker(sampleManifest); // pending
      const w2 = registry.addWorker(sampleManifest);
      registry.markRunning(w2, 1002); // running
      const w3 = registry.addWorker(sampleManifest);
      registry.markRunning(w3, 1003);
      registry.markCompleted(w3, sampleResult); // completed — not orphaned

      const orphans = registry.getOrphanedWorkers();
      expect(orphans).toHaveLength(2);
      expect(orphans.map((w) => w.id)).toContain(w1);
      expect(orphans.map((w) => w.id)).toContain(w2);
    });

    it('returns empty array when all workers are in terminal states', () => {
      const w1 = registry.addWorker(sampleManifest);
      registry.markRunning(w1, 1001);
      registry.markCompleted(w1, sampleResult);

      const w2 = registry.addWorker(sampleManifest);
      registry.markRunning(w2, 1002);
      registry.markFailed(w2, { ...sampleResult, exitCode: 1 }, 'err');

      const w3 = registry.addWorker(sampleManifest);
      registry.markRunning(w3, 1003);
      registry.markCancelled(w3, 'cancelled');

      expect(registry.getOrphanedWorkers()).toEqual([]);
    });

    it('correctly identifies orphaned worker statuses', () => {
      registry.addWorker(sampleManifest); // pending
      const w2 = registry.addWorker(sampleManifest);
      registry.markRunning(w2, 1002); // running

      const orphans = registry.getOrphanedWorkers();
      const statuses = orphans.map((w) => w.status);
      expect(statuses).toContain('pending');
      expect(statuses).toContain('running');
    });
  });
});
