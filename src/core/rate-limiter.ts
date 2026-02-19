import type { RateLimitConfig } from '../types/config.js';
import { createLogger } from './logger.js';

const logger = createLogger('rate-limiter');

export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxMessages: number;
  private readonly enabled: boolean;
  /** sender → timestamps of recent messages */
  private readonly windows = new Map<string, number[]>();

  constructor(config: RateLimitConfig) {
    this.enabled = config.enabled;
    this.maxMessages = config.maxMessages;
    this.windowMs = config.windowMs;

    if (this.enabled) {
      logger.info(
        { maxMessages: this.maxMessages, windowMs: this.windowMs },
        'Rate limiter initialized',
      );
    }
  }

  /**
   * Returns true if the sender is within their allowed rate.
   * Returns false (and logs a warning) if the sender has exceeded the limit.
   */
  isAllowed(sender: string): boolean {
    if (!this.enabled) return true;

    const now = Date.now();
    const cutoff = now - this.windowMs;

    const timestamps = (this.windows.get(sender) ?? []).filter((t) => t > cutoff);
    timestamps.push(now);
    this.windows.set(sender, timestamps);

    if (timestamps.length > this.maxMessages) {
      logger.warn(
        {
          sender,
          count: timestamps.length,
          maxMessages: this.maxMessages,
          windowMs: this.windowMs,
        },
        'Rate limit exceeded',
      );
      return false;
    }

    return true;
  }
}
