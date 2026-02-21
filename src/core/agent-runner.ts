import { spawn as nodeSpawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createLogger } from './logger.js';
import { BUILT_IN_PROFILES } from '../types/agent.js';
import type { TaskManifest, ToolProfile } from '../types/agent.js';

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
 * Model fallback chain: opus → sonnet → haiku.
 * If the preferred model is unavailable or rate-limited, the runner
 * falls back to the next model in the chain before retrying.
 */
export const MODEL_FALLBACK_CHAIN: Record<string, string | undefined> = {
  opus: 'sonnet',
  sonnet: 'haiku',
  haiku: undefined, // no further fallback
};

/**
 * Heuristic patterns that indicate a rate-limit or model-unavailability error.
 * Matched case-insensitively against stderr output.
 */
const RATE_LIMIT_PATTERNS = [
  'rate limit',
  'rate_limit',
  'too many requests',
  '429',
  'overloaded',
  'capacity',
  'unavailable',
  'model_not_available',
];

/**
 * Check whether the stderr output from a failed attempt indicates a rate-limit
 * or model-unavailability error that warrants falling back to a different model.
 */
export function isRateLimitError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return RATE_LIMIT_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Get the next model in the fallback chain for a given model.
 * Returns undefined if there is no further fallback (haiku is the end of the chain).
 * For unknown models (full model IDs), falls back to sonnet as a safe default.
 */
export function getNextFallbackModel(currentModel: string): string | undefined {
  return MODEL_FALLBACK_CHAIN[currentModel] ?? (currentModel === 'haiku' ? undefined : 'sonnet');
}

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
 * Resolve a profile name to its tool list.
 * Checks custom profiles first (if provided), then falls back to built-in profiles.
 * Returns undefined if the profile name is not recognized in either source.
 */
export function resolveProfile(
  profileName: string,
  customProfiles?: Record<string, ToolProfile>,
): string[] | undefined {
  if (customProfiles) {
    const custom = customProfiles[profileName];
    if (custom) return custom.tools;
  }
  const profile = BUILT_IN_PROFILES[profileName as keyof typeof BUILT_IN_PROFILES];
  return profile?.tools;
}

/**
 * Convert a TaskManifest into SpawnOptions.
 *
 * Resolution rules:
 * - If `allowedTools` is provided explicitly, it takes priority over `profile`
 * - If only `profile` is provided, resolve it via custom profiles then built-in
 * - If neither is provided, no tools restriction is applied
 * - All other fields map directly to SpawnOptions equivalents
 */
export function manifestToSpawnOptions(
  manifest: TaskManifest,
  customProfiles?: Record<string, ToolProfile>,
): SpawnOptions {
  let allowedTools: string[] | undefined = manifest.allowedTools;

  if (!allowedTools && manifest.profile) {
    const resolved = resolveProfile(manifest.profile, customProfiles);
    if (resolved) {
      allowedTools = resolved;
    } else {
      logger.warn(
        { profile: manifest.profile },
        'Unknown profile name — no tools restriction applied',
      );
    }
  }

  return {
    prompt: manifest.prompt,
    workspacePath: manifest.workspacePath,
    model: manifest.model,
    allowedTools,
    maxTurns: manifest.maxTurns,
    timeout: manifest.timeout,
    retries: manifest.retries,
    retryDelay: manifest.retryDelay,
  };
}

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
  /** System prompt to append to the default Claude system prompt */
  systemPrompt?: string;
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
  /** Models that were tried and fell back from due to rate limits, in order */
  modelFallbacks?: string[];
}

/** Record of a single execution attempt (used for aggregated error reporting) */
export interface AttemptRecord {
  attempt: number;
  exitCode: number;
  stderr: string;
}

/**
 * Error thrown when all retry attempts are exhausted.
 * Contains aggregated details from every attempt so callers can inspect
 * what went wrong across the full retry sequence.
 */
export class AgentExhaustedError extends Error {
  readonly attempts: AttemptRecord[];
  readonly lastExitCode: number;
  readonly totalAttempts: number;
  readonly durationMs: number;

  constructor(attempts: AttemptRecord[], durationMs: number) {
    const total = attempts.length;
    const lastExit = attempts[total - 1]?.exitCode ?? 1;
    const summary = attempts
      .map(
        (a) =>
          `  attempt ${a.attempt}: exit ${a.exitCode}` +
          (a.stderr ? ` — ${a.stderr.slice(0, 200)}` : ''),
      )
      .join('\n');
    super(`Agent failed after ${total} attempt(s) (last exit code ${lastExit}):\n${summary}`);
    this.name = 'AgentExhaustedError';
    this.attempts = attempts;
    this.lastExitCode = lastExit;
    this.totalAttempts = total;
    this.durationMs = durationMs;
  }
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

