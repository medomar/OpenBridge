/**
 * Batch Manager — Lifecycle management for Batch Task Continuation.
 *
 * When a user asks to "implement all tasks", "go through each one", or similar,
 * the Master AI activates Batch Mode. BatchManager owns the state machine that
 * drives sequential item processing through a batch run.
 *
 * Responsibilities:
 * - Create / advance / pause / resume / abort batch runs
 * - Track per-item completion status and cumulative cost
 * - Persist batch state to `.openbridge/batch-state.json` after every mutation
 * - Load persisted state on `initialize()` to resume interrupted batches
 * - Expose `isActive()` and `getStatus()` for integration into MasterManager
 *
 * This class does NOT read TASKS.md or FINDINGS.md — that is the responsibility
 * of subsequent tasks (OB-1607). It only manages lifecycle state.
 */

import { randomUUID } from 'node:crypto';

import { createLogger } from '../core/logger.js';
import type {
  BatchCompletedItem,
  BatchPlanItem,
  BatchSourceType,
  BatchState,
} from '../types/agent.js';
import type { BatchConfig } from '../types/config.js';
import type { DotFolderManager } from './dotfolder-manager.js';

const logger = createLogger('batch-manager');

// ── Public result types ────────────────────────────────────────────

/** Summary returned by advanceBatch() after recording an item result. */
export interface BatchAdvanceResult {
  /** The batch identifier. */
  batchId: string;
  /** Zero-based index of the item just completed. */
  completedIndex: number;
  /** Zero-based index of the next item to process, or null when the batch is done. */
  nextIndex: number | null;
  /** Whether the batch has finished all items. */
  finished: boolean;
  /**
   * Populated when finished === true — the formatted completion summary to send to the user (OB-1618).
   * Includes total completed/failed/skipped, cost, duration, and per-item summaries.
   */
  completionSummary: string | null;
}

/** Describes a single safety rail limit that was exceeded. */
export interface SafetyRailViolation {
  /** Which limit was exceeded. */
  rail: 'iterations' | 'budget' | 'timeout';
  /** Human-readable explanation suitable for surfacing to the user. */
  message: string;
}

/** Result of a safety rail check. */
export interface SafetyRailCheckResult {
  /** True when all rails pass and the batch may continue. */
  passed: boolean;
  /** Populated when passed is false — the first violation that triggered the pause. */
  violation: SafetyRailViolation | undefined;
}

// ── BatchManager ───────────────────────────────────────────────────

/**
 * Manages the lifecycle of Batch Task Continuation runs.
 *
 * A single batch is supported at a time per BatchManager instance.
 * Only one batch should be active for a given Master AI session.
 */
export class BatchManager {
  /** All tracked batches keyed by batchId. */
  private readonly batches = new Map<string, BatchState>();

  /** Optional persistence layer — when set, batch state is saved after every mutation. */
  private dotFolder: DotFolderManager | undefined;

  /** Stores the completion summary for the most-recently-finished batch (OB-1618). */
  private lastCompletionSummary: string | null = null;

  constructor(dotFolder?: DotFolderManager) {
    this.dotFolder = dotFolder;
  }

  // ── Persistence helpers ────────────────────────────────────────

  /**
   * Load any persisted batch state from `.openbridge/batch-state.json` on startup.
   * Resumes the batch as paused so the caller can decide whether to continue.
   * No-op when no persistence layer is configured or no saved state exists.
   */
  async initialize(): Promise<void> {
    if (!this.dotFolder) return;

    const saved = await this.dotFolder.readBatchState();
    if (!saved) return;

    // Resume as paused — the caller (MasterManager) will unpause when ready.
    saved.paused = true;
    this.batches.set(saved.batchId, saved);

    logger.info(
      {
        batchId: saved.batchId,
        currentIndex: saved.currentIndex,
        totalItems: saved.totalItems,
        completedItems: saved.completedItems.length,
      },
      'Resumed batch from persisted state',
    );
  }

  /** Persist the given batch state to disk (no-op when no dotFolder is set). */
  private async persist(state: BatchState): Promise<void> {
    if (!this.dotFolder) return;
    try {
      await this.dotFolder.writeBatchState(state);
    } catch (err) {
      logger.warn({ batchId: state.batchId, err }, 'Failed to persist batch state');
    }
  }

