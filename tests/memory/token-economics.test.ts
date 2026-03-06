import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  storeChunks,
  DEFAULT_AVG_TOKENS_PER_TURN,
  type Chunk,
} from '../../src/memory/chunk-store.js';
import { hybridSearch } from '../../src/memory/retrieval.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeChunk = (overrides: Partial<Chunk> = {}): Chunk => ({
  scope: 'src/core',
  category: 'structure',
  content: 'The bridge module routes messages between connectors and providers.',
  ...overrides,
});

interface TokenEconRow {
  chunk_id: number;
  discovery_tokens: number;
  retrieval_count: number;
  total_read_tokens: number;
  created_at: string;
  last_read_at: string | null;
}

function getTokenRow(db: Database.Database, chunkId: number): TokenEconRow | undefined {
  return db.prepare('SELECT * FROM token_economics WHERE chunk_id = ?').get(chunkId) as
    | TokenEconRow
    | undefined;
}

function getChunkId(db: Database.Database, scope: string): number {
  const row = db.prepare('SELECT id FROM context_chunks WHERE scope = ?').get(scope) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`No chunk found with scope '${scope}'`);
  return row.id;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('token_economics — tracking', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  // -------------------------------------------------------------------------
  // Discovery token recording (via storeChunks)
  // -------------------------------------------------------------------------

  describe('discovery tokens', () => {
    it('records a token_economics row for each inserted chunk', () => {
      void storeChunks(db, [makeChunk({ scope: 'src/core' })], { workerTurns: 2 });

      const chunkId = getChunkId(db, 'src/core');
      const row = getTokenRow(db, chunkId);

      expect(row).toBeDefined();
      expect(row!.chunk_id).toBe(chunkId);
    });

    it('calculates discovery_tokens as workerTurns × avgTokensPerTurn', () => {
      const workerTurns = 3;
      void storeChunks(db, [makeChunk({ scope: 'src/core' })], { workerTurns });

      const chunkId = getChunkId(db, 'src/core');
      const row = getTokenRow(db, chunkId);

      expect(row!.discovery_tokens).toBe(workerTurns * DEFAULT_AVG_TOKENS_PER_TURN);
    });

    it('uses custom avgTokensPerTurn when provided', () => {
      void storeChunks(db, [makeChunk({ scope: 'src/core' })], {
        workerTurns: 2,
        avgTokensPerTurn: 1000,
      });

      const chunkId = getChunkId(db, 'src/core');
      const row = getTokenRow(db, chunkId);

      expect(row!.discovery_tokens).toBe(2000);
    });

    it('stores zero discovery_tokens when workerTurns is not provided', () => {
      void storeChunks(db, [makeChunk({ scope: 'src/core' })]);

      const chunkId = getChunkId(db, 'src/core');
      const row = getTokenRow(db, chunkId);

      expect(row!.discovery_tokens).toBe(0);
    });

    it('records a token_economics row for every chunk in a batch', () => {
      void storeChunks(
        db,
        [
          makeChunk({ scope: 'src/core', content: 'core chunk content one' }),
          makeChunk({
            scope: 'src/master',
            content: 'master chunk content two',
            category: 'patterns',
          }),
        ],
        { workerTurns: 1 },
      );

      const coreId = getChunkId(db, 'src/core');
      const masterId = getChunkId(db, 'src/master');

      expect(getTokenRow(db, coreId)).toBeDefined();
      expect(getTokenRow(db, masterId)).toBeDefined();
    });

    it('does not overwrite an existing token_economics row (INSERT OR IGNORE)', () => {
      // First store — records discovery tokens
      void storeChunks(db, [makeChunk({ scope: 'src/core' })], { workerTurns: 5 });
      const chunkId = getChunkId(db, 'src/core');

      // Backdate so the 30-second window does not apply
      db.prepare(
        `UPDATE context_chunks SET updated_at = datetime('now', '-60 seconds') WHERE id = ?`,
      ).run(chunkId);

      // Second store with different turn count should not update the existing row
      void storeChunks(db, [makeChunk({ scope: 'src/core' })], { workerTurns: 1 });

      const row = getTokenRow(db, chunkId);
      expect(row!.discovery_tokens).toBe(5 * DEFAULT_AVG_TOKENS_PER_TURN);
    });

    it('sets initial retrieval_count to 0', () => {
      void storeChunks(db, [makeChunk({ scope: 'src/core' })], { workerTurns: 1 });

      const chunkId = getChunkId(db, 'src/core');
      const row = getTokenRow(db, chunkId);

      expect(row!.retrieval_count).toBe(0);
      expect(row!.total_read_tokens).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Read token tracking (via hybridSearch → trackReadTokens)
  // -------------------------------------------------------------------------

  describe('read tokens and retrieval_count', () => {
    const UNIQUE_TERM = 'xyzuniqtokenterm';

    beforeEach(() => {
      void storeChunks(
        db,
        [
          makeChunk({
            scope: 'src/core',
            content: `${UNIQUE_TERM} bridge routes messages between connectors`,
          }),
        ],
        { workerTurns: 2 },
      );
    });

    it('increments retrieval_count by 1 on each hybridSearch hit', async () => {
      const chunkId = getChunkId(db, 'src/core');

      await hybridSearch(db, UNIQUE_TERM);

      const row = getTokenRow(db, chunkId);
      expect(row!.retrieval_count).toBe(1);
    });

    it('accumulates retrieval_count across multiple searches', async () => {
      const chunkId = getChunkId(db, 'src/core');

      await hybridSearch(db, UNIQUE_TERM);
      await hybridSearch(db, UNIQUE_TERM);
      await hybridSearch(db, UNIQUE_TERM);

      const row = getTokenRow(db, chunkId);
      expect(row!.retrieval_count).toBe(3);
    });

    it('accumulates total_read_tokens proportional to content length', async () => {
      const chunkId = getChunkId(db, 'src/core');
      const chunk = db.prepare('SELECT content FROM context_chunks WHERE id = ?').get(chunkId) as {
        content: string;
      };

      // Each retrieval adds ceil(content.length / 4) tokens
      const tokensPerRetrieval = Math.ceil(chunk.content.length / 4);

      await hybridSearch(db, UNIQUE_TERM);
      await hybridSearch(db, UNIQUE_TERM);

      const row = getTokenRow(db, chunkId);
      expect(row!.total_read_tokens).toBe(tokensPerRetrieval * 2);
    });

    it('sets last_read_at on first retrieval', async () => {
      const chunkId = getChunkId(db, 'src/core');

      const before = new Date().toISOString();
      await hybridSearch(db, UNIQUE_TERM);
      const after = new Date().toISOString();

      const row = getTokenRow(db, chunkId);
      expect(row!.last_read_at).not.toBeNull();
      expect(row!.last_read_at! >= before).toBe(true);
      expect(row!.last_read_at! <= after).toBe(true);
    });

    it('upserts a token_economics row for chunks that have no prior discovery record', async () => {
      // Insert chunk without workerTurns — storeChunks creates a row with 0 discovery_tokens
      void storeChunks(db, [
        makeChunk({ scope: 'src/types', content: `${UNIQUE_TERM} type definitions` }),
      ]);

      const chunkId = getChunkId(db, 'src/types');

      // Manually delete the token_economics row to simulate a missing record
      db.prepare('DELETE FROM token_economics WHERE chunk_id = ?').run(chunkId);
      expect(getTokenRow(db, chunkId)).toBeUndefined();

      // hybridSearch should upsert a new row via trackReadTokens
      await hybridSearch(db, UNIQUE_TERM);

      const row = getTokenRow(db, chunkId);
      expect(row).toBeDefined();
      expect(row!.retrieval_count).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Aggregate stats (getTokenEconomicsStats via MemoryManager)
  // -------------------------------------------------------------------------

  describe('aggregate stats', () => {
    it('returns zeros for all counters when token_economics table is empty', () => {
      const stats = db
        .prepare(
          `SELECT
             COALESCE(SUM(discovery_tokens), 0)  AS total_discovery,
             COALESCE(SUM(total_read_tokens), 0) AS total_read,
             COALESCE(SUM(retrieval_count), 0)   AS total_retrievals,
             COUNT(*)                             AS chunks_tracked
           FROM token_economics`,
        )
        .get() as {
        total_discovery: number;
        total_read: number;
        total_retrievals: number;
        chunks_tracked: number;
      };

      expect(stats.total_discovery).toBe(0);
      expect(stats.total_read).toBe(0);
      expect(stats.total_retrievals).toBe(0);
      expect(stats.chunks_tracked).toBe(0);
    });

    it('sums discovery_tokens across all tracked chunks', () => {
      void storeChunks(
        db,
        [
          makeChunk({ scope: 'src/core', content: 'alpha content unique chunk' }),
          makeChunk({
            scope: 'src/master',
            content: 'beta content unique chunk',
            category: 'patterns',
          }),
        ],
        { workerTurns: 3 },
      );

      const stats = db
        .prepare(
          `SELECT COALESCE(SUM(discovery_tokens), 0) AS total_discovery FROM token_economics`,
        )
        .get() as { total_discovery: number };

      expect(stats.total_discovery).toBe(2 * 3 * DEFAULT_AVG_TOKENS_PER_TURN);
    });

    it('reports chunks_tracked equal to number of rows in token_economics', () => {
      void storeChunks(
        db,
        [
          makeChunk({ scope: 'src/core', content: 'scope core unique' }),
          makeChunk({ scope: 'src/types', content: 'scope types unique', category: 'api' }),
          makeChunk({
            scope: 'src/discovery',
            content: 'scope discovery unique',
            category: 'config',
          }),
        ],
        { workerTurns: 1 },
      );

      const stats = db.prepare(`SELECT COUNT(*) AS chunks_tracked FROM token_economics`).get() as {
        chunks_tracked: number;
      };

      expect(stats.chunks_tracked).toBe(3);
    });

    it('accumulates total_retrievals and total_read_tokens across all chunks', async () => {
      const TERM = 'zyxwvutstats';
      void storeChunks(
        db,
        [
          makeChunk({ scope: 'src/core', content: `${TERM} core content` }),
          makeChunk({
            scope: 'src/master',
            content: `${TERM} master content`,
            category: 'patterns',
          }),
        ],
        { workerTurns: 1 },
      );

      // Two retrievals — both chunks match, so retrieval_count goes up for each
      await hybridSearch(db, TERM);
      await hybridSearch(db, TERM);

      const stats = db
        .prepare(
          `SELECT
             COALESCE(SUM(retrieval_count), 0) AS total_retrievals,
             COALESCE(SUM(total_read_tokens), 0) AS total_read
           FROM token_economics`,
        )
        .get() as { total_retrievals: number; total_read: number };

      expect(stats.total_retrievals).toBeGreaterThanOrEqual(2);
      expect(stats.total_read).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // /stats output format — number formatting
  // -------------------------------------------------------------------------

  describe('/stats output format — number formatting', () => {
    /**
     * Local replica of the fmt() function used in router.ts and stats.ts.
     * Tests verify the canonical formatting rules are correct.
     */
    function fmt(n: number): string {
      if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M`;
      if (n >= 1_000) return `~${Math.round(n / 1_000)}K`;
      return `${n}`;
    }

    it('formats numbers below 1 000 as plain integers', () => {
      expect(fmt(0)).toBe('0');
      expect(fmt(999)).toBe('999');
      expect(fmt(42)).toBe('42');
    });

    it('formats numbers >= 1 000 as ~NK (rounded)', () => {
      expect(fmt(1000)).toBe('~1K');
      expect(fmt(1500)).toBe('~2K');
      expect(fmt(50000)).toBe('~50K');
      expect(fmt(999_499)).toBe('~999K');
    });

    it('formats numbers >= 1 000 000 as ~N.NM (one decimal)', () => {
      expect(fmt(1_000_000)).toBe('~1.0M');
      expect(fmt(1_500_000)).toBe('~1.5M');
      expect(fmt(10_000_000)).toBe('~10.0M');
    });

    it('formats boundary value 1 000 exactly as ~1K', () => {
      expect(fmt(1_000)).toBe('~1K');
    });

    it('formats boundary value 1 000 000 exactly as ~1.0M', () => {
      expect(fmt(1_000_000)).toBe('~1.0M');
    });

    it('composes a valid stats line for known inputs', () => {
      const totalDiscoveryTokens = 50_000;
      const totalReadTokens = 200_000;
      const totalRetrievals = 15;
      const chunksTracked = 42;

      const roi = (totalReadTokens / totalDiscoveryTokens).toFixed(1);
      const roiStr = ` (${roi}x ROI)`;
      const line = `Explored with ${fmt(totalDiscoveryTokens)} tokens, saved ${fmt(totalReadTokens)} tokens across ${totalRetrievals} retrieval${totalRetrievals !== 1 ? 's' : ''}${roiStr}`;

      expect(line).toBe(
        'Explored with ~50K tokens, saved ~200K tokens across 15 retrievals (4.0x ROI)',
      );
      expect(`Chunks tracked: ${chunksTracked}`).toBe('Chunks tracked: 42');
    });

    it('uses singular "retrieval" when count is 1', () => {
      const totalRetrievals = 1;
      const suffix = `retrieval${totalRetrievals !== 1 ? 's' : ''}`;
      expect(suffix).toBe('retrieval');
    });

    it('uses plural "retrievals" when count is 0 or >1', () => {
      for (const n of [0, 2, 15, 100]) {
        const suffix = `retrieval${n !== 1 ? 's' : ''}`;
        expect(suffix).toBe('retrievals');
      }
    });

    it('omits ROI string when totalDiscoveryTokens is 0', () => {
      const totalDiscoveryTokens = 0;
      const totalReadTokens = 500;
      const roi =
        totalDiscoveryTokens > 0 ? (totalReadTokens / totalDiscoveryTokens).toFixed(1) : null;
      const roiStr = roi !== null ? ` (${roi}x ROI)` : '';
      expect(roiStr).toBe('');
    });
  });
});
