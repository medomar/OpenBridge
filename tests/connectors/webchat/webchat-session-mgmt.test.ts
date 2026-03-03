/**
 * Tests for WebChat session management (OB-1498).
 *
 * Verifies that:
 *  - Session IDs are crypto.randomUUID() format (UUID v4)
 *  - Session cookies have Max-Age set to 24 hours (86400 seconds)
 *  - Sessions expire after 24 hours and are subsequently rejected
 *  - Sessions are still valid before the TTL elapses
 *  - Multiple concurrent sessions are independent and unique
 *  - Evicted expired sessions free memory and cannot be reused
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const FIXED_TOKEN = 'abc123fixedtoken';
/** 24 hours in milliseconds */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// ── Shared state ─────────────────────────────────────────────────────────────

let capturedHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

// ── Mock: node:http ───────────────────────────────────────────────────────────

interface MockHttpServer {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

vi.mock('node:http', () => ({
  createServer: vi
    .fn()
    .mockImplementation((handler: (req: IncomingMessage, res: ServerResponse) => void) => {
      capturedHandler = handler;
      const server: MockHttpServer = {
        listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
        close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
        on: vi.fn(),
      };
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

vi.mock('../../../src/connectors/webchat/webchat-auth.js', () => ({
  getOrCreateAuthToken: vi.fn().mockReturnValue('abc123fixedtoken'),
}));

// ── Mock: ui-bundle ───────────────────────────────────────────────────────────

vi.mock('../../../src/connectors/webchat/ui-bundle.js', () => ({
  WEBCHAT_HTML: '<html>mock</html>',
  WEBCHAT_LOGIN_HTML: '<html>login</html>',
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

function handle(req: IncomingMessage, res: MockResponse): void {
  if (!capturedHandler) throw new Error('Handler not captured yet');
  capturedHandler(req, res as unknown as ServerResponse);
}

/** Authenticate with the fixed token and return the issued session ID. */
function createSession(): string {
  const req = makeReq(`/?token=${FIXED_TOKEN}`);
  const res = makeRes();
  handle(req, res);
  expect(res.statusCode).toBe(200);
  const cookieCall = res.setHeader.mock.calls.find(
    ([name]) => (name as string).toLowerCase() === 'set-cookie',
  );
  expect(cookieCall).toBeDefined();
  const cookieHeader = cookieCall![1] as string;
  return cookieHeader.split(';')[0]!.split('=')[1]!.trim();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebChat session management (OB-1498)', () => {
  let connector: WebChatConnector;

  beforeEach(async () => {
    capturedHandler = null;
    vi.useFakeTimers();
    connector = new WebChatConnector({});
    await connector.initialize();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  it('session ID matches UUID v4 format (crypto.randomUUID)', () => {
    const sessionId = createSession();
    // UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(sessionId).toMatch(uuidV4Pattern);
  });

  it('session cookie Max-Age is 86400 seconds (24 hours)', () => {
    const req = makeReq(`/?token=${FIXED_TOKEN}`);
    const res = makeRes();
    handle(req, res);

    const cookieCall = res.setHeader.mock.calls.find(
      ([name]) => (name as string).toLowerCase() === 'set-cookie',
    );
    const cookieHeader = cookieCall![1] as string;
    expect(cookieHeader).toContain('Max-Age=86400');
  });

  it('session cookie is HttpOnly and SameSite=Strict', () => {
    const req = makeReq(`/?token=${FIXED_TOKEN}`);
    const res = makeRes();
    handle(req, res);

    const cookieCall = res.setHeader.mock.calls.find(
      ([name]) => (name as string).toLowerCase() === 'set-cookie',
    );
    const cookieHeader = cookieCall![1] as string;
    expect(cookieHeader).toContain('HttpOnly');
    expect(cookieHeader).toContain('SameSite=Strict');
  });

  it('session is valid within the 24 h TTL', () => {
    const sessionId = createSession();

    // Advance time to just before expiry
    vi.advanceTimersByTime(SESSION_TTL_MS - 1);

    const req = makeReq('/', { cookie: `ob_session=${sessionId}` });
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('session is rejected after the 24 h TTL elapses', () => {
    const sessionId = createSession();

    // Advance time past the 24 h expiry
    vi.advanceTimersByTime(SESSION_TTL_MS + 1);

    const req = makeReq('/', { cookie: `ob_session=${sessionId}` });
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('multiple concurrent sessions have unique IDs', () => {
    const id1 = createSession();
    const id2 = createSession();
    const id3 = createSession();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it('multiple concurrent sessions are independently valid', () => {
    const id1 = createSession();
    const id2 = createSession();

    const req1 = makeReq('/', { cookie: `ob_session=${id1}` });
    const res1 = makeRes();
    handle(req1, res1);
    expect(res1.statusCode).toBe(200);

    const req2 = makeReq('/', { cookie: `ob_session=${id2}` });
    const res2 = makeRes();
    handle(req2, res2);
    expect(res2.statusCode).toBe(200);
  });

  it('expired session cannot be reused after TTL (evicted from store)', () => {
    const sessionId = createSession();

    // Expire the session
    vi.advanceTimersByTime(SESSION_TTL_MS + 1);

    // First attempt after expiry — evicts it from the store
    const req1 = makeReq('/', { cookie: `ob_session=${sessionId}` });
    const res1 = makeRes();
    handle(req1, res1);
    expect(res1.statusCode).toBe(401);

    // Second attempt — must also be rejected (not re-added)
    const req2 = makeReq('/', { cookie: `ob_session=${sessionId}` });
    const res2 = makeRes();
    handle(req2, res2);
    expect(res2.statusCode).toBe(401);
  });
});
