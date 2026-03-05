/**
 * Tests for BatchManager and BatchPlanner — OB-1625.
 *
 * Covers:
 * 1.  Batch detection from keywords (BatchPlanner.detectSourceType)
 * 2.  Plan extraction from TASKS.md (BatchPlanner.extractPendingTasks)
 * 3.  Continuation message injected (buildProgressMessage)
 * 4.  Progress messages sent after each item
 * 5.  Safety rails pause at iteration / budget / timeout limits
 * 6.  Pause / resume round-trip
 * 7.  Failure pauses batch (buildFailureMessage + pauseBatch)
 * 8.  Commit-after-each flag and commit prompt generation
 * 9.  Abort cleans state (abortBatch removes from memory + disk)
 * 10. Batch state survives restart (initialize() loads persisted state)
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, mkdir, rm } from 'node:fs/promises';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BatchManager } from '../../src/master/batch-manager.js';
import { BatchPlanner } from '../../src/master/batch-planner.js';
import type { BatchCompletedItem, BatchPlanItem, BatchState } from '../../src/types/agent.js';
import type { BatchConfig } from '../../src/types/config.js';

// ── Helpers ─────────────────────────────────────────────────────────

const DEFAULT_RAILS: Pick<
  BatchConfig,
  'maxBatchIterations' | 'batchBudgetUsd' | 'batchTimeoutMinutes'
> = {
  maxBatchIterations: 20,
  batchBudgetUsd: 5.0,
  batchTimeoutMinutes: 120,
};

const PLAN: BatchPlanItem[] = [
  { id: 'OB-1001', description: 'First task' },
  { id: 'OB-1002', description: 'Second task' },
  { id: 'OB-1003', description: 'Third task' },
];

/** Build a minimal completed item. */
function completed(id: string, summary = 'Done'): BatchCompletedItem {
  return { id, summary, status: 'completed' };
}

/** Create a mock DotFolderManager that stores batch state in memory. */
function makeMockDotFolder(initial?: BatchState) {
  let stored: BatchState | null = initial ?? null;
  return {
    readBatchState: vi.fn(async () => stored),
    writeBatchState: vi.fn(async (s: BatchState) => {
      stored = structuredClone(s);
    }),
    deleteBatchState: vi.fn(async () => {
      stored = null;
    }),
    // Expose for assertions
    _stored: () => stored,
  };
}

// ── 1. Batch detection from keywords ─────────────────────────────────

describe('BatchPlanner — detectSourceType', () => {
  const planner = new BatchPlanner();

  it('returns findings when message contains "finding"', () => {
    expect(planner.detectSourceType('Fix all findings')).toBe('findings');
  });

  it('returns findings when message contains "bug"', () => {
    expect(planner.detectSourceType('go through each bug')).toBe('findings');
  });

  it('returns findings when message contains "issue"', () => {
    expect(planner.detectSourceType('resolve all issues')).toBe('findings');
  });

  it('returns tasks-md by default (no keywords)', () => {
    expect(planner.detectSourceType('implement all tasks')).toBe('tasks-md');
  });

  it('returns tasks-md for generic batch trigger phrases', () => {
    expect(planner.detectSourceType('go through each one')).toBe('tasks-md');
  });
});

// ── 2. Plan extraction from TASKS.md ─────────────────────────────────

