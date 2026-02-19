import type { AIProvider, ProviderResult } from '../../src/types/provider.js';
import type { InboundMessage } from '../../src/types/message.js';

export class MockProvider implements AIProvider {
  readonly name = 'mock';
  readonly processedMessages: InboundMessage[] = [];
  private response: ProviderResult = { content: 'Mock response' };
  private available = true;

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

  /** Set availability status */
  setAvailable(available: boolean): void {
    this.available = available;
  }
}
