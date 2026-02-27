import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig, EmailConfig } from '../types/config.js';
import type { InboundMessage, OutboundMessage } from '../types/message.js';
import type { Connector } from '../types/connector.js';
import type { AIProvider } from '../types/provider.js';
import type { MasterManager } from '../master/master-manager.js';
import { MemoryManager } from '../memory/index.js';
import { AuthService } from './auth.js';
import { AuditLogger } from './audit-logger.js';
import { ConfigWatcher } from './config-watcher.js';
import { FileServer } from './file-server.js';
import { HealthServer } from './health.js';
import type { HealthStatus, ComponentStatus } from './health.js';
import { MessageQueue } from './queue.js';
import { MetricsCollector, MetricsServer } from './metrics.js';
import { PluginRegistry } from './registry.js';
import { RateLimiter } from './rate-limiter.js';
import { Router, classifyMessagePriority } from './router.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { createLogger } from './logger.js';

const logger = createLogger('bridge');

/** Maximum inbound message length — matches sanitizePrompt's cap in agent-runner.ts */
const MAX_INBOUND_LENGTH = 32_768;

export interface BridgeOptions {
  configPath?: string;
  /** Max ms to wait for queue drain on shutdown before proceeding. Default: 30 000 */
  drainTimeoutMs?: number;
  /** Absolute path to the target workspace — when provided, MemoryManager is created for SQLite persistence */
  workspacePath?: string;
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
  private memory: MemoryManager | null = null;
  private fileServer: FileServer | null = null;
  private readonly workspacePath: string | undefined;
  private readonly connectors: Connector[] = [];
  private readonly providers: AIProvider[] = [];
  private readonly startedAt: number = Date.now();
  private readonly configPath?: string;
  private stopped = false;
  private readonly drainTimeoutMs: number;
  private agentStatusInterval: ReturnType<typeof setInterval> | null = null;
  private evictionInterval: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt: string | null = null;

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

