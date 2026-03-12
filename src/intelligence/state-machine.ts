import type Database from 'better-sqlite3';
import type { DocType, DocTypeTransition } from '../types/doctype.js';

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
