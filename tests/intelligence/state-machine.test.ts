import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  evaluateCondition,
  validateTransition,
  executeTransition,
  listAvailableActions,
  resetAuditTableFlag,
} from '../../src/intelligence/state-machine.js';
import type { DocType, DocTypeHook } from '../../src/types/doctype.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal DocType definition for testing */
function makeDocType(overrides?: Partial<DocType>): DocType {
  return {
    id: 'dt-invoice',
    name: 'Invoice',
    label_singular: 'Invoice',
    label_plural: 'Invoices',
    table_name: 'dt_invoice',
    source: 'ai-created',
    ...overrides,
  };
}

/** Set up an in-memory SQLite database with required metadata tables + a data table */
function setupDb(): Database.Database {
  const db = new Database(':memory:');

  // Metadata tables expected by state-machine.ts
  db.exec(`
    CREATE TABLE doctype_transitions (
      id            TEXT PRIMARY KEY,
      doctype_id    TEXT NOT NULL,
      from_state    TEXT NOT NULL,
      to_state      TEXT NOT NULL,
      action_name   TEXT NOT NULL,
      action_label  TEXT NOT NULL,
      allowed_roles TEXT,
      condition     TEXT
    );

    CREATE TABLE doctype_hooks (
      id            TEXT PRIMARY KEY,
      doctype_id    TEXT NOT NULL,
      event         TEXT NOT NULL,
      action_type   TEXT NOT NULL,
      action_config TEXT NOT NULL DEFAULT '{}',
      sort_order    INTEGER NOT NULL DEFAULT 0,
      enabled       INTEGER NOT NULL DEFAULT 1
    );

    -- Data table for the Invoice DocType
    CREATE TABLE dt_invoice (
      id         TEXT PRIMARY KEY,
      status     TEXT NOT NULL DEFAULT 'draft',
      total      REAL NOT NULL DEFAULT 0,
      updated_at TEXT
    );
  `);

  return db;
}

