import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { V2ConfigSchema } from '../types/config.js';
import type { HealthConfig, MCPServer, V2Config } from '../types/config.js';
import type { MetricsSnapshot } from './metrics.js';
import { createLogger } from './logger.js';

const logger = createLogger('health');

export interface ComponentStatus {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
}

export interface McpServerStatus {
  name: string;
  status: 'configured' | 'error';
  command: string;
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
  mcp?: {
    enabled: boolean;
    servers: McpServerStatus[];
  };
}

/**
 * Check whether a command exists on PATH using `which` (Unix) or `where` (Windows).
 * Returns true if found, false if not.
 */
export function checkCommandOnPath(command: string): boolean {
  try {
    const whichCmd = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(whichCmd, [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check health of a list of MCP servers by verifying their commands exist on PATH.
 * Returns the mcp health section ready to include in HealthStatus.
 */
export function checkMcpServersHealth(servers: MCPServer[]): HealthStatus['mcp'] {
  if (servers.length === 0) {
    return { enabled: true, servers: [] };
  }
  return {
    enabled: true,
    servers: servers.map((server) => ({
      name: server.name,
      command: server.command,
      status: checkCommandOnPath(server.command) ? 'configured' : 'error',
    })),
  };
}

export interface HealthCheckItem {
  name: string;
  passed: boolean;
  message: string;
}

export interface HealthCheckResult {
  passed: boolean;
  checks: HealthCheckItem[];
}

/**
 * Run a pre-flight health check suitable for use from both the CLI wizard and the HTTP endpoint.
 * Checks: config file validity, AI tool availability, workspace path accessibility,
 * and connector-specific prerequisites (Telegram token, Discord credentials).
 *
 * @param configPath - Absolute path to config.json. Defaults to `<cwd>/config.json`.
 */
export function runHealthCheck(configPath?: string): HealthCheckResult {
  const checks: HealthCheckItem[] = [];
  const resolvedPath = configPath ?? resolve(process.cwd(), 'config.json');

  // Check 1: Config file exists and is valid
  let config: V2Config | null = null;
  if (!existsSync(resolvedPath)) {
    checks.push({
      name: 'Config file',
      passed: false,
      message: `config.json not found at ${resolvedPath}`,
    });
  } else {
    try {
      const raw = readFileSync(resolvedPath, 'utf-8');
      const json = JSON.parse(raw) as unknown;
      const result = V2ConfigSchema.safeParse(json);
      if (result.success) {
        config = result.data;
        checks.push({
          name: 'Config file',
          passed: true,
          message: `config.json is valid`,
        });
      } else {
        const firstIssue = result.error.issues[0]?.message ?? 'unknown error';
        checks.push({
          name: 'Config file',
          passed: false,
          message: `config.json has validation errors: ${firstIssue}`,
        });
      }
    } catch (err) {
      checks.push({
        name: 'Config file',
        passed: false,
        message: `config.json is not valid JSON: ${(err as Error).message}`,
      });
    }
  }

  // Check 2: At least one AI tool available
  const aiTools = ['claude', 'codex', 'aider'];
  const foundTools = aiTools.filter((tool) => checkCommandOnPath(tool));
  if (foundTools.length > 0) {
    checks.push({
      name: 'AI tools',
      passed: true,
      message: `Found: ${foundTools.join(', ')}`,
    });
  } else {
    checks.push({
      name: 'AI tools',
      passed: false,
      message: 'No AI tools found. Install claude, codex, or aider.',
    });
  }

  if (config) {
    // Check 3: Workspace path accessible
    if (existsSync(config.workspacePath)) {
      checks.push({
        name: 'Workspace path',
        passed: true,
        message: `Workspace accessible: ${config.workspacePath}`,
      });
    } else {
      checks.push({
        name: 'Workspace path',
        passed: false,
        message: `Workspace path not found: ${config.workspacePath}`,
      });
    }

    // Check 4: Connector-specific prerequisites
    for (const channel of config.channels) {
      if (!channel.enabled) continue;
      const opts = channel.options ?? {};

      if (channel.type === 'telegram') {
        if (opts['token']) {
          checks.push({
            name: 'Telegram token',
            passed: true,
            message: 'Telegram bot token is configured',
          });
        } else {
          checks.push({
            name: 'Telegram token',
            passed: false,
            message: 'Telegram connector requires a bot token (options.token)',
          });
        }
      } else if (channel.type === 'discord') {
        const hasToken = Boolean(opts['token']);
        const hasAppId = Boolean(opts['applicationId'] ?? opts['appId']);
        if (hasToken && hasAppId) {
          checks.push({
            name: 'Discord credentials',
            passed: true,
            message: 'Discord bot token and application ID are configured',
          });
        } else {
          const missing: string[] = [];
          if (!hasToken) missing.push('token');
          if (!hasAppId) missing.push('applicationId');
          checks.push({
            name: 'Discord credentials',
            passed: false,
            message: `Discord connector requires: ${missing.join(', ')} in options`,
          });
        }
      }
    }
  }

  return {
    passed: checks.every((c) => c.passed),
    checks,
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
  private mcpServers: MCPServer[] = [];

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

  /**
   * Configure the MCP servers to health-check on each /health request.
   * Call this after Bridge.start() with servers from V2Config.mcp.servers.
   * When servers are set, the /health response includes an `mcp` section
   * reporting whether each server's command exists on PATH.
   */
  setMcpServers(servers: MCPServer[]): void {
    this.mcpServers = servers;
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

    if (this.mcpServers.length > 0) {
      health.mcp = checkMcpServersHealth(this.mcpServers);
    }

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
