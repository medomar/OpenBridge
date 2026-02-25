import type Database from 'better-sqlite3';
import type { Chunk } from './chunk-store.js';
import type { ConversationEntry } from './index.js';

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
// Hybrid FTS5 + metadata search
// ---------------------------------------------------------------------------

/**
 * Hybrid search over context chunks using FTS5 full-text search combined with
 * metadata filters and BM25 ranking.
 *
 * Layers:
 *   1. FTS5 MATCH — fast sub-millisecond keyword search
 *   2. Metadata filters — scope prefix, category, stale flag
 *   3. BM25 ordering — SQLite's built-in ranking (lower rank = more relevant)
 *
 * AI reranking (Layer 4) is handled separately by OB-721.
 */
export function hybridSearch(
  db: Database.Database,
  query: string,
  options: SearchOptions = {},
): Chunk[] {
  if (!query.trim()) return [];

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

  const rows = db.prepare(sql).all(query, ...extraParams, limit) as ChunkRow[];
  return rows.map(rowToChunk);
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
    .all(query, limit) as ConversationRow[];

  return rows.map(rowToEntry);
}
