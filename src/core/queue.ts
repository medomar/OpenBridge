import type { InboundMessage } from '../types/message.js';
import type { QueueConfig } from '../types/config.js';
import type { MetricsCollector } from './metrics.js';
import { ProviderError } from '../providers/claude-code/provider-error.js';
import { createLogger } from './logger.js';

const logger = createLogger('queue');

interface QueueItem {
  message: InboundMessage;
  addedAt: Date;
  attempts: number;
  /** 1 = quick-answer (highest), 2 = tool-use, 3 = complex-task (lowest) */
  priority: 1 | 2 | 3;
}

export interface DeadLetterItem {
  message: InboundMessage;
  error: string;
  attempts: number;
  failedAt: Date;
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
  private readonly dlq: DeadLetterItem[] = [];
  private readonly metrics?: MetricsCollector;
  /** Rolling window of the last 10 message processing durations (ms). */
  private readonly recentProcessingTimes: number[] = [];
  /** Called when a message must wait in queue — provides position and estimated wait. */
  private queuedHandler:
    | ((message: InboundMessage, position: number, estimatedWaitMs: number) => void)
    | null = null;
  /**
   * Called when a priority-1 message is enqueued for a sender whose previous message
   * is still being processed.  The Router uses this to trigger a checkpoint-handle-resume
   * cycle so that session state is saved before the urgent message is handled.
   */
  private urgentEnqueuedHandler: ((message: InboundMessage) => void) | null = null;

  constructor(config: Partial<QueueConfig> = {}, metrics?: MetricsCollector) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.metrics = metrics;
  }

  /** Register the message handler */
  onMessage(handler: (message: InboundMessage) => Promise<void>): void {
    this.handler = handler;
  }

  /**
   * Register a callback invoked when a message is queued behind another in-flight message.
   * Receives the queued message, its 1-based position in the waiting queue, and the
   * estimated wait time in milliseconds based on recent processing durations.
   */
  onQueued(
    handler: (message: InboundMessage, position: number, estimatedWaitMs: number) => void,
  ): void {
    this.queuedHandler = handler;
  }

  /**
   * Register a callback invoked when a priority-1 (urgent) message is enqueued for a sender
   * whose previous message is still in flight.
   *
   * Used by the Router to trigger a checkpoint-handle-resume cycle: the session is
   * checkpointed before the urgent message is processed and restored afterwards, preserving
   * the pre-interruption Master context for subsequent messages.
   */
  onUrgentEnqueued(handler: (message: InboundMessage) => void): void {
    this.urgentEnqueuedHandler = handler;
  }

  /**
   * Rolling average of recent message processing times (ms).
   * Returns 30 000 ms as a default when no history is available.
   */
  get averageProcessingTimeMs(): number {
    if (this.recentProcessingTimes.length === 0) return 30_000;
    const sum = this.recentProcessingTimes.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.recentProcessingTimes.length);
  }

  /**
   * Add a message to the queue.
   *
   * @param message - The inbound message to queue.
   * @param priority - Queue priority: 1 (quick-answer, highest) · 2 (tool-use, default) · 3 (complex-task, lowest).
   *   Quick-answer messages (priority 1) jump ahead of pending tool-use and complex-task messages.
   */
  async enqueue(message: InboundMessage, priority: 1 | 2 | 3 = 2): Promise<void> {
    const sender = message.sender;

    let queue = this.userQueues.get(sender);
    if (!queue) {
      queue = [];
      this.userQueues.set(sender, queue);
    }

    const item: QueueItem = { message, addedAt: new Date(), attempts: 0, priority };

    // Insert in priority order — find the first existing item with lower priority (higher number)
    // and insert before it so that higher-priority messages are processed first.
    // Within the same priority, FIFO order is preserved (insert before any equal-priority item
    // that was already in the queue at the time of insertion is NOT done — we only jump ahead of
    // lower-priority items to keep same-priority ordering stable).
    const insertAt = queue.findIndex((existing) => existing.priority > item.priority);
    if (insertAt === -1) {
      queue.push(item);
    } else {
      queue.splice(insertAt, 0, item);
    }

    this.metrics?.recordEnqueued();

    logger.debug(
      { messageId: message.id, sender, queueSize: queue.length, priority },
      'Message enqueued',
    );

    // Notify when a priority-1 message is enqueued for a sender whose current message is
    // still in flight.  The Router uses this to trigger a checkpoint-handle-resume cycle.
    if (priority === 1 && this.activeUsers.has(sender) && this.urgentEnqueuedHandler) {
      this.urgentEnqueuedHandler(message);
    }

    if (!this.activeUsers.has(sender)) {
      await this.processNextForUser(sender);
    } else if (this.queuedHandler) {
      // Another message for this sender is already in-flight — notify about queue position.
      const position = queue.length; // 1-based: how many messages are waiting (including this one)
      const estimatedWaitMs = this.averageProcessingTimeMs * position;
      this.queuedHandler(message, position, estimatedWaitMs);
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
    const processingStart = Date.now();

    logger.info({ messageId: item.message.id, sender }, 'Processing message');

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (attempt > 0) {
        this.metrics?.recordRetry();
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

    // Record elapsed time (including any retries) for rolling average used by onQueued.
    const elapsed = Date.now() - processingStart;
    this.recentProcessingTimes.push(elapsed);
    if (this.recentProcessingTimes.length > 10) {
      this.recentProcessingTimes.shift();
    }

    if (lastError !== undefined) {
      const deadLetterItem: DeadLetterItem = {
        message: item.message,
        error:
          lastError instanceof Error
            ? lastError.message
            : typeof lastError === 'string'
              ? lastError
              : 'Unknown error',
        attempts: item.attempts,
        failedAt: new Date(),
      };
      this.dlq.push(deadLetterItem);
      this.metrics?.recordDeadLettered();

      logger.error(
        { messageId: item.message.id, attempts: item.attempts, dlqSize: this.dlq.length },
        'Message permanently failed — moved to dead letter queue',
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

  /** Returns a read-only snapshot of dead letter queue items */
  get deadLetters(): ReadonlyArray<DeadLetterItem> {
    return [...this.dlq];
  }

  /** Number of messages in the dead letter queue */
  get deadLetterSize(): number {
    return this.dlq.length;
  }

  /** Remove and return all items from the dead letter queue */
  flushDeadLetters(): DeadLetterItem[] {
    return this.dlq.splice(0);
  }

  /**
   * Returns a per-user snapshot of queued (waiting) messages.
   * Only includes users that have at least one pending message.
   * `estimatedWaitMs` is computed as `averageProcessingTimeMs × pending`.
   */
  getQueueSnapshot(): Array<{ sender: string; pending: number; estimatedWaitMs: number }> {
    const result: Array<{ sender: string; pending: number; estimatedWaitMs: number }> = [];
    for (const [sender, items] of this.userQueues) {
      if (items.length > 0) {
        result.push({
          sender,
          pending: items.length,
          estimatedWaitMs: this.averageProcessingTimeMs * items.length,
        });
      }
    }
    return result;
  }
}
