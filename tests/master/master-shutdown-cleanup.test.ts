/**
 * Unit tests for MasterManager shutdown cleanup — OB-1299 / OB-F170.
 *
 * Verifies that after shutdown():
 * 1. batchTimers is empty (all pending batch continuation timers cleared)
 * 2. idleCheckTimer is null (idle detection interval stopped)
 */

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
  batchTimers: Set<NodeJS.Timeout>;
  idleCheckTimer: NodeJS.Timeout | null;
};

// ── Suite ────────────────────────────────────────────────────────────

describe('MasterManager — shutdown cleanup (OB-1299)', () => {
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

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    mockSpawnWithHandle.mockImplementation((opts: SpawnOptions) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue('quick-answer');

    testWorkspace = path.join(os.tmpdir(), 'test-workspace-shutdown-cleanup-' + Date.now());
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
    const internal = masterManager as unknown as MasterManagerInternal;
    if (internal.idleCheckTimer !== null || internal.batchTimers.size > 0) {
      // Ensure cleanup if a test didn't call shutdown()
      await masterManager.shutdown();
    }
    vi.useRealTimers();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('idleCheckTimer is set after start()', () => {
    const internal = masterManager as unknown as MasterManagerInternal;
    expect(internal.idleCheckTimer).not.toBeNull();
  });

  it('idleCheckTimer is null after shutdown()', async () => {
    const internal = masterManager as unknown as MasterManagerInternal;
    expect(internal.idleCheckTimer).not.toBeNull();

    await masterManager.shutdown();

    expect(internal.idleCheckTimer).toBeNull();
  });

  it('batchTimers is empty after shutdown() with no pending timers', async () => {
    const internal = masterManager as unknown as MasterManagerInternal;
    expect(internal.batchTimers.size).toBe(0);

    await masterManager.shutdown();

    expect(internal.batchTimers.size).toBe(0);
  });

  it('batchTimers is cleared after shutdown() with pending timers', async () => {
    const internal = masterManager as unknown as MasterManagerInternal;

    // Inject fake batch continuation timers (simulates scheduled batch resumption)
    const handle1 = setTimeout(() => {}, 500);
    const handle2 = setTimeout(() => {}, 1000);
    internal.batchTimers.add(handle1);
    internal.batchTimers.add(handle2);
    expect(internal.batchTimers.size).toBe(2);

    await masterManager.shutdown();

    expect(internal.batchTimers.size).toBe(0);
  });

  it('clears both batchTimers and idleCheckTimer together on shutdown()', async () => {
    const internal = masterManager as unknown as MasterManagerInternal;

    // Inject a batch timer
    const handle = setTimeout(() => {}, 2000);
    internal.batchTimers.add(handle);

    expect(internal.batchTimers.size).toBe(1);
    expect(internal.idleCheckTimer).not.toBeNull();

    await masterManager.shutdown();

    expect(internal.batchTimers.size).toBe(0);
    expect(internal.idleCheckTimer).toBeNull();
  });

  it('second shutdown() call is a no-op (state already shutdown)', async () => {
    const internal = masterManager as unknown as MasterManagerInternal;

    await masterManager.shutdown();

    expect(internal.batchTimers.size).toBe(0);
    expect(internal.idleCheckTimer).toBeNull();

    // Second shutdown should not throw and should leave fields clean
    await masterManager.shutdown();

    expect(internal.batchTimers.size).toBe(0);
    expect(internal.idleCheckTimer).toBeNull();
  });
});
