import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter } from '../../src/core/rate-limiter.js';

describe('RateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('should allow messages within the limit', () => {
    const limiter = new RateLimiter({ enabled: true, maxMessages: 3, windowMs: 60_000 });
    expect(limiter.isAllowed('+1234567890')).toBe(true);
    expect(limiter.isAllowed('+1234567890')).toBe(true);
    expect(limiter.isAllowed('+1234567890')).toBe(true);
  });

  it('should block messages that exceed the limit', () => {
    const limiter = new RateLimiter({ enabled: true, maxMessages: 2, windowMs: 60_000 });
    expect(limiter.isAllowed('+1234567890')).toBe(true);
    expect(limiter.isAllowed('+1234567890')).toBe(true);
    expect(limiter.isAllowed('+1234567890')).toBe(false);
  });

  it('should track limits per sender independently', () => {
    const limiter = new RateLimiter({ enabled: true, maxMessages: 1, windowMs: 60_000 });
    expect(limiter.isAllowed('+1111111111')).toBe(true);
    expect(limiter.isAllowed('+2222222222')).toBe(true);
    // both senders used their 1 message — next should be blocked
    expect(limiter.isAllowed('+1111111111')).toBe(false);
    expect(limiter.isAllowed('+2222222222')).toBe(false);
  });

  it('should reset after the time window expires', () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter({ enabled: true, maxMessages: 1, windowMs: 1_000 });

    expect(limiter.isAllowed('+1234567890')).toBe(true);
    expect(limiter.isAllowed('+1234567890')).toBe(false);

    // Advance past the window
    vi.advanceTimersByTime(1_001);

    expect(limiter.isAllowed('+1234567890')).toBe(true);
  });

  it('should allow all messages when disabled', () => {
    const limiter = new RateLimiter({ enabled: false, maxMessages: 1, windowMs: 60_000 });
    for (let i = 0; i < 100; i++) {
      expect(limiter.isAllowed('+1234567890')).toBe(true);
    }
  });
});
