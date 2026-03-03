/**
 * Tests for WebChat execution profile settings (OB-1535).
 *
 * Covers:
 *   1. GET /api/webchat/settings returns default profile 'thorough'
 *   2. PUT /api/webchat/settings updates the execution profile
 *   3. PUT /api/webchat/settings rejects an invalid profile value
 *   4. PUT /api/webchat/settings returns 400 for malformed JSON body
 *   5. GET /api/webchat/settings reflects the updated profile after PUT
 *   6. WEBCHAT_HTML bundle contains server-sync call for execution profile
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';
import { WEBCHAT_HTML } from '../../../src/connectors/webchat/ui-bundle.js';

// ---------------------------------------------------------------------------
// Capture the HTTP request handler from createServer
// ---------------------------------------------------------------------------

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

let capturedHandler: RequestHandler | null = null;

vi.mock('node:http', () => ({
  createServer: vi.fn().mockImplementation((handler: RequestHandler) => {
    capturedHandler = handler;
    return {
      listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
      close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
      on: vi.fn(),
    };
  }),
}));

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn((cb?: () => void) => cb?.()),
  })),
}));

vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/connectors/webchat/webchat-auth.js', () => ({
  getOrCreateAuthToken: vi.fn().mockReturnValue('exec-profile-test-token'),
}));

// ---------------------------------------------------------------------------
// Mock request / response helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'exec-profile-test-token';

function makeGetReq(url: string): IncomingMessage {
  return {
    url,
    method: 'GET',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function makePutReq(url: string): IncomingMessage & {
  _dataHandlers: Array<(chunk: Buffer) => void>;
  _endHandlers: Array<() => void>;
} {
  const req = {
    url,
    method: 'PUT',
    headers: {
      authorization: `Bearer ${TEST_TOKEN}`,
      'content-type': 'application/json',
    },
    socket: { remoteAddress: '127.0.0.1' },
    _dataHandlers: [] as Array<(chunk: Buffer) => void>,
    _endHandlers: [] as Array<() => void>,
    on(event: string, handler: (arg?: Buffer) => void): void {
      if (event === 'data') this._dataHandlers.push(handler as (chunk: Buffer) => void);
      if (event === 'end') this._endHandlers.push(handler as () => void);
    },
    destroy: vi.fn(),
  };
  return req as unknown as IncomingMessage & {
    _dataHandlers: Array<(chunk: Buffer) => void>;
    _endHandlers: Array<() => void>;
  };
}

interface MockRes {
  writeHead: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  statusCode: number;
  headers: Record<string, string | undefined>;
  body: string;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead: vi.fn((code: number, headers: Record<string, string>) => {
      res.statusCode = code;
      res.headers = headers;
    }),
    setHeader: vi.fn(),
    end: vi.fn((data: string) => {
      res.body = data;
    }),
  };
  return res;
}

function callHandler(req: IncomingMessage, res: MockRes): void {
  capturedHandler!(req, res as unknown as ServerResponse);
}

/** Send a PUT request with the given body string and wait for the response to complete. */
function sendPut(
  url: string,
  body: string,
): {
  req: ReturnType<typeof makePutReq>;
  res: MockRes;
  flush: () => void;
} {
  const req = makePutReq(url);
  const res = makeRes();
  callHandler(req as unknown as IncomingMessage, res);
  const flush = (): void => {
    for (const h of req._dataHandlers) h(Buffer.from(body));
    for (const h of req._endHandlers) h();
  };
  return { req, res, flush };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebChat execution profile settings API (OB-1535)', () => {
  let connector: WebChatConnector;

  beforeEach(() => {
    capturedHandler = null;
    connector = new WebChatConnector({});
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  it('GET /api/webchat/settings returns default profile "thorough"', async () => {
    await connector.initialize();

    const req = makeGetReq('/api/webchat/settings');
    const res = makeRes();
    callHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { profile: string };
    expect(body.profile).toBe('thorough');
  });

  it('PUT /api/webchat/settings updates the profile and returns ok', async () => {
    await connector.initialize();

    const { res, flush } = sendPut('/api/webchat/settings', JSON.stringify({ profile: 'fast' }));
    flush();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; profile: string };
    expect(body.ok).toBe(true);
    expect(body.profile).toBe('fast');
  });

  it('GET /api/webchat/settings reflects updated profile after PUT', async () => {
    await connector.initialize();

    // Update to 'manual'
    const { flush } = sendPut('/api/webchat/settings', JSON.stringify({ profile: 'manual' }));
    flush();

    // Now GET should return 'manual'
    const req = makeGetReq('/api/webchat/settings');
    const res = makeRes();
    callHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { profile: string };
    expect(body.profile).toBe('manual');
  });

  it('PUT /api/webchat/settings rejects invalid profile value', async () => {
    await connector.initialize();

    const { res, flush } = sendPut('/api/webchat/settings', JSON.stringify({ profile: 'invalid' }));
    flush();

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/fast.*thorough.*manual/);
  });

  it('PUT /api/webchat/settings returns 400 for malformed JSON', async () => {
    await connector.initialize();

    const { res, flush } = sendPut('/api/webchat/settings', 'not-json{{{');
    flush();

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('WEBCHAT_HTML bundle contains PUT /api/webchat/settings fetch call', () => {
    expect(WEBCHAT_HTML).toContain('/api/webchat/settings');
  });
});
