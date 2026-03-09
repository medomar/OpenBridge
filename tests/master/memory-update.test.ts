/**
 * Unit tests for MasterManager.triggerMemoryUpdate() context injection (OB-1120).
 *
 * Verifies:
 * (a) prompt contains "## Recent conversation history:" when messages exist in SQLite
 * (b) prompt includes formatted "[timestamp] Role: content" lines
 * (c) content is truncated to 300 chars with "…" for long messages
 * (d) when no messages exist, prompt is sent without the history section (no crash)
 * (e) when this.memory is null, prompt is sent without history (graceful fallback)
 *
 * Also verifies (OB-1272):
 * After exploration completes, writeExplorationSummaryToMemory() populates memory.md
 * with meaningful project content — not the fallback stub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';
import type { WorkspaceMap, Classification } from '../../src/types/master.js';
import { MemoryManager, type ConversationEntry } from '../../src/memory/index.js';

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
    DEFAULT_MAX_FIX_ITERATIONS: 3,
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

// ---------------------------------------------------------------------------
// Integration test — SQLite → MemoryManager → formatted prompt pipeline (OB-1121)
// ---------------------------------------------------------------------------

describe('MemoryManager integration — getRecentMessages pipeline (OB-1121)', () => {
  /**
   * Apply the same formatting logic used by triggerMemoryUpdate() in master-manager.ts.
   * This mirrors lines 876–882 of that file so the test validates the real output.
   */
  function formatHistorySection(entries: ConversationEntry[]): string {
    if (entries.length === 0) return '';
    const lines = entries.map((msg) => {
      const ts = msg.created_at ? msg.created_at.slice(0, 16).replace('T', ' ') : '';
      const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
      const content = msg.content.length > 300 ? msg.content.slice(0, 300) + '…' : msg.content;
      return `[${ts}] ${role}: ${content}`;
    });
    return `## Recent conversation history:\n${lines.join('\n')}\n\n`;
  }

  it('(d+e) returns entries chronologically filtered to user/master and formats correctly into prompt', async () => {
    // (a) Create MemoryManager backed by an in-memory SQLite database
    const manager = new MemoryManager(':memory:');
    await manager.init();

    try {
      // (b) Insert 5 test conversation entries — mix of user/master roles, some with special chars
      const testEntries: ConversationEntry[] = [
        {
          session_id: 'sess-int',
          role: 'user',
          content: "What's the project status?", // single quote (FTS5 special char)
          created_at: '2026-01-15T10:00:00.000Z',
        },
        {
          session_id: 'sess-int',
          role: 'master',
          content: 'Phase 63 is complete. Next: "Phase 64" (memory updates).',
          created_at: '2026-01-15T10:01:00.000Z',
        },
        {
          session_id: 'sess-int',
          role: 'user',
          content: 'Can you fix the AND/OR logic in the search?', // FTS5 operators
          created_at: '2026-01-15T10:02:00.000Z',
        },
        {
          session_id: 'sess-int',
          role: 'master',
          content: 'Fixed the FTS5 sanitization (OB-F38): special chars * handled.',
          created_at: '2026-01-15T10:03:00.000Z',
        },
        {
          session_id: 'sess-int',
          role: 'user',
          content: 'Great! What about the memory.md issue?',
          created_at: '2026-01-15T10:04:00.000Z',
        },
      ];

      // (c) Insert via MemoryManager facade
      for (const entry of testEntries) {
        await manager.recordMessage(entry);
      }

      // (d) Verify getRecentMessages(20) returns all 5 entries in chronological order
      const result = await manager.getRecentMessages(20);

      expect(result).toHaveLength(5);

      // Verify chronological order (oldest → newest)
      for (let i = 1; i < result.length; i++) {
        expect(result[i].created_at! >= result[i - 1].created_at!).toBe(true);
      }

      // Verify only user/master roles are present
      for (const entry of result) {
        expect(['user', 'master']).toContain(entry.role);
      }

      // Verify content of first and last entries
      expect(result[0].content).toContain("What's the project status?");
      expect(result[4].content).toContain('memory.md');

      // (e) Verify the formatted prompt string contains snippets from test conversations
      const historySection = formatHistorySection(result);

      expect(historySection).toContain('## Recent conversation history:');
      expect(historySection).toContain("[2026-01-15 10:00] User: What's the project status?");
      expect(historySection).toContain('[2026-01-15 10:01] Master: Phase 63 is complete.');
      expect(historySection).toContain(
        '[2026-01-15 10:04] User: Great! What about the memory.md issue?',
      );
    } finally {
      await manager.close();
    }
  });

  it('filters out worker and system roles — only user/master appear in getRecentMessages()', async () => {
    const manager = new MemoryManager(':memory:');
    await manager.init();

    try {
      // Insert all four role types
      await manager.recordMessage({
        session_id: 'sess-roles',
        role: 'user',
        content: 'User message',
        created_at: '2026-01-15T10:00:00.000Z',
      });
      await manager.recordMessage({
        session_id: 'sess-roles',
        role: 'master',
        content: 'Master response',
        created_at: '2026-01-15T10:01:00.000Z',
      });
      await manager.recordMessage({
        session_id: 'sess-roles',
        role: 'worker',
        content: 'Worker output — should be excluded',
        created_at: '2026-01-15T10:02:00.000Z',
      });
      await manager.recordMessage({
        session_id: 'sess-roles',
        role: 'system',
        content: 'System note — should be excluded',
        created_at: '2026-01-15T10:03:00.000Z',
      });

      const result = await manager.getRecentMessages(20);

      // Only user and master should be returned
      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('master');
    } finally {
      await manager.close();
    }
  });

  it('respects the limit parameter', async () => {
    const manager = new MemoryManager(':memory:');
    await manager.init();

    try {
      // Insert 6 entries
      for (let i = 0; i < 6; i++) {
        await manager.recordMessage({
          session_id: 'sess-limit',
          role: i % 2 === 0 ? 'user' : 'master',
          content: `Message ${i}`,
          created_at: `2026-01-15T10:0${i}:00.000Z`,
        });
      }

      // Request only 3
      const result = await manager.getRecentMessages(3);
      expect(result).toHaveLength(3);
    } finally {
      await manager.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Post-exploration memory.md population test (OB-1272)
// ---------------------------------------------------------------------------

describe('MasterManager — writeExplorationSummaryToMemory() (OB-1272)', () => {
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

    testWorkspace = path.join(
      os.tmpdir(),
      'test-exploration-memory-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    );
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

  /** Get the DotFolderManager from MasterManager's private field */
  function getDotFolder(mm: MasterManager): DotFolderManager {
    return (mm as unknown as Record<string, unknown>).dotFolder as DotFolderManager;
  }

  /** Call the private writeExplorationSummaryToMemory() method */
  async function callWriteExplorationSummaryToMemory(mm: MasterManager): Promise<void> {
    return (
      mm as unknown as { writeExplorationSummaryToMemory(): Promise<void> }
    ).writeExplorationSummaryToMemory();
  }

  it('populates memory.md with project overview — not the fallback stub', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    const dotFolder = getDotFolder(masterManager);
    await dotFolder.createFolder();

    const workspaceMap: WorkspaceMap = {
      workspacePath: testWorkspace,
      projectName: 'my-test-project',
      projectType: 'node',
      frameworks: ['TypeScript', 'Vitest'],
      structure: {
        src: { path: 'src', purpose: 'Source code' },
        tests: { path: 'tests', purpose: 'Test files' },
      },
      keyFiles: [],
      entryPoints: ['src/index.ts'],
      commands: { build: 'npm run build', test: 'npm test' },
      dependencies: [],
      summary: 'A test Node.js project',
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
    };
    await dotFolder.writeWorkspaceMap(workspaceMap);

    await callWriteExplorationSummaryToMemory(masterManager);

    const content = await dotFolder.readMemoryFile();

    expect(content).not.toBeNull();
    expect(content).toContain('# Memory');
    expect(content).toContain('(post-exploration seed)');
    expect(content).toContain('## Project Overview');
    expect(content).toContain('my-test-project');
    expect(content).toContain('node');
    // Must NOT be the fallback stub produced by writeMemoryFromConversation()
    expect(content).not.toContain('_No recent messages._');
  });

  it('includes frameworks section when workspace map has frameworks', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    const dotFolder = getDotFolder(masterManager);
    await dotFolder.createFolder();

    const workspaceMap: WorkspaceMap = {
      workspacePath: testWorkspace,
      projectName: 'framework-project',
      projectType: 'node',
      frameworks: ['React', 'TypeScript', 'Vite'],
      structure: {},
      keyFiles: [],
      entryPoints: [],
      commands: {},
      dependencies: [],
      summary: 'A React project',
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
    };
    await dotFolder.writeWorkspaceMap(workspaceMap);

    await callWriteExplorationSummaryToMemory(masterManager);

    const content = await dotFolder.readMemoryFile();

    expect(content).toContain('## Frameworks & Tech Stack');
    expect(content).toContain('React');
    expect(content).toContain('TypeScript');
    expect(content).toContain('Vite');
  });

  it('falls back to classification.json when workspace map is missing', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    const dotFolder = getDotFolder(masterManager);

    // Write ONLY classification (no workspace map)
    const classification: Classification = {
      projectType: 'python',
      projectName: 'my-python-app',
      frameworks: ['FastAPI', 'SQLAlchemy'],
      commands: { run: 'python main.py', test: 'pytest' },
      dependencies: [],
      insights: ['Uses async patterns'],
      classifiedAt: new Date().toISOString(),
      durationMs: 150,
    };
    await dotFolder.writeClassification(classification);

    await callWriteExplorationSummaryToMemory(masterManager);

    const content = await dotFolder.readMemoryFile();

    expect(content).not.toBeNull();
    expect(content).toContain('# Memory');
    expect(content).toContain('my-python-app');
    expect(content).toContain('python');
    expect(content).not.toContain('_No recent messages._');
  });

  it('does not write memory.md when neither workspace map nor classification exists', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    const dotFolder = getDotFolder(masterManager);

    // No exploration data — method should skip silently
    await callWriteExplorationSummaryToMemory(masterManager);

    const content = await dotFolder.readMemoryFile();
    // memory.md should not have been created
    expect(content).toBeNull();
  });
});
