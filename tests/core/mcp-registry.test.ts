/**
 * Unit tests for McpRegistry (OB-1188):
 * - addServer: success, duplicate name rejection
 * - removeServer: success, not-found rejection
 * - toggleServer: enable, disable, not-found rejection
 * - listServers: healthy / error / unknown status, env var masking
 * - config persistence via mocked fs
 * - setOnChange callback on mutations
 * - reload() replaces server list
 * - getServer() lookup
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpRegistry } from '../../src/core/mcp-registry.js';
import type { MCPServer } from '../../src/types/config.js';

// ── Mock node:fs ─────────────────────────────────────────────────────────────

const mockReadFileSync = vi.fn<() => string>();
const mockWriteFileSync = vi.fn<() => void>();

vi.mock('node:fs', () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
}));

// ── Mock checkCommandOnPath from health.ts ────────────────────────────────────

const mockCheckCommandOnPath = vi.fn<(cmd: string) => boolean>();

vi.mock('../../src/core/health.js', () => ({
  checkCommandOnPath: (cmd: string) => mockCheckCommandOnPath(cmd),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const CONFIG_PATH = '/tmp/test-config.json';

/** Create a registry with a stub config file containing no mcp.servers */
function makeRegistry(initialServers: MCPServer[] = []): McpRegistry {
  mockReadFileSync.mockReturnValue(JSON.stringify({ workspacePath: '/ws', mcp: { servers: [] } }));
  return new McpRegistry(CONFIG_PATH, initialServers);
}

const serverA: MCPServer = { name: 'canva', command: 'npx', args: ['-y', '@canva/mcp'] };
const serverB: MCPServer = { name: 'github', command: 'npx', args: ['-y', '@github/mcp'] };
const serverWithEnv: MCPServer = {
  name: 'gmail',
  command: 'npx',
  env: { GMAIL_TOKEN: 'tok_abc12345', SHORT: 'ab' },
};

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  mockReadFileSync.mockReset();
  mockWriteFileSync.mockReset();
  mockCheckCommandOnPath.mockReset();
  // Default: command found on PATH
  mockCheckCommandOnPath.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── addServer() ───────────────────────────────────────────────────────────────

