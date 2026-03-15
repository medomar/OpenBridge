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

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
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
 * Identifiers extracted from a block of text by `extractIdentifiers()`.
 *
 * Used by `compactTurns()` internally and available as a standalone public
 * method so callers can extract identifiers from any text without running a
 * full compaction (e.g. for populating `compaction_history.identifiers_preserved`).
 */
export interface ExtractedIdentifiers {
  /** Deduplicated file paths found in the text (e.g. `src/master/session-compactor.ts`). */
  filePaths: string[];
  /** Function/method names found in the text, with trailing `()`. */
  functionNames: string[];
  /** OpenBridge task IDs found in the text (e.g. `OB-1669`). */
  taskIds: string[];
  /** OpenBridge finding IDs found in the text (e.g. `OB-F84`). */
  findingIds: string[];
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
  /**
   * Maximum prompt character limit used for prompt-size-based compaction.
   * Default: `800_000` for Opus 4.6 / Sonnet 4.6 (1M token context window, ~3.4M chars total).
   *          `32_768` for Haiku 4.5 and all other/unrecognized models (conservative fallback).
   * Explicit values override the model-aware default.
   */
  promptSizeLimit?: number;
  /**
   * Fraction of promptSizeLimit at which prompt-size compaction is triggered.
   * Default: 0.8 (fires when assembled prompt exceeds 80% of the model-aware limit —
   * e.g. 640K chars for Opus 4.6 / Sonnet 4.6, or 26K chars for Haiku 4.5 / others).
   */
  promptSizeThreshold?: number;
  /**
   * Optional model ID used to derive model-aware prompt size defaults.
   * When set to `claude-opus-4-6` or `claude-sonnet-4-6` (Opus 4.6 / Sonnet 4.6),
   * the default `promptSizeLimit` is raised to `800_000` to match their 1M token
   * context windows. All other models keep the conservative `32_768` default.
   */
  modelId?: string;
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
  /**
   * Primary reason compaction is needed.
   * - `'turn-count'` — turn-count threshold exceeded.
   * - `'prompt-size'` — assembled prompt exceeded 80% of the size limit.
   * - `undefined` — compaction not needed.
   */
  compactionReason?: 'turn-count' | 'prompt-size';
  /** The configured maxTurns value used for this snapshot. */
  maxTurns: number;
  /** The fraction threshold in use (e.g. 0.8). */
  threshold: number;
  /** The absolute turn count at which compaction fires (Math.floor(maxTurns × threshold)). */
  thresholdTurns: number;
  /** Most-recently reported assembled prompt size in chars (0 if not yet reported). */
  lastPromptChars: number;
  /** Whether the last reported prompt size exceeded the configured size threshold. */
  promptSizeExceeded: boolean;
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
  private readonly promptSizeLimit: number;
  private readonly promptSizeThreshold: number;

  /**
   * Track the totalTurns value at which we last triggered compaction.
   * Prevents re-triggering on every subsequent message once the cumulative
   * count exceeds the threshold (since message_count never resets).
   * Next compaction fires when totalTurns >= lastCompactedAtTurns + thresholdTurns.
   */
  private lastCompactedAtTurns = 0;

  /**
   * Set to true by `notifyPromptSize()` when the assembled prompt exceeds
   * the configured prompt-size threshold. Reset after successful compaction.
   */
  private _promptSizeExceeded = false;

  /** Most-recently reported assembled prompt size in chars. */
  private _lastPromptChars = 0;

  constructor(config: CompactorConfig) {
    this.maxTurns = config.maxTurns;
    this.threshold = config.threshold ?? 0.8;
    this.maxRetries = config.maxRetries ?? 2;
    // Model-aware default: Opus 4.6 / Sonnet 4.6 get 800_000 (matching their 1M token context
    // window); all other models keep the conservative 32_768 fallback.
    const modelId = config.modelId;
    const isLargeContextModel =
      modelId != null &&
      (/opus.*4[.-]6/i.test(modelId) ||
        modelId === 'claude-opus-4-6' ||
        /sonnet.*4[.-]6/i.test(modelId) ||
        modelId === 'claude-sonnet-4-6');
    const defaultPromptSizeLimit = isLargeContextModel ? 800_000 : 32_768;
    this.promptSizeLimit = config.promptSizeLimit ?? defaultPromptSizeLimit;
    this.promptSizeThreshold = config.promptSizeThreshold ?? 0.8;
  }

