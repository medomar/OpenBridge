/**
 * Spawn Parser — Parses [SPAWN:profile]{...}[/SPAWN] markers from Master output.
 *
 * The Master AI uses SPAWN markers to decompose user requests into worker subtasks.
 * Each marker contains a profile name and a JSON task manifest that describes the
 * worker to spawn. OpenBridge parses these, spawns workers via AgentRunner, and
 * feeds results back to the Master session.
 *
 * Format:
 *   [SPAWN:profile-name]{"prompt":"...","model":"haiku","maxTurns":10}[/SPAWN]
 *
 * The profile name is a shorthand resolved by AgentRunner (e.g., "read-only",
 * "code-edit", "full-access", or a custom profile from .openbridge/profiles.json).
 * The JSON body can override or extend the manifest with explicit values.
 */

import { z } from 'zod';
import { createLogger } from '../core/logger.js';

const logger = createLogger('spawn-parser');

/**
 * Schema for the JSON body inside a [SPAWN] marker.
 * All fields are optional except `prompt` — the profile from the marker tag
 * is applied as a default if not overridden in the JSON body.
 */
export const SpawnMarkerBodySchema = z.object({
  /** The prompt/instructions for the worker */
  prompt: z.string().min(1),
  /** Model override (e.g., 'haiku', 'sonnet', 'opus', or tier: 'fast', 'balanced', 'powerful') */
  model: z.string().optional(),
  /** AI tool to use for this worker (e.g., 'claude', 'codex', 'aider'). Defaults to master tool. */
  tool: z.string().optional(),
  /** Max agentic turns for this worker */
  maxTurns: z.number().int().positive().optional(),
  /** Timeout in milliseconds */
  timeout: z.number().int().positive().optional(),
  /** Number of retries on failure */
  retries: z.number().int().nonnegative().optional(),
  /** Maximum spend in USD for this worker (passed as --max-budget-usd) */
  maxBudgetUsd: z.number().positive().optional(),
  /**
   * Per-worker cost cap in USD — override the profile-based default.
   * When set, AgentRunner kills the process if cumulative cost exceeds this value.
   */
  maxCostUsd: z.number().positive().optional(),
  /** Explicitly grant this worker permission to modify test files (OB-1787).
   * When true, the spawnWorker logic injects an authorization header so the
   * worker knows test modifications are intentional and approved by the Master.
   * Use this when the user has explicitly requested test file changes. */
  allowTestModification: z.boolean().optional(),
});

export type SpawnMarkerBody = z.infer<typeof SpawnMarkerBodySchema>;

/**
 * A parsed SPAWN marker extracted from Master output.
 */
export interface ParsedSpawnMarker {
  /** The profile name from the marker tag (e.g., "read-only", "code-edit") */
  profile: string;
  /** The parsed JSON body with worker configuration */
  body: SpawnMarkerBody;
  /** The raw matched text (for stripping from the response) */
  rawMatch: string;
}

/**
 * Result of parsing Master output for SPAWN markers.
 */
export interface SpawnParseResult {
  /** Parsed SPAWN markers found in the output */
  markers: ParsedSpawnMarker[];
  /** The Master output with SPAWN markers stripped out */
  cleanedOutput: string;
}

/**
 * Regex to match [SPAWN:profile-name]{...JSON...}[/SPAWN] markers.
 *
 * Captures:
 *   group 1: profile name (alphanumeric, hyphens, underscores)
 *   group 2: JSON body (everything between ] and [/SPAWN])
 */
const SPAWN_MARKER_PATTERN = /\[SPAWN:([a-zA-Z0-9_-]+)\]([\s\S]*?)\[\/SPAWN\]/g;

/**
 * Strip triple-backtick code blocks from text.
 * Returns the text with all fenced code blocks replaced by empty strings.
 * This prevents the parser from picking up SPAWN examples in system prompt docs.
 */
function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '');
}

/**
 * Check whether a JSON string contains unresolved template variables (e.g. ${fastModel}).
 * These appear in system prompt examples and must not be treated as real markers.
 */
function hasTemplateVariables(jsonStr: string): boolean {
  return /\$\{[^}]+\}/.test(jsonStr);
}

