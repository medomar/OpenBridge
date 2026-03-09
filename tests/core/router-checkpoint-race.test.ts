/**
 * Unit tests for OB-1293 / OB-F163: checkpoint/resume race condition.
 *
 * Verifies that when `processMessage()` throws after `checkpointSession()`,
 * the finally block calls `resumeSession()` to prevent stuck checkpoint state.
 *
 * Tests the exact logic from Router.route() lines 1699–1821.
 */
import { describe, it, expect, vi } from 'vitest';
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

/**
 * Reproduces the checkpoint-handle-resume logic from Router.route()
 * (src/core/router.ts lines 1699–1821). Extracted here so we can
 * test the finally-block behavior in isolation without wiring up a
 * full Router + Connector + Provider stack.
 */
async function simulateRouteWithCheckpoint(
  message: InboundMessage,
  urgentIds: Set<string>,
  master: {
    checkpointSession: () => Promise<boolean>;
    resumeSession: () => Promise<unknown>;
    processMessage: (msg: InboundMessage) => Promise<string>;
  },
): Promise<string> {
  const isUrgentCycle = urgentIds.has(message.id);
  let sessionCheckpointed = false;
  if (isUrgentCycle) {
    urgentIds.delete(message.id);
    await master.checkpointSession();
    sessionCheckpointed = true;
  }

  try {
    const response = await master.processMessage(message);
    return response;
  } finally {
    if (sessionCheckpointed) {
      try {
        await master.resumeSession();
      } catch {
        // Logged in real code — swallowed here to match router behavior
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Checkpoint/resume race condition (OB-F163)', () => {
  it('resumeSession() is called when processMessage() throws after checkpoint', async () => {
    const order: string[] = [];

    const mockMaster = {
      checkpointSession: vi.fn(async () => {
        order.push('checkpoint');
        return true;
      }),
      resumeSession: vi.fn(async () => {
        order.push('resume');
        return { restored: true, pendingMessages: 0, restoredWorkers: 0, failedWorkers: 0 };
      }),
      processMessage: vi.fn(async () => {
        order.push('process-throw');
        throw new Error('AI service unavailable');
      }),
    };

    const urgentIds = new Set<string>();
    const msg = makeMessage('urgent-err', 'status?');
    urgentIds.add(msg.id);

    await expect(simulateRouteWithCheckpoint(msg, urgentIds, mockMaster)).rejects.toThrow(
      'AI service unavailable',
    );

    // checkpoint → process (throws) → resume (finally)
    expect(order).toEqual(['checkpoint', 'process-throw', 'resume']);
    expect(mockMaster.checkpointSession).toHaveBeenCalledOnce();
    expect(mockMaster.resumeSession).toHaveBeenCalledOnce();
  });

  it('resumeSession() is called on success (normal path)', async () => {
    const mockMaster = {
      checkpointSession: vi.fn(async () => true),
      resumeSession: vi.fn(async () => ({
        restored: true,
        pendingMessages: 0,
        restoredWorkers: 0,
        failedWorkers: 0,
      })),
      processMessage: vi.fn(async () => 'response ok'),
    };

    const urgentIds = new Set<string>();
    const msg = makeMessage('urgent-ok', 'status?');
    urgentIds.add(msg.id);

    const result = await simulateRouteWithCheckpoint(msg, urgentIds, mockMaster);

    expect(result).toBe('response ok');
    expect(mockMaster.checkpointSession).toHaveBeenCalledOnce();
    expect(mockMaster.resumeSession).toHaveBeenCalledOnce();
  });

  it('neither checkpoint nor resume called for non-urgent messages', async () => {
    const mockMaster = {
      checkpointSession: vi.fn(async () => true),
      resumeSession: vi.fn(async () => ({})),
      processMessage: vi.fn(async () => 'ok'),
    };

    const urgentIds = new Set<string>();
    const msg = makeMessage('normal-1', 'build a feature');
    // NOT added to urgentIds

    await simulateRouteWithCheckpoint(msg, urgentIds, mockMaster);

    expect(mockMaster.checkpointSession).not.toHaveBeenCalled();
    expect(mockMaster.resumeSession).not.toHaveBeenCalled();
    expect(mockMaster.processMessage).toHaveBeenCalledOnce();
  });

  it('processMessage() error propagates even though resumeSession() succeeds', async () => {
    const mockMaster = {
      checkpointSession: vi.fn(async () => true),
      resumeSession: vi.fn(async () => ({ restored: true })),
      processMessage: vi.fn(async () => {
        throw new TypeError('Cannot read properties of null');
      }),
    };

    const urgentIds = new Set<string>();
    const msg = makeMessage('urgent-type-err', 'check');
    urgentIds.add(msg.id);

    await expect(simulateRouteWithCheckpoint(msg, urgentIds, mockMaster)).rejects.toThrow(
      TypeError,
    );
    expect(mockMaster.resumeSession).toHaveBeenCalledOnce();
  });

  it('resumeSession() error is swallowed — does not mask the original error', async () => {
    const mockMaster = {
      checkpointSession: vi.fn(async () => true),
      resumeSession: vi.fn(async () => {
        throw new Error('Resume failed: session corrupt');
      }),
      processMessage: vi.fn(async () => {
        throw new Error('Process failed');
      }),
    };

    const urgentIds = new Set<string>();
    const msg = makeMessage('urgent-double-err', 'query');
    urgentIds.add(msg.id);

    // The original processMessage error should propagate, not the resume error
    await expect(simulateRouteWithCheckpoint(msg, urgentIds, mockMaster)).rejects.toThrow(
      'Process failed',
    );
    expect(mockMaster.resumeSession).toHaveBeenCalledOnce();
  });

  it('resumeSession() error is swallowed on success path too', async () => {
    const mockMaster = {
      checkpointSession: vi.fn(async () => true),
      resumeSession: vi.fn(async () => {
        throw new Error('Resume failed');
      }),
      processMessage: vi.fn(async () => 'good response'),
    };

    const urgentIds = new Set<string>();
    const msg = makeMessage('urgent-resume-fail', 'check');
    urgentIds.add(msg.id);

    // processMessage succeeded — resume error should not propagate
    const result = await simulateRouteWithCheckpoint(msg, urgentIds, mockMaster);
    expect(result).toBe('good response');
    expect(mockMaster.resumeSession).toHaveBeenCalledOnce();
  });
});
