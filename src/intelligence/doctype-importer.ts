/**
 * DocType Importer — Import data from CSV/Excel files into DocType tables.
 *
 * Detects the file type (CSV or Excel), calls the document-processor to
 * extract table data, maps column headers to DocType field names using a
 * normalisation-based heuristic, and inserts valid rows via the database.
 * Skipped rows are reported with a human-readable reason.
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ExtractedTable } from '../types/intelligence.js';
import { processCsv } from './processors/csv-processor.js';
import { processExcel } from './processors/excel-processor.js';
import { getDocTypeByName } from './doctype-store.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('doctype-importer');

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Result returned by importFromFile */
export interface ImportResult {
  /** Number of rows successfully imported */
  imported: number;
  /** Human-readable error messages for skipped rows */
  errors: string[];
}

// ---------------------------------------------------------------------------
// Header → field mapping
// ---------------------------------------------------------------------------

/**
 * Normalise a string for fuzzy column-to-field matching.
 * Lowercases, strips leading/trailing whitespace, and collapses spaces/hyphens/dots to underscores.
 */
function normalise(str: string): string {
  return str
    .trim()
    .toLowerCase()
    .replace(/[\s\-.]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

/**
 * Build a mapping from column index → DocType field name.
 *
 * Matching priority (highest first):
 *   1. Exact field name match (case-insensitive)
 *   2. Exact field label match (case-insensitive)
 *   3. Normalised name / label match
 *
 * Returns a sparse array — unmapped column indices are left undefined.
 */
function buildColumnMap(
  headers: string[],
  fields: Array<{ name: string; label: string; field_type: string; formula?: string | null }>,
): Array<string | undefined> {
  // Only map non-formula, non-table fields
  const mappableFields = fields.filter((f) => !f.formula && f.field_type !== 'table');

  return headers.map((header) => {
    const normHeader = normalise(header);

    // 1. Exact field-name match
    const exact = mappableFields.find((f) => f.name.toLowerCase() === header.trim().toLowerCase());
    if (exact) return exact.name;

    // 2. Exact label match
    const labelExact = mappableFields.find(
      (f) => f.label.toLowerCase() === header.trim().toLowerCase(),
    );
    if (labelExact) return labelExact.name;

    // 3. Normalised match on name or label
    const fuzzy = mappableFields.find(
      (f) => normalise(f.name) === normHeader || normalise(f.label) === normHeader,
    );
    if (fuzzy) return fuzzy.name;

    return undefined;
  });
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

/** Coerce a raw cell value into the appropriate SQLite-ready value for the given field type. */
function coerceValue(
  raw: unknown,
  fieldType: string,
): { ok: true; value: unknown } | { ok: false; reason: string } {
  // Treat empty string / null / undefined as NULL (omit from INSERT)
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: null };
  }

  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
    return { ok: false, reason: `Unexpected value type: ${typeof raw}` };
  }

  const str = String(raw).trim();

  switch (fieldType) {
    case 'number':
    case 'currency': {
      // Strip common currency symbols before parsing
      const cleaned = str.replace(/[$£€,\s]/g, '');
      const num = Number(cleaned);
      if (isNaN(num)) return { ok: false, reason: `Cannot parse "${str}" as number` };
      return { ok: true, value: num };
    }
    case 'checkbox': {
      const lower = str.toLowerCase();
      if (['1', 'true', 'yes', 'y', 'on'].includes(lower)) return { ok: true, value: 1 };
      if (['0', 'false', 'no', 'n', 'off', ''].includes(lower)) return { ok: true, value: 0 };
      return { ok: false, reason: `Cannot parse "${str}" as checkbox` };
    }
    case 'date': {
      // Accept ISO format; try to normalise common MM/DD/YYYY or DD/MM/YYYY
      if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return { ok: true, value: str };
      const d = new Date(str);
      if (!isNaN(d.getTime())) return { ok: true, value: d.toISOString().slice(0, 10) };
      return { ok: false, reason: `Cannot parse "${str}" as date` };
    }
    case 'datetime': {
      const d = new Date(str);
      if (!isNaN(d.getTime())) return { ok: true, value: d.toISOString() };
      return { ok: false, reason: `Cannot parse "${str}" as datetime` };
    }
    default:
      return { ok: true, value: str };
  }
}

// ---------------------------------------------------------------------------
// Row insertion
// ---------------------------------------------------------------------------