  /**
   * Notify the compactor of the most-recently assembled prompt size.
   *
   * Called by `PromptContextBuilder.buildMasterSpawnOptions()` after each
   * prompt assembly. When `chars` exceeds `promptSizeLimit × promptSizeThreshold`
   * (default: 80% of 32 768), the internal `_promptSizeExceeded` flag is raised
   * and the next `triggerIfNeeded()` call will fire early compaction regardless
   * of the current turn count.
   *
   * @param chars - Length of the assembled system prompt in characters.
   */
  notifyPromptSize(chars: number): void {
    this._lastPromptChars = chars;
    const warnAt = Math.floor(this.promptSizeLimit * this.promptSizeThreshold);
    const exceeded = chars >= warnAt;
    if (exceeded && !this._promptSizeExceeded) {
      logger.warn(
        {
          chars,
          warnAt,
          promptSizeLimit: this.promptSizeLimit,
          promptSizeThreshold: this.promptSizeThreshold,
        },
        'SessionCompactor: prompt size exceeded %d%% threshold (%d/%d chars) — early compaction queued',
        Math.round(this.promptSizeThreshold * 100),
        chars,
        this.promptSizeLimit,
      );
    }
    this._promptSizeExceeded = exceeded;
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
    // Compare turns accumulated *since last compaction*, not the absolute total.
    // This prevents compaction from re-triggering on every message once the
    // cumulative count first exceeds the threshold.
    const turnsSinceLastCompaction = totalTurns - this.lastCompactedAtTurns;
    const turnCountExceeded = turnsSinceLastCompaction >= this.thresholdTurns;
    const needsCompaction = turnCountExceeded || this._promptSizeExceeded;
    const compactionReason: TurnSnapshot['compactionReason'] = needsCompaction
      ? turnCountExceeded
        ? 'turn-count'
        : 'prompt-size'
      : undefined;

    logger.debug(
      {
        sessionId,
        messageCount,
        workerSpawnCount,
        totalTurns,
        turnsSinceLastCompaction,
        lastCompactedAtTurns: this.lastCompactedAtTurns,
        thresholdTurns: this.thresholdTurns,
        promptSizeExceeded: this._promptSizeExceeded,
        lastPromptChars: this._lastPromptChars,
        needsCompaction,
        compactionReason,
      },
      'SessionCompactor: turn snapshot',
    );

    return {
      sessionId,
      messageCount,
      workerSpawnCount,
      totalTurns,
      needsCompaction,
      compactionReason,
      maxTurns: this.maxTurns,
      threshold: this.threshold,
      thresholdTurns: this.thresholdTurns,
      lastPromptChars: this._lastPromptChars,
      promptSizeExceeded: this._promptSizeExceeded,
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
        compactionReason: snapshot.compactionReason,
        lastPromptChars: snapshot.lastPromptChars,
        promptSizeExceeded: snapshot.promptSizeExceeded,
      },
      'SessionCompactor: threshold exceeded — triggering compaction (reason: %s)',
      snapshot.compactionReason ?? 'unknown',
    );

