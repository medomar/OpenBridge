/**
 * Session Compactor (OB-1666, OB-1667, OB-1668)
 *
 * Monitors the Master AI session's turn count via `agent_activity` tracking
 * and determines when compaction is needed to prevent context window overflow.
 *
 * Turn count is derived from two sources:
 *  - `sessions.message_count`  — number of messages processed in this session
 *  - `agent_activity` (type='worker', parent_id=sessionId) — worker spawns
 *
 * Compaction is triggered when totalTurns >= maxTurns × threshold.
 *
 * When compaction fires, `compactTurns()` produces a structured
 * {@link CompactionSummary} from the conversation history, preserving key
 * identifiers (file paths, function names, task IDs, finding IDs) so the next
 * session segment can resume without re-reading the full history.
 */

import type Database from 'better-sqlite3';
import { createLogger } from '../core/logger.js';

const logger = createLogger('session-compactor');

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/**
 * A single conversation turn supplied to `compactTurns()`.
 */
export interface ConversationTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Structured compaction summary produced by `compactTurns()`.
 *
 * Preserves identifiers extracted from the original turns so the next session
 * segment can resume work without replaying the full conversation history.
 */
export interface CompactionSummary {
  /** Brief text overview of the activity covered in the summarized turns. */
  overview: string;
  /** Deduplicated file paths referenced across all turns (e.g. `src/master/session-compactor.ts`). */
  filePaths: string[];
  /** Function/method names mentioned across all turns, with trailing `()`. */
  functionNames: string[];
  /** OpenBridge task IDs found in turns (e.g. `OB-1668`). */
  taskIds: string[];
  /** OpenBridge finding IDs found in turns (e.g. `OB-F84`). */
  findingIds: string[];
  /** Completed work items inferred from explicit completion markers in turn content. */
  completedWork: string[];
  /** Pending or in-progress work items inferred from explicit markers in turn content. */
  pendingWork: string[];
  /** Total number of turns summarized. */
  turnCount: number;
  /** ISO timestamp when this summary was produced. */
  compactedAt: string;
}

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
 * Async handler invoked when compaction is triggered.
 * Receives a point-in-time snapshot describing why compaction fired.
 * Implementations should summarize conversation turns and persist the
 * summary (e.g. to memory.md) so the next session segment retains context.
 */
export type CompactionHandler = (snapshot: TurnSnapshot) => Promise<void>;

/**
 * Result returned by `triggerIfNeeded()`.
 */
export interface CompactionTriggerResult {
  /** Whether compaction was actually triggered (false when below threshold). */
  triggered: boolean;
  /** The turn snapshot captured at trigger time. */
  snapshot: TurnSnapshot;
  /**
   * Reason compaction was skipped (only present when `triggered` is false).
   * E.g. "below threshold" or "already compacted this session".
   */
  skippedReason?: string;
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

  /**
   * Check the session's turn count and trigger compaction if the configurable
   * threshold has been reached.
   *
   * When compaction is needed the provided `handler` is invoked (if any).
   * If no handler is supplied the method still returns `triggered: true` so
   * the caller can take its own action (e.g. restart the session segment).
   *
   * Returns a {@link CompactionTriggerResult} describing whether compaction
   * fired and why (or why not).
   *
   * @param db        - Open SQLite database handle.
   * @param sessionId - The current Master session ID to inspect.
   * @param handler   - Optional async callback invoked when threshold is exceeded.
   */
  async triggerIfNeeded(
    db: Database.Database,
    sessionId: string,
    handler?: CompactionHandler,
  ): Promise<CompactionTriggerResult> {
    const snapshot = this.snapshotTurns(db, sessionId);

    if (!snapshot.needsCompaction) {
      logger.debug(
        {
          sessionId,
          totalTurns: snapshot.totalTurns,
          thresholdTurns: snapshot.thresholdTurns,
        },
        'SessionCompactor: below threshold — skipping compaction',
      );
      return { triggered: false, snapshot, skippedReason: 'below threshold' };
    }

    logger.info(
      {
        sessionId,
        totalTurns: snapshot.totalTurns,
        thresholdTurns: snapshot.thresholdTurns,
        maxTurns: snapshot.maxTurns,
        threshold: snapshot.threshold,
      },
      'SessionCompactor: threshold exceeded — triggering compaction',
    );

    if (handler) {
      await handler(snapshot);
    }

    return { triggered: true, snapshot };
  }

  // ---------------------------------------------------------------------------
  // Compaction Strategy (OB-1668)
  // ---------------------------------------------------------------------------

