import type Database from 'better-sqlite3';
import { ensureDocTypeStoreSchema, getDocType, listDocTypes } from './doctype-store.js';
import { getRelations, resolveLinkedRecords } from './relation-manager.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A business entity resolved from a DocType table row */
export interface BusinessEntity {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** A relation between two business entities */
export interface BusinessRelation {
  from: { id: string; type: string };
  to: { id: string; type: string };
  relation_type: string;
  label?: string;
}

/** A single hop in a relation path */
export interface RelationHop {
  entity: { id: string; type: string };
  relation_type: string;
  direction: 'outgoing' | 'incoming';
}

/** A path of relations between two entities */
export interface RelationPath {
  from: { id: string; type: string };
  to: { id: string; type: string };
  hops: RelationHop[];
  length: number;
}

/** Supported aggregate operations */
export type AggregateOp = 'sum' | 'avg' | 'count' | 'min' | 'max';

// ---------------------------------------------------------------------------
// queryEntities
// ---------------------------------------------------------------------------

/**
 * Query entities from a DocType table.
 *
 * @param db      - Open SQLite database handle.
 * @param type    - DocType name (e.g. "invoice", "customer").
 * @param filters - Optional field→value equality filters.
 * @returns Array of business entities matching the query.
 */
export function queryEntities(
  db: Database.Database,
  type: string,
  filters?: Record<string, unknown>,
): BusinessEntity[] {
  ensureDocTypeStoreSchema(db);

  const doctype = findDocTypeByName(db, type);
  if (!doctype) return [];

  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      whereClauses.push(`"${sanitizeIdentifier(key)}" = ?`);
      params.push(value);
    }
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const tableName = quoteIdentifier(doctype.table_name);

  const rows = db.prepare(`SELECT * FROM ${tableName} ${whereSQL}`).all(...params) as Record<
    string,
    unknown
  >[];

  return rows.map((row) => ({
    id: row['id'] as string,
    type,
    data: row,
  }));
}

// ---------------------------------------------------------------------------
// queryRelations
// ---------------------------------------------------------------------------

/**
 * Query all relations for a given entity.
 *
 * Finds the DocType that owns the entity, looks up all relations for that
 * DocType, and resolves the linked records.
 *
 * @param db       - Open SQLite database handle.
 * @param entityId - The record ID to find relations for.
 * @param type     - Optional DocType name hint (avoids scanning all tables).
 * @returns Array of business relations involving this entity.
 */
