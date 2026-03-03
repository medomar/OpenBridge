import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock node:net (isPortInUse) ───────────────────────────────────────────────

let portInUseShouldFail = false;

vi.mock('node:net', () => {
  return {
    createServer: () => {
      const server = new EventEmitter() as EventEmitter & {
        listen: (port: number, host: string) => void;
        close: (cb?: () => void) => void;
      };
      server.listen = (_port: number, _host: string) => {
        if (portInUseShouldFail) {
          const err = Object.assign(new Error('EADDRINUSE'), { code: 'EADDRINUSE' });
          process.nextTick(() => server.emit('error', err));
        } else {
          process.nextTick(() => server.emit('listening'));
        }
      };
      server.close = (cb?: () => void) => {
        if (cb) process.nextTick(cb);
      };
      return server;
    },
  };
});

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Mock ws ───────────────────────────────────────────────────────────────────

/** Minimal mock for a WebSocket client connection. */
interface MockWsClient {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}

interface MockRequest {
  headers: Record<string, string | string[] | undefined>;
  url?: string;
}

type ConnectionListener = (socket: MockWsClient, request: MockRequest) => void;

/** Captured state for the latest WebSocketServer instance. */
let capturedConnectionHandler: ConnectionListener | null = null;

function createMockWsClient(readyState = 1): MockWsClient {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  return {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    on(event: string, listener: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(listener);
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of handlers.get(event) ?? []) fn(...args);
    },
  };
}

class MockWssServer {
  private closeCallback: (() => void) | null = null;

  constructor(_opts: { port: number }) {
    capturedConnectionHandler = null;
  }

  on(event: string, listener: (...args: unknown[]) => void): void {
    if (event === 'connection') {
      capturedConnectionHandler = listener as ConnectionListener;
    }
  }

  close(callback?: () => void): void {
    this.closeCallback = callback ?? null;
    if (callback) callback();
  }
}

vi.mock('ws', () => ({
  WebSocketServer: MockWssServer,
}));

// ── Import SUT after mock declarations ────────────────────────────────────────

import { InteractionRelay } from '../../src/core/interaction-relay.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Connect a mock client to the relay using an optional appId header and URL. */
function connectClient(appId?: string, url = '/'): MockWsClient {
  const socket = createMockWsClient();
  const headers: Record<string, string | string[] | undefined> = appId ? { 'x-app-id': appId } : {};
  capturedConnectionHandler!(socket, { headers, url });
  return socket;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('InteractionRelay', () => {
  let relay: InteractionRelay;

  beforeEach(() => {
    portInUseShouldFail = false;
    capturedConnectionHandler = null;
    relay = new InteractionRelay(3199); // dedicated test port — not used for real
  });

  afterEach(async () => {
    await relay.stop();
  });

  // ── 1. Relay starts WebSocket server ─────────────────────────────────────────

  it('start() creates a WebSocket server and sets isRunning to true', async () => {
    expect(relay.isRunning).toBe(false);

    await relay.start();

    expect(relay.isRunning).toBe(true);
    expect(capturedConnectionHandler).not.toBeNull();
  });

  // ── 2. App connects and sends message ────────────────────────────────────────

  it('app connects and sends a message — relay receives it via onAppMessage', async () => {
    await relay.start();

    // Register an app token so the relay assigns a named appId to the connection
    relay.registerApp('app-1', 'token-for-app-1');

    const received: unknown[] = [];
    relay.onAppMessage((msg) => received.push(msg));

    const socket = createMockWsClient();
    capturedConnectionHandler!(socket, {
      headers: {},
      url: '/?token=token-for-app-1',
    });

    const payload = JSON.stringify({ type: 'user-action', data: { value: 42 } });
    socket.emit('message', Buffer.from(payload));

    // Flush any async handlers
    await Promise.resolve();

    expect(received).toHaveLength(1);
    const msg = received[0] as { appId: string; type: string; data: { value: number } };
    expect(msg.appId).toBe('app-1');
    expect(msg.type).toBe('user-action');
    expect(msg.data).toEqual({ value: 42 });
  });

  // ── 3. Relay routes message to Master (handler called) ───────────────────────

  it('onAppMessage handler is called for each message received from any app', async () => {
    await relay.start();

    const handler = vi.fn();
    relay.onAppMessage(handler);

    const socket = connectClient('app-x');
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'query', data: 'hello' })));
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'query', data: 'world' })));

    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  // ── 4. sendToApp delivers data ───────────────────────────────────────────────

  it('sendToApp serialises message to JSON and delivers it to the connected app socket', async () => {
    await relay.start();

    // Register a token so the relay assigns 'app-send' as the appId
    relay.registerApp('app-send', 'token-send-abc');

    const socket = createMockWsClient(1 /* WS_OPEN */);
    capturedConnectionHandler!(socket, { headers: {}, url: '/?token=token-send-abc' });

    const result = relay.sendToApp('app-send', 'update', { status: 'done' });

    expect(result).toBe(true);
    expect(socket.send).toHaveBeenCalledOnce();

    const sent = JSON.parse(socket.send.mock.calls[0][0] as string) as {
      appId: string;
      type: string;
      data: { status: string };
    };
    expect(sent.appId).toBe('app-send');
    expect(sent.type).toBe('update');
    expect(sent.data).toEqual({ status: 'done' });
  });

  // ── 5. Unknown origins rejected when tokens are registered ───────────────────

  it('rejects connections that have no valid token when the relay is in authenticated mode', async () => {
    await relay.start();

    // Register one token → relay switches to authenticated mode
    relay.registerApp('known-app', 'valid-token-abc');

    const socket = createMockWsClient();
    // Connect with an invalid token
    capturedConnectionHandler!(socket, { headers: {}, url: '/?token=wrong-token' });

    expect(socket.close).toHaveBeenCalledWith(1008, 'Unauthorized');
    expect(relay.connectionCount).toBe(0);
  });

  it('accepts connections with a valid token when the relay is in authenticated mode', async () => {
    await relay.start();

    relay.registerApp('my-app', 'secret-token-xyz');

    const socket = createMockWsClient();
    capturedConnectionHandler!(socket, { headers: {}, url: '/?token=secret-token-xyz' });

    expect(socket.close).not.toHaveBeenCalled();
    expect(relay.connectionCount).toBe(1);
  });

  // ── 6. Relay stops cleanly ───────────────────────────────────────────────────

  it('stop() clears connections and sets isRunning to false', async () => {
    await relay.start();

    connectClient('app-a');
    connectClient('app-b');
    expect(relay.connectionCount).toBe(2);

    await relay.stop();

    expect(relay.isRunning).toBe(false);
    expect(relay.connectionCount).toBe(0);
  });

  // ── Additional: connectionCount and sendToApp edge cases ─────────────────────

  it('connectionCount reflects the number of currently connected apps', async () => {
    await relay.start();

    expect(relay.connectionCount).toBe(0);

    connectClient('a1');
    connectClient('a2');

    expect(relay.connectionCount).toBe(2);
  });

  it('sendToApp returns false when the target app is not connected', async () => {
    await relay.start();

    const result = relay.sendToApp('ghost-app', 'ping', {});

    expect(result).toBe(false);
  });

  it('start() throws when the port is already in use', async () => {
    portInUseShouldFail = true;

    await expect(relay.start()).rejects.toThrow('already in use');
  });
});
