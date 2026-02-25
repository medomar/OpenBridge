import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SubMasterStatus = 'active' | 'stale' | 'disabled';

export interface SubMasterCapabilities {
  frameworks?: string[];
  languages?: string[];
  patterns?: string[];
  [key: string]: unknown;
}

export interface SubMasterEntry {
  id: string;
  path: string;
  name: string;
  capabilities?: SubMasterCapabilities | null;
  file_count?: number | null;
  last_synced_at?: string | null;
  status?: SubMasterStatus;
}

interface SubMasterRow {
  id: string;
  path: string;
  name: string;
  capabilities: string | null;
  file_count: number | null;
  last_synced_at: string | null;
  status: string;
}

function rowToEntry(row: SubMasterRow): SubMasterEntry {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    capabilities: row.capabilities ? (JSON.parse(row.capabilities) as SubMasterCapabilities) : null,
    file_count: row.file_count,
    last_synced_at: row.last_synced_at,
    status: row.status as SubMasterStatus,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Insert or replace a sub_masters entry.
 * When an entry already exists for the given id, it is fully replaced.
 */
export function registerSubMaster(db: Database.Database, entry: SubMasterEntry): void {
  db.prepare(
    `INSERT OR REPLACE INTO sub_masters
       (id, path, name, capabilities, file_count, last_synced_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.id,
    entry.path,
    entry.name,
    entry.capabilities != null ? JSON.stringify(entry.capabilities) : null,
    entry.file_count ?? null,
    entry.last_synced_at ?? null,
    entry.status ?? 'active',
  );
}

/**
 * Return the sub_masters entry for the given id.
 * Returns null when no entry exists.
 */
export function getSubMaster(db: Database.Database, id: string): SubMasterEntry | null {
  const row = db.prepare(`SELECT * FROM sub_masters WHERE id = ?`).get(id) as
    | SubMasterRow
    | undefined;
  return row ? rowToEntry(row) : null;
}

/** Return all sub_masters entries ordered by path. */
export function listSubMasters(db: Database.Database): SubMasterEntry[] {
  const rows = db.prepare(`SELECT * FROM sub_masters ORDER BY path`).all() as SubMasterRow[];
  return rows.map(rowToEntry);
}

/** Update the status field for a specific sub_masters entry. */
export function updateSubMasterStatus(
  db: Database.Database,
  id: string,
  status: SubMasterStatus,
): void {
  db.prepare(`UPDATE sub_masters SET status = ? WHERE id = ?`).run(status, id);
}

/** Remove the sub_masters entry for the given id. */
export function removeSubMaster(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM sub_masters WHERE id = ?`).run(id);
}
