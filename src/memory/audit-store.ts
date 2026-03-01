import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditEventType = 'inbound' | 'outbound' | 'auth_denied' | 'rate_limited' | 'error';

export interface AuditRecord {
  id?: number;
  timestamp: string;
  event: AuditEventType;
  message_id?: string | null;
  sender?: string | null;
  source?: string | null;
  recipient?: string | null;
  content_length?: number | null;
  error?: string | null;
  metadata?: string | null;
}

export interface AuditSearchOptions {
  event?: AuditEventType;
  sender?: string;
  limit?: number;
  since?: string;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Insert an audit log entry. */
export function insertAuditEntry(db: Database.Database, entry: AuditRecord): void {
  db.prepare(
    `INSERT INTO audit_log
       (timestamp, event, message_id, sender, source, recipient, content_length, error, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.timestamp,
    entry.event,
    entry.message_id ?? null,
    entry.sender ?? null,
    entry.source ?? null,
    entry.recipient ?? null,
    entry.content_length ?? null,
    entry.error ?? null,
    entry.metadata ?? null,
  );
}

/** Query audit log entries with optional filters. */
export function queryAuditEntries(
  db: Database.Database,
  options?: AuditSearchOptions,
): AuditRecord[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options?.event) {
    conditions.push('event = ?');
    params.push(options.event);
  }
  if (options?.sender) {
    conditions.push('sender = ?');
    params.push(options.sender);
  }
  if (options?.since) {
    conditions.push('timestamp >= ?');
    params.push(options.since);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 100;

  return db
    .prepare(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit) as AuditRecord[];
}

/** Full-text search across audit log entries. */
export function searchAuditLog(db: Database.Database, query: string, limit = 20): AuditRecord[] {
  interface FtsRow {
    rowid: number;
  }
  const ftsRows = db
    .prepare(`SELECT rowid FROM audit_log_fts WHERE audit_log_fts MATCH ? LIMIT ?`)
    .all(query, limit) as FtsRow[];

  if (ftsRows.length === 0) return [];

  const placeholders = ftsRows.map(() => '?').join(',');
  const ids = ftsRows.map((r) => r.rowid);

  return db
    .prepare(`SELECT * FROM audit_log WHERE id IN (${placeholders}) ORDER BY id DESC`)
    .all(...ids) as AuditRecord[];
}

/** Count audit entries by event type within a time range. */
export function countAuditByEvent(
  db: Database.Database,
  since?: string,
): { event: string; count: number }[] {
  const where = since ? 'WHERE timestamp >= ?' : '';
  const params = since ? [since] : [];

  return db
    .prepare(
      `SELECT event, COUNT(*) as count FROM audit_log ${where} GROUP BY event ORDER BY count DESC`,
    )
    .all(...params) as { event: string; count: number }[];
}
