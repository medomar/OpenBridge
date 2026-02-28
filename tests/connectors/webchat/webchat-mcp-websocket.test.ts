/**
 * Unit tests for MCP Dashboard WebSocket broadcast (OB-1194):
 * - mcp-status broadcast fires on addServer(), removeServer(), toggleServer()
 * - payload format: {type: 'mcp-status', servers: [{name, enabled, status}]}
 * - env var values are not included in broadcast payload
 * - no broadcast (no error) when no clients are connected
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';
import { McpRegistry } from '../../../src/core/mcp-registry.js';
import type { McpServerStatus } from '../../../src/core/mcp-registry.js';
import type { MCPServer } from '../../../src/types/config.js';

interface McpStatusPayload {
  type: string;
  servers: Array<{ name: string; enabled: boolean; status: McpServerStatus }>;
}

function parseMcpStatusPayload(raw: string): McpStatusPayload {
  return JSON.parse(raw) as McpStatusPayload;
}

// ── Mock node:fs (used by McpRegistry.persistToConfig) ────────────────────────

const mockReadFileSync = vi.fn<() => string>();
const mockWriteFileSync = vi.fn<() => void>();

vi.mock('node:fs', () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

// ── Mock health.js (used by McpRegistry.listServers) ─────────────────────────

const mockCheckCommandOnPath = vi.fn<(cmd: string) => boolean>();

vi.mock('../../../src/core/health.js', () => ({
  checkCommandOnPath: (cmd: string) => mockCheckCommandOnPath(cmd),
}));

// ── Mock node:http (dynamically imported in WebChatConnector.initialize) ──────

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

// ── Mock ws (dynamically imported in WebChatConnector.initialize) ─────────────

interface MockWsClient {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  handlers: Map<string, ((...args: unknown[]) => void)[]>;
  simulateClose(): void;
}

function createMockClient(): MockWsClient {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  return {
    readyState: 1, // WS_OPEN
    send: vi.fn(),
    handlers,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event)!.push(handler);
    }),
    simulateClose() {
      for (const h of handlers.get('close') ?? []) h();
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

// ── Mock logger ───────────────────────────────────────────────────────────────

vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONFIG_PATH = '/tmp/mcp-ws-test-config.json';
const STUB_CONFIG = JSON.stringify({ workspacePath: '/ws', mcp: { servers: [] } });

/** Create a real McpRegistry with mocked file I/O. */
function makeRegistry(initialServers: MCPServer[] = []): McpRegistry {
  mockReadFileSync.mockReturnValue(STUB_CONFIG);
  return new McpRegistry(CONFIG_PATH, initialServers);
}

/** Prepare fs mocks for a single mutation (persistToConfig reads then writes). */
function stubPersist(): void {
  mockReadFileSync.mockReturnValue(STUB_CONFIG);
}

