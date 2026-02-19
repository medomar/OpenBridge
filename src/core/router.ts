import type { AIProvider, ProviderResult } from '../types/provider.js';
import type { InboundMessage, OutboundMessage } from '../types/message.js';
import type { Connector } from '../types/connector.js';
import { ProviderError } from '../providers/claude-code/provider-error.js';
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

    // Send typing indicator while AI processes (best-effort)
    if (connector.sendTypingIndicator) {
      await connector.sendTypingIndicator(message.sender);
    }

    // Process with AI provider — prefer streaming to avoid timeout on long responses
    let result: ProviderResult;

    try {
      if (provider.streamMessage) {
        result = await this.consumeStream(provider.streamMessage(message));
      } else {
        result = await provider.processMessage(message);
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        const userMessage =
          error.kind === 'transient'
            ? 'The AI service is temporarily unavailable. Please try again in a moment.'
            : `Request failed: ${error.message}`;

        const errorResponse: OutboundMessage = {
          target: message.source,
          recipient: message.sender,
          content: userMessage,
          replyTo: message.id,
        };
        await connector.sendMessage(errorResponse);
      }
      throw error;
    }

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

  /** Drain a streaming provider response, returning the final ProviderResult */
  private async consumeStream(
    stream: AsyncGenerator<string, ProviderResult>,
  ): Promise<ProviderResult> {
    let iterResult: IteratorResult<string, ProviderResult>;

    do {
      iterResult = await stream.next();
    } while (!iterResult.done);

    // When done === true, value is the ProviderResult return value
    return iterResult.value;
  }

  get defaultProvider(): string {
    return this.defaultProviderName;
  }
}
