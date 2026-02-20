import type { AppConfig } from '../types/config.js';
import type { InboundMessage } from '../types/message.js';
import type { Connector } from '../types/connector.js';
import type { AIProvider } from '../types/provider.js';
import type { MasterManager } from '../master/master-manager.js';
import { AuthService } from './auth.js';
import { AuditLogger } from './audit-logger.js';
import { ConfigWatcher } from './config-watcher.js';
import { HealthServer } from './health.js';
import type { HealthStatus, ComponentStatus } from './health.js';
import { MessageQueue } from './queue.js';
import { MetricsCollector, MetricsServer } from './metrics.js';
import { PluginRegistry } from './registry.js';
import { RateLimiter } from './rate-limiter.js';
import { Router } from './router.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { createLogger } from './logger.js';

const logger = createLogger('bridge');

export interface BridgeOptions {
  configPath?: string;
}

export class Bridge {
  private readonly config: AppConfig;
  private readonly auth: AuthService;
  private readonly auditLogger: AuditLogger;
  private configWatcher: ConfigWatcher | null = null;
  private readonly healthServer: HealthServer;
  private readonly metrics: MetricsCollector;
  private readonly metricsServer: MetricsServer;
  private readonly rateLimiter: RateLimiter;
  private readonly queue: MessageQueue;
  private readonly registry: PluginRegistry;
  private readonly router: Router;
  private readonly orchestrator: AgentOrchestrator;
  private master: MasterManager | null = null;
  private readonly connectors: Connector[] = [];
  private readonly providers: AIProvider[] = [];
  private readonly startedAt: number = Date.now();
  private readonly configPath?: string;

  constructor(config: AppConfig, options?: BridgeOptions) {
    this.config = config;
    this.configPath = options?.configPath;
    this.auth = new AuthService(config.auth);
    this.auditLogger = new AuditLogger(config.audit);
    this.healthServer = new HealthServer(config.health);
    this.metrics = new MetricsCollector();
    this.metricsServer = new MetricsServer(config.metrics);
    this.rateLimiter = new RateLimiter(config.auth.rateLimit);
    this.queue = new MessageQueue(config.queue, this.metrics);
    this.registry = new PluginRegistry();
    this.router = new Router(config.defaultProvider, config.router, this.auditLogger, this.metrics);
    this.orchestrator = new AgentOrchestrator(config.defaultProvider);
  }

  /** Register built-in and external plugins before starting */
  getRegistry(): PluginRegistry {
    return this.registry;
  }

  /** Set the Master AI — must be called before start() to enable Master routing */
  setMaster(master: MasterManager): void {
    this.master = master;
    logger.info('Master AI set on Bridge');
  }

  /** Start the bridge: initialize all connectors and providers, begin processing */
  async start(): Promise<void> {
    logger.info('Starting OpenBridge...');

    // Initialize providers
    for (const providerConfig of this.config.providers) {
      if (!providerConfig.enabled) continue;

      const provider = this.registry.createProvider(providerConfig.type, providerConfig.options);
      await provider.initialize();
      this.router.addProvider(provider);
      this.orchestrator.addProvider(provider);
      this.providers.push(provider);
      logger.info({ provider: provider.name }, 'Provider initialized');
    }

    // Wire Master into the router if set (priority routing path)
    if (this.master) {
      this.router.setMaster(this.master);
      logger.info('Master AI wired into router');
    } else {
      // Wire orchestrator into the router as fallback
      this.router.setOrchestrator(this.orchestrator);
      logger.info('Agent orchestrator wired into router');
    }

    // Initialize connectors
    for (const connectorConfig of this.config.connectors) {
      if (!connectorConfig.enabled) continue;

      const connector = this.registry.createConnector(
        connectorConfig.type,
        connectorConfig.options,
      );

      connector.on('message', (message: InboundMessage) => {
        this.handleIncomingMessage(message, connector);
      });

      connector.on('ready', () => {
        logger.info({ connector: connector.name }, 'Connector ready');
      });

      connector.on('error', (error: Error) => {
        logger.error({ connector: connector.name, error }, 'Connector error');
      });

      await connector.initialize();
      this.router.addConnector(connector);
      this.connectors.push(connector);
      logger.info({ connector: connector.name }, 'Connector initialized');
    }

    // Set up queue processing
    this.queue.onMessage(async (message) => {
      await this.router.route(message);
    });

    // Start health check endpoint
    this.healthServer.setDataProvider(() => this.getHealthStatus());
    await this.healthServer.start();

    // Start metrics endpoint
    this.metricsServer.setDataProvider(() => this.metrics.snapshot());
    await this.metricsServer.start();

    // Start config file watcher for hot-reload
    if (this.configPath) {
      this.configWatcher = new ConfigWatcher(this.configPath);
      this.configWatcher.onChange((newConfig) => this.onConfigChange(newConfig));
      this.configWatcher.start();
    }

    logger.info('OpenBridge started successfully');
  }

