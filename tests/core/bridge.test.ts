/**
 * Unit tests for Bridge — covers connector init failure paths and stop() edge cases.
 * Targets lines uncovered by integration tests (OB-635).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bridge } from '../../src/core/bridge.js';
import { MockConnector } from '../helpers/mock-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { Connector, ConnectorEvents } from '../../src/types/connector.js';
import type { OutboundMessage } from '../../src/types/message.js';
import type { AppConfig } from '../../src/types/config.js';

// ---------------------------------------------------------------------------
// fs/promises mock — used by cleanLegacyDotFolderArtifacts tests (OB-1648)
// ---------------------------------------------------------------------------

const mockFsAccess = vi.fn<() => Promise<void>>();
const mockFsUnlink = vi.fn<() => Promise<void>>();
const mockFsReadFile = vi.fn<() => Promise<string>>();
const mockFsRm = vi.fn<() => Promise<void>>();
const mockFsReaddir = vi.fn<() => Promise<string[]>>();

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockFsAccess(...args),
  unlink: (...args: unknown[]) => mockFsUnlink(...args),
  readFile: (...args: unknown[]) => mockFsReadFile(...args),
  rm: (...args: unknown[]) => mockFsRm(...args),
  readdir: (...args: unknown[]) => mockFsReaddir(...args),
}));

// ---------------------------------------------------------------------------
// Config fixture
// ---------------------------------------------------------------------------

function baseConfig(): AppConfig {
  return {
    defaultProvider: 'mock',
    connectors: [{ type: 'mock', enabled: true, options: {} }],
    providers: [{ type: 'mock', enabled: true, options: {} }],
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
// Minimal failing connector stub
// ---------------------------------------------------------------------------

class FailingConnector implements Connector {
  readonly name = 'failing';
  private readonly listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  async initialize(): Promise<void> {
    throw new Error('Connector startup failed');
  }

  async sendMessage(_msg: OutboundMessage): Promise<void> {}

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(listener as (...args: unknown[]) => void);
  }

  async shutdown(): Promise<void> {}

  isConnected(): boolean {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Connector init failure
// ---------------------------------------------------------------------------

describe('Bridge — connector init failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('continues starting other connectors when one fails to initialize', async () => {
    const config: AppConfig = {
      ...baseConfig(),
      connectors: [
        { type: 'failing', enabled: true, options: {} },
        { type: 'mock', enabled: true, options: {} },
      ],
    };

    const goodConnector = new MockConnector();
    const bridge = new Bridge(config);
    bridge.getRegistry().registerConnector('failing', () => new FailingConnector());
    bridge.getRegistry().registerConnector('mock', () => goodConnector);
    bridge.getRegistry().registerProvider('mock', () => new MockProvider());

    // Should NOT throw even though one connector fails
    await expect(bridge.start()).resolves.toBeUndefined();

    // Clean up
    await bridge.stop();
  });

  it('does not add the failed connector to the router', async () => {
    const config: AppConfig = {
      ...baseConfig(),
      connectors: [
        { type: 'failing', enabled: true, options: {} },
        { type: 'mock', enabled: true, options: {} },
      ],
    };

    const goodConnector = new MockConnector();
    const bridge = new Bridge(config);
    bridge.getRegistry().registerConnector('failing', () => new FailingConnector());
    bridge.getRegistry().registerConnector('mock', () => goodConnector);
    bridge.getRegistry().registerProvider('mock', () => new MockProvider());

    await bridge.start();

    // The good connector is ready, the failing one was not added
    expect(goodConnector.isConnected()).toBe(true);

    await bridge.stop();
  });
});

// ---------------------------------------------------------------------------
// Bridge.stop() edge cases
// ---------------------------------------------------------------------------

describe('Bridge.stop() — edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is idempotent — second stop() call is a no-op', async () => {
    const bridge = new Bridge(baseConfig());
    const connector = new MockConnector();
    const provider = new MockProvider();
    bridge.getRegistry().registerConnector('mock', () => connector);
    bridge.getRegistry().registerProvider('mock', () => provider);

    await bridge.start();

    await bridge.stop();
    // Second call should resolve without throwing
    await expect(bridge.stop()).resolves.toBeUndefined();
  });

  it('stops cleanly when no connectors were registered', async () => {
    const config: AppConfig = {
      ...baseConfig(),
      connectors: [], // no connectors
      providers: [],
    };

    const bridge = new Bridge(config);

    await bridge.start();
    await expect(bridge.stop()).resolves.toBeUndefined();
  });

  it('continues shutdown when a provider shutdown throws', async () => {
    // V0 mode: providers registered directly (no master)
    const config: AppConfig = {
      ...baseConfig(),
      connectors: [],
    };

    const provider = new MockProvider();
    // Override shutdown to throw
    provider.shutdown = vi.fn().mockRejectedValue(new Error('Provider shutdown error'));

    const bridge = new Bridge(config);
    bridge.getRegistry().registerProvider('mock', () => provider);

    await bridge.start();

    // Should NOT rethrow — errors during provider shutdown are logged and swallowed
    await expect(bridge.stop()).resolves.toBeUndefined();
  });

  it('respects drainTimeoutMs — proceeds after drain timeout', async () => {
    vi.useFakeTimers();

    const bridge = new Bridge(baseConfig(), { drainTimeoutMs: 100 });
    const connector = new MockConnector();
    const provider = new MockProvider();
    bridge.getRegistry().registerConnector('mock', () => connector);
    bridge.getRegistry().registerProvider('mock', () => provider);

    await bridge.start();

    const stopPromise = bridge.stop();
    // Advance past the drain timeout
    await vi.advanceTimersByTimeAsync(200);
    await stopPromise;

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// cleanLegacyDotFolderArtifacts — exploration/ guard (OB-1648)
// ---------------------------------------------------------------------------

describe('cleanLegacyDotFolderArtifacts — exploration/ guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all fs operations succeed (files/dirs don't exist paths will be caught)
    mockFsAccess.mockResolvedValue(undefined);
    mockFsUnlink.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    mockFsRm.mockResolvedValue(undefined);
    mockFsReaddir.mockResolvedValue([]);
  });

  it('skips exploration/ deletion when state is incomplete', async () => {
    // exploration-state.json reports status "structure_scan" — exploration in progress
    mockFsReadFile.mockResolvedValue(JSON.stringify({ status: 'structure_scan' }));

    const memory = { getPromptManifest: vi.fn().mockResolvedValue(null) };
    const bridge = new Bridge(baseConfig());

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await (bridge as any).cleanLegacyDotFolderArtifacts('/fake/workspace', memory);

    // fs.rm must NOT have been called for the exploration/ path
    const explorationRm = mockFsRm.mock.calls.find((args) =>
      String(args[0]).includes('exploration'),
    );
    expect(explorationRm).toBeUndefined();
  });

  it('deletes exploration/ when state is completed', async () => {
    // exploration-state.json reports status "completed" — safe to delete
    mockFsReadFile.mockResolvedValue(JSON.stringify({ status: 'completed' }));

    const memory = { getPromptManifest: vi.fn().mockResolvedValue(null) };
    const bridge = new Bridge(baseConfig());

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    await (bridge as any).cleanLegacyDotFolderArtifacts('/fake/workspace', memory);

    // fs.rm MUST have been called for the exploration/ path
    const explorationRm = mockFsRm.mock.calls.find((args) =>
      String(args[0]).includes('exploration'),
    );
    expect(explorationRm).toBeDefined();
  });
});
