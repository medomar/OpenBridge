import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock child_process ──────────────────────────────────────────────────────

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
}

let mockChildren: MockChild[] = [];

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn((_signal?: string) => {
    child.killed = true;
    return true;
  });
  mockChildren.push(child);
  return child;
}

vi.mock('node:child_process', () => ({
  spawn: () => createMockChild(),
}));

// ── Mock node:fs/promises ──────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

// ── Mock logger ────────────────────────────────────────────────────────────

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Import SUT and mocked modules after vi.mock declarations ───────────────

import { access } from 'node:fs/promises';
import { AppServer } from '../../src/core/app-server.js';

const mockAccess = access as ReturnType<typeof vi.fn>;

// ── Helper: configure scaffold detection to return 'static' ───────────────

function setupStaticScaffold(): void {
  mockAccess.mockImplementation((filePath: unknown) => {
    const p = String(filePath);
    if (p.endsWith('index.html')) {
      return Promise.resolve();
    }
    return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('AppServer', () => {
  beforeEach(() => {
    mockChildren = [];
    mockAccess.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // ── 1. startApp with static HTML ──────────────────────────────────────────

  it('startApp with static HTML returns a running AppInstance', async () => {
    setupStaticScaffold();
    const server = new AppServer({ portStart: 4000, portEnd: 4099, idleTimeoutMs: 60_000 });

    const instance = await server.startApp('/test/app');

    expect(instance.status).toBe('running');
    expect(instance.port).toBe(4000);
    expect(instance.url).toBe('http://localhost:4000');
    expect(instance.publicUrl).toBeNull();
    expect(typeof instance.id).toBe('string');
    expect(instance.id.length).toBeGreaterThan(0);
    expect(typeof instance.startedAt).toBe('string');

    server.stopAll();
  });

  // ── 2. Unique port allocation ─────────────────────────────────────────────

  it('allocates unique ports for concurrently started apps', async () => {
    setupStaticScaffold();
    const server = new AppServer({ portStart: 4100, portEnd: 4199, idleTimeoutMs: 60_000 });

    const [a, b] = await Promise.all([
      server.startApp('/test/app-a'),
      server.startApp('/test/app-b'),
    ]);

    expect(a.port).not.toBe(b.port);
    expect(a.port).toBeGreaterThanOrEqual(4100);
    expect(b.port).toBeGreaterThanOrEqual(4100);
    expect(a.port).toBeLessThanOrEqual(4199);
    expect(b.port).toBeLessThanOrEqual(4199);

    server.stopAll();
  });

  // ── 3. stopApp releases port ──────────────────────────────────────────────

  it('stopApp releases the port so the next app can reuse it', async () => {
    setupStaticScaffold();
    const server = new AppServer({ portStart: 4200, portEnd: 4299, idleTimeoutMs: 60_000 });

    const first = await server.startApp('/test/first');
    const freedPort = first.port;

    server.stopApp(first.id);
    expect(server.getApp(first.id)).toBeNull();

    // The freed port should be the first available slot for the next app.
    const second = await server.startApp('/test/second');
    expect(second.port).toBe(freedPort);

    server.stopAll();
  });

  // ── 4. Idle timeout stops app ─────────────────────────────────────────────

  it('idle timeout stops the app after inactivity', async () => {
    vi.useFakeTimers();
    setupStaticScaffold();

    const idleTimeoutMs = 5_000;
    const server = new AppServer({ portStart: 4300, portEnd: 4399, idleTimeoutMs });

    const instance = await server.startApp('/test/idle-app');
    expect(server.listApps()).toHaveLength(1);

    // Advance fake clock past the idle timeout threshold.
    vi.advanceTimersByTime(idleTimeoutMs + 100);

    expect(server.listApps()).toHaveLength(0);
    expect(server.getApp(instance.id)).toBeNull();
  });

  // ── 5. listApps ───────────────────────────────────────────────────────────

  it('listApps returns all running apps with correct data', async () => {
    setupStaticScaffold();
    const server = new AppServer({ portStart: 4400, portEnd: 4499, idleTimeoutMs: 60_000 });

    expect(server.listApps()).toHaveLength(0);

    const a = await server.startApp('/test/app-a');
    expect(server.listApps()).toHaveLength(1);

    const b = await server.startApp('/test/app-b');
    const apps = server.listApps();
    expect(apps).toHaveLength(2);

    const ids = apps.map((x) => x.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);

    for (const app of apps) {
      expect(app.status).toBe('running');
    }

    server.stopAll();
  });

  // ── 6. maxConcurrent enforced ─────────────────────────────────────────────

  it('enforces maxConcurrent — rejects new app when limit reached', async () => {
    setupStaticScaffold();
    const server = new AppServer({
      portStart: 4500,
      portEnd: 4599,
      idleTimeoutMs: 60_000,
      maxConcurrent: 2,
    });

    await server.startApp('/test/app-1');
    await server.startApp('/test/app-2');

    await expect(server.startApp('/test/app-3')).rejects.toThrow(
      'Maximum concurrent apps reached (2)',
    );

    server.stopAll();
  });

  // ── 7. stopAll stops all apps ─────────────────────────────────────────────

  it('stopAll stops every running app and kills all processes', async () => {
    setupStaticScaffold();
    const server = new AppServer({ portStart: 4600, portEnd: 4699, idleTimeoutMs: 60_000 });

    await server.startApp('/test/app-a');
    await server.startApp('/test/app-b');
    await server.startApp('/test/app-c');

    expect(server.listApps()).toHaveLength(3);

    server.stopAll();

    expect(server.listApps()).toHaveLength(0);
    expect(mockChildren).toHaveLength(3);
    for (const child of mockChildren) {
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    }
  });
});
