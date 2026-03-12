import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { ensureDocTypeStoreSchema, createDocType } from '../../src/intelligence/doctype-store.js';
import { executeHooks, registerHookHandler } from '../../src/intelligence/hook-executor.js';
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
