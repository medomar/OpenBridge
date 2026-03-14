/**
 * Raw Material Manager — tracks primary ingredients distributed to the pizzeria.
 *
 * Tables:
 *   raw_materials      — ingredient catalog (flour, mozzarella, tuna, etc.)
 *   material_deliveries — delivery records (when you distribute materials)
 *   recipe_ingredients  — technical sheets linking menu items to raw materials
 *
 * Flow:
 *   1. Register raw materials (addRawMaterial)
 *   2. Record deliveries (recordDelivery) → increases stock
 *   3. Define recipes (setRecipeIngredient) → e.g., Pizza Thon = 200g mozza + 200g tuna
 *   4. After daily XLS import, call deductConsumption(db, date) → auto-deducts stock
 *   5. Query stock levels, low-stock alerts, delivery history
 */

import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawMaterial {
  id: string;
  name: string;
  unit: string; // kg, L, pcs, etc.
  cost_per_unit: number; // cost per unit (TND)
  current_stock: number; // current quantity in stock
  min_stock: number; // alert threshold
  supplier: string;
  category: string; // dairy, meat, vegetables, dry goods, etc.
  created_at?: string;
  updated_at?: string;
}

export interface MaterialDelivery {
  id: string;
  material_id: string;
  date: string; // YYYY-MM-DD
  quantity: number;
  cost_per_unit: number;
  total_cost: number;
  supplier: string;
  notes: string;
  created_at?: string;
}

export interface RecipeIngredient {
  id: string;
  item_name: string; // menu item (e.g., "PIZZA THON")
  material_id: string; // raw material FK
  quantity_per_unit: number; // grams/ml/pcs per 1 menu item
  unit: string; // g, ml, pcs
}

export interface ConsumptionResult {
  date: string;
  deductions: Array<{
    material_name: string;
    total_consumed: number;
    unit: string;
    items: Array<{ item_name: string; qty_sold: number; per_unit: number; consumed: number }>;
  }>;
  warnings: string[];
}

