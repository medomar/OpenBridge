/**
 * Unit tests for MCP health checks (OB-1080):
 * - checkCommandOnPath() correctly uses `which`/`where`
 * - checkMcpServersHealth() reports 'configured' / 'error' per server
 * - HealthServer includes mcp section when servers configured, omits when not
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkCommandOnPath, checkMcpServersHealth, HealthServer } from '../../src/core/health.js';
import type { HealthStatus, McpServerStatus } from '../../src/core/health.js';

// ── Mock node:child_process ──────────────────────────────────────────────────

const mockExecFileSync = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args) as Buffer,
}));

// ── checkCommandOnPath() ─────────────────────────────────────────────────────

describe('checkCommandOnPath()', () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it('returns true when command exists on PATH', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/bin/npx\n'));
    expect(checkCommandOnPath('npx')).toBe(true);
  });

  it('returns false when command is not found on PATH', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(checkCommandOnPath('nonexistent-binary')).toBe(false);
  });

  it('calls `which` with the command name on non-Windows', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/bin/node\n'));

    checkCommandOnPath('node');

    expect(mockExecFileSync).toHaveBeenCalledWith('which', ['node'], { stdio: 'ignore' });
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('does not throw when execFileSync throws', () => {
    mockExecFileSync.mockImplementation(() => {
      const err = new Error('not found');
      (err as NodeJS.ErrnoException).code = 'ENOENT';
      throw err;
    });
    expect(() => checkCommandOnPath('missing')).not.toThrow();
  });

  it('returns false (not true) on error from execFileSync', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    // Ensure the returned value is specifically false, not just falsy
    const result = checkCommandOnPath('missing');
    expect(result).toBe(false);
  });
});

// ── checkMcpServersHealth() ──────────────────────────────────────────────────

describe('checkMcpServersHealth()', () => {
  afterEach(() => {
    mockExecFileSync.mockReset();
  });

  it('returns { enabled: true, servers: [] } for empty array', () => {
    const result = checkMcpServersHealth([]);
    expect(result).toEqual({ enabled: true, servers: [] });
  });

  it('reports configured status when command exists on PATH', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/bin/npx\n'));
    const result = checkMcpServersHealth([{ name: 'canva', command: 'npx' }]);
    expect(result?.servers[0]).toEqual({
      name: 'canva',
      command: 'npx',
      status: 'configured',
    } satisfies McpServerStatus);
  });

  it('reports error status when command is not on PATH', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });
    const result = checkMcpServersHealth([
      { name: 'missing-server', command: 'nonexistent-binary' },
    ]);
    expect(result?.servers[0]).toEqual({
      name: 'missing-server',
      command: 'nonexistent-binary',
      status: 'error',
    } satisfies McpServerStatus);
  });

  it('checks each server independently (first passes, second fails)', () => {
    mockExecFileSync
      .mockReturnValueOnce(Buffer.from('/usr/bin/npx\n'))
      .mockImplementationOnce(() => {
        throw new Error('not found');
      });

    const result = checkMcpServersHealth([
      { name: 'canva', command: 'npx' },
      { name: 'broken', command: 'nonexistent' },
    ]);

    expect(result?.servers).toHaveLength(2);
    expect(result?.servers[0]?.status).toBe('configured');
    expect(result?.servers[1]?.status).toBe('error');
  });

  it('always returns enabled: true', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/bin/npx\n'));
    const result = checkMcpServersHealth([{ name: 'test', command: 'npx' }]);
    expect(result?.enabled).toBe(true);
  });

  it('preserves server name and command in the output', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/bin/npx\n'));
    const result = checkMcpServersHealth([
      { name: 'my-server', command: 'my-command', args: ['--flag'] },
    ]);
    expect(result?.servers[0]?.name).toBe('my-server');
    expect(result?.servers[0]?.command).toBe('my-command');
  });

  it('handles all servers existing on PATH', () => {
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/bin/npx\n'));
    const result = checkMcpServersHealth([
      { name: 'canva', command: 'npx' },
      { name: 'gmail', command: 'npx' },
      { name: 'slack', command: 'npx' },
    ]);
    expect(result?.servers).toHaveLength(3);
    expect(result?.servers.every((s) => s.status === 'configured')).toBe(true);
  });
});

// ── HealthServer MCP section ─────────────────────────────────────────────────

function makeHealthy(): HealthStatus {
  return {
    status: 'healthy',
    uptime_seconds: 10,
    memory_mb: 64,
    active_workers: 0,
    master_status: 'ready',
    db_status: 'connected',
    last_message_at: null,
    timestamp: new Date().toISOString(),
    connectors: [],
    providers: [],
    queue: { pending: 0, processing: false, deadLetterSize: 0 },
  };
}

describe('HealthServer — MCP section in /health response', () => {
  let server: HealthServer;

  afterEach(async () => {
    await server?.stop();
    mockExecFileSync.mockReset();
  });

  it('omits mcp field when no MCP servers configured (default)', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/health`);
    const body = (await res.json()) as HealthStatus;

    expect(body).not.toHaveProperty('mcp');
  });

  it('omits mcp field when setMcpServers called with empty array', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    server.setMcpServers([]);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/health`);
    const body = (await res.json()) as HealthStatus;

    expect(body).not.toHaveProperty('mcp');
  });

  it('includes mcp field when servers are configured', async () => {
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/bin/npx\n'));

    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    server.setMcpServers([{ name: 'canva', command: 'npx' }]);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/health`);
    const body = (await res.json()) as HealthStatus;

    expect(body).toHaveProperty('mcp');
    expect(body.mcp?.enabled).toBe(true);
  });

  it('reports configured status for command found on PATH', async () => {
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/bin/npx\n'));

    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    server.setMcpServers([{ name: 'canva', command: 'npx' }]);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/health`);
    const body = (await res.json()) as HealthStatus;

    expect(body.mcp?.servers[0]?.status).toBe('configured');
    expect(body.mcp?.servers[0]?.name).toBe('canva');
    expect(body.mcp?.servers[0]?.command).toBe('npx');
  });

  it('reports error status for command not found on PATH', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    server.setMcpServers([{ name: 'broken', command: 'no-such-binary' }]);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/health`);
    const body = (await res.json()) as HealthStatus;

    expect(body.mcp?.servers[0]?.status).toBe('error');
    expect(body.mcp?.servers[0]?.name).toBe('broken');
  });

  it('reports mixed statuses for multiple servers', async () => {
    mockExecFileSync
      .mockReturnValueOnce(Buffer.from('/usr/bin/npx\n'))
      .mockImplementationOnce(() => {
        throw new Error('not found');
      });

    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    server.setMcpServers([
      { name: 'canva', command: 'npx' },
      { name: 'broken', command: 'nonexistent-cmd' },
    ]);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/health`);
    const body = (await res.json()) as HealthStatus;

    expect(body.mcp?.servers).toHaveLength(2);
    const statuses = body.mcp?.servers.map((s) => s.status);
    expect(statuses).toContain('configured');
    expect(statuses).toContain('error');
  });

  it('mcp section is consistent across multiple health requests', async () => {
    mockExecFileSync.mockReturnValue(Buffer.from('/usr/bin/npx\n'));

    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    server.setMcpServers([{ name: 'canva', command: 'npx' }]);
    await server.start();

    const port = getPort(server);

    const res1 = await fetch(`http://localhost:${port}/health`);
    const body1 = (await res1.json()) as HealthStatus;

    const res2 = await fetch(`http://localhost:${port}/health`);
    const body2 = (await res2.json()) as HealthStatus;

    expect(body1.mcp?.servers[0]?.name).toBe('canva');
    expect(body2.mcp?.servers[0]?.name).toBe('canva');
  });

  it('overall health status is unaffected by MCP server errors', async () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found');
    });

    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    server.setMcpServers([{ name: 'broken', command: 'nonexistent-cmd' }]);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/health`);

    // HTTP 200 because overall bridge health is 'healthy' (MCP status is informational)
    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthStatus;
    expect(body.status).toBe('healthy');
  });
});

/** Extract the dynamically assigned port from the server */
function getPort(healthServer: HealthServer): number {
  const srv = (healthServer as unknown as { server: { address: () => { port: number } } }).server;
  return srv.address().port;
}
