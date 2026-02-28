/**
 * Unit tests for WebChat MCP REST endpoints (OB-1189):
 *
 * GET  /api/mcp/servers          → list servers (503 without registry, 200 with)
 * POST /api/mcp/servers          → create server (201, 400 validation, 409 duplicate, 503)
 * DELETE /api/mcp/servers/:name  → remove server (204, 404 not-found, URL-decode)
 * PATCH  /api/mcp/servers/:name  → toggle server (200, 404 not-found, 400 bad body)
 * GET  /api/mcp/catalog          → full catalog, filtered by category
 * POST /api/mcp/catalog/:name/connect → connect from catalog (201, 400 missing env, 404, 409, 503)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';
import type { McpRegistry, McpServerWithStatus } from '../../../src/core/mcp-registry.js';

// ── Mock node:http ─────────────────────────────────────────────────────────────

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

let capturedHandler: RequestHandler | null = null;

vi.mock('node:http', () => ({
  createServer: vi.fn().mockImplementation((handler: RequestHandler) => {
    capturedHandler = handler;
    return {
      listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
      close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
    };
  }),
}));

// ── Mock ws ────────────────────────────────────────────────────────────────────

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn((cb?: () => void) => cb?.()),
  })),
}));

// ── Mock logger ────────────────────────────────────────────────────────────────

vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Mock MCP_CATALOG ───────────────────────────────────────────────────────────
// vi.mock is hoisted, so TEST_CATALOG must also be hoisted via vi.hoisted().

const { TEST_CATALOG } = vi.hoisted(() => {
  const TEST_CATALOG = [
    {
      name: 'Filesystem',
      description: 'Read and write files on the local filesystem.',
      category: 'code',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      envVars: [],
      docsUrl: 'https://example.com/filesystem',
    },
    {
      name: 'GitHub',
      description: 'Interact with GitHub repositories.',
      category: 'code',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      envVars: [
        {
          key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
          description: 'GitHub personal access token',
          required: true,
        },
      ],
      docsUrl: 'https://example.com/github',
    },
    {
      name: 'Slack',
      description: 'Send Slack messages.',
      category: 'communication',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      envVars: [
        { key: 'SLACK_BOT_TOKEN', description: 'Slack bot token', required: true },
        { key: 'SLACK_TEAM_ID', description: 'Slack team ID', required: true },
      ],
      docsUrl: 'https://example.com/slack',
    },
  ];
  return { TEST_CATALOG };
});

vi.mock('../../../src/core/mcp-catalog.js', () => ({
  MCP_CATALOG: TEST_CATALOG,
}));

// ── Mock registry factory ──────────────────────────────────────────────────────

interface RegistryMocks {
  listServers: ReturnType<typeof vi.fn>;
  addServer: ReturnType<typeof vi.fn>;
  removeServer: ReturnType<typeof vi.fn>;
  toggleServer: ReturnType<typeof vi.fn>;
  getServer: ReturnType<typeof vi.fn>;
  setOnChange: ReturnType<typeof vi.fn>;
  reload: ReturnType<typeof vi.fn>;
}

function createMockRegistry(initialServers: McpServerWithStatus[] = []): {
  registry: McpRegistry;
  mocks: RegistryMocks;
} {
  const serverMap = new Map<string, McpServerWithStatus>(initialServers.map((s) => [s.name, s]));

  const mocks: RegistryMocks = {
    listServers: vi.fn(() => [...serverMap.values()]),
    addServer: vi.fn((server: { name: string; command: string; args?: string[] }) => {
      serverMap.set(server.name, {
        ...server,
        args: server.args ?? [],
        enabled: true,
        status: 'healthy',
      });
    }),
    removeServer: vi.fn((name: string) => {
      if (!serverMap.has(name)) throw new Error(`MCP server "${name}" not found`);
      serverMap.delete(name);
    }),
    toggleServer: vi.fn((name: string, enabled: boolean) => {
      const entry = serverMap.get(name);
      if (!entry) throw new Error(`MCP server "${name}" not found`);
      serverMap.set(name, { ...entry, enabled });
    }),
    getServer: vi.fn((name: string) => serverMap.get(name)),
    setOnChange: vi.fn(),
    reload: vi.fn(),
  };

  return { registry: mocks as unknown as McpRegistry, mocks };
}

// ── Request / response helpers ────────────────────────────────────────────────

function makeGetReq(url: string): IncomingMessage {
  return { url, method: 'GET' } as unknown as IncomingMessage;
}

function makeDeleteReq(url: string): IncomingMessage {
  return { url, method: 'DELETE' } as unknown as IncomingMessage;
}

/**
 * Creates a mock request that simulates a streaming JSON body.
 * Listeners are registered synchronously; events fire via setImmediate so all
 * three `.on('data' | 'end' | 'error')` registrations complete first.
 */
