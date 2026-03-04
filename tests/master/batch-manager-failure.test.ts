/**
 * Tests for BatchManager failure handling (OB-1616).
 *
 * Covers:
 * - buildFailureMessage() formats the correct user-facing message
 * - skipCurrentItem() records item as skipped and advances the batch
 * - retryCurrentItem() resumes the batch without advancing the index
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BatchManager } from '../../src/master/batch-manager.js';
import type { BatchPlanItem } from '../../src/types/agent.js';

const PLAN: BatchPlanItem[] = [
  { id: 'OB-1001', description: 'First task' },
  { id: 'OB-1002', description: 'Second task' },
  { id: 'OB-1003', description: 'Third task' },
];

describe('BatchManager — failure handling (OB-1616)', () => {
  let manager: BatchManager;
  let batchId: string;

  beforeEach(async () => {
    manager = new BatchManager(); // no dotFolder — no persistence
    batchId = await manager.createBatch('custom-list', PLAN);
    // Simulate the batch being paused after a failure
    await manager.pauseBatch(batchId);
  });

  // ── buildFailureMessage ───────────────────────────────────────

  it('buildFailureMessage returns null for unknown batchId', () => {
    const msg = manager.buildFailureMessage('nonexistent', 'boom');
    expect(msg).toBeNull();
  });

  it('buildFailureMessage includes the current item ID and reason', () => {
    const msg = manager.buildFailureMessage(batchId, 'timeout after 60s');
    expect(msg).not.toBeNull();
    expect(msg).toContain('OB-1001');
    expect(msg).toContain('timeout after 60s');
  });

  it('buildFailureMessage includes /batch skip, /batch retry, /batch abort instructions', () => {
    const msg = manager.buildFailureMessage(batchId, 'some error');
    expect(msg).toContain('/batch skip');
    expect(msg).toContain('/batch retry');
    expect(msg).toContain('/batch abort');
  });

  // ── skipCurrentItem ───────────────────────────────────────────

  it('skipCurrentItem returns null for unknown batchId', async () => {
    const result = await manager.skipCurrentItem('nonexistent');
    expect(result).toBeNull();
  });

  it('skipCurrentItem records the current item as skipped and advances index', async () => {
    const result = await manager.skipCurrentItem(batchId);
    expect(result).not.toBeNull();
    expect(result!.completedIndex).toBe(0);
    expect(result!.nextIndex).toBe(1);
    expect(result!.finished).toBe(false);

    const status = manager.getStatus(batchId);
    expect(status!.currentIndex).toBe(1);
    expect(status!.completedItems).toHaveLength(1);
    expect(status!.completedItems[0]!.status).toBe('skipped');
    expect(status!.completedItems[0]!.id).toBe('OB-1001');
  });

  it('skipCurrentItem resumes the batch (clears paused flag) before advancing', async () => {
    const beforeSkip = manager.getStatus(batchId)!;
    expect(beforeSkip.paused).toBe(true);

    await manager.skipCurrentItem(batchId);

    // After skip the batch should have advanced; the new state is active (not paused)
    const after = manager.getStatus(batchId);
    // batch still has items at index 1 → it exists and is not paused
    expect(after).not.toBeUndefined();
    expect(after!.paused).toBe(false);
  });

  it('skipCurrentItem returns finished=true when skipping the last item', async () => {
    // Create a single-item batch
    const singleBatchId = await manager.createBatch('custom-list', [PLAN[0]!]);
    await manager.pauseBatch(singleBatchId);

    const result = await manager.skipCurrentItem(singleBatchId);
    expect(result).not.toBeNull();
    expect(result!.finished).toBe(true);
    expect(result!.nextIndex).toBeNull();
  });

  // ── retryCurrentItem ──────────────────────────────────────────

  it('retryCurrentItem returns false for unknown batchId', async () => {
    const ok = await manager.retryCurrentItem('nonexistent');
    expect(ok).toBe(false);
  });

  it('retryCurrentItem resumes the batch without advancing currentIndex', async () => {
    const beforeStatus = manager.getStatus(batchId)!;
    expect(beforeStatus.currentIndex).toBe(0);
    expect(beforeStatus.paused).toBe(true);

    const ok = await manager.retryCurrentItem(batchId);
    expect(ok).toBe(true);

    const afterStatus = manager.getStatus(batchId)!;
    expect(afterStatus.currentIndex).toBe(0); // same index
    expect(afterStatus.paused).toBe(false); // no longer paused
  });

  it('retryCurrentItem does not add any completed items', async () => {
    await manager.retryCurrentItem(batchId);
    const status = manager.getStatus(batchId)!;
    expect(status.completedItems).toHaveLength(0);
  });
});
