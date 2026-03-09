import { describe, it, expect } from 'vitest';
import { MessageQueue } from '../../src/core/queue.js';
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

describe('MessageQueue — recursion safety', () => {
  it('should process 500 messages for the same sender without stack overflow', async () => {
    const queue = new MessageQueue({ maxRetries: 0 });
    const processed: string[] = [];

    queue.onMessage(async (message) => {
      processed.push(message.id);
    });

    const TOTAL = 500;
    const sender = '+1111111111';

    // Enqueue all messages; the first triggers processing, the rest wait.
    for (let i = 0; i < TOTAL; i++) {
      await queue.enqueue(createMessage(String(i), sender));
    }

    // Wait for the while-loop processor to drain all 500 messages.
    await queue.drain();

    expect(processed.length).toBe(TOTAL);
    // Verify FIFO order was preserved.
    for (let i = 0; i < TOTAL; i++) {
      expect(processed[i]).toBe(String(i));
    }
  });
});
