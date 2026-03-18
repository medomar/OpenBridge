import nodeCron from 'node-cron';
import { z } from 'zod/v3';
import { createLogger } from '../../core/logger.js';
import type { Workflow } from '../../types/workflow.js';

const logger = createLogger('schedule-trigger');

/**
 * Schema for parsed schedule trigger configuration
 */
export const ScheduleConfigSchema = z
  .object({
    cron: z.string().min(1, 'Cron expression cannot be empty'),
    timezone: z.string().optional(),
  })
  .strict();

export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;

/**
 * Matches a workflow to the schedule trigger type and validates the cron configuration.
 * Returns true if the workflow has a schedule trigger type and a valid cron expression.
 *
 * @param workflow - The workflow to check
 * @returns true if this is a valid schedule trigger, false otherwise
 */
export function matchScheduleTrigger(workflow: Workflow): boolean {
  if (workflow.trigger.type !== 'schedule') {
    return false;
  }

  const cronExpr = workflow.trigger.cron;
  if (!cronExpr) {
    logger.debug({ workflowId: workflow.id }, 'Schedule trigger missing cron expression');
    return false;
  }

  if (!nodeCron.validate(cronExpr)) {
    logger.debug({ workflowId: workflow.id, cron: cronExpr }, 'Invalid cron expression');
    return false;
  }

  return true;
}

/**
 * Parses and validates schedule trigger configuration.
 * Extracts cron expression and optional timezone from the raw config.
 *
 * @param config - The raw configuration object
 * @returns Validated schedule configuration with cron and optional timezone
 * @throws ZodError if config is invalid
 */
export function parseScheduleConfig(config: unknown): ScheduleConfig {
  const parsed = ScheduleConfigSchema.parse(config);

  // Additional validation: ensure cron expression is valid
  if (!nodeCron.validate(parsed.cron)) {
    throw new Error(`Invalid cron expression: ${parsed.cron}`);
  }

  return parsed;
}
