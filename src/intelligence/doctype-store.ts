import type Database from 'better-sqlite3';
import type {
  DocType,
  DocTypeField,
  DocTypeState,
  DocTypeTransition,
  DocTypeHook,
  DocTypeRelation,
} from '../types/doctype.js';

// ---------------------------------------------------------------------------
// Update type (avoids index-signature issues from Partial<DocType>)
// ---------------------------------------------------------------------------

export interface DocTypeUpdate {
  id: string;
  name?: string;
  label_singular?: string;
  label_plural?: string;
  icon?: string | null;
  table_name?: string;
  source?: string;
  template_id?: string | null;
}

// ---------------------------------------------------------------------------
// Row types (SQLite representation — JSON columns stored as TEXT)
// ---------------------------------------------------------------------------

interface DocTypeRow {
  id: string;
  name: string;
  label_singular: string;
  label_plural: string;
  icon: string | null;
  table_name: string;
  source: string;
  template_id: string | null;
  created_at: string;
  updated_at: string;
}

interface DocTypeFieldRow {
  id: string;
  doctype_id: string;
  name: string;
  label: string;
  field_type: string;
  required: number;
  default_value: string | null;
  options: string | null;
  formula: string | null;
  depends_on: string | null;
  searchable: number;
  sort_order: number;
  link_doctype: string | null;
  child_doctype: string | null;
}

interface DocTypeStateRow {
  id: string;
  doctype_id: string;
  name: string;
  label: string;
  color: string;
  is_initial: number;
  is_terminal: number;
  sort_order: number;
}

interface DocTypeTransitionRow {
  id: string;
  doctype_id: string;
  from_state: string;
  to_state: string;
  action_name: string;
  action_label: string;
  allowed_roles: string | null;
  condition: string | null;
}

interface DocTypeHookRow {
  id: string;
  doctype_id: string;
  event: string;
  action_type: string;
  action_config: string;
  sort_order: number;
  enabled: number;
}

interface DocTypeRelationRow {
  id: string;
  from_doctype: string;
  to_doctype: string;
  relation_type: string;
  from_field: string;
  to_field: string;
  label: string | null;
}

// ---------------------------------------------------------------------------
// Row → domain converters
// ---------------------------------------------------------------------------

