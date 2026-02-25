import { describe, it, expect, afterEach } from 'vitest';
import { HealthServer } from '../../src/core/health.js';
import type { HealthStatus } from '../../src/core/health.js';

function makeHealthy(): HealthStatus {
  return {
    status: 'healthy',
    uptime_seconds: 42,
    memory_mb: 128.5,
    active_workers: 0,
    master_status: 'ready',
    db_status: 'connected',
    last_message_at: null,
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
    expect(body.uptime_seconds).toBe(42);
    expect(body.memory_mb).toBe(128.5);
    expect(body.active_workers).toBe(0);
    expect(body.master_status).toBe('ready');
    expect(body.db_status).toBe('connected');
    expect(body.last_message_at).toBeNull();
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

  it('returns 404 for unknown paths', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(makeHealthy);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/unknown`);

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Not found');
  });

  it('/metrics returns Prometheus-compatible text when provider is set', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setMetricsProvider(() => ({
      uptime: 100,
      timestamp: new Date().toISOString(),
      messages: {
        received: 5,
        authorized: 4,
        rateLimited: 0,
        commandBlocked: 0,
        processed: 4,
        failed: 1,
      },
      latency: { count: 4, totalMs: 800, avgMs: 200, minMs: 100, maxMs: 350 },
      queue: { enqueued: 5, retries: 0, deadLettered: 0 },
      errors: { total: 1, transient: 1, permanent: 0 },
    }));
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/metrics`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    const text = await res.text();
    expect(text).toContain('openbridge_messages_received_total 5');
    expect(text).toContain('openbridge_messages_processed_total 4');
    expect(text).toContain('openbridge_messages_failed_total 1');
    expect(text).toContain('openbridge_errors_total 1');
    expect(text).toContain('openbridge_response_latency_ms_avg 200');
    expect(text).toContain('openbridge_uptime_seconds 100');
  });

  it('/metrics includes worker count from health provider', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setDataProvider(() => ({ ...makeHealthy(), active_workers: 3 }));
    server.setMetricsProvider(() => ({
      uptime: 60,
      timestamp: new Date().toISOString(),
      messages: {
        received: 0,
        authorized: 0,
        rateLimited: 0,
        commandBlocked: 0,
        processed: 0,
        failed: 0,
      },
      latency: { count: 0, totalMs: 0, avgMs: 0, minMs: 0, maxMs: 0 },
      queue: { enqueued: 0, retries: 0, deadLettered: 0 },
      errors: { total: 0, transient: 0, permanent: 0 },
    }));
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/metrics`);
    const text = await res.text();

    expect(text).toContain('openbridge_workers_active 3');
  });

  it('/metrics returns empty body when no provider is set', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/metrics`);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.trim()).toBe('');
  });

  it('/ready returns 503 when readiness provider returns false', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setReadinessProvider(() => false);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/ready`);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { ready: boolean; reason: string };
    expect(body.ready).toBe(false);
    expect(body.reason).toBe('Master AI not initialized');
  });

  it('/ready returns 200 when readiness provider returns true', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    server.setReadinessProvider(() => true);
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/ready`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ready: boolean };
    expect(body.ready).toBe(true);
  });

  it('/ready returns 503 when no readiness provider is set', async () => {
    server = new HealthServer({ enabled: true, port: 0 });
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/ready`);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { ready: boolean };
    expect(body.ready).toBe(false);
  });
});

/** Extract the dynamically assigned port from the server */
function getPort(healthServer: HealthServer): number {
  // Access the underlying server to get the assigned port
  const srv = (healthServer as unknown as { server: { address: () => { port: number } } }).server;
  return srv.address().port;
}
