import https from 'node:https';
import path from 'node:path';
import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { InboundMessage, OutboundMessage, ProgressEvent } from '../../types/message.js';
import { processDocument } from '../../intelligence/document-processor.js';
import { TelegramConfigSchema } from './telegram-config.js';
import type { TelegramConfig } from './telegram-config.js';
import { createLogger } from '../../core/logger.js';
import { splitMessage, PLATFORM_MAX_LENGTH } from '../message-splitter.js';
import type { MediaManager } from '../../core/media-manager.js';
import { transcribeAudio, TRANSCRIPTION_FALLBACK_MESSAGE } from '../../core/voice-transcriber.js';

const logger = createLogger('telegram');

type EventListeners = {
  [E in keyof ConnectorEvents]: ConnectorEvents[E][];
};

/** Minimal interface for the grammY Bot needed by this connector */
interface GrammyBot {
  token: string;
  on: (event: string, handler: (ctx: GrammyContext) => void) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  api: {
    sendMessage: (chatId: string | number, text: string) => Promise<{ message_id: number }>;
    sendChatAction: (chatId: string | number, action: string) => Promise<unknown>;
    editMessageText: (chatId: string | number, messageId: number, text: string) => Promise<unknown>;
    deleteMessage: (chatId: string | number, messageId: number) => Promise<unknown>;
    getFile: (
      fileId: string,
    ) => Promise<{ file_id: string; file_path?: string; file_size?: number }>;
    sendPhoto: (
      chatId: string | number,
      photo: unknown,
      other?: Record<string, unknown>,
    ) => Promise<unknown>;
    sendDocument: (
      chatId: string | number,
      document: unknown,
      other?: Record<string, unknown>,
    ) => Promise<unknown>;
    sendVideo: (
      chatId: string | number,
      video: unknown,
      other?: Record<string, unknown>,
    ) => Promise<unknown>;
    sendVoice: (
      chatId: string | number,
      voice: unknown,
      other?: Record<string, unknown>,
    ) => Promise<unknown>;
  };
}

/** Maps common file extensions to MIME types for Telegram file downloads */
const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
};

/** Fetch a URL over HTTPS and return the response body as a Buffer */
function fetchHttpsBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/**
 * Download a file from Telegram's servers and save it via MediaManager.
 *
 * @param bot          grammY Bot instance (needs `token` + `api.getFile`)
 * @param fileId       Telegram file_id to download
 * @param mediaManager MediaManager instance for temp storage
 * @returns            Saved file path, size in bytes, and detected MIME type
 */
