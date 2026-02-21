import { spawn as nodeSpawn } from 'node:child_process';
import { createLogger } from './logger.js';

const logger = createLogger('agent-runner');

const MAX_PROMPT_LENGTH = 32_768;

/**
 * Default max-turns limits to prevent runaway agents.
 * Without --max-turns, Claude can make unlimited tool calls until
 * the process timeout kills it (OB-F14: exit code 143 / SIGTERM).
 */

/** Max turns for exploration tasks (file listing, classification) — fast, bounded */
export const DEFAULT_MAX_TURNS_EXPLORATION = 15;

/** Max turns for user-facing tasks (implementation, reasoning) — more room to work */
export const DEFAULT_MAX_TURNS_TASK = 25;

/**
 * Accepted model short names for the --model flag.
 * The Claude CLI accepts these directly (no need to resolve to full IDs).
 * Callers can also pass full model IDs like 'claude-sonnet-4-5-20250929'.
 */
export const MODEL_ALIASES = ['haiku', 'sonnet', 'opus'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

/**
 * Validate a model string.
 * Accepts known short aliases ('haiku', 'sonnet', 'opus') or full model IDs
 * matching the Claude naming pattern (e.g. 'claude-sonnet-4-5-20250929').
 * Returns true if valid, false otherwise.
 */
export function isValidModel(model: string): boolean {
  if (MODEL_ALIASES.includes(model as ModelAlias)) return true;
  // Full model IDs follow the pattern: claude-<variant>-<version>
  return /^claude-[a-z0-9]+-[a-z0-9._-]+$/.test(model);
}

/**
 * Tool group constants for --allowedTools.
 * Used instead of --dangerously-skip-permissions to give agents
 * only the tools they need for a given task type.
 */

/** Read-only tools — safe for exploration and information gathering */
export const TOOLS_READ_ONLY = ['Read', 'Glob', 'Grep'] as const;

/** Code editing tools — for implementation tasks that modify files */
export const TOOLS_CODE_EDIT = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(git:*)',
  'Bash(npm:*)',
  'Bash(npx:*)',
] as const;

/** Full access tools — unrestricted (use sparingly) */
export const TOOLS_FULL = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'] as const;

/**
 * Sanitize a user-supplied prompt before passing it to the CLI.
 *
 * Removes null bytes and ASCII control characters (except tab, newline, and
 * carriage return). Truncates to MAX_PROMPT_LENGTH to prevent resource
 * exhaustion. spawn() is used without shell: true, so shell metacharacters
 * are already safe.
 */
export function sanitizePrompt(prompt: string): string {
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

/** Options accepted by AgentRunner.spawn() */
export interface SpawnOptions {
  /** The prompt to send to the AI agent */
  prompt: string;
  /** Working directory for the agent */
  workspacePath: string;
  /** Model to use: 'haiku', 'sonnet', 'opus', or a full model ID */
  model?: string;
  /** List of tools the agent is allowed to use (passed as --allowedTools) */
  allowedTools?: string[];
  /** Maximum number of agentic turns before the agent stops */
  maxTurns?: number;
  /** Timeout in milliseconds for each individual attempt */
  timeout?: number;
  /** Number of retry attempts on non-zero exit codes (default: 3) */
  retries?: number;
  /** Delay in milliseconds between retry attempts (default: 10000) */
  retryDelay?: number;
  /** Path to write the full log output */
  logFile?: string;
  /** Resume an existing session */
  resumeSessionId?: string;
  /** Start a new conversation with a specific session ID */
  sessionId?: string;
}

/** Result returned from AgentRunner.spawn() */
export interface AgentResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  retryCount: number;
  /** The model that was requested (undefined = CLI default) */
  model?: string;
}

/** Build the CLI argument array from spawn options. */
export function buildArgs(opts: SpawnOptions): string[] {
  const args = ['--print'];

  if (opts.model) {
    if (!isValidModel(opts.model)) {
      logger.warn(
        { model: opts.model },
        'Unrecognized model — passing through to CLI, which may reject it',
      );
    }
    args.push('--model', opts.model);
  }

  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS_TASK;
  args.push('--max-turns', String(maxTurns));

  if (opts.allowedTools && opts.allowedTools.length > 0) {
    for (const tool of opts.allowedTools) {
      args.push('--allowedTools', tool);
    }
  }

  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  } else if (opts.sessionId) {
    args.push('--session-id', opts.sessionId);
  }

  args.push(sanitizePrompt(opts.prompt));

  return args;
}

/** Execute a single agent attempt. Returns stdout, stderr, exitCode. */
function execOnce(
  args: string[],
  workspacePath: string,
  timeout?: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn('claude', args, {
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
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class AgentRunner {
  /**
   * Spawn a Claude CLI agent with the given options.
   *
   * Builds CLI args from the options, executes the child process, and
   * retries on non-zero exit codes up to `retries` times with `retryDelay`
   * between attempts.
   */
  async spawn(opts: SpawnOptions): Promise<AgentResult> {
    const retries = opts.retries ?? 3;
    const retryDelay = opts.retryDelay ?? 10_000;
    const args = buildArgs(opts);
    const startTime = Date.now();

    logger.debug(
      {
        workspacePath: opts.workspacePath,
        model: opts.model,
        maxTurns: opts.maxTurns,
        allowedTools: opts.allowedTools,
        timeout: opts.timeout,
        retries,
        sessionId: opts.resumeSessionId ?? opts.sessionId,
      },
      'Spawning agent',
    );

    let lastResult: { stdout: string; stderr: string; exitCode: number } | undefined;
    let attempt = 0;

    for (attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        logger.warn(
          { attempt, maxRetries: retries, delay: retryDelay },
          'Retrying agent after non-zero exit',
        );
        await sleep(retryDelay);
      }

      try {
        lastResult = await execOnce(args, opts.workspacePath, opts.timeout);
      } catch (error) {
        logger.error({ error, attempt }, 'Agent spawn error');
        if (attempt < retries) {
          continue;
        }
        throw error;
      }

      if (lastResult.exitCode === 0) {
        break;
      }

      logger.warn(
        { exitCode: lastResult.exitCode, attempt, stderr: lastResult.stderr.slice(0, 500) },
        'Agent exited with non-zero code',
      );
    }

    const durationMs = Date.now() - startTime;
    const retryCount = Math.min(attempt, retries);

    const result: AgentResult = {
      stdout: lastResult?.stdout ?? '',
      stderr: lastResult?.stderr ?? '',
      exitCode: lastResult?.exitCode ?? 1,
      durationMs,
      retryCount,
      model: opts.model,
    };

    logger.info(
      {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        model: result.model ?? 'default',
        retryCount: result.retryCount,
      },
      'Agent completed',
    );

    return result;
  }
}
