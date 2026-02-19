import type { InboundMessage } from '../types/message.js';
import type { QueueConfig } from '../types/config.js';
import { ProviderError } from '../providers/claude-code/provider-error.js';
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

/**
 * Per-user message queue.
 *
 * Each sender gets its own sequential queue so that one slow response
 * does not block messages from other users. Messages from the same
 * sender are still processed in order.
 */
export class MessageQueue {
  private readonly userQueues = new Map<string, QueueItem[]>();
  private readonly activeUsers = new Set<string>();
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
    const sender = message.sender;

    let queue = this.userQueues.get(sender);
    if (!queue) {
      queue = [];
      this.userQueues.set(sender, queue);
    }
    queue.push({ message, addedAt: new Date(), attempts: 0 });

    logger.debug({ messageId: message.id, sender, queueSize: queue.length }, 'Message enqueued');

    if (!this.activeUsers.has(sender)) {
      await this.processNextForUser(sender);
    }
  }

  /** Wait until all per-user queues are empty and no messages are in flight */
  drain(): Promise<void> {
    if (this.activeUsers.size === 0 && this.totalSize === 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  /** Process the next message for a specific user */
  private async processNextForUser(sender: string): Promise<void> {
    const queue = this.userQueues.get(sender);
    if (!queue || queue.length === 0 || !this.handler) {
      this.activeUsers.delete(sender);
      if (queue?.length === 0) {
        this.userQueues.delete(sender);
      }
      this.resolveDrainIfIdle();
      return;
    }

    this.activeUsers.add(sender);
    const item = queue.shift()!;

    logger.info({ messageId: item.message.id, sender }, 'Processing message');

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

        const isPermanent = error instanceof ProviderError && error.kind === 'permanent';
        logger.error(
          {
            messageId: item.message.id,
            attempt: attempt + 1,
            maxRetries: this.config.maxRetries,
            errorKind: error instanceof ProviderError ? error.kind : 'unknown',
            error,
          },
          isPermanent ? 'Permanent error — skipping retries' : 'Failed to process message',
        );

        if (isPermanent) break;
      }
    }

    if (lastError !== undefined) {
      logger.error(
        { messageId: item.message.id, attempts: item.attempts },
        'Message permanently failed after all retries — dropping',
      );
    }

    await this.processNextForUser(sender);
  }

  private resolveDrainIfIdle(): void {
    if (this.activeUsers.size === 0 && this.totalSize === 0) {
      for (const resolve of this.drainResolvers) {
        resolve();
      }
      this.drainResolvers = [];
    }
  }

  /** Total number of queued (waiting) messages across all users */
  get size(): number {
    return this.totalSize;
  }

  private get totalSize(): number {
    let total = 0;
    for (const q of this.userQueues.values()) {
      total += q.length;
    }
    return total;
  }

  get isProcessing(): boolean {
    return this.activeUsers.size > 0;
  }
}
