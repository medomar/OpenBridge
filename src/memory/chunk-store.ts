import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Chunk {
  id?: number;
  scope: string;
  category: 'structure' | 'patterns' | 'dependencies' | 'api' | 'config';
  content: string;
  source_hash?: string;
  content_hash?: string;
  created_at?: string;
  updated_at?: string;
  stale?: boolean;
}

/** Raw row shape returned by better-sqlite3 (BOOLEAN stored as INTEGER). */
export interface ChunkRow {
  id: number;
  scope: string;
  category: Chunk['category'];
  content: string;
  source_hash: string | null;
  content_hash: string | null;
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
    content_hash: row.content_hash ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    stale: row.stale === 1,
  };
}

/**
 * Computes a SHA-256 hash of normalized chunk content.
 * Normalization: trim whitespace, collapse internal whitespace runs to a single space.
 */
export function computeContentHash(content: string): string {
  const normalized = content.trim().replace(/\s+/g, ' ');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// FTS5 query sanitization
// ---------------------------------------------------------------------------

function sanitizeFts5Query(raw: string): string {
  const cleaned = raw.replace(/["*(){}[\]:^~?@#$%&\\|<>=!+,;]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' ');
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Insert chunks into `context_chunks` and keep `context_chunks_fts` in sync.
 * If a chunk with the same `content_hash` already exists, only its `updated_at`
 * timestamp is refreshed — no duplicate row is created.
 * All operations run inside a single transaction.
 */
export function storeChunks(db: Database.Database, chunks: Chunk[]): void {
  if (chunks.length === 0) return;

  const now = new Date().toISOString();

  const findByHash = db.prepare<[string], { id: number }>(
    `SELECT id FROM context_chunks WHERE content_hash = ? LIMIT 1`,
  );

  const touchChunk = db.prepare(`UPDATE context_chunks SET updated_at = ? WHERE id = ?`);

  const insertChunk = db.prepare(`
    INSERT INTO context_chunks (scope, category, content, source_hash, content_hash, created_at, updated_at, stale)
    VALUES (@scope, @category, @content, @source_hash, @content_hash, @created_at, @updated_at, 0)
  `);

  const insertFts = db.prepare(`
    INSERT INTO context_chunks_fts (rowid, content, scope, category)
    VALUES (?, ?, ?, ?)
  `);

  const insertAll = db.transaction((rows: Chunk[]) => {
    for (const chunk of rows) {
      const hash = chunk.content_hash ?? computeContentHash(chunk.content);
      const existing = findByHash.get(hash);

      if (existing) {
        touchChunk.run(now, existing.id);
        continue;
      }

      const result = insertChunk.run({
        scope: chunk.scope,
        category: chunk.category,
        content: chunk.content,
        source_hash: chunk.source_hash ?? null,
        content_hash: hash,
        created_at: now,
        updated_at: now,
      });
      insertFts.run(result.lastInsertRowid, chunk.content, chunk.scope, chunk.category);
    }
  });

  insertAll(chunks);
}

/**
 * Full-text search over non-stale chunks using the `context_chunks_fts` table.
 * Returns up to `limit` matching chunks (default 10).
 */
export function searchChunks(db: Database.Database, query: string, limit = 10): Chunk[] {
  if (!query.trim()) return [];

  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];

  const rows = db
    .prepare(
      `SELECT c.id, c.scope, c.category, c.content, c.source_hash,
              c.created_at, c.updated_at, c.stale
       FROM context_chunks c
       WHERE c.id IN (
         SELECT rowid FROM context_chunks_fts WHERE context_chunks_fts MATCH ?
       )
         AND c.stale = 0
       LIMIT ?`,
    )
    .all(sanitized, limit) as ChunkRow[];

  return rows.map(rowToChunk);
}

/**
 * Full-text search over all chunks using the `context_chunks_fts` FTS5 virtual
 * table. Returns raw {@link ChunkRow} records ordered by FTS5 rank (most
 * relevant first). Unlike {@link searchChunks}, stale chunks are not filtered
 * out. Default limit: 10.
 *
 * Returns an empty array when the query is empty or when FTS5 encounters a
 * syntax error.
 */
export function searchFTS5(db: Database.Database, query: string, limit = 10): ChunkRow[] {
  if (!query.trim()) return [];

  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];

  try {
    return db
      .prepare(
        `SELECT c.id, c.scope, c.category, c.content, c.source_hash,
                c.created_at, c.updated_at, c.stale
         FROM context_chunks c
         JOIN (
           SELECT rowid
           FROM context_chunks_fts
           WHERE context_chunks_fts MATCH ?
           ORDER BY rank
           LIMIT ?
         ) AS ranked ON c.id = ranked.rowid`,
      )
      .all(sanitized, limit) as ChunkRow[];
  } catch {
    return [];
  }
}

/**
 * Mark all chunks whose scope matches any entry in `scopes` as stale.
 * Stale chunks are excluded from search and will be removed by eviction.
 */
export function markStale(db: Database.Database, scopes: string[]): void {
  if (scopes.length === 0) return;

  const now = new Date().toISOString();
  const placeholders = scopes.map(() => '?').join(', ');

  db.prepare(
    `UPDATE context_chunks
     SET stale = 1, updated_at = ?
     WHERE scope IN (${placeholders})`,
  ).run(now, ...scopes);
}

/**
 * Delete all chunks (regardless of stale flag) for the given scope and their
 * corresponding FTS5 entries. Runs inside a transaction so the two tables stay
 * in sync. Used before re-inserting fresh exploration data to prevent unbounded
 * chunk growth across incremental exploration runs.
 */
export function deleteChunksByScope(db: Database.Database, scope: string): void {
  const rows = db.prepare('SELECT id FROM context_chunks WHERE scope = ?').all(scope) as {
    id: number;
  }[];

  if (rows.length === 0) return;

  const deleteAll = db.transaction(() => {
    for (const { id } of rows) {
      db.prepare('DELETE FROM context_chunks_fts WHERE rowid = ?').run(id);
    }
    db.prepare('DELETE FROM context_chunks WHERE scope = ?').run(scope);
  });

  deleteAll();
}

/**
 * Delete all stale chunks and their corresponding FTS5 entries.
 * Runs inside a transaction so the two tables stay in sync.
 */
export function deleteStaleChunks(db: Database.Database): void {
  const staleIds = db.prepare('SELECT id FROM context_chunks WHERE stale = 1').all() as {
    id: number;
  }[];

  if (staleIds.length === 0) return;

  const deleteAll = db.transaction(() => {
    for (const { id } of staleIds) {
      db.prepare('DELETE FROM context_chunks_fts WHERE rowid = ?').run(id);
    }
    db.prepare('DELETE FROM context_chunks WHERE stale = 1').run();
  });

  deleteAll();
}
