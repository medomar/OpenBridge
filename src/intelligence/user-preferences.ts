import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Preferred response format learned from interaction patterns */
export type ResponseFormat = 'brief' | 'detailed' | 'unknown';

/** A user preference record stored in SQLite */
export interface UserPreference {
  /** Sender identifier (phone number, user ID, etc.) */
  sender: string;
  /** Preferred response format inferred from interactions */
  responseFormat: ResponseFormat;
  /** Top request types, most frequent first (e.g. "report", "lookup", "create") */
  commonRequestTypes: string[];
  /** Active hours as UTC hour numbers (0–23) seen in past interactions */
  workingHours: number[];
  /** Detected language code (e.g. "en", "fr", "ar") or empty string when unknown */
  languagePreference: string;
  /** ISO timestamp of the first recorded interaction */
  firstSeenAt: string;
  /** ISO timestamp of the most recent interaction */
  lastSeenAt: string;
  /** Total number of interactions recorded */
  interactionCount: number;
}

// ---------------------------------------------------------------------------
// SQLite row type
// ---------------------------------------------------------------------------

interface UserPreferenceRow {
  sender: string;
  response_format: string;
  common_request_types: string;
  working_hours: string;
  language_preference: string;
  first_seen_at: string;
  last_seen_at: string;
  interaction_count: number;
}

