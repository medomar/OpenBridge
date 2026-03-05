import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import { WorkerRegistry } from '../../src/master/worker-registry.js';
import type { TaskManifest } from '../../src/types/agent.js';
import type { AgentResult } from '../../src/core/agent-runner.js';

const TEST_WORKSPACE = '/tmp/openbridge-test-dotfolder-workers';

describe('DotFolderManager - Workers Registry Integration', () => {
  let manager: DotFolderManager;

  const sampleManifest: TaskManifest = {
    prompt: 'Test task',
    workspacePath: TEST_WORKSPACE,
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

  beforeEach(async () => {
    // Clean up test workspace
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
    await fs.mkdir(TEST_WORKSPACE, { recursive: true });

    manager = new DotFolderManager(TEST_WORKSPACE);
    await manager.initialize();
  });

  afterEach(async () => {
    await fs.rm(TEST_WORKSPACE, { recursive: true, force: true });
  });

  describe('getWorkersPath', () => {
    it('should return correct workers.json path', () => {
      const workersPath = manager.getWorkersPath();
      expect(workersPath).toBe(path.join(TEST_WORKSPACE, '.openbridge', 'workers.json'));
    });
  });

  describe('readWorkers', () => {
    it('should return null when workers.json does not exist', async () => {
      const registry = await manager.readWorkers();
      expect(registry).toBeNull();
    });

    it('should read workers registry from disk', async () => {
      // Create a registry and persist it
      const reg = new WorkerRegistry();
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);

      const w2 = reg.addWorker(sampleManifest);
      reg.markCompleted(w2, sampleResult);

      await manager.writeWorkers(reg.toJSON());

      // Read it back
      const loaded = await manager.readWorkers();

      expect(loaded).not.toBeNull();
      expect(loaded?.workers).toHaveProperty(w1);
      expect(loaded?.workers).toHaveProperty(w2);
      expect(loaded?.workers[w1]?.status).toBe('running');
      expect(loaded?.workers[w2]?.status).toBe('completed');
    });

    it('should validate workers registry on read', async () => {
      // Write invalid JSON
      const workersPath = manager.getWorkersPath();
      await fs.writeFile(
        workersPath,
        JSON.stringify({
          workers: {
            invalid: {
              id: 'invalid',
              // Missing required fields
            },
          },
          updatedAt: new Date().toISOString(),
        }),
        'utf-8',
      );

      const registry = await manager.readWorkers();
      expect(registry).toBeNull();
    });
  });

  describe('writeWorkers', () => {
    it('should write workers registry to disk', async () => {
      const reg = new WorkerRegistry();
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);

      await manager.writeWorkers(reg.toJSON());

      const workersPath = manager.getWorkersPath();
      const fileExists = await fs
        .access(workersPath)
        .then(() => true)
        .catch(() => false);

      expect(fileExists).toBe(true);

      const content = await fs.readFile(workersPath, 'utf-8');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsed = JSON.parse(content);

      expect(parsed).toHaveProperty('workers');
      expect(parsed).toHaveProperty('updatedAt');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(parsed.workers).toHaveProperty(w1);
    });

    it('should validate workers registry before writing', async () => {
      const invalidRegistry: any = {
        workers: {
          invalid: {
            id: 'invalid',
            // Missing required fields
          },
        },
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(manager.writeWorkers(invalidRegistry)).rejects.toThrow();
    });

    it('should format JSON with proper indentation', async () => {
      const reg = new WorkerRegistry();
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);

      await manager.writeWorkers(reg.toJSON());

      const workersPath = manager.getWorkersPath();
      const content = await fs.readFile(workersPath, 'utf-8');

      // Check that JSON is formatted with 2-space indentation
      expect(content).toContain('  "workers"');
      expect(content).toContain('  "updatedAt"');
    });
  });

  describe('integration with WorkerRegistry', () => {
    it('should support full persistence cycle', async () => {
      // Session 1: Create workers
      const session1 = new WorkerRegistry({ maxConcurrentWorkers: 5 });

      const w1 = session1.addWorker(sampleManifest);
      session1.markRunning(w1, 1001);

      const w2 = session1.addWorker(sampleManifest);
      session1.markRunning(w2, 1002);
      session1.markCompleted(w2, sampleResult);

      const w3 = session1.addWorker(sampleManifest);
      session1.markRunning(w3, 1003);
      session1.markFailed(w3, { ...sampleResult, exitCode: 1 }, 'Task failed');

      // Persist to disk
      await manager.writeWorkers(session1.toJSON());

      // Session 2: Load from disk
      const loadedRegistry = await manager.readWorkers();
      expect(loadedRegistry).not.toBeNull();

      const session2 = new WorkerRegistry({ maxConcurrentWorkers: 5 });
      session2.fromJSON(loadedRegistry!);

      // Verify state restored
      expect(session2.getAllWorkers()).toHaveLength(3);
      expect(session2.getWorker(w1)?.status).toBe('running');
      expect(session2.getWorker(w1)?.pid).toBe(1001);
      expect(session2.getWorker(w2)?.status).toBe('completed');
      expect(session2.getWorker(w2)?.result?.stdout).toBe('Task completed successfully');
      expect(session2.getWorker(w3)?.status).toBe('failed');
      expect(session2.getWorker(w3)?.error).toBe('Task failed');
      expect(session2.getRunningCount()).toBe(1);
    });

    it('should support incremental updates', async () => {
      const reg = new WorkerRegistry();

      // Initial state
      const w1 = reg.addWorker(sampleManifest);
      reg.markRunning(w1, 1001);
      await manager.writeWorkers(reg.toJSON());

      // Add more workers
      const w2 = reg.addWorker(sampleManifest);
      reg.markRunning(w2, 1002);
      await manager.writeWorkers(reg.toJSON());

      // Complete first worker
      reg.markCompleted(w1, sampleResult);
      await manager.writeWorkers(reg.toJSON());

      // Load final state
      const loadedRegistry = await manager.readWorkers();
      expect(loadedRegistry).not.toBeNull();

      const loaded = new WorkerRegistry();
      loaded.fromJSON(loadedRegistry!);

      expect(loaded.getAllWorkers()).toHaveLength(2);
      expect(loaded.getWorker(w1)?.status).toBe('completed');
      expect(loaded.getWorker(w2)?.status).toBe('running');
      expect(loaded.getRunningCount()).toBe(1);
    });

    it('should handle empty registry', async () => {
      const reg = new WorkerRegistry();
      await manager.writeWorkers(reg.toJSON());

      const loadedRegistry = await manager.readWorkers();
      expect(loadedRegistry).not.toBeNull();
      expect(loadedRegistry?.workers).toEqual({});

      const loaded = new WorkerRegistry();
      loaded.fromJSON(loadedRegistry!);
      expect(loaded.getAllWorkers()).toHaveLength(0);
    });
  });

  describe('cross-restart visibility', () => {
    it('should preserve worker state across manager instances', async () => {
      // Manager instance 1
      const manager1 = new DotFolderManager(TEST_WORKSPACE);
      const reg1 = new WorkerRegistry();

      const w1 = reg1.addWorker(sampleManifest);
      reg1.markRunning(w1, 1001);

      await manager1.writeWorkers(reg1.toJSON());

      // Manager instance 2 (simulates restart)
      const manager2 = new DotFolderManager(TEST_WORKSPACE);
      const loadedRegistry = await manager2.readWorkers();

      expect(loadedRegistry).not.toBeNull();
      expect(loadedRegistry?.workers[w1]?.status).toBe('running');
      expect(loadedRegistry?.workers[w1]?.pid).toBe(1001);
    });

    it('should detect running workers after restart', async () => {
      const reg1 = new WorkerRegistry();

      // Add several workers in different states
      const w1 = reg1.addWorker(sampleManifest);
      reg1.markRunning(w1, 1001);

      const w2 = reg1.addWorker(sampleManifest);
      reg1.markRunning(w2, 1002);

      const w3 = reg1.addWorker(sampleManifest);
      reg1.markCompleted(w3, sampleResult);

      await manager.writeWorkers(reg1.toJSON());

      // After restart, load and check running workers
      const loadedRegistry = await manager.readWorkers();
      const reg2 = new WorkerRegistry();
      reg2.fromJSON(loadedRegistry!);

      const runningWorkers = reg2.getRunningWorkers();
      expect(runningWorkers).toHaveLength(2);
      expect(runningWorkers.map((w) => w.id)).toContain(w1);
      expect(runningWorkers.map((w) => w.id)).toContain(w2);
    });
  });
});