describe('addServer()', () => {
  it('adds a new server and persists config', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry();

    registry.addServer(serverA);

    expect(registry.getServer('canva')).toMatchObject({ name: 'canva', command: 'npx' });
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('sets enabled: true for newly added server', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry();

    registry.addServer(serverA);

    const entry = registry.getServer('canva');
    expect(entry?.enabled).toBe(true);
  });

  it('rejects duplicate server name with descriptive error', () => {
    const registry = makeRegistry([serverA]);

    expect(() => registry.addServer({ ...serverA })).toThrow('MCP server "canva" already exists');
  });

  it('does not persist config when duplicate name is rejected', () => {
    const registry = makeRegistry([serverA]);
    mockWriteFileSync.mockReset();

    expect(() => registry.addServer({ ...serverA })).toThrow();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

// ── removeServer() ────────────────────────────────────────────────────────────

describe('removeServer()', () => {
  it('removes an existing server and persists config', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry([serverA]);

    registry.removeServer('canva');

    expect(registry.getServer('canva')).toBeUndefined();
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('throws when server name is not found', () => {
    const registry = makeRegistry();

    expect(() => registry.removeServer('nonexistent')).toThrow(
      'MCP server "nonexistent" not found',
    );
  });

  it('does not affect other servers when removing one', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry([serverA, serverB]);

    registry.removeServer('canva');

    expect(registry.getServer('github')).toMatchObject({ name: 'github' });
  });
});

// ── toggleServer() ────────────────────────────────────────────────────────────

describe('toggleServer()', () => {
  it('disables an enabled server', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry([serverA]);

    registry.toggleServer('canva', false);

    expect(registry.getServer('canva')?.enabled).toBe(false);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('enables a disabled server', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry([serverA]);
    registry.toggleServer('canva', false);
    mockWriteFileSync.mockClear();

    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    registry.toggleServer('canva', true);

    expect(registry.getServer('canva')?.enabled).toBe(true);
    expect(mockWriteFileSync).toHaveBeenCalledOnce();
  });

  it('throws when server name is not found', () => {
    const registry = makeRegistry();

    expect(() => registry.toggleServer('ghost', true)).toThrow('MCP server "ghost" not found');
  });
});

// ── listServers() — health status ─────────────────────────────────────────────

describe('listServers() — health status', () => {
  it('returns "healthy" for enabled server whose command is on PATH', () => {
    mockCheckCommandOnPath.mockReturnValue(true);
    const registry = makeRegistry([serverA]);

    const [entry] = registry.listServers();
    expect(entry?.status).toBe('healthy');
  });

  it('returns "error" for enabled server whose command is NOT on PATH', () => {
    mockCheckCommandOnPath.mockReturnValue(false);
    const registry = makeRegistry([serverA]);

    const [entry] = registry.listServers();
    expect(entry?.status).toBe('error');
  });

  it('returns "unknown" for disabled server (command not checked)', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry([serverA]);
    registry.toggleServer('canva', false);

    const [entry] = registry.listServers();
    expect(entry?.status).toBe('unknown');
    // Command check should NOT be called for a disabled server
    expect(mockCheckCommandOnPath).not.toHaveBeenCalled();
  });

  it('returns all servers with their names and commands', () => {
    mockCheckCommandOnPath.mockReturnValue(true);
    const registry = makeRegistry([serverA, serverB]);

    const list = registry.listServers();
    expect(list).toHaveLength(2);
    const names = list.map((s) => s.name);
    expect(names).toContain('canva');
    expect(names).toContain('github');
  });

  it('returns empty array when no servers registered', () => {
    const registry = makeRegistry();
    expect(registry.listServers()).toEqual([]);
  });
});

// ── listServers() — env var masking ───────────────────────────────────────────

describe('listServers() — env var masking', () => {
  it('masks env values: first 4 chars + ****', () => {
    mockCheckCommandOnPath.mockReturnValue(true);
    const registry = makeRegistry([serverWithEnv]);

    const [entry] = registry.listServers();
    expect(entry?.env?.['GMAIL_TOKEN']).toBe('tok_****');
  });

  it('masks short env values (< 4 chars) as just ****', () => {
    mockCheckCommandOnPath.mockReturnValue(true);
    const registry = makeRegistry([serverWithEnv]);

    const [entry] = registry.listServers();
    expect(entry?.env?.['SHORT']).toBe('****');
  });

  it('returns undefined env when server has no env vars', () => {
    mockCheckCommandOnPath.mockReturnValue(true);
    const registry = makeRegistry([serverA]);

    const [entry] = registry.listServers();
    expect(entry?.env).toBeUndefined();
  });

  it('full env value is never exposed in listServers output', () => {
    mockCheckCommandOnPath.mockReturnValue(true);
    const registry = makeRegistry([serverWithEnv]);

    const [entry] = registry.listServers();
    const envValues = Object.values(entry?.env ?? {});
    for (const val of envValues) {
      expect(val).not.toBe('tok_abc12345');
      expect(val).not.toBe('ab');
    }
  });
});

// ── config persistence ────────────────────────────────────────────────────────

describe('config persistence', () => {
  it('writes merged mcp.servers back to config.json after addServer', () => {
    const existingConfig = { workspacePath: '/my/project', mcp: { enabled: true, servers: [] } };
    const registry = makeRegistry();
    // Override mock AFTER construction so addServer reads /my/project
    mockReadFileSync.mockReturnValue(JSON.stringify(existingConfig));

    registry.addServer(serverA);

    expect(mockWriteFileSync).toHaveBeenCalledOnce();
    const [writtenPath, writtenContent] = mockWriteFileSync.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(writtenPath).toBe(CONFIG_PATH);
    const parsed = JSON.parse(writtenContent) as {
      workspacePath: string;
      mcp: { enabled: boolean; servers: MCPServer[] };
    };
    // Preserves existing top-level fields
    expect(parsed.workspacePath).toBe('/my/project');
    // Preserves existing mcp fields
    expect(parsed.mcp.enabled).toBe(true);
    // Includes new server
    expect(parsed.mcp.servers).toHaveLength(1);
    expect(parsed.mcp.servers[0]?.name).toBe('canva');
  });

  it('strips runtime-only `enabled` field from persisted server objects', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry();
    registry.addServer(serverA);

    const [, writtenContent] = mockWriteFileSync.mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(writtenContent) as { mcp: { servers: unknown[] } };
    const persistedServer = parsed.mcp.servers[0] as Record<string, unknown>;
    expect(persistedServer).not.toHaveProperty('enabled');
    expect(persistedServer).not.toHaveProperty('status');
  });

  it('throws a descriptive error when config file cannot be read', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });
    const registry = new McpRegistry(CONFIG_PATH, []);

    expect(() => registry.addServer(serverA)).toThrow(/McpRegistry: cannot read config file/);
  });

  it('throws a descriptive error when config file contains invalid JSON', () => {
    mockReadFileSync.mockReturnValue('not { valid json');
    const registry = new McpRegistry(CONFIG_PATH, []);

    expect(() => registry.addServer(serverA)).toThrow(
      /McpRegistry: config file .+ is not valid JSON/,
    );
  });
});

