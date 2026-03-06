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
    INSERT INTO token_economics (chunk_id, discovery_tokens, total_read_tokens, created_at, last_read_at)
    VALUES (?, 0, ?, ?, ?)
    ON CONFLICT (chunk_id) DO UPDATE SET
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
