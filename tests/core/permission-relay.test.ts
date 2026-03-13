import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Import SUT after mock declarations ────────────────────────────────────────

import {
  PermissionRelay,
  formatPermissionPrompt,
  isPermissionResponse,
  parsePermissionResponse,
} from '../../src/core/permission-relay.js';
import type { Connector } from '../../src/types/connector.js';
import type { OutboundMessage } from '../../src/types/message.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Flush the microtask queue so that `await connector.sendMessage()` inside
 * relayPermission resolves and the pending entry is registered in the map.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createMockConnector(): Connector & { sentMessages: OutboundMessage[] } {
  const sentMessages: OutboundMessage[] = [];
  return {
    name: 'mock',
    sentMessages,
    initialize: vi.fn(),
    sendMessage: vi.fn((msg: OutboundMessage) => {
      sentMessages.push(msg);
      return Promise.resolve();
    }),
  } as unknown as Connector & { sentMessages: OutboundMessage[] };
}

function makeRelay(timeoutMs = 200): {
  relay: PermissionRelay;
  connector: Connector & { sentMessages: OutboundMessage[] };
} {
  const connector = createMockConnector();
  const connectors = new Map<string, Connector>([['mock', connector]]);
  const relay = new PermissionRelay(() => connectors, { timeoutMs });
  return { relay, connector };
}

// ── Tests: pure formatting helpers (no timers needed) ────────────────────────

describe('formatPermissionPrompt', () => {
  it('formats a Bash command prompt', () => {
    const msg = formatPermissionPrompt('Bash', { command: 'rm -rf ./old-data/' });
    expect(msg).toContain('Permission Request');
    expect(msg).toContain('rm -rf ./old-data/');
    expect(msg).toContain('YES');
    expect(msg).toContain('NO');
  });

  it('formats a Write file prompt', () => {
    const msg = formatPermissionPrompt('Write', { file_path: '/tmp/output.txt', content: 'hello' });
    expect(msg).toContain('write to');
    expect(msg).toContain('/tmp/output.txt');
  });

  it('formats an Edit file prompt', () => {
    const msg = formatPermissionPrompt('Edit', { file_path: '/src/index.ts' });
    expect(msg).toContain('edit');
    expect(msg).toContain('/src/index.ts');
  });

  it('falls back to generic tool prompt when no command or path', () => {
    const msg = formatPermissionPrompt('Glob', { pattern: '**/*.ts' });
    expect(msg).toContain('Glob');
    expect(msg).toContain('pattern');
  });

  it('truncates long commands', () => {
    const longCmd = 'a'.repeat(300);
    const msg = formatPermissionPrompt('Bash', { command: longCmd });
    expect(msg.length).toBeLessThan(longCmd.length + 200);
    expect(msg).toContain('...');
  });
});

describe('isPermissionResponse / parsePermissionResponse', () => {
  it.each(['yes', 'YES', 'Yes', 'y', 'Y', 'allow', 'ALLOW', 'ok', 'go'])(
    'isPermissionResponse returns true for "%s"',
    (word) => {
      expect(isPermissionResponse(word)).toBe(true);
      expect(isPermissionResponse(`  ${word}  `)).toBe(true);
    },
  );

  it.each(['no', 'NO', 'No', 'n', 'N', 'deny', 'DENY', 'reject', 'cancel', 'stop'])(
    'isPermissionResponse returns true for "%s"',
    (word) => {
      expect(isPermissionResponse(word)).toBe(true);
    },
  );

  it('isPermissionResponse returns false for unrelated text', () => {
    expect(isPermissionResponse('hello')).toBe(false);
    expect(isPermissionResponse('maybe')).toBe(false);
    expect(isPermissionResponse('')).toBe(false);
  });

  it('parsePermissionResponse returns true for YES variants', () => {
    expect(parsePermissionResponse('yes')).toBe(true);
    expect(parsePermissionResponse('ALLOW')).toBe(true);
    expect(parsePermissionResponse('ok')).toBe(true);
  });

  it('parsePermissionResponse returns false for NO variants', () => {
    expect(parsePermissionResponse('no')).toBe(false);
    expect(parsePermissionResponse('DENY')).toBe(false);
    expect(parsePermissionResponse('cancel')).toBe(false);
  });

  it('parsePermissionResponse returns undefined for non-matching text', () => {
    expect(parsePermissionResponse('sure')).toBeUndefined();
    expect(parsePermissionResponse('')).toBeUndefined();
  });
});

