import { spawn } from 'node:child_process';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('claude-executor');

const MAX_PROMPT_LENGTH = 32_768; // 32 KiB — guard against runaway input

/**
 * Sanitize a user-supplied prompt before passing it to the CLI.
 *
 * Removes null bytes and ASCII control characters (except tab, newline, and
 * carriage return which are legitimate whitespace). Truncates to
 * MAX_PROMPT_LENGTH characters to prevent resource exhaustion.
 *
 * Note: `spawn` is used without `shell: true`, so shell metacharacters are
 * already safe — they are passed as a literal argv element, not interpolated
 * by a shell. This function handles the remaining character-level concerns.
 */
export function sanitizePrompt(prompt: string): string {
  // Strip null bytes and non-printable control chars (U+0000–U+001F) except
  // horizontal tab (0x09), line feed (0x0A), and carriage return (0x0D).
  // eslint-disable-next-line no-control-regex
  const cleaned = prompt.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  if (cleaned.length > MAX_PROMPT_LENGTH) {
    logger.warn(
      { original: prompt.length, truncated: MAX_PROMPT_LENGTH },
      'Prompt truncated to maximum allowed length',
    );
    return cleaned.slice(0, MAX_PROMPT_LENGTH);
  }

  return cleaned;
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Execute a Claude Code CLI command in a given workspace */
export function executeClaudeCode(
  prompt: string,
  workspacePath: string,
  timeout: number,
): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    const sanitized = sanitizePrompt(prompt);
    const args = ['--print', sanitized];

    logger.debug({ workspacePath, timeout }, 'Executing Claude Code CLI');

    const child = spawn('claude', args, {
      cwd: workspacePath,
      timeout,
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
      });
    });

    child.on('error', (error) => {
      logger.error({ error }, 'Claude Code execution error');
      reject(error);
    });
  });
}
