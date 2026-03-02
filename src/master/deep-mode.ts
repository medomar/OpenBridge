/**
 * Deep Mode Manager — Multi-phase execution for complex analysis tasks.
 *
 * Instead of single-pass execution (classify → execute → respond), Deep Mode
 * runs through up to five sequential phases: investigate → report → plan →
 * execute → verify. Each phase can produce a result that feeds into the next.
 *
 * Three execution profiles:
 * - fast:     Skips Deep Mode entirely (current behaviour).
 * - thorough: Runs all phases automatically without pausing.
 * - manual:   Pauses between phases and waits for user confirmation.
 *
 * This class owns the phase state machine lifecycle. Wiring into MasterManager
 * and per-phase prompts/models are added by subsequent tasks (OB-1399 – OB-1403).
 */

import { randomUUID } from 'node:crypto';

import type { ModelTier } from '../core/model-registry.js';
import { createLogger } from '../core/logger.js';
import type {
  DeepModeState,
  DeepPhase,
  DeepPhaseResult,
  ExecutionProfile,
} from '../types/agent.js';
import type { ProgressEvent } from '../types/message.js';
import {
  DEEP_INVESTIGATE,
  DEEP_REPORT,
  DEEP_PLAN,
  DEEP_EXECUTE,
  DEEP_VERIFY,
} from './seed-prompts.js';

/** Callback type for emitting Deep Mode phase progress events. */
type PhaseProgressReporter = (event: ProgressEvent) => Promise<void>;

// ── Parallel Execution Types ───────────────────────────────────────

/**
 * A single task parsed from the plan phase output.
 * Extracted from the numbered task blocks in the plan Markdown.
 */
export interface DeepPlanTask {
  /** 1-based task number (from "Task #N" in plan output) */
  taskNumber: number;
  /** Short task title (from "**Title:**" field) */
  title: string;
  /** Task description (from "**Description:**" field) */
  description: string;
  /** Relative file paths to modify (from "**Files to Modify:**" field) */
  filesToModify: string[];
  /** 1-based task numbers this task depends on (from "**Dependencies:**" field) */
  dependsOn: number[];
}

/**
 * A batch of tasks that can all be spawned simultaneously because they
 * have no inter-dependencies. All tasks in a batch are ready to run
 * at the same time, though callers should still respect the
 * WorkerRegistry concurrency limit when launching them.
 */
export type DeepExecuteBatch = DeepPlanTask[];

// ── Plan Output Parsers ────────────────────────────────────────────

/**
 * Parse individual task entries from plan phase output.
 *
 * Scans for "**Task #N**" headers and extracts the title, files to modify,
 * dependencies, and description for each task. The parser is intentionally
 * lenient — missing fields produce empty/default values so callers always
 * receive a well-typed result.
 *
 * @param planOutput  Raw plan phase output (Markdown).
 * @returns           Parsed tasks in document order.
 */