// ── setOnChange() callback ────────────────────────────────────────────────────

describe('setOnChange() callback', () => {
  it('calls callback after addServer', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry();
    const onChange = vi.fn();
    registry.setOnChange(onChange);

    registry.addServer(serverA);

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('calls callback after removeServer', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry([serverA]);
    const onChange = vi.fn();
    registry.setOnChange(onChange);

    registry.removeServer('canva');

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('calls callback after toggleServer', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    const registry = makeRegistry([serverA]);
    const onChange = vi.fn();
    registry.setOnChange(onChange);

    registry.toggleServer('canva', false);

    expect(onChange).toHaveBeenCalledOnce();
  });

  it('passes listServers() result to the callback', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ mcp: { servers: [] } }));
    mockCheckCommandOnPath.mockReturnValue(true);
    const registry = makeRegistry();
    const onChange = vi.fn();
    registry.setOnChange(onChange);

    registry.addServer(serverA);

    const [callbackArg] = onChange.mock.calls[0] as [unknown[]];
    expect(Array.isArray(callbackArg)).toBe(true);
  });
});

// ── reload() ──────────────────────────────────────────────────────────────────

describe('reload()', () => {
  it('replaces all servers with new list', () => {
    const registry = makeRegistry([serverA]);

    registry.reload([serverB]);

    expect(registry.getServer('canva')).toBeUndefined();
    expect(registry.getServer('github')).toMatchObject({ name: 'github' });
  });

  it('sets enabled: true for all reloaded servers', () => {
    const registry = makeRegistry([serverA]);

    registry.reload([serverB]);

    expect(registry.getServer('github')?.enabled).toBe(true);
  });

  it('clears all servers when reloaded with empty array', () => {
    const registry = makeRegistry([serverA, serverB]);

    registry.reload([]);

    expect(registry.listServers()).toHaveLength(0);
  });

  it('does NOT persist to config (caller already wrote to disk)', () => {
    const registry = makeRegistry([serverA]);
    mockWriteFileSync.mockClear();

    registry.reload([serverB]);

    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

// ── getServer() ───────────────────────────────────────────────────────────────

describe('getServer()', () => {
  it('returns the server entry for a known name', () => {
    const registry = makeRegistry([serverA]);
    const entry = registry.getServer('canva');
    expect(entry).toMatchObject({ name: 'canva', command: 'npx', enabled: true });
  });

  it('returns undefined for an unknown name', () => {
    const registry = makeRegistry([serverA]);
    expect(registry.getServer('missing')).toBeUndefined();
  });
});
