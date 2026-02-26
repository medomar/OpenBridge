import { describe, it, expect, vi } from 'vitest';
import { MessageQueue } from '../../src/core/queue.js';
import type { DeadLetterItem } from '../../src/core/queue.js';
import { ProviderError } from '../../src/providers/claude-code/provider-error.js';
import type { InboundMessage } from '../../src/types/message.js';

function createMessage(id: string, sender = '+1234567890'): InboundMessage {
  return {
    id,
    source: 'test',
    sender,
    rawContent: `/ai test ${id}`,
    content: `test ${id}`,
    timestamp: new Date(),
  };
}

describe('MessageQueue', () => {
  it('should process messages in order for the same sender', async () => {
    const queue = new MessageQueue();
    const processed: string[] = [];

    queue.onMessage(async (message) => {
      processed.push(message.id);
    });

    await queue.enqueue(createMessage('1'));
    await queue.enqueue(createMessage('2'));

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(processed).toEqual(['1', '2']);
  });

  it('should report queue size', () => {
    const queue = new MessageQueue();
    expect(queue.size).toBe(0);
  });

  it('should handle errors without stopping the queue', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(undefined);

    queue.onMessage(handler);

    await queue.enqueue(createMessage('1'));
    await queue.enqueue(createMessage('2'));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should retry a failed message up to maxRetries times', async () => {
    const queue = new MessageQueue({ maxRetries: 2, retryDelayMs: 10 });
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce(undefined);

    queue.onMessage(handler);

    await queue.enqueue(createMessage('1'));

    // Allow time for retries (2 retries × 10ms delay + processing)
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('should permanently drop a message after exhausting all retries', async () => {
    const queue = new MessageQueue({ maxRetries: 2, retryDelayMs: 10 });
    const handler = vi.fn().mockRejectedValue(new Error('always fails'));

    queue.onMessage(handler);

    await queue.enqueue(createMessage('1'));

    // Allow time for initial attempt + 2 retries
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 1 initial attempt + 2 retries = 3 total calls
    expect(handler).toHaveBeenCalledTimes(3);
  });

  it('should continue processing subsequent messages after a permanently failed message', async () => {
    const queue = new MessageQueue({ maxRetries: 1, retryDelayMs: 10 });
    const processed: string[] = [];
    const handler = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('fail')))
      .mockImplementationOnce(() => Promise.reject(new Error('fail')))
      .mockImplementation(async (msg: InboundMessage) => {
        processed.push(msg.id);
      });

    queue.onMessage(handler);

    await queue.enqueue(createMessage('1'));
    await queue.enqueue(createMessage('2'));

    // Allow time for retries + next message
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Message '1' exhausted retries, message '2' should succeed
    expect(processed).toContain('2');
  });

  it('drain() resolves immediately when queue is empty and not processing', async () => {
    const queue = new MessageQueue();
    queue.onMessage(async () => {});
    await expect(queue.drain()).resolves.toBeUndefined();
  });

  it('drain() waits for in-flight message to complete', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });

    let resolveHandler!: () => void;
    queue.onMessage(
      () =>
        new Promise<void>((resolve) => {
          resolveHandler = resolve;
        }),
    );

    void queue.enqueue(createMessage('1'));

    const drainPromise = queue.drain();
    let drained = false;
    void drainPromise.then(() => {
      drained = true;
    });

    // Not yet drained — handler is still blocked
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(drained).toBe(false);

    // Unblock the handler
    resolveHandler();
    await drainPromise;
    expect(drained).toBe(true);
  });

  // --- Per-user queue tests ---

  it('should process messages from different users in parallel', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });
    const timeline: string[] = [];

    queue.onMessage(async (message) => {
      timeline.push(`start:${message.id}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      timeline.push(`end:${message.id}`);
    });

    // Enqueue messages from two different users simultaneously
    void queue.enqueue(createMessage('userA-msg', '+111'));
    void queue.enqueue(createMessage('userB-msg', '+222'));

    await new Promise((resolve) => setTimeout(resolve, 150));

    // Both should start before either finishes (parallel)
    const startA = timeline.indexOf('start:userA-msg');
    const startB = timeline.indexOf('start:userB-msg');
    const endA = timeline.indexOf('end:userA-msg');
    const endB = timeline.indexOf('end:userB-msg');

    expect(startA).toBeLessThan(endA);
    expect(startB).toBeLessThan(endB);
    // Both start before either ends — proves parallel execution
    expect(startA).toBeLessThan(endB);
    expect(startB).toBeLessThan(endA);
  });

  it('should process messages from the same user sequentially', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });
    const timeline: string[] = [];

    queue.onMessage(async (message) => {
      timeline.push(`start:${message.id}`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      timeline.push(`end:${message.id}`);
    });

    void queue.enqueue(createMessage('msg1', '+111'));
    void queue.enqueue(createMessage('msg2', '+111'));

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Same user: first must finish before second starts
    const start1 = timeline.indexOf('start:msg1');
    const end1 = timeline.indexOf('end:msg1');
    const start2 = timeline.indexOf('start:msg2');
    const end2 = timeline.indexOf('end:msg2');

    expect(start1).toBeLessThan(end1);
    expect(end1).toBeLessThan(start2);
    expect(start2).toBeLessThan(end2);
  });

  it('drain() waits for all per-user queues to complete', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });
    const resolvers: (() => void)[] = [];

    queue.onMessage(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    // Enqueue messages from two different users
    void queue.enqueue(createMessage('a1', '+111'));
    void queue.enqueue(createMessage('b1', '+222'));

    // Let both handlers start
    await new Promise((resolve) => setTimeout(resolve, 10));

    const drainPromise = queue.drain();
    let drained = false;
    void drainPromise.then(() => {
      drained = true;
    });

    // Resolve one user — should not drain yet
    resolvers[0]!();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(drained).toBe(false);

    // Resolve second user — now drain should complete
    resolvers[1]!();
    await drainPromise;
    expect(drained).toBe(true);
  });

  it('cleans up empty user queues', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });

    queue.onMessage(async () => {});

    await queue.enqueue(createMessage('1', '+111'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(queue.size).toBe(0);
    expect(queue.isProcessing).toBe(false);
  });

  it('skips retries for permanent ProviderErrors', async () => {
    const queue = new MessageQueue({ maxRetries: 3, retryDelayMs: 10 });
    const handler = vi.fn().mockRejectedValue(new ProviderError('invalid api key', 'permanent', 1));

    queue.onMessage(handler);

    await queue.enqueue(createMessage('1'));

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Only 1 attempt — no retries for permanent errors
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('retries transient ProviderErrors up to maxRetries', async () => {
    const queue = new MessageQueue({ maxRetries: 2, retryDelayMs: 10 });
    const handler = vi.fn().mockRejectedValue(new ProviderError('timeout', 'transient', 124));

    queue.onMessage(handler);

    await queue.enqueue(createMessage('1'));

    await new Promise((resolve) => setTimeout(resolve, 200));

    // 1 initial attempt + 2 retries = 3
    expect(handler).toHaveBeenCalledTimes(3);
  });

  // --- Dead Letter Queue tests ---

  it('moves permanently failed messages to the dead letter queue', async () => {
    const queue = new MessageQueue({ maxRetries: 1, retryDelayMs: 10 });
    const handler = vi.fn().mockRejectedValue(new Error('always fails'));

    queue.onMessage(handler);

    await queue.enqueue(createMessage('dlq-1'));
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(queue.deadLetterSize).toBe(1);
    const items = queue.deadLetters;
    expect(items[0]!.message.id).toBe('dlq-1');
    expect(items[0]!.error).toBe('always fails');
    expect(items[0]!.attempts).toBe(2); // 1 initial + 1 retry
    expect(items[0]!.failedAt).toBeInstanceOf(Date);
  });

  it('moves permanent ProviderError messages to the DLQ without retries', async () => {
    const queue = new MessageQueue({ maxRetries: 3, retryDelayMs: 10 });
    const handler = vi.fn().mockRejectedValue(new ProviderError('invalid api key', 'permanent', 1));

    queue.onMessage(handler);

    await queue.enqueue(createMessage('dlq-perm'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(queue.deadLetterSize).toBe(1);
    expect(queue.deadLetters[0]!.error).toBe('invalid api key');
  });

  it('accumulates multiple failed messages in the DLQ', async () => {
    const queue = new MessageQueue({ maxRetries: 0, retryDelayMs: 10 });
    const handler = vi.fn().mockRejectedValue(new Error('fail'));

    queue.onMessage(handler);

    await queue.enqueue(createMessage('f1'));
    await queue.enqueue(createMessage('f2'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(queue.deadLetterSize).toBe(2);
    expect(queue.deadLetters.map((d: DeadLetterItem) => d.message.id)).toEqual(['f1', 'f2']);
  });

  it('flushDeadLetters returns all items and empties the DLQ', async () => {
    const queue = new MessageQueue({ maxRetries: 0, retryDelayMs: 10 });
    const handler = vi.fn().mockRejectedValue(new Error('fail'));

    queue.onMessage(handler);

    await queue.enqueue(createMessage('f1'));
    await queue.enqueue(createMessage('f2'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const flushed = queue.flushDeadLetters();
    expect(flushed).toHaveLength(2);
    expect(queue.deadLetterSize).toBe(0);
    expect(queue.deadLetters).toEqual([]);
  });

  it('deadLetters returns a snapshot (not a live reference)', async () => {
    const queue = new MessageQueue({ maxRetries: 0, retryDelayMs: 10 });
    const handler = vi.fn().mockRejectedValue(new Error('fail'));

    queue.onMessage(handler);

    await queue.enqueue(createMessage('snap-1'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const snapshot = queue.deadLetters;
    expect(snapshot).toHaveLength(1);

    // Add another failed message
    await queue.enqueue(createMessage('snap-2'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Original snapshot should be unchanged
    expect(snapshot).toHaveLength(1);
    expect(queue.deadLetters).toHaveLength(2);
  });

  it('DLQ starts empty', () => {
    const queue = new MessageQueue();
    expect(queue.deadLetterSize).toBe(0);
    expect(queue.deadLetters).toEqual([]);
  });

  // --- Queue notification (onQueued) tests ---

  it('averageProcessingTimeMs returns 30000 when no messages have been processed', () => {
    const queue = new MessageQueue();
    expect(queue.averageProcessingTimeMs).toBe(30_000);
  });

  it('averageProcessingTimeMs reflects processing duration after messages complete', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });
    queue.onMessage(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await queue.enqueue(createMessage('t1'));
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should be close to 20ms — allow generous range due to timer imprecision
    expect(queue.averageProcessingTimeMs).toBeGreaterThanOrEqual(5);
    expect(queue.averageProcessingTimeMs).toBeLessThan(500);
  });

  it('onQueued is NOT called when a message is processed immediately', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });
    const queuedCb = vi.fn();

    queue.onMessage(async () => {});
    queue.onQueued(queuedCb);

    await queue.enqueue(createMessage('immediate'));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(queuedCb).not.toHaveBeenCalled();
  });

  it('onQueued fires with position=1 when a second message arrives while first is in-flight', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });
    const queuedCb = vi.fn();
    let resolveFirst!: () => void;

    queue.onMessage(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    queue.onQueued(queuedCb);

    // Start processing first message
    void queue.enqueue(createMessage('first', '+111'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Enqueue second — should trigger onQueued
    void queue.enqueue(createMessage('second', '+111'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(queuedCb).toHaveBeenCalledOnce();
    const [msg, position, estimatedWaitMs] = queuedCb.mock.calls[0] as [
      InboundMessage,
      number,
      number,
    ];
    expect(msg.id).toBe('second');
    expect(position).toBe(1);
    expect(estimatedWaitMs).toBeGreaterThan(0);

    resolveFirst();
  });

  it('onQueued fires with position=2 for the third message behind two in-flight', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });
    const queuedCb = vi.fn();
    let resolveFirst!: () => void;

    queue.onMessage(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    queue.onQueued(queuedCb);

    // Start processing first message
    void queue.enqueue(createMessage('first', '+111'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second and third arrive while first is still processing
    void queue.enqueue(createMessage('second', '+111'));
    void queue.enqueue(createMessage('third', '+111'));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(queuedCb).toHaveBeenCalledTimes(2);
    const secondCall = queuedCb.mock.calls[0] as [InboundMessage, number, number];
    const thirdCall = queuedCb.mock.calls[1] as [InboundMessage, number, number];
    expect(secondCall[1]).toBe(1); // second is position 1
    expect(thirdCall[1]).toBe(2); // third is position 2
    // Third's estimated wait should be twice second's
    expect(thirdCall[2]).toBe(secondCall[2] * 2);

    resolveFirst();
  });
});
