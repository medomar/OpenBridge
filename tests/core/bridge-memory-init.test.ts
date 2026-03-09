/**
 * Unit tests for Bridge — MemoryManager init failure paths (OB-1295).
 * Verifies that when MemoryManager.init() rejects, the eviction interval
 * is NOT set and no null-pointer errors occur.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bridge } from '../../src/core/bridge.js';
import type { AppConfig } from '../../src/types/config.js';

// ---------------------------------------------------------------------------
// Config fixture
// ---------------------------------------------------------------------------

function baseConfig(): AppConfig {
  return {
    defaultProvider: 'mock',
    connectors: [],
    providers: [],
    auth: {
      whitelist: ['+1234567890'],
      prefix: '/ai',
      rateLimit: { enabled: false, windowMs: 60000, maxMessages: 5 },
    },
    queue: { maxRetries: 0, retryDelayMs: 1 },
    audit: { enabled: false, logPath: 'audit.log' },
    logLevel: 'info',
  };
}

// ---------------------------------------------------------------------------
// Mock MemoryManager
// ---------------------------------------------------------------------------

vi.mock('../../src/memory/index.js', () => {
  return {
    MemoryManager: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockRejectedValue(new Error('SQLite init failed')),
      migrate: vi.fn().mockResolvedValue(undefined),
      evictOldData: vi.fn().mockResolvedValue(undefined),
      getDb: vi.fn().mockReturnValue(null),
      close: vi.fn().mockResolvedValue(undefined),
      closeActiveSessions: vi.fn().mockResolvedValue(undefined),
      getPromptManifest: vi.fn().mockResolvedValue(null),
      getActiveAgents: vi.fn().mockResolvedValue([]),
      getDailyCost: vi.fn().mockResolvedValue(0),
    })),
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bridge — MemoryManager init failure', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it('does not throw when MemoryManager.init() rejects', async () => {
    const bridge = new Bridge(baseConfig(), { workspacePath: '/fake/workspace' });
    await expect(bridge.start()).resolves.toBeUndefined();
    await bridge.stop();
  });

  it('sets memory to null after init() failure', async () => {
    const bridge = new Bridge(baseConfig(), { workspacePath: '/fake/workspace' });
    await bridge.start();

    // After failed init, getMemory() must return null
    expect(bridge.getMemory()).toBeNull();

    await bridge.stop();
  });

  it('does NOT set eviction interval when init() fails', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const bridge = new Bridge(baseConfig(), { workspacePath: '/fake/workspace' });
    await bridge.start();

    // The eviction setInterval (24h interval) must not have been called
    const evictionCalls = setIntervalSpy.mock.calls.filter(
      (call) => call[1] === 24 * 60 * 60 * 1000,
    );
    expect(evictionCalls.length).toBe(0);

    await bridge.stop();
  });

  it('evictOldData is never called when init() fails', async () => {
    // Track whether evictOldData is ever invoked by monitoring setInterval
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    const bridge = new Bridge(baseConfig(), { workspacePath: '/fake/workspace' });
    await bridge.start();

    // Advance time well past the eviction interval
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000);

    // No 24-hour eviction interval should have been registered
    const evictionCalls = setIntervalSpy.mock.calls.filter(
      (call) => call[1] === 24 * 60 * 60 * 1000,
    );
    expect(evictionCalls.length).toBe(0);

    await bridge.stop();
  });

  it('stop() completes cleanly after failed init (no null-pointer errors)', async () => {
    const bridge = new Bridge(baseConfig(), { workspacePath: '/fake/workspace' });
    await bridge.start();

    // stop() must not throw even though memory is null
    await expect(bridge.stop()).resolves.toBeUndefined();
  });
});
