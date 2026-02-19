import { describe, it, expect, vi } from 'vitest';
import { MessageQueue } from '../../src/core/queue.js';
import type { InboundMessage } from '../../src/types/message.js';

function createMessage(id: string): InboundMessage {
  return {
    id,
    source: 'test',
    sender: '+1234567890',
    rawContent: `/ai test ${id}`,
    content: `test ${id}`,
    timestamp: new Date(),
  };
}

describe('MessageQueue', () => {
  it('should process messages in order', async () => {
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
});
