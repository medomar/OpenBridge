import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { AgentResult, SpawnOptions } from '../../src/core/agent-runner.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Mock AgentRunner ─────────────────────────────────────────────────

const mockSpawn = vi.fn();
const mockStream = vi.fn();
const mockSpawnWithHandle = vi.fn();

vi.mock('../../src/core/agent-runner.js', () => {
  const profiles: Record<string, string[]> = {
    'read-only': ['Read', 'Glob', 'Grep'],
    'code-edit': [
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(git:*)',
      'Bash(npm:*)',
      'Bash(npx:*)',
    ],
    'full-access': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  };

  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: mockSpawn,
      stream: mockStream,
      spawnWithHandle: mockSpawnWithHandle,
    })),
    TOOLS_READ_ONLY: profiles['read-only'],
    TOOLS_CODE_EDIT: profiles['code-edit'],
    TOOLS_FULL: profiles['full-access'],
    DEFAULT_MAX_TURNS_EXPLORATION: 15,
    DEFAULT_MAX_TURNS_TASK: 25,
    DEFAULT_MAX_FIX_ITERATIONS: 3,
    sanitizePrompt: vi.fn((s: string) => s),
    buildArgs: vi.fn(),
    isValidModel: vi.fn(() => true),
    MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
    AgentExhaustedError: class AgentExhaustedError extends Error {},
    resolveProfile: (profileName: string) => profiles[profileName],
    classifyError: (_stderr: string, exitCode: number): string => {
      if (exitCode !== 0) return 'crash';
      return 'unknown';
    },
    manifestToSpawnOptions: (manifest: Record<string, unknown>) => {
      const profile = manifest.profile as string | undefined;
      const allowedTools =
        (manifest.allowedTools as string[] | undefined) ??
        (profile ? profiles[profile] : undefined);
      return Promise.resolve({
        spawnOptions: {
          prompt: manifest.prompt,
          workspacePath: manifest.workspacePath,
          model: manifest.model,
          allowedTools,
          maxTurns: manifest.maxTurns,
          timeout: manifest.timeout,
          retries: manifest.retries,
          retryDelay: manifest.retryDelay,
        },
        cleanup: async () => {},
      });
    },
  };
});

// ── Mock logger ──────────────────────────────────────────────────────

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Type helper to access private members for testing ────────────────

type MasterManagerInternal = {
  workerAbortHandles: Map<string, () => void>;
};

// ── Suite ────────────────────────────────────────────────────────────

