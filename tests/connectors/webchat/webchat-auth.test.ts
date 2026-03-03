/**
 * Comprehensive WebChat authentication tests (OB-1502).
 *
 * Covers:
 *  1. Valid token allows access
 *  2. Invalid token returns 401
 *  3. Password login flow — correct password returns 200 + session cookie
 *  4. Session cookie set after authentication
 *  5. WebSocket upgrade rejects invalid / missing token
 *  6. Rate limit kicks in after 5 consecutive login failures (429)
 *  7. Rate limit block resets after the 30-minute window expires
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const FIXED_TOKEN = 'auth-test-token-abc123';
const CORRECT_PASSWORD = 'correct-password';
const WRONG_PASSWORD = 'wrong-password';
const BLOCK_DURATION_MS = 31 * 60 * 1000; // 31 min — just past the 30-min block window

// ── Shared state ──────────────────────────────────────────────────────────────

let capturedHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

interface MockSocket {
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

let capturedUpgradeHandler: ((req: IncomingMessage, socket: MockSocket) => void) | null = null;

// ── Mock: node:http ───────────────────────────────────────────────────────────

vi.mock('node:http', () => ({
  createServer: vi
    .fn()
    .mockImplementation((handler: (req: IncomingMessage, res: ServerResponse) => void) => {
      capturedHandler = handler;
      return {
        listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
        close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
        on: vi.fn((event: string, h: unknown) => {
          if (event === 'upgrade') {
            capturedUpgradeHandler = h as (req: IncomingMessage, socket: MockSocket) => void;
          }
        }),
      };
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
//
// Note: vi.mock is hoisted — literal values are required; FIXED_TOKEN constant
// is not accessible here.  Use the same literal 'auth-test-token-abc123'.
// hashPassword / verifyPassword use a trivial scheme: hash = "hashed:<pw>".

vi.mock('../../../src/connectors/webchat/webchat-auth.js', () => ({
  getOrCreateAuthToken: vi.fn().mockReturnValue('auth-test-token-abc123'),
  hashPassword: vi.fn().mockImplementation(async (pw: string) => `hashed:${pw}`),
  verifyPassword: vi
    .fn()
    .mockImplementation(async (submitted: string, hash: string) => hash === `hashed:${submitted}`),
}));

// ── Mock: ui-bundle ───────────────────────────────────────────────────────────

vi.mock('../../../src/connectors/webchat/ui-bundle.js', () => ({
  WEBCHAT_HTML: '<html>chat</html>',
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

interface MockResponse {
  statusCode: number | null;
  headers: Record<string, string | string[]>;
  body: string;
  writeHead: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function makeGetReq(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    url,
    headers,
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function makeSocket(): MockSocket {
  return { write: vi.fn(), destroy: vi.fn() };
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
  if (!capturedHandler) throw new Error('capturedHandler is null');
  capturedHandler(req, res as unknown as ServerResponse);
}

/**
 * Send a POST to /api/webchat/login and wait for the response to complete.
 *
 * The login endpoint reads the body asynchronously (req.on('data') / 'end'),
 * then calls verifyPassword (async).  This helper creates a promise that
 * resolves exactly when res.end() is called — works with both real and fake
 * timers because only promise microtasks are involved.
 */
async function postLogin(password: string, ip = '127.0.0.1'): Promise<MockResponse> {
  if (!capturedHandler) throw new Error('capturedHandler is null');

  const emitter = new EventEmitter();
  Object.assign(emitter, {
    url: '/api/webchat/login',
    headers: {},
    method: 'POST',
    socket: { remoteAddress: ip },
  });

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
    end: vi.fn(), // replaced below
  };

  const done = new Promise<MockResponse>((resolve) => {
    res.end = vi.fn((data?: string) => {
      res.body = data ?? '';
      resolve(res);
    });
  });

  capturedHandler(emitter as unknown as IncomingMessage, res as unknown as ServerResponse);

  // Emit the request body — triggers the async login logic
  emitter.emit('data', Buffer.from(JSON.stringify({ password })));
  emitter.emit('end');

  return done;
}

// ── Token-mode tests ──────────────────────────────────────────────────────────

