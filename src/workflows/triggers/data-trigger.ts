import { createLogger } from '../../core/logger.js';
import type { Workflow } from '../../types/workflow.js';

const logger = createLogger('data-trigger');

// ---------------------------------------------------------------------------
// Condition parsing
// ---------------------------------------------------------------------------

/**
 * Supported condition prefixes for data triggers.
 *
 *   changed_to:<value>   — field was NOT <value> in old record, IS <value> in new record
 *   changed_from:<value> — field WAS <value> in old record, is NOT <value> in new record
 *   changed              — field has any different value between old and new records
 *   equals:<value>       — field equals <value> in the new record (regardless of old)
 *   not_equals:<value>   — field does NOT equal <value> in the new record
 */
type ConditionType = 'changed_to' | 'changed_from' | 'changed' | 'equals' | 'not_equals';

interface ParsedCondition {
  type: ConditionType;
  value?: string;
}

function parseCondition(raw: string): ParsedCondition | null {
  const trimmed = raw.trim();

  if (trimmed === 'changed') {
    return { type: 'changed' };
  }

  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) {
    logger.debug({ condition: raw }, 'Data trigger condition has no colon — not recognised');
    return null;
  }

  const prefix = trimmed.slice(0, colonIdx);
  const value = trimmed.slice(colonIdx + 1);

  switch (prefix) {
    case 'changed_to':
      return { type: 'changed_to', value };
    case 'changed_from':
      return { type: 'changed_from', value };
    case 'equals':
      return { type: 'equals', value };
    case 'not_equals':
      return { type: 'not_equals', value };
    default:
      logger.debug({ prefix, condition: raw }, 'Data trigger condition prefix not recognised');
      return null;
  }
}

// ---------------------------------------------------------------------------
// Field value resolution
// ---------------------------------------------------------------------------

function fieldToString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluates whether a workflow's data trigger condition is satisfied by a
 * record state change.
 *
 * Returns `true` when all of the following are satisfied:
 *   1. `workflow.trigger.type` is `'data'`
 *   2. `workflow.trigger.field` is set
 *   3. `workflow.trigger.condition` is set and matches the field transition
 *
 * @param workflow   - Workflow definition with a data trigger configuration
 * @param oldRecord  - Record state before the change (field values as key/value)
 * @param newRecord  - Record state after the change (field values as key/value)
 * @returns `true` if the trigger condition is satisfied, `false` otherwise
 */
export function evaluateDataTrigger(
  workflow: Workflow,
  oldRecord: Record<string, unknown>,
  newRecord: Record<string, unknown>,
): boolean {
  const { trigger } = workflow;

  if (trigger.type !== 'data') {
    return false;
  }

  const field = trigger.field;
  if (!field) {
    logger.debug({ workflowId: workflow.id }, 'Data trigger has no field configured');
    return false;
  }

  const conditionRaw = trigger.condition;
  if (!conditionRaw) {
    logger.debug({ workflowId: workflow.id }, 'Data trigger has no condition configured');
    return false;
  }

  const parsed = parseCondition(conditionRaw);
  if (!parsed) {
    logger.warn(
      { workflowId: workflow.id, condition: conditionRaw },
      'Data trigger condition could not be parsed — skipping',
    );
    return false;
  }

  const oldVal = fieldToString(oldRecord[field]);
  const newVal = fieldToString(newRecord[field]);

  let matched: boolean;

  switch (parsed.type) {
    case 'changed':
      matched = oldVal !== newVal;
      break;

    case 'changed_to':
      matched = oldVal !== parsed.value && newVal === parsed.value;
      break;

    case 'changed_from':
      matched = oldVal === parsed.value && newVal !== parsed.value;
      break;

    case 'equals':
      matched = newVal === parsed.value;
      break;

    case 'not_equals':
      matched = newVal !== parsed.value;
      break;

    default:
      matched = false;
  }

  logger.debug(
    {
      workflowId: workflow.id,
      field,
      condition: conditionRaw,
      oldVal,
      newVal,
      matched,
    },
    'Data trigger evaluated',
  );

  return matched;
}
