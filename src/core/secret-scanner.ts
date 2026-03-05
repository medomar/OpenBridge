import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLogger } from './logger.js';

const logger = createLogger('secret-scanner');

export type SecretSeverity = 'critical' | 'high' | 'medium';

export interface SecretMatch {
  /** Absolute path to the file */
  path: string;
  /** The sensitive pattern that matched */
  pattern: string;
  /** How sensitive the file is likely to be */
  severity: SecretSeverity;
}

interface SensitivePattern {
  pattern: string;
  severity: SecretSeverity;
}

/**
 * Environment-file basenames that are documentation / templates, not real secrets.
 * These are matched case-insensitively against the file basename and skipped
 * before any SENSITIVE_PATTERNS check.
 */
export const SENSITIVE_FILE_EXCEPTIONS: ReadonlySet<string> = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.test',
  '.env.defaults',
]);

/**
 * Scans a workspace root (1 level deep) for files whose names match sensitive patterns.
 * Name-check only — file contents are never read.
 *
 * Patterns are matched against the file's basename using minimatch-style glob semantics:
 * a leading '*' matches any prefix, trailing '*' matches any suffix.
 * The full list of patterns is defined in SENSITIVE_PATTERNS below and extended in OB-1468.
 */
export class SecretScanner {
  private readonly patterns: readonly SensitivePattern[];
  private readonly configExceptionPatterns: readonly string[];

  constructor(patterns?: SensitivePattern[], configExceptionPatterns?: string[]) {
    this.patterns = patterns ?? SENSITIVE_PATTERNS;
    this.configExceptionPatterns = configExceptionPatterns ?? [];
  }

  /**
   * Scan the workspace root directory (1 level deep) for files whose names match
   * any sensitive pattern.
   *
   * @param workspacePath  Absolute path to the workspace root.
   * @returns              Array of matches, one per detected sensitive file.
   */
  public async scanWorkspace(workspacePath: string): Promise<SecretMatch[]> {
    const matches: SecretMatch[] = [];

    let entries: { name: string; isFile(): boolean }[];
    try {
      entries = await fs.readdir(workspacePath, { withFileTypes: true });
    } catch (err) {
      logger.warn({ err, workspacePath }, 'SecretScanner: cannot read workspace directory');
      return matches;
    }

    for (const entry of entries) {
      // Only inspect files (skip directories and other special entries at root level)
      if (!entry.isFile()) continue;

      const basename = entry.name;
      const filePath = path.join(workspacePath, basename);

      // Skip well-known documentation / template env files — not real secrets
      if (SENSITIVE_FILE_EXCEPTIONS.has(basename.toLowerCase())) continue;

      // Skip user-configured exception patterns from config.security.sensitiveFileExceptions
      if (this.configExceptionPatterns.some((pat) => matchesPattern(basename, pat))) continue;

      for (const { pattern, severity } of this.patterns) {
        if (matchesPattern(basename, pattern)) {
          matches.push({ path: filePath, pattern, severity });
          // Report first matching pattern per file — avoid duplicate entries
          break;
        }
      }
    }

    logger.debug(
      { workspacePath, scanned: entries.length, detected: matches.length },
      'SecretScanner: scan complete',
    );

    return matches;
  }
}

/**
 * Match a filename against a glob-style pattern.
 * Supports '*' wildcards anywhere in the pattern (any number of them).
 * A plain string pattern is an exact match against the basename.
 * Matching is case-insensitive.
 */
function matchesPattern(basename: string, pattern: string): boolean {
  const lower = basename.toLowerCase();
  const pat = pattern.toLowerCase();

  // Convert glob pattern to a regex: escape regex specials, then replace '*' with '.*'
  const regexStr = pat
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex special chars (preserves *)
    .replace(/\*/g, '.*'); // glob '*' → regex '.*'

  return new RegExp(`^${regexStr}$`).test(lower);
}

/**
 * Default sensitive file patterns.
 * Severity tiers:
 *   critical — private keys, certificates, keystores (exposure = immediate compromise)
 *   high     — credential files, password databases, environment secrets
 *   medium   — config files that may contain secrets
 */
export const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // --- Environment files (high) ---
  { pattern: '.env', severity: 'high' },
  { pattern: '.env.*', severity: 'high' },

  // --- Private keys and certificates (critical) ---
  { pattern: '*.pem', severity: 'critical' },
  { pattern: '*.key', severity: 'critical' },
  { pattern: '*.p12', severity: 'critical' },
  { pattern: '*.pfx', severity: 'critical' },
  { pattern: 'id*rsa*', severity: 'critical' }, // SSH RSA keys (id_rsa, id_rsa.pub, etc.)
  { pattern: 'id_ed25519*', severity: 'critical' }, // SSH Ed25519 keys
  { pattern: '*.jks', severity: 'critical' }, // Java KeyStore

  // --- Credential and secret files (high) ---
  { pattern: 'service-account*.json', severity: 'high' }, // GCP service accounts
  { pattern: 'credentials*.json', severity: 'high' }, // OAuth / API credentials
  { pattern: '*.kdbx', severity: 'high' }, // KeePass password database
];
