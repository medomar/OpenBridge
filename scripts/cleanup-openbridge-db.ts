#!/usr/bin/env tsx
/**
 * cleanup-openbridge-db.ts
 * Clears stale exploration state from an openbridge.db SQLite database.
 *
 * Usage:
 *   npm run cleanup-db                              # uses .openbridge/openbridge.db
 *   npm run cleanup-db -- /path/to/openbridge.db   # explicit path
 *   npx tsx scripts/cleanup-openbridge-db.ts [db-path]
 *
 * Tables cleaned:
 *   system_config   WHERE key LIKE 'exploration%'
 *   workspace_state ALL rows (equivalent to deleting analysis-marker.json)
 *   context_chunks  WHERE created_at < now - 7 days  (stale exploration chunks)
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { resolve } from 'path';

// ── Resolve DB path ────────────────────────────────────────────────

const arg = process.argv[2];
const dbPath = arg ? resolve(arg) : resolve(process.cwd(), '.openbridge', 'openbridge.db');

if (!existsSync(dbPath)) {
  console.error(`Error: database not found: ${dbPath}`);
  process.exit(1);
}

console.log(`Database: ${dbPath}`);
console.log('');

// ── Open database ─────────────────────────────────────────────────

const db = new Database(dbPath);

// Helper: safely check if a table exists
function tableExists(name: string): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name=?`)
    .get(name) as { cnt: number };
  return row.cnt > 0;
}

// Helper: count + delete rows, log result
function cleanTable(
  table: string,
  countSql: string,
  deleteSql: string,
  description: string,
): number {
  if (!tableExists(table)) {
    console.log(`  [skip] ${table} — table not found`);
    return 0;
  }
  const { count } = db.prepare(countSql).get() as { count: number };
  db.prepare(deleteSql).run();
  console.log(`  [deleted] ${count} row(s) from ${table} (${description})`);
  return count;
}

// ── Cleanup ───────────────────────────────────────────────────────

let totalDeleted = 0;

// 1. Clear exploration state keys from system_config
totalDeleted += cleanTable(
  'system_config',
  `SELECT COUNT(*) AS count FROM system_config WHERE key LIKE 'exploration%'`,
  `DELETE FROM system_config WHERE key LIKE 'exploration%'`,
  'exploration state keys',
);

// 2. Clear workspace analysis marker (all rows)
totalDeleted += cleanTable(
  'workspace_state',
  `SELECT COUNT(*) AS count FROM workspace_state`,
  `DELETE FROM workspace_state`,
  'workspace analysis marker',
);

// 3. Evict stale exploration chunks (>7 days old)
totalDeleted += cleanTable(
  'context_chunks',
  `SELECT COUNT(*) AS count FROM context_chunks WHERE datetime(created_at) < datetime('now', '-7 days')`,
  `DELETE FROM context_chunks WHERE datetime(created_at) < datetime('now', '-7 days')`,
  'stale exploration chunks (>7 days old)',
);

// ── Summary ───────────────────────────────────────────────────────

db.close();
console.log('');
console.log(`DB cleanup complete. ${totalDeleted} total row(s) deleted.`);
console.log('OpenBridge will trigger fresh exploration on next startup.');
