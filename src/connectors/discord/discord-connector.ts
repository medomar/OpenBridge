import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { InboundMessage, OutboundMessage } from '../../types/message.js';
import { DiscordConfigSchema } from './discord-config.js';
import type { DiscordConfig } from './discord-config.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('discord');

type EventListeners = {
  [E in keyof ConnectorEvents]: ConnectorEvents[E][];
};

/** Minimal interface for a discord.js Client needed by this connector */
interface DiscordClient {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  login: (token: string) => Promise<string>;
  destroy: () => void;
  channels: {
    fetch: (id: string) => Promise<DiscordTextChannel | null>;
  };
}

interface DiscordTextChannel {
  send: (content: string) => Promise<unknown>;
  isTextBased: () => boolean;
}

interface DiscordMessage {
  id: string;
  content: string;
  author: {
    id: string;
    bot: boolean;
  };
  channelId: string;
  channel: {
    type: number;
  };
  createdTimestamp: number;
}

// discord.js ChannelType.DM = 1
const CHANNEL_TYPE_DM = 1;

/**
 * Discord connector — receives DMs and guild channel messages via discord.js.
 *
 * Config options:
 *   - token (required): Bot token from the Discord Developer Portal
 *
 * Usage in config.json:
 * ```json
 * {
 *   "channels": [{ "type": "discord", "options": { "token": "Bot.Token.Here" } }]
 * }
 * ```
 *
 * The connector handles:
 *   - DM messages (ChannelType.DM)
 *   - Guild text channel messages
 *   - Bot messages are ignored automatically
 */
export class DiscordConnector implements Connector {
  readonly name = 'discord';
  private config: DiscordConfig;
  private connected = false;
  private client: DiscordClient | null = null;
  private readonly listeners: EventListeners = {
    message: [],
    ready: [],
    auth: [],
    error: [],
    disconnected: [],
  };

  constructor(options: Record<string, unknown>) {
    this.config = DiscordConfigSchema.parse(options);
  }

  async initialize(): Promise<void> {
    // Dynamic import to avoid requiring discord.js at module load (enables testing via vi.mock)
    const discordjs = await import('discord.js');
    const { Client, GatewayIntentBits, Events } = discordjs;

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    }) as unknown as DiscordClient;

    this.client.on(Events.ClientReady, () => {
      this.connected = true;
      logger.info('Discord connector ready');
      this.emit('ready');
    });

    this.client.on(Events.MessageCreate, (rawMsg: unknown) => {
      const msg = rawMsg as DiscordMessage;

      // Ignore messages from bots (including self)
      if (msg.author.bot) return;
      if (!msg.content) return;

      const isDM = msg.channel.type === CHANNEL_TYPE_DM;

      const inbound: InboundMessage = {
        id: `discord-${msg.id}`,
        source: 'discord',
        sender: msg.author.id,
        rawContent: msg.content,
        content: msg.content,
        timestamp: new Date(msg.createdTimestamp),
        metadata: {
          channelId: msg.channelId,
          isDM,
        },
      };

      this.emit('message', inbound);
    });

    this.client.login(this.config.token).catch((err: Error) => {
      logger.error({ err }, 'Discord login error');
      this.connected = false;
      this.emit('error', err);
      this.emit('disconnected', err.message);
    });
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('Discord connector is not connected');
    }
    const channel = await this.client.channels.fetch(message.recipient);
    if (!channel) {
      throw new Error(`Discord channel not found: ${message.recipient}`);
    }
    await channel.send(message.content);
  }

  sendTypingIndicator(_chatId: string): Promise<void> {
    // discord.js typing indicators require a channel fetch;
    // skip silently to match the Telegram connector behaviour
    return Promise.resolve();
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    this.listeners[event].push(listener);
  }

  shutdown(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.connected = false;
    logger.info('Discord connector shut down');
    return Promise.resolve();
  }

  isConnected(): boolean {
    return this.connected;
  }

  private emit<E extends keyof ConnectorEvents>(
    event: E,
    ...args: Parameters<ConnectorEvents[E]>
  ): void {
    for (const listener of this.listeners[event]) {
      (listener as (...a: Parameters<ConnectorEvents[E]>) => void)(...args);
    }
  }
}