export interface StockAlert {
  material_name: string;
  current_stock: number;
  min_stock: number;
  unit: string;
  deficit: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export function ensureRawMaterialSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS raw_materials (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      unit            TEXT NOT NULL DEFAULT 'kg',
      cost_per_unit   REAL NOT NULL DEFAULT 0,
      current_stock   REAL NOT NULL DEFAULT 0,
      min_stock       REAL NOT NULL DEFAULT 0,
      supplier        TEXT NOT NULL DEFAULT '',
      category        TEXT NOT NULL DEFAULT '',
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS material_deliveries (
      id              TEXT PRIMARY KEY,
      material_id     TEXT NOT NULL,
      date            TEXT NOT NULL,
      quantity        REAL NOT NULL,
      cost_per_unit   REAL NOT NULL DEFAULT 0,
      total_cost      REAL NOT NULL DEFAULT 0,
      supplier        TEXT NOT NULL DEFAULT '',
      notes           TEXT NOT NULL DEFAULT '',
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (material_id) REFERENCES raw_materials(id)
    );

    CREATE TABLE IF NOT EXISTS recipe_ingredients (
      id                TEXT PRIMARY KEY,
      item_name         TEXT NOT NULL,
      material_id       TEXT NOT NULL,
      quantity_per_unit  REAL NOT NULL,
      unit              TEXT NOT NULL DEFAULT 'g',
      UNIQUE(item_name, material_id),
      FOREIGN KEY (material_id) REFERENCES raw_materials(id)
    );

    CREATE TABLE IF NOT EXISTS consumption_log (
      id              TEXT PRIMARY KEY,
      date            TEXT NOT NULL,
      material_id     TEXT NOT NULL,
      item_name       TEXT NOT NULL,
      quantity_sold   REAL NOT NULL,
      material_used   REAL NOT NULL,
      unit            TEXT NOT NULL DEFAULT 'g',
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (material_id) REFERENCES raw_materials(id)
    );

    CREATE INDEX IF NOT EXISTS idx_deliveries_date ON material_deliveries(date);
    CREATE INDEX IF NOT EXISTS idx_deliveries_material ON material_deliveries(material_id);
    CREATE INDEX IF NOT EXISTS idx_recipe_item ON recipe_ingredients(item_name);
    CREATE INDEX IF NOT EXISTS idx_consumption_date ON consumption_log(date);
  `);
}

// ---------------------------------------------------------------------------
// Raw Material CRUD
// ---------------------------------------------------------------------------

/** Add or update a raw material. */
export function addRawMaterial(
  db: Database.Database,
  material: Omit<RawMaterial, 'id' | 'created_at' | 'updated_at'> & { id?: string },
): RawMaterial {
  ensureRawMaterialSchema(db);
  const id = material.id ?? randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `
    INSERT INTO raw_materials (id, name, unit, cost_per_unit, current_stock, min_stock, supplier, category, created_at, updated_at)
    VALUES (@id, @name, @unit, @cost_per_unit, @current_stock, @min_stock, @supplier, @category, @created_at, @updated_at)
    ON CONFLICT(name) DO UPDATE SET
      unit          = excluded.unit,
      cost_per_unit = excluded.cost_per_unit,
      min_stock     = excluded.min_stock,
      supplier      = excluded.supplier,
      category      = excluded.category,
      updated_at    = excluded.updated_at
  `,
  ).run({
    id,
    name: material.name,
    unit: material.unit,
    cost_per_unit: material.cost_per_unit,
    current_stock: material.current_stock,
    min_stock: material.min_stock,
    supplier: material.supplier,
    category: material.category,
    created_at: now,
    updated_at: now,
  });

  return db.prepare('SELECT * FROM raw_materials WHERE name = ?').get(material.name) as RawMaterial;
}

/** List all raw materials. */
export function listRawMaterials(db: Database.Database): RawMaterial[] {
  ensureRawMaterialSchema(db);
  return db.prepare('SELECT * FROM raw_materials ORDER BY category, name').all() as RawMaterial[];
}

/** Get a raw material by name (case-insensitive). */
export function getRawMaterial(db: Database.Database, name: string): RawMaterial | null {
  ensureRawMaterialSchema(db);
  return (
    (db
      .prepare('SELECT * FROM raw_materials WHERE LOWER(name) = LOWER(?)')
      .get(name) as RawMaterial) ?? null
  );
}

/** Delete a raw material by name. */
export function deleteRawMaterial(db: Database.Database, name: string): boolean {
  ensureRawMaterialSchema(db);
  const mat = getRawMaterial(db, name);
  if (!mat) return false;
  db.prepare('DELETE FROM recipe_ingredients WHERE material_id = ?').run(mat.id);
  db.prepare('DELETE FROM material_deliveries WHERE material_id = ?').run(mat.id);
  db.prepare('DELETE FROM consumption_log WHERE material_id = ?').run(mat.id);
  db.prepare('DELETE FROM raw_materials WHERE id = ?').run(mat.id);
  return true;
}

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

/** Record a delivery of raw material → increases current_stock. */
export function recordDelivery(
  db: Database.Database,
  materialName: string,
  quantity: number,
  date?: string,
  costPerUnit?: number,
  supplier?: string,
  notes?: string,
): MaterialDelivery | null {
  ensureRawMaterialSchema(db);

  const mat = getRawMaterial(db, materialName);
  if (!mat) return null;

  const deliveryDate = date ?? new Date().toISOString().slice(0, 10);
  const cost = costPerUnit ?? mat.cost_per_unit;
  const totalCost = Math.round(quantity * cost * 100) / 100;
  const id = randomUUID();

  const run = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO material_deliveries (id, material_id, date, quantity, cost_per_unit, total_cost, supplier, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ).run(
      id,
      mat.id,
      deliveryDate,
      quantity,
      cost,
      totalCost,
      supplier ?? mat.supplier,
      notes ?? '',
    );

    db.prepare(
      `
      UPDATE raw_materials SET current_stock = current_stock + ?, updated_at = ? WHERE id = ?
    `,
    ).run(quantity, new Date().toISOString(), mat.id);
  });

  run();

  return db.prepare('SELECT * FROM material_deliveries WHERE id = ?').get(id) as MaterialDelivery;
}

/** Get delivery history for a material, or all if no name given. */
export function getDeliveries(
  db: Database.Database,
  materialName?: string,
  from?: string,
  to?: string,
): MaterialDelivery[] {
  ensureRawMaterialSchema(db);

  if (materialName) {
    const mat = getRawMaterial(db, materialName);
    if (!mat) return [];

    if (from && to) {
      return db
        .prepare(
          `
        SELECT d.* FROM material_deliveries d WHERE d.material_id = ? AND d.date BETWEEN ? AND ? ORDER BY d.date DESC
      `,
        )
        .all(mat.id, from, to) as MaterialDelivery[];
    }
    return db
      .prepare(
        `
      SELECT * FROM material_deliveries WHERE material_id = ? ORDER BY date DESC
    `,
      )
      .all(mat.id) as MaterialDelivery[];
  }

  if (from && to) {
    return db
      .prepare(
        `
      SELECT * FROM material_deliveries WHERE date BETWEEN ? AND ? ORDER BY date DESC
    `,
      )
      .all(from, to) as MaterialDelivery[];
  }
  return db
    .prepare('SELECT * FROM material_deliveries ORDER BY date DESC LIMIT 100')
    .all() as MaterialDelivery[];
}

// ---------------------------------------------------------------------------
// Recipes (Technical Sheets)
// ---------------------------------------------------------------------------

/** Set a recipe ingredient: "PIZZA THON" uses 200g of "Mozzarella". */
export function setRecipeIngredient(
  db: Database.Database,
  itemName: string,
  materialName: string,
  quantityPerUnit: number,
  unit: string = 'g',
): RecipeIngredient | null {
  ensureRawMaterialSchema(db);

  const mat = getRawMaterial(db, materialName);
  if (!mat) return null;

  const id = randomUUID();
  db.prepare(
    `
    INSERT INTO recipe_ingredients (id, item_name, material_id, quantity_per_unit, unit)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(item_name, material_id) DO UPDATE SET
      quantity_per_unit = excluded.quantity_per_unit,
      unit = excluded.unit
  `,
  ).run(id, itemName.toUpperCase(), mat.id, quantityPerUnit, unit);

  return db
    .prepare(
      `
    SELECT * FROM recipe_ingredients WHERE item_name = ? AND material_id = ?
  `,
    )
    .get(itemName.toUpperCase(), mat.id) as RecipeIngredient;
}

/** Get the full recipe (technical sheet) for a menu item. */
export function getRecipe(
  db: Database.Database,
  itemName: string,
): Array<{
  material_name: string;
  material_id: string;
  quantity_per_unit: number;
  unit: string;
  cost_per_unit: number;
}> {
  ensureRawMaterialSchema(db);

  return db
    .prepare(
      `
    SELECT r.material_id, m.name AS material_name, r.quantity_per_unit, r.unit, m.cost_per_unit
    FROM recipe_ingredients r
    JOIN raw_materials m ON m.id = r.material_id
    WHERE UPPER(r.item_name) = UPPER(?)
    ORDER BY m.name
  `,
    )
    .all(itemName) as Array<{
    material_name: string;
    material_id: string;
    quantity_per_unit: number;
    unit: string;
    cost_per_unit: number;
  }>;
}

/** List all recipes with their ingredients. */
export function listRecipes(
  db: Database.Database,
): Record<
  string,
  Array<{ material_name: string; quantity_per_unit: number; unit: string; cost_per_unit: number }>
> {
  ensureRawMaterialSchema(db);

  const rows = db
    .prepare(
      `
    SELECT r.item_name, m.name AS material_name, r.quantity_per_unit, r.unit, m.cost_per_unit
    FROM recipe_ingredients r
    JOIN raw_materials m ON m.id = r.material_id
    ORDER BY r.item_name, m.name
  `,
    )
    .all() as Array<{
    item_name: string;
    material_name: string;
    quantity_per_unit: number;
    unit: string;
    cost_per_unit: number;
  }>;

  const recipes: Record<
    string,
    Array<{ material_name: string; quantity_per_unit: number; unit: string; cost_per_unit: number }>
  > = {};
  for (const row of rows) {
    if (!recipes[row.item_name]) recipes[row.item_name] = [];
    recipes[row.item_name]!.push({
      material_name: row.material_name,
      quantity_per_unit: row.quantity_per_unit,
      unit: row.unit,
      cost_per_unit: row.cost_per_unit,
    });
  }
  return recipes;
}

/** Remove a recipe ingredient. */
export function removeRecipeIngredient(
  db: Database.Database,
  itemName: string,
  materialName: string,
): boolean {
  ensureRawMaterialSchema(db);
  const mat = getRawMaterial(db, materialName);
  if (!mat) return false;
  const result = db
    .prepare('DELETE FROM recipe_ingredients WHERE UPPER(item_name) = UPPER(?) AND material_id = ?')
    .run(itemName, mat.id);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Consumption — auto-deduct from stock based on daily sales + recipes
// ---------------------------------------------------------------------------

/**
 * Deduct raw materials from stock based on daily_sales for a given date.
 * Uses recipe_ingredients to calculate how much of each material was consumed.
 *
 * Call this AFTER importing daily sales via processDailyXLS().
 */
export function deductConsumption(db: Database.Database, date: string): ConsumptionResult {
  ensureRawMaterialSchema(db);

  const warnings: string[] = [];
  const deductionMap = new Map<
    string,
    {
      material_name: string;
      material_id: string;
      total_consumed: number;
      unit: string;
      items: Array<{ item_name: string; qty_sold: number; per_unit: number; consumed: number }>;
    }
  >();

  // Check if daily_sales table exists
  const tableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='daily_sales'`)
    .get();
  if (!tableExists) {
    return { date, deductions: [], warnings: ['daily_sales table does not exist'] };
  }

