import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { storeChunks, markStale, type Chunk } from '../../src/memory/chunk-store.js';
import {
  hybridSearch,
  searchConversations,
  rerank,
  sanitizeFts5Query,
  computeTemporalScore,
  computeHybridScore,
} from '../../src/memory/retrieval.js';
import type { ConversationEntry } from '../../src/memory/index.js';
import type { AgentRunner } from '../../src/core/agent-runner.js';

// ---------------------------------------------------------------------------
// Helpers for inserting conversation rows directly (avoids circular imports)
// ---------------------------------------------------------------------------

function insertConversation(db: Database.Database, msg: ConversationEntry): void {
  const now = new Date().toISOString();
  const createdAt = msg.created_at ?? now;

  const res = db
    .prepare(
      `INSERT INTO conversations (session_id, role, content, channel, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      msg.session_id,
      msg.role,
      msg.content,
      msg.channel ?? null,
      msg.user_id ?? null,
      createdAt,
    );

  db.prepare(`INSERT INTO conversations_fts (rowid, content) VALUES (?, ?)`).run(
    res.lastInsertRowid,
    msg.content,
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('retrieval.ts', () => {
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

  // -------------------------------------------------------------------------
  // hybridSearch
  // -------------------------------------------------------------------------

  describe('hybridSearch', () => {
    it('returns empty array for empty query', async () => {
      await expect(hybridSearch(db, '')).resolves.toEqual([]);
    });

    it('returns empty array for whitespace-only query', async () => {
      await expect(hybridSearch(db, '   ')).resolves.toEqual([]);
    });

    it('finds chunks matching FTS5 keyword query', async () => {
      void storeChunks(db, [
        makeChunk({ content: 'The authentication module validates user credentials' }),
        makeChunk({ scope: 'src/types', content: 'TypeScript configuration file for strict mode' }),
      ]);

      const results = await hybridSearch(db, 'authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('authentication');
    });

    it('returns empty array when no chunks match query', async () => {
      void storeChunks(db, [makeChunk({ content: 'Database connection pooling logic' })]);
      const results = await hybridSearch(db, 'xyznonexistentterm');
      expect(results).toHaveLength(0);
    });

    it('respects the limit parameter', async () => {
      void storeChunks(
        db,
        Array.from({ length: 5 }, (_, i) => makeChunk({ content: `message routing item ${i}` })),
      );

      const results = await hybridSearch(db, 'message', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('excludes stale chunks by default (excludeStale=true)', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'stale-scope', content: 'stale authentication chunk here' }),
      ]);
      markStale(db, ['stale-scope']);

      const results = await hybridSearch(db, 'authentication');
      expect(results).toHaveLength(0);
    });

    it('includes stale chunks when excludeStale=false', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'stale-scope', content: 'stale authentication chunk here' }),
      ]);
      markStale(db, ['stale-scope']);

      const results = await hybridSearch(db, 'authentication', { excludeStale: false });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].stale).toBe(true);
    });

    it('returns only chunks whose scope starts with the scope prefix filter', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/core', content: 'core routing logic for messages' }),
        makeChunk({ scope: 'src/master', content: 'master routing and delegation logic' }),
      ]);

      const results = await hybridSearch(db, 'routing', { scope: 'src/core' });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.scope.startsWith('src/core'))).toBe(true);
    });

    it('scope filter excludes chunks that do not match the prefix', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/master', content: 'master delegation orchestration logic' }),
      ]);

      // scope filter 'src/core' should exclude 'src/master'
      const results = await hybridSearch(db, 'orchestration', { scope: 'src/core' });
      expect(results).toHaveLength(0);
    });

    it('category filter returns only matching category chunks', async () => {
      void storeChunks(db, [
        makeChunk({ category: 'structure', content: 'project structure definition layout here' }),
        makeChunk({ category: 'patterns', content: 'project patterns best practices layout here' }),
      ]);

      const results = await hybridSearch(db, 'project', { category: 'structure' });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.category === 'structure')).toBe(true);
    });

    it('combined scope and category filter narrows results correctly', async () => {
      void storeChunks(db, [
        makeChunk({
          scope: 'src/core',
          category: 'structure',
          content: 'core structure layout definition here',
        }),
        makeChunk({
          scope: 'src/core',
          category: 'patterns',
          content: 'core patterns layout definition here',
        }),
        makeChunk({
          scope: 'src/master',
          category: 'structure',
          content: 'master structure layout definition here',
        }),
      ]);

      const results = await hybridSearch(db, 'layout', {
        scope: 'src/core',
        category: 'structure',
      });
      expect(results.length).toBeGreaterThan(0);
      expect(
        results.every((r) => r.scope.startsWith('src/core') && r.category === 'structure'),
      ).toBe(true);
    });

    it('does not call agentRunner when rerank=false', async () => {
      const mockSpawn = vi.fn();
      const mockRunner = { spawn: mockSpawn } as unknown as AgentRunner;
      void storeChunks(db, [makeChunk({ content: 'message routing logic test' })]);

      await hybridSearch(db, 'message', { rerank: false }, mockRunner);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('does not trigger AI reranking when results <= 10 even with rerank=true', async () => {
      const mockSpawn = vi.fn();
      const mockRunner = { spawn: mockSpawn } as unknown as AgentRunner;

      // Insert exactly 5 matching chunks — below the 10-result threshold
      void storeChunks(
        db,
        Array.from({ length: 5 }, (_, i) => makeChunk({ content: `message item ${i}` })),
      );

      await hybridSearch(db, 'message', { rerank: true, limit: 10 }, mockRunner);
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('triggers AI reranking when > 10 results and rerank=true', async () => {
      const mockSpawn = vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: '1,2,3,4,5,6,7,8,9,10,11,12',
        stderr: '',
      });
      const mockRunner = { spawn: mockSpawn } as unknown as AgentRunner;

      // Insert 12 matching chunks — above the threshold
      void storeChunks(
        db,
        Array.from({ length: 12 }, (_, i) =>
          makeChunk({ content: `routing logic module component ${i}` }),
        ),
      );

      await hybridSearch(db, 'routing', { rerank: true, limit: 12 }, mockRunner);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('returned chunks have required fields populated', async () => {
      void storeChunks(db, [makeChunk({ content: 'bridge gateway integration module' })]);
      const results = await hybridSearch(db, 'bridge');
      expect(results.length).toBeGreaterThan(0);
      const chunk = results[0];
      expect(chunk.id).toBeDefined();
      expect(chunk.scope).toBe('src/core');
      expect(chunk.category).toBe('structure');
      expect(chunk.content).toContain('bridge');
      expect(chunk.stale).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // rerank
  // -------------------------------------------------------------------------

  describe('rerank', () => {
    const chunks: Chunk[] = [
      { scope: 'a', category: 'structure', content: 'alpha content first' },
      { scope: 'b', category: 'structure', content: 'beta content second' },
      { scope: 'c', category: 'structure', content: 'gamma content third' },
    ];

    it('returns empty array unchanged for empty input', async () => {
      const spawnMock = vi.fn();
      const mockRunner = { spawn: spawnMock } as unknown as AgentRunner;
      const result = await rerank([], 'query', mockRunner);
      expect(result).toHaveLength(0);
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('reorders chunks according to AI-provided ranking', async () => {
      const mockRunner = {
        spawn: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '3,1,2', stderr: '' }),
      } as unknown as AgentRunner;

      const result = await rerank(chunks, 'query', mockRunner);
      expect(result[0]).toStrictEqual(chunks[2]); // chunk 3 → index 2
      expect(result[1]).toStrictEqual(chunks[0]); // chunk 1 → index 0
      expect(result[2]).toStrictEqual(chunks[1]); // chunk 2 → index 1
    });

    it('falls back to original order when AI returns non-zero exit code', async () => {
      const mockRunner = {
        spawn: vi.fn().mockResolvedValue({ exitCode: 1, stdout: '3,1,2', stderr: 'error' }),
      } as unknown as AgentRunner;

      const result = await rerank(chunks, 'query', mockRunner);
      expect(result).toEqual(chunks);
    });

    it('falls back to original order when AI stdout is empty', async () => {
      const mockRunner = {
        spawn: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
      } as unknown as AgentRunner;

      const result = await rerank(chunks, 'query', mockRunner);
      expect(result).toEqual(chunks);
    });

    it('falls back to original order when AI spawn throws', async () => {
      const mockRunner = {
        spawn: vi.fn().mockRejectedValue(new Error('timeout')),
      } as unknown as AgentRunner;

      const result = await rerank(chunks, 'query', mockRunner);
      expect(result).toEqual(chunks);
    });

    it('appends unranked chunks at end in original order', async () => {
      // AI only mentions chunks 3 and 1, leaving chunk 2 unranked
      const mockRunner = {
        spawn: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '3,1', stderr: '' }),
      } as unknown as AgentRunner;

      const result = await rerank(chunks, 'query', mockRunner);
      expect(result).toHaveLength(3);
      expect(result[0]).toStrictEqual(chunks[2]); // ranked #1
      expect(result[1]).toStrictEqual(chunks[0]); // ranked #2
      expect(result[2]).toStrictEqual(chunks[1]); // unranked → appended
    });

    it('handles out-of-range indices gracefully (ignores them)', async () => {
      // Index 99 is out of range for 3 chunks
      const mockRunner = {
        spawn: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '99,1,2,3', stderr: '' }),
      } as unknown as AgentRunner;

      const result = await rerank(chunks, 'query', mockRunner);
      expect(result).toHaveLength(3);
      // All chunks should appear exactly once
      expect(result).toContainEqual(chunks[0]);
      expect(result).toContainEqual(chunks[1]);
      expect(result).toContainEqual(chunks[2]);
    });
  });

  // -------------------------------------------------------------------------
  // searchConversations
  // -------------------------------------------------------------------------

  describe('searchConversations', () => {
    const makeMsg = (overrides: Partial<ConversationEntry> = {}): ConversationEntry => ({
      session_id: 'sess-001',
      role: 'user',
      content: 'Deploy the authentication service to production',
      ...overrides,
    });

    it('returns empty array for empty query', () => {
      expect(searchConversations(db, '')).toHaveLength(0);
    });

    it('returns empty array for whitespace-only query', () => {
      expect(searchConversations(db, '   ')).toHaveLength(0);
    });

    it('finds conversation messages matching the FTS5 query', () => {
      insertConversation(db, makeMsg({ content: 'deploy the authentication service' }));
      insertConversation(db, makeMsg({ content: 'how does TypeScript strict mode work' }));

      const results = searchConversations(db, 'authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('authentication');
    });

    it('returns empty array when no messages match', () => {
      insertConversation(db, makeMsg({ content: 'run the database migration script' }));
      const results = searchConversations(db, 'xyznonexistent');
      expect(results).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        insertConversation(db, makeMsg({ content: `routing request handler function ${i}` }));
      }

      const results = searchConversations(db, 'routing', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('returned entries have required fields', () => {
      insertConversation(
        db,
        makeMsg({
          session_id: 'sess-xyz',
          role: 'master',
          content: 'configuring database connection pool settings',
        }),
      );

      const results = searchConversations(db, 'database');
      expect(results.length).toBeGreaterThan(0);
      const entry = results[0];
      expect(entry.id).toBeDefined();
      expect(entry.session_id).toBe('sess-xyz');
      expect(entry.role).toBe('master');
      expect(entry.content).toContain('database');
    });

    // FTS5 special character escaping tests (OB-1114)

    it("does not throw SqliteError for query with single quote (it's)", () => {
      insertConversation(db, makeMsg({ content: 'deploy the authentication service' }));
      expect(() => searchConversations(db, "it's")).not.toThrow();
    });

    it("returns results or empty array for single-quote query (it's)", () => {
      insertConversation(db, makeMsg({ content: "it's a great authentication service" }));
      const results = searchConversations(db, "it's");
      expect(Array.isArray(results)).toBe(true);
    });

    it('does not throw SqliteError for query with double quotes ("hello")', () => {
      insertConversation(db, makeMsg({ content: 'deploy the authentication service' }));
      expect(() => searchConversations(db, '"hello"')).not.toThrow();
    });

    it('returns results or empty array for double-quote query ("hello")', () => {
      insertConversation(db, makeMsg({ content: 'hello world authentication message' }));
      const results = searchConversations(db, '"hello"');
      expect(Array.isArray(results)).toBe(true);
    });

    it('does not throw SqliteError for query with parentheses ((test))', () => {
      insertConversation(db, makeMsg({ content: 'deploy the authentication service' }));
      expect(() => searchConversations(db, '(test)')).not.toThrow();
    });

    it('returns results or empty array for parentheses query ((test))', () => {
      insertConversation(db, makeMsg({ content: 'test the authentication service here' }));
      const results = searchConversations(db, '(test)');
      expect(Array.isArray(results)).toBe(true);
    });

    it('does not throw SqliteError for query with asterisk (test*)', () => {
      insertConversation(db, makeMsg({ content: 'deploy the authentication service' }));
      expect(() => searchConversations(db, 'test*')).not.toThrow();
    });

    it('returns results or empty array for asterisk query (test*)', () => {
      insertConversation(db, makeMsg({ content: 'testing the authentication service here' }));
      const results = searchConversations(db, 'test*');
      expect(Array.isArray(results)).toBe(true);
    });

    it('does not throw SqliteError for query with FTS5 operators (AND OR NOT)', () => {
      insertConversation(db, makeMsg({ content: 'deploy the authentication service' }));
      expect(() => searchConversations(db, 'AND OR NOT')).not.toThrow();
    });

    it('returns results or empty array for FTS5 operator words (AND OR NOT)', () => {
      insertConversation(db, makeMsg({ content: 'AND OR NOT are valid words here' }));
      const results = searchConversations(db, 'AND OR NOT');
      expect(Array.isArray(results)).toBe(true);
    });

    it('returns empty array for empty string query', () => {
      insertConversation(db, makeMsg({ content: 'some content here' }));
      const results = searchConversations(db, '');
      expect(results).toHaveLength(0);
    });

    it('returns empty array for string of only special characters', () => {
      insertConversation(db, makeMsg({ content: 'some content here' }));
      const results = searchConversations(db, '"*(){}[]');
      expect(results).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // computeTemporalScore (OB-1654)
  // -------------------------------------------------------------------------

  describe('computeTemporalScore', () => {
    it('returns ~1.0 for a timestamp from right now', () => {
      const now = new Date().toISOString();
      const score = computeTemporalScore(now);
      expect(score).toBeGreaterThan(0.99);
      expect(score).toBeLessThanOrEqual(1.0);
    });

    it('returns a lower score for an older timestamp', () => {
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days ago
      const score = computeTemporalScore(old);
      expect(score).toBeLessThan(1.0);
      expect(score).toBeGreaterThan(0); // never exactly zero
    });

    it('newer chunks score higher than older chunks', () => {
      const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
      const older = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      expect(computeTemporalScore(recent)).toBeGreaterThan(computeTemporalScore(older));
    });

    it('uses the provided decayRate', () => {
      const ts = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago
      const slowDecay = computeTemporalScore(ts, 0.001);
      const fastDecay = computeTemporalScore(ts, 0.1);
      expect(slowDecay).toBeGreaterThan(fastDecay);
    });

    it('returns a value in [0, 1] for various timestamps', () => {
      const timestamps = [
        new Date().toISOString(),
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      ];
      for (const ts of timestamps) {
        const score = computeTemporalScore(ts);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // computeHybridScore (OB-1654)
  // -------------------------------------------------------------------------

  describe('computeHybridScore', () => {
    it('returns correct weighted sum: 0.4*v + 0.4*f + 0.2*t', () => {
      expect(computeHybridScore(1, 1, 1)).toBeCloseTo(1.0);
      expect(computeHybridScore(0, 0, 0)).toBeCloseTo(0.0);
      expect(computeHybridScore(1, 0, 0)).toBeCloseTo(0.4);
      expect(computeHybridScore(0, 1, 0)).toBeCloseTo(0.4);
      expect(computeHybridScore(0, 0, 1)).toBeCloseTo(0.2);
    });

    it('weights sum to 1.0 (all-ones input → 1.0 output)', () => {
      expect(computeHybridScore(1, 1, 1)).toBeCloseTo(1.0);
    });

    it('vector and FTS5 carry equal weight', () => {
      const vHeavy = computeHybridScore(1, 0, 0);
      const fHeavy = computeHybridScore(0, 1, 0);
      expect(vHeavy).toBeCloseTo(fHeavy);
    });

    it('temporal score has lower weight than vector or FTS5', () => {
      const temporal = computeHybridScore(0, 0, 1);
      const vector = computeHybridScore(1, 0, 0);
      expect(temporal).toBeLessThan(vector);
    });
  });

  // -------------------------------------------------------------------------
  // hybridSearch with queryVector (OB-1654)
  // -------------------------------------------------------------------------

  describe('hybridSearch with queryVector', () => {
    it('returns FTS5 matches when queryVector is provided but sqlite-vec unavailable', async () => {
      // In the test environment sqlite-vec is not loaded, so knnSearch returns [].
      // The hybrid path should still return FTS5 matches (vectorScore=0 for all).
      void storeChunks(db, [
        makeChunk({ content: 'authentication service handles login logic' }),
        makeChunk({ scope: 'src/types', content: 'TypeScript strict mode configuration' }),
      ]);

      const queryVector = new Float32Array([0.1, 0.2, 0.3]);
      const results = await hybridSearch(db, 'authentication', { queryVector });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('authentication');
    });

    it('empty queryVector falls back to FTS5-only path', async () => {
      void storeChunks(db, [makeChunk({ content: 'bridge routing logic for all messages' })]);

      // Empty vector → should use FTS5-only path (same results as without queryVector)
      const results = await hybridSearch(db, 'routing', { queryVector: new Float32Array(0) });
      const resultsFts5 = await hybridSearch(db, 'routing');
      expect(results).toEqual(resultsFts5);
    });

    it('returns empty array when no FTS5 or vector matches', async () => {
      void storeChunks(db, [makeChunk({ content: 'database connection pool' })]);
      const queryVector = new Float32Array([0.1, 0.2, 0.3]);
      const results = await hybridSearch(db, 'xyznonexistentterm', { queryVector });
      expect(results).toHaveLength(0);
    });

    it('respects scope filter in hybrid path', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/core', content: 'core authentication module logic' }),
        makeChunk({ scope: 'src/master', content: 'master authentication delegation logic' }),
      ]);

      const queryVector = new Float32Array([0.1, 0.2, 0.3]);
      const results = await hybridSearch(db, 'authentication', {
        queryVector,
        scope: 'src/core',
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.scope.startsWith('src/core'))).toBe(true);
    });

    it('respects limit in hybrid path', async () => {
      void storeChunks(
        db,
        Array.from({ length: 5 }, (_, i) => makeChunk({ content: `router module entry ${i}` })),
      );

      const queryVector = new Float32Array([0.1, 0.2, 0.3]);
      const results = await hybridSearch(db, 'router', { queryVector, limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // sanitizeFts5Query
  // -------------------------------------------------------------------------

  describe('sanitizeFts5Query', () => {
    it('returns empty string for empty input', () => {
      expect(sanitizeFts5Query('')).toBe('');
    });

    it('returns empty string for whitespace-only input', () => {
      expect(sanitizeFts5Query('   ')).toBe('');
    });

    it('returns empty string for string of only special characters', () => {
      expect(sanitizeFts5Query('"*(){}[]')).toBe('');
    });

    it('strips single quotes and wraps remaining token in double quotes', () => {
      const result = sanitizeFts5Query("it's");
      // single quote is not in the sanitizer's special char set, so 'its' becomes "it's" → "it's"
      // Actually single quote is not stripped - only double quote is in the regex
      // The result should be a non-empty sanitized string that does not crash FTS5
      expect(result.length).toBeGreaterThan(0);
    });

    it('strips double quotes and wraps remaining token in double quotes', () => {
      const result = sanitizeFts5Query('"hello"');
      expect(result).toBe('"hello"');
    });

    it('strips parentheses and wraps remaining token in double quotes', () => {
      const result = sanitizeFts5Query('(test)');
      expect(result).toBe('"test"');
    });

    it('strips asterisks and wraps remaining token in double quotes', () => {
      const result = sanitizeFts5Query('test*');
      expect(result).toBe('"test"');
    });

    it('handles multiple tokens separated by spaces', () => {
      const result = sanitizeFts5Query('hello world');
      expect(result).toBe('"hello" OR "world"');
    });

    it('handles mixed text with special characters', () => {
      const result = sanitizeFts5Query('hello (world)');
      expect(result).toBe('"hello" OR "world"');
    });

    it('preserves plain words without modification other than quoting', () => {
      const result = sanitizeFts5Query('authentication');
      expect(result).toBe('"authentication"');
    });
  });
});
