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

import { createLogger } from '../core/logger.js';
import type {
  DeepModeState,
  DeepPhase,
  DeepPhaseResult,
  ExecutionProfile,
} from '../types/agent.js';

const logger = createLogger('deep-mode');

// ── Phase Ordering ────────────────────────────────────────────────

/** Canonical order of Deep Mode phases */
const PHASE_ORDER: DeepPhase[] = ['investigate', 'report', 'plan', 'execute', 'verify'];

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
 */
export class DeepModeManager {
  private readonly sessions = new Map<string, DeepModeState>();

  constructor(private readonly host: DeepModeHost) {}

  // ── Session lifecycle ─────────────────────────────────────────

  /**
   * Start a new Deep Mode session.
   *
   * @param taskSummary  One-line summary of the original user request.
   * @param profile      Execution profile (fast | thorough | manual).
   * @returns            The new session ID.
   */
  startSession(taskSummary: string, profile: ExecutionProfile): string {
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
    };

    this.sessions.set(sessionId, state);

    logger.info({ sessionId, profile, taskSummary }, 'Deep Mode session started');

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

    logger.info({ sessionId, currentPhase: state.currentPhase }, 'Deep Mode session aborted');
    this.sessions.delete(sessionId);
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

    if (nextPhase) {
      logger.info(
        { sessionId, fromPhase: currentPhase, toPhase: nextPhase },
        'Deep Mode phase advanced',
      );
    } else {
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

    return nextPhase;
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

  // ── Accessors ─────────────────────────────────────────────────

  /**
   * Return whether a session is currently active (exists and has phases remaining).
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
}
