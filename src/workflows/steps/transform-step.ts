import { z } from 'zod/v3';
import { createLogger } from '../../core/logger.js';
import type { StepResult } from '../../types/workflow.js';

const logger = createLogger('transform-step');

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const TransformConfigSchema = z
  .object({
    /** Aggregate: compute count/sum/average over a records array */
    aggregate: z
      .object({
        operation: z.enum(['count', 'sum', 'average']),
        /** Field to sum/average (not required for count) */
        field: z.string().optional(),
        /** Output key in json; defaults to operation name */
        output_key: z.string().optional(),
      })
      .optional(),
    /** Filter: keep only records matching a condition */
    filter: z
      .object({
        field: z.string(),
        operator: z
          .enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains'])
          .default('eq'),
        value: z.unknown(),
      })
      .optional(),
    /** Sort: order records by a field */
    sort: z
      .object({
        field: z.string(),
        direction: z.enum(['asc', 'desc']).default('asc'),
      })
      .optional(),
    /** Map: project/rename fields in each record */
    map: z.record(z.string()).optional(),
  })
  .strict();

export type TransformConfig = z.infer<typeof TransformConfigSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getRecords(json: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(json['records'])) {
    return json['records'] as Record<string, unknown>[];
  }
  return [];
}

function compareValues(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case 'eq':
      return actual === expected;
    case 'ne':
      return actual !== expected;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'contains':
      return (
        typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
      );
    case 'not_contains':
      return (
        typeof actual === 'string' && typeof expected === 'string' && !actual.includes(expected)
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------

/**
 * Execute a transform step: apply data transformations (aggregate, filter,
 * sort, map) to the records array in the incoming StepResult.
 *
 * Transformations are applied in order: filter → sort → map → aggregate.
 *
 * @param config - Transform configuration
 * @param input  - Incoming data envelope from the previous step
 * @returns A StepResult with the transformed data
 */
// eslint-disable-next-line @typescript-eslint/require-await -- synchronous work; async signature matches step interface
export async function executeTransformStep(
  config: {
    aggregate?: { operation: string; field?: string; output_key?: string };
    filter?: { field: string; operator?: string; value: unknown };
    sort?: { field: string; direction?: string };
    map?: Record<string, string>;
  },
  input: StepResult,
): Promise<StepResult> {
  const parsed = TransformConfigSchema.parse(config);
  let records = getRecords(input.json);

  // 1. Filter
  if (parsed.filter) {
    const { field, operator, value } = parsed.filter;
    records = records.filter((r) => compareValues(r[field], operator, value));
    logger.debug({ field, operator, count: records.length }, 'Filter applied');
  }

  // 2. Sort
  if (parsed.sort) {
    const { field, direction } = parsed.sort;
    records = [...records].sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      const cmp = av < bv ? -1 : 1;
      return direction === 'desc' ? -cmp : cmp;
    });
    logger.debug({ field, direction }, 'Sort applied');
  }

  // 3. Map (project fields)
  if (parsed.map && Object.keys(parsed.map).length > 0) {
    const mapping = parsed.map;
    records = records.map((r) => {
      const projected: Record<string, unknown> = {};
      for (const [targetKey, sourceKey] of Object.entries(mapping)) {
        projected[targetKey] = r[sourceKey] ?? null;
      }
      return projected;
    });
    logger.debug({ keys: Object.keys(parsed.map) }, 'Map applied');
  }

  // 4. Aggregate (reduces records to a scalar)
  if (parsed.aggregate) {
    const { operation, field, output_key } = parsed.aggregate;
    const outKey = output_key ?? operation;
    let aggregateValue: number;

    switch (operation) {
      case 'count':
        aggregateValue = records.length;
        break;
      case 'sum': {
        if (!field) {
          logger.warn('sum aggregate requires a field');
          aggregateValue = 0;
        } else {
          aggregateValue = records.reduce((acc, r) => {
            const v = r[field];
            return acc + (typeof v === 'number' ? v : 0);
          }, 0);
        }
        break;
      }
      case 'average': {
        if (!field || records.length === 0) {
          aggregateValue = 0;
        } else {
          const sum = records.reduce((acc, r) => {
            const v = r[field];
            return acc + (typeof v === 'number' ? v : 0);
          }, 0);
          aggregateValue = sum / records.length;
        }
        break;
      }
      default:
        aggregateValue = 0;
    }

    logger.debug({ operation, field, result: aggregateValue }, 'Aggregate applied');
    return {
      json: { ...input.json, records, [outKey]: aggregateValue },
      files: input.files,
    };
  }

  return {
    json: { ...input.json, records },
    files: input.files,
  };
}
