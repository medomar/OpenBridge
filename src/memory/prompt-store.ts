import type Database from 'better-sqlite3';
import { createLogger } from '../core/logger.js';
import type { PromptRecord } from './index.js';

const logger = createLogger('prompt-store');

export const MAX_PROMPT_VERSION_LENGTH = 45_000;

// ---------------------------------------------------------------------------
// Raw row shape returned by better-sqlite3
// ---------------------------------------------------------------------------

interface PromptRow {
  id: number;
  name: string;
  version: number;
  content: string;
  effectiveness: number;
  usage_count: number;
  success_count: number;
  active: number; // SQLite stores booleans as integers
  created_at: string;
}

function rowToRecord(row: PromptRow): PromptRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    content: row.content,
    effectiveness: row.effectiveness,
    usage_count: row.usage_count,
    success_count: row.success_count,
    active: row.active === 1,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Return the active prompt with the highest version number for the given name.
 * Returns null when no active prompt exists.
 */
export function getActivePrompt(db: Database.Database, name: string): PromptRecord | null {
  const row = db
    .prepare(
      `SELECT id, name, version, content, effectiveness, usage_count, success_count, active, created_at
       FROM prompts
       WHERE name = ? AND active = 1
       ORDER BY version DESC
       LIMIT 1`,
    )
    .get(name) as PromptRow | undefined;

  return row ? rowToRecord(row) : null;
}

/**
 * Insert a new prompt version and deactivate all previous versions of the same name.
 * The new version number is max(existing) + 1 (or 1 for a brand-new prompt).
 * Runs inside a transaction.
 */
export function createPromptVersion(db: Database.Database, name: string, content: string): void {
  if (content.length > MAX_PROMPT_VERSION_LENGTH) {
    logger.warn(
      { name, size: content.length, max: MAX_PROMPT_VERSION_LENGTH },
      'Prompt version rejected: content exceeds size cap',
    );
    return;
  }

  const now = new Date().toISOString();

  const maxVersionRow = db
    .prepare(`SELECT COALESCE(MAX(version), 0) AS max_v FROM prompts WHERE name = ?`)
    .get(name) as { max_v: number };

  const nextVersion = maxVersionRow.max_v + 1;

  db.transaction(() => {
    // Deactivate all existing versions
    db.prepare(`UPDATE prompts SET active = 0 WHERE name = ?`).run(name);

    // Insert the new version as active
    db.prepare(
      `INSERT INTO prompts (name, version, content, effectiveness, usage_count, success_count, active, created_at)
       VALUES (?, ?, ?, 0.5, 0, 0, 1, ?)`,
    ).run(name, nextVersion, content, now);
  })();
}

/**
 * Increment `usage_count` (always) and `success_count` (when success=true) for the
 * active prompt version.  Recalculates `effectiveness` = success_count / usage_count.
 */
export function recordPromptOutcome(db: Database.Database, name: string, success: boolean): void {
  db.prepare(
    `UPDATE prompts
     SET usage_count   = usage_count + 1,
         success_count = success_count + ?,
         effectiveness = CAST(success_count + ? AS REAL) / (usage_count + 1)
     WHERE name = ? AND active = 1`,
  ).run(success ? 1 : 0, success ? 1 : 0, name);
}

/**
 * Return per-version stats (effectiveness, usage_count, success_count) for all versions
 * of the given prompt name, ordered by version descending.
 */
export function getPromptStats(db: Database.Database, name: string): PromptRecord[] {
  const rows = db
    .prepare(
      `SELECT id, name, version, content, effectiveness, usage_count, success_count, active, created_at
       FROM prompts
       WHERE name = ?
       ORDER BY version DESC`,
    )
    .all(name) as PromptRow[];

  return rows.map(rowToRecord);
}

/**
 * Return all active prompt versions whose effectiveness is below `threshold`.
 * Default threshold is 0.7 (70% success rate).
 */
export function getUnderperformingPrompts(db: Database.Database, threshold = 0.7): PromptRecord[] {
  const rows = db
    .prepare(
      `SELECT id, name, version, content, effectiveness, usage_count, success_count, active, created_at
       FROM prompts
       WHERE active = 1 AND effectiveness < ?
       ORDER BY effectiveness ASC`,
    )
    .all(threshold) as PromptRow[];

  return rows.map(rowToRecord);
}

/**
 * Return active prompt versions whose effectiveness is at or above `threshold`
 * and whose `usage_count` meets the minimum (default 5).
 * Used for injecting high-performing prompt patterns into the Master system prompt.
 */
export function getHighEffectivenessPrompts(
  db: Database.Database,
  threshold = 0.7,
  minUsage = 5,
): PromptRecord[] {
  const rows = db
    .prepare(
      `SELECT id, name, version, content, effectiveness, usage_count, success_count, active, created_at
       FROM prompts
       WHERE active = 1 AND effectiveness >= ? AND usage_count >= ?
       ORDER BY effectiveness DESC`,
    )
    .all(threshold, minUsage) as PromptRow[];

  return rows.map(rowToRecord);
}