  /** Delete the persisted batch state file (no-op when no dotFolder is set). */
  private async deletePersisted(): Promise<void> {
    if (!this.dotFolder) return;
    try {
      await this.dotFolder.deleteBatchState();
    } catch (err) {
      logger.warn({ err }, 'Failed to delete persisted batch state');
    }
  }

  // ── Lifecycle methods ──────────────────────────────────────────

  /**
   * Create a new batch run.
   *
   * @param sourceType      Where the item list comes from (tasks-md, findings, custom-list).
   * @param plan            Ordered list of items to process (from BatchPlanner).
   *                        When provided, totalItems is derived from plan.length.
   *                        When omitted, pass totalItems explicitly.
   * @param totalItems      Number of items — used only when plan is not provided.
   * @param commitAfterEach When true, a git-commit worker is spawned after each item (OB-1615).
   * @returns               The new batch ID.
   */
  async createBatch(
    sourceType: BatchSourceType,
    plan: BatchPlanItem[],
    totalItems?: number,
    commitAfterEach = false,
  ): Promise<string> {
    const batchId = randomUUID();
    const resolvedTotal = plan.length > 0 ? plan.length : (totalItems ?? 0);

    const state: BatchState = {
      batchId,
      sourceType,
      totalItems: resolvedTotal,
      currentIndex: 0,
      plan,
      completedItems: [],
      failedItems: [],
      startedAt: new Date().toISOString(),
      totalCostUsd: 0,
      paused: false,
      commitAfterEach,
    };

    this.batches.set(batchId, state);
    await this.persist(state);

    logger.info(
      { batchId, sourceType, totalItems: resolvedTotal, planItems: plan.length },
      'Batch created',
    );

    return batchId;
  }

  /**
   * Record the result of the current item and advance to the next one.
   *
   * @param batchId       The active batch identifier.
   * @param item          Completion record for the item just processed.
   * @param costUsd       Cost incurred for this item in USD (added to running total).
   * @returns             Advance result with the next index, or null when the batch is done.
   *                      Returns null if the batchId is unknown.
   */
  async advanceBatch(
    batchId: string,
    item: BatchCompletedItem,
    costUsd = 0,
  ): Promise<BatchAdvanceResult | null> {
    const state = this.batches.get(batchId);
    if (!state) {
      logger.warn({ batchId }, 'advanceBatch() called on unknown batch');
      return null;
    }

    const completedIndex = state.currentIndex;

    // Record the completed item
    state.completedItems.push(item);
    if (item.status === 'failed') {
      state.failedItems.push(item.id);
    }

    // Accumulate cost
    state.totalCostUsd += costUsd;

    // Advance to next item
    const nextIndex = completedIndex + 1;
    const finished = nextIndex >= state.totalItems;

    state.currentIndex = finished ? state.totalItems : nextIndex;

    logger.info(
      {
        batchId,
        completedIndex,
        nextIndex: finished ? null : nextIndex,
        itemStatus: item.status,
        finished,
        totalCostUsd: state.totalCostUsd,
      },
      'Batch item completed',
    );

    let completionSummary: string | null = null;
    if (finished) {
      // Build the completion summary BEFORE removing state from memory (OB-1618).
      completionSummary = this.buildCompletionSummaryText(state);
      this.lastCompletionSummary = completionSummary;
      // Batch is complete — remove in-progress state from disk
      this.batches.delete(batchId);
      await this.deletePersisted();
    } else {
      await this.persist(state);
    }

    return {
      batchId,
      completedIndex,
      nextIndex: finished ? null : nextIndex,
      finished,
      completionSummary,
    };
  }

  /**
   * Pause an active batch (e.g., awaiting user confirmation or safety rail trigger).
   *
   * @param batchId  The batch to pause.
   * @returns        True if the batch was found and paused, false otherwise.
   */
  async pauseBatch(batchId: string): Promise<boolean> {
    const state = this.batches.get(batchId);
    if (!state) {
      logger.warn({ batchId }, 'pauseBatch() called on unknown batch');
      return false;
    }

    state.paused = true;
    await this.persist(state);

    logger.info({ batchId, currentIndex: state.currentIndex }, 'Batch paused');
    return true;
  }

