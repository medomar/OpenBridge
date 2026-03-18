/**
 * Integration test: full permission flow.
 *
 * Tests the end-to-end flow from SDK adapter's canUseTool callback through
 * the permission relay to the messaging connector, and back.
 *
 * @see OB-1505, OB-F183
 */

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

// ── Mock @anthropic-ai/claude-agent-sdk ───────────────────────────────────────

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { ClaudeSDKAdapter } from '../../src/core/adapters/claude-sdk.js';
import { PermissionRelay } from '../../src/core/permission-relay.js';
import { AdapterRegistry } from '../../src/core/adapter-registry.js';
import type { Connector } from '../../src/types/connector.js';
import type { OutboundMessage } from '../../src/types/message.js';
import type { PermissionRelayFn } from '../../src/core/adapters/claude-sdk.js';
import type { CLIAdapter } from '../../src/core/cli-adapter.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Flush microtask queue so async sendMessage inside relayPermission resolves
 * and the pending entry is registered in the map.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Integration: full permission flow', () => {
  let adapter: ClaudeSDKAdapter;
  let relay: PermissionRelay;
  let connector: Connector & { sentMessages: OutboundMessage[] };
  let connectors: Map<string, Connector>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    adapter = new ClaudeSDKAdapter();
    connector = createMockConnector();
    connectors = new Map<string, Connector>([['webchat', connector]]);
    relay = new PermissionRelay(() => connectors, { timeoutMs: 5_000 });
  });

  afterEach(() => {
    relay.cancelAll();
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  describe('SDK adapter → canUseTool → permission relay → user YES → tool allowed', () => {
    it('routes a non-allowed tool through permission relay and approves on YES', async () => {
      // Build canUseTool with relay bound
      const relayFn: PermissionRelayFn = (params) =>
        relay.relayPermission({
          toolName: params.toolName,
          input: params.input,
          userId: params.userId,
          channel: params.channel,
        });

      const canUseTool = adapter.buildCanUseTool(
        ['Read', 'Glob', 'Grep'],
        relayFn,
        'user-1',
        'webchat',
      );

      // Trigger a non-allowed tool call (Bash)
      const permissionPromise = canUseTool('Bash', { command: 'npm run build' }, {} as never);

      // Let async sendMessage inside relay resolve
      await flushMicrotasks();

      // Verify the permission prompt was sent through the connector
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('Permission Request');
      expect(connector.sentMessages[0]!.content).toContain('npm run build');
      expect(connector.sentMessages[0]!.recipient).toBe('user-1');

      // Verify a pending permission exists
      expect(relay.hasPending('user-1')).toBe(true);

      // Simulate user replying "YES" — as the router would do
      const consumed = relay.handleResponse('user-1', 'YES');
      expect(consumed).toBe(true);

      // The permission promise should now resolve to allow
      const result = await permissionPromise;
      expect(result).toEqual({ behavior: 'allow', updatedInput: { command: 'npm run build' } });

      // No more pending
      expect(relay.hasPending('user-1')).toBe(false);
    });
  });

  describe('SDK adapter → canUseTool → permission relay → user NO → tool denied', () => {
    it('denies the tool when user replies NO', async () => {
      const relayFn: PermissionRelayFn = (params) =>
        relay.relayPermission({
          toolName: params.toolName,
          input: params.input,
          userId: params.userId,
          channel: params.channel,
        });

      const canUseTool = adapter.buildCanUseTool(['Read'], relayFn, 'user-1', 'webchat');

      const permissionPromise = canUseTool(
        'Write',
        { file_path: '/src/secret.ts', content: 'x' },
        {} as never,
      );
      await flushMicrotasks();

      // Verify prompt was sent
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('write to');
      expect(connector.sentMessages[0]!.content).toContain('/src/secret.ts');

      // User denies
      const consumed = relay.handleResponse('user-1', 'no');
      expect(consumed).toBe(true);

      const result = await permissionPromise;
      expect(result).toEqual({
        behavior: 'deny',
        message: 'User denied via messaging channel',
      });
    });
  });

  describe('timeout → auto-deny', () => {
    it('auto-denies when user does not respond within timeout', async () => {
      const relayFn: PermissionRelayFn = (params) =>
        relay.relayPermission({
          toolName: params.toolName,
          input: params.input,
          userId: params.userId,
          channel: params.channel,
        });

      const canUseTool = adapter.buildCanUseTool(['Read'], relayFn, 'user-2', 'webchat');

      const permissionPromise = canUseTool('Bash', { command: 'rm -rf /tmp/data' }, {} as never);
      await flushMicrotasks();

      // Permission prompt sent
      expect(connector.sentMessages).toHaveLength(1);
      expect(relay.hasPending('user-2')).toBe(true);

      // Advance time past the timeout (5 seconds configured above)
      await vi.advanceTimersByTimeAsync(5_001);

      const result = await permissionPromise;
      expect(result).toEqual({
        behavior: 'deny',
        message: 'User denied via messaging channel',
      });

      // Timeout notification was sent
      expect(connector.sentMessages).toHaveLength(2);
      expect(connector.sentMessages[1]!.content).toContain('timed out');

      // No more pending
      expect(relay.hasPending('user-2')).toBe(false);
    });
  });

  describe('/trust auto → CLI adapter used (no prompts)', () => {
    it('selects CLI adapter for trust=auto — no permission relay involved', () => {
      const registry = new AdapterRegistry();
      // Register both adapters
      const cliAdapter = { name: 'claude', isSDKAdapter: () => false } as unknown as CLIAdapter;
      const sdkAdapter = { name: 'claude-sdk', isSDKAdapter: () => true } as unknown as CLIAdapter;
      registry.register('claude', cliAdapter);
      registry.register('claude-sdk', sdkAdapter);

      // trust=auto → CLI adapter
      const autoAdapter = registry.getForTrustLevel('claude', 'auto');
      expect(autoAdapter).toBe(cliAdapter);
      expect(autoAdapter!.name).toBe('claude');

      // trust=edit → SDK adapter
      const editAdapter = registry.getForTrustLevel('claude', 'edit');
      expect(editAdapter).toBe(sdkAdapter);
      expect(editAdapter!.name).toBe('claude-sdk');

      // trust=ask → SDK adapter
      const askAdapter = registry.getForTrustLevel('claude', 'ask');
      expect(askAdapter).toBe(sdkAdapter);
      expect(askAdapter!.name).toBe('claude-sdk');
    });

    it('auto-approves allowed tools without relay when no permissionRelay is set', async () => {
      // In trust=auto mode, the CLI adapter is used but even if the SDK adapter
      // were used, tools in the allowed list are auto-approved without relay.
      const canUseTool = adapter.buildCanUseTool(['Read', 'Glob', 'Grep', 'Bash(*)']);

      // Allowed tool → auto-approve
      const readResult = await canUseTool('Read', {}, {} as never);
      expect(readResult).toEqual({ behavior: 'allow' });

      // Bash wildcard → auto-approve
      const bashResult = await canUseTool('Bash', { command: 'ls' }, {} as never);
      expect(bashResult).toEqual({ behavior: 'allow' });

      // No messages sent — no relay involved
      expect(connector.sentMessages).toHaveLength(0);
    });

    it('denies non-allowed tools when no permissionRelay is set', async () => {
      const canUseTool = adapter.buildCanUseTool(['Read', 'Glob']);

      const result = await canUseTool('Write', { file_path: '/test.txt' }, {} as never);
      expect(result.behavior).toBe('deny');
      expect(connector.sentMessages).toHaveLength(0);
    });
  });

  describe('concurrent permission requests', () => {
    it('auto-denies a second request while one is pending for same user', async () => {
      const relayFn: PermissionRelayFn = (params) =>
        relay.relayPermission({
          toolName: params.toolName,
          input: params.input,
          userId: params.userId,
          channel: params.channel,
        });

      const canUseTool = adapter.buildCanUseTool([], relayFn, 'user-3', 'webchat');

      // First tool call — starts pending
      const firstPromise = canUseTool('Bash', { command: 'echo first' }, {} as never);
      await flushMicrotasks();
      expect(relay.hasPending('user-3')).toBe(true);

      // Second tool call — auto-denied because first is still pending
      const secondPromise = canUseTool('Write', { file_path: '/x.txt' }, {} as never);
      await flushMicrotasks();

      const secondResult = await secondPromise;
      expect(secondResult).toEqual({
        behavior: 'deny',
        message: 'User denied via messaging channel',
      });

      // First is still pending — only 1 prompt was sent
      expect(connector.sentMessages).toHaveLength(1);
      expect(connector.sentMessages[0]!.content).toContain('echo first');

      // Resolve the first
      relay.handleResponse('user-3', 'yes');
      const firstResult = await firstPromise;
      expect(firstResult.behavior).toBe('allow');
    });

    it('allows requests from different users concurrently', async () => {
      const relayFnA: PermissionRelayFn = (params) =>
        relay.relayPermission({
          toolName: params.toolName,
          input: params.input,
          userId: params.userId,
          channel: params.channel,
        });
      const relayFnB: PermissionRelayFn = (params) =>
        relay.relayPermission({
          toolName: params.toolName,
          input: params.input,
          userId: params.userId,
          channel: params.channel,
        });

      const canUseToolA = adapter.buildCanUseTool([], relayFnA, 'user-A', 'webchat');
      const canUseToolB = adapter.buildCanUseTool([], relayFnB, 'user-B', 'webchat');

      const promiseA = canUseToolA('Bash', { command: 'cmd-A' }, {} as never);
      await flushMicrotasks();
      const promiseB = canUseToolB('Bash', { command: 'cmd-B' }, {} as never);
      await flushMicrotasks();

      // Both pending — different users
      expect(relay.hasPending('user-A')).toBe(true);
      expect(relay.hasPending('user-B')).toBe(true);
      expect(connector.sentMessages).toHaveLength(2);

      // Resolve in reverse order
      relay.handleResponse('user-B', 'yes');
      relay.handleResponse('user-A', 'no');

      const resultA = await promiseA;
      const resultB = await promiseB;

      expect(resultA.behavior).toBe('deny');
      expect(resultB.behavior).toBe('allow');
    });
  });

  describe('router interception pattern', () => {
    it('handleResponse returns true only for valid YES/NO, false for other text', async () => {
      const relayFn: PermissionRelayFn = (params) =>
        relay.relayPermission({
          toolName: params.toolName,
          input: params.input,
          userId: params.userId,
          channel: params.channel,
        });

      const canUseTool = adapter.buildCanUseTool([], relayFn, 'user-4', 'webchat');
      const promise = canUseTool('Bash', { command: 'test' }, {} as never);
      await flushMicrotasks();

      // Non-permission text should not be consumed
      const notConsumed = relay.handleResponse('user-4', 'hello world');
      expect(notConsumed).toBe(false);
      expect(relay.hasPending('user-4')).toBe(true);

      // Valid response should be consumed
      const consumed = relay.handleResponse('user-4', 'allow');
      expect(consumed).toBe(true);
      expect(relay.hasPending('user-4')).toBe(false);

      const result = await promise;
      expect(result.behavior).toBe('allow');
    });

    it('handleResponse returns false when no pending request exists', () => {
      const consumed = relay.handleResponse('nonexistent-user', 'YES');
      expect(consumed).toBe(false);
    });
  });
});
