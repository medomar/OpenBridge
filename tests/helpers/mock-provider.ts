import type { AIProvider, ProviderResult, ProviderContext } from '../../src/types/provider.js';
import type { InboundMessage } from '../../src/types/message.js';

export class MockProvider implements AIProvider {
  readonly name = 'mock';
  readonly processedMessages: InboundMessage[] = [];
  readonly receivedContexts: Array<ProviderContext | undefined> = [];
  private response: ProviderResult = { content: 'Mock response' };
  private available = true;
  streamMessage?: (
    message: InboundMessage,
    context?: ProviderContext,
  ) => AsyncGenerator<string, ProviderResult>;

  async initialize(): Promise<void> {
    // No-op
  }

  async processMessage(
    message: InboundMessage,
    context?: ProviderContext,
  ): Promise<ProviderResult> {
    this.processedMessages.push(message);
    this.receivedContexts.push(context);
    return this.response;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async shutdown(): Promise<void> {
    // No-op
  }

  /** Set the response to return for the next processMessage call */
  setResponse(response: ProviderResult): void {
    this.response = response;
  }

  /** Enable streaming and set the chunks to yield from streamMessage */
  setStreamChunks(chunks: string[]): void {
    const provider = {
      messages: this.processedMessages,
      contexts: this.receivedContexts,
      getResponse: () => this.response,
    };
    this.streamMessage = async function* (
      message: InboundMessage,
      context?: ProviderContext,
    ): AsyncGenerator<string, ProviderResult> {
      provider.messages.push(message);
      provider.contexts.push(context);
      for (const chunk of chunks) {
        yield chunk;
      }
      return provider.getResponse();
    };
  }

  /** Set availability status */
  setAvailable(available: boolean): void {
    this.available = available;
  }
}