function rowToDocType(row: DocTypeRow): DocType {
  return {
    id: row.id,
    name: row.name,
    label_singular: row.label_singular,
    label_plural: row.label_plural,
    icon: row.icon ?? undefined,
    table_name: row.table_name,
    source: row.source as DocType['source'],
    template_id: row.template_id ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToField(row: DocTypeFieldRow): DocTypeField {
  return {
    id: row.id,
    doctype_id: row.doctype_id,
    name: row.name,
    label: row.label,
    field_type: row.field_type as DocTypeField['field_type'],
    required: row.required === 1,
    default_value: row.default_value ?? undefined,
    options: row.options ? (JSON.parse(row.options) as string[]) : undefined,
    formula: row.formula ?? undefined,
    depends_on: row.depends_on ?? undefined,
    searchable: row.searchable === 1,
    sort_order: row.sort_order,
    link_doctype: row.link_doctype ?? undefined,
    child_doctype: row.child_doctype ?? undefined,
  };
}

function rowToState(row: DocTypeStateRow): DocTypeState {
  return {
    id: row.id,
    doctype_id: row.doctype_id,
    name: row.name,
    label: row.label,
    color: row.color,
    is_initial: row.is_initial === 1,
    is_terminal: row.is_terminal === 1,
    sort_order: row.sort_order,
  };
}

function rowToTransition(row: DocTypeTransitionRow): DocTypeTransition {
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

function rowToHook(row: DocTypeHookRow): DocTypeHook {
  return {
    id: row.id,
    doctype_id: row.doctype_id,
    event: row.event,
    action_type: row.action_type as DocTypeHook['action_type'],
    action_config: JSON.parse(row.action_config) as Record<string, unknown>,
    sort_order: row.sort_order,
    enabled: row.enabled === 1,
  };
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
// Schema creation
// ---------------------------------------------------------------------------

/**
 * Ensure all DocType metadata tables exist.
 * Safe to call multiple times (uses CREATE TABLE IF NOT EXISTS).
 */
export function ensureDocTypeStoreSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS doctypes (
      id              TEXT PRIMARY KEY,
      name            TEXT NOT NULL UNIQUE,
      label_singular  TEXT NOT NULL,
      label_plural    TEXT NOT NULL,
      icon            TEXT,
      table_name      TEXT NOT NULL UNIQUE,
      source          TEXT NOT NULL,
      template_id     TEXT,
      created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS doctype_fields (
      id              TEXT PRIMARY KEY,
      doctype_id      TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      label           TEXT NOT NULL,
      field_type      TEXT NOT NULL,
      required        INTEGER DEFAULT 0,
      default_value   TEXT,
      options         TEXT,
      formula         TEXT,
      depends_on      TEXT,
      searchable      INTEGER DEFAULT 0,
      sort_order      INTEGER NOT NULL,
      link_doctype    TEXT,
      child_doctype   TEXT,
      UNIQUE(doctype_id, name)
    );

    CREATE TABLE IF NOT EXISTS doctype_states (
      id              TEXT PRIMARY KEY,
      doctype_id      TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      label           TEXT NOT NULL,
      color           TEXT DEFAULT 'gray',
      is_initial      INTEGER DEFAULT 0,
      is_terminal     INTEGER DEFAULT 0,
      sort_order      INTEGER NOT NULL,
      UNIQUE(doctype_id, name)
    );

    CREATE TABLE IF NOT EXISTS doctype_transitions (
      id              TEXT PRIMARY KEY,
      doctype_id      TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
      from_state      TEXT NOT NULL,
      to_state        TEXT NOT NULL,
      action_name     TEXT NOT NULL,
      action_label    TEXT NOT NULL,
      allowed_roles   TEXT,
      condition       TEXT,
      UNIQUE(doctype_id, from_state, action_name)
    );

    CREATE TABLE IF NOT EXISTS doctype_hooks (
      id              TEXT PRIMARY KEY,
      doctype_id      TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
      event           TEXT NOT NULL,
      action_type     TEXT NOT NULL,
      action_config   TEXT NOT NULL,
      sort_order      INTEGER DEFAULT 0,
      enabled         INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS doctype_relations (
      id              TEXT PRIMARY KEY,
      from_doctype    TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
      to_doctype      TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
      relation_type   TEXT NOT NULL,
      from_field      TEXT NOT NULL,
      to_field        TEXT DEFAULT 'id',
      label           TEXT
    );

    CREATE TABLE IF NOT EXISTS dt_series (
      prefix          TEXT PRIMARY KEY,
      current_value   INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_doctype_fields_doctype
      ON doctype_fields(doctype_id);
    CREATE INDEX IF NOT EXISTS idx_doctype_states_doctype
      ON doctype_states(doctype_id);
    CREATE INDEX IF NOT EXISTS idx_doctype_transitions_doctype
      ON doctype_transitions(doctype_id);
  `);
}

// ---------------------------------------------------------------------------
// Full DocType with all child records
// ---------------------------------------------------------------------------

export interface FullDocType {
  doctype: DocType;
  fields: DocTypeField[];
  states: DocTypeState[];
  transitions: DocTypeTransition[];
  hooks: DocTypeHook[];
  relations: DocTypeRelation[];
}

// ---------------------------------------------------------------------------
// CRUD — Create
// ---------------------------------------------------------------------------

/**
 * Create a DocType and its associated fields, states, transitions, hooks,
 * and relations in a single transaction.
 */
export function createDocType(
  db: Database.Database,
  data: {
    doctype: DocType;
    fields?: DocTypeField[];
    states?: DocTypeState[];
    transitions?: DocTypeTransition[];
    hooks?: DocTypeHook[];
    relations?: DocTypeRelation[];
  },
): string {
  ensureDocTypeStoreSchema(db);

  const insertDocType = db.prepare(`
    INSERT INTO doctypes
      (id, name, label_singular, label_plural, icon, table_name, source, template_id, created_at, updated_at)
    VALUES
      (@id, @name, @label_singular, @label_plural, @icon, @table_name, @source, @template_id, @created_at, @updated_at)
  `);

  const insertField = db.prepare(`
    INSERT INTO doctype_fields
      (id, doctype_id, name, label, field_type, required, default_value, options, formula, depends_on, searchable, sort_order, link_doctype, child_doctype)
    VALUES
      (@id, @doctype_id, @name, @label, @field_type, @required, @default_value, @options, @formula, @depends_on, @searchable, @sort_order, @link_doctype, @child_doctype)
  `);

  const insertState = db.prepare(`
    INSERT INTO doctype_states
      (id, doctype_id, name, label, color, is_initial, is_terminal, sort_order)
    VALUES
      (@id, @doctype_id, @name, @label, @color, @is_initial, @is_terminal, @sort_order)
  `);

  const insertTransition = db.prepare(`
    INSERT INTO doctype_transitions
      (id, doctype_id, from_state, to_state, action_name, action_label, allowed_roles, condition)
    VALUES
      (@id, @doctype_id, @from_state, @to_state, @action_name, @action_label, @allowed_roles, @condition)
  `);

  const insertHook = db.prepare(`
    INSERT INTO doctype_hooks
      (id, doctype_id, event, action_type, action_config, sort_order, enabled)
    VALUES
      (@id, @doctype_id, @event, @action_type, @action_config, @sort_order, @enabled)
  `);

  const insertRelation = db.prepare(`
    INSERT INTO doctype_relations
      (id, from_doctype, to_doctype, relation_type, from_field, to_field, label)
    VALUES
      (@id, @from_doctype, @to_doctype, @relation_type, @from_field, @to_field, @label)
  `);

  const now = new Date().toISOString();
  const dt = data.doctype;

  db.transaction(() => {
    insertDocType.run({
      id: dt.id,
      name: dt.name,
      label_singular: dt.label_singular,
      label_plural: dt.label_plural,
      icon: dt.icon ?? null,
      table_name: dt.table_name,
      source: dt.source,
      template_id: dt.template_id ?? null,
      created_at: dt.created_at ?? now,
      updated_at: dt.updated_at ?? now,
    });

    for (const f of data.fields ?? []) {
      insertField.run({
        id: f.id,
        doctype_id: f.doctype_id,
        name: f.name,
        label: f.label,
        field_type: f.field_type,
        required: f.required ? 1 : 0,
        default_value: f.default_value ?? null,
        options: f.options ? JSON.stringify(f.options) : null,
        formula: f.formula ?? null,
        depends_on: f.depends_on ?? null,
        searchable: f.searchable ? 1 : 0,
        sort_order: f.sort_order,
        link_doctype: f.link_doctype ?? null,
        child_doctype: f.child_doctype ?? null,
      });
    }

    for (const s of data.states ?? []) {
      insertState.run({
        id: s.id,
        doctype_id: s.doctype_id,
        name: s.name,
        label: s.label,
        color: s.color ?? 'gray',
        is_initial: s.is_initial ? 1 : 0,
        is_terminal: s.is_terminal ? 1 : 0,
        sort_order: s.sort_order,
      });
    }

    for (const t of data.transitions ?? []) {
      insertTransition.run({
        id: t.id,
        doctype_id: t.doctype_id,
        from_state: t.from_state,
        to_state: t.to_state,
        action_name: t.action_name,
        action_label: t.action_label,
        allowed_roles: t.allowed_roles ? JSON.stringify(t.allowed_roles) : null,
        condition: t.condition ?? null,
      });
    }

    for (const h of data.hooks ?? []) {
      insertHook.run({
        id: h.id,
        doctype_id: h.doctype_id,
        event: h.event,
        action_type: h.action_type,
        action_config: JSON.stringify(h.action_config),
        sort_order: h.sort_order ?? 0,
        enabled: h.enabled !== false ? 1 : 0,
      });
    }

    for (const r of data.relations ?? []) {
      insertRelation.run({
        id: r.id,
        from_doctype: r.from_doctype,
        to_doctype: r.to_doctype,
        relation_type: r.relation_type,
        from_field: r.from_field,
        to_field: r.to_field ?? 'id',
        label: r.label ?? null,
      });
    }
  })();

  return dt.id;
}

// ---------------------------------------------------------------------------
// CRUD — Read
// ---------------------------------------------------------------------------

/**
 * Retrieve a DocType by ID with all associated child records.
 */
export function getDocType(db: Database.Database, doctypeId: string): FullDocType | null {
  ensureDocTypeStoreSchema(db);

  const row = db.prepare('SELECT * FROM doctypes WHERE id = ?').get(doctypeId) as
    | DocTypeRow
    | undefined;
  if (!row) return null;

  return loadFullDocType(db, row);
}

/**
 * Retrieve a DocType by its unique name with all associated child records.
 */
export function getDocTypeByName(db: Database.Database, name: string): FullDocType | null {
  ensureDocTypeStoreSchema(db);

  const row = db.prepare('SELECT * FROM doctypes WHERE name = ?').get(name) as
    | DocTypeRow
    | undefined;
  if (!row) return null;

  return loadFullDocType(db, row);
}

/**
 * List all DocTypes. Returns only the top-level metadata (no child records).
 */
export function listDocTypes(db: Database.Database): DocType[] {
  ensureDocTypeStoreSchema(db);

  const rows = db.prepare('SELECT * FROM doctypes ORDER BY name').all() as DocTypeRow[];

  return rows.map(rowToDocType);
}

// ---------------------------------------------------------------------------
// CRUD — Update
// ---------------------------------------------------------------------------

/**
 * Update an existing DocType and optionally replace its child records.
 * Only the provided child arrays are replaced; omitted arrays are left unchanged.
 */
export function updateDocType(
  db: Database.Database,
  data: {
    doctype: DocTypeUpdate;
    fields?: DocTypeField[];
    states?: DocTypeState[];
    transitions?: DocTypeTransition[];
    hooks?: DocTypeHook[];
    relations?: DocTypeRelation[];
  },
): boolean {
  ensureDocTypeStoreSchema(db);

  const existing = db.prepare('SELECT id FROM doctypes WHERE id = ?').get(data.doctype.id) as
    | { id: string }
    | undefined;
  if (!existing) return false;

  const now = new Date().toISOString();

  db.transaction(() => {
    const dt = data.doctype;
    const setClauses: string[] = ['updated_at = @updated_at'];
    const params: Record<string, unknown> = { id: dt.id, updated_at: now };

    const updatableFields: Array<[keyof DocTypeUpdate, string]> = [
      ['name', 'name'],
      ['label_singular', 'label_singular'],
      ['label_plural', 'label_plural'],
      ['icon', 'icon'],
      ['table_name', 'table_name'],
      ['source', 'source'],
      ['template_id', 'template_id'],
    ];

    for (const [key, col] of updatableFields) {
      if (dt[key] !== undefined) {
        setClauses.push(`${col} = @${col}`);
        params[col] = dt[key] ?? null;
      }
    }

    db.prepare(`UPDATE doctypes SET ${setClauses.join(', ')} WHERE id = @id`).run(params);

    // Replace child collections if provided
    if (data.fields) {
      db.prepare('DELETE FROM doctype_fields WHERE doctype_id = ?').run(dt.id);
      const insertField = db.prepare(`
        INSERT INTO doctype_fields
          (id, doctype_id, name, label, field_type, required, default_value, options, formula, depends_on, searchable, sort_order, link_doctype, child_doctype)
        VALUES
          (@id, @doctype_id, @name, @label, @field_type, @required, @default_value, @options, @formula, @depends_on, @searchable, @sort_order, @link_doctype, @child_doctype)
      `);
      for (const f of data.fields) {
        insertField.run({
          id: f.id,
          doctype_id: f.doctype_id,
          name: f.name,
          label: f.label,
          field_type: f.field_type,
          required: f.required ? 1 : 0,
          default_value: f.default_value ?? null,
          options: f.options ? JSON.stringify(f.options) : null,
          formula: f.formula ?? null,
          depends_on: f.depends_on ?? null,
          searchable: f.searchable ? 1 : 0,
          sort_order: f.sort_order,
          link_doctype: f.link_doctype ?? null,
          child_doctype: f.child_doctype ?? null,
        });
      }
    }

    if (data.states) {
      db.prepare('DELETE FROM doctype_states WHERE doctype_id = ?').run(dt.id);
      const insertState = db.prepare(`
        INSERT INTO doctype_states
          (id, doctype_id, name, label, color, is_initial, is_terminal, sort_order)
        VALUES
          (@id, @doctype_id, @name, @label, @color, @is_initial, @is_terminal, @sort_order)
      `);
      for (const s of data.states) {
        insertState.run({
          id: s.id,
          doctype_id: s.doctype_id,
          name: s.name,
          label: s.label,
          color: s.color ?? 'gray',
          is_initial: s.is_initial ? 1 : 0,
          is_terminal: s.is_terminal ? 1 : 0,
          sort_order: s.sort_order,
        });
      }
    }

    if (data.transitions) {
      db.prepare('DELETE FROM doctype_transitions WHERE doctype_id = ?').run(dt.id);
      const insertTransition = db.prepare(`
        INSERT INTO doctype_transitions
          (id, doctype_id, from_state, to_state, action_name, action_label, allowed_roles, condition)
        VALUES
          (@id, @doctype_id, @from_state, @to_state, @action_name, @action_label, @allowed_roles, @condition)
      `);
      for (const t of data.transitions) {
        insertTransition.run({
          id: t.id,
          doctype_id: t.doctype_id,
          from_state: t.from_state,
          to_state: t.to_state,
          action_name: t.action_name,
          action_label: t.action_label,
          allowed_roles: t.allowed_roles ? JSON.stringify(t.allowed_roles) : null,
          condition: t.condition ?? null,
        });
      }
    }

    if (data.hooks) {
      db.prepare('DELETE FROM doctype_hooks WHERE doctype_id = ?').run(dt.id);
      const insertHook = db.prepare(`
        INSERT INTO doctype_hooks
          (id, doctype_id, event, action_type, action_config, sort_order, enabled)
        VALUES
          (@id, @doctype_id, @event, @action_type, @action_config, @sort_order, @enabled)
      `);
      for (const h of data.hooks) {
        insertHook.run({
          id: h.id,
          doctype_id: h.doctype_id,
          event: h.event,
          action_type: h.action_type,
          action_config: JSON.stringify(h.action_config),
          sort_order: h.sort_order ?? 0,
          enabled: h.enabled !== false ? 1 : 0,
        });
      }
    }

    if (data.relations) {
      db.prepare('DELETE FROM doctype_relations WHERE from_doctype = ?').run(dt.id);
      const insertRelation = db.prepare(`
        INSERT INTO doctype_relations
          (id, from_doctype, to_doctype, relation_type, from_field, to_field, label)
        VALUES
          (@id, @from_doctype, @to_doctype, @relation_type, @from_field, @to_field, @label)
      `);
      for (const r of data.relations) {
        insertRelation.run({
          id: r.id,
          from_doctype: r.from_doctype,
          to_doctype: r.to_doctype,
          relation_type: r.relation_type,
          from_field: r.from_field,
          to_field: r.to_field ?? 'id',
          label: r.label ?? null,
        });
      }
    }
  })();

  return true;
}

// ---------------------------------------------------------------------------
// CRUD — Delete
// ---------------------------------------------------------------------------

/**
 * Delete a DocType and all associated child records (cascades via FK).
 * Returns true if the DocType existed and was deleted.
 */
export function deleteDocType(db: Database.Database, doctypeId: string): boolean {
  ensureDocTypeStoreSchema(db);

  // Ensure FK cascades are honoured in this connection
  db.pragma('foreign_keys = ON');

  const result = db.prepare('DELETE FROM doctypes WHERE id = ?').run(doctypeId);
  return result.changes > 0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function loadFullDocType(db: Database.Database, row: DocTypeRow): FullDocType {
  const doctypeId = row.id;

  const fields = (
    db
      .prepare('SELECT * FROM doctype_fields WHERE doctype_id = ? ORDER BY sort_order')
      .all(doctypeId) as DocTypeFieldRow[]
  ).map(rowToField);

  const states = (
    db
      .prepare('SELECT * FROM doctype_states WHERE doctype_id = ? ORDER BY sort_order')
      .all(doctypeId) as DocTypeStateRow[]
  ).map(rowToState);

  const transitions = (
    db
      .prepare('SELECT * FROM doctype_transitions WHERE doctype_id = ?')
      .all(doctypeId) as DocTypeTransitionRow[]
  ).map(rowToTransition);

  const hooks = (
    db
      .prepare('SELECT * FROM doctype_hooks WHERE doctype_id = ? ORDER BY sort_order')
      .all(doctypeId) as DocTypeHookRow[]
  ).map(rowToHook);

  const relations = (
    db
      .prepare('SELECT * FROM doctype_relations WHERE from_doctype = ?')
      .all(doctypeId) as DocTypeRelationRow[]
  ).map(rowToRelation);

  return {
    doctype: rowToDocType(row),
    fields,
    states,
    transitions,
    hooks,
    relations,
  };
}
