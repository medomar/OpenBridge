/**
 * Error classification helpers for worker exit analysis.
 *
 * Extracted from agent-runner.ts (OB-1285) so the classification
 * logic can be imported independently without pulling in the full
 * process-execution machinery.
 */

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
