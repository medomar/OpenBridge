/**
 * Session Compactor (OB-1666)
 *
 * Monitors the Master AI session's turn count via `agent_activity` tracking
 * and determines when compaction is needed to prevent context window overflow.
 *
 * Turn count is derived from two sources:
 *  - `sessions.message_count`  — number of messages processed in this session
 *  - `agent_activity` (type='worker', parent_id=sessionId) — worker spawns
 *
 * Compaction is triggered when totalTurns >= maxTurns × threshold.
 */

import type Database from 'better-sqlite3';
import { createLogger } from '../core/logger.js';

const logger = createLogger('session-compactor');

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface CompactorConfig {
  /** Max turns for the Master session (mirrors MASTER_MAX_TURNS). */
  maxTurns: number;
  /**
   * Fraction of maxTurns at which compaction is triggered.
   * Default: 0.8 (compaction fires when 80% of maxTurns is consumed).
   */
  threshold?: number;
  /**
   * Maximum number of retries on compaction failure before giving up.
   * Default: 2.
   */
  maxRetries?: number;
}

/**
 * A point-in-time snapshot of the session's turn consumption.
 * Returned by `snapshotTurns()` — callers can inspect fields or call
 * `needsCompaction` directly.
 */
export interface TurnSnapshot {
  /** Session ID that was queried. */
  sessionId: string;
  /** Messages processed in this session (from `sessions.message_count`). */
  messageCount: number;
  /** Worker spawns recorded under this session (from `agent_activity`). */
  workerSpawnCount: number;
  /**
   * Total observed turn cost: messageCount + workerSpawnCount.
   * This is the value compared against the threshold.
   */
  totalTurns: number;
  /** Whether totalTurns has reached or exceeded the compaction threshold. */
  needsCompaction: boolean;
  /** The configured maxTurns value used for this snapshot. */
  maxTurns: number;
  /** The fraction threshold in use (e.g. 0.8). */
  threshold: number;
  /** The absolute turn count at which compaction fires (Math.floor(maxTurns × threshold)). */
  thresholdTurns: number;
  /** ISO timestamp when this snapshot was captured. */
  capturedAt: string;
}

// ---------------------------------------------------------------------------
// SessionCompactor
// ---------------------------------------------------------------------------

/**
 * Monitors a Master session's turn consumption and determines when compaction
 * should be triggered to prevent the context window from being exhausted.
 *
 * Usage:
 * ```typescript
 * const compactor = new SessionCompactor({ maxTurns: 50 });
 * if (compactor.shouldCompact(db, sessionId)) {
 *   // ... trigger compaction
 * }
 * ```
 */
export class SessionCompactor {
  private readonly maxTurns: number;
  private readonly threshold: number;
  readonly maxRetries: number;

  constructor(config: CompactorConfig) {
    this.maxTurns = config.maxTurns;
    this.threshold = config.threshold ?? 0.8;
    this.maxRetries = config.maxRetries ?? 2;
  }

  /**
   * Absolute turn count at which compaction fires.
   * Computed as `Math.floor(maxTurns × threshold)`.
   */
  get thresholdTurns(): number {
    return Math.floor(this.maxTurns * this.threshold);
  }

  /**
   * Capture a turn-count snapshot for the given session.
   *
   * Queries:
   *  - `sessions` table for `message_count` (cumulative interactions)
   *  - `agent_activity` for worker spawns whose `parent_id` matches `sessionId`
   *
   * Both counts are combined to estimate total context consumption, since each
   * worker spawn contributes additional context into the Master session window.
   */
  snapshotTurns(db: Database.Database, sessionId: string): TurnSnapshot {
    // --- message_count from sessions table ---
    let messageCount = 0;
    try {
      const row = db
        .prepare(`SELECT message_count FROM sessions WHERE id = ? LIMIT 1`)
        .get(sessionId) as { message_count: number | null } | undefined;
      messageCount = row?.message_count ?? 0;
    } catch (err) {
      logger.warn({ err, sessionId }, 'SessionCompactor: failed to read sessions.message_count');
    }

    // --- worker spawns from agent_activity ---
    let workerSpawnCount = 0;
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM agent_activity
           WHERE parent_id = ? AND type = 'worker'`,
        )
        .get(sessionId) as { count: number } | undefined;
      workerSpawnCount = row?.count ?? 0;
    } catch (err) {
      logger.warn(
        { err, sessionId },
        'SessionCompactor: failed to read agent_activity worker count',
      );
    }

    const totalTurns = messageCount + workerSpawnCount;
    const needsCompaction = totalTurns >= this.thresholdTurns;

    logger.debug(
      {
        sessionId,
        messageCount,
        workerSpawnCount,
        totalTurns,
        thresholdTurns: this.thresholdTurns,
        needsCompaction,
      },
      'SessionCompactor: turn snapshot',
    );

    return {
      sessionId,
      messageCount,
      workerSpawnCount,
      totalTurns,
      needsCompaction,
      maxTurns: this.maxTurns,
      threshold: this.threshold,
      thresholdTurns: this.thresholdTurns,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Return `true` when the session's turn count has reached or exceeded the
   * compaction threshold.
   *
   * Equivalent to `snapshotTurns(db, sessionId).needsCompaction` but more
   * convenient when only a boolean is required.
   */
  shouldCompact(db: Database.Database, sessionId: string): boolean {
    return this.snapshotTurns(db, sessionId).needsCompaction;
  }
}
