/**
 * Daily XLS Import Pipeline — ingest daily sales spreadsheets into the cafe demo database.
 *
 * Reads an XLSX/XLS file, maps columns to the daily_sales table fields, deduplicates
 * by (date, item_name), and records import metadata in import_history.
 *
 * Expected XLS columns (fuzzy-matched):
 *   date | item_name / item | category | quantity / qty | unit_price / price | total / amount | cashier
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { processExcel } from './processors/excel-processor.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('daily-import-pipeline');

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface DailyImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_sales (
      id          TEXT PRIMARY KEY,
      date        TEXT NOT NULL,
      item_name   TEXT NOT NULL,
      category    TEXT,
      quantity    REAL,
      unit_price  REAL,
      total       REAL,
      cashier     TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(date, item_name)
    );

    CREATE TABLE IF NOT EXISTS import_history (
      id           TEXT PRIMARY KEY,
      date         TEXT NOT NULL,
      filename     TEXT NOT NULL,
      hash         TEXT NOT NULL,
      record_count INTEGER NOT NULL,
      imported_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_daily_sales_date ON daily_sales(date);
    CREATE INDEX IF NOT EXISTS idx_daily_sales_item  ON daily_sales(item_name);
  `);
}

// ---------------------------------------------------------------------------
// Column mapping (fuzzy)
// ---------------------------------------------------------------------------

/** Normalise a header string for fuzzy matching. */
function norm(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s\-./]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

const FIELD_ALIASES: Record<string, string[]> = {
  date: ['date', 'sale_date', 'transaction_date', 'day'],
  item_name: ['item_name', 'item', 'product', 'article', 'name', 'produit'],
  category: ['category', 'cat', 'type', 'categorie'],
  quantity: ['quantity', 'qty', 'quantite', 'qte', 'count'],
  unit_price: ['unit_price', 'price', 'prix', 'unit_cost', 'prix_unitaire'],
  total: ['total', 'amount', 'montant', 'subtotal', 'total_price'],
  cashier: ['cashier', 'server', 'staff', 'employee', 'caissier'],
};

function buildColumnMap(headers: string[]): Array<string | undefined> {
  return headers.map((header) => {
    const n = norm(header);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(n)) return field;
    }
    return undefined;
  });
}

// ---------------------------------------------------------------------------
// Value coercion
// ---------------------------------------------------------------------------

function toNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const cleaned = String(raw as string | number).replace(/[$€£,\s]/g, '');
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}

function toDate(raw: unknown, fallback: string): string {
  if (!raw || raw === '') return fallback;
  const s = String(raw as string | number).trim();
  // ISO already
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try Date parse
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return fallback;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Process a daily sales XLS/XLSX file and insert rows into the daily_sales table.
 *
 * @param filePath  Absolute path to the XLSX or XLS file.
 * @param db        Open SQLite database handle.
 * @param date      Override date for all rows (YYYY-MM-DD). Defaults to today.
 * @returns         { imported, skipped, errors }
 */
export async function processDailyXLS(
  filePath: string,
  db: Database.Database,
  date?: string,
): Promise<DailyImportResult> {
  ensureSchema(db);

  const today = new Date().toISOString().slice(0, 10);
  const defaultDate = date ?? today;
  const filename = basename(filePath);

  // ── 1. File hash for dedup of import_history ─────────────────────────────
  let fileHash: string;
  try {
    const buf = readFileSync(filePath);
    fileHash = createHash('md5').update(buf).digest('hex');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { imported: 0, skipped: 0, errors: [`Cannot read file: ${msg}`] };
  }

  // ── 2. Extract rows from XLSX ─────────────────────────────────────────────
  let result;
  try {
    result = await processExcel(filePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { imported: 0, skipped: 0, errors: [`Excel parse error: ${msg}`] };
  }

  if (result.tables.length === 0) {
    return { imported: 0, skipped: 0, errors: ['No sheets with data found in file'] };
  }

  // Pick the largest table
  const table = result.tables.reduce(
    (best, t) => (t.rows.length > best.rows.length ? t : best),
    result.tables[0]!,
  );

  if (table.rows.length === 0) {
    return { imported: 0, skipped: 0, errors: ['Sheet has no data rows'] };
  }

  // ── 3. Map columns ────────────────────────────────────────────────────────
  const columnMap = buildColumnMap(table.headers);
  const mappedFields = columnMap.filter(Boolean);

  if (!mappedFields.includes('item_name')) {
    return {
      imported: 0,
      skipped: 0,
      errors: [
        `Could not find an item_name column. ` +
          `Headers found: [${table.headers.join(', ')}]. ` +
          `Expected one of: item_name, item, product, article, name.`,
      ],
    };
  }

  logger.info({ filePath, rows: table.rows.length, hash: fileHash }, 'Starting daily XLS import');

  // ── 4. Insert rows ────────────────────────────────────────────────────────
  const checkDup = db.prepare('SELECT 1 FROM daily_sales WHERE date = ? AND item_name = ? LIMIT 1');

  const insert = db.prepare(`
    INSERT INTO daily_sales (id, date, item_name, category, quantity, unit_price, total, cashier, created_at)
    VALUES (@id, @date, @item_name, @category, @quantity, @unit_price, @total, @cashier, @created_at)
  `);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  const runImport = db.transaction(() => {
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i]!;

      // Build a field → value map for this row
      const fields: Record<string, unknown> = {};
      for (let ci = 0; ci < columnMap.length; ci++) {
        const field = columnMap[ci];
        if (field) fields[field] = row[ci];
      }

      const itemName = fields['item_name'] ? String(fields['item_name'] as string).trim() : '';
      if (!itemName) {
        errors.push(`Row ${i + 2}: item_name is empty — skipped`);
        skipped++;
        continue;
      }

      const rowDate = toDate(fields['date'], defaultDate);

      // Deduplication check
      const existing = checkDup.get(rowDate, itemName);
      if (existing) {
        skipped++;
        continue;
      }

      try {
        insert.run({
          id: randomUUID(),
          date: rowDate,
          item_name: itemName,
          category: fields['category'] ? String(fields['category'] as string).trim() : null,
          quantity: toNumber(fields['quantity']),
          unit_price: toNumber(fields['unit_price']),
          total: toNumber(fields['total']),
          cashier: fields['cashier'] ? String(fields['cashier'] as string).trim() : null,
          created_at: new Date().toISOString(),
        });
        imported++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Row ${i + 2}: insert failed — ${msg}`);
        skipped++;
      }
    }
  });

  runImport();

  // ── 5. Record import metadata ─────────────────────────────────────────────
  db.prepare(
    `
    INSERT INTO import_history (id, date, filename, hash, record_count, imported_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(randomUUID(), defaultDate, filename, fileHash, imported, new Date().toISOString());

  logger.info({ filename, imported, skipped, errors: errors.length }, 'Daily XLS import complete');

  return { imported, skipped, errors };
}
