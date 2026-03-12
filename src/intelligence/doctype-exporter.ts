/**
 * DocType Exporter — Export DocType records to CSV or XLSX files.
 *
 * Queries the DocType's dynamic SQLite table with optional field filters,
 * maps records to tabular form, and writes the output to
 * `<outputDir>/{doctype}-{timestamp}.{ext}` using the SheetJS (xlsx) package.
 *
 * For XLSX exports, child table records are included as additional sheets
 * (one sheet per child field whose `child_doctype` is set).
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { getDocTypeByName } from './doctype-store.js';
import { createLogger } from '../core/logger.js';

// SheetJS — required via CJS interop (no ESM export in the xlsx package)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx') as {
  utils: {
    book_new: () => XLSXWorkbook;
    aoa_to_sheet: (data: (string | number | boolean | null)[][]) => XLSXSheet;
    book_append_sheet: (wb: XLSXWorkbook, ws: XLSXSheet, name: string) => void;
    sheet_to_csv: (ws: XLSXSheet) => string;
  };
  writeFile: (wb: XLSXWorkbook, path: string) => void;
};

interface XLSXWorkbook {
  SheetNames: string[];
  Sheets: Record<string, XLSXSheet>;
}

interface XLSXSheet {
  [key: string]: unknown;
}

const logger = createLogger('doctype-exporter');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Quote a SQLite identifier. */
function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Slugify a name to a safe sheet name (max 31 chars, no special chars). */
function toSheetName(name: string, maxLen = 31): string {
  return name.replace(/[:\\/?*[\]]/g, '_').slice(0, maxLen);
}

/**
 * Build a WHERE clause + parameter array from a flat filters map.
 *
 * Only scalar equality filters are supported (no nested operators).
 * Each key must match an actual column name to prevent injection; unknown
 * keys are silently skipped.
 */
function buildWhereClause(
  filters: Record<string, unknown>,
  allowedColumns: Set<string>,
): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  for (const [key, value] of Object.entries(filters)) {
    if (!allowedColumns.has(key)) continue; // skip unknown columns
    conditions.push(`${quoteId(key)} = ?`);
    params.push(value);
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

/**
 * Query all rows from a table, returning headers and rows as a 2-D array.
 * The first element of the result is the header row.
 */
function queryTable(
  db: Database.Database,
  tableName: string,
  filters: Record<string, unknown>,
): { headers: string[]; rows: (string | number | boolean | null)[][] } {
  // Retrieve column names via PRAGMA so we can validate filter keys
  const pragmaRows = db.prepare(`PRAGMA table_info(${quoteId(tableName)})`).all() as Array<{
    name: string;
  }>;

  if (pragmaRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const columnNames = pragmaRows.map((r) => r.name);
  const allowedColumns = new Set(columnNames);

  const { clause, params } = buildWhereClause(filters, allowedColumns);
  const sql = `SELECT * FROM ${quoteId(tableName)} ${clause}`;

  const dataRows = db.prepare(sql).all(...params) as Record<string, unknown>[];

  const rows = dataRows.map((row) =>
    columnNames.map((col) => {
      const v = row[col];
      if (v === null || v === undefined) return null;
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
      return JSON.stringify(v);
    }),
  );

  return { headers: columnNames, rows };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Export records from a DocType table to a CSV or XLSX file.
 *
 * @param db          - Open SQLite database handle.
 * @param outputDir   - Absolute path to the output directory (created if absent).
 * @param doctypeName - Name of the DocType to export.
 * @param format      - Output format: `'csv'` or `'xlsx'`.
 * @param filters     - Optional equality filters applied to the main table.
 * @returns Absolute path to the written file.
 */
export async function exportToFile(
  db: Database.Database,
  outputDir: string,
  doctypeName: string,
  format: 'csv' | 'xlsx',
  filters: Record<string, unknown> = {},
): Promise<string> {
  // ── 1. Load DocType metadata ───────────────────────────────────────────────
  const fullDocType = getDocTypeByName(db, doctypeName);
  if (!fullDocType) {
    throw new Error(`DocType "${doctypeName}" not found`);
  }

  const { doctype, fields } = fullDocType;
  logger.info({ doctype: doctypeName, format }, 'Starting export');

  // ── 2. Query main table ────────────────────────────────────────────────────
  const mainTable = queryTable(db, doctype.table_name, filters);

  if (mainTable.headers.length === 0) {
    throw new Error(`Table "${doctype.table_name}" does not exist or has no columns`);
  }

  // ── 3. Determine child tables ──────────────────────────────────────────────
  const childFields = fields.filter(
    (f) => f.field_type === 'table' && typeof f.child_doctype === 'string',
  );

  // ── 4. Build output path ───────────────────────────────────────────────────
  mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeName = doctypeName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const ext = format === 'csv' ? 'csv' : 'xlsx';
  const filePath = join(outputDir, `${safeName}-${timestamp}.${ext}`);

  // ── 5. Write file ──────────────────────────────────────────────────────────
  if (format === 'csv') {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([mainTable.headers, ...mainTable.rows]);
    XLSX.utils.book_append_sheet(wb, ws, toSheetName(doctype.label_singular || doctypeName));
    const csv = XLSX.utils.sheet_to_csv(ws);

    // writeFile supports CSV via the bookType option; however, sheet_to_csv +
    // writeFile('.csv') is simpler and consistent across SheetJS versions.
    const { writeFileSync } = await import('node:fs');
    writeFileSync(filePath, csv, 'utf8');

    logger.info({ filePath, rows: mainTable.rows.length }, 'CSV export complete');
  } else {
    // XLSX: main sheet + one sheet per child table
    const wb = XLSX.utils.book_new();

    // Main sheet
    const mainWs = XLSX.utils.aoa_to_sheet([mainTable.headers, ...mainTable.rows]);
    XLSX.utils.book_append_sheet(wb, mainWs, toSheetName(doctype.label_singular || doctypeName));

    // Child sheets — query `dt_{parent}__{child}` pattern
    for (const field of childFields) {
      const childDoctype = field.child_doctype as string;
      // Naming follows the table-builder pattern: dt_{parent}__{child}
      const childTableName = `dt_${doctype.name}__${childDoctype}`;
      const childTable = queryTable(db, childTableName, {});

      if (childTable.headers.length === 0) {
        logger.warn({ childTableName }, 'Child table not found or empty — skipping sheet');
        continue;
      }

      const sheetName = toSheetName(field.label || childDoctype);
      const childWs = XLSX.utils.aoa_to_sheet([childTable.headers, ...childTable.rows]);
      XLSX.utils.book_append_sheet(wb, childWs, sheetName);

      logger.debug({ sheetName, rows: childTable.rows.length }, 'Child sheet added');
    }

    XLSX.writeFile(wb, filePath);

    logger.info(
      { filePath, rows: mainTable.rows.length, sheets: 1 + childFields.length },
      'XLSX export complete',
    );
  }

  return filePath;
}
