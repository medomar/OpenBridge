import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { InboundMessage, OutboundMessage, ProgressEvent } from '../../types/message.js';
import { TelegramConfigSchema } from './telegram-config.js';
import type { TelegramConfig } from './telegram-config.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('telegram');

type EventListeners = {
  [E in keyof ConnectorEvents]: ConnectorEvents[E][];
};

/** Minimal interface for the grammY Bot needed by this connector */
interface GrammyBot {
  on: (event: string, handler: (ctx: GrammyContext) => void) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  api: {
    sendMessage: (chatId: string | number, text: string) => Promise<{ message_id: number }>;
    sendChatAction: (chatId: string | number, action: string) => Promise<unknown>;
    editMessageText: (chatId: string | number, messageId: number, text: string) => Promise<unknown>;
    deleteMessage: (chatId: string | number, messageId: number) => Promise<unknown>;
  };
}

function formatProgressEvent(event: ProgressEvent): string {
  switch (event.type) {
    case 'classifying':
      return '🔍 Analyzing request...';
    case 'planning':
      return '📋 Planning subtasks...';
    case 'spawning':
      return `📋 Breaking into ${event.workerCount.toString()} subtask${event.workerCount !== 1 ? 's' : ''}...`;
    case 'worker-progress':
      return `⚙️ ${event.completed.toString()}/${event.total.toString()} workers done${event.workerName ? ` (${event.workerName})` : ''}`;
    case 'synthesizing':
      return '📝 Preparing final response...';
    case 'complete':
      return '✅ Done';
    case 'exploring':
      return `🗺️ ${event.phase}${event.detail ? ` — ${event.detail}` : ''}...`;
    case 'exploring-directory':
      return `📂 Exploring directories: ${event.completed.toString()}/${event.total.toString()}${event.directory ? ` (${event.directory})` : ''}...`;
    case 'worker-cancelled':
      return `🛑 Worker ${event.workerId} was stopped by ${event.cancelledBy}.`;
    case 'worker-turn-progress':
      return `⚙️ Worker ${event.workerId.slice(0, 8)} — turn ${event.turnsUsed.toString()}/${event.turnsMax.toString()}${event.lastAction ? ` (${event.lastAction.slice(0, 60)})` : ''}...`;
    default:
      return `⏳ Processing (${event.type})...`;
  }
}

interface GrammyContext {
  message: {
    message_id: number;
    text?: string;
    date: number;
  };
  from?: {
    id: number;
    username?: string;
    first_name: string;
  };
  chat: {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
  };
}

/**
 * Telegram connector — receives DMs and group @mentions via grammY long polling.
 *
 * Config options:
 *   - token (required): Bot token from @BotFather
 *   - botUsername (optional): Bot username without @ — required for group mention detection
 *
 * Usage in config.json:
 * ```json
 * {
 *   "channels": [{ "type": "telegram", "options": { "token": "123:ABC", "botUsername": "MyBot" } }]
 * }
 * ```
 */
export class TelegramConnector implements Connector {
  readonly name = 'telegram';
  private config: TelegramConfig;
  private connected = false;
  private bot: GrammyBot | null = null;
  /** Maps chatId → message_id of the in-flight progress message for edit-in-place updates. */
  private readonly progressMessageIds = new Map<string, number>();
  private readonly listeners: EventListeners = {
    message: [],
    ready: [],
    auth: [],
    error: [],
    disconnected: [],
  };

  constructor(options: Record<string, unknown>) {
    this.config = TelegramConfigSchema.parse(options);
  }

  async initialize(): Promise<void> {
    // Dynamic import to avoid requiring grammy at module load (enables testing via vi.mock)
    const grammy = await import('grammy');
    const { Bot } = grammy;

    this.bot = new Bot(this.config.token) as unknown as GrammyBot;

    this.bot.on('message:text', (ctx: GrammyContext) => {
      const isGroup = ctx.chat.type === 'group' || ctx.chat.type === 'supergroup';

      if (isGroup) {
        // In groups, only respond to direct @mentions
        const text = ctx.message.text ?? '';
        const botUsername = this.config.botUsername;
        if (!botUsername || !text.includes(`@${botUsername}`)) {
          return;
        }
      }

      const message: InboundMessage = {
        id: `telegram-${ctx.message.message_id.toString()}`,
        source: 'telegram',
        sender: ctx.from?.id.toString() ?? 'unknown',
        rawContent: ctx.message.text ?? '',
        content: ctx.message.text ?? '',
        timestamp: new Date(ctx.message.date * 1000),
        metadata: { chatId: ctx.chat.id.toString() },
      };

      this.emit('message', message);
    });

    // Start long polling — does not await because it runs until bot.stop()
    this.bot.start().catch((err: Error) => {
      logger.error({ err }, 'Telegram bot polling error');
      this.connected = false;
      this.emit('error', err);
      this.emit('disconnected', err.message);
    });

    this.connected = true;
    logger.info(
      { botUsername: this.config.botUsername ?? '(not set)' },
      'Telegram connector ready',
    );
    this.emit('ready');
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.bot || !this.connected) {
      throw new Error('Telegram connector is not connected');
    }
    await this.bot.api.sendMessage(message.recipient, message.content);
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.bot || !this.connected) return;
    await this.bot.api.sendChatAction(chatId, 'typing');
  }

  async sendProgress(event: ProgressEvent, chatId: string): Promise<void> {
    if (!this.bot || !this.connected) return;

    const existingId = this.progressMessageIds.get(chatId);

    try {
      if (event.type === 'complete') {
        if (existingId !== undefined) {
          await this.bot.api.deleteMessage(chatId, existingId);
          this.progressMessageIds.delete(chatId);
        }
        return;
      }

      const text = formatProgressEvent(event);
      if (existingId !== undefined) {
        await this.bot.api.editMessageText(chatId, existingId, text);
      } else {
        const result = await this.bot.api.sendMessage(chatId, text);
        this.progressMessageIds.set(chatId, result.message_id);
      }
    } catch (err: unknown) {
      logger.debug({ chatId, err }, 'Failed to send/edit Telegram progress message');
    }
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    this.listeners[event].push(listener);
  }

  async shutdown(): Promise<void> {
    this.progressMessageIds.clear();
    if (this.bot) {
      await this.bot.stop();
      this.bot = null;
    }
    this.connected = false;
    logger.info('Telegram connector shut down');
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
