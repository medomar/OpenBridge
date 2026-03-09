import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { ClassificationResult } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { AgentResult, SpawnOptions } from '../../src/core/agent-runner.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Mock AgentRunner ────────────────────────────────────────────────

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
    classifyError: (_stderr: string, _exitCode: number): string => 'unknown',
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

// ── Mock logger ─────────────────────────────────────────────────────

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Constants matching master-manager.ts values ──────────────────────

/** quick-answer: questions, lookups, explanations → 5 turns */
const QUICK_ANSWER_MAX_TURNS = 5;
/** tool-use: file generation, single edits, targeted fixes → 15 turns */
const TOOL_USE_MAX_TURNS = 15;

// ── Helpers ─────────────────────────────────────────────────────────

const masterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  available: true,
  role: 'master',
  capabilities: ['general'],
};

function getSpawnCallOpts(callIndex: number): SpawnOptions | undefined {
  return mockSpawn.mock.calls[callIndex]?.[0] as SpawnOptions | undefined;
}

// ── Suite: Keyword detection — file-reference group (OB-1261) ────────

describe('MasterManager — file-reference keyword detection (OB-1261)', () => {
  let testWorkspace: string;
  let manager: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawn.mockReset();
    mockStream.mockReset();
    mockSpawnWithHandle.mockReset();

    testWorkspace = path.join(os.tmpdir(), 'test-keyword-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    const dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();

    manager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    await manager.start();
  });

  afterEach(async () => {
    await manager.shutdown();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('classifies "explore the xl file I sent" as tool-use via keyword detection (OB-1261)', async () => {
    // Make the AI classifier fail so classifyTask() falls back to keyword heuristics.
    mockSpawn.mockRejectedValue(new Error('AI classifier unavailable'));

    const result = await manager.classifyTask('explore the xl file I sent');

    expect(result.class).toBe('tool-use');
    expect(result.reason).toMatch(/file-reference/i);
  });
});

// ── Suite: Attachment escalation (OB-1257, OB-1260) ─────────────────

describe('MasterManager — attachment escalation (OB-1257, OB-1260)', () => {
  let testWorkspace: string;
  let manager: MasterManager;

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

    testWorkspace = path.join(os.tmpdir(), 'test-classification-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    const dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();

    manager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    await manager.start();
  });

  afterEach(async () => {
    await manager.shutdown();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('escalates quick-answer to tool-use when message has file attachments — master spawn uses 15 turns (OB-1260)', async () => {
    // Force classifyTask() to return quick-answer so we can verify the escalation
    // that happens AFTER classification in processMessage().
    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue({
      class: 'quick-answer',
      maxTurns: QUICK_ANSWER_MAX_TURNS,
      timeout: 210_000,
      reason: 'test: forced quick-answer',
    } as ClassificationResult);

    // Simple response — no SPAWN markers needed for this test
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'Here is what I found in the file.',
      stderr: '',
      retryCount: 0,
      durationMs: 200,
    });

    const message: InboundMessage = {
      id: 'msg-attachment-test',
      content: 'explore this',
      rawContent: '/ai explore this',
      sender: '+1234567890',
      source: 'whatsapp',
      timestamp: new Date(),
      attachments: [
        {
          type: 'document',
          filePath: '/tmp/data.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          filename: 'data.xlsx',
          sizeBytes: 1024,
        },
      ],
    };

    await manager.processMessage(message);

    // The master spawn (call index 0) must use tool-use maxTurns (15), not quick-answer (5),
    // because the attachment escalation logic in processMessage() upgrades the class.
    const masterCall = getSpawnCallOpts(0);
    expect(masterCall).toBeDefined();
    expect(masterCall?.maxTurns).toBe(TOOL_USE_MAX_TURNS);
    expect(masterCall?.maxTurns).not.toBe(QUICK_ANSWER_MAX_TURNS);
  });
});
