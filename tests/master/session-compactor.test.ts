import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SessionCompactor,
  type ConversationTurn,
  type CompactionSummary,
  type TurnSnapshot,
} from '../../src/master/session-compactor.js';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock DB that returns the given message and worker counts.
 *
 * The first `prepare().get()` call returns the sessions row (messageCount),
 * the second returns the agent_activity count row (workerCount).
 */
function makeMockDb(messageCount: number, workerCount: number): Database.Database {
  const mockGet = vi
    .fn()
    .mockReturnValueOnce({ message_count: messageCount })
    .mockReturnValueOnce({ count: workerCount });

  return {
    prepare: vi.fn().mockReturnValue({ get: mockGet }),
  } as unknown as Database.Database;
}

/** Build a DB mock that throws on every prepare() call. */
function makeErrorDb(): Database.Database {
  return {
    prepare: vi.fn().mockImplementation(() => {
      throw new Error('DB error');
    }),
  } as unknown as Database.Database;
}

// ---------------------------------------------------------------------------
// snapshotTurns
// ---------------------------------------------------------------------------

describe('SessionCompactor.snapshotTurns', () => {
  it('reads messageCount and workerSpawnCount from DB', () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const db = makeMockDb(20, 5);
    const snap = compactor.snapshotTurns(db, 'sess-1');

    expect(snap.messageCount).toBe(20);
    expect(snap.workerSpawnCount).toBe(5);
    expect(snap.totalTurns).toBe(25);
  });

  it('returns needsCompaction=false when totalTurns < thresholdTurns', () => {
    // threshold = 0.8 * 100 = 80
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const db = makeMockDb(40, 10); // totalTurns = 50 < 80
    const snap = compactor.snapshotTurns(db, 'sess-1');

    expect(snap.needsCompaction).toBe(false);
    expect(snap.thresholdTurns).toBe(80);
  });

  it('returns needsCompaction=true when totalTurns === thresholdTurns', () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const db = makeMockDb(50, 30); // totalTurns = 80 === 80
    const snap = compactor.snapshotTurns(db, 'sess-1');

    expect(snap.needsCompaction).toBe(true);
  });

  it('returns needsCompaction=true when totalTurns > thresholdTurns', () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const db = makeMockDb(60, 40); // totalTurns = 100 > 80
    const snap = compactor.snapshotTurns(db, 'sess-1');

    expect(snap.needsCompaction).toBe(true);
  });

  it('respects custom threshold', () => {
    // threshold = 0.5 * 50 = 25
    const compactor = new SessionCompactor({ maxTurns: 50, threshold: 0.5 });
    const db = makeMockDb(20, 6); // totalTurns = 26 >= 25
    const snap = compactor.snapshotTurns(db, 'sess-1');

    expect(snap.thresholdTurns).toBe(25);
    expect(snap.needsCompaction).toBe(true);
  });

  it('uses default threshold of 0.8 when not specified', () => {
    const compactor = new SessionCompactor({ maxTurns: 50 });
    expect(compactor.thresholdTurns).toBe(40); // Math.floor(50 * 0.8)
  });

  it('computes thresholdTurns via Math.floor', () => {
    const compactor = new SessionCompactor({ maxTurns: 30, threshold: 0.8 });
    expect(compactor.thresholdTurns).toBe(24); // Math.floor(30 * 0.8)
  });

  it('falls back to 0 for both counts when DB throws', () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const snap = compactor.snapshotTurns(makeErrorDb(), 'sess-err');

    expect(snap.messageCount).toBe(0);
    expect(snap.workerSpawnCount).toBe(0);
    expect(snap.totalTurns).toBe(0);
    expect(snap.needsCompaction).toBe(false);
  });

  it('includes maxTurns, threshold, and thresholdTurns in snapshot', () => {
    const compactor = new SessionCompactor({ maxTurns: 100, threshold: 0.75 });
    const db = makeMockDb(0, 0);
    const snap = compactor.snapshotTurns(db, 'sess-1');

    expect(snap.maxTurns).toBe(100);
    expect(snap.threshold).toBe(0.75);
    expect(snap.thresholdTurns).toBe(75);
  });

  it('sets sessionId and capturedAt on snapshot', () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const db = makeMockDb(0, 0);
    const snap = compactor.snapshotTurns(db, 'my-session-id');

    expect(snap.sessionId).toBe('my-session-id');
    expect(snap.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// shouldCompact
// ---------------------------------------------------------------------------

describe('SessionCompactor.shouldCompact', () => {
  it('returns false when below threshold', () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    expect(compactor.shouldCompact(makeMockDb(10, 5), 'sess-1')).toBe(false);
  });

  it('returns true when at threshold', () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    expect(compactor.shouldCompact(makeMockDb(50, 30), 'sess-1')).toBe(true); // 80 >= 80
  });

  it('returns true when above threshold', () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    expect(compactor.shouldCompact(makeMockDb(90, 10), 'sess-1')).toBe(true); // 100 >= 80
  });
});

