import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from './logger.js';
import { type TunnelManager } from './tunnel-manager.js';

const logger = createLogger('app-server');

export type AppStatus = 'running' | 'stopped';
export type AppScaffoldType = 'npm' | 'static' | 'node';

export interface AppScaffold {
  type: AppScaffoldType;
  command: string;
  args: string[];
}

export interface AppInstance {
  id: string;
  port: number;
  url: string;
  publicUrl: string | null;
  status: AppStatus;
  startedAt: string;
}

interface AppServerOptions {
  baseUrl?: string;
  portStart?: number;
  portEnd?: number;
  idleTimeoutMs?: number;
  /**
   * Factory that creates a fresh TunnelManager for each app that starts.
   * If provided, a tunnel is created for each app port and the public URL
   * is stored in AppInstance.publicUrl. The tunnel is stopped when the app stops.
   */
  tunnelFactory?: () => TunnelManager;
}

const DEFAULT_BASE_URL = 'http://localhost';
const DEFAULT_PORT_START = 3100;
const DEFAULT_PORT_END = 3199;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const HEALTH_CHECK_TIMEOUT_MS = 20_000;
const HEALTH_CHECK_INTERVAL_MS = 500;
const HEALTH_REQUEST_TIMEOUT_MS = 2_000;

interface AppRuntime {
  instance: AppInstance;
  process: ChildProcess;
  appPath: string;
  scaffold: AppScaffold;
  lastRequestAt: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  tunnelManager: TunnelManager | null;
}

export class AppServer {
  private readonly apps = new Map<string, AppRuntime>();
  private readonly baseUrl: string;
  private readonly idleTimeoutMs: number;
  private readonly portStart: number;
  private readonly portEnd: number;
  private readonly usedPorts = new Set<number>();
  private readonly tunnelFactory: (() => TunnelManager) | null;

  constructor(options: AppServerOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.portStart = options.portStart ?? DEFAULT_PORT_START;
    this.portEnd = options.portEnd ?? DEFAULT_PORT_END;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.tunnelFactory = options.tunnelFactory ?? null;
  }

  /**
   * Scan the port range and mark any already-bound ports as in use.
   * Call this once on startup before the first startApp().
   */
  async scanUsedPorts(): Promise<void> {
    const checks: Promise<void>[] = [];
    for (let port = this.portStart; port <= this.portEnd; port++) {
      checks.push(
        isPortInUse(port).then((inUse) => {
          if (inUse) {
            this.usedPorts.add(port);
          }
        }),
      );
    }
    await Promise.all(checks);
    logger.info(
      { portStart: this.portStart, portEnd: this.portEnd, inUse: this.usedPorts.size },
      'Port scan complete',
    );
  }

  async detectAppScaffold(appPath: string): Promise<AppScaffold | null> {
    const packageJsonPath = path.join(appPath, 'package.json');
    if (await this.pathExists(packageJsonPath)) {
      try {
        const raw = await readFile(packageJsonPath, 'utf-8');
        const data = JSON.parse(raw) as { scripts?: Record<string, string> };
        if (data.scripts?.['start']) {
          return { type: 'npm', command: 'npm', args: ['start'] };
        }
      } catch (error) {
        logger.warn({ err: error, appPath }, 'Failed to parse package.json for app scaffold');
      }
    }

    const serverPath = path.join(appPath, 'server.js');
    if (await this.pathExists(serverPath)) {
      return { type: 'node', command: 'node', args: ['server.js'] };
    }

    const indexPath = path.join(appPath, 'index.html');
    if (await this.pathExists(indexPath)) {
      return { type: 'static', command: 'npx', args: ['-y', 'serve', '.'] };
    }

    return null;
  }

