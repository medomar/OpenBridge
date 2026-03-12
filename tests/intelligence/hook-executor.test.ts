import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ensureDocTypeStoreSchema, createDocType } from '../../src/intelligence/doctype-store.js';
import {
  executeHooks,
  registerHookHandler,
  registerStripeAdapter,
} from '../../src/intelligence/hook-executor.js';
import type { DocType } from '../../src/types/doctype.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const DOCTYPE: DocType = {
  id: 'dt-invoice',
  name: 'invoice',
  label_singular: 'Invoice',
  label_plural: 'Invoices',
  table_name: 'dt_invoice',
  source: 'ai-created',
};

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  ensureDocTypeStoreSchema(db);
  // Register the DocType so FK constraints pass when inserting hooks
  createDocType(db, { doctype: DOCTYPE, transitions: [], hooks: [] });
  return db;
}

function insertHook(
  db: Database.Database,
  params: {
    id?: string;
    doctype_id?: string;
    event: string;
    action_type: string;
    action_config?: Record<string, unknown>;
    sort_order?: number;
    enabled?: number;
  },
): void {
  db.prepare(
    `INSERT INTO doctype_hooks (id, doctype_id, event, action_type, action_config, sort_order, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    params.id ?? `hook-${Math.random()}`,
    params.doctype_id ?? DOCTYPE.id,
    params.event,
    params.action_type,
    JSON.stringify(params.action_config ?? {}),
    params.sort_order ?? 0,
    params.enabled ?? 1,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeHooks', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('returns immediately when no matching hooks exist', async () => {
    // No hooks inserted — should not throw
    await expect(executeHooks(db, DOCTYPE, 'create', {}, 'before')).resolves.toBeUndefined();
  });

  it('skips disabled hooks', async () => {
    const handler = vi.fn();
    registerHookHandler('update_field', handler);

    insertHook(db, { event: 'before_create', action_type: 'update_field', enabled: 0 });

    await executeHooks(db, DOCTYPE, 'create', {}, 'before');

    expect(handler).not.toHaveBeenCalled();
  });

  it('only executes hooks matching timing + event', async () => {
    const handler = vi.fn();
    registerHookHandler('update_field', handler);

    insertHook(db, { event: 'after_create', action_type: 'update_field' });

    // before_create — should NOT fire the after_create hook
    await executeHooks(db, DOCTYPE, 'create', {}, 'before');
    expect(handler).not.toHaveBeenCalled();

    // after_create — should fire
    await executeHooks(db, DOCTYPE, 'create', {}, 'after');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('executes hooks in sort_order', async () => {
    const calls: number[] = [];

    registerHookHandler('update_field', async (hook) => {
      calls.push(hook.sort_order);
    });

    insertHook(db, {
      id: 'h3',
      event: 'before_update',
      action_type: 'update_field',
      sort_order: 3,
    });
    insertHook(db, {
      id: 'h1',
      event: 'before_update',
      action_type: 'update_field',
      sort_order: 1,
    });
    insertHook(db, {
      id: 'h2',
      event: 'before_update',
      action_type: 'update_field',
      sort_order: 2,
    });

    await executeHooks(db, DOCTYPE, 'update', {}, 'before');

    expect(calls).toEqual([1, 2, 3]);
  });

  it('continues executing remaining hooks when one hook throws', async () => {
    const results: string[] = [];

    registerHookHandler('update_field', async (hook) => {
      const config = hook.action_config;
      if (config['fail']) throw new Error('Intentional hook failure');
      results.push((config['label'] as string | undefined) ?? 'unknown');
    });

    insertHook(db, {
      id: 'h1',
      event: 'before_create',
      action_type: 'update_field',
      action_config: { label: 'first' },
      sort_order: 1,
    });
    insertHook(db, {
      id: 'h2',
      event: 'before_create',
      action_type: 'update_field',
      action_config: { fail: true },
      sort_order: 2,
    });
    insertHook(db, {
      id: 'h3',
      event: 'before_create',
      action_type: 'update_field',
      action_config: { label: 'third' },
      sort_order: 3,
    });

    // Should not reject
    await expect(executeHooks(db, DOCTYPE, 'create', {}, 'before')).resolves.toBeUndefined();

    // First and third hooks ran; second was skipped due to error
    expect(results).toEqual(['first', 'third']);
  });

  it('skips hooks with unknown action_type without throwing', async () => {
    insertHook(db, { event: 'before_create', action_type: 'run_workflow' });
    await expect(executeHooks(db, DOCTYPE, 'create', {}, 'before')).resolves.toBeUndefined();
  });

  it('passes db and record to the handler', async () => {
    let capturedRecord: Record<string, unknown> | null = null;
    let capturedDb: unknown = null;

    registerHookHandler('update_field', async (hook, record, hookDb) => {
      capturedRecord = record;
      capturedDb = hookDb;
    });

    const record = { id: 'rec-1', total: 500 };
    insertHook(db, { event: 'after_transition', action_type: 'update_field' });

    await executeHooks(db, DOCTYPE, 'transition', record, 'after');

    expect(capturedRecord).toBe(record);
    expect(capturedDb).toBe(db);
  });

  it('constructs event key as `timing_event`', async () => {
    let firedEvent = '';

    registerHookHandler('update_field', async (hook) => {
      firedEvent = hook.event;
    });

    insertHook(db, { event: 'before_delete', action_type: 'update_field' });

    await executeHooks(db, DOCTYPE, 'delete', {}, 'before');

    expect(firedEvent).toBe('before_delete');
  });
});

describe('create_payment_link hook', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => {
    // Reset Stripe adapter between tests
    registerStripeAdapter(undefined);
  });

  it('logs warning and skips when Stripe adapter is not registered', async () => {
    insertHook(db, {
      event: 'after_transition',
      action_type: 'create_payment_link',
      action_config: {
        amount_field: 'total',
        description_field: 'description',
        output_field: 'payment_url',
      },
    });

    const record: Record<string, unknown> = { total: 5000, description: 'Invoice #1' };
    await expect(executeHooks(db, DOCTYPE, 'transition', record, 'after')).resolves.toBeUndefined();

    // output_field should remain unset since adapter is not registered
    expect(record['payment_url']).toBeUndefined();
  });

  it('calls Stripe adapter and stores payment URL in output_field', async () => {
    const createPaymentLink = vi.fn().mockResolvedValue('https://buy.stripe.com/test_link');
    registerStripeAdapter({ createPaymentLink });

    insertHook(db, {
      event: 'after_transition',
      action_type: 'create_payment_link',
      action_config: {
        amount_field: 'amount',
        description_field: 'label',
        output_field: 'stripe_url',
      },
    });

    const record: Record<string, unknown> = { amount: 9900, label: 'Order #42' };
    await executeHooks(db, DOCTYPE, 'transition', record, 'after');

    expect(createPaymentLink).toHaveBeenCalledWith(9900, 'Order #42');
    expect(record['stripe_url']).toBe('https://buy.stripe.com/test_link');
  });

  it('skips and logs warning when amount_field is missing from config', async () => {
    const createPaymentLink = vi.fn();
    registerStripeAdapter({ createPaymentLink });

    insertHook(db, {
      event: 'after_transition',
      action_type: 'create_payment_link',
      action_config: { description_field: 'label', output_field: 'stripe_url' },
    });

    const record: Record<string, unknown> = { label: 'Order #42' };
    await expect(executeHooks(db, DOCTYPE, 'transition', record, 'after')).resolves.toBeUndefined();
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it('skips and logs warning when amount field value is not numeric', async () => {
    const createPaymentLink = vi.fn();
    registerStripeAdapter({ createPaymentLink });

    insertHook(db, {
      event: 'after_transition',
      action_type: 'create_payment_link',
      action_config: {
        amount_field: 'total',
        description_field: 'label',
        output_field: 'stripe_url',
      },
    });

    const record: Record<string, unknown> = { total: 'not-a-number', label: 'Order #42' };
    await expect(executeHooks(db, DOCTYPE, 'transition', record, 'after')).resolves.toBeUndefined();
    expect(createPaymentLink).not.toHaveBeenCalled();
  });

  it('uses empty string for description when description field is missing from record', async () => {
    const createPaymentLink = vi.fn().mockResolvedValue('https://buy.stripe.com/empty_desc');
    registerStripeAdapter({ createPaymentLink });

    insertHook(db, {
      event: 'after_transition',
      action_type: 'create_payment_link',
      action_config: {
        amount_field: 'total',
        description_field: 'desc',
        output_field: 'stripe_url',
      },
    });

    // 'desc' field is absent from the record
    const record: Record<string, unknown> = { total: 1000 };
    await executeHooks(db, DOCTYPE, 'transition', record, 'after');

    expect(createPaymentLink).toHaveBeenCalledWith(1000, '');
    expect(record['stripe_url']).toBe('https://buy.stripe.com/empty_desc');
  });
});
