/**
 * Worker Result Formatter — Structures worker results for injection into the Master session.
 *
 * When workers complete (success or failure), their results are formatted as structured
 * messages and fed back into the Master session. The Master reads these to synthesize
 * a final response to the user.
 *
 * Format mirrors OpenClaw's auto-announcement pattern: results are pushed to the
 * Master session as follow-up messages — no polling required.
 */

import type { AgentResult, ErrorCategory } from '../core/agent-runner.js';
import { classifyError } from '../core/agent-runner.js';
import { parseCodexJsonlOutput } from '../core/adapters/codex-adapter.js';

/**
 * Metadata about a completed worker execution.
 */
export interface WorkerResultMeta {
  /** Worker index (1-based) within the current batch */
  workerIndex: number;
  /** Total number of workers in this batch */
  totalWorkers: number;
  /** The profile used for this worker (e.g., "read-only", "code-edit") */
  profile: string;
  /** The model requested for this worker (e.g., "haiku", "sonnet") */
  model?: string;
  /** The AI tool used for this worker (e.g., "claude", "codex", "aider") */
  tool?: string;
  /** Duration of the worker execution in milliseconds */
  durationMs: number;
  /** Whether the worker succeeded */
  success: boolean;
  /** Exit code from the worker process */
  exitCode: number;
  /** Number of retries that occurred */
  retryCount: number;
  /**
   * Classified error category for failed workers (from classifyError).
   * When present, formatWorkerError uses the [WORKER FAILED: <category>] format
   * so the Master AI can take category-specific re-delegation actions.
   */
  errorCategory?: ErrorCategory;
  /** Whether the worker exhausted its turn budget before completing */
  turnsExhausted?: boolean;
  /** Maximum turns the worker was allowed (used in the partial warning message) */
  maxTurns?: number;
}

/**
 * Defensive guard: if output looks like raw Codex JSONL (starts with `{"type":`),
 * parse it through parseCodexJsonlOutput() to extract readable text.
 *
 * This catches any code paths where parseOutput() was not applied before the
 * worker result reached the formatter (e.g., non-streaming fallbacks, edge cases
 * in adapter wiring, or future adapters that emit JSONL without a parseOutput hook).
 */
export function sanitizeWorkerOutput(output: string): string {
  const trimmed = output.trimStart();
  if (trimmed.startsWith('{"type":')) {
    return parseCodexJsonlOutput(output);
  }
  return output;
}

/**
 * Format a successful worker result for injection into the Master session.
 *
 * Output format:
 *   Worker result (haiku, read-only, worker 1/3, 1.2s):
 *   <output>
 */
export function formatWorkerResult(meta: WorkerResultMeta, output: string): string {
  const modelLabel = formatModelLabel(meta.tool, meta.model);
  const durationLabel = formatDuration(meta.durationMs);
  const workerLabel = `worker ${meta.workerIndex}/${meta.totalWorkers}`;
  const safeOutput = sanitizeWorkerOutput(output);

  let body = safeOutput.trim();
  if (meta.turnsExhausted) {
    const turns = meta.maxTurns ?? '?';
    body += `\n\n[PARTIAL — worker used all ${turns} turns, result may be incomplete]`;
  }

  return `[WORKER RESULT (${modelLabel}, ${meta.profile}, ${workerLabel}, ${durationLabel})]\n${body}\n[/WORKER RESULT]`;
}

/**
 * Format a failed worker result for injection into the Master session.
 *
 * When `meta.errorCategory` is set (worker failed after retries), uses the
 * [WORKER FAILED: <category>] format so the Master AI can take category-specific
 * re-delegation actions (e.g., retry with different model, split task, report to user).
 *
 * When no errorCategory is set (e.g., exception thrown before execution), falls back
 * to the generic [WORKER ERROR] format.
 *
 * Output format (with category):
 *   [WORKER FAILED: rate-limit (sonnet, code-edit, worker 2/3, 0.5s, exit 1)]
 *   <error details>
 *   [/WORKER FAILED]
 *
 * Output format (without category):
 *   [WORKER ERROR (sonnet, code-edit, worker 2/3, 0.5s, exit 1)]
 *   <error details>
 *   [/WORKER ERROR]
 */
export function formatWorkerError(meta: WorkerResultMeta, error: string): string {
  const modelLabel = formatModelLabel(meta.tool, meta.model);
  const durationLabel = formatDuration(meta.durationMs);
  const workerLabel = `worker ${meta.workerIndex}/${meta.totalWorkers}`;
  const details = `${modelLabel}, ${meta.profile}, ${workerLabel}, ${durationLabel}, exit ${meta.exitCode}`;

  if (meta.errorCategory) {
    return `[WORKER FAILED: ${meta.errorCategory} (${details})]\n${error.trim()}\n[/WORKER FAILED]`;
  }

  return `[WORKER ERROR (${details})]\n${error.trim()}\n[/WORKER ERROR]`;
}

