import type { AppConfig } from '../types/config.js';
import type { InboundMessage } from '../types/message.js';
import type { Connector } from '../types/connector.js';
import type { AIProvider } from '../types/provider.js';
import { AuthService } from './auth.js';
import { AuditLogger } from './audit-logger.js';
import { MessageQueue } from './queue.js';
import { PluginRegistry } from './registry.js';
import { RateLimiter } from './rate-limiter.js';
import { Router } from './router.js';
import { createLogger } from './logger.js';

const logger = createLogger('bridge');

export class Bridge {
  private readonly config: AppConfig;
  private readonly auth: AuthService;
  private readonly auditLogger: AuditLogger;
  private readonly rateLimiter: RateLimiter;
  private readonly queue: MessageQueue;
  private readonly registry: PluginRegistry;
  private readonly router: Router;
  private readonly connectors: Connector[] = [];
  private readonly providers: AIProvider[] = [];

  constructor(config: AppConfig) {
    this.config = config;
    this.auth = new AuthService(config.auth);
    this.auditLogger = new AuditLogger(config.audit);
    this.rateLimiter = new RateLimiter(config.auth.rateLimit);
    this.queue = new MessageQueue(config.queue);
    this.registry = new PluginRegistry();
    this.router = new Router(config.defaultProvider, config.router, this.auditLogger);
  }

  /** Register built-in and external plugins before starting */
  getRegistry(): PluginRegistry {
    return this.registry;
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
      this.providers.push(provider);
      logger.info({ provider: provider.name }, 'Provider initialized');
    }

    // Initialize connectors
    for (const connectorConfig of this.config.connectors) {
      if (!connectorConfig.enabled) continue;

      const connector = this.registry.createConnector(
        connectorConfig.type,
        connectorConfig.options,
      );

      connector.on('message', (message: InboundMessage) => {
        this.handleIncomingMessage(message);
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

    logger.info('OpenBridge started successfully');
  }

  /** Stop the bridge gracefully — drains in-flight messages, then shuts down connectors and providers */
  async stop(): Promise<void> {
    logger.info('Stopping OpenBridge...');

    logger.info('Draining message queue...');
    await this.queue.drain();
    logger.info('Message queue drained');

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

    logger.info('OpenBridge stopped');
  }

  private handleIncomingMessage(message: InboundMessage): void {
    if (!this.auth.isAuthorized(message.sender)) {
      logger.warn({ sender: message.sender }, 'Unauthorized sender');
      void this.auditLogger.logAuthDenied(message.sender);
      return;
    }

    if (!this.auth.hasPrefix(message.rawContent)) {
      return; // Not a command, ignore silently
    }

    if (!this.rateLimiter.isAllowed(message.sender)) {
      logger.warn({ sender: message.sender }, 'Message dropped — rate limit exceeded');
      void this.auditLogger.logRateLimited(message.sender);
      return;
    }

    const strippedContent = this.auth.stripPrefix(message.rawContent);

    const filterResult = this.auth.filterCommand(strippedContent);
    if (!filterResult.allowed) {
      logger.warn({ sender: message.sender }, 'Message blocked by command filter');
      return;
    }

    const cleaned: InboundMessage = {
      ...message,
      content: strippedContent,
    };

    void this.auditLogger.logInbound(cleaned);
    void this.queue.enqueue(cleaned);
  }
}
