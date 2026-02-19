import { describe, it, expect, afterEach } from 'vitest';
import { MetricsCollector, MetricsServer } from '../../src/core/metrics.js';
import type { MetricsSnapshot } from '../../src/core/metrics.js';

describe('MetricsCollector', () => {
  it('returns zero counters on fresh instance', () => {
    const collector = new MetricsCollector();
    const snap = collector.snapshot();

    expect(snap.messages.received).toBe(0);
    expect(snap.messages.authorized).toBe(0);
    expect(snap.messages.rateLimited).toBe(0);
    expect(snap.messages.commandBlocked).toBe(0);
    expect(snap.messages.processed).toBe(0);
    expect(snap.messages.failed).toBe(0);
    expect(snap.latency.count).toBe(0);
    expect(snap.latency.avgMs).toBe(0);
    expect(snap.latency.minMs).toBe(0);
    expect(snap.latency.maxMs).toBe(0);
    expect(snap.queue.enqueued).toBe(0);
    expect(snap.queue.retries).toBe(0);
    expect(snap.queue.deadLettered).toBe(0);
    expect(snap.errors.total).toBe(0);
    expect(snap.errors.transient).toBe(0);
    expect(snap.errors.permanent).toBe(0);
  });

  it('increments message counters', () => {
    const collector = new MetricsCollector();

    collector.recordReceived();
    collector.recordReceived();
    collector.recordAuthorized();
    collector.recordRateLimited();
    collector.recordCommandBlocked();

    const snap = collector.snapshot();
    expect(snap.messages.received).toBe(2);
    expect(snap.messages.authorized).toBe(1);
    expect(snap.messages.rateLimited).toBe(1);
    expect(snap.messages.commandBlocked).toBe(1);
  });

  it('tracks latency statistics', () => {
    const collector = new MetricsCollector();

    collector.recordProcessed(100);
    collector.recordProcessed(200);
    collector.recordProcessed(300);

    const snap = collector.snapshot();
    expect(snap.messages.processed).toBe(3);
    expect(snap.latency.count).toBe(3);
    expect(snap.latency.totalMs).toBe(600);
    expect(snap.latency.avgMs).toBe(200);
    expect(snap.latency.minMs).toBe(100);
    expect(snap.latency.maxMs).toBe(300);
  });

  it('tracks error types', () => {
    const collector = new MetricsCollector();

    collector.recordFailed('transient');
    collector.recordFailed('transient');
    collector.recordFailed('permanent');
    collector.recordFailed('unknown');

    const snap = collector.snapshot();
    expect(snap.messages.failed).toBe(4);
    expect(snap.errors.total).toBe(4);
    expect(snap.errors.transient).toBe(2);
    expect(snap.errors.permanent).toBe(1);
  });

  it('tracks queue counters', () => {
    const collector = new MetricsCollector();

    collector.recordEnqueued();
    collector.recordEnqueued();
    collector.recordRetry();
    collector.recordDeadLettered();

    const snap = collector.snapshot();
    expect(snap.queue.enqueued).toBe(2);
    expect(snap.queue.retries).toBe(1);
    expect(snap.queue.deadLettered).toBe(1);
  });

  it('includes uptime and timestamp in snapshot', () => {
    const collector = new MetricsCollector();
    const snap = collector.snapshot();

    expect(snap.uptime).toBeGreaterThanOrEqual(0);
    expect(snap.timestamp).toBeTruthy();
    expect(() => new Date(snap.timestamp)).not.toThrow();
  });
});

describe('MetricsServer', () => {
  let server: MetricsServer;

  afterEach(async () => {
    await server?.stop();
  });

  it('does not start when disabled', async () => {
    server = new MetricsServer({ enabled: false, port: 0 });
    await server.start();

    // No server running — fetch should fail
    await expect(fetch('http://localhost:0/metrics')).rejects.toThrow();
  });

  it('starts and responds with metrics snapshot', async () => {
    server = new MetricsServer({ enabled: true, port: 0 });
    const collector = new MetricsCollector();
    collector.recordReceived();
    collector.recordProcessed(150);

    server.setDataProvider(() => collector.snapshot());
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/metrics`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');

    const body = (await res.json()) as MetricsSnapshot;
    expect(body.messages.received).toBe(1);
    expect(body.messages.processed).toBe(1);
    expect(body.latency.avgMs).toBe(150);
  });

  it('returns 503 when no data provider is set', async () => {
    server = new MetricsServer({ enabled: true, port: 0 });
    await server.start();

    const port = getPort(server);
    const res = await fetch(`http://localhost:${port}/`);

    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Not initialized');
  });

  it('stops cleanly', async () => {
    server = new MetricsServer({ enabled: true, port: 0 });
    server.setDataProvider(() => new MetricsCollector().snapshot());
    await server.start();

    const port = getPort(server);
    await server.stop();

    await expect(fetch(`http://localhost:${port}/`)).rejects.toThrow();
  });

  it('stop is a no-op when not started', async () => {
    server = new MetricsServer({ enabled: false, port: 0 });
    await expect(server.stop()).resolves.toBeUndefined();
  });
});

/** Extract the dynamically assigned port from the server */
function getPort(metricsServer: MetricsServer): number {
  const srv = (metricsServer as unknown as { server: { address: () => { port: number } } }).server;
  return srv.address().port;
}
