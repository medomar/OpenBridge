import { z } from 'zod';
import { createLogger } from '../../core/logger.js';
import type { Workflow } from '../../types/workflow.js';

const logger = createLogger('message-trigger');

/**
 * Schema for parsed message trigger configuration
 */
export const MessageConfigSchema = z
  .object({
    command: z.string().min(1, 'Command pattern cannot be empty'),
  })
  .strict();

export type MessageConfig = z.infer<typeof MessageConfigSchema>;

/**
 * Matches an incoming command against a workflow's message trigger pattern.
 *
 * Patterns:
 *   - Exact match: `/report` matches exactly `/report`
 *   - Prefix match: `/report*` matches `/report`, `/report status`, `/report summary`, etc.
 *   - Wildcard: `*` matches any non-empty command
 *
 * @param workflow - The workflow to check
 * @param command - The incoming message command (e.g. `/report`)
 * @returns true if the command matches the trigger pattern, false otherwise
 */
export function matchMessageTrigger(workflow: Workflow, command: string): boolean {
  if (workflow.trigger.type !== 'message') {
    return false;
  }

  const pattern = workflow.trigger.command;
  if (!pattern) {
    logger.debug({ workflowId: workflow.id }, 'Message trigger has no command pattern configured');
    return false;
  }

  const trimmedCommand = command.trim();
  const trimmedPattern = pattern.trim();

  // Wildcard matches any non-empty command
  if (trimmedPattern === '*') {
    return trimmedCommand.length > 0;
  }

  // If pattern ends with *, it's a prefix match
  if (trimmedPattern.endsWith('*')) {
    const prefix = trimmedPattern.slice(0, -1);
    const matches = trimmedCommand.startsWith(prefix);

    logger.debug(
      {
        workflowId: workflow.id,
        pattern: trimmedPattern,
        command: trimmedCommand,
        matches,
      },
      'Message trigger prefix match evaluated',
    );

    return matches;
  }

  // Otherwise, exact match
  const matches = trimmedCommand === trimmedPattern;

  logger.debug(
    {
      workflowId: workflow.id,
      pattern: trimmedPattern,
      command: trimmedCommand,
      matches,
    },
    'Message trigger exact match evaluated',
  );

  return matches;
}

/**
 * Parses and validates message trigger configuration.
 * Extracts command pattern from the raw config.
 *
 * @param config - The raw configuration object
 * @returns Validated message configuration with command pattern
 * @throws ZodError if config is invalid
 */
export function parseMessageConfig(config: unknown): MessageConfig {
  return MessageConfigSchema.parse(config);
}
