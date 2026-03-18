import { z } from 'zod/v3';
import { createLogger } from '../../core/logger.js';
import type { StepResult } from '../../types/workflow.js';

const logger = createLogger('condition-step');

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const ConditionConfigSchema = z
  .object({
    /**
     * Expression to evaluate against the input data.
     * Supports simple comparisons: `field operator value`
     * e.g. "count > 0", "status == 'active'", "total >= 100"
     * Or boolean field reference: "has_errors"
     */
    if: z.string().min(1),
    /** 0-based step index to jump to when the condition is true */
    then: z.number().int().nonnegative(),
    /** 0-based step index to jump to when the condition is false */
    else: z.number().int().nonnegative(),
  })
  .strict();

export type ConditionConfig = z.infer<typeof ConditionConfigSchema>;

// ---------------------------------------------------------------------------
// Expression evaluator
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-path field reference from the input json.
 * e.g. "records.0.status" → input.json.records[0].status
 */
function resolveField(json: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = json;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current)) {
      const idx = Number(part);
      current = isNaN(idx) ? undefined : current[idx];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Parse a literal value from a string token.
 * Handles: quoted strings, numbers, booleans, null.
 */
function parseLiteral(token: string): unknown {
  const t = token.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  const num = Number(t);
  if (!isNaN(num) && t !== '') return num;
  return t;
}

const OPERATORS = ['>=', '<=', '!=', '==', '>', '<', 'contains', 'not_contains'] as const;

/**
 * Evaluate a simple infix expression: `<field> <operator> <value>`
 * Returns true/false. Falls back to boolean coercion for bare field references.
 */
function evaluateExpression(expression: string, json: Record<string, unknown>): boolean {
  const expr = expression.trim();

  // Try to match `field operator literal`
  for (const op of OPERATORS) {
    const idx = expr.indexOf(op);
    if (idx === -1) continue;

    const fieldPath = expr.slice(0, idx).trim();
    const rawValue = expr.slice(idx + op.length).trim();

    const actual = resolveField(json, fieldPath);
    const expected = parseLiteral(rawValue);

    switch (op) {
      case '==':
        return actual == expected; // intentional loose equality for user expressions
      case '!=':
        return actual != expected; // intentional loose equality for user expressions
      case '>':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      case '>=':
        return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
      case '<':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      case '<=':
        return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
      case 'contains':
        return (
          typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
        );
      case 'not_contains':
        return (
          typeof actual === 'string' && typeof expected === 'string' && !actual.includes(expected)
        );
    }
  }

  // Bare field reference — treat as boolean
  const value = resolveField(json, expr);
  return Boolean(value);
}

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------

/**
 * Evaluate a condition expression against the input data and return the
 * index of the next step to execute (if/else branching).
 *
 * @param config - Condition configuration with `if`, `then`, and `else`
 * @param input  - Incoming data envelope from the previous step
 * @returns `{ nextStep }` indicating which step index should execute next,
 *          plus the original input data passed through unchanged.
 */
// eslint-disable-next-line @typescript-eslint/require-await -- synchronous work; async signature matches step interface
export async function evaluateCondition(
  config: { if: string; then: number; else: number },
  input: StepResult,
): Promise<{ nextStep: number } & StepResult> {
  const parsed = ConditionConfigSchema.parse(config);
  const result = evaluateExpression(parsed.if, input.json);

  const nextStep = result ? parsed.then : parsed.else;

  logger.debug({ expression: parsed.if, result, nextStep }, 'Condition evaluated');

  return {
    nextStep,
    json: input.json,
    files: input.files,
  };
}