  /** Stop the bridge gracefully — drains in-flight messages, then shuts down connectors and providers */
  async stop(): Promise<void> {
    logger.info('Stopping OpenBridge...');

    logger.info('Draining message queue...');
    await this.queue.drain();
    logger.info('Message queue drained');

    // Shut down Master AI if set
    if (this.master) {
      await this.master.shutdown();
      logger.info('Master AI shut down');
    }

    // Shut down orchestrator — cancels active agents before providers are torn down
    const activeAgents = this.orchestrator.getActiveAgents().length;
    if (activeAgents > 0) {
      logger.info({ activeAgents }, 'Cancelling active agents before shutdown');
    }
    this.orchestrator.shutdown();
    logger.info('Agent orchestrator shut down');

    for (const connector of this.connectors) {
      try {
        await connector.shutdown();
        logger.info({ connector: connector.name }, 'Connector shut down');
      } catch (error) {
        logger.error({ connector: connector.name, error }, 'Error shutting down connector');
      }
    }

    for (const provider of this.providers) {
      try {
        await provider.shutdown();
        logger.info({ provider: provider.name }, 'Provider shut down');
      } catch (error) {
        logger.error({ provider: provider.name, error }, 'Error shutting down provider');
      }
    }

    this.configWatcher?.stop();

    await this.healthServer.stop();
    await this.metricsServer.stop();

    logger.info('OpenBridge stopped');
  }

  private onConfigChange(newConfig: AppConfig): void {
    logger.info('Applying hot-reloaded configuration');

    this.auth.updateConfig(newConfig.auth);
    this.rateLimiter.updateConfig(newConfig.auth.rateLimit);

    logger.info('Configuration hot-reload complete');
  }

  private getHealthStatus(): HealthStatus {
    const connectorStatuses: ComponentStatus[] = this.connectors.map((c) => ({
      name: c.name,
      status: c.isConnected() ? 'healthy' : 'unhealthy',
    }));

    const providerStatuses: ComponentStatus[] = this.providers.map((p) => ({
      name: p.name,
      status: 'healthy' as const,
    }));

    const orchestratorSnapshot = this.orchestrator.getHealthSnapshot();

    const allStatuses = [...connectorStatuses, ...providerStatuses];
    const hasUnhealthy = allStatuses.some((s) => s.status === 'unhealthy');
    const hasDegraded = allStatuses.some((s) => s.status === 'degraded');

    // Check for failed agents — degrade health if any agents have failed
    const failedAgents = orchestratorSnapshot.byStatus['failed'] ?? 0;
    const hasFailedAgents = failedAgents > 0;

    let overall: HealthStatus['status'] = 'healthy';
    if (hasUnhealthy) overall = 'unhealthy';
    else if (hasDegraded || hasFailedAgents) overall = 'degraded';

    return {
      status: overall,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      timestamp: new Date().toISOString(),
      connectors: connectorStatuses,
      providers: providerStatuses,
      queue: {
        pending: this.queue.size,
        processing: this.queue.isProcessing,
        deadLetterSize: this.queue.deadLetterSize,
      },
      orchestrator: orchestratorSnapshot,
    };
  }

  private handleIncomingMessage(message: InboundMessage, _connector?: Connector): void {
    this.metrics.recordReceived();

    if (!this.auth.isAuthorized(message.sender)) {
      logger.warn({ sender: message.sender }, 'Unauthorized sender');
      void this.auditLogger.logAuthDenied(message.sender);
      return;
    }

    if (!this.auth.hasPrefix(message.rawContent)) {
      return; // Not a command, ignore silently
    }

    this.metrics.recordAuthorized();

    if (!this.rateLimiter.isAllowed(message.sender)) {
      logger.warn({ sender: message.sender }, 'Message dropped — rate limit exceeded');
      void this.auditLogger.logRateLimited(message.sender);
      this.metrics.recordRateLimited();
      return;
    }

    const strippedContent = this.auth.stripPrefix(message.rawContent);
    const metadata: Record<string, unknown> = { ...message.metadata };

    const filterResult = this.auth.filterCommand(strippedContent);
    if (!filterResult.allowed) {
      logger.warn({ sender: message.sender }, 'Message blocked by command filter');
      this.metrics.recordCommandBlocked();
      return;
    }

    const cleaned: InboundMessage = {
      ...message,
      content: strippedContent,
      metadata,
    };

    void this.auditLogger.logInbound(cleaned);
    void this.queue.enqueue(cleaned);
  }
}
