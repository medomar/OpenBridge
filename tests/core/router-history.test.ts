/**
 * Unit tests for the Router /history command (OB-1038).
 *
 * Covers:
 *   "history"               → list last 10 sessions
 *   "history search <q>"    → search sessions by keyword
 *   "history <session-id>"  → show full transcript
 *
 * Each variant tests: memory available, memory missing, and empty result cases.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/core/github-publisher.js', () => ({
  publishToGitHubPages: vi.fn().mockResolvedValue('https://owner.github.io/repo/report.html'),
}));

vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: vi.fn().mockResolvedValue({ stdout: 'Fast-path answer', stderr: '', exitCode: 0 }),
    spawnWithHandle: vi.fn(),
  })),
  TOOLS_READ_ONLY: ['Read', 'Glob', 'Grep'],
}));

import { Router } from '../../src/core/router.js';
import { MockConnector } from '../helpers/mock-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { MemoryManager, SessionSummary, ConversationEntry } from '../../src/memory/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHistoryMessage(content: string): InboundMessage {
  return {
    id: 'msg-hist',
    source: 'mock',
    sender: '+1234567890',
    rawContent: content,
    content,
    timestamp: new Date(),
  };
}

function makeSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: 'sess-abc',
    title: 'Test session title',
    first_message_at: '2026-01-01T10:00:00.000Z',
    last_message_at: '2026-01-01T11:00:00.000Z',
    message_count: 5,
    channel: 'whatsapp',
    user_id: '+1234567890',
    ...overrides,
  };
}

function makeEntry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    session_id: 'sess-abc',
    role: 'user',
    content: 'Hello there',
    created_at: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

/** Build a minimal MemoryManager stub with the three history-related methods. */
function createMockMemory(
  sessions: SessionSummary[] = [],
  entries: ConversationEntry[] = [],
): Partial<MemoryManager> {
  return {
    listSessions: vi.fn().mockResolvedValue(sessions),
    searchSessions: vi.fn().mockResolvedValue(sessions),
    getSessionHistory: vi.fn().mockResolvedValue(entries),
    // Fast-path responder also calls these methods — provide stubs
    searchConversations: vi.fn().mockResolvedValue([]),
    findRelevantHistory: vi.fn().mockResolvedValue([]),
    getActivitySummary: vi.fn().mockResolvedValue([]),
    getRecentSessions: vi.fn().mockResolvedValue([]),
  };
}

