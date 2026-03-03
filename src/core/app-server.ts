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
}

const DEFAULT_BASE_URL = 'http://localhost';
const DEFAULT_PORT_START = 3100;

export class AppServer {
  private readonly apps = new Map<string, AppInstance>();
  private readonly baseUrl: string;
  private nextPort: number;

  constructor(options: AppServerOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.nextPort = options.portStart ?? DEFAULT_PORT_START;
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

  startApp(appPath: string): AppInstance {
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

    this.apps.set(id, instance);
    logger.info({ id, port, appPath }, 'App registered');
    return instance;
  }

  stopApp(appId: string): void {
    const instance = this.apps.get(appId);
    if (!instance) return;
    instance.status = 'stopped';
    this.apps.delete(appId);
    logger.info({ id: appId, port: instance.port }, 'App stopped');
  }

  listApps(): AppInstance[] {
    return Array.from(this.apps.values());
  }

  getApp(appId: string): AppInstance | null {
    return this.apps.get(appId) ?? null;
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
