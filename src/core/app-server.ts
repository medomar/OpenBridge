import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from './logger.js';

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
  idleTimeoutMs?: number;
}

const DEFAULT_BASE_URL = 'http://localhost';
const DEFAULT_PORT_START = 3100;
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
}

export class AppServer {
  private readonly apps = new Map<string, AppRuntime>();
  private readonly baseUrl: string;
  private readonly idleTimeoutMs: number;
  private nextPort: number;

  constructor(options: AppServerOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.nextPort = options.portStart ?? DEFAULT_PORT_START;
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
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
    const port = this.nextPort++;
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

    this.scheduleIdleTimeout(id);
    logger.info({ id, port, appPath }, 'App started');
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

    this.apps.delete(appId);
    logger.info({ id: appId, port: runtime.instance.port }, 'App stopped');
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
