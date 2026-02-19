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
    const queue = new MessageQueue();
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
});
