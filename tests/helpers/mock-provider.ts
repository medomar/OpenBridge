import type { AIProvider, ProviderResult } from '../../src/types/provider.js';
import type { InboundMessage } from '../../src/types/message.js';

export class MockProvider implements AIProvider {
  readonly name = 'mock';
  readonly processedMessages: InboundMessage[] = [];
  private response: ProviderResult = { content: 'Mock response' };
  private available = true;
  streamMessage?: (message: InboundMessage) => AsyncGenerator<string, ProviderResult>;

  async initialize(): Promise<void> {
    // No-op
  }

  async processMessage(message: InboundMessage): Promise<ProviderResult> {
    this.processedMessages.push(message);
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
    const provider = { messages: this.processedMessages, getResponse: () => this.response };
    this.streamMessage = async function* (
      message: InboundMessage,
    ): AsyncGenerator<string, ProviderResult> {
      provider.messages.push(message);
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