    if (handler) {
      let lastError: unknown;
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          await handler(snapshot);
          lastError = undefined;
          break;
        } catch (err) {
          lastError = err;
          logger.warn(
            { err, sessionId, attempt, maxRetries: this.maxRetries },
            'SessionCompactor: compaction handler failed — will retry if attempts remain',
          );
        }
      }
      if (lastError !== undefined) {
        logger.warn(
          { err: lastError, sessionId, maxRetries: this.maxRetries },
          'SessionCompactor: compaction failed after all retries — continuing session without compaction',
        );
      } else {
        // Record the turn count at which compaction succeeded so we don't
        // re-trigger on every subsequent message.
        this.lastCompactedAtTurns = snapshot.totalTurns;
        // Reset prompt-size flag — it was the trigger and has now been handled.
        this._promptSizeExceeded = false;
        logger.info(
          { sessionId, lastCompactedAtTurns: this.lastCompactedAtTurns },
          'SessionCompactor: recorded compaction point — next compaction after %d more turns',
          this.thresholdTurns,
        );
      }
    } else {
      // No handler but compaction was triggered — still record the point
      this.lastCompactedAtTurns = snapshot.totalTurns;
      this._promptSizeExceeded = false;
    }

    return { triggered: true, snapshot };
  }

  // ---------------------------------------------------------------------------
  // Identifier Extraction (OB-1669)
  // ---------------------------------------------------------------------------

  /**
   * Extract key identifiers from any block of text using regex patterns.
   *
   * Scans for:
   * - File paths: `src/...`, `tests/...`, `docs/...`, `scripts/...`, `./...`,
   *   and common absolute paths (`/Users/...`, `/home/...`, etc.)
   * - Function/method names: any camelCase/snake_case token followed by `()`
   * - OpenBridge task IDs: `OB-NNNN` (four or more digits)
   * - OpenBridge finding IDs: `OB-FNNNN`
   *
   * All results are deduplicated and sorted. This method is the canonical
   * extraction implementation — `compactTurns()` delegates to it internally.
   *
   * @param text - Raw text to scan (may be concatenated conversation content).
   */
  extractIdentifiers(text: string): ExtractedIdentifiers {
    return {
      filePaths: this._extractFilePaths(text),
      functionNames: this._extractFunctionNames(text),
      taskIds: this._extractTaskIds(text),
      findingIds: this._extractFindingIds(text),
    };
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
    const ids = this.extractIdentifiers(allContent);

    return {
      overview: this._buildOverview(turns),
      filePaths: ids.filePaths,
      functionNames: ids.functionNames,
      taskIds: ids.taskIds,
      findingIds: ids.findingIds,
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

  // ---------------------------------------------------------------------------
  // Memory Write (OB-1670)
  // ---------------------------------------------------------------------------

  /**
   * Format a {@link CompactionSummary} as a Markdown section suitable for
   * inclusion in `memory.md`.
   *
   * The resulting block is a `## Session Compaction` entry that captures:
   * - timestamp + turn count
   * - brief overview
   * - files referenced, task IDs, finding IDs
   * - completed and pending work items
   *
   * @param summary - The compaction summary to format.
   */
  formatSummaryAsMarkdown(summary: CompactionSummary): string {
    const lines: string[] = [
      `## Session Compaction — ${summary.compactedAt}`,
      '',
      `**Overview:** ${summary.overview}`,
      `**Turns summarized:** ${summary.turnCount}`,
    ];

    if (summary.filePaths.length > 0) {
      lines.push('', `**Files referenced:** ${summary.filePaths.join(', ')}`);
    }

    if (summary.taskIds.length > 0) {
      lines.push(`**Tasks:** ${summary.taskIds.join(', ')}`);
    }

    if (summary.findingIds.length > 0) {
      lines.push(`**Findings:** ${summary.findingIds.join(', ')}`);
    }

    if (summary.completedWork.length > 0) {
      lines.push('', '**Completed:**');
      for (const item of summary.completedWork.slice(0, 10)) {
        lines.push(`- ${item}`);
      }
    }

    if (summary.pendingWork.length > 0) {
      lines.push('', '**Pending:**');
      for (const item of summary.pendingWork.slice(0, 10)) {
        lines.push(`- ${item}`);
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * Write a {@link CompactionSummary} to `memory.md` at the given file path,
   * ensuring cross-session continuity before starting a new session segment.
   *
   * Behaviour:
   * - Reads existing `memory.md` if present (creates it if missing).
   * - Finds or creates a `<!-- compaction-history -->` block at the top of the
   *   file, immediately after the first `# Memory` heading (or at the very top
   *   if no heading exists).
   * - Prepends the new compaction entry inside that block so the most-recent
   *   entry appears first.
   * - Trims the oldest compaction entries when the total file would exceed 200
   *   lines, keeping the rest of the file intact.
   * - Writes the result back to disk.
   *
   * @param summary          - The compaction summary to persist.
   * @param memoryFilePath   - Absolute path to `memory.md`.
   */
  async writeCompactionSummaryToMemory(
    summary: CompactionSummary,
    memoryFilePath: string,
  ): Promise<void> {
    const MAX_LINES = 200;
    const BLOCK_START = '<!-- compaction-history -->';
    const BLOCK_END = '<!-- /compaction-history -->';

    // Read existing content (tolerate missing file).
    let existing = '';
    try {
      existing = await fs.readFile(memoryFilePath, 'utf-8');
    } catch {
      // File does not exist yet — start with an empty string.
    }

    const newEntry = this.formatSummaryAsMarkdown(summary);

    let updated: string;

    if (existing.includes(BLOCK_START) && existing.includes(BLOCK_END)) {
      // Inject new entry immediately after the opening marker.
      updated = existing.replace(BLOCK_START, `${BLOCK_START}\n${newEntry}`);
    } else {
      // Insert a new block after the first `# ` heading, or at the top.
      const headingMatch = /^# .+$/m.exec(existing);
      if (headingMatch) {
        const insertPos = headingMatch.index + headingMatch[0].length;
        updated =
          `${existing.slice(0, insertPos)}\n\n${BLOCK_START}\n${newEntry}${BLOCK_END}\n` +
          existing.slice(insertPos);
      } else {
        updated = `${BLOCK_START}\n${newEntry}${BLOCK_END}\n\n${existing}`;
      }
    }

    // Enforce 200-line limit by trimming oldest compaction entries.
    let lines = updated.split('\n');
    while (lines.length > MAX_LINES) {
      // Find the last compaction entry boundary inside the block and remove it.
      const blockStartIdx = lines.findIndex((l) => l.trim() === BLOCK_START);
      const blockEndIdx = lines.findIndex((l) => l.trim() === BLOCK_END);

      if (blockStartIdx === -1 || blockEndIdx === -1 || blockEndIdx <= blockStartIdx) {
        // No managed block found — just hard-truncate.
        lines = lines.slice(0, MAX_LINES);
        break;
      }

      // Find the second `## Session Compaction` header inside the block —
      // that marks the start of the oldest entry we can trim.
      const blockLines = lines.slice(blockStartIdx + 1, blockEndIdx);
      const compactionHeaders = blockLines.reduce<number[]>((acc, l, i) => {
        if (/^## Session Compaction/.test(l)) acc.push(i);
        return acc;
      }, []);

      if (compactionHeaders.length <= 1) {
        // Only one entry in the block — hard-truncate instead of removing it.
        lines = lines.slice(0, MAX_LINES);
        break;
      }

      // Remove the last (oldest) compaction entry from inside the block.
      // compactionHeaders[] indices are relative to blockLines (blockStartIdx+1).
      // The LAST entry in the array is the oldest (at the bottom of the block).
      const oldestRelIdx = compactionHeaders[compactionHeaders.length - 1] ?? 0;
      const oldestStart = blockStartIdx + 1 + oldestRelIdx;
      // The oldest entry extends from oldestStart to blockEndIdx (end of block).
      const removeCount = blockEndIdx - oldestStart;

      if (removeCount <= 0) {
        // Safety: cannot trim further — hard-truncate to prevent infinite loop.
        lines = lines.slice(0, MAX_LINES);
        break;
      }

      lines.splice(oldestStart, removeCount);
    }

    const finalContent = lines.join('\n');

    await fs.mkdir(path.dirname(memoryFilePath), { recursive: true });
    await fs.writeFile(memoryFilePath, finalContent, 'utf-8');

    logger.info(
      { memoryFilePath, turnCount: summary.turnCount, lines: lines.length },
      'SessionCompactor: wrote compaction summary to memory.md',
    );
  }
}
