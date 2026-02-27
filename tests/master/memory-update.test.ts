/**
 * Unit tests for MasterManager.triggerMemoryUpdate() context injection (OB-1120).
 *
 * Verifies:
 * (a) prompt contains "## Recent conversation history:" when messages exist in SQLite
 * (b) prompt includes formatted "[timestamp] Role: content" lines
 * (c) content is truncated to 300 chars with "…" for long messages
 * (d) when no messages exist, prompt is sent without the history section (no crash)
 * (e) when this.memory is null, prompt is sent without history (graceful fallback)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';
import type { ConversationEntry, MemoryManager } from '../../src/memory/index.js';

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
    classifyError: () => 'unknown',
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

/** Minimal fake MasterSession to satisfy triggerMemoryUpdate()'s early-return guard */
const fakeMasterSession = {
  sessionId: 'test-session-id',
  createdAt: new Date().toISOString(),
  lastUsedAt: new Date().toISOString(),
  messageCount: 0,
  allowedTools: ['Read', 'Write'],
  maxTurns: 50,
};

/** Build a ConversationEntry with sensible defaults */
function makeEntry(
  role: 'user' | 'master',
  content: string,
  created_at = '2026-01-15T10:30:00.000Z',
): ConversationEntry {
  return {
    session_id: 'sess-1',
    role,
    content,
    created_at,
  };
}

/** Create a minimal MemoryManager mock with getRecentMessages controlled by test */
function makeMemory(entries: ConversationEntry[]): MemoryManager {
  return {
    getRecentMessages: vi.fn().mockResolvedValue(entries),
  } as unknown as MemoryManager;
}