/** Quote a SQLite identifier */
function quoteId(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Insert a single data row into the DocType table.
 * Returns null on success, or an error message on failure.
 */
function insertRow(
  db: Database.Database,
  tableName: string,
  fieldMap: Array<{ fieldName: string; fieldType: string; colIndex: number }>,
  row: unknown[],
  rowIndex: number,
): string | null {
  const columns: string[] = ['id', 'created_at', 'updated_at', 'created_by'];
  const placeholders: string[] = ['?', '?', '?', '?'];
  const values: unknown[] = [
    randomUUID(),
    new Date().toISOString(),
    new Date().toISOString(),
    'import',
  ];

  for (const { fieldName, fieldType, colIndex } of fieldMap) {
    const raw = row[colIndex];
    const coerced = coerceValue(raw, fieldType);
    if (!coerced.ok) {
      return `Row ${rowIndex + 1}: field "${fieldName}" — ${coerced.reason}`;
    }
    if (coerced.value !== null) {
      columns.push(quoteId(fieldName));
      placeholders.push('?');
      values.push(coerced.value);
    }
  }

  try {
    const sql = `INSERT INTO ${quoteId(tableName)} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`;
    db.prepare(sql).run(...values);
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Row ${rowIndex + 1}: insert failed — ${msg}`;
  }
}

// ---------------------------------------------------------------------------
// File type detection
// ---------------------------------------------------------------------------

function isCsvPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.csv');
}

function isExcelPath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Import data from a CSV or Excel file into the named DocType's SQLite table.
 *
 * Steps:
 *   1. Detect file type and extract tables via the document processor.
 *   2. Pick the first (or largest) table from the extracted output.
 *   3. Map column headers to DocType field names via normalised heuristic.
 *   4. Insert each row; collect errors for skipped rows.
 *
 * @param db           - Open SQLite database handle.
 * @param filePath     - Absolute path to the file to import (CSV or XLSX/XLS).
 * @param doctypeName  - Name of the target DocType (must exist in doctypes table).
 * @returns            Promise resolving to { imported, errors }.
 */
export async function importFromFile(
  db: Database.Database,
  filePath: string,
  doctypeName: string,
): Promise<ImportResult> {
  // ── 1. Load DocType metadata ───────────────────────────────────────────────
  const fullDocType = getDocTypeByName(db, doctypeName);
  if (!fullDocType) {
    return { imported: 0, errors: [`DocType "${doctypeName}" not found`] };
  }

  const { doctype, fields } = fullDocType;
  logger.info({ doctype: doctypeName, filePath }, 'Starting import');

  // ── 2. Extract tables from file ───────────────────────────────────────────
  let result;
  try {
    if (isCsvPath(filePath)) {
      result = await processCsv(filePath);
    } else if (isExcelPath(filePath)) {
      result = await processExcel(filePath);
    } else {
      return {
        imported: 0,
        errors: [`Unsupported file type: ${filePath} (expected .csv, .xlsx, or .xls)`],
      };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { imported: 0, errors: [`Failed to read file: ${msg}`] };
  }

  if (result.tables.length === 0) {
    return { imported: 0, errors: ['No tables found in file'] };
  }

  // Pick the table with the most data rows; fall back to the first table
  const table: ExtractedTable = result.tables.reduce(
    (best, t) => (t.rows.length > best.rows.length ? t : best),
    result.tables[0]!,
  );

  if (table.headers.length === 0) {
    return { imported: 0, errors: ['Table has no headers'] };
  }

  if (table.rows.length === 0) {
    return { imported: 0, errors: ['Table has no data rows'] };
  }

  // ── 3. Build column → field mapping ───────────────────────────────────────
  const columnMap = buildColumnMap(table.headers, fields);

  // Build a flat list of mapped columns for insertion
  const fieldMap: Array<{ fieldName: string; fieldType: string; colIndex: number }> = [];
  const unmappedHeaders: string[] = [];

  for (let i = 0; i < table.headers.length; i++) {
    const fieldName = columnMap[i];
    if (fieldName) {
      const field = fields.find((f) => f.name === fieldName)!;
      fieldMap.push({ fieldName, fieldType: field.field_type, colIndex: i });
    } else {
      unmappedHeaders.push(table.headers[i] ?? `col_${i}`);
    }
  }

  if (fieldMap.length === 0) {
    return {
      imported: 0,
      errors: [
        `No columns could be mapped to DocType fields. ` +
          `File headers: [${table.headers.join(', ')}]. ` +
          `DocType fields: [${fields.map((f) => f.name).join(', ')}].`,
      ],
    };
  }

  if (unmappedHeaders.length > 0) {
    logger.warn({ doctype: doctypeName, unmappedHeaders }, 'Some columns could not be mapped');
  }

  // ── 4. Insert rows ─────────────────────────────────────────────────────────
  let imported = 0;
  const errors: string[] = [];

  for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
    const row = table.rows[rowIndex]!;
    const error = insertRow(db, doctype.table_name, fieldMap, row, rowIndex);
    if (error) {
      errors.push(error);
    } else {
      imported++;
    }
  }

  logger.info({ doctype: doctypeName, imported, skipped: errors.length }, 'Import complete');

  return { imported, errors };
}