  if (opts.systemPrompt) {
    args.push('--append-system-prompt', opts.systemPrompt);
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

/**
 * Write a log file with a header and full stdout/stderr output.
 * Creates the parent directory if it doesn't exist.
 */
async function writeLogFile(
  logFile: string,
  opts: SpawnOptions,
  result: AgentResult,
): Promise<void> {
  const header = [
    `# Agent Run Log`,
    `# Timestamp: ${new Date().toISOString()}`,
    `# Model: ${opts.model ?? 'default'}`,
    `# Tools: ${opts.allowedTools?.join(', ') ?? 'none specified'}`,
    `# Max Turns: ${opts.maxTurns ?? DEFAULT_MAX_TURNS_TASK}`,
    `# Prompt Length: ${opts.prompt.length}`,
    `# Exit Code: ${result.exitCode}`,
    `# Duration: ${result.durationMs}ms`,
    `# Retries: ${result.retryCount}`,
    '',
    '--- STDOUT ---',
    result.stdout,
    '',
    '--- STDERR ---',
    result.stderr,
  ].join('\n');

  await mkdir(dirname(logFile), { recursive: true });
  await writeFile(logFile, header, 'utf-8');
}

/** Execute a single agent attempt in streaming mode. Yields stdout chunks. */
function execOnceStreaming(
  args: string[],
  workspacePath: string,
  timeout?: number,
): {
  chunks: AsyncGenerator<string, { exitCode: number; stderr: string }>;
  abort: () => void;
} {
  const child = nodeSpawn('claude', args, {
    cwd: workspacePath,
    timeout,
    env: { ...process.env },
  });

  let stderr = '';

  child.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  const chunkQueue: string[] = [];
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
    chunkQueue.push(data.toString());
    notify?.();
  });

  child.on('close', (code) => {
    exitCode = code ?? 1;
    done = true;
    notify?.();
  });

  child.on('error', (error) => {
    logger.error({ error }, 'Agent streaming error');
    spawnError = error;
    done = true;
    notify?.();
  });

  async function* generate(): AsyncGenerator<string, { exitCode: number; stderr: string }> {
    while (!done || chunkQueue.length > 0) {
      if (chunkQueue.length > 0) {
        yield chunkQueue.shift()!;
      } else if (!done) {
        await waitForData();
      }
    }

    if (spawnError) {
      throw spawnError;
    }

    return { exitCode, stderr };
  }

  return {
    chunks: generate(),
    abort: (): void => {
      child.kill('SIGTERM');
    },
  };
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
    let currentModel = opts.model;
    let currentArgs = buildArgs(opts);
    const startTime = Date.now();
    const modelFallbacks: string[] = [];

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
    const attemptRecords: AttemptRecord[] = [];

    for (attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        logger.warn(
          { attempt, maxRetries: retries, delay: retryDelay },
          'Retrying agent after non-zero exit',
        );
        await sleep(retryDelay);
      }

      try {
        lastResult = await execOnce(currentArgs, opts.workspacePath, opts.timeout);
      } catch (error) {
        logger.error({ error, attempt }, 'Agent spawn error');
        attemptRecords.push({
          attempt,
          exitCode: -1,
          stderr: error instanceof Error ? error.message : String(error),
        });
        if (attempt < retries) {
          continue;
        }
        throw new AgentExhaustedError(attemptRecords, Date.now() - startTime);
      }

      if (lastResult.exitCode === 0) {
        break;
      }

      logger.warn(
        { exitCode: lastResult.exitCode, attempt, stderr: lastResult.stderr.slice(0, 500) },
        'Agent exited with non-zero code',
      );

      attemptRecords.push({
        attempt,
        exitCode: lastResult.exitCode,
        stderr: lastResult.stderr,
      });

