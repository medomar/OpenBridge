/**
 * Unit tests for PromptContextBuilder.buildConversationContext — sender isolation (OB-1546).
 * Verifies that the sender param is threaded correctly to session history and FTS5 search,
 * so WebChat "New Chat" sessions are isolated per sender.
 *
 * Also tests buildMasterSpawnOptions — system prompt budget (OB-F216).
 */

// ── Mock logger before any imports ──────────────────────────────────────────
const { mockWarnPcb } = vi.hoisted(() => ({ mockWarnPcb: vi.fn() }));

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: mockWarnPcb,
    debug: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PromptContextBuilder,
  type PromptContextBuilderDeps,
} from '../../src/master/prompt-context-builder.js';
import type { MemoryManager, ConversationEntry } from '../../src/memory/index.js';
import type { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { CLIAdapter } from '../../src/core/cli-adapter.js';
import type { MasterSession, ExplorationSummary } from '../../src/types/master.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  role: ConversationEntry['role'],
  content: string,
  userId: string,
): ConversationEntry {
  return {
    session_id: 'test-session',
    role,
    content,
    user_id: userId,
    created_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PromptContextBuilder.buildConversationContext — sender isolation (OB-1546)', () => {
  let builder: PromptContextBuilder;
  let mockGetSessionHistoryForSender: ReturnType<typeof vi.fn>;
  let mockGetSessionHistory: ReturnType<typeof vi.fn>;
  let mockSearchConversations: ReturnType<typeof vi.fn>;
  let mockReadMemoryFile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWarnPcb.mockClear();

    mockGetSessionHistoryForSender = vi.fn().mockResolvedValue([]);
    mockGetSessionHistory = vi.fn().mockResolvedValue([]);
    mockSearchConversations = vi.fn().mockResolvedValue([]);
    mockReadMemoryFile = vi.fn().mockResolvedValue(null);

    const mockMemory = {
      getSessionHistoryForSender: mockGetSessionHistoryForSender,
      getSessionHistory: mockGetSessionHistory,
      searchConversations: mockSearchConversations,
    } as unknown as MemoryManager;

    const mockDotFolder = {
      readMemoryFile: mockReadMemoryFile,
    } as unknown as DotFolderManager;

    const deps: PromptContextBuilderDeps = {
      workspacePath: '/tmp/test',
      dotFolder: mockDotFolder,
      messageTimeout: 30_000,
      getMemory: () => mockMemory,
      getSystemPrompt: () => null,
      getMasterSession: () => null,
      getMapLastVerifiedAt: () => null,
      getLearningsSummary: () => null,
      getExplorationSummary: () => null,
      getWorkspaceContextSummary: () => null,
      getBatchManager: () => null,
      drainCancellationNotifications: () => [],
      drainDeepModeResumeOffers: () => [],
      readWorkspaceMapFromStore: async () => null,
      readAllTasksFromStore: async () => [],
    };

    builder = new PromptContextBuilder(deps);
  });

  it('calls getSessionHistoryForSender when sender is provided', async () => {
    mockGetSessionHistoryForSender.mockResolvedValue([
      makeEntry('user', 'hello from alice', 'alice'),
    ]);

    await builder.buildConversationContext('test message', 'sess-1', 'alice');

    expect(mockGetSessionHistoryForSender).toHaveBeenCalledWith('sess-1', 'alice', 20);
    expect(mockGetSessionHistory).not.toHaveBeenCalled();
  });

  it('calls getSessionHistory when no sender is provided', async () => {
    mockGetSessionHistory.mockResolvedValue([makeEntry('user', 'hello from anyone', 'anyone')]);

    await builder.buildConversationContext('test message', 'sess-1');

    expect(mockGetSessionHistory).toHaveBeenCalledWith('sess-1', 20);
    expect(mockGetSessionHistoryForSender).not.toHaveBeenCalled();
  });

  it('produces context containing sender messages when sender is provided', async () => {
    mockGetSessionHistoryForSender.mockResolvedValue([
      makeEntry('user', 'alice asked about deployment pipeline', 'alice'),
      makeEntry('master', 'deployment pipeline is ready for review', 'alice'),
    ]);

    const context = await builder.buildConversationContext('deploy query', 'sess-1', 'alice');

    expect(context).not.toBeNull();
    expect(context).toContain('alice asked about deployment pipeline');
    expect(context).toContain('deployment pipeline is ready for review');
  });

  it('passes sender as userId to searchConversations for cross-session filtering', async () => {
    await builder.buildConversationContext('authentication deploy', 'sess-1', 'alice');

    expect(mockSearchConversations).toHaveBeenCalledWith('authentication deploy', 5, 'alice');
  });

  it('passes undefined as userId to searchConversations when sender is not provided', async () => {
    await builder.buildConversationContext('authentication deploy', 'sess-1');

    expect(mockSearchConversations).toHaveBeenCalledWith('authentication deploy', 5, undefined);
  });

  it('returns null when session has no messages and memory is empty', async () => {
    // All mocks return empty — nothing to build context from
    const context = await builder.buildConversationContext('some query');

    expect(context).toBeNull();
  });

  it('cross-session results for sender do not include other senders messages', async () => {
    // Only alice's cross-session messages are returned
    mockSearchConversations.mockResolvedValue([
      makeEntry('user', 'alice previous session question', 'alice'),
    ]);

    const context = await builder.buildConversationContext('previous topic', undefined, 'alice');

    expect(context).not.toBeNull();
    expect(context).toContain('alice previous session question');
    expect(mockSearchConversations).toHaveBeenCalledWith('previous topic', 5, 'alice');
  });
});