export function parsePlanTasks(planOutput: string): DeepPlanTask[] {
  const tasks: DeepPlanTask[] = [];

  // Locate every "**Task #N**" header and slice the text between consecutive headers
  const headerRegex = /\*\*Task\s+#(\d+)\*\*/gi;
  const headerMatches = [...planOutput.matchAll(headerRegex)];

  for (let i = 0; i < headerMatches.length; i++) {
    const headerMatch = headerMatches[i];
    if (!headerMatch) continue;
    const capturedNum = headerMatch[1] ?? '0';
    const taskNumber = parseInt(capturedNum, 10);
    const start = headerMatch.index ?? 0;
    const nextMatch = headerMatches[i + 1];
    const end = nextMatch?.index ?? planOutput.length;
    const chunk = planOutput.slice(start, end);

    // Title
    const titleMatch = /\*\*Title:\*\*\s*(.+)/i.exec(chunk);
    const title = titleMatch ? (titleMatch[1] ?? '').trim() : `Task #${taskNumber}`;

    // Files to Modify — may be a single line or a newline-separated list
    const filesMatch = /\*\*Files\s+to\s+Modify:\*\*\s*([\s\S]+?)(?=\n\*\*|\n---)/i.exec(chunk);
    let filesToModify: string[] = [];
    if (filesMatch) {
      filesToModify = (filesMatch[1] ?? '')
        .split(/[\n,]/)
        .map((l) =>
          l
            .replace(/[`*]/g, '')
            .replace(/^\s*[-•]\s*/, '')
            .trim(),
        )
        .filter(Boolean);
    }

    // Dependencies — "none" or a list of task numbers like "#1, #3"
    const depsMatch = /\*\*Dependencies:\*\*\s*(.+)/i.exec(chunk);
    let dependsOn: number[] = [];
    const depsText = depsMatch ? (depsMatch[1] ?? '') : '';
    if (depsText && !/^\s*none\s*$/i.test(depsText)) {
      dependsOn = [...depsText.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1] ?? '0', 10));
    }

    // Description — multi-line field; ends at the next "---" separator or task header
    const descMatch =
      /\*\*Description:\*\*\s*([\s\S]+?)(?=\n---|\n\*\*Task\s+#|\n\*\*Batch|\s*$)/i.exec(chunk);
    const description = descMatch ? (descMatch[1] ?? '').trim() : '';

    tasks.push({ taskNumber, title, description, filesToModify, dependsOn });
  }

  return tasks;
}

/**
 * Parse the "Parallel Batches" section from plan phase output.
 *
 * Reads lines in the format:
 *   **Batch 1 (parallel):** Tasks #1, #2, #3
 *   **Batch 2 (sequential):** Task #4 (depends on Batch 1)
 *
 * and returns an ordered array of task-number arrays. Only the task numbers
 * listed directly after the colon are extracted — task numbers inside
 * parenthetical dependency annotations are ignored.
 *
 * @param planOutput  Raw plan phase output (Markdown).
 * @returns           Ordered batches, each an array of 1-based task numbers.
 *                    Returns an empty array if no batch section is found.
 */
export function parsePlanBatches(planOutput: string): number[][] {
  const batches: number[][] = [];

  // Match: **Batch N (type):** <task list>
  // Capture everything after the colon up to the first '(' or end of line
  const batchLineRegex = /\*\*Batch\s+\d+[^:]*:\*\*\s*([^(\n]*)/gi;
  let match: RegExpExecArray | null;

  while ((match = batchLineRegex.exec(planOutput)) !== null) {
    const taskListText = match[1] ?? '';
    const taskNums = [...taskListText.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1] ?? '0', 10));
    if (taskNums.length > 0) {
      batches.push(taskNums);
    }
  }

  return batches;
}

/**
 * Group tasks into dependency-ordered batches using a BFS topological sort.
 *
 * Used as a fallback when no "Parallel Batches" section is present in the plan.
 * Tasks in the same batch have no inter-dependencies and can run simultaneously.
 *
 * @param tasks  Tasks to group (skipped items should be excluded by the caller).
 * @returns      Ordered batches; tasks whose dependencies fall outside the set
 *               are treated as having no dependencies for grouping purposes.
 */
function groupTasksByDependency(tasks: DeepPlanTask[]): DeepExecuteBatch[] {
  if (tasks.length === 0) return [];

  const taskSet = new Set(tasks.map((t) => t.taskNumber));
  const completed = new Set<number>();
  const batches: DeepExecuteBatch[] = [];
  let remaining = [...tasks];

  while (remaining.length > 0) {
    // A task is ready when all its dependencies are completed or outside the set
    const ready = remaining.filter((t) =>
      t.dependsOn.every((dep) => completed.has(dep) || !taskSet.has(dep)),
    );

    // Guard against circular dependencies — take first remaining task to break the cycle
    const first = remaining[0];
    const batch: DeepExecuteBatch = ready.length > 0 ? ready : first ? [first] : [];

    batches.push(batch);

    for (const t of batch) {
      completed.add(t.taskNumber);
    }

    remaining = remaining.filter((t) => !completed.has(t.taskNumber));
  }

  return batches;
}

const logger = createLogger('deep-mode');

// ── Phase Ordering ────────────────────────────────────────────────

/** Canonical order of Deep Mode phases */
const PHASE_ORDER: DeepPhase[] = ['investigate', 'report', 'plan', 'execute', 'verify'];

// ── Per-Phase Model Selection ──────────────────────────────────────

/**
 * Default model tier for each Deep Mode phase.
 *
 * - investigate: powerful — thorough code/context exploration requires the best model
 * - report:      balanced — summarising findings is less reasoning-intensive
 * - plan:        powerful — high-quality planning reduces downstream errors
 * - execute:     balanced — implementation tasks are well-scoped; balanced is sufficient
 * - verify:      fast     — test running + pass/fail checks are straightforward
 *
 * Users can override individual entries via `deep.phaseModels` in config (OB-1402).
 */
export const PHASE_MODEL_MAP: Record<DeepPhase, ModelTier> = {
  investigate: 'powerful',
  report: 'balanced',
  plan: 'powerful',
  execute: 'balanced',
  verify: 'fast',
};

// ── Per-Phase System Prompts ───────────────────────────────────────

/**
 * Focused system prompt injection for each Deep Mode phase.
 *
 * These strings are appended to the Master AI system prompt at the start of each
 * phase to steer the model toward the phase-appropriate goal. Callers retrieve
 * them via getPhaseSystemPrompt() and pass them as --append-system-prompt.
 */
export const PHASE_SYSTEM_PROMPTS: Record<DeepPhase, string> = {
  investigate: `## Deep Mode — Investigate Phase

Your goal in this phase is to **explore and identify**. Do not implement or modify anything.

- Read source files, configs, tests, and documentation thoroughly.
- Identify issues, gaps, risks, and opportunities relevant to the user's request.
- Collect concrete evidence: file paths, line numbers, code snippets, error messages.
- Produce a comprehensive list of findings. Be specific — vague findings are not useful.
- End your output with a clearly structured "Findings" section that the next phase can summarise.`,

  report: `## Deep Mode — Report Phase

Your goal in this phase is to **summarise findings** from the investigation into a clear, actionable report.

- Organise findings by severity or priority (critical → high → medium → low).
- For each finding include: what it is, why it matters, and where it lives (file:line).
- Do not implement fixes yet — focus on clear, accurate documentation.
- Keep the report concise enough for a non-developer to understand the key points.
- End with a numbered list of recommended next steps that will feed into the plan phase.`,

  plan: `## Deep Mode — Plan Phase

Your goal in this phase is to **create an actionable plan** based on the report findings.

- Convert each finding or recommendation into a concrete, numbered task.
- Order tasks by dependency and priority — tasks that others depend on come first.
- For each task specify: what to do, which files to touch, and the expected outcome.
- Flag tasks that require user input or approval before execution.
- Produce a final numbered task list. This list will be executed step-by-step in the next phase.`,

  execute: `## Deep Mode — Execute Phase

Your goal in this phase is to **implement the plan** produced in the previous phase.

- Work through the task list in order, one task at a time.
- Make only the changes described in the plan — do not scope-creep.
- After each task, confirm what was changed and check for side effects.
- If a task is blocked or unsafe to execute, stop and report the blocker — do not skip silently.
- End with a summary of all changes made and any tasks that were deferred.`,

  verify: `## Deep Mode — Verify Phase

Your goal in this phase is to **run tests and checks** to confirm the implementation is correct.

- Run the project's test suite (npm test, pytest, cargo test, etc. as appropriate).
- Run linting and type checks if available (npm run lint, npm run typecheck, etc.).
- Read the output carefully — flag any failures, warnings, or regressions.
- Confirm that each executed task from the plan phase produced the expected outcome.
- End with a pass/fail verdict and a list of any remaining issues that need follow-up.`,
};

// ── Phase Worker Prompt Context ────────────────────────────────────

/**
 * Context supplied by callers when building a phase worker prompt.
 *
 * Each field maps to a `{{placeholder}}` in the corresponding DEEP_* template.
 * Investigate-phase fields are only used for the investigate phase; execute-phase
 * fields are only used for the execute phase. Previous-phase results are injected
 * automatically from the session state — callers do not need to supply them.
 */
export interface DeepPhaseWorkerContext {
  /** Absolute workspace path (investigate — defaults to host.workspacePath). */
  workspacePath?: string;
  /** Human-readable project name (investigate). */
  projectName?: string;
  /** Detected project type, e.g. "Node.js / TypeScript" (investigate). */
  projectType?: string;
  /** Comma-separated list of detected frameworks (investigate). */
  frameworks?: string;
  /** Summary of the workspace file/directory structure (investigate). */
  structure?: string;
  /** 1-based task number to execute (execute phase). */
  taskNumber?: number;
  /** Short task title (execute phase). */
  taskTitle?: string;
  /** Newline-separated list of files to modify (execute phase). */
  filesToModify?: string;
  /** Task description from the plan (execute phase). */
  taskDescription?: string;
  /** Additional constraints to enforce during execution (execute phase). */
  constraints?: string;
}

// ── MasterManager Surface ─────────────────────────────────────────

/**
 * Minimal interface for the MasterManager capabilities that DeepModeManager
 * requires. Using an interface avoids a circular import with master-manager.ts.
 * The concrete MasterManager satisfies this interface; pass `this` when wiring.
 */
export interface DeepModeHost {
  /** The absolute workspace path the Master AI is operating on */
  readonly workspacePath: string;
}

// ── Deep Mode Manager ─────────────────────────────────────────────

/**
 * DeepModeManager — Manages the phase state machine for Deep Mode sessions.
 *
 * Each session is identified by a unique sessionId returned from startSession().
 * Multiple sessions can exist concurrently (one per active user conversation).
 *
 * Profile behaviour:
 * - fast:     Deep Mode is skipped. startSession() returns null.
 * - thorough: All phases run automatically without pausing.
 * - manual:   After each advancePhase() call the session is marked as paused.
 *             Callers must call resume() after receiving user confirmation.
 */
export class DeepModeManager {
  private readonly sessions = new Map<string, DeepModeState>();

  /** Sessions awaiting user confirmation (manual profile only). */
  private readonly pausedSessions = new Set<string>();

  /** Per-session progress reporters — emit WebSocket events on phase transitions. */
  private readonly progressReporters = new Map<string, PhaseProgressReporter>();

  constructor(private readonly host: DeepModeHost) {}

  /** Fire-and-forget helper that emits a phase progress event without blocking callers. */
  private emitPhaseEvent(sessionId: string, event: ProgressEvent): void {
    const reporter = this.progressReporters.get(sessionId);
    if (reporter) {
      reporter(event).catch((err: unknown) => {
        logger.warn({ err, sessionId }, 'deep-phase progress emit failed');
      });
    }
  }

  // ── Session lifecycle ─────────────────────────────────────────

  /**
   * Start a new Deep Mode session.
   *
   * @param taskSummary       One-line summary of the original user request.
   * @param profile           Execution profile (fast | thorough | manual).
   * @param progressReporter  Optional callback for emitting WebSocket phase progress events.
   * @returns                 The new session ID, or `null` when `fast` skips Deep Mode.
   */
  startSession(
    taskSummary: string,
    profile: ExecutionProfile,
    progressReporter?: PhaseProgressReporter,
  ): string | null {
    if (profile === 'fast') {
      logger.info({ profile, taskSummary }, 'Deep Mode skipped for fast profile');
      return null;
    }

    const sessionId = randomUUID();
    const firstPhase: DeepPhase = 'investigate';

    const state: DeepModeState = {
      sessionId,
      profile,
      currentPhase: firstPhase,
      phaseResults: {},
      startedAt: new Date().toISOString(),
      taskSummary,
      skippedItems: [],
      taskModelOverrides: {},
    };

    this.sessions.set(sessionId, state);

    if (progressReporter) {
      this.progressReporters.set(sessionId, progressReporter);
    }

    logger.info({ sessionId, profile, taskSummary }, 'Deep Mode session started');

    this.emitPhaseEvent(sessionId, {
      type: 'deep-phase',
      sessionId,
      phase: firstPhase,
      status: 'started',
    });

    return sessionId;
  }

  /**
   * Abort an active Deep Mode session and remove it from memory.
   *
   * @param sessionId  The session to abort.
   */
  abort(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      logger.warn({ sessionId }, 'abort() called on unknown Deep Mode session');
      return;
    }

    const abortedPhase = state.currentPhase;
    logger.info({ sessionId, currentPhase: abortedPhase }, 'Deep Mode session aborted');

    if (abortedPhase) {
      this.emitPhaseEvent(sessionId, {
        type: 'deep-phase',
        sessionId,
        phase: abortedPhase,
        status: 'aborted',
      });
    }

    this.sessions.delete(sessionId);
    this.pausedSessions.delete(sessionId);
    this.progressReporters.delete(sessionId);
  }

  // ── Phase state machine ───────────────────────────────────────

  /**
   * Advance to the next phase of a Deep Mode session.
   *
   * Stores the provided result for the current phase and moves the session
   * forward. For `thorough` profiles, advancement is automatic. For `manual`
   * profiles, callers are expected to pause and wait for user confirmation
   * before calling advancePhase().
   *
   * @param sessionId  Active session identifier.
   * @param result     Result produced by the completed current phase.
   * @returns          The next phase, or `undefined` when all phases are done.
   */
  advancePhase(sessionId: string, result: DeepPhaseResult): DeepPhase | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) {
      logger.warn({ sessionId }, 'advancePhase() called on unknown session');
      return undefined;
    }

    const { currentPhase } = state;
    if (!currentPhase) {
      logger.warn({ sessionId }, 'advancePhase() called on already-completed session');
      return undefined;
    }

    // Persist the result for the current phase
    state.phaseResults[currentPhase] = result;

    // Find the next phase in canonical order
    const currentIndex = PHASE_ORDER.indexOf(currentPhase);
    const nextPhase = currentIndex >= 0 ? PHASE_ORDER[currentIndex + 1] : undefined;

    state.currentPhase = nextPhase;

    // Emit completed event for the phase that just finished (truncate summary to 200 chars)
    const resultSummary = result.output.length > 200 ? result.output.slice(0, 200) : result.output;
    this.emitPhaseEvent(sessionId, {
      type: 'deep-phase',
      sessionId,
      phase: currentPhase,
      status: 'completed',
      resultSummary,
    });

    if (nextPhase) {
      logger.info(
        { sessionId, fromPhase: currentPhase, toPhase: nextPhase, profile: state.profile },
        'Deep Mode phase advanced',
      );

      // Emit started event for the incoming phase
      this.emitPhaseEvent(sessionId, {
        type: 'deep-phase',
        sessionId,
        phase: nextPhase,
        status: 'started',
      });

      // Manual profile pauses after each phase transition to wait for user confirmation.
      // Thorough profile continues automatically — no pause needed.
      if (state.profile === 'manual') {
        this.pausedSessions.add(sessionId);
        logger.info(
          { sessionId, nextPhase },
          'Deep Mode paused — awaiting user confirmation to continue',
        );
      }
    } else {
      // All phases completed — remove any paused state and clean up
      this.pausedSessions.delete(sessionId);
      this.progressReporters.delete(sessionId);
      logger.info(
        { sessionId, completedPhase: currentPhase },
        'Deep Mode session completed all phases',
      );
    }

    return nextPhase;
  }

  /**
   * Skip the current phase without recording a result, advancing to the next.
   *
   * @param sessionId  Active session identifier.
   * @returns          The next phase after the skipped one, or `undefined` if done.
   */
  skipPhase(sessionId: string): DeepPhase | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) {
      logger.warn({ sessionId }, 'skipPhase() called on unknown session');
      return undefined;
    }

    const { currentPhase } = state;
    if (!currentPhase) {
      logger.warn({ sessionId }, 'skipPhase() called on already-completed session');
      return undefined;
    }

    const currentIndex = PHASE_ORDER.indexOf(currentPhase);
    const nextPhase = currentIndex >= 0 ? PHASE_ORDER[currentIndex + 1] : undefined;

    state.currentPhase = nextPhase;

    logger.info({ sessionId, skippedPhase: currentPhase, nextPhase }, 'Deep Mode phase skipped');

    this.emitPhaseEvent(sessionId, {
      type: 'deep-phase',
      sessionId,
      phase: currentPhase,
      status: 'skipped',
    });

    if (nextPhase) {
      this.emitPhaseEvent(sessionId, {
        type: 'deep-phase',
        sessionId,
        phase: nextPhase,
        status: 'started',
      });
    } else {
      this.progressReporters.delete(sessionId);
    }

    return nextPhase;
  }

  /**
   * Mark a specific plan item as skipped (1-based index).
   *
   * Appends itemIndex to state.skippedItems so that the execute phase can
   * exclude it when processing the task list. Idempotent — calling with the
   * same index twice has no additional effect.
   *
   * @param sessionId  Active session identifier.
   * @param itemIndex  1-based index of the plan item to skip.
   */
  skipItem(sessionId: string, itemIndex: number): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      logger.warn({ sessionId }, 'skipItem() called on unknown session');
      return;
    }

    if (!state.skippedItems.includes(itemIndex)) {
      state.skippedItems.push(itemIndex);
    }

    logger.info({ sessionId, skippedItem: itemIndex }, 'Deep Mode item marked as skipped');
  }

  /**
   * Focus investigation on a specific plan item (1-based index).
   *
   * Records the item as "focused" for the current session. Callers can
   * use this to repeat the investigate phase with a narrower scope.
   * The index is appended to skippedItems to signal that other items
   * should be deprioritised in the next investigation turn.
   *
   * @param sessionId  Active session identifier.
   * @param itemIndex  1-based index of the plan item to focus on.
   */
  focusOnItem(sessionId: string, itemIndex: number): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      logger.warn({ sessionId }, 'focusOnItem() called on unknown session');
      return;
    }

    if (!state.skippedItems.includes(itemIndex)) {
      state.skippedItems.push(itemIndex);
    }

    logger.info({ sessionId, focusedItem: itemIndex }, 'Deep Mode focus item recorded');
  }

  // ── Profile-aware helpers ─────────────────────────────────────

  /**
   * Return whether a manual-profile session is paused waiting for user confirmation.
   * Always false for thorough sessions (they never pause).
   *
   * @param sessionId  Session to query.
   */
  isPaused(sessionId: string): boolean {
    return this.pausedSessions.has(sessionId);
  }

  /**
   * Resume a paused manual-profile session after the user has confirmed.
   * No-op for sessions that are not paused.
   *
   * @param sessionId  Session to resume.
   */
  resume(sessionId: string): void {
    if (!this.pausedSessions.has(sessionId)) {
      logger.warn({ sessionId }, 'resume() called on session that is not paused');
      return;
    }
    this.pausedSessions.delete(sessionId);
    logger.info({ sessionId }, 'Deep Mode session resumed after user confirmation');
  }

  /**
   * Return whether the profile for this session requires user confirmation between phases.
   * True only for manual profile.
   *
   * @param sessionId  Session to query.
   */
  requiresConfirmation(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    return state?.profile === 'manual';
  }

  /**
   * Return whether the profile for this session should auto-advance through phases
   * without waiting for user input. True only for thorough profile.
   *
   * @param sessionId  Session to query.
   */
  shouldAutoAdvance(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    return state?.profile === 'thorough';
  }

  // ── Accessors ─────────────────────────────────────────────────

  /**
   * Return whether a session is currently active (exists, has phases remaining, and not paused).
   *
   * @param sessionId  Session to query.
   */
  isActive(sessionId: string): boolean {
    const state = this.sessions.get(sessionId);
    return state !== undefined && state.currentPhase !== undefined;
  }

  /**
   * Return the current phase for a session, or `undefined` if done / not found.
   *
   * @param sessionId  Session to query.
   */
  getCurrentPhase(sessionId: string): DeepPhase | undefined {
    return this.sessions.get(sessionId)?.currentPhase;
  }

  /**
   * Return the stored result for a completed phase, or `undefined` if the phase
   * has not yet run or was skipped.
   *
   * @param sessionId  Session to query.
   * @param phase      The phase whose result to retrieve.
   */
  getPhaseResult(sessionId: string, phase: DeepPhase): DeepPhaseResult | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;
    return state.phaseResults[phase];
  }

  /**
   * Return a read-only snapshot of the full session state.
   *
   * @param sessionId  Session to query.
   */
  getSessionState(sessionId: string): Readonly<DeepModeState> | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Return all active session IDs.
   */
  getActiveSessions(): string[] {
    return [...this.sessions.keys()];
  }

  // ── Per-Phase Model Selection ──────────────────────────────────

  // ── Per-Task Model Overrides (OB-1412) ────────────────────────

  /**
   * Set a model tier override for a specific plan item in the execute phase.
   *
   * Called when the user sends a natural language request such as
   * "use opus for task 1" or "use haiku for this".
   *
   * Use taskIndex = 0 as a sentinel for "current task / current phase" — this
   * maps to the same key "0" in `taskModelOverrides`.
   *
   * @param sessionId  Active session identifier.
   * @param taskIndex  1-based plan item index; 0 means "current task/phase".
   * @param modelTier  The model tier to use ('fast' | 'balanced' | 'powerful').
   * @returns          `true` if the override was stored, `false` if session not found.
   */
  setTaskModelOverride(sessionId: string, taskIndex: number, modelTier: ModelTier): boolean {
    const state = this.sessions.get(sessionId);
    if (!state) {
      logger.warn({ sessionId }, 'setTaskModelOverride() called on unknown session');
      return false;
    }

    state.taskModelOverrides[String(taskIndex)] = modelTier;
    logger.info({ sessionId, taskIndex, modelTier }, 'Deep Mode task model override set');
    return true;
  }

  /**
   * Return the model tier override for a specific plan item, if one has been set.
   *
   * Falls back to the override for index 0 ("current task/phase") when no
   * task-specific override exists.
   *
   * @param sessionId  Active session identifier.
   * @param taskIndex  1-based plan item index to look up.
   * @returns          The overridden ModelTier, or `undefined` if no override is set.
   */
  getTaskModelOverride(sessionId: string, taskIndex: number): ModelTier | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;

    // Task-specific override takes precedence over the "current" sentinel (index 0)
    const specific = state.taskModelOverrides[String(taskIndex)];
    if (specific !== undefined) return specific as ModelTier;

    const current = state.taskModelOverrides['0'];
    return current !== undefined ? (current as ModelTier) : undefined;
  }

  /**
   * Return the recommended model tier for the current phase of a session.
   *
   * Applies user-supplied per-phase overrides (from `deep.phaseModels` config,
   * added in OB-1402) on top of the built-in PHASE_MODEL_MAP defaults.
   *
   * @param sessionId  Session to query.
   * @param overrides  Optional per-phase model tier overrides (from config).
   * @returns          The model tier, or `undefined` if session not found / done.
   */
  getPhaseModelTier(
    sessionId: string,
    overrides?: Partial<Record<DeepPhase, ModelTier>>,
  ): ModelTier | undefined {
    const state = this.sessions.get(sessionId);
    if (!state || !state.currentPhase) return undefined;

    const phase = state.currentPhase;
    return overrides?.[phase] ?? PHASE_MODEL_MAP[phase];
  }

  /**
   * Return the system prompt injection for the current phase of a session.
   *
   * The returned string is intended to be appended to the Master AI system prompt
   * (via --append-system-prompt) to steer the model toward the phase-appropriate goal.
   *
   * Callers may supply per-phase prompt overrides to replace individual built-in
   * prompts — useful for domain-specific Deep Mode configurations.
   *
   * @param sessionId  Session to query.
   * @param overrides  Optional per-phase prompt overrides.
   * @returns          The system prompt string, or `undefined` if session not found / done.
   */
  getPhaseSystemPrompt(
    sessionId: string,
    overrides?: Partial<Record<DeepPhase, string>>,
  ): string | undefined {
    const state = this.sessions.get(sessionId);
    if (!state || !state.currentPhase) return undefined;

    const phase = state.currentPhase;
    return overrides?.[phase] ?? PHASE_SYSTEM_PROMPTS[phase];
  }

  // ── Parallel Execute Phase ────────────────────────────────────

  /**
   * Return parallel execution batches for the execute phase of a session.
   *
   * Reads the plan phase result, parses task structure and batch groupings,
   * filters out items marked as skipped, and returns an ordered array of
   * batches. Tasks within the same batch have no inter-dependencies and can
   * be spawned simultaneously by the caller.
   *
   * If no "Parallel Batches" section is found in the plan output (e.g., the AI
   * omitted it), falls back to `groupTasksByDependency()` which derives batches
   * from the per-task "**Dependencies:**" fields.
   *
   * Callers are responsible for respecting the WorkerRegistry concurrency limit
   * when spawning tasks within each batch — use `workerRegistry.waitForSlot()`
   * before each spawn.
   *
   * @param sessionId  Active session identifier.
   * @returns          Ordered batches; each batch is an array of DeepPlanTask.
   *                   Returns `undefined` if the session is not found or has no plan result.
   */
  getExecuteBatches(sessionId: string): DeepExecuteBatch[] | undefined {
    const state = this.sessions.get(sessionId);
    if (!state) return undefined;

    const planResult = state.phaseResults['plan'];
    if (!planResult) return undefined;

    const planOutput = planResult.output;
    const tasks = parsePlanTasks(planOutput);
    if (tasks.length === 0) return undefined;

    const skipped = new Set(state.skippedItems);
    const batchTaskNums = parsePlanBatches(planOutput);

    let batches: DeepExecuteBatch[];

    if (batchTaskNums.length > 0) {
      // Use the explicit batch structure emitted by the plan worker
      const taskMap = new Map(tasks.map((t) => [t.taskNumber, t]));
      batches = batchTaskNums
        .map((nums) =>
          nums
            .filter((n) => !skipped.has(n))
            .map((n) => taskMap.get(n))
            .filter((t): t is DeepPlanTask => t !== undefined),
        )
        .filter((batch) => batch.length > 0);
    } else {
      // Fallback: derive batches from the per-task dependency fields
      const nonSkipped = tasks.filter((t) => !skipped.has(t.taskNumber));
      batches = groupTasksByDependency(nonSkipped);
    }

    logger.info(
      { sessionId, batchCount: batches.length, totalTasks: tasks.length },
      'Deep Mode execute batches computed',
    );

    return batches;
  }

  /**
   * Build worker prompts for all tasks in a parallel execution batch.
   *
   * Each task in the batch gets its own DEEP_EXECUTE worker prompt with the
   * task-specific context filled in. The session must have a plan result and
   * be (or have been) in the execute phase for the output to be meaningful.
   *
   * @param sessionId  Active session identifier.
   * @param batch      The execution batch returned by `getExecuteBatches()`.
   * @returns          Worker prompt strings, one per task. Empty if session not found.
   */
  buildBatchWorkerPrompts(sessionId: string, batch: DeepExecuteBatch): string[] {
    return batch
      .map((task) =>
        this.buildWorkerPrompt(sessionId, {
          taskNumber: task.taskNumber,
          taskTitle: task.title,
          taskDescription: task.description,
          filesToModify: task.filesToModify.join('\n') || '(see plan)',
        }),
      )
      .filter((p): p is string => p !== undefined);
  }

  // ── Phase Worker Prompt Builder ────────────────────────────────

  /**
   * Build the worker prompt for the current phase of a session.
   *
   * Selects the DEEP_* seed-prompt template that matches the current phase,
   * substitutes all `{{placeholder}}` tokens, and injects the output from
   * previous phases as context:
   *
   * - investigate: uses caller-supplied workspace / project metadata
   * - report:      injects investigate.output as `{{investigationFindings}}`
   * - plan:        injects report.output as `{{reportFindings}}`
   * - execute:     injects plan.output as `{{planContext}}` + caller task details
   * - verify:      injects execute.output as `{{executedTasks}}`
   *
   * @param sessionId  Active session identifier.
   * @param context    Phase-specific context for placeholder substitution.
   * @returns          The filled worker prompt string, or `undefined` if session not found / done.
   */
  buildWorkerPrompt(sessionId: string, context: DeepPhaseWorkerContext = {}): string | undefined {
    const state = this.sessions.get(sessionId);
    if (!state || !state.currentPhase) return undefined;

    const { currentPhase: phase, taskSummary: userRequest, phaseResults } = state;

    switch (phase) {
      case 'investigate':
        return DEEP_INVESTIGATE.content
          .replace('{{workspacePath}}', context.workspacePath ?? this.host.workspacePath)
          .replace('{{userRequest}}', userRequest)
          .replace('{{projectName}}', context.projectName ?? 'Unknown')
          .replace('{{projectType}}', context.projectType ?? 'Unknown')
          .replace('{{frameworks}}', context.frameworks ?? 'Unknown')
          .replace('{{structure}}', context.structure ?? '(no structure available)');

      case 'report': {
        const investigationFindings =
          phaseResults['investigate']?.output ?? '(no investigation results available)';
        return DEEP_REPORT.content
          .replace('{{userRequest}}', userRequest)
          .replace('{{investigationFindings}}', investigationFindings);
      }

      case 'plan': {
        const reportFindings = phaseResults['report']?.output ?? '(no report available)';
        return DEEP_PLAN.content
          .replace('{{userRequest}}', userRequest)
          .replace('{{reportFindings}}', reportFindings);
      }

      case 'execute': {
        const planContext = phaseResults['plan']?.output ?? '(no plan available)';
        return DEEP_EXECUTE.content
          .replace('{{userRequest}}', userRequest)
          .replace('{{taskNumber}}', String(context.taskNumber ?? 1))
          .replace('{{taskTitle}}', context.taskTitle ?? 'Execute task')
          .replace('{{filesToModify}}', context.filesToModify ?? '(see plan)')
          .replace('{{taskDescription}}', context.taskDescription ?? '(see plan)')
          .replace('{{constraints}}', context.constraints ?? 'None.')
          .replace('{{planContext}}', planContext);
      }

      case 'verify': {
        const executedTasks = phaseResults['execute']?.output ?? '(no execute results available)';
        return DEEP_VERIFY.content
          .replace('{{userRequest}}', userRequest)
          .replace('{{executedTasks}}', executedTasks);
      }

      default:
        return undefined;
    }
  }
}
