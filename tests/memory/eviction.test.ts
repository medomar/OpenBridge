import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { evictOldData } from '../../src/memory/eviction.js';
import { recordMessage } from '../../src/memory/conversation-store.js';
import { storeChunks, markStale } from '../../src/memory/chunk-store.js';
import type { ConversationEntry } from '../../src/memory/index.js';

describe('eviction.ts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  /** Returns an ISO timestamp N days in the past. */
  function daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }

  const makeConv = (overrides: Partial<ConversationEntry> = {}): ConversationEntry => ({
    session_id: 'sess-evict',
    role: 'user',
    content: 'some message content',
    ...overrides,
  });

  describe('conversation eviction', () => {
    it('deletes conversations older than conversationRetentionDays', () => {
      recordMessage(db, makeConv({ content: 'very old message', created_at: daysAgo(95) }));
      recordMessage(db, makeConv({ content: 'recent message', created_at: daysAgo(5) }));

      evictOldData(db, { conversationRetentionDays: 90 });

      const remaining = db.prepare('SELECT content FROM conversations').all() as {
        content: string;
      }[];
      expect(remaining).toHaveLength(1);
      expect(remaining[0].content).toBe('recent message');
    });

    it('keeps conversations within the retention period', () => {
      recordMessage(db, makeConv({ content: 'recent message', created_at: daysAgo(10) }));

      evictOldData(db, { conversationRetentionDays: 90 });

      const count = (db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number })
        .c;
      expect(count).toBe(1);
    });

    it('uses 90 days as default retention', () => {
      recordMessage(db, makeConv({ content: 'old message', created_at: daysAgo(91) }));
      recordMessage(db, makeConv({ content: 'fresh message', created_at: daysAgo(1) }));

      evictOldData(db); // default options

      const count = (db.prepare('SELECT COUNT(*) as c FROM conversations').get() as { c: number })
        .c;
      expect(count).toBe(1);
    });
  });

  describe('task eviction', () => {
    it('deletes completed tasks older than taskRetentionDays', () => {
      db.prepare(
        `INSERT INTO tasks (id, type, status, created_at, completed_at)
         VALUES ('old-task', 'worker', 'completed', ?, ?)`,
      ).run(daysAgo(200), daysAgo(200));

      db.prepare(
        `INSERT INTO tasks (id, type, status, created_at, completed_at)
         VALUES ('new-task', 'worker', 'completed', ?, ?)`,
      ).run(daysAgo(10), daysAgo(10));

      evictOldData(db, { taskRetentionDays: 180 });

      const remaining = db.prepare('SELECT id FROM tasks').all() as { id: string }[];
      expect(remaining.map((r) => r.id)).toEqual(['new-task']);
    });

    it('does not delete running tasks even if old', () => {
      db.prepare(
        `INSERT INTO tasks (id, type, status, created_at)
         VALUES ('running-old', 'worker', 'running', ?)`,
      ).run(daysAgo(200));

      evictOldData(db, { taskRetentionDays: 180 });

      const row = db.prepare("SELECT id FROM tasks WHERE id = 'running-old'").get();
      expect(row).toBeDefined();
    });

    it('keeps recently completed tasks', () => {
      db.prepare(
        `INSERT INTO tasks (id, type, status, created_at, completed_at)
         VALUES ('recent-task', 'worker', 'completed', ?, ?)`,
      ).run(daysAgo(5), daysAgo(5));

      evictOldData(db, { taskRetentionDays: 180 });

      const row = db.prepare("SELECT id FROM tasks WHERE id = 'recent-task'").get();
      expect(row).toBeDefined();
    });
  });

  describe('stale chunk eviction', () => {
    it('deletes stale chunks older than staleChunkRetentionDays', () => {
      storeChunks(db, [
        { scope: 'old-stale', category: 'structure', content: 'old stale content' },
      ]);
      markStale(db, ['old-stale']);
      // Manually backdate updated_at
      db.prepare('UPDATE context_chunks SET updated_at = ? WHERE scope = ?').run(
        daysAgo(35),
        'old-stale',
      );

      storeChunks(db, [
        { scope: 'fresh', category: 'structure', content: 'fresh non-stale content' },
      ]);

      evictOldData(db, { staleChunkRetentionDays: 30 });

      const remaining = db.prepare('SELECT scope FROM context_chunks').all() as { scope: string }[];
      expect(remaining.map((r) => r.scope)).toEqual(['fresh']);
    });

    it('keeps recently stale chunks', () => {
      storeChunks(db, [
        { scope: 'new-stale', category: 'patterns', content: 'newly stale content' },
      ]);
      markStale(db, ['new-stale']); // updated_at is now

      evictOldData(db, { staleChunkRetentionDays: 30 });

      const row = db.prepare("SELECT scope FROM context_chunks WHERE scope = 'new-stale'").get();
      expect(row).toBeDefined();
    });

    it('keeps non-stale chunks regardless of age', () => {
      storeChunks(db, [{ scope: 'very-old-fresh', category: 'api', content: 'old but not stale' }]);
      db.prepare('UPDATE context_chunks SET updated_at = ? WHERE scope = ?').run(
        daysAgo(365),
        'very-old-fresh',
      );

      evictOldData(db, { staleChunkRetentionDays: 30 });

      const row = db
        .prepare("SELECT scope FROM context_chunks WHERE scope = 'very-old-fresh'")
        .get();
      expect(row).toBeDefined();
    });
  });

  describe('agent_activity eviction', () => {
    it('does not throw when agent_activity table does not exist', () => {
      expect(() => evictOldData(db, { agentActivityRetentionHours: 24 })).not.toThrow();
    });
  });

  describe('combined eviction', () => {
    it('runs all eviction policies in one call without error', () => {
      recordMessage(db, makeConv({ created_at: daysAgo(100) }));
      storeChunks(db, [{ scope: 'stale-s', category: 'config', content: 'stale' }]);
      markStale(db, ['stale-s']);
      db.prepare('UPDATE context_chunks SET updated_at = ?').run(daysAgo(50));

      expect(() => evictOldData(db)).not.toThrow();
    });
  });
});
