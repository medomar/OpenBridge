import type Database from 'better-sqlite3';
import type { Workflow, WorkflowRun, WorkflowApproval } from '../types/workflow.js';

// ---------------------------------------------------------------------------
// Raw row shapes returned by better-sqlite3
// ---------------------------------------------------------------------------

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  enabled: number;
  trigger_type: string;
  trigger_config: string;
  steps: string;
  created_by: string;
  created_at: string;
  last_run: string | null;
  run_count: number;
  failure_count: number;
  success_count: number;
}

interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  trigger_data: string | null;
  step_results: string | null;
  error: string | null;
  duration_ms: number | null;
}

interface WorkflowApprovalRow {
  id: string;
  workflow_run_id: string;
  step_index: number;
  message: string;
  options: string;
  sent_to: string;
  sent_at: string;
  responded_at: string | null;
  response: string | null;
  timeout_at: string;
}

// ---------------------------------------------------------------------------
// Row → domain object mappers
// ---------------------------------------------------------------------------

function rowToWorkflow(row: WorkflowRow): Workflow {
  const trigger = JSON.parse(row.trigger_config) as Record<string, unknown>;
  trigger['type'] = row.trigger_type;
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    trigger: trigger as Workflow['trigger'],
    steps: JSON.parse(row.steps) as Workflow['steps'],
    status: row.enabled ? 'active' : 'inactive',
    run_count: row.run_count,
    error_count: row.failure_count,
    created_at: row.created_at,
    updated_at: row.last_run ?? undefined,
    last_run_at: row.last_run ?? undefined,
  };
}

function rowToRun(row: WorkflowRunRow): WorkflowRun {
  return {
    id: row.id,
    workflow_id: row.workflow_id,
    status: row.status as WorkflowRun['status'],
    trigger_data: row.trigger_data
      ? (JSON.parse(row.trigger_data) as Record<string, unknown>)
      : undefined,
    current_step: 0,
    last_output: row.step_results
      ? (JSON.parse(row.step_results) as WorkflowRun['last_output'])
      : undefined,
    error: row.error ?? undefined,
    started_at: row.started_at,
    completed_at: row.completed_at ?? undefined,
  };
}

