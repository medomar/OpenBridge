import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createDocType,
  getDocType,
  getDocTypeByName,
} from '../../src/intelligence/doctype-store.js';
import { buildCreateTableDDL, buildFTS5DDL } from '../../src/intelligence/table-builder.js';
import { generateNextNumber } from '../../src/intelligence/naming-series.js';
import type { DocType, DocTypeField, DocTypeState } from '../../src/types/doctype.js';
import { ensureDocTypeStoreSchema } from '../../src/intelligence/doctype-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInvoiceDocType(): DocType {
  return {
    id: 'dt-invoice',
    name: 'invoice',
    label_singular: 'Invoice',
    label_plural: 'Invoices',
    table_name: 'dt_invoice',
    source: 'ai-created' as const,
  };
}

function makeInvoiceFields(): DocTypeField[] {
  return [
    {
      id: 'f-invoice-number',
      doctype_id: 'dt-invoice',
      name: 'invoice_number',
      label: 'Invoice Number',
      field_type: 'text',
      required: true,
      searchable: true,
      sort_order: 1,
    },
    {
      id: 'f-customer-name',
      doctype_id: 'dt-invoice',
      name: 'customer_name',
      label: 'Customer Name',
      field_type: 'text',
      required: true,
      searchable: true,
      sort_order: 2,
    },
    {
      id: 'f-qty',
      doctype_id: 'dt-invoice',
      name: 'qty',
      label: 'Quantity',
      field_type: 'number',
      sort_order: 3,
    },
    {
      id: 'f-unit-price',
      doctype_id: 'dt-invoice',
      name: 'unit_price',
      label: 'Unit Price',
      field_type: 'currency',
      sort_order: 4,
    },
    {
      id: 'f-total',
      doctype_id: 'dt-invoice',
      name: 'total',
      label: 'Total',
      field_type: 'currency',
      formula: 'qty * unit_price',
      depends_on: 'qty',
      sort_order: 5,
    },
    {
      id: 'f-status',
      doctype_id: 'dt-invoice',
      name: 'status',
      label: 'Status',
      field_type: 'select',
      options: ['Draft', 'Sent', 'Paid'],
      default_value: 'Draft',
      searchable: true,
      sort_order: 6,
    },
    {
      id: 'f-notes',
      doctype_id: 'dt-invoice',
      name: 'notes',
      label: 'Notes',
      field_type: 'longtext',
      searchable: true,
      sort_order: 7,
    },
  ];
}

function makeInvoiceStates(): DocTypeState[] {
  return [
    {
      id: 's-draft',
      doctype_id: 'dt-invoice',
      name: 'draft',
      label: 'Draft',
      color: 'gray',
      is_initial: true,
      sort_order: 1,
    },
    {
      id: 's-sent',
      doctype_id: 'dt-invoice',
      name: 'sent',
      label: 'Sent',
      color: 'blue',
      sort_order: 2,
    },
    {
      id: 's-paid',
      doctype_id: 'dt-invoice',
      name: 'paid',
      label: 'Paid',
      color: 'green',
      is_terminal: true,
      sort_order: 3,
    },
  ];
}

// ---------------------------------------------------------------------------
// Integration test suite
// ---------------------------------------------------------------------------

