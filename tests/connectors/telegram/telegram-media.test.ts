/**
 * Unit tests for Telegram media handling (OB-1166).
 *
 * Covers:
 *  - downloadTelegramFile() helper (MIME resolution, error handling)
 *  - message:voice handler (Whisper transcription, fallback, failure)
 *  - message:photo handler (largest size, caption, failure)
 *  - message:document handler (filename, mime_type, caption)
 *  - message:video handler (caption, attachment)
 *  - outbound media (sendPhoto, sendDocument, sendVideo, sendVoice, caption)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { InboundMessage, OutboundMessage } from '../../../src/types/message.js';

// ---------------------------------------------------------------------------
// Mock: node:https — intercept fetchHttpsBuffer inside the connector
// ---------------------------------------------------------------------------

const mockHttpsGet = vi.hoisted(() => vi.fn());

vi.mock('node:https', () => ({
  default: { get: mockHttpsGet },
}));

// ---------------------------------------------------------------------------
// Mock: voice transcriber
// ---------------------------------------------------------------------------

import type { TranscriptionResult } from '../../../src/core/voice-transcriber.js';

const mockTranscribeAudio = vi.hoisted(() =>
  vi.fn<[string], Promise<TranscriptionResult | null>>(),
);

vi.mock('../../../src/core/voice-transcriber.js', () => ({
  transcribeAudio: mockTranscribeAudio,
  TRANSCRIPTION_FALLBACK_MESSAGE:
    '[Voice message — set OPENAI_API_KEY or install whisper for transcription]',
}));

const MOCK_FALLBACK = '[Voice message — set OPENAI_API_KEY or install whisper for transcription]';

// ---------------------------------------------------------------------------
// Mock: logger — suppress output
// ---------------------------------------------------------------------------

vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock: grammy — full media-capable API
// ---------------------------------------------------------------------------

type GrammyCtx = {
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
  from?: { id: number; username?: string; first_name: string };
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
};

interface MockBotApi {
  sendMessage: ReturnType<typeof vi.fn>;
  sendChatAction: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
  getFile: ReturnType<typeof vi.fn>;
  sendPhoto: ReturnType<typeof vi.fn>;
  sendDocument: ReturnType<typeof vi.fn>;
  sendVideo: ReturnType<typeof vi.fn>;
  sendVoice: ReturnType<typeof vi.fn>;
}

interface MockBotInstance {
  token: string;
  handlers: Map<string, Array<(ctx: GrammyCtx) => void>>;
  api: MockBotApi;
  on: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  simulateEvent(event: string, ctx: GrammyCtx): void;
}

const createdBotInstances = vi.hoisted(() => [] as MockBotInstance[]);

vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation((token: string) => {
    const handlers = new Map<string, Array<(ctx: GrammyCtx) => void>>();
    const api: MockBotApi = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      sendChatAction: vi.fn().mockResolvedValue({}),
      editMessageText: vi.fn().mockResolvedValue({}),
      deleteMessage: vi.fn().mockResolvedValue({}),
      getFile: vi.fn().mockResolvedValue({
        file_id: 'file123',
        file_path: 'voice/file.oga',
        file_size: 1024,
      }),
      sendPhoto: vi.fn().mockResolvedValue({}),
      sendDocument: vi.fn().mockResolvedValue({}),
      sendVideo: vi.fn().mockResolvedValue({}),
      sendVoice: vi.fn().mockResolvedValue({}),
    };
    const instance: MockBotInstance = {
      token,
      handlers,
      api,
      on: vi.fn((event: string, handler: (ctx: GrammyCtx) => void) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(handler);
      }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      simulateEvent(event: string, ctx: GrammyCtx) {
        for (const h of handlers.get(event) ?? []) h(ctx);
      },
    };
    createdBotInstances.push(instance);
    return instance;
  }),
  InputFile: vi
    .fn()
    .mockImplementation((data: unknown, name?: string) => ({ _data: data, _name: name })),
}));

// ---------------------------------------------------------------------------
// Import connector after all mocks are registered
// ---------------------------------------------------------------------------

import {
  TelegramConnector,
  downloadTelegramFile,
} from '../../../src/connectors/telegram/telegram-connector.js';
import type { MediaManager } from '../../../src/core/media-manager.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function latestBot(): MockBotInstance {
  const bot = createdBotInstances[createdBotInstances.length - 1];
  if (!bot) throw new Error('No bot instance created');
  return bot;
}

function buildMockMediaManager(
  filePath = '/tmp/tg/media/saved.oga',
  sizeBytes = 2048,
): MediaManager {
  return {
    saveMedia: vi.fn().mockResolvedValue({ filePath, sizeBytes }),
    cleanExpired: vi.fn().mockResolvedValue(undefined),
    get directory() {
      return '/tmp/tg/media';
    },
  } as unknown as MediaManager;
}

/** Configure mockHttpsGet to stream a buffer synchronously and resolve. */
function setupHttpsSuccess(data = Buffer.from('binary-data')): void {
  mockHttpsGet.mockImplementation((_url: string, callback: (res: EventEmitter) => void) => {
    const mockReq = { on: vi.fn().mockReturnThis() };
    const mockRes = new EventEmitter();
    callback(mockRes);
    mockRes.emit('data', data);
    mockRes.emit('end');
    return mockReq;
  });
}

