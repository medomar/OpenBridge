import type { InboundMessage } from '../types/message.js';
import { createLogger } from './logger.js';

const logger = createLogger('queue');

interface QueueItem {
  message: InboundMessage;
  addedAt: Date;
}

export class MessageQueue {
  private readonly queue: QueueItem[] = [];
  private processing = false;
  private handler: ((message: InboundMessage) => Promise<void>) | null = null;

  /** Register the message handler */
  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.handler = handler;
  }

  /** Add a message to the queue */
  async enqueue(message: InboundMessage): Promise<void> {
    this.queue.push({ message, addedAt: new Date() });
    logger.debug({ messageId: message.id, queueSize: this.queue.length }, 'Message enqueued');

    if (!this.processing) {
      await this.processNext();
    }
  }

  /** Process the next message in the queue */
  private async processNext(): Promise<void> {
    if (this.queue.length === 0 || !this.handler) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const item = this.queue.shift();
    if (!item) {
      this.processing = false;
      return;
    }

    logger.info({ messageId: item.message.id }, 'Processing message');

    try {
      await this.handler(item.message);
    } catch (error) {
      logger.error({ messageId: item.message.id, error }, 'Failed to process message');
    }

    await this.processNext();
  }

  get size(): number {
    return this.queue.length;
  }

  get isProcessing(): boolean {
    return this.processing;
  }
}
