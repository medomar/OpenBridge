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
 * Scans a workspace root (1 level deep) for files whose names match sensitive patterns.
 * Name-check only — file contents are never read.
 *
 * Patterns are matched against the file's basename using minimatch-style glob semantics:
 * a leading '*' matches any prefix, trailing '*' matches any suffix.
 * The full list of patterns is defined in SENSITIVE_PATTERNS below and extended in OB-1468.
 */
export class SecretScanner {
  private readonly patterns: readonly SensitivePattern[];

  constructor(patterns?: SensitivePattern[]) {
    this.patterns = patterns ?? SENSITIVE_PATTERNS;
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
 * Match a filename against a simple glob-style pattern.
 * Supports leading '*' (prefix wildcard) and trailing '*' (suffix wildcard).
 * A plain string pattern is an exact match against the basename.
 */
function matchesPattern(basename: string, pattern: string): boolean {
  const lower = basename.toLowerCase();
  const pat = pattern.toLowerCase();

  const startsWild = pat.startsWith('*');
  const endsWild = pat.endsWith('*');

  if (startsWild && endsWild) {
    // *foo* — basename must contain the middle segment
    const middle = pat.slice(1, -1);
    return lower.includes(middle);
  }
  if (startsWild) {
    // *foo — basename must end with suffix
    return lower.endsWith(pat.slice(1));
  }
  if (endsWild) {
    // foo* — basename must start with prefix
    return lower.startsWith(pat.slice(0, -1));
  }
  // Exact match (case-insensitive)
  return lower === pat;
}

/**
 * Default sensitive file patterns.
 * Extended in OB-1468 with the full set of credentials, certificates, and key files.
 */
export const SENSITIVE_PATTERNS: SensitivePattern[] = [
  // Environment files
  { pattern: '.env', severity: 'high' },
  { pattern: '.env.*', severity: 'high' },
];
