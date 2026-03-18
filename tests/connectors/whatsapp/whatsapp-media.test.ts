import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// --------------------------------------------------------------------------
// Mock whatsapp-web.js — same pattern as whatsapp-connector.test.ts
// --------------------------------------------------------------------------

interface MockClientInstance {
  on: Mock;
  initialize: Mock;
  sendMessage: Mock;
  getChatById: Mock;
  destroy: Mock;
  _trigger: (event: string, ...args: unknown[]) => void;
}

const createdClients: MockClientInstance[] = [];
let mockClientInstance: MockClientInstance;

vi.mock('whatsapp-web.js', () => {
  class MockClient {
    private handlers: Map<string, ((...args: unknown[]) => void)[]> = new Map();

    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!this.handlers.has(event)) this.handlers.set(event, []);
      this.handlers.get(event)!.push(handler);
    });

    initialize = vi.fn(async () => {});
    sendMessage = vi.fn(async () => {});
    getChatById = vi.fn(async () => ({ sendStateTyping: vi.fn(async () => {}) }));
    destroy = vi.fn(async () => {});

    _trigger(event: string, ...args: unknown[]): void {
      const handlers = this.handlers.get(event) ?? [];
      for (const h of handlers) h(...args);
    }
  }

  class LocalAuth {}
  class MessageMedia {}

  const ClientConstructor = vi.fn(function (this: MockClientInstance) {
    const instance = new MockClient() as unknown as MockClientInstance;
    createdClients.push(instance);
    mockClientInstance = instance;
    return instance;
  });

  return {
    Client: ClientConstructor,
    LocalAuth,
    MessageMedia,
    default: { Client: ClientConstructor, LocalAuth, MessageMedia },
  };
});

// Mock document-processor so tests don't attempt real file reads
vi.mock('../../../src/intelligence/document-processor.js', () => ({
  processDocument: vi.fn().mockResolvedValue({
    id: 'doc-1',
    filename: 'test.jpg',
    mimeType: 'image/jpeg',
    filePath: '/tmp/media/saved-file.jpg',
    docType: 'image',
    rawText: '',
    tables: [],
    images: [],
    entities: [],
    relations: [],
    metadata: {},
    processedAt: new Date().toISOString(),
  }),
}));

// --------------------------------------------------------------------------
// Import after mock registration
// --------------------------------------------------------------------------

import { WhatsAppConnector } from '../../../src/connectors/whatsapp/whatsapp-connector.js';
import { parseWhatsAppMessage } from '../../../src/connectors/whatsapp/whatsapp-message.js';
import type { MediaManager } from '../../../src/core/media-manager.js';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function buildMockMediaManager(
  filePath = '/tmp/media/saved-file.jpg',
  sizeBytes = 1024,
): MediaManager {
  return {
    saveMedia: vi.fn().mockResolvedValue({ filePath, sizeBytes }),
    cleanExpired: vi.fn().mockResolvedValue(undefined),
    get directory() {
      return '/tmp/media';
    },
  } as unknown as MediaManager;
}

function buildConnector(options: Record<string, unknown> = {}): WhatsAppConnector {
  return new WhatsAppConnector(options);
}

/** Flush the microtask queue deeply enough to resolve the void handleIncomingMessage() chain.
 *
 * Chain: void handleIncomingMessage → await downloadIncomingMedia
 *                                     → await msg.downloadMedia()   (level 1)
 *                                     → await mediaManager.saveMedia() (level 2)
 *        → resume, emit                                                (level 3+)
 */
