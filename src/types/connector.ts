import type { InboundMessage, OutboundMessage } from './message.js';

/**
 * Lifecycle events emitted by a connector.
 */
export interface ConnectorEvents {
  /** Fired when a valid, filtered message arrives */
  message: (message: InboundMessage) => void;
  /** Fired when the connector is ready to send/receive */
  ready: () => void;
  /** Fired on authentication events (e.g., QR code for WhatsApp) */
  auth: (data: unknown) => void;
  /** Fired on connector errors */
  error: (error: Error) => void;
  /** Fired when the connector disconnects */
  disconnected: (reason: string) => void;
}

/**
 * Interface that every messaging connector must implement.
 *
 * To add a new connector (e.g., Slack, Telegram):
 * 1. Create src/connectors/your-connector/
 * 2. Implement this interface
 * 3. Register in src/core/registry.ts
 */
export interface Connector {
  /** Unique identifier for this connector type (e.g., 'whatsapp', 'slack') */
  readonly name: string;

  /** Initialize and connect to the messaging platform */
  initialize(): Promise<void>;

  /** Send a response back through the messaging platform */
  sendMessage(message: OutboundMessage): Promise<void>;

  /** Send a typing indicator to the given chat (best-effort, not all connectors support this) */
  sendTypingIndicator?(chatId: string): Promise<void>;

  /** Register event listeners */
  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void;

  /** Gracefully shut down the connector */
  shutdown(): Promise<void>;

  /** Check if the connector is currently connected */
  isConnected(): boolean;
}