/** Insert a transition row */
function insertTransition(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    doctype_id: string;
    from_state: string;
    to_state: string;
    action_name: string;
    action_label: string;
    allowed_roles: string[] | null;
    condition: string | null;
  }> = {},
): void {
  const {
    id = 'tr-1',
    doctype_id = 'dt-invoice',
    from_state = 'draft',
    to_state = 'submitted',
    action_name = 'submit',
    action_label = 'Submit',
    allowed_roles = null,
    condition = null,
  } = overrides;

  db.prepare(
    `INSERT INTO doctype_transitions
       (id, doctype_id, from_state, to_state, action_name, action_label, allowed_roles, condition)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    doctype_id,
    from_state,
    to_state,
    action_name,
    action_label,
    allowed_roles ? JSON.stringify(allowed_roles) : null,
    condition,
  );
}

/** Insert a hook row */
function insertHook(
  db: Database.Database,
  overrides: Partial<{
    id: string;
    doctype_id: string;
    event: string;
    action_type: string;
    action_config: Record<string, unknown>;
    sort_order: number;
    enabled: number;
  }> = {},
): void {
  const {
    id = 'hook-1',
    doctype_id = 'dt-invoice',
    event = 'before_transition',
    action_type = 'update_field',
    action_config = {},
    sort_order = 0,
    enabled = 1,
  } = overrides;

  db.prepare(
    `INSERT INTO doctype_hooks
       (id, doctype_id, event, action_type, action_config, sort_order, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, doctype_id, event, action_type, JSON.stringify(action_config), sort_order, enabled);
}

/** Insert a record into dt_invoice */
function insertRecord(
  db: Database.Database,
  overrides: Partial<{ id: string; status: string; total: number }> = {},
): void {
  const { id = 'rec-1', status = 'draft', total = 100 } = overrides;
  db.prepare('INSERT INTO dt_invoice (id, status, total) VALUES (?, ?, ?)').run(id, status, total);
}

// ===========================================================================
// evaluateCondition (existing tests preserved)
// ===========================================================================

describe('evaluateCondition', () => {
  const record = {
    total: 150,
    status: 'draft',
    items_count: 3,
    discount: 0,
    label: 'pending review',
    active: true,
    archived: false,
  };

  // ---------------------------------------------------------------------------
  // Empty / blank expressions
  // ---------------------------------------------------------------------------

  it('returns true for empty expression', () => {
    expect(evaluateCondition('', record)).toBe(true);
    expect(evaluateCondition('   ', record)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Numeric comparisons
  // ---------------------------------------------------------------------------

  it('evaluates > with numeric field', () => {
    expect(evaluateCondition('total > 0', record)).toBe(true);
    expect(evaluateCondition('total > 200', record)).toBe(false);
  });

  it('evaluates < with numeric field', () => {
    expect(evaluateCondition('discount < 10', record)).toBe(true);
    expect(evaluateCondition('total < 100', record)).toBe(false);
  });

  it('evaluates >= with numeric field', () => {
    expect(evaluateCondition('total >= 150', record)).toBe(true);
    expect(evaluateCondition('total >= 151', record)).toBe(false);
  });

  it('evaluates <= with numeric field', () => {
    expect(evaluateCondition('total <= 150', record)).toBe(true);
    expect(evaluateCondition('total <= 149', record)).toBe(false);
  });

  it('evaluates == with numeric field', () => {
    expect(evaluateCondition('items_count == 3', record)).toBe(true);
    expect(evaluateCondition('items_count == 0', record)).toBe(false);
  });

  it('evaluates != with numeric field', () => {
    expect(evaluateCondition('items_count != 0', record)).toBe(true);
    expect(evaluateCondition('items_count != 3', record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // String comparisons
  // ---------------------------------------------------------------------------

  it("evaluates == with string literal ('draft')", () => {
    expect(evaluateCondition("status == 'draft'", record)).toBe(true);
    expect(evaluateCondition("status == 'submitted'", record)).toBe(false);
  });

  it('evaluates != with string literal', () => {
    expect(evaluateCondition("status != 'submitted'", record)).toBe(true);
    expect(evaluateCondition("status != 'draft'", record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Logical AND
  // ---------------------------------------------------------------------------

  it('evaluates AND conjunction (both true)', () => {
    expect(evaluateCondition("total > 0 AND status == 'draft'", record)).toBe(true);
  });

  it('evaluates AND conjunction (first false)', () => {
    expect(evaluateCondition("total > 200 AND status == 'draft'", record)).toBe(false);
  });

  it('evaluates AND conjunction (second false)', () => {
    expect(evaluateCondition("total > 0 AND status == 'submitted'", record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Logical OR
  // ---------------------------------------------------------------------------

  it('evaluates OR disjunction (both true)', () => {
    expect(evaluateCondition('total > 0 OR items_count > 0', record)).toBe(true);
  });

  it('evaluates OR disjunction (first false, second true)', () => {
    expect(evaluateCondition('total > 200 OR items_count > 0', record)).toBe(true);
  });

  it('evaluates OR disjunction (both false)', () => {
    expect(evaluateCondition('total > 200 OR items_count > 10', record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Boolean literals
  // ---------------------------------------------------------------------------

  it('evaluates == true literal', () => {
    expect(evaluateCondition('active == true', record)).toBe(true);
    expect(evaluateCondition('archived == true', record)).toBe(false);
  });

  it('evaluates == false literal', () => {
    expect(evaluateCondition('archived == false', record)).toBe(true);
    expect(evaluateCondition('active == false', record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Bare field reference (truthy check)
  // ---------------------------------------------------------------------------

  it('returns truthy for a non-zero numeric field reference', () => {
    expect(evaluateCondition('total', record)).toBe(true);
    expect(evaluateCondition('discount', record)).toBe(false);
  });

  it('returns false for unknown field reference', () => {
    expect(evaluateCondition('nonexistent_field', record)).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('handles numeric zero boundary correctly', () => {
    expect(evaluateCondition('discount > 0', record)).toBe(false);
    expect(evaluateCondition('discount == 0', record)).toBe(true);
  });

  it('is case-insensitive for AND / OR keywords', () => {
    expect(evaluateCondition('total > 0 and items_count > 0', record)).toBe(true);
    expect(evaluateCondition('total > 200 or items_count > 0', record)).toBe(true);
  });
});

// ===========================================================================
// validateTransition
// ===========================================================================

describe('validateTransition', () => {
  let db: Database.Database;
  const doctype = makeDocType();

  beforeEach(() => {
    db = setupDb();
    resetAuditTableFlag();
  });

  // (1) valid transition succeeds
  it('succeeds for a valid transition with no role or condition', () => {
    insertTransition(db);
    const record = { total: 100, status: 'draft' };

    const result = validateTransition(db, doctype, record, 'draft', 'submit');
    expect(result.valid).toBe(true);
    expect(result.toState).toBe('submitted');
    expect(result.error).toBeUndefined();
  });

  // (2) invalid transition rejected
  it('rejects when no matching transition exists', () => {
    insertTransition(db); // draft → submitted via "submit"
    const record = { total: 100, status: 'draft' };

    const result = validateTransition(db, doctype, record, 'draft', 'approve');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No transition found');
    expect(result.error).toContain('approve');
  });

  it('rejects when from_state does not match', () => {
    insertTransition(db);
    const record = { total: 100, status: 'submitted' };

    const result = validateTransition(db, doctype, record, 'submitted', 'submit');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('No transition found');
  });

  // (3) role check blocks unauthorized user
  it('blocks a user whose role is not in allowed_roles', () => {
    insertTransition(db, { allowed_roles: ['manager', 'admin'] });
    const record = { total: 100, status: 'draft' };

    const result = validateTransition(db, doctype, record, 'draft', 'submit', 'viewer');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Role "viewer" is not allowed');
  });

  it('blocks when no role is provided but allowed_roles is set', () => {
    insertTransition(db, { allowed_roles: ['manager'] });
    const record = { total: 100, status: 'draft' };

    const result = validateTransition(db, doctype, record, 'draft', 'submit');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Role "(none)" is not allowed');
  });

  it('allows a user whose role is in allowed_roles', () => {
    insertTransition(db, { allowed_roles: ['manager', 'admin'] });
    const record = { total: 100, status: 'draft' };

    const result = validateTransition(db, doctype, record, 'draft', 'submit', 'manager');
    expect(result.valid).toBe(true);
    expect(result.toState).toBe('submitted');
  });

  // (4) condition expression evaluation (total > 0 with total=0 → blocked)
  it('blocks when condition expression is not met (total > 0 with total=0)', () => {
    insertTransition(db, { condition: 'total > 0' });
    const record = { total: 0, status: 'draft' };

    const result = validateTransition(db, doctype, record, 'draft', 'submit');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Transition condition not met');
    expect(result.error).toContain('total > 0');
  });

  it('allows when condition expression is met', () => {
    insertTransition(db, { condition: 'total > 0' });
    const record = { total: 500, status: 'draft' };

    const result = validateTransition(db, doctype, record, 'draft', 'submit');
    expect(result.valid).toBe(true);
  });

  it('allows transition with no condition set', () => {
    insertTransition(db, { condition: null });
    const record = { total: 0, status: 'draft' };

    const result = validateTransition(db, doctype, record, 'draft', 'submit');
    expect(result.valid).toBe(true);
  });
});

// ===========================================================================
// listAvailableActions
// ===========================================================================

describe('listAvailableActions', () => {
  let db: Database.Database;
  const doctype = makeDocType();

  beforeEach(() => {
    db = setupDb();
    resetAuditTableFlag();
  });

  it('returns actions available from the current state', () => {
    insertTransition(db, { id: 'tr-1', action_name: 'submit', action_label: 'Submit' });
    insertTransition(db, {
      id: 'tr-2',
      from_state: 'draft',
      to_state: 'cancelled',
      action_name: 'cancel',
      action_label: 'Cancel',
    });

    const actions = listAvailableActions(db, doctype, { total: 100 }, 'draft');
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.action_name)).toContain('submit');
    expect(actions.map((a) => a.action_name)).toContain('cancel');
  });

  it('filters out actions that fail role check', () => {
    insertTransition(db, { allowed_roles: ['admin'] });

    const actions = listAvailableActions(db, doctype, { total: 100 }, 'draft', 'viewer');
    expect(actions).toHaveLength(0);
  });

  it('filters out actions whose condition is not met', () => {
    insertTransition(db, { condition: 'total > 0' });

    const actions = listAvailableActions(db, doctype, { total: 0 }, 'draft');
    expect(actions).toHaveLength(0);
  });
});

// ===========================================================================
// executeTransition — full pipeline with before/after hooks
// ===========================================================================

describe('executeTransition', () => {
  let db: Database.Database;
  const doctype = makeDocType();

  beforeEach(() => {
    db = setupDb();
    resetAuditTableFlag();
  });

  // (5) full transition pipeline with before/after hooks (mock hooks)
  it('executes the full pipeline: validate → before-hooks → update → after-hooks', async () => {
    insertTransition(db);
    insertRecord(db);

    // Add before and after hooks
    insertHook(db, {
      id: 'hook-before',
      event: 'before_transition',
      action_type: 'update_field',
      sort_order: 0,
    });
    insertHook(db, {
      id: 'hook-after',
      event: 'after_transition',
      action_type: 'send_notification',
      sort_order: 1,
    });

    const hookCalls: Array<{ hooks: DocTypeHook[]; recordStatus: unknown }> = [];
    const mockHookExecutor = vi.fn((hooks: DocTypeHook[], record: Record<string, unknown>) => {
      hookCalls.push({ hooks, recordStatus: record['status'] });
    });

    const result = await executeTransition({
      db,
      doctype,
      tableName: 'dt_invoice',
      recordId: 'rec-1',
      action: 'submit',
      hookExecutor: mockHookExecutor,
    });

    expect(result.success).toBe(true);
    expect(result.fromState).toBe('draft');
    expect(result.toState).toBe('submitted');
    expect(result.record).toBeDefined();
    expect(result.record!['status']).toBe('submitted');

    // hookExecutor called twice: before-hooks, then after-hooks
    expect(mockHookExecutor).toHaveBeenCalledTimes(2);

    // Before-hooks receive original record (status = 'draft')
    expect(hookCalls[0]!.recordStatus).toBe('draft');
    expect(hookCalls[0]!.hooks).toHaveLength(1);
    expect(hookCalls[0]!.hooks[0]!.event).toBe('before_transition');

    // After-hooks receive updated record (status = 'submitted')
    expect(hookCalls[1]!.recordStatus).toBe('submitted');
    expect(hookCalls[1]!.hooks).toHaveLength(1);
    expect(hookCalls[1]!.hooks[0]!.event).toBe('after_transition');
  });

  it('writes audit log entries on successful transition', async () => {
    insertTransition(db);
    insertRecord(db);

    await executeTransition({
      db,
      doctype,
      tableName: 'dt_invoice',
      recordId: 'rec-1',
      action: 'submit',
    });

    // Check transition audit table
    const auditRows = db
      .prepare('SELECT * FROM doctype_transition_audit WHERE record_id = ?')
      .all('rec-1') as Array<Record<string, unknown>>;
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!['from_state']).toBe('draft');
    expect(auditRows[0]!['to_state']).toBe('submitted');
    expect(auditRows[0]!['action']).toBe('submit');

    // Check shared dt_audit_log table
    const sharedAudit = db
      .prepare('SELECT * FROM dt_audit_log WHERE record_id = ?')
      .all('rec-1') as Array<Record<string, unknown>>;
    expect(sharedAudit).toHaveLength(1);
    expect(sharedAudit[0]!['event']).toBe('transition');
    expect(sharedAudit[0]!['old_value']).toBe('draft');
    expect(sharedAudit[0]!['new_value']).toBe('submitted');
  });

  it('fails when record does not exist', async () => {
    insertTransition(db);

    const result = await executeTransition({
      db,
      doctype,
      tableName: 'dt_invoice',
      recordId: 'nonexistent',
      action: 'submit',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Record "nonexistent" not found');
  });

  it('fails when transition validation fails (invalid action)', async () => {
    insertTransition(db);
    insertRecord(db);

    const result = await executeTransition({
      db,
      doctype,
      tableName: 'dt_invoice',
      recordId: 'rec-1',
      action: 'approve', // no such transition from 'draft'
    });

    expect(result.success).toBe(false);
    expect(result.fromState).toBe('draft');
    expect(result.error).toContain('No transition found');
  });

  it('fails when role check blocks the transition', async () => {
    insertTransition(db, { allowed_roles: ['admin'] });
    insertRecord(db);

    const result = await executeTransition({
      db,
      doctype,
      tableName: 'dt_invoice',
      recordId: 'rec-1',
      action: 'submit',
      userRole: 'viewer',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Role "viewer" is not allowed');
  });

  it('fails when condition is not met', async () => {
    insertTransition(db, { condition: 'total > 0' });
    insertRecord(db, { total: 0 });

    const result = await executeTransition({
      db,
      doctype,
      tableName: 'dt_invoice',
      recordId: 'rec-1',
      action: 'submit',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Transition condition not met');
  });

  it('calls workflowTrigger after successful transition', async () => {
    insertTransition(db);
    insertRecord(db);

    const mockWorkflow = vi.fn();

    await executeTransition({
      db,
      doctype,
      tableName: 'dt_invoice',
      recordId: 'rec-1',
      action: 'submit',
      workflowTrigger: mockWorkflow,
    });

    expect(mockWorkflow).toHaveBeenCalledWith(
      'dt-invoice',
      'rec-1',
      'draft',
      'submitted',
      'submit',
      expect.objectContaining({ status: 'draft', total: 100 }),
      expect.objectContaining({ status: 'submitted', total: 100 }),
    );
  });

  it('succeeds even if workflowTrigger throws (non-fatal)', async () => {
    insertTransition(db);
    insertRecord(db);

    const result = await executeTransition({
      db,
      doctype,
      tableName: 'dt_invoice',
      recordId: 'rec-1',
      action: 'submit',
      workflowTrigger: async () => {
        throw new Error('workflow boom');
      },
    });

    // Transition itself should still succeed
    expect(result.success).toBe(true);
    expect(result.toState).toBe('submitted');
  });

  it('does not call hookExecutor when there are no hooks', async () => {
    insertTransition(db);
    insertRecord(db);

    const mockHookExecutor = vi.fn();

    const result = await executeTransition({
      db,
      doctype,
      tableName: 'dt_invoice',
      recordId: 'rec-1',
      action: 'submit',
      hookExecutor: mockHookExecutor,
    });

    expect(result.success).toBe(true);
    expect(mockHookExecutor).not.toHaveBeenCalled();
  });
});
