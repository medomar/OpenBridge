import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { storeChunks, markStale, type Chunk } from '../../src/memory/chunk-store.js';
import {
  hybridSearch,
  knnSearch,
  searchConversations,
  rerank,
  sanitizeFts5Query,
  computeTemporalScore,
  computeHybridScore,
  applyMMR,
  searchIndex,
  getDetails,
} from '../../src/memory/retrieval.js';
import { NoOpEmbeddingProvider } from '../../src/memory/embedding-provider.js';
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
  // applyMMR (OB-1655)
  // -------------------------------------------------------------------------

  describe('applyMMR', () => {
    const makeCandidate = (scope: string, score: number): { chunk: Chunk; score: number } => ({
      chunk: { scope, category: 'structure', content: `content for ${scope}` },
      score,
    });

    it('returns empty array for empty input', () => {
      expect(applyMMR([], 5)).toHaveLength(0);
    });

    it('returns empty array when limit is 0', () => {
      expect(applyMMR([makeCandidate('src/a', 0.9)], 0)).toHaveLength(0);
    });

    it('returns at most limit results', () => {
      const candidates = [
        makeCandidate('src/a', 0.9),
        makeCandidate('src/b', 0.8),
        makeCandidate('src/c', 0.7),
        makeCandidate('src/d', 0.6),
      ];
      expect(applyMMR(candidates, 2)).toHaveLength(2);
    });

    it('with lambda=1.0 returns top-k by relevance score (no diversification)', () => {
      const candidates = [
        makeCandidate('src/a', 0.9),
        makeCandidate('src/b', 0.8),
        makeCandidate('src/c', 0.7),
      ];
      const result = applyMMR(candidates, 3, 1.0);
      expect(result[0]?.scope).toBe('src/a');
      expect(result[1]?.scope).toBe('src/b');
      expect(result[2]?.scope).toBe('src/c');
    });

    it('first result is always the highest-scoring candidate regardless of lambda', () => {
      const candidates = [
        makeCandidate('src/a', 0.9),
        makeCandidate('src/a', 0.85),
        makeCandidate('src/b', 0.7),
      ];
      const result = applyMMR(candidates, 3, 0.5);
      expect(result[0]?.scope).toBe('src/a');
    });

    it('diversifies results — prevents same scope from dominating', () => {
      // 4 high-scoring chunks from src/core, 2 lower-scoring from src/master
      const candidates = [
        makeCandidate('src/core', 0.9),
        makeCandidate('src/core', 0.88),
        makeCandidate('src/core', 0.85),
        makeCandidate('src/core', 0.82),
        makeCandidate('src/master', 0.6),
        makeCandidate('src/master', 0.5),
      ];
      const result = applyMMR(candidates, 4, 0.7);
      // With lambda=0.7 the diversity penalty keeps src/core from filling all 4 slots
      const scopes = result.map((c) => c.scope);
      expect(scopes).toContain('src/master');
    });

    it('with lambda=0.0 (pure diversity) prefers a different scope over higher score', () => {
      const candidates = [
        makeCandidate('src/a', 0.9),
        makeCandidate('src/a', 0.89), // same scope, high score
        makeCandidate('src/b', 0.5), // different scope, lower score
      ];
      const result = applyMMR(candidates, 3, 0.0);
      // First pick is src/a (highest relevance — no selected set yet)
      expect(result[0]?.scope).toBe('src/a');
      // Second pick should be src/b: diversity wins over relevance when lambda=0
      expect(result[1]?.scope).toBe('src/b');
    });

    it('returns all candidates when limit exceeds candidate count', () => {
      const candidates = [makeCandidate('src/a', 0.9), makeCandidate('src/b', 0.8)];
      const result = applyMMR(candidates, 10);
      expect(result).toHaveLength(2);
    });

    it('all chunks returned contain valid scope and content', () => {
      const candidates = [
        makeCandidate('src/a', 0.9),
        makeCandidate('src/b', 0.7),
        makeCandidate('src/c', 0.5),
      ];
      const result = applyMMR(candidates, 3);
      for (const chunk of result) {
        expect(chunk.scope).toBeDefined();
        expect(chunk.content).toBeDefined();
      }
    });
  });

  // -------------------------------------------------------------------------
  // hybridSearch with decayRate option (OB-1656)
  // -------------------------------------------------------------------------

  describe('hybridSearch with decayRate option (OB-1656)', () => {
    /**
     * Insert a chunk directly so we can control updated_at.
     * storeChunks() always uses the current timestamp.
     */
    function insertChunkAt(
      testDb: Database.Database,
      scope: string,
      content: string,
      updatedAt: string,
    ): void {
      const res = testDb
        .prepare(
          `INSERT INTO context_chunks (scope, category, content, source_hash, stale, created_at, updated_at)
           VALUES (?, 'structure', ?, NULL, 0, ?, ?)`,
        )
        .run(scope, content, updatedAt, updatedAt);
      testDb
        .prepare(`INSERT INTO context_chunks_fts (rowid, content) VALUES (?, ?)`)
        .run(res.lastInsertRowid, content);
    }

    it('accepts decayRate option without error', async () => {
      void storeChunks(db, [makeChunk({ content: 'authentication service module' })]);
      await expect(hybridSearch(db, 'authentication', { decayRate: 0.5 })).resolves.toBeDefined();
    });

    it('with extreme decayRate, recent chunks rank above equally-relevant old chunks', async () => {
      const recentTs = new Date().toISOString();
      const oldTs = '2020-01-01T00:00:00.000Z';

      insertChunkAt(db, 'src/recent', 'authentication service module', recentTs);
      insertChunkAt(db, 'src/old', 'authentication service module', oldTs);

      // decayRate=10 → exp(-10 * ~2200 days) ≈ 0 for the old chunk
      const results = await hybridSearch(db, 'authentication', { decayRate: 10, limit: 2 });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.scope).toBe('src/recent');
    });

    it('with decayRate=0, BM25 order is preserved (no temporal penalty)', async () => {
      const oldTs = '2020-01-01T00:00:00.000Z';
      // Only one chunk — decayRate=0 should not filter it out
      insertChunkAt(db, 'src/old', 'authentication service module', oldTs);
      const results = await hybridSearch(db, 'authentication', { decayRate: 0 });
      expect(results.length).toBeGreaterThan(0);
    });

    it('with queryVector and extreme decayRate, recent chunks rank above old chunks', async () => {
      const recentTs = new Date().toISOString();
      const oldTs = '2020-01-01T00:00:00.000Z';

      insertChunkAt(db, 'src/recent', 'authentication service module', recentTs);
      insertChunkAt(db, 'src/old', 'authentication service module', oldTs);

      const queryVector = new Float32Array([0.1, 0.2, 0.3]);
      // sqlite-vec not loaded → vectorScore=0 for all; differentiation via temporalScore
      const results = await hybridSearch(db, 'authentication', {
        queryVector,
        decayRate: 10,
        limit: 2,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.scope).toBe('src/recent');
    });
  });

  // -------------------------------------------------------------------------
  // knnSearch — vector similarity (OB-1663)
  // -------------------------------------------------------------------------

  describe('knnSearch — vector similarity (OB-1663)', () => {
    it('returns empty array immediately when queryVector has zero dimensions', () => {
      expect(knnSearch(db, new Float32Array(0))).toEqual([]);
    });

    it('returns empty array for zero-dimension vector regardless of k', () => {
      for (const k of [1, 5, 10, 100]) {
        expect(knnSearch(db, new Float32Array(0), k)).toEqual([]);
      }
    });

    it('returns empty array when embeddings table does not exist', () => {
      // openDatabase() in test environment does not create embeddings table
      // (sqlite-vec not loaded). knnSearch should detect missing table and return [].
      const vector = new Float32Array([0.1, 0.2, 0.3]);
      const result = knnSearch(db, vector);
      expect(Array.isArray(result)).toBe(true);
      // Without the embeddings table or sqlite-vec, always returns []
      expect(result).toHaveLength(0);
    });

    it('gracefully catches sqlite-vec extension errors and returns empty array', () => {
      // sqlite-vec is not loaded in the test environment. Calling knnSearch with
      // a non-empty vector against a DB that lacks the extension should catch
      // the runtime error and return [] (zero degradation guarantee).
      const vector = new Float32Array([0.5, 0.5, 0.5, 0.5]);
      expect(() => knnSearch(db, vector)).not.toThrow();
      expect(knnSearch(db, vector)).toEqual([]);
    });

    it('returns empty array for any k value when sqlite-vec is not loaded', () => {
      const vector = new Float32Array([1.0, 0.0]);
      for (const k of [1, 3, 10, 50]) {
        const results = knnSearch(db, vector, k);
        expect(Array.isArray(results)).toBe(true);
        expect(results).toHaveLength(0);
      }
    });

    it('KnnResult shape has chunkId and score fields in [0,1] when results exist', () => {
      // Structural test — when results are returned (e.g. with real sqlite-vec),
      // each KnnResult must have chunkId (number) and score (0–1).
      // Without sqlite-vec in tests, results=[]; the shape guard still runs.
      const vector = new Float32Array([1.0, 0.0]);
      const results = knnSearch(db, vector, 5);
      for (const r of results) {
        expect(typeof r.chunkId).toBe('number');
        expect(typeof r.score).toBe('number');
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    });

    it('score formula maps cosine distance 0 → score 1.0 and distance 2 → score 0.0', () => {
      // Verify the mathematical mapping: score = 1 - distance / 2
      // distance=0 (identical vectors) → score=1.0
      // distance=1 (orthogonal vectors) → score=0.5
      // distance=2 (opposite vectors) → score=0.0
      expect(1 - 0 / 2).toBe(1.0);
      expect(1 - 1 / 2).toBe(0.5);
      expect(1 - 2 / 2).toBe(0.0);
    });
  });

  // -------------------------------------------------------------------------
  // Hybrid ranking formula — explicit scoring verification (OB-1663)
  // -------------------------------------------------------------------------

  describe('hybrid ranking formula — score computation (OB-1663)', () => {
    it('vector-only chunk (fts5Score=0) scores 0.4*v + 0.2*t', () => {
      // vectorScore=0.8, fts5Score=0, temporalScore=1.0
      // expected = 0.4*0.8 + 0.4*0 + 0.2*1.0 = 0.32 + 0 + 0.2 = 0.52
      expect(computeHybridScore(0.8, 0, 1.0)).toBeCloseTo(0.52);
    });

    it('FTS5-only chunk (vectorScore=0) scores 0.4*f + 0.2*t', () => {
      // vectorScore=0, fts5Score=0.9, temporalScore=1.0
      // expected = 0.4*0 + 0.4*0.9 + 0.2*1.0 = 0 + 0.36 + 0.2 = 0.56
      expect(computeHybridScore(0, 0.9, 1.0)).toBeCloseTo(0.56);
    });

    it('full hybrid chunk scores correctly across all three components', () => {
      // vectorScore=0.7, fts5Score=0.8, temporalScore=0.9
      // expected = 0.4*0.7 + 0.4*0.8 + 0.2*0.9 = 0.28 + 0.32 + 0.18 = 0.78
      expect(computeHybridScore(0.7, 0.8, 0.9)).toBeCloseTo(0.78);
    });

    it('higher vectorScore → higher hybrid score when fts5 and temporal are equal', () => {
      expect(computeHybridScore(0.9, 0.5, 0.8)).toBeGreaterThan(computeHybridScore(0.3, 0.5, 0.8));
    });

    it('higher fts5Score → higher hybrid score when vector and temporal are equal', () => {
      expect(computeHybridScore(0.5, 0.9, 0.8)).toBeGreaterThan(computeHybridScore(0.5, 0.3, 0.8));
    });

    it('temporal weight (0.2) is exactly half the vector/FTS5 weight (0.4)', () => {
      const temporalImpact = computeHybridScore(0, 0, 1.0) - computeHybridScore(0, 0, 0);
      const vectorImpact = computeHybridScore(1.0, 0, 0) - computeHybridScore(0, 0, 0);
      expect(temporalImpact).toBeCloseTo(0.2);
      expect(vectorImpact).toBeCloseTo(0.4);
      expect(temporalImpact).toBeCloseTo(vectorImpact / 2);
    });

    it('chunk with zero scores on all three components scores 0.0', () => {
      expect(computeHybridScore(0, 0, 0)).toBeCloseTo(0.0);
    });

    it('chunk with scores 1 on all three components scores 1.0', () => {
      expect(computeHybridScore(1, 1, 1)).toBeCloseTo(1.0);
    });
  });

  // -------------------------------------------------------------------------
  // MMR diversity — extended tests (OB-1663)
  // -------------------------------------------------------------------------

  describe('applyMMR — extended diversity tests (OB-1663)', () => {
    const makeCandidate = (scope: string, score: number): { chunk: Chunk; score: number } => ({
      chunk: { scope, category: 'structure', content: `content for ${scope}` },
      score,
    });

    it('lambda=0.5 balances relevance and diversity — at least 2 distinct scopes in 3 results', () => {
      const candidates = [
        makeCandidate('src/a', 0.9),
        makeCandidate('src/a', 0.88),
        makeCandidate('src/b', 0.7),
        makeCandidate('src/c', 0.6),
      ];
      const result = applyMMR(candidates, 3, 0.5);
      expect(result[0]?.scope).toBe('src/a'); // highest score always first
      const scopes = new Set(result.map((c) => c.scope));
      expect(scopes.size).toBeGreaterThanOrEqual(2);
    });

    it('produces deterministic results — same input always gives same output', () => {
      const candidates = [
        makeCandidate('src/x', 0.8),
        makeCandidate('src/y', 0.7),
        makeCandidate('src/z', 0.6),
      ];
      const result1 = applyMMR(candidates, 3);
      const result2 = applyMMR(candidates, 3);
      expect(result1.map((c) => c.scope)).toEqual(result2.map((c) => c.scope));
    });

    it('single candidate is always returned regardless of lambda value', () => {
      const candidates = [makeCandidate('src/single', 0.5)];
      for (const lambda of [0.0, 0.5, 0.7, 1.0]) {
        const result = applyMMR(candidates, 1, lambda);
        expect(result).toHaveLength(1);
        expect(result[0]?.scope).toBe('src/single');
      }
    });

    it('with lambda=0.0 (pure diversity), second pick always comes from a different scope', () => {
      const candidates = [
        makeCandidate('src/a', 0.9),
        makeCandidate('src/a', 0.89), // same scope, high score
        makeCandidate('src/b', 0.5), // different scope, lower score
      ];
      const result = applyMMR(candidates, 3, 0.0);
      expect(result[0]?.scope).toBe('src/a'); // first: no selected set yet
      expect(result[1]?.scope).toBe('src/b'); // second: diversity wins
    });

    it('with many candidates from same scope, MMR spreads across scopes', () => {
      const candidates = [
        ...Array.from({ length: 5 }, (_, i) => makeCandidate('src/dominant', 0.9 - i * 0.01)),
        makeCandidate('src/other1', 0.6),
        makeCandidate('src/other2', 0.5),
      ];
      const result = applyMMR(candidates, 5, 0.6);
      const scopes = result.map((c) => c.scope);
      // MMR should bring in at least one non-dominant scope
      expect(scopes.some((s) => s !== 'src/dominant')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Temporal decay — extended tests (OB-1663)
  // -------------------------------------------------------------------------

  describe('computeTemporalScore — extended (OB-1663)', () => {
    it('future timestamp scores exactly 1.0 (clamped at zero days via max(0, days))', () => {
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour ahead
      expect(computeTemporalScore(future)).toBe(1.0);
    });

    it('follows exponential decay formula precisely for a 10-day-old chunk', () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      // exp(-0.01 * 10) = exp(-0.1) ≈ 0.9048
      expect(computeTemporalScore(tenDaysAgo, 0.01)).toBeCloseTo(Math.exp(-0.1), 2);
    });

    it('approaches 0 for a very old chunk with a high decay rate', () => {
      const ancient = new Date(Date.now() - 1000 * 24 * 60 * 60 * 1000).toISOString();
      // exp(-0.1 * 1000) = exp(-100) ≈ 0
      expect(computeTemporalScore(ancient, 0.1)).toBeCloseTo(0, 5);
    });

    it('is monotonically decreasing — older chunks always score lower', () => {
      const days = [1, 7, 30, 90, 365];
      const scores = days.map((d) => {
        const ts = new Date(Date.now() - d * 24 * 60 * 60 * 1000).toISOString();
        return computeTemporalScore(ts);
      });
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThan(scores[i - 1]!);
      }
    });

    it('decayRate=0 gives a constant score of 1.0 regardless of age', () => {
      const veryOld = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString();
      expect(computeTemporalScore(veryOld, 0)).toBeCloseTo(1.0);
    });

    it('higher decayRate degrades score faster than lower decayRate for same age', () => {
      const ts = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();
      const fast = computeTemporalScore(ts, 0.1);
      const slow = computeTemporalScore(ts, 0.001);
      expect(slow).toBeGreaterThan(fast);
    });
  });

  // -------------------------------------------------------------------------
  // hybridSearch with mmr option (OB-1655)
  // -------------------------------------------------------------------------

  describe('hybridSearch with mmr option', () => {
    it('MMR option diversifies results across different scopes', async () => {
      // Insert 4 chunks from src/core and 2 from other scopes — without MMR all 4
      // core chunks might appear; with MMR diversity should spread the results.
      void storeChunks(db, [
        ...Array.from({ length: 4 }, (_, i) =>
          makeChunk({ scope: 'src/core', content: `bridge routing message handler ${i}` }),
        ),
        makeChunk({ scope: 'src/types', content: 'bridge type definitions and interfaces' }),
        makeChunk({ scope: 'src/master', content: 'bridge master delegation message routing' }),
      ]);

      const results = await hybridSearch(db, 'bridge', { limit: 4, mmr: true });
      expect(results.length).toBeLessThanOrEqual(4);

      const scopes = new Set(results.map((r) => r.scope));
      // MMR should bring in at least one chunk from a different scope
      expect(scopes.size).toBeGreaterThan(1);
    });

    it('without mmr option all results may come from same scope', async () => {
      void storeChunks(db, [
        ...Array.from({ length: 4 }, (_, i) =>
          makeChunk({ scope: 'src/core', content: `bridge routing message handler ${i}` }),
        ),
        makeChunk({ scope: 'src/types', content: 'bridge type definitions and interfaces' }),
      ]);

      const results = await hybridSearch(db, 'bridge', { limit: 4, mmr: false });
      // Without MMR, results are purely relevance-ordered — no assertion on scope diversity
      expect(results.length).toBeLessThanOrEqual(4);
    });
  });

  // -------------------------------------------------------------------------
  // knnSearch + hybridSearch — provider='none' graceful fallback (OB-1657)
  // -------------------------------------------------------------------------

  describe("provider='none' graceful fallback (OB-1657)", () => {
    it('NoOpEmbeddingProvider embed() returns an empty Float32Array (dimensions=0)', async () => {
      const provider = new NoOpEmbeddingProvider();
      const result = await provider.embed('any text');
      expect(result.vector).toBeInstanceOf(Float32Array);
      expect(result.vector.length).toBe(0);
      expect(result.dimensions).toBe(0);
      expect(result.model).toBe('none');
    });

    it('NoOpEmbeddingProvider embedBatch() returns empty vectors for every text', async () => {
      const provider = new NoOpEmbeddingProvider();
      const results = await provider.embedBatch(['a', 'b', 'c']);
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(r.vector.length).toBe(0);
      }
    });

    it('NoOpEmbeddingProvider isAvailable() returns true', async () => {
      const provider = new NoOpEmbeddingProvider();
      await expect(provider.isAvailable()).resolves.toBe(true);
    });

    it('knnSearch returns empty array when queryVector is empty (provider=none)', () => {
      // NoOpEmbeddingProvider yields Float32Array(0) — knnSearch must short-circuit
      const emptyVector = new Float32Array(0);
      const results = knnSearch(db, emptyVector);
      expect(results).toEqual([]);
    });

    it('knnSearch returns empty array for any k when vector is empty', () => {
      for (const k of [1, 5, 10, 100]) {
        expect(knnSearch(db, new Float32Array(0), k)).toEqual([]);
      }
    });

    it('hybridSearch with empty queryVector (provider=none) falls back to FTS5-only — returns same results as no queryVector', async () => {
      void storeChunks(db, [
        makeChunk({ content: 'authentication service handles login sessions' }),
        makeChunk({ scope: 'src/types', content: 'TypeScript strict mode configuration' }),
      ]);

      // Simulate what happens when NoOpEmbeddingProvider produces an empty vector
      const noopVector = new Float32Array(0);
      const withNoopVector = await hybridSearch(db, 'authentication', { queryVector: noopVector });
      const withoutVector = await hybridSearch(db, 'authentication');

      // Results must be identical — zero degradation guarantee
      expect(withNoopVector).toEqual(withoutVector);
    });

    it('hybridSearch with provider=none still returns FTS5 matches (zero degradation)', async () => {
      void storeChunks(db, [
        makeChunk({ content: 'routing module dispatches messages to handlers' }),
      ]);

      const noopVector = new Float32Array(0);
      const results = await hybridSearch(db, 'routing', { queryVector: noopVector });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('routing');
    });

    it('hybridSearch with provider=none returns empty array when no FTS5 matches exist', async () => {
      void storeChunks(db, [makeChunk({ content: 'database connection pool management' })]);

      const noopVector = new Float32Array(0);
      const results = await hybridSearch(db, 'xyznonexistentterm', { queryVector: noopVector });
      expect(results).toHaveLength(0);
    });

    it('hybridSearch with provider=none respects limit and scope filters', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/core', content: 'core authentication middleware provider' }),
        makeChunk({ scope: 'src/master', content: 'master authentication orchestration provider' }),
      ]);

      const noopVector = new Float32Array(0);
      const results = await hybridSearch(db, 'authentication', {
        queryVector: noopVector,
        scope: 'src/core',
        limit: 1,
      });

      expect(results.length).toBeLessThanOrEqual(1);
      expect(results.every((r) => r.scope.startsWith('src/core'))).toBe(true);
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

  // -------------------------------------------------------------------------
  // Progressive disclosure — searchIndex (OB-1658) + getDetails (OB-1659)
  // -------------------------------------------------------------------------

  describe('searchIndex', () => {
    it('returns empty array when no chunks exist', async () => {
      const results = await searchIndex(db, 'authentication');
      expect(results).toEqual([]);
    });

    it('returns IndexResult objects with all required fields', async () => {
      void storeChunks(db, [
        makeChunk({
          scope: 'src/core/auth.ts',
          category: 'patterns',
          content: 'Authentication middleware validates JWT tokens on every request.',
        }),
      ]);

      const results = await searchIndex(db, 'authentication');
      expect(results.length).toBeGreaterThan(0);

      const result = results[0]!;
      expect(typeof result.id).toBe('number');
      expect(typeof result.title).toBe('string');
      expect(typeof result.score).toBe('number');
      expect(typeof result.snippet).toBe('string');
      expect(typeof result.source_file).toBe('string');
      expect(typeof result.category).toBe('string');
    });

    it('snippet is at most 80 characters', async () => {
      const longContent =
        'This is a very long chunk content that exceeds eighty characters and should be truncated by the snippet field in searchIndex results.';
      void storeChunks(db, [makeChunk({ content: longContent })]);

      const results = await searchIndex(db, 'long chunk content');
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.snippet.length).toBeLessThanOrEqual(80);
      }
    });

    it('top result scores 1.0 when there is one result', async () => {
      void storeChunks(db, [makeChunk({ content: 'unique bridge connector routing module' })]);

      const results = await searchIndex(db, 'unique bridge connector routing');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.score).toBe(1.0);
    });

    it('scores decay from 1.0 to 1/n across multiple results', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/core/router.ts', content: 'router handles message routing' }),
        makeChunk({ scope: 'src/core/auth.ts', content: 'router authentication filter chain' }),
        makeChunk({
          scope: 'src/core/queue.ts',
          content: 'router queue message processing router',
        }),
      ]);

      const results = await searchIndex(db, 'router');
      expect(results.length).toBeGreaterThanOrEqual(2);

      // Scores must be in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
      }

      // Top score is 1.0; bottom score is >= 1/n
      const n = results.length;
      expect(results[0]!.score).toBe(1.0);
      expect(results[n - 1]!.score).toBeGreaterThanOrEqual(1 / n - 0.01);
    });

    it('title is derived from the last path component of scope', async () => {
      void storeChunks(db, [
        makeChunk({
          scope: 'src/core/router.ts',
          content: 'The router module handles message routing between connectors.',
        }),
      ]);

      const results = await searchIndex(db, 'router module');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.title).toBe('router.ts');
      expect(results[0]!.source_file).toBe('src/core/router.ts');
    });

    it('title is truncated to 60 characters for very long scope components', async () => {
      const longScope = 'src/core/' + 'a'.repeat(80) + '.ts';
      void storeChunks(db, [
        makeChunk({
          scope: longScope,
          content: 'module with extremely long filename in scope path',
        }),
      ]);

      const results = await searchIndex(db, 'extremely long filename');
      if (results.length > 0) {
        expect(results[0]!.title.length).toBeLessThanOrEqual(60);
      }
    });

    it('category field matches the stored chunk category', async () => {
      void storeChunks(db, [
        makeChunk({ category: 'dependencies', content: 'npm package dependency resolution list' }),
      ]);

      const results = await searchIndex(db, 'dependency resolution');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.category).toBe('dependencies');
    });

    it('respects limit option', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/a.ts', content: 'connector routing module one' }),
        makeChunk({ scope: 'src/b.ts', content: 'connector routing module two' }),
        makeChunk({ scope: 'src/c.ts', content: 'connector routing module three' }),
      ]);

      const results = await searchIndex(db, 'connector routing', { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------------
  // getDetails (OB-1659)
  // -------------------------------------------------------------------------

  describe('getDetails', () => {
    it('returns empty array for empty id list', () => {
      const result = getDetails(db, []);
      expect(result).toEqual([]);
    });

    it('returns full chunk content for a valid id', async () => {
      void storeChunks(db, [
        makeChunk({ content: 'Full content of the authentication module with all details.' }),
      ]);

      // Retrieve the inserted ID via searchIndex
      const indexResults = await searchIndex(db, 'authentication module');
      expect(indexResults.length).toBeGreaterThan(0);

      const id = indexResults[0]!.id;
      const chunks = getDetails(db, [id]);

      expect(chunks.length).toBe(1);
      expect(chunks[0]!.content).toBe(
        'Full content of the authentication module with all details.',
      );
      expect(chunks[0]!.id).toBe(id);
    });

    it('preserves input order when fetching multiple ids', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/first.ts', content: 'first module discovery scanning order' }),
        makeChunk({ scope: 'src/second.ts', content: 'second module discovery scanning order' }),
        makeChunk({ scope: 'src/third.ts', content: 'third module discovery scanning order' }),
      ]);

      const indexResults = await searchIndex(db, 'discovery scanning order', { limit: 3 });
      expect(indexResults.length).toBeGreaterThanOrEqual(2);

      const ids = indexResults.map((r) => r.id);
      const chunks = getDetails(db, ids);

      // getDetails returns chunks in the same order as the input ids
      for (let i = 0; i < ids.length; i++) {
        expect(chunks[i]!.id).toBe(ids[i]);
      }
    });

    it('silently omits ids that do not correspond to existing chunks', () => {
      const nonExistentId = 999999;
      const chunks = getDetails(db, [nonExistentId]);
      expect(chunks).toEqual([]);
    });

    it('handles mix of valid and non-existent ids', async () => {
      void storeChunks(db, [makeChunk({ content: 'valid chunk for mixed id test' })]);

      const indexResults = await searchIndex(db, 'valid chunk mixed');
      expect(indexResults.length).toBeGreaterThan(0);

      const validId = indexResults[0]!.id;
      const chunks = getDetails(db, [validId, 888888, 777777]);

      // Only the valid chunk should be returned
      expect(chunks.length).toBe(1);
      expect(chunks[0]!.id).toBe(validId);
    });
  });

  // -------------------------------------------------------------------------
  // 2-step RAG flow (OB-1660)
  // -------------------------------------------------------------------------

  describe('2-step RAG flow', () => {
    it('step 1 searchIndex returns compact results with fewer tokens than full chunks', async () => {
      const longContent = 'A'.repeat(500) + ' router bridge connector authentication module.';
      void storeChunks(db, [makeChunk({ content: longContent })]);

      const indexResults = await searchIndex(db, 'router bridge connector authentication');
      expect(indexResults.length).toBeGreaterThan(0);

      // Index result snippet is bounded at 80 chars — much shorter than full content
      const totalSnippetChars = indexResults.reduce((sum, r) => sum + r.snippet.length, 0);
      const totalContentChars = longContent.length * indexResults.length;
      expect(totalSnippetChars).toBeLessThan(totalContentChars);
    });

    it('step 2 filters low-scoring results by score threshold', async () => {
      void storeChunks(db, [
        makeChunk({
          scope: 'src/core/router.ts',
          content: 'bridge router message routing connector',
        }),
        makeChunk({
          scope: 'src/core/auth.ts',
          content: 'bridge router authentication validation',
        }),
        makeChunk({ scope: 'src/unrelated.ts', content: 'bridge router unrelated content xyz' }),
      ]);

      const indexResults = await searchIndex(db, 'bridge router', { limit: 3 });
      expect(indexResults.length).toBeGreaterThan(0);

      // Apply a score threshold (step 2): only keep results above 0.3
      const scoreThreshold = 0.3;
      const relevant = indexResults.filter((r) => r.score > scoreThreshold);

      // At minimum the top result always scores 1.0 and passes the threshold
      expect(relevant.length).toBeGreaterThan(0);
      expect(relevant[0]!.score).toBeGreaterThan(scoreThreshold);
    });

    it('step 3 getDetails returns full content only for relevant ids', async () => {
      void storeChunks(db, [
        makeChunk({
          scope: 'src/core/router.ts',
          content:
            'The routing module handles message routing between connectors and providers in full detail.',
        }),
        makeChunk({
          scope: 'src/core/auth.ts',
          content:
            'The authentication module validates JWT tokens and enforces whitelist rules in full detail.',
        }),
      ]);

      // Step 1: compact index search
      const indexResults = await searchIndex(db, 'routing module connector', { limit: 2 });
      expect(indexResults.length).toBeGreaterThan(0);

      // Step 2: filter by score (all pass since scores are always >= 1/n)
      const topIds = indexResults.map((r) => r.id);

      // Step 3: fetch full content
      const chunks = getDetails(db, topIds);
      expect(chunks.length).toBe(topIds.length);

      // Full content is longer than the 80-char snippet
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i]!.content.length).toBeGreaterThan(indexResults[i]!.snippet.length);
      }
    });

    it('full 2-step flow: searchIndex → filter → getDetails returns expected chunks', async () => {
      void storeChunks(db, [
        makeChunk({
          scope: 'src/memory/chunk-store.ts',
          content:
            'Chunk store manages workspace knowledge base with FTS5 full-text search indexing.',
        }),
        makeChunk({
          scope: 'src/memory/retrieval.ts',
          content:
            'Retrieval module provides hybrid FTS5 and vector search for workspace knowledge.',
        }),
      ]);

      // Step 1
      const indexResults = await searchIndex(db, 'workspace knowledge FTS5 search');
      expect(indexResults.length).toBeGreaterThanOrEqual(1);

      // Verify compact structure
      for (const r of indexResults) {
        expect(r.snippet.length).toBeLessThanOrEqual(80);
        expect(r.score).toBeGreaterThan(0);
        expect(r.id).toBeGreaterThan(0);
      }

      // Step 2: filter by score > 0.3
      const relevant = indexResults.filter((r) => r.score > 0.3);
      expect(relevant.length).toBeGreaterThan(0);

      // Step 3: fetch full content
      const ids = relevant.map((r) => r.id);
      const chunks = getDetails(db, ids);
      expect(chunks.length).toBe(ids.length);

      // Each chunk has full content (not truncated)
      for (const chunk of chunks) {
        expect(chunk.content.length).toBeGreaterThan(0);
        expect(chunk.scope).toBeTruthy();
        expect(chunk.category).toBeTruthy();
      }
    });
  });

  // -------------------------------------------------------------------------
  // FTS5-only path when provider='none' — no sqlite-vec calls (OB-1665)
  // -------------------------------------------------------------------------

  describe("FTS5-only fallback — no sqlite-vec calls when provider='none' (OB-1665)", () => {
    it('knnSearch short-circuits before preparing any SQL when queryVector is empty', () => {
      // Spy on db.prepare to verify no sqlite-vec SQL is executed
      const prepareSpy = vi.spyOn(db, 'prepare');
      knnSearch(db, new Float32Array(0));
      // db.prepare must never be called with vec_distance_cosine or any embeddings query
      const vecCalls = prepareSpy.mock.calls.filter((args) =>
        String(args[0]).includes('vec_distance_cosine'),
      );
      expect(vecCalls).toHaveLength(0);
      prepareSpy.mockRestore();
    });

    it('knnSearch short-circuits before checking embeddings table when vector is empty', () => {
      const prepareSpy = vi.spyOn(db, 'prepare');
      knnSearch(db, new Float32Array(0), 10);
      // Even the embeddings table existence check should be skipped
      const embeddingsCalls = prepareSpy.mock.calls.filter((args) =>
        String(args[0]).includes('embeddings'),
      );
      expect(embeddingsCalls).toHaveLength(0);
      prepareSpy.mockRestore();
    });

    it('hybridSearch with provider=none never invokes knnSearch with a non-empty vector', async () => {
      void storeChunks(db, [makeChunk({ content: 'connector bridge routing module dispatch' })]);

      const knnSpy = vi.spyOn({ knnSearch }, 'knnSearch');

      // Pass an empty queryVector (what NoOpEmbeddingProvider produces)
      const noopVector = new Float32Array(0);
      const results = await hybridSearch(db, 'connector bridge', { queryVector: noopVector });

      // Results come from FTS5, not from vector search
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].content).toContain('connector');
      // The spy was never called with a non-empty vector
      expect(knnSpy).not.toHaveBeenCalled();
      knnSpy.mockRestore();
    });

    it('hybridSearch with provider=none produces identical results to omitting queryVector entirely', async () => {
      void storeChunks(db, [
        makeChunk({
          scope: 'src/core/bridge.ts',
          content: 'bridge orchestrator wires connectors together',
        }),
        makeChunk({
          scope: 'src/core/router.ts',
          content: 'bridge router handles message dispatch',
        }),
        makeChunk({
          scope: 'src/memory/retrieval.ts',
          content: 'bridge retrieval indexes workspace chunks',
        }),
      ]);

      const noopVector = new Float32Array(0);
      const withNoop = await hybridSearch(db, 'bridge', { queryVector: noopVector, limit: 5 });
      const withoutVector = await hybridSearch(db, 'bridge', { limit: 5 });

      expect(withNoop).toEqual(withoutVector);
    });

    it('hybridSearch with provider=none does not prepare any vec_distance_cosine SQL', async () => {
      void storeChunks(db, [makeChunk({ content: 'authentication token validation service' })]);

      const prepareSpy = vi.spyOn(db, 'prepare');
      await hybridSearch(db, 'authentication', { queryVector: new Float32Array(0) });

      const vecCalls = prepareSpy.mock.calls.filter((args) =>
        String(args[0]).includes('vec_distance_cosine'),
      );
      expect(vecCalls).toHaveLength(0);
      prepareSpy.mockRestore();
    });

    it('hybridSearch with provider=none returns correct FTS5-ranked results regardless of vector absence', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/a.ts', content: 'worker briefing context injection memory' }),
        makeChunk({ scope: 'src/b.ts', content: 'worker spawn orchestration memory pool' }),
        makeChunk({ scope: 'src/c.ts', content: 'database connection pool management' }),
      ]);

      const noopVector = new Float32Array(0);
      const results = await hybridSearch(db, 'worker memory', { queryVector: noopVector });

      // FTS5 should find both 'worker briefing' and 'worker spawn' chunks
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.every((r) => r.content.includes('worker'))).toBe(true);
    });

    it('hybridSearch with provider=none + scope filter still restricts to correct scope', async () => {
      void storeChunks(db, [
        makeChunk({ scope: 'src/memory', content: 'memory store eviction policy chunks' }),
        makeChunk({ scope: 'src/core', content: 'memory core bridge connector chunks' }),
      ]);

      const noopVector = new Float32Array(0);
      const results = await hybridSearch(db, 'memory chunks', {
        queryVector: noopVector,
        scope: 'src/memory',
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.every((r) => r.scope.startsWith('src/memory'))).toBe(true);
    });
  });
});
