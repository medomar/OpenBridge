import type Database from 'better-sqlite3';
import type { DeepPhase, ExecutionProfile } from '../types/agent.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AccessRole = 'owner' | 'admin' | 'developer' | 'viewer' | 'custom';

/**
 * Per-user consent preference for high-risk spawn confirmation prompts.
 *
 * - `always-ask`             (default) — always prompt before high/critical-risk workers.
 * - `auto-approve-read`      — skip confirmation for low-risk (read-only, code-audit) profiles;
 *                              still prompt for medium/high/critical-risk profiles.
 * - `auto-approve-up-to-edit` — skip confirmation for low/medium-risk profiles (read-only,
 *                              code-audit, code-edit); still prompt for high/critical-risk
 *                              (full-access, master). Also auto-approves tool escalations to
 *                              code-edit level without requiring user input.
 * - `auto-approve-all`       — never prompt; all workers proceed without confirmation.
 */
export type ConsentMode =
  | 'always-ask'
  | 'auto-approve-read'
  | 'auto-approve-up-to-edit'
  | 'auto-approve-all';

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
  /** Consent preference for high-risk spawn confirmation prompts (default: 'always-ask'). */
  consentMode?: ConsentMode;
  /** Execution profile preference for Deep Mode (default: 'fast'). */
  executionProfile?: ExecutionProfile;
  /** Per-phase model overrides for Deep Mode. Keys are DeepPhase names; values are model IDs. */
  modelPreferences?: Partial<Record<DeepPhase, string>>;
  /** Permanently granted tool names via /allow escalation (persists across restarts). */
  approvedToolEscalations?: string[];
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
  consent_mode: string | null;
  execution_profile: string | null;
  model_preferences: string | null;
  approved_tool_escalations: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_CONSENT_MODES = new Set<ConsentMode>([
  'always-ask',
  'auto-approve-read',
  'auto-approve-up-to-edit',
  'auto-approve-all',
]);

function parseConsentMode(raw: string | null): ConsentMode {
  if (raw && VALID_CONSENT_MODES.has(raw as ConsentMode)) {
    return raw as ConsentMode;
  }
  return 'always-ask';
}

const VALID_EXECUTION_PROFILES = new Set<ExecutionProfile>(['fast', 'thorough', 'manual']);

function parseExecutionProfile(raw: string | null): ExecutionProfile {
  if (raw && VALID_EXECUTION_PROFILES.has(raw as ExecutionProfile)) {
    return raw as ExecutionProfile;
  }
  return 'fast';
}

function parseModelPreferences(raw: string | null): Partial<Record<DeepPhase, string>> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Partial<Record<DeepPhase, string>>;
  } catch {
    return undefined;
  }
}

