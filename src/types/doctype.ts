import { z } from 'zod/v3';

/** Supported field types for DocType fields */
export const FieldTypeEnum = z.enum([
  'text',
  'number',
  'currency',
  'date',
  'datetime',
  'select',
  'multiselect',
  'link',
  'table',
  'longtext',
  'image',
  'checkbox',
  'email',
  'phone',
  'url',
]);

export type FieldType = z.infer<typeof FieldTypeEnum>;

/** A single field definition within a DocType */
export const DocTypeFieldSchema = z
  .object({
    id: z.string(),
    doctype_id: z.string(),
    name: z.string().min(1),
    label: z.string().min(1),
    field_type: FieldTypeEnum,
    required: z.boolean().default(false),
    default_value: z.string().optional(),
    options: z.array(z.string()).optional(),
    formula: z.string().optional(),
    depends_on: z.string().optional(),
    searchable: z.boolean().default(false),
    sort_order: z.number().int().nonnegative(),
    link_doctype: z.string().optional(),
    child_doctype: z.string().optional(),
  })
  .passthrough();

export type DocTypeField = z.infer<typeof DocTypeFieldSchema>;

/** A state in the DocType state machine */
export const DocTypeStateSchema = z
  .object({
    id: z.string(),
    doctype_id: z.string(),
    name: z.string().min(1),
    label: z.string().min(1),
    color: z.string().default('gray'),
    is_initial: z.boolean().default(false),
    is_terminal: z.boolean().default(false),
    sort_order: z.number().int().nonnegative(),
  })
  .passthrough();

export type DocTypeState = z.infer<typeof DocTypeStateSchema>;

/** A transition between two states in the state machine */
export const DocTypeTransitionSchema = z
  .object({
    id: z.string(),
    doctype_id: z.string(),
    from_state: z.string().min(1),
    to_state: z.string().min(1),
    action_name: z.string().min(1),
    action_label: z.string().min(1),
    allowed_roles: z.array(z.string()).optional(),
    condition: z.string().optional(),
  })
  .passthrough();

export type DocTypeTransition = z.infer<typeof DocTypeTransitionSchema>;

/** Action types supported by lifecycle hooks */
export const HookActionTypeEnum = z.enum([
  'generate_number',
  'generate_pdf',
  'send_notification',
  'create_payment_link',
  'update_field',
  'run_workflow',
  'call_integration',
  'spawn_worker',
]);

export type HookActionType = z.infer<typeof HookActionTypeEnum>;

/** A lifecycle hook attached to a DocType event */
export const DocTypeHookSchema = z
  .object({
    id: z.string(),
    doctype_id: z.string(),
    event: z.string().min(1),
    action_type: HookActionTypeEnum,
    action_config: z.record(z.unknown()),
    sort_order: z.number().int().nonnegative().default(0),
    enabled: z.boolean().default(true),
  })
  .passthrough();

export type DocTypeHook = z.infer<typeof DocTypeHookSchema>;

/** Relation types between DocTypes */
export const RelationTypeEnum = z.enum(['has_many', 'belongs_to', 'many_to_many']);

export type RelationType = z.infer<typeof RelationTypeEnum>;

/** A relation between two DocTypes */
export const DocTypeRelationSchema = z
  .object({
    id: z.string(),
    from_doctype: z.string().min(1),
    to_doctype: z.string().min(1),
    relation_type: RelationTypeEnum,
    from_field: z.string().min(1),
    to_field: z.string().default('id'),
    label: z.string().optional(),
  })
  .passthrough();

export type DocTypeRelation = z.infer<typeof DocTypeRelationSchema>;

/** Naming series entry for auto-numbering */
export const NamingSeriesSchema = z
  .object({
    prefix: z.string().min(1),
    current_value: z.number().int().nonnegative().default(0),
  })
  .passthrough();

export type NamingSeries = z.infer<typeof NamingSeriesSchema>;

/** Source of the DocType definition */
export const DocTypeSourceEnum = z.enum(['ai-created', 'imported', 'integration', 'template']);

export type DocTypeSource = z.infer<typeof DocTypeSourceEnum>;

/** Top-level DocType definition */
export const DocTypeSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    label_singular: z.string().min(1),
    label_plural: z.string().min(1),
    icon: z.string().optional(),
    table_name: z.string().min(1),
    source: DocTypeSourceEnum,
    template_id: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
  })
  .passthrough();

export type DocType = z.infer<typeof DocTypeSchema>;
