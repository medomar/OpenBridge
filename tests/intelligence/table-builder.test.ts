import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildCreateTableDDL,
  buildChildTableDDL,
  buildRecomputeTriggers,
  buildFTS5DDL,
} from '../../src/intelligence/table-builder.js';
import type { DocType, DocTypeField } from '../../src/types/doctype.js';

function makeDocType(overrides: Partial<DocType> = {}): DocType {
  return {
    id: 'dt-001',
    name: 'Invoice',
    label_singular: 'Invoice',
    label_plural: 'Invoices',
    table_name: 'dt_invoice',
    source: 'ai-created' as const,
    ...overrides,
  };
}

function makeField(
  overrides: Partial<DocTypeField> & { name: string; field_type: DocTypeField['field_type'] },
): DocTypeField {
  return {
    id: `f-${overrides.name}`,
    doctype_id: 'dt-001',
    label: overrides.name,
    required: false,
    searchable: false,
    sort_order: 0,
    ...overrides,
  };
}

describe('table-builder DDL generation', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    db.close();
  });

  it('creates a basic table with text/number/date fields', () => {
    const doctype = makeDocType();
    const fields: DocTypeField[] = [
      makeField({ name: 'customer_name', field_type: 'text', required: true }),
      makeField({ name: 'total', field_type: 'number' }),
      makeField({ name: 'due_date', field_type: 'date' }),
    ];

    const ddl = buildCreateTableDDL(doctype, fields);

    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS');
    expect(ddl).toContain('"dt_invoice"');
    expect(ddl).toContain('"customer_name" TEXT NOT NULL');
    expect(ddl).toContain('"total" REAL');
    expect(ddl).toContain('"due_date" TEXT');

    // Execute against in-memory SQLite — must not throw
    db.exec(ddl);

    // Verify table exists and has expected columns
    const cols = db.pragma(`table_info("dt_invoice")`) as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('customer_name');
    expect(colNames).toContain('total');
    expect(colNames).toContain('due_date');

    const customerCol = cols.find((c) => c.name === 'customer_name')!;
    expect(customerCol.notnull).toBe(1);

    const totalCol = cols.find((c) => c.name === 'total')!;
    expect(totalCol.type).toBe('REAL');
    expect(totalCol.notnull).toBe(0);
  });

  it('creates a child table with parent reference and FK constraint', () => {
    // First create parent table
    const parentDoctype = makeDocType();
    const parentFields: DocTypeField[] = [makeField({ name: 'subtotal', field_type: 'number' })];
    db.exec(buildCreateTableDDL(parentDoctype, parentFields));

    // Create child table
    const childFields: DocTypeField[] = [
      makeField({ name: 'description', field_type: 'text', required: true }),
      makeField({ name: 'amount', field_type: 'currency' }),
      makeField({ name: 'qty', field_type: 'number' }),
    ];

    const ddl = buildChildTableDDL('invoice', 'items', childFields);

    expect(ddl).toContain('"dt_invoice__items"');
    expect(ddl).toContain('parent_id TEXT NOT NULL REFERENCES "dt_invoice"(id) ON DELETE CASCADE');
    expect(ddl).toContain('UNIQUE(parent_id, idx)');

    // Execute — must not throw
    db.exec(ddl);

    // Verify child table structure
    const cols = db.pragma(`table_info("dt_invoice__items")`) as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('parent_id');
    expect(colNames).toContain('idx');
    expect(colNames).toContain('description');
    expect(colNames).toContain('amount');
    expect(colNames).toContain('qty');
  });

  it('creates a GENERATED column with a formula', () => {
    const doctype = makeDocType();
    const fields: DocTypeField[] = [
      makeField({ name: 'qty', field_type: 'number' }),
      makeField({ name: 'unit_price', field_type: 'currency' }),
      makeField({
        name: 'line_total',
        field_type: 'currency',
        formula: 'qty * unit_price',
      }),
    ];

    const ddl = buildCreateTableDDL(doctype, fields);

    expect(ddl).toContain('GENERATED ALWAYS AS (qty * unit_price) STORED');

    // Execute and verify the generated column works
    db.exec(ddl);

    db.prepare(
      `INSERT INTO "dt_invoice" (id, created_at, updated_at, created_by, qty, unit_price)
       VALUES ('r1', '2025-01-01', '2025-01-01', 'test', 5, 20.0)`,
    ).run();

    const row = db.prepare(`SELECT line_total FROM "dt_invoice" WHERE id = 'r1'`).get() as {
      line_total: number;
    };
    expect(row.line_total).toBe(100);
  });

  it('creates an FTS5 virtual table and sync triggers', () => {
    // Create the content table first
    const doctype = makeDocType();
    const fields: DocTypeField[] = [
      makeField({ name: 'customer_name', field_type: 'text', searchable: true }),
      makeField({ name: 'notes', field_type: 'longtext', searchable: true }),
      makeField({ name: 'total', field_type: 'number' }),
    ];
    db.exec(buildCreateTableDDL(doctype, fields));

    const searchableFields = fields.filter((f) => f.searchable).map((f) => f.name);
    const ddlStatements = buildFTS5DDL('dt_invoice', searchableFields);

    expect(ddlStatements).toHaveLength(4);
    expect(ddlStatements[0]).toContain('CREATE VIRTUAL TABLE');
    expect(ddlStatements[0]).toContain('fts5');
    expect(ddlStatements[0]).toContain('"customer_name"');
    expect(ddlStatements[0]).toContain('"notes"');

    // Execute all FTS5 DDL statements
    for (const stmt of ddlStatements) {
      db.exec(stmt);
    }

    // Insert a row into the content table — trigger should sync to FTS5
    db.prepare(
      `INSERT INTO "dt_invoice" (id, created_at, updated_at, created_by, customer_name, notes, total)
       VALUES ('r1', '2025-01-01', '2025-01-01', 'test', 'Acme Corp', 'Urgent delivery', 500)`,
    ).run();

    // Search FTS5 index
    const results = db
      .prepare(`SELECT * FROM "dt_invoice_fts" WHERE "dt_invoice_fts" MATCH 'Acme'`)
      .all() as Array<{ customer_name: string }>;
    expect(results).toHaveLength(1);
    expect(results[0].customer_name).toBe('Acme Corp');
  });

  it('generates recomputation triggers that keep parent aggregate in sync', () => {
    // Set up parent and child tables
    const parentDoctype = makeDocType();
    const parentFields: DocTypeField[] = [makeField({ name: 'subtotal', field_type: 'number' })];
    db.exec(buildCreateTableDDL(parentDoctype, parentFields));

    const childFields: DocTypeField[] = [makeField({ name: 'amount', field_type: 'currency' })];
    db.exec(buildChildTableDDL('invoice', 'items', childFields));

    // Create triggers
    const triggers = buildRecomputeTriggers(
      'dt_invoice',
      'dt_invoice__items',
      'subtotal',
      'amount',
    );
    expect(triggers).toHaveLength(3);

    for (const trigger of triggers) {
      expect(trigger).toContain('CREATE TRIGGER IF NOT EXISTS');
      db.exec(trigger);
    }

    // Insert parent row
    db.prepare(
      `INSERT INTO "dt_invoice" (id, created_at, updated_at, created_by, subtotal)
       VALUES ('inv1', '2025-01-01', '2025-01-01', 'test', 0)`,
    ).run();

    // INSERT trigger: add child rows
    db.prepare(
      `INSERT INTO "dt_invoice__items" (id, parent_id, idx, amount) VALUES ('i1', 'inv1', 1, 100)`,
    ).run();
    db.prepare(
      `INSERT INTO "dt_invoice__items" (id, parent_id, idx, amount) VALUES ('i2', 'inv1', 2, 250)`,
    ).run();

    let parent = db.prepare(`SELECT subtotal FROM "dt_invoice" WHERE id = 'inv1'`).get() as {
      subtotal: number;
    };
    expect(parent.subtotal).toBe(350);

    // UPDATE trigger: change a child amount
    db.prepare(`UPDATE "dt_invoice__items" SET amount = 200 WHERE id = 'i1'`).run();
    parent = db.prepare(`SELECT subtotal FROM "dt_invoice" WHERE id = 'inv1'`).get() as {
      subtotal: number;
    };
    expect(parent.subtotal).toBe(450);

    // DELETE trigger: remove a child row
    db.prepare(`DELETE FROM "dt_invoice__items" WHERE id = 'i2'`).run();
    parent = db.prepare(`SELECT subtotal FROM "dt_invoice" WHERE id = 'inv1'`).get() as {
      subtotal: number;
    };
    expect(parent.subtotal).toBe(200);
  });
});