      // Check for rate-limit / model unavailability — fall back to next model
      if (currentModel && isRateLimitError(lastResult.stderr) && attempt < retries) {
        const nextModel = getNextFallbackModel(currentModel);
        if (nextModel) {
          logger.warn(
            { from: currentModel, to: nextModel, attempt },
            'Model rate-limited — falling back to next model in chain',
          );
          modelFallbacks.push(currentModel);
          currentModel = nextModel;
          currentArgs = buildArgs({ ...opts, model: currentModel });
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const retryCount = Math.min(attempt, retries);

    // If we exited the loop without a success, throw aggregated error
    if (!lastResult || lastResult.exitCode !== 0) {
      throw new AgentExhaustedError(attemptRecords, durationMs);
    }

    const result: AgentResult = {
      stdout: lastResult.stdout,
      stderr: lastResult.stderr,
      exitCode: lastResult.exitCode,
      durationMs,
      retryCount,
      model: currentModel,
      modelFallbacks: modelFallbacks.length > 0 ? modelFallbacks : undefined,
    };

    logger.info(
      {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        model: result.model ?? 'default',
        retryCount: result.retryCount,
        modelFallbacks: result.modelFallbacks,
      },
      'Agent completed',
    );

    if (opts.logFile) {
      try {
        await writeLogFile(opts.logFile, opts, result);
        logger.debug({ logFile: opts.logFile }, 'Agent log written to disk');
      } catch (logError) {
        logger.warn({ logFile: opts.logFile, error: logError }, 'Failed to write agent log');
      }
    }

    return result;
  }

  /**
   * Stream a Claude CLI agent, yielding stdout chunks as they arrive.
   *
   * Supports all the same options as spawn() — allowedTools, maxTurns,
   * model, retries, disk logging. On non-zero exit codes, retries the
   * entire execution (previous chunks are discarded for that attempt).
   *
   * The generator's return value is an AgentResult with the accumulated
   * stdout from the successful attempt.
   */
  async *stream(opts: SpawnOptions): AsyncGenerator<string, AgentResult> {
    const retries = opts.retries ?? 3;
    const retryDelay = opts.retryDelay ?? 10_000;
    let currentModel = opts.model;
    let currentArgs = buildArgs(opts);
    const startTime = Date.now();
    const modelFallbacks: string[] = [];

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
      'Streaming agent',
    );

    const attemptRecords: AttemptRecord[] = [];
    let attempt = 0;

    for (attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) {
        logger.warn(
          { attempt, maxRetries: retries, delay: retryDelay },
          'Retrying stream after non-zero exit',
        );
        await sleep(retryDelay);
      }

      let stdout = '';
      let streamResult: { exitCode: number; stderr: string } | undefined;
      let spawnError: Error | undefined;

      try {
        const { chunks } = execOnceStreaming(currentArgs, opts.workspacePath, opts.timeout);

        // Drain all chunks — yield each one and accumulate stdout
        let iterResult = await chunks.next();
        while (!iterResult.done) {
          const chunk = iterResult.value;
          stdout += chunk;
          yield chunk;
          iterResult = await chunks.next();
        }

        streamResult = iterResult.value;
      } catch (error) {
        logger.error({ error, attempt }, 'Agent stream error');
        spawnError = error instanceof Error ? error : new Error(String(error));
      }

      if (spawnError) {
        attemptRecords.push({
          attempt,
          exitCode: -1,
          stderr: spawnError.message,
        });
        if (attempt < retries) {
          continue;
        }
        throw new AgentExhaustedError(attemptRecords, Date.now() - startTime);
      }

      if (streamResult!.exitCode === 0) {
        const durationMs = Date.now() - startTime;
        const retryCount = attempt;

        const result: AgentResult = {
          stdout,
          stderr: streamResult!.stderr,
          exitCode: 0,
          durationMs,
          retryCount,
          model: currentModel,
          modelFallbacks: modelFallbacks.length > 0 ? modelFallbacks : undefined,
        };

        logger.info(
          {
            exitCode: 0,
            durationMs,
            model: currentModel ?? 'default',
            retryCount,
            modelFallbacks: result.modelFallbacks,
          },
          'Stream completed',
        );

        if (opts.logFile) {
          try {
            await writeLogFile(opts.logFile, opts, result);
            logger.debug({ logFile: opts.logFile }, 'Stream log written to disk');
          } catch (logError) {
            logger.warn({ logFile: opts.logFile, error: logError }, 'Failed to write stream log');
          }
        }

        return result;
      }

      // Non-zero exit — record and possibly retry
      logger.warn(
        {
          exitCode: streamResult!.exitCode,
          attempt,
          stderr: streamResult!.stderr.slice(0, 500),
        },
        'Stream exited with non-zero code',
      );

      attemptRecords.push({
        attempt,
        exitCode: streamResult!.exitCode,
        stderr: streamResult!.stderr,
      });

      // Check for rate-limit / model unavailability — fall back to next model
      if (currentModel && isRateLimitError(streamResult!.stderr) && attempt < retries) {
        const nextModel = getNextFallbackModel(currentModel);
        if (nextModel) {
          logger.warn(
            { from: currentModel, to: nextModel, attempt },
            'Model rate-limited — falling back to next model in chain',
          );
          modelFallbacks.push(currentModel);
          currentModel = nextModel;
          currentArgs = buildArgs({ ...opts, model: currentModel });
        }
      }
    }

    // All retries exhausted
    throw new AgentExhaustedError(attemptRecords, Date.now() - startTime);
  }

  /**
   * Spawn a Claude CLI agent from a TaskManifest.
   *
   * Converts the manifest into SpawnOptions, resolving the `profile` field
   * into `--allowedTools` flags via custom profiles then built-in profiles.
   * If both `profile` and explicit `allowedTools` are provided, explicit wins.
   */
  async spawnFromManifest(
    manifest: TaskManifest,
    customProfiles?: Record<string, ToolProfile>,
  ): Promise<AgentResult> {
    return this.spawn(manifestToSpawnOptions(manifest, customProfiles));
  }

  /**
   * Stream a Claude CLI agent from a TaskManifest.
   *
   * Same as streamFromManifest but yields stdout chunks as they arrive.
   * Resolves `profile` to tools the same way as spawnFromManifest.
   */
  async *streamFromManifest(
    manifest: TaskManifest,
    customProfiles?: Record<string, ToolProfile>,
  ): AsyncGenerator<string, AgentResult> {
    return yield* this.stream(manifestToSpawnOptions(manifest, customProfiles));
  }
}
