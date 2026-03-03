/**
 * Tests for WebChat /api/discovery endpoint (OB-1534).
 *
 * Covers:
 *   1. GET /api/discovery returns { tools: [] } when no tools set
 *   2. GET /api/discovery returns available tools with name and version
 *   3. Unavailable tools are excluded from the response
 *   4. setDiscoveryResult() populates the endpoint response
 *   5. Response includes Cache-Control header
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';
import type { DiscoveredTool } from '../../../src/types/discovery.js';

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
  getOrCreateAuthToken: vi.fn().mockReturnValue('discovery-test-token'),
}));

// ---------------------------------------------------------------------------
// Mock request / response helpers
// ---------------------------------------------------------------------------

const TEST_TOKEN = 'discovery-test-token';

function makeReq(url: string): IncomingMessage {
  return {
    url,
    method: 'GET',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTool(overrides: Partial<DiscoveredTool> = {}): DiscoveredTool {
  return {
    name: 'claude',
    path: '/usr/local/bin/claude',
    version: '1.2.3',
    capabilities: ['chat', 'code'],
    role: 'master',
    available: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebChat /api/discovery endpoint (OB-1534)', () => {
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

  it('returns empty tools array when no discovery result set', async () => {
    await connector.initialize();

    const req = makeReq('/api/discovery');
    const res = makeRes();
    callHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { tools: unknown[] };
    expect(body).toHaveProperty('tools');
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toHaveLength(0);
  });

  it('returns available tools with name and version', async () => {
    connector.setDiscoveryResult([
      makeTool({ name: 'claude', version: '1.2.3', available: true }),
      makeTool({ name: 'codex', version: '2.0.0', available: true, role: 'specialist' }),
    ]);
    await connector.initialize();

    const req = makeReq('/api/discovery');
    const res = makeRes();
    callHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { tools: Array<{ name: string; version: string }> };
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0]).toEqual({ name: 'claude', version: '1.2.3' });
    expect(body.tools[1]).toEqual({ name: 'codex', version: '2.0.0' });
  });

  it('excludes unavailable tools from response', async () => {
    connector.setDiscoveryResult([
      makeTool({ name: 'claude', available: true }),
      makeTool({ name: 'aider', available: false }),
    ]);
    await connector.initialize();

    const req = makeReq('/api/discovery');
    const res = makeRes();
    callHandler(req, res);

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { tools: Array<{ name: string }> };
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]?.name).toBe('claude');
  });

  it('includes Cache-Control header', async () => {
    await connector.initialize();

    const req = makeReq('/api/discovery');
    const res = makeRes();
    callHandler(req, res);

    expect(res.headers['Cache-Control']).toBe('public, max-age=300');
  });

  it('setDiscoveryResult() updates the tools list', async () => {
    await connector.initialize();

    connector.setDiscoveryResult([makeTool({ name: 'claude', available: true })]);

    const req = makeReq('/api/discovery');
    const res = makeRes();
    callHandler(req, res);

    const body = JSON.parse(res.body) as { tools: Array<{ name: string }> };
    expect(body.tools[0]?.name).toBe('claude');
  });
});
