import { spawn as nodeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { createLogger } from './logger.js';
import { DockerSandbox } from './docker-sandbox.js';
import { sanitizeEnv } from './env-sanitizer.js';
import { BUILT_IN_PROFILES } from '../types/agent.js';
import type { TaskManifest, ToolProfile } from '../types/agent.js';
import type { ModelRegistry } from './model-registry.js';
import type { CLIAdapter, CLISpawnConfig } from './cli-adapter.js';
import { ClaudeAdapter } from './adapters/claude-adapter.js';
import type { SandboxConfig, SecurityConfig } from '../types/config.js';

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
 * Default maximum number of lint/test fix iterations before escalating to Master.
 * Configurable via `worker.maxFixIterations` in config (OB-1791).
 */
export const DEFAULT_MAX_FIX_ITERATIONS = 3;

/**
 * Patterns in worker stdout that indicate a lint/test fix iteration.
 * Each pattern match signals one fix attempt cycle (run checks → fix errors).
 * Matched case-insensitively against accumulated stdout.
 */
export const FIX_ITERATION_PATTERNS: RegExp[] = [
  /\bnpm run lint\b/i,
  /\bnpm run typecheck\b/i,
  /\bvite(?:st)?\s+run\b/i,
  /\bRunning\s+(?:lint|test|typecheck)\s+fix/i,
  /\bAttempting\s+to\s+fix\b/i,
  /\bFix\s+attempt\s+\d+\b/i,
  /\bApplying\s+(?:lint|type)\s+fix/i,
  /\bRe-running\s+(?:lint|tests?|typecheck)\b/i,
];

/**
 * Count the number of fix iteration signals in worker stdout.
 * Each pattern match counts as one fix attempt.
 * Used to enforce the maxFixIterations cap.
 */
export function countFixIterations(stdout: string): number {
  let count = 0;
  for (const pattern of FIX_ITERATION_PATTERNS) {
    const globalPattern = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g',
    );
    const matches = stdout.match(globalPattern);
    if (matches) count += matches.length;
  }
  return count;
}

/**
 * Patterns that identify unresolved error lines in worker stdout.
 * Used by extractRemainingErrors() to surface errors that the worker
 * failed to fix before hitting the iteration cap (OB-1790).
 */
const REMAINING_ERROR_PATTERNS: RegExp[] = [
  /\berror\s+TS\d+:/i, // TypeScript: error TS2345:
  /\btype\s+error\b/i, // TypeScript: Type error
  /^\d+\s+error/i, // "3 errors" summary line
  /\berror\b[^:]*:\s+.{10,}/i, // generic "error: some message"
  /[✕✗×]/, // test failure symbols
  /\bfailing\b/i, // "2 failing"
  /\bFAIL\b/, // Jest/Vitest FAIL
  /\bAssertionError\b/i, // assertion failure
  /Expected.*Received/is, // Jest/Vitest assertion diff
  /^\s*●\s+.{10,}/, // Jest bullet error
];

/**
 * Extract unresolved error lines from worker stdout.
 *
 * Scans the last 3 000 characters of output (most recent activity) for
 * lint, TypeScript, and test failure patterns. Returns up to 10 distinct
 * error lines that likely represent issues the worker could not fix before
 * hitting the iteration cap.
 *
 * Used to build the error-details section of the [FIX CAP REACHED] report
 * injected into the Master session (OB-1790).
 */
export function extractRemainingErrors(stdout: string): string[] {
  // Focus on the tail — most recent output is the most relevant
  const tail = stdout.length > 3_000 ? stdout.slice(-3_000) : stdout;
  const lines = tail
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const errors: string[] = [];

  for (const line of lines) {
    if (errors.length >= 10) break;
    if (REMAINING_ERROR_PATTERNS.some((re) => re.test(line))) {
      const truncated = line.slice(0, 200);
      if (!seen.has(truncated)) {
        seen.add(truncated);
        errors.push(truncated);
      }
    }
  }

  return errors;
}

/**
 * Patterns in streaming stdout that indicate a new agent turn has started.
 * Matched against each chunk to extract the current turn number.
 * Claude CLI emits these markers at the beginning of each agentic turn.
 */
const TURN_INDICATOR_PATTERNS: RegExp[] = [
  /\bturn\s+(\d+)\b/i, // "Turn 1", "Turn 2", "agentic turn 3"
  /"turn":\s*(\d+)/, // JSON: "turn": 1
  /\((\d+)\s+agentic\s+turn/i, // "(3 agentic turns used)"
  /step\s+(\d+)\s+of\s+\d+/i, // "Step 1 of 25"
];

/**
 * Result of parsing a turn indicator from a streaming stdout chunk.
 */
export interface TurnIndicator {
  /** Number of agentic turns used so far */
  turnsUsed: number;
  /** The last action text extracted from the chunk, if detectable */
  lastAction?: string;
}

/**
 * Parse a turn indicator from a chunk of Claude CLI streaming stdout.
 *
 * Returns a `TurnIndicator` if a turn marker is found in the chunk,
 * or `null` if the chunk contains no recognizable turn information.
 * Used by workers streaming real-time progress via `execOnceStreaming()`.
 */
export function parseTurnIndicator(chunk: string): TurnIndicator | null {
  for (const pattern of TURN_INDICATOR_PATTERNS) {
    const match = chunk.match(pattern);
    if (match?.[1]) {
      const turnsUsed = parseInt(match[1], 10);
      if (!isNaN(turnsUsed) && turnsUsed > 0) {
        // Extract a short lastAction hint from the first non-empty line of the chunk
        const firstLine = chunk
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.length > 0);
        return { turnsUsed, lastAction: firstLine };
      }
    }
  }
  return null;
}

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

