/**
 * Unit tests for Bridge — process signal handler de-duplication (OB-1301).
 * Verifies that calling Bridge.start() twice (e.g., after a restart) does
 * NOT register duplicate process signal handlers for tunnel cleanup.
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
// Tests — registerTunnelShutdownHandlers() guard behaviour
// ---------------------------------------------------------------------------

describe('Bridge — signal handler de-duplication (OB-1301)', () => {
  let onceSpy: ReturnType<typeof vi.spyOn>;
  let onSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    onceSpy = vi.spyOn(process, 'once');
    onSpy = vi.spyOn(process, 'on');
  });

  afterEach(() => {
    onceSpy.mockRestore();
    onSpy.mockRestore();
  });

  it('registers exactly one exit handler on the first call', () => {
    const bridge = new Bridge(baseConfig(), { tunnelTool: 'cloudflared' });

    const exitBefore = onceSpy.mock.calls.filter(([e]) => e === 'exit').length;

    (
      bridge as unknown as { registerTunnelShutdownHandlers(): void }
    ).registerTunnelShutdownHandlers();

    const exitAfter = onceSpy.mock.calls.filter(([e]) => e === 'exit').length;
    expect(exitAfter - exitBefore).toBe(1);
  });

  it('registers exactly one SIGINT handler on the first call', () => {
    const bridge = new Bridge(baseConfig(), { tunnelTool: 'cloudflared' });

    const sigintBefore = onSpy.mock.calls.filter(([e]) => e === 'SIGINT').length;

    (
      bridge as unknown as { registerTunnelShutdownHandlers(): void }
    ).registerTunnelShutdownHandlers();

    const sigintAfter = onSpy.mock.calls.filter(([e]) => e === 'SIGINT').length;
    expect(sigintAfter - sigintBefore).toBe(1);
  });

  it('does not add a second exit handler when called twice (duplicate-start guard)', () => {
    const bridge = new Bridge(baseConfig(), { tunnelTool: 'cloudflared' });
    const type = bridge as unknown as { registerTunnelShutdownHandlers(): void };

    const exitBefore = onceSpy.mock.calls.filter(([e]) => e === 'exit').length;

    type.registerTunnelShutdownHandlers();
    type.registerTunnelShutdownHandlers(); // second call — must be a no-op

    const exitAfter = onceSpy.mock.calls.filter(([e]) => e === 'exit').length;
    expect(exitAfter - exitBefore).toBe(1);
  });

  it('does not add a second SIGINT handler when called twice (duplicate-start guard)', () => {
    const bridge = new Bridge(baseConfig(), { tunnelTool: 'cloudflared' });
    const type = bridge as unknown as { registerTunnelShutdownHandlers(): void };

    const sigintBefore = onSpy.mock.calls.filter(([e]) => e === 'SIGINT').length;

    type.registerTunnelShutdownHandlers();
    type.registerTunnelShutdownHandlers(); // second call — must be a no-op

    const sigintAfter = onSpy.mock.calls.filter(([e]) => e === 'SIGINT').length;
    expect(sigintAfter - sigintBefore).toBe(1);
  });

  it('is a no-op when tunnelManager is not set (no tunnelTool option)', () => {
    const bridge = new Bridge(baseConfig());
    const type = bridge as unknown as { registerTunnelShutdownHandlers(): void };

    const exitBefore = onceSpy.mock.calls.filter(([e]) => e === 'exit').length;
    const sigintBefore = onSpy.mock.calls.filter(([e]) => e === 'SIGINT').length;

    type.registerTunnelShutdownHandlers();

    const exitAfter = onceSpy.mock.calls.filter(([e]) => e === 'exit').length;
    const sigintAfter = onSpy.mock.calls.filter(([e]) => e === 'SIGINT').length;

    expect(exitAfter - exitBefore).toBe(0);
    expect(sigintAfter - sigintBefore).toBe(0);
  });

  it('clears stored handler references after clearTunnelShutdownHandlers()', () => {
    const bridge = new Bridge(baseConfig(), { tunnelTool: 'cloudflared' });
    const removeListenerSpy = vi.spyOn(process, 'removeListener');

    const type = bridge as unknown as {
      registerTunnelShutdownHandlers(): void;
      clearTunnelShutdownHandlers(): void;
      tunnelExitHandler: (() => void) | null;
      tunnelSigintHandler: (() => void) | null;
    };

    type.registerTunnelShutdownHandlers();

    // Handlers must have been stored
    expect(type.tunnelExitHandler).not.toBeNull();
    expect(type.tunnelSigintHandler).not.toBeNull();

    type.clearTunnelShutdownHandlers();

    // process.removeListener must have been called for both events
    const exitRemovals = removeListenerSpy.mock.calls.filter(([e]) => e === 'exit').length;
    const sigintRemovals = removeListenerSpy.mock.calls.filter(([e]) => e === 'SIGINT').length;
    expect(exitRemovals).toBe(1);
    expect(sigintRemovals).toBe(1);

    // References must be nullified so a future start() re-registers cleanly
    expect(type.tunnelExitHandler).toBeNull();
    expect(type.tunnelSigintHandler).toBeNull();

    removeListenerSpy.mockRestore();
  });

  it('re-registers handlers after stop() clears them (restart pattern)', () => {
    const bridge = new Bridge(baseConfig(), { tunnelTool: 'cloudflared' });
    const type = bridge as unknown as {
      registerTunnelShutdownHandlers(): void;
      clearTunnelShutdownHandlers(): void;
    };

    // Simulate first start
    type.registerTunnelShutdownHandlers();
    const exitAfterFirst = onceSpy.mock.calls.filter(([e]) => e === 'exit').length;
    const sigintAfterFirst = onSpy.mock.calls.filter(([e]) => e === 'SIGINT').length;

    // Simulate stop (clears handlers)
    type.clearTunnelShutdownHandlers();

    // Simulate second start — should re-register
    type.registerTunnelShutdownHandlers();
    const exitAfterSecond = onceSpy.mock.calls.filter(([e]) => e === 'exit').length;
    const sigintAfterSecond = onSpy.mock.calls.filter(([e]) => e === 'SIGINT').length;

    // One new handler added in each start cycle
    expect(exitAfterSecond - exitAfterFirst).toBe(1);
    expect(sigintAfterSecond - sigintAfterFirst).toBe(1);
  });
});
