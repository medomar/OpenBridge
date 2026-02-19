import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Resolve a leading `~` or `~/` in a path to the user's home directory.
 */
export function resolveTilde(filePath: string): string {
  if (filePath === '~') return homedir();
  if (filePath.startsWith('~/')) return resolve(homedir(), filePath.slice(2));
  return filePath;
}

export const ClaudeCodeConfigSchema = z.object({
  workspacePath: z.string().default('.').transform(resolveTilde),
  maxTokens: z.number().positive().default(4096),
  timeout: z.number().positive().default(120_000), // 2 minutes
});

export type ClaudeCodeConfig = z.infer<typeof ClaudeCodeConfigSchema>;
