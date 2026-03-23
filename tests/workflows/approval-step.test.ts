/**
 * Unit tests for approval-step (OB-1427)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createWorkflowStore } from '../../src/workflows/workflow-store.js';
import type { WorkflowStore } from '../../src/workflows/workflow-store.js';
import {
  executeApprovalStep,
  ApprovalConfigSchema,
  type ApprovalStepContext,
} from '../../src/workflows/steps/approval-step.js';
import type { StepResult } from '../../src/types/workflow.js';

// Suppress log output during tests
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
// DDL (matches workflow-engine.test.ts)
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

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let db: Database.Database;
let store: WorkflowStore;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(WORKFLOW_DDL);
  store = createWorkflowStore(db);

  // Create a dummy workflow and run so foreign keys are satisfied
  db.prepare(
    `INSERT INTO workflows (id, name, trigger_type, trigger_config, steps)
     VALUES ('wf-1', 'Test Workflow', 'message', '{}', '[]')`,
  ).run();
  db.prepare(
    `INSERT INTO workflow_runs (id, workflow_id, started_at, status)
     VALUES ('run-1', 'wf-1', datetime('now'), 'running')`,
  ).run();

  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
});

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe('ApprovalConfigSchema', () => {
  it('validates a valid config', () => {
    const result = ApprovalConfigSchema.parse({
      message: 'Please approve this',
      options: ['Approve', 'Reject'],
      send_to: '+1234567890',
      timeout_minutes: 30,
    });
    expect(result.timeout_minutes).toBe(30);
  });

  it('applies default timeout_minutes', () => {
    const result = ApprovalConfigSchema.parse({
      message: 'Approve?',
      options: ['Yes', 'No'],
      send_to: 'user@example.com',
    });
    expect(result.timeout_minutes).toBe(60);
  });

  it('rejects empty message', () => {
    expect(() =>
      ApprovalConfigSchema.parse({
        message: '',
        options: ['Yes'],
        send_to: '+1234567890',
      }),
    ).toThrow();
  });

  it('rejects empty options array', () => {
    expect(() =>
      ApprovalConfigSchema.parse({
        message: 'Approve?',
        options: [],
        send_to: '+1234567890',
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('executeApprovalStep', () => {
  it('sends approval message and creates record in store', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const context: ApprovalStepContext = { sendMessage, store };
    const input: StepResult = { json: { orderId: 'ORD-123' } };

    // Resolve the approval immediately so the poll loop exits
    const executionPromise = executeApprovalStep(
      context,
      {
        message: 'Approve order {{orderId}}?',
        options: ['Approve', 'Reject'],
        send_to: '+1234567890',
        timeout_minutes: 1,
      },
      input,
      'run-1',
    );

    // Let the first poll tick fire, then resolve the approval
    await vi.advanceTimersByTimeAsync(100);

    // Find the pending approval and resolve it
    const pending = store.getPendingApproval('run-1');
    expect(pending).not.toBeNull();
    expect(pending!.message).toBe('Approve order ORD-123?');
    store.resolveApproval(pending!.id, 'Approve');

    // Advance past the poll interval so the loop picks up the resolution
    await vi.advanceTimersByTimeAsync(3_000);

    const result = await executionPromise;

    // Verify sendMessage was called with formatted message
    expect(sendMessage).toHaveBeenCalledOnce();
    const [to, text] = sendMessage.mock.calls[0] as [string, string];
    expect(to).toBe('+1234567890');
    expect(text).toContain('Approve order ORD-123?');
    expect(text).toContain('1. Approve');
    expect(text).toContain('2. Reject');

    // Verify result contains approval metadata
    expect(result.json._approval_id).toBeDefined();
    expect(result.json._approval_status).toBe('approved');
    expect(result.json.orderId).toBe('ORD-123');
  });

  it('times out when no response is given', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const context: ApprovalStepContext = { sendMessage, store };
    const input: StepResult = { json: {} };

    const executionPromise = executeApprovalStep(
      context,
      {
        message: 'Approve this?',
        options: ['Yes', 'No'],
        send_to: '+1234567890',
        timeout_minutes: 1,
      },
      input,
      'run-1',
    );

    // Advance past the full timeout (1 minute + buffer)
    await vi.advanceTimersByTimeAsync(65_000);

    const result = await executionPromise;

    expect(result.json._approval_status).toBe('timed_out');
    expect(result.json._approval_response).toBe('timed_out');
  });

  it('works without sendMessage callback (logs warning)', async () => {
    const context: ApprovalStepContext = { store };
    const input: StepResult = { json: {} };

    const executionPromise = executeApprovalStep(
      context,
      {
        message: 'Approve?',
        options: ['Yes'],
        send_to: '+1234567890',
        timeout_minutes: 1,
      },
      input,
      'run-1',
    );

    // Resolve immediately
    await vi.advanceTimersByTimeAsync(100);
    const pending = store.getPendingApproval('run-1');
    expect(pending).not.toBeNull();
    store.resolveApproval(pending!.id, 'Yes');

    await vi.advanceTimersByTimeAsync(3_000);
    const result = await executionPromise;

    expect(result.json._approval_status).toBe('approved');
  });

  it('templates send_to with input data', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const context: ApprovalStepContext = { sendMessage, store };
    const input: StepResult = { json: { phone: '+9876543210' } };

    const executionPromise = executeApprovalStep(
      context,
      {
        message: 'Approve?',
        options: ['Yes'],
        send_to: '{{phone}}',
        timeout_minutes: 1,
      },
      input,
      'run-1',
    );

    await vi.advanceTimersByTimeAsync(100);
    const pending = store.getPendingApproval('run-1');
    store.resolveApproval(pending!.id, 'Yes');
    await vi.advanceTimersByTimeAsync(3_000);

    const result = await executionPromise;
    expect(sendMessage).toHaveBeenCalledWith('+9876543210', expect.any(String));
    expect(result.json._approval_send_to).toBe('+9876543210');
  });

  it('preserves input files in output', async () => {
    const context: ApprovalStepContext = { store };
    const input: StepResult = { json: {}, files: ['/tmp/report.pdf'] };

    const executionPromise = executeApprovalStep(
      context,
      {
        message: 'Approve?',
        options: ['Yes'],
        send_to: '+1234567890',
        timeout_minutes: 1,
      },
      input,
      'run-1',
    );

    await vi.advanceTimersByTimeAsync(100);
    const pending = store.getPendingApproval('run-1');
    store.resolveApproval(pending!.id, 'Yes');
    await vi.advanceTimersByTimeAsync(3_000);

    const result = await executionPromise;
    expect(result.files).toEqual(['/tmp/report.pdf']);
  });

  it('throws when sendMessage fails', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Network error'));
    const context: ApprovalStepContext = { sendMessage, store };
    const input: StepResult = { json: {} };

    await expect(
      executeApprovalStep(
        context,
        {
          message: 'Approve?',
          options: ['Yes'],
          send_to: '+1234567890',
        },
        input,
        'run-1',
      ),
    ).rejects.toThrow('Network error');
  });
});
