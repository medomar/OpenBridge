import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { HealthConfig } from '../types/config.js';
import { createLogger } from './logger.js';

const logger = createLogger('health');

export interface ComponentStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  timestamp: string;
  connectors: ComponentStatus[];
  providers: ComponentStatus[];
  queue: {
    pending: number;
    processing: boolean;
    deadLetterSize: number;
  };
}

export type HealthDataProvider = () => HealthStatus;

const DEFAULT_CONFIG: HealthConfig = {
  enabled: false,
  port: 8080,
};

export class HealthServer {
  private readonly config: HealthConfig;
  private server: Server | null = null;
  private dataProvider: HealthDataProvider | null = null;

  constructor(config: Partial<HealthConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setDataProvider(provider: HealthDataProvider): void {
    this.dataProvider = provider;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.debug('Health check endpoint disabled');
      return;
    }

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, () => {
        logger.info({ port: this.config.port }, 'Health check endpoint started');
        resolve();
      });

      this.server!.on('error', (error: Error) => {
        logger.error({ error }, 'Health check server error');
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        logger.info('Health check endpoint stopped');
        this.server = null;
        resolve();
      });
    });
  }

  private handleRequest(_req: IncomingMessage, res: ServerResponse): void {
    if (!this.dataProvider) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy', error: 'Not initialized' }));
      return;
    }

    const health = this.dataProvider();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
  }
}
