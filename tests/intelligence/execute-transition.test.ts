import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ensureDocTypeStoreSchema, createDocType } from '../../src/intelligence/doctype-store.js';
import {
  executeTransition,
  resetAuditTableFlag,
  type HookExecutor,
  type WorkflowTrigger,
} from '../../src/intelligence/state-machine.js';
import type { DocType, DocTypeTransition, DocTypeHook } from '../../src/types/doctype.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const INVOICE_DOCTYPE: DocType = {
  id: 'dt-invoice',
  name: 'invoice',
  label_singular: 'Invoice',
  label_plural: 'Invoices',
  table_name: 'dt_invoice',
  source: 'ai-created',
};

const TRANSITIONS: DocTypeTransition[] = [
  {
    id: 'tr-1',
    doctype_id: 'dt-invoice',
    from_state: 'draft',
    to_state: 'submitted',
    action_name: 'submit',
    action_label: 'Submit',
    allowed_roles: ['editor', 'admin'],
  },
  {
    id: 'tr-2',
    doctype_id: 'dt-invoice',
    from_state: 'submitted',
    to_state: 'paid',
    action_name: 'pay',
    action_label: 'Mark Paid',
    condition: 'total > 0',
  },
  {
    id: 'tr-3',
    doctype_id: 'dt-invoice',
    from_state: 'draft',
    to_state: 'cancelled',
    action_name: 'cancel',
    action_label: 'Cancel',
  },
];

