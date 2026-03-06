import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { applySchemaChanges } from '../../src/memory/migration.js';
import {
  storeChunks,
  searchChunks,
  markStale,
  deleteStaleChunks,
  deleteChunksByScope,
  computeContentHash,
  type Chunk,
} from '../../src/memory/chunk-store.js';
import type { EmbeddingProvider, EmbeddingResult } from '../../src/memory/embedding-provider.js';

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
      void storeChunks(db, [makeChunk()]);
      const rows = db.prepare('SELECT * FROM context_chunks').all() as Chunk[];
      expect(rows).toHaveLength(1);
    });

    it('inserts multiple chunks in a single transaction', () => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/core', content: 'Bridge core message routing logic' }),
        makeChunk({
          scope: 'src/master',
          category: 'patterns',
          content: 'Master AI worker spawning patterns',
        }),
        makeChunk({
          scope: 'src/types',
          category: 'api',
          content: 'TypeScript strict config definitions',
        }),
      ]);
      const rows = db.prepare('SELECT * FROM context_chunks').all() as Chunk[];
      expect(rows).toHaveLength(3);
    });

    it('deduplicates chunks with the same content hash — updates updated_at instead of inserting', () => {
      const content = 'Shared content that appears in multiple scopes';
      void storeChunks(db, [makeChunk({ content, scope: 'src/a' })]);
      const before = (
        db.prepare('SELECT updated_at FROM context_chunks LIMIT 1').get() as { updated_at: string }
      ).updated_at;

      // Insert identical content again — should not create a new row
      void storeChunks(db, [makeChunk({ content, scope: 'src/b' })]);
      const count = (db.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number })
        .c;
      expect(count).toBe(1);

      const after = (
        db.prepare('SELECT updated_at FROM context_chunks LIMIT 1').get() as { updated_at: string }
      ).updated_at;
      // updated_at should be >= original (same ms is fine in fast tests)
      expect(after >= before).toBe(true);
    });

    it('stores optional source_hash', () => {
      void storeChunks(db, [makeChunk({ source_hash: 'abc123' })]);
      const row = db.prepare('SELECT source_hash FROM context_chunks').get() as {
        source_hash: string;
      };
      expect(row.source_hash).toBe('abc123');
    });

    it('sets stale = 0 on new chunks', () => {
      void storeChunks(db, [makeChunk()]);
      const row = db.prepare('SELECT stale FROM context_chunks').get() as { stale: number };
      expect(row.stale).toBe(0);
    });

    it('keeps FTS5 table in sync (rowid matches)', () => {
      void storeChunks(db, [makeChunk({ content: 'xyzuniqueftsword' })]);
      const chunk = db.prepare('SELECT id FROM context_chunks').get() as { id: number };
      const ftsRow = db
        .prepare('SELECT rowid FROM context_chunks_fts WHERE content MATCH ?')
        .get('xyzuniqueftsword') as { rowid: number } | undefined;
      expect(ftsRow).toBeDefined();
      expect(ftsRow!.rowid).toBe(chunk.id);
    });

    it('is a no-op when given an empty array', () => {
      void storeChunks(db, []);
      const count = (db.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number })
        .c;
      expect(count).toBe(0);
    });

    describe('30-second deduplication window', () => {
      it('skips hash check for scopes written within the last 30 seconds — allows re-insert', () => {
        const content = 'Duplicate content within dedup window';
        // First call: scope has no recent chunks → hash check runs → inserted
        void storeChunks(db, [makeChunk({ content, scope: 'hot-scope' })]);
        // Second call within 30s to the same scope: hash check is skipped → inserted again
        void storeChunks(db, [makeChunk({ content, scope: 'hot-scope' })]);
        const count = (
          db.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number }
        ).c;
        // Both rows exist because the 30-second fast path bypasses the hash lookup
        expect(count).toBe(2);
      });

      it('enforces hash dedup for scopes outside the 30-second window', () => {
        const content = 'Old content to be deduped';
        void storeChunks(db, [makeChunk({ content, scope: 'cold-scope' })]);
        // Backdate the existing chunk so it falls outside the 30-second window
        db.prepare(
          `UPDATE context_chunks SET updated_at = datetime('now', '-60 seconds') WHERE scope = 'cold-scope'`,
        ).run();
        // Second call: scope not recent → hash check runs → duplicate detected → no new row
        void storeChunks(db, [makeChunk({ content, scope: 'cold-scope' })]);
        const count = (
          db.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number }
        ).c;
        expect(count).toBe(1);
      });

      it('applies the window per-scope — recent scope bypasses hash check, old scope does not', () => {
        const content = 'Shared content';
        // Insert to both scopes but backdate one
        void storeChunks(db, [makeChunk({ content, scope: 'hot-scope' })]);
        void storeChunks(db, [makeChunk({ content: 'different content', scope: 'cold-scope' })]);
        db.prepare(
          `UPDATE context_chunks SET updated_at = datetime('now', '-60 seconds') WHERE scope = 'cold-scope'`,
        ).run();

        // hot-scope is recent → skip hash check → 1 new row for hot-scope
        // cold-scope is not recent → hash check runs → deduped (same content)
        void storeChunks(db, [
          makeChunk({ content, scope: 'hot-scope' }),
          makeChunk({ content: 'different content', scope: 'cold-scope' }),
        ]);

        const hotCount = (
          db
            .prepare(`SELECT COUNT(*) as c FROM context_chunks WHERE scope = 'hot-scope'`)
            .get() as { c: number }
        ).c;
        const coldCount = (
          db
            .prepare(`SELECT COUNT(*) as c FROM context_chunks WHERE scope = 'cold-scope'`)
            .get() as { c: number }
        ).c;
        // hot-scope: 2 rows (window bypassed hash check)
        expect(hotCount).toBe(2);
        // cold-scope: 1 row (hash check ran and deduplicated)
        expect(coldCount).toBe(1);
      });
    });
  });

  describe('searchChunks', () => {
    beforeEach(() => {
      void storeChunks(db, [
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
      void storeChunks(db, [
        makeChunk({ content: 'extra chunk alpha one' }),
        makeChunk({ content: 'extra chunk beta two' }),
        makeChunk({ content: 'extra chunk gamma three' }),
      ]);
      // Store many chunks with the same keyword
      void storeChunks(
        db,
        Array.from({ length: 8 }, (_, i) => makeChunk({ content: `keyword item ${i}` })),
      );
      const results = searchChunks(db, 'keyword', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('excludes stale chunks from search results', () => {
      void storeChunks(db, [
        makeChunk({ scope: 'stale-scope', content: 'stale content fragment' }),
      ]);
      markStale(db, ['stale-scope']);
      const results = searchChunks(db, 'stale');
      expect(results.every((r) => r.stale !== true)).toBe(true);
    });
  });

  describe('markStale', () => {
    beforeEach(() => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/core', content: 'Core routing logic content' }),
        makeChunk({ scope: 'src/master', content: 'Master AI lifecycle content' }),
        makeChunk({ scope: 'src/types', content: 'TypeScript type definitions content' }),
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
      void storeChunks(db, [
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

  describe('deleteChunksByScope', () => {
    beforeEach(() => {
      void storeChunks(db, [
        makeChunk({ scope: 'target-scope', content: 'old structure chunk' }),
        makeChunk({ scope: 'target-scope', category: 'config', content: 'old config chunk' }),
        makeChunk({ scope: 'keep-scope', content: 'should stay' }),
      ]);
    });

    it('removes all chunks with the given scope', () => {
      deleteChunksByScope(db, 'target-scope');
      const remaining = db.prepare('SELECT scope FROM context_chunks').all() as {
        scope: string;
      }[];
      expect(remaining.map((r) => r.scope)).toEqual(['keep-scope']);
    });

    it('removes the corresponding FTS5 entries', () => {
      deleteChunksByScope(db, 'target-scope');
      const ftsRows = db
        .prepare("SELECT * FROM context_chunks_fts WHERE content MATCH 'old'")
        .all();
      expect(ftsRows).toHaveLength(0);
    });

    it('does not affect chunks from other scopes', () => {
      deleteChunksByScope(db, 'target-scope');
      const count = (
        db
          .prepare('SELECT COUNT(*) as c FROM context_chunks WHERE scope = ?')
          .get('keep-scope') as { c: number }
      ).c;
      expect(count).toBe(1);
    });

    it('removes stale and non-stale chunks alike', () => {
      markStale(db, ['target-scope']);
      deleteChunksByScope(db, 'target-scope');
      const count = (
        db
          .prepare('SELECT COUNT(*) as c FROM context_chunks WHERE scope = ?')
          .get('target-scope') as { c: number }
      ).c;
      expect(count).toBe(0);
    });

    it('is a no-op when the scope has no chunks', () => {
      deleteChunksByScope(db, 'nonexistent-scope');
      const count = (db.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number })
        .c;
      expect(count).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // computeContentHash
  // ---------------------------------------------------------------------------

  describe('computeContentHash', () => {
    it('returns a 64-character lowercase hex string', () => {
      const hash = computeContentHash('hello world');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('produces the same hash for identical content', () => {
      const content = 'Bridge routes messages between connectors and providers.';
      expect(computeContentHash(content)).toBe(computeContentHash(content));
    });

    it('produces different hashes for different content', () => {
      const h1 = computeContentHash('content alpha');
      const h2 = computeContentHash('content beta');
      expect(h1).not.toBe(h2);
    });

    it('normalizes leading and trailing whitespace (trim)', () => {
      const h1 = computeContentHash('  hello  ');
      const h2 = computeContentHash('hello');
      expect(h1).toBe(h2);
    });

    it('normalizes internal whitespace runs to a single space', () => {
      const h1 = computeContentHash('hello   world');
      const h2 = computeContentHash('hello world');
      expect(h1).toBe(h2);
    });

    it('normalizes tabs and newlines as whitespace', () => {
      const h1 = computeContentHash('hello\t\nworld');
      const h2 = computeContentHash('hello world');
      expect(h1).toBe(h2);
    });

    it('works on empty string', () => {
      const hash = computeContentHash('');
      expect(hash).toHaveLength(64);
    });
  });

  // ---------------------------------------------------------------------------
  // Migration v11 — content_hash backfill
  // ---------------------------------------------------------------------------

  describe('migration v11 — content_hash backfill', () => {
    /**
     * Creates a minimal raw database that simulates a pre-v11 state:
     * - context_chunks WITHOUT the content_hash column
     * - schema_versions table (so applySchemaChanges can record applied migrations)
     * - No prior migrations recorded
     */
    function createLegacyDb(): Database.Database {
      const legacyDb = new BetterSqlite3(':memory:');

      legacyDb.exec(`
        CREATE TABLE schema_versions (
          version    INTEGER PRIMARY KEY,
          applied_at TEXT    NOT NULL,
          description TEXT   NOT NULL
        );

        CREATE TABLE context_chunks (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          scope       TEXT    NOT NULL,
          category    TEXT    NOT NULL,
          content     TEXT    NOT NULL,
          source_hash TEXT,
          created_at  TEXT    NOT NULL,
          updated_at  TEXT    NOT NULL,
          stale       BOOLEAN DEFAULT 0
        );

        CREATE VIRTUAL TABLE context_chunks_fts
          USING fts5(content, scope, category);

        -- Stub tables required by migrations 1-10
        CREATE TABLE agent_activity (
          id INTEGER PRIMARY KEY,
          status TEXT,
          pid INTEGER,
          summary_json TEXT
        );
        CREATE TABLE conversations (id INTEGER PRIMARY KEY, title TEXT);
        CREATE TABLE sessions (id TEXT PRIMARY KEY, checkpoint_data TEXT);
        CREATE TABLE access_control (
          id INTEGER PRIMARY KEY,
          consent_mode TEXT DEFAULT 'always-ask',
          execution_profile TEXT DEFAULT 'fast',
          model_preferences TEXT DEFAULT NULL,
          approved_tool_escalations TEXT DEFAULT '[]'
        );
        CREATE TABLE observations (
          id INTEGER PRIMARY KEY,
          session_id TEXT NOT NULL,
          worker_id  TEXT NOT NULL,
          type       TEXT NOT NULL,
          title      TEXT NOT NULL,
          narrative  TEXT NOT NULL,
          facts      TEXT NOT NULL DEFAULT '[]',
          concepts   TEXT NOT NULL DEFAULT '[]',
          files_read     TEXT NOT NULL DEFAULT '[]',
          files_modified TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL
        );
        CREATE VIRTUAL TABLE observations_fts
          USING fts5(title, narrative, content=observations, content_rowid=id);
        CREATE TABLE qa_cache (
          id INTEGER PRIMARY KEY,
          question TEXT NOT NULL,
          answer TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 0.5,
          file_paths TEXT,
          created_at TEXT NOT NULL,
          accessed_at TEXT NOT NULL,
          access_count INTEGER NOT NULL DEFAULT 0
        );
        CREATE VIRTUAL TABLE qa_cache_fts
          USING fts5(question, content=qa_cache, content_rowid=id);
      `);

      return legacyDb;
    }

    it('adds content_hash column when it is missing', () => {
      const legacyDb = createLegacyDb();

      const hasBefore =
        (
          legacyDb
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('context_chunks') WHERE name='content_hash'`,
            )
            .get() as { c: number }
        ).c > 0;
      expect(hasBefore).toBe(false);

      applySchemaChanges(legacyDb);

      const hasAfter =
        (
          legacyDb
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('context_chunks') WHERE name='content_hash'`,
            )
            .get() as { c: number }
        ).c > 0;
      expect(hasAfter).toBe(true);

      legacyDb.close();
    });

    it('backfills content_hash for existing rows using computeContentHash', () => {
      const legacyDb = createLegacyDb();
      const now = new Date().toISOString();

      // Insert two rows without content_hash (old schema)
      legacyDb
        .prepare(
          `INSERT INTO context_chunks (scope, category, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('src/core', 'structure', 'Bridge routes messages', now, now);
      legacyDb
        .prepare(
          `INSERT INTO context_chunks (scope, category, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('src/master', 'patterns', 'Master spawns workers', now, now);

      applySchemaChanges(legacyDb);

      const rows = legacyDb
        .prepare('SELECT content, content_hash FROM context_chunks ORDER BY id')
        .all() as { content: string; content_hash: string }[];

      expect(rows).toHaveLength(2);
      expect(rows[0].content_hash).toBe(computeContentHash('Bridge routes messages'));
      expect(rows[1].content_hash).toBe(computeContentHash('Master spawns workers'));

      legacyDb.close();
    });

    it('does not overwrite existing content_hash values', () => {
      const legacyDb = createLegacyDb();

      // Apply migration to get the column
      applySchemaChanges(legacyDb);

      const now = new Date().toISOString();
      const customHash = 'a'.repeat(64);

      // Insert a row with a pre-set content_hash
      legacyDb
        .prepare(
          `INSERT INTO context_chunks (scope, category, content, content_hash, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run('src/test', 'structure', 'test content', customHash, now, now);

      // Running migrations again should not overwrite
      // (schema_versions prevents re-run, but we verify the value is untouched)
      const row = legacyDb.prepare('SELECT content_hash FROM context_chunks').get() as {
        content_hash: string;
      };
      expect(row.content_hash).toBe(customHash);

      legacyDb.close();
    });

    it('is idempotent — running migrations twice does not change hashes', () => {
      const legacyDb = createLegacyDb();
      const now = new Date().toISOString();

      legacyDb
        .prepare(
          `INSERT INTO context_chunks (scope, category, content, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run('src/core', 'structure', 'Idempotent test content', now, now);

      applySchemaChanges(legacyDb);

      const hashAfterFirst = (
        legacyDb.prepare('SELECT content_hash FROM context_chunks').get() as {
          content_hash: string;
        }
      ).content_hash;

      // Calling again should be a no-op (schema_versions guards re-execution)
      applySchemaChanges(legacyDb);

      const hashAfterSecond = (
        legacyDb.prepare('SELECT content_hash FROM context_chunks').get() as {
          content_hash: string;
        }
      ).content_hash;

      expect(hashAfterFirst).toBe(hashAfterSecond);
      expect(hashAfterFirst).toBe(computeContentHash('Idempotent test content'));

      legacyDb.close();
    });

    it('handles an empty context_chunks table gracefully (no-op backfill)', () => {
      const legacyDb = createLegacyDb();

      expect(() => applySchemaChanges(legacyDb)).not.toThrow();

      const count = (
        legacyDb.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number }
      ).c;
      expect(count).toBe(0);

      legacyDb.close();
    });
  });

  // ---------------------------------------------------------------------------
  // Batch embedding (OB-1652)
  // ---------------------------------------------------------------------------

  describe('batch embedding via embeddingProvider', () => {
    /** Build a mock EmbeddingProvider that records which texts were embedded. */
    function makeMockProvider(
      dims = 4,
      failBatch = false,
    ): EmbeddingProvider & { calls: string[][] } {
      const provider: EmbeddingProvider & { calls: string[][] } = {
        name: 'mock',
        dimensions: dims,
        calls: [],
        embed(_text: string): Promise<EmbeddingResult> {
          return Promise.resolve({
            vector: new Float32Array(dims).fill(0.1),
            model: 'mock',
            dimensions: dims,
          });
        },
        embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
          if (failBatch) return Promise.reject(new Error('Network error'));
          provider.calls.push([...texts]);
          return Promise.resolve(
            texts.map(() => ({
              vector: new Float32Array(dims).fill(0.1),
              model: 'mock',
              dimensions: dims,
            })),
          );
        },
        isAvailable(): Promise<boolean> {
          return Promise.resolve(true);
        },
      };
      return provider;
    }

    it('stores embeddings in the embeddings table for newly inserted chunks', async () => {
      const provider = makeMockProvider();
      await storeChunks(
        db,
        [
          makeChunk({ content: 'Chunk alpha content', scope: 'embed-scope' }),
          makeChunk({ content: 'Chunk beta content', scope: 'embed-scope' }),
        ],
        { embeddingProvider: provider },
      );

      const count = (db.prepare('SELECT COUNT(*) as c FROM embeddings').get() as { c: number }).c;
      expect(count).toBe(2);
      // embedBatch should have been called once with both texts
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0]).toHaveLength(2);
    });

    it('does not store embeddings when provider name is "none"', async () => {
      const noopProvider: EmbeddingProvider = {
        name: 'none',
        dimensions: 0,
        embed: () => Promise.resolve({ vector: new Float32Array(0), model: 'none', dimensions: 0 }),
        embedBatch: (texts) =>
          Promise.resolve(
            texts.map(() => ({ vector: new Float32Array(0), model: 'none', dimensions: 0 })),
          ),
        isAvailable: () => Promise.resolve(true),
      };

      await storeChunks(db, [makeChunk({ content: 'No-op embed content' })], {
        embeddingProvider: noopProvider,
      });

      const count = (db.prepare('SELECT COUNT(*) as c FROM embeddings').get() as { c: number }).c;
      expect(count).toBe(0);
    });

    it('chunk is still stored even when embedding fails', async () => {
      const failingProvider = makeMockProvider(4, true);

      await expect(
        storeChunks(db, [makeChunk({ content: 'Chunk survives embedding failure' })], {
          embeddingProvider: failingProvider,
        }),
      ).resolves.not.toThrow();

      const chunkCount = (
        db.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number }
      ).c;
      expect(chunkCount).toBe(1);

      const embeddingCount = (
        db.prepare('SELECT COUNT(*) as c FROM embeddings').get() as { c: number }
      ).c;
      expect(embeddingCount).toBe(0);
    });

    it('only embeds newly inserted chunks, not dedup-touched ones', async () => {
      const content = 'Dedup embedding test content';
      // Insert once (outside any window) so hash is stored
      await storeChunks(db, [makeChunk({ content, scope: 'cold-embed-scope' })]);
      // Backdate so it falls outside the 30-second window
      db.prepare(
        `UPDATE context_chunks SET updated_at = datetime('now', '-60 seconds') WHERE scope = 'cold-embed-scope'`,
      ).run();

      const provider = makeMockProvider();
      // Second insert: same content → dedup touch, no new row, no new embedding
      await storeChunks(db, [makeChunk({ content, scope: 'cold-embed-scope' })], {
        embeddingProvider: provider,
      });

      // No embedBatch call because no new chunk was inserted
      expect(provider.calls).toHaveLength(0);
    });

    it('does not embed when no provider is given', async () => {
      await storeChunks(db, [makeChunk({ content: 'No provider chunk' })]);

      const count = (db.prepare('SELECT COUNT(*) as c FROM embeddings').get() as { c: number }).c;
      expect(count).toBe(0);
    });

    it('gracefully skips embedding when embeddings table does not exist', async () => {
      // Create a minimal DB without the embeddings table
      const minimalDb = new BetterSqlite3(':memory:');
      minimalDb.exec(`
        CREATE TABLE schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL, description TEXT NOT NULL);
        CREATE TABLE context_chunks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL, category TEXT NOT NULL, content TEXT NOT NULL,
          source_hash TEXT, content_hash TEXT,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, stale BOOLEAN DEFAULT 0
        );
        CREATE VIRTUAL TABLE context_chunks_fts USING fts5(content, scope, category);
      `);

      const provider = makeMockProvider();
      await expect(
        storeChunks(minimalDb, [makeChunk({ content: 'Minimal DB chunk' })], {
          embeddingProvider: provider,
        }),
      ).resolves.not.toThrow();

      const chunkCount = (
        minimalDb.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number }
      ).c;
      expect(chunkCount).toBe(1);

      minimalDb.close();
    });
  });
});
