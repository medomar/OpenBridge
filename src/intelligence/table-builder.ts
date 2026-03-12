import type { DocType, DocTypeField, FieldType } from '../types/doctype.js';

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
    const notNull = field.required ? ' NOT NULL' : '';
    const defaultClause =
      field.default_value != null
        ? ` DEFAULT ${sqliteLiteral(field.default_value, sqliteType)}`
        : '';
    columnDefs.push(`${quoteIdentifier(field.name)} ${sqliteType}${notNull}${defaultClause}`);
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
    const notNull = field.required ? ' NOT NULL' : '';
    const defaultClause =
      field.default_value != null
        ? ` DEFAULT ${sqliteLiteral(field.default_value, sqliteType)}`
        : '';
    columnDefs.push(`${quoteIdentifier(field.name)} ${sqliteType}${notNull}${defaultClause}`);
  }

  columnDefs.push('UNIQUE(parent_id, idx)');

  return `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(childTable)} (\n  ${columnDefs.join(',\n  ')}\n);`;
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
