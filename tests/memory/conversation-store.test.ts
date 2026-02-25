import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  recordMessage,
  findRelevantHistory,
  getSessionHistory,
  deleteOldConversations,
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
});
