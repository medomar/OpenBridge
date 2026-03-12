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