/**
 * Parse Master AI output for [SPAWN:profile]{...}[/SPAWN] markers.
 *
 * Extracts all SPAWN markers, validates the JSON body against the schema,
 * and returns both the parsed markers and the cleaned output (with markers removed).
 *
 * Markers inside fenced code blocks (triple backticks) are ignored — these are
 * documentation examples from the system prompt, not real spawn requests.
 *
 * Invalid markers (malformed JSON, schema validation failure) are logged as
 * warnings and skipped — they do not prevent valid markers from being parsed.
 */
export function parseSpawnMarkers(output: string): SpawnParseResult {
  const markers: ParsedSpawnMarker[] = [];
  let cleanedOutput = output;

  // Strip code blocks before scanning so we don't parse system prompt examples.
  // We still scan the original `output` for raw matches to strip from cleanedOutput.
  const strippedOutput = stripCodeBlocks(output);

  let match;
  // Reset lastIndex for global regex
  SPAWN_MARKER_PATTERN.lastIndex = 0;

  while ((match = SPAWN_MARKER_PATTERN.exec(strippedOutput)) !== null) {
    const rawMatch = match[0];
    const profile = match[1]?.trim();
    const jsonBody = match[2]?.trim();

    if (!profile || !jsonBody) {
      logger.warn({ rawMatch }, 'SPAWN marker missing profile or body — skipping');
      continue;
    }

    // Reject markers with unresolved template variables (system prompt examples)
    if (hasTemplateVariables(jsonBody)) {
      logger.debug(
        { profile },
        'SPAWN marker contains template variables — skipping (likely a documentation example)',
      );
      continue;
    }

    // Parse and validate the JSON body
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonBody);
    } catch {
      logger.warn(
        { profile, jsonBody: jsonBody.slice(0, 200) },
        'SPAWN marker has invalid JSON — skipping',
      );
      continue;
    }

    const result = SpawnMarkerBodySchema.safeParse(parsed);
    if (!result.success) {
      logger.warn(
        { profile, errors: result.error.issues },
        'SPAWN marker body failed schema validation — skipping',
      );
      continue;
    }

    markers.push({
      profile,
      body: result.data,
      rawMatch,
    });

    // Strip marker from cleaned output
    cleanedOutput = cleanedOutput.replace(rawMatch, '');
  }

  // Clean up excess whitespace left by marker removal
  cleanedOutput = cleanedOutput.replace(/\n{3,}/g, '\n\n').trim();

  if (markers.length > 0) {
    logger.info(
      { markerCount: markers.length, profiles: markers.map((m) => m.profile) },
      'Parsed SPAWN markers from Master output',
    );
  }

  return { markers, cleanedOutput };
}

/**
 * Check if Master output contains any SPAWN markers.
 * Faster than full parsing when you just need a boolean check.
 */
export function hasSpawnMarkers(output: string): boolean {
  SPAWN_MARKER_PATTERN.lastIndex = 0;
  return SPAWN_MARKER_PATTERN.test(output);
}

/**
 * Extract one-line summaries from parsed SPAWN markers for status messages.
 *
 * Each summary is taken from the first non-empty line of the marker's prompt
 * field and truncated to 120 characters. Used to build dispatch status messages
 * when Master output consists entirely of SPAWN markers with no user-facing text.
 *
 * Edge cases:
 * - Multi-line prompts: only the first non-empty line is used
 * - Long summaries: truncated to 120 chars with ellipsis
 * - No useful description (prompt is missing or all whitespace): falls back to
 *   the profile name (e.g., "Task via read-only profile")
 */
export function extractTaskSummaries(spawnMarkers: ParsedSpawnMarker[]): string[] {
  return spawnMarkers.map((marker) => {
    const prompt = marker.body.prompt?.trim() ?? '';

    if (!prompt) {
      return `Task via ${marker.profile} profile`;
    }

    // Use only the first non-empty line for a one-line summary
    const firstLine = prompt
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0);

    if (!firstLine) {
      return `Task via ${marker.profile} profile`;
    }

    // Truncate to 120 chars
    if (firstLine.length > 120) {
      return firstLine.slice(0, 117) + '...';
    }

    return firstLine;
  });
}
