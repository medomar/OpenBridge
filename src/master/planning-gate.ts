/**
 * Planning Gate (OB-1775, OB-1776, OB-1777, OB-1778)
 *
 * Controls the two-phase execution model for Master AI task processing:
 *
 *   1. Analysis phase  — 1–2 read-only workers investigate the codebase,
 *      gather facts, and surface risks before any code is written.
 *      Workers are built via buildAnalysisWorkerSpecs() and capped at
 *      MAX_ANALYSIS_WORKERS (2).
 *
 *   2. Execution phase — code-edit workers implement the confirmed strategy.
 *      This phase ONLY starts after ALL analysis workers have returned their
 *      output AND the Master has explicitly confirmed the approach via
 *      confirmApproach(). Attempting to complete the analysis phase before all
 *      workers have finished throws an error (OB-1777).
 *
 * For simple tasks (single-file edits, FAQ answers), planning is bypassed
 * automatically via `shouldBypassPlanning()` (OB-1778). Wiring into
 * MasterManager is done by OB-1779; the reasoning checkpoint before
 * full-access workers is OB-1780.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../core/logger.js';

const logger = createLogger('planning-gate');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of read-only workers that may be spawned during the analysis
 * phase. Keeping the cap at 2 avoids over-investigation for most tasks while
 * still allowing a second worker for risk/dependency assessment.
 */
export const MAX_ANALYSIS_WORKERS = 2;

/**
 * Max agentic turns for each read-only analysis worker.
 * Analysis workers explore and report — they don't need many turns.
 */
export const ANALYSIS_WORKER_MAX_TURNS = 10;

// ---------------------------------------------------------------------------
// Simple-Task Heuristics (OB-1778)
// ---------------------------------------------------------------------------

/**
 * Word-count threshold below which a task is considered too short to need a
 * planning phase. Very brief tasks are typically single-step commands.
 */
const BYPASS_WORD_COUNT_THRESHOLD = 15;

/**
 * If a task mentions more than this many distinct file-path-like tokens it is
 * considered multi-file and therefore non-trivial (planning is NOT bypassed).
 */
const BYPASS_MAX_FILE_PATHS = 1;