function parseApprovedToolEscalations(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
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
    consentMode: parseConsentMode(row.consent_mode),
    executionProfile: parseExecutionProfile(row.execution_profile),
    modelPreferences: parseModelPreferences(row.model_preferences),
    approvedToolEscalations: parseApprovedToolEscalations(row.approved_tool_escalations),
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

  const modelPrefsJson =
    entry.modelPreferences != null ? JSON.stringify(entry.modelPreferences) : null;
  const approvedEscalationsJson = JSON.stringify(entry.approvedToolEscalations ?? []);

  if (existing) {
    db.prepare(
      `UPDATE access_control SET
         role                      = ?,
         scopes                    = ?,
         allowed_actions           = ?,
         blocked_actions           = ?,
         max_cost_per_day_usd      = ?,
         daily_cost_used           = ?,
         cost_reset_at             = ?,
         active                    = ?,
         consent_mode              = ?,
         execution_profile         = ?,
         model_preferences         = ?,
         approved_tool_escalations = ?,
         updated_at                = ?
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
      entry.consentMode ?? 'always-ask',
      entry.executionProfile ?? 'fast',
      modelPrefsJson,
      approvedEscalationsJson,
      now,
      entry.user_id,
      entry.channel,
    );
  } else {
    db.prepare(
      `INSERT INTO access_control
         (user_id, channel, role, scopes, allowed_actions, blocked_actions,
          max_cost_per_day_usd, daily_cost_used, cost_reset_at, active,
          consent_mode, execution_profile, model_preferences, approved_tool_escalations,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      entry.consentMode ?? 'always-ask',
      entry.executionProfile ?? 'fast',
      modelPrefsJson,
      approvedEscalationsJson,
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
 * Return the consent mode for a specific user+channel pair.
 * Falls back to 'always-ask' when no entry exists.
 */
export function getConsentMode(
  db: Database.Database,
  userId: string,
  channel: string,
): ConsentMode {
  const entry = getAccess(db, userId, channel);
  return entry?.consentMode ?? 'always-ask';
}

/**
 * Return the execution profile preference for a specific user+channel pair.
 * Falls back to 'fast' when no entry exists.
 */
export function getExecutionProfile(
  db: Database.Database,
  userId: string,
  channel: string,
): ExecutionProfile {
  const entry = getAccess(db, userId, channel);
  return entry?.executionProfile ?? 'fast';
}

/**
 * Return per-phase model overrides for a specific user+channel pair.
 * Returns an empty object when no entry exists or no preferences are set.
 */
export function getModelPreferences(
  db: Database.Database,
  userId: string,
  channel: string,
): Partial<Record<DeepPhase, string>> {
  const entry = getAccess(db, userId, channel);
  return entry?.modelPreferences ?? {};
}

/**
 * Return permanently granted tool names for a specific user+channel pair.
 * Returns an empty array when no entry exists or no grants have been added.
 */
export function getApprovedEscalations(
  db: Database.Database,
  userId: string,
  channel: string,
): string[] {
  const entry = getAccess(db, userId, channel);
  return entry?.approvedToolEscalations ?? [];
}

/**
 * Append a tool name to the permanent escalation grants for a specific user+channel.
 * Creates an access_control entry with the given defaultRole (default: 'owner') if none exists.
 * No-op if the tool is already in the grants list.
 *
 * Pass `defaultRole: 'owner'` (the default) for whitelisted users so they are not
 * accidentally created as read-only viewers on their first tool escalation.
 */
export function addApprovedEscalation(
  db: Database.Database,
  userId: string,
  channel: string,
  tool: string,
  defaultRole: AccessRole = 'owner',
): void {
  const now = new Date().toISOString();
  const existing = getAccess(db, userId, channel);

  if (existing) {
    const current = existing.approvedToolEscalations ?? [];
    if (current.includes(tool)) return;
    const updated = [...current, tool];
    db.prepare(
      `UPDATE access_control
       SET approved_tool_escalations = ?,
           updated_at                = ?
       WHERE user_id = ? AND channel = ?`,
    ).run(JSON.stringify(updated), now, userId, channel);
  } else {
    const initial = [tool];
    db.prepare(
      `INSERT INTO access_control
         (user_id, channel, role, scopes, allowed_actions, blocked_actions,
          max_cost_per_day_usd, daily_cost_used, cost_reset_at, active,
          consent_mode, execution_profile, model_preferences, approved_tool_escalations,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      channel,
      defaultRole,
      null,
      null,
      null,
      null,
      0,
      null,
      1,
      'always-ask',
      'fast',
      null,
      JSON.stringify(initial),
      now,
      now,
    );
  }
}

/**
 * Remove a specific tool name from the permanent escalation grants for a user+channel.
 * No-op if the tool is not in the grants list or no entry exists.
 */
export function removeApprovedEscalation(
  db: Database.Database,
  userId: string,
  channel: string,
  tool: string,
): void {
  const existing = getAccess(db, userId, channel);
  if (!existing) return;
  const current = existing.approvedToolEscalations ?? [];
  if (!current.includes(tool)) return;
  const updated = current.filter((t) => t !== tool);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE access_control
     SET approved_tool_escalations = ?,
         updated_at                = ?
     WHERE user_id = ? AND channel = ?`,
  ).run(JSON.stringify(updated), now, userId, channel);
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
