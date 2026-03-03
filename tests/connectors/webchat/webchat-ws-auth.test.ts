/**
 * Tests for WebChat WebSocket upgrade authentication (OB-1495).
 *
 * Verifies that the WebSocket upgrade handler:
 *  - Rejects connections with no token (writes 401 response, destroys socket)
 *  - Rejects connections with an invalid token
 *  - Allows connections with a valid token in the query string
 *  - Allows connections with a valid token in the Authorization header
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';

// ── Fixed token used in all tests ─────────────────────────────────────────────

const FIXED_TOKEN = 'ws-test-token-abc123';

// ── Shared state ──────────────────────────────────────────────────────────────

interface MockSocket {
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

type UpgradeHandler = (req: IncomingMessage, socket: MockSocket) => void;
let capturedUpgradeHandler: UpgradeHandler | null = null;

// ── Mock: node:http ───────────────────────────────────────────────────────────

vi.mock('node:http', () => ({
  createServer: vi.fn().mockImplementation(() => ({
    listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
    close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
    on: vi.fn((event: string, handler: unknown) => {
      if (event === 'upgrade') {
        capturedUpgradeHandler = handler as UpgradeHandler;
      }
    }),
  })),
}));

// ── Mock: ws ──────────────────────────────────────────────────────────────────

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn((cb?: () => void) => cb?.()),
  })),
}));

// ── Mock: webchat-auth ────────────────────────────────────────────────────────

// Note: vi.mock is hoisted — literal value required, not the FIXED_TOKEN constant
vi.mock('../../../src/connectors/webchat/webchat-auth.js', () => ({
  getOrCreateAuthToken: vi.fn().mockReturnValue('ws-test-token-abc123'),
}));

// ── Mock: ui-bundle ───────────────────────────────────────────────────────────

vi.mock('../../../src/connectors/webchat/ui-bundle.js', () => ({
  WEBCHAT_HTML: '<html>mock</html>',
}));

// ── Mock: qr-store ────────────────────────────────────────────────────────────

vi.mock('../../../src/core/qr-store.js', () => ({
  getQrCode: vi.fn().mockReturnValue(null),
}));

// ── Mock: logger ──────────────────────────────────────────────────────────────

vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSocket(): MockSocket {
  return { write: vi.fn(), destroy: vi.fn() };
}

function makeReq(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { url, headers } as unknown as IncomingMessage;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebChat WebSocket upgrade authentication (OB-1495)', () => {
  let connector: WebChatConnector;

  beforeEach(async () => {
    capturedUpgradeHandler = null;
    connector = new WebChatConnector({});
    await connector.initialize();
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  it('registers an upgrade handler during initialize()', () => {
    expect(capturedUpgradeHandler).not.toBeNull();
  });

  it('rejects upgrade with no token — writes 401 and destroys socket', () => {
    const socket = makeSocket();
    capturedUpgradeHandler!(makeReq('/'), socket);
    expect(socket.write).toHaveBeenCalledOnce();
    const written = socket.write.mock.calls[0][0] as string;
    expect(written).toContain('401');
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('rejects upgrade with an invalid token in the query string', () => {
    const socket = makeSocket();
    capturedUpgradeHandler!(makeReq('/?token=wrongtoken'), socket);
    expect(socket.write).toHaveBeenCalledOnce();
    const written = socket.write.mock.calls[0][0] as string;
    expect(written).toContain('401');
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('allows upgrade when valid token is in the query string', () => {
    const socket = makeSocket();
    capturedUpgradeHandler!(makeReq(`/?token=${FIXED_TOKEN}`), socket);
    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('allows upgrade when valid token is in the Authorization Bearer header', () => {
    const socket = makeSocket();
    capturedUpgradeHandler!(makeReq('/', { authorization: `Bearer ${FIXED_TOKEN}` }), socket);
    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
  });
});