/** Flush microtask queue enough times to let all async handler awaits resolve. */
async function flushAsync(): Promise<void> {
  for (let i = 0; i < 15; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Telegram media handling (OB-1166)', () => {
  let connector: TelegramConnector;

  beforeEach(() => {
    createdBotInstances.length = 0;
    vi.clearAllMocks();
    connector = new TelegramConnector({ token: 'test-token:ABC' });
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  // -------------------------------------------------------------------------
  // downloadTelegramFile() — unit tests for the exported helper
  // -------------------------------------------------------------------------

  describe('downloadTelegramFile()', () => {
    it('fetches file path from Telegram API, downloads via HTTPS, and saves via MediaManager', async () => {
      setupHttpsSuccess(Buffer.from('jpeg-data'));

      const mockBot = {
        token: 'tok:ABC',
        api: {
          getFile: vi.fn().mockResolvedValue({
            file_id: 'file123',
            file_path: 'photos/image.jpg',
          }),
        },
      } as unknown as Parameters<typeof downloadTelegramFile>[0];

      const mediaManager = buildMockMediaManager('/tmp/tg/media/image.jpg', 5000);

      const result = await downloadTelegramFile(mockBot, 'file123', mediaManager);

      expect(mockBot.api.getFile).toHaveBeenCalledWith('file123');
      expect(mockHttpsGet).toHaveBeenCalledWith(
        'https://api.telegram.org/file/bottok:ABC/photos/image.jpg',
        expect.any(Function),
      );
      expect(mediaManager.saveMedia).toHaveBeenCalledWith(
        Buffer.from('jpeg-data'),
        'image/jpeg',
        'image.jpg',
      );
      expect(result).toMatchObject({
        filePath: '/tmp/tg/media/image.jpg',
        sizeBytes: 5000,
        mimeType: 'image/jpeg',
      });
    });

    it('throws when getFile returns no file_path', async () => {
      const mockBot = {
        token: 'tok:ABC',
        api: {
          getFile: vi.fn().mockResolvedValue({ file_id: 'file123' }), // no file_path
        },
      } as unknown as Parameters<typeof downloadTelegramFile>[0];

      const mediaManager = buildMockMediaManager();

      await expect(downloadTelegramFile(mockBot, 'file123', mediaManager)).rejects.toThrow(
        'no file_path',
      );
    });

    it('resolves mimeType for .oga files as audio/ogg', async () => {
      setupHttpsSuccess(Buffer.from('ogg-data'));

      const mockBot = {
        token: 'tok:ABC',
        api: {
          getFile: vi.fn().mockResolvedValue({ file_id: 'v', file_path: 'voice/voice.oga' }),
        },
      } as unknown as Parameters<typeof downloadTelegramFile>[0];

      const result = await downloadTelegramFile(mockBot, 'v', buildMockMediaManager());
      expect(result.mimeType).toBe('audio/ogg');
    });

    it('falls back to application/octet-stream for unknown file extensions', async () => {
      setupHttpsSuccess(Buffer.from('data'));

      const mockBot = {
        token: 'tok:ABC',
        api: {
          getFile: vi.fn().mockResolvedValue({ file_id: 'f', file_path: 'files/file.xyz' }),
        },
      } as unknown as Parameters<typeof downloadTelegramFile>[0];

      const result = await downloadTelegramFile(mockBot, 'f', buildMockMediaManager());
      expect(result.mimeType).toBe('application/octet-stream');
    });
  });

  // -------------------------------------------------------------------------
  // message:voice handler — voice transcription
  // -------------------------------------------------------------------------

  describe('message:voice handler', () => {
    it('emits transcription text as content when Whisper is available', async () => {
      setupHttpsSuccess(Buffer.from('ogg-audio'));
      mockTranscribeAudio.mockResolvedValue({
        text: 'Hello, this is a transcription',
        backend: 'cli',
        durationMs: 10,
      });

      const mediaManager = buildMockMediaManager('/tmp/tg/media/voice.oga');
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      latestBot().simulateEvent('message:voice', {
        message: { message_id: 1, date: 1_700_000_000, voice: { file_id: 'voice1', duration: 5 } },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.content).toBe('Hello, this is a transcription');
      expect(msg.source).toBe('telegram');
      expect(msg.sender).toBe('42');
      expect(msg.id).toBe('telegram-1');
    });

    it('emits fallback text when transcribeAudio returns null (Whisper not installed)', async () => {
      setupHttpsSuccess(Buffer.from('ogg-audio'));
      mockTranscribeAudio.mockResolvedValue(null);

      const mediaManager = buildMockMediaManager('/tmp/tg/media/voice.oga');
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      latestBot().simulateEvent('message:voice', {
        message: { message_id: 2, date: 1_700_000_000, voice: { file_id: 'voice2', duration: 3 } },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.content).toBe(MOCK_FALLBACK);
    });

    it('sends failure reply and emits fallback content when download throws', async () => {
      const mediaManager = buildMockMediaManager();
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      const bot = latestBot();
      bot.api.getFile.mockRejectedValueOnce(new Error('Telegram API error'));

      bot.simulateEvent('message:voice', {
        message: { message_id: 3, date: 1_700_000_000, voice: { file_id: 'voice3', duration: 2 } },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      expect(bot.api.sendMessage).toHaveBeenCalledWith('42', '[Failed to process voice]');
      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.content).toBe('[Voice message — transcription failed]');
    });

    it('emits fallback when no MediaManager is configured', async () => {
      // No setMediaManager call
      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      latestBot().simulateEvent('message:voice', {
        message: { message_id: 4, date: 1_700_000_000, voice: { file_id: 'v4', duration: 1 } },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.content).toBe(MOCK_FALLBACK);
    });

    it('sends typing chat action before downloading the voice file', async () => {
      setupHttpsSuccess(Buffer.from('audio'));
      mockTranscribeAudio.mockResolvedValue({ text: 'text', backend: 'cli', durationMs: 5 });

      const mediaManager = buildMockMediaManager();
      connector.setMediaManager(mediaManager);
      connector.on('message', vi.fn());
      await connector.initialize();

      const bot = latestBot();
      bot.simulateEvent('message:voice', {
        message: { message_id: 5, date: 1_700_000_000, voice: { file_id: 'v5', duration: 2 } },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      expect(bot.api.sendChatAction).toHaveBeenCalledWith('42', 'typing');
    });
  });

  // -------------------------------------------------------------------------
  // message:photo handler — photo download
  // -------------------------------------------------------------------------

  describe('message:photo handler', () => {
    it('downloads the largest photo size (last element) and attaches it', async () => {
      setupHttpsSuccess(Buffer.from('photo-data'));

      const mediaManager = buildMockMediaManager('/tmp/tg/media/photo.jpg', 4096);
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      const bot = latestBot();
      bot.api.getFile.mockResolvedValue({ file_id: 'large', file_path: 'photos/large.jpg' });

      bot.simulateEvent('message:photo', {
        message: {
          message_id: 10,
          date: 1_700_000_000,
          caption: 'Look at this!',
          photo: [
            { file_id: 'small', width: 100, height: 100 },
            { file_id: 'medium', width: 320, height: 240 },
            { file_id: 'large', width: 800, height: 600 }, // largest — last element
          ],
        },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      // Should only fetch the largest (last) photo
      expect(bot.api.getFile).toHaveBeenCalledWith('large');
      expect(bot.api.getFile).toHaveBeenCalledTimes(1);

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.content).toBe('Look at this!');
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments![0]).toMatchObject({
        type: 'image',
        filePath: '/tmp/tg/media/photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 4096,
      });
    });

    it('uses "[Image]" fallback content when photo has no caption', async () => {
      setupHttpsSuccess(Buffer.from('photo-data'));

      const mediaManager = buildMockMediaManager('/tmp/tg/media/photo.jpg');
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      const bot = latestBot();
      bot.api.getFile.mockResolvedValue({ file_id: 'p1', file_path: 'photos/photo.jpg' });

      bot.simulateEvent('message:photo', {
        message: {
          message_id: 11,
          date: 1_700_000_000,
          // no caption field
          photo: [{ file_id: 'p1', width: 640, height: 480 }],
        },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.content).toBe('[Image]');
    });

    it('sends upload_photo chat action before downloading the photo', async () => {
      setupHttpsSuccess(Buffer.from('photo'));

      const mediaManager = buildMockMediaManager();
      connector.setMediaManager(mediaManager);
      connector.on('message', vi.fn());
      await connector.initialize();

      const bot = latestBot();
      bot.api.getFile.mockResolvedValue({ file_id: 'p', file_path: 'photos/p.jpg' });

      bot.simulateEvent('message:photo', {
        message: {
          message_id: 12,
          date: 1_700_000_000,
          photo: [{ file_id: 'p', width: 100, height: 100 }],
        },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      expect(bot.api.sendChatAction).toHaveBeenCalledWith('42', 'upload_photo');
    });

    it('sends failure reply and emits message without attachments when download fails', async () => {
      const mediaManager = buildMockMediaManager();
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      const bot = latestBot();
      bot.api.getFile.mockRejectedValueOnce(new Error('API error'));

      bot.simulateEvent('message:photo', {
        message: {
          message_id: 13,
          date: 1_700_000_000,
          caption: 'My photo',
          photo: [{ file_id: 'fail', width: 100, height: 100 }],
        },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      expect(bot.api.sendMessage).toHaveBeenCalledWith('42', '[Failed to process photo]');
      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.attachments).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // message:document handler — document download
  // -------------------------------------------------------------------------

  describe('message:document handler', () => {
    it('downloads a document and attaches it with filename and mime_type', async () => {
      setupHttpsSuccess(Buffer.from('pdf-data'));

      const mediaManager = buildMockMediaManager('/tmp/tg/media/report.pdf', 512_000);
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      const bot = latestBot();
      bot.api.getFile.mockResolvedValue({
        file_id: 'doc1',
        file_path: 'documents/report.pdf',
      });

      bot.simulateEvent('message:document', {
        message: {
          message_id: 20,
          date: 1_700_000_000,
          caption: 'Here is the report',
          document: {
            file_id: 'doc1',
            file_name: 'report.pdf',
            mime_type: 'application/pdf',
          },
        },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.content).toBe('Here is the report');
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments![0]).toMatchObject({
        type: 'document',
        filePath: '/tmp/tg/media/report.pdf',
        mimeType: 'application/pdf',
        filename: 'report.pdf',
        sizeBytes: 512_000,
      });
    });

    it('uses "[Document]" fallback content when no caption', async () => {
      setupHttpsSuccess(Buffer.from('doc-data'));

      const mediaManager = buildMockMediaManager('/tmp/tg/media/file.pdf');
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      const bot = latestBot();
      bot.api.getFile.mockResolvedValue({ file_id: 'doc2', file_path: 'documents/file.pdf' });

      bot.simulateEvent('message:document', {
        message: {
          message_id: 21,
          date: 1_700_000_000,
          // no caption
          document: { file_id: 'doc2', file_name: 'file.pdf' },
        },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.content).toBe('[Document]');
    });

    it('sends upload_document chat action before downloading', async () => {
      setupHttpsSuccess(Buffer.from('doc'));

      const mediaManager = buildMockMediaManager();
      connector.setMediaManager(mediaManager);
      connector.on('message', vi.fn());
      await connector.initialize();

      const bot = latestBot();
      bot.api.getFile.mockResolvedValue({ file_id: 'd', file_path: 'documents/d.pdf' });

      bot.simulateEvent('message:document', {
        message: {
          message_id: 22,
          date: 1_700_000_000,
          document: { file_id: 'd' },
        },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      expect(bot.api.sendChatAction).toHaveBeenCalledWith('42', 'upload_document');
    });
  });

  // -------------------------------------------------------------------------
  // message:video handler — video download
  // -------------------------------------------------------------------------

  describe('message:video handler', () => {
    it('downloads a video and attaches it with caption as content', async () => {
      setupHttpsSuccess(Buffer.from('video-data'));

      const mediaManager = buildMockMediaManager('/tmp/tg/media/video.mp4', 8_192_000);
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      const bot = latestBot();
      bot.api.getFile.mockResolvedValue({ file_id: 'vid1', file_path: 'videos/clip.mp4' });

      bot.simulateEvent('message:video', {
        message: {
          message_id: 30,
          date: 1_700_000_000,
          caption: 'Watch this clip',
          video: { file_id: 'vid1' },
        },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.content).toBe('Watch this clip');
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments![0]).toMatchObject({
        type: 'video',
        mimeType: 'video/mp4',
        sizeBytes: 8_192_000,
      });
    });

    it('uses "[Video]" fallback content when no caption', async () => {
      setupHttpsSuccess(Buffer.from('video'));

      const mediaManager = buildMockMediaManager('/tmp/tg/media/vid.mp4');
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);
      await connector.initialize();

      const bot = latestBot();
      bot.api.getFile.mockResolvedValue({ file_id: 'vid2', file_path: 'videos/vid.mp4' });

      bot.simulateEvent('message:video', {
        message: {
          message_id: 31,
          date: 1_700_000_000,
          video: { file_id: 'vid2' },
        },
        from: { id: 42, first_name: 'Alice' },
        chat: { id: 42, type: 'private' },
      });

      await flushAsync();

      const msg = messageListener.mock.calls[0]![0] as InboundMessage;
      expect(msg.content).toBe('[Video]');
    });
  });

  // -------------------------------------------------------------------------
  // outbound media — sendMessage() with media field
  // -------------------------------------------------------------------------

  describe('outbound media via sendMessage()', () => {
    it('sends a photo using bot.api.sendPhoto', async () => {
      await connector.initialize();
      const bot = latestBot();

      await connector.sendMessage({
        target: 'telegram',
        recipient: '12345',
        content: 'Here is the image',
        media: {
          type: 'image',
          data: Buffer.from('photo-bytes'),
          mimeType: 'image/jpeg',
          filename: 'photo.jpg',
        },
      } as OutboundMessage);

      expect(bot.api.sendPhoto).toHaveBeenCalledOnce();
      const sendPhotoCall = bot.api.sendPhoto.mock.calls[0] as [
        string,
        unknown,
        Record<string, unknown>,
      ];
      expect(sendPhotoCall[0]).toBe('12345');
      expect(sendPhotoCall[2]).toMatchObject({ caption: 'Here is the image' });
    });

    it('sends a document using bot.api.sendDocument', async () => {
      await connector.initialize();
      const bot = latestBot();

      await connector.sendMessage({
        target: 'telegram',
        recipient: '12345',
        content: 'See attached',
        media: {
          type: 'document',
          data: Buffer.from('pdf'),
          mimeType: 'application/pdf',
          filename: 'doc.pdf',
        },
      } as OutboundMessage);

      expect(bot.api.sendDocument).toHaveBeenCalledOnce();
    });

    it('sends a video using bot.api.sendVideo', async () => {
      await connector.initialize();
      const bot = latestBot();

      await connector.sendMessage({
        target: 'telegram',
        recipient: '12345',
        content: 'Video caption',
        media: {
          type: 'video',
          data: Buffer.from('video'),
          mimeType: 'video/mp4',
          filename: 'clip.mp4',
        },
      } as OutboundMessage);

      expect(bot.api.sendVideo).toHaveBeenCalledOnce();
    });

    it('sends audio using bot.api.sendVoice', async () => {
      await connector.initialize();
      const bot = latestBot();

      await connector.sendMessage({
        target: 'telegram',
        recipient: '12345',
        content: '',
        media: {
          type: 'audio',
          data: Buffer.from('audio'),
          mimeType: 'audio/ogg',
          filename: 'audio.ogg',
        },
      } as OutboundMessage);

      expect(bot.api.sendVoice).toHaveBeenCalledOnce();
    });

    it('omits caption when content is empty for outbound media', async () => {
      await connector.initialize();
      const bot = latestBot();

      await connector.sendMessage({
        target: 'telegram',
        recipient: '99',
        content: '',
        media: {
          type: 'image',
          data: Buffer.from('img'),
          mimeType: 'image/png',
          filename: 'img.png',
        },
      } as OutboundMessage);

      const emptyCapCall = bot.api.sendPhoto.mock.calls[0] as [
        string,
        unknown,
        Record<string, unknown>,
      ];
      expect(emptyCapCall[2]).toEqual({});
    });
  });
});
