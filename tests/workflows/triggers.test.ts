/**
 * Unit tests for workflow triggers (OB-1433)
 *
 * Tests:
 * 1. Schedule trigger creates valid cron job
 * 2. Data trigger matches field change condition
 * 3. Message trigger matches command
 * 4. Webhook trigger dispatches to correct workflow
 */

import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import {
  matchScheduleTrigger,
  parseScheduleConfig,
} from '../../src/workflows/triggers/schedule-trigger.js';
import { evaluateDataTrigger } from '../../src/workflows/triggers/data-trigger.js';
import { matchMessageTrigger } from '../../src/workflows/triggers/message-trigger.js';
import {
  WebhookRouter,
  registerWebhookTrigger,
  unregisterWebhookTrigger,
} from '../../src/workflows/triggers/webhook-trigger.js';
import { createWorkflowScheduler } from '../../src/workflows/scheduler.js';
import type { Workflow } from '../../src/types/workflow.js';
import type { WorkflowEngine } from '../../src/workflows/engine.js';

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

function makeWorkflow(overrides: Partial<Workflow> & { id: string }): Workflow {
  return {
    id: overrides.id,
    name: `Workflow ${overrides.id}`,
    trigger: { type: 'message', command: '/test' },
    steps: [],
    status: 'active',
    run_count: 0,
    error_count: 0,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeMockEngine(): WorkflowEngine {
  return {
    loadWorkflows: vi.fn().mockResolvedValue(undefined),
    executeWorkflow: vi.fn().mockResolvedValue(undefined),
    getWorkflow: vi.fn(),
    listWorkflows: vi.fn().mockReturnValue([]),
  } as unknown as WorkflowEngine;
}

// ---------------------------------------------------------------------------
// 1. Schedule trigger creates valid cron job
// ---------------------------------------------------------------------------

describe('schedule trigger', () => {
  it('matchScheduleTrigger returns true for valid cron expression', () => {
    const wf = makeWorkflow({
      id: 'wf-sched-1',
      trigger: { type: 'schedule', cron: '0 9 * * *' },
    });
    expect(matchScheduleTrigger(wf)).toBe(true);
  });

  it('matchScheduleTrigger returns false for non-schedule trigger type', () => {
    const wf = makeWorkflow({
      id: 'wf-sched-2',
      trigger: { type: 'message', command: '/report' },
    });
    expect(matchScheduleTrigger(wf)).toBe(false);
  });

  it('matchScheduleTrigger returns false when cron expression is missing', () => {
    const wf = makeWorkflow({
      id: 'wf-sched-3',
      trigger: { type: 'schedule' },
    });
    expect(matchScheduleTrigger(wf)).toBe(false);
  });

  it('matchScheduleTrigger returns false for invalid cron expression', () => {
    const wf = makeWorkflow({
      id: 'wf-sched-4',
      trigger: { type: 'schedule', cron: 'not-a-cron' },
    });
    expect(matchScheduleTrigger(wf)).toBe(false);
  });

  it('parseScheduleConfig parses valid cron config', () => {
    const config = parseScheduleConfig({ cron: '*/5 * * * *' });
    expect(config.cron).toBe('*/5 * * * *');
    expect(config.timezone).toBeUndefined();
  });

  it('parseScheduleConfig parses cron config with timezone', () => {
    const config = parseScheduleConfig({ cron: '0 9 * * *', timezone: 'America/New_York' });
    expect(config.cron).toBe('0 9 * * *');
    expect(config.timezone).toBe('America/New_York');
  });

  it('parseScheduleConfig throws on invalid cron expression', () => {
    expect(() => parseScheduleConfig({ cron: 'bad cron' })).toThrow();
  });

  it('parseScheduleConfig throws when cron is missing', () => {
    expect(() => parseScheduleConfig({})).toThrow();
  });

  it('scheduler schedules a workflow with a valid cron expression', async () => {
    const engine = makeMockEngine();
    const scheduler = createWorkflowScheduler(engine);
    const wf = makeWorkflow({
      id: 'wf-sched-5',
      trigger: { type: 'schedule', cron: '0 9 * * *' },
    });

    // Should not throw — a valid cron job is created
    await expect(scheduler.scheduleWorkflow(wf)).resolves.toBeUndefined();
    // Clean up
    await scheduler.unscheduleWorkflow(wf.id);
  });

  it('scheduler skips scheduling for non-schedule workflows', async () => {
    const engine = makeMockEngine();
    const scheduler = createWorkflowScheduler(engine);
    const wf = makeWorkflow({
      id: 'wf-sched-6',
      trigger: { type: 'message', command: '/run' },
    });

    await expect(scheduler.scheduleWorkflow(wf)).resolves.toBeUndefined();
    // No job to unschedule — should not throw
    await expect(scheduler.unscheduleWorkflow(wf.id)).resolves.toBeUndefined();
  });

  it('scheduler replaces an existing job when rescheduled', async () => {
    const engine = makeMockEngine();
    const scheduler = createWorkflowScheduler(engine);
    const wf = makeWorkflow({
      id: 'wf-reschedule',
      trigger: { type: 'schedule', cron: '0 9 * * *' },
    });

    await scheduler.scheduleWorkflow(wf);
    // Schedule again — should replace the existing job without throwing
    await expect(scheduler.scheduleWorkflow(wf)).resolves.toBeUndefined();

    await scheduler.unscheduleAll();
  });

  it('unscheduleAll removes all jobs', async () => {
    const engine = makeMockEngine();
    const scheduler = createWorkflowScheduler(engine);

    const wf1 = makeWorkflow({ id: 'wf-all-1', trigger: { type: 'schedule', cron: '0 9 * * *' } });
    const wf2 = makeWorkflow({ id: 'wf-all-2', trigger: { type: 'schedule', cron: '0 10 * * *' } });

    await scheduler.scheduleWorkflow(wf1);
    await scheduler.scheduleWorkflow(wf2);
    await expect(scheduler.unscheduleAll()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. Data trigger matches field change condition
// ---------------------------------------------------------------------------

describe('data trigger', () => {
  it('returns true when field changes to specified value', () => {
    const wf = makeWorkflow({
      id: 'wf-data-1',
      trigger: { type: 'data', field: 'status', condition: 'changed_to:overdue' },
    });
    expect(evaluateDataTrigger(wf, { status: 'pending' }, { status: 'overdue' })).toBe(true);
  });

  it('returns false when field does not change to specified value', () => {
    const wf = makeWorkflow({
      id: 'wf-data-2',
      trigger: { type: 'data', field: 'status', condition: 'changed_to:overdue' },
    });
    expect(evaluateDataTrigger(wf, { status: 'pending' }, { status: 'paid' })).toBe(false);
  });

  it('returns true when field changes from specified value', () => {
    const wf = makeWorkflow({
      id: 'wf-data-3',
      trigger: { type: 'data', field: 'status', condition: 'changed_from:pending' },
    });
    expect(evaluateDataTrigger(wf, { status: 'pending' }, { status: 'active' })).toBe(true);
  });

  it('returns false when field does not change from specified value', () => {
    const wf = makeWorkflow({
      id: 'wf-data-4',
      trigger: { type: 'data', field: 'status', condition: 'changed_from:pending' },
    });
    expect(evaluateDataTrigger(wf, { status: 'active' }, { status: 'overdue' })).toBe(false);
  });

  it('returns true when field has any change with "changed" condition', () => {
    const wf = makeWorkflow({
      id: 'wf-data-5',
      trigger: { type: 'data', field: 'amount', condition: 'changed' },
    });
    expect(evaluateDataTrigger(wf, { amount: 100 }, { amount: 200 })).toBe(true);
  });

  it('returns false when field does not change with "changed" condition', () => {
    const wf = makeWorkflow({
      id: 'wf-data-6',
      trigger: { type: 'data', field: 'amount', condition: 'changed' },
    });
    expect(evaluateDataTrigger(wf, { amount: 100 }, { amount: 100 })).toBe(false);
  });

  it('returns true for equals condition when field matches', () => {
    const wf = makeWorkflow({
      id: 'wf-data-7',
      trigger: { type: 'data', field: 'status', condition: 'equals:active' },
    });
    expect(evaluateDataTrigger(wf, { status: 'pending' }, { status: 'active' })).toBe(true);
  });

  it('returns true for not_equals condition when field differs', () => {
    const wf = makeWorkflow({
      id: 'wf-data-8',
      trigger: { type: 'data', field: 'status', condition: 'not_equals:paid' },
    });
    expect(evaluateDataTrigger(wf, { status: 'paid' }, { status: 'overdue' })).toBe(true);
  });

  it('returns false for non-data trigger type', () => {
    const wf = makeWorkflow({
      id: 'wf-data-9',
      trigger: { type: 'message', command: '/report' },
    });
    expect(evaluateDataTrigger(wf, {}, {})).toBe(false);
  });

  it('returns false when field is not configured', () => {
    const wf = makeWorkflow({
      id: 'wf-data-10',
      trigger: { type: 'data', condition: 'changed' },
    });
    expect(evaluateDataTrigger(wf, { status: 'a' }, { status: 'b' })).toBe(false);
  });

  it('returns false when condition is not configured', () => {
    const wf = makeWorkflow({
      id: 'wf-data-11',
      trigger: { type: 'data', field: 'status' },
    });
    expect(evaluateDataTrigger(wf, { status: 'a' }, { status: 'b' })).toBe(false);
  });

  it('returns false for unrecognised condition prefix', () => {
    const wf = makeWorkflow({
      id: 'wf-data-12',
      trigger: { type: 'data', field: 'status', condition: 'unknown:value' },
    });
    expect(evaluateDataTrigger(wf, { status: 'a' }, { status: 'b' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Message trigger matches command
// ---------------------------------------------------------------------------

describe('message trigger', () => {
  it('matches exact command', () => {
    const wf = makeWorkflow({
      id: 'wf-msg-1',
      trigger: { type: 'message', command: '/report' },
    });
    expect(matchMessageTrigger(wf, '/report')).toBe(true);
  });

  it('does not match different command', () => {
    const wf = makeWorkflow({
      id: 'wf-msg-2',
      trigger: { type: 'message', command: '/report' },
    });
    expect(matchMessageTrigger(wf, '/other')).toBe(false);
  });

  it('matches prefix pattern with wildcard suffix', () => {
    const wf = makeWorkflow({
      id: 'wf-msg-3',
      trigger: { type: 'message', command: '/report*' },
    });
    expect(matchMessageTrigger(wf, '/report status')).toBe(true);
    expect(matchMessageTrigger(wf, '/report')).toBe(true);
    expect(matchMessageTrigger(wf, '/other')).toBe(false);
  });

  it('matches any non-empty command with wildcard *', () => {
    const wf = makeWorkflow({
      id: 'wf-msg-4',
      trigger: { type: 'message', command: '*' },
    });
    expect(matchMessageTrigger(wf, '/anything')).toBe(true);
    expect(matchMessageTrigger(wf, 'some text')).toBe(true);
    expect(matchMessageTrigger(wf, '')).toBe(false);
  });

  it('returns false for non-message trigger type', () => {
    const wf = makeWorkflow({
      id: 'wf-msg-5',
      trigger: { type: 'schedule', cron: '0 9 * * *' },
    });
    expect(matchMessageTrigger(wf, '/report')).toBe(false);
  });

  it('returns false when command pattern is not configured', () => {
    const wf = makeWorkflow({
      id: 'wf-msg-6',
      trigger: { type: 'message' },
    });
    expect(matchMessageTrigger(wf, '/report')).toBe(false);
  });

  it('trims whitespace before matching', () => {
    const wf = makeWorkflow({
      id: 'wf-msg-7',
      trigger: { type: 'message', command: '/report' },
    });
    expect(matchMessageTrigger(wf, '  /report  ')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Webhook trigger dispatches to correct workflow
// ---------------------------------------------------------------------------

describe('webhook trigger', () => {
  function makeMockRequest(
    options: {
      method?: string;
      url?: string;
      body?: string;
      headers?: Record<string, string>;
    } = {},
  ): IncomingMessage {
    const emitter = new EventEmitter() as IncomingMessage;
    emitter.method = options.method ?? 'POST';
    emitter.url = options.url ?? '/webhook/workflow/wf-webhook-1';
    emitter.headers = options.headers ?? {};

    // Emit body asynchronously
    setImmediate(() => {
      if (options.body) {
        emitter.emit('data', Buffer.from(options.body, 'utf-8'));
      }
      emitter.emit('end');
    });

    return emitter;
  }

  function makeMockResponse(): ServerResponse & {
    statusCode: number;
    _body: string;
  } {
    const res = {
      statusCode: 200,
      _body: '',
      writeHead: vi.fn(function (this: { statusCode: number }, code: number) {
        this.statusCode = code;
      }),
      end: vi.fn(function (this: { _body: string }, data?: string) {
        this._body = data ?? '';
      }),
    } as unknown as ServerResponse & { statusCode: number; _body: string };
    return res;
  }

  it('registers a POST handler at /webhook/workflow/{id}', async () => {
    const router = new WebhookRouter();
    const engine = makeMockEngine();
    const wf = makeWorkflow({ id: 'wf-webhook-1', trigger: { type: 'webhook' } });

    registerWebhookTrigger(wf, router, engine);
    expect(router.hasRoutes()).toBe(true);

    unregisterWebhookTrigger(wf, router);
    expect(router.hasRoutes()).toBe(false);
  });

  it('dispatches to correct workflow when POST arrives', async () => {
    const router = new WebhookRouter();
    const engine = makeMockEngine();
    const wf = makeWorkflow({ id: 'wf-webhook-2', trigger: { type: 'webhook' } });

    registerWebhookTrigger(wf, router, engine);

    const req = makeMockRequest({
      url: '/webhook/workflow/wf-webhook-2',
      body: JSON.stringify({ event: 'order.created', order_id: '42' }),
    });
    const res = makeMockResponse();

    const handled = await router.handle(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(202);

    // Wait for setImmediate to fire executeWorkflow
    await new Promise((resolve) => setImmediate(resolve));
    expect(engine.executeWorkflow).toHaveBeenCalledWith('wf-webhook-2', {
      event: 'order.created',
      order_id: '42',
    });
  });

  it('does not dispatch for unknown routes', async () => {
    const router = new WebhookRouter();
    const engine = makeMockEngine();
    const wf = makeWorkflow({ id: 'wf-webhook-3', trigger: { type: 'webhook' } });

    registerWebhookTrigger(wf, router, engine);

    const req = makeMockRequest({ url: '/webhook/workflow/non-existent' });
    const res = makeMockResponse();

    const handled = await router.handle(req, res);
    expect(handled).toBe(false);
    expect(engine.executeWorkflow).not.toHaveBeenCalled();
  });

  it('rejects request with invalid signature when secret is set', async () => {
    const router = new WebhookRouter();
    const engine = makeMockEngine();
    const wf = makeWorkflow({
      id: 'wf-webhook-4',
      trigger: { type: 'webhook', webhook_secret: 'mysecret' },
    });

    registerWebhookTrigger(wf, router, engine);

    const req = makeMockRequest({
      url: '/webhook/workflow/wf-webhook-4',
      body: '{"data":1}',
      headers: { 'x-hub-signature-256': 'sha256=invalidsignature' },
    });
    const res = makeMockResponse();

    const handled = await router.handle(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(engine.executeWorkflow).not.toHaveBeenCalled();
  });

  it('accepts request with valid HMAC-SHA256 signature', async () => {
    const { createHmac } = await import('node:crypto');
    const router = new WebhookRouter();
    const engine = makeMockEngine();
    const secret = 'test-secret-123';
    const wf = makeWorkflow({
      id: 'wf-webhook-5',
      trigger: { type: 'webhook', webhook_secret: secret },
    });

    registerWebhookTrigger(wf, router, engine);

    const body = JSON.stringify({ order_id: '99' });
    const signature = `sha256=${createHmac('sha256', secret).update(Buffer.from(body)).digest('hex')}`;

    const req = makeMockRequest({
      url: '/webhook/workflow/wf-webhook-5',
      body,
      headers: { 'x-hub-signature-256': signature },
    });
    const res = makeMockResponse();

    const handled = await router.handle(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(202);

    await new Promise((resolve) => setImmediate(resolve));
    expect(engine.executeWorkflow).toHaveBeenCalledWith('wf-webhook-5', { order_id: '99' });
  });

  it('handles non-POST requests by returning false', async () => {
    const router = new WebhookRouter();
    const engine = makeMockEngine();
    const wf = makeWorkflow({ id: 'wf-webhook-6', trigger: { type: 'webhook' } });

    registerWebhookTrigger(wf, router, engine);

    const req = makeMockRequest({ method: 'GET', url: '/webhook/workflow/wf-webhook-6' });
    const res = makeMockResponse();

    const handled = await router.handle(req, res);
    expect(handled).toBe(false);
    expect(engine.executeWorkflow).not.toHaveBeenCalled();
  });

  it('falls back to empty object on invalid JSON body', async () => {
    const router = new WebhookRouter();
    const engine = makeMockEngine();
    const wf = makeWorkflow({ id: 'wf-webhook-7', trigger: { type: 'webhook' } });

    registerWebhookTrigger(wf, router, engine);

    const req = makeMockRequest({
      url: '/webhook/workflow/wf-webhook-7',
      body: 'not-json',
    });
    const res = makeMockResponse();

    const handled = await router.handle(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(202);

    await new Promise((resolve) => setImmediate(resolve));
    expect(engine.executeWorkflow).toHaveBeenCalledWith('wf-webhook-7', {});
  });
});
