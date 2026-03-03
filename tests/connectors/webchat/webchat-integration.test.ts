/**
 * Integration tests for WebChat connector (OB-323).
 *
 * Verifies the full message flow:
 *   WebSocket message → WebChatConnector emits → Bridge (auth / queue / router) →
 *   MockProvider processes → client.send called with response
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';
import { Bridge } from '../../../src/core/bridge.js';
import { MockProvider } from '../../helpers/mock-provider.js';
import type { AppConfig } from '../../../src/types/config.js';

// ---------------------------------------------------------------------------
// Mock: node:http
// ---------------------------------------------------------------------------

interface MockHttpServer {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

const mockHttpServers: MockHttpServer[] = [];

vi.mock('node:http', () => ({
  createServer: vi.fn().mockImplementation(() => {
    const server: MockHttpServer = {
      listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
      close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
      on: vi.fn(),
    };
    mockHttpServers.push(server);
    return server;
  }),
}));

// ---------------------------------------------------------------------------
// Mock: ws
// ---------------------------------------------------------------------------

interface MockWsClient {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  handlers: Map<string, ((...args: unknown[]) => void)[]>;
  simulateMessage(data: string): void;
  simulateClose(): void;
}

function createMockClient(): MockWsClient {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    readyState: 1, // OPEN
    send: vi.fn(),
    handlers,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    simulateMessage(data: string) {
      for (const h of handlers.get('message') ?? []) h(Buffer.from(data));
    },
    simulateClose() {
      for (const h of handlers.get('close') ?? []) h();
    },
  };
}

interface MockWss {
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  connectionHandlers: ((client: MockWsClient) => void)[];
  simulateConnection(client: MockWsClient): void;
}

const mockWssInstances: MockWss[] = [];

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => {
    const connectionHandlers: ((client: MockWsClient) => void)[] = [];
    const instance: MockWss = {
      connectionHandlers,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'connection') {
          connectionHandlers.push(handler as (client: MockWsClient) => void);
        }
      }),
      close: vi.fn((cb?: () => void) => cb?.()),
      simulateConnection(client: MockWsClient) {
        for (const h of connectionHandlers) h(client);
      },
    };
    mockWssInstances.push(instance);
    return instance;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function latestWss(): MockWss {
  const wss = mockWssInstances[mockWssInstances.length - 1];
  if (!wss) throw new Error('No WSS instance created');
  return wss;
}

/** Check if a mock spy was ever called with a JSON payload containing specific fields. */
function hadJsonCall(spy: ReturnType<typeof vi.fn>, partial: Record<string, unknown>): boolean {
  return spy.mock.calls.flat().some((call) => {
    if (typeof call !== 'string') return false;
    try {
      const p = JSON.parse(call) as Record<string, unknown>;
      return Object.entries(partial).every(([k, v]) => p[k] === v);
    } catch {
      return false;
    }
  });
}

/** Get the nth (1-indexed) call's parsed JSON payload. */
function nthJsonCall(spy: ReturnType<typeof vi.fn>, n: number): Record<string, unknown> {
  const call = spy.mock.calls[n - 1];
  if (!call) throw new Error(`No ${n}th call`);
  return JSON.parse(call[0] as string) as Record<string, unknown>;
}