export async function downloadTelegramFile(
  bot: GrammyBot,
  fileId: string,
  mediaManager: MediaManager,
): Promise<{ filePath: string; sizeBytes: number; mimeType: string }> {
  const fileInfo = await bot.api.getFile(fileId);

  const remotePath = fileInfo.file_path;
  if (!remotePath) {
    throw new Error(`Telegram API returned no file_path for file_id ${fileId}`);
  }

  const downloadUrl = `https://api.telegram.org/file/bot${bot.token}/${remotePath}`;
  const buffer = await fetchHttpsBuffer(downloadUrl);

  const ext = path.extname(remotePath).toLowerCase();
  const mimeType = EXT_TO_MIME[ext] ?? 'application/octet-stream';
  const filename = path.basename(remotePath);

  const result = await mediaManager.saveMedia(buffer, mimeType, filename);
  return { ...result, mimeType };
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
    caption?: string;
    voice?: { file_id: string; duration: number };
    photo?: Array<{ file_id: string; width: number; height: number }>;
    document?: { file_id: string; file_name?: string; mime_type?: string };
    video?: { file_id: string };
    audio?: { file_id: string };
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
  readonly supportsFileAttachments = true as const;
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

  private mediaManager: MediaManager | null = null;

  constructor(options: Record<string, unknown>) {
    this.config = TelegramConfigSchema.parse(options);
  }

  /** Wire a MediaManager for saving incoming voice/media files to disk. */
  setMediaManager(manager: MediaManager): void {
    this.mediaManager = manager;
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

    this.bot.on('message:voice', (ctx: GrammyContext) => {
      const voice = ctx.message.voice;
      if (!voice) return;

      const chatId = ctx.chat.id.toString();
      const sender = ctx.from?.id.toString() ?? 'unknown';
      const msgId = `telegram-${ctx.message.message_id.toString()}`;
      const timestamp = new Date(ctx.message.date * 1000);

      const bot = this.bot;
      const mediaManager = this.mediaManager;

      const handleVoice = async (): Promise<void> => {
        let content: string;

        if (!bot || !mediaManager) {
          content = TRANSCRIPTION_FALLBACK_MESSAGE;
        } else {
          await bot.api.sendChatAction(chatId, 'typing').catch(() => {});
          try {
            const { filePath } = await downloadTelegramFile(bot, voice.file_id, mediaManager);
            const transcription = await transcribeAudio(filePath);
            if (transcription) {
              logger.debug(
                { backend: transcription.backend, durationMs: transcription.durationMs },
                'Voice transcription complete',
              );
            }
            content = transcription?.text ?? TRANSCRIPTION_FALLBACK_MESSAGE;
          } catch (err) {
            logger.warn({ err, chatId }, 'Failed to download/transcribe Telegram voice message');
            await bot.api.sendMessage(chatId, '[Failed to process voice]').catch(() => {});
            content = '[Voice message — transcription failed]';
          }
        }

        const inbound: InboundMessage = {
          id: msgId,
          source: 'telegram',
          sender,
          rawContent: content,
          content,
          timestamp,
          metadata: { chatId },
        };

        this.emit('message', inbound);
      };

      handleVoice().catch((err: Error) => {
        logger.warn({ err, chatId }, 'Unhandled error in Telegram voice handler');
      });
    });

    this.bot.on('message:photo', (ctx: GrammyContext) => {
      const photos = ctx.message.photo;
      if (!photos || photos.length === 0) return;

      const chatId = ctx.chat.id.toString();
      const sender = ctx.from?.id.toString() ?? 'unknown';
      const msgId = `telegram-${ctx.message.message_id.toString()}`;
      const timestamp = new Date(ctx.message.date * 1000);
      const caption = ctx.message.caption ?? '';

      const bot = this.bot;
      const mediaManager = this.mediaManager;

      const handlePhoto = async (): Promise<void> => {
        // Telegram sends photos in multiple resolutions; the last element is the largest
        const largestPhoto = photos[photos.length - 1];
        if (!largestPhoto) return;

        let attachments: InboundMessage['attachments'];
        let processedDoc: InboundMessage['processedDocument'];

        if (bot && mediaManager) {
          await bot.api.sendChatAction(chatId, 'upload_photo').catch(() => {});
          try {
            const { filePath, sizeBytes, mimeType } = await downloadTelegramFile(
              bot,
              largestPhoto.file_id,
              mediaManager,
            );
            attachments = [{ type: 'image', filePath, mimeType, sizeBytes }];
            try {
              processedDoc = await processDocument(filePath);
              logger.debug({ filePath, docType: processedDoc.docType }, 'Photo processed');
            } catch (err) {
              logger.warn({ err, filePath }, 'Document processing failed for Telegram photo');
            }
          } catch (err) {
            logger.warn({ err, chatId }, 'Failed to download Telegram photo');
            await bot.api.sendMessage(chatId, '[Failed to process photo]').catch(() => {});
          }
        }

        const content = caption || '[Image]';
        const inbound: InboundMessage = {
          id: msgId,
          source: 'telegram',
          sender,
          rawContent: content,
          content,
          timestamp,
          attachments,
          metadata: { chatId },
        };
        if (processedDoc !== undefined) {
          inbound.processedDocument = processedDoc;
        }

        this.emit('message', inbound);
      };

      handlePhoto().catch((err: Error) => {
        logger.warn({ err, chatId }, 'Unhandled error in Telegram photo handler');
      });
    });

    this.bot.on('message:document', (ctx: GrammyContext) => {
      const document = ctx.message.document;
      if (!document) return;

      const chatId = ctx.chat.id.toString();
      const sender = ctx.from?.id.toString() ?? 'unknown';
      const msgId = `telegram-${ctx.message.message_id.toString()}`;
      const timestamp = new Date(ctx.message.date * 1000);
      const caption = ctx.message.caption ?? '';

      const bot = this.bot;
      const mediaManager = this.mediaManager;

      const handleDocument = async (): Promise<void> => {
        let attachments: InboundMessage['attachments'];
        let processedDoc: InboundMessage['processedDocument'];

        if (bot && mediaManager) {
          await bot.api.sendChatAction(chatId, 'upload_document').catch(() => {});
          try {
            const { filePath, sizeBytes, mimeType } = await downloadTelegramFile(
              bot,
              document.file_id,
              mediaManager,
            );
            attachments = [
              {
                type: 'document',
                filePath,
                mimeType: document.mime_type ?? mimeType,
                filename: document.file_name,
                sizeBytes,
              },
            ];
            try {
              processedDoc = await processDocument(filePath);
              logger.debug({ filePath, docType: processedDoc.docType }, 'Document processed');
            } catch (err) {
              logger.warn({ err, filePath }, 'Document processing failed for Telegram document');
            }
          } catch (err) {
            logger.warn({ err, chatId }, 'Failed to download Telegram document');
            await bot.api.sendMessage(chatId, '[Failed to process document]').catch(() => {});
          }
        }

        const content = caption || '[Document]';
        const inbound: InboundMessage = {
          id: msgId,
          source: 'telegram',
          sender,
          rawContent: content,
          content,
          timestamp,
          attachments,
          metadata: { chatId },
        };
        if (processedDoc !== undefined) {
          inbound.processedDocument = processedDoc;
        }

        this.emit('message', inbound);
      };

      handleDocument().catch((err: Error) => {
        logger.warn({ err, chatId }, 'Unhandled error in Telegram document handler');
      });
    });

    this.bot.on('message:video', (ctx: GrammyContext) => {
      const video = ctx.message.video;
      if (!video) return;

      const chatId = ctx.chat.id.toString();
      const sender = ctx.from?.id.toString() ?? 'unknown';
      const msgId = `telegram-${ctx.message.message_id.toString()}`;
      const timestamp = new Date(ctx.message.date * 1000);
      const caption = ctx.message.caption ?? '';

      const bot = this.bot;
      const mediaManager = this.mediaManager;

      const handleVideo = async (): Promise<void> => {
        let attachments: InboundMessage['attachments'];

        if (bot && mediaManager) {
          await bot.api.sendChatAction(chatId, 'upload_video').catch(() => {});
          try {
            const { filePath, sizeBytes, mimeType } = await downloadTelegramFile(
              bot,
              video.file_id,
              mediaManager,
            );
            attachments = [{ type: 'video', filePath, mimeType, sizeBytes }];
          } catch (err) {
            logger.warn({ err, chatId }, 'Failed to download Telegram video');
            await bot.api.sendMessage(chatId, '[Failed to process video]').catch(() => {});
          }
        }

        const content = caption || '[Video]';
        const inbound: InboundMessage = {
          id: msgId,
          source: 'telegram',
          sender,
          rawContent: content,
          content,
          timestamp,
          attachments,
          metadata: { chatId },
        };

        this.emit('message', inbound);
      };

      handleVideo().catch((err: Error) => {
        logger.warn({ err, chatId }, 'Unhandled error in Telegram video handler');
      });
    });

    this.bot.on('message:audio', (ctx: GrammyContext) => {
      const audio = ctx.message.audio;
      if (!audio) return;

      const chatId = ctx.chat.id.toString();
      const sender = ctx.from?.id.toString() ?? 'unknown';
      const msgId = `telegram-${ctx.message.message_id.toString()}`;
      const timestamp = new Date(ctx.message.date * 1000);
      const caption = ctx.message.caption ?? '';

      const bot = this.bot;
      const mediaManager = this.mediaManager;

      const handleAudio = async (): Promise<void> => {
        let attachments: InboundMessage['attachments'];

        if (bot && mediaManager) {
          await bot.api.sendChatAction(chatId, 'upload_document').catch(() => {});
          try {
            const { filePath, sizeBytes, mimeType } = await downloadTelegramFile(
              bot,
              audio.file_id,
              mediaManager,
            );
            attachments = [{ type: 'audio', filePath, mimeType, sizeBytes }];
          } catch (err) {
            logger.warn({ err, chatId }, 'Failed to download Telegram audio');
            await bot.api.sendMessage(chatId, '[Failed to process audio]').catch(() => {});
          }
        }

        const content = caption || '[Audio]';
        const inbound: InboundMessage = {
          id: msgId,
          source: 'telegram',
          sender,
          rawContent: content,
          content,
          timestamp,
          attachments,
          metadata: { chatId },
        };

        this.emit('message', inbound);
      };

      handleAudio().catch((err: Error) => {
        logger.warn({ err, chatId }, 'Unhandled error in Telegram audio handler');
      });
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

    if (message.media) {
      const { InputFile } = await import('grammy');
      const chatId = message.recipient;
      const inputFile = new InputFile(message.media.data, message.media.filename ?? 'file');
      const other: Record<string, unknown> = message.content ? { caption: message.content } : {};

      switch (message.media.type) {
        case 'image':
          await this.bot.api.sendPhoto(chatId, inputFile, other);
          break;
        case 'document':
          await this.bot.api.sendDocument(chatId, inputFile, other);
          break;
        case 'video':
          await this.bot.api.sendVideo(chatId, inputFile, other);
          break;
        case 'audio':
          await this.bot.api.sendVoice(chatId, inputFile, other);
          break;
      }
      return;
    }

    const chunks = splitMessage(message.content, PLATFORM_MAX_LENGTH.telegram);
    for (const chunk of chunks) {
      await this.bot.api.sendMessage(message.recipient, chunk);
    }
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
