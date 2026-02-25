import type Database from 'better-sqlite3';
import {
  evictConversations as _evictConversations,
  type ConversationEvictionOptions,
} from './conversation-store.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface EvictionOptions {
  /** Delete conversations older than this many days (default: 90) */
  conversationRetentionDays?: number;
  /** Delete completed tasks older than this many days (default: 180) */
  taskRetentionDays?: number;
  /** Delete stale context_chunks older than this many days (default: 30) */
  staleChunkRetentionDays?: number;
  /** Delete completed agent_activity records older than this many hours (default: 24) */
  agentActivityRetentionHours?: number;
  /** Optional AgentRunner for AI-powered conversation summarization (30–90 day window). */
  agentRunner?: ConversationEvictionOptions['agentRunner'];
  /** Working directory for the AI summarizer agent. */
  workspacePath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a Date that is `days` days before now. */
function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** Returns a Date that is `hours` hours before now. */
function hoursAgo(hours: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - hours);
  return d;
}

/** Returns true if the named table exists in the database. */
function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
    .get(tableName) as { '1': number } | undefined;
  return row !== undefined;
}

// ---------------------------------------------------------------------------
// Eviction policies
// ---------------------------------------------------------------------------

/**
 * Tiered conversation eviction — delegates to the public `evictConversations`
 * in conversation-store.ts which implements the 30/90/365-day policy.
 *
 * `conversationRetentionDays` maps to the `summarizeDays` boundary (default 90):
 * conversations older than that are deleted / task-linked; the 30-day keep and
 * 365-day hard-delete boundaries use their own defaults.
 */
async function evictConversations(db: Database.Database, options: EvictionOptions): Promise<void> {
  return _evictConversations(db, {
    summarizeDays: options.conversationRetentionDays ?? 90,
    agentRunner: options.agentRunner,
    workspacePath: options.workspacePath,
  });
}

/**
 * Delete completed tasks older than `retentionDays`.
 */
function evictTasks(db: Database.Database, retentionDays: number): void {
  const cutoff = daysAgo(retentionDays).toISOString();
  db.prepare(
    `DELETE FROM tasks
     WHERE status = 'completed'
       AND completed_at IS NOT NULL
       AND completed_at < ?`,
  ).run(cutoff);
}

/**
 * Delete stale context_chunks whose `updated_at` is older than `retentionDays`.
 * Only stale chunks (stale = 1) that are old enough are removed.
 */
function evictStaleChunks(db: Database.Database, retentionDays: number): void {
  const cutoff = daysAgo(retentionDays).toISOString();

  // Mark qualifying stale chunks for deletion by collecting their IDs first,
  // then delegate to the canonical deleteStaleChunks helper which keeps FTS5
  // in sync. We temporarily set non-qualifying stale chunks to stale=0, run
  // the helper, then restore them — but that is complex and risky.
  //
  // Simpler approach: delete FTS5 entries and the rows inline for chunks that
  // are stale AND old enough, matching the same pattern used in chunk-store.ts.

  const ids = db
    .prepare(
      `SELECT id FROM context_chunks
       WHERE stale = 1 AND updated_at < ?`,
    )
    .all(cutoff) as { id: number }[];

  if (ids.length === 0) return;

  db.transaction(() => {
    for (const { id } of ids) {
      db.prepare('DELETE FROM context_chunks_fts WHERE rowid = ?').run(id);
    }
    db.prepare(
      `DELETE FROM context_chunks
       WHERE stale = 1 AND updated_at < ?`,
    ).run(cutoff);
  })();
}

/**
 * Delete completed agent_activity records older than `retentionHours`.
 * This table is created in Phase 36 — skip silently if it doesn't exist.
 */
function evictAgentActivity(db: Database.Database, retentionHours: number): void {
  if (!tableExists(db, 'agent_activity')) return;

  const cutoff = hoursAgo(retentionHours).toISOString();
  db.prepare(
    `DELETE FROM agent_activity
     WHERE status = 'completed'
       AND completed_at IS NOT NULL
       AND completed_at < ?`,
  ).run(cutoff);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all eviction policies against the database.
 *
 * Each policy can be individually tuned via `options`:
 * - `conversationRetentionDays`  — summarizeDays boundary for conversations (default 90)
 * - `taskRetentionDays`          — completed tasks older than N days        (default 180)
 * - `staleChunkRetentionDays`    — stale chunks older than N days           (default 30)
 * - `agentActivityRetentionHours`— agent_activity older than N hours        (default 24)
 * - `agentRunner`                — enables AI summarization for 30–90 day window
 * - `workspacePath`              — working directory for the AI summarizer
 */
export async function evictOldData(
  db: Database.Database,
  options: EvictionOptions = {},
): Promise<void> {
  const {
    taskRetentionDays = 180,
    staleChunkRetentionDays = 30,
    agentActivityRetentionHours = 24,
  } = options;

  await evictConversations(db, options);
  evictTasks(db, taskRetentionDays);
  evictStaleChunks(db, staleChunkRetentionDays);
  evictAgentActivity(db, agentActivityRetentionHours);
}
