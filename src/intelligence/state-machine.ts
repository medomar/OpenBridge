import type Database from 'better-sqlite3';
import type { DocType, DocTypeHook, DocTypeTransition } from '../types/doctype.js';
import { createLogger } from '../core/logger.js';
import { ensureAuditLogTable, insertAuditEntry } from './audit-log.js';

const logger = createLogger('state-machine');

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface TransitionResult {
  valid: boolean;
  toState?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Internal row type for reading transitions from SQLite
// ---------------------------------------------------------------------------

interface TransitionRow {
  id: string;
  doctype_id: string;
  from_state: string;
  to_state: string;
  action_name: string;
  action_label: string;
  allowed_roles: string | null;
  condition: string | null;
}

function rowToTransition(row: TransitionRow): DocTypeTransition {
  return {
    id: row.id,
    doctype_id: row.doctype_id,
    from_state: row.from_state,
    to_state: row.to_state,
    action_name: row.action_name,
    action_label: row.action_label,
    allowed_roles: row.allowed_roles ? (JSON.parse(row.allowed_roles) as string[]) : undefined,
    condition: row.condition ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Condition expression evaluator (safe — no eval())
// ---------------------------------------------------------------------------

/**
 * Evaluate a simple condition expression against a record.
 *
 * Supported syntax:
 *   - Field references: bare identifier (e.g. `total`, `status`)
 *   - String literals: single-quoted values (e.g. `'draft'`)
 *   - Numeric literals: integer or decimal (e.g. `0`, `100.5`)
 *   - Comparison operators: `==`, `!=`, `>`, `<`, `>=`, `<=`
 *   - Logical operators: `AND`, `OR` (case-insensitive)
 *
 * Examples:
 *   `total > 0`
 *   `status == 'draft'`
 *   `items_count > 0 AND total >= 100`
 */
export function evaluateCondition(expression: string, record: Record<string, unknown>): boolean {
  const trimmed = expression.trim();
  if (!trimmed) return true;

  // Split on OR first (lowest precedence)
  const orParts = splitOnLogical(trimmed, 'OR');
  if (orParts.length > 1) {
    return orParts.some((part) => evaluateCondition(part, record));
  }

  // Split on AND
  const andParts = splitOnLogical(trimmed, 'AND');
  if (andParts.length > 1) {
    return andParts.every((part) => evaluateCondition(part, record));
  }

  // Single comparison clause
  return evaluateComparison(trimmed, record);
}

/**
 * Split an expression string on a logical keyword (AND / OR) respecting that
 * the keyword must appear as a standalone word boundary (not inside a value).
 * Returns the original single-element array if the keyword is not found.
 */
function splitOnLogical(expr: string, keyword: 'AND' | 'OR'): string[] {
  // Regex: whitespace + keyword + whitespace (case-insensitive, word-bounded)
  const re = new RegExp(`\\s+${keyword}\\s+`, 'i');
  const parts = expr.split(re);
  return parts.length > 1 ? parts.map((p) => p.trim()) : [expr];
}

/**
 * Evaluate a single `<left> <op> <right>` comparison.
 * Returns `true` on unrecognised syntax (fail-open for permissive default).
 */
function evaluateComparison(clause: string, record: Record<string, unknown>): boolean {
  // Match: <token> <op> <token>
  // op: ==, !=, >=, <=, >, <
  const COMPARISON_RE = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;
  const match = COMPARISON_RE.exec(clause.trim());
  if (!match) {
    // Not a recognised comparison — treat bare field reference as truthy check
    const val = resolveToken(clause.trim(), record);
    return isTruthy(val);
  }

  const left = resolveToken((match[1] ?? '').trim(), record);
  const op = match[2] ?? '==';
  const right = resolveToken((match[3] ?? '').trim(), record);

  return compare(left, op, right);
}

/**
 * Resolve a token to its value: a string literal, numeric literal, or field ref.
 */
function resolveToken(token: string, record: Record<string, unknown>): unknown {
  // Single-quoted string literal
  if (token.startsWith("'") && token.endsWith("'")) {
    return token.slice(1, -1);
  }

  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(token)) {
    return Number(token);
  }

  // Boolean literals
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null') return null;

  // Field reference
  return Object.prototype.hasOwnProperty.call(record, token) ? record[token] : undefined;
}

function isTruthy(val: unknown): boolean {
  if (val === null || val === undefined || val === false || val === 0 || val === '') return false;
  return true;
}

/**
 * Safely convert a primitive value to string. Objects are returned as empty string
 * to avoid the `[object Object]` default stringification.
 */
function toStringValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

/**
 * Compare two values with the given operator.
 * Numbers are compared numerically; everything else is compared as strings.
 */
function compare(left: unknown, op: string, right: unknown): boolean {
  // Numeric comparison when both sides coerce to finite numbers
  if (typeof left === 'number' || typeof right === 'number') {
    const l = Number(left);
    const r = Number(right);
    if (isFinite(l) && isFinite(r)) {
      switch (op) {
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '>':
          return l > r;
        case '<':
          return l < r;
        case '>=':
          return l >= r;
        case '<=':
          return l <= r;
      }
    }
  }

  // String / equality comparison — only stringify primitives
  const l = toStringValue(left);
  const r = toStringValue(right);
  switch (op) {
    case '==':
      return l === r;
    case '!=':
      return l !== r;
    case '>':
      return l > r;
    case '<':
      return l < r;
    case '>=':
      return l >= r;
    case '<=':
      return l <= r;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Transition loader
// ---------------------------------------------------------------------------

/**
 * Load all transitions for a DocType from the metadata tables.
 * Requires `doctype_transitions` table to exist (created by ensureDocTypeStoreSchema).
 */
function loadTransitions(db: Database.Database, doctypeId: string): DocTypeTransition[] {
  const rows = db
    .prepare('SELECT * FROM doctype_transitions WHERE doctype_id = ?')
    .all(doctypeId) as TransitionRow[];
  return rows.map(rowToTransition);
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Validate whether a state transition is allowed for the given record.
 *
 * Checks:
 *   1. A transition exists from `fromState` via `action`
 *   2. The `userRole` (if provided) is in the transition's `allowed_roles` list
 *   3. The optional `condition` expression evaluates to true against `record`
 *
 * @param db         - better-sqlite3 Database instance (must have metadata tables)
 * @param doctype    - DocType definition (used for its `id`)
 * @param record     - The data record being transitioned (field values as key/value)
 * @param fromState  - The record's current state name
 * @param action     - The action being performed (maps to `action_name`)
 * @param userRole   - Optional role of the user performing the action
 * @returns          TransitionResult with `valid`, `toState`, or `error`
 */
export function validateTransition(
  db: Database.Database,
  doctype: DocType,
  record: Record<string, unknown>,
  fromState: string,
  action: string,
  userRole?: string,
): TransitionResult {
  const transitions = loadTransitions(db, doctype.id);

  // 1. Find a matching transition
  const transition = transitions.find(
    (t) => t.from_state === fromState && t.action_name === action,
  );

  if (!transition) {
    return {
      valid: false,
      error: `No transition found from state "${fromState}" via action "${action}"`,
    };
  }

  // 2. Check role
  if (transition.allowed_roles && transition.allowed_roles.length > 0) {
    if (!userRole || !transition.allowed_roles.includes(userRole)) {
      return {
        valid: false,
        error: `Role "${userRole ?? '(none)'}" is not allowed to perform action "${action}"`,
      };
    }
  }

  // 3. Evaluate condition
  if (transition.condition) {
    let conditionMet: boolean;
    try {
      conditionMet = evaluateCondition(transition.condition, record);
    } catch {
      return {
        valid: false,
        error: `Condition evaluation error for expression: "${transition.condition}"`,
      };
    }

    if (!conditionMet) {
      return {
        valid: false,
        error: `Transition condition not met: "${transition.condition}"`,
      };
    }
  }

  return { valid: true, toState: transition.to_state };
}

// ---------------------------------------------------------------------------
// Execute transition — full Salesforce-inspired pipeline
// ---------------------------------------------------------------------------

/** Result returned by executeTransition */
export interface ExecuteTransitionResult {
  success: boolean;
  fromState: string;
  toState?: string;
  error?: string;
  /** The updated record after the status change */
  record?: Record<string, unknown>;
}

/** Callback for lifecycle hook execution. Receives the hooks to fire and the current record. */
export type HookExecutor = (
  hooks: DocTypeHook[],
  record: Record<string, unknown>,
) => Promise<void> | void;

/** Callback for triggering dependent workflows after a transition completes. */
export type WorkflowTrigger = (
  doctypeId: string,
  recordId: string,
  fromState: string,
  toState: string,
  action: string,
) => Promise<void> | void;

/** Options for executeTransition */
export interface ExecuteTransitionOptions {
  /** Database instance */
  db: Database.Database;
  /** DocType definition */
  doctype: DocType;
  /** The data table name for the DocType (e.g. "dt_invoice") */
  tableName: string;
  /** The column name that stores the current state (defaults to "status") */
  statusField?: string;
  /** The record ID to transition */
  recordId: string;
  /** The action being performed */
  action: string;
  /** Optional role of the user performing the action */
  userRole?: string;
  /** Optional hook executor — called for before/after hooks */
  hookExecutor?: HookExecutor;
  /** Optional workflow trigger — called after transition completes */
  workflowTrigger?: WorkflowTrigger;
}

/**
 * Execute a full state transition pipeline:
 *
 *   1. Load record from the dynamic table
 *   2. Validate transition (role, condition checks)
 *   3. Fire before-transition hooks
 *   4. UPDATE status field + insert audit log entry
 *   5. Fire after-transition hooks
 *   6. Trigger dependent workflows
 *
 * Steps 1–5 are wrapped in a SQLite transaction. Step 6 (workflows) runs
 * outside the transaction since workflows may perform async/external work.
 */
export async function executeTransition(
  opts: ExecuteTransitionOptions,
): Promise<ExecuteTransitionResult> {
  const { db, doctype, tableName, recordId, action, userRole, hookExecutor, workflowTrigger } =
    opts;
  const statusField = opts.statusField ?? 'status';
  const qTable = quoteIdent(tableName);
  const qStatus = quoteIdent(statusField);

  // Step 1: Load record
  logger.debug({ doctypeId: doctype.id, recordId, action }, 'Step 1: Loading record');
  const record = db.prepare(`SELECT * FROM ${qTable} WHERE "id" = ?`).get(recordId) as
    | Record<string, unknown>
    | undefined;

  if (!record) {
    logger.warn({ doctypeId: doctype.id, recordId }, 'Record not found');
    return {
      success: false,
      fromState: '',
      error: `Record "${recordId}" not found in table "${tableName}"`,
    };
  }

  const rawStatus = record[statusField];
  const fromState =
    rawStatus == null || typeof rawStatus === 'object'
      ? ''
      : String(rawStatus as string | number | boolean);
  if (!fromState) {
    return {
      success: false,
      fromState: '',
      error: `Record "${recordId}" has no value in status field "${statusField}"`,
    };
  }

  // Step 2: Validate transition
  logger.debug({ doctypeId: doctype.id, fromState, action }, 'Step 2: Validating transition');
  const validation = validateTransition(db, doctype, record, fromState, action, userRole);
  if (!validation.valid) {
    logger.info(
      { doctypeId: doctype.id, fromState, action, error: validation.error },
      'Transition validation failed',
    );
    return { success: false, fromState, error: validation.error };
  }

  const toState = validation.toState!;

  // Load hooks for before/after firing
  const allHooks = loadHooks(db, doctype.id);
  const beforeHooks = allHooks.filter((h) => h.event === 'before_transition' && h.enabled);
  const afterHooks = allHooks.filter((h) => h.event === 'after_transition' && h.enabled);

  // Ensure audit log table exists before entering the transaction (exec not allowed inside transactions)
  ensureAuditLogTable(db);

  // Steps 3–5 in a transaction
  const runTransaction = db.transaction(() => {
    // Step 3: Fire before-hooks (synchronous within transaction)
    if (beforeHooks.length > 0) {
      logger.debug(
        { doctypeId: doctype.id, hookCount: beforeHooks.length },
        'Step 3: Firing before-transition hooks',
      );
      if (hookExecutor) {
        // hookExecutor may be sync or async; within transaction we call it synchronously
        const result = hookExecutor(beforeHooks, record);
        // If it returns a promise inside a transaction, it won't actually await —
        // callers providing async hookExecutors should ensure before-hooks are sync
        if (result && typeof result === 'object' && 'then' in result) {
          logger.warn(
            'hookExecutor returned a Promise inside transaction — before-hooks should be synchronous',
          );
        }
      }
    } else {
      logger.debug('Step 3: No before-transition hooks to fire');
    }

    // Step 4: UPDATE status + audit log
    logger.debug(
      { doctypeId: doctype.id, recordId, fromState, toState },
      'Step 4: Updating status and writing audit log',
    );

    const now = new Date().toISOString();
    db.prepare(`UPDATE ${qTable} SET ${qStatus} = ?, "updated_at" = ? WHERE "id" = ?`).run(
      toState,
      now,
      recordId,
    );

    // Write transition-specific audit table
    ensureTransitionAuditTable(db);
    db.prepare(
      `INSERT INTO doctype_transition_audit
        (doctype_id, record_id, from_state, to_state, action, user_role, transitioned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(doctype.id, recordId, fromState, toState, action, userRole ?? null, now);

    // Write to the shared dt_audit_log
    insertAuditEntry(db, {
      doctype: doctype.name,
      record_id: recordId,
      event: 'transition',
      old_value: fromState,
      new_value: toState,
      changed_by: userRole ?? null,
      changed_at: now,
    });

    // Step 5: Fire after-hooks (synchronous within transaction)
    // Re-read record with updated status for after-hooks
    const updatedRecord = db
      .prepare(`SELECT * FROM ${qTable} WHERE "id" = ?`)
      .get(recordId) as Record<string, unknown>;

    if (afterHooks.length > 0) {
      logger.debug(
        { doctypeId: doctype.id, hookCount: afterHooks.length },
        'Step 5: Firing after-transition hooks',
      );
      if (hookExecutor) {
        const result = hookExecutor(afterHooks, updatedRecord);
        if (result && typeof result === 'object' && 'then' in result) {
          logger.warn(
            'hookExecutor returned a Promise inside transaction — after-hooks should be synchronous',
          );
        }
      }
    } else {
      logger.debug('Step 5: No after-transition hooks to fire');
    }

    return updatedRecord;
  });

  let updatedRecord: Record<string, unknown>;
  try {
    updatedRecord = runTransaction();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, doctypeId: doctype.id, recordId, action }, 'Transaction failed');
    return { success: false, fromState, error: `Transaction failed: ${message}` };
  }

  // Step 6: Trigger dependent workflows (outside transaction)
  if (workflowTrigger) {
    logger.debug(
      { doctypeId: doctype.id, fromState, toState, action },
      'Step 6: Triggering dependent workflows',
    );
    try {
      await workflowTrigger(doctype.id, recordId, fromState, toState, action);
    } catch (err) {
      // Workflow failures are non-fatal — log but don't fail the transition
      logger.error(
        { err, doctypeId: doctype.id, recordId, action },
        'Workflow trigger failed (non-fatal)',
      );
    }
  } else {
    logger.debug('Step 6: No workflow trigger configured');
  }

  logger.info(
    { doctypeId: doctype.id, recordId, fromState, toState, action },
    'Transition executed successfully',
  );

  return { success: true, fromState, toState, record: updatedRecord };
}

// ---------------------------------------------------------------------------
// Audit table schema
// ---------------------------------------------------------------------------

let auditTableCreated = false;

function ensureTransitionAuditTable(db: Database.Database): void {
  if (auditTableCreated) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS doctype_transition_audit (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      doctype_id      TEXT NOT NULL,
      record_id       TEXT NOT NULL,
      from_state      TEXT NOT NULL,
      to_state        TEXT NOT NULL,
      action          TEXT NOT NULL,
      user_role       TEXT,
      transitioned_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transition_audit_record
      ON doctype_transition_audit(doctype_id, record_id);
  `);
  auditTableCreated = true;
}

/** Reset the audit table creation flag (for testing) */
export function resetAuditTableFlag(): void {
  auditTableCreated = false;
}

// ---------------------------------------------------------------------------
// Hook loader
// ---------------------------------------------------------------------------

interface HookRow {
  id: string;
  doctype_id: string;
  event: string;
  action_type: string;
  action_config: string;
  sort_order: number;
  enabled: number;
}

function loadHooks(db: Database.Database, doctypeId: string): DocTypeHook[] {
  const rows = db
    .prepare('SELECT * FROM doctype_hooks WHERE doctype_id = ? ORDER BY sort_order')
    .all(doctypeId) as HookRow[];
  return rows.map((row) => ({
    id: row.id,
    doctype_id: row.doctype_id,
    event: row.event,
    action_type: row.action_type as DocTypeHook['action_type'],
    action_config: JSON.parse(row.action_config) as Record<string, unknown>,
    sort_order: row.sort_order,
    enabled: row.enabled === 1,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Quote a SQLite identifier (used locally to avoid collision with table-builder's private fn) */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// List available actions
// ---------------------------------------------------------------------------

/**
 * List all valid actions available from `currentState` for the given record and role.
 * Useful for building UI action buttons or validating user input.
 */
export function listAvailableActions(
  db: Database.Database,
  doctype: DocType,
  record: Record<string, unknown>,
  currentState: string,
  userRole?: string,
): Array<{ action_name: string; action_label: string; to_state: string }> {
  const transitions = loadTransitions(db, doctype.id);

  return transitions
    .filter((t) => {
      if (t.from_state !== currentState) return false;
      if (t.allowed_roles && t.allowed_roles.length > 0) {
        if (!userRole || !t.allowed_roles.includes(userRole)) return false;
      }
      if (t.condition) {
        try {
          return evaluateCondition(t.condition, record);
        } catch {
          return false;
        }
      }
      return true;
    })
    .map((t) => ({
      action_name: t.action_name,
      action_label: t.action_label,
      to_state: t.to_state,
    }));
}
