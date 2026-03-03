/**
 * Tests for WebChat HTTP authentication (OB-1494).
 *
 * Verifies that the HTTP request handler:
 *  - Accepts requests with a valid token in the query string
 *  - Accepts requests with a valid token in the Authorization header
 *  - Issues a session cookie after a successful token auth
 *  - Accepts subsequent requests using that session cookie
 *  - Rejects requests with an invalid or missing token/cookie (401)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';

// ── Shared state ─────────────────────────────────────────────────────────────

const FIXED_TOKEN = 'abc123fixedtoken';

/** Captured request handler from createServer() */
let capturedHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

// ── Mock: node:http ───────────────────────────────────────────────────────────

interface MockHttpServer {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const mockHttpServers: MockHttpServer[] = [];

vi.mock('node:http', () => ({
  createServer: vi
    .fn()
    .mockImplementation((handler: (req: IncomingMessage, res: ServerResponse) => void) => {
      capturedHandler = handler;
      const server: MockHttpServer = {
        listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
        close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
      };
      mockHttpServers.push(server);
      return server;
    }),
}));

// ── Mock: ws ──────────────────────────────────────────────────────────────────

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn((cb?: () => void) => cb?.()),
  })),
}));

// ── Mock: webchat-auth ────────────────────────────────────────────────────────

// Note: vi.mock is hoisted — use a literal, not the FIXED_TOKEN constant
vi.mock('../../../src/connectors/webchat/webchat-auth.js', () => ({
  getOrCreateAuthToken: vi.fn().mockReturnValue('abc123fixedtoken'),
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

function makeReq(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { url, headers } as unknown as IncomingMessage;
}

interface MockResponse {
  statusCode: number | null;
  headers: Record<string, string | string[]>;
  body: string;
  writeHead: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    statusCode: null,
    headers: {},
    body: '',
    writeHead: vi.fn((code: number) => {
      res.statusCode = code;
    }),
    setHeader: vi.fn((name: string, value: string | string[]) => {
      res.headers[name.toLowerCase()] = value;
    }),
    end: vi.fn((data?: string) => {
      res.body = data ?? '';
    }),
  };
  return res;
}

/** Invoke the captured HTTP handler synchronously (most routes are sync). */
function handle(req: IncomingMessage, res: MockResponse): void {
  if (!capturedHandler) throw new Error('Handler not captured yet');
  capturedHandler(req, res as unknown as ServerResponse);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebChat HTTP authentication (OB-1494)', () => {
  let connector: WebChatConnector;

  beforeEach(async () => {
    mockHttpServers.length = 0;
    capturedHandler = null;
    connector = new WebChatConnector({});
    await connector.initialize();
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  it('returns 401 when no token or cookie is provided', () => {
    const req = makeReq('/');
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe('Unauthorized');
  });

  it('returns 401 when an incorrect token is provided in the query string', () => {
    const req = makeReq('/?token=wrongtoken');
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when an incorrect token is in the Authorization header', () => {
    const req = makeReq('/', { authorization: 'Bearer wrongtoken' });
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('allows access and serves HTML when correct token is in the query string', () => {
    const req = makeReq(`/?token=${FIXED_TOKEN}`);
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('mock');
  });

  it('allows access when correct token is in Authorization Bearer header', () => {
    const req = makeReq('/', { authorization: `Bearer ${FIXED_TOKEN}` });
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('sets a Set-Cookie header after successful token authentication', () => {
    const req = makeReq(`/?token=${FIXED_TOKEN}`);
    const res = makeRes();
    handle(req, res);
    expect(res.setHeader).toHaveBeenCalled();
    const cookieCall = res.setHeader.mock.calls.find(
      ([name]) => (name as string).toLowerCase() === 'set-cookie',
    );
    expect(cookieCall).toBeDefined();
    const cookieValue = cookieCall![1] as string;
    expect(cookieValue).toMatch(/^ob_session=/);
    expect(cookieValue).toContain('HttpOnly');
    expect(cookieValue).toContain('SameSite=Strict');
  });

  it('allows access using a valid session cookie (no token required)', () => {
    // First request authenticates with token and captures the session ID
    const firstReq = makeReq(`/?token=${FIXED_TOKEN}`);
    const firstRes = makeRes();
    handle(firstReq, firstRes);
    expect(firstRes.statusCode).toBe(200);

    // Extract session ID from Set-Cookie header
    const cookieCall = firstRes.setHeader.mock.calls.find(
      ([name]) => (name as string).toLowerCase() === 'set-cookie',
    )!;
    const cookieHeader = cookieCall[1] as string;
    const sessionId = cookieHeader.split(';')[0]!.split('=')[1]!.trim();

    // Second request uses the session cookie only
    const secondReq = makeReq('/api/sessions', { cookie: `ob_session=${sessionId}` });
    const secondRes = makeRes();
    // /api/sessions needs memory — it will return 503 (no memory), but auth should pass (not 401)
    handle(secondReq, secondRes);
    expect(secondRes.statusCode).not.toBe(401);
  });

  it('returns 401 with a fabricated session cookie (not issued by the server)', () => {
    const req = makeReq('/', { cookie: 'ob_session=fakesessionid' });
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('does not set a cookie when access is via a valid session cookie', () => {
    // Authenticate to get a real session
    const firstReq = makeReq(`/?token=${FIXED_TOKEN}`);
    const firstRes = makeRes();
    handle(firstReq, firstRes);
    const cookieCall = firstRes.setHeader.mock.calls.find(
      ([name]) => (name as string).toLowerCase() === 'set-cookie',
    )!;
    const cookieHeader = cookieCall[1] as string;
    const sessionId = cookieHeader.split(';')[0]!.split('=')[1]!.trim();

    // Second request via cookie should not set a new cookie
    const secondReq = makeReq('/', { cookie: `ob_session=${sessionId}` });
    const secondRes = makeRes();
    handle(secondReq, secondRes);
    expect(secondRes.statusCode).toBe(200);
    const setCookieCall = secondRes.setHeader.mock.calls.find(
      ([name]) => (name as string).toLowerCase() === 'set-cookie',
    );
    expect(setCookieCall).toBeUndefined();
  });
});
