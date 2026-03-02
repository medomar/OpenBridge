import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QACacheEntry {
  id?: number;
  question: string;
  answer: string;
  confidence: number;
  file_paths?: string[];
  created_at?: string;
  accessed_at?: string;
  access_count?: number;
}

interface QACacheRow {
  id: number;
  question: string;
  answer: string;
  confidence: number;
  file_paths: string | null;
  created_at: string;
  accessed_at: string;
  access_count: number;
}

function rowToEntry(row: QACacheRow): QACacheEntry {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    confidence: row.confidence,
    file_paths: row.file_paths ? (JSON.parse(row.file_paths) as string[]) : undefined,
    created_at: row.created_at,
    accessed_at: row.accessed_at,
    access_count: row.access_count,
  };
}

// ---------------------------------------------------------------------------
// FTS5 query sanitization (same pattern as chunk-store.ts)
// ---------------------------------------------------------------------------

function sanitizeFts5Query(raw: string): string {
  const cleaned = raw.replace(/["*(){}[\]:^~?@#$%&\\|<>=!+,;]/g, ' ');
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  return tokens.map((t) => `"${t}"`).join(' ');
}

// ---------------------------------------------------------------------------
// QACacheStore
// ---------------------------------------------------------------------------

export class QACacheStore {
  constructor(private readonly db: Database.Database) {}

  /**
   * Insert a Q&A pair into `qa_cache` and keep `qa_cache_fts` in sync.
   * Returns the id of the newly inserted row.
   */
  store(entry: Omit<QACacheEntry, 'id' | 'created_at' | 'accessed_at' | 'access_count'>): number {
    const now = new Date().toISOString();

    const insertRow = this.db.prepare(`
      INSERT INTO qa_cache (question, answer, confidence, file_paths, created_at, accessed_at, access_count)
      VALUES (@question, @answer, @confidence, @file_paths, @created_at, @accessed_at, 0)
    `);

    const insertFts = this.db.prepare(`
      INSERT INTO qa_cache_fts (rowid, question) VALUES (?, ?)
    `);

    let insertedId = 0;

    this.db.transaction((): void => {
      const result = insertRow.run({
        question: entry.question,
        answer: entry.answer,
        confidence: entry.confidence,
        file_paths: entry.file_paths ? JSON.stringify(entry.file_paths) : null,
        created_at: now,
        accessed_at: now,
      });
      insertedId = Number(result.lastInsertRowid);
      insertFts.run(insertedId, entry.question);
    })();

    return insertedId;
  }

  /**
   * Full-text search for Q&A entries whose question matches the given query.
   * Uses the `qa_cache_fts` FTS5 virtual table. Returns up to `limit` entries
   * ordered by FTS5 rank (most relevant first). Default limit: 5.
   */
  findSimilar(question: string, limit = 5): QACacheEntry[] {
    if (!question.trim()) return [];

    const sanitized = sanitizeFts5Query(question);
    if (!sanitized) return [];

    try {
      const rows = this.db
        .prepare(
          `SELECT q.id, q.question, q.answer, q.confidence, q.file_paths,
                  q.created_at, q.accessed_at, q.access_count
           FROM qa_cache q
           JOIN (
             SELECT rowid
             FROM qa_cache_fts
             WHERE qa_cache_fts MATCH ?
             ORDER BY rank
             LIMIT ?
           ) AS ranked ON q.id = ranked.rowid`,
        )
        .all(sanitized, limit) as QACacheRow[];

      return rows.map(rowToEntry);
    } catch {
      return [];
    }
  }

  /**
   * Increment the access_count and update accessed_at for the given entry id.
   * No-op if the id does not exist.
   */
  incrementAccess(id: number): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE qa_cache
         SET access_count = access_count + 1, accessed_at = ?
         WHERE id = ?`,
      )
      .run(now, id);
  }

  /**
   * Delete Q&A cache entries older than `maxAge` milliseconds.
   * Both the `qa_cache` row and its `qa_cache_fts` entry are removed inside
   * a single transaction so the two tables stay in sync.
   *
   * @param maxAge - Maximum age in milliseconds (e.g. 7 * 24 * 60 * 60 * 1000 for 7 days)
   */
  evictStale(maxAge: number): number {
    const cutoff = new Date(Date.now() - maxAge).toISOString();

    const staleRows = this.db
      .prepare(`SELECT id, question FROM qa_cache WHERE created_at < ?`)
      .all(cutoff) as { id: number; question: string }[];

    if (staleRows.length === 0) return 0;

    const deleteFts = this.db.prepare(
      `INSERT INTO qa_cache_fts (qa_cache_fts, rowid, question) VALUES ('delete', ?, ?)`,
    );
    const deleteRow = this.db.prepare(`DELETE FROM qa_cache WHERE id = ?`);

    this.db.transaction((): void => {
      for (const row of staleRows) {
        deleteFts.run(row.id, row.question);
        deleteRow.run(row.id);
      }
    })();

    return staleRows.length;
  }

  /**
   * Retrieve a single Q&A cache entry by id. Returns null if not found.
   */
  getById(id: number): QACacheEntry | null {
    const row = this.db.prepare(`SELECT * FROM qa_cache WHERE id = ?`).get(id) as
      | QACacheRow
      | undefined;
    return row ? rowToEntry(row) : null;
  }

  /**
   * Return the total number of entries in the qa_cache table.
   */
  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS c FROM qa_cache`).get() as { c: number };
    return row.c;
  }
}
