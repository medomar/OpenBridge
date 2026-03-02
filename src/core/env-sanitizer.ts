/**
 * Environment Variable Sanitizer
 *
 * Prevents sensitive secrets (API keys, DB credentials, tokens) from leaking
 * to spawned worker processes. All CLI adapters use this shared module.
 *
 * @see OB-F70 — Environment variables leak sensitive secrets to workers
 */

import { createLogger } from './logger.js';
import type { SecurityConfig } from '../types/config.js';

const logger = createLogger('env-sanitizer');

/** Convert a simple glob pattern (with * wildcards) to a regex */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
  return new RegExp(regexStr);
}

function matchesAnyPattern(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => globToRegex(pattern).test(name));
}

/**
 * Sanitize environment variables for a worker process.
 *
 * For each variable name:
 *   1. If it matches any pattern in `config.envDenyPatterns`, it is a candidate for removal.
 *   2. If it also matches any pattern in `config.envAllowPatterns`, it is kept (allow overrides deny).
 *   3. Otherwise it is stripped from the returned object.
 *
 * `process.env` is never mutated; a new object is always returned.
 */
export function sanitizeEnv(
  env: Record<string, string | undefined>,
  config: SecurityConfig,
): Record<string, string | undefined> {
  const { envDenyPatterns, envAllowPatterns } = config;
  const result: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(env)) {
    const denied = matchesAnyPattern(key, envDenyPatterns);
    if (denied) {
      const allowed = envAllowPatterns.length > 0 && matchesAnyPattern(key, envAllowPatterns);
      if (!allowed) {
        continue; // strip
      }
    }
    result[key] = value;
  }

  return result;
}

/**
 * Scan the current environment for known secret patterns and log warnings.
 * Called once at bridge startup for transparency.
 */
export function warnAboutExposedSecrets(
  env: Record<string, string | undefined>,
  denyPatterns: readonly string[],
): string[] {
  const found: string[] = [];

  for (const key of Object.keys(env)) {
    if (matchesAnyPattern(key, denyPatterns) && env[key] !== undefined) {
      found.push(key);
    }
  }

  if (found.length > 0) {
    logger.warn(
      { count: found.length, vars: found },
      'Detected %d environment variable(s) matching secret patterns — these will be stripped from worker environments',
      found.length,
    );
  }

  return found;
}
