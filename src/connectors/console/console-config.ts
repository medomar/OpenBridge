import { z } from 'zod';

export const ConsoleConfigSchema = z.object({
  /** Identifier for the console user (used as sender in messages) */
  userId: z.string().default('console-user'),
  /** Prompt string shown before user input */
  prompt: z.string().default('> '),
});

export type ConsoleConfig = z.infer<typeof ConsoleConfigSchema>;
