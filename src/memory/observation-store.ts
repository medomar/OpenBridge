import type Database from 'better-sqlite3';
import { createLogger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const logger = createLogger('observation-store');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Observation {
  id?: number;
  session_id: string;
  worker_id: string;
  type: string;
  title: string;
  narrative: string;
  facts?: string[];
  concepts?: string[];
  files_read?: string[];
  files_modified?: string[];
  created_at?: string;
}

/** Raw row shape returned by better-sqlite3 (JSON columns stored as TEXT). */
interface ObservationRow {
  id: number;
  session_id: string;
  worker_id: string;
  type: string;
  title: string;
  narrative: string;
  facts: string;
  concepts: string;
  files_read: string;
  files_modified: string;
  created_at: string;
}

function rowToObservation(row: ObservationRow): Observation {
  let facts: string[] = [];
  let concepts: string[] = [];
  let files_read: string[] = [];
  let files_modified: string[] = [];

  try {
    facts = JSON.parse(row.facts) as string[];
  } catch (err) {
    logger.warn({ err, id: row.id, field: 'facts' }, 'Failed to parse observation facts JSON');
  }

  try {
    concepts = JSON.parse(row.concepts) as string[];
  } catch (err) {
    logger.warn(
      { err, id: row.id, field: 'concepts' },
      'Failed to parse observation concepts JSON',
    );
  }

  try {
    files_read = JSON.parse(row.files_read) as string[];
  } catch (err) {
    logger.warn(
      { err, id: row.id, field: 'files_read' },
      'Failed to parse observation files_read JSON',
    );
  }

  try {
    files_modified = JSON.parse(row.files_modified) as string[];
  } catch (err) {
    logger.warn(
      { err, id: row.id, field: 'files_modified' },
      'Failed to parse observation files_modified JSON',
    );
  }

  return {
    id: row.id,
    session_id: row.session_id,
    worker_id: row.worker_id,
    type: row.type,
    title: row.title,
    narrative: row.narrative,
    facts,
    concepts,
    files_read,
    files_modified,
    created_at: row.created_at,
  };
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
 * Insert a new observation record into the `observations` table.
 * The FTS5 index is kept in sync via INSERT trigger defined in the schema.
 * Returns the inserted row id.
 */
export function insertObservation(db: Database.Database, obs: Observation): number {
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO observations
         (session_id, worker_id, type, title, narrative,
          facts, concepts, files_read, files_modified, created_at)
       VALUES
         (@session_id, @worker_id, @type, @title, @narrative,
          @facts, @concepts, @files_read, @files_modified, @created_at)`,
    )
    .run({
      session_id: obs.session_id,
      worker_id: obs.worker_id,
      type: obs.type,
      title: obs.title,
      narrative: obs.narrative,
      facts: JSON.stringify(obs.facts ?? []),
      concepts: JSON.stringify(obs.concepts ?? []),
      files_read: JSON.stringify(obs.files_read ?? []),
      files_modified: JSON.stringify(obs.files_modified ?? []),
      created_at: obs.created_at ?? now,
    });

  return result.lastInsertRowid as number;
}

/**
 * Return all observations for a given session, ordered by creation time (newest first).
 */
export function getBySession(db: Database.Database, sessionId: string, limit = 50): Observation[] {
  const rows = db
    .prepare(
      `SELECT * FROM observations
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(sessionId, limit) as ObservationRow[];
  return rows.map(rowToObservation);
}

/**
 * Return all observations produced by a specific worker, ordered newest first.
 */
export function getByWorker(db: Database.Database, workerId: string, limit = 50): Observation[] {
  const rows = db
    .prepare(
      `SELECT * FROM observations
       WHERE worker_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(workerId, limit) as ObservationRow[];
  return rows.map(rowToObservation);
}

/**
 * Full-text search over observations using the `observations_fts` FTS5 table.
 * Searches across `title` and `narrative` columns.
 * Returns up to `limit` matching observations (default 10).
 */
export function searchObservations(
  db: Database.Database,
  query: string,
  limit = 10,
): Observation[] {
  if (!query.trim()) return [];

  const sanitized = sanitizeFts5Query(query);
  if (!sanitized) return [];

  try {
    const rows = db
      .prepare(
        `SELECT o.*
         FROM observations o
         WHERE o.id IN (
           SELECT rowid FROM observations_fts WHERE observations_fts MATCH ?
         )
         ORDER BY o.created_at DESC
         LIMIT ?`,
      )
      .all(sanitized, limit) as ObservationRow[];
    return rows.map(rowToObservation);
  } catch {
    return [];
  }
}

/**
 * Return the most recent observations of a specific type.
 * Useful for surfacing recent bugfixes, architecture notes, etc.
 */
export function getRecentByType(db: Database.Database, type: string, limit = 10): Observation[] {
  const rows = db
    .prepare(
      `SELECT * FROM observations
       WHERE type = ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(type, limit) as ObservationRow[];
  return rows.map(rowToObservation);
}
