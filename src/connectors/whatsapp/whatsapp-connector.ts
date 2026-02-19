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
    });

    await this.client.initialize();
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