// ---------------------------------------------------------------------------
// buildMasterSpawnOptions — system prompt budget (OB-F216)
// ---------------------------------------------------------------------------

function makeMockSession(): MasterSession {
  return {
    sessionId: 'test-session-id',
    createdAt: new Date().toISOString(),
    lastUsedAt: new Date().toISOString(),
    messageCount: 0,
    allowedTools: ['Read', 'Write'],
    maxTurns: 50,
  };
}

function buildBuilderWithAdapter(
  systemPrompt: string,
  maxSystemPromptChars: number,
): PromptContextBuilder {
  const mockAdapter = {
    getPromptBudget: vi.fn().mockReturnValue({
      maxSystemPromptChars,
      maxPromptChars: maxSystemPromptChars,
    }),
  } as unknown as CLIAdapter;

  return new PromptContextBuilder({
    workspacePath: '/test/workspace',
    messageTimeout: 30_000,
    adapter: mockAdapter,
    dotFolder: {
      readMemoryFile: vi.fn().mockResolvedValue(null),
      listAvailableTemplates: vi.fn().mockResolvedValue([]),
    } as unknown as DotFolderManager,
    getMemory: () => null,
    getSystemPrompt: () => systemPrompt,
    getMasterSession: makeMockSession,
    getMapLastVerifiedAt: () => null,
    getLearningsSummary: () => null,
    getExplorationSummary: (): ExplorationSummary | null => null,
    getWorkspaceContextSummary: () => null,
    getBatchManager: () => null,
    drainCancellationNotifications: () => [],
    drainDeepModeResumeOffers: () => [],
    readWorkspaceMapFromStore: vi.fn().mockResolvedValue(null),
    readAllTasksFromStore: vi.fn().mockResolvedValue([]),
  });
}

describe('buildMasterSpawnOptions — system prompt budget (OB-F216)', () => {
  beforeEach(() => {
    mockWarnPcb.mockClear();
  });

  it('does not truncate a 49K system prompt when adapter budget is 800K (Sonnet/Opus)', () => {
    // systemPromptBudget = Math.min(800K * 0.6, 200K) = 200K
    // 49K < 200K → not truncated
    const systemPrompt = 'S'.repeat(49_000);
    const builder = buildBuilderWithAdapter(systemPrompt, 800_000);

    const result = builder.buildMasterSpawnOptions('test message');

    expect(result.systemPrompt).toBeDefined();
    expect(result.systemPrompt!.length).toBe(49_000);
  });

  it('truncates a 150K system prompt to ~108K when adapter budget is 180K (Haiku)', () => {
    // systemPromptBudget = Math.min(180K * 0.6, 200K) = 108K
    // 150K > 108K → truncated to 108K
    const systemPrompt = 'S'.repeat(150_000);
    const builder = buildBuilderWithAdapter(systemPrompt, 180_000);

    const result = builder.buildMasterSpawnOptions('test message');

    expect(result.systemPrompt).toBeDefined();
    expect(result.systemPrompt!.length).toBeLessThanOrEqual(108_000);
  });

  it('does not truncate a 49K system prompt when adapter budget is 180K (Haiku)', () => {
    // systemPromptBudget = Math.min(180K * 0.6, 200K) = 108K
    // 49K < 108K → still fits
    const systemPrompt = 'S'.repeat(49_000);
    const builder = buildBuilderWithAdapter(systemPrompt, 180_000);

    const result = builder.buildMasterSpawnOptions('test message');

    expect(result.systemPrompt).toBeDefined();
    expect(result.systemPrompt!.length).toBe(49_000);
  });

  it('emits no truncation warning when 49K system prompt fits within 800K budget', () => {
    const systemPrompt = 'S'.repeat(49_000);
    const builder = buildBuilderWithAdapter(systemPrompt, 800_000);

    builder.buildMasterSpawnOptions('test message');

    // No truncation warning should fire when content fits
    const warnCalls = mockWarnPcb.mock.calls as unknown[][];
    const truncationWarnings = warnCalls.filter((args) => {
      const obj = args[0] as Record<string, unknown>;
      return Array.isArray(obj.truncated);
    });
    expect(truncationWarnings).toHaveLength(0);
  });

  it('emits a truncation warning when 150K system prompt is capped to 108K on Haiku', () => {
    const systemPrompt = 'S'.repeat(150_000);
    const builder = buildBuilderWithAdapter(systemPrompt, 180_000);

    builder.buildMasterSpawnOptions('test message');

    // Truncation warning must fire when content is cut
    const warnCalls = mockWarnPcb.mock.calls as unknown[][];
    const truncationWarnings = warnCalls.filter((args) => {
      const obj = args[0] as Record<string, unknown>;
      return Array.isArray(obj.truncated);
    });
    expect(truncationWarnings.length).toBeGreaterThan(0);
  });
});
