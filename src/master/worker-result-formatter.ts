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

import type { AgentResult } from '../core/agent-runner.js';

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
  /** Duration of the worker execution in milliseconds */
  durationMs: number;
  /** Whether the worker succeeded */
  success: boolean;
  /** Exit code from the worker process */
  exitCode: number;
  /** Number of retries that occurred */
  retryCount: number;
}

/**
 * Format a successful worker result for injection into the Master session.
 *
 * Output format:
 *   Worker result (haiku, read-only, worker 1/3, 1.2s):
 *   <output>
 */
export function formatWorkerResult(meta: WorkerResultMeta, output: string): string {
  const modelLabel = meta.model ?? 'default';
  const durationLabel = formatDuration(meta.durationMs);
  const workerLabel = `worker ${meta.workerIndex}/${meta.totalWorkers}`;

  return `[WORKER RESULT (${modelLabel}, ${meta.profile}, ${workerLabel}, ${durationLabel})]\n${output.trim()}\n[/WORKER RESULT]`;
}

/**
 * Format a failed worker result for injection into the Master session.
 *
 * Output format:
 *   Worker error (sonnet, code-edit, worker 2/3, 0.5s, exit 1):
 *   <error details>
 */
export function formatWorkerError(meta: WorkerResultMeta, error: string): string {
  const modelLabel = meta.model ?? 'default';
  const durationLabel = formatDuration(meta.durationMs);
  const workerLabel = `worker ${meta.workerIndex}/${meta.totalWorkers}`;

  return `[WORKER ERROR (${modelLabel}, ${meta.profile}, ${workerLabel}, ${durationLabel}, exit ${meta.exitCode})]\n${error.trim()}\n[/WORKER ERROR]`;
}

/**
 * Build the feedback prompt that injects worker results into the Master session.
 * This is the message sent back to the Master after all workers complete.
 */
export function buildWorkerFeedbackPrompt(formattedResults: string[]): string {
  const summary = formattedResults.length === 1 ? '1 worker' : `${formattedResults.length} workers`;

  return `${summary} completed. Results:\n\n${formattedResults.join('\n\n')}\n\nPlease synthesize these results and provide a final response to the user.`;
}

/**
 * Format a batch of worker outcomes (from Promise.allSettled) into structured results.
 * Returns both the formatted results array and the combined feedback prompt.
 */
export function formatWorkerBatch(
  outcomes: PromiseSettledResult<AgentResult>[],
  markers: Array<{ profile: string; body: { model?: string } }>,
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
        durationMs: result.durationMs,
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        retryCount: result.retryCount,
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
        durationMs: 0,
        success: false,
        exitCode: -1,
        retryCount: 0,
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
 * Format milliseconds into a human-readable duration string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