// ── Tests: PermissionRelay class ──────────────────────────────────────────────

describe('PermissionRelay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. Sends user-friendly permission message ──────────────────────────────

  it('sends a user-friendly permission message when relaying', async () => {
    const { relay, connector } = makeRelay();

    const promise = relay.relayPermission({
      toolName: 'Bash',
      input: { command: 'rm -rf ./old-data/' },
      userId: 'user-1',
      channel: 'mock',
    });

    // Flush so sendMessage resolves and pending entry is registered
    await flushMicrotasks();

    relay.handleResponse('user-1', 'YES');
    await promise;

    expect(connector.sentMessages).toHaveLength(1);
    const sent = connector.sentMessages[0];
    expect(sent.recipient).toBe('user-1');
    expect(sent.content).toContain('Permission Request');
    expect(sent.content).toContain('rm -rf ./old-data/');
    expect(sent.metadata?.permissionRequest).toBe(true);
    expect(sent.metadata?.toolName).toBe('Bash');
  });

  // ── 2. Returns true on YES response ───────────────────────────────────────

  it('returns true when user replies YES', async () => {
    const { relay } = makeRelay();

    const promise = relay.relayPermission({
      toolName: 'Bash',
      input: { command: 'echo hello' },
      userId: 'user-yes',
      channel: 'mock',
    });

    await flushMicrotasks();
    relay.handleResponse('user-yes', 'yes');

    expect(await promise).toBe(true);
  });

  it('returns true for YES aliases', async () => {
    for (const word of ['allow', 'ALLOW', 'ok', 'go']) {
      const { relay } = makeRelay();
      const promise = relay.relayPermission({
        toolName: 'Bash',
        input: { command: 'ls' },
        userId: 'user-alias',
        channel: 'mock',
      });
      await flushMicrotasks();
      relay.handleResponse('user-alias', word);
      expect(await promise).toBe(true);
    }
  });

  // ── 3. Returns false on NO response ───────────────────────────────────────

  it('returns false when user replies NO', async () => {
    const { relay } = makeRelay();

    const promise = relay.relayPermission({
      toolName: 'Write',
      input: { file_path: '/tmp/test.txt' },
      userId: 'user-no',
      channel: 'mock',
    });

    await flushMicrotasks();
    relay.handleResponse('user-no', 'no');

    expect(await promise).toBe(false);
  });

  it('returns false for NO aliases', async () => {
    for (const word of ['deny', 'DENY', 'reject', 'cancel', 'stop', 'n']) {
      const { relay } = makeRelay();
      const promise = relay.relayPermission({
        toolName: 'Edit',
        input: { file_path: '/src/app.ts' },
        userId: 'user-deny',
        channel: 'mock',
      });
      await flushMicrotasks();
      relay.handleResponse('user-deny', word);
      expect(await promise).toBe(false);
    }
  });

  // ── 4. Auto-denies on timeout ──────────────────────────────────────────────

  it('auto-denies and sends timeout notification when user does not respond', async () => {
    const { relay, connector } = makeRelay(500);

    const promise = relay.relayPermission({
      toolName: 'Bash',
      input: { command: 'npm install' },
      userId: 'user-timeout',
      channel: 'mock',
    });

    // Flush so pending entry is registered, then advance timers
    await flushMicrotasks();
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe(false);

    // Should have sent 2 messages: initial prompt + timeout notification
    expect(connector.sentMessages).toHaveLength(2);
    expect(connector.sentMessages[1].content).toMatch(/timed out/i);
  });

  it('hasPending returns false after timeout', async () => {
    const { relay } = makeRelay(500);

    const p = relay.relayPermission({
      toolName: 'Bash',
      input: { command: 'pwd' },
      userId: 'user-pending-check',
      channel: 'mock',
    });

    await flushMicrotasks();
    expect(relay.hasPending('user-pending-check')).toBe(true);

    await vi.runAllTimersAsync();
    await p;

    expect(relay.hasPending('user-pending-check')).toBe(false);
  });

  // ── 5. Handles concurrent permission requests for the same user ───────────

  it('auto-denies a second concurrent request for the same user', async () => {
    const { relay } = makeRelay();

    // First request — will stay pending
    const first = relay.relayPermission({
      toolName: 'Bash',
      input: { command: 'ls' },
      userId: 'user-concurrent',
      channel: 'mock',
    });

    // Flush so the first request's pending entry is registered
    await flushMicrotasks();

    // Second request for the same user — should be immediately auto-denied
    const second = relay.relayPermission({
      toolName: 'Write',
      input: { file_path: '/tmp/out.txt' },
      userId: 'user-concurrent',
      channel: 'mock',
    });

    // Second should resolve false immediately (no connector call for the second)
    expect(await second).toBe(false);

    // First is still pending — resolve it
    relay.handleResponse('user-concurrent', 'YES');
    expect(await first).toBe(true);
  });

  it('pendingCount reflects current pending requests', async () => {
    const { relay } = makeRelay();

    expect(relay.pendingCount).toBe(0);

    const p1 = relay.relayPermission({
      toolName: 'Bash',
      input: { command: 'ls' },
      userId: 'user-count-a',
      channel: 'mock',
    });
    const p2 = relay.relayPermission({
      toolName: 'Bash',
      input: { command: 'pwd' },
      userId: 'user-count-b',
      channel: 'mock',
    });

    // Flush so both pending entries are registered
    await flushMicrotasks();
    await flushMicrotasks();

    expect(relay.pendingCount).toBe(2);

    relay.handleResponse('user-count-a', 'YES');
    await p1;
    expect(relay.pendingCount).toBe(1);

    relay.handleResponse('user-count-b', 'NO');
    await p2;
    expect(relay.pendingCount).toBe(0);
  });

  // ── 6. cancelAll resolves pending requests as denied ──────────────────────

  it('cancelAll resolves all pending requests as false', async () => {
    const { relay } = makeRelay();

    const p1 = relay.relayPermission({
      toolName: 'Bash',
      input: { command: 'ls' },
      userId: 'cancel-a',
      channel: 'mock',
    });
    const p2 = relay.relayPermission({
      toolName: 'Write',
      input: { file_path: '/x' },
      userId: 'cancel-b',
      channel: 'mock',
    });

    await flushMicrotasks();
    await flushMicrotasks();

    relay.cancelAll();

    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
    expect(relay.pendingCount).toBe(0);
  });

  // ── 7. handleResponse ignores non-permission text ─────────────────────────

  it('handleResponse returns false and does not consume when text is not YES/NO', async () => {
    const { relay } = makeRelay();

    const promise = relay.relayPermission({
      toolName: 'Bash',
      input: { command: 'ls' },
      userId: 'user-noisy',
      channel: 'mock',
    });

    await flushMicrotasks();

    // Non-permission reply should not consume the pending entry
    const consumed = relay.handleResponse('user-noisy', 'sure, why not?');
    expect(consumed).toBe(false);
    expect(relay.hasPending('user-noisy')).toBe(true);

    // Valid reply resolves it
    relay.handleResponse('user-noisy', 'yes');
    expect(await promise).toBe(true);
  });

  // ── 8. Auto-denies when no connector found ────────────────────────────────

  it('returns false when the specified channel has no connector', async () => {
    const emptyConnectors = new Map<string, Connector>();
    const relay = new PermissionRelay(() => emptyConnectors, { timeoutMs: 200 });

    const result = await relay.relayPermission({
      toolName: 'Bash',
      input: { command: 'ls' },
      userId: 'user-no-connector',
      channel: 'nonexistent',
    });

    expect(result).toBe(false);
  });
});
