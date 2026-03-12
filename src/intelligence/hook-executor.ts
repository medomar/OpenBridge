import type Database from 'better-sqlite3';
import type { DocType, DocTypeHook, HookActionType } from '../types/doctype.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('hook-executor');

// ---------------------------------------------------------------------------
// Hook row type for SQLite reads
// ---------------------------------------------------------------------------

interface HookRow {
  id: string;
  doctype_id: string;
  event: string;
  action_type: string;
  action_config: string;
  sort_order: number;
  enabled: number;
}

function rowToHook(row: HookRow): DocTypeHook {
  return {
    id: row.id,
    doctype_id: row.doctype_id,
    event: row.event,
    action_type: row.action_type as HookActionType,
    action_config: JSON.parse(row.action_config) as Record<string, unknown>,
    sort_order: row.sort_order,
    enabled: row.enabled === 1,
  };
}

// ---------------------------------------------------------------------------
// Hook handler dispatch map
// ---------------------------------------------------------------------------

/**
 * Handler function signature for a single hook type.
 * Returns void — side effects are applied directly to the record object.
 */
type HookHandler = (
  hook: DocTypeHook,
  record: Record<string, unknown>,
  db: Database.Database,
) => Promise<void> | void;

/**
 * Dispatch table: action_type → handler.
 *
 * Each handler is implemented in a dedicated task (OB-1377 through OB-1381).
 * Unknown types are handled by the fallback in executeHooks().
 */
const HOOK_HANDLERS: Partial<Record<HookActionType, HookHandler>> = {
  // OB-1377: generate_number — fills a naming-series field on create
  generate_number: handleNotImplemented('generate_number'),

  // OB-1378: update_field — evaluates an expression and sets a field
  update_field: handleNotImplemented('update_field'),

  // OB-1379: send_notification — sends a formatted message via a channel
  send_notification: handleNotImplemented('send_notification'),

  // OB-1380: generate_pdf — renders a PDF and stores the file path
  generate_pdf: handleNotImplemented('generate_pdf'),

  // OB-1381: create_payment_link — calls Stripe to generate a payment URL
  create_payment_link: handleNotImplemented('create_payment_link'),

  // OB-future: remaining action types
  run_workflow: handleNotImplemented('run_workflow'),
  call_integration: handleNotImplemented('call_integration'),
  spawn_worker: handleNotImplemented('spawn_worker'),
};

/**
 * Returns a stub handler that logs a "not yet implemented" warning and returns
 * without throwing, so it does not block other hooks in the sequence.
 */
function handleNotImplemented(actionType: string): HookHandler {
  return (_hook, _record, _db) => {
    logger.warn({ actionType }, 'Hook action type not yet implemented — skipping');
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute lifecycle hooks for a given (event, timing) combination.
 *
 * Loads hooks from the `doctype_hooks` metadata table filtered by:
 *   - `doctype_id` matches the given DocType
 *   - `event` matches `${timing}_${event}` (e.g. `before_create`, `after_transition`)
 *   - `enabled = 1`
 *   - Ordered by `sort_order` ASC
 *
 * Hooks are executed **sequentially** in sort_order. Errors are caught per hook
 * so that one failing hook does not prevent subsequent hooks from running.
 *
 * @param db      - better-sqlite3 Database instance (must have doctype_hooks table)
 * @param doctype - DocType definition (used for its `id`)
 * @param event   - Event name without timing prefix (e.g. `create`, `update`, `transition`)
 * @param record  - The current data record (may be mutated by before-hooks like generate_number)
 * @param timing  - Whether these are `before` or `after` hooks
 */
export async function executeHooks(
  db: Database.Database,
  doctype: DocType,
  event: string,
  record: Record<string, unknown>,
  timing: 'before' | 'after',
): Promise<void> {
  const fullEvent = `${timing}_${event}`;

  // Load hooks from the metadata table
  const rows = db
    .prepare(
      `SELECT * FROM doctype_hooks
       WHERE doctype_id = ? AND event = ? AND enabled = 1
       ORDER BY sort_order ASC`,
    )
    .all(doctype.id, fullEvent) as HookRow[];

  if (rows.length === 0) {
    logger.debug({ doctypeId: doctype.id, event: fullEvent }, 'No hooks to execute');
    return;
  }

  const hooks = rows.map(rowToHook);

  logger.debug(
    { doctypeId: doctype.id, event: fullEvent, hookCount: hooks.length },
    'Executing lifecycle hooks',
  );

  for (const hook of hooks) {
    logger.debug(
      { hookId: hook.id, actionType: hook.action_type, sortOrder: hook.sort_order },
      'Executing hook',
    );

    const handler = HOOK_HANDLERS[hook.action_type];

    if (!handler) {
      logger.warn(
        { hookId: hook.id, actionType: hook.action_type },
        'Unknown hook action_type — skipping',
      );
      continue;
    }

    try {
      await handler(hook, record, db);
      logger.debug({ hookId: hook.id, actionType: hook.action_type }, 'Hook executed successfully');
    } catch (err) {
      // Error isolation: log and continue — one failed hook must not block others
      logger.error(
        { err, hookId: hook.id, actionType: hook.action_type, doctypeId: doctype.id },
        'Hook execution failed — continuing with remaining hooks',
      );
    }
  }

  logger.debug(
    { doctypeId: doctype.id, event: fullEvent, hookCount: hooks.length },
    'All hooks processed',
  );
}

// ---------------------------------------------------------------------------
// Handler registration (used by sub-tasks OB-1377 through OB-1381)
// ---------------------------------------------------------------------------

/**
 * Register a handler for a specific hook action type.
 * Subsequent tasks (OB-1377+) call this to register their implementations,
 * overriding the default stub handlers.
 */
export function registerHookHandler(actionType: HookActionType, handler: HookHandler): void {
  HOOK_HANDLERS[actionType] = handler;
}

// Re-export the handler type for sub-task use
export type { HookHandler };
