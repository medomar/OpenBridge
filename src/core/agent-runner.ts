import { spawn as nodeSpawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createLogger } from './logger.js';
import { BUILT_IN_PROFILES } from '../types/agent.js';
import type { TaskManifest, ToolProfile } from '../types/agent.js';
import type { ModelRegistry } from './model-registry.js';
import type { CLIAdapter, CLISpawnConfig } from './cli-adapter.js';
import { ClaudeAdapter } from './adapters/claude-adapter.js';

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
 * @deprecated Use ModelRegistry with capability tiers ('fast', 'balanced', 'powerful') instead.
 * Kept for backward compatibility — these are the Claude-specific aliases.
 */
export const MODEL_ALIASES = ['haiku', 'sonnet', 'opus'] as const;
export type ModelAlias = (typeof MODEL_ALIASES)[number];

/**
 * Model fallback chain: opus → sonnet → haiku.
 * @deprecated Use ModelRegistry.getFallback() for provider-agnostic fallback.
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
 * Patterns in stdout that indicate the Claude CLI hit its --max-turns limit.
 * Claude exits with code 0 when max-turns is reached, so we must scan stdout
 * to distinguish a complete run from a turn-budget exhaustion.
 * Matched case-insensitively against stdout.
 */
export const MAX_TURNS_PATTERNS = [
  'max turns reached',
  'maximum turns reached',
  'turn limit',
  'turn budget',
  'turns exhausted',
  'max_turns',
];

/**
 * Patterns indicating authentication / authorization failures.
 * These are non-retryable — retrying with the same credentials will fail again.
 */
const AUTH_PATTERNS = [
  'api key',
  'api_key',
  'invalid api',
  'unauthorized',
  'unauthenticated',
  'authentication failed',
  'permission denied',
  'access denied',
  'invalid token',
  'forbidden',
  '401',
  '403',
];

/**
 * Patterns indicating the prompt or context exceeded the model's context window.
 * These are non-retryable with the same prompt — the task must be split.
 */
const CONTEXT_OVERFLOW_PATTERNS = [
  'context too long',
  'context window',
  'context length',
  'context_length_exceeded',
  'prompt too long',
  'maximum context',
  'token limit',
  'too many tokens',
  'context overflow',
  'context_overflow',
];

/**
 * Categories of worker exit errors.
 * Used by callers to decide retry strategy:
 *   retryable:     'rate-limit', 'timeout', 'crash'
 *   non-retryable: 'auth', 'context-overflow', 'unknown'
 */
export type ErrorCategory =
  | 'rate-limit'
  | 'auth'
  | 'timeout'
  | 'crash'
  | 'context-overflow'
  | 'unknown';

/**
 * Check whether the stderr output from a failed attempt indicates a rate-limit
 * or model-unavailability error that warrants falling back to a different model.
 */
export function isRateLimitError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return RATE_LIMIT_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Check whether the stdout from a completed agent run indicates that the
 * Claude CLI hit its --max-turns limit. Claude exits with code 0 when
 * max-turns is reached, so we must inspect stdout to detect incomplete work.
 */
