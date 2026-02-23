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

export interface ExecutionOptions {
  prompt: string;
  workspacePath: string;
  timeout: number;
  /** Resume an existing conversation session */
  resumeSessionId?: string;
  /** Start a new conversation with a specific session ID */
  sessionId?: string;
}

/** Execute a Claude Code CLI command in a given workspace */
export function executeClaudeCode(
  promptOrOptions: string | ExecutionOptions,
  workspacePath?: string,
  timeout?: number,
): Promise<ExecutionResult> {
  return new Promise((resolve, reject) => {
    let opts: ExecutionOptions;

    if (typeof promptOrOptions === 'string') {
      opts = {
        prompt: promptOrOptions,
        workspacePath: workspacePath!,
        timeout: timeout!,
      };
    } else {
      opts = promptOrOptions;
    }

    const sanitized = sanitizePrompt(opts.prompt);
    const args = ['--print'];

    if (opts.resumeSessionId) {
      args.push('--resume', opts.resumeSessionId);
    } else if (opts.sessionId) {
      args.push('--session-id', opts.sessionId);
    }

    args.push(sanitized);

    logger.debug(
      {
        workspacePath: opts.workspacePath,
        timeout: opts.timeout,
        sessionId: opts.resumeSessionId ?? opts.sessionId,
      },
      'Executing Claude Code CLI',
    );

    const child = spawn('claude', args, {
      cwd: opts.workspacePath,
      timeout: opts.timeout,
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

export interface StreamResult {
  exitCode: number;
  stderr: string;
}

/**
 * Execute Claude Code CLI and stream stdout chunks as they arrive.
 *
 * Yields each stdout data chunk as a string instead of buffering the entire
 * response. This prevents timeout risk for long AI responses and allows the
 * caller to forward partial output incrementally.
 */
export async function* streamClaudeCode(
  promptOrOptions: string | ExecutionOptions,
  workspacePath?: string,
  timeout?: number,
): AsyncGenerator<string, StreamResult> {
  let opts: ExecutionOptions;

  if (typeof promptOrOptions === 'string') {
    opts = {
      prompt: promptOrOptions,
      workspacePath: workspacePath!,
      timeout: timeout!,
    };
  } else {
    opts = promptOrOptions;
  }

  const sanitized = sanitizePrompt(opts.prompt);
  const args = ['--print'];

  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  } else if (opts.sessionId) {
    args.push('--session-id', opts.sessionId);
  }

  args.push(sanitized);

  logger.debug(
    {
      workspacePath: opts.workspacePath,
      timeout: opts.timeout,
      sessionId: opts.resumeSessionId ?? opts.sessionId,
    },
    'Streaming Claude Code CLI',
  );

  const child = spawn('claude', args, {
    cwd: opts.workspacePath,
    timeout: opts.timeout,
    env: { ...process.env },
  });

  let stderr = '';

  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  // Queue-based async iteration: stdout chunks are pushed here and drained by the generator
  const chunks: string[] = [];
  let done = false;
  let exitCode = 1;
  let spawnError: Error | undefined;

  let notify: (() => void) | undefined;
  function waitForData(): Promise<void> {
    return new Promise<void>((resolve) => {
      notify = resolve;
    });
  }

  child.stdout.on('data', (data: Buffer) => {
    chunks.push(data.toString());
    notify?.();
  });

  child.on('close', (code) => {
    exitCode = code ?? 1;
    done = true;
    notify?.();
  });

  child.on('error', (error) => {
    logger.error({ error }, 'Claude Code streaming error');
    spawnError = error;
    done = true;
    notify?.();
  });

  while (!done || chunks.length > 0) {
    if (chunks.length > 0) {
      yield chunks.shift()!;
    } else if (!done) {
      await waitForData();
    }
  }

  if (spawnError) {
    throw spawnError;
  }

  return { exitCode, stderr };
}
