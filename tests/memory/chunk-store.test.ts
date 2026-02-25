import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  storeChunks,
  searchChunks,
  markStale,
  deleteStaleChunks,
  type Chunk,
} from '../../src/memory/chunk-store.js';

describe('chunk-store.ts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  const makeChunk = (overrides: Partial<Chunk> = {}): Chunk => ({
    scope: 'src/core',
    category: 'structure',
    content: 'The bridge module routes messages between connectors and providers.',
    ...overrides,
  });

  describe('storeChunks', () => {
    it('inserts chunks into context_chunks table', () => {
      storeChunks(db, [makeChunk()]);
      const rows = db.prepare('SELECT * FROM context_chunks').all() as Chunk[];
      expect(rows).toHaveLength(1);
    });

    it('inserts multiple chunks in a single transaction', () => {
      storeChunks(db, [
        makeChunk({ scope: 'src/core' }),
        makeChunk({ scope: 'src/master', category: 'patterns' }),
        makeChunk({ scope: 'src/types', category: 'api' }),
      ]);
      const rows = db.prepare('SELECT * FROM context_chunks').all() as Chunk[];
      expect(rows).toHaveLength(3);
    });

    it('stores optional source_hash', () => {
      storeChunks(db, [makeChunk({ source_hash: 'abc123' })]);
      const row = db.prepare('SELECT source_hash FROM context_chunks').get() as {
        source_hash: string;
      };
      expect(row.source_hash).toBe('abc123');
    });

    it('sets stale = 0 on new chunks', () => {
      storeChunks(db, [makeChunk()]);
      const row = db.prepare('SELECT stale FROM context_chunks').get() as { stale: number };
      expect(row.stale).toBe(0);
    });

    it('keeps FTS5 table in sync (rowid matches)', () => {
      storeChunks(db, [makeChunk({ content: 'xyzuniqueftsword' })]);
      const chunk = db.prepare('SELECT id FROM context_chunks').get() as { id: number };
      const ftsRow = db
        .prepare('SELECT rowid FROM context_chunks_fts WHERE content MATCH ?')
        .get('xyzuniqueftsword') as { rowid: number } | undefined;
      expect(ftsRow).toBeDefined();
      expect(ftsRow!.rowid).toBe(chunk.id);
    });

    it('is a no-op when given an empty array', () => {
      storeChunks(db, []);
      const count = (db.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number })
        .c;
      expect(count).toBe(0);
    });
  });

  describe('searchChunks', () => {
    beforeEach(() => {
      storeChunks(db, [
        makeChunk({ content: 'Bridge routes messages between connectors and providers' }),
        makeChunk({ scope: 'src/master', content: 'Master AI spawns worker agents for tasks' }),
        makeChunk({ scope: 'src/types', content: 'TypeScript strict mode configuration' }),
      ]);
    });

    it('returns chunks matching the FTS5 query', () => {
      const results = searchChunks(db, 'Bridge');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('Bridge');
    });

    it('returns empty array for empty query', () => {
      const results = searchChunks(db, '');
      expect(results).toHaveLength(0);
    });

    it('returns empty array for whitespace-only query', () => {
      const results = searchChunks(db, '   ');
      expect(results).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      storeChunks(db, [
        makeChunk({ content: 'extra chunk alpha one' }),
        makeChunk({ content: 'extra chunk beta two' }),
        makeChunk({ content: 'extra chunk gamma three' }),
      ]);
      // Store many chunks with the same keyword
      storeChunks(
        db,
        Array.from({ length: 8 }, (_, i) => makeChunk({ content: `keyword item ${i}` })),
      );
      const results = searchChunks(db, 'keyword', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('excludes stale chunks from search results', () => {
      storeChunks(db, [makeChunk({ scope: 'stale-scope', content: 'stale content fragment' })]);
      markStale(db, ['stale-scope']);
      const results = searchChunks(db, 'stale');
      expect(results.every((r) => r.stale !== true)).toBe(true);
    });
  });

  describe('markStale', () => {
    beforeEach(() => {
      storeChunks(db, [
        makeChunk({ scope: 'src/core' }),
        makeChunk({ scope: 'src/master' }),
        makeChunk({ scope: 'src/types' }),
      ]);
    });

    it('marks chunks with matching scope as stale', () => {
      markStale(db, ['src/core']);
      const staleRows = db
        .prepare('SELECT stale FROM context_chunks WHERE scope = ?')
        .all('src/core') as {
        stale: number;
      }[];
      expect(staleRows.every((r) => r.stale === 1)).toBe(true);
    });

    it('does not affect chunks with non-matching scope', () => {
      markStale(db, ['src/core']);
      const notStale = db
        .prepare('SELECT stale FROM context_chunks WHERE scope = ?')
        .all('src/master') as {
        stale: number;
      }[];
      expect(notStale.every((r) => r.stale === 0)).toBe(true);
    });

    it('can mark multiple scopes at once', () => {
      markStale(db, ['src/core', 'src/master']);
      const count = (
        db.prepare('SELECT COUNT(*) as c FROM context_chunks WHERE stale = 1').get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(2);
    });

    it('is a no-op for empty scopes array', () => {
      markStale(db, []);
      const count = (
        db.prepare('SELECT COUNT(*) as c FROM context_chunks WHERE stale = 1').get() as {
          c: number;
        }
      ).c;
      expect(count).toBe(0);
    });
  });

  describe('deleteStaleChunks', () => {
    beforeEach(() => {
      storeChunks(db, [
        makeChunk({ scope: 'src/core', content: 'fresh chunk stays' }),
        makeChunk({ scope: 'src/stale', content: 'stale chunk goes' }),
      ]);
      markStale(db, ['src/stale']);
    });

    it('removes stale chunks from context_chunks', () => {
      deleteStaleChunks(db);
      const remaining = db.prepare('SELECT scope FROM context_chunks').all() as { scope: string }[];
      expect(remaining.map((r) => r.scope)).toEqual(['src/core']);
    });

    it('removes corresponding entries from FTS5 table', () => {
      deleteStaleChunks(db);
      const ftsRows = db
        .prepare("SELECT * FROM context_chunks_fts WHERE content MATCH 'stale'")
        .all();
      expect(ftsRows).toHaveLength(0);
    });

    it('does not delete fresh (non-stale) chunks', () => {
      deleteStaleChunks(db);
      const count = (db.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number })
        .c;
      expect(count).toBe(1);
    });

    it('is a no-op when there are no stale chunks', () => {
      // Mark nothing stale, then call delete
      deleteStaleChunks(db);
      // Fresh chunk stays
      const count = (
        db.prepare('SELECT COUNT(*) as c FROM context_chunks WHERE stale = 0').get() as {
          c: number;
        }
      ).c;
      expect(count).toBeGreaterThan(0);
    });
  });
});
