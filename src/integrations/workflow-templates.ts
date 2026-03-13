/**
 * workflow-templates.ts — Pre-built workflow suggestions from OpenAPI specs (OB-1454).
 *
 * Analyses a parsed OpenAPI document and returns up to three workflow suggestions:
 *   1. Notification on new records — if a POST endpoint exists.
 *   2. Daily summary             — if a list GET endpoint exists (no path params).
 *   3. Status change alerts      — if a PATCH/PUT endpoint with a status field exists.
 *
 * Returned workflows have status 'draft'; they become 'active' once the user approves them.
 */

import { randomUUID } from 'node:crypto';
import type { OpenAPI, OpenAPIV3 } from 'openapi-types';
import type { Workflow, WorkflowTrigger, WorkflowStep } from '../types/workflow.js';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse `spec` and produce up to three pre-built workflow suggestions.
 *
 * The returned `Workflow` objects use status `'draft'` so that they are not
 * executed until the user explicitly approves them (via the conversation UI or
 * the `/approve-workflow` command).
 */
export function generateDefaultWorkflows(spec: OpenAPI.Document): Workflow[] {
  const doc = spec as OpenAPIV3.Document;
  const paths = doc.paths ?? {};
  const now = new Date().toISOString();

  let firstPostPath: string | null = null;
  let firstGetListPath: string | null = null;
  let statusChangePath: string | null = null;
  let statusChangeMethod = '';

  for (const [urlPath, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;
    const pi = pathItem as Record<string, unknown>;

    // POST endpoint → candidate for "notify on new record"
    if (pi['post'] && !firstPostPath) {
      firstPostPath = urlPath;
    }

    // Collection GET endpoint (no path param = list endpoint)
    if (pi['get'] && !firstGetListPath && !urlPath.includes('{')) {
      firstGetListPath = urlPath;
    }

    // PATCH/PUT with a status-like field → candidate for "status change alert"
    for (const method of ['patch', 'put'] as const) {
      const op = pi[method] as OpenAPIV3.OperationObject | undefined;
      if (op && !statusChangePath && hasStatusField(op, doc)) {
        statusChangePath = urlPath;
        statusChangeMethod = method.toUpperCase();
      }
    }
  }

  const workflows: Workflow[] = [];

  // ── Workflow 1: notification on new records ───────────────────────────────
  if (firstPostPath) {
    const trigger: WorkflowTrigger = {
      type: 'webhook',
      event: 'record.created',
    };
    const steps: WorkflowStep[] = [
      {
        id: randomUUID(),
        name: 'Notify on new record',
        type: 'send',
        config: {
          template: `New record created via POST ${firstPostPath}: {{data}}`,
        },
        sort_order: 0,
        continue_on_error: false,
      },
    ];
    workflows.push({
      id: 'notify-on-new-record',
      name: 'Notify on new records',
      description:
        `Send a notification when a new record is created via POST ${firstPostPath}. ` +
        'Connect a webhook from your API to receive live events.',
      trigger,
      steps,
      status: 'draft',
      run_count: 0,
      error_count: 0,
      created_at: now,
    });
  }

  // ── Workflow 2: daily summary ─────────────────────────────────────────────
  if (firstGetListPath) {
    const trigger: WorkflowTrigger = {
      type: 'schedule',
      cron: '0 9 * * *',
      timezone: 'UTC',
    };
    const steps: WorkflowStep[] = [
      {
        id: randomUUID(),
        name: `Fetch records from ${firstGetListPath}`,
        type: 'query',
        config: { operation: `GET ${firstGetListPath}` },
        sort_order: 0,
        continue_on_error: false,
      },
      {
        id: randomUUID(),
        name: 'Send daily summary',
        type: 'send',
        config: {
          template: `Daily summary (${firstGetListPath}):\n{{data}}`,
        },
        sort_order: 1,
        continue_on_error: false,
      },
    ];
    workflows.push({
      id: 'daily-summary',
      name: 'Daily summary',
      description:
        `Every day at 9 AM UTC, fetch records from GET ${firstGetListPath} ` +
        'and send a summary. Useful for monitoring totals, recent activity, or inventory levels.',
      trigger,
      steps,
      status: 'draft',
      run_count: 0,
      error_count: 0,
      created_at: now,
    });
  }

  // ── Workflow 3: status change alerts ─────────────────────────────────────
  if (statusChangePath) {
    const trigger: WorkflowTrigger = {
      type: 'webhook',
      event: 'record.updated',
      field: 'status',
    };
    const steps: WorkflowStep[] = [
      {
        id: randomUUID(),
        name: 'Alert on status change',
        type: 'send',
        config: {
          template:
            `Status changed on ${statusChangePath} (${statusChangeMethod}): ` + '{{data.status}}',
        },
        sort_order: 0,
        continue_on_error: false,
      },
    ];
    workflows.push({
      id: 'status-change-alert',
      name: 'Status change alerts',
      description:
        `Send an alert when a record's status field changes via ` +
        `${statusChangeMethod} ${statusChangePath}. ` +
        'Useful for order status changes, ticket updates, or approval state transitions.',
      trigger,
      steps,
      status: 'draft',
      run_count: 0,
      error_count: 0,
      created_at: now,
    });
  }

  return workflows;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return true if the request body contains a status-like field. */
function hasStatusField(op: OpenAPIV3.OperationObject, doc: OpenAPIV3.Document): boolean {
  const body = op.requestBody as OpenAPIV3.RequestBodyObject | undefined;
  if (!body?.content) return false;

  for (const mediaType of Object.values(body.content)) {
    const schemaRef = mediaType.schema;
    if (!schemaRef) continue;

    const schema = resolveSchema(schemaRef, doc);
    if (!schema?.properties) continue;

    const keys = Object.keys(schema.properties).map((k) => k.toLowerCase());
    if (keys.some((k) => k === 'status' || k === 'state' || k === 'condition')) {
      return true;
    }
  }

  return false;
}

/** Dereference a $ref to a local schema component, or return the schema as-is. */
function resolveSchema(
  ref: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  doc: OpenAPIV3.Document,
): OpenAPIV3.SchemaObject | undefined {
  if ('$ref' in ref) {
    const name = ref.$ref.split('/').pop();
    if (!name) return undefined;
    const resolved = doc.components?.schemas?.[name];
    if (!resolved || '$ref' in resolved) return undefined;
    return resolved;
  }
  return ref;
}
