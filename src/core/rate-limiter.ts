import type { RateLimitConfig } from '../types/config.js';
import { createLogger } from './logger.js';

const logger = createLogger('rate-limiter');

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class RateLimiter {
  private windowMs: number;
  private maxMessages: number;
  private enabled: boolean;
  /** sender → timestamps of recent messages */
  private readonly windows = new Map<string, number[]>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

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

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    // Allow the process to exit even if this interval is still active
    this.cleanupInterval.unref?.();
  }

  /** Remove stale window entries to prevent unbounded Map growth */
  private cleanup(): void {
    const cutoff = Date.now() - 2 * this.windowMs;
    for (const [sender, timestamps] of this.windows) {
      if (timestamps.every((t) => t < cutoff)) {
        this.windows.delete(sender);
      }
    }
  }

  /** Stop the background cleanup timer. Call from Bridge.stop(). */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
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

  /** Hot-reload rate limiter config without restarting */
  updateConfig(config: RateLimitConfig): void {
    this.enabled = config.enabled;
    this.maxMessages = config.maxMessages;
    this.windowMs = config.windowMs;

    logger.info(
      { enabled: this.enabled, maxMessages: this.maxMessages, windowMs: this.windowMs },
      'Rate limiter config reloaded',
    );
  }
}
