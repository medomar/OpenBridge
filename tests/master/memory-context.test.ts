/**
 * Integration tests: verify that MasterManager injects memory.md content
 * into the Master's system prompt via buildConversationContext() (OB-1027 / OB-F29 / OB-1022).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { MasterManager } from '../../src/master/master-manager.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';

// ---------------------------------------------------------------------------
// Module mocks
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

describe('MasterManager — memory.md context injection (OB-1027 / OB-1022)', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;
  let dotFolderManager: DotFolderManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockSpawnWithHandle.mockImplementation((opts: Parameters<typeof mockSpawn>[0]) => ({
      promise: mockSpawn(opts) as Promise<unknown>,
      pid: 12345,
      abort: vi.fn(),
    }));

    // Use keyword-based classification so tests don't consume extra spawn mocks
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

    testWorkspace = path.join(os.tmpdir(), 'test-workspace-memory-ctx-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();
  });

  afterEach(async () => {
    if (masterManager) {
      await masterManager.shutdown();
    }
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // TODO: mock drift — MasterManager prompt assembly path changed, memory injection not wired in test mock
  it.skip('injects memory.md content into Master systemPrompt when file exists', async () => {
    const memoryContent = [
      '## User Preferences',
      '- Always uses TypeScript',
      '- Prefers short answers',
      '',
      '## Project State',
      '- Authentication implemented with JWT',
    ].join('\n');

    await dotFolderManager.writeMemoryFile(memoryContent);

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });
    await masterManager.start();

    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'Hello! How can I help?',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    await masterManager.processMessage(makeMessage('hello'));

    const spawnOpts = getSpawnCallOpts(0);
    expect(spawnOpts).toBeDefined();
    expect(spawnOpts?.systemPrompt).toBeDefined();
    expect(spawnOpts?.systemPrompt).toContain('## Memory:');
    expect(spawnOpts?.systemPrompt).toContain('## User Preferences');
    expect(spawnOpts?.systemPrompt).toContain('Authentication implemented with JWT');
  });

  it('does not inject memory section when memory.md is missing', async () => {
    // No memory.md written — file does not exist
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });
    await masterManager.start();

    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'Hello! How can I help?',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    await masterManager.processMessage(makeMessage('hello'));

    const spawnOpts = getSpawnCallOpts(0);
    expect(spawnOpts).toBeDefined();
    // systemPrompt may be set from other sources, but should NOT contain memory section
    const prompt = spawnOpts?.systemPrompt ?? '';
    expect(prompt).not.toContain('## Memory:');
  });

  it('does not inject memory section when memory.md is empty', async () => {
    // Write an empty (whitespace-only) memory file
    await fs.writeFile(
      path.join(testWorkspace, '.openbridge', 'context', 'memory.md'),
      '   \n   ',
      'utf-8',
    );

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });
    await masterManager.start();

    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'Hello! How can I help?',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    await masterManager.processMessage(makeMessage('hello'));

    const spawnOpts = getSpawnCallOpts(0);
    const prompt = spawnOpts?.systemPrompt ?? '';
    expect(prompt).not.toContain('## Memory:');
  });

  it('injects memory content verbatim (trimmed) under ## Memory: header', async () => {
    const memoryContent = '  decision: chose PostgreSQL  ';

    await dotFolderManager.writeMemoryFile(memoryContent);

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });
    await masterManager.start();

    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'Got it.',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    await masterManager.processMessage(makeMessage('hello'));

    const spawnOpts = getSpawnCallOpts(0);
    expect(spawnOpts?.systemPrompt).toContain('## Memory:\ndecision: chose PostgreSQL');
  });
});