  /**
   * Resume a paused batch.
   *
   * @param batchId  The batch to resume.
   * @returns        True if the batch was found and resumed, false otherwise.
   */
  async resumeBatch(batchId: string): Promise<boolean> {
    const state = this.batches.get(batchId);
    if (!state) {
      logger.warn({ batchId }, 'resumeBatch() called on unknown batch');
      return false;
    }

    if (!state.paused) {
      logger.warn({ batchId }, 'resumeBatch() called on a batch that is not paused');
    }

    state.paused = false;
    await this.persist(state);

    logger.info({ batchId, currentIndex: state.currentIndex }, 'Batch resumed');
    return true;
  }

  /**
   * Abort a batch and remove it from memory and disk.
   *
   * @param batchId  The batch to abort.
   * @returns        True if the batch was found and aborted, false if it was unknown.
   */
  async abortBatch(batchId: string): Promise<boolean> {
    const state = this.batches.get(batchId);
    if (!state) {
      logger.warn({ batchId }, 'abortBatch() called on unknown batch');
      return false;
    }

    logger.info(
      {
        batchId,
        completedItems: state.completedItems.length,
        currentIndex: state.currentIndex,
        totalItems: state.totalItems,
      },
      'Batch aborted',
    );

    this.batches.delete(batchId);
    await this.deletePersisted();
    return true;
  }

  // ── Completion summary ─────────────────────────────────────────

