import type Database from 'better-sqlite3';
import type { Chunk } from './chunk-store.js';
import type { ConversationEntry } from './index.js';
import type { AgentRunner } from '../core/agent-runner.js';
import {
  type Observation,
  searchObservations as _searchObservationsStore,
} from './observation-store.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchOptions {
  /** Path prefix filter — only return chunks whose scope starts with this value. */
  scope?: string;
  /** Category filter. */
  category?: 'structure' | 'patterns' | 'dependencies' | 'api' | 'config';
  /** Maximum number of results to return (default 10). */
  limit?: number;
  /** Exclude stale chunks (default true). */
  excludeStale?: boolean;
  /** Enable AI-powered reranking when > 10 results are returned (default false). */
  rerank?: boolean;
  /** Working directory for the AI reranker (required when rerank is true). */
  workspacePath?: string;
  /**
   * Query embedding vector for hybrid (vector + FTS5) scoring.
   * When provided and non-empty, enables hybrid scoring:
   *   0.4 * vectorScore + 0.4 * fts5Score + 0.2 * temporalScore
   * Chunks from both FTS5 and KNN results are merged into a single ranked list.
   */
  queryVector?: Float32Array;
}

interface ChunkRow {
  id: number;
  scope: string;
  category: Chunk['category'];
  content: string;
  source_hash: string | null;
  created_at: string;
  updated_at: string;
  stale: number;
}

function rowToChunk(row: ChunkRow): Chunk {
  return {
    id: row.id,
    scope: row.scope,
    category: row.category,
    content: row.content,
    source_hash: row.source_hash ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    stale: row.stale === 1,
  };
}

interface ConversationRow {
  id: number;
  session_id: string;
  role: ConversationEntry['role'];
  content: string;
  channel: string | null;
  user_id: string | null;
  created_at: string;
}

