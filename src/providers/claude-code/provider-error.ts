/**
 * Error classification for provider failures.
 *
 * - `transient`: temporary failures that may succeed on retry (timeout, rate limit, network)
 * - `permanent`: failures that will not recover on retry (invalid input, auth, CLI not found)
 */
export type ErrorKind = 'transient' | 'permanent';

export class ProviderError extends Error {
  readonly kind: ErrorKind;
  readonly exitCode: number;

  constructor(message: string, kind: ErrorKind, exitCode: number) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.exitCode = exitCode;
  }
}

/** Patterns in stderr that indicate a transient (retryable) failure */
const TRANSIENT_PATTERNS = [
  /timeout/i,
  /timed?\s*out/i,
  /rate\s*limit/i,
  /too\s*many\s*requests/i,
  /ETIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
  /ENETUNREACH/,
  /EAI_AGAIN/,
  /overloaded/i,
  /temporarily\s*unavailable/i,
  /503/,
  /429/,
];

/** Patterns in stderr that indicate a permanent (non-retryable) failure */
const PERMANENT_PATTERNS = [
  /invalid\s*api\s*key/i,
  /authentication\s*failed/i,
  /unauthorized/i,
  /permission\s*denied/i,
  /not\s*found/i,
  /ENOENT/,
  /invalid\s*model/i,
  /400\s*bad\s*request/i,
];

/**
 * Classify a CLI execution failure as transient or permanent.
 *
 * Heuristics (in priority order):
 * 1. Exit code 124 or signal-based timeout → transient
 * 2. stderr matches a known transient pattern → transient
 * 3. stderr matches a known permanent pattern → permanent
 * 4. ENOENT spawn error (CLI missing) → permanent
 * 5. Default for unrecognised non-zero exit → transient (safer to retry)
 */
export function classifyError(exitCode: number, stderr: string): ErrorKind {
  // Timeout exit code (common for `timeout` command or Node child_process timeout)
  if (exitCode === 124) return 'transient';

  // Check stderr against known patterns — transient first
  for (const pattern of TRANSIENT_PATTERNS) {
    if (pattern.test(stderr)) return 'transient';
  }

  for (const pattern of PERMANENT_PATTERNS) {
    if (pattern.test(stderr)) return 'permanent';
  }

  // Default: treat unknown errors as transient (safe to retry)
  return 'transient';
}