  /**
   * Summarize a sequence of conversation turns into a structured
   * {@link CompactionSummary} that preserves key identifiers.
   *
   * The summary captures:
   * - File paths (`src/...`, `tests/...`, `docs/...`, `./...`, absolute paths)
   * - Function/method names (token followed by `()`)
   * - OpenBridge task IDs (`OB-NNNN`)
   * - OpenBridge finding IDs (`OB-FNNNN`)
   * - Completed work items (from `✅`, `[x]`, `done:`, `completed:`, `fixed:`)
   * - Pending work items (from `TODO:`, `NEXT:`, `pending:`, `[ ]`, `needs:`)
   *
   * @param turns - The conversation turns to compact.
   */
  compactTurns(turns: ConversationTurn[]): CompactionSummary {
    if (turns.length === 0) {
      return {
        overview: 'No turns to compact.',
        filePaths: [],
        functionNames: [],
        taskIds: [],
        findingIds: [],
        completedWork: [],
        pendingWork: [],
        turnCount: 0,
        compactedAt: new Date().toISOString(),
      };
    }

    const allContent = turns.map((t) => t.content).join('\n');

    return {
      overview: this._buildOverview(turns),
      filePaths: this._extractFilePaths(allContent),
      functionNames: this._extractFunctionNames(allContent),
      taskIds: this._extractTaskIds(allContent),
      findingIds: this._extractFindingIds(allContent),
      completedWork: this._extractCompletedWork(allContent),
      pendingWork: this._extractPendingWork(allContent),
      turnCount: turns.length,
      compactedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Private extraction helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a one-sentence overview from the first user turn and the last
   * assistant turn in the sequence.
   */
  private _buildOverview(turns: ConversationTurn[]): string {
    const firstUser = turns.find((t) => t.role === 'user')?.content ?? '';
    const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')?.content ?? '';

    const userPreview = firstUser.slice(0, 100).replace(/\n/g, ' ').trim();
    const assistantPreview = lastAssistant.slice(0, 100).replace(/\n/g, ' ').trim();

    if (userPreview && assistantPreview) {
      return `Compacted ${turns.length} turns. First request: "${userPreview}". Last response: "${assistantPreview}".`;
    }
    if (userPreview) {
      return `Compacted ${turns.length} turns. First request: "${userPreview}".`;
    }
    return `Compacted ${turns.length} turns.`;
  }

  /**
   * Extract file paths from text.
   * Matches `src/`, `tests/`, `docs/` relative paths and absolute paths.
   */
  private _extractFilePaths(text: string): string[] {
    const found = new Set<string>();
    const patterns: RegExp[] = [
      /\bsrc\/[\w/\-.]+\.\w+\b/g,
      /\btests\/[\w/\-.]+\.\w+\b/g,
      /\bdocs\/[\w/\-.]+\.\w+\b/g,
      /\bscripts\/[\w/\-.]+\.\w+\b/g,
      /\.\/[\w/\-.]+\.\w+/g,
      /\/(?:Users|home|var|tmp|opt|etc)\/[\w/\-.]+\.\w+/g,
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        found.add(match[0]);
      }
    }
    return Array.from(found).sort();
  }

  /**
   * Extract function/method names (identifier immediately followed by `()`).
   * Excludes very short or all-uppercase tokens (likely control-flow keywords).
   */
  private _extractFunctionNames(text: string): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(/\b([a-z_][a-zA-Z0-9_]{2,})\(\)/g)) {
      found.add(`${match[1]}()`);
    }
    return Array.from(found).sort();
  }

  /**
   * Extract OpenBridge task IDs of the form `OB-NNNN` (digits only, not finding IDs).
   */
  private _extractTaskIds(text: string): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(/\bOB-(\d{4,})\b/g)) {
      found.add(`OB-${match[1]}`);
    }
    return Array.from(found).sort();
  }

  /**
   * Extract OpenBridge finding IDs of the form `OB-FNNNN`.
   */
  private _extractFindingIds(text: string): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(/\bOB-F(\d+)\b/g)) {
      found.add(`OB-F${match[1]}`);
    }
    return Array.from(found).sort();
  }

  /**
   * Extract completed work items from explicit completion markers in text.
   * Markers: `✅ ...`, `[x] ...`, `done: ...`, `completed: ...`, `fixed: ...`
   */
  private _extractCompletedWork(text: string): string[] {
    const found: string[] = [];
    const markers: RegExp[] = [
      /✅\s+(.+)/g,
      /\[x\]\s+(.+)/gi,
      /\bdone:\s*(.+)/gi,
      /\bcompleted:\s*(.+)/gi,
      /\bfixed:\s*(.+)/gi,
    ];
    for (const pattern of markers) {
      for (const match of text.matchAll(pattern)) {
        const item = match[1]?.trim().slice(0, 120) ?? '';
        if (item) found.push(item);
      }
    }
    return [...new Set(found)];
  }

  /**
   * Extract pending/in-progress work items from explicit markers in text.
   * Markers: `TODO: ...`, `NEXT: ...`, `pending: ...`, `[ ] ...`, `needs: ...`
   */
  private _extractPendingWork(text: string): string[] {
    const found: string[] = [];
    const markers: RegExp[] = [
      /\bTODO:\s*(.+)/gi,
      /\bNEXT:\s*(.+)/gi,
      /\bpending:\s*(.+)/gi,
      /\[ \]\s+(.+)/g,
      /\bneeds:\s*(.+)/gi,
    ];
    for (const pattern of markers) {
      for (const match of text.matchAll(pattern)) {
        const item = match[1]?.trim().slice(0, 120) ?? '';
        if (item) found.push(item);
      }
    }
    return [...new Set(found)];
  }
}
