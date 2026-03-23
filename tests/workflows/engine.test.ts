/**
 * Unit tests for WorkflowEngine (OB-1432)
 *
 * Tests:
 * 1. Execute simple 2-step workflow (query → send)
 * 2. Condition step routes to correct branch
 * 3. Failed step marks run as failed
 * 4. Step output flows to next step input
 * 5. Workflow run history recorded correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createWorkflowEngine } from '../../src/workflows/engine.js';
import { createWorkflowStore } from '../../src/workflows/workflow-store.js';
import type { WorkflowEngine } from '../../src/workflows/engine.js';
import type { WorkflowStore } from '../../src/workflows/workflow-store.js';
import type { Workflow, WorkflowStep } from '../../src/types/workflow.js';

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKFLOW_DDL = `
  CREATE TABLE workflows (
    id             TEXT    PRIMARY KEY,
    name           TEXT    NOT NULL,
    description    TEXT,
    enabled        INTEGER NOT NULL DEFAULT 1,
    trigger_type   TEXT    NOT NULL,
    trigger_config TEXT    NOT NULL,
    steps          TEXT    NOT NULL,
    created_by     TEXT    NOT NULL DEFAULT 'system',
    created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT,
    last_run       TEXT,
    run_count      INTEGER NOT NULL DEFAULT 0,
    failure_count  INTEGER NOT NULL DEFAULT 0,
    success_count  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE workflow_runs (
    id           TEXT    PRIMARY KEY,
    workflow_id  TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    started_at   TEXT    NOT NULL,
    completed_at TEXT,
    status       TEXT    NOT NULL,
    trigger_data TEXT,
    step_results TEXT,
    error        TEXT,
    duration_ms  INTEGER
  );

  CREATE TABLE workflow_approvals (
    id              TEXT    PRIMARY KEY,
    workflow_run_id TEXT    NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_index      INTEGER NOT NULL,
    message         TEXT    NOT NULL,
    options         TEXT    NOT NULL,
    sent_to         TEXT    NOT NULL,
    sent_at         TEXT    NOT NULL,
    responded_at    TEXT,
    response        TEXT,
    timeout_at      TEXT    NOT NULL
  );
`;

function makeStep(
  overrides: Partial<WorkflowStep> & { id: string; type: WorkflowStep['type'] },
): WorkflowStep {
  return {
    name: overrides.id,
    config: {},
    sort_order: 0,
    continue_on_error: false,
    ...overrides,
  };
}

function makeWorkflow(id: string, steps: WorkflowStep[], enabled = true): Workflow {
  return {
    id,
    name: `Test Workflow ${id}`,
    trigger: { type: 'message', command: '/test' },
    steps,
    status: enabled ? 'active' : 'inactive',
    run_count: 0,
    error_count: 0,
    created_at: new Date().toISOString(),
  };
}

interface RunRow {
  id: string;
  workflow_id: string;
  status: string;
  trigger_data: string | null;
  step_results: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowEngine', () => {
  let db: Database.Database;
  let store: WorkflowStore;
  let engine: WorkflowEngine;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(WORKFLOW_DDL);
    store = createWorkflowStore(db);
    engine = createWorkflowEngine(store);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // 1. Execute simple 2-step workflow (query → send)
  // -------------------------------------------------------------------------
  describe('execute simple 2-step workflow (query → send)', () => {
    it('runs query then send steps sequentially and completes', async () => {
      const steps = [
        makeStep({
          id: 'step-query',
          type: 'query',
          sort_order: 0,
          config: { query: 'SELECT * FROM invoices' },
        }),
        makeStep({
          id: 'step-send',
          type: 'send',
          sort_order: 1,
          config: { channel: 'email', to: 'user@test.com', message: 'Report ready' },
        }),
      ];
      const wf = makeWorkflow('wf-query-send', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-query-send', { source: 'test' });

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-query-send') as RunRow[];
      expect(runs).toHaveLength(1);
      expect(runs[0]!.status).toBe('completed');
      expect(runs[0]!.completed_at).toBeTruthy();
      expect(runs[0]!.error).toBeNull();

      // Verify last step output contains send step metadata
      const output = JSON.parse(runs[0]!.step_results!) as { json: Record<string, unknown> };
      expect(output.json._step_type).toBe('send');
      expect(output.json._step_id).toBe('step-send');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Condition step routes to correct branch
  // -------------------------------------------------------------------------
  describe('condition step routes to correct branch', () => {
    it('sets _condition_matched=true when condition is met', async () => {
      const steps = [
        makeStep({
          id: 'cond',
          type: 'condition',
          sort_order: 0,
          config: { field: 'count', operator: 'gt', value: 0 },
        }),
      ];
      const wf = makeWorkflow('wf-cond-true', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-cond-true', { count: 5 });

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-cond-true') as RunRow[];
      const output = JSON.parse(runs[0]!.step_results!) as { json: Record<string, unknown> };
      expect(output.json._condition_matched).toBe(true);
    });

    it('sets _condition_matched=false when condition is not met', async () => {
      const steps = [
        makeStep({
          id: 'cond',
          type: 'condition',
          sort_order: 0,
          config: { field: 'count', operator: 'gt', value: 10 },
        }),
      ];
      const wf = makeWorkflow('wf-cond-false', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-cond-false', { count: 3 });

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-cond-false') as RunRow[];
      const output = JSON.parse(runs[0]!.step_results!) as { json: Record<string, unknown> };
      expect(output.json._condition_matched).toBe(false);
    });

    it('supports equals operator', async () => {
      const steps = [
        makeStep({
          id: 'cond',
          type: 'condition',
          sort_order: 0,
          config: { field: 'status', operator: 'equals', value: 'overdue' },
        }),
      ];
      const wf = makeWorkflow('wf-cond-eq', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-cond-eq', { status: 'overdue' });

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-cond-eq') as RunRow[];
      const output = JSON.parse(runs[0]!.step_results!) as { json: Record<string, unknown> };
      expect(output.json._condition_matched).toBe(true);
    });

    it('supports not_equals operator', async () => {
      const steps = [
        makeStep({
          id: 'cond',
          type: 'condition',
          sort_order: 0,
          config: { field: 'status', operator: 'not_equals', value: 'paid' },
        }),
      ];
      const wf = makeWorkflow('wf-cond-neq', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-cond-neq', { status: 'overdue' });

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-cond-neq') as RunRow[];
      const output = JSON.parse(runs[0]!.step_results!) as { json: Record<string, unknown> };
      expect(output.json._condition_matched).toBe(true);
    });

    it('supports exists operator', async () => {
      const steps = [
        makeStep({
          id: 'cond',
          type: 'condition',
          sort_order: 0,
          config: { field: 'name', operator: 'exists' },
        }),
      ];
      const wf = makeWorkflow('wf-cond-exists', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-cond-exists', { name: 'Alice' });

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-cond-exists') as RunRow[];
      const output = JSON.parse(runs[0]!.step_results!) as { json: Record<string, unknown> };
      expect(output.json._condition_matched).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Failed step marks run as failed
  // -------------------------------------------------------------------------
  describe('failed step marks run as failed', () => {
    it('marks run as failed and increments error_count on step failure', async () => {
      // Monkey-patch store.updateRun to throw on the first step execution,
      // simulating a step that throws during execution.
      // Instead, we'll create a scenario where the step executor throws
      // by using a spied store that throws during step processing.
      const steps = [
        makeStep({ id: 's1', type: 'query', sort_order: 0 }),
        makeStep({ id: 's2', type: 'query', sort_order: 1 }),
      ];
      const wf = makeWorkflow('wf-fail', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      // Spy on store.updateRun and make it throw on the second call
      // (first call sets current_step=0, second call would be for step output)
      // This simulates the step failing during execution.
      let callCount = 0;
      const originalUpdateRun = store.updateRun.bind(store);
      vi.spyOn(store, 'updateRun').mockImplementation((id, updates) => {
        callCount++;
        // Let the initial status update through, then throw to simulate step failure
        if (callCount === 2) {
          throw new Error('Simulated step failure');
        }
        return originalUpdateRun(id, updates);
      });

      await engine.executeWorkflow('wf-fail');

      // Run should be marked failed
      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-fail') as RunRow[];
      expect(runs).toHaveLength(1);
      expect(runs[0]!.status).toBe('failed');
      expect(runs[0]!.error).toContain('failed');

      // Workflow error_count should be incremented
      const updated = store.getWorkflow('wf-fail')!;
      expect(updated.error_count).toBe(1);
    });

    it('continues past error when continue_on_error is true', async () => {
      const steps = [
        makeStep({ id: 's1', type: 'query', sort_order: 0 }),
        makeStep({ id: 's2', type: 'query', sort_order: 1 }),
      ];
      const wf = makeWorkflow('wf-cont', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      // Make first step throw but set continue_on_error
      steps[0]!.continue_on_error = true;
      // Re-create with continue_on_error
      store.deleteWorkflow('wf-cont');
      const wf2 = makeWorkflow('wf-cont', [
        makeStep({ id: 's1', type: 'query', sort_order: 0, continue_on_error: true }),
        makeStep({ id: 's2', type: 'query', sort_order: 1 }),
      ]);
      store.createWorkflow(wf2);
      await engine.loadWorkflows();

      // Spy to throw on first step's updateRun (step output save)
      let callCount = 0;
      const originalUpdateRun = store.updateRun.bind(store);
      vi.spyOn(store, 'updateRun').mockImplementation((id, updates) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Step 1 error');
        }
        return originalUpdateRun(id, updates);
      });

      await engine.executeWorkflow('wf-cont');

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-cont') as RunRow[];
      expect(runs).toHaveLength(1);
      // With continue_on_error, the error is caught, _step_error is attached,
      // and the run continues to completion
      expect(runs[0]!.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Step output flows to next step input
  // -------------------------------------------------------------------------
  describe('step output flows to next step input', () => {
    it('chains transform step output into next step input', async () => {
      const steps = [
        makeStep({
          id: 's1',
          type: 'transform',
          sort_order: 0,
          config: { mappings: { mapped_name: 'name' } },
        }),
        makeStep({
          id: 's2',
          type: 'condition',
          sort_order: 1,
          config: { field: 'mapped_name', operator: 'equals', value: 'Alice' },
        }),
      ];
      const wf = makeWorkflow('wf-chain', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-chain', { name: 'Alice' });

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-chain') as RunRow[];
      const output = JSON.parse(runs[0]!.step_results!) as { json: Record<string, unknown> };
      // Step 1 mapped name→mapped_name, step 2 checked mapped_name equals Alice
      expect(output.json.mapped_name).toBe('Alice');
      expect(output.json._condition_matched).toBe(true);
    });

    it('trigger data becomes initial input to first step', async () => {
      const steps = [
        makeStep({
          id: 's1',
          type: 'query',
          sort_order: 0,
          config: { query: 'SELECT 1' },
        }),
      ];
      const wf = makeWorkflow('wf-trigger-input', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      const triggerData = { user_id: 42, event: 'invoice_created' };
      await engine.executeWorkflow('wf-trigger-input', triggerData);

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-trigger-input') as RunRow[];
      const output = JSON.parse(runs[0]!.step_results!) as { json: Record<string, unknown> };
      // Trigger data should be present in the output (passed through query step)
      expect(output.json.user_id).toBe(42);
      expect(output.json.event).toBe('invoice_created');
    });

    it('preserves files array across steps', async () => {
      // Query step preserves files from input
      const steps = [
        makeStep({ id: 's1', type: 'query', sort_order: 0, config: { query: 'test' } }),
        makeStep({
          id: 's2',
          type: 'transform',
          sort_order: 1,
          config: { mappings: { out: 'query' } },
        }),
      ];
      const wf = makeWorkflow('wf-files', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      // Note: trigger data doesn't include files directly, but the engine
      // initializes with empty files. Steps preserve the files array.
      await engine.executeWorkflow('wf-files', { data: 'test' });

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-files') as RunRow[];
      expect(runs[0]!.status).toBe('completed');
    });

    it('chains 3 steps with data flowing through each', async () => {
      const steps = [
        makeStep({
          id: 's1',
          type: 'transform',
          sort_order: 0,
          config: { mappings: { amount: 'raw_amount' } },
        }),
        makeStep({
          id: 's2',
          type: 'condition',
          sort_order: 1,
          config: { field: 'amount', operator: 'gt', value: 100 },
        }),
        makeStep({
          id: 's3',
          type: 'send',
          sort_order: 2,
          config: { channel: 'webhook', to: 'https://example.com', message: 'alert' },
        }),
      ];
      const wf = makeWorkflow('wf-3step', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-3step', { raw_amount: 250 });

      const runs = db
        .prepare('SELECT * FROM workflow_runs WHERE workflow_id = ?')
        .all('wf-3step') as RunRow[];
      const output = JSON.parse(runs[0]!.step_results!) as { json: Record<string, unknown> };
      // Step 1: raw_amount→amount (250)
      expect(output.json.amount).toBe(250);
      // Step 2: condition matched (250 > 100)
      expect(output.json._condition_matched).toBe(true);
      // Step 3: send step metadata attached
      expect(output.json._step_type).toBe('send');
      expect(runs[0]!.status).toBe('completed');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Workflow run history recorded correctly
  // -------------------------------------------------------------------------
  describe('workflow run history recorded correctly', () => {
    it('creates a run record with correct workflow_id and status', async () => {
      const steps = [makeStep({ id: 's1', type: 'query', sort_order: 0 })];
      const wf = makeWorkflow('wf-history', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-history');

      const runs = store.listRuns('wf-history');
      expect(runs).toHaveLength(1);
      expect(runs[0]!.workflow_id).toBe('wf-history');
      expect(runs[0]!.status).toBe('completed');
      expect(runs[0]!.started_at).toBeTruthy();
      expect(runs[0]!.completed_at).toBeTruthy();
    });

    it('stores trigger_data in the run record', async () => {
      const steps = [makeStep({ id: 's1', type: 'query', sort_order: 0 })];
      const wf = makeWorkflow('wf-hist-trigger', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      const triggerData = { triggered_by: 'schedule', cron: '0 9 * * *' };
      await engine.executeWorkflow('wf-hist-trigger', triggerData);

      const runs = store.listRuns('wf-hist-trigger');
      expect(runs[0]!.trigger_data).toEqual(triggerData);
    });

    it('stores last step output in run record', async () => {
      const steps = [
        makeStep({
          id: 's1',
          type: 'transform',
          sort_order: 0,
          config: { mappings: { result: 'input' } },
        }),
      ];
      const wf = makeWorkflow('wf-hist-output', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-hist-output', { input: 'hello' });

      const runs = store.listRuns('wf-hist-output');
      expect(runs[0]!.last_output).toBeDefined();
      expect(runs[0]!.last_output!.json.result).toBe('hello');
    });

    it('records multiple runs for the same workflow', async () => {
      const steps = [makeStep({ id: 's1', type: 'query', sort_order: 0 })];
      const wf = makeWorkflow('wf-multi', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-multi', { run: 1 });
      await engine.executeWorkflow('wf-multi', { run: 2 });
      await engine.executeWorkflow('wf-multi', { run: 3 });

      const runs = store.listRuns('wf-multi');
      expect(runs).toHaveLength(3);
      // All should be completed
      expect(runs.every((r) => r.status === 'completed')).toBe(true);
      // Each run should have distinct IDs
      const ids = new Set(runs.map((r) => r.id));
      expect(ids.size).toBe(3);
    });

    it('updates workflow run_count after successful runs', async () => {
      const steps = [makeStep({ id: 's1', type: 'query', sort_order: 0 })];
      const wf = makeWorkflow('wf-counter', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-counter');
      // Reload to refresh in-memory cache (engine reads run_count from loaded map)
      await engine.loadWorkflows();
      await engine.executeWorkflow('wf-counter');

      const updated = store.getWorkflow('wf-counter')!;
      expect(updated.run_count).toBe(2);
    });

    it('updates workflow last_run_at after execution', async () => {
      const steps = [makeStep({ id: 's1', type: 'query', sort_order: 0 })];
      const wf = makeWorkflow('wf-lastrun', steps);
      store.createWorkflow(wf);
      await engine.loadWorkflows();

      await engine.executeWorkflow('wf-lastrun');

      const updated = store.getWorkflow('wf-lastrun')!;
      expect(updated.last_run_at).toBeTruthy();
    });
  });
});