describe('BatchPlanner — extractPendingTasks', () => {
  let tmpDir: string;
  let tasksFile: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `ob-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    tasksFile = join(tmpDir, 'TASKS.md');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('extracts pending task rows from TASKS.md', async () => {
    const content = [
      '| 1 | OB-1001 | First task description here | ◻ Pending |',
      '| 2 | OB-1002 | Second task description     | ✅ Done   |',
      '| 3 | OB-1003 | Third task description      | ◻ Pending |',
    ].join('\n');

    await writeFile(tasksFile, content, 'utf8');

    const planner = new BatchPlanner();
    const items = await planner.extractPendingTasks(tasksFile);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 'OB-1001', description: 'First task description here' });
    expect(items[1]).toMatchObject({ id: 'OB-1003', description: 'Third task description' });
  });

  it('returns empty array when TASKS.md has no pending rows', async () => {
    await writeFile(tasksFile, '| 1 | OB-1001 | Done task | ✅ Done |\n', 'utf8');

    const planner = new BatchPlanner();
    const items = await planner.extractPendingTasks(tasksFile);

    expect(items).toHaveLength(0);
  });

  it('returns empty array when TASKS.md does not exist', async () => {
    const planner = new BatchPlanner();
    const items = await planner.extractPendingTasks(join(tmpDir, 'nonexistent.md'));
    expect(items).toHaveLength(0);
  });
});

// ── 3 & 4. Continuation / progress messages ──────────────────────────

describe('BatchManager — buildProgressMessage', () => {
  let manager: BatchManager;
  let batchId: string;

  beforeEach(async () => {
    manager = new BatchManager();
    batchId = await manager.createBatch('custom-list', PLAN);
  });

  it('returns null before any items are completed', () => {
    expect(manager.buildProgressMessage(batchId)).toBeNull();
  });

  it('returns null for an unknown batchId', () => {
    expect(manager.buildProgressMessage('unknown-id')).toBeNull();
  });

  it('returns a formatted progress message after advancing one item', async () => {
    await manager.advanceBatch(batchId, completed('OB-1001', 'Implemented feature'));

    const msg = manager.buildProgressMessage(batchId);
    expect(msg).not.toBeNull();
    expect(msg).toContain('OB-1001');
    expect(msg).toContain('Implemented feature');
    expect(msg).toContain('OB-1002'); // next item
    expect(msg).toMatch(/\d+\/\d+/); // progress fraction
  });

  it('includes ✅ icon for successful item and ❌ icon for failed item', async () => {
    await manager.advanceBatch(batchId, {
      id: 'OB-1001',
      summary: 'Errored',
      status: 'failed',
    });

    const msg = manager.buildProgressMessage(batchId);
    expect(msg).toContain('❌');
  });

  it('returns null after the last item is completed (batch finished)', async () => {
    for (const item of PLAN) {
      await manager.advanceBatch(batchId, completed(item.id));
    }
    // Batch is finished — no next item
    expect(manager.buildProgressMessage(batchId)).toBeNull();
  });
});

// ── 5. Safety rails pause at limit ───────────────────────────────────

describe('BatchManager — checkSafetyRails', () => {
  let manager: BatchManager;
  let batchId: string;

  beforeEach(async () => {
    manager = new BatchManager();
    batchId = await manager.createBatch('custom-list', [
      ...PLAN,
      { id: 'OB-1004', description: 'Fourth task' },
      { id: 'OB-1005', description: 'Fifth task' },
    ]);
  });

  it('passes when no limits are exceeded', async () => {
    const result = await manager.checkSafetyRails(batchId, DEFAULT_RAILS);
    expect(result.passed).toBe(true);
    expect(result.violation).toBeUndefined();
  });

  it('pauses and returns iteration violation when max iterations reached', async () => {
    // Complete 2 items so completedItems.length === 2
    await manager.advanceBatch(batchId, completed('OB-1001'));
    await manager.advanceBatch(batchId, completed('OB-1002'));

    const result = await manager.checkSafetyRails(batchId, {
      ...DEFAULT_RAILS,
      maxBatchIterations: 2, // set limit equal to completed count
    });

    expect(result.passed).toBe(false);
    expect(result.violation?.rail).toBe('iterations');
    expect(result.violation?.message).toContain('2');

    const status = manager.getStatus(batchId);
    expect(status?.paused).toBe(true);
  });

  it('pauses and returns budget violation when cost exceeds budget', async () => {
    await manager.advanceBatch(batchId, completed('OB-1001'), 3.0);

    const result = await manager.checkSafetyRails(batchId, {
      ...DEFAULT_RAILS,
      batchBudgetUsd: 2.0,
    });

    expect(result.passed).toBe(false);
    expect(result.violation?.rail).toBe('budget');
    expect(result.violation?.message).toContain('$');

    const status = manager.getStatus(batchId);
    expect(status?.paused).toBe(true);
  });

  it('pauses and returns timeout violation when elapsed time exceeds limit', async () => {
    // Backdate startedAt so the elapsed time is greater than the timeout
    const state = manager.getStatus(batchId)!;
    // Directly mutate via a new batch with an old startedAt
    const oldBatchId = await manager.createBatch('custom-list', PLAN);
    // Hack: access internal state via getCurrentBatchId + getStatus, then use faketime
    vi.useFakeTimers();
    const freshBatchId = await manager.createBatch('custom-list', PLAN);
    // Advance clock by 3 hours
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);

    const result = await manager.checkSafetyRails(freshBatchId, {
      ...DEFAULT_RAILS,
      batchTimeoutMinutes: 60,
    });

    vi.useRealTimers();

    expect(result.passed).toBe(false);
    expect(result.violation?.rail).toBe('timeout');
    void state; // suppress unused warning
    void oldBatchId;
  });

  it('passes (fail-open) for unknown batchId', async () => {
    const result = await manager.checkSafetyRails('unknown-batch', DEFAULT_RAILS);
    expect(result.passed).toBe(true);
  });
});

// ── 6. Pause / resume ────────────────────────────────────────────────

describe('BatchManager — pause / resume', () => {
  let manager: BatchManager;
  let batchId: string;

  beforeEach(async () => {
    manager = new BatchManager();
    batchId = await manager.createBatch('custom-list', PLAN);
  });

  it('isActive() returns true for a newly created batch', () => {
    expect(manager.isActive(batchId)).toBe(true);
  });

  it('pauseBatch() marks the batch as paused', async () => {
    const ok = await manager.pauseBatch(batchId);
    expect(ok).toBe(true);
    expect(manager.getStatus(batchId)?.paused).toBe(true);
    expect(manager.isActive(batchId)).toBe(false);
  });

  it('resumeBatch() clears the paused flag', async () => {
    await manager.pauseBatch(batchId);
    const ok = await manager.resumeBatch(batchId);
    expect(ok).toBe(true);
    expect(manager.getStatus(batchId)?.paused).toBe(false);
    expect(manager.isActive(batchId)).toBe(true);
  });

  it('pauseBatch() returns false for unknown batchId', async () => {
    expect(await manager.pauseBatch('nonexistent')).toBe(false);
  });

  it('resumeBatch() returns false for unknown batchId', async () => {
    expect(await manager.resumeBatch('nonexistent')).toBe(false);
  });
});

// ── 7. Failure pauses batch ──────────────────────────────────────────

describe('BatchManager — failure handling integration', () => {
  let manager: BatchManager;
  let batchId: string;

  beforeEach(async () => {
    manager = new BatchManager();
    batchId = await manager.createBatch('custom-list', PLAN);
  });

  it('buildFailureMessage returns formatted message with item ID and reason', () => {
    const msg = manager.buildFailureMessage(batchId, 'Worker timed out');
    expect(msg).not.toBeNull();
    expect(msg).toContain('OB-1001');
    expect(msg).toContain('Worker timed out');
  });

  it('buildFailureMessage returns null for unknown batchId', () => {
    expect(manager.buildFailureMessage('unknown', 'reason')).toBeNull();
  });

  it('after failure, pause + advanceBatch records failed item', async () => {
    await manager.pauseBatch(batchId);

    // Simulate calling advanceBatch for the failed item
    const result = await manager.advanceBatch(
      batchId,
      { id: 'OB-1001', summary: 'Worker timed out', status: 'failed' },
      0,
    );

    expect(result).not.toBeNull();
    expect(result!.completedIndex).toBe(0);

    const status = manager.getStatus(batchId);
    expect(status?.failedItems).toContain('OB-1001');
  });
});

// ── 8. Commit-after-each ─────────────────────────────────────────────

describe('BatchManager — commit-after-each', () => {
  let manager: BatchManager;
  let batchId: string;

  beforeEach(async () => {
    manager = new BatchManager();
    batchId = await manager.createBatch('custom-list', PLAN, undefined, true);
  });

  it('shouldCommitAfterEach returns true when flag is set at creation', () => {
    expect(manager.shouldCommitAfterEach(batchId)).toBe(true);
  });

  it('shouldCommitAfterEach returns false when flag is not set', async () => {
    const noBatchId = await manager.createBatch('custom-list', PLAN, undefined, false);
    expect(manager.shouldCommitAfterEach(noBatchId)).toBe(false);
  });

  it('setCommitAfterEach() toggles the flag', async () => {
    await manager.setCommitAfterEach(batchId, false);
    expect(manager.shouldCommitAfterEach(batchId)).toBe(false);

    await manager.setCommitAfterEach(batchId, true);
    expect(manager.shouldCommitAfterEach(batchId)).toBe(true);
  });

  it('buildCommitPrompt returns null before any item is completed', () => {
    expect(manager.buildCommitPrompt(batchId)).toBeNull();
  });

  it('buildCommitPrompt includes the completed item ID and a git commit command', async () => {
    await manager.advanceBatch(batchId, completed('OB-1001', 'Implemented feature'));

    const prompt = manager.buildCommitPrompt(batchId);
    expect(prompt).not.toBeNull();
    expect(prompt).toContain('OB-1001');
    expect(prompt).toContain('git');
    expect(prompt).toContain('commit');
  });
});

// ── 9. Abort cleans state ────────────────────────────────────────────

describe('BatchManager — abortBatch', () => {
  let manager: BatchManager;
  let batchId: string;

  beforeEach(async () => {
    manager = new BatchManager();
    batchId = await manager.createBatch('custom-list', PLAN);
  });

  it('abortBatch removes the batch from memory', async () => {
    const ok = await manager.abortBatch(batchId);
    expect(ok).toBe(true);
    expect(manager.getStatus(batchId)).toBeUndefined();
    expect(manager.isActive(batchId)).toBe(false);
    expect(manager.getCurrentBatchId()).toBeUndefined();
  });

  it('abortBatch returns false for unknown batchId', async () => {
    expect(await manager.abortBatch('nonexistent')).toBe(false);
  });

  it('abortBatch calls deleteBatchState on dotFolder', async () => {
    const dotFolder = makeMockDotFolder();
    const mgr = new BatchManager(dotFolder as never);
    const id = await mgr.createBatch('custom-list', PLAN);

    await mgr.abortBatch(id);

    expect(dotFolder.deleteBatchState).toHaveBeenCalledOnce();
  });

  it('popCompletionSummary returns abort summary after abortBatch', async () => {
    await manager.advanceBatch(batchId, completed('OB-1001'));
    await manager.abortBatch(batchId);

    const summary = manager.popCompletionSummary();
    expect(summary).not.toBeNull();
    expect(summary).toContain('aborted');
  });
});

// ── 10. Batch state survives restart ─────────────────────────────────

describe('BatchManager — initialize() persistence', () => {
  it('loads persisted batch state on initialize()', async () => {
    const savedState: BatchState = {
      batchId: 'test-batch-persisted',
      sourceType: 'tasks-md',
      totalItems: 3,
      currentIndex: 1,
      plan: PLAN,
      completedItems: [completed('OB-1001', 'Done in previous session')],
      failedItems: [],
      startedAt: new Date().toISOString(),
      totalCostUsd: 0.5,
      paused: false,
      commitAfterEach: false,
    };

    const dotFolder = makeMockDotFolder(savedState);
    const manager = new BatchManager(dotFolder as never);

    await manager.initialize();

    // Batch should be loaded and paused (initialize() forces paused=true)
    const status = manager.getStatus('test-batch-persisted');
    expect(status).not.toBeUndefined();
    expect(status?.paused).toBe(true);
    expect(status?.currentIndex).toBe(1);
    expect(status?.completedItems).toHaveLength(1);
    expect(status?.totalCostUsd).toBe(0.5);
  });

  it('is a no-op when no persisted state exists', async () => {
    const dotFolder = makeMockDotFolder(); // stored = null
    const manager = new BatchManager(dotFolder as never);

    await manager.initialize();

    expect(manager.getCurrentBatchId()).toBeUndefined();
  });

  it('persists state to dotFolder on createBatch', async () => {
    const dotFolder = makeMockDotFolder();
    const manager = new BatchManager(dotFolder as never);

    await manager.createBatch('custom-list', PLAN);

    expect(dotFolder.writeBatchState).toHaveBeenCalledOnce();
    const stored = dotFolder._stored();
    expect(stored).not.toBeNull();
    expect(stored?.plan).toHaveLength(3);
  });

  it('deletes persisted state when batch finishes naturally', async () => {
    const dotFolder = makeMockDotFolder();
    const manager = new BatchManager(dotFolder as never);
    const batchId = await manager.createBatch('custom-list', [PLAN[0]!]);

    // Complete the only item
    await manager.advanceBatch(batchId, completed('OB-1001'));

    expect(dotFolder.deleteBatchState).toHaveBeenCalledOnce();
    expect(dotFolder._stored()).toBeNull();
  });
});

// ── Bonus: getCurrentBatchId + isActive global check ─────────────────

describe('BatchManager — getCurrentBatchId / isActive (global)', () => {
  it('isActive() with no batchId returns false when no batches exist', () => {
    const manager = new BatchManager();
    expect(manager.isActive()).toBe(false);
  });

  it('isActive() with no batchId returns true when any active batch exists', async () => {
    const manager = new BatchManager();
    await manager.createBatch('custom-list', PLAN);
    expect(manager.isActive()).toBe(true);
  });

  it('getCurrentBatchId returns undefined when all batches are complete', async () => {
    const manager = new BatchManager();
    const batchId = await manager.createBatch('custom-list', [PLAN[0]!]);
    await manager.advanceBatch(batchId, completed('OB-1001'));
    // Batch is finished — removed from memory
    expect(manager.getCurrentBatchId()).toBeUndefined();
  });
});

// ── 11. Shutdown timer safety (OB-1664 / OB-1665) ─────────────────────

describe('Shutdown timer safety — batchTimers pattern (OB-1664 / OB-1665)', () => {
  it('clearTimeout on all handles in a Set cancels all pending batch timers', () => {
    vi.useFakeTimers();

    const timers = new Set<NodeJS.Timeout>();
    const fired: string[] = [];

    const t1 = setTimeout(() => fired.push('t1'), 500);
    const t2 = setTimeout(() => fired.push('t2'), 1500);
    timers.add(t1);
    timers.add(t2);

    // Simulate MasterManager.shutdown() clearing all batch timers (OB-1665)
    for (const handle of timers) {
      clearTimeout(handle);
    }
    timers.clear();

    vi.advanceTimersByTime(2000);

    expect(fired).toHaveLength(0);
    expect(timers.size).toBe(0);

    vi.useRealTimers();
  });

  it('timer callback with shutdown guard is a no-op when shutdown state is set', () => {
    vi.useFakeTimers();

    let isShutdown = false;
    let continuationCalled = false;
    const timers = new Set<NodeJS.Timeout>();

    const handle = setTimeout(() => {
      timers.delete(handle);
      if (isShutdown) return; // guard — OB-1665
      continuationCalled = true;
    }, 500);
    timers.add(handle);

    // Shutdown fires before timer expires
    isShutdown = true;

    vi.advanceTimersByTime(1000);

    expect(continuationCalled).toBe(false);

    vi.useRealTimers();
  });
});

// ── 12. routeBatchContinuation error pauses batch (OB-1666) ────────────

describe('BatchManager — error pauses batch (OB-1666)', () => {
  it('pauseBatch() correctly pauses batch when called from a catch handler', async () => {
    const manager = new BatchManager();
    const batchId = await manager.createBatch('custom-list', PLAN);

    expect(manager.isActive(batchId)).toBe(true);

    // Simulate: routeBatchContinuation rejects → catch handler calls pauseBatch (OB-1666)
    const routeBatchContinuation = async (): Promise<void> => {
      throw new Error('Network error');
    };

    await routeBatchContinuation().catch(async () => {
      await manager.pauseBatch(batchId);
    });

    expect(manager.isActive(batchId)).toBe(false);
    expect(manager.getStatus(batchId)?.paused).toBe(true);
  });
});

// ── 13. Sender info persistence and restoration (OB-1667) ──────────────

describe('BatchManager — sender info persistence and restoration (OB-1667)', () => {
  it('setSenderInfo persists senderInfo to batch state on disk', async () => {
    const dotFolder = makeMockDotFolder();
    const manager = new BatchManager(dotFolder as never);
    const batchId = await manager.createBatch('custom-list', PLAN);

    manager.setSenderInfo(batchId, { sender: '+1234567890', source: 'whatsapp' });

    // In-memory lookup should work immediately
    expect(manager.getSenderInfo(batchId)).toEqual({ sender: '+1234567890', source: 'whatsapp' });

    // setSenderInfo calls persist() asynchronously — wait for microtasks
    await Promise.resolve();
    expect(dotFolder._stored()?.senderInfo).toEqual({
      sender: '+1234567890',
      source: 'whatsapp',
    });
  });

  it('initialize() restores senderInfo from persisted state after restart', async () => {
    const savedState: BatchState = {
      batchId: 'batch-with-sender',
      sourceType: 'tasks-md',
      totalItems: 2,
      currentIndex: 0,
      plan: PLAN.slice(0, 2),
      completedItems: [],
      failedItems: [],
      startedAt: new Date().toISOString(),
      totalCostUsd: 0,
      paused: false,
      commitAfterEach: false,
      senderInfo: { sender: '+9876543210', source: 'whatsapp' },
    };

    const dotFolder = makeMockDotFolder(savedState);
    const manager = new BatchManager(dotFolder as never);

    await manager.initialize();

    // senderInfo should be restored from persisted state (OB-1667)
    expect(manager.getSenderInfo('batch-with-sender')).toEqual({
      sender: '+9876543210',
      source: 'whatsapp',
    });
  });
});