describe('WebChat auth — token mode (OB-1502)', () => {
  let connector: WebChatConnector;

  beforeEach(async () => {
    capturedHandler = null;
    capturedUpgradeHandler = null;
    connector = new WebChatConnector({});
    await connector.initialize();
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  // Requirement 1 — valid token allows access
  it('allows access with valid token in query string', () => {
    const req = makeGetReq(`/?token=${FIXED_TOKEN}`);
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('chat');
  });

  // Requirement 2 — invalid token returns 401
  it('returns 401 when token is invalid', () => {
    const req = makeGetReq('/?token=totally-wrong');
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toBe('Unauthorized');
  });

  it('returns 401 when no auth is provided', () => {
    const req = makeGetReq('/');
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(401);
  });

  // Requirement 4 — session cookie set after auth
  it('sets an HttpOnly session cookie after valid token authentication', () => {
    const req = makeGetReq(`/?token=${FIXED_TOKEN}`);
    const res = makeRes();
    handle(req, res);

    const cookieCall = res.setHeader.mock.calls.find(
      ([name]) => (name as string).toLowerCase() === 'set-cookie',
    );
    expect(cookieCall).toBeDefined();
    const cookieValue = cookieCall![1] as string;
    expect(cookieValue).toMatch(/^ob_session=/);
    expect(cookieValue).toContain('HttpOnly');
    expect(cookieValue).toContain('SameSite=Strict');
  });

  // Requirement 5 — WebSocket rejects invalid token
  it('WebSocket upgrade rejects invalid token — writes 401 and destroys socket', () => {
    expect(capturedUpgradeHandler).not.toBeNull();
    const socket = makeSocket();
    capturedUpgradeHandler!(makeGetReq('/?token=bad'), socket);
    expect(socket.write).toHaveBeenCalledOnce();
    expect(socket.write.mock.calls[0][0] as string).toContain('401');
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('WebSocket upgrade accepts valid token — socket is not destroyed', () => {
    expect(capturedUpgradeHandler).not.toBeNull();
    const socket = makeSocket();
    capturedUpgradeHandler!(makeGetReq(`/?token=${FIXED_TOKEN}`), socket);
    expect(socket.write).not.toHaveBeenCalled();
    expect(socket.destroy).not.toHaveBeenCalled();
  });
});

// ── Password-mode tests ───────────────────────────────────────────────────────

describe('WebChat auth — password mode (OB-1502)', () => {
  let connector: WebChatConnector;

  beforeEach(async () => {
    capturedHandler = null;
    capturedUpgradeHandler = null;
    vi.useFakeTimers();
    connector = new WebChatConnector({ password: CORRECT_PASSWORD });
    await connector.initialize();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  // Requirement 3 — password login flow returns 200 + session cookie
  it('correct password returns 200 and sets an HttpOnly session cookie', async () => {
    const res = await postLogin(CORRECT_PASSWORD);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean };
    expect(body.ok).toBe(true);

    const cookieCall = res.setHeader.mock.calls.find(
      ([name]) => (name as string).toLowerCase() === 'set-cookie',
    );
    expect(cookieCall).toBeDefined();
    const cookieValue = cookieCall![1] as string;
    expect(cookieValue).toMatch(/^ob_session=/);
    expect(cookieValue).toContain('HttpOnly');
  });

  it('wrong password returns 401', async () => {
    const res = await postLogin(WRONG_PASSWORD);
    expect(res.statusCode).toBe(401);
  });

  // Requirement 4 (password mode) — session cookie from login grants access
  it('session cookie from password login grants access to chat page', async () => {
    const loginRes = await postLogin(CORRECT_PASSWORD);
    const cookieCall = loginRes.setHeader.mock.calls.find(
      ([name]) => (name as string).toLowerCase() === 'set-cookie',
    );
    expect(cookieCall).toBeDefined();
    const cookieHeader = cookieCall![1] as string;
    const sessionId = cookieHeader.split(';')[0]!.split('=')[1]!.trim();

    const req = makeGetReq('/', { cookie: `ob_session=${sessionId}` });
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('chat');
  });

  it('unauthenticated GET / serves the login page (not a bare 401)', () => {
    const req = makeGetReq('/');
    const res = makeRes();
    handle(req, res);
    // Password mode: page requests get the login screen, not 401
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('login');
  });

  // Requirement 6 — rate limit after 5 failures
  it('returns 429 after 5 consecutive failed login attempts', async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      const r = await postLogin(WRONG_PASSWORD, ip);
      expect(r.statusCode).toBe(401);
    }
    // The 6th attempt should be blocked
    const blocked = await postLogin(WRONG_PASSWORD, ip);
    expect(blocked.statusCode).toBe(429);
  });

  // Requirement 7 — rate limit resets after block period
  it('rate limit block resets after the 30-minute block window expires', async () => {
    const ip = '10.0.0.2';

    // Trigger the rate limit
    for (let i = 0; i < 5; i++) {
      await postLogin(WRONG_PASSWORD, ip);
    }
    const blocked = await postLogin(WRONG_PASSWORD, ip);
    expect(blocked.statusCode).toBe(429);

    // Advance fake time past the 30-min block period
    vi.advanceTimersByTime(BLOCK_DURATION_MS);

    // IP should now be unblocked — request proceeds and returns 401 (bad pw), not 429
    const unblocked = await postLogin(WRONG_PASSWORD, ip);
    expect(unblocked.statusCode).toBe(401);
  });
});
