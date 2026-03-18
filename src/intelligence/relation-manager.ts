import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { DocTypeRelation } from '../types/doctype.js';
import { ensureDocTypeStoreSchema } from './doctype-store.js';

// ---------------------------------------------------------------------------
// Row type
// ---------------------------------------------------------------------------

interface DocTypeRelationRow {
  id: string;
  from_doctype: string;
  to_doctype: string;
  relation_type: string;
  from_field: string;
  to_field: string;
  label: string | null;
}

function rowToRelation(row: DocTypeRelationRow): DocTypeRelation {
  return {
    id: row.id,
    from_doctype: row.from_doctype,
    to_doctype: row.to_doctype,
    relation_type: row.relation_type as DocTypeRelation['relation_type'],
    from_field: row.from_field,
    to_field: row.to_field,
    label: row.label ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** A linked record fetched from a target DocType table */
export interface LinkedRecord {
  id: string;
  [key: string]: unknown;
}

/** Result of resolving linked records for a given relation */
export interface ResolvedRelation {
  relation: DocTypeRelation;
  records: LinkedRecord[];
}

// ---------------------------------------------------------------------------
// createRelation
// ---------------------------------------------------------------------------

/**
 * Persist a new inter-DocType relation to the `doctype_relations` table.
 * Returns the generated relation ID.
 */
export function createRelation(
  db: Database.Database,
  input: Omit<DocTypeRelation, 'id'> & { id?: string },
): string {
  ensureDocTypeStoreSchema(db);

  const id = input.id ?? randomUUID();

  db.prepare(
    `
    INSERT INTO doctype_relations (id, from_doctype, to_doctype, relation_type, from_field, to_field, label)
    VALUES (@id, @from_doctype, @to_doctype, @relation_type, @from_field, @to_field, @label)
  `,
  ).run({
    id,
    from_doctype: input['from_doctype'],
    to_doctype: input['to_doctype'],
    relation_type: input['relation_type'],
    from_field: input['from_field'],
    to_field: input['to_field'] ?? 'id',
    label: input['label'] ?? null,
  });

  return id;
}

// ---------------------------------------------------------------------------
// getRelations
// ---------------------------------------------------------------------------

/**
 * Retrieve all relations for a given DocType (either as source or target).
 *
 * @param doctypeId - The `doctypes.id` to look up.
 * @param direction - `'from'` returns relations where this DocType is the owner
 *                    (has_many / belongs_to from this side).
 *                    `'to'` returns relations where this DocType is the target.
 *                    `'both'` (default) returns all.
 */
export function getRelations(
  db: Database.Database,
  doctypeId: string,
  direction: 'from' | 'to' | 'both' = 'both',
): DocTypeRelation[] {
  ensureDocTypeStoreSchema(db);

  let rows: DocTypeRelationRow[];

  if (direction === 'from') {
    rows = db
      .prepare('SELECT * FROM doctype_relations WHERE from_doctype = ?')
      .all(doctypeId) as DocTypeRelationRow[];
  } else if (direction === 'to') {
    rows = db
      .prepare('SELECT * FROM doctype_relations WHERE to_doctype = ?')
      .all(doctypeId) as DocTypeRelationRow[];
  } else {
    rows = db
      .prepare('SELECT * FROM doctype_relations WHERE from_doctype = ? OR to_doctype = ?')
      .all(doctypeId, doctypeId) as DocTypeRelationRow[];
  }

  return rows.map(rowToRelation);
}

// ---------------------------------------------------------------------------
// resolveLinkedRecords
// ---------------------------------------------------------------------------

/**
 * Resolve the linked records for a `link` field or explicit relation.
 *
 * For `has_many`: fetches rows from `dt_{to_doctype}` where `from_field`
 *   (on the child table) equals `sourceRecordId`.
 *
 * For `belongs_to`: fetches the single row from `dt_{to_doctype}` whose
 *   `to_field` matches the value stored in `from_field` of `sourceRecord`.
 *
 * For `many_to_many`: fetches rows via a join table named
 *   `dt_{from_doctype}___{to_doctype}` (three underscores, alphabetical order).
 *   The join table must have `from_id` and `to_id` columns.
 *
 * @param db             - Open SQLite database handle.
 * @param relation       - Relation metadata.
 * @param sourceRecordId - ID of the record on the `from_doctype` side.
 * @param sourceRecord   - Full record object (needed for `belongs_to` look-up).
 * @returns Resolved linked records from the target table.
 */
export function resolveLinkedRecords(
  db: Database.Database,
  relation: DocTypeRelation,
  sourceRecordId: string,
  sourceRecord?: Record<string, unknown>,
): ResolvedRelation {
  const toTable = `dt_${relation.to_doctype}`;

  let records: LinkedRecord[] = [];

  switch (relation.relation_type) {
    case 'has_many': {
      // Child rows that point back to the parent via from_field
      records = db
        .prepare(`SELECT * FROM "${toTable}" WHERE "${relation.from_field}" = ?`)
        .all(sourceRecordId) as LinkedRecord[];
      break;
    }

    case 'belongs_to': {
      // The foreign-key value lives on the source record
      const fkValue = sourceRecord
        ? (sourceRecord[relation.from_field] as string | undefined)
        : sourceRecordId;

      if (fkValue == null) {
        records = [];
      } else {
        const row = db
          .prepare(`SELECT * FROM "${toTable}" WHERE "${relation.to_field}" = ?`)
          .get(fkValue) as LinkedRecord | undefined;
        records = row ? [row] : [];
      }
      break;
    }

    case 'many_to_many': {
      // Derive join table name (sorted alphabetically for determinism)
      const parts = [relation.from_doctype, relation.to_doctype].sort();
      const joinTable = `dt_${parts[0]}___${parts[1]}`;

      records = db
        .prepare(
          `SELECT t.* FROM "${toTable}" t
           INNER JOIN "${joinTable}" j ON j.to_id = t."${relation.to_field}"
           WHERE j.from_id = ?`,
        )
        .all(sourceRecordId) as LinkedRecord[];
      break;
    }
  }

  return { relation, records };
}

// ---------------------------------------------------------------------------
// deleteRelation
// ---------------------------------------------------------------------------

/**
 * Remove a relation by its ID.
 * Returns true if a row was deleted.
 */
export function deleteRelation(db: Database.Database, relationId: string): boolean {
  ensureDocTypeStoreSchema(db);
  const result = db.prepare('DELETE FROM doctype_relations WHERE id = ?').run(relationId);
  return result.changes > 0;
}
