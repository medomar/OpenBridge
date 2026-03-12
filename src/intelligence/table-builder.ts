import type { DocType, DocTypeField, FieldType } from '../types/doctype.js';

/**
 * Returns true if `formula` is a safe SQLite expression suitable for a GENERATED column.
 * Rejects: semicolons (statement separator) and DDL/DML keywords that could indicate injection.
 */
export function isValidSQLiteExpression(formula: string): boolean {
  if (formula.includes(';')) return false;
  const BANNED = /\b(DROP|ALTER|CREATE|INSERT|UPDATE|DELETE|ATTACH|DETACH|PRAGMA)\b/i;
  return !BANNED.test(formula);
}

/** Maps DocType field types to SQLite column type affinity */
const FIELD_TYPE_MAP: Record<FieldType, string> = {
  text: 'TEXT',
  longtext: 'TEXT',
  email: 'TEXT',
  phone: 'TEXT',
  url: 'TEXT',
  select: 'TEXT',
  multiselect: 'TEXT',
  link: 'TEXT',
  image: 'TEXT',
  date: 'TEXT',
  datetime: 'TEXT',
  number: 'REAL',
  currency: 'REAL',
  checkbox: 'INTEGER',
  table: 'TEXT',
};

/**
 * Generates a `CREATE TABLE` DDL statement for a DocType's data table.
 *
 * Standard columns: id (PK), created_at, updated_at, created_by
 * User-defined columns: one per DocTypeField, typed from FIELD_TYPE_MAP
 */
export function buildCreateTableDDL(doctype: DocType, fields: DocTypeField[]): string {
  const tableName = doctype.table_name;

  const columnDefs: string[] = [
    'id TEXT NOT NULL PRIMARY KEY',
    'created_at TEXT NOT NULL',
    'updated_at TEXT NOT NULL',
    'created_by TEXT NOT NULL',
  ];

  for (const field of fields) {
    const sqliteType = FIELD_TYPE_MAP[field.field_type] ?? 'TEXT';
    if (field.formula != null) {
      if (!isValidSQLiteExpression(field.formula)) {
        throw new Error(
          `Field "${field.name}": formula contains disallowed SQL keywords or characters.`,
        );
      }
      const fieldNames = new Set(fields.map((f) => f.name));
      validateFormulaColumns(field.formula, fieldNames, field.name);
      columnDefs.push(
        `${quoteIdentifier(field.name)} ${sqliteType} GENERATED ALWAYS AS (${field.formula}) STORED`,
      );
    } else {
      const notNull = field.required ? ' NOT NULL' : '';
      const defaultClause =
        field.default_value != null
          ? ` DEFAULT ${sqliteLiteral(field.default_value, sqliteType)}`
          : '';
      columnDefs.push(`${quoteIdentifier(field.name)} ${sqliteType}${notNull}${defaultClause}`);
    }
  }

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(tableName)} (\n  ${columnDefs.join(',\n  ')}\n);`;
}

/**
 * Generates a `CREATE TABLE` DDL statement for a child (table-type field) data table.
 *
 * Child table naming follows Frappe convention: `dt_{parent}__{child}` (double underscore).
 * Standard columns: id (PK), parent_id (FK → parent ON DELETE CASCADE), idx (sort order)
 * User-defined columns: one per DocTypeField, typed from FIELD_TYPE_MAP
 * Constraint: UNIQUE(parent_id, idx) to enforce ordering within a parent record.
 */
export function buildChildTableDDL(
  parentDoctype: string,
  childName: string,
  fields: DocTypeField[],
): string {
  const parentTable = `dt_${parentDoctype}`;
  const childTable = `dt_${parentDoctype}__${childName}`;

  const columnDefs: string[] = [
    'id TEXT NOT NULL PRIMARY KEY',
    `parent_id TEXT NOT NULL REFERENCES ${quoteIdentifier(parentTable)}(id) ON DELETE CASCADE`,
    'idx INTEGER NOT NULL',
  ];

  for (const field of fields) {
    const sqliteType = FIELD_TYPE_MAP[field.field_type] ?? 'TEXT';
    if (field.formula != null) {
      if (!isValidSQLiteExpression(field.formula)) {
        throw new Error(
          `Field "${field.name}": formula contains disallowed SQL keywords or characters.`,
        );
      }
      const fieldNames = new Set(fields.map((f) => f.name));
      validateFormulaColumns(field.formula, fieldNames, field.name);
      columnDefs.push(
        `${quoteIdentifier(field.name)} ${sqliteType} GENERATED ALWAYS AS (${field.formula}) STORED`,
      );
    } else {
      const notNull = field.required ? ' NOT NULL' : '';
      const defaultClause =
        field.default_value != null
          ? ` DEFAULT ${sqliteLiteral(field.default_value, sqliteType)}`
          : '';
      columnDefs.push(`${quoteIdentifier(field.name)} ${sqliteType}${notNull}${defaultClause}`);
    }
  }

  columnDefs.push('UNIQUE(parent_id, idx)');

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(childTable)} (\n  ${columnDefs.join(',\n  ')}\n);`;
}

