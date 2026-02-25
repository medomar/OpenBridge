import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccessRole = 'owner' | 'admin' | 'developer' | 'viewer' | 'custom';

export interface AccessControlEntry {
  id?: number;
  user_id: string;
  channel: string;
  role: AccessRole;
  scopes?: string[] | null;
  allowed_actions?: string[] | null;
  blocked_actions?: string[] | null;
  max_cost_per_day_usd?: number | null;
  daily_cost_used?: number;
  cost_reset_at?: string | null;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
}

interface AccessControlRow {
  id: number;
  user_id: string;
  channel: string;
  role: AccessRole;
  scopes: string | null;
  allowed_actions: string | null;
  blocked_actions: string | null;
  max_cost_per_day_usd: number | null;
  daily_cost_used: number;
  cost_reset_at: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

function rowToEntry(row: AccessControlRow): AccessControlEntry {
  return {
    id: row.id,
    user_id: row.user_id,
    channel: row.channel,
    role: row.role,
    scopes: row.scopes ? (JSON.parse(row.scopes) as string[]) : null,
    allowed_actions: row.allowed_actions ? (JSON.parse(row.allowed_actions) as string[]) : null,
    blocked_actions: row.blocked_actions ? (JSON.parse(row.blocked_actions) as string[]) : null,
    max_cost_per_day_usd: row.max_cost_per_day_usd,
    daily_cost_used: row.daily_cost_used,
    cost_reset_at: row.cost_reset_at,
    active: row.active === 1,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Return the access_control entry for a specific user+channel pair.
 * Returns null when no entry exists.
 */
export function getAccess(
  db: Database.Database,
  userId: string,
  channel: string,
): AccessControlEntry | null {
  const row = db
    .prepare(
      `SELECT * FROM access_control
       WHERE user_id = ? AND channel = ?`,
    )
    .get(userId, channel) as AccessControlRow | undefined;
  return row ? rowToEntry(row) : null;
}

/**
 * Insert or replace an access_control entry.
 * When an entry already exists for (user_id, channel), it is updated in-place.
 */
export function setAccess(db: Database.Database, entry: AccessControlEntry): void {
  const now = new Date().toISOString();
  const existing = getAccess(db, entry.user_id, entry.channel);

  if (existing) {
    db.prepare(
      `UPDATE access_control SET
         role                 = ?,
         scopes               = ?,
         allowed_actions      = ?,
         blocked_actions      = ?,
         max_cost_per_day_usd = ?,
         daily_cost_used      = ?,
         cost_reset_at        = ?,
         active               = ?,
         updated_at           = ?
       WHERE user_id = ? AND channel = ?`,
    ).run(
      entry.role,
      entry.scopes != null ? JSON.stringify(entry.scopes) : null,
      entry.allowed_actions != null ? JSON.stringify(entry.allowed_actions) : null,
      entry.blocked_actions != null ? JSON.stringify(entry.blocked_actions) : null,
      entry.max_cost_per_day_usd ?? null,
      entry.daily_cost_used ?? 0,
      entry.cost_reset_at ?? null,
      entry.active !== false ? 1 : 0,
      now,
      entry.user_id,
      entry.channel,
    );
  } else {
    db.prepare(
      `INSERT INTO access_control
         (user_id, channel, role, scopes, allowed_actions, blocked_actions,
          max_cost_per_day_usd, daily_cost_used, cost_reset_at, active,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.user_id,
      entry.channel,
      entry.role,
      entry.scopes != null ? JSON.stringify(entry.scopes) : null,
      entry.allowed_actions != null ? JSON.stringify(entry.allowed_actions) : null,
      entry.blocked_actions != null ? JSON.stringify(entry.blocked_actions) : null,
      entry.max_cost_per_day_usd ?? null,
      entry.daily_cost_used ?? 0,
      entry.cost_reset_at ?? null,
      entry.active !== false ? 1 : 0,
      now,
      now,
    );
  }
}

/** Return all access_control entries. */
export function listAccess(db: Database.Database): AccessControlEntry[] {
  const rows = db
    .prepare(`SELECT * FROM access_control ORDER BY user_id, channel`)
    .all() as AccessControlRow[];
  return rows.map(rowToEntry);
}

/** Remove the access_control entry for a specific user+channel. */
export function removeAccess(db: Database.Database, userId: string, channel: string): void {
  db.prepare(`DELETE FROM access_control WHERE user_id = ? AND channel = ?`).run(userId, channel);
}

/**
 * Increment daily_cost_used for a specific user+channel by the given amount.
 * No-op if no entry exists for that user+channel.
 */
export function incrementDailyCost(
  db: Database.Database,
  userId: string,
  channel: string,
  costUsd: number,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE access_control
     SET daily_cost_used = daily_cost_used + ?,
         updated_at      = ?
     WHERE user_id = ? AND channel = ?`,
  ).run(costUsd, now, userId, channel);
}

/**
 * Reset daily_cost_used to 0 for all entries whose cost_reset_at is in the past
 * (or null). Updates cost_reset_at to the start of the next UTC day.
 */
export function resetDailyCosts(db: Database.Database): void {
  const now = new Date().toISOString();
  // Next reset: tomorrow at 00:00:00 UTC
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  const nextReset = tomorrow.toISOString();

  db.prepare(
    `UPDATE access_control
     SET daily_cost_used = 0,
         cost_reset_at   = ?,
         updated_at      = ?
     WHERE cost_reset_at IS NULL OR cost_reset_at <= ?`,
  ).run(nextReset, now, now);
}