/**
 * Maximum total characters for the combined feedback prompt.
 * Must stay under AgentRunner's MAX_PROMPT_LENGTH (32 768) to avoid truncation.
 * We use 30 000 to leave headroom for the wrapper text and metadata.
 */
const MAX_FEEDBACK_CHARS = 30_000;

/**
 * Truncate worker output to fit within a per-worker character budget.
 * Keeps the first and last portions so the Master sees both the beginning
 * (context/plan) and end (final result/summary) of the worker's output.
 */
function truncateWorkerOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  const half = Math.floor((maxChars - 60) / 2); // 60 chars for the "[... truncated ...]" marker
  return (
    output.slice(0, half) +
    `\n\n[... ${output.length - maxChars} chars truncated for synthesis ...]\n\n` +
    output.slice(-half)
  );
}

/**
 * Build the feedback prompt that injects worker results into the Master session.
 * This is the message sent back to the Master after all workers complete.
 *
 * Truncates individual worker outputs so the combined prompt stays under
 * MAX_FEEDBACK_CHARS, preventing downstream sanitizePrompt() from blindly
 * chopping the concatenated result.
 */
export function buildWorkerFeedbackPrompt(formattedResults: string[]): string {
  const summary = formattedResults.length === 1 ? '1 worker' : `${formattedResults.length} workers`;
  const wrapperOverhead = 200; // summary line + instruction suffix
  const perWorkerBudget = Math.floor(
    (MAX_FEEDBACK_CHARS - wrapperOverhead) / Math.max(formattedResults.length, 1),
  );

  const trimmed = formattedResults.map((r) => truncateWorkerOutput(r, perWorkerBudget));

  return `${summary} completed. Results:\n\n${trimmed.join('\n\n')}\n\nSummarize the worker results into a clear, user-friendly response. If a file was created, tell the user its path and a brief description. Be concise.`;
}

/**
 * Format a batch of worker outcomes (from Promise.allSettled) into structured results.
 * Returns both the formatted results array and the combined feedback prompt.
 */
export function formatWorkerBatch(
  outcomes: PromiseSettledResult<AgentResult>[],
  markers: Array<{ profile: string; body: { model?: string; tool?: string } }>,
): { formattedResults: string[]; feedbackPrompt: string } {
  const formattedResults: string[] = [];

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i]!;
    const marker = markers[i]!;
    const totalWorkers = outcomes.length;

    if (outcome.status === 'fulfilled') {
      const result = outcome.value;
      const meta: WorkerResultMeta = {
        workerIndex: i + 1,
        totalWorkers,
        profile: marker.profile,
        model: marker.body.model ?? result.model,
        tool: marker.body.tool,
        durationMs: result.durationMs,
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        retryCount: result.retryCount,
        // Classify the error so the Master can take category-specific re-delegation actions
        errorCategory:
          result.exitCode !== 0 ? classifyError(result.stderr, result.exitCode) : undefined,
        turnsExhausted: result.turnsExhausted,
        maxTurns: result.maxTurns,
      };

      if (result.exitCode === 0) {
        formattedResults.push(formatWorkerResult(meta, result.stdout));
      } else {
        formattedResults.push(formatWorkerError(meta, result.stderr || result.stdout));
      }
    } else {
      const errorMsg =
        outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
      const meta: WorkerResultMeta = {
        workerIndex: i + 1,
        totalWorkers,
        profile: marker.profile,
        model: marker.body.model,
        tool: marker.body.tool,
        durationMs: 0,
        success: false,
        exitCode: -1,
        retryCount: 0,
        // Exceptions (spawn failures) are treated as crash-category failures
        errorCategory: 'crash',
      };
      formattedResults.push(formatWorkerError(meta, errorMsg));
    }
  }

  return {
    formattedResults,
    feedbackPrompt: buildWorkerFeedbackPrompt(formattedResults),
  };
}

/**
 * Format the model label, optionally prefixed with the tool name.
 * Examples: "haiku", "codex/codex-mini", "aider/gpt-4o-mini"
 */
function formatModelLabel(tool?: string, model?: string): string {
  const modelName = model ?? 'default';
  if (!tool) return modelName;
  return `${tool}/${modelName}`;
}

/**
 * Format milliseconds into a human-readable duration string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
