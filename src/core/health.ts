import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { HealthConfig } from '../types/config.js';
import type { MetricsSnapshot } from './metrics.js';
import { createLogger } from './logger.js';

const logger = createLogger('health');

export interface ComponentStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime_seconds: number;
  memory_mb: number;
  active_workers: number;
  master_status: string;
  db_status: 'connected' | 'disconnected';
  last_message_at: string | null;
  timestamp: string;
  connectors: ComponentStatus[];
  providers: ComponentStatus[];
  queue: {
    pending: number;
    processing: boolean;
    deadLetterSize: number;
  };
  orchestrator?: {
    totalAgents: number;
    activeAgents: number;
    taskAgents: number;
    byStatus: Record<string, number>;
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
  private metricsProvider: (() => MetricsSnapshot) | null = null;
  private readinessProvider: (() => boolean) | null = null;

  constructor(config: Partial<HealthConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setDataProvider(provider: HealthDataProvider): void {
    this.dataProvider = provider;
  }

  setMetricsProvider(provider: () => MetricsSnapshot): void {
    this.metricsProvider = provider;
  }

  setReadinessProvider(provider: () => boolean): void {
    this.readinessProvider = provider;
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

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const path = url.split('?')[0];

    if (path === '/health' || path === '/') {
      this.handleHealthRequest(res);
    } else if (path === '/metrics') {
      this.handleMetricsRequest(res);
    } else if (path === '/ready') {
      this.handleReadyRequest(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  }

  private handleHealthRequest(res: ServerResponse): void {
    if (!this.dataProvider) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'unhealthy', error: 'Not initialized' }));
      return;
    }

    const health = this.dataProvider();
    const statusCode = health.status === 'unhealthy' ? 503 : 200;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health));
  }

  private handleMetricsRequest(res: ServerResponse): void {
    const lines: string[] = [];

    if (this.metricsProvider) {
      const snap = this.metricsProvider();
      lines.push(
        '# HELP openbridge_messages_received_total Total inbound messages received',
        '# TYPE openbridge_messages_received_total counter',
        `openbridge_messages_received_total ${snap.messages.received}`,
        '',
        '# HELP openbridge_messages_processed_total Total messages successfully processed',
        '# TYPE openbridge_messages_processed_total counter',
        `openbridge_messages_processed_total ${snap.messages.processed}`,
        '',
        '# HELP openbridge_messages_failed_total Total messages that failed processing',
        '# TYPE openbridge_messages_failed_total counter',
        `openbridge_messages_failed_total ${snap.messages.failed}`,
        '',
        '# HELP openbridge_errors_total Total error count',
        '# TYPE openbridge_errors_total counter',
        `openbridge_errors_total ${snap.errors.total}`,
        '',
        '# HELP openbridge_response_latency_ms_avg Average response latency in milliseconds',
        '# TYPE openbridge_response_latency_ms_avg gauge',
        `openbridge_response_latency_ms_avg ${snap.latency.avgMs}`,
        '',
        '# HELP openbridge_response_latency_ms_min Minimum response latency in milliseconds',
        '# TYPE openbridge_response_latency_ms_min gauge',
        `openbridge_response_latency_ms_min ${snap.latency.minMs}`,
        '',
        '# HELP openbridge_response_latency_ms_max Maximum response latency in milliseconds',
        '# TYPE openbridge_response_latency_ms_max gauge',
        `openbridge_response_latency_ms_max ${snap.latency.maxMs}`,
        '',
        '# HELP openbridge_response_latency_ms_total Cumulative response latency in milliseconds',
        '# TYPE openbridge_response_latency_ms_total counter',
        `openbridge_response_latency_ms_total ${snap.latency.totalMs}`,
        '',
        '# HELP openbridge_response_latency_count_total Total number of measured responses',
        '# TYPE openbridge_response_latency_count_total counter',
        `openbridge_response_latency_count_total ${snap.latency.count}`,
        '',
        '# HELP openbridge_queue_enqueued_total Total messages enqueued',
        '# TYPE openbridge_queue_enqueued_total counter',
        `openbridge_queue_enqueued_total ${snap.queue.enqueued}`,
        '',
        '# HELP openbridge_uptime_seconds Bridge uptime in seconds',
        '# TYPE openbridge_uptime_seconds gauge',
        `openbridge_uptime_seconds ${snap.uptime}`,
      );
    }

    if (this.dataProvider) {
      const health = this.dataProvider();
      lines.push(
        '',
        '# HELP openbridge_workers_active Current number of active worker agents',
        '# TYPE openbridge_workers_active gauge',
        `openbridge_workers_active ${health.active_workers}`,
      );
    }

    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
    res.end(lines.join('\n') + '\n');
  }

  private handleReadyRequest(res: ServerResponse): void {
    if (!this.readinessProvider || !this.readinessProvider()) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready: false, reason: 'Master AI not initialized' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ready: true }));
  }
}