const HOOKS: DocTypeHook[] = [
  {
    id: 'hook-before-1',
    doctype_id: 'dt-invoice',
    event: 'before_transition',
    action_type: 'update_field',
    action_config: { field: 'updated_by', value: 'system' },
    sort_order: 0,
    enabled: true,
  },
  {
    id: 'hook-after-1',
    doctype_id: 'dt-invoice',
    event: 'after_transition',
    action_type: 'send_notification',
    action_config: { channel: 'email' },
    sort_order: 0,
    enabled: true,
  },
  {
    id: 'hook-disabled',
    doctype_id: 'dt-invoice',
    event: 'before_transition',
    action_type: 'update_field',
    action_config: {},
    sort_order: 1,
    enabled: false,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  ensureDocTypeStoreSchema(db);

  // Create the DocType metadata
  createDocType(db, {
    doctype: INVOICE_DOCTYPE,
    transitions: TRANSITIONS,
    hooks: HOOKS,
  });

  // Create the data table
  db.exec(`
    CREATE TABLE IF NOT EXISTS "dt_invoice" (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'draft',
      total REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    )
  `);

  return db;
}

function insertRecord(db: Database.Database, id: string, status: string, total: number): void {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO dt_invoice (id, status, total, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, status, total, now, now, 'test');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeTransition', () => {
  let db: Database.Database;

  beforeEach(() => {
    resetAuditTableFlag();
    db = setupDb();
  });

  it('successfully transitions a record from draft to submitted', async () => {
    insertRecord(db, 'inv-001', 'draft', 100);

    const result = await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'inv-001',
      action: 'submit',
      userRole: 'editor',
    });

    expect(result.success).toBe(true);
    expect(result.fromState).toBe('draft');
    expect(result.toState).toBe('submitted');
    expect(result.record).toBeDefined();
    expect(result.record!['status']).toBe('submitted');
  });

  it('writes audit log entry on successful transition', async () => {
    insertRecord(db, 'inv-002', 'draft', 50);

    await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'inv-002',
      action: 'submit',
      userRole: 'admin',
    });

    const audit = db
      .prepare('SELECT * FROM doctype_transition_audit WHERE record_id = ?')
      .get('inv-002') as Record<string, unknown>;

    expect(audit).toBeDefined();
    expect(audit['from_state']).toBe('draft');
    expect(audit['to_state']).toBe('submitted');
    expect(audit['action']).toBe('submit');
    expect(audit['user_role']).toBe('admin');
  });

  it('fails when record does not exist', async () => {
    const result = await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'nonexistent',
      action: 'submit',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('fails when transition is invalid (wrong role)', async () => {
    insertRecord(db, 'inv-003', 'draft', 100);

    const result = await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'inv-003',
      action: 'submit',
      userRole: 'viewer',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not allowed');
  });

  it('fails when transition condition is not met', async () => {
    insertRecord(db, 'inv-004', 'submitted', 0);

    const result = await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'inv-004',
      action: 'pay',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('condition not met');
  });

  it('succeeds when condition is met', async () => {
    insertRecord(db, 'inv-005', 'submitted', 250);

    const result = await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'inv-005',
      action: 'pay',
    });

    expect(result.success).toBe(true);
    expect(result.toState).toBe('paid');
  });

  it('calls hookExecutor with before and after hooks', async () => {
    insertRecord(db, 'inv-006', 'draft', 100);

    const hookCalls: Array<{ event: string; hookCount: number }> = [];
    const hookExecutor: HookExecutor = (hooks, _record) => {
      hookCalls.push({
        event: hooks[0]?.event ?? 'unknown',
        hookCount: hooks.length,
      });
    };

    await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'inv-006',
      action: 'submit',
      userRole: 'editor',
      hookExecutor,
    });

    // Should have been called twice: once for before, once for after
    expect(hookCalls).toHaveLength(2);
    expect(hookCalls[0]!.event).toBe('before_transition');
    expect(hookCalls[0]!.hookCount).toBe(1); // 1 enabled before hook
    expect(hookCalls[1]!.event).toBe('after_transition');
    expect(hookCalls[1]!.hookCount).toBe(1); // 1 enabled after hook
  });

  it('calls workflowTrigger after successful transition', async () => {
    insertRecord(db, 'inv-007', 'draft', 100);

    const workflowTrigger = vi.fn<WorkflowTrigger>();

    await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'inv-007',
      action: 'cancel',
      workflowTrigger,
    });

    expect(workflowTrigger).toHaveBeenCalledWith(
      'dt-invoice',
      'inv-007',
      'draft',
      'cancelled',
      'cancel',
    );
  });

  it('does not call workflowTrigger on failed transition', async () => {
    insertRecord(db, 'inv-008', 'draft', 100);

    const workflowTrigger = vi.fn<WorkflowTrigger>();

    await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'inv-008',
      action: 'pay', // invalid — can't pay from draft
      workflowTrigger,
    });

    expect(workflowTrigger).not.toHaveBeenCalled();
  });

  it('uses custom statusField when provided', async () => {
    // Create a table with a different status column name
    db.exec(`
      CREATE TABLE IF NOT EXISTS "dt_order" (
        id TEXT PRIMARY KEY,
        order_state TEXT NOT NULL DEFAULT 'new',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_by TEXT NOT NULL
      )
    `);

    const orderDoctype: DocType = {
      id: 'dt-order',
      name: 'order',
      label_singular: 'Order',
      label_plural: 'Orders',
      table_name: 'dt_order',
      source: 'ai-created',
    };

    // Create order transitions
    createDocType(db, {
      doctype: orderDoctype,
      transitions: [
        {
          id: 'tr-order-1',
          doctype_id: 'dt-order',
          from_state: 'new',
          to_state: 'processing',
          action_name: 'process',
          action_label: 'Process',
        },
      ],
    });

    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO dt_order (id, order_state, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, ?)',
    ).run('ord-001', 'new', now, now, 'test');

    const result = await executeTransition({
      db,
      doctype: orderDoctype,
      tableName: 'dt_order',
      statusField: 'order_state',
      recordId: 'ord-001',
      action: 'process',
    });

    expect(result.success).toBe(true);
    expect(result.toState).toBe('processing');

    const row = db.prepare('SELECT order_state FROM dt_order WHERE id = ?').get('ord-001') as {
      order_state: string;
    };
    expect(row.order_state).toBe('processing');
  });

  it('handles workflow trigger errors gracefully (non-fatal)', async () => {
    insertRecord(db, 'inv-009', 'draft', 100);

    const workflowTrigger: WorkflowTrigger = async () => {
      throw new Error('Workflow engine unavailable');
    };

    // Should not throw — workflow errors are non-fatal
    const result = await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'inv-009',
      action: 'cancel',
      workflowTrigger,
    });

    expect(result.success).toBe(true);
    expect(result.toState).toBe('cancelled');
  });

  it('updates the updated_at timestamp on transition', async () => {
    insertRecord(db, 'inv-010', 'draft', 100);

    const before = db.prepare('SELECT updated_at FROM dt_invoice WHERE id = ?').get('inv-010') as {
      updated_at: string;
    };

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));

    await executeTransition({
      db,
      doctype: INVOICE_DOCTYPE,
      tableName: 'dt_invoice',
      recordId: 'inv-010',
      action: 'cancel',
    });

    const after = db.prepare('SELECT updated_at FROM dt_invoice WHERE id = ?').get('inv-010') as {
      updated_at: string;
    };

    expect(after.updated_at).not.toBe(before.updated_at);
  });
});
