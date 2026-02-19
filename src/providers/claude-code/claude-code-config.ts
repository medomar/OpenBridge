import { z } from 'zod';

export const ClaudeCodeConfigSchema = z.object({
  workspacePath: z.string().default('.'),
  maxTokens: z.number().positive().default(4096),
  timeout: z.number().positive().default(120_000), // 2 minutes
});

export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfigSchema>;
