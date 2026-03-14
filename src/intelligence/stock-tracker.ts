/**
 * Stock Tracker — technical inventory data and sales history queries for the cafe demo.
 *
 * Provides stock valuation, daily totals, and per-item sales history
 * based on the daily_sales table populated by daily-import-pipeline.
 */

import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Technical details for a stock-tracked item. */
export interface StockItem {
  item_name: string;
  category: string;
  unit_cost: number;
  supplier: string;
  storage_temp: string;
  shelf_life_days: number;
  min_stock: number;
  current_stock: number;
}

/** Stock valuation entry — current stock × unit cost. */
export interface StockValuation {
  item_name: string;
  current_stock: number;
  unit_cost: number;
  total_value: number;
}

/** Daily sales total. */
export interface DailySalesTotal {
  date: string;
  total_revenue: number;
  total_quantity: number;
  transaction_count: number;
}

/** Per-item sales record over a date range. */
export interface ItemSalesRecord {
  date: string;
  quantity: number;
  unit_price: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Schema helper
// ---------------------------------------------------------------------------

function ensureStockSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_items (
      item_name        TEXT PRIMARY KEY,
      category         TEXT NOT NULL DEFAULT '',
      unit_cost        REAL NOT NULL DEFAULT 0,
      supplier         TEXT NOT NULL DEFAULT '',
      storage_temp     TEXT NOT NULL DEFAULT '',
      shelf_life_days  INTEGER NOT NULL DEFAULT 0,
      min_stock        REAL NOT NULL DEFAULT 0,
      current_stock    REAL NOT NULL DEFAULT 0,
      updated_at       TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Return stock valuation for all items in the stock_items table.
 * Total value = current_stock × unit_cost.
 */
export function getStockValuation(db: Database.Database): StockValuation[] {
  ensureStockSchema(db);

  const rows = db
    .prepare(
      `
      SELECT item_name,
             current_stock,
             unit_cost,
             ROUND(current_stock * unit_cost, 2) AS total_value
      FROM   stock_items
      ORDER  BY item_name
    `,
    )
    .all() as StockValuation[];

  return rows;
}

/**
 * Return daily revenue and quantity totals grouped by date, within the given range.
 *
 * @param db    Open SQLite database handle.
 * @param from  Start date inclusive (YYYY-MM-DD).
 * @param to    End date inclusive (YYYY-MM-DD).
 */
export function getSalesHistory(
  db: Database.Database,
  from: string,
  to: string,
): DailySalesTotal[] {
  // daily_sales created by daily-import-pipeline; may not exist yet
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='daily_sales'`)
    .get();

  if (!tableExists) return [];

  const rows = db
    .prepare(
      `
      SELECT date,
             ROUND(SUM(total), 2)    AS total_revenue,
             SUM(quantity)           AS total_quantity,
             COUNT(*)                AS transaction_count
      FROM   daily_sales
      WHERE  date BETWEEN ? AND ?
      GROUP  BY date
      ORDER  BY date
    `,
    )
    .all(from, to) as DailySalesTotal[];

  return rows;
}

/**
 * Return per-row sales records for a specific item over a date range.
 *
 * @param db        Open SQLite database handle.
 * @param itemName  Exact item_name value (case-sensitive).
 * @param from      Start date inclusive (YYYY-MM-DD).
 * @param to        End date inclusive (YYYY-MM-DD).
 */
export function getItemSalesHistory(
  db: Database.Database,
  itemName: string,
  from: string,
  to: string,
): ItemSalesRecord[] {
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='daily_sales'`)
    .get();

  if (!tableExists) return [];

  const rows = db
    .prepare(
      `
      SELECT date,
             quantity,
             unit_price,
             ROUND(total, 2) AS total
      FROM   daily_sales
      WHERE  item_name = ?
        AND  date BETWEEN ? AND ?
      ORDER  BY date
    `,
    )
    .all(itemName, from, to) as ItemSalesRecord[];

  return rows;
}

// ---------------------------------------------------------------------------
// Stock item CRUD helpers (simple upsert)
// ---------------------------------------------------------------------------

/**
 * Upsert a stock item (insert or replace).
 * Useful when seeding initial stock data or updating quantities.
 */
export function upsertStockItem(db: Database.Database, item: StockItem): void {
  ensureStockSchema(db);

  db.prepare(
    `
    INSERT INTO stock_items
      (item_name, category, unit_cost, supplier, storage_temp, shelf_life_days, min_stock, current_stock, updated_at)
    VALUES
      (@item_name, @category, @unit_cost, @supplier, @storage_temp, @shelf_life_days, @min_stock, @current_stock, @updated_at)
    ON CONFLICT(item_name) DO UPDATE SET
      category        = excluded.category,
      unit_cost       = excluded.unit_cost,
      supplier        = excluded.supplier,
      storage_temp    = excluded.storage_temp,
      shelf_life_days = excluded.shelf_life_days,
      min_stock       = excluded.min_stock,
      current_stock   = excluded.current_stock,
      updated_at      = excluded.updated_at
  `,
  ).run({ ...item, updated_at: new Date().toISOString() });
}

/**
 * Return all stock items sorted by item_name.
 */
export function listStockItems(db: Database.Database): StockItem[] {
  ensureStockSchema(db);

  return db.prepare('SELECT * FROM stock_items ORDER BY item_name').all() as StockItem[];
}