export function queryRelations(
  db: Database.Database,
  entityId: string,
  type?: string,
): BusinessRelation[] {
  ensureDocTypeStoreSchema(db);

  const ownerDoctype = type ? findDocTypeByName(db, type) : findDocTypeForRecord(db, entityId);
  if (!ownerDoctype) return [];

  const doctypeFull = getDocType(db, ownerDoctype.id);
  if (!doctypeFull) return [];

  const relations = getRelations(db, ownerDoctype.id, 'both');
  const result: BusinessRelation[] = [];

  for (const rel of relations) {
    const isSource = rel.from_doctype === ownerDoctype.id;

    if (isSource) {
      // Outgoing: resolve linked records on the "to" side
      const sourceRecord = db
        .prepare(`SELECT * FROM "${sanitizeIdentifier(ownerDoctype.table_name)}" WHERE id = ?`)
        .get(entityId) as Record<string, unknown> | undefined;

      const resolved = resolveLinkedRecords(db, rel, entityId, sourceRecord ?? undefined);
      for (const linkedRow of resolved.records) {
        const targetDoctype = findDocTypeById(db, rel.to_doctype);
        result.push({
          from: { id: entityId, type: ownerDoctype.name },
          to: { id: linkedRow.id, type: targetDoctype?.name ?? rel.to_doctype },
          relation_type: rel.relation_type,
          label: rel.label,
        });
      }
    } else {
      // Incoming: this entity is on the "to" side
      const sourceDoctype = findDocTypeById(db, rel.from_doctype);
      if (!sourceDoctype) continue;

      const sourceTable = quoteIdentifier(sourceDoctype.table_name);
      const sourceRows = db
        .prepare(`SELECT id FROM ${sourceTable} WHERE "${sanitizeIdentifier(rel.from_field)}" = ?`)
        .all(entityId) as Array<{ id: string }>;

      for (const sourceRow of sourceRows) {
        result.push({
          from: { id: sourceRow.id, type: sourceDoctype.name },
          to: { id: entityId, type: ownerDoctype.name },
          relation_type: rel.relation_type,
          label: rel.label,
        });
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// findPath
// ---------------------------------------------------------------------------

/**
 * Find relation paths between two entities via BFS graph traversal.
 *
 * @param db     - Open SQLite database handle.
 * @param fromId - Source entity ID.
 * @param toId   - Target entity ID.
 * @param maxDepth - Maximum traversal depth (default 4).
 * @returns Array of relation paths from source to target.
 */
export function findPath(
  db: Database.Database,
  fromId: string,
  toId: string,
  maxDepth = 4,
): RelationPath[] {
  ensureDocTypeStoreSchema(db);

  const fromDoctype = findDocTypeForRecord(db, fromId);
  const toDoctype = findDocTypeForRecord(db, toId);
  if (!fromDoctype || !toDoctype) return [];

  // BFS to find paths between entity types (DocType-level graph)
  // Then verify actual record-level connectivity
  const typePaths = bfsTypePaths(db, fromDoctype.id, toDoctype.id, maxDepth);
  const results: RelationPath[] = [];

  for (const typePath of typePaths) {
    // Verify record-level connectivity along this type path
    const recordPath = verifyRecordPath(db, fromId, toId, typePath);
    if (recordPath) {
      results.push(recordPath);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// aggregateMetrics
// ---------------------------------------------------------------------------

/**
 * Run an aggregate operation on a DocType field.
 *
 * @param db        - Open SQLite database handle.
 * @param doctype   - DocType name.
 * @param field     - Field name to aggregate.
 * @param operation - Aggregate operation (sum, avg, count, min, max).
 * @param filters   - Optional field→value equality filters.
 * @returns Numeric result, or 0 if the DocType or field doesn't exist.
 */
export function aggregateMetrics(
  db: Database.Database,
  doctype: string,
  field: string,
  operation: AggregateOp,
  filters?: Record<string, unknown>,
): number {
  ensureDocTypeStoreSchema(db);

  const dt = findDocTypeByName(db, doctype);
  if (!dt) return 0;

  const tableName = quoteIdentifier(dt.table_name);
  const safeField = quoteIdentifier(field);

  const aggFn = operation.toUpperCase();
  const validOps = ['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'];
  if (!validOps.includes(aggFn)) return 0;

  const aggExpr = operation === 'count' ? `COUNT(${safeField})` : `${aggFn}(${safeField})`;

  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      whereClauses.push(`"${sanitizeIdentifier(key)}" = ?`);
      params.push(value);
    }
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  try {
    const row = db
      .prepare(`SELECT ${aggExpr} AS result FROM ${tableName} ${whereSQL}`)
      .get(...params) as { result: number | null } | undefined;
    return row?.result ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Find a DocType metadata record by name (case-insensitive) */
function findDocTypeByName(
  db: Database.Database,
  name: string,
): { id: string; name: string; table_name: string } | null {
  const row = db
    .prepare('SELECT id, name, table_name FROM doctypes WHERE LOWER(name) = LOWER(?)')
    .get(name) as { id: string; name: string; table_name: string } | undefined;
  return row ?? null;
}

/** Find a DocType metadata record by ID */
function findDocTypeById(
  db: Database.Database,
  id: string,
): { id: string; name: string; table_name: string } | null {
  const row = db.prepare('SELECT id, name, table_name FROM doctypes WHERE id = ?').get(id) as
    | { id: string; name: string; table_name: string }
    | undefined;
  return row ?? null;
}

/** Find which DocType table contains a given record ID */
function findDocTypeForRecord(
  db: Database.Database,
  recordId: string,
): { id: string; name: string; table_name: string } | null {
  const allDocTypes = listDocTypes(db);

  for (const dt of allDocTypes) {
    try {
      const row = db
        .prepare(`SELECT id FROM "${sanitizeIdentifier(dt.table_name)}" WHERE id = ?`)
        .get(recordId) as { id: string } | undefined;
      if (row) {
        return { id: dt.id, name: dt.name, table_name: dt.table_name };
      }
    } catch {
      // Table may not exist yet — skip
    }
  }

  return null;
}

/** Sanitize a SQL identifier by removing embedded double-quotes */
function sanitizeIdentifier(name: string): string {
  return name.replace(/"/g, '');
}

/** Wrap a SQL identifier in double-quotes */
function quoteIdentifier(name: string): string {
  return `"${sanitizeIdentifier(name)}"`;
}

// ---------------------------------------------------------------------------
// BFS for type-level paths
// ---------------------------------------------------------------------------

interface TypeHop {
  fromDoctypeId: string;
  toDoctypeId: string;
  relation_type: string;
  from_field: string;
  to_field: string;
  direction: 'outgoing' | 'incoming';
}

/** BFS over DocType relations to find type-level paths */
function bfsTypePaths(
  db: Database.Database,
  fromDoctypeId: string,
  toDoctypeId: string,
  maxDepth: number,
): TypeHop[][] {
  if (fromDoctypeId === toDoctypeId) return [[]];

  // Queue entries: [current doctype ID, path so far]
  const queue: Array<[string, TypeHop[]]> = [[fromDoctypeId, []]];
  const visited = new Set<string>([fromDoctypeId]);
  const results: TypeHop[][] = [];

  while (queue.length > 0) {
    const [currentId, path] = queue.shift()!;

    if (path.length >= maxDepth) continue;

    const relations = getRelations(db, currentId, 'both');

    for (const rel of relations) {
      const isSource = rel.from_doctype === currentId;
      const neighborId = isSource ? rel.to_doctype : rel.from_doctype;

      const hop: TypeHop = {
        fromDoctypeId: isSource ? currentId : neighborId,
        toDoctypeId: isSource ? neighborId : currentId,
        relation_type: rel.relation_type,
        from_field: rel.from_field,
        to_field: rel.to_field,
        direction: isSource ? 'outgoing' : 'incoming',
      };

      const newPath = [...path, hop];

      if (neighborId === toDoctypeId) {
        results.push(newPath);
        continue;
      }

      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push([neighborId, newPath]);
      }
    }
  }

  return results;
}

/** Verify that a type-level path has actual record connectivity */
function verifyRecordPath(
  db: Database.Database,
  fromId: string,
  toId: string,
  typeHops: TypeHop[],
): RelationPath | null {
  if (typeHops.length === 0) {
    // Same DocType — from and to are in the same table
    const dt = findDocTypeForRecord(db, fromId);
    if (!dt) return null;
    return {
      from: { id: fromId, type: dt.name },
      to: { id: toId, type: dt.name },
      hops: [],
      length: 0,
    };
  }

  let currentIds = [fromId];
  const hops: RelationHop[] = [];

  for (const hop of typeHops) {
    const nextIds: string[] = [];
    const sourceDt = findDocTypeById(db, hop.fromDoctypeId);
    const targetDt = findDocTypeById(db, hop.toDoctypeId);
    if (!sourceDt || !targetDt) return null;

    if (hop.direction === 'outgoing') {
      // Follow from_field on source to to_field on target
      const targetTable = quoteIdentifier(targetDt.table_name);
      const sourceTable = quoteIdentifier(sourceDt.table_name);

      for (const cid of currentIds) {
        // Get source record's from_field value
        const sourceRow = db
          .prepare(
            `SELECT "${sanitizeIdentifier(hop.from_field)}" AS fk FROM ${sourceTable} WHERE id = ?`,
          )
          .get(cid) as { fk: unknown } | undefined;

        if (sourceRow?.fk != null) {
          const targetRows = db
            .prepare(
              `SELECT id FROM ${targetTable} WHERE "${sanitizeIdentifier(hop.to_field)}" = ?`,
            )
            .all(sourceRow.fk) as Array<{ id: string }>;
          nextIds.push(...targetRows.map((r) => r.id));
        }
      }
    } else {
      // Incoming: follow from source table where from_field points to current
      const sourceTable = quoteIdentifier(sourceDt.table_name);

      for (const cid of currentIds) {
        const rows = db
          .prepare(
            `SELECT id FROM ${sourceTable} WHERE "${sanitizeIdentifier(hop.from_field)}" = ?`,
          )
          .all(cid) as Array<{ id: string }>;
        nextIds.push(...rows.map((r) => r.id));
      }
    }

    if (nextIds.length === 0) return null;

    currentIds = nextIds;
    hops.push({
      entity: { id: nextIds[0]!, type: targetDt.name },
      relation_type: hop.relation_type,
      direction: hop.direction,
    });
  }

  // Check if toId is reachable
  if (!currentIds.includes(toId)) return null;

  const fromDt = findDocTypeForRecord(db, fromId);
  const toDt = findDocTypeForRecord(db, toId);
  if (!fromDt || !toDt) return null;

  return {
    from: { id: fromId, type: fromDt.name },
    to: { id: toId, type: toDt.name },
    hops,
    length: hops.length,
  };
}