function rowToPreference(row: UserPreferenceRow): UserPreference {
  return {
    sender: row.sender,
    responseFormat: (row.response_format as ResponseFormat) ?? 'unknown',
    commonRequestTypes: JSON.parse(row.common_request_types) as string[],
    workingHours: JSON.parse(row.working_hours) as number[],
    languagePreference: row.language_preference ?? '',
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    interactionCount: row.interaction_count,
  };
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * Ensure the `user_preferences` table exists.
 * Safe to call multiple times (uses CREATE TABLE IF NOT EXISTS).
 */
export function ensureUserPreferencesTable(db: Database.Database): void {
  db.prepare(
    `CREATE TABLE IF NOT EXISTS user_preferences (
       sender                TEXT    PRIMARY KEY,
       response_format       TEXT    NOT NULL DEFAULT 'unknown',
       common_request_types  TEXT    NOT NULL DEFAULT '[]',
       working_hours         TEXT    NOT NULL DEFAULT '[]',
       language_preference   TEXT    NOT NULL DEFAULT '',
       first_seen_at         TEXT    NOT NULL,
       last_seen_at          TEXT    NOT NULL,
       interaction_count     INTEGER NOT NULL DEFAULT 0
     )`,
  ).run();
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

/**
 * Record a new interaction for the given sender.
 * Creates the preference row on first call; updates statistics on subsequent calls.
 *
 * @param db          SQLite database instance
 * @param sender      Sender identifier
 * @param requestType Detected request type label (e.g. "report", "lookup")
 * @param language    Detected language code (e.g. "en") — empty string to skip
 */
export function recordInteraction(
  db: Database.Database,
  sender: string,
  requestType?: string,
  language?: string,
): void {
  const now = new Date().toISOString();
  const currentHour = new Date().getUTCHours();

  // Upsert: create row if first interaction, otherwise merge stats
  const existing = db.prepare('SELECT * FROM user_preferences WHERE sender = ?').get(sender) as
    | UserPreferenceRow
    | undefined;

  if (!existing) {
    const requestTypes = requestType ? JSON.stringify([requestType]) : '[]';
    db.prepare(
      `INSERT INTO user_preferences
         (sender, response_format, common_request_types, working_hours, language_preference, first_seen_at, last_seen_at, interaction_count)
       VALUES (?, 'unknown', ?, ?, ?, ?, ?, 1)`,
    ).run(sender, requestTypes, JSON.stringify([currentHour]), language ?? '', now, now);
    return;
  }

  // Merge request types (keep top 10 most frequent)
  const requestTypes = JSON.parse(existing.common_request_types) as string[];
  if (requestType && requestType.length > 0) {
    requestTypes.push(requestType);
  }
  const typeCounts = new Map<string, number>();
  for (const t of requestTypes) {
    typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
  }
  const topTypes = [...typeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([t]) => t);

  // Merge working hours (keep unique hours seen, max 24 entries)
  const hours = JSON.parse(existing.working_hours) as number[];
  if (!hours.includes(currentHour)) {
    hours.push(currentHour);
    hours.sort((a, b) => a - b);
  }

  // Language: update only if a non-empty value is provided
  const lang = language && language.length > 0 ? language : existing.language_preference;

  db.prepare(
    `UPDATE user_preferences SET
       common_request_types = ?,
       working_hours        = ?,
       language_preference  = ?,
       last_seen_at         = ?,
       interaction_count    = interaction_count + 1
     WHERE sender = ?`,
  ).run(JSON.stringify(topTypes), JSON.stringify(hours), lang, now, sender);
}

/**
 * Update the inferred response format for a sender.
 * Call this when there is enough signal to determine whether the user
 * prefers brief or detailed responses.
 */
export function setResponseFormat(
  db: Database.Database,
  sender: string,
  format: ResponseFormat,
): void {
  db.prepare(`UPDATE user_preferences SET response_format = ? WHERE sender = ?`).run(
    format,
    sender,
  );
}

/**
 * Retrieve the stored preferences for a sender.
 * Returns null when no interactions have been recorded yet.
 */
export function getUserPreference(db: Database.Database, sender: string): UserPreference | null {
  const row = db.prepare('SELECT * FROM user_preferences WHERE sender = ?').get(sender) as
    | UserPreferenceRow
    | undefined;
  return row ? rowToPreference(row) : null;
}

/**
 * Return all stored user preference rows.
 */
export function listUserPreferences(db: Database.Database): UserPreference[] {
  const rows = db
    .prepare('SELECT * FROM user_preferences ORDER BY last_seen_at DESC')
    .all() as UserPreferenceRow[];
  return rows.map(rowToPreference);
}

/**
 * Delete a sender's preference record.
 * Returns true if a row was removed.
 */
export function deleteUserPreference(db: Database.Database, sender: string): boolean {
  const result = db.prepare('DELETE FROM user_preferences WHERE sender = ?').run(sender);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Prompt injection
// ---------------------------------------------------------------------------

/**
 * Build the `## User Preferences for {sender}` section for injection into
 * the Master AI prompt.  Returns null when no preferences are stored.
 */
export function buildUserPreferencesSection(db: Database.Database, sender: string): string | null {
  const prefs = getUserPreference(db, sender);
  if (!prefs || prefs.interactionCount < 2) return null;

  const lines: string[] = [`## User Preferences for ${sender}`, ''];

  if (prefs.responseFormat !== 'unknown') {
    lines.push(
      `- **Response style:** ${prefs.responseFormat === 'brief' ? 'Keep responses concise and to the point.' : 'Provide detailed, thorough responses.'}`,
    );
  }

  if (prefs.commonRequestTypes.length > 0) {
    lines.push(`- **Common request types:** ${prefs.commonRequestTypes.slice(0, 5).join(', ')}`);
  }

  if (prefs.workingHours.length > 0) {
    const formatted = formatWorkingHours(prefs.workingHours);
    if (formatted) {
      lines.push(`- **Typically active:** ${formatted}`);
    }
  }

  if (prefs.languagePreference && prefs.languagePreference.length > 0) {
    lines.push(`- **Language preference:** ${prefs.languagePreference}`);
  }

  lines.push(`- **Interactions recorded:** ${prefs.interactionCount}`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Format a sorted list of UTC hours (0–23) into a human-readable active window.
 * E.g. [8, 9, 10, 11, 14, 15] → "08:00–12:00 UTC, 14:00–16:00 UTC"
 */
function formatWorkingHours(hours: number[]): string {
  if (hours.length === 0) return '';

  // Group contiguous hours into ranges
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  let rangeStart = sorted[0]!;
  let prev = sorted[0]!;

  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i]!;
    if (h === prev + 1) {
      prev = h;
    } else {
      ranges.push([rangeStart, prev + 1]);
      rangeStart = h;
      prev = h;
    }
  }
  ranges.push([rangeStart, prev + 1]);

  return ranges
    .map(
      ([start, end]) =>
        `${String(start).padStart(2, '0')}:00–${String(end).padStart(2, '0')}:00 UTC`,
    )
    .join(', ');
}
