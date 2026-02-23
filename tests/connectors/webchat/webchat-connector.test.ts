import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';
import type { InboundMessage } from '../../../src/types/message.js';

// ---- Mock: node:http ----

interface MockHttpServer {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const mockHttpServers: MockHttpServer[] = [];

vi.mock('node:http', () => ({
  createServer: vi.fn().mockImplementation(() => {
    const server: MockHttpServer = {
      listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
      close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
    };
    mockHttpServers.push(server);
    return server;
  }),
}));

// ---- Mock: ws ----

interface MockWsClient {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  handlers: Map<string, ((...args: unknown[]) => void)[]>;
  on: ReturnType<typeof vi.fn>;
  simulateMessage(data: string): void;
  simulateClose(): void;
  simulateError(err: Error): void;
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
    simulateError(err: Error) {
      for (const h of handlers.get('error') ?? []) h(err);
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

// Suppress logger output
vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function latestWss(): MockWss {
  const wss = mockWssInstances[mockWssInstances.length - 1];
  if (!wss) throw new Error('No WSS instance created');
  return wss;
}

function latestHttpServer(): MockHttpServer {
  const server = mockHttpServers[mockHttpServers.length - 1];
  if (!server) throw new Error('No HTTP server created');
  return server;
}

describe('WebChatConnector', () => {
  let connector: WebChatConnector;

  beforeEach(() => {
    mockHttpServers.length = 0;
    mockWssInstances.length = 0;
    connector = new WebChatConnector({});
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  it('should have name "webchat"', () => {
    expect(connector.name).toBe('webchat');
  });

  it('should start disconnected', () => {
    expect(connector.isConnected()).toBe(false);
  });

  it('should throw when constructing with invalid port', () => {
    expect(() => new WebChatConnector({ port: -1 })).toThrow();
  });

  it('should connect on initialize and emit ready', async () => {
    const readyHandler = vi.fn();
    connector.on('ready', readyHandler);

    await connector.initialize();

    expect(connector.isConnected()).toBe(true);
    expect(readyHandler).toHaveBeenCalledOnce();
  });

  it('should listen on configured port and host', async () => {
    connector = new WebChatConnector({ port: 4000, host: '0.0.0.0' });
    await connector.initialize();

    const server = latestHttpServer();
    expect(server.listen).toHaveBeenCalledWith(4000, '0.0.0.0', expect.any(Function));
  });

  it('should default to port 3000 and host localhost', async () => {
    await connector.initialize();

    const server = latestHttpServer();
    expect(server.listen).toHaveBeenCalledWith(3000, 'localhost', expect.any(Function));
  });

  it('should create WebSocketServer attached to http server', async () => {
    const { WebSocketServer } = await import('ws');
    await connector.initialize();

    expect(WebSocketServer).toHaveBeenCalledWith({ server: latestHttpServer() });
  });

  it('should emit message event when browser client sends text', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateMessage(JSON.stringify({ type: 'message', content: 'hello world' }));

    expect(messageHandler).toHaveBeenCalledOnce();
    const msg = messageHandler.mock.calls[0]![0] as InboundMessage;
    expect(msg.source).toBe('webchat');
    expect(msg.sender).toBe('webchat-user');
    expect(msg.content).toBe('hello world');
    expect(msg.rawContent).toBe('hello world');
    expect(msg.id).toBe('webchat-1');
    expect(msg.timestamp).toBeInstanceOf(Date);
  });

  it('should increment message id counter across messages', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateMessage(JSON.stringify({ type: 'message', content: 'first' }));
    client.simulateMessage(JSON.stringify({ type: 'message', content: 'second' }));

    expect(messageHandler).toHaveBeenCalledTimes(2);
    const msg1 = messageHandler.mock.calls[0]![0] as InboundMessage;
    const msg2 = messageHandler.mock.calls[1]![0] as InboundMessage;
    expect(msg1.id).toBe('webchat-1');
    expect(msg2.id).toBe('webchat-2');
  });

  it('should ignore non-message WebSocket payloads', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateMessage(JSON.stringify({ type: 'ping' }));

    expect(messageHandler).not.toHaveBeenCalled();
  });

  it('should ignore invalid JSON from WebSocket client', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateMessage('not valid json!!!');

    expect(messageHandler).not.toHaveBeenCalled();
  });

  it('should send response to all OPEN clients', async () => {
    await connector.initialize();

    const client1 = createMockClient();
    const client2 = createMockClient();
    latestWss().simulateConnection(client1);
    latestWss().simulateConnection(client2);

    await connector.sendMessage({ target: 'webchat', recipient: 'all', content: 'AI response' });

    const expected = JSON.stringify({ type: 'response', content: 'AI response' });
    expect(client1.send).toHaveBeenCalledWith(expected);
    expect(client2.send).toHaveBeenCalledWith(expected);
  });

  it('should not send to non-OPEN clients', async () => {
    await connector.initialize();

    const client = createMockClient();
    client.readyState = 3; // CLOSED
    latestWss().simulateConnection(client);

    await connector.sendMessage({ target: 'webchat', recipient: 'all', content: 'hi' });

    expect(client.send).not.toHaveBeenCalled();
  });

  it('should reject sendMessage when not connected', async () => {
    await expect(
      connector.sendMessage({ target: 'webchat', recipient: 'all', content: 'hi' }),
    ).rejects.toThrow('WebChat connector is not connected');
  });

  it('should send typing indicator to all OPEN clients', async () => {
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    await connector.sendTypingIndicator('all');

    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: 'typing' }));
  });

  it('should silently skip typing indicator when not connected', async () => {
    await expect(connector.sendTypingIndicator('all')).resolves.toBeUndefined();
  });

  it('should remove client from set on WebSocket close', async () => {
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    // Client is OPEN — sendMessage reaches it
    await connector.sendMessage({ target: 'webchat', recipient: 'all', content: 'before' });
    expect(client.send).toHaveBeenCalledTimes(1);

    // Simulate disconnect
    client.simulateClose();

    // After close, client is removed from set
    await connector.sendMessage({ target: 'webchat', recipient: 'all', content: 'after' });
    expect(client.send).toHaveBeenCalledTimes(1); // no additional sends
  });

  it('should remove client from set on WebSocket error', async () => {
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);
    client.simulateError(new Error('connection reset'));

    // After error, client is removed
    await connector.sendMessage({ target: 'webchat', recipient: 'all', content: 'test' });
    expect(client.send).not.toHaveBeenCalled();
  });

  it('should close WSS and HTTP server on shutdown', async () => {
    await connector.initialize();
    const wss = latestWss();
    const httpServer = latestHttpServer();

    await connector.shutdown();

    expect(connector.isConnected()).toBe(false);
    expect(wss.close).toHaveBeenCalledOnce();
    expect(httpServer.close).toHaveBeenCalledOnce();
  });

  it('should clear all clients on shutdown', async () => {
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    await connector.shutdown();

    // After shutdown, re-initialize check: isConnected = false
    expect(connector.isConnected()).toBe(false);
  });

  it('should accept custom port and host in constructor', () => {
    const c = new WebChatConnector({ port: 8080, host: '127.0.0.1' });
    expect(c.name).toBe('webchat');
  });

  it('should send progress event to all OPEN clients', async () => {
    await connector.initialize();

    const client1 = createMockClient();
    const client2 = createMockClient();
    latestWss().simulateConnection(client1);
    latestWss().simulateConnection(client2);

    await connector.sendProgress({ type: 'classifying' }, 'webchat-user');

    const expected = JSON.stringify({ type: 'progress', event: { type: 'classifying' } });
    expect(client1.send).toHaveBeenCalledWith(expected);
    expect(client2.send).toHaveBeenCalledWith(expected);
  });

  it('should send spawning progress event with workerCount', async () => {
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    await connector.sendProgress({ type: 'spawning', workerCount: 3 }, 'webchat-user');

    const expected = JSON.stringify({
      type: 'progress',
      event: { type: 'spawning', workerCount: 3 },
    });
    expect(client.send).toHaveBeenCalledWith(expected);
  });

  it('should send worker-progress event with completed and total', async () => {
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    await connector.sendProgress(
      { type: 'worker-progress', completed: 2, total: 3, workerName: 'ReadProject' },
      'webchat-user',
    );

    const expected = JSON.stringify({
      type: 'progress',
      event: { type: 'worker-progress', completed: 2, total: 3, workerName: 'ReadProject' },
    });
    expect(client.send).toHaveBeenCalledWith(expected);
  });

  it('should send complete progress event', async () => {
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    await connector.sendProgress({ type: 'complete' }, 'webchat-user');

    const expected = JSON.stringify({ type: 'progress', event: { type: 'complete' } });
    expect(client.send).toHaveBeenCalledWith(expected);
  });

  it('should not send progress to non-OPEN clients', async () => {
    await connector.initialize();

    const client = createMockClient();
    client.readyState = 3; // CLOSED
    latestWss().simulateConnection(client);

    await connector.sendProgress({ type: 'synthesizing' }, 'webchat-user');

    expect(client.send).not.toHaveBeenCalled();
  });

  it('should silently skip sendProgress when not connected', async () => {
    await expect(
      connector.sendProgress({ type: 'classifying' }, 'webchat-user'),
    ).resolves.toBeUndefined();
  });
});
