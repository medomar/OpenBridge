import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { FieldType, HookActionType, RelationType } from '../types/doctype.js';
import type { WorkflowTrigger, WorkflowStep, WorkflowStatus } from '../types/workflow.js';
import { createDocType, getDocTypeByName } from './doctype-store.js';
import { createWorkflowStore } from '../workflows/workflow-store.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('template-loader');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A field entry in a DocTypeDefinition. IDs are generated if absent. */
export interface FieldDef {
  id?: string;
  name: string;
  label: string;
  field_type: FieldType;
  required?: boolean;
  searchable?: boolean;
  sort_order?: number;
  default_value?: string;
  options?: string[];
  formula?: string;
  depends_on?: string;
  link_doctype?: string;
  child_doctype?: string;
}

/** A state entry in a DocTypeDefinition. IDs are generated if absent. */
export interface StateDef {
  id?: string;
  name: string;
  label: string;
  color?: string;
  is_initial?: boolean;
  is_terminal?: boolean;
  sort_order?: number;
}

/** A transition entry in a DocTypeDefinition. IDs are generated if absent. */
export interface TransitionDef {
  id?: string;
  from_state: string;
  to_state: string;
  action_name: string;
  action_label: string;
  allowed_roles?: string[];
  condition?: string;
}

/** A lifecycle hook entry in a DocTypeDefinition. IDs are generated if absent. */
export interface HookDef {
  id?: string;
  event: string;
  action_type: HookActionType;
  action_config?: Record<string, unknown>;
  sort_order?: number;
  enabled?: boolean;
}

/** A relation entry in a DocTypeDefinition. IDs are generated if absent. */
export interface RelationDef {
  id?: string;
  from_doctype: string;
  to_doctype: string;
  relation_type: RelationType;
  from_field: string;
  to_field?: string;
  label?: string;
}

/**
 * A DocType definition as stored in an industry template manifest.
 * All IDs are optional — they are generated on `applyTemplate` if absent.
 */
export interface DocTypeDefinition {
  doctype: {
    id?: string;
    name: string;
    label_singular: string;
    label_plural: string;
    icon?: string;
    table_name: string;
    source?: 'ai-created' | 'imported' | 'integration' | 'template';
  };
  fields?: FieldDef[];
  states?: StateDef[];
  transitions?: TransitionDef[];
  hooks?: HookDef[];
  relations?: RelationDef[];
}

/**
 * A Workflow definition as stored in an industry template manifest.
 * IDs are optional — they are generated on `applyTemplate` if absent.
 */
export interface WorkflowDefinition {
  id?: string;
  name: string;
  description?: string;
  trigger: WorkflowTrigger;
  steps: WorkflowStep[];
  status?: WorkflowStatus;
  run_count?: number;
  error_count?: number;
}

/**
 * An industry template — a bundle of DocTypes, Workflows, skill pack guidance,
 * and sample queries that can be applied to a workspace in one operation.
 */
export interface IndustryTemplate {
  id: string;
  name: string;
  description: string;
  doctypes: DocTypeDefinition[];
  workflows: WorkflowDefinition[];
  /**
   * Inline Markdown content for the skill pack, or a relative path (from the
   * template directory) to a `.md` file.  `loadTemplate` resolves file paths
   * to their contents automatically.
   */
  skillPack: string;
  sampleQueries: string[];
}

// ---------------------------------------------------------------------------
// loadTemplate
// ---------------------------------------------------------------------------

/**
 * Load an industry template from
 * `<workspacePath>/.openbridge/industry-templates/<templateId>/manifest.json`.
 *
 * If `skillPack` in the manifest is a file path ending in `.md` (no newlines),
 * the file is read and its contents replace the path in the returned object.
 *
 * @throws If the manifest file does not exist or cannot be parsed.
 */