function rowToEntry(row: ConversationRow): ConversationEntry {
  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content: row.content,
    channel: row.channel ?? undefined,
    user_id: row.user_id ?? undefined,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Hybrid scoring helpers (OB-1654)
// ---------------------------------------------------------------------------

/** Extended ChunkRow that also carries the raw BM25 rank from FTS5. */
interface ChunkRowWithRank extends ChunkRow {
  bm25_rank: number;
}

/**
 * Compute a recency-based temporal score in the range [0, 1].
 *
 * Uses exponential decay: `exp(-decayRate * daysSinceUpdate)`.
 * A chunk updated today scores ≈ 1.0; one updated 100 days ago with the
 * default rate (0.01) scores ≈ 0.37.
 *
 * @param updatedAt  ISO-8601 timestamp string (e.g. `chunk.updated_at`)
 * @param decayRate  Decay rate per day (default 0.01 — configurable in OB-1656)
 */
export function computeTemporalScore(updatedAt: string, decayRate = 0.01): number {
  const daysSince = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.exp(-decayRate * Math.max(0, daysSince));
}

/**
 * Compute the hybrid retrieval score from three component scores.
 *
 * Formula: `0.4 * vectorScore + 0.4 * fts5Score + 0.2 * temporalScore`
 *
 * All inputs are expected to be in the range [0, 1].
 */
export function computeHybridScore(
  vectorScore: number,
  fts5Score: number,
  temporalScore: number,
): number {
  return 0.4 * vectorScore + 0.4 * fts5Score + 0.2 * temporalScore;
}

/**
 * Normalize an array of raw BM25 rank values (negative; more negative = better)
 * to the range [0, 1] (higher = more relevant) using min–max normalization.
 *
 * - Single-element arrays return `[1.0]`.
 * - If all ranks are equal, every element returns `1.0`.
 */
function normalizeBm25(ranks: number[]): number[] {
  if (ranks.length === 0) return [];
  if (ranks.length === 1) return [1.0];

  // Negate so that a higher value means higher relevance
  const raw = ranks.map((r) => -r);
  const minRaw = Math.min(...raw);
  const maxRaw = Math.max(...raw);

  if (maxRaw === minRaw) return ranks.map(() => 1.0);
  return raw.map((r) => (r - minRaw) / (maxRaw - minRaw));
}

/**
 * Run FTS5 search and return chunks paired with their raw BM25 rank.
 * Used by the hybrid scoring path to obtain per-chunk BM25 relevance values.
 */
function fts5SearchWithRanks(
  db: Database.Database,
  sanitized: string,
  options: SearchOptions,
  fetchLimit: number,
): Array<{ chunk: Chunk; bm25Rank: number }> {
  const { scope, category, excludeStale = true } = options;

  const conditions: string[] = [];
  const extraParams: (string | number)[] = [];

  if (excludeStale) conditions.push('c.stale = 0');
  if (scope !== undefined) {
    conditions.push('c.scope LIKE ?');
    extraParams.push(`${scope}%`);
  }
  if (category !== undefined) {
    conditions.push('c.category = ?');
    extraParams.push(category);
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT c.id, c.scope, c.category, c.content, c.source_hash,
           c.created_at, c.updated_at, c.stale, fts.bm25_rank
    FROM context_chunks c
    INNER JOIN (
      SELECT rowid, rank AS bm25_rank
      FROM context_chunks_fts
      WHERE context_chunks_fts MATCH ?
    ) fts ON c.id = fts.rowid
    WHERE 1=1 ${whereClause}
    ORDER BY fts.bm25_rank
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(sanitized, ...extraParams, fetchLimit) as ChunkRowWithRank[];
  return rows.map((row) => ({ chunk: rowToChunk(row), bm25Rank: row.bm25_rank }));
}

/**
 * Hybrid search that merges vector KNN results and FTS5 results, then scores
 * each chunk with the weighted formula:
 *   `0.4 * vectorScore + 0.4 * fts5Score + 0.2 * temporalScore`
 *
 * Chunks that appear only in KNN results receive `fts5Score = 0`.
 * Chunks that appear only in FTS5 results receive `vectorScore = 0`.
 * All chunks receive a temporal score based on their `updated_at` timestamp.
 */
async function hybridSearchWithVectorScoring(
  db: Database.Database,
  query: string,
  sanitized: string,
  queryVector: Float32Array,
  options: SearchOptions,
  agentRunner?: AgentRunner,
): Promise<Chunk[]> {
  const { limit = 10 } = options;
  // Fetch more candidates than needed so the merge has enough material to work with
  const candidateLimit = limit * 3;

  // --- FTS5 candidates ---
  const fts5Results = fts5SearchWithRanks(db, sanitized, options, candidateLimit);

  // --- Vector KNN candidates ---
  const knnResults = knnSearch(db, queryVector, candidateLimit);

  // Build a unified map: chunkId → { chunk, bm25Rank | null, vectorScore }
  type Entry = { chunk: Chunk; bm25Rank: number | null; vectorScore: number };
  const chunkMap = new Map<number, Entry>();

  for (const { chunk, bm25Rank } of fts5Results) {
    if (chunk.id !== undefined) {
      chunkMap.set(chunk.id, { chunk, bm25Rank, vectorScore: 0 });
    }
  }

  // Fetch full chunk rows for any KNN-only hits (not already in FTS5 results)
  const knnOnlyIds = knnResults.map((r) => r.chunkId).filter((id) => !chunkMap.has(id));

  if (knnOnlyIds.length > 0) {
    const placeholders = knnOnlyIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT id, scope, category, content, source_hash, created_at, updated_at, stale
         FROM context_chunks WHERE id IN (${placeholders})`,
      )
      .all(...knnOnlyIds) as ChunkRow[];

    for (const row of rows) {
      chunkMap.set(row.id, { chunk: rowToChunk(row), bm25Rank: null, vectorScore: 0 });
    }
  }

  // Apply vector scores from KNN results
  for (const { chunkId, score } of knnResults) {
    const entry = chunkMap.get(chunkId);
    if (entry !== undefined) {
      entry.vectorScore = score;
    }
  }

  // Normalize BM25 ranks across all FTS5 results → [0, 1]
  const bm25Ranks = fts5Results.map((r) => r.bm25Rank);
  const normalizedBm25 = normalizeBm25(bm25Ranks);
  const bm25NormMap = new Map<number, number>();
  for (let i = 0; i < fts5Results.length; i++) {
    const r = fts5Results[i];
    const n = normalizedBm25[i];
    if (r !== undefined && n !== undefined && r.chunk.id !== undefined) {
      bm25NormMap.set(r.chunk.id, n);
    }
  }

  // Score every candidate chunk and sort descending
  const scored = Array.from(chunkMap.entries()).map(([id, { chunk, vectorScore }]) => {
    const fts5Score = bm25NormMap.get(id) ?? 0;
    const temporalScore = computeTemporalScore(chunk.updated_at ?? new Date().toISOString());
    const hybridScore = computeHybridScore(vectorScore, fts5Score, temporalScore);
    return { chunk, hybridScore };
  });

  scored.sort((a, b) => b.hybridScore - a.hybridScore);

  const chunks = scored.slice(0, limit).map((s) => s.chunk);

  // Optional AI reranking (same threshold as FTS5-only path)
  if (options.rerank && agentRunner && chunks.length > 10) {
    const reranked = await rerank(chunks, query, agentRunner, options.workspacePath);
    trackReadTokens(db, reranked);
    return reranked;
  }

  trackReadTokens(db, chunks);
  return chunks;
}

// ---------------------------------------------------------------------------
// AI-powered reranking (OB-721)
// ---------------------------------------------------------------------------

/**
 * Use AgentRunner to semantically rerank chunks by relevance to a query.
 *
 * Spawns a quick haiku call that scores each chunk and returns a ranked order.
 * Falls back to the original BM25 order if the AI call fails or times out.
 *
 * @param chunks      Chunks to rerank (should have > 10 for reranking to be worthwhile)
 * @param query       The search query that produced the chunks
 * @param agentRunner AgentRunner instance used to spawn the AI call
 * @param workspacePath Working directory for the agent (defaults to process.cwd())
 */
export async function rerank(
  chunks: Chunk[],
  query: string,
  agentRunner: AgentRunner,
  workspacePath = process.cwd(),
): Promise<Chunk[]> {
  if (chunks.length === 0) return chunks;

  // Build a numbered list of chunk summaries (truncate content for token budget)
  const numberedList = chunks
    .map(
      (chunk, i) =>
        `[${i + 1}] scope=${chunk.scope} category=${chunk.category}\n${chunk.content.slice(0, 200)}`,
    )
    .join('\n\n');

  const prompt =
    `Rank these ${chunks.length} text chunks by relevance to the query: "${query}"\n\n` +
    `${numberedList}\n\n` +
    `Reply with ONLY a comma-separated list of chunk numbers from most to least relevant. ` +
    `Example for 5 chunks: 3,1,5,2,4`;

  try {
    const result = await agentRunner.spawn({
      prompt,
      workspacePath,
      model: 'haiku',
      maxTurns: 1,
      timeout: 15_000,
      retries: 0,
    });

    if (result.exitCode !== 0 || !result.stdout.trim()) return chunks;

    // Parse "3,1,5,2,4" — convert 1-based to 0-based indices
    const indices = result.stdout
      .trim()
      .split(',')
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((i) => Number.isFinite(i) && i >= 0 && i < chunks.length);

    if (indices.length === 0) return chunks;

    // Build reranked array; append any chunks not mentioned in the ranking
    const seen = new Set<number>();
    const reranked: Chunk[] = [];

    for (const i of indices) {
      const chunk = chunks[i];
      if (!seen.has(i) && chunk !== undefined) {
        seen.add(i);
        reranked.push(chunk);
      }
    }

    // Append remaining chunks in original BM25 order
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!seen.has(i) && chunk !== undefined) {
        reranked.push(chunk);
      }
    }

    return reranked;
  } catch {
    // Any error (timeout, spawn failure, parse error) → return original order
    return chunks;
  }
}

// ---------------------------------------------------------------------------
// Token economics helpers
// ---------------------------------------------------------------------------

/** Estimated characters per token — matches OpenAI / Anthropic rule of thumb. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate the number of tokens in a string using the chars-to-tokens ratio (÷4).
 */
function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}

/**
 * Update `total_read_tokens` and `last_read_at` in `token_economics` for each
 * retrieved chunk. Uses UPSERT so rows are created if they don't exist yet.
 * Gracefully skips if the `token_economics` table does not exist (e.g. older
 * databases that haven't run migration 14).
 */
function trackReadTokens(db: Database.Database, chunks: Chunk[]): void {
  if (chunks.length === 0) return;

  const tableExists =
    (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='token_economics'`,
        )
        .get() as { c: number }
    ).c > 0;

  if (!tableExists) return;

  const nowIso = new Date().toISOString();

  const upsert = db.prepare(`
    INSERT INTO token_economics (chunk_id, discovery_tokens, retrieval_count, total_read_tokens, created_at, last_read_at)
    VALUES (?, 0, 1, ?, ?, ?)
    ON CONFLICT (chunk_id) DO UPDATE SET
      retrieval_count = retrieval_count + 1,
      total_read_tokens = total_read_tokens + excluded.total_read_tokens,
      last_read_at = excluded.last_read_at
  `);

  const updateAll = db.transaction(() => {
    for (const chunk of chunks) {
      if (chunk.id === undefined) continue;
      upsert.run(chunk.id, estimateTokens(chunk.content), nowIso, nowIso);
    }
  });

  updateAll();
}

// ---------------------------------------------------------------------------
// Vector similarity search (sqlite-vec KNN)
// ---------------------------------------------------------------------------

/** A single result from {@link knnSearch}: chunk ID paired with its similarity score. */
export interface KnnResult {
  /** Primary key of the matching row in `context_chunks`. */
  chunkId: number;
  /**
   * Cosine similarity score in the range [0, 1].
   * Computed as `1 - cosine_distance` where 0 = completely dissimilar,
   * 1 = identical direction. Higher is more relevant.
   */
  score: number;
}

/**
 * Vector similarity search over the `embeddings` table using the sqlite-vec
 * extension and cosine distance.
 *
 * Returns the top-K most similar chunks ordered by descending similarity
 * (highest score first). Returns an empty array when:
 * - `queryVector` has zero dimensions (NoOpEmbeddingProvider / provider='none')
 * - The `embeddings` table does not exist (database predates OB-1646)
 * - The `sqlite-vec` extension is not loaded (graceful fallback)
 * - No embeddings are stored yet
 *
 * @param db           SQLite database instance (must have sqlite-vec loaded)
 * @param queryVector  Float32Array embedding of the search query
 * @param k            Maximum number of results to return (default 10)
 */
export function knnSearch(db: Database.Database, queryVector: Float32Array, k = 10): KnnResult[] {
  // No-op when the vector is empty (NoOpEmbeddingProvider, provider='none')
  if (queryVector.length === 0) return [];

  // Gracefully skip if the embeddings table does not exist
  const tableExists =
    (
      db
        .prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='embeddings'`)
        .get() as { c: number }
    ).c > 0;
  if (!tableExists) return [];

  try {
    // sqlite-vec vec_distance_cosine() returns values in [0, 2] (0 = identical,
    // 2 = opposite directions). We normalise to cosine similarity [0, 1] by
    // computing `1 - distance / 2` so the result is directly comparable to
    // FTS5 / temporal scores used by the hybrid ranker (OB-1654).
    const vectorBlob = Buffer.from(
      queryVector.buffer,
      queryVector.byteOffset,
      queryVector.byteLength,
    );

    const rows = db
      .prepare(
        `SELECT chunk_id, vec_distance_cosine(vector, ?) AS distance
         FROM embeddings
         ORDER BY distance ASC
         LIMIT ?`,
      )
      .all(vectorBlob, k) as { chunk_id: number; distance: number }[];

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      score: 1 - row.distance / 2,
    }));
  } catch {
    // sqlite-vec extension not loaded or other runtime error — fall back
    // gracefully so callers can degrade to FTS5-only search (OB-1657).
    return [];
  }
}

// ---------------------------------------------------------------------------
// Hybrid FTS5 + metadata search
// ---------------------------------------------------------------------------

/**
 * Fetch the most recent chunks ordered by updated_at descending.
 * Used as a fallback when the FTS5 query is empty (e.g. query is all stop words
 * or special characters that sanitize away to nothing).
 */
function recentChunksFallback(
  db: Database.Database,
  options: SearchOptions = {},
  fallbackLimit = 20,
): Chunk[] {
  const { scope, category, excludeStale = true } = options;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (excludeStale) conditions.push('stale = 0');
  if (scope !== undefined) {
    conditions.push('scope LIKE ?');
    params.push(`${scope}%`);
  }
  if (category !== undefined) {
    conditions.push('category = ?');
    params.push(category);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `
    SELECT id, scope, category, content, source_hash, created_at, updated_at, stale
    FROM context_chunks
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT ?
  `;

  return (db.prepare(sql).all(...params, fallbackLimit) as ChunkRow[]).map(rowToChunk);
}

/**
 * Hybrid search over context chunks using FTS5 full-text search combined with
 * metadata filters and BM25 ranking.
 *
 * Layers:
 *   1. FTS5 MATCH — fast sub-millisecond keyword search
 *   2. Metadata filters — scope prefix, category, stale flag
 *   3. BM25 ordering — SQLite's built-in ranking (lower rank = more relevant)
 *   4. AI reranking (optional, Layer 4) — enabled via options.rerank when > 10 results
 *
 * When the sanitized FTS5 query is empty (all tokens are special characters or
 * the original query is blank), falls back to the 20 most recently updated
 * chunks so callers always receive something useful.
 *
 * @param agentRunner Optional AgentRunner for AI reranking (required when options.rerank is true)
 */
export async function hybridSearch(
  db: Database.Database,
  query: string,
  options: SearchOptions = {},
  agentRunner?: AgentRunner,
): Promise<Chunk[]> {
  // Sanitize the query for FTS5 MATCH — user prompts may contain special FTS5
  // operators (?, *, ^, etc.) that cause SQLITE_ERROR if passed through raw.
  const sanitized = query.trim() ? sanitizeFts5Query(query) : '';

  // If the sanitized query is empty, fall back to recent chunks by timestamp
  // so callers always receive context rather than an empty array.
  if (!sanitized) {
    const fallbackChunks = recentChunksFallback(db, options);
    trackReadTokens(db, fallbackChunks);
    return fallbackChunks;
  }

  // Hybrid scoring path (OB-1654) — when a queryVector is provided and non-empty,
  // merge FTS5 and KNN results and score with the weighted formula.
  if (options.queryVector !== undefined && options.queryVector.length > 0) {
    return hybridSearchWithVectorScoring(
      db,
      query,
      sanitized,
      options.queryVector,
      options,
      agentRunner,
    );
  }

  const { scope, category, limit = 10, excludeStale = true } = options;

  // Build optional WHERE conditions for the outer query
  const conditions: string[] = [];
  const extraParams: (string | number)[] = [];

  if (excludeStale) {
    conditions.push('c.stale = 0');
  }
  if (scope !== undefined) {
    conditions.push('c.scope LIKE ?');
    extraParams.push(`${scope}%`);
  }
  if (category !== undefined) {
    conditions.push('c.category = ?');
    extraParams.push(category);
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  // The FTS5 `rank` hidden column returns the BM25 score for each matching row.
  // Lower (more negative) values indicate higher relevance.
  const sql = `
    SELECT c.id, c.scope, c.category, c.content, c.source_hash,
           c.created_at, c.updated_at, c.stale
    FROM context_chunks c
    INNER JOIN (
      SELECT rowid, rank AS bm25_rank
      FROM context_chunks_fts
      WHERE context_chunks_fts MATCH ?
    ) fts ON c.id = fts.rowid
    WHERE 1=1 ${whereClause}
    ORDER BY fts.bm25_rank
    LIMIT ?
  `;

  const rows = db.prepare(sql).all(sanitized, ...extraParams, limit) as ChunkRow[];
  const chunks = rows.map(rowToChunk);

  // Layer 4: AI reranking — only when explicitly enabled and results exceed 10
  if (options.rerank && agentRunner && chunks.length > 10) {
    const reranked = await rerank(chunks, query, agentRunner, options.workspacePath);
    trackReadTokens(db, reranked);
    return reranked;
  }

  trackReadTokens(db, chunks);
  return chunks;
}

// ---------------------------------------------------------------------------
// FTS5 query sanitization (shared)
// ---------------------------------------------------------------------------

/**
 * Sanitize a user-provided string for use in an FTS5 MATCH expression.
 * Strips special FTS5 syntax characters and wraps each token in double quotes.
 * Multiple tokens are OR-joined so that any matching term returns results,
 * instead of AND-joining (which requires all terms to match and causes
 * natural-language questions to return zero results).
 * Returns an empty string if no usable tokens remain.
 */
export function sanitizeFts5Query(raw: string): string {
  const cleaned = raw.replace(/["*(){}[\]:^~?@#$%&\\|<>=!+,;]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' OR ');
}

// ---------------------------------------------------------------------------
// Combined observation + chunk search
// ---------------------------------------------------------------------------

/** Result type returned by the combined search. */
export interface CombinedSearchResult {
  observations: Observation[];
  chunks: Chunk[];
}

/**
 * Combined search over observations (FTS5) and context chunks (hybridSearch).
 *
 * Runs both searches in parallel and returns a unified result containing
 * matching observations and relevant chunks for the same query.
 *
 * @param db               SQLite database instance
 * @param query            Search query
 * @param options          Options passed through to hybridSearch; additionally
 *                         accepts `observationLimit` (default 10)
 * @param agentRunner      Optional AgentRunner for AI reranking of chunks
 */
export async function searchObservations(
  db: Database.Database,
  query: string,
  options: SearchOptions & { observationLimit?: number } = {},
  agentRunner?: AgentRunner,
): Promise<CombinedSearchResult> {
  const { observationLimit = 10, ...chunkOptions } = options;

  const [observations, chunks] = await Promise.all([
    Promise.resolve(_searchObservationsStore(db, query, observationLimit)),
    hybridSearch(db, query, chunkOptions, agentRunner),
  ]);

  return { observations, chunks };
}

// ---------------------------------------------------------------------------
// Conversation search
// ---------------------------------------------------------------------------

/**
 * Full-text search over past conversations using `conversations_fts`.
 * Results are BM25-ranked for relevance, then sorted by recency within
 * equal-relevance groups.
 *
 * Returns up to `limit` matching entries (default 10).
 */
export function searchConversations(
  db: Database.Database,
  query: string,
  limit = 10,
): ConversationEntry[] {
  if (!query.trim()) return [];

  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];

  const rows = db
    .prepare(
      `SELECT c.id, c.session_id, c.role, c.content, c.channel, c.user_id, c.created_at
       FROM conversations c
       INNER JOIN (
         SELECT rowid, rank AS bm25_rank
         FROM conversations_fts
         WHERE conversations_fts MATCH ?
       ) fts ON c.id = fts.rowid
       ORDER BY fts.bm25_rank, c.created_at DESC
       LIMIT ?`,
    )
    .all(sanitized, limit) as ConversationRow[];

  return rows.map(rowToEntry);
}