  // Check if already deducted for this date
  const alreadyDone = db
    .prepare('SELECT COUNT(*) as cnt FROM consumption_log WHERE date = ?')
    .get(date) as { cnt: number };
  if (alreadyDone.cnt > 0) {
    return {
      date,
      deductions: [],
      warnings: [`Consumption already deducted for ${date} (${alreadyDone.cnt} entries)`],
    };
  }

  // Get all sales for the date
  const sales = db
    .prepare(
      `
    SELECT item_name, quantity FROM daily_sales WHERE date = ? AND quantity > 0
  `,
    )
    .all(date) as Array<{ item_name: string; quantity: number }>;

  if (sales.length === 0) {
    return { date, deductions: [], warnings: [`No sales found for ${date}`] };
  }

  // For each sold item, look up its recipe and calculate consumption
  for (const sale of sales) {
    const recipe = db
      .prepare(
        `
      SELECT r.material_id, m.name AS material_name, r.quantity_per_unit, r.unit
      FROM recipe_ingredients r
      JOIN raw_materials m ON m.id = r.material_id
      WHERE UPPER(r.item_name) = UPPER(?)
    `,
      )
      .all(sale.item_name) as Array<{
      material_id: string;
      material_name: string;
      quantity_per_unit: number;
      unit: string;
    }>;

    if (recipe.length === 0) {
      warnings.push(`No recipe for "${sale.item_name}" — cannot deduct materials`);
      continue;
    }

    for (const ingredient of recipe) {
      const consumed = sale.quantity * ingredient.quantity_per_unit;

      if (!deductionMap.has(ingredient.material_id)) {
        deductionMap.set(ingredient.material_id, {
          material_name: ingredient.material_name,
          material_id: ingredient.material_id,
          total_consumed: 0,
          unit: ingredient.unit,
          items: [],
        });
      }

      const entry = deductionMap.get(ingredient.material_id)!;
      entry.total_consumed += consumed;
      entry.items.push({
        item_name: sale.item_name,
        qty_sold: sale.quantity,
        per_unit: ingredient.quantity_per_unit,
        consumed,
      });
    }
  }

