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
 * - Expose `isActive()` and `getStatus()` for integration into MasterManager
 *
 * This class does NOT read TASKS.md or FINDINGS.md — that is the responsibility
 * of subsequent tasks (OB-1607). It only manages lifecycle state.
 */

import { randomUUID } from 'node:crypto';

import { createLogger } from '../core/logger.js';
import type { BatchCompletedItem, BatchSourceType, BatchState } from '../types/agent.js';

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

  // ── Lifecycle methods ──────────────────────────────────────────

  /**
   * Create a new batch run.
   *
   * @param sourceType   Where the item list comes from (tasks-md, findings, custom-list).
   * @param totalItems   Number of items in the batch.
   * @returns            The new batch ID.
   */
  createBatch(sourceType: BatchSourceType, totalItems: number): string {
    const batchId = randomUUID();

    const state: BatchState = {
      batchId,
      sourceType,
      totalItems,
      currentIndex: 0,
      completedItems: [],
      failedItems: [],
      startedAt: new Date().toISOString(),
      totalCostUsd: 0,
      paused: false,
    };

    this.batches.set(batchId, state);

    logger.info({ batchId, sourceType, totalItems }, 'Batch created');

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
  advanceBatch(batchId: string, item: BatchCompletedItem, costUsd = 0): BatchAdvanceResult | null {
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

    return {
      batchId,
      completedIndex,
      nextIndex: finished ? null : nextIndex,
      finished,
    };
  }

  /**
   * Pause an active batch (e.g., awaiting user confirmation or safety rail trigger).
   *
   * @param batchId  The batch to pause.
   * @returns        True if the batch was found and paused, false otherwise.
   */
  pauseBatch(batchId: string): boolean {
    const state = this.batches.get(batchId);
    if (!state) {
      logger.warn({ batchId }, 'pauseBatch() called on unknown batch');
      return false;
    }

    state.paused = true;
    logger.info({ batchId, currentIndex: state.currentIndex }, 'Batch paused');
    return true;
  }

  /**
   * Resume a paused batch.
   *
   * @param batchId  The batch to resume.
   * @returns        True if the batch was found and resumed, false otherwise.
   */
  resumeBatch(batchId: string): boolean {
    const state = this.batches.get(batchId);
    if (!state) {
      logger.warn({ batchId }, 'resumeBatch() called on unknown batch');
      return false;
    }

    if (!state.paused) {
      logger.warn({ batchId }, 'resumeBatch() called on a batch that is not paused');
    }

    state.paused = false;
    logger.info({ batchId, currentIndex: state.currentIndex }, 'Batch resumed');
    return true;
  }

  /**
   * Abort a batch and remove it from memory.
   *
   * @param batchId  The batch to abort.
   * @returns        True if the batch was found and aborted, false if it was unknown.
   */
  abortBatch(batchId: string): boolean {
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
    return true;
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
}
