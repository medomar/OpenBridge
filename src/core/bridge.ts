import * as fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { AppConfig, EmailConfig, MCPServer, SecurityConfig } from '../types/config.js';
import { V2ConfigSchema, ENV_DENY_PATTERNS } from '../types/config.js';
import type { DiscoveredTool } from '../types/discovery.js';
import { warnAboutExposedSecrets } from './env-sanitizer.js';
import { TunnelManager } from './tunnel-manager.js';
// Side-effect imports: each adapter auto-registers with TunnelManager on load
import './cloudflared-adapter.js';
import './ngrok-adapter.js';
import type { InboundMessage, OutboundMessage } from '../types/message.js';
import type { Connector } from '../types/connector.js';
import type { AIProvider } from '../types/provider.js';
import type { MasterManager } from '../master/master-manager.js';
import { DotFolderManager } from '../master/dotfolder-manager.js';
import { KnowledgeRetriever } from './knowledge-retriever.js';
import { MemoryManager } from '../memory/index.js';
import { createMediaManager } from './media-manager.js';
import type { MediaManager } from './media-manager.js';
import type { McpRegistry } from './mcp-registry.js';
import { AuthService } from './auth.js';
import { AuditLogger } from './audit-logger.js';
import { ConfigWatcher } from './config-watcher.js';
import { FileServer } from './file-server.js';
import { HealthServer } from './health.js';
import type { HealthStatus, ComponentStatus } from './health.js';
import { MessageQueue } from './queue.js';
import { MetricsCollector, MetricsServer } from './metrics.js';
import { setAgentRunnerMetrics } from './agent-runner.js';
import { PluginRegistry } from './registry.js';
import { RateLimiter } from './rate-limiter.js';
import { Router, classifyMessagePriority } from './router.js';
import { AgentOrchestrator } from './agent-orchestrator.js';
import type { AppServer } from './app-server.js';
import type { InteractionRelay } from './interaction-relay.js';
import { SecretScanner } from './secret-scanner.js';
import type { SecretMatch } from './secret-scanner.js';
import { DockerSandbox, DockerHealthMonitor, cleanupSandboxContainers } from './docker-sandbox.js';
import { IntegrationHub } from '../integrations/hub.js';
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
  /** MCP server registry — when provided, exposed via getMcpRegistry() and wired to connectors */
  mcpRegistry?: McpRegistry;
  /** Security config — controls which env vars are stripped from worker processes */
  securityConfig?: SecurityConfig;
  /** Tunnel tool name (e.g. 'cloudflared', 'ngrok') — when set, starts a tunnel on the file server port during start() */
  tunnelTool?: string;
  /** Glob patterns for files to include — only these visible to the AI (workspace.include from V2 config) */
  workspaceInclude?: readonly string[];
  /** Glob patterns for files to exclude — hidden from the AI (workspace.exclude from V2 config) */
  workspaceExclude?: readonly string[];
  /** Discovered AI tools — when provided, exposed via GET /api/discovery in WebChat */
  discoveredTools?: DiscoveredTool[];
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
  private mcpRegistry: McpRegistry | null = null;
  private readonly securityConfig: SecurityConfig | undefined;
  private fileServer: FileServer | null = null;
  private appServer: AppServer | null = null;
  private interactionRelay: InteractionRelay | null = null;
  private tunnelManager: TunnelManager | null = null;
  private tunnelPublicUrl: string | null = null;
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
  private tunnelExitHandler: (() => void) | null = null;
  private tunnelSigintHandler: (() => void) | null = null;
  private dockerHealthMonitor: DockerHealthMonitor | null = null;
  private readonly integrationHub: IntegrationHub;
  private readonly detectedSecrets: SecretMatch[] = [];
  private readonly sessionExcludePatterns: string[] = [];
  private readonly workspaceInclude: readonly string[];
  private readonly workspaceExclude: readonly string[];
  private readonly discoveredTools: DiscoveredTool[];

  constructor(config: AppConfig, options?: BridgeOptions) {
    this.config = config;
    this.configPath = options?.configPath;
    this.drainTimeoutMs = options?.drainTimeoutMs ?? 30_000;
    this.workspaceInclude = options?.workspaceInclude ?? [];
    this.workspaceExclude = options?.workspaceExclude ?? [];
    this.discoveredTools = options?.discoveredTools ?? [];
    this.auth = new AuthService(config.auth);
    this.auditLogger = new AuditLogger(config.audit);
    this.healthServer = new HealthServer(config.health);
    this.metrics = new MetricsCollector();
    setAgentRunnerMetrics(this.metrics);
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
      this.auditLogger.setWorkspacePath(options.workspacePath);
    }

    if (options?.mcpRegistry) {
      this.mcpRegistry = options.mcpRegistry;
    }

    if (options?.tunnelTool) {
      this.tunnelManager = new TunnelManager(options.tunnelTool);
    }

    this.securityConfig = options?.securityConfig;
    this.integrationHub = new IntegrationHub();
  }

  /** Register built-in and external plugins before starting */
  getRegistry(): PluginRegistry {
    return this.registry;
  }

  /** Returns the names of all successfully initialized connectors */
  getActiveConnectorNames(): string[] {
    return this.connectors.map((c) => c.name);
  }

  /** Returns the port the file server is listening on, or null if not running */
  getFileServerPort(): number | null {
    if (!this.fileServer) return null;
    const match = this.fileServer.baseUrl.match(/:(\d+)$/);
    return match ? parseInt(match[1]!, 10) : null;
  }

  /** Returns the tunnel public URL if a tunnel is active, or null if not running */
  getTunnelUrl(): string | null {
    return this.tunnelPublicUrl;
  }

  /** Returns WebChat access URL (with token) and the raw token if a webchat connector is active */
  getWebChatInfo(): { url: string; token: string } | null {
    for (const connector of this.connectors) {
      if (connector.name !== 'webchat') continue;
      const c = connector as {
        getAuthToken?: () => string | null;
        getWebChatAccessUrl?: () => string | null;
      };
      const token = typeof c.getAuthToken === 'function' ? c.getAuthToken() : null;
      const url = typeof c.getWebChatAccessUrl === 'function' ? c.getWebChatAccessUrl() : null;
      if (token && url) return { url, token };
    }
    return null;
  }

  private registerTunnelShutdownHandlers(): void {
    if (!this.tunnelManager || this.tunnelExitHandler || this.tunnelSigintHandler) {
      return;
    }

    this.tunnelExitHandler = (): void => {
      this.tunnelManager?.stop();
      this.tunnelPublicUrl = null;
    };
    this.tunnelSigintHandler = (): void => {
      this.tunnelManager?.stop();
      this.tunnelPublicUrl = null;
    };
    process.once('exit', this.tunnelExitHandler);
    process.on('SIGINT', this.tunnelSigintHandler);
  }

  private clearTunnelShutdownHandlers(): void {
    if (this.tunnelExitHandler) {
      process.removeListener('exit', this.tunnelExitHandler);
      this.tunnelExitHandler = null;
    }
    if (this.tunnelSigintHandler) {
      process.removeListener('SIGINT', this.tunnelSigintHandler);
      this.tunnelSigintHandler = null;
    }
  }

  /** Returns the MemoryManager instance (null if no workspacePath was provided or init failed) */
  getMemory(): MemoryManager | null {
    return this.memory;
  }

  /** Returns the McpRegistry instance (null if no mcpRegistry was provided) */
  getMcpRegistry(): McpRegistry | null {
    return this.mcpRegistry;
  }

  /** Returns the IntegrationHub instance */
  getIntegrationHub(): IntegrationHub {
    return this.integrationHub;
  }

  /**
   * Returns glob patterns for files auto-excluded this session after startup secret scanning.
   * Each entry is a relative path from the workspace root (e.g. "service-account-prod.json").
   * Pass alongside `config.workspace.exclude` when calling isFileVisible().
   */
  getSessionExcludePatterns(): readonly string[] {
    return this.sessionExcludePatterns;
  }

  /**
   * Returns the list of sensitive files detected during startup scanning.
   * Useful for the /scope command (OB-1472) to report secrets with severity.
   */
  getDetectedSecrets(): readonly SecretMatch[] {
    return this.detectedSecrets;
  }

  /** Set the Master AI — must be called before start() to enable Master routing */
  setMaster(master: MasterManager): void {
    this.master = master;
    logger.info('Master AI set on Bridge');
  }

  /** Set the AppServer — enables graceful app cleanup on shutdown and APP marker handling in Router */
  setAppServer(appServer: AppServer): void {
    this.appServer = appServer;
    this.router.setAppServer(appServer);
    logger.info('AppServer set on Bridge and Router');
  }

  /** Set the InteractionRelay — routes app messages to Master via Router */
  setInteractionRelay(relay: InteractionRelay): void {
    this.interactionRelay = relay;
    this.router.setInteractionRelay(relay);
    logger.info('InteractionRelay set on Bridge and Router');
  }

  /** Set the email config — enables [SHARE:email] marker support in the router */
  setEmailConfig(config: EmailConfig): void {
    this.router.setEmailConfig(config);
    logger.info('Email config set on Router');
  }

  /**
   * Register MCP servers with the health check endpoint.
   * Call after bridge.start() with servers from V2Config.mcp.servers.
   * The /health response will include an `mcp` section reporting whether
   * each server's command is available on PATH.
   */
  setMcpServers(servers: MCPServer[]): void {
    this.healthServer.setMcpServers(servers);
    logger.info({ count: servers.length }, 'MCP servers registered for health checks');
  }

  /** Start the bridge: initialize all connectors and providers, begin processing */
  async start(): Promise<void> {
    logger.info('Starting OpenBridge...');

    // Scan process.env for secret patterns and warn operators about variables that will be stripped
    const denyPatterns = this.securityConfig?.envDenyPatterns ?? [...ENV_DENY_PATTERNS];
    warnAboutExposedSecrets(process.env, denyPatterns);

    // Scan workspace root for sensitive files — non-fatal, logs warnings and builds session exclude list
    if (this.workspacePath) {
      await this.runSecretScan(this.workspacePath);
    }

    // Docker startup health check + periodic recheck (OB-1557)
    if (this.securityConfig?.sandbox?.mode === 'docker') {
      const dockerSandbox = new DockerSandbox();
      this.dockerHealthMonitor = new DockerHealthMonitor(dockerSandbox);
      await this.dockerHealthMonitor.start();

      // Clean up dangling containers only when daemon is reachable (OB-1554)
      if (this.dockerHealthMonitor.isDockerAvailable()) {
        dockerSandbox.cleanupDanglingContainers().catch((err: unknown) => {
          logger.warn({ err }, 'Docker startup cleanup failed — continuing');
        });
      }
    }

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
        if (!this.memory) return;
        logger.info('Running scheduled DB eviction');
        void this.memory
          .evictOldData()
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

    // Wire security config into router for high-risk spawn confirmation
    if (this.securityConfig) {
      this.router.setSecurityConfig(this.securityConfig);
    }

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

    // Wire workspace visibility state into router for /scope command (OB-1472)
    this.router.setVisibilityState(
      this.detectedSecrets,
      this.sessionExcludePatterns,
      this.workspaceInclude,
      this.workspaceExclude,
    );

    // Wire IntegrationHub into Router and MasterManager
    this.router.setIntegrationHub(this.integrationHub);

    if (this.master) {
      this.master.setIntegrationHub(this.integrationHub);
    }

    if (this.master) {
      // V2 flow: Master AI handles all routing — skip provider initialization
      this.router.setMaster(this.master);
      this.master.setRouter(this.router);
      logger.info('Master AI wired into router (V2 mode — providers skipped)');

      // Wire KnowledgeRetriever after MemoryManager and DotFolderManager are ready (OB-1344)
      if (this.memory && this.workspacePath) {
        const dotFolder = new DotFolderManager(this.workspacePath);
        const retriever = new KnowledgeRetriever(this.memory, dotFolder);
        this.master.setKnowledgeRetriever(retriever);
        logger.info('KnowledgeRetriever wired into Master AI');
      }
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

    // Wire memory into connectors that support the sessions REST API (e.g. WebChat /api/sessions)
    if (this.memory) {
      for (const connector of this.connectors) {
        const c = connector as { setMemory?: (m: MemoryManager) => void };
        if (typeof c.setMemory === 'function') {
          c.setMemory(this.memory);
        }
      }
    }

    // Wire discovered AI tools into connectors that support the /api/discovery endpoint (e.g. WebChat)
    if (this.discoveredTools.length > 0) {
      for (const connector of this.connectors) {
        const c = connector as { setDiscoveryResult?: (t: DiscoveredTool[]) => void };
        if (typeof c.setDiscoveryResult === 'function') {
          c.setDiscoveryResult(this.discoveredTools);
        }
      }
    }

    // Wire MCP registry into connectors that support the /api/mcp/servers endpoints (e.g. WebChat)
    if (this.mcpRegistry) {
      for (const connector of this.connectors) {
        const c = connector as { setMcpRegistry?: (r: McpRegistry) => void };
        if (typeof c.setMcpRegistry === 'function') {
          c.setMcpRegistry(this.mcpRegistry);
        }
      }
    }

    // Wire MediaManager into connectors that support incoming media download (e.g. WhatsApp)
    if (this.workspacePath) {
      const mediaManager = createMediaManager(this.workspacePath);
      for (const connector of this.connectors) {
        const c = connector as { setMediaManager?: (m: MediaManager) => void };
        if (typeof c.setMediaManager === 'function') {
          c.setMediaManager(mediaManager);
        }
      }
    }

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
        // Wire file server into router so [SHARE:FILE] markers create shareable links
        this.router.setFileServer(this.fileServer);
      } catch (error) {
        logger.warn({ err: error }, 'File server failed to start — continuing without it');
        this.fileServer = null;
      }
    }

    // Start tunnel if configured — expose file server to the internet (non-fatal)
    if (this.tunnelManager && this.fileServer) {
      this.registerTunnelShutdownHandlers();
      const fileServerPort = this.getFileServerPort();
      if (fileServerPort !== null) {
        try {
          this.tunnelPublicUrl = await this.tunnelManager.start(fileServerPort);
          logger.info(
            { url: this.tunnelPublicUrl },
            'Tunnel started — file server accessible at public URL',
          );
        } catch (error) {
          logger.warn(
            { err: error },
            'Tunnel failed to start — continuing with localhost access only',
          );
        }
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

    // Shut down IntegrationHub — gracefully tears down all registered integrations
    try {
      await this.integrationHub.shutdown();
      logger.info('IntegrationHub shut down');
    } catch (error) {
      logger.warn({ err: error }, 'IntegrationHub shutdown failed — continuing');
    }

    // Stop all running apps before tearing down connectors
    if (this.appServer) {
      this.appServer.stopAll();
      logger.info('AppServer shut down');
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

    this.rateLimiter.dispose();

    this.dockerHealthMonitor?.stop();

    // Force-remove any Docker containers that are still tracked (OB-F111).
    if (this.securityConfig?.sandbox?.mode === 'docker') {
      await cleanupSandboxContainers();
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

    if (this.tunnelManager) {
      this.tunnelManager.stop();
      this.tunnelPublicUrl = null;
      this.clearTunnelShutdownHandlers();
      logger.info('Tunnel stopped');
    }

    if (this.memory) {
      try {
        await this.memory.closeActiveSessions();
        logger.info('Active sessions closed');
      } catch (error) {
        logger.warn({ err: error }, 'Error closing active sessions — continuing with DB close');
      }
      try {
        await this.memory.close();
        logger.info('MemoryManager closed');
      } catch (error) {
        logger.error({ err: error }, 'Error closing MemoryManager');
      }
      this.memory = null;
    }

    logger.info('OpenBridge stopped');
  }

  private onConfigChange(newConfig: AppConfig): void {
    logger.info('Applying hot-reloaded configuration');

    this.auth.updateConfig(newConfig.auth);
    this.rateLimiter.updateConfig(newConfig.auth.rateLimit);

    // Propagate MCP server changes to McpRegistry and MasterManager.
    // config.json may have been updated by McpRegistry.persistToConfig() (via the WebChat
    // MCP management API) or by the user editing the file directly. Either way we re-parse
    // the raw file to extract the V2Config MCP section and synchronise runtime state.
    if (this.configPath && (this.mcpRegistry !== null || this.master !== null)) {
      try {
        const raw = readFileSync(this.configPath, 'utf-8');
        const parsed: unknown = JSON.parse(raw);
        const v2Result = V2ConfigSchema.safeParse(parsed);
        if (v2Result.success) {
          const newMcpServers =
            v2Result.data.mcp?.enabled !== false ? (v2Result.data.mcp?.servers ?? []) : [];
          this.mcpRegistry?.reload(newMcpServers);
          this.master?.reloadMcpServers(newMcpServers);
          logger.info({ count: newMcpServers.length }, 'MCP server list hot-reloaded');
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to extract MCP servers from hot-reloaded config');
      }
    }

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

    if (!this.auth.isAuthorized(message.sender, message.source)) {
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

    // Auto-create access_control entry for whitelisted user on first command.
    // Ensures checkAccessControl always finds an entry rather than silently defaulting to owner.
    this.auth.ensureAccessEntry(message.sender, message.source);

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
   * Scan the workspace root for sensitive files (name-check only, 1 level deep).
   * Logs a warning listing every detected file, then records each as a relative-path
   * exclude pattern in sessionExcludePatterns so it is hidden from AI visibility.
   * Errors are non-fatal — a scan failure must not prevent the bridge from starting.
   */
  private async runSecretScan(workspacePath: string): Promise<void> {
    try {
      const scanner = new SecretScanner(undefined, this.securityConfig?.sensitiveFileExceptions);
      const matches = await scanner.scanWorkspace(workspacePath);

      if (matches.length === 0) return;

      logger.warn(
        {
          count: matches.length,
          paths: matches.map((m) => m.path),
        },
        'Sensitive files detected in workspace — auto-excluding from AI visibility for this session',
      );

      for (const match of matches) {
        this.detectedSecrets.push(match);
        // Convert absolute path to a workspace-relative pattern for isFileVisible()
        const relative = path.relative(workspacePath, match.path);
        if (relative && !this.sessionExcludePatterns.includes(relative)) {
          this.sessionExcludePatterns.push(relative);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Workspace secret scan failed — continuing without session excludes');
    }
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
