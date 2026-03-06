/**
 * Planning Gate (OB-1775, OB-1776)
 *
 * Controls the two-phase execution model for Master AI task processing:
 *
 *   1. Analysis phase  — 1–2 read-only workers investigate the codebase,
 *      gather facts, and surface risks before any code is written.
 *      Workers are built via buildAnalysisWorkerSpecs() and capped at
 *      MAX_ANALYSIS_WORKERS (2).
 *
 *   2. Execution phase — code-edit workers implement the confirmed strategy.
 *      This phase only starts after the analysis phase concludes and the
 *      Master has confirmed its approach.
 *
 * For simple tasks (single-file edits, FAQ answers), planning is bypassed
 * automatically (OB-1778). Wiring into MasterManager is done by OB-1779;
 * the reasoning checkpoint before full-access workers is OB-1780.
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
   * @param aggregatedOutput Combined output from all analysis workers.
   * @returns A snapshot of the updated state.
   */
  completeAnalysis(aggregatedOutput: string): PlanningGateState {
    this._requireStatus('analysis', 'completeAnalysis');
    const state = this._state!;
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