/** Create a Router pre-wired with a mock connector and provider. */
function createRouter(memory?: Partial<MemoryManager>): {
  router: Router;
  connector: MockConnector;
} {
  const router = new Router('mock');
  const connector = new MockConnector();
  const provider = new MockProvider();
  provider.setResponse({ content: 'AI response' });

  router.addConnector(connector);
  router.addProvider(provider);

  if (memory) {
    router.setMemory(memory as MemoryManager);
  }

  return { router, connector };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Router /history command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // bare "history" — list sessions
  // -------------------------------------------------------------------------
  describe('bare "history"', () => {
    it('sends session list when memory is available and sessions exist', async () => {
      const sessions = [
        makeSessionSummary({ session_id: 'sess-1', title: 'First chat' }),
        makeSessionSummary({ session_id: 'sess-2', title: 'Second chat', message_count: 3 }),
      ];
      const memory = createMockMemory(sessions);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history'));

      expect(connector.sentMessages).toHaveLength(1);
      const content = connector.sentMessages[0]!.content;
      expect(content).toContain('Conversation History');
      expect(content).toContain('First chat');
      expect(content).toContain('Second chat');
    });

    it('calls listSessions with limit=10, offset=0', async () => {
      const memory = createMockMemory([makeSessionSummary()]);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history'));

      expect(memory.listSessions).toHaveBeenCalledWith(10, 0);
    });

    it('sends "no past sessions" when memory returns empty array', async () => {
      const memory = createMockMemory([]);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('No past sessions');
    });

    it('sends error message when memory is not initialized', async () => {
      const { router, connector } = createRouter(/* no memory */);
      await connector.initialize();

      await router.route(makeHistoryMessage('history'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('not available');
    });

    it('is case-insensitive (HISTORY, History)', async () => {
      const memory = createMockMemory([makeSessionSummary()]);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('HISTORY'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('Conversation History');
    });
  });

  // -------------------------------------------------------------------------
  // "history search <query>"
  // -------------------------------------------------------------------------
  describe('"history search <query>"', () => {
    it('sends matching sessions for a valid search query', async () => {
      const sessions = [makeSessionSummary({ title: 'Authentication discussion' })];
      const memory = createMockMemory(sessions);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history search authentication'));

      expect(memory.searchSessions).toHaveBeenCalledWith('authentication', 10);
      expect(connector.sentMessages).toHaveLength(1);
      const content = connector.sentMessages[0]!.content;
      expect(content).toContain('Conversation History');
      expect(content).toContain('Authentication discussion');
    });

    it('sends "no sessions found" when search returns empty', async () => {
      const memory = createMockMemory([]);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history search xyzzy-no-match'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('No sessions found matching');
    });

    it('sends usage hint when search query is missing', async () => {
      const memory = createMockMemory([]);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history search'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('Usage:');
      expect(connector.sentMessages[0]!.content).toContain('history search');
    });

    it('sends error when memory is not initialized', async () => {
      const { router, connector } = createRouter(/* no memory */);
      await connector.initialize();

      await router.route(makeHistoryMessage('history search authentication'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('not available');
    });

    it('passes multi-word queries correctly', async () => {
      const memory = createMockMemory([]);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history search auth service deploy'));

      expect(memory.searchSessions).toHaveBeenCalledWith('auth service deploy', 10);
    });
  });

  // -------------------------------------------------------------------------
  // "history <session-id>" — show full transcript
  // -------------------------------------------------------------------------
  describe('"history <session-id>"', () => {
    it('sends conversation transcript for a valid session', async () => {
      const entries = [
        makeEntry({
          role: 'user',
          content: 'What is the status?',
          created_at: '2026-01-01T10:00:00.000Z',
        }),
        makeEntry({
          role: 'master',
          content: 'Everything is running fine.',
          created_at: '2026-01-01T10:01:00.000Z',
        }),
      ];
      const memory = createMockMemory([], entries);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history sess-abc'));

      expect(memory.getSessionHistory).toHaveBeenCalledWith('sess-abc', 50);
      expect(connector.sentMessages).toHaveLength(1);
      const content = connector.sentMessages[0]!.content;
      expect(content).toContain('Conversation Transcript');
      expect(content).toContain('What is the status?');
      expect(content).toContain('Everything is running fine.');
    });

    it('sends "no conversation found" when session has no messages', async () => {
      const memory = createMockMemory([], []);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history unknown-session-id'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('No conversation found');
      expect(connector.sentMessages[0]!.content).toContain('unknown-session-id');
    });

    it('sends error when memory is not initialized', async () => {
      const { router, connector } = createRouter(/* no memory */);
      await connector.initialize();

      await router.route(makeHistoryMessage('history some-session-id'));

      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('not available');
    });

    it('uses the correct session ID from the message', async () => {
      const memory = createMockMemory([], [makeEntry()]);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history my-session-uuid-1234'));

      expect(memory.getSessionHistory).toHaveBeenCalledWith('my-session-uuid-1234', 50);
    });
  });

  // -------------------------------------------------------------------------
  // Formatting — session list channel variants
  // -------------------------------------------------------------------------
  describe('session list formatting', () => {
    it('formats as numbered list for "mock" channel (WhatsApp-style)', async () => {
      const sessions = [
        makeSessionSummary({
          session_id: 's1',
          title: 'My project chat',
          message_count: 7,
          last_message_at: '2026-02-15T00:00:00.000Z',
        }),
      ];
      const memory = createMockMemory(sessions);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history'));

      const content = connector.sentMessages[0]!.content;
      // numbered list format: "1. Title — N msgs — YYYY-MM-DD"
      expect(content).toMatch(/1\.\s+My project chat/);
      expect(content).toContain('7 msgs');
      expect(content).toContain('2026-02-15');
    });

    it('uses singular "msg" for sessions with one message', async () => {
      const sessions = [makeSessionSummary({ message_count: 1 })];
      const memory = createMockMemory(sessions);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history'));

      expect(connector.sentMessages[0]!.content).toContain('1 msg');
    });

    it('uses "Untitled" when session has no title', async () => {
      const sessions = [makeSessionSummary({ title: null })];
      const memory = createMockMemory(sessions);
      const { router, connector } = createRouter(memory);
      await connector.initialize();

      await router.route(makeHistoryMessage('history'));

      expect(connector.sentMessages[0]!.content).toContain('Untitled');
    });
  });
});
