import type { AIProvider } from '../types/provider.js';
import type { InboundMessage, OutboundMessage } from '../types/message.js';
import type { Connector } from '../types/connector.js';
import { createLogger } from './logger.js';

const logger = createLogger('router');

export class Router {
  private readonly connectors = new Map<string, Connector>();
  private readonly providers = new Map<string, AIProvider>();
  private defaultProviderName: string;

  constructor(defaultProvider: string) {
    this.defaultProviderName = defaultProvider;
  }

  /** Register an active connector */
  addConnector(connector: Connector): void {
    this.connectors.set(connector.name, connector);
  }

  /** Register an active provider */
  addProvider(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** Route an inbound message to the appropriate provider and send the response back */
  async route(message: InboundMessage): Promise<void> {
    const provider = this.providers.get(this.defaultProviderName);
    if (!provider) {
      logger.error({ provider: this.defaultProviderName }, 'Default provider not found');
      return;
    }

    const connector = this.connectors.get(message.source);
    if (!connector) {
      logger.error({ source: message.source }, 'Source connector not found');
      return;
    }

    logger.info(
      { messageId: message.id, provider: provider.name, source: message.source },
      'Routing message',
    );

    // Send acknowledgment
    const ack: OutboundMessage = {
      target: message.source,
      recipient: message.sender,
      content: 'Working on it...',
      replyTo: message.id,
    };
    await connector.sendMessage(ack);

    // Process with AI provider
    const result = await provider.processMessage(message);

    // Send result back
    const response: OutboundMessage = {
      target: message.source,
      recipient: message.sender,
      content: result.content,
      replyTo: message.id,
      metadata: result.metadata,
    };
    await connector.sendMessage(response);

    logger.info({ messageId: message.id }, 'Message processed and response sent');
  }

  get defaultProvider(): string {
    return this.defaultProviderName;
  }
}