function rowToApproval(row: WorkflowApprovalRow): WorkflowApproval {
  return {
    id: row.id,
    run_id: row.workflow_run_id,
    workflow_id: '',
    step_id: String(row.step_index),
    message: row.message,
    options: JSON.parse(row.options) as string[],
    send_to: row.sent_to,
    status: row.responded_at
      ? row.response === 'timed_out'
        ? 'timed_out'
        : row.response === 'rejected'
          ? 'rejected'
          : 'approved'
      : 'pending',
    response: row.response ?? undefined,
    timeout_minutes: 60,
    created_at: row.sent_at,
    resolved_at: row.responded_at ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// WorkflowStore interface
// ---------------------------------------------------------------------------

export interface WorkflowStore {
  createWorkflow(workflow: Workflow): void;
  getWorkflow(id: string): Workflow | null;
  listWorkflows(enabledOnly?: boolean): Workflow[];
  updateWorkflow(id: string, updates: Partial<Workflow>): void;
  deleteWorkflow(id: string): void;
  createRun(run: WorkflowRun): void;
  getRun(id: string): WorkflowRun | null;
  updateRun(id: string, updates: Partial<WorkflowRun>): void;
  createApproval(approval: WorkflowApproval): void;
  resolveApproval(id: string, response: string): void;
  getPendingApproval(runId: string): WorkflowApproval | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWorkflowStore(db: Database.Database): WorkflowStore {
  return {
    createWorkflow(workflow: Workflow): void {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO workflows
           (id, name, description, enabled, trigger_type, trigger_config, steps,
            created_by, created_at, run_count, failure_count, success_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        workflow.id,
        workflow.name,
        workflow.description ?? null,
        workflow.status === 'active' ? 1 : 0,
        workflow.trigger.type,
        JSON.stringify(workflow.trigger),
        JSON.stringify(workflow.steps),
        'system',
        workflow.created_at ?? now,
        workflow.run_count ?? 0,
        workflow.error_count ?? 0,
        0,
      );
    },

    getWorkflow(id: string): Workflow | null {
      const row = db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as
        | WorkflowRow
        | undefined;
      return row ? rowToWorkflow(row) : null;
    },

    listWorkflows(enabledOnly = false): Workflow[] {
      const sql = enabledOnly
        ? 'SELECT * FROM workflows WHERE enabled = 1 ORDER BY created_at DESC'
        : 'SELECT * FROM workflows ORDER BY created_at DESC';
      const rows = db.prepare(sql).all() as WorkflowRow[];
      return rows.map(rowToWorkflow);
    },

    updateWorkflow(id: string, updates: Partial<Workflow>): void {
      const now = new Date().toISOString();
      const sets: string[] = ['updated_at = ?'];
      const values: unknown[] = [now];

      if (updates.name !== undefined) {
        sets.push('name = ?');
        values.push(updates.name);
      }
      if (updates.description !== undefined) {
        sets.push('description = ?');
        values.push(updates.description ?? null);
      }
      if (updates.status !== undefined) {
        sets.push('enabled = ?');
        values.push(updates.status === 'active' ? 1 : 0);
      }
      if (updates.trigger !== undefined) {
        sets.push('trigger_type = ?', 'trigger_config = ?');
        values.push(updates.trigger.type, JSON.stringify(updates.trigger));
      }
      if (updates.steps !== undefined) {
        sets.push('steps = ?');
        values.push(JSON.stringify(updates.steps));
      }
      if (updates.run_count !== undefined) {
        sets.push('run_count = ?');
        values.push(updates.run_count);
      }
      if (updates.error_count !== undefined) {
        sets.push('failure_count = ?');
        values.push(updates.error_count);
      }
      if (updates.last_run_at !== undefined) {
        sets.push('last_run = ?');
        values.push(updates.last_run_at);
      }

      values.push(id);
      db.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    },

    deleteWorkflow(id: string): void {
      db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    },

    createRun(run: WorkflowRun): void {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO workflow_runs
           (id, workflow_id, started_at, status, trigger_data, step_results, error, duration_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        run.id,
        run.workflow_id,
        run.started_at ?? now,
        run.status,
        run.trigger_data ? JSON.stringify(run.trigger_data) : null,
        run.last_output ? JSON.stringify(run.last_output) : null,
        run.error ?? null,
        null,
      );
    },

    getRun(id: string): WorkflowRun | null {
      const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as
        | WorkflowRunRow
        | undefined;
      return row ? rowToRun(row) : null;
    },

    updateRun(id: string, updates: Partial<WorkflowRun>): void {
      const sets: string[] = [];
      const values: unknown[] = [];

      if (updates.status !== undefined) {
        sets.push('status = ?');
        values.push(updates.status);
      }
      if (updates.completed_at !== undefined) {
        sets.push('completed_at = ?');
        values.push(updates.completed_at);
      }
      if (updates.last_output !== undefined) {
        sets.push('step_results = ?');
        values.push(JSON.stringify(updates.last_output));
      }
      if (updates.error !== undefined) {
        sets.push('error = ?');
        values.push(updates.error);
      }

      if (sets.length === 0) return;
      values.push(id);
      db.prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    },

    createApproval(approval: WorkflowApproval): void {
      const now = new Date().toISOString();
      const timeoutAt = new Date(
        Date.now() + (approval.timeout_minutes ?? 60) * 60 * 1000,
      ).toISOString();
      db.prepare(
        `INSERT INTO workflow_approvals
           (id, workflow_run_id, step_index, message, options, sent_to, sent_at, timeout_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        approval.id,
        approval.run_id,
        parseInt(approval.step_id, 10) || 0,
        approval.message,
        JSON.stringify(approval.options),
        approval.send_to,
        approval.created_at ?? now,
        timeoutAt,
      );
    },

    resolveApproval(id: string, response: string): void {
      const now = new Date().toISOString();
      db.prepare(`UPDATE workflow_approvals SET responded_at = ?, response = ? WHERE id = ?`).run(
        now,
        response,
        id,
      );
    },

    getPendingApproval(runId: string): WorkflowApproval | null {
      const row = db
        .prepare(
          `SELECT * FROM workflow_approvals
           WHERE workflow_run_id = ? AND responded_at IS NULL
           ORDER BY sent_at ASC LIMIT 1`,
        )
        .get(runId) as WorkflowApprovalRow | undefined;
      return row ? rowToApproval(row) : null;
    },
  };
}