describe('DocType E2E: create Invoice → CRUD', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureDocTypeStoreSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates an Invoice DocType and verifies the dynamic table exists', () => {
    const doctype = makeInvoiceDocType();
    const fields = makeInvoiceFields();
    const states = makeInvoiceStates();

    // Step 1: Create DocType metadata
    const id = createDocType(db, { doctype, fields, states });
    expect(id).toBe('dt-invoice');

    // Step 2: Build and execute DDL for the dynamic table
    const ddl = buildCreateTableDDL(doctype, fields);
    db.exec(ddl);

    // Verify the table was created with expected columns
    // Use table_xinfo to include GENERATED columns (table_info omits them)
    const cols = db.pragma(`table_xinfo("dt_invoice")`) as Array<{
      name: string;
      type: string;
      notnull: number;
    }>;
    const colNames = cols.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
    expect(colNames).toContain('created_by');
    expect(colNames).toContain('invoice_number');
    expect(colNames).toContain('customer_name');
    expect(colNames).toContain('qty');
    expect(colNames).toContain('unit_price');
    expect(colNames).toContain('total');
    expect(colNames).toContain('status');
    expect(colNames).toContain('notes');

    // Verify required fields are NOT NULL
    const customerCol = cols.find((c) => c.name === 'customer_name')!;
    expect(customerCol.notnull).toBe(1);
  });

  it('inserts a record and reads it back', () => {
    const doctype = makeInvoiceDocType();
    const fields = makeInvoiceFields();

    createDocType(db, { doctype, fields });
    db.exec(buildCreateTableDDL(doctype, fields));

    // Insert a record
    db.prepare(
      `INSERT INTO "dt_invoice"
        (id, created_at, updated_at, created_by, invoice_number, customer_name, qty, unit_price, status, notes)
       VALUES
        ('inv-001', '2026-03-12', '2026-03-12', 'test-user', 'INV-2026-00001', 'Acme Corp', 10, 25.50, 'Draft', 'Urgent delivery needed')`,
    ).run();

    // Read it back
    const row = db.prepare(`SELECT * FROM "dt_invoice" WHERE id = 'inv-001'`).get() as Record<
      string,
      unknown
    >;

    expect(row).toBeDefined();
    expect(row.id).toBe('inv-001');
    expect(row.invoice_number).toBe('INV-2026-00001');
    expect(row.customer_name).toBe('Acme Corp');
    expect(row.qty).toBe(10);
    expect(row.unit_price).toBe(25.5);
    expect(row.status).toBe('Draft');
    expect(row.notes).toBe('Urgent delivery needed');
  });

  it('verifies auto-numbering works via naming-series', () => {
    const doctype = makeInvoiceDocType();
    const fields = makeInvoiceFields();

    createDocType(db, { doctype, fields });
    db.exec(buildCreateTableDDL(doctype, fields));

    const now = new Date('2026-03-12');

    // Generate sequential invoice numbers
    const num1 = generateNextNumber(db, 'INV-{YYYY}-{#####}', now);
    const num2 = generateNextNumber(db, 'INV-{YYYY}-{#####}', now);
    const num3 = generateNextNumber(db, 'INV-{YYYY}-{#####}', now);

    expect(num1).toBe('INV-2026-00001');
    expect(num2).toBe('INV-2026-00002');
    expect(num3).toBe('INV-2026-00003');

    // Insert records with auto-generated numbers
    const insert = db.prepare(
      `INSERT INTO "dt_invoice"
        (id, created_at, updated_at, created_by, invoice_number, customer_name, qty, unit_price, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insert.run('inv-001', '2026-03-12', '2026-03-12', 'test', num1, 'Alice', 2, 100, 'Draft');
    insert.run('inv-002', '2026-03-12', '2026-03-12', 'test', num2, 'Bob', 5, 50, 'Draft');
    insert.run('inv-003', '2026-03-12', '2026-03-12', 'test', num3, 'Charlie', 1, 200, 'Draft');

    // Verify all three records have unique invoice numbers
    const rows = db
      .prepare(`SELECT invoice_number FROM "dt_invoice" ORDER BY invoice_number`)
      .all() as Array<{ invoice_number: string }>;

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.invoice_number)).toEqual([
      'INV-2026-00001',
      'INV-2026-00002',
      'INV-2026-00003',
    ]);
  });

  it('verifies GENERATED fields compute correctly', () => {
    const doctype = makeInvoiceDocType();
    const fields = makeInvoiceFields();

    createDocType(db, { doctype, fields });
    db.exec(buildCreateTableDDL(doctype, fields));

    // Insert records with different qty and unit_price
    const insert = db.prepare(
      `INSERT INTO "dt_invoice"
        (id, created_at, updated_at, created_by, invoice_number, customer_name, qty, unit_price, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insert.run(
      'inv-001',
      '2026-03-12',
      '2026-03-12',
      'test',
      'INV-001',
      'Alice',
      10,
      25.0,
      'Draft',
    );
    insert.run('inv-002', '2026-03-12', '2026-03-12', 'test', 'INV-002', 'Bob', 3, 99.99, 'Draft');
    insert.run(
      'inv-003',
      '2026-03-12',
      '2026-03-12',
      'test',
      'INV-003',
      'Charlie',
      0,
      50.0,
      'Draft',
    );

    // Verify GENERATED total = qty * unit_price
    const rows = db
      .prepare(`SELECT id, qty, unit_price, total FROM "dt_invoice" ORDER BY id`)
      .all() as Array<{ id: string; qty: number; unit_price: number; total: number }>;

    expect(rows[0].total).toBe(250.0); // 10 * 25
    expect(rows[1].total).toBeCloseTo(299.97); // 3 * 99.99
    expect(rows[2].total).toBe(0); // 0 * 50

    // Update qty and verify total recomputes
    db.prepare(`UPDATE "dt_invoice" SET qty = 20 WHERE id = 'inv-001'`).run();
    const updated = db.prepare(`SELECT total FROM "dt_invoice" WHERE id = 'inv-001'`).get() as {
      total: number;
    };
    expect(updated.total).toBe(500.0); // 20 * 25
  });

  it('verifies FTS5 search finds the record', () => {
    const doctype = makeInvoiceDocType();
    const fields = makeInvoiceFields();

    createDocType(db, { doctype, fields });
    db.exec(buildCreateTableDDL(doctype, fields));

    // Create FTS5 index on searchable fields
    const searchableFields = fields.filter((f) => f.searchable).map((f) => f.name);
    const ftsStatements = buildFTS5DDL('dt_invoice', searchableFields);
    for (const stmt of ftsStatements) {
      db.exec(stmt);
    }

    // Insert records
    const insert = db.prepare(
      `INSERT INTO "dt_invoice"
        (id, created_at, updated_at, created_by, invoice_number, customer_name, qty, unit_price, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    insert.run(
      'inv-001',
      '2026-03-12',
      '2026-03-12',
      'test',
      'INV-2026-00001',
      'Acme Corp',
      10,
      25.0,
      'Draft',
      'Urgent delivery needed',
    );
    insert.run(
      'inv-002',
      '2026-03-12',
      '2026-03-12',
      'test',
      'INV-2026-00002',
      'Globex Industries',
      5,
      50.0,
      'Sent',
      'Standard shipping',
    );
    insert.run(
      'inv-003',
      '2026-03-12',
      '2026-03-12',
      'test',
      'INV-2026-00003',
      'Acme Corp',
      2,
      100.0,
      'Paid',
      'Priority handling',
    );

    // Search by customer name
    const acmeResults = db
      .prepare(`SELECT rowid FROM "dt_invoice_fts" WHERE "dt_invoice_fts" MATCH 'Acme'`)
      .all();
    expect(acmeResults).toHaveLength(2);

    // Search by notes content
    const urgentResults = db
      .prepare(`SELECT rowid FROM "dt_invoice_fts" WHERE "dt_invoice_fts" MATCH 'Urgent'`)
      .all();
    expect(urgentResults).toHaveLength(1);

    // Search by status
    const draftResults = db
      .prepare(`SELECT rowid FROM "dt_invoice_fts" WHERE "dt_invoice_fts" MATCH 'Draft'`)
      .all();
    expect(draftResults).toHaveLength(1);

    // Search that returns no results
    const noResults = db
      .prepare(`SELECT rowid FROM "dt_invoice_fts" WHERE "dt_invoice_fts" MATCH 'Nonexistent'`)
      .all();
    expect(noResults).toHaveLength(0);
  });

  it('reads DocType metadata back via getDocType and getDocTypeByName', () => {
    const doctype = makeInvoiceDocType();
    const fields = makeInvoiceFields();
    const states = makeInvoiceStates();

    createDocType(db, { doctype, fields, states });

    // Retrieve by ID
    const byId = getDocType(db, 'dt-invoice');
    expect(byId).not.toBeNull();
    expect(byId!.doctype.name).toBe('invoice');
    expect(byId!.doctype.label_singular).toBe('Invoice');
    expect(byId!.fields).toHaveLength(7);
    expect(byId!.states).toHaveLength(3);

    // Retrieve by name
    const byName = getDocTypeByName(db, 'invoice');
    expect(byName).not.toBeNull();
    expect(byName!.doctype.id).toBe('dt-invoice');
    expect(byName!.fields.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'invoice_number',
        'customer_name',
        'qty',
        'unit_price',
        'total',
        'status',
        'notes',
      ]),
    );

    // Verify field properties round-trip correctly
    const totalField = byName!.fields.find((f) => f.name === 'total')!;
    expect(totalField.formula).toBe('qty * unit_price');
    expect(totalField.field_type).toBe('currency');

    const statusField = byName!.fields.find((f) => f.name === 'status')!;
    expect(statusField.options).toEqual(['Draft', 'Sent', 'Paid']);
    expect(statusField.default_value).toBe('Draft');

    // Verify states round-trip
    const draftState = byName!.states.find((s) => s.name === 'draft')!;
    expect(draftState.is_initial).toBe(true);
    const paidState = byName!.states.find((s) => s.name === 'paid')!;
    expect(paidState.is_terminal).toBe(true);
  });

  it('full end-to-end: create DocType → build table → auto-number → insert → compute → search', () => {
    const doctype = makeInvoiceDocType();
    const fields = makeInvoiceFields();
    const states = makeInvoiceStates();

    // 1. Create DocType metadata
    createDocType(db, { doctype, fields, states });

    // 2. Build dynamic table + FTS5
    db.exec(buildCreateTableDDL(doctype, fields));
    const searchableFields = fields.filter((f) => f.searchable).map((f) => f.name);
    for (const stmt of buildFTS5DDL('dt_invoice', searchableFields)) {
      db.exec(stmt);
    }

    // 3. Generate auto-numbers
    const now = new Date('2026-03-12');
    const invNum = generateNextNumber(db, 'INV-{YYYY}-{#####}', now);
    expect(invNum).toBe('INV-2026-00001');

    // 4. Insert record with auto-number
    db.prepare(
      `INSERT INTO "dt_invoice"
        (id, created_at, updated_at, created_by, invoice_number, customer_name, qty, unit_price, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'inv-e2e',
      '2026-03-12',
      '2026-03-12',
      'e2e-test',
      invNum,
      'Zenith Global Corp',
      7,
      42.0,
      'Draft',
      'Integration test record',
    );

    // 5. Verify GENERATED total computed
    const record = db.prepare(`SELECT * FROM "dt_invoice" WHERE id = 'inv-e2e'`).get() as Record<
      string,
      unknown
    >;
    expect(record.invoice_number).toBe('INV-2026-00001');
    expect(record.total).toBe(294.0); // 7 * 42

    // 6. Verify FTS5 finds it
    const ftsResults = db
      .prepare(`SELECT rowid FROM "dt_invoice_fts" WHERE "dt_invoice_fts" MATCH 'Zenith'`)
      .all();
    expect(ftsResults).toHaveLength(1);

    // 7. Verify DocType metadata still readable
    const full = getDocType(db, 'dt-invoice');
    expect(full).not.toBeNull();
    expect(full!.fields).toHaveLength(7);
    expect(full!.states).toHaveLength(3);
  });
});
