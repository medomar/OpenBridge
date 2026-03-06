/**
 * Integration test: worker retry on failure (OB-910)
 *
 * Verifies that when a worker fails with a retryable error, MasterManager:
 *  1. Retries the worker (spawn called again after the failure)
 *  2. Returns the successful result to the caller when the retry succeeds
 *  3. Updates the learnings table in the real SQLite MemoryManager
 *
 * Uses a real SQLite MemoryManager (temp file on disk) + mock AgentRunner +
 * MasterManager with skipAutoExploration and workerRetryDelayMs=0.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { MasterManager } from '../../src/master/master-manager.js';
import { MemoryManager } from '../../src/memory/index.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { AgentResult } from '../../src/core/agent-runner.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

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
    isMaxTurnsExhausted: vi.fn((_stdout: string) => false),
    classifyError: (stderr: string, exitCode: number): string => {
      const lower = stderr.toLowerCase();
      if (
        lower.includes('rate limit') ||
        lower.includes('rate_limit') ||
        lower.includes('too many requests')
      )
        return 'rate-limit';
      if (
        lower.includes('context window') ||
        lower.includes('context length') ||
        lower.includes('too many tokens')
      )
        return 'context-overflow';
      if (
        lower.includes('invalid api key') ||
        lower.includes('unauthorized') ||
        lower.includes('authentication failed')
      )
        return 'auth';
      if (exitCode === 143 || exitCode === 137 || lower.includes('timeout')) return 'timeout';
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const masterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  available: true,
  role: 'master',
  capabilities: ['general'],
};

const discoveredTools: DiscoveredTool[] = [masterTool];

function makeMessage(content: string): InboundMessage {
  return {
    id: 'msg-' + Date.now(),
    content,
    rawContent: '/ai ' + content,
    sender: '+1234567890',
    source: 'whatsapp',
    timestamp: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: worker retry on failure with real MemoryManager (OB-910)', () => {
  let testWorkspace: string;
  let memory: MemoryManager;
  let masterManager: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawnWithHandle.mockReset();
    // spawnWithHandle delegates to mockSpawn so existing mockResolvedValueOnce calls work
    mockSpawnWithHandle.mockImplementation((opts: Parameters<typeof mockSpawn>[0]) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    // Use /tmp to stay outside the project git repo (avoids git hook interference)
    testWorkspace = path.join(
      os.tmpdir(),
      `ob-worker-retry-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    await fs.mkdir(testWorkspace, { recursive: true });

    // Real SQLite MemoryManager backed by a temp file
    const dbPath = path.join(testWorkspace, '.openbridge', 'openbridge.db');
    await fs.mkdir(path.join(testWorkspace, '.openbridge'), { recursive: true });
    memory = new MemoryManager(dbPath);
    await memory.init();

    // Stub keyword-based classifyTask so tests don't consume extra spawn mocks
    vi.spyOn(MasterManager.prototype, 'classifyTask').mockImplementation(
      async (content: string) => {
        const lower = content.toLowerCase();
        if (
          ['implement', 'build', 'refactor', 'develop', 'set up', 'setup'].some((kw) =>
            lower.includes(kw),
          )
        )
          return 'complex-task';
        if (
          ['generate', 'create', 'write', 'fix', 'update file', 'add to', 'make a'].some((kw) =>
            lower.includes(kw),
          )
        )
          return 'tool-use';
        return 'quick-answer';
      },
    );

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools,
      skipAutoExploration: true,
      workerRetryDelayMs: 0, // No delay — keeps tests fast
      memory,
    });

    await masterManager.start();
  });

  afterEach(async () => {
    await masterManager.shutdown();
    await memory.close();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  describe('Retry fires and succeeds', () => {
    it('retries worker after crash failure and returns successful result', async () => {
      const spawnMarker = `[SPAWN:code-edit]{"prompt":"Fix the authentication bug","model":"sonnet","retries":2}[/SPAWN]`;

      // Call 1: Master returns a SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: spawnMarker,
        stderr: '',
        retryCount: 0,
        durationMs: 150,
      });

      // Call 2: Worker first attempt crashes (retryable)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Transient network error during execution',
        retryCount: 0,
        durationMs: 80,
      });

      // Call 3: Worker retry succeeds
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Authentication bug fixed successfully.',
        stderr: '',
        retryCount: 0,
        durationMs: 450,
      });

      // Call 4: Master processes the worker result
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The authentication bug has been fixed.',
        stderr: '',
        retryCount: 0,
        durationMs: 120,
      });

      const response = await masterManager.processMessage(
        makeMessage('Fix the authentication bug'),
      );

      // Verify Master received the successful result
      expect(response).toBe('The authentication bug has been fixed.');

      // Verify spawn was called exactly 4 times (master + fail + retry + feedback)
      expect(mockSpawn).toHaveBeenCalledTimes(4);
    });

    it('worker registry records completed status with workerRetries=1 after a single retry', async () => {
      const spawnMarker = `[SPAWN:code-edit]{"prompt":"Fix the authentication bug","model":"sonnet","retries":2}[/SPAWN]`;

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: spawnMarker,
          stderr: '',
          retryCount: 0,
          durationMs: 150,
        }) // master
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Transient error',
          retryCount: 0,
          durationMs: 80,
        }) // worker fail
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Bug fixed.',
          stderr: '',
          retryCount: 0,
          durationMs: 400,
        }) // worker retry
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Done.',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        }); // master feedback

      await masterManager.processMessage(makeMessage('Fix the authentication bug'));

      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();

      expect(workers).toHaveLength(1);
      expect(workers[0]?.status).toBe('completed');
      expect(workers[0]?.workerRetries).toBe(1);
    });

    it('records a learning entry in the SQLite learnings table after a successful retry', async () => {
      const spawnMarker = `[SPAWN:code-edit]{"prompt":"Fix the authentication bug","model":"sonnet","retries":2}[/SPAWN]`;

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: spawnMarker,
          stderr: '',
          retryCount: 0,
          durationMs: 150,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Transient error',
          retryCount: 0,
          durationMs: 80,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Bug fixed.',
          stderr: '',
          retryCount: 0,
          durationMs: 400,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Done.',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });

      await masterManager.processMessage(makeMessage('Fix the authentication bug'));

      // Real learnings table should have at least one entry
      const learned = await memory.getLearnedTaskTypes();
      expect(learned.length).toBeGreaterThan(0);
    });

    it('records a success in the learnings table when retry succeeds', async () => {
      const spawnMarker = `[SPAWN:code-edit]{"prompt":"Fix the authentication bug","model":"sonnet","retries":2}[/SPAWN]`;

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: spawnMarker,
          stderr: '',
          retryCount: 0,
          durationMs: 150,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Transient error',
          retryCount: 0,
          durationMs: 80,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Bug fixed.',
          stderr: '',
          retryCount: 0,
          durationMs: 400,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Done.',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });

      await masterManager.processMessage(makeMessage('Fix the authentication bug'));

      // Learnings should record the final result as a success (retry succeeded)
      const learned = await memory.getLearnedTaskTypes();
      const totalSuccess = learned.reduce((sum, row) => sum + row.successCount, 0);
      expect(totalSuccess).toBeGreaterThan(0);
    });
  });

  describe('Retry exhaustion records failure in learnings', () => {
    it('records a failure in learnings when all retries are exhausted', async () => {
      const spawnMarker = `[SPAWN:code-edit]{"prompt":"Unstable task","model":"sonnet","retries":1}[/SPAWN]`;

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: spawnMarker,
          stderr: '',
          retryCount: 0,
          durationMs: 150,
        }) // master
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Crash',
          retryCount: 0,
          durationMs: 80,
        }) // worker fail 1
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Crash again',
          retryCount: 0,
          durationMs: 80,
        }) // worker retry fails
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Worker failed.',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        }); // master feedback

      await masterManager.processMessage(makeMessage('Run unstable task'));

      // Worker should be marked as failed
      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers[0]?.status).toBe('failed');

      // Learnings should record the failure
      const learned = await memory.getLearnedTaskTypes();
      const totalFailure = learned.reduce((sum, row) => sum + row.failureCount, 0);
      expect(totalFailure).toBeGreaterThan(0);
    });

    it('Master receives the failed-worker result message after retry exhaustion', async () => {
      const spawnMarker = `[SPAWN:code-edit]{"prompt":"Unstable task","model":"sonnet","retries":1}[/SPAWN]`;

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: spawnMarker,
          stderr: '',
          retryCount: 0,
          durationMs: 150,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Crash',
          retryCount: 0,
          durationMs: 80,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Crash again',
          retryCount: 0,
          durationMs: 80,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'The task failed after all retries.',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });

      const response = await masterManager.processMessage(makeMessage('Run unstable task'));

      // Master should receive a response (derived from the final master feedback call)
      expect(response).toBe('The task failed after all retries.');
    });
  });

  describe('Non-retryable errors are not retried', () => {
    it('does not retry on auth failure and records failure in learnings', async () => {
      const spawnMarker = `[SPAWN:code-edit]{"prompt":"Authenticated task","model":"sonnet","retries":3}[/SPAWN]`;

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: spawnMarker,
          stderr: '',
          retryCount: 0,
          durationMs: 150,
        }) // master
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Error: invalid api key — authentication failed',
          retryCount: 0,
          durationMs: 50,
        }) // worker — auth error, non-retryable
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Authentication error.',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        }); // master feedback

      await masterManager.processMessage(makeMessage('Run authenticated task'));

      // Only 3 calls: master + worker (no retry) + master feedback
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      // Learnings should record failure (no success)
      const learned = await memory.getLearnedTaskTypes();
      const totalFailure = learned.reduce((sum, row) => sum + row.failureCount, 0);
      expect(totalFailure).toBeGreaterThan(0);

      const totalSuccess = learned.reduce((sum, row) => sum + row.successCount, 0);
      expect(totalSuccess).toBe(0);
    });
  });
});