export function isMaxTurnsExhausted(stdout: string): boolean {
  const lower = stdout.toLowerCase();
  return MAX_TURNS_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Classify the category of a worker exit error from stderr output and exit code.
 *
 * Priority order (highest to lowest):
 *   1. rate-limit   — recoverable, retry with model fallback
 *   2. auth         — non-retryable, report to user
 *   3. context-overflow — non-retryable, split the task
 *   4. timeout      — exit code 143/137 or "timeout" in stderr
 *   5. crash        — any other non-zero exit
 *   6. unknown      — exit code 0 with unrecognised stderr
 */
export function classifyError(stderr: string, exitCode: number): ErrorCategory {
  const lower = stderr.toLowerCase();

  if (isRateLimitError(stderr)) return 'rate-limit';
  if (AUTH_PATTERNS.some((p) => lower.includes(p))) return 'auth';
  if (CONTEXT_OVERFLOW_PATTERNS.some((p) => lower.includes(p))) return 'context-overflow';
  if (exitCode === 143 || exitCode === 137 || lower.includes('timeout')) return 'timeout';
  if (exitCode !== 0) return 'crash';
  return 'unknown';
}

/**
 * Get the next model in the fallback chain for a given model.
 * If a ModelRegistry is provided, uses tier-aware fallback (provider-agnostic).
 * Otherwise falls back to the hardcoded Claude chain.
 */
export function getNextFallbackModel(
  currentModel: string,
  registry?: ModelRegistry,
): string | undefined {
  if (registry) {
    return registry.getFallback(currentModel);
  }
  return MODEL_FALLBACK_CHAIN[currentModel] ?? (currentModel === 'haiku' ? undefined : 'sonnet');
}

/**
 * Validate a model string.
 * If a ModelRegistry is provided, checks against registered models (provider-agnostic).
 * Otherwise falls back to Claude-specific validation.
 */
export function isValidModel(model: string, registry?: ModelRegistry): boolean {
  if (registry) {
    return registry.isValid(model);
  }
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
    maxBudgetUsd: manifest.maxBudgetUsd,
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
  /** Maximum spend in USD for this agent run (passed as --max-budget-usd) */
  maxBudgetUsd?: number;
}

/**
 * Estimate the cost in USD for a single agent call.
 * Uses a simple per-call heuristic scaled by output size:
 *   haiku  = $0.001 base + $0.0001 per KB of output
 *   sonnet = $0.01  base + $0.001  per KB of output
 *   opus   = $0.05  base + $0.005  per KB of output
 * Falls back to sonnet pricing for unknown / undefined models.
 */
export function estimateCostUsd(model: string | undefined, outputBytes: number): number {
  const outputKb = outputBytes / 1024;
  const modelKey = (model ?? '').toLowerCase();

  if (modelKey.includes('haiku')) {
    return 0.001 + outputKb * 0.0001;
  }
  if (modelKey.includes('opus')) {
    return 0.05 + outputKb * 0.005;
  }
  // Default / sonnet
  return 0.01 + outputKb * 0.001;
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
  /** Estimated cost in USD for this agent run */
  costUsd?: number;
  /**
   * True when the Claude CLI exited with code 0 but stdout contains a
   * max-turns indicator, meaning the worker ran out of its turn budget
   * before completing the task. The result is incomplete.
   */
  turnsExhausted?: boolean;
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

/**
 * Build the CLI argument array from spawn options.
 * @deprecated Use CLIAdapter.buildSpawnConfig() instead for provider-agnostic arg building.
 * Kept for backward compatibility — produces Claude-specific args.
 */
export function buildArgs(opts: SpawnOptions): string[] {
  const args: string[] = [];

  // Depth limiting: --print (single-turn, no session) and --session-id/--resume
  // (multi-turn, persistent) are mutually exclusive.
  // Workers use --print (enforces they can't spawn other workers).
  // Master uses --session-id/--resume (enables persistent multi-turn behavior).
  if (opts.resumeSessionId) {
    args.push('--resume', opts.resumeSessionId);
  } else if (opts.sessionId) {
    args.push('--session-id', opts.sessionId);
  } else {
    // No session — use --print for single-turn, stateless execution
    args.push('--print');
  }

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

  if (opts.systemPrompt) {
    args.push('--append-system-prompt', opts.systemPrompt);
  }

  if (opts.maxBudgetUsd !== undefined && opts.maxBudgetUsd > 0) {
    args.push('--max-budget-usd', String(opts.maxBudgetUsd));
  }

  // Place the prompt BEFORE --allowedTools. Commander.js parses the first
  // positional argument as the prompt. --allowedTools is variadic (<tools...>)
  // and would consume a trailing prompt as a tool name when no other option
  // follows it (e.g. --append-system-prompt).
  args.push(sanitizePrompt(opts.prompt));

  if (opts.allowedTools && opts.allowedTools.length > 0) {
    for (const tool of opts.allowedTools) {
      args.push('--allowedTools', tool);
    }
  }

  return args;
}

/**
 * Grace period in milliseconds between SIGTERM and SIGKILL.
 * When a worker times out, we send SIGTERM first, wait this long,
 * then send SIGKILL if the process hasn't exited.
 */
const SIGTERM_GRACE_PERIOD_MS = 5000;

/** Handle returned by execOnce() — exposes the result promise, process PID, and a kill function. */
interface ExecOnceHandle {
  promise: Promise<{ stdout: string; stderr: string; exitCode: number }>;
  pid: number;
  kill: () => void;
}

/** Execute a single agent attempt. Returns stdout, stderr, exitCode. */
function execOnce(config: CLISpawnConfig, workspacePath: string, timeout?: number): ExecOnceHandle {
  const child = nodeSpawn(config.binary, config.args, {
    cwd: workspacePath,
    env: config.env,
    stdio: [config.stdin ?? 'ignore', 'pipe', 'pipe'],
  });

  logger.debug(
    { pid: child.pid, binary: config.binary, argCount: config.args.length },
    'Spawned child process',
  );

  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let gracePeriodTimer: NodeJS.Timeout | undefined;

  const promise = new Promise<{ stdout: string; stderr: string; exitCode: number }>(
    (resolve, reject) => {
      // Manual timeout handling with SIGTERM → SIGKILL progression
      if (timeout && timeout > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          logger.warn(
            { timeout, pid: child.pid },
            'Worker timeout exceeded — sending SIGTERM (5s grace period)',
          );

          // Send SIGTERM for graceful shutdown
          const terminated = child.kill('SIGTERM');

          if (!terminated) {
            logger.warn({ pid: child.pid }, 'Failed to send SIGTERM to worker');
            // Resolve immediately if kill failed
            resolve({
              stdout,
              stderr: stderr + '\nTimeout: failed to terminate process',
              exitCode: 143,
            });
            return;
          }

          // Set up grace period timer for SIGKILL
          gracePeriodTimer = setTimeout(() => {
            logger.warn({ timeout, pid: child.pid }, 'Grace period expired — sending SIGKILL');
            child.kill('SIGKILL');
          }, SIGTERM_GRACE_PERIOD_MS);
        }, timeout);
      }

      child.stdout!.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        logger.debug(
          { pid: child.pid, chunkLen: chunk.length, totalLen: stdout.length },
          'stdout data received',
        );
      });

      child.stderr!.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code, signal) => {
        // Clear both timers
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (gracePeriodTimer) clearTimeout(gracePeriodTimer);

        logger.debug(
          { pid: child.pid, code, signal, stdoutLen: stdout.length, stderrLen: stderr.length },
          'Child process closed',
        );

        if (timedOut) {
          // Process was terminated due to timeout
          const exitCode = signal === 'SIGTERM' ? 143 : signal === 'SIGKILL' ? 137 : (code ?? 1);
          resolve({
            stdout,
            stderr:
              stderr +
              `\nTimeout: process terminated after ${timeout}ms (signal: ${signal ?? 'none'})`,
            exitCode,
          });
        } else {
          resolve({ stdout, stderr, exitCode: code ?? 1 });
        }
      });

      child.on('error', (error) => {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (gracePeriodTimer) clearTimeout(gracePeriodTimer);
        reject(error);
      });
    },
  );

  return {
    promise,
    pid: child.pid ?? -1,
    kill: (): void => {
      // Clear timers if kill is called manually
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (gracePeriodTimer) clearTimeout(gracePeriodTimer);

      // Graceful shutdown with SIGTERM
      const terminated = child.kill('SIGTERM');

      if (terminated) {
        // Set up grace period for SIGKILL
        gracePeriodTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, SIGTERM_GRACE_PERIOD_MS);
      }
    },
  };
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
  config: CLISpawnConfig,
  workspacePath: string,
  timeout?: number,
): {
  chunks: AsyncGenerator<string, { exitCode: number; stderr: string }>;
  abort: () => void;
} {
  const child = nodeSpawn(config.binary, config.args, {
    cwd: workspacePath,
    // Don't use Node's built-in timeout — we handle it manually for graceful cleanup
    env: config.env,
    stdio: [config.stdin ?? 'ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  let timedOut = false;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let gracePeriodTimer: NodeJS.Timeout | undefined;

  // Manual timeout handling with SIGTERM → SIGKILL progression
  if (timeout && timeout > 0) {
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      logger.warn(
        { timeout, pid: child.pid },
        'Worker streaming timeout exceeded — sending SIGTERM (5s grace period)',
      );

      // Send SIGTERM for graceful shutdown
      const terminated = child.kill('SIGTERM');

      if (!terminated) {
        logger.warn({ pid: child.pid }, 'Failed to send SIGTERM to streaming worker');
        return;
      }

      // Set up grace period timer for SIGKILL
      gracePeriodTimer = setTimeout(() => {
        logger.warn(
          { timeout, pid: child.pid },
          'Grace period expired — sending SIGKILL to streaming worker',
        );
        child.kill('SIGKILL');
      }, SIGTERM_GRACE_PERIOD_MS);
    }, timeout);
  }

  child.stderr!.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  const chunkQueue: string[] = [];
  let done = false;
  let exitCode = 1;
  let _exitSignal: string | null = null;
  let spawnError: Error | undefined;

  let notify: (() => void) | undefined;
  function waitForData(): Promise<void> {
    return new Promise<void>((resolve) => {
      notify = resolve;
    });
  }

  child.stdout!.on('data', (data: Buffer) => {
    chunkQueue.push(data.toString());
    notify?.();
  });

  child.on('close', (code, signal) => {
    // Clear both timers
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (gracePeriodTimer) clearTimeout(gracePeriodTimer);

    exitCode = code ?? 1;
    _exitSignal = signal;

    if (timedOut) {
      // Process was terminated due to timeout
      exitCode = signal === 'SIGTERM' ? 143 : signal === 'SIGKILL' ? 137 : (code ?? 1);
      stderr += `\nTimeout: process terminated after ${timeout}ms (signal: ${signal ?? 'none'})`;
    }

    done = true;
    notify?.();
  });

  child.on('error', (error) => {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (gracePeriodTimer) clearTimeout(gracePeriodTimer);

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
      // Clear timers if abort is called manually
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (gracePeriodTimer) clearTimeout(gracePeriodTimer);

      // Graceful shutdown with SIGTERM
      const terminated = child.kill('SIGTERM');

      if (terminated) {
        // Set up grace period for SIGKILL
        gracePeriodTimer = setTimeout(() => {
          child.kill('SIGKILL');
        }, SIGTERM_GRACE_PERIOD_MS);
      }
    },
  };
}

export class AgentRunner {
  private readonly adapter: CLIAdapter;

  constructor(adapter?: CLIAdapter) {
    this.adapter = adapter ?? new ClaudeAdapter();
  }

  /**
   * Spawn an AI CLI agent with the given options.
   *
   * Uses the CLIAdapter to build provider-specific CLI args, executes the
   * child process, and retries on non-zero exit codes up to `retries` times
   * with `retryDelay` between attempts.
   */
  async spawn(opts: SpawnOptions): Promise<AgentResult> {
    const retries = opts.retries ?? 3;
    const retryDelay = opts.retryDelay ?? 10_000;
    let currentModel = opts.model;
    let currentConfig = this.adapter.buildSpawnConfig(opts);
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
        const { promise: execPromise } = execOnce(currentConfig, opts.workspacePath, opts.timeout);
        lastResult = await execPromise;
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
          currentConfig = this.adapter.buildSpawnConfig({ ...opts, model: currentModel });
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const retryCount = Math.min(attempt, retries);

    // If we exited the loop without a success, throw aggregated error
    if (!lastResult || lastResult.exitCode !== 0) {
      throw new AgentExhaustedError(attemptRecords, durationMs);
    }

    const turnsExhausted = isMaxTurnsExhausted(lastResult.stdout);

    const result: AgentResult = {
      stdout: lastResult.stdout,
      stderr: lastResult.stderr,
      exitCode: lastResult.exitCode,
      durationMs,
      retryCount,
      model: currentModel,
      modelFallbacks: modelFallbacks.length > 0 ? modelFallbacks : undefined,
      costUsd: estimateCostUsd(currentModel, Buffer.byteLength(lastResult.stdout, 'utf8')),
      turnsExhausted: turnsExhausted || undefined,
    };

    if (turnsExhausted) {
      logger.warn(
        { model: currentModel ?? 'default', maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS_TASK },
        'Agent exited with code 0 but max-turns was exhausted — result may be incomplete',
      );
    }

    logger.info(
      {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        model: result.model ?? 'default',
        retryCount: result.retryCount,
        modelFallbacks: result.modelFallbacks,
        costUsd: result.costUsd,
        turnsExhausted: result.turnsExhausted,
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
   * Stream an AI CLI agent, yielding stdout chunks as they arrive.
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
    let currentConfig = this.adapter.buildSpawnConfig(opts);
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
        const { chunks } = execOnceStreaming(currentConfig, opts.workspacePath, opts.timeout);

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
        const turnsExhausted = isMaxTurnsExhausted(stdout);

        const result: AgentResult = {
          stdout,
          stderr: streamResult!.stderr,
          exitCode: 0,
          durationMs,
          retryCount,
          model: currentModel,
          modelFallbacks: modelFallbacks.length > 0 ? modelFallbacks : undefined,
          costUsd: estimateCostUsd(currentModel, Buffer.byteLength(stdout, 'utf8')),
          turnsExhausted: turnsExhausted || undefined,
        };

        if (turnsExhausted) {
          logger.warn(
            {
              model: currentModel ?? 'default',
              maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS_TASK,
            },
            'Stream exited with code 0 but max-turns was exhausted — result may be incomplete',
          );
        }

        logger.info(
          {
            exitCode: 0,
            durationMs,
            model: currentModel ?? 'default',
            retryCount,
            modelFallbacks: result.modelFallbacks,
            costUsd: result.costUsd,
            turnsExhausted: result.turnsExhausted,
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
          currentConfig = this.adapter.buildSpawnConfig({ ...opts, model: currentModel });
        }
      }
    }

    // All retries exhausted
    throw new AgentExhaustedError(attemptRecords, Date.now() - startTime);
  }

  /**
   * Spawn an AI CLI agent from a TaskManifest.
   *
   * Converts the manifest into SpawnOptions, resolving the `profile` field
   * into tool lists via custom profiles then built-in profiles.
   * If both `profile` and explicit `allowedTools` are provided, explicit wins.
   */
  async spawnFromManifest(
    manifest: TaskManifest,
    customProfiles?: Record<string, ToolProfile>,
  ): Promise<AgentResult> {
    return this.spawn(manifestToSpawnOptions(manifest, customProfiles));
  }

  /**
   * Stream an AI CLI agent from a TaskManifest.
   *
   * Same as spawnFromManifest but yields stdout chunks as they arrive.
   * Resolves `profile` to tools the same way as spawnFromManifest.
   */
  async *streamFromManifest(
    manifest: TaskManifest,
    customProfiles?: Record<string, ToolProfile>,
  ): AsyncGenerator<string, AgentResult> {
    return yield* this.stream(manifestToSpawnOptions(manifest, customProfiles));
  }
}
