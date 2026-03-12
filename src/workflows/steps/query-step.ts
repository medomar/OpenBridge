import type Database from 'better-sqlite3';
import { z } from 'zod';
import { createLogger } from '../../core/logger.js';
import type { StepResult } from '../../types/workflow.js';

const logger = createLogger('query-step');

/** Maximum number of records returned by a single query step */
const MAX_RECORDS = 500;

/**
 * Schema for query step configuration
 */
export const QueryConfigSchema = z
  .object({
    /** DocType name to query (e.g. "Invoice", "Lead") */
    doctype: z.string().min(1, 'DocType name cannot be empty'),
    /** Key/value filters applied as WHERE field = value */
    filters: z.record(z.unknown()).optional().default({}),
  })
  .strict();

export type QueryConfig = z.infer<typeof QueryConfigSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely double-quote an SQL identifier */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Resolve the physical table name for a given DocType name.
 * Returns null if the DocType does not exist.
 */
function resolveTableName(db: Database.Database, doctypeName: string): string | null {
  const row = db.prepare('SELECT table_name FROM doctypes WHERE name = ?').get(doctypeName) as
    | { table_name: string }
    | undefined;

  return row?.table_name ?? null;
}

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------

/**
 * Execute a query step: look up records from a DocType table filtered by
 * the provided key/value pairs and return them in the step output.
 *
 * @param db     - SQLite database instance
 * @param config - Step configuration (doctype name + optional filters)
 * @param input  - Incoming data envelope from the previous step
 * @returns A StepResult whose `json.records` contains the matching rows
 */
// eslint-disable-next-line @typescript-eslint/require-await -- better-sqlite3 is sync; async signature matches the step interface contract
export async function executeQueryStep(
  db: Database.Database,
  config: { doctype: string; filters?: Record<string, unknown> },
  input: StepResult,
): Promise<StepResult> {
  const parsed = QueryConfigSchema.parse(config);
  const { doctype, filters } = parsed;

  const tableName = resolveTableName(db, doctype);
  if (!tableName) {
    logger.warn({ doctype }, 'DocType not found for query step');
    return {
      json: { ...input.json, records: [], _query_error: `DocType "${doctype}" not found` },
      files: input.files,
    };
  }

  const quotedTable = quoteIdentifier(tableName);

  // Build WHERE clause from filters — only accept scalar primitives to
  // prevent SQL injection via crafted filter values.
  const whereClauses: string[] = [];
  const whereParams: unknown[] = [];

  for (const [field, value] of Object.entries(filters ?? {})) {
    if (value === null || value === undefined) {
      whereClauses.push(`${quoteIdentifier(field)} IS NULL`);
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      whereClauses.push(`${quoteIdentifier(field)} = ?`);
      whereParams.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    } else {
      // Non-scalar filter values are skipped to avoid injection
      logger.debug({ field, valueType: typeof value }, 'Skipping non-scalar filter value');
    }
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const sql = `SELECT * FROM ${quotedTable} ${whereSQL} LIMIT ?`;

  let records: Record<string, unknown>[];
  try {
    records = db.prepare(sql).all(...whereParams, MAX_RECORDS) as Record<string, unknown>[];
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ doctype, tableName, error: errorMsg }, 'Query step failed');
    return {
      json: { ...input.json, records: [], _query_error: errorMsg },
      files: input.files,
    };
  }

  logger.debug({ doctype, count: records.length }, 'Query step completed');

  return {
    json: { ...input.json, records },
    files: input.files,
  };
}
