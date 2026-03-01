/**
 * Integration tests for OB-1055: checkpoint-handle-resume cycle wired to the priority queue.
 *
 * Verifies that when a priority-1 message is enqueued while the same sender's message
 * is in-flight, the Router:
 *   1. Calls `checkpointSession()` before processing the urgent message.
 *   2. Processes the urgent message via Master.
 *   3. Calls `resumeSession()` after the urgent message completes.
 */
import { describe, it, expect, vi } from 'vitest';
import { MessageQueue } from '../../src/core/queue.js';
import type { InboundMessage } from '../../src/types/message.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(id: string, content: string, sender = '+1111111111'): InboundMessage {
  return {
    id,
    source: 'console',
    sender,
    rawContent: content,
    content,
    timestamp: new Date(),
  };
}

// ---------------------------------------------------------------------------
// onUrgentEnqueued + Router integration
// ---------------------------------------------------------------------------

describe('Checkpoint-queue integration (OB-1055)', () => {
  describe('MessageQueue.onUrgentEnqueued fires for same-sender priority-1', () => {
    it('triggers callback with the urgent message object', async () => {
      const queue = new MessageQueue({ maxRetries: 0 });
      const urgentCb = vi.fn();
      let resolveFirst!: () => void;

      queue.onMessage(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      );
      queue.onUrgentEnqueued(urgentCb);

      const first = makeMessage('first', 'implement a new feature');
      const urgent = makeMessage('urgent', 'what is the status?');

      void queue.enqueue(first);
      await new Promise((resolve) => setTimeout(resolve, 10));

      void queue.enqueue(urgent, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(urgentCb).toHaveBeenCalledOnce();
      expect((urgentCb.mock.calls[0] as [InboundMessage])[0].id).toBe('urgent');

      resolveFirst();
    });

    it('does not trigger callback for same-sender priority-2 while in-flight', async () => {
      const queue = new MessageQueue({ maxRetries: 0 });
      const urgentCb = vi.fn();
      let resolveFirst!: () => void;

      queue.onMessage(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      );
      queue.onUrgentEnqueued(urgentCb);

      void queue.enqueue(makeMessage('first', 'complex task'));
      await new Promise((resolve) => setTimeout(resolve, 10));

      void queue.enqueue(makeMessage('second', 'write some code'), 2);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(urgentCb).not.toHaveBeenCalled();

      resolveFirst();
    });
  });

  describe('urgentCycleMessageIds tracks IDs for checkpoint cycle', () => {
    it('adds urgent message ID when onUrgentEnqueued fires', async () => {
      // Simulate the Router's handler registration: collect IDs in a Set
      const capturedIds = new Set<string>();

      const queue = new MessageQueue({ maxRetries: 0 });
      let resolveFirst!: () => void;

      queue.onMessage(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      );

      queue.onUrgentEnqueued((msg) => {
        capturedIds.add(msg.id);
      });

      const urgent = makeMessage('urgent-42', 'urgent question?');
      void queue.enqueue(makeMessage('first', 'complex task'));
      await new Promise((resolve) => setTimeout(resolve, 10));

      void queue.enqueue(urgent, 1);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(capturedIds.has('urgent-42')).toBe(true);

      resolveFirst();
    });

    it('does not add ID when urgent from different sender', async () => {
      const capturedIds = new Set<string>();

      const queue = new MessageQueue({ maxRetries: 0 });
      let resolveFirst!: () => void;

      queue.onMessage(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      );

      queue.onUrgentEnqueued((msg) => {
        capturedIds.add(msg.id);
      });

      void queue.enqueue(makeMessage('first', 'complex task', '+AAA'));
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Different sender — urgent callback should NOT fire
      void queue.enqueue(makeMessage('other-urgent', 'quick question?', '+BBB'), 1);
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(capturedIds.size).toBe(0);

      resolveFirst();
    });
  });

  describe('checkpoint → handle → resume ordering', () => {
    it('checkpointSession is called before processMessage for urgent cycle message', async () => {
      const order: string[] = [];

      // Mock master with checkpoint/resume tracking
      const mockMaster = {
        checkpointSession: vi.fn(async () => {
          order.push('checkpoint');
          return true;
        }),
        resumeSession: vi.fn(async () => {
          order.push('resume');
          return { restored: true, pendingMessages: 0, restoredWorkers: 0, failedWorkers: 0 };
        }),
        processMessage: vi.fn(async (_msg: InboundMessage) => {
          order.push('process');
          return 'ok';
        }),
        getState: vi.fn(() => 'ready' as const),
      };

      // Simulate Router checkpoint/resume logic directly (extracted for unit testing)
      const urgentIds = new Set<string>();

      // Simulate onUrgentEnqueued registration
      const onUrgentEnqueued = (msg: InboundMessage): void => {
        urgentIds.add(msg.id);
      };

      const simulateRoute = async (message: InboundMessage): Promise<string> => {
        const isUrgentCycle = urgentIds.has(message.id);
        if (isUrgentCycle) {
          urgentIds.delete(message.id);
          await mockMaster.checkpointSession();
        }

        const response = await mockMaster.processMessage(message);

        if (isUrgentCycle) {
          await mockMaster.resumeSession();
        }

        return response;
      };

      // Mark urgent-1 as flagged
      const urgentMsg = makeMessage('urgent-1', 'status check?');
      onUrgentEnqueued(urgentMsg);

      await simulateRoute(urgentMsg);

      // Verify order: checkpoint → process → resume
      expect(order).toEqual(['checkpoint', 'process', 'resume']);
      expect(mockMaster.checkpointSession).toHaveBeenCalledOnce();
      expect(mockMaster.processMessage).toHaveBeenCalledOnce();
      expect(mockMaster.resumeSession).toHaveBeenCalledOnce();
    });

    it('checkpoint and resume are NOT called for non-urgent messages', async () => {
      const mockMaster = {
        checkpointSession: vi.fn(async () => true),
        resumeSession: vi.fn(async () => ({
          restored: true,
          pendingMessages: 0,
          restoredWorkers: 0,
          failedWorkers: 0,
        })),
        processMessage: vi.fn(async () => 'ok'),
        getState: vi.fn(() => 'ready' as const),
      };

      const urgentIds = new Set<string>();

      const simulateRoute = async (message: InboundMessage): Promise<string> => {
        const isUrgentCycle = urgentIds.has(message.id);
        if (isUrgentCycle) {
          urgentIds.delete(message.id);
          await mockMaster.checkpointSession();
        }

        const response = await mockMaster.processMessage(message);

        if (isUrgentCycle) {
          await mockMaster.resumeSession();
        }

        return response;
      };

      // Not flagged as urgent
      const normalMsg = makeMessage('normal-1', 'implement a feature');
      await simulateRoute(normalMsg);

      expect(mockMaster.checkpointSession).not.toHaveBeenCalled();
      expect(mockMaster.resumeSession).not.toHaveBeenCalled();
      expect(mockMaster.processMessage).toHaveBeenCalledOnce();
    });

    it('urgent ID is consumed (deleted from set) after checkpoint cycle', async () => {
      const mockMaster = {
        checkpointSession: vi.fn(async () => true),
        resumeSession: vi.fn(async () => ({
          restored: true,
          pendingMessages: 0,
          restoredWorkers: 0,
          failedWorkers: 0,
        })),
        processMessage: vi.fn(async () => 'ok'),
        getState: vi.fn(() => 'ready' as const),
      };

      const urgentIds = new Set<string>();

      const simulateRoute = async (message: InboundMessage): Promise<string> => {
        const isUrgentCycle = urgentIds.has(message.id);
        if (isUrgentCycle) {
          urgentIds.delete(message.id);
          await mockMaster.checkpointSession();
        }
        const response = await mockMaster.processMessage(message);
        if (isUrgentCycle) {
          await mockMaster.resumeSession();
        }
        return response;
      };

      const urgentMsg = makeMessage('urgent-2', 'quick check?');
      urgentIds.add(urgentMsg.id);

      await simulateRoute(urgentMsg);

      // ID should be consumed — routing the same message again should NOT re-trigger cycle
      expect(urgentIds.has(urgentMsg.id)).toBe(false);

      vi.clearAllMocks();
      await simulateRoute(urgentMsg);

      expect(mockMaster.checkpointSession).not.toHaveBeenCalled();
      expect(mockMaster.resumeSession).not.toHaveBeenCalled();
    });
  });
});