    if (options?.workspacePath) {
      this.workspacePath = options.workspacePath;
      const dbPath = path.join(options.workspacePath, '.openbridge', 'openbridge.db');
      this.memory = new MemoryManager(dbPath);
      this.fileServer = new FileServer(options.workspacePath);
      this.router.setWorkspacePath(options.workspacePath);
    }
  }

  /** Register built-in and external plugins before starting */
  getRegistry(): PluginRegistry {
    return this.registry;
  }

  /** Returns the names of all successfully initialized connectors */
  getActiveConnectorNames(): string[] {
    return this.connectors.map((c) => c.name);
  }

  /** Returns the MemoryManager instance (null if no workspacePath was provided or init failed) */
  getMemory(): MemoryManager | null {
    return this.memory;
  }

  /** Set the Master AI — must be called before start() to enable Master routing */
  setMaster(master: MasterManager): void {
    this.master = master;
    logger.info('Master AI set on Bridge');
  }

  /** Set the email config — enables [SHARE:email] marker support in the router */
  setEmailConfig(config: EmailConfig): void {
    this.router.setEmailConfig(config);
    logger.info('Email config set on Router');
  }

  /** Start the bridge: initialize all connectors and providers, begin processing */
  async start(): Promise<void> {
    logger.info('Starting OpenBridge...');

    // Initialize memory system (SQLite) — non-fatal: DotFolderManager is the fallback
    if (this.memory) {
      try {
        await this.memory.init();
        await this.memory.migrate();
        logger.info('MemoryManager initialized and migrated');

        // Wire SQLite audit persistence into AuditLogger
        this.auditLogger.setMemory(this.memory);
      } catch (error) {
        logger.error(
          { err: error },
          'MemoryManager initialization failed — continuing with DotFolderManager fallback',
        );
        this.memory = null;
      }
    }

    // Clean up legacy .openbridge/ artifacts that were migrated to SQLite
    if (this.memory && this.workspacePath) {
      await this.cleanLegacyDotFolderArtifacts(this.workspacePath, this.memory);
    }

    // Schedule periodic DB eviction — run once on startup, then every 24 hours
    if (this.memory) {
      const runEviction = (): void => {
        logger.info('Running scheduled DB eviction');
        void this.memory!.evictOldData()
          .then(() => {
            logger.info('DB eviction complete');
          })
          .catch((err: unknown) => {
            logger.error({ err }, 'DB eviction failed');
          });
      };
      runEviction();
      this.evictionInterval = setInterval(runEviction, 24 * 60 * 60 * 1000);
    }

    // Wire auth service into router for SEND marker whitelist enforcement
    this.router.setAuth(this.auth);

    // Attach the SQLite DB to the auth service for access_control enforcement
    if (this.memory) {
      const db = this.memory.getDb();
      if (db) this.auth.setDatabase(db);
    }

    // Wire memory into router for "status" command support
    if (this.memory) {
      this.router.setMemory(this.memory);
    }

    // Wire message queue into router for queue-depth display in "status" command
    this.router.setQueue(this.queue);

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
      // Snapshot daily cost before routing so we can attribute the delta to this user.
      let costBefore = 0;
      if (this.memory) {
        try {
          costBefore = await this.memory.getDailyCost();
        } catch {
          // best-effort — cost attribution skipped if this fails
        }
      }

      await this.router.route(message);

      // Increment daily_cost_used by the cost incurred during this task.
      if (this.memory) {
        try {
          const costAfter = await this.memory.getDailyCost();
          const delta = Math.max(0, costAfter - costBefore);
          if (delta > 0) {
            this.auth.incrementDailyCost(message.sender, message.source, delta);
          }
        } catch {
          // best-effort — cost tracking is non-fatal
        }
      }
    });

    // Notify users when their message must wait behind an in-flight message.
    // Includes queue position and estimated wait based on recent processing times.
    this.queue.onQueued((message, position, estimatedWaitMs) => {
      const waitStr =
        estimatedWaitMs < 60_000
          ? `~${Math.ceil(estimatedWaitMs / 1000)}s`
          : `~${Math.round(estimatedWaitMs / 60_000)}m`;
      const content = `You're #${position} in queue (${waitStr}). I'll get to your message shortly.`;
      void this.router.sendDirect(message.source, message.sender, content, message.id);
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

    // Start agent status broadcasting to WebChat dashboard (2s poll — best-effort)
    if (this.memory) {
      this.agentStatusInterval = setInterval(() => {
        void this.broadcastAgentStatusToWebChat();
      }, 2000);
    }

    // Start health check endpoint
    this.healthServer.setDataProvider(() => this.getHealthStatus());
    this.healthServer.setMetricsProvider(() => this.metrics.snapshot());
    this.healthServer.setReadinessProvider(
      () => this.master !== null && this.master.getState() === 'ready',
    );
    await this.healthServer.start();

    // Start metrics endpoint
    this.metricsServer.setDataProvider(() => this.metrics.snapshot());
    await this.metricsServer.start();

    // Start local file server for generated content (non-fatal)
    if (this.fileServer) {
      try {
        await this.fileServer.start();
        logger.info(
          { url: this.fileServer.baseUrl, dir: this.fileServer.directory },
          'File server started — generated content available at /shared/:filename',
        );
      } catch (error) {
        logger.warn({ err: error }, 'File server failed to start — continuing without it');
        this.fileServer = null;
      }
    }

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

    if (this.agentStatusInterval) {
      clearInterval(this.agentStatusInterval);
      this.agentStatusInterval = null;
    }

    if (this.evictionInterval) {
      clearInterval(this.evictionInterval);
      this.evictionInterval = null;
    }

    this.configWatcher?.stop();

    await this.healthServer.stop();
    await this.metricsServer.stop();

    if (this.fileServer) {
      try {
        await this.fileServer.stop();
      } catch (error) {
        logger.warn({ err: error }, 'Error stopping file server');
      }
    }

    if (this.memory) {
      try {
        await this.memory.close();
        logger.info('MemoryManager closed');
      } catch (error) {
        logger.error({ err: error }, 'Error closing MemoryManager');
      }
    }

    logger.info('OpenBridge stopped');
  }

  private onConfigChange(newConfig: AppConfig): void {
    logger.info('Applying hot-reloaded configuration');

    this.auth.updateConfig(newConfig.auth);
    this.rateLimiter.updateConfig(newConfig.auth.rateLimit);

    logger.info('Configuration hot-reload complete');
  }

  /** Poll active agent activity and broadcast to any connector that supports it (e.g. WebChat). */
  private async broadcastAgentStatusToWebChat(): Promise<void> {
    if (!this.memory) return;
    try {
      const agents = await this.memory.getActiveAgents();
      for (const connector of this.connectors) {
        const c = connector as { broadcastAgentStatus?: (agents: unknown[]) => void };
        if (typeof c.broadcastAgentStatus === 'function') {
          c.broadcastAgentStatus(agents);
        }
      }
    } catch {
      // Non-fatal — dashboard updates are best-effort
    }
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
      uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
      memory_mb: Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 10) / 10,
      active_workers: orchestratorSnapshot.activeAgents,
      master_status: this.master ? this.master.getState() : 'not_configured',
      db_status: this.memory ? 'connected' : 'disconnected',
      last_message_at: this.lastMessageAt,
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

  private handleIncomingMessage(incomingMessage: InboundMessage, connector?: Connector): void {
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
    this.lastMessageAt = new Date().toISOString();

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

    // Access control check: verify role, action, scope, and daily budget.
    // Runs after prefix-stripping so the classifier receives the actual command text.
    const accessResult = this.auth.checkAccessControl(
      message.sender,
      message.source,
      strippedContent,
    );
    if (!accessResult.allowed) {
      logger.warn(
        { sender: message.sender, reason: accessResult.reason },
        'Message blocked by access control',
      );
      this.metrics.recordCommandBlocked();
      void this.auditLogger.logAuthDenied(message.sender);
      // Send a denial message so the user knows why their request was rejected.
      if (connector) {
        const denialMsg: OutboundMessage = {
          target: message.source,
          recipient: message.sender,
          content: accessResult.reason ?? 'You do not have permission to perform that action.',
          replyTo: message.id,
        };
        void connector.sendMessage(denialMsg);
      }
      return;
    }

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
    const priority = classifyMessagePriority(cleaned.content);
    void this.queue.enqueue(cleaned, priority);
  }

  /**
   * Remove legacy .openbridge/ artifacts that have been migrated to SQLite.
   * Called on startup after memory.init() and memory.migrate() succeed.
   * Only deletes files/dirs when the corresponding data exists in the DB,
   * to avoid data loss on the first run before migration has occurred.
   */
  private async cleanLegacyDotFolderArtifacts(
    workspacePath: string,
    memory: MemoryManager,
  ): Promise<void> {
    const dotFolderPath = path.join(workspacePath, '.openbridge');

    try {
      await fs.access(dotFolderPath);
    } catch {
      return; // .openbridge/ doesn't exist yet — nothing to clean
    }

    // 1. exploration.log — logging is now in the DB
    try {
      await fs.unlink(path.join(dotFolderPath, 'exploration.log'));
      logger.info('Removed legacy .openbridge/exploration.log');
    } catch {
      // File doesn't exist — no-op
    }

    // 2. exploration/ directory — exploration state is now in system_config
    try {
      await fs.access(path.join(dotFolderPath, 'exploration'));
      await fs.rm(path.join(dotFolderPath, 'exploration'), { recursive: true, force: true });
      logger.info('Removed legacy .openbridge/exploration/ directory');
    } catch {
      // Directory doesn't exist — no-op
    }

    // 3. prompts/ directory — only remove when memory already holds the manifest,
    //    to avoid deleting prompt data before it has been migrated to the DB.
    try {
      await fs.access(path.join(dotFolderPath, 'prompts'));
      const manifest = await memory.getPromptManifest();
      if (manifest !== null) {
        await fs.rm(path.join(dotFolderPath, 'prompts'), { recursive: true, force: true });
        logger.info('Removed legacy .openbridge/prompts/ directory');
      }
    } catch {
      // Directory doesn't exist — no-op
    }

    // 4. *.migrated backup files — safe to delete (migration has already run)
    try {
      const entries = await fs.readdir(dotFolderPath);
      for (const entry of entries) {
        if (entry.endsWith('.migrated')) {
          await fs.unlink(path.join(dotFolderPath, entry));
          logger.info({ file: entry }, 'Removed legacy .migrated backup file');
        }
      }
    } catch {
      // Best-effort — ignore readdir or unlink errors
    }
  }
}
