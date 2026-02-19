import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { OutboundMessage } from '../../types/message.js';
import { WhatsAppConfigSchema } from './whatsapp-config.js';
import type { WhatsAppConfig } from './whatsapp-config.js';
import { parseWhatsAppMessage, truncateForWhatsApp } from './whatsapp-message.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('whatsapp');

type EventListeners = {
  [E in keyof ConnectorEvents]: ConnectorEvents[E][];
};

interface WAClient {
  on: (event: string, handler: (...args: never[]) => void) => void;
  initialize: () => Promise<void>;
  sendMessage: (to: string, content: string) => Promise<void>;
  destroy: () => Promise<void>;
}

export class WhatsAppConnector implements Connector {
  readonly name = 'whatsapp';
  private config: WhatsAppConfig;
  private connected = false;
  private client: WAClient | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;
  private readonly listeners: EventListeners = {
    message: [],
    ready: [],
    auth: [],
    error: [],
    disconnected: [],
  };

  constructor(options: Record<string, unknown>) {
    this.config = WhatsAppConfigSchema.parse(options);
  }

  async initialize(): Promise<void> {
    logger.info({ sessionName: this.config.sessionName }, 'Initializing WhatsApp connector');
    this.shuttingDown = false;
    await this.createAndStartClient();
  }

  private async createAndStartClient(): Promise<void> {
    // Dynamic import to avoid requiring whatsapp-web.js at module load
    const WAWebJS = await import('whatsapp-web.js');
    const { Client, LocalAuth } = WAWebJS;

    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: this.config.sessionName }),
    }) as unknown as WAClient;

    this.client.on('qr', (qr: string) => {
      logger.info('QR code received — scan with WhatsApp');
      this.emit('auth', qr);
    });

    this.client.on('ready', () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      logger.info('WhatsApp client ready');
      this.emit('ready');
    });

    this.client.on(
      'message',
      (msg: { id: { id: string }; from: string; body: string; timestamp: number }) => {
        const parsed = parseWhatsAppMessage(msg.id.id, msg.from, msg.body, msg.timestamp);
        this.emit('message', parsed);
      },
    );

    this.client.on('disconnected', (reason: string) => {
      this.connected = false;
      logger.warn({ reason }, 'WhatsApp disconnected');
      this.emit('disconnected', reason);
      this.scheduleReconnect();
    });

    await this.client.initialize();
  }

  private scheduleReconnect(): void {
    const { enabled, maxAttempts, initialDelayMs, maxDelayMs, backoffFactor } =
      this.config.reconnect;

    if (this.shuttingDown || !enabled) {
      return;
    }

    if (maxAttempts > 0 && this.reconnectAttempt >= maxAttempts) {
      logger.error({ maxAttempts }, 'WhatsApp reconnect: max attempts reached, giving up');
      this.emit('error', new Error('WhatsApp reconnect failed: max attempts reached'));
      return;
    }

    const delay = Math.min(
      initialDelayMs * Math.pow(backoffFactor, this.reconnectAttempt),
      maxDelayMs,
    );
    this.reconnectAttempt++;

    logger.info(
      { attempt: this.reconnectAttempt, delayMs: delay },
      'WhatsApp scheduling reconnect',
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shuttingDown) return;

      logger.info({ attempt: this.reconnectAttempt }, 'WhatsApp attempting reconnect');

      if (this.client) {
        this.client.destroy().catch((err: unknown) => {
          logger.warn({ err }, 'Error destroying old WhatsApp client before reconnect');
        });
        this.client = null;
      }

      this.createAndStartClient().catch((err: unknown) => {
        logger.error({ err }, 'WhatsApp reconnect failed');
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        this.scheduleReconnect();
      });
    }, delay);
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('WhatsApp connector is not connected');
    }

    const content = truncateForWhatsApp(message.content);
    await this.client.sendMessage(message.recipient, content);

    logger.debug({ recipient: message.recipient }, 'Message sent');
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    this.listeners[event].push(listener);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      await this.client.destroy();
      this.connected = false;
      logger.info('WhatsApp connector shut down');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private emit<E extends keyof ConnectorEvents>(
    event: E,
    ...args: Parameters<ConnectorEvents[E]>
  ): void {
    for (const listener of this.listeners[event]) {
      (listener as (...args: Parameters<ConnectorEvents[E]>) => void)(...args);
    }
  }
}