  // Apply deductions in a transaction
  const deductions = Array.from(deductionMap.values());

  const applyDeductions = db.transaction(() => {
    for (const d of deductions) {
      // Convert to material's unit (recipe is in g/ml, stock might be in kg/L)
      const mat = db
        .prepare('SELECT * FROM raw_materials WHERE id = ?')
        .get(d.material_id) as RawMaterial;
      let stockDeduction = d.total_consumed;

      // Auto-convert g→kg or ml→L if units differ
      if (d.unit === 'g' && mat.unit === 'kg') {
        stockDeduction = d.total_consumed / 1000;
      } else if (d.unit === 'ml' && mat.unit === 'L') {
        stockDeduction = d.total_consumed / 1000;
      }

      stockDeduction = Math.round(stockDeduction * 1000) / 1000;

      // Deduct from stock
      db.prepare(
        `
        UPDATE raw_materials SET current_stock = MAX(0, current_stock - ?), updated_at = ? WHERE id = ?
      `,
      ).run(stockDeduction, new Date().toISOString(), d.material_id);

      // Log each consumption entry
      for (const item of d.items) {
        db.prepare(
          `
          INSERT INTO consumption_log (id, date, material_id, item_name, quantity_sold, material_used, unit)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          randomUUID(),
          date,
          d.material_id,
          item.item_name,
          item.qty_sold,
          item.consumed,
          d.unit,
        );
      }

      // Check if stock is below minimum
      const updated = db
        .prepare('SELECT current_stock, min_stock FROM raw_materials WHERE id = ?')
        .get(d.material_id) as { current_stock: number; min_stock: number };
      if (updated.current_stock < updated.min_stock) {
        warnings.push(
          `⚠ LOW STOCK: ${mat.name} — ${updated.current_stock} ${mat.unit} remaining (minimum: ${updated.min_stock} ${mat.unit})`,
        );
      }
    }
  });

  applyDeductions();

  return { date, deductions, warnings };
}

// ---------------------------------------------------------------------------
// Stock Queries
// ---------------------------------------------------------------------------

/** Get low-stock alerts (materials below min_stock). */
export function getLowStockAlerts(db: Database.Database): StockAlert[] {
  ensureRawMaterialSchema(db);

  return db
    .prepare(
      `
    SELECT name AS material_name, current_stock, min_stock, unit,
           ROUND(min_stock - current_stock, 3) AS deficit
    FROM raw_materials
    WHERE current_stock < min_stock
    ORDER BY (min_stock - current_stock) DESC
  `,
    )
    .all() as StockAlert[];
}

/** Get total stock valuation (current_stock × cost_per_unit for all materials). */
export function getStockValuation(db: Database.Database): {
  materials: Array<{
    name: string;
    current_stock: number;
    unit: string;
    cost_per_unit: number;
    value: number;
  }>;
  total_value: number;
} {
  ensureRawMaterialSchema(db);

  const materials = db
    .prepare(
      `
    SELECT name, current_stock, unit, cost_per_unit,
           ROUND(current_stock * cost_per_unit, 2) AS value
    FROM raw_materials
    ORDER BY value DESC
  `,
    )
    .all() as Array<{
    name: string;
    current_stock: number;
    unit: string;
    cost_per_unit: number;
    value: number;
  }>;

  const total_value = materials.reduce((sum, m) => sum + m.value, 0);
  return { materials, total_value: Math.round(total_value * 100) / 100 };
}

/** Get consumption history for a date range. */
export function getConsumptionHistory(
  db: Database.Database,
  from: string,
  to: string,
): Array<{ date: string; material_name: string; total_used: number; unit: string }> {
  ensureRawMaterialSchema(db);

  return db
    .prepare(
      `
    SELECT c.date, m.name AS material_name, SUM(c.material_used) AS total_used, c.unit
    FROM consumption_log c
    JOIN raw_materials m ON m.id = c.material_id
    WHERE c.date BETWEEN ? AND ?
    GROUP BY c.date, c.material_id
    ORDER BY c.date DESC, m.name
  `,
    )
    .all(from, to) as Array<{
    date: string;
    material_name: string;
    total_used: number;
    unit: string;
  }>;
}

/** Calculate the raw material cost of a menu item based on its recipe. */
export function getItemCost(
  db: Database.Database,
  itemName: string,
): {
  item_name: string;
  ingredients: Array<{ material_name: string; quantity: number; unit: string; cost: number }>;
  total_cost: number;
} | null {
  const recipe = getRecipe(db, itemName);
  if (recipe.length === 0) return null;

  const ingredients = recipe.map((r) => {
    let costMultiplier = 1;
    // Convert g→kg or ml→L for cost calculation
    if (r.unit === 'g') costMultiplier = 1 / 1000;
    else if (r.unit === 'ml') costMultiplier = 1 / 1000;

    const cost = Math.round(r.quantity_per_unit * costMultiplier * r.cost_per_unit * 100) / 100;
    return {
      material_name: r.material_name,
      quantity: r.quantity_per_unit,
      unit: r.unit,
      cost,
    };
  });

  const total_cost = Math.round(ingredients.reduce((s, i) => s + i.cost, 0) * 100) / 100;

  return { item_name: itemName.toUpperCase(), ingredients, total_cost };
}
