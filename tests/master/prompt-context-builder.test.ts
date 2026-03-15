/**
 * Unit tests for PromptContextBuilder.buildConversationContext — sender isolation (OB-1546).
 * Verifies that the sender param is threaded correctly to session history and FTS5 search,
 * so WebChat "New Chat" sessions are isolated per sender.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  PromptContextBuilder,
  type PromptContextBuilderDeps,
} from '../../src/master/prompt-context-builder.js';
import type { MemoryManager, ConversationEntry } from '../../src/memory/index.js';
import type { DotFolderManager } from '../../src/master/dotfolder-manager.js';

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
