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
import { classifyError, extractRemainingErrors } from '../core/agent-runner.js';
import { parseCodexJsonlOutput } from '../core/adapters/codex-adapter.js';
import {
  extractObservation,
  extractFilesRead,
  extractFilesModified,
} from './observation-extractor.js';
import type { Observation } from '../memory/observation-store.js';
import type { WorkerSummary } from '../types/agent.js';

// ---------------------------------------------------------------------------
// Test file protection constants (OB-1788)
// ---------------------------------------------------------------------------

/** Profiles for which test file protection applies (mirrors master-manager.ts) */
const TEST_PROTECTION_PROFILES = new Set(['code-edit', 'full-access']);

/** In-prompt authorization marker set by master-manager.ts (OB-1787) */
const AUTHORIZED_MARKER = 'AUTHORIZED: test modification permitted';

/** Regex patterns identifying test file paths */
const TEST_FILE_PATTERNS: RegExp[] = [
  /(?:^|\/)tests\//,
  /(?:^|\/)__tests__\//,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
];

/**
 * Returns true if the file path matches any test file pattern.
 */
export function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some((re) => re.test(filePath));
}

/**
 * Returns the subset of files that are test files.
 * Used by OB-1788 to detect unauthorized test file modifications.
 */
export function detectTestFileModification(files: string[]): string[] {
  return files.filter(isTestFile);
}

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
  /**
   * Whether this worker was explicitly authorized to modify test files (OB-1787/OB-1788).
   * When false and test files are detected in the output, a flag is appended for Master review.
   * Only relevant for code-edit and full-access profiles.
   */
  testModificationAuthorized?: boolean;
  /**
   * True when the worker hit the fix iteration cap before resolving all errors (OB-1790).
   * When set, formatWorkerResult appends a [FIX CAP REACHED] block so the Master
   * can decide whether to retry, split the task, or accept the partial result.
   */
  fixCapReached?: boolean;
  /** Number of fix iterations the worker used before the cap was hit (OB-1790). */
  fixIterationsUsed?: number;
  /**
   * True when the worker was killed because cumulative cost exceeded maxCostUsd (OB-1524).
   * When set, formatWorkerError appends a cost-capped advisory so the Master can
   * adapt its strategy (e.g., narrow the prompt or use a cheaper model).
   */
  costCapped?: boolean;
  /** The per-worker cost cap in USD that was exceeded (from SpawnOptions.maxCostUsd). */
  costCapUsd?: number;
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

  // OB-1790: When the fix iteration cap is hit, inject a structured report so the
  // Master can decide the next action (retry, split, escalate, or accept partial).
  if (meta.fixCapReached) {
    const iters = meta.fixIterationsUsed ?? '?';
    const remainingErrors = extractRemainingErrors(safeOutput);
    const errorList =
      remainingErrors.length > 0
        ? remainingErrors.map((e) => `• ${e}`).join('\n')
        : '(no specific error lines detected — review full output above)';
    body +=
      `\n\n[FIX CAP REACHED — ${iters} fix iterations exhausted, errors remain unresolved]\n` +
      `Unresolved errors:\n${errorList}\n` +
      `Decide: retry with narrower scope | split into subtasks | accept partial result\n` +
      `[/FIX CAP REACHED]`;
  }

  // OB-1788: Detect unauthorized test file modifications and flag for Master review.
  // Only applies to profiles that have test protection (code-edit, full-access).
  if (TEST_PROTECTION_PROFILES.has(meta.profile) && !meta.testModificationAuthorized) {
    const modifiedFiles = extractFilesModified(safeOutput);
    const unauthorizedTestFiles = detectTestFileModification(modifiedFiles);
    if (unauthorizedTestFiles.length > 0) {
      body += `\n\n[TEST FILES MODIFIED — UNAUTHORIZED: ${unauthorizedTestFiles.join(', ')}]`;
    }
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

  // OB-1524: When cost-capped, append an advisory so the Master can adapt its strategy.
  const costCapSuffix = meta.costCapped
    ? `\n[Worker cost-capped${meta.costCapUsd !== undefined ? ` at $${meta.costCapUsd.toFixed(2)}` : ''} — output may be incomplete. Consider narrowing the prompt or using a cheaper model.]`
    : '';

  if (meta.errorCategory) {
    return `[WORKER FAILED: ${meta.errorCategory} (${details})]\n${error.trim()}${costCapSuffix}\n[/WORKER FAILED]`;
  }

  return `[WORKER ERROR (${details})]\n${error.trim()}${costCapSuffix}\n[/WORKER ERROR]`;
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
 *
 * When `workerIds` and `sessionId` are provided, also extracts a structured
 * Observation from each fulfilled worker result via the observation extractor.
 * The caller is responsible for persisting the returned observations.
 */
export function formatWorkerBatch(
  outcomes: PromiseSettledResult<AgentResult>[],
  markers: Array<{
    profile: string;
    body: {
      model?: string;
      tool?: string;
      prompt?: string;
      allowTestModification?: boolean;
      maxCostUsd?: number;
    };
  }>,
  workerIds?: string[],
  sessionId?: string,
): {
  formattedResults: string[];
  feedbackPrompt: string;
  observations: Observation[];
  workerSummaries: WorkerSummary[];
} {
  const formattedResults: string[] = [];
  const observations: Observation[] = [];
  const workerSummaries: WorkerSummary[] = [];

  for (let i = 0; i < outcomes.length; i++) {
    const outcome = outcomes[i]!;
    const marker = markers[i]!;
    const totalWorkers = outcomes.length;

    if (outcome.status === 'fulfilled') {
      const result = outcome.value;
      // OB-1788: Determine if this worker was authorized to modify test files.
      // Authorization comes from the SPAWN marker flag OR the in-prompt AUTHORIZED_MARKER text.
      const isTestAuthorized =
        marker.body.allowTestModification === true ||
        (marker.body.prompt?.includes(AUTHORIZED_MARKER) ?? false);
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
        // Only set for profiles where test protection is enforced
        testModificationAuthorized: TEST_PROTECTION_PROFILES.has(marker.profile)
          ? isTestAuthorized
          : undefined,
        // OB-1790: pass fix cap state so formatWorkerResult can build the escalation report
        fixCapReached: result.fixCapReached,
        fixIterationsUsed: result.fixIterationsUsed,
        // OB-1524: pass cost-cap state so formatWorkerError can advise the Master
        costCapped: result.costCapped,
        costCapUsd: marker.body.maxCostUsd,
      };

      if (result.exitCode === 0) {
        formattedResults.push(formatWorkerResult(meta, result.stdout));
      } else {
        formattedResults.push(formatWorkerError(meta, result.stderr || result.stdout));
      }

      // Extract a structured observation from the worker output when we have session context
      if (sessionId) {
        const workerId = workerIds?.[i] || `worker-${i + 1}`;
        const output = result.stdout || result.stderr;
        if (output.trim()) {
          observations.push(
            extractObservation({
              output,
              sessionId,
              workerId,
              profile: marker.profile,
              prompt: marker.body.prompt,
            }),
          );
        }
      }

      // Extract a structured WorkerSummary from the worker output (OB-1632)
      const workerOutput = result.stdout || result.stderr;
      if (workerOutput.trim()) {
        workerSummaries.push(
          extractWorkerSummary(workerOutput, marker.body.prompt ?? '', result.exitCode !== 0),
        );
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
    observations,
    workerSummaries,
  };
}

// ---------------------------------------------------------------------------
// Worker Summary Extraction (OB-1632)
// ---------------------------------------------------------------------------

/**
 * Extract the text body of the first matching markdown section.
 * Returns content between the matched heading and the next heading (or EOF),
 * collapsed to a single line and trimmed to maxChars.
 */
function extractMarkdownSection(text: string, headingRe: RegExp, maxChars = 300): string {
  const lines = text.split('\n');
  const collected: string[] = [];
  let capturing = false;

  for (const line of lines) {
    if (headingRe.test(line)) {
      capturing = true;
      continue;
    }
    if (capturing) {
      if (/^#{1,3}\s/.test(line)) break; // next heading → stop collecting
      collected.push(line);
    }
  }

  return collected.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

/**
 * Extract lines that match keyword patterns and join them into a string.
 * Lines shorter than 10 characters are skipped.
 */
function extractByKeywords(text: string, keywordRe: RegExp, maxChars = 300): string {
  const matches: string[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length < 10) continue;
    if (keywordRe.test(trimmed)) matches.push(trimmed);
  }
  return matches.join(' ').slice(0, maxChars).trim();
}

/**
 * Extract a structured WorkerSummary from raw worker output text.
 *
 * Uses regex heuristics to identify:
 *  - investigated: what the worker read/explored
 *  - completed:    what was accomplished
 *  - learned:      key insights from the task
 *  - next_steps:   recommended follow-up actions
 *  - files_read / files_modified: delegated to observation-extractor helpers
 *  - error_summary: error text when the worker failed (isError=true)
 *
 * No AI calls — pure regex + heuristics.
 */
export function extractWorkerSummary(
  output: string,
  request: string,
  isError = false,
): WorkerSummary {
  const investigated =
    extractMarkdownSection(
      output,
      /^#{1,3}\s+(investigation|analysis|what\s+i?\s*(investigated|explored|analy[sz]ed?|found)|context)/i,
    ) ||
    extractByKeywords(
      output,
      /\b(read|explored?|investigated?|inspected?|scanned?|analy[sz]ed?|examined?|loaded?)\b/i,
    );

  const completed =
    extractMarkdownSection(
      output,
      /^#{1,3}\s+(summary|completed?|result|what\s+was\s+done|changes?\s+made|accomplished|done)/i,
    ) ||
    extractByKeywords(
      output,
      /^(fixed|updated|added|removed?|created|modified|refactored|implemented|resolved|wrote|completed|changed|migrated|improved)\b/i,
    );

  const learned =
    extractMarkdownSection(
      output,
      /^#{1,3}\s+(finding|insight|learned?|key\s+(note|insight|finding)|important|takeaway)/i,
    ) ||
    extractByKeywords(
      output,
      /^(note:|finding:|insight:|learned:|important:|discovered:|key\s+(insight|finding):)/i,
    );

  const next_steps =
    extractMarkdownSection(
      output,
      /^#{1,3}\s+(next[\s-]steps?|todo|remaining|follow.?up|what\s+(remains?|next)|recommendation)/i,
    ) ||
    extractByKeywords(
      output,
      /\b(next\s+steps?:?|todo:|remaining:|follow-?up:|should\s+(be\s+done|implement|fix|add)|needs?\s+to)\b/i,
    );

  let error_summary: string | undefined;
  if (isError && output.trim()) {
    error_summary =
      extractMarkdownSection(output, /^#{1,3}\s+(error|failure|problem|issue)/i, 200) ||
      extractByKeywords(output, /\b(error:|Error:|failed?:|exception:|error\s+message:)\b/i, 200) ||
      output.replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  return {
    request: request.trim() || 'unknown',
    investigated: investigated || '',
    completed: completed || '',
    learned: learned || '',
    next_steps: next_steps || '',
    files_modified: extractFilesModified(output),
    files_read: extractFilesRead(output),
    ...(error_summary !== undefined ? { error_summary } : {}),
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