function latestWss(): MockWss {
  const wss = mockWssInstances[mockWssInstances.length - 1];
  if (!wss) throw new Error('No WSS instance created');
  return wss;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let connector: WebChatConnector;

beforeEach(() => {
  mockHttpServers.length = 0;
  mockWssInstances.length = 0;
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockCheckCommandOnPath.mockReset();
  // Default: command is found on PATH → status 'healthy'
  mockCheckCommandOnPath.mockReturnValue(true);
  connector = new WebChatConnector({});
});

afterEach(async () => {
  if (connector.isConnected()) {
    await connector.shutdown();
  }
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MCP Dashboard WebSocket broadcast (OB-1194)', () => {
  it('broadcasts mcp-status to connected client when addServer() is called', async () => {
    const registry = makeRegistry();
    connector.setMcpRegistry(registry);
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    stubPersist();
    registry.addServer({ name: 'canva', command: 'npx', args: ['-y', '@canva/mcp'] });

    expect(client.send).toHaveBeenCalled();
    const payload = parseMcpStatusPayload(client.send.mock.calls[0]![0] as string);
    expect(payload.type).toBe('mcp-status');
    expect(payload.servers).toHaveLength(1);
    expect(payload.servers[0].name).toBe('canva');
    expect(payload.servers[0].enabled).toBe(true);
    expect(payload.servers[0].status).toBe('healthy');
  });

  it('broadcasts mcp-status to connected client when removeServer() is called', async () => {
    const server: MCPServer = { name: 'github', command: 'npx' };
    const registry = makeRegistry([server]);
    connector.setMcpRegistry(registry);
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    stubPersist();
    registry.removeServer('github');

    expect(client.send).toHaveBeenCalled();
    const payload = parseMcpStatusPayload(client.send.mock.calls[0]![0] as string);
    expect(payload.type).toBe('mcp-status');
    // Server was removed — list is empty
    expect(payload.servers).toHaveLength(0);
  });

  it('broadcasts mcp-status to connected client when toggleServer() is called', async () => {
    const server: MCPServer = { name: 'slack', command: 'npx' };
    const registry = makeRegistry([server]);
    connector.setMcpRegistry(registry);
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    stubPersist();
    registry.toggleServer('slack', false);

    expect(client.send).toHaveBeenCalled();
    const payload = parseMcpStatusPayload(client.send.mock.calls[0]![0] as string);
    expect(payload.type).toBe('mcp-status');
    expect(payload.servers[0].name).toBe('slack');
    // Server is now disabled → status is 'unknown'
    expect(payload.servers[0].enabled).toBe(false);
    expect(payload.servers[0].status).toBe('unknown');
  });

  it('broadcast payload contains only {name, enabled, status} — no env vars or other fields', async () => {
    const server: MCPServer = {
      name: 'gmail',
      command: 'npx',
      args: ['-y', '@gmail/mcp'],
      env: { GMAIL_TOKEN: 'super-secret-token-12345' },
    };
    const registry = makeRegistry([server]);
    connector.setMcpRegistry(registry);
    await connector.initialize();

    const client = createMockClient();
    latestWss().simulateConnection(client);

    stubPersist();
    registry.toggleServer('gmail', false);

    expect(client.send).toHaveBeenCalled();
    const rawPayload = client.send.mock.calls[0]![0] as string;
    const payload = parseMcpStatusPayload(rawPayload);

    // Correct event type
    expect(payload.type).toBe('mcp-status');

    // Each server entry has name, enabled, status
    const entry = payload.servers[0];
    expect(entry.name).toBe('gmail');
    expect(entry.enabled).toBe(false);
    expect(entry.status).toBe('unknown');

    // No env vars, command, or args in broadcast payload
    expect(entry).not.toHaveProperty('env');
    expect(entry).not.toHaveProperty('command');
    expect(entry).not.toHaveProperty('args');

    // Secret value is not anywhere in the broadcast JSON
    expect(rawPayload).not.toContain('super-secret-token-12345');
  });

  it('does not throw and sends nothing when no clients are connected', async () => {
    const server: MCPServer = { name: 'canva', command: 'npx' };
    const registry = makeRegistry([server]);
    connector.setMcpRegistry(registry);
    await connector.initialize();

    // No clients connected — registry mutation should not throw
    expect(() => {
      stubPersist();
      registry.toggleServer('canva', false);
    }).not.toThrow();
  });

  it('broadcasts to all OPEN clients simultaneously on registry change', async () => {
    const server: MCPServer = { name: 'canva', command: 'npx' };
    const registry = makeRegistry([server]);
    connector.setMcpRegistry(registry);
    await connector.initialize();

    const client1 = createMockClient();
    const client2 = createMockClient();
    latestWss().simulateConnection(client1);
    latestWss().simulateConnection(client2);

    stubPersist();
    registry.toggleServer('canva', false);

    const expectedPayload = JSON.stringify({
      type: 'mcp-status',
      servers: [{ name: 'canva', enabled: false, status: 'unknown' }],
    });
    expect(client1.send).toHaveBeenCalledWith(expectedPayload);
    expect(client2.send).toHaveBeenCalledWith(expectedPayload);
  });

  it('does not broadcast to closed WebSocket clients', async () => {
    const server: MCPServer = { name: 'canva', command: 'npx' };
    const registry = makeRegistry([server]);
    connector.setMcpRegistry(registry);
    await connector.initialize();

    const client = createMockClient();
    client.readyState = 3; // CLOSED
    latestWss().simulateConnection(client);

    stubPersist();
    registry.toggleServer('canva', false);

    expect(client.send).not.toHaveBeenCalled();
  });
});
