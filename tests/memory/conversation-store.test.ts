import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  recordMessage,
  findRelevantHistory,
  getSessionHistory,
  getSessionHistoryForSender,
  deleteOldConversations,
  listSessions,
  searchSessions,
} from '../../src/memory/conversation-store.js';
import type { ConversationEntry } from '../../src/memory/index.js';

describe('conversation-store.ts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  const makeEntry = (overrides: Partial<ConversationEntry> = {}): ConversationEntry => ({
    session_id: 'sess-abc',
    role: 'user',
    content: 'Hello, how is the project going?',
    channel: 'whatsapp',
    user_id: '+1234567890',
    ...overrides,
  });

  describe('recordMessage', () => {
    it('inserts a message into conversations table', () => {
      recordMessage(db, makeEntry());
      const rows = db.prepare('SELECT * FROM conversations').all() as ConversationEntry[];
      expect(rows).toHaveLength(1);
    });

    it('keeps conversations_fts in sync', () => {
      recordMessage(db, makeEntry({ content: 'unique phrase for FTS search test' }));
      const conv = db.prepare('SELECT id FROM conversations').get() as { id: number };
      const ftsRow = db
        .prepare("SELECT rowid FROM conversations_fts WHERE content MATCH 'unique'")
        .get() as { rowid: number } | undefined;
      expect(ftsRow).toBeDefined();
      expect(ftsRow!.rowid).toBe(conv.id);
    });

    it('stores optional fields as null when not provided', () => {
      recordMessage(db, { session_id: 'sess-min', role: 'master', content: 'reply' });
      const row = db.prepare('SELECT channel, user_id FROM conversations').get() as {
        channel: string | null;
        user_id: string | null;
      };
      expect(row.channel).toBeNull();
      expect(row.user_id).toBeNull();
    });

    it('uses provided created_at timestamp', () => {
      const ts = '2026-01-15T10:00:00.000Z';
      recordMessage(db, makeEntry({ created_at: ts }));
      const row = db.prepare('SELECT created_at FROM conversations').get() as {
        created_at: string;
      };
      expect(row.created_at).toBe(ts);
    });

    it('auto-fills created_at when not provided', () => {
      recordMessage(db, { session_id: 'sess-auto', role: 'user', content: 'hi' });
      const row = db.prepare('SELECT created_at FROM conversations').get() as {
        created_at: string;
      };
      expect(row.created_at).toBeTruthy();
      expect(new Date(row.created_at).getTime()).toBeGreaterThan(0);
    });
  });

  describe('findRelevantHistory', () => {
    beforeEach(() => {
      recordMessage(db, makeEntry({ content: 'Deploy the authentication feature' }));
      recordMessage(db, makeEntry({ content: 'Run the test suite before merging' }));
      recordMessage(
        db,
        makeEntry({ role: 'master', content: 'Authentication deployment complete' }),
      );
    });

    it('returns entries matching the FTS5 query', () => {
      const results = findRelevantHistory(db, 'authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.content.toLowerCase().includes('authentication'))).toBe(true);
    });

    it('returns empty array for empty query', () => {
      const results = findRelevantHistory(db, '');
      expect(results).toHaveLength(0);
    });

    it('returns empty array for whitespace-only query', () => {
      const results = findRelevantHistory(db, '   ');
      expect(results).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      // Add many messages with the same keyword
      for (let i = 0; i < 8; i++) {
        recordMessage(db, makeEntry({ content: `keyword appears here item ${i}` }));
      }
      const results = findRelevantHistory(db, 'keyword', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('returns results ordered by created_at DESC', () => {
      recordMessage(
        db,
        makeEntry({ content: 'oldest search result', created_at: '2026-01-01T00:00:00.000Z' }),
      );
      recordMessage(
        db,
        makeEntry({ content: 'newest search result', created_at: '2026-01-03T00:00:00.000Z' }),
      );
      const results = findRelevantHistory(db, 'search result');
      expect(results[0].content).toBe('newest search result');
    });
  });

  describe('getSessionHistory', () => {
    it('returns messages for a specific session in chronological order', () => {
      recordMessage(
        db,
        makeEntry({
          session_id: 'sess-A',
          content: 'first',
          created_at: '2026-01-01T00:00:00.000Z',
        }),
      );
      recordMessage(
        db,
        makeEntry({
          session_id: 'sess-A',
          content: 'second',
          created_at: '2026-01-02T00:00:00.000Z',
        }),
      );
      recordMessage(db, makeEntry({ session_id: 'sess-B', content: 'other session' }));
      const history = getSessionHistory(db, 'sess-A');
      expect(history).toHaveLength(2);
      expect(history[0].content).toBe('first');
      expect(history[1].content).toBe('second');
    });

    it('returns empty array when session has no messages', () => {
      const history = getSessionHistory(db, 'nonexistent-session');
      expect(history).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        recordMessage(db, makeEntry({ session_id: 'sess-limit', content: `message ${i}` }));
      }
      const history = getSessionHistory(db, 'sess-limit', 5);
      expect(history).toHaveLength(5);
    });
  });

  describe('getSessionHistoryForSender', () => {
    it('returns only messages matching both sessionId and sender', () => {
      // 5 messages from sender-A
      for (let i = 0; i < 5; i++) {
        recordMessage(
          db,
          makeEntry({
            session_id: 'shared-sess',
            user_id: 'sender-A',
            content: `msg-A-${i}`,
            created_at: `2026-01-01T0${i}:00:00.000Z`,
          }),
        );
      }
      // 5 messages from sender-B in the same session
      for (let i = 0; i < 5; i++) {
        recordMessage(
          db,
          makeEntry({
            session_id: 'shared-sess',
            user_id: 'sender-B',
            content: `msg-B-${i}`,
            created_at: `2026-01-01T1${i}:00:00.000Z`,
          }),
        );
      }

      const historyA = getSessionHistoryForSender(db, 'shared-sess', 'sender-A');
      expect(historyA).toHaveLength(5);
      expect(historyA.every((e) => e.user_id === 'sender-A')).toBe(true);
      expect(historyA.every((e) => e.content.startsWith('msg-A-'))).toBe(true);
    });

    it('does not return messages from other senders in the same session', () => {
      recordMessage(db, makeEntry({ session_id: 'iso-sess', user_id: 'alice', content: 'hi' }));
      recordMessage(db, makeEntry({ session_id: 'iso-sess', user_id: 'bob', content: 'hello' }));

      const aliceHistory = getSessionHistoryForSender(db, 'iso-sess', 'alice');
      expect(aliceHistory).toHaveLength(1);
      expect(aliceHistory[0]!.content).toBe('hi');

      const bobHistory = getSessionHistoryForSender(db, 'iso-sess', 'bob');
      expect(bobHistory).toHaveLength(1);
      expect(bobHistory[0]!.content).toBe('hello');
    });

    it('returns messages in chronological order (oldest first)', () => {
      recordMessage(
        db,
        makeEntry({
          session_id: 'order-sess',
          user_id: 'user-x',
          content: 'first',
          created_at: '2026-01-01T08:00:00.000Z',
        }),
      );
      recordMessage(
        db,
        makeEntry({
          session_id: 'order-sess',
          user_id: 'user-x',
          content: 'second',
          created_at: '2026-01-01T09:00:00.000Z',
        }),
      );
      recordMessage(
        db,
        makeEntry({
          session_id: 'order-sess',
          user_id: 'user-x',
          content: 'third',
          created_at: '2026-01-01T10:00:00.000Z',
        }),
      );

      const history = getSessionHistoryForSender(db, 'order-sess', 'user-x');
      expect(history[0]!.content).toBe('first');
      expect(history[1]!.content).toBe('second');
      expect(history[2]!.content).toBe('third');
    });

    it('returns empty array when no messages match the sender', () => {
      recordMessage(db, makeEntry({ session_id: 'empty-sess', user_id: 'alice', content: 'hi' }));
      const history = getSessionHistoryForSender(db, 'empty-sess', 'unknown-sender');
      expect(history).toHaveLength(0);
    });

    it('returns empty array when session does not exist', () => {
      const history = getSessionHistoryForSender(db, 'nonexistent-session', 'sender-X');
      expect(history).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        recordMessage(
          db,
          makeEntry({
            session_id: 'limit-sess',
            user_id: 'user-lim',
            content: `message ${i}`,
          }),
        );
      }
      const history = getSessionHistoryForSender(db, 'limit-sess', 'user-lim', 4);
      expect(history).toHaveLength(4);
    });
  });

  describe('deleteOldConversations', () => {
    it('deletes conversations older than the cutoff date', () => {
      const old = new Date('2026-01-01T00:00:00.000Z').toISOString();
      const recent = new Date('2026-03-01T00:00:00.000Z').toISOString();
      recordMessage(db, makeEntry({ content: 'old message', created_at: old }));
      recordMessage(db, makeEntry({ content: 'recent message', created_at: recent }));

      const cutoff = new Date('2026-02-01T00:00:00.000Z');
      deleteOldConversations(db, cutoff);

      const remaining = db.prepare('SELECT content FROM conversations').all() as {
        content: string;
      }[];
      expect(remaining).toHaveLength(1);
      expect(remaining[0].content).toBe('recent message');
    });

    it('removes corresponding FTS5 entries', () => {
      const old = new Date('2025-06-01T00:00:00.000Z').toISOString();
      recordMessage(db, makeEntry({ content: 'ancient FTS content to remove', created_at: old }));

      deleteOldConversations(db, new Date('2026-01-01T00:00:00.000Z'));

      const fts = db.prepare("SELECT * FROM conversations_fts WHERE content MATCH 'ancient'").all();
      expect(fts).toHaveLength(0);
    });

    it('is a no-op when no conversations are older than the cutoff', () => {
      recordMessage(
        db,
        makeEntry({ content: 'fresh message', created_at: new Date().toISOString() }),
      );
      const pastCutoff = new Date('2020-01-01T00:00:00.000Z');
      deleteOldConversations(db, pastCutoff);
      const count = (db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number })
        .c;
      expect(count).toBe(1);
    });
  });

  describe('listSessions', () => {
    it('returns empty array when no messages', () => {
      expect(listSessions(db)).toHaveLength(0);
    });

    it('returns a session summary for each distinct session_id', () => {
      recordMessage(db, makeEntry({ session_id: 'sess-1', content: 'hello' }));
      recordMessage(db, makeEntry({ session_id: 'sess-2', content: 'world' }));
      const sessions = listSessions(db);
      expect(sessions).toHaveLength(2);
      expect(sessions.map((s) => s.session_id).sort()).toEqual(['sess-1', 'sess-2']);
    });

    it('aggregates message_count correctly', () => {
      recordMessage(db, makeEntry({ session_id: 'sess-count', content: 'msg1' }));
      recordMessage(db, makeEntry({ session_id: 'sess-count', content: 'msg2' }));
      recordMessage(db, makeEntry({ session_id: 'sess-count', content: 'msg3' }));
      const [session] = listSessions(db);
      expect(session).toBeDefined();
      expect(session!.message_count).toBe(3);
    });

    it('orders sessions by most recent activity (last_message_at DESC)', () => {
      recordMessage(
        db,
        makeEntry({
          session_id: 'old-sess',
          content: 'old',
          created_at: '2026-01-01T00:00:00.000Z',
        }),
      );
      recordMessage(
        db,
        makeEntry({
          session_id: 'new-sess',
          content: 'new',
          created_at: '2026-03-01T00:00:00.000Z',
        }),
      );
      const sessions = listSessions(db);
      expect(sessions[0]!.session_id).toBe('new-sess');
      expect(sessions[1]!.session_id).toBe('old-sess');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        recordMessage(db, makeEntry({ session_id: `sess-${i}`, content: `message ${i}` }));
      }
      const sessions = listSessions(db, 3);
      expect(sessions).toHaveLength(3);
    });

    it('respects offset parameter', () => {
      for (let i = 0; i < 4; i++) {
        recordMessage(
          db,
          makeEntry({
            session_id: `sess-${i}`,
            content: `message ${i}`,
            created_at: `2026-0${i + 1}-01T00:00:00.000Z`,
          }),
        );
      }
      const all = listSessions(db, 4, 0);
      const paged = listSessions(db, 4, 2);
      expect(paged).toHaveLength(2);
      expect(paged[0]!.session_id).toBe(all[2]!.session_id);
    });

    it('sets title from the first user message of each session', () => {
      recordMessage(
        db,
        makeEntry({
          session_id: 'titled-sess',
          role: 'user',
          content: 'User asked a question here',
        }),
      );
      recordMessage(
        db,
        makeEntry({ session_id: 'titled-sess', role: 'master', content: 'AI replied' }),
      );
      const [session] = listSessions(db);
      expect(session!.title).toBe('User asked a question here');
    });

    it('truncates title to 50 characters', () => {
      const longContent = 'A'.repeat(80);
      recordMessage(
        db,
        makeEntry({ session_id: 'long-title-sess', role: 'user', content: longContent }),
      );
      const [session] = listSessions(db);
      expect(session!.title).toHaveLength(50);
    });

    it('returns correct channel and user_id', () => {
      recordMessage(
        db,
        makeEntry({
          session_id: 'meta-sess',
          channel: 'telegram',
          user_id: '+9876543210',
          content: 'test',
        }),
      );
      const [session] = listSessions(db);
      expect(session!.channel).toBe('telegram');
      expect(session!.user_id).toBe('+9876543210');
    });

    it('returns correct first_message_at and last_message_at', () => {
      recordMessage(
        db,
        makeEntry({
          session_id: 'time-sess',
          content: 'first',
          created_at: '2026-01-01T08:00:00.000Z',
        }),
      );
      recordMessage(
        db,
        makeEntry({
          session_id: 'time-sess',
          content: 'last',
          created_at: '2026-01-01T20:00:00.000Z',
        }),
      );
      const [session] = listSessions(db);
      expect(session!.first_message_at).toBe('2026-01-01T08:00:00.000Z');
      expect(session!.last_message_at).toBe('2026-01-01T20:00:00.000Z');
    });
  });

  describe('searchSessions', () => {
    it('returns empty array for empty query', () => {
      recordMessage(db, makeEntry({ content: 'some content' }));
      expect(searchSessions(db, '')).toHaveLength(0);
    });

    it('returns empty array for whitespace-only query', () => {
      recordMessage(db, makeEntry({ content: 'some content' }));
      expect(searchSessions(db, '   ')).toHaveLength(0);
    });

    it('returns sessions whose messages match the query', () => {
      recordMessage(
        db,
        makeEntry({ session_id: 'match-sess', content: 'Deploy the authentication service' }),
      );
      recordMessage(
        db,
        makeEntry({ session_id: 'no-match-sess', content: 'Unrelated database migration' }),
      );
      const results = searchSessions(db, 'authentication');
      expect(results).toHaveLength(1);
      expect(results[0]!.session_id).toBe('match-sess');
    });

    it('returns empty array when no sessions match', () => {
      recordMessage(db, makeEntry({ session_id: 'some-sess', content: 'Unrelated content' }));
      const results = searchSessions(db, 'xyzzy-no-match');
      expect(results).toHaveLength(0);
    });

    it('groups results by session — multiple matching messages in same session count as one', () => {
      recordMessage(
        db,
        makeEntry({ session_id: 'multi-match', content: 'First mention of authentication' }),
      );
      recordMessage(
        db,
        makeEntry({ session_id: 'multi-match', content: 'Second mention of authentication flow' }),
      );
      recordMessage(
        db,
        makeEntry({ session_id: 'other-sess', content: 'Single authentication reference' }),
      );
      const results = searchSessions(db, 'authentication');
      // Both sessions match — multi-match should rank first (2 matches)
      expect(results).toHaveLength(2);
      expect(results[0]!.session_id).toBe('multi-match');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        recordMessage(
          db,
          makeEntry({ session_id: `search-sess-${i}`, content: 'matching keyword here' }),
        );
      }
      const results = searchSessions(db, 'keyword', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('returns correct session metadata (message_count, channel, user_id)', () => {
      recordMessage(
        db,
        makeEntry({
          session_id: 'full-meta-sess',
          content: 'unique-search-term',
          channel: 'discord',
          user_id: 'user123',
        }),
      );
      recordMessage(
        db,
        makeEntry({ session_id: 'full-meta-sess', content: 'another message', channel: 'discord' }),
      );
      const results = searchSessions(db, 'unique-search-term');
      expect(results).toHaveLength(1);
      expect(results[0]!.message_count).toBe(2);
      expect(results[0]!.channel).toBe('discord');
      expect(results[0]!.user_id).toBe('user123');
    });
  });
});
