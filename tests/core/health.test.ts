import { describe, it, expect, afterEach } from 'vitest';
import { HealthServer } from '../../src/core/health.js';
import type { HealthStatus } from '../../src/core/health.js';

function makeHealthy(): HealthStatus {
  return {
    status: 'healthy',
    uptime: 42,
    timestamp: new Date().toISOString(),
    connectors: [{ name: 'whatsapp', status: 'healthy' }],
    providers: [{ name: 'claude-code', status: 'healthy' }],
    queue: { pending: 0, processing: false, deadLetterSize: 0 },
  };
}

function makeUnhealthy(): HealthStatus {
  return {
    ...makeHealthy(),
    status: 'unhealthy',
    connectors: [{ name: 'whatsapp', status: 'unhealthy' }],
  };
}

describe('HealthServer', () => {
  let server: HealthServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('does not start when disabled', async () => {
    server = new HealthServer({ enabled: false, port: 0 });
    await server.start();

    // No server running — fetch should fail
    await expect(fetch('http://localhost:0/health')).rejects.toThrow();
  });

  it('starts and responds with health status on any path', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/health`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');

    const body = (await res.json()) as HealthStatus;
    expect(body.status).toBe('healthy');
    expect(body.uptime).toBe(42);
    expect(body.connectors).toHaveLength(1);
    expect(body.providers).toHaveLength(1);
    expect(body.queue.pending).toBe(0);
  });

  it('returns 503 when status is unhealthy', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeUnhealthy);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/`);

    expect(res.status).toBe(503);
    const body = (await res.json()) as HealthStatus;
    expect(body.status).toBe('unhealthy');
  });

  it('returns 503 when no data provider is set', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/`);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe('unhealthy');
    expect(body.error).toBe('Not initialized');
  });

  it('returns 200 for degraded status', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(() => ({
      ...makeHealthy(),
      status: 'degraded',
    }));
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as HealthStatus;
    expect(body.status).toBe('degraded');
  });

  it('stops cleanly', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    await server.start();

    const port = getPort(server);
    await server.stop();

    await expect(fetch(`http://localhost:${port}/`)).rejects.toThrow();
  });

  it('stop is a no-op when not started', async () => {
    server = new HealthServer({ enabled: false, port: 0 });
    // Should not throw
    await expect(server.stop()).resolves.toBeUndefined();
  });
});

/** Extract the dynamically assigned port from the server */
function getPort(healthServer: HealthServer): number {
  // Access the underlying server to get the assigned port
  const srv = (healthServer as unknown as { server: { address: () => { port: number } } }).server;
  return srv.address().port;
}
