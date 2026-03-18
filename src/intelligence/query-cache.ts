import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A cached query entry */
export interface QueryCacheEntry {
  id: number;
  /** Normalized hash of the question (cache key) */
  questionHash: string;
  /** Original question text (for debugging) */
  question: string;
  /** Computed answer/aggregate stored as JSON string */
  answer: string;
  /** ISO timestamp when the entry was cached */
  cachedAt: string;
  /** ISO timestamp when the entry expires */
  expiresAt: string;
  /** DocTypes this answer depends on (for targeted invalidation) */
  relatedDocTypes: string[];
}

// ---------------------------------------------------------------------------
// Row type for SQLite
// ---------------------------------------------------------------------------

interface QueryCacheRow {
  id: number;
  question_hash: string;
  question: string;
  answer: string;
  cached_at: string;
  expires_at: string;
  related_doc_types: string;
}

function rowToEntry(row: QueryCacheRow): QueryCacheEntry {
  return {
    id: row.id,
    questionHash: row.question_hash,
    question: row.question,
    answer: row.answer,
    cachedAt: row.cached_at,
    expiresAt: row.expires_at,
    relatedDocTypes: JSON.parse(row.related_doc_types) as string[],
  };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Ensure the `query_cache` table exists in the given database.
 * Safe to call multiple times (uses CREATE TABLE IF NOT EXISTS).
 */
export function ensureQueryCacheTable(db: Database.Database): void {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS query_cache (
       id                INTEGER PRIMARY KEY AUTOINCREMENT,
       question_hash     TEXT    NOT NULL UNIQUE,
       question          TEXT    NOT NULL,
       answer            TEXT    NOT NULL,
       cached_at         TEXT    NOT NULL,
       expires_at        TEXT    NOT NULL,
       related_doc_types TEXT    NOT NULL DEFAULT '[]'
     )`,
  ).run();
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_query_cache_expires ON query_cache (expires_at)`,
  ).run();
}

// ---------------------------------------------------------------------------
// Question normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a question to a stable cache key:
 * - lower-case
 * - collapse whitespace
 * - strip leading/trailing punctuation
 * Returns a SHA-256 hex digest (64 chars).
 */
export function normalizeQuestion(question: string): string {
  const normalized = question
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^a-z0-9]+|[^a-z0-9?!]+$/g, '');
  return createHash('sha256').update(normalized).digest('hex');
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Store (or overwrite) a cached answer for the given question.
 *
 * @param db            SQLite database instance
 * @param question      Raw question text
 * @param answer        Computed answer (will be JSON-serialised if not a string)
 * @param relatedDocTypes  DocTypes this answer depends on
 * @param ttlMs         Time-to-live in milliseconds (default: 5 minutes)
 * @returns             The inserted/replaced row ID
 */
export function cacheAnswer(
  db: Database.Database,
  question: string,
  answer: unknown,
  relatedDocTypes: string[] = [],
  ttlMs: number = DEFAULT_TTL_MS,
): number {
  const hash = normalizeQuestion(question);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const answerStr = typeof answer === 'string' ? answer : JSON.stringify(answer);

  const result = db
    .prepare(
      `INSERT INTO query_cache
         (question_hash, question, answer, cached_at, expires_at, related_doc_types)
       VALUES (@hash, @question, @answer, @cachedAt, @expiresAt, @relatedDocTypes)
       ON CONFLICT (question_hash) DO UPDATE SET
         question          = excluded.question,
         answer            = excluded.answer,
         cached_at         = excluded.cached_at,
         expires_at        = excluded.expires_at,
         related_doc_types = excluded.related_doc_types`,
    )
    .run({
      hash,
      question,
      answer: answerStr,
      cachedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      relatedDocTypes: JSON.stringify(relatedDocTypes),
    });

  return Number(result.lastInsertRowid);
}

/**
 * Retrieve a non-expired cached answer for the given question.
 * Returns null if no entry exists or the entry is expired (and prunes it).
 */
export function getCachedAnswer(db: Database.Database, question: string): QueryCacheEntry | null {
  const hash = normalizeQuestion(question);
  const row = db.prepare('SELECT * FROM query_cache WHERE question_hash = ?').get(hash) as
    | QueryCacheRow
    | undefined;

  if (!row) return null;

  const now = new Date();
  if (new Date(row.expires_at) <= now) {
    // Prune expired entry
    db.prepare('DELETE FROM query_cache WHERE question_hash = ?').run(hash);
    return null;
  }

  return rowToEntry(row);
}

/**
 * Invalidate all cached entries that depend on one or more of the given DocTypes.
 * Call this whenever DocType data changes (insert / update / delete).
 *
 * @returns Number of cache entries removed
 */
export function invalidateByDocTypes(db: Database.Database, docTypes: string[]): number {
  if (docTypes.length === 0) return 0;

  // Fetch all rows and filter in JS — SQLite JSON functions require a loaded
  // extension which is not guaranteed; a full-table scan on a small cache table
  // is acceptable.
  const rows = db.prepare('SELECT id, related_doc_types FROM query_cache').all() as Array<{
    id: number;
    related_doc_types: string;
  }>;

  const toDelete: number[] = [];
  for (const row of rows) {
    const related = JSON.parse(row.related_doc_types) as string[];
    if (docTypes.some((dt) => related.includes(dt))) {
      toDelete.push(row.id);
    }
  }

  if (toDelete.length === 0) return 0;

  const placeholders = toDelete.map(() => '?').join(',');
  const result = db
    .prepare(`DELETE FROM query_cache WHERE id IN (${placeholders})`)
    .run(...toDelete);

  return result.changes;
}

/**
 * Remove all entries that have already expired.
 *
 * @returns Number of entries pruned
 */
export function pruneExpiredCache(db: Database.Database): number {
  const result = db
    .prepare(`DELETE FROM query_cache WHERE expires_at <= ?`)
    .run(new Date().toISOString());
  return result.changes;
}

/**
 * Delete a specific cache entry by question.
 *
 * @returns true if an entry was removed
 */
export function invalidateQuestion(db: Database.Database, question: string): boolean {
  const hash = normalizeQuestion(question);
  const result = db.prepare('DELETE FROM query_cache WHERE question_hash = ?').run(hash);
  return result.changes > 0;
}

/**
 * Flush the entire query cache.
 *
 * @returns Number of entries removed
 */
export function clearCache(db: Database.Database): number {
  const result = db.prepare('DELETE FROM query_cache').run();
  return result.changes;
}
