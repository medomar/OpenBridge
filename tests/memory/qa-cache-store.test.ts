import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { QACacheStore } from '../../src/memory/qa-cache-store.js';

describe('QACacheStore', () => {
  let db: Database.Database;
  let store: QACacheStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new QACacheStore(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  // ---------------------------------------------------------------------------
  // store()
  // ---------------------------------------------------------------------------

  describe('store()', () => {
    it('inserts a Q&A entry and returns a positive id', () => {
      const id = store.store({
        question: 'How does the router work?',
        answer: 'The router handles message routing.',
        confidence: 0.9,
      });
      expect(id).toBeGreaterThan(0);
    });

    it('count increases after each store', () => {
      expect(store.count()).toBe(0);
      store.store({ question: 'Q1', answer: 'A1', confidence: 0.8 });
      store.store({ question: 'Q2', answer: 'A2', confidence: 0.7 });
      expect(store.count()).toBe(2);
    });

    it('stores file_paths as JSON and retrieves them correctly', () => {
      const id = store.store({
        question: 'What is auth?',
        answer: 'Auth validates phone numbers.',
        confidence: 0.85,
        file_paths: ['src/core/auth.ts', 'src/types/config.ts'],
      });
      const entry = store.getById(id);
      expect(entry?.file_paths).toEqual(['src/core/auth.ts', 'src/types/config.ts']);
    });

    it('stores entry without file_paths (undefined)', () => {
      const id = store.store({ question: 'Q', answer: 'A', confidence: 0.75 });
      const entry = store.getById(id);
      expect(entry?.file_paths).toBeUndefined();
    });

    it('initialises access_count to 0', () => {
      const id = store.store({ question: 'Q', answer: 'A', confidence: 0.8 });
      const entry = store.getById(id);
      expect(entry?.access_count).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // findSimilar()
  // ---------------------------------------------------------------------------

  describe('findSimilar()', () => {
    it('returns matching entries for a similar question', () => {
      store.store({
        question: 'How does the router work',
        answer: 'The router handles message routing.',
        confidence: 0.9,
      });
      const results = store.findSimilar('router');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].answer).toBe('The router handles message routing.');
    });

    it('returns empty array for empty question string', () => {
      store.store({ question: 'How does auth work', answer: 'Auth validates.', confidence: 0.8 });
      const results = store.findSimilar('');
      expect(results).toEqual([]);
    });

    it('returns empty array when no entries exist', () => {
      const results = store.findSimilar('router message handling');
      expect(results).toEqual([]);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 6; i++) {
        store.store({
          question: `router question ${i}`,
          answer: `answer ${i}`,
          confidence: 0.8,
        });
      }
      const results = store.findSimilar('router question', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returns entries with all expected fields populated', () => {
      const id = store.store({
        question: 'auth module question',
        answer: 'Auth answer.',
        confidence: 0.85,
        file_paths: ['src/core/auth.ts'],
      });
      const results = store.findSimilar('auth module');
      const found = results.find((e) => e.id === id);
      expect(found).toBeDefined();
      expect(found?.question).toBe('auth module question');
      expect(found?.confidence).toBe(0.85);
      expect(found?.file_paths).toEqual(['src/core/auth.ts']);
    });
  });

  // ---------------------------------------------------------------------------
  // incrementAccess()
  // ---------------------------------------------------------------------------

  describe('incrementAccess()', () => {
    it('increments access_count by 1', () => {
      const id = store.store({ question: 'Q', answer: 'A', confidence: 0.8 });
      expect(store.getById(id)?.access_count).toBe(0);
      store.incrementAccess(id);
      expect(store.getById(id)?.access_count).toBe(1);
    });

    it('accumulates on repeated calls', () => {
      const id = store.store({ question: 'Q', answer: 'A', confidence: 0.8 });
      store.incrementAccess(id);
      store.incrementAccess(id);
      store.incrementAccess(id);
      expect(store.getById(id)?.access_count).toBe(3);
    });

    it('is a no-op for non-existent id (does not throw)', () => {
      expect(() => store.incrementAccess(99999)).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // evictStale()
  // ---------------------------------------------------------------------------

  describe('evictStale()', () => {
    it('removes entries older than maxAge and returns the evicted count', () => {
      // Insert a stale entry directly with an old created_at
      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(); // 8 days ago
      db.prepare(
        `INSERT INTO qa_cache (question, answer, confidence, file_paths, created_at, accessed_at, access_count)
         VALUES (?, ?, ?, NULL, ?, ?, 0)`,
      ).run('old question stale', 'old answer', 0.8, oldDate, oldDate);
      const staleId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
      db.prepare(`INSERT INTO qa_cache_fts (rowid, question) VALUES (?, ?)`).run(
        staleId,
        'old question stale',
      );

      // Insert a fresh entry via the store
      store.store({ question: 'fresh question recent', answer: 'fresh answer', confidence: 0.9 });

      expect(store.count()).toBe(2);

      const evicted = store.evictStale(7 * 24 * 60 * 60 * 1000); // 7-day threshold
      expect(evicted).toBe(1);
      expect(store.count()).toBe(1);
    });

    it('keeps fresh entries intact after eviction', () => {
      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare(
        `INSERT INTO qa_cache (question, answer, confidence, file_paths, created_at, accessed_at, access_count)
         VALUES (?, ?, ?, NULL, ?, ?, 0)`,
      ).run('stale entry only', 'old', 0.8, oldDate, oldDate);
      const staleId = (db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number }).id;
      db.prepare(`INSERT INTO qa_cache_fts (rowid, question) VALUES (?, ?)`).run(
        staleId,
        'stale entry only',
      );

      const freshId = store.store({
        question: 'fresh stays alive',
        answer: 'fresh answer',
        confidence: 0.9,
      });

      store.evictStale(7 * 24 * 60 * 60 * 1000);

      expect(store.getById(freshId)).not.toBeNull();
      expect(store.count()).toBe(1);
    });

    it('returns 0 when no entries are stale', () => {
      store.store({ question: 'recent Q', answer: 'recent A', confidence: 0.9 });
      const evicted = store.evictStale(7 * 24 * 60 * 60 * 1000);
      expect(evicted).toBe(0);
    });

    it('returns 0 when store is empty', () => {
      const evicted = store.evictStale(7 * 24 * 60 * 60 * 1000);
      expect(evicted).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getById()
  // ---------------------------------------------------------------------------

  describe('getById()', () => {
    it('returns null for non-existent id', () => {
      expect(store.getById(99999)).toBeNull();
    });

    it('returns the entry for an existing id', () => {
      const id = store.store({
        question: 'test question',
        answer: 'test answer',
        confidence: 0.75,
      });
      const entry = store.getById(id);
      expect(entry).not.toBeNull();
      expect(entry?.question).toBe('test question');
      expect(entry?.answer).toBe('test answer');
      expect(entry?.confidence).toBe(0.75);
    });
  });

  // ---------------------------------------------------------------------------
  // count()
  // ---------------------------------------------------------------------------

  describe('count()', () => {
    it('returns 0 for empty store', () => {
      expect(store.count()).toBe(0);
    });

    it('returns correct count after multiple stores', () => {
      store.store({ question: 'Q1', answer: 'A1', confidence: 0.8 });
      store.store({ question: 'Q2', answer: 'A2', confidence: 0.7 });
      store.store({ question: 'Q3', answer: 'A3', confidence: 0.6 });
      expect(store.count()).toBe(3);
    });
  });
});