function baseConfig(): AppConfig {
  return {
    defaultProvider: 'mock',
    connectors: [{ type: 'webchat', enabled: true, options: {} }],
    providers: [{ type: 'mock', enabled: true, options: {} }],
    auth: {
      whitelist: ['webchat-user'],
      prefix: '/ai',
      rateLimit: { enabled: false, windowMs: 60000, maxMessages: 5 },
    },
    queue: { maxRetries: 0, retryDelayMs: 1 },
    audit: { enabled: false, logPath: 'audit.log' },
    logLevel: 'info',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebChat connector integration (OB-323)', () => {
  let connector: WebChatConnector;
  let provider: MockProvider;
  let bridge: Bridge;

  beforeEach(() => {
    mockHttpServers.length = 0;
    mockWssInstances.length = 0;
    vi.clearAllMocks();
    connector = new WebChatConnector({});
    provider = new MockProvider();
    bridge = new Bridge(baseConfig());
    bridge.getRegistry().registerConnector('webchat', () => connector);
    bridge.getRegistry().registerProvider('mock', () => provider);
  });

  afterEach(async () => {
    await bridge.stop().catch(() => {});
  });

  it('routes a WebSocket message through the bridge and sends response to client', async () => {
    provider.setResponse({ content: 'Hello from AI' });

    await bridge.start();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateMessage(JSON.stringify({ type: 'message', content: '/ai hello world' }));

    await new Promise((r) => setTimeout(r, 50));

    // Provider received the prefix-stripped content
    expect(provider.processedMessages).toHaveLength(1);
    expect(provider.processedMessages[0]?.content).toBe('hello world');

    // Client received ack and AI response
    expect(hadJsonCall(client.send, { type: 'response', content: 'Working on it...' })).toBe(true);
    expect(hadJsonCall(client.send, { type: 'response', content: 'Hello from AI' })).toBe(true);
  });

  it('sends acknowledgment before the AI response', async () => {
    provider.setResponse({ content: 'AI reply' });

    await bridge.start();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateMessage(JSON.stringify({ type: 'message', content: '/ai test query' }));

    await new Promise((r) => setTimeout(r, 50));

    // 3 sends: ack, typing indicator, AI response
    expect(client.send).toHaveBeenCalledTimes(3);
    expect(nthJsonCall(client.send, 1)).toMatchObject({
      type: 'response',
      content: 'Working on it...',
    });
    expect(nthJsonCall(client.send, 2)).toEqual({ type: 'typing' });
    expect(nthJsonCall(client.send, 3)).toMatchObject({ type: 'response', content: 'AI reply' });
  });

  it('strips the /ai prefix before forwarding to the provider', async () => {
    provider.setResponse({ content: 'ok' });

    await bridge.start();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateMessage(
      JSON.stringify({ type: 'message', content: '/ai what is in the project?' }),
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(provider.processedMessages[0]?.content).toBe('what is in the project?');
  });

  it('auto-prepends /ai prefix for WebChat messages without it', async () => {
    provider.setResponse({ content: 'response to unprefixed message' });
    await bridge.start();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateMessage(JSON.stringify({ type: 'message', content: 'just a chat message' }));

    await new Promise((r) => setTimeout(r, 50));

    // WebChat is a direct AI connector — prefix is auto-prepended by the bridge
    expect(provider.processedMessages).toHaveLength(1);
    expect(provider.processedMessages[0]?.content).toBe('just a chat message');
  });

  it('broadcasts response to all connected OPEN clients', async () => {
    provider.setResponse({ content: 'broadcast response' });

    await bridge.start();

    const client1 = createMockClient();
    const client2 = createMockClient();
    latestWss().simulateConnection(client1);
    latestWss().simulateConnection(client2);

    // client1 sends the message; response is broadcast to both clients
    client1.simulateMessage(JSON.stringify({ type: 'message', content: '/ai hello' }));

    await new Promise((r) => setTimeout(r, 50));

    expect(hadJsonCall(client1.send, { type: 'response', content: 'broadcast response' })).toBe(
      true,
    );
    expect(hadJsonCall(client2.send, { type: 'response', content: 'broadcast response' })).toBe(
      true,
    );
  });

  it('does not send to clients that are no longer OPEN', async () => {
    provider.setResponse({ content: 'response' });

    await bridge.start();

    const client = createMockClient();
    client.readyState = 3; // CLOSED
    latestWss().simulateConnection(client);
    client.simulateMessage(JSON.stringify({ type: 'message', content: '/ai hello' }));

    await new Promise((r) => setTimeout(r, 50));

    // Closed client never receives anything
    expect(client.send).not.toHaveBeenCalled();
  });

  it('ignores non-message WebSocket payload types', async () => {
    await bridge.start();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateMessage(JSON.stringify({ type: 'ping' }));

    await new Promise((r) => setTimeout(r, 50));

    expect(provider.processedMessages).toHaveLength(0);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('allows all senders when the whitelist is empty', async () => {
    bridge = new Bridge({
      ...baseConfig(),
      auth: {
        whitelist: [],
        prefix: '/ai',
        rateLimit: { enabled: false, windowMs: 60000, maxMessages: 5 },
      },
    });
    bridge.getRegistry().registerConnector('webchat', () => connector);
    bridge.getRegistry().registerProvider('mock', () => provider);
    provider.setResponse({ content: 'ok' });

    await bridge.start();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateMessage(JSON.stringify({ type: 'message', content: '/ai hello' }));

    await new Promise((r) => setTimeout(r, 50));

    expect(provider.processedMessages).toHaveLength(1);
  });

  it('removes disconnected client so it receives no future messages', async () => {
    provider.setResponse({ content: 'response' });

    await bridge.start();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    // First message — client is OPEN
    client.simulateMessage(JSON.stringify({ type: 'message', content: '/ai first' }));
    await new Promise((r) => setTimeout(r, 50));
    const countBefore = client.send.mock.calls.length;

    // Client disconnects
    client.simulateClose();

    // Second message — client is removed from active set; response is broadcast but skipped
    client.simulateMessage(JSON.stringify({ type: 'message', content: '/ai second' }));
    await new Promise((r) => setTimeout(r, 50));

    // No new sends after disconnect
    expect(client.send.mock.calls.length).toBe(countBefore);
  });

  it('shuts down HTTP server and WebSocket server on bridge.stop()', async () => {
    await bridge.start();

    expect(connector.isConnected()).toBe(true);

    await bridge.stop();

    expect(connector.isConnected()).toBe(false);
  });
});
