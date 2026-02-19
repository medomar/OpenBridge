import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../../src/providers/claude-code/session-manager.js';

describe('SessionManager', () => {
  const TTL = 30_000; // 30 seconds for tests
  let manager: SessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new SessionManager(TTL);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a new session for an unknown sender', () => {
    const result = manager.getOrCreate('+1234567890');

    expect(result.isNew).toBe(true);
    expect(result.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('returns the same session for the same sender within TTL', () => {
    const first = manager.getOrCreate('+1234567890');
    vi.advanceTimersByTime(TTL - 1);
    const second = manager.getOrCreate('+1234567890');

    expect(second.isNew).toBe(false);
    expect(second.sessionId).toBe(first.sessionId);
  });

  it('creates a new session after TTL expires', () => {
    const first = manager.getOrCreate('+1234567890');
    vi.advanceTimersByTime(TTL);
    const second = manager.getOrCreate('+1234567890');

    expect(second.isNew).toBe(true);
    expect(second.sessionId).not.toBe(first.sessionId);
  });

  it('maintains separate sessions for different senders', () => {
    const alice = manager.getOrCreate('+1111111111');
    const bob = manager.getOrCreate('+2222222222');

    expect(alice.sessionId).not.toBe(bob.sessionId);
    expect(manager.size).toBe(2);
  });

  it('refreshes lastUsed on access within TTL', () => {
    const first = manager.getOrCreate('+1234567890');
    vi.advanceTimersByTime(TTL - 1);
    manager.getOrCreate('+1234567890'); // refreshes
    vi.advanceTimersByTime(TTL - 1);
    const third = manager.getOrCreate('+1234567890');

    expect(third.isNew).toBe(false);
    expect(third.sessionId).toBe(first.sessionId);
  });

  it('clear() removes a specific sender session', () => {
    manager.getOrCreate('+1234567890');
    expect(manager.size).toBe(1);

    manager.clear('+1234567890');
    expect(manager.size).toBe(0);

    const result = manager.getOrCreate('+1234567890');
    expect(result.isNew).toBe(true);
  });

  it('clearAll() removes all sessions', () => {
    manager.getOrCreate('+1111111111');
    manager.getOrCreate('+2222222222');
    expect(manager.size).toBe(2);

    manager.clearAll();
    expect(manager.size).toBe(0);
  });

  it('evictExpired() removes only expired sessions', () => {
    manager.getOrCreate('+1111111111');
    vi.advanceTimersByTime(TTL);
    manager.getOrCreate('+2222222222'); // fresh

    const evicted = manager.evictExpired();

    expect(evicted).toBe(1);
    expect(manager.size).toBe(1);
  });

  it('evictExpired() returns 0 when no sessions are expired', () => {
    manager.getOrCreate('+1234567890');
    const evicted = manager.evictExpired();
    expect(evicted).toBe(0);
  });

  it('size returns current session count', () => {
    expect(manager.size).toBe(0);
    manager.getOrCreate('+1111111111');
    expect(manager.size).toBe(1);
    manager.getOrCreate('+2222222222');
    expect(manager.size).toBe(2);
  });
});
