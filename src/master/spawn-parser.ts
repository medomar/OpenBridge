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
  /** Model override (e.g., 'haiku', 'sonnet', 'opus') */
  model: z.string().optional(),
  /** Max agentic turns for this worker */
  maxTurns: z.number().int().positive().optional(),
  /** Timeout in milliseconds */
  timeout: z.number().int().positive().optional(),
  /** Number of retries on failure */
  retries: z.number().int().nonnegative().optional(),
  /** Maximum spend in USD for this worker (passed as --max-budget-usd) */
  maxBudgetUsd: z.number().positive().optional(),
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
 * Parse Master AI output for [SPAWN:profile]{...}[/SPAWN] markers.
 *
 * Extracts all SPAWN markers, validates the JSON body against the schema,
 * and returns both the parsed markers and the cleaned output (with markers removed).
 *
 * Invalid markers (malformed JSON, schema validation failure) are logged as
 * warnings and skipped — they do not prevent valid markers from being parsed.
 */
export function parseSpawnMarkers(output: string): SpawnParseResult {
  const markers: ParsedSpawnMarker[] = [];
  let cleanedOutput = output;

  let match;
  // Reset lastIndex for global regex
  SPAWN_MARKER_PATTERN.lastIndex = 0;

  while ((match = SPAWN_MARKER_PATTERN.exec(output)) !== null) {
    const rawMatch = match[0];
    const profile = match[1]?.trim();
    const jsonBody = match[2]?.trim();

    if (!profile || !jsonBody) {
      logger.warn({ rawMatch }, 'SPAWN marker missing profile or body — skipping');
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