  /**
   * Build a formatted completion summary string from the final batch state (OB-1618).
   *
   * Includes: total completed/failed/skipped counts, cumulative cost, wall-clock duration,
   * and a per-item list with status icons and one-line summaries.
   *
   * Called internally by advanceBatch() just before the completed batch state is deleted.
   */
  private buildCompletionSummaryText(state: BatchState): string {
    const completed = state.completedItems.filter((i) => i.status === 'completed').length;
    const failed = state.completedItems.filter((i) => i.status === 'failed').length;
    const skipped = state.completedItems.filter((i) => i.status === 'skipped').length;

    const durationMs = Date.now() - new Date(state.startedAt).getTime();
    const totalSeconds = Math.round(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    let durationStr: string;
    if (hours > 0) {
      durationStr = `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      durationStr = `${minutes}m ${seconds}s`;
    } else {
      durationStr = `${seconds}s`;
    }

    const costStr = state.totalCostUsd > 0 ? `$${state.totalCostUsd.toFixed(4)}` : 'not tracked';

    const lines: string[] = [
      '🎉 Batch complete!',
      '',
      `**Results:** ${completed} completed, ${failed} failed, ${skipped} skipped`,
      `**Total cost:** ${costStr}`,
      `**Duration:** ${durationStr}`,
    ];

    if (state.completedItems.length > 0) {
      lines.push('', '**Items:**');
      for (const item of state.completedItems) {
        const icon = item.status === 'failed' ? '❌' : item.status === 'skipped' ? '⏭' : '✅';
        const summary = item.summary ? ` — ${item.summary}` : '';
        lines.push(`- ${icon} ${item.id}${summary}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Return the completion summary for the most recently finished batch and clear it (OB-1618).
   *
   * Should be called by MasterManager immediately after detecting that a batch has finished
   * (i.e. advanceBatch() returned finished === true). Returns null if no summary is available
   * (e.g. the batch was aborted rather than completed naturally).
   */
  popCompletionSummary(): string | null {
    const summary = this.lastCompletionSummary;
    this.lastCompletionSummary = null;
    return summary;
  }

  // ── Query methods ──────────────────────────────────────────────

  /**
   * Return a snapshot of the current batch state.
   *
   * @param batchId  The batch to query.
   * @returns        Current state, or undefined if the batch is unknown.
   */
  getStatus(batchId: string): BatchState | undefined {
    const state = this.batches.get(batchId);
    if (!state) return undefined;

    // Return a shallow copy so callers cannot mutate internal state
    return {
      ...state,
      completedItems: [...state.completedItems],
      failedItems: [...state.failedItems],
    };
  }

  /**
   * Check whether any batch (or a specific one) is currently active.
   *
   * A batch is considered active if it exists and is not paused and has items remaining.
   *
   * @param batchId  Optional — check a specific batch ID.
   *                 When omitted, returns true if ANY batch has remaining items.
   * @returns        True when an active, unpaused batch is found.
   */
  isActive(batchId?: string): boolean {
    if (batchId !== undefined) {
      const state = this.batches.get(batchId);
      if (!state) return false;
      return !state.paused && state.currentIndex < state.totalItems;
    }

    // Check any batch
    for (const state of this.batches.values()) {
      if (!state.paused && state.currentIndex < state.totalItems) {
        return true;
      }
    }
    return false;
  }

  /**
   * Return the ID of the first active batch, or undefined if none exist.
   *
   * Useful for MasterManager to locate the current batch without storing the ID separately.
   */
  getActiveBatchId(): string | undefined {
    for (const [id, state] of this.batches.entries()) {
      if (state.currentIndex < state.totalItems) {
        return id;
      }
    }
    return undefined;
  }

  /**
   * Build a user-facing progress message for the batch after an item completes (OB-1614).
   *
   * Returns a formatted string when there is at least one completed item and a next
   * item remaining in the plan. Returns null when there is nothing useful to show
   * (e.g. no completed items yet, batch done, or batch unknown).
   *
   * Format:
   *   ✅ Task {id} done: {summary}
   *   Starting {nextId}... ({current}/{total})
   *
   * @param batchId  The active batch identifier.
   * @returns        Formatted progress message, or null.
   */
  buildProgressMessage(batchId: string): string | null {
    const state = this.batches.get(batchId);
    if (!state) return null;

    const lastCompleted = state.completedItems[state.completedItems.length - 1];
    if (!lastCompleted) return null;

    // No next item — batch is done; completion summary is handled by OB-1618.
    const nextItem = state.plan[state.currentIndex];
    if (!nextItem) return null;

    const current = state.completedItems.length;
    const total = state.totalItems;

    const statusIcon = lastCompleted.status === 'failed' ? '❌' : '✅';
    const summaryLine = lastCompleted.summary
      ? `${statusIcon} Task ${lastCompleted.id} done: ${lastCompleted.summary}`
      : `${statusIcon} Task ${lastCompleted.id} done.`;

    return `${summaryLine}\nStarting ${nextItem.id}... (${current}/${total})`;
  }

  // ── Failure handling ───────────────────────────────────────────

  /**
   * Build a user-facing failure message for a failed batch item (OB-1616).
   *
   * Returns the formatted string with instructions for how the user can respond:
   *   ❌ Task {id} failed: {reason}
   *   Reply '/batch skip' to skip and continue, '/batch retry' to retry, '/batch abort' to stop.
   *
   * @param batchId  The active batch identifier.
   * @param reason   Short human-readable reason the item failed.
   * @returns        Formatted failure message, or null if the batch is unknown.
   */
  buildFailureMessage(batchId: string, reason: string): string | null {
    const state = this.batches.get(batchId);
    if (!state) return null;

    const currentItem = state.plan[state.currentIndex];
    const itemId = currentItem?.id ?? `item-${state.currentIndex + 1}`;

    return (
      `❌ Task ${itemId} failed: ${reason}\n` +
      `Reply '/batch skip' to skip and continue, '/batch retry' to retry, '/batch abort' to stop.`
    );
  }

  /**
   * Skip the current failed item and advance to the next one (OB-1616).
   *
   * Records the current item as 'skipped', resumes the batch (clears paused flag),
   * and advances to the next index via advanceBatch().
   *
   * @param batchId  The batch whose current item should be skipped.
   * @returns        BatchAdvanceResult (same as advanceBatch), or null on unknown batch.
   */
  async skipCurrentItem(batchId: string): Promise<BatchAdvanceResult | null> {
    const state = this.batches.get(batchId);
    if (!state) {
      logger.warn({ batchId }, 'skipCurrentItem() called on unknown batch');
      return null;
    }

    const currentItem = state.plan[state.currentIndex];
    const item: BatchCompletedItem = {
      id: currentItem?.id ?? `item-${state.currentIndex + 1}`,
      summary: 'Skipped by user',
      status: 'skipped',
    };

    // Clear paused so advanceBatch can record and advance
    state.paused = false;

    logger.info({ batchId, itemId: item.id }, 'Batch item skipped by user');
    return this.advanceBatch(batchId, item);
  }

  /**
   * Retry the current failed item by resuming the batch at the same index (OB-1616).
   *
   * This is equivalent to resumeBatch() — the currentIndex is NOT advanced,
   * so the next continuation trigger will re-run the same item.
   *
   * @param batchId  The batch whose current item should be retried.
   * @returns        True if the batch was found and resumed, false otherwise.
   */
  async retryCurrentItem(batchId: string): Promise<boolean> {
    const state = this.batches.get(batchId);
    if (!state) {
      logger.warn({ batchId }, 'retryCurrentItem() called on unknown batch');
      return false;
    }

    const currentItem = state.plan[state.currentIndex];
    logger.info(
      { batchId, itemId: currentItem?.id, currentIndex: state.currentIndex },
      'Batch item retry requested — resuming at same index',
    );

    return this.resumeBatch(batchId);
  }

  // ── Commit-after-each support ─────────────────────────────────

  /**
   * Set or clear the commitAfterEach flag on an existing batch (OB-1615).
   *
   * @param batchId          The batch to update.
   * @param commitAfterEach  Whether to spawn a git-commit worker after each item.
   * @returns                True if the batch was found and updated, false otherwise.
   */
  async setCommitAfterEach(batchId: string, commitAfterEach: boolean): Promise<boolean> {
    const state = this.batches.get(batchId);
    if (!state) {
      logger.warn({ batchId }, 'setCommitAfterEach() called on unknown batch');
      return false;
    }

    state.commitAfterEach = commitAfterEach;
    await this.persist(state);

    logger.info({ batchId, commitAfterEach }, 'Batch commitAfterEach updated');
    return true;
  }

  /**
   * Return whether the given batch should spawn a commit worker after each item (OB-1615).
   *
   * @param batchId  The batch to check.
   * @returns        True when commitAfterEach is set and the batch exists.
   */
  shouldCommitAfterEach(batchId: string): boolean {
    return this.batches.get(batchId)?.commitAfterEach === true;
  }

  /**
   * Build the prompt for a git-commit worker after a batch item completes (OB-1615).
   *
   * The prompt instructs the worker to stage all changes and create a conventional commit
   * referencing the completed item's ID and description.
   *
   * @param batchId  The active batch identifier.
   * @returns        Commit worker prompt string, or null when no last completed item exists.
   */
  buildCommitPrompt(batchId: string): string | null {
    const state = this.batches.get(batchId);
    if (!state) return null;

    const lastCompleted = state.completedItems[state.completedItems.length - 1];
    if (!lastCompleted) return null;

    // Find the plan item to get its description
    const planItem = state.plan.find((p) => p.id === lastCompleted.id);
    const description = planItem?.description ?? lastCompleted.summary ?? lastCompleted.id;

    return (
      `git add and commit changes for: ${description}\n\n` +
      `Use a conventional commit message. Reference the task ID "${lastCompleted.id}" in the commit body.\n` +
      `Run: git add -A && git commit -m "feat: ${description.slice(0, 72)}" -m "Resolves ${lastCompleted.id}"\n` +
      `If there is nothing to commit (working tree clean), skip the commit and exit cleanly.`
    );
  }

  // ── Safety rails ───────────────────────────────────────────────

  /**
   * Check all safety rails before processing the next batch iteration.
   *
   * Evaluates three limits from the provided config:
   *  - `maxBatchIterations` — total completed items must be below this cap.
   *  - `batchBudgetUsd`     — cumulative cost must remain below this value.
   *  - `batchTimeoutMinutes`— wall-clock time from batch start must be below this.
   *
   * If any limit is exceeded the batch is automatically paused (so it can be resumed
   * after user confirmation) and the violation is returned. The caller is responsible
   * for forwarding the `violation.message` to the user.
   *
   * @param batchId  The batch to check.
   * @param config   Safety limits from the config (BatchConfig fields).
   * @returns        `{ passed: true }` when safe to continue, or `{ passed: false, violation }`.
   *                 Returns `{ passed: true }` for unknown batch IDs (fail-open — let
   *                 other guards handle missing state).
   */
  async checkSafetyRails(
    batchId: string,
    config: Pick<BatchConfig, 'maxBatchIterations' | 'batchBudgetUsd' | 'batchTimeoutMinutes'>,
  ): Promise<SafetyRailCheckResult> {
    const state = this.batches.get(batchId);
    if (!state) {
      logger.warn({ batchId }, 'checkSafetyRails() called on unknown batch — allowing');
      return { passed: true, violation: undefined };
    }

    const { maxBatchIterations, batchBudgetUsd, batchTimeoutMinutes } = config;

    // ── Rail 1: iteration cap ──────────────────────────────────
    if (state.completedItems.length >= maxBatchIterations) {
      const violation: SafetyRailViolation = {
        rail: 'iterations',
        message:
          `Batch paused: completed ${state.completedItems.length} of ${state.totalItems} items, ` +
          `which has reached the maximum iteration limit (${maxBatchIterations}). ` +
          `Reply "continue batch" to process the next ${maxBatchIterations} items.`,
      };
      logger.warn(
        { batchId, completedItems: state.completedItems.length, maxBatchIterations },
        'Safety rail triggered: iteration limit reached',
      );
      await this.pauseBatch(batchId);
      return { passed: false, violation };
    }

    // ── Rail 2: budget cap ─────────────────────────────────────
    if (state.totalCostUsd >= batchBudgetUsd) {
      const violation: SafetyRailViolation = {
        rail: 'budget',
        message:
          `Batch paused: cumulative cost $${state.totalCostUsd.toFixed(4)} has reached ` +
          `the budget limit ($${batchBudgetUsd.toFixed(2)}). ` +
          `Reply "continue batch" to authorize additional spending.`,
      };
      logger.warn(
        { batchId, totalCostUsd: state.totalCostUsd, batchBudgetUsd },
        'Safety rail triggered: budget limit reached',
      );
      await this.pauseBatch(batchId);
      return { passed: false, violation };
    }

    // ── Rail 3: timeout cap ────────────────────────────────────
    const elapsedMs = Date.now() - new Date(state.startedAt).getTime();
    const timeoutMs = batchTimeoutMinutes * 60 * 1000;
    if (elapsedMs >= timeoutMs) {
      const elapsedMin = Math.round(elapsedMs / 60_000);
      const violation: SafetyRailViolation = {
        rail: 'timeout',
        message:
          `Batch paused: elapsed time ${elapsedMin} min has reached the timeout limit ` +
          `(${batchTimeoutMinutes} min). ` +
          `Reply "continue batch" to extend the session.`,
      };
      logger.warn(
        { batchId, elapsedMs, timeoutMs },
        'Safety rail triggered: timeout limit reached',
      );
      await this.pauseBatch(batchId);
      return { passed: false, violation };
    }

    return { passed: true, violation: undefined };
  }

  // ── Master context injection ────────────────────────────────────

  /**
   * Build a system prompt section describing the current batch state (OB-1617).
   *
   * Injected into the Master AI's system prompt on every turn during a batch run
   * so the Master never loses track of which item is current, what has been
   * completed, and how many items remain.
   *
   * @param batchId  The active batch identifier.
   * @returns        Formatted Markdown section, or null when the batch is unknown.
   */
  buildBatchContextSection(batchId: string): string | null {
    const state = this.batches.get(batchId);
    if (!state) return null;

    const completed = state.completedItems.length;
    const remaining = state.totalItems - state.currentIndex;
    const currentPosition = state.currentIndex + 1; // 1-based for human display
    const currentItem = state.plan[state.currentIndex];

    const lines: string[] = [
      '## Active Batch Run',
      '',
      `**Batch ID:** ${batchId}`,
      `**Progress:** ${completed} completed, ${remaining} remaining (${currentPosition}/${state.totalItems} total)`,
    ];

    if (currentItem) {
      lines.push(
        '',
        `**Current item (${currentPosition}/${state.totalItems}):** ${currentItem.id}`,
      );
      if (currentItem.description) {
        lines.push(`**Task:** ${currentItem.description}`);
      }
    }

    if (state.completedItems.length > 0) {
      lines.push('', '**Completed items:**');
      for (const item of state.completedItems) {
        const icon = item.status === 'failed' ? '❌' : item.status === 'skipped' ? '⏭' : '✅';
        const summary = item.summary ? ` — ${item.summary}` : '';
        lines.push(`- ${icon} ${item.id}${summary}`);
      }
    }

    if (state.failedItems.length > 0) {
      lines.push('', `**Failed items:** ${state.failedItems.join(', ')}`);
    }

    lines.push(
      '',
      'Process the current item above. When done, the batch will automatically continue to the next item.',
    );

    return lines.join('\n');
  }
}
