import type { Connector, ConnectorEvents } from '../../src/types/connector.js';
import type { OutboundMessage } from '../../src/types/message.js';

export class MockConnector implements Connector {
  readonly name = 'mock';
  readonly sentMessages: OutboundMessage[] = [];
  readonly typingIndicators: string[] = [];
  private connected = false;
  private readonly listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  async initialize(): Promise<void> {
    this.connected = true;
    this.emit('ready');
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    this.typingIndicators.push(chatId);
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener as (...args: unknown[]) => void);
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Simulate an incoming message (for testing) */
  simulateMessage(...args: unknown[]): void {
    this.emit('message', ...args);
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners[event];
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }
}
