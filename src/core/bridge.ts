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

/** Maximum inbound message length — matches sanitizePrompt's cap in agent-runner.ts */
const MAX_INBOUND_LENGTH = 32_768;

export interface BridgeOptions {
  configPath?: string;
  /** Max ms to wait for queue drain on shutdown before proceeding. Default: 30 000 */
  drainTimeoutMs?: number;
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
  private stopped = false;
  private readonly drainTimeoutMs: number;

  constructor(config: AppConfig, options?: BridgeOptions) {
    this.config = config;
    this.configPath = options?.configPath;
    this.drainTimeoutMs = options?.drainTimeoutMs ?? 30_000;
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

  /** Returns the names of all successfully initialized connectors */
  getActiveConnectorNames(): string[] {
    return this.connectors.map((c) => c.name);
  }

  /** Set the Master AI — must be called before start() to enable Master routing */
  setMaster(master: MasterManager): void {
    this.master = master;
    logger.info('Master AI set on Bridge');
  }

  /** Start the bridge: initialize all connectors and providers, begin processing */
  async start(): Promise<void> {
    logger.info('Starting OpenBridge...');

    if (this.master) {
      // V2 flow: Master AI handles all routing — skip provider initialization
      this.router.setMaster(this.master);
      this.master.setRouter(this.router);
      logger.info('Master AI wired into router (V2 mode — providers skipped)');
    } else {
      // V0 flow: initialize providers and wire orchestrator
      for (const providerConfig of this.config.providers) {
        if (!providerConfig.enabled) continue;

        const provider = this.registry.createProvider(providerConfig.type, providerConfig.options);
        await provider.initialize();
        this.router.addProvider(provider);
        this.orchestrator.addProvider(provider);
        this.providers.push(provider);
        logger.info({ provider: provider.name }, 'Provider initialized');
      }

      this.router.setOrchestrator(this.orchestrator);
      logger.info('Agent orchestrator wired into router');
    }

    // Set up queue processing BEFORE connectors — so messages are handled
    // as soon as any connector is ready (don't wait for slow ones like WhatsApp).
    this.queue.onMessage(async (message) => {
      await this.router.route(message);
    });

    // Initialize connectors in parallel — slow connectors (WhatsApp/Puppeteer)
    // must not block fast connectors (Console) from starting.
    const connectorPromises: Promise<void>[] = [];
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

      // Initialize each connector independently — don't await sequentially
      const initPromise = connector
        .initialize()
        .then(() => {
          this.router.addConnector(connector);
          this.connectors.push(connector);
          logger.info({ connector: connector.name }, 'Connector initialized');
        })
        .catch((error: unknown) => {
          logger.error(
            { connector: connector.name, error },
            'Connector initialization failed — other connectors continue',
          );
        });
      connectorPromises.push(initPromise);
    }
    // Wait for all connectors to finish (success or failure)
    await Promise.allSettled(connectorPromises);

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
    if (this.stopped) {
      logger.warn('Bridge.stop() called again — already stopped, skipping');
      return;
    }
    this.stopped = true;
    logger.info('Stopping OpenBridge...');

    logger.info('Draining message queue...');
    const drainTimeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), this.drainTimeoutMs),
    );
    const result = await Promise.race([
      this.queue.drain().then(() => 'done' as const),
      drainTimeout,
    ]);
    if (result === 'timeout') {
      logger.warn(
        { drainTimeoutMs: this.drainTimeoutMs },
        `Queue drain timed out after ${this.drainTimeoutMs}ms — proceeding with shutdown`,
      );
    } else {
      logger.info('Message queue drained');
    }

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

  /**
   * Connectors where every message is an AI command (no shared conversation).
   * Messages from these connectors get the prefix auto-prepended if missing.
   */
  private static readonly DIRECT_AI_CONNECTORS = new Set(['webchat', 'console']);

  private handleIncomingMessage(incomingMessage: InboundMessage, _connector?: Connector): void {
    // Cap rawContent length before any further processing to protect queue, auth, and prefix checks
    let message = incomingMessage;
    if (incomingMessage.rawContent.length > MAX_INBOUND_LENGTH) {
      logger.warn(
        { sender: incomingMessage.sender, originalLength: incomingMessage.rawContent.length },
        `Inbound message truncated from ${incomingMessage.rawContent.length} to ${MAX_INBOUND_LENGTH} chars`,
      );
      message = {
        ...incomingMessage,
        rawContent: incomingMessage.rawContent.slice(0, MAX_INBOUND_LENGTH),
      };
    }

    // Auto-prepend prefix for direct AI connectors (webchat, console) where every
    // message is an AI command. Shared channels (WhatsApp, Telegram, Discord) still
    // require the explicit prefix to distinguish AI commands from normal chat.
    if (
      Bridge.DIRECT_AI_CONNECTORS.has(message.source) &&
      !this.auth.hasPrefix(message.rawContent)
    ) {
      const prefix = this.auth.commandPrefix;
      message = { ...message, rawContent: `${prefix} ${message.rawContent}` };
    }

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
