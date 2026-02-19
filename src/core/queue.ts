import type { InboundMessage } from '../types/message.js';
import type { QueueConfig } from '../types/config.js';
import { createLogger } from './logger.js';

const logger = createLogger('queue');

interface QueueItem {
  message: InboundMessage;
  addedAt: Date;
  attempts: number;
}

const DEFAULT_CONFIG: QueueConfig = {
  maxRetries: 3,
  retryDelayMs: 1_000,
};

export class MessageQueue {
  private readonly queue: QueueItem[] = [];
  private processing = false;
  private handler: ((message: InboundMessage) => Promise<void>) | null = null;
  private readonly config: QueueConfig;
  private drainResolvers: (() => void)[] = [];

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Register the message handler */
  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.handler = handler;
  }

  /** Add a message to the queue */
  async enqueue(message: InboundMessage): Promise<void> {
    this.queue.push({ message, addedAt: new Date(), attempts: 0 });
    logger.debug({ messageId: message.id, queueSize: this.queue.length }, 'Message enqueued');

    if (!this.processing) {
      await this.processNext();
    }
  }

  /** Wait until the queue is empty and all in-flight messages have been processed */
  drain(): Promise<void> {
    if (!this.processing && this.queue.length === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  /** Process the next message in the queue */
  private async processNext(): Promise<void> {
    if (this.queue.length === 0 || !this.handler) {
      this.processing = false;
      for (const resolve of this.drainResolvers) {
        resolve();
      }
      this.drainResolvers = [];
      return;
    }

    this.processing = true;
    const item = this.queue.shift();
    if (!item) {
      this.processing = false;
      return;
    }

    logger.info({ messageId: item.message.id }, 'Processing message');

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = this.config.retryDelayMs * attempt;
        logger.warn({ messageId: item.message.id, attempt, delay }, 'Retrying message after delay');
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      try {
        await this.handler(item.message);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        item.attempts = attempt + 1;
        logger.error(
          {
            messageId: item.message.id,
            attempt: attempt + 1,
            maxRetries: this.config.maxRetries,
            error,
          },
          'Failed to process message',
        );
      }
    }

    if (lastError !== undefined) {
      logger.error(
        { messageId: item.message.id, attempts: item.attempts },
        'Message permanently failed after all retries — dropping',
      );
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
