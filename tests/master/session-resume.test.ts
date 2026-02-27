/**
 * Unit tests for MasterManager.resumeSession() (OB-1054 / OB-F31).
 *
 * Verifies that session state is correctly restored from a `sessions` table
 * checkpoint: masterSession, pending messages, and worker history.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { MasterManager } from '../../src/master/master-manager.js';
import { MemoryManager } from '../../src/memory/index.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockSpawn = vi.fn();
const mockSpawnWithHandle = vi.fn();

vi.mock('../../src/core/agent-runner.js', () => {
  const profiles: Record<string, string[]> = {
    'read-only': ['Read', 'Glob', 'Grep'],
    'code-edit': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)'],
    'full-access': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  };

  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: mockSpawn,
      stream: vi.fn(),
      spawnWithHandle: mockSpawnWithHandle,
      spawnWithStreamingHandle: mockSpawnWithHandle,
    })),
    TOOLS_READ_ONLY: profiles['read-only'],
    TOOLS_CODE_EDIT: profiles['code-edit'],
    TOOLS_FULL: profiles['full-access'],
    DEFAULT_MAX_TURNS_EXPLORATION: 15,
    DEFAULT_MAX_TURNS_TASK: 25,
    sanitizePrompt: vi.fn((s: string) => s),
    buildArgs: vi.fn(),
    isValidModel: vi.fn(() => true),
    MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
    AgentExhaustedError: class AgentExhaustedError extends Error {},
    resolveProfile: (profileName: string) => profiles[profileName],
    manifestToSpawnOptions: (manifest: Record<string, unknown>) => {
      const profile = manifest.profile as string | undefined;
      const allowedTools =
        (manifest.allowedTools as string[] | undefined) ??
        (profile ? profiles[profile] : undefined);
      return {
        prompt: manifest.prompt,
        workspacePath: manifest.workspacePath,
        model: manifest.model,
        allowedTools,
        maxTurns: manifest.maxTurns,
        timeout: manifest.timeout,
        retries: manifest.retries,
        retryDelay: manifest.retryDelay,
      };
    },
  };
});

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const masterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  available: true,
  role: 'master',
  capabilities: ['general'],
};

function makeCheckpointData(
  overrides: {
    pendingWorkers?: unknown[];
    completedWorkers?: unknown[];
    pendingMessages?: unknown[];
  } = {},
): string {
  return JSON.stringify({
    checkpointedAt: new Date().toISOString(),
    pendingWorkers: overrides.pendingWorkers ?? [],
    completedWorkers: overrides.completedWorkers ?? [],
    pendingMessages: overrides.pendingMessages ?? [],
  });
}

function makeWorkerRecord(id: string, status: 'completed' | 'failed' | 'pending' | 'running') {
  return {
    id,
    taskManifest: {
      prompt: 'test task',
      workspacePath: '/test/workspace',
      profile: 'read-only',
      model: 'claude-sonnet-4-5',
      maxTurns: 10,
      timeout: 60000,
    },
    startedAt: new Date().toISOString(),
    status,
    ...(status === 'completed' || status === 'failed'
      ? {
          completedAt: new Date().toISOString(),
          result: { stdout: 'done', stderr: '', exitCode: 0, durationMs: 500, retryCount: 0 },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MasterManager.resumeSession() (OB-1054)', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;
  let memory: MemoryManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawnWithHandle.mockImplementation((opts: Parameters<typeof mockSpawn>[0]) => ({
      promise: mockSpawn(opts) as Promise<unknown>,
      pid: 12345,
      abort: vi.fn(),
    }));
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'OK',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue('quick-answer');

    testWorkspace = path.join(process.cwd(), 'test-workspace-resume-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    memory = new MemoryManager(':memory:');
    await memory.init();
  });

  afterEach(async () => {
    if (masterManager) {
      await masterManager.shutdown();
    }
    await memory.close();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('returns null when no memory is configured', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      // no memory option — memory is null
    });
    await masterManager.start();

    const result = await masterManager.resumeSession();
    expect(result).toBeNull();
  });

  it('returns null when no session exists in the sessions table', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });
    await masterManager.start();

    const result = await masterManager.resumeSession();
    expect(result).toBeNull();
  });

  it('returns null when session has no checkpoint_data', async () => {
    const sessionId = 'test-session-no-checkpoint';
    await memory.upsertSession({
      id: sessionId,
      type: 'master',
      status: 'active',
      restart_count: 0,
      message_count: 5,
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      // no checkpoint_data
    });

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });
    await masterManager.start();

    const result = await masterManager.resumeSession();
    expect(result).toBeNull();
  });

  it('restores masterSession from checkpoint data', async () => {
    const sessionId = 'test-session-with-checkpoint';
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    const lastUsedAt = new Date().toISOString();

    await memory.upsertSession({
      id: sessionId,
      type: 'master',
      status: 'active',
      restart_count: 2,
      message_count: 10,
      created_at: createdAt,
      last_used_at: lastUsedAt,
      checkpoint_data: makeCheckpointData(),
    });

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });
    await masterManager.start();

    const result = await masterManager.resumeSession();
    expect(result).not.toBeNull();
    expect(result?.restored).toBe(true);

    // Verify masterSession was restored from the DB record
    const session = masterManager.getMasterSession();
    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe(sessionId);
    expect(session?.messageCount).toBe(10);
    expect(session?.createdAt).toBe(createdAt);
  });

  it('re-queues pending messages with Date timestamps', async () => {
    const ts1 = new Date(Date.now() - 5000).toISOString();
    const ts2 = new Date(Date.now() - 3000).toISOString();

    const pendingMessages = [
      {
        id: 'msg-1',
        source: 'whatsapp',
        sender: '+1234567890',
        rawContent: '/ai task one',
        content: 'task one',
        timestamp: ts1,
      },
      {
        id: 'msg-2',
        source: 'whatsapp',
        sender: '+1234567890',
        rawContent: '/ai task two',
        content: 'task two',
        timestamp: ts2,
      },
    ];

    await memory.upsertSession({
      id: 'session-pending-msgs',
      type: 'master',
      status: 'active',
      restart_count: 0,
      message_count: 3,
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      checkpoint_data: makeCheckpointData({ pendingMessages }),
    });

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });
    await masterManager.start();

    const result = await masterManager.resumeSession();
    expect(result).not.toBeNull();
    expect(result?.pendingMessages).toBe(2);

    // Timestamps must be restored as Date objects, not strings
    const pending = masterManager.getPendingMessages();
    expect(pending).toHaveLength(2);
    expect(pending[0]!.timestamp).toBeInstanceOf(Date);
    expect(pending[0]!.timestamp.toISOString()).toBe(ts1);
    expect(pending[1]!.timestamp).toBeInstanceOf(Date);
    expect(pending[1]!.timestamp.toISOString()).toBe(ts2);
  });

  it('restores completed workers for context and stats', async () => {
    const completedWorkers = [
      makeWorkerRecord('worker-completed-1', 'completed'),
      makeWorkerRecord('worker-failed-1', 'failed'),
    ];

    await memory.upsertSession({
      id: 'session-with-completed-workers',
      type: 'master',
      status: 'active',
      restart_count: 0,
      message_count: 5,
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      checkpoint_data: makeCheckpointData({ completedWorkers }),
    });

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });
    await masterManager.start();

    const result = await masterManager.resumeSession();
    expect(result).not.toBeNull();
    expect(result?.restoredWorkers).toBe(2);
    expect(result?.failedWorkers).toBe(0);

    const registry = masterManager.getWorkerRegistry();
    const allWorkers = registry.getAllWorkers();
    expect(allWorkers).toHaveLength(2);
    // Original statuses preserved
    const statuses = allWorkers.map((w) => w.status).sort();
    expect(statuses).toEqual(['completed', 'failed']);
  });

  it('marks pending and running workers as failed with checkpoint error', async () => {
    const pendingWorkers = [
      makeWorkerRecord('worker-pending-1', 'pending'),
      makeWorkerRecord('worker-running-1', 'running'),
    ];

    await memory.upsertSession({
      id: 'session-with-pending-workers',
      type: 'master',
      status: 'active',
      restart_count: 0,
      message_count: 2,
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      checkpoint_data: makeCheckpointData({ pendingWorkers }),
    });

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });
    await masterManager.start();

    const result = await masterManager.resumeSession();
    expect(result).not.toBeNull();
    expect(result?.failedWorkers).toBe(2);
    expect(result?.restoredWorkers).toBe(0);

    const registry = masterManager.getWorkerRegistry();
    const allWorkers = registry.getAllWorkers();
    expect(allWorkers).toHaveLength(2);
    // All should be marked failed
    expect(allWorkers.every((w) => w.status === 'failed')).toBe(true);
    // Should have the checkpoint error message
    expect(allWorkers.every((w) => w.error?.includes('checkpoint'))).toBe(true);
  });

  it('returns correct counts for mixed worker states', async () => {
    const completedWorkers = [
      makeWorkerRecord('worker-done-1', 'completed'),
      makeWorkerRecord('worker-done-2', 'completed'),
    ];
    const pendingWorkers = [
      makeWorkerRecord('worker-pending-1', 'pending'),
      makeWorkerRecord('worker-running-1', 'running'),
      makeWorkerRecord('worker-running-2', 'running'),
    ];

    await memory.upsertSession({
      id: 'session-mixed-workers',
      type: 'master',
      status: 'active',
      restart_count: 1,
      message_count: 7,
      created_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
      checkpoint_data: makeCheckpointData({ completedWorkers, pendingWorkers }),
    });

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });
    await masterManager.start();

    const result = await masterManager.resumeSession();
    expect(result).not.toBeNull();
    expect(result?.restored).toBe(true);
    expect(result?.restoredWorkers).toBe(2); // completed workers
    expect(result?.failedWorkers).toBe(3); // pending + running → failed

    const registry = masterManager.getWorkerRegistry();
    expect(registry.getAllWorkers()).toHaveLength(5);
    expect(registry.getCompletedWorkers()).toHaveLength(2);
    expect(registry.getFailedWorkers()).toHaveLength(3);
  });
});
