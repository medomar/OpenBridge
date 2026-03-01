/**
 * Environment Variable Sanitizer
 *
 * Prevents sensitive secrets (API keys, DB credentials, tokens) from leaking
 * to spawned worker processes. All CLI adapters use this shared module.
 *
 * @see OB-F70 — Environment variables leak sensitive secrets to workers
 */

import { createLogger } from './logger.js';

const logger = createLogger('env-sanitizer');

/**
 * Default glob-style deny patterns that match common secret env var names.
 * These are stripped from worker environments out-of-the-box.
 */
export const DEFAULT_ENV_DENY_PATTERNS: readonly string[] = [
  // Cloud provider credentials
  'AWS_*',
  'AZURE_*',
  'GCP_*',
  'GOOGLE_*',

  // API keys and tokens
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GITLAB_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'API_KEY*',
  'SECRET_*',
  'TOKEN_*',
  '*_SECRET',
  '*_SECRET_*',
  '*_TOKEN',
  '*_API_KEY',

  // Database credentials
  'DATABASE_URL',
  'DB_*',
  'MONGO_*',
  'REDIS_*',
  'POSTGRES_*',
  'MYSQL_*',

  // Email / SMTP
  'SMTP_*',
  'MAIL_*',
  'EMAIL_PASSWORD',

  // Auth / crypto
  'PASSWORD*',
  'PRIVATE_KEY*',
  'SSH_*',
  'JWT_*',
  'AUTH_*',

  // Platform-specific agent vars (already handled, but included for completeness)
  'CLAUDECODE',
  'CLAUDE_CODE_*',
  'CLAUDE_AGENT_SDK_*',
];

/**
 * Minimum set of env vars workers always need to function.
 * These are never stripped, even if they match a deny pattern.
 */
const ALWAYS_ALLOW: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'XDG_RUNTIME_DIR',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
];

/** Convert a simple glob pattern (with * wildcards) to a regex */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
  return new RegExp(regexStr, 'i');
}

export interface EnvSanitizerOptions {
  /** Additional deny patterns beyond the defaults */
  extraDenyPatterns?: string[];
  /** Override defaults entirely — only these patterns are denied */
  denyPatterns?: string[];
  /** Allowlist mode — if set, ONLY these patterns + ALWAYS_ALLOW are kept */
  allowPatterns?: string[];
}

/**
 * Sanitize environment variables for a worker process.
 *
 * Default behavior: strip vars matching DEFAULT_ENV_DENY_PATTERNS.
 * Allowlist mode (when allowPatterns is set): only keep matching vars + ALWAYS_ALLOW.
 */
export function sanitizeEnv(
  env: Record<string, string | undefined>,
  options: EnvSanitizerOptions = {},
): Record<string, string | undefined> {
  const cleaned = { ...env };
  const alwaysAllowSet = new Set(ALWAYS_ALLOW.map((k) => k.toUpperCase()));

  if (options.allowPatterns && options.allowPatterns.length > 0) {
    // Allowlist mode: only keep vars matching allowPatterns + ALWAYS_ALLOW
    const allowRegexes = options.allowPatterns.map(globToRegex);
    for (const key of Object.keys(cleaned)) {
      const upper = key.toUpperCase();
      if (alwaysAllowSet.has(upper)) continue;
      const allowed = allowRegexes.some((re) => re.test(key));
      if (!allowed) {
        delete cleaned[key];
      }
    }
  } else {
    // Denylist mode (default): strip vars matching deny patterns
    const patterns = options.denyPatterns ?? [
      ...DEFAULT_ENV_DENY_PATTERNS,
      ...(options.extraDenyPatterns ?? []),
    ];
    const denyRegexes = patterns.map(globToRegex);

    for (const key of Object.keys(cleaned)) {
      const upper = key.toUpperCase();
      if (alwaysAllowSet.has(upper)) continue;
      const denied = denyRegexes.some((re) => re.test(key));
      if (denied) {
        delete cleaned[key];
      }
    }
  }

  return cleaned;
}

/**
 * Scan the current environment for known secret patterns and log warnings.
 * Called once at bridge startup for transparency.
 */
export function warnAboutExposedSecrets(env: Record<string, string | undefined>): string[] {
  const denyRegexes = DEFAULT_ENV_DENY_PATTERNS.map(globToRegex);
  const found: string[] = [];

  for (const key of Object.keys(env)) {
    const denied = denyRegexes.some((re) => re.test(key));
    if (denied && env[key] !== undefined) {
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