/** Code audit tools — read files and run test/lint/typecheck commands, no file modifications */
export const TOOLS_CODE_AUDIT = [
  'Read',
  'Glob',
  'Grep',
  'Bash(npm:test)',
  'Bash(npm:run:lint)',
  'Bash(npm:run:typecheck)',
  'Bash(npx:vitest:*)',
  'Bash(npx:eslint:*)',
  'Bash(npx:tsc:*)',
  'Bash(npm:run:test:*)',
  'Bash(pytest:*)',
  'Bash(cargo:test)',
] as const;

/**
 * Default per-profile cost caps in USD.
 * If a worker's estimated cost exceeds the cap for its profile,
 * the agent is aborted and a WARNING is logged (OB-F101).
 */
export const PROFILE_COST_CAPS: Record<string, number> = {
  'read-only': 0.5,
  'code-edit': 1.0,
  'code-audit': 1.0,
  'full-access': 2.0,
};

/**
 * Get the cost cap in USD for a given tool profile.
 * Returns the cap from `overrides` first, then `PROFILE_COST_CAPS`.
 * Returns `undefined` if the profile is unknown or no cap is configured.
 */
export function getProfileCostCap(
  profile: string | undefined,
  overrides?: Record<string, number>,
): number | undefined {
  if (!profile) return undefined;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, profile)) {
    return overrides[profile];
  }
  return PROFILE_COST_CAPS[profile];
}

/**
 * Module-level in-memory running average of worker costs per profile (OB-1673).
 * Tracks { sum, count } so we can compute mean without storing all values.
 * Resets on process restart — this is intentional (short-lived diagnostic signal).
 */
const _profileCostAccumulator: Map<string, { sum: number; count: number }> = new Map();

/**
 * Record a completed worker cost for its profile and warn if the cost is
 * more than 10x the running average for that profile.
 *
 * Only called after the agent has successfully produced a result (not on abort).
 * The average is updated AFTER the spike check so extreme outliers do not
 * immediately skew the baseline.
 */
export function checkProfileCostSpike(profile: string | undefined, costUsd: number): void {
  if (!profile || costUsd <= 0) return;

  const acc = _profileCostAccumulator.get(profile);
  if (acc && acc.count > 0) {
    const avg = acc.sum / acc.count;
    if (avg > 0 && costUsd > avg * 10) {
      const multiplier = (costUsd / avg).toFixed(0);
      logger.warn(
        { cost: costUsd, average: avg, multiplier: Number(multiplier), profile },
        `Worker cost $${costUsd.toFixed(4)} is ${multiplier}x average $${avg.toFixed(4)} for ${profile} profile`,
      );
    }
  }

  // Update accumulator after the check to keep baseline stable
  if (acc) {
    acc.sum += costUsd;
    acc.count += 1;
  } else {
    _profileCostAccumulator.set(profile, { sum: costUsd, count: 1 });
  }
}

/**
 * Return a snapshot of the current profile cost averages (for testing).
 */
export function getProfileCostAverages(): Record<string, { avg: number; count: number }> {
  const result: Record<string, { avg: number; count: number }> = {};
  for (const [profile, acc] of _profileCostAccumulator) {
    result[profile] = { avg: acc.count > 0 ? acc.sum / acc.count : 0, count: acc.count };
  }
  return result;
}

/**
 * Reset the cost accumulator (exposed for tests only).
 */
export function resetProfileCostAverages(): void {
  _profileCostAccumulator.clear();
}

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
 * Resolve a profile name to its tool list using the built-in TOOLS_* constants.
 * For profiles not covered by the constants, falls back to resolveProfile().
 * Used when profile: 'code-audit' (or other built-in names) is requested via
 * SPAWN markers or config — returns the correct tool list for --allowedTools flags.
 */
export function resolveTools(
  profileName: string,
  customProfiles?: Record<string, ToolProfile>,
): string[] | undefined {
  switch (profileName) {
    case 'read-only':
      return [...TOOLS_READ_ONLY];
    case 'code-edit':
      return [...TOOLS_CODE_EDIT];
    case 'full-access':
      return [...TOOLS_FULL];
    case 'code-audit':
      return [...TOOLS_CODE_AUDIT];
    default:
      return resolveProfile(profileName, customProfiles);
  }
}

/**
 * Result returned by manifestToSpawnOptions().
 * Contains the resolved SpawnOptions and a cleanup function that deletes
 * any temporary files created for per-worker MCP isolation.
 */
export interface ManifestSpawnResult {
  /** Resolved spawn options ready for AgentRunner.spawn() */
  spawnOptions: SpawnOptions;
  /**
   * Async cleanup function — call after spawn completes (success or failure).
   * Deletes the per-worker MCP temp file if one was created; no-op otherwise.
   */
  cleanup: () => Promise<void>;
}

/**
 * Convert a TaskManifest into SpawnOptions.
 *
 * Resolution rules:
 * - If `allowedTools` is provided explicitly, it takes priority over `profile`
 * - If only `profile` is provided, resolve it via custom profiles then built-in
 * - If neither is provided, no tools restriction is applied
 * - All other fields map directly to SpawnOptions equivalents
 *
 * Per-worker MCP isolation:
 * - When `manifest.mcpServers` is non-empty, a temporary JSON file is written
 *   containing only those servers (not all globally configured servers).
 * - `spawnOptions.mcpConfigPath` is set to the temp file path and
 *   `strictMcpConfig` is set to `true` so the worker cannot access any
 *   globally configured MCP servers.
 * - Call `cleanup()` after the spawn completes to delete the temp file.
 */
