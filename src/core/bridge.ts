import type { AppConfig } from '../types/config.js';
import type { InboundMessage } from '../types/message.js';
import { AuthService } from './auth.js';
import { MessageQueue } from './queue.js';
import { PluginRegistry } from './registry.js';
import { Router } from './router.js';
import { createLogger } from './logger.js';

const logger = createLogger('bridge');

export class Bridge {
  private readonly config: AppConfig;
  private readonly auth: AuthService;
  private readonly queue: MessageQueue;
  private readonly registry: PluginRegistry;
  private readonly router: Router;

  constructor(config: AppConfig) {
    this.config = config;
    this.auth = new AuthService(config.auth);
    this.queue = new MessageQueue();
    this.registry = new PluginRegistry();
    this.router = new Router(config.defaultProvider);
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
      logger.info({ connector: connector.name }, 'Connector initialized');
    }

    // Set up queue processing
    this.queue.onMessage(async (message) => {
      await this.router.route(message);
    });

    logger.info('OpenBridge started successfully');
  }

  /** Stop the bridge gracefully */
  // eslint-disable-next-line @typescript-eslint/require-await
  async stop(): Promise<void> {
    logger.info('Stopping OpenBridge...');
    // Shutdown logic will be added when connectors/providers are tracked
    logger.info('OpenBridge stopped');
  }

  private handleIncomingMessage(message: InboundMessage): void {
    if (!this.auth.isAuthorized(message.sender)) {
      logger.warn({ sender: message.sender }, 'Unauthorized sender');
      return;
    }

    if (!this.auth.hasPrefix(message.rawContent)) {
      return; // Not a command, ignore silently
    }

    const cleaned: InboundMessage = {
      ...message,
      content: this.auth.stripPrefix(message.rawContent),
    };

    void this.queue.enqueue(cleaned);
  }
}