export function loadTemplate(workspacePath: string, templateId: string): IndustryTemplate {
  const templateDir = join(workspacePath, '.openbridge', 'industry-templates', templateId);
  const manifestPath = join(templateDir, 'manifest.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`Template manifest not found: ${manifestPath}`);
  }

  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as IndustryTemplate;

  // Resolve a skillPack file reference to its contents
  if (parsed.skillPack && !parsed.skillPack.includes('\n') && parsed.skillPack.endsWith('.md')) {
    const skillPackPath = join(templateDir, parsed.skillPack);
    if (existsSync(skillPackPath)) {
      parsed.skillPack = readFileSync(skillPackPath, 'utf-8');
    }
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// applyTemplate
// ---------------------------------------------------------------------------

/** Derive a slug suitable for use as an ID component. */
function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Apply an industry template to a SQLite database — creates all DocTypes and
 * Workflows defined in the template.
 *
 * Already-existing records (matched by name) are skipped, making the
 * operation **idempotent**: safe to call multiple times.
 *
 * @param db        An open better-sqlite3 `Database` instance.
 * @param template  The template to apply (typically from `loadTemplate`).
 */
export function applyTemplate(db: Database.Database, template: IndustryTemplate): void {
  const workflowStore = createWorkflowStore(db);

  // --- Apply DocTypes ---
  for (const def of template.doctypes) {
    if (getDocTypeByName(db, def.doctype.name)) {
      logger.debug({ name: def.doctype.name }, 'DocType already exists — skipping');
      continue;
    }

    const doctypeId = def.doctype.id ?? `dt-${toSlug(def.doctype.name)}`;
    const now = new Date().toISOString();

    createDocType(db, {
      doctype: {
        id: doctypeId,
        name: def.doctype.name,
        label_singular: def.doctype.label_singular,
        label_plural: def.doctype.label_plural,
        icon: def.doctype.icon,
        table_name: def.doctype.table_name,
        source: def.doctype.source ?? 'template',
        template_id: template.id,
        created_at: now,
        updated_at: now,
      },
      fields: (def.fields ?? []).map((f, i) => ({
        id: f.id ?? `${doctypeId}-f${i}`,
        doctype_id: doctypeId,
        name: f.name,
        label: f.label,
        field_type: f.field_type,
        required: f.required ?? false,
        searchable: f.searchable ?? false,
        sort_order: f.sort_order ?? i,
        default_value: f.default_value,
        options: f.options,
        formula: f.formula,
        depends_on: f.depends_on,
        link_doctype: f.link_doctype,
        child_doctype: f.child_doctype,
      })),
      states: (def.states ?? []).map((s, i) => ({
        id: s.id ?? `${doctypeId}-s${i}`,
        doctype_id: doctypeId,
        name: s.name,
        label: s.label,
        color: s.color ?? 'gray',
        is_initial: s.is_initial ?? false,
        is_terminal: s.is_terminal ?? false,
        sort_order: s.sort_order ?? i,
      })),
      transitions: (def.transitions ?? []).map((t, i) => ({
        id: t.id ?? `${doctypeId}-t${i}`,
        doctype_id: doctypeId,
        from_state: t.from_state,
        to_state: t.to_state,
        action_name: t.action_name,
        action_label: t.action_label,
        allowed_roles: t.allowed_roles,
        condition: t.condition,
      })),
      hooks: (def.hooks ?? []).map((h, i) => ({
        id: h.id ?? `${doctypeId}-h${i}`,
        doctype_id: doctypeId,
        event: h.event,
        action_type: h.action_type,
        action_config: h.action_config ?? {},
        sort_order: h.sort_order ?? i,
        enabled: h.enabled ?? true,
      })),
      relations: (def.relations ?? []).map((r, i) => ({
        id: r.id ?? `${doctypeId}-r${i}`,
        from_doctype: r.from_doctype,
        to_doctype: r.to_doctype,
        relation_type: r.relation_type,
        from_field: r.from_field,
        to_field: r.to_field ?? 'id',
        label: r.label,
      })),
    });

    logger.info({ name: def.doctype.name, id: doctypeId }, 'Created DocType from template');
  }

  // --- Apply Workflows ---
  for (const def of template.workflows) {
    const workflowId = def.id ?? `wf-${toSlug(template.id)}-${toSlug(def.name)}`;
    const now = new Date().toISOString();

    try {
      workflowStore.createWorkflow({
        id: workflowId,
        name: def.name,
        description: def.description,
        trigger: def.trigger,
        steps: def.steps,
        status: def.status ?? 'active',
        run_count: def.run_count ?? 0,
        error_count: def.error_count ?? 0,
        created_at: now,
        updated_at: now,
      });
      logger.info({ name: def.name, id: workflowId }, 'Created Workflow from template');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE constraint') || msg.includes('already exists')) {
        logger.debug({ name: def.name }, 'Workflow already exists — skipping');
      } else {
        throw err;
      }
    }
  }
}