/**
 * Validates that every bare identifier in `formula` references a known column.
 * Bare identifiers are word tokens that are not SQLite keywords or numeric literals.
 * Throws if an unrecognised column name is found.
 */
function validateFormulaColumns(formula: string, fieldNames: Set<string>, fieldName: string): void {
  // Known SQLite keywords / built-in function names that are safe to ignore
  const SQLITE_KEYWORDS = new Set([
    'abs',
    'avg',
    'case',
    'cast',
    'coalesce',
    'count',
    'else',
    'end',
    'ifnull',
    'iif',
    'julianday',
    'length',
    'lower',
    'max',
    'min',
    'not',
    'null',
    'nullif',
    'round',
    'rtrim',
    'strftime',
    'substr',
    'sum',
    'then',
    'total',
    'trim',
    'typeof',
    'upper',
    'when',
  ]);

  // Extract bare word tokens (skip quoted identifiers and string literals)
  const strippedFormula = formula
    .replace(/"[^"]*"/g, '') // remove double-quoted identifiers
    .replace(/'[^']*'/g, ''); // remove single-quoted string literals

  const wordTokens = strippedFormula.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];

  for (const token of wordTokens) {
    if (SQLITE_KEYWORDS.has(token.toLowerCase())) continue;
    if (/^\d+$/.test(token)) continue; // numeric token (shouldn't match \b[A-Za-z_] but guard anyway)
    if (!fieldNames.has(token)) {
      throw new Error(
        `Field "${fieldName}": formula references unknown column "${token}". Only columns defined in the same DocType are allowed.`,
      );
    }
  }
}

/**
 * Generates INSERT, UPDATE, and DELETE triggers on a child table that
 * recompute an aggregate field on the parent table.
 *
 * Follows the Odoo `@api.depends` cross-table cascade pattern adapted for
 * SQLite triggers (see IMPLEMENTATION-PLAN.md Part 5).
 *
 * @param parentTable  — fully-qualified parent table name (e.g. `dt_invoice`)
 * @param childTable   — fully-qualified child table name (e.g. `dt_invoice__items`)
 * @param aggregateField — column on the parent table to update (e.g. `subtotal`)
 * @param sourceField  — column on the child table to SUM (e.g. `amount`)
 * @returns array of three CREATE TRIGGER statements (insert, update, delete)
 */
export function buildRecomputeTriggers(
  parentTable: string,
  childTable: string,
  aggregateField: string,
  sourceField: string,
): string[] {
  const qParent = quoteIdentifier(parentTable);
  const qChild = quoteIdentifier(childTable);
  const qAgg = quoteIdentifier(aggregateField);
  const qSrc = quoteIdentifier(sourceField);

  // Derive a short suffix from table names for unique trigger naming
  const suffix = `${parentTable}__${aggregateField}`;

  const qParentId = quoteIdentifier('parent_id');
  const subquery = `(SELECT COALESCE(SUM(${qSrc}), 0) FROM ${qChild} WHERE ${qParentId} = {{ref}}.${qParentId})`;

  const insertTrigger = `CREATE TRIGGER IF NOT EXISTS "trg_${suffix}_insert"
AFTER INSERT ON ${qChild}
BEGIN
  UPDATE ${qParent} SET
    ${qAgg} = ${subquery.replace('{{ref}}', 'NEW')},
    "updated_at" = datetime('now')
  WHERE "id" = NEW."parent_id";
END;`;

  const updateTrigger = `CREATE TRIGGER IF NOT EXISTS "trg_${suffix}_update"
AFTER UPDATE OF ${qSrc} ON ${qChild}
BEGIN
  UPDATE ${qParent} SET
    ${qAgg} = ${subquery.replace('{{ref}}', 'NEW')},
    "updated_at" = datetime('now')
  WHERE "id" = NEW."parent_id";
END;`;

  const deleteTrigger = `CREATE TRIGGER IF NOT EXISTS "trg_${suffix}_delete"
AFTER DELETE ON ${qChild}
BEGIN
  UPDATE ${qParent} SET
    ${qAgg} = ${subquery.replace('{{ref}}', 'OLD')},
    "updated_at" = datetime('now')
  WHERE "id" = OLD."parent_id";
END;`;

  return [insertTrigger, updateTrigger, deleteTrigger];
}

/** Wraps a SQLite identifier in double-quotes, escaping any embedded double-quotes. */
function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Produces a safe SQLite literal for a default value given its target column type. */
function sqliteLiteral(value: string, sqliteType: string): string {
  if (sqliteType === 'INTEGER' || sqliteType === 'REAL') {
    // Allow bare numeric literals; fall back to quoted string if not numeric
    if (/^-?\d+(\.\d+)?$/.test(value)) {
      return value;
    }
  }
  // Escape single-quotes by doubling them
  return `'${value.replace(/'/g, "''")}'`;
}
