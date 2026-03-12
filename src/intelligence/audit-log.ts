import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single audit log entry from the dt_audit_log table. */
export interface AuditEntry {
  id: number;
  doctype: string;
  record_id: string;
  /** e.g. 'transition', 'update', 'create', 'delete' */
  event: string;
  /** Old value (state name, field value serialised as string, or null) */
  old_value: string | null;
  /** New value (state name, field value serialised as string, or null) */
  new_value: string | null;
  /** Who made the change (role name, user identifier, or null) */
  changed_by: string | null;
  changed_at: string;
}

interface AuditRow {
  id: number;
  doctype: string;
  record_id: string;
  event: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Set of database instances that have already had the audit log table created.
 * Using WeakSet ensures entries are garbage-collected when the DB is closed.
 */
const initializedDbs = new WeakSet<Database.Database>();

/**
 * Ensure the dt_audit_log table exists.
 * Safe to call multiple times and across different database instances.
 * Must be called OUTSIDE any active transaction.
 */
export function ensureAuditLogTable(db: Database.Database): void {
  if (initializedDbs.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS dt_audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      doctype     TEXT NOT NULL,
      record_id   TEXT NOT NULL,
      event       TEXT NOT NULL,
      old_value   TEXT,
      new_value   TEXT,
      changed_by  TEXT,
      changed_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dt_audit_log_record
      ON dt_audit_log(doctype, record_id);
  `);
  initializedDbs.add(db);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Insert a single audit log entry.
 * Callers must ensure the dt_audit_log table exists by calling
 * ensureAuditLogTable(db) before any active transaction.
 */
export function insertAuditEntry(db: Database.Database, entry: Omit<AuditEntry, 'id'>): void {
  db.prepare(
    `INSERT INTO dt_audit_log
       (doctype, record_id, event, old_value, new_value, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.doctype,
    entry.record_id,
    entry.event,
    entry.old_value ?? null,
    entry.new_value ?? null,
    entry.changed_by ?? null,
    entry.changed_at,
  );
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Retrieve the full audit history for a specific record, ordered by
 * changed_at ascending (oldest first).
 *
 * @param db        - better-sqlite3 Database instance
 * @param doctype   - DocType name (e.g. "Invoice")
 * @param recordId  - The record's UUID
 */
export function getAuditLog(
  db: Database.Database,
  doctype: string,
  recordId: string,
): AuditEntry[] {
  // Safe to call here — getAuditLog is never called inside a transaction
  ensureAuditLogTable(db);
  const rows = db
    .prepare(
      `SELECT * FROM dt_audit_log
       WHERE doctype = ? AND record_id = ?
       ORDER BY changed_at ASC, id ASC`,
    )
    .all(doctype, recordId) as AuditRow[];
  return rows;
}