function makeBodyReq(url: string, method: string, body: unknown): IncomingMessage {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const bodyBuf = Buffer.from(bodyStr, 'utf-8');
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};

  setImmediate(() => {
    for (const h of listeners['data'] ?? []) h(bodyBuf);
    for (const h of listeners['end'] ?? []) h();
  });

  return {
    url,
    method,
    on(event: string, handler: (...args: unknown[]) => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
  } as unknown as IncomingMessage;
}

interface MockRes {
  writeHead: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead: vi.fn((code: number, headers?: Record<string, string>) => {
      res.statusCode = code;
      if (headers) res.headers = headers;
    }),
    end: vi.fn((data?: string) => {
      if (data) res.body = data;
    }),
  };
  return res;
}

/** Invoke the captured HTTP handler and wait for res.end to be called. */
async function callHandler(req: IncomingMessage, res: MockRes): Promise<void> {
  capturedHandler!(req, res as unknown as ServerResponse);
  await vi.waitFor(() => expect(res.end).toHaveBeenCalled(), { timeout: 2000 });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('WebChat MCP REST endpoints', () => {
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

  // ─── GET /api/mcp/servers ──────────────────────────────────────────────────

  describe('GET /api/mcp/servers', () => {
    it('returns 503 when no registry is wired', async () => {
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/mcp/servers'), res);

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ error: 'MCP registry not available' });
    });

    it('returns 200 with empty array when registry has no servers', async () => {
      const { registry } = createMockRegistry([]);
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/mcp/servers'), res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it('returns 200 with all registered servers', async () => {
      const servers: McpServerWithStatus[] = [
        { name: 'canva', command: 'npx', args: [], enabled: true, status: 'healthy' },
        { name: 'github', command: 'npx', args: [], enabled: false, status: 'unknown' },
      ];
      const { registry } = createMockRegistry(servers);
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/mcp/servers'), res);

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as unknown[];
      expect(parsed).toHaveLength(2);
    });
  });

  // ─── POST /api/mcp/servers ─────────────────────────────────────────────────

  describe('POST /api/mcp/servers', () => {
    it('returns 503 when no registry is wired', async () => {
      await connector.initialize();

      const res = makeRes();
      // 503 is returned before the body is read, so a basic mock without on() works
      const req = { url: '/api/mcp/servers', method: 'POST' } as unknown as IncomingMessage;
      capturedHandler!(req, res as unknown as ServerResponse);
      // sync response — no need for waitFor
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ error: 'MCP registry not available' });
    });

    it('creates a new server and returns 201', async () => {
      const { registry, mocks } = createMockRegistry([]);
      mocks.getServer.mockReturnValue({
        name: 'my-server',
        command: 'npx',
        args: [],
        enabled: true,
        status: 'healthy',
      });
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(
        makeBodyReq('/api/mcp/servers', 'POST', { name: 'my-server', command: 'npx' }),
        res,
      );

      expect(res.statusCode).toBe(201);
      expect(mocks.addServer).toHaveBeenCalledOnce();
    });

    it('returns 400 on validation failure (missing required command field)', async () => {
      const { registry } = createMockRegistry([]);
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      // 'command' is required by MCPServerSchema — omitting it triggers 400
      await callHandler(makeBodyReq('/api/mcp/servers', 'POST', { name: 'my-server' }), res);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe('Validation failed');
    });

    it('returns 400 on invalid JSON body', async () => {
      const { registry } = createMockRegistry([]);
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeBodyReq('/api/mcp/servers', 'POST', 'not-valid-json{'), res);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe('Invalid JSON body');
    });

    it('returns 409 when server name already exists', async () => {
      const { registry, mocks } = createMockRegistry([]);
      mocks.addServer.mockImplementation(() => {
        throw new Error('MCP server "canva" already exists');
      });
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(
        makeBodyReq('/api/mcp/servers', 'POST', { name: 'canva', command: 'npx' }),
        res,
      );

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toContain('already exists');
    });
  });

  // ─── DELETE /api/mcp/servers/:name ────────────────────────────────────────

  describe('DELETE /api/mcp/servers/:name', () => {
    it('returns 503 when no registry is wired', async () => {
      await connector.initialize();

      const res = makeRes();
      capturedHandler!(makeDeleteReq('/api/mcp/servers/canva'), res as unknown as ServerResponse);
      expect(res.statusCode).toBe(503);
    });

    it('returns 204 on successful deletion', async () => {
      const { registry } = createMockRegistry([
        { name: 'canva', command: 'npx', args: [], enabled: true, status: 'healthy' },
      ]);
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      capturedHandler!(makeDeleteReq('/api/mcp/servers/canva'), res as unknown as ServerResponse);

      expect(res.statusCode).toBe(204);
      expect(res.end).toHaveBeenCalled();
    });

    it('returns 404 when server is not found', async () => {
      const { registry } = createMockRegistry([]);
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      capturedHandler!(
        makeDeleteReq('/api/mcp/servers/nonexistent'),
        res as unknown as ServerResponse,
      );

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toContain('not found');
    });

    it('URL-decodes the server name before passing to removeServer', async () => {
      const { registry, mocks } = createMockRegistry([]);
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      capturedHandler!(
        makeDeleteReq('/api/mcp/servers/my%20server'),
        res as unknown as ServerResponse,
      );

      expect(mocks.removeServer).toHaveBeenCalledWith('my server');
    });
  });

  // ─── PATCH /api/mcp/servers/:name ─────────────────────────────────────────

  describe('PATCH /api/mcp/servers/:name', () => {
    it('returns 503 when no registry is wired', async () => {
      await connector.initialize();

      const res = makeRes();
      const req = {
        url: '/api/mcp/servers/canva',
        method: 'PATCH',
      } as unknown as IncomingMessage;
      capturedHandler!(req, res as unknown as ServerResponse);
      expect(res.statusCode).toBe(503);
    });

    it('toggles server enabled state and returns 200 with updated server', async () => {
      const { registry, mocks } = createMockRegistry([
        { name: 'canva', command: 'npx', args: [], enabled: true, status: 'healthy' },
      ]);
      mocks.getServer.mockReturnValue({
        name: 'canva',
        command: 'npx',
        args: [],
        enabled: false,
        status: 'unknown',
      });
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeBodyReq('/api/mcp/servers/canva', 'PATCH', { enabled: false }), res);

      expect(res.statusCode).toBe(200);
      expect(mocks.toggleServer).toHaveBeenCalledWith('canva', false);
    });

    it('returns 404 when server is not found', async () => {
      const { registry, mocks } = createMockRegistry([]);
      mocks.toggleServer.mockImplementation(() => {
        throw new Error('MCP server "ghost" not found');
      });
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeBodyReq('/api/mcp/servers/ghost', 'PATCH', { enabled: true }), res);

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toContain('not found');
    });

    it('returns 400 when body is not { enabled: boolean }', async () => {
      const { registry } = createMockRegistry([]);
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeBodyReq('/api/mcp/servers/canva', 'PATCH', { wrong: 'field' }), res);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toContain('enabled');
    });
  });

  // ─── GET /api/mcp/catalog ──────────────────────────────────────────────────

  describe('GET /api/mcp/catalog', () => {
    it('returns 200 with full catalog when no category filter', async () => {
      await connector.initialize();

      const res = makeRes();
      capturedHandler!(makeGetReq('/api/mcp/catalog'), res as unknown as ServerResponse);

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/json');
      const parsed = JSON.parse(res.body) as unknown[];
      expect(parsed).toHaveLength(TEST_CATALOG.length);
    });

    it('returns only matching entries when category filter is provided', async () => {
      await connector.initialize();

      const res = makeRes();
      capturedHandler!(
        makeGetReq('/api/mcp/catalog?category=code'),
        res as unknown as ServerResponse,
      );

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as Array<{ category: string }>;
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed.every((e) => e.category === 'code')).toBe(true);
    });

    it('returns empty array for an unknown category', async () => {
      await connector.initialize();

      const res = makeRes();
      capturedHandler!(
        makeGetReq('/api/mcp/catalog?category=nonexistent'),
        res as unknown as ServerResponse,
      );

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });
  });

  // ─── POST /api/mcp/catalog/:name/connect ──────────────────────────────────

  describe('POST /api/mcp/catalog/:name/connect', () => {
    it('returns 503 when no registry is wired', async () => {
      await connector.initialize();

      const res = makeRes();
      const req = {
        url: '/api/mcp/catalog/Filesystem/connect',
        method: 'POST',
      } as unknown as IncomingMessage;
      capturedHandler!(req, res as unknown as ServerResponse);
      expect(res.statusCode).toBe(503);
    });

    it('returns 404 when catalog entry is not found', async () => {
      const { registry } = createMockRegistry([]);
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeBodyReq('/api/mcp/catalog/NonExistent/connect', 'POST', {}), res);

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toContain('not found');
    });

    it('creates server from catalog entry with no required env vars and returns 201', async () => {
      const { registry, mocks } = createMockRegistry([]);
      mocks.getServer.mockReturnValue({
        name: 'Filesystem',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem'],
        enabled: true,
        status: 'healthy',
      });
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      // 'Filesystem' has no required env vars
      await callHandler(makeBodyReq('/api/mcp/catalog/Filesystem/connect', 'POST', {}), res);

      expect(res.statusCode).toBe(201);
      expect(mocks.addServer).toHaveBeenCalledOnce();
    });

    it('returns 400 when required env vars are missing', async () => {
      const { registry } = createMockRegistry([]);
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      // 'GitHub' requires GITHUB_PERSONAL_ACCESS_TOKEN
      await callHandler(
        makeBodyReq('/api/mcp/catalog/GitHub/connect', 'POST', { envVars: {} }),
        res,
      );

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string; missing: string[] };
      expect(body.error).toBe('Missing required env vars');
      expect(body.missing).toContain('GITHUB_PERSONAL_ACCESS_TOKEN');
    });

    it('creates server with provided env vars and returns 201', async () => {
      const { registry, mocks } = createMockRegistry([]);
      mocks.getServer.mockReturnValue({
        name: 'GitHub',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_****' },
        enabled: true,
        status: 'healthy',
      });
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(
        makeBodyReq('/api/mcp/catalog/GitHub/connect', 'POST', {
          envVars: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_test_token' },
        }),
        res,
      );

      expect(res.statusCode).toBe(201);
    });

    it('returns 409 when server already exists in registry', async () => {
      const { registry, mocks } = createMockRegistry([]);
      mocks.addServer.mockImplementation(() => {
        throw new Error('MCP server "Filesystem" already exists');
      });
      connector.setMcpRegistry(registry);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeBodyReq('/api/mcp/catalog/Filesystem/connect', 'POST', {}), res);

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toContain('already exists');
    });
  });
});