/** Regex that matches a leading question word at the start of a task. */
const FAQ_PATTERN =
  /^\s*(what|how|why|who|where|when|which|explain|describe|list|show me|tell me|can you tell|is there|are there|does|do you|what is|what are|what does|what's)\b/i;

/** Regex that matches file-path-like tokens (src/…, ./…, absolute /path/…). */
const FILE_PATH_PATTERN = /(?:^|[\s"'`(])(?:\.{0,2}\/[\w./-]+|src\/[\w./-]+)/g;

/**
 * Result returned by `shouldBypassPlanning()`.
 *
 * When `bypass` is `true`, callers should call `gate.bypass(task, reason)`
 * immediately and skip the analysis phase entirely.
 */
export interface BypassDecision {
  /** Whether to skip the planning/analysis phase. */
  bypass: boolean;
  /** Human-readable reason (always set, even when bypass is false). */
  reason: string;
}

/**
 * Analyse a task description and decide whether the analysis phase should be
 * bypassed (OB-1778).
 *
 * A task bypasses planning when **any** of the following are true:
 *
 * 1. **FAQ / read-only question** — the task starts with a question word
 *    (what, how, why, explain, …) and contains no write-intent verbs
 *    (create, add, fix, update, refactor, delete, remove, implement).
 *
 * 2. **Single-file edit** — the task references exactly one file path token
 *    (e.g. `src/core/router.ts`) and does not involve many moving parts.
 *
 * 3. **Very short task** — the task is fewer than `BYPASS_WORD_COUNT_THRESHOLD`
 *    words, implying a single, atomic action that needs no pre-investigation.
 *
 * When multiple signals conflict (e.g. a short task with a write verb that
 * touches more than one file), the function returns `bypass: false` to keep
 * planning enabled.
 *
 * @param taskDescription Plain-text description of the task to evaluate.
 * @returns A `BypassDecision` with a boolean and human-readable reason.
 */
export function shouldBypassPlanning(taskDescription: string): BypassDecision {
  const trimmed = taskDescription.trim();

  if (!trimmed) {
    return { bypass: true, reason: 'empty task description — no planning needed' };
  }

  const words = trimmed.split(/\s+/);
  const wordCount = words.length;

  // Detect write-intent verbs — these suggest the task will modify files.
  const writeIntentPattern =
    /\b(create|add|fix|update|refactor|delete|remove|implement|write|rewrite|rename|move|migrate|replace|change|modify|patch|edit|set|enable|disable|configure)\b/i;
  const hasWriteIntent = writeIntentPattern.test(trimmed);

  // Count distinct file-path-like tokens in the task.
  const filePaths = Array.from(new Set(trimmed.match(FILE_PATH_PATTERN) ?? []));
  const filePathCount = filePaths.length;

  // ── Rule 1: FAQ / read-only question ──────────────────────────────────────
  if (FAQ_PATTERN.test(trimmed) && !hasWriteIntent) {
    return {
      bypass: true,
      reason: 'read-only FAQ question — no code changes implied',
    };
  }

  // ── Rule 2: Single-file edit ──────────────────────────────────────────────
  if (filePathCount === BYPASS_MAX_FILE_PATHS && hasWriteIntent) {
    return {
      bypass: true,
      reason: `single-file edit (${filePaths[0]?.trim()}) — no multi-file analysis required`,
    };
  }

  // ── Rule 3: Very short task (no multi-file concern) ───────────────────────
  if (wordCount < BYPASS_WORD_COUNT_THRESHOLD && filePathCount <= BYPASS_MAX_FILE_PATHS) {
    return {
      bypass: true,
      reason: `short task (${wordCount} words) — simple enough to skip planning`,
    };
  }

  // ── Default: planning required ────────────────────────────────────────────
  const reasons: string[] = [];
  if (filePathCount > BYPASS_MAX_FILE_PATHS) {
    reasons.push(`${filePathCount} file paths mentioned`);
  }
  if (wordCount >= BYPASS_WORD_COUNT_THRESHOLD) {
    reasons.push(`${wordCount} words`);
  }
  if (hasWriteIntent) {
    reasons.push('write-intent detected');
  }

  return {
    bypass: false,
    reason: `complex task — planning required (${reasons.join(', ')})`,
  };
}

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** The two high-level phases of a planning-gated task. */
export type PlanningPhase = 'analysis' | 'execution';

/** Current status of a PlanningGate session. */
export type PlanningGateStatus =
  | 'idle' // Gate has not started yet
  | 'analysis' // Analysis phase is running (read-only workers)
  | 'awaiting_confirmation' // Analysis done — waiting for Master to confirm approach
  | 'execution' // Execution phase is running (code-edit workers)
  | 'complete' // All phases finished
  | 'bypassed'; // Gate was bypassed for a simple task

/** A read-only planning worker spawned during the analysis phase. */
export interface PlanningWorker {
  /** Unique worker identifier. */
  id: string;
  /** The prompt sent to this worker. */
  prompt: string;
  /** ISO 8601 timestamp when this worker was spawned. */
  spawnedAt: string;
  /** Raw output from the worker (set when complete). */
  output?: string;
  /** ISO 8601 timestamp when this worker completed. */
  completedAt?: string;
}

/**
 * Specification for a read-only planning worker to be spawned during the
 * analysis phase. Callers receive these specs from `buildAnalysisWorkerSpecs()`
 * and are responsible for actually spawning the workers via AgentRunner, then
 * calling `recordAnalysisWorker()` / `completeAnalysisWorker()` to track them.
 */
export interface AnalysisWorkerSpec {
  /** Unique ID — must match the `PlanningWorker.id` passed to `recordAnalysisWorker()`. */
  id: string;
  /** Always 'read-only' — analysis workers must not modify files. */
  profile: 'read-only';
  /** Prompt/instructions for the worker. */
  prompt: string;
  /** Max agentic turns (bounded for fast analysis). */
  maxTurns: number;
}

/** Live state for an active PlanningGate session. */
export interface PlanningGateState {
  /** Unique gate session identifier. */
  sessionId: string;
  /** One-line summary of the task being gated. */
  taskSummary: string;
  /** Current phase/status of the gate. */
  status: PlanningGateStatus;
  /** Read-only workers spawned during the analysis phase. */
  analysisWorkers: PlanningWorker[];
  /** Aggregated analysis output from all planning workers. */
  analysisOutput: string;
  /** The confirmed execution strategy (set after analysis, before execution). */
  confirmedStrategy: string;
  /** When this gate session was created (ISO 8601). */
  createdAt: string;
  /** When the analysis phase completed (ISO 8601). */
  analysisCompletedAt?: string;
  /** When the execution phase started (ISO 8601). */
  executionStartedAt?: string;
  /** Why planning was bypassed (only set when status === 'bypassed'). */
  bypassReason?: string;
}

// ---------------------------------------------------------------------------
// PlanningGate
// ---------------------------------------------------------------------------

/**
 * PlanningGate — two-phase execution guard for Master AI.
 *
 * Prevents code-edit workers from being spawned before read-only analysis
 * workers have investigated the task and the Master has confirmed a strategy.
 *
 * Usage:
 *
 * ```ts
 * const gate = new PlanningGate();
 *
 * // Start analysis (read-only workers)
 * gate.startAnalysis('Refactor authentication module');
 * gate.recordAnalysisWorker({ id: 'w1', prompt: '...', spawnedAt: now });
 * gate.completeAnalysisWorker('w1', workerOutput);
 * gate.completeAnalysis(aggregatedOutput);
 *
 * // Master reviews and confirms approach
 * gate.confirmApproach('Extract AuthService, keep JWT logic in place');
 *
 * // Execution workers can now run
 * if (gate.allowsExecution) { ... }
 * gate.completeExecution();
 * ```
 *
 * Simple tasks bypass the gate entirely:
 *
 * ```ts
 * gate.bypass('What does foo() do?', 'read-only FAQ — no code changes');
 * ```
 */
export class PlanningGate {
  private _state: PlanningGateState | null = null;

  // ── Phase Control ───────────────────────────────────────────────

  /**
   * Start a new planning gate session for a task.
   * Transitions status from unstarted to `analysis`.
   *
   * @param taskSummary One-line description of the task being gated.
   * @returns A snapshot of the new state.
   */
  startAnalysis(taskSummary: string): PlanningGateState {
    const now = new Date().toISOString();
    this._state = {
      sessionId: randomUUID(),
      taskSummary,
      status: 'analysis',
      analysisWorkers: [],
      analysisOutput: '',
      confirmedStrategy: '',
      createdAt: now,
    };
    logger.debug(
      { sessionId: this._state.sessionId, taskSummary },
      'Planning gate: analysis phase started',
    );
    return { ...this._state, analysisWorkers: [...this._state.analysisWorkers] };
  }

  /**
   * Mark the analysis phase as complete with its aggregated output.
   * Transitions status from `analysis` to `awaiting_confirmation`.
   *
   * **Enforcement (OB-1777):** All registered analysis workers must have
   * returned (i.e. have a `completedAt` timestamp) before this method
   * succeeds. If any worker is still running, an error is thrown to prevent
   * the execution phase from starting prematurely.
   *
   * Use `canCompleteAnalysis` to check readiness before calling this method,
   * and `aggregateWorkerOutputs()` to build the combined output automatically.
   *
   * @param aggregatedOutput Combined output from all analysis workers.
   *   You can use `aggregateWorkerOutputs()` to generate this automatically.
   * @returns A snapshot of the updated state.
   * @throws If any registered analysis worker has not yet completed.
   */
  completeAnalysis(aggregatedOutput: string): PlanningGateState {
    this._requireStatus('analysis', 'completeAnalysis');
    const state = this._state!;

    // OB-1777: Enforce that every registered analysis worker has returned
    // before allowing the execution phase to proceed.
    const incompleteWorkers = state.analysisWorkers.filter((w) => !w.completedAt);
    if (incompleteWorkers.length > 0) {
      throw new Error(
        `PlanningGate.completeAnalysis(): ${incompleteWorkers.length} analysis worker(s) have not yet returned. ` +
          'Wait for all workers to complete before ending the analysis phase.',
      );
    }

    state.analysisOutput = aggregatedOutput;
    state.analysisCompletedAt = new Date().toISOString();
    state.status = 'awaiting_confirmation';
    logger.debug(
      { sessionId: state.sessionId, workerCount: state.analysisWorkers.length },
      'Planning gate: analysis phase complete, awaiting confirmation',
    );
    return { ...state, analysisWorkers: [...state.analysisWorkers] };
  }

  /**
   * Confirm the execution strategy after reviewing analysis output.
   * Transitions status from `awaiting_confirmation` to `execution`.
   *
   * @param strategy Human-readable description of the confirmed approach.
   * @returns A snapshot of the updated state.
   */
  confirmApproach(strategy: string): PlanningGateState {
    this._requireStatus('awaiting_confirmation', 'confirmApproach');
    const state = this._state!;
    state.confirmedStrategy = strategy;
    state.executionStartedAt = new Date().toISOString();
    state.status = 'execution';
    logger.debug(
      { sessionId: state.sessionId },
      'Planning gate: approach confirmed, execution phase started',
    );
    return { ...state, analysisWorkers: [...state.analysisWorkers] };
  }

  /**
   * Mark the entire gate as complete after the execution phase finishes.
   * Transitions status from `execution` to `complete`.
   *
   * @returns A snapshot of the final state.
   */
  completeExecution(): PlanningGateState {
    this._requireStatus('execution', 'completeExecution');
    const state = this._state!;
    state.status = 'complete';
    logger.debug({ sessionId: state.sessionId }, 'Planning gate: complete');
    return { ...state, analysisWorkers: [...state.analysisWorkers] };
  }

  /**
   * Bypass the planning gate entirely for simple tasks.
   * The gate transitions directly to `bypassed`, allowing execution to
   * proceed without an analysis phase.
   *
   * @param taskSummary One-line description of the task.
   * @param reason Human-readable explanation of why planning was skipped.
   * @returns A snapshot of the bypassed state.
   */
  bypass(taskSummary: string, reason: string): PlanningGateState {
    const now = new Date().toISOString();
    this._state = {
      sessionId: randomUUID(),
      taskSummary,
      status: 'bypassed',
      analysisWorkers: [],
      analysisOutput: '',
      confirmedStrategy: '',
      createdAt: now,
      bypassReason: reason,
    };
    logger.debug(
      { sessionId: this._state.sessionId, reason },
      'Planning gate: bypassed (simple task)',
    );
    return { ...this._state, analysisWorkers: [] };
  }

  // ── Worker Tracking ─────────────────────────────────────────────

  /**
   * Register a read-only planning worker spawned during the analysis phase.
   * Must be called while status is `analysis`.
   *
   * At most `MAX_ANALYSIS_WORKERS` (2) workers may be registered per session.
   * Attempting to register a third worker throws an error.
   *
   * @param worker The worker record to register.
   */
  recordAnalysisWorker(worker: PlanningWorker): void {
    this._requireStatus('analysis', 'recordAnalysisWorker');
    const state = this._state!;
    if (state.analysisWorkers.length >= MAX_ANALYSIS_WORKERS) {
      throw new Error(
        `PlanningGate.recordAnalysisWorker(): cannot register more than ${MAX_ANALYSIS_WORKERS} analysis workers per session`,
      );
    }
    state.analysisWorkers.push({ ...worker });
  }

  /**
   * Update a registered planning worker with its completed output.
   *
   * @param workerId The ID of the worker to update.
   * @param output Raw text output produced by the worker.
   * @returns `true` if the worker was found and updated; `false` otherwise.
   */
  completeAnalysisWorker(workerId: string, output: string): boolean {
    if (!this._state) return false;
    const worker = this._state.analysisWorkers.find((w) => w.id === workerId);
    if (!worker) return false;
    worker.output = output;
    worker.completedAt = new Date().toISOString();
    return true;
  }

  // ── Output Aggregation ───────────────────────────────────────────

  /**
   * Aggregate the outputs from all completed analysis workers into a single
   * string, labelled by worker index (OB-1777).
   *
   * Returns an empty string if no workers have completed yet.
   * Callers may pass the result directly to `completeAnalysis()`.
   */
  aggregateWorkerOutputs(): string {
    if (!this._state) return '';
    const completed = this._state.analysisWorkers.filter(
      (w) => w.completedAt !== undefined && w.output !== undefined,
    );
    if (completed.length === 0) return '';
    return completed
      .map((w, i) => `## Analysis Worker ${i + 1}\n\n${w.output ?? ''}`)
      .join('\n\n---\n\n');
  }

  // ── Analysis Worker Factory ──────────────────────────────────────

  /**
   * Build 1–2 read-only worker specifications for the analysis phase.
   *
   * Always generates two workers:
   *
   *   1. **Investigation worker** — reads relevant files and summarises what
   *      already exists in the codebase that relates to the task.
   *
   *   2. **Risk-assessment worker** — identifies potential breakage points,
   *      dependencies, and edge cases that the implementation must handle.
   *
   * Both workers use the `'read-only'` profile (Read, Glob, Grep only) and
   * are capped at `ANALYSIS_WORKER_MAX_TURNS` turns so they return quickly.
   *
   * Callers must spawn the workers themselves (via AgentRunner), then call
   * `recordAnalysisWorker()` and `completeAnalysisWorker()` to update state.
   *
   * @param taskDescription A plain-text description of the task to investigate.
   * @returns Exactly two `AnalysisWorkerSpec` objects ready for spawning.
   */
  buildAnalysisWorkerSpecs(taskDescription: string): AnalysisWorkerSpec[] {
    const investigationId = randomUUID();
    const riskId = randomUUID();

    const investigationPrompt = [
      'You are a read-only investigation worker. Your job is to explore the codebase',
      'and gather facts relevant to the following task. Do NOT modify any files.',
      '',
      `Task: ${taskDescription}`,
      '',
      'Investigate:',
      '1. Which files and modules are most relevant to this task?',
      '2. What does the current implementation look like in those areas?',
      '3. Are there existing patterns or conventions to follow?',
      '4. What tests currently cover this area?',
      '',
      'End your output with a brief summary of your findings (3–8 bullet points).',
    ].join('\n');

    const riskPrompt = [
      'You are a read-only risk-assessment worker. Your job is to identify what could',
      'go wrong when implementing the following task. Do NOT modify any files.',
      '',
      `Task: ${taskDescription}`,
      '',
      'Identify:',
      '1. Which other parts of the codebase depend on the files likely to change?',
      '2. What edge cases or inputs might break the implementation?',
      '3. Are there any circular dependencies or shared-state hazards?',
      '4. What is the minimum safe scope for this change?',
      '',
      'End your output with a brief risk summary (3–8 bullet points).',
    ].join('\n');

    return [
      {
        id: investigationId,
        profile: 'read-only',
        prompt: investigationPrompt,
        maxTurns: ANALYSIS_WORKER_MAX_TURNS,
      },
      {
        id: riskId,
        profile: 'read-only',
        prompt: riskPrompt,
        maxTurns: ANALYSIS_WORKER_MAX_TURNS,
      },
    ];
  }

  // ── Inspection ──────────────────────────────────────────────────

  /** Current gate state snapshot, or `null` if no session has started. */
  get state(): PlanningGateState | null {
    if (!this._state) return null;
    return { ...this._state, analysisWorkers: [...this._state.analysisWorkers] };
  }

  /** Current status, or `'idle'` if no session has started. */
  get status(): PlanningGateStatus {
    return this._state?.status ?? 'idle';
  }

  /** `true` when the gate is actively running the analysis phase. */
  get isAnalysisPhase(): boolean {
    return this._state?.status === 'analysis';
  }

  /** `true` when analysis is done and the Master must confirm before execution. */
  get isAwaitingConfirmation(): boolean {
    return this._state?.status === 'awaiting_confirmation';
  }

  /** `true` when the execution phase is active (code-edit workers may run). */
  get isExecutionPhase(): boolean {
    return this._state?.status === 'execution';
  }

  /** `true` when code-edit workers are permitted to run. */
  get allowsExecution(): boolean {
    return this._state?.status === 'execution' || this._state?.status === 'bypassed';
  }

  /** `true` when the gate has been bypassed for a simple task. */
  get isBypassed(): boolean {
    return this._state?.status === 'bypassed';
  }

  /** `true` when the gate session has fully concluded (complete or bypassed). */
  get isComplete(): boolean {
    return this._state?.status === 'complete' || this._state?.status === 'bypassed';
  }

  /**
   * `true` when the analysis phase is active and all registered workers have
   * returned their output (OB-1777). Callers should check this before calling
   * `completeAnalysis()` to avoid the incomplete-worker error.
   */
  get canCompleteAnalysis(): boolean {
    if (this._state?.status !== 'analysis') return false;
    if (this._state.analysisWorkers.length === 0) return false;
    return this._state.analysisWorkers.every((w) => w.completedAt !== undefined);
  }

  /** Number of analysis workers that have finished (have a `completedAt` timestamp). */
  get completedAnalysisWorkerCount(): number {
    return this._state?.analysisWorkers.filter((w) => w.completedAt !== undefined).length ?? 0;
  }

  /** Total number of analysis workers registered so far. */
  get totalAnalysisWorkerCount(): number {
    return this._state?.analysisWorkers.length ?? 0;
  }

  // ── Reset ────────────────────────────────────────────────────────

  /** Reset the gate so it can be reused for a new task. */
  reset(): void {
    this._state = null;
  }

  // ── Private ──────────────────────────────────────────────────────

  private _requireStatus(expected: PlanningGateStatus, method: string): void {
    const actual = this._state?.status ?? 'idle';
    if (actual !== expected) {
      throw new Error(
        `PlanningGate.${method}(): expected status '${expected}' but current status is '${actual}'`,
      );
    }
  }
}