// ---------------------------------------------------------------------------
// triggerIfNeeded — threshold gate
// ---------------------------------------------------------------------------

describe('SessionCompactor.triggerIfNeeded — threshold gate', () => {
  it('returns triggered=false with skippedReason when below threshold', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const result = await compactor.triggerIfNeeded(makeMockDb(10, 5), 'sess-1');

    expect(result.triggered).toBe(false);
    expect(result.skippedReason).toBe('below threshold');
  });

  it('returns triggered=true when threshold is exceeded', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const result = await compactor.triggerIfNeeded(makeMockDb(50, 30), 'sess-1');

    expect(result.triggered).toBe(true);
    expect(result.skippedReason).toBeUndefined();
  });

  it('returns triggered=true even without a handler', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const result = await compactor.triggerIfNeeded(makeMockDb(50, 30), 'sess-1');
    expect(result.triggered).toBe(true);
  });

  it('calls handler with the turn snapshot when triggered', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const handler = vi.fn().mockResolvedValue(undefined);

    await compactor.triggerIfNeeded(makeMockDb(50, 30), 'sess-1', handler);

    expect(handler).toHaveBeenCalledOnce();
    const snap = handler.mock.calls[0][0] as TurnSnapshot;
    expect(snap.sessionId).toBe('sess-1');
    expect(snap.needsCompaction).toBe(true);
  });

  it('does NOT call handler when below threshold', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const handler = vi.fn().mockResolvedValue(undefined);

    await compactor.triggerIfNeeded(makeMockDb(10, 5), 'sess-1', handler);

    expect(handler).not.toHaveBeenCalled();
  });

  it('snapshot in result contains correct turn data', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    const result = await compactor.triggerIfNeeded(makeMockDb(50, 30), 'sess-abc');

    expect(result.snapshot.sessionId).toBe('sess-abc');
    expect(result.snapshot.totalTurns).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// triggerIfNeeded — retry on failure (OB-1671)
// ---------------------------------------------------------------------------

describe('SessionCompactor.triggerIfNeeded — retry on failure', () => {
  it('retries handler up to maxRetries times on failure', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100, maxRetries: 2 });
    const handler = vi.fn().mockRejectedValue(new Error('handler failed'));

    await compactor.triggerIfNeeded(makeMockDb(50, 30), 'sess-1', handler);

    // Initial attempt + 2 retries = 3 total calls
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('uses default maxRetries of 2 when not specified', () => {
    const compactor = new SessionCompactor({ maxTurns: 100 });
    expect(compactor.maxRetries).toBe(2);
  });

  it('respects custom maxRetries setting', () => {
    const compactor = new SessionCompactor({ maxTurns: 100, maxRetries: 0 });
    expect(compactor.maxRetries).toBe(0);
  });

  it('only calls handler once when maxRetries=0 and it fails', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100, maxRetries: 0 });
    const handler = vi.fn().mockRejectedValue(new Error('fail'));

    await compactor.triggerIfNeeded(makeMockDb(50, 30), 'sess-1', handler);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('stops retrying as soon as handler succeeds', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100, maxRetries: 2 });
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('first fail'))
      .mockResolvedValue(undefined);

    await compactor.triggerIfNeeded(makeMockDb(50, 30), 'sess-1', handler);

    // First attempt fails, second succeeds — no third call
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('still returns triggered=true after all retries fail', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100, maxRetries: 2 });
    const handler = vi.fn().mockRejectedValue(new Error('always fails'));

    const result = await compactor.triggerIfNeeded(makeMockDb(50, 30), 'sess-1', handler);

    expect(result.triggered).toBe(true);
  });

  it('does not throw even when all retries are exhausted', async () => {
    const compactor = new SessionCompactor({ maxTurns: 100, maxRetries: 1 });
    const handler = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(
      compactor.triggerIfNeeded(makeMockDb(50, 30), 'sess-1', handler),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// extractIdentifiers (OB-1669)
// ---------------------------------------------------------------------------

describe('SessionCompactor.extractIdentifiers', () => {
  let compactor: SessionCompactor;

  beforeEach(() => {
    compactor = new SessionCompactor({ maxTurns: 100 });
  });

  it('returns empty arrays for empty text', () => {
    const result = compactor.extractIdentifiers('');
    expect(result.filePaths).toEqual([]);
    expect(result.functionNames).toEqual([]);
    expect(result.taskIds).toEqual([]);
    expect(result.findingIds).toEqual([]);
  });

  it('extracts src/ relative paths', () => {
    const text = 'Modified src/core/auth.ts and src/types/message.ts.';
    const { filePaths } = compactor.extractIdentifiers(text);
    expect(filePaths).toContain('src/core/auth.ts');
    expect(filePaths).toContain('src/types/message.ts');
  });

  it('extracts tests/ relative paths', () => {
    const text = 'Tests live in tests/core/auth.test.ts.';
    const { filePaths } = compactor.extractIdentifiers(text);
    expect(filePaths).toContain('tests/core/auth.test.ts');
  });

  it('extracts docs/ relative paths', () => {
    const text = 'See docs/audit/TASKS.md for details.';
    const { filePaths } = compactor.extractIdentifiers(text);
    expect(filePaths).toContain('docs/audit/TASKS.md');
  });

  it('extracts scripts/ relative paths', () => {
    const text = 'Run scripts/run-tasks.sh to start.';
    const { filePaths } = compactor.extractIdentifiers(text);
    expect(filePaths).toContain('scripts/run-tasks.sh');
  });

  it('extracts ./ relative paths', () => {
    const text = 'Loaded ./config/settings.json from disk.';
    const { filePaths } = compactor.extractIdentifiers(text);
    expect(filePaths).toContain('./config/settings.json');
  });

  it('extracts absolute /Users paths', () => {
    const text = 'File at /Users/dev/project/src/index.ts was opened.';
    const { filePaths } = compactor.extractIdentifiers(text);
    expect(filePaths).toContain('/Users/dev/project/src/index.ts');
  });

  it('deduplicates repeated file paths', () => {
    const text = 'src/core/auth.ts was read. Then src/core/auth.ts was edited.';
    const { filePaths } = compactor.extractIdentifiers(text);
    expect(filePaths.filter((p) => p === 'src/core/auth.ts').length).toBe(1);
  });

  it('returns file paths sorted alphabetically', () => {
    const text = 'src/z-last.ts src/a-first.ts src/m-middle.ts';
    const { filePaths } = compactor.extractIdentifiers(text);
    expect(filePaths).toEqual([...filePaths].sort());
  });

  it('extracts camelCase function names followed by ()', () => {
    const text = 'Called snapshotTurns() and triggerIfNeeded() on the compactor.';
    const { functionNames } = compactor.extractIdentifiers(text);
    expect(functionNames).toContain('snapshotTurns()');
    expect(functionNames).toContain('triggerIfNeeded()');
  });

  it('extracts snake_case function names followed by ()', () => {
    const text = 'Invoked extract_identifiers() helper.';
    const { functionNames } = compactor.extractIdentifiers(text);
    expect(functionNames).toContain('extract_identifiers()');
  });

  it('does not extract very short function names (< 3 chars)', () => {
    const text = 'Called id() and ok() helpers.';
    const { functionNames } = compactor.extractIdentifiers(text);
    expect(functionNames).not.toContain('id()');
    expect(functionNames).not.toContain('ok()');
  });

  it('deduplicates repeated function names', () => {
    const text = 'compactTurns() was called. Then compactTurns() ran again.';
    const { functionNames } = compactor.extractIdentifiers(text);
    expect(functionNames.filter((n) => n === 'compactTurns()').length).toBe(1);
  });

  it('extracts OB-NNNN task IDs', () => {
    const text = 'Resolves OB-1669 and OB-1682.';
    const { taskIds } = compactor.extractIdentifiers(text);
    expect(taskIds).toContain('OB-1669');
    expect(taskIds).toContain('OB-1682');
  });

  it('does NOT extract OB-FNNNN finding IDs as task IDs', () => {
    const text = 'Finding OB-F84 tracked separately.';
    const { taskIds } = compactor.extractIdentifiers(text);
    expect(taskIds).not.toContain('OB-F84');
  });

  it('requires at least 4 digits for task IDs', () => {
    const text = 'OB-12 is too short to be a task ID.';
    const { taskIds } = compactor.extractIdentifiers(text);
    expect(taskIds).not.toContain('OB-12');
  });

  it('extracts OB-FNNNN finding IDs', () => {
    const text = 'Related to findings OB-F84 and OB-F80.';
    const { findingIds } = compactor.extractIdentifiers(text);
    expect(findingIds).toContain('OB-F84');
    expect(findingIds).toContain('OB-F80');
  });

  it('deduplicates repeated finding IDs', () => {
    const text = 'OB-F84 is critical. OB-F84 needs to be fixed.';
    const { findingIds } = compactor.extractIdentifiers(text);
    expect(findingIds.filter((f) => f === 'OB-F84').length).toBe(1);
  });

  it('returns all arrays sorted alphabetically', () => {
    const text = 'OB-F88 OB-F80 OB-1682 OB-1618 src/z.ts src/a.ts';
    const result = compactor.extractIdentifiers(text);
    expect(result.taskIds).toEqual([...result.taskIds].sort());
    expect(result.findingIds).toEqual([...result.findingIds].sort());
    expect(result.filePaths).toEqual([...result.filePaths].sort());
  });
});

// ---------------------------------------------------------------------------
// compactTurns (OB-1668)
// ---------------------------------------------------------------------------

describe('SessionCompactor.compactTurns', () => {
  let compactor: SessionCompactor;

  beforeEach(() => {
    compactor = new SessionCompactor({ maxTurns: 100 });
  });

  it('returns empty summary for empty turns array', () => {
    const summary = compactor.compactTurns([]);
    expect(summary.turnCount).toBe(0);
    expect(summary.overview).toBe('No turns to compact.');
    expect(summary.filePaths).toEqual([]);
    expect(summary.functionNames).toEqual([]);
    expect(summary.taskIds).toEqual([]);
    expect(summary.findingIds).toEqual([]);
    expect(summary.completedWork).toEqual([]);
    expect(summary.pendingWork).toEqual([]);
  });

  it('sets turnCount to the number of turns provided', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'Fix the bug in OB-1669.' },
      { role: 'assistant', content: 'Fixed src/master/session-compactor.ts.' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.turnCount).toBe(2);
  });

  it('sets compactedAt to an ISO timestamp', () => {
    const summary = compactor.compactTurns([{ role: 'user', content: 'hello' }]);
    expect(summary.compactedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('builds overview from first user turn and last assistant turn', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'Implement the compaction strategy' },
      { role: 'assistant', content: 'I have implemented it successfully' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.overview).toContain('Implement the compaction strategy');
    expect(summary.overview).toContain('I have implemented it successfully');
    expect(summary.overview).toContain('2 turns');
  });

  it('overview includes only user preview when no assistant turn', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'A user message with no assistant reply' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.overview).toContain('A user message');
    expect(summary.overview).not.toContain('Last response');
  });

  it('overview falls back gracefully when only system turns exist', () => {
    const turns: ConversationTurn[] = [{ role: 'system', content: 'You are a helpful assistant.' }];
    const summary = compactor.compactTurns(turns);
    expect(typeof summary.overview).toBe('string');
    expect(summary.overview.length).toBeGreaterThan(0);
  });

  it('extracts file paths from turn content', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'Edit src/core/auth.ts' },
      { role: 'assistant', content: 'Done — updated src/core/auth.ts' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.filePaths).toContain('src/core/auth.ts');
  });

  it('extracts task IDs from turn content', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'Work on OB-1682 and OB-1668.' },
      { role: 'assistant', content: 'Completed OB-1668.' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.taskIds).toContain('OB-1682');
    expect(summary.taskIds).toContain('OB-1668');
  });

  it('extracts finding IDs from turn content', () => {
    const turns: ConversationTurn[] = [
      { role: 'user', content: 'Fix OB-F84.' },
      { role: 'assistant', content: 'OB-F84 resolved.' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.findingIds).toContain('OB-F84');
  });

  it('extracts completedWork from ✅ marker', () => {
    const turns: ConversationTurn[] = [
      { role: 'assistant', content: '✅ Implemented session compaction\n✅ Added retry logic' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.completedWork).toContain('Implemented session compaction');
    expect(summary.completedWork).toContain('Added retry logic');
  });

  it('extracts completedWork from [x] marker', () => {
    const turns: ConversationTurn[] = [
      { role: 'assistant', content: '[x] Added migration for compaction_history' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.completedWork).toContain('Added migration for compaction_history');
  });

  it('extracts completedWork from done:/completed:/fixed: markers', () => {
    const turns: ConversationTurn[] = [
      { role: 'assistant', content: 'done: schema updated\ncompleted: tests pass\nfixed: the bug' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.completedWork).toContain('schema updated');
    expect(summary.completedWork).toContain('tests pass');
    expect(summary.completedWork).toContain('the bug');
  });

  it('extracts pendingWork from TODO: marker', () => {
    const turns: ConversationTurn[] = [
      { role: 'assistant', content: 'TODO: add vector search integration' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.pendingWork).toContain('add vector search integration');
  });

  it('extracts pendingWork from NEXT: marker', () => {
    const turns: ConversationTurn[] = [
      { role: 'assistant', content: 'NEXT: wire compactor into master-manager' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.pendingWork).toContain('wire compactor into master-manager');
  });

  it('extracts pendingWork from [ ] checkbox', () => {
    const turns: ConversationTurn[] = [
      { role: 'assistant', content: '[ ] Run lint before committing' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.pendingWork).toContain('Run lint before committing');
  });

  it('extracts pendingWork from pending:/needs: markers', () => {
    const turns: ConversationTurn[] = [
      {
        role: 'assistant',
        content: 'pending: more tests needed\nneeds: documentation update',
      },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.pendingWork).toContain('more tests needed');
    expect(summary.pendingWork).toContain('documentation update');
  });

  it('deduplicates completedWork and pendingWork entries', () => {
    const turns: ConversationTurn[] = [
      { role: 'assistant', content: '✅ Tests pass\n✅ Tests pass' },
    ];
    const summary = compactor.compactTurns(turns);
    expect(summary.completedWork.filter((w) => w === 'Tests pass').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// formatSummaryAsMarkdown (OB-1670)
// ---------------------------------------------------------------------------

describe('SessionCompactor.formatSummaryAsMarkdown', () => {
  let compactor: SessionCompactor;

  beforeEach(() => {
    compactor = new SessionCompactor({ maxTurns: 100 });
  });

  const makeSummary = (overrides?: Partial<CompactionSummary>): CompactionSummary => ({
    overview: 'Compacted 5 turns.',
    filePaths: ['src/core/auth.ts'],
    functionNames: ['snapshotTurns()'],
    taskIds: ['OB-1682'],
    findingIds: ['OB-F84'],
    completedWork: ['Session compaction wired'],
    pendingWork: ['Add vector search'],
    turnCount: 5,
    compactedAt: '2026-03-06T00:00:00.000Z',
    ...overrides,
  });

  it('starts with ## Session Compaction —', () => {
    const md = compactor.formatSummaryAsMarkdown(makeSummary());
    expect(md).toMatch(/^## Session Compaction —/);
  });

  it('includes overview and turn count', () => {
    const md = compactor.formatSummaryAsMarkdown(makeSummary());
    expect(md).toContain('Compacted 5 turns.');
    expect(md).toContain('5');
  });

  it('includes file paths section when non-empty', () => {
    const md = compactor.formatSummaryAsMarkdown(makeSummary());
    expect(md).toContain('src/core/auth.ts');
  });

  it('skips file paths section when empty', () => {
    const md = compactor.formatSummaryAsMarkdown(makeSummary({ filePaths: [] }));
    expect(md).not.toContain('Files referenced');
  });

  it('includes task IDs when non-empty', () => {
    const md = compactor.formatSummaryAsMarkdown(makeSummary());
    expect(md).toContain('OB-1682');
  });

  it('skips tasks section when empty', () => {
    const md = compactor.formatSummaryAsMarkdown(makeSummary({ taskIds: [] }));
    expect(md).not.toContain('**Tasks:**');
  });

  it('includes finding IDs when non-empty', () => {
    const md = compactor.formatSummaryAsMarkdown(makeSummary());
    expect(md).toContain('OB-F84');
  });

  it('includes completed work section when non-empty', () => {
    const md = compactor.formatSummaryAsMarkdown(makeSummary());
    expect(md).toContain('Session compaction wired');
  });

  it('includes pending work section when non-empty', () => {
    const md = compactor.formatSummaryAsMarkdown(makeSummary());
    expect(md).toContain('Add vector search');
  });

  it('ends with a newline', () => {
    const md = compactor.formatSummaryAsMarkdown(makeSummary());
    expect(md.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// writeCompactionSummaryToMemory (OB-1670)
// ---------------------------------------------------------------------------

describe('SessionCompactor.writeCompactionSummaryToMemory', () => {
  let compactor: SessionCompactor;
  let tmpDir: string;

  const makeSummary = (): CompactionSummary => ({
    overview: 'Compacted 3 turns.',
    filePaths: ['src/master/session-compactor.ts'],
    functionNames: ['compactTurns()'],
    taskIds: ['OB-1670'],
    findingIds: [],
    completedWork: ['memory.md write logic'],
    pendingWork: [],
    turnCount: 3,
    compactedAt: '2026-03-06T00:00:00.000Z',
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ob-compactor-test-'));
    compactor = new SessionCompactor({ maxTurns: 100 });
  });

  it('creates memory.md if it does not exist', async () => {
    const memPath = path.join(tmpDir, 'memory.md');
    await compactor.writeCompactionSummaryToMemory(makeSummary(), memPath);

    const content = await fs.readFile(memPath, 'utf-8');
    expect(content).toContain('<!-- compaction-history -->');
    expect(content).toContain('<!-- /compaction-history -->');
    expect(content).toContain('Compacted 3 turns.');
  });

  it('inserts block after # heading when file exists with heading', async () => {
    const memPath = path.join(tmpDir, 'memory.md');
    await fs.writeFile(memPath, '# Memory\n\nSome notes here.\n', 'utf-8');

    await compactor.writeCompactionSummaryToMemory(makeSummary(), memPath);

    const content = await fs.readFile(memPath, 'utf-8');
    expect(content).toContain('# Memory');
    expect(content).toContain('<!-- compaction-history -->');
    expect(content).toContain('Compacted 3 turns.');
    expect(content).toContain('Some notes here.');
  });

  it('inserts block at top when file has no heading', async () => {
    const memPath = path.join(tmpDir, 'memory.md');
    await fs.writeFile(memPath, 'Existing content without a heading.\n', 'utf-8');

    await compactor.writeCompactionSummaryToMemory(makeSummary(), memPath);

    const content = await fs.readFile(memPath, 'utf-8');
    expect(content.startsWith('<!-- compaction-history -->')).toBe(true);
  });

  it('prepends new entry to existing compaction block', async () => {
    const memPath = path.join(tmpDir, 'memory.md');

    // Write first summary
    await compactor.writeCompactionSummaryToMemory(
      { ...makeSummary(), overview: 'First compaction.' },
      memPath,
    );
    // Write second summary
    await compactor.writeCompactionSummaryToMemory(
      { ...makeSummary(), overview: 'Second compaction.' },
      memPath,
    );

    const content = await fs.readFile(memPath, 'utf-8');
    const firstIdx = content.indexOf('First compaction.');
    const secondIdx = content.indexOf('Second compaction.');

    // Second (newer) entry should appear before first (older) entry
    expect(secondIdx).toBeLessThan(firstIdx);
  });

  it('creates parent directory if it does not exist', async () => {
    const memPath = path.join(tmpDir, 'nested', 'deep', 'memory.md');
    await compactor.writeCompactionSummaryToMemory(makeSummary(), memPath);

    const content = await fs.readFile(memPath, 'utf-8');
    expect(content).toContain('Compacted 3 turns.');
  });
});