describe('MasterManager — Worker Kill Infrastructure (OB-876)', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;

  const masterTool: DiscoveredTool = {
    name: 'claude',
    path: '/usr/local/bin/claude',
    version: '1.0.0',
    available: true,
    role: 'master',
    capabilities: ['general'],
  };

  const sampleManifest = {
    prompt: 'Fix the authentication bug in src/auth.ts',
    workspacePath: '/test',
    model: 'sonnet',
    profile: 'code-edit' as const,
    maxTurns: 10,
  };

  const sampleResult: AgentResult = {
    stdout: 'Done',
    stderr: '',
    exitCode: 0,
    durationMs: 1000,
    retryCount: 0,
    model: 'sonnet',
    status: 'completed',
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawn.mockReset();
    mockStream.mockReset();
    mockSpawnWithHandle.mockReset();
    mockSpawnWithHandle.mockImplementation((opts: SpawnOptions) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue('tool-use');

    testWorkspace = path.join(os.tmpdir(), 'test-workspace-kill-worker-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    const dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    await masterManager.start();
  });

  afterEach(async () => {
    await masterManager.shutdown();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ── killWorker() — edge cases ────────────────────────────────────

  describe('killWorker() — edge cases', () => {
    it('returns success:false for an unknown (non-existent) worker ID', async () => {
      const result = await masterManager.killWorker('worker-9999-nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('returns success:false for an already-completed worker', async () => {
      const registry = masterManager.getWorkerRegistry();
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 1234);
      registry.markCompleted(workerId, sampleResult);

      const result = await masterManager.killWorker(workerId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('completed');
    });

    it('returns success:false for an already-failed worker', async () => {
      const registry = masterManager.getWorkerRegistry();
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 1234);
      registry.markFailed(
        workerId,
        { ...sampleResult, exitCode: 1, stderr: 'crash' },
        'Process crashed',
      );

      const result = await masterManager.killWorker(workerId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('failed');
    });

    it('returns success:false for an already-cancelled worker', async () => {
      const registry = masterManager.getWorkerRegistry();
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 1234);
      registry.markCancelled(workerId, 'Cancelled earlier');

      const result = await masterManager.killWorker(workerId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('cancelled');
    });
  });

  // ── killWorker() — running worker with abort handle ───────────────

  describe('killWorker() — running worker with abort handle', () => {
    it('invokes the abort handle when killing a running worker', async () => {
      const registry = masterManager.getWorkerRegistry();
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 99999);

      const mockAbort = vi.fn();
      (masterManager as unknown as MasterManagerInternal).workerAbortHandles.set(
        workerId,
        mockAbort,
      );

      const result = await masterManager.killWorker(workerId);

      expect(result.success).toBe(true);
      expect(mockAbort).toHaveBeenCalledTimes(1);
    });

    it('removes the abort handle from the internal map after killing', async () => {
      const registry = masterManager.getWorkerRegistry();
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 99999);

      const mockAbort = vi.fn();
      const internals = masterManager as unknown as MasterManagerInternal;
      internals.workerAbortHandles.set(workerId, mockAbort);

      await masterManager.killWorker(workerId);

      expect(internals.workerAbortHandles.has(workerId)).toBe(false);
    });

    it('marks the worker as cancelled in WorkerRegistry', async () => {
      const registry = masterManager.getWorkerRegistry();
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 99999);

      (masterManager as unknown as MasterManagerInternal).workerAbortHandles.set(workerId, vi.fn());

      await masterManager.killWorker(workerId);

      expect(registry.getWorker(workerId)?.status).toBe('cancelled');
    });

    it('returns success:true with a descriptive message including model and task summary', async () => {
      const registry = masterManager.getWorkerRegistry();
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 99999);

      (masterManager as unknown as MasterManagerInternal).workerAbortHandles.set(workerId, vi.fn());

      const result = await masterManager.killWorker(workerId);

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/^Stopped worker /);
      // Message should include the model name
      expect(result.message).toContain('sonnet');
    });

    it('handles missing abort handle gracefully (legacy PID -1 case) — marks cancelled without kill signal', async () => {
      const registry = masterManager.getWorkerRegistry();
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, -1);

      // No abort handle registered in workerAbortHandles — simulates legacy worker
      const result = await masterManager.killWorker(workerId);

      // Should still succeed: marks cancelled even without sending a signal
      expect(result.success).toBe(true);
      expect(registry.getWorker(workerId)?.status).toBe('cancelled');
    });
  });

  // ── killAllWorkers() ──────────────────────────────────────────────

  describe('killAllWorkers()', () => {
    it('returns empty stopped array and no-op message when no workers are running', async () => {
      const result = await masterManager.killAllWorkers();

      expect(result.stopped).toEqual([]);
      expect(result.message).toBe('No workers are currently running.');
    });

    it('stops a single running worker and returns its ID in the stopped list', async () => {
      const registry = masterManager.getWorkerRegistry();
      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 11111);

      const mockAbort = vi.fn();
      (masterManager as unknown as MasterManagerInternal).workerAbortHandles.set(
        workerId,
        mockAbort,
      );

      const result = await masterManager.killAllWorkers();

      expect(result.stopped).toHaveLength(1);
      expect(result.stopped).toContain(workerId);
      expect(mockAbort).toHaveBeenCalledTimes(1);
    });

    it('stops all running workers and returns all their IDs', async () => {
      const registry = masterManager.getWorkerRegistry();
      const internals = masterManager as unknown as MasterManagerInternal;

      const id1 = registry.addWorker({ ...sampleManifest, prompt: 'Task 1' });
      registry.markRunning(id1, 11111);
      const abort1 = vi.fn();
      internals.workerAbortHandles.set(id1, abort1);

      const id2 = registry.addWorker({ ...sampleManifest, prompt: 'Task 2' });
      registry.markRunning(id2, 22222);
      const abort2 = vi.fn();
      internals.workerAbortHandles.set(id2, abort2);

      const result = await masterManager.killAllWorkers();

      expect(result.stopped).toHaveLength(2);
      expect(result.stopped).toContain(id1);
      expect(result.stopped).toContain(id2);
      expect(abort1).toHaveBeenCalledTimes(1);
      expect(abort2).toHaveBeenCalledTimes(1);
    });

    it('only kills running workers — completed/cancelled workers are skipped', async () => {
      const registry = masterManager.getWorkerRegistry();
      const internals = masterManager as unknown as MasterManagerInternal;

      // Running worker
      const runningId = registry.addWorker(sampleManifest);
      registry.markRunning(runningId, 11111);
      const runningAbort = vi.fn();
      internals.workerAbortHandles.set(runningId, runningAbort);

      // Completed worker — should NOT be killed
      const completedId = registry.addWorker({ ...sampleManifest, prompt: 'Already done' });
      registry.markRunning(completedId, 22222);
      registry.markCompleted(completedId, sampleResult);

      const result = await masterManager.killAllWorkers();

      expect(result.stopped).toHaveLength(1);
      expect(result.stopped).toContain(runningId);
      expect(result.stopped).not.toContain(completedId);
      expect(runningAbort).toHaveBeenCalledTimes(1);
    });

    it('returns a summary message listing the count of stopped workers', async () => {
      const registry = masterManager.getWorkerRegistry();
      const internals = masterManager as unknown as MasterManagerInternal;

      const id1 = registry.addWorker(sampleManifest);
      registry.markRunning(id1, 11111);
      internals.workerAbortHandles.set(id1, vi.fn());

      const id2 = registry.addWorker({ ...sampleManifest, prompt: 'Task 2' });
      registry.markRunning(id2, 22222);
      internals.workerAbortHandles.set(id2, vi.fn());

      const result = await masterManager.killAllWorkers();

      expect(result.message).toMatch(/^Stopped 2 workers/);
    });

    it('each stopped worker details appear in the summary message', async () => {
      const registry = masterManager.getWorkerRegistry();
      const internals = masterManager as unknown as MasterManagerInternal;

      const workerId = registry.addWorker(sampleManifest);
      registry.markRunning(workerId, 55555);
      internals.workerAbortHandles.set(workerId, vi.fn());

      const result = await masterManager.killAllWorkers();

      // Each line format: "- <shortId> (<model>, '<summary>', <elapsed>)"
      const shortId = workerId.split('-').pop();
      expect(result.message).toContain(`- ${shortId}`);
      expect(result.message).toContain('sonnet');
    });
  });
});