async function flushMessageHandling(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('WhatsApp media handling (OB-1165)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.clearAllTimers();
    vi.spyOn(
      WhatsAppConnector.prototype as unknown as { removeStaleLock: () => Promise<void> },
      'removeStaleLock',
    ).mockResolvedValue(undefined);
    createdClients.length = 0;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // parseWhatsAppMessage() with attachments
  // -----------------------------------------------------------------------

  describe('parseWhatsAppMessage() with attachments', () => {
    it('includes the attachments array when provided', () => {
      const attachments = [
        {
          type: 'image' as const,
          filePath: '/tmp/media/img.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2048,
        },
      ];
      const result = parseWhatsAppMessage(
        'id-1',
        '+1234567890',
        'Check this out',
        1700000000,
        attachments,
      );
      expect(result.attachments).toEqual(attachments);
    });

    it('omits the attachments field when not provided', () => {
      const result = parseWhatsAppMessage('id-2', '+1234567890', 'Hello', 1700000000);
      expect(result.attachments).toBeUndefined();
    });

    it('preserves all attachment metadata fields for a document', () => {
      const attachments = [
        {
          type: 'document' as const,
          filePath: '/tmp/media/report.pdf',
          mimeType: 'application/pdf',
          filename: 'report.pdf',
          sizeBytes: 512000,
        },
      ];
      const result = parseWhatsAppMessage(
        'id-3',
        '+1234567890',
        '[Document]',
        1700000000,
        attachments,
      );
      expect(result.attachments?.[0]).toMatchObject({
        type: 'document',
        filePath: '/tmp/media/report.pdf',
        mimeType: 'application/pdf',
        filename: 'report.pdf',
        sizeBytes: 512000,
      });
    });
  });

  // -----------------------------------------------------------------------
  // handleIncomingMessage() — incoming media download
  // -----------------------------------------------------------------------

  describe('handleIncomingMessage() — image download', () => {
    it('downloads an image and populates InboundMessage.attachments', async () => {
      const connector = buildConnector();
      const mediaManager = buildMockMediaManager('/tmp/media/abc.jpg', 2048);
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      mockClientInstance._trigger('message', {
        id: { id: 'img-1' },
        from: '+1234567890',
        body: 'Look at this image',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'image',
        downloadMedia: vi.fn().mockResolvedValue({ data: 'base64imgdata', mimetype: 'image/jpeg' }),
      });

      await flushMessageHandling();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as {
        content: string;
        attachments: Array<{ type: string; filePath: string; mimeType: string; sizeBytes: number }>;
      };
      expect(msg.content).toBe('Look at this image');
      expect(msg.attachments).toBeDefined();
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0]).toMatchObject({
        type: 'image',
        filePath: '/tmp/media/abc.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 2048,
      });
    });

    it('uses fallback "[Image]" content when image has no caption', async () => {
      const connector = buildConnector();
      const mediaManager = buildMockMediaManager('/tmp/media/noCaption.jpg', 512);
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      mockClientInstance._trigger('message', {
        id: { id: 'img-nocap-1' },
        from: '+1234567890',
        body: '', // no caption
        timestamp: 1700000000,
        hasMedia: true,
        type: 'image',
        downloadMedia: vi.fn().mockResolvedValue({ data: 'imgdata', mimetype: 'image/jpeg' }),
      });

      await flushMessageHandling();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as { content: string };
      expect(msg.content).toBe('[Image]');
    });
  });

  describe('handleIncomingMessage() — document download', () => {
    it('downloads a document with filename and populates attachments', async () => {
      const connector = buildConnector();
      const mediaManager = buildMockMediaManager('/tmp/media/uuid.pdf', 512000);
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      mockClientInstance._trigger('message', {
        id: { id: 'doc-1' },
        from: '+1234567890',
        body: 'Here is the report',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'document',
        downloadMedia: vi.fn().mockResolvedValue({
          data: 'pdfbase64',
          mimetype: 'application/pdf',
          filename: 'report.pdf',
        }),
      });

      await flushMessageHandling();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as {
        content: string;
        attachments: Array<{ type: string; filename?: string; mimeType: string }>;
      };
      expect(msg.content).toBe('Here is the report');
      expect(msg.attachments?.[0]).toMatchObject({
        type: 'document',
        filePath: '/tmp/media/uuid.pdf',
        mimeType: 'application/pdf',
        filename: 'report.pdf',
        sizeBytes: 512000,
      });
    });
  });

  describe('handleIncomingMessage() — video download', () => {
    it('downloads a video and uses "[Video]" fallback content when no caption', async () => {
      const connector = buildConnector();
      const mediaManager = buildMockMediaManager('/tmp/media/vid.mp4', 8192000);
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      mockClientInstance._trigger('message', {
        id: { id: 'vid-1' },
        from: '+1234567890',
        body: '', // no caption
        timestamp: 1700000000,
        hasMedia: true,
        type: 'video',
        downloadMedia: vi.fn().mockResolvedValue({ data: 'videobase64', mimetype: 'video/mp4' }),
      });

      await flushMessageHandling();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as {
        content: string;
        attachments: Array<{ type: string }>;
      };
      expect(msg.content).toBe('[Video]');
      expect(msg.attachments?.[0]).toMatchObject({ type: 'video', mimeType: 'video/mp4' });
    });
  });

  describe('handleIncomingMessage() — sticker', () => {
    it('maps sticker type to "image" attachment type', async () => {
      const connector = buildConnector();
      const mediaManager = buildMockMediaManager('/tmp/media/sticker.webp', 256);
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      mockClientInstance._trigger('message', {
        id: { id: 'sticker-1' },
        from: '+1234567890',
        body: '',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'sticker',
        downloadMedia: vi.fn().mockResolvedValue({ data: 'webpdata', mimetype: 'image/webp' }),
      });

      await flushMessageHandling();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as {
        attachments: Array<{ type: string; mimeType: string }>;
      };
      // Sticker is remapped to 'image' in the attachment type
      expect(msg.attachments?.[0]?.type).toBe('image');
      expect(msg.attachments?.[0]?.mimeType).toBe('image/webp');
    });
  });

  describe('handleIncomingMessage() — download failure fallback', () => {
    it('prepends failure notice and omits attachments when downloadMedia() throws', async () => {
      const connector = buildConnector();
      const mediaManager = buildMockMediaManager();
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      mockClientInstance._trigger('message', {
        id: { id: 'img-fail-1' },
        from: '+1234567890',
        body: 'my caption text',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'image',
        downloadMedia: vi.fn().mockRejectedValue(new Error('Network error')),
      });

      await flushMessageHandling();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as {
        content: string;
        attachments?: unknown[];
      };
      expect(msg.content).toContain('[Media attachment failed to download — image]');
      expect(msg.content).toContain('my caption text');
      expect(msg.attachments).toBeUndefined();
    });

    it('emits failure text alone when no caption is present', async () => {
      const connector = buildConnector();
      const mediaManager = buildMockMediaManager();
      connector.setMediaManager(mediaManager);

      const messageListener = vi.fn();
      connector.on('message', messageListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      mockClientInstance._trigger('message', {
        id: { id: 'doc-fail-1' },
        from: '+1234567890',
        body: '',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'document',
        downloadMedia: vi.fn().mockRejectedValue(new Error('Timeout')),
      });

      await flushMessageHandling();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as { content: string };
      expect(msg.content).toBe('[Media attachment failed to download — document]');
    });
  });

  describe('handleIncomingMessage() — typing indicator', () => {
    it('sends typing indicator when hasMedia is true', async () => {
      const connector = buildConnector();
      const mediaManager = buildMockMediaManager();
      connector.setMediaManager(mediaManager);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      const typingSpy = vi.spyOn(connector, 'sendTypingIndicator').mockResolvedValue(undefined);

      mockClientInstance._trigger('message', {
        id: { id: 'img-typing-1' },
        from: '+1234567890',
        body: '',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'image',
        downloadMedia: vi.fn().mockResolvedValue({ data: 'imgdata', mimetype: 'image/jpeg' }),
      });

      await flushMessageHandling();

      expect(typingSpy).toHaveBeenCalledWith('+1234567890');
    });
  });

  describe('handleIncomingMessage() — no MediaManager configured', () => {
    it('does not attempt media download and emits text-only message', async () => {
      // No MediaManager set on the connector
      const connector = buildConnector();

      const messageListener = vi.fn();
      connector.on('message', messageListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      const downloadMedia = vi.fn().mockResolvedValue({ data: 'imgdata', mimetype: 'image/jpeg' });

      mockClientInstance._trigger('message', {
        id: { id: 'img-no-manager' },
        from: '+1234567890',
        body: 'Just a caption',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'image',
        downloadMedia,
      });

      await flushMessageHandling();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as {
        content: string;
        attachments?: unknown[];
      };
      // Without a MediaManager, downloadIncomingMedia returns null → no attachments
      expect(msg.attachments).toBeUndefined();
      // Original body is preserved
      expect(msg.content).toBe('Just a caption');
      // downloadMedia should not have been called without a MediaManager
      expect(downloadMedia).not.toHaveBeenCalled();
    });
  });
});
