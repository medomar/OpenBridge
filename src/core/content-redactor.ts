import { createLogger } from './logger.js';

const logger = createLogger('content-redactor');

export interface RedactionResult {
  /** The content with sensitive values replaced by REDACTED:<pattern_name> tokens */
  redacted: string;
  /** Number of replacements made across all patterns */
  redactionCount: number;
}

interface RedactionPattern {
  /** Human-readable name used in the replacement token, e.g. "openai_key" */
  name: string;
  /** Regex that matches the sensitive value. Must use the global flag (g) */
  pattern: RegExp;
}

export interface ContentRedactorOptions {
  /** Whether redaction is active. Defaults to false — opt-in feature */
  enabled?: boolean;
  /** Override the built-in pattern list */
  patterns?: RedactionPattern[];
}

/**
 * Scans text content for sensitive values (API keys, connection strings, private key blocks)
 * and replaces them with REDACTED:<pattern_name> tokens.
 *
 * This is an opt-in feature — disabled by default.
 * Enable by constructing with { enabled: true }.
 *
 * Redaction patterns are defined in DEFAULT_PATTERNS below and extended by OB-1471.
 */
export class ContentRedactor {
  private readonly enabled: boolean;
  private readonly patterns: readonly RedactionPattern[];

  constructor(options: ContentRedactorOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.patterns = options.patterns ?? DEFAULT_PATTERNS;
  }

  /**
   * Scan content for sensitive values and replace them with redaction tokens.
   *
   * If the redactor is disabled, returns the original content unchanged with count 0.
   *
   * @param content  Raw text to scan (e.g. file content, worker output, prompt text)
   * @returns        { redacted, redactionCount }
   */
  public redact(content: string): RedactionResult {
    if (!this.enabled) {
      return { redacted: content, redactionCount: 0 };
    }

    let redacted = content;
    let redactionCount = 0;

    for (const { name, pattern } of this.patterns) {
      const replacement = `REDACTED:${name}`;
      const matches = redacted.match(pattern);
      if (matches) {
        redactionCount += matches.length;
        redacted = redacted.replace(pattern, replacement);
      }
    }

    if (redactionCount > 0) {
      logger.debug({ redactionCount }, 'ContentRedactor: redacted sensitive values from content');
    }

    return { redacted, redactionCount };
  }
}

/**
 * Default redaction patterns.
 * Ordered from most specific to least specific to avoid partial matches shadowing
 * more-precise ones.
 */
export const DEFAULT_PATTERNS: RedactionPattern[] = [
  // PEM private key blocks — matched first (multi-line, most specific)
  {
    name: 'pem_private_key',
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  // OpenAI API keys: sk- or sk-proj- followed by 20+ base64url chars
  {
    name: 'openai_key',
    pattern: /sk-(?:proj-)?[A-Za-z0-9\-_]{20,}/g,
  },
  // AWS Access Key IDs: AKIA + 16 uppercase alphanumeric chars
  {
    name: 'aws_key',
    pattern: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
  },
  // GitHub Personal Access Tokens (classic)
  {
    name: 'github_pat',
    pattern: /ghp_[A-Za-z0-9]{36}/g,
  },
  // GitHub Server-to-Server tokens
  {
    name: 'github_server_token',
    pattern: /ghs_[A-Za-z0-9]{36}/g,
  },
  // MongoDB connection strings
  {
    name: 'mongodb_connection_string',
    pattern: /mongodb:\/\/[^\s"'`\])}]+/g,
  },
  // PostgreSQL connection strings
  {
    name: 'postgres_connection_string',
    pattern: /postgres(?:ql)?:\/\/[^\s"'`\])}]+/g,
  },
  // MySQL connection strings
  {
    name: 'mysql_connection_string',
    pattern: /mysql:\/\/[^\s"'`\])}]+/g,
  },
];
