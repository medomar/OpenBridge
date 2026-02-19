/**
 * Integration tests for the full message flow:
 * Connector → Bridge → Router → Provider → Connector
 *
 * Uses mock connector and provider to avoid real WhatsApp / Claude CLI calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bridge } from '../../src/core/bridge.js';
import { MockConnector } from '../helpers/mock-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { AppConfig } from '../../src/types/config.js';

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
    logLevel: 'info',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestContext {
  bridge: Bridge;
  connector: MockConnector;
  provider: MockProvider;
}

function buildBridge(configOverride?: Partial<AppConfig>): TestContext {
  const config = { ...baseConfig(), ...configOverride };

  const connector = new MockConnector();
  const provider = new MockProvider();

  // Register mock plugins
  const bridge = new Bridge(config);
  bridge.getRegistry().registerConnector('mock', () => connector);
  bridge.getRegistry().registerProvider('mock', () => provider);

  return { bridge, connector, provider };
}

// ---------------------------------------------------------------------------
// Full message flow
// ---------------------------------------------------------------------------

describe('Full message flow: connector → bridge → provider → connector', () => {
  let ctx: TestContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = buildBridge();
  });

  it('delivers AI response back to connector for a whitelisted sender', async () => {
    ctx.provider.setResponse({ content: 'Here are the files.' });

    await ctx.bridge.start();

    // Simulate an inbound message from the whitelisted sender
    ctx.connector.simulateMessage({
      id: 'msg-1',
      source: 'mock',
      sender: '+1234567890',
      rawContent: '/ai list files',
      content: 'list files',
      timestamp: new Date(),
    });

    // Let the async queue process
    await new Promise((r) => setTimeout(r, 50));

    // Provider received the message
    expect(ctx.provider.processedMessages).toHaveLength(1);
    expect(ctx.provider.processedMessages[0]?.content).toBe('list files');

    // Connector sent ack + response
    expect(ctx.connector.sentMessages).toHaveLength(2);
    expect(ctx.connector.sentMessages[0]?.content).toBe('Working on it...');
    expect(ctx.connector.sentMessages[1]?.content).toBe('Here are the files.');
  });

  it('strips prefix before forwarding to provider', async () => {
    ctx.provider.setResponse({ content: 'done' });

    await ctx.bridge.start();

    ctx.connector.simulateMessage({
      id: 'msg-2',
      source: 'mock',
      sender: '+1234567890',
      rawContent: '/ai what is in src/?',
      content: '/ai what is in src/?',
      timestamp: new Date(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.provider.processedMessages[0]?.content).toBe('what is in src/?');
  });

  it('ignores messages from non-whitelisted senders', async () => {
    await ctx.bridge.start();

    ctx.connector.simulateMessage({
      id: 'msg-3',
      source: 'mock',
      sender: '+9999999999', // not in whitelist
      rawContent: '/ai hello',
      content: 'hello',
      timestamp: new Date(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.provider.processedMessages).toHaveLength(0);
    expect(ctx.connector.sentMessages).toHaveLength(0);
  });

  it('ignores messages without the command prefix', async () => {
    await ctx.bridge.start();

    ctx.connector.simulateMessage({
      id: 'msg-4',
      source: 'mock',
      sender: '+1234567890',
      rawContent: 'just a regular chat message',
      content: 'just a regular chat message',
      timestamp: new Date(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.provider.processedMessages).toHaveLength(0);
    expect(ctx.connector.sentMessages).toHaveLength(0);
  });

  it('allows all senders when whitelist is empty', async () => {
    ctx = buildBridge({
      auth: {
        whitelist: [],
        prefix: '/ai',
        rateLimit: { enabled: false, windowMs: 60000, maxMessages: 5 },
      },
    });
    ctx.provider.setResponse({ content: 'hello' });

    await ctx.bridge.start();

    ctx.connector.simulateMessage({
      id: 'msg-5',
      source: 'mock',
      sender: '+0000000000', // any sender
      rawContent: '/ai hi',
      content: 'hi',
      timestamp: new Date(),
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(ctx.provider.processedMessages).toHaveLength(1);
  });

  it('drops messages when rate limit is exceeded', async () => {
    ctx = buildBridge({
      auth: {
        whitelist: ['+1234567890'],
        prefix: '/ai',
        rateLimit: { enabled: true, windowMs: 60000, maxMessages: 1 },
      },
    });
    ctx.provider.setResponse({ content: 'ok' });

    await ctx.bridge.start();

    const makeMsg = (id: string) => ({
      id,
      source: 'mock',
      sender: '+1234567890',
      rawContent: '/ai hi',
      content: 'hi',
      timestamp: new Date(),
    });

    ctx.connector.simulateMessage(makeMsg('m1'));
    ctx.connector.simulateMessage(makeMsg('m2')); // should be dropped

    await new Promise((r) => setTimeout(r, 100));

    // Only one message reaches the provider
    expect(ctx.provider.processedMessages).toHaveLength(1);
  });

  it('processes multiple messages from the same sender sequentially', async () => {
    const order: string[] = [];

    ctx.provider.setResponse({ content: 'response' });
    // Override streamMessage (preferred by router over processMessage)
    ctx.provider.streamMessage = async function* (msg) {
      order.push(msg.id);
      yield 'response';
      return { content: 'response' };
    };

    await ctx.bridge.start();

    const makeMsg = (id: string) => ({
      id,
      source: 'mock',
      sender: '+1234567890',
      rawContent: `/ai cmd ${id}`,
      content: `cmd ${id}`,
      timestamp: new Date(),
    });

    ctx.connector.simulateMessage(makeMsg('first'));
    ctx.connector.simulateMessage(makeMsg('second'));

    await new Promise((r) => setTimeout(r, 100));

    expect(order).toEqual(['first', 'second']);
  });

  it('bridge.stop() drains queue and shuts down connector and provider', async () => {
    await ctx.bridge.start();

    const shutdownConnector = vi.spyOn(ctx.connector, 'shutdown');
    const shutdownProvider = vi.spyOn(ctx.provider, 'shutdown');

    await ctx.bridge.stop();

    expect(shutdownConnector).toHaveBeenCalledOnce();
    expect(shutdownProvider).toHaveBeenCalledOnce();
  });
});
