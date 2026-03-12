import { z } from 'zod';

/** Trigger types for workflow execution */
export const WorkflowTriggerTypeEnum = z.enum([
  'schedule',
  'webhook',
  'data',
  'message',
  'integration',
]);

export type WorkflowTriggerType = z.infer<typeof WorkflowTriggerTypeEnum>;

/** Workflow trigger configuration */
export const WorkflowTriggerSchema = z
  .object({
    type: WorkflowTriggerTypeEnum,
    /** For schedule triggers: cron expression (e.g. "0 9 * * *") */
    cron: z.string().optional(),
    /** For schedule triggers: timezone (e.g. "America/New_York") */
    timezone: z.string().optional(),
    /** For webhook triggers: optional secret for signature verification */
    webhook_secret: z.string().optional(),
    /** For data triggers: DocType name to watch */
    doctype: z.string().optional(),
    /** For data triggers: field to watch (e.g. "status") */
    field: z.string().optional(),
    /** For data triggers: condition expression (e.g. "changed_to:overdue") */
    condition: z.string().optional(),
    /** For message triggers: command pattern (e.g. "/report") */
    command: z.string().optional(),
    /** For integration triggers: integration ID */
    integration_id: z.string().optional(),
    /** For integration triggers: event name */
    event: z.string().optional(),
  })
  .passthrough();

export type WorkflowTrigger = z.infer<typeof WorkflowTriggerSchema>;

/** Step types for workflow execution */
export const WorkflowStepTypeEnum = z.enum([
  'query',
  'transform',
  'condition',
  'send',
  'integration',
  'approval',
  'ai',
  'generate',
]);

export type WorkflowStepType = z.infer<typeof WorkflowStepTypeEnum>;

/** n8n-style data envelope passed between steps */
export const StepResultSchema = z
  .object({
    /** The main data payload */
    json: z.record(z.unknown()),
    /** Optional file paths attached to this result */
    files: z.array(z.string()).optional(),
  })
  .passthrough();

export type StepResult = z.infer<typeof StepResultSchema>;

/** A single step in a workflow pipeline */
export const WorkflowStepSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    type: WorkflowStepTypeEnum,
    /** Step-specific configuration object */
    config: z.record(z.unknown()),
    /** 0-based index of this step in the pipeline */
    sort_order: z.number().int().nonnegative(),
    /** Whether to continue on error instead of failing the run */
    continue_on_error: z.boolean().default(false),
  })
  .passthrough();

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

/** Status values for a workflow run */
export const WorkflowRunStatusEnum = z.enum([
  'pending',
  'running',
  'waiting_approval',
  'completed',
  'failed',
  'cancelled',
]);

export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusEnum>;

/** A single execution record for a workflow */
export const WorkflowRunSchema = z
  .object({
    id: z.string(),
    workflow_id: z.string(),
    status: WorkflowRunStatusEnum,
    /** Trigger data that started this run */
    trigger_data: z.record(z.unknown()).optional(),
    /** Index of the currently executing step */
    current_step: z.number().int().nonnegative().default(0),
    /** Output from the last completed step */
    last_output: StepResultSchema.optional(),
    /** Error message if status is "failed" */
    error: z.string().optional(),
    started_at: z.string().optional(),
    completed_at: z.string().optional(),
  })
  .passthrough();

export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

/** Status values for a workflow approval request */
export const WorkflowApprovalStatusEnum = z.enum(['pending', 'approved', 'rejected', 'timed_out']);

export type WorkflowApprovalStatus = z.infer<typeof WorkflowApprovalStatusEnum>;

/** A human-in-the-loop approval request within a workflow run */
export const WorkflowApprovalSchema = z
  .object({
    id: z.string(),
    run_id: z.string(),
    workflow_id: z.string(),
    /** The step that requested approval */
    step_id: z.string(),
    /** Message presented to the approver */
    message: z.string(),
    /** Choices presented (e.g. ["Approve", "Reject"]) */
    options: z.array(z.string()),
    /** Messaging channel target (e.g. phone number or chat ID) */
    send_to: z.string(),
    status: WorkflowApprovalStatusEnum,
    /** The choice made by the approver */
    response: z.string().optional(),
    /** Minutes before the request times out */
    timeout_minutes: z.number().int().positive().default(60),
    created_at: z.string().optional(),
    resolved_at: z.string().optional(),
  })
  .passthrough();

export type WorkflowApproval = z.infer<typeof WorkflowApprovalSchema>;

/** Status values for a workflow definition */
export const WorkflowStatusEnum = z.enum(['active', 'inactive', 'draft']);

export type WorkflowStatus = z.infer<typeof WorkflowStatusEnum>;

/** Top-level workflow definition */
export const WorkflowSchema = z
  .object({
    id: z.string(),
    name: z.string().min(1),
    description: z.string().optional(),
    trigger: WorkflowTriggerSchema,
    steps: z.array(WorkflowStepSchema),
    status: WorkflowStatusEnum.default('draft'),
    /** Number of successful runs */
    run_count: z.number().int().nonnegative().default(0),
    /** Number of failed runs */
    error_count: z.number().int().nonnegative().default(0),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    last_run_at: z.string().optional(),
  })
  .passthrough();

export type Workflow = z.infer<typeof WorkflowSchema>;