export async function manifestToSpawnOptions(
  manifest: TaskManifest,
  customProfiles?: Record<string, ToolProfile>,
): Promise<ManifestSpawnResult> {
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

  const baseOptions: SpawnOptions = {
    prompt: manifest.prompt,
    workspacePath: manifest.workspacePath,
    model: manifest.model,
    allowedTools,
    maxTurns: manifest.maxTurns,
    timeout: manifest.timeout,
    retries: manifest.retries,
    retryDelay: manifest.retryDelay,
    maxBudgetUsd: manifest.maxBudgetUsd,
    profile: manifest.profile,
  };

  // No MCP servers requested — return immediately with a no-op cleanup
  if (!manifest.mcpServers || manifest.mcpServers.length === 0) {
    return {
      spawnOptions: baseOptions,
      cleanup: async (): Promise<void> => {
        /* no-op */
      },
    };
  }

  // Per-worker MCP isolation: write a temp file with ONLY the requested servers.
  // This ensures each worker sees only the MCP servers it needs, not all
  // globally configured servers (security: least-privilege per worker).
  const tempFilePath = `${tmpdir()}/ob-mcp-${randomUUID()}.json`;

  const mcpServersConfig: Record<
    string,
    { command: string; args?: string[]; env?: Record<string, string> }
  > = {};
  for (const server of manifest.mcpServers) {
    mcpServersConfig[server.name] = {
      command: server.command,
      ...(server.args !== undefined ? { args: server.args } : {}),
      ...(server.env !== undefined ? { env: server.env } : {}),
    };
  }

  await writeFile(tempFilePath, JSON.stringify({ mcpServers: mcpServersConfig }, null, 2), 'utf-8');

  logger.debug(
    { tempFilePath, serverCount: manifest.mcpServers.length },
    'Wrote per-worker MCP config — worker sees only its requested servers',
  );

  return {
    spawnOptions: {
      ...baseOptions,
      mcpConfigPath: tempFilePath,
      strictMcpConfig: true,
    },
    cleanup: async (): Promise<void> => {
      try {
        await rm(tempFilePath, { force: true });
        logger.debug({ tempFilePath }, 'Cleaned up per-worker MCP temp file');
      } catch (err) {
        logger.warn({ tempFilePath, err }, 'Failed to clean up MCP temp file');
      }
    },
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
  /**
   * Path to an MCP config JSON file to pass to the agent CLI.
   * For Claude: passed as `--mcp-config <path>` so the worker can use MCP tools.
   * For Codex: passed via the `-c` flag when set.
   */
  mcpConfigPath?: string;
  /**
   * When true, passes `--strict-mcp-config` to the Claude CLI, isolating the worker
   * from any globally configured MCP servers (e.g. ~/.claude/claude_desktop_config.json).
   * Only the servers listed in `mcpConfigPath` will be available to the worker.
   */
  strictMcpConfig?: boolean;
  /**
   * Sandbox configuration for this worker.
   * When `sandbox.mode` is `'docker'`, the worker is spawned inside a Docker container
   * using the `openbridge-worker:latest` image with workspace volume mounts,
   * resource limits, and env var sanitization applied.
   * Default: `{ mode: 'none' }` — run as a regular child process.
   */
  sandbox?: SandboxConfig;
  /**
   * Security configuration for env var sanitization inside the Docker sandbox.
   * When `sandbox.mode` is `'docker'`, the sanitizer strips env vars matching
   * `envDenyPatterns` (unless overridden by `envAllowPatterns`) before passing
   * them to the container via `-e` flags.
   * If omitted, the default deny/allow patterns from Phase 85 are used.
   */
  securityConfig?: SecurityConfig;
  /**
   * Tool profile name used for per-profile cost cap enforcement (OB-F101).
   * When set, the runner checks accumulated cost against PROFILE_COST_CAPS[profile]
   * during streaming and logs a WARNING + aborts if the cap is exceeded.
   * Populated automatically by manifestToSpawnOptions() from TaskManifest.profile.
   */
  profile?: string;
  /**
   * Per-profile cost cap overrides in USD.
   * Merged on top of PROFILE_COST_CAPS defaults — caller-supplied values win.
   * Example: `{ 'read-only': 0.25 }` to tighten the default $0.50 cap.
   */
  workerCostCaps?: Record<string, number>;
  /**
   * Maximum number of lint/test fix iterations before escalating to Master (OB-1789).
   * Each time the worker runs lint/test commands and then attempts a fix, that counts
   * as one iteration. When the cap is reached, the run is aborted with
   * `fixCapReached: true` in the result so Master can decide the next action.
   * Defaults to DEFAULT_MAX_FIX_ITERATIONS (3). Set to 0 to disable the cap.
   */
  maxFixIterations?: number;
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

/**
 * Result returned by estimateCost().
 * Provides rough pre-execution cost and time estimates for display in the
 * user confirmation prompt before a high-risk worker is spawned.
 */
export interface CostEstimate {
  /** Expected number of agent turns (equals maxTurns — pessimistic worst-case estimate) */
  estimatedTurns: number;
  /** Human-readable cost estimate string, e.g. "~$0.30" */
  costString: string;
  /** Human-readable time estimate string, e.g. "~5 min" */
  timeString: string;
}

/**
 * Estimate the pre-execution cost and time for a worker spawn.
 *
 * Uses rough per-turn costs (pessimistic — assumes all turns are used):
 *   haiku / fast      = $0.01 / turn
 *   sonnet / balanced = $0.03 / turn
 *   opus / powerful   = $0.10 / turn
 *
 * Time estimate: ~10 seconds per turn.
 *
 * @param _profile   Profile name — reserved for future profile-based adjustments
 * @param maxTurns   Maximum turns the worker is allowed (used as the turn estimate)
 * @param modelTier  Model tier ('fast', 'balanced', 'powerful') or alias ('haiku', 'sonnet', 'opus')
 */
export function estimateCost(_profile: string, maxTurns: number, modelTier: string): CostEstimate {
  const tier = modelTier.toLowerCase();

  let costPerTurn: number;
  if (tier === 'fast' || tier.includes('haiku')) {
    costPerTurn = 0.01;
  } else if (tier === 'powerful' || tier.includes('opus')) {
    costPerTurn = 0.1;
  } else {
    // balanced / sonnet / unknown — default to sonnet pricing
    costPerTurn = 0.03;
  }

  const estimatedTurns = maxTurns;
  const totalCost = costPerTurn * estimatedTurns;
  const totalSeconds = estimatedTurns * 10;
  const totalMinutes = Math.ceil(totalSeconds / 60);

  const costString = `~$${totalCost.toFixed(2)}`;
  const timeString = totalMinutes <= 1 ? '~1 min' : `~${totalMinutes} min`;

  return { estimatedTurns, costString, timeString };
}

/**
 * Handle returned by AgentRunner.spawnWithHandle().
 * Provides the result promise, the PID of the initial child process,
 * and an abort function that sends SIGTERM → 5s grace → SIGKILL.
 */
export interface SpawnHandle {
  /** Promise that resolves to the final AgentResult (after retries if any) */
  promise: Promise<AgentResult>;
  /** PID of the initial child process (-1 if the OS did not assign one) */
  pid: number;
  /** Abort the currently-running execution (SIGTERM → 5s grace period → SIGKILL) */
  abort: () => void;
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
  /** Last agentic turn count reported during streaming (undefined if not tracked) */
  turnsUsed?: number;
  /** Max turns limit that was configured for this run (undefined if not set) */
  maxTurns?: number;
  /**
   * Completion status of the agent run.
   * - 'completed': agent finished within its turn budget
   * - 'partial': agent hit the max-turns limit before finishing (turnsExhausted: true)
   * - 'fix-cap-reached': agent hit the fix iteration cap (fixCapReached: true)
   */
  status: 'completed' | 'partial' | 'fix-cap-reached';
  /**
   * Number of lint/test fix iterations detected in worker output (OB-1789).
   * Populated when maxFixIterations is set. Undefined if fix cap tracking is disabled.
   */
  fixIterationsUsed?: number;
  /**
   * True when the worker hit the fix iteration cap without resolving all errors (OB-1789).
   * Master should inspect the partial output and decide whether to retry, escalate,
   * or accept the partial result.
   */
  fixCapReached?: boolean;
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
  let killed = false;
  let timeoutTimer: NodeJS.Timeout | undefined;
  let gracePeriodTimer: NodeJS.Timeout | undefined;

  const promise = new Promise<{ stdout: string; stderr: string; exitCode: number }>(
    (resolve, reject) => {
      // Manual timeout handling with SIGTERM → SIGKILL progression
      if (timeout && timeout > 0) {
        timeoutTimer = setTimeout(() => {
          if (killed) return;
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
            if (killed) return;
            killed = true;
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

        // Apply adapter-specific output parsing (e.g. Codex --json JSONL extraction)
        let parsedStdout = stdout;
        if (config.parseOutput) {
          try {
            parsedStdout = config.parseOutput(stdout);
          } catch (parseErr) {
            logger.warn({ parseErr }, 'parseOutput threw — falling back to raw stdout');
          }
        }

        if (timedOut) {
          // Process was terminated due to timeout
          const exitCode = signal === 'SIGTERM' ? 143 : signal === 'SIGKILL' ? 137 : (code ?? 1);
          resolve({
            stdout: parsedStdout,
            stderr:
              stderr +
              `\nTimeout: process terminated after ${timeout}ms (signal: ${signal ?? 'none'})`,
            exitCode,
          });
        } else {
          resolve({ stdout: parsedStdout, stderr, exitCode: code ?? 1 });
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
      // Guard: process already exited — skip kill, clear any lingering timers
      if (child.exitCode !== null) {
        clearTimeout(gracePeriodTimer);
        gracePeriodTimer = undefined;
        logger.debug(
          { pid: child.pid, exitCode: child.exitCode },
          'kill() called on already-exited process — skipping',
        );
        return;
      }

      killed = true;
      // Clear both timers atomically to prevent any pending timeout/grace-period from firing
      clearTimeout(timeoutTimer);
      clearTimeout(gracePeriodTimer);
      timeoutTimer = undefined;
      gracePeriodTimer = undefined;

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
  pid: number;
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
    pid: child.pid ?? -1,
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
   * Execute a single agent attempt inside a Docker sandbox container.
   *
   * Creates, starts, execs, stops, and removes a container for each call.
   * The container is always removed in the `finally` block — even on error.
   *
   * Returns the same shape as the `execOnce()` promise so it can be used as
   * a drop-in replacement inside the `spawn()` retry loop.
   */
  private async _execOnceDocker(
    config: CLISpawnConfig,
    workspacePath: string,
    sandboxConfig: SandboxConfig,
    timeout?: number,
    maxTurns?: number,
    securityConfig?: SecurityConfig,
    mcpConfigPath?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const dockerSandbox = new DockerSandbox();

    // Apply env sanitizer (Phase 85) to strip secrets before passing to the container.
    // sanitizeEnv() expects Record<string, string | undefined>; Docker only accepts strings,
    // so we filter undefined values out in the same pass.
    const rawEnv: Record<string, string | undefined> = config.env;
    const sanitized = securityConfig ? sanitizeEnv(rawEnv, securityConfig) : rawEnv;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(sanitized)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }

    const rawCount = Object.keys(rawEnv).filter((k) => rawEnv[k] !== undefined).length;
    const sanitizedCount = Object.keys(env).length;
    if (sanitizedCount < rawCount) {
      logger.debug(
        { stripped: rawCount - sanitizedCount, kept: sanitizedCount },
        'Docker sandbox: stripped secret env vars via sanitizer',
      );
    }

    const containerName = `ob-worker-${randomUUID().slice(0, 8)}`;
    const mounts = DockerSandbox.buildWorkspaceMounts({ workspacePath });

    // MCP config isolation (OB-1556): if a per-worker MCP config file was written
    // on the host, mount it read-only into the container and rewrite the CLI args
    // so the agent references the container path instead of the host path.
    const CONTAINER_MCP_CONFIG_PATH = '/tmp/ob-mcp-config.json';
    let containerArgs = config.args;
    if (mcpConfigPath) {
      mounts.push({
        host: mcpConfigPath,
        container: CONTAINER_MCP_CONFIG_PATH,
        readOnly: true,
      });
      // Replace the host path with the container path in the arg list.
      containerArgs = config.args.map((arg) =>
        arg === mcpConfigPath ? CONTAINER_MCP_CONFIG_PATH : arg,
      );
      logger.debug(
        { mcpConfigPath, containerPath: CONTAINER_MCP_CONFIG_PATH },
        'Mounting MCP config into Docker container',
      );
    }

    // Compute exec timeout: use explicit timeout when provided, otherwise derive
    // from maxTurns (30 seconds per turn) so long-running workers are eventually
    // force-killed by the exec call.  Fall back to 5 minutes if neither is set.
    const SECS_PER_TURN = 30;
    const effectiveTimeout = timeout ?? (maxTurns ? maxTurns * SECS_PER_TURN * 1_000 : 300_000);

    logger.debug(
      { containerName, binary: config.binary, argCount: config.args.length, effectiveTimeout },
      'Spawning agent inside Docker container',
    );

    let containerId: string | undefined;
    try {
      containerId = await dockerSandbox.createContainer({
        image: 'openbridge-worker:latest',
        name: containerName,
        mounts,
        env,
        network: sandboxConfig.network,
        memoryMB: sandboxConfig.memoryMB,
        cpus: sandboxConfig.cpus,
        workdir: '/workspace',
      });
      dockerSandbox.trackContainer(containerId);

      await dockerSandbox.startContainer(containerId);

      const result = await dockerSandbox.exec(containerId, [config.binary, ...containerArgs], {
        cwd: '/workspace',
        timeout: effectiveTimeout,
      });

      logger.info({ containerName, exitCode: result.exitCode }, 'Docker agent exec completed');

      return result;
    } finally {
      if (containerId) {
        // Untrack before cleanup so the crash-exit handler skips this container.
        dockerSandbox.untrackContainer(containerId);
        try {
          await dockerSandbox.stopContainer(containerId, 5);
        } catch {
          // Container may have already exited — ignore stop errors
        }
        try {
          await dockerSandbox.removeContainer(containerId, true);
        } catch (err) {
          logger.warn(
            { containerName, err },
            'Failed to remove Docker container after worker exit',
          );
        }
      }
    }
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
        if (opts.sandbox?.mode === 'docker') {
          // OB-1558: Check Docker availability before attempting sandbox spawn.
          // If the daemon is unavailable, fall back to direct spawn with a warning
          // rather than failing silently or throwing an unrecoverable error.
          const dockerSandboxCheck = new DockerSandbox();
          const dockerAvailable = await dockerSandboxCheck.isAvailable();
          if (!dockerAvailable) {
            logger.warn(
              { attempt, workspacePath: opts.workspacePath },
              'Docker unavailable — falling back to direct (unsandboxed) spawn',
            );
            const { promise: execPromise } = execOnce(
              currentConfig,
              opts.workspacePath,
              opts.timeout,
            );
            lastResult = await execPromise;
          } else {
            lastResult = await this._execOnceDocker(
              currentConfig,
              opts.workspacePath,
              opts.sandbox,
              opts.timeout,
              opts.maxTurns,
              opts.securityConfig,
              opts.mcpConfigPath,
            );
          }
        } else {
          const { promise: execPromise } = execOnce(
            currentConfig,
            opts.workspacePath,
            opts.timeout,
          );
          lastResult = await execPromise;
        }
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

    const costUsd = estimateCostUsd(currentModel, Buffer.byteLength(lastResult.stdout, 'utf8'));

    // Post-hoc cost cap warning for non-streaming path (OB-F101).
    // Cannot abort after completion — log warning so callers can diagnose spikes.
    const costCap = getProfileCostCap(opts.profile, opts.workerCostCaps);
    if (costCap !== undefined && costUsd > costCap) {
      logger.warn(
        { cost: costUsd, cap: costCap, profile: opts.profile },
        `Worker cost cap exceeded: ${costUsd.toFixed(4)} > ${costCap} for profile ${opts.profile ?? 'unknown'}`,
      );
    }

    // 10x average spike detection (OB-1673)
    checkProfileCostSpike(opts.profile, costUsd);

    // Fix iteration cap check (OB-1789).
    // Count how many lint/test fix attempts appear in the output.
    // If the count reaches maxFixIterations, mark the result accordingly.
    const maxFixIterations = opts.maxFixIterations ?? DEFAULT_MAX_FIX_ITERATIONS;
    const fixIterationsUsed =
      maxFixIterations > 0 ? countFixIterations(lastResult.stdout) : undefined;
    const fixCapReached = fixIterationsUsed !== undefined && fixIterationsUsed >= maxFixIterations;

    let resultStatus: AgentResult['status'];
    if (fixCapReached) {
      resultStatus = 'fix-cap-reached';
    } else if (turnsExhausted) {
      resultStatus = 'partial';
    } else {
      resultStatus = 'completed';
    }

    const result: AgentResult = {
      stdout: lastResult.stdout,
      stderr: lastResult.stderr,
      exitCode: lastResult.exitCode,
      durationMs,
      retryCount,
      model: currentModel,
      modelFallbacks: modelFallbacks.length > 0 ? modelFallbacks : undefined,
      costUsd,
      turnsExhausted: turnsExhausted || undefined,
      maxTurns: opts.maxTurns,
      status: resultStatus,
      fixIterationsUsed,
      fixCapReached: fixCapReached || undefined,
    };

    if (fixCapReached) {
      logger.warn(
        {
          fixIterationsUsed,
          maxFixIterations,
          model: currentModel ?? 'default',
        },
        'Worker hit fix iteration cap — escalating to Master',
      );
    } else if (turnsExhausted) {
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
        status: result.status,
        fixIterationsUsed: result.fixIterationsUsed,
        fixCapReached: result.fixCapReached,
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
   * Spawn an AI CLI agent and immediately return a handle with the child PID
   * and an abort function, without waiting for the run to complete.
   *
   * The returned `promise` resolves to the same `AgentResult` that `spawn()`
   * would produce (including retries and model fallback). The `abort()` function
   * always targets the *currently running* child process — it updates across
   * retry boundaries so a late abort still kills an in-progress retry.
   *
   * Use this instead of `spawn()` when the caller needs to:
   *   - record the worker PID in a registry before the run finishes
   *   - cancel a long-running worker in response to a user "stop" command
   *
   * Keep `spawn()` unchanged for backward compatibility.
   */
  spawnWithHandle(opts: SpawnOptions): SpawnHandle {
    const retries = opts.retries ?? 3;
    const retryDelay = opts.retryDelay ?? 10_000;
    let currentModel = opts.model;
    let currentConfig = this.adapter.buildSpawnConfig(opts);
    const startTime = Date.now();
    const modelFallbacks: string[] = [];

    // Mutable reference to the kill function of the currently-running process.
    // Updated on each retry so abort() always terminates the live child.
    let currentKill: (() => void) | undefined;

    const abort = (): void => {
      currentKill?.();
    };

    // Launch the first execution immediately — this lets us capture its PID
    // synchronously before the async retry loop begins.
    const firstHandle = execOnce(currentConfig, opts.workspacePath, opts.timeout);
    currentKill = firstHandle.kill;
    const initialPid = firstHandle.pid;

    logger.debug(
      {
        workspacePath: opts.workspacePath,
        model: opts.model,
        maxTurns: opts.maxTurns,
        allowedTools: opts.allowedTools,
        timeout: opts.timeout,
        retries,
        pid: initialPid,
        sessionId: opts.resumeSessionId ?? opts.sessionId,
      },
      'Spawning agent with handle',
    );

    const promise = (async (): Promise<AgentResult> => {
      const attemptRecords: AttemptRecord[] = [];
      let lastResult: { stdout: string; stderr: string; exitCode: number } | undefined;
      let attempt = 0;

      // The first iteration uses the already-started handle; subsequent
      // iterations create new execOnce() calls for each retry.
      let currentHandle: ExecOnceHandle = firstHandle;

      for (attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
          logger.warn(
            { attempt, maxRetries: retries, delay: retryDelay },
            'Retrying agent after non-zero exit',
          );
          await sleep(retryDelay);
          currentHandle = execOnce(currentConfig, opts.workspacePath, opts.timeout);
          currentKill = currentHandle.kill;
        }

        try {
          lastResult = await currentHandle.promise;
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

        // Rate-limit / model unavailability — fall back to next model
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

      if (!lastResult || lastResult.exitCode !== 0) {
        throw new AgentExhaustedError(attemptRecords, durationMs);
      }

      const turnsExhausted = isMaxTurnsExhausted(lastResult.stdout);

      const costUsdHandle = estimateCostUsd(
        currentModel,
        Buffer.byteLength(lastResult.stdout, 'utf8'),
      );

      // Post-hoc cost cap warning for non-streaming path (OB-F101).
      const costCapHandle = getProfileCostCap(opts.profile, opts.workerCostCaps);
      if (costCapHandle !== undefined && costUsdHandle > costCapHandle) {
        logger.warn(
          { cost: costUsdHandle, cap: costCapHandle, profile: opts.profile },
          `Worker cost cap exceeded: ${costUsdHandle.toFixed(4)} > ${costCapHandle} for profile ${opts.profile ?? 'unknown'}`,
        );
      }

      // 10x average spike detection (OB-1673)
      checkProfileCostSpike(opts.profile, costUsdHandle);

      // Fix iteration cap check (OB-1789).
      const maxFixIterationsHandle = opts.maxFixIterations ?? DEFAULT_MAX_FIX_ITERATIONS;
      const fixIterationsUsedHandle =
        maxFixIterationsHandle > 0 ? countFixIterations(lastResult.stdout) : undefined;
      const fixCapReachedHandle =
        fixIterationsUsedHandle !== undefined && fixIterationsUsedHandle >= maxFixIterationsHandle;

      let handleStatus: AgentResult['status'];
      if (fixCapReachedHandle) {
        handleStatus = 'fix-cap-reached';
      } else if (turnsExhausted) {
        handleStatus = 'partial';
      } else {
        handleStatus = 'completed';
      }

      const result: AgentResult = {
        stdout: lastResult.stdout,
        stderr: lastResult.stderr,
        exitCode: lastResult.exitCode,
        durationMs,
        retryCount,
        model: currentModel,
        modelFallbacks: modelFallbacks.length > 0 ? modelFallbacks : undefined,
        costUsd: costUsdHandle,
        turnsExhausted: turnsExhausted || undefined,
        maxTurns: opts.maxTurns,
        status: handleStatus,
        fixIterationsUsed: fixIterationsUsedHandle,
        fixCapReached: fixCapReachedHandle || undefined,
      };

      if (fixCapReachedHandle) {
        logger.warn(
          {
            fixIterationsUsed: fixIterationsUsedHandle,
            maxFixIterations: maxFixIterationsHandle,
            model: currentModel ?? 'default',
          },
          'Worker hit fix iteration cap — escalating to Master',
        );
      } else if (turnsExhausted) {
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
          fixIterationsUsed: result.fixIterationsUsed,
          fixCapReached: result.fixCapReached,
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
    })();

    return { promise, pid: initialPid, abort };
  }

  /**
   * Spawn an AI CLI agent with real-time streaming progress via turn-indicator parsing.
   *
   * Identical to spawnWithHandle() — returns pid, abort, and a result promise —
   * but uses execOnceStreaming() internally so that stdout chunks are inspected
   * as they arrive. Whenever parseTurnIndicator() detects a new agent turn in a
   * chunk, the optional onProgress callback is invoked with the TurnIndicator.
   *
   * Use this instead of spawnWithHandle() when the caller needs real-time turn
   * visibility (e.g. to broadcast worker-turn-progress events to connectors).
   */
  spawnWithStreamingHandle(
    opts: SpawnOptions,
    onProgress?: (indicator: TurnIndicator) => void,
  ): SpawnHandle {
    const retries = opts.retries ?? 3;
    const retryDelay = opts.retryDelay ?? 10_000;
    let currentModel = opts.model;
    let currentConfig = this.adapter.buildSpawnConfig(opts);
    const startTime = Date.now();
    const modelFallbacks: string[] = [];

    // Mutable reference to the abort function of the currently-running stream.
    // Updated on each retry so abort() always terminates the live child.
    let currentAbort: (() => void) | undefined;
    const abort = (): void => {
      currentAbort?.();
    };

    // Launch the first execution immediately — this lets us capture its PID
    // synchronously before the async retry loop begins.
    const firstStreaming = execOnceStreaming(currentConfig, opts.workspacePath, opts.timeout);
    currentAbort = firstStreaming.abort;
    const initialPid = firstStreaming.pid;

    logger.debug(
      {
        workspacePath: opts.workspacePath,
        model: opts.model,
        maxTurns: opts.maxTurns,
        allowedTools: opts.allowedTools,
        timeout: opts.timeout,
        retries,
        pid: initialPid,
        sessionId: opts.resumeSessionId ?? opts.sessionId,
      },
      'Spawning agent with streaming handle',
    );

    const promise = (async (): Promise<AgentResult> => {
      const attemptRecords: AttemptRecord[] = [];
      let attempt = 0;
      let lastTurnsUsed = 0;

      // The first iteration uses the already-started streaming handle.
      let currentStreaming: ReturnType<typeof execOnceStreaming> = firstStreaming;

      for (attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
          logger.warn(
            { attempt, maxRetries: retries, delay: retryDelay },
            'Retrying streaming agent after non-zero exit',
          );
          await sleep(retryDelay);
          currentStreaming = execOnceStreaming(currentConfig, opts.workspacePath, opts.timeout);
          currentAbort = currentStreaming.abort;
        }

        let stdout = '';
        let streamResult: { exitCode: number; stderr: string } | undefined;
        let spawnError: Error | undefined;
        let costCapExceeded = false;
        let costCapMessage = '';

        try {
          // Drain all chunks — accumulate stdout and report turn progress
          let iterResult = await currentStreaming.chunks.next();
          while (!iterResult.done) {
            const chunk = iterResult.value;
            stdout += chunk;

            // Per-profile cost cap check (OB-F101).
            // Estimate cost from accumulated output; abort early if cap exceeded.
            const costCap = getProfileCostCap(opts.profile, opts.workerCostCaps);
            if (costCap !== undefined) {
              const currentCostUsd = estimateCostUsd(
                currentModel,
                Buffer.byteLength(stdout, 'utf8'),
              );
              if (currentCostUsd > costCap) {
                costCapMessage = `Worker cost cap exceeded: ${currentCostUsd.toFixed(4)} > ${costCap} for profile ${opts.profile ?? 'unknown'}`;
                logger.warn(
                  { cost: currentCostUsd, cap: costCap, profile: opts.profile },
                  costCapMessage,
                );
                currentAbort?.();
                costCapExceeded = true;
                break;
              }
            }

            if (onProgress) {
              if (currentConfig.parseStreamChunk) {
                // Adapter has incremental stream parser (e.g. Codex --json JSONL).
                // Split chunk by lines — each line may be a separate structured event.
                // Transform readable events to synthetic TurnIndicators so users see
                // real-time progress instead of raw JSON.
                for (const line of chunk.split('\n')) {
                  if (!line.trim()) continue;
                  const parsedText = currentConfig.parseStreamChunk(line);
                  if (parsedText !== null) {
                    lastTurnsUsed++;
                    onProgress({ turnsUsed: lastTurnsUsed, lastAction: parsedText });
                  }
                }
              } else {
                // Claude path — use turn indicator parsing for Claude-specific patterns.
                const indicator = parseTurnIndicator(chunk);
                if (indicator) {
                  lastTurnsUsed = indicator.turnsUsed;
                  onProgress(indicator);
                }
              }
            }
            iterResult = await currentStreaming.chunks.next();
          }
          if (!costCapExceeded && iterResult.done) {
            streamResult = iterResult.value;
          }
        } catch (error) {
          logger.error({ error, attempt }, 'Agent streaming handle error');
          spawnError = error instanceof Error ? error : new Error(String(error));
        }

        // Cost cap exceeded — abort immediately without retrying
        if (costCapExceeded) {
          attemptRecords.push({ attempt, exitCode: 1, stderr: costCapMessage });
          throw new AgentExhaustedError(attemptRecords, Date.now() - startTime);
        }

        if (spawnError) {
          attemptRecords.push({
            attempt,
            exitCode: -1,
            stderr: spawnError.message,
          });
          if (attempt < retries) continue;
          throw new AgentExhaustedError(attemptRecords, Date.now() - startTime);
        }

        if (streamResult!.exitCode === 0) {
          const durationMs = Date.now() - startTime;
          const retryCount = attempt;
          const turnsExhausted = isMaxTurnsExhausted(stdout);

          // Apply adapter-specific output parsing (e.g. Codex --json JSONL extraction)
          let parsedStdout = stdout;
          if (currentConfig.parseOutput) {
            try {
              parsedStdout = currentConfig.parseOutput(stdout);
            } catch (parseErr) {
              logger.warn({ parseErr }, 'parseOutput threw — falling back to raw stdout');
            }
          }

          const streamCostUsd = estimateCostUsd(currentModel, Buffer.byteLength(stdout, 'utf8'));

          // 10x average spike detection (OB-1673)
          checkProfileCostSpike(opts.profile, streamCostUsd);

          // Fix iteration cap check (OB-1789).
          const maxFixIterationsStream = opts.maxFixIterations ?? DEFAULT_MAX_FIX_ITERATIONS;
          const fixIterationsUsedStream =
            maxFixIterationsStream > 0 ? countFixIterations(stdout) : undefined;
          const fixCapReachedStream =
            fixIterationsUsedStream !== undefined &&
            fixIterationsUsedStream >= maxFixIterationsStream;

          let streamStatus: AgentResult['status'];
          if (fixCapReachedStream) {
            streamStatus = 'fix-cap-reached';
          } else if (turnsExhausted) {
            streamStatus = 'partial';
          } else {
            streamStatus = 'completed';
          }

          const result: AgentResult = {
            stdout: parsedStdout,
            stderr: streamResult!.stderr,
            exitCode: 0,
            durationMs,
            retryCount,
            model: currentModel,
            modelFallbacks: modelFallbacks.length > 0 ? modelFallbacks : undefined,
            costUsd: streamCostUsd,
            turnsExhausted: turnsExhausted || undefined,
            turnsUsed: lastTurnsUsed > 0 ? lastTurnsUsed : undefined,
            maxTurns: opts.maxTurns,
            status: streamStatus,
            fixIterationsUsed: fixIterationsUsedStream,
            fixCapReached: fixCapReachedStream || undefined,
          };

          if (fixCapReachedStream) {
            logger.warn(
              {
                fixIterationsUsed: fixIterationsUsedStream,
                maxFixIterations: maxFixIterationsStream,
                model: currentModel ?? 'default',
              },
              'Streaming worker hit fix iteration cap — escalating to Master',
            );
          } else if (turnsExhausted) {
            logger.warn(
              {
                model: currentModel ?? 'default',
                maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS_TASK,
              },
              'Streaming agent exited with code 0 but max-turns was exhausted — result may be incomplete',
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
              fixIterationsUsed: result.fixIterationsUsed,
              fixCapReached: result.fixCapReached,
            },
            'Streaming agent completed',
          );

          if (opts.logFile) {
            try {
              await writeLogFile(opts.logFile, opts, result);
              logger.debug({ logFile: opts.logFile }, 'Streaming agent log written to disk');
            } catch (logError) {
              logger.warn({ logFile: opts.logFile, error: logError }, 'Failed to write agent log');
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
          'Streaming agent exited with non-zero code',
        );

        attemptRecords.push({
          attempt,
          exitCode: streamResult!.exitCode,
          stderr: streamResult!.stderr,
        });

        // Rate-limit / model unavailability — fall back to next model
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
    })();

    return { promise, pid: initialPid, abort };
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

        // Apply adapter-specific output parsing (e.g. Codex --json JSONL extraction)
        let parsedStdout = stdout;
        if (currentConfig.parseOutput) {
          try {
            parsedStdout = currentConfig.parseOutput(stdout);
          } catch (parseErr) {
            logger.warn({ parseErr }, 'parseOutput threw — falling back to raw stdout');
          }
        }

        const result: AgentResult = {
          stdout: parsedStdout,
          stderr: streamResult!.stderr,
          exitCode: 0,
          durationMs,
          retryCount,
          model: currentModel,
          modelFallbacks: modelFallbacks.length > 0 ? modelFallbacks : undefined,
          costUsd: estimateCostUsd(currentModel, Buffer.byteLength(stdout, 'utf8')),
          turnsExhausted: turnsExhausted || undefined,
          maxTurns: opts.maxTurns,
          status: turnsExhausted ? 'partial' : 'completed',
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
    const { spawnOptions, cleanup } = await manifestToSpawnOptions(manifest, customProfiles);
    try {
      return await this.spawn(spawnOptions);
    } finally {
      await cleanup();
    }
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
    const { spawnOptions, cleanup } = await manifestToSpawnOptions(manifest, customProfiles);
    try {
      return yield* this.stream(spawnOptions);
    } finally {
      await cleanup();
    }
  }
}
