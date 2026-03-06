/**
 * Integration tests: verify that MasterManager injects a memory briefing
 * as the `systemPrompt` when spawning workers (OB-723 / OB-727).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { MasterManager } from '../../src/master/master-manager.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import { MemoryManager } from '../../src/memory/index.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { AgentResult, SpawnOptions } from '../../src/core/agent-runner.js';

// ---------------------------------------------------------------------------
// Module mocks (must be at top level before any imports resolved by Vitest)
// ---------------------------------------------------------------------------

const mockSpawn = vi.fn();
const mockStream = vi.fn();
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

function getSpawnCallOpts(callIndex: number): SpawnOptions | undefined {
  return mockSpawn.mock.calls[callIndex]?.[0] as SpawnOptions | undefined;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MasterManager — worker briefing integration (OB-723 / OB-727)', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;
  let memory: MemoryManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawnWithHandle.mockReset();
    // spawnWithHandle delegates to mockSpawn so existing mockResolvedValueOnce calls work
    mockSpawnWithHandle.mockImplementation((opts: Parameters<typeof mockSpawn>[0]) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    // Keyword-based classification so tests don't consume extra spawn mocks
    vi.spyOn(MasterManager.prototype, 'classifyTask').mockImplementation(
      async (content: string) => {
        const lower = content.toLowerCase();
        if (['implement', 'build', 'refactor', 'develop'].some((kw) => lower.includes(kw)))
          return 'complex-task';
        if (['create', 'fix', 'write', 'generate'].some((kw) => lower.includes(kw)))
          return 'tool-use';
        return 'quick-answer';
      },
    );

    testWorkspace = path.join(os.tmpdir(), 'test-workspace-briefing-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    const dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();

    // Create an in-memory MemoryManager — buildBriefing will return "TASK: <prompt>"
    memory = new MemoryManager(':memory:');
    await memory.init();

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
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
      // Ignore cleanup errors
    }
  });

  it('passes briefing as systemPrompt in worker spawn options', async () => {
    const responseWithSpawn = `Analyzing the request.

[SPAWN:read-only]{"prompt":"List all source files","model":"haiku","maxTurns":5}[/SPAWN]

Done.`;

    // Call 1: Master processes message → returns SPAWN marker
    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: responseWithSpawn,
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    // Call 2: Worker spawned from SPAWN marker
    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'src/index.ts, src/core/bridge.ts',
      stderr: '',
      retryCount: 0,
      durationMs: 80,
    });

    // Call 3: Feedback to Master with worker results
    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'Found 2 source files.',
      stderr: '',
      retryCount: 0,
      durationMs: 50,
    });

    await masterManager.processMessage(makeMessage('List all source files'));

    expect(mockSpawn).toHaveBeenCalledTimes(3);

    // Call index 1 is the worker spawn — verify systemPrompt is set
    const workerCall = getSpawnCallOpts(1);
    expect(workerCall).toBeDefined();
    // The briefing should start with 'TASK:' (minimal DB has no chunks)
    expect(workerCall?.systemPrompt).toBeDefined();
    expect(workerCall?.systemPrompt).toContain('TASK:');
  });

  it('briefing systemPrompt contains the worker task prompt', async () => {
    const workerTask = 'List all source files';
    const responseWithSpawn = `[SPAWN:read-only]{"prompt":"${workerTask}","model":"haiku","maxTurns":5}[/SPAWN]`;

    mockSpawn
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'src/index.ts',
        stderr: '',
        retryCount: 0,
        durationMs: 50,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Done.',
        stderr: '',
        retryCount: 0,
        durationMs: 30,
      });

    await masterManager.processMessage(makeMessage('List source files'));

    const workerCall = getSpawnCallOpts(1);
    expect(workerCall?.systemPrompt).toContain(workerTask);
  });

  it('still spawns workers when MemoryManager.buildBriefing throws', async () => {
    // Force buildBriefing to throw
    vi.spyOn(memory, 'buildBriefing').mockRejectedValueOnce(new Error('DB error'));

    const responseWithSpawn =
      '[SPAWN:read-only]{"prompt":"List configs","model":"haiku","maxTurns":5}[/SPAWN]';

    mockSpawn
      .mockResolvedValueOnce({ exitCode: 0, stdout: responseWithSpawn, stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'config.json', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 0, stdout: 'Found 1 config file.', stderr: '' });

    // Should not throw — error is swallowed with a warning
    const response = await masterManager.processMessage(makeMessage('List configs'));
    expect(response).toBeDefined();
    expect(mockSpawn).toHaveBeenCalledTimes(3);

    // Worker spawn should still have been called, but without systemPrompt
    const workerCall = getSpawnCallOpts(1);
    expect(workerCall).toBeDefined();
    expect(workerCall?.systemPrompt).toBeUndefined();
  });
});
