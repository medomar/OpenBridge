import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { MetricsConfig } from '../types/config.js';
import { createLogger } from './logger.js';

const logger = createLogger('metrics');

export interface MetricsSnapshot {
  uptime: number;
  timestamp: string;
  messages: {
    received: number;
    authorized: number;
    rateLimited: number;
    commandBlocked: number;
    processed: number;
    failed: number;
  };
  latency: {
    count: number;
    totalMs: number;
    avgMs: number;
    minMs: number;
    maxMs: number;
  };
  queue: {
    enqueued: number;
    retries: number;
    deadLettered: number;
  };
  errors: {
    total: number;
    transient: number;
    permanent: number;
  };
}

export type MetricsDataProvider = () => MetricsSnapshot;

const DEFAULT_CONFIG: MetricsConfig = {
  enabled: false,
  port: 9090,
};

/**
 * In-memory metrics collector.
 *
 * Tracks message counts, latency, and error rates.
 * Injected into Bridge, Router, and Queue as an optional dependency.
 */
export class MetricsCollector {
  private readonly startedAt: number = Date.now();

  // Message counters
  private _received = 0;
  private _authorized = 0;
  private _rateLimited = 0;
  private _commandBlocked = 0;
  private _processed = 0;
  private _failed = 0;

  // Latency tracking
  private _latencyCount = 0;
  private _latencyTotalMs = 0;
  private _latencyMinMs = Infinity;
  private _latencyMaxMs = -Infinity;

  // Queue counters
  private _enqueued = 0;
  private _retries = 0;
  private _deadLettered = 0;

  // Error counters
  private _errorsTotal = 0;
  private _errorsTransient = 0;
  private _errorsPermanent = 0;

  recordReceived(): void {
    this._received++;
  }

  recordAuthorized(): void {
    this._authorized++;
  }

  recordRateLimited(): void {
    this._rateLimited++;
  }

  recordCommandBlocked(): void {
    this._commandBlocked++;
  }

  recordProcessed(durationMs: number): void {
    this._processed++;
    this._latencyCount++;
    this._latencyTotalMs += durationMs;
    if (durationMs < this._latencyMinMs) this._latencyMinMs = durationMs;
    if (durationMs > this._latencyMaxMs) this._latencyMaxMs = durationMs;
  }

  recordFailed(kind: 'transient' | 'permanent' | 'unknown'): void {
    this._failed++;
    this._errorsTotal++;
    if (kind === 'transient') this._errorsTransient++;
    else if (kind === 'permanent') this._errorsPermanent++;
  }

  recordEnqueued(): void {
    this._enqueued++;
  }

  recordRetry(): void {
    this._retries++;
  }

  recordDeadLettered(): void {
    this._deadLettered++;
  }

  snapshot(): MetricsSnapshot {
    return {
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      messages: {
        received: this._received,
        authorized: this._authorized,
        rateLimited: this._rateLimited,
        commandBlocked: this._commandBlocked,
        processed: this._processed,
        failed: this._failed,
      },
      latency: {
        count: this._latencyCount,
        totalMs: this._latencyTotalMs,
        avgMs: this._latencyCount > 0 ? Math.round(this._latencyTotalMs / this._latencyCount) : 0,
        minMs: this._latencyMinMs === Infinity ? 0 : this._latencyMinMs,
        maxMs: this._latencyMaxMs === -Infinity ? 0 : this._latencyMaxMs,
      },
      queue: {
        enqueued: this._enqueued,
        retries: this._retries,
        deadLettered: this._deadLettered,
      },
      errors: {
        total: this._errorsTotal,
        transient: this._errorsTransient,
        permanent: this._errorsPermanent,
      },
    };
  }
}

/**
 * HTTP server that exposes collected metrics as JSON.
 *
 * Follows the same pattern as HealthServer — disabled by default,
 * configurable port, data provider injection.
 */
export class MetricsServer {
  private readonly config: MetricsConfig;
  private server: Server | null = null;
  private dataProvider: MetricsDataProvider | null = null;

  constructor(config: Partial<MetricsConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  setDataProvider(provider: MetricsDataProvider): void {
    this.dataProvider = provider;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      logger.debug('Metrics endpoint disabled');
      return;
    }

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      this.handleRequest(req, res);
    });

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, () => {
        logger.info({ port: this.config.port }, 'Metrics endpoint started');
        resolve();
      });

      this.server!.on('error', (error: Error) => {
        logger.error({ error }, 'Metrics server error');
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        logger.info('Metrics endpoint stopped');
        this.server = null;
        resolve();
      });
    });
  }

  private handleRequest(_req: IncomingMessage, res: ServerResponse): void {
    if (!this.dataProvider) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not initialized' }));
      return;
    }

    const metrics = this.dataProvider();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics));
  }
}