/** Extract the prompt from the first spawn call */
function getCapturedPrompt(): string | undefined {
  const opts = mockSpawn.mock.calls[0]?.[0] as SpawnOptions | undefined;
  return opts?.prompt;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MasterManager — triggerMemoryUpdate() context injection (OB-1120)', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockSpawnWithHandle.mockImplementation((opts: SpawnOptions) => ({
      promise: mockSpawn(opts) as Promise<unknown>,
      pid: 99999,
      abort: vi.fn(),
    }));

    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: '',
      stderr: '',
      retryCount: 0,
      durationMs: 50,
    });

    testWorkspace = path.join(process.cwd(), 'test-mem-update-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });
  });

  afterEach(async () => {
    if (masterManager) {
      try {
        await masterManager.shutdown();
      } catch {
        // Ignore shutdown errors in tests
      }
    }
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // -------------------------------------------------------------------------
  // (a) prompt contains "## Recent conversation history:" when messages exist
  // -------------------------------------------------------------------------

  it('(a) includes "## Recent conversation history:" section when messages exist', async () => {
    const memory = makeMemory([
      makeEntry('user', 'Hello, can you help me?'),
      makeEntry('master', 'Of course! What do you need?'),
    ]);

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });

    // Inject fake session to bypass early-return guard
    (masterManager as unknown as Record<string, unknown>).masterSession = fakeMasterSession;

    await (
      masterManager as unknown as { triggerMemoryUpdate(): Promise<void> }
    ).triggerMemoryUpdate();

    const prompt = getCapturedPrompt();
    expect(prompt).toBeDefined();
    expect(prompt).toContain('## Recent conversation history:');
  });

  // -------------------------------------------------------------------------
  // (b) prompt includes formatted [timestamp] Role: content lines
  // -------------------------------------------------------------------------

  it('(b) formats each message as "[timestamp] Role: content"', async () => {
    const memory = makeMemory([
      makeEntry('user', 'What is the project status?', '2026-01-15T10:30:00.000Z'),
      makeEntry('master', 'Phase 63 is complete.', '2026-01-15T10:31:00.000Z'),
    ]);

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });

    (masterManager as unknown as Record<string, unknown>).masterSession = fakeMasterSession;

    await (
      masterManager as unknown as { triggerMemoryUpdate(): Promise<void> }
    ).triggerMemoryUpdate();

    const prompt = getCapturedPrompt();
    expect(prompt).toContain('[2026-01-15 10:30] User: What is the project status?');
    expect(prompt).toContain('[2026-01-15 10:31] Master: Phase 63 is complete.');
  });

  // -------------------------------------------------------------------------
  // (c) content is truncated to 300 chars with "…" for long messages
  // -------------------------------------------------------------------------

  it('(c) truncates long message content to 300 chars with "…"', async () => {
    const longContent = 'A'.repeat(400);
    const memory = makeMemory([makeEntry('user', longContent, '2026-01-15T09:00:00.000Z')]);

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });

    (masterManager as unknown as Record<string, unknown>).masterSession = fakeMasterSession;

    await (
      masterManager as unknown as { triggerMemoryUpdate(): Promise<void> }
    ).triggerMemoryUpdate();

    const prompt = getCapturedPrompt();
    expect(prompt).toBeDefined();
    // Truncated content is 300 chars of 'A' followed by '…'
    expect(prompt).toContain('A'.repeat(300) + '…');
    // The original 400-char content should NOT appear verbatim
    expect(prompt).not.toContain('A'.repeat(301));
  });

  it('(c) does not truncate content that is exactly 300 chars', async () => {
    const exactContent = 'B'.repeat(300);
    const memory = makeMemory([makeEntry('master', exactContent, '2026-01-15T09:00:00.000Z')]);

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });

    (masterManager as unknown as Record<string, unknown>).masterSession = fakeMasterSession;

    await (
      masterManager as unknown as { triggerMemoryUpdate(): Promise<void> }
    ).triggerMemoryUpdate();

    const prompt = getCapturedPrompt();
    // Exactly 300 chars — no truncation, no "…"
    expect(prompt).toContain('B'.repeat(300));
    expect(prompt).not.toContain('B'.repeat(300) + '…');
  });

  // -------------------------------------------------------------------------
  // (d) when no messages exist, prompt is sent without the history section
  // -------------------------------------------------------------------------

  it('(d) sends prompt without history section when no messages exist', async () => {
    const memory = makeMemory([]); // empty list

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      memory,
    });

    (masterManager as unknown as Record<string, unknown>).masterSession = fakeMasterSession;

    await (
      masterManager as unknown as { triggerMemoryUpdate(): Promise<void> }
    ).triggerMemoryUpdate();

    // spawn should still be called (no crash)
    expect(mockSpawn).toHaveBeenCalledOnce();

    const prompt = getCapturedPrompt();
    expect(prompt).toBeDefined();
    expect(prompt).not.toContain('## Recent conversation history:');
    // Core memory-update instructions should still be present
    expect(prompt).toContain('Update your memory file');
  });

  // -------------------------------------------------------------------------
  // (e) when this.memory is null, prompt is sent without history (graceful fallback)
  // -------------------------------------------------------------------------

  it('(e) sends prompt without history when memory is null', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
      // no memory option → this.memory = null
    });

    (masterManager as unknown as Record<string, unknown>).masterSession = fakeMasterSession;

    await (
      masterManager as unknown as { triggerMemoryUpdate(): Promise<void> }
    ).triggerMemoryUpdate();

    // spawn should be called (no crash)
    expect(mockSpawn).toHaveBeenCalledOnce();

    const prompt = getCapturedPrompt();
    expect(prompt).toBeDefined();
    expect(prompt).not.toContain('## Recent conversation history:');
    expect(prompt).toContain('Update your memory file');
  });

  // -------------------------------------------------------------------------
  // Edge case: early return when masterSession is null
  // -------------------------------------------------------------------------

  it('does not call spawn when masterSession is null', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    // masterSession is null by default — triggerMemoryUpdate() should return early
    await (
      masterManager as unknown as { triggerMemoryUpdate(): Promise<void> }
    ).triggerMemoryUpdate();

    expect(mockSpawn).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Edge case: early return when state is 'shutdown'
  // -------------------------------------------------------------------------

  it('does not call spawn when state is "shutdown"', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    (masterManager as unknown as Record<string, unknown>).masterSession = fakeMasterSession;
    (masterManager as unknown as Record<string, unknown>).state = 'shutdown';

    await (
      masterManager as unknown as { triggerMemoryUpdate(): Promise<void> }
    ).triggerMemoryUpdate();

    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
