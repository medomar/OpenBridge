import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CodexSessionManager } from '../../../src/providers/codex/session-manager.js';

describe('CodexSessionManager', () => {
  const TTL = 30_000; // 30 seconds for tests
  let manager: CodexSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new CodexSessionManager(TTL);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // getOrCreate()
  // -----------------------------------------------------------------------

  describe('getOrCreate()', () => {
    it('returns isNew: true for an unknown key', () => {
      const result = manager.getOrCreate('user1:/workspace');
      expect(result.isNew).toBe(true);
    });

    it('returns no sessionId for a brand-new session', () => {
      const result = manager.getOrCreate('user1:/workspace');
      expect(result.sessionId).toBeUndefined();
    });

    it('returns isNew: false for the same key within TTL', () => {
      manager.getOrCreate('user1:/workspace');
      vi.advanceTimersByTime(TTL - 1);
      const second = manager.getOrCreate('user1:/workspace');
      expect(second.isNew).toBe(false);
    });

    it('returns isNew: true after TTL expires', () => {
      manager.getOrCreate('user1:/workspace');
      vi.advanceTimersByTime(TTL);
      const second = manager.getOrCreate('user1:/workspace');
      expect(second.isNew).toBe(true);
    });

    it('refreshes lastUsed on access within TTL', () => {
      manager.getOrCreate('user1:/workspace');
      vi.advanceTimersByTime(TTL - 1); // near expiry
      manager.getOrCreate('user1:/workspace'); // refreshes
      vi.advanceTimersByTime(TTL - 1); // would have expired without refresh
      const third = manager.getOrCreate('user1:/workspace');
      expect(third.isNew).toBe(false);
    });

    it('maintains separate sessions for different keys', () => {
      const a = manager.getOrCreate('alice:/workspace-a');
      const b = manager.getOrCreate('bob:/workspace-b');
      expect(a.isNew).toBe(true);
      expect(b.isNew).toBe(true);
      expect(manager.size).toBe(2);
    });

    it('returns stored sessionId when updateSessionId() was called', () => {
      manager.getOrCreate('user1:/workspace');
      manager.updateSessionId('user1:/workspace', 'explicit-session-abc');

      const result = manager.getOrCreate('user1:/workspace');
      expect(result.isNew).toBe(false);
      expect(result.sessionId).toBe('explicit-session-abc');
    });

    it('does not return sessionId from an expired session', () => {
      manager.getOrCreate('user1:/workspace');
      manager.updateSessionId('user1:/workspace', 'explicit-session-abc');
      vi.advanceTimersByTime(TTL); // expire
      const result = manager.getOrCreate('user1:/workspace');
      expect(result.isNew).toBe(true);
      expect(result.sessionId).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // updateSessionId()
  // -----------------------------------------------------------------------

  describe('updateSessionId()', () => {
    it('stores sessionId for a known key', () => {
      manager.getOrCreate('user1:/workspace');
      manager.updateSessionId('user1:/workspace', 'session-xyz');
      const result = manager.getOrCreate('user1:/workspace');
      expect(result.sessionId).toBe('session-xyz');
    });

    it('is a no-op for an unknown key (does not create entry)', () => {
      manager.updateSessionId('user1:/workspace', 'session-xyz');
      expect(manager.size).toBe(0);
    });

    it('overwrites a previously set sessionId', () => {
      manager.getOrCreate('user1:/workspace');
      manager.updateSessionId('user1:/workspace', 'session-first');
      manager.updateSessionId('user1:/workspace', 'session-second');
      const result = manager.getOrCreate('user1:/workspace');
      expect(result.sessionId).toBe('session-second');
    });
  });

  // -----------------------------------------------------------------------
  // clear()
  // -----------------------------------------------------------------------

  describe('clear()', () => {
    it('removes a specific session', () => {
      manager.getOrCreate('user1:/workspace');
      expect(manager.size).toBe(1);
      manager.clear('user1:/workspace');
      expect(manager.size).toBe(0);
    });

    it('next call after clear() returns isNew: true', () => {
      manager.getOrCreate('user1:/workspace');
      manager.clear('user1:/workspace');
      const result = manager.getOrCreate('user1:/workspace');
      expect(result.isNew).toBe(true);
    });

    it('does not affect other sessions', () => {
      manager.getOrCreate('user1:/workspace-a');
      manager.getOrCreate('user2:/workspace-b');
      manager.clear('user1:/workspace-a');
      expect(manager.size).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // clearAll()
  // -----------------------------------------------------------------------

  describe('clearAll()', () => {
    it('removes all sessions', () => {
      manager.getOrCreate('user1:/workspace');
      manager.getOrCreate('user2:/workspace');
      expect(manager.size).toBe(2);
      manager.clearAll();
      expect(manager.size).toBe(0);
    });

    it('is safe to call on an empty manager', () => {
      expect(() => manager.clearAll()).not.toThrow();
      expect(manager.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // evictExpired()
  // -----------------------------------------------------------------------

  describe('evictExpired()', () => {
    it('removes sessions that exceeded TTL', () => {
      manager.getOrCreate('user1:/workspace');
      vi.advanceTimersByTime(TTL);
      manager.getOrCreate('user2:/workspace'); // fresh
      const evicted = manager.evictExpired();
      expect(evicted).toBe(1);
      expect(manager.size).toBe(1);
    });

    it('returns 0 when no sessions are expired', () => {
      manager.getOrCreate('user1:/workspace');
      const evicted = manager.evictExpired();
      expect(evicted).toBe(0);
    });

    it('returns 0 when manager is empty', () => {
      expect(manager.evictExpired()).toBe(0);
    });

    it('evicts all sessions when all are expired', () => {
      manager.getOrCreate('user1:/workspace');
      manager.getOrCreate('user2:/workspace');
      vi.advanceTimersByTime(TTL);
      const evicted = manager.evictExpired();
      expect(evicted).toBe(2);
      expect(manager.size).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // size
  // -----------------------------------------------------------------------

  describe('size', () => {
    it('returns 0 for empty manager', () => {
      expect(manager.size).toBe(0);
    });

    it('increments on each new getOrCreate()', () => {
      manager.getOrCreate('user1:/workspace');
      expect(manager.size).toBe(1);
      manager.getOrCreate('user2:/workspace');
      expect(manager.size).toBe(2);
    });

    it('does not increment when same key accessed again', () => {
      manager.getOrCreate('user1:/workspace');
      manager.getOrCreate('user1:/workspace');
      expect(manager.size).toBe(1);
    });
  });
});
