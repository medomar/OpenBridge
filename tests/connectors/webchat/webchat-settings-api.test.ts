/**
 * Tests for WebChat settings REST API (OB-1538).
 *
 * Covers:
 *   1. WebchatSettingsPutSchema validates valid profile values
 *   2. WebchatSettingsPutSchema rejects invalid profile value
 *   3. PUT /api/webchat/settings uses Zod schema — error matches /fast.*thorough.*manual/
 *   4. PUT /api/webchat/settings persists profile to access-store when memory is available
 *   5. PUT /api/webchat/settings succeeds without memory (access-store optional)
 *   6. GET /api/webchat/settings returns default profile before any PUT
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';
import { WebchatSettingsPutSchema } from '../../../src/connectors/webchat/webchat-config.js';
import type { MemoryManager } from '../../../src/memory/index.js';
import type { AccessControlEntry } from '../../../src/memory/access-store.js';

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
  getOrCreateAuthToken: vi.fn().mockReturnValue('settings-api-test-token'),
}));

// ---------------------------------------------------------------------------
// Mock request / response helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'settings-api-test-token';

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
// Mock memory helpers
// ---------------------------------------------------------------------------

function createMockMemory(existing: AccessControlEntry | null = null): Partial<MemoryManager> {
  return {
    getAccess: vi.fn().mockResolvedValue(existing),
    setAccess: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests — WebchatSettingsPutSchema (Zod)
// ---------------------------------------------------------------------------

describe('WebchatSettingsPutSchema (OB-1538)', () => {
  it('accepts "fast" as a valid profile', () => {
    const result = WebchatSettingsPutSchema.safeParse({ profile: 'fast' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.profile).toBe('fast');
  });

  it('accepts "thorough" as a valid profile', () => {
    const result = WebchatSettingsPutSchema.safeParse({ profile: 'thorough' });
    expect(result.success).toBe(true);
  });

  it('accepts "manual" as a valid profile', () => {
    const result = WebchatSettingsPutSchema.safeParse({ profile: 'manual' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid profile value', () => {
    const result = WebchatSettingsPutSchema.safeParse({ profile: 'invalid' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = result.error.errors[0]?.message ?? '';
      // Error should mention expected values
      expect(msg).toMatch(/fast|thorough|manual/i);
    }
  });

  it('rejects missing profile field', () => {
    const result = WebchatSettingsPutSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-string profile', () => {
    const result = WebchatSettingsPutSchema.safeParse({ profile: 42 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — GET/PUT /api/webchat/settings
// ---------------------------------------------------------------------------

describe('WebChat settings REST API (OB-1538)', () => {
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

  it('GET /api/webchat/settings returns default profile "thorough" before any PUT', async () => {
    await connector.initialize();

    const req = makeGetReq('/api/webchat/settings');
    const res = makeRes();
    callHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { profile: string };
    expect(body.profile).toBe('thorough');
  });

  it('PUT /api/webchat/settings validates profile via Zod — error message includes enum values', async () => {
    await connector.initialize();

    const { res, flush } = sendPut('/api/webchat/settings', JSON.stringify({ profile: 'bad' }));
    flush();

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string };
    // Zod enum error message references expected values
    expect(body.error).toMatch(/fast|thorough|manual/i);
  });

  it('PUT /api/webchat/settings succeeds without memory (access-store is optional)', async () => {
    await connector.initialize();

    const { res, flush } = sendPut('/api/webchat/settings', JSON.stringify({ profile: 'fast' }));
    flush();

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; profile: string };
    expect(body.ok).toBe(true);
    expect(body.profile).toBe('fast');
  });

  it('PUT /api/webchat/settings persists profile to access-store when memory is set', async () => {
    const memory = createMockMemory(null);
    connector.setMemory(memory as MemoryManager);
    await connector.initialize();

    const { res, flush } = sendPut('/api/webchat/settings', JSON.stringify({ profile: 'manual' }));
    flush();

    expect(res.statusCode).toBe(200);

    // Allow the async fire-and-forget to settle
    await vi.waitFor(
      () => {
        expect(memory.setAccess).toHaveBeenCalledWith(
          expect.objectContaining({
            user_id: 'webchat-user',
            channel: 'webchat',
            executionProfile: 'manual',
          }),
        );
      },
      { timeout: 1000 },
    );
  });

  it('PUT /api/webchat/settings reads existing access-store entry before overwriting', async () => {
    const existingEntry: AccessControlEntry = {
      user_id: 'webchat-user',
      channel: 'webchat',
      role: 'admin',
      active: true,
    };
    const memory = createMockMemory(existingEntry);
    connector.setMemory(memory as MemoryManager);
    await connector.initialize();

    const { res, flush } = sendPut(
      '/api/webchat/settings',
      JSON.stringify({ profile: 'thorough' }),
    );
    flush();

    expect(res.statusCode).toBe(200);

    // Access-store call should preserve the existing role
    await vi.waitFor(
      () => {
        expect(memory.setAccess).toHaveBeenCalledWith(
          expect.objectContaining({
            role: 'admin',
            executionProfile: 'thorough',
          }),
        );
      },
      { timeout: 1000 },
    );
  });
});