  async startApp(appPath: string): Promise<AppInstance> {
    const scaffold = await this.detectAppScaffold(appPath);
    if (!scaffold) {
      throw new Error(`No app scaffold detected at path: ${appPath}`);
    }

    const id = randomUUID();
    const port = this.allocatePort();
    const url = `${this.baseUrl}:${port}`;
    const instance: AppInstance = {
      id,
      port,
      url,
      publicUrl: null,
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    const child = this.spawnAppProcess(scaffold, appPath, port);
    const runtime: AppRuntime = {
      instance,
      process: child,
      appPath,
      scaffold,
      lastRequestAt: Date.now(),
      idleTimer: null,
      tunnelManager: null,
    };

    this.apps.set(id, runtime);

    child.on('exit', (code, signal) => {
      const active = this.apps.get(id);
      if (!active) return;
      logger.warn(
        { id, port, appPath, code, signal },
        'App process exited unexpectedly; stopping app',
      );
      this.stopApp(id);
    });

    try {
      await this.waitForHealthy(url);
    } catch (error) {
      this.stopApp(id);
      throw error;
    }

    if (this.tunnelFactory) {
      const tm = this.tunnelFactory();
      try {
        const publicUrl = await tm.start(port);
        instance.publicUrl = publicUrl;
        runtime.tunnelManager = tm;
        logger.info({ id, port, publicUrl }, 'App tunnel created');
      } catch (err) {
        logger.warn(
          { id, port, err },
          'Failed to create tunnel for app — continuing without tunnel',
        );
      }
    }

    this.scheduleIdleTimeout(id);
    logger.info({ id, port, appPath, publicUrl: instance.publicUrl }, 'App started');
    return instance;
  }

  stopApp(appId: string): void {
    const runtime = this.apps.get(appId);
    if (!runtime) return;

    runtime.instance.status = 'stopped';
    if (runtime.idleTimer) {
      clearTimeout(runtime.idleTimer);
      runtime.idleTimer = null;
    }

    if (!runtime.process.killed) {
      runtime.process.kill('SIGTERM');
    }

    if (runtime.tunnelManager) {
      runtime.tunnelManager.stop();
      runtime.tunnelManager = null;
      logger.info({ id: appId, port: runtime.instance.port }, 'App tunnel stopped');
    }

    this.usedPorts.delete(runtime.instance.port);
    this.apps.delete(appId);
    logger.info({ id: appId, port: runtime.instance.port }, 'App stopped');
  }

  stopAll(): void {
    const ids = Array.from(this.apps.keys());
    for (const id of ids) {
      this.stopApp(id);
    }
    logger.info({ count: ids.length }, 'All apps stopped');
  }

  listApps(): AppInstance[] {
    return Array.from(this.apps.values(), (runtime) => runtime.instance);
  }

  getApp(appId: string): AppInstance | null {
    return this.apps.get(appId)?.instance ?? null;
  }

  recordAppRequest(appId: string): void {
    const runtime = this.apps.get(appId);
    if (!runtime) return;
    runtime.lastRequestAt = Date.now();
    this.scheduleIdleTimeout(appId);
  }

  private allocatePort(): number {
    for (let port = this.portStart; port <= this.portEnd; port++) {
      if (!this.usedPorts.has(port)) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error(
      `No available ports in range ${this.portStart}–${this.portEnd}. All ${this.portEnd - this.portStart + 1} ports in use.`,
    );
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private spawnAppProcess(scaffold: AppScaffold, appPath: string, port: number): ChildProcess {
    const env = { ...process.env, PORT: String(port), HOST: '0.0.0.0' };
    const args = [...scaffold.args];

    if (scaffold.type === 'static') {
      if (!args.includes('-l') && !args.includes('--listen')) {
        args.push('-l', String(port));
      }
    }

    logger.info({ appPath, port, command: scaffold.command, args }, 'Spawning app process');

    return spawn(scaffold.command, args, {
      cwd: appPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  private async waitForHealthy(url: string): Promise<void> {
    const deadline = Date.now() + HEALTH_CHECK_TIMEOUT_MS;
    let lastError: string | null = null;

    while (Date.now() < deadline) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (response.ok) {
          return;
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
    }

    throw new Error(`App health check failed for ${url}` + (lastError ? ` (${lastError})` : ''));
  }

  private scheduleIdleTimeout(appId: string): void {
    const runtime = this.apps.get(appId);
    if (!runtime) return;

    if (runtime.idleTimer) {
      clearTimeout(runtime.idleTimer);
    }

    runtime.idleTimer = setTimeout(() => {
      const latest = this.apps.get(appId);
      if (!latest) return;
      const idleFor = Date.now() - latest.lastRequestAt;
      if (idleFor >= this.idleTimeoutMs) {
        logger.info({ id: appId, port: latest.instance.port }, 'App idle timeout reached');
        this.stopApp(appId);
      } else {
        this.scheduleIdleTimeout(appId);
      }
    }, this.idleTimeoutMs);
  }
}

/**
 * Check whether a TCP port is already in use by attempting to bind to it.
 * Returns true if the port is in use (bind fails with EADDRINUSE).
 */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, '127.0.0.1');
  });
}
