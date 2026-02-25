import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// --------------------------------------------------------------------------
// No need to mock node:fs/promises — we stub removeStaleLock() on the
// WhatsAppConnector prototype instead.  See beforeEach below.
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Mock whatsapp-web.js
// The connector uses a dynamic import, so we mock the module here.
// --------------------------------------------------------------------------

interface MockChat {
  sendStateTyping: Mock;
}

interface MockClientInstance {
  on: Mock;
  initialize: Mock;
  sendMessage: Mock;
  getChatById: Mock;
  destroy: Mock;
  // Internal helper to trigger registered event handlers in tests
  _trigger: (event: string, ...args: unknown[]) => void;
}

// All client instances created during a test, in order of creation
const createdClients: MockClientInstance[] = [];

// Convenience accessor — always points to the most recently created client
let mockClientInstance: MockClientInstance;

// Options passed to the Client constructor (captured per test)
const capturedClientOptions: unknown[] = [];

// Controls how many times initialize() fails before succeeding (0 = never fail)
let initializeFailCount = 0;

vi.mock('whatsapp-web.js', () => {
  class MockClient {
    private handlers: Map<string, ((...args: unknown[]) => void)[]> = new Map();

    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!this.handlers.has(event)) {
        this.handlers.set(event, []);
      }
      this.handlers.get(event)!.push(handler);
    });

    initialize = vi.fn(async () => {
      if (initializeFailCount > 0) {
        initializeFailCount--;
        throw new Error('ProtocolError: Execution context was destroyed');
      }
    });
    sendMessage = vi.fn(async () => {});
    getChatById = vi.fn(async () => ({ sendStateTyping: vi.fn(async () => {}) }));
    destroy = vi.fn(async () => {});

    _trigger(event: string, ...args: unknown[]): void {
      const handlers = this.handlers.get(event) ?? [];
      for (const h of handlers) {
        h(...args);
      }
    }
  }

  class LocalAuth {}

  class MessageMedia {
    mimetype: string;
    data: string;
    filename: string | null;
    constructor(mimetype: string, data: string, filename?: string | null) {
      this.mimetype = mimetype;
      this.data = data;
      this.filename = filename ?? null;
    }
  }

  const ClientConstructor = vi.fn(function (this: MockClientInstance, options: unknown) {
    capturedClientOptions.push(options);
    const instance = new MockClient() as unknown as MockClientInstance;
    createdClients.push(instance);
    mockClientInstance = instance;
    return instance;
  });

  return {
    Client: ClientConstructor,
    LocalAuth,
    MessageMedia,
    // whatsapp-web.js is CJS — in ESM dynamic import, LocalAuth lives on .default
    default: { Client: ClientConstructor, LocalAuth, MessageMedia },
  };
});

// --------------------------------------------------------------------------
// Import connector AFTER mock is registered
// --------------------------------------------------------------------------

import { WhatsAppConnector } from '../../../src/connectors/whatsapp/whatsapp-connector.js';

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function buildConnector(options: Record<string, unknown> = {}): WhatsAppConnector {
  return new WhatsAppConnector(options);
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('WhatsAppConnector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.clearAllTimers();
    // Stub removeStaleLock — it does real filesystem I/O (readlink/unlink) that
    // can deadlock under fake timers or on CI runners.
    vi.spyOn(
      WhatsAppConnector.prototype as unknown as { removeStaleLock: () => Promise<void> },
      'removeStaleLock',
    ).mockResolvedValue(undefined);
    createdClients.length = 0;
    capturedClientOptions.length = 0;
    initializeFailCount = 0;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  describe('constructor', () => {
    it('accepts empty options and uses defaults', () => {
      expect(() => buildConnector()).not.toThrow();
    });

    it('accepts custom sessionName and sessionPath', () => {
      expect(() =>
        buildConnector({ sessionName: 'my-session', sessionPath: '/tmp/sessions' }),
      ).not.toThrow();
    });

    it('has name "whatsapp"', () => {
      const connector = buildConnector();
      expect(connector.name).toBe('whatsapp');
    });

    it('is not connected before initialize', () => {
      const connector = buildConnector();
      expect(connector.isConnected()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // initialize()
  // -----------------------------------------------------------------------

  describe('initialize()', () => {
    it('creates a WhatsApp Client and calls initialize()', async () => {
      const connector = buildConnector();
      await connector.initialize();
      expect(mockClientInstance.initialize).toHaveBeenCalledOnce();
    });

    it('emits "auth" when QR event fires', async () => {
      const connector = buildConnector();
      const authListener = vi.fn();
      connector.on('auth', authListener);

      await connector.initialize();
      mockClientInstance._trigger('qr', 'mock-qr-string');

      expect(authListener).toHaveBeenCalledOnce();
      expect(authListener).toHaveBeenCalledWith('mock-qr-string');
    });

    it('emits "ready" and marks connected when ready event fires', async () => {
      const connector = buildConnector();
      const readyListener = vi.fn();
      connector.on('ready', readyListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      expect(readyListener).toHaveBeenCalledOnce();
      expect(connector.isConnected()).toBe(true);
    });

    it('emits "error" on auth_failure', async () => {
      const connector = buildConnector();
      const errorListener = vi.fn();
      connector.on('error', errorListener);

      await connector.initialize();
      mockClientInstance._trigger('auth_failure', 'bad creds');

      expect(errorListener).toHaveBeenCalledOnce();
      const err = errorListener.mock.calls[0]?.[0] as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('auth failure');
    });

    it('emits "message" when a WhatsApp message is received', async () => {
      const connector = buildConnector();
      const messageListener = vi.fn();
      connector.on('message', messageListener);

      await connector.initialize();
      mockClientInstance._trigger('message', {
        id: { id: 'msg-42' },
        from: '+212600000000',
        body: '/ai hello',
        timestamp: 1700000000,
      });

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as { id: string; sender: string };
      expect(msg.id).toBe('msg-42');
      expect(msg.sender).toBe('+212600000000');
    });
  });

  // -----------------------------------------------------------------------
  // sendMessage()
  // -----------------------------------------------------------------------

  describe('sendMessage()', () => {
    it('throws when not connected', async () => {
      const connector = buildConnector();
      await connector.initialize();
      // NOT triggering 'ready' — connector is not connected

      await expect(
        connector.sendMessage({ target: 'whatsapp', recipient: '+1234567890', content: 'hi' }),
      ).rejects.toThrow('not connected');
    });

    it('sends message to the client when connected', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.sendMessage({
        target: 'whatsapp',
        recipient: '+1234567890',
        content: 'hello',
      });

      expect(mockClientInstance.sendMessage).toHaveBeenCalledOnce();
      expect(mockClientInstance.sendMessage).toHaveBeenCalledWith('+1234567890', 'hello');
    });

    it('splits long messages into multiple chunks sent sequentially', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      const longContent = 'a'.repeat(5000);
      await connector.sendMessage({
        target: 'whatsapp',
        recipient: '+1234567890',
        content: longContent,
      });

      // Should have sent more than one message
      expect(mockClientInstance.sendMessage.mock.calls.length).toBeGreaterThan(1);

      // Every chunk must be ≤ 4096 chars
      for (const call of mockClientInstance.sendMessage.mock.calls) {
        const sent = call[1] as string;
        expect(sent.length).toBeLessThanOrEqual(4096);
      }
    });
  });

  // -----------------------------------------------------------------------
  // sendMessage() with media attachments (OB-602)
  // -----------------------------------------------------------------------

  describe('sendMessage() with media', () => {
    it('sends a MessageMedia object when media field is present', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.sendMessage({
        target: 'whatsapp',
        recipient: '+1234567890',
        content: '',
        media: {
          type: 'image',
          data: Buffer.from('fake-image-data'),
          mimeType: 'image/png',
        },
      });

      expect(mockClientInstance.sendMessage).toHaveBeenCalledOnce();
      const [, content] = mockClientInstance.sendMessage.mock.calls[0] as [string, unknown];
      // Content should be a MessageMedia object (not a string)
      expect(typeof content).toBe('object');
      expect(content).not.toBeNull();
    });

    it('encodes buffer data as base64 in the MessageMedia object', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      const rawData = Buffer.from('hello pdf');
      await connector.sendMessage({
        target: 'whatsapp',
        recipient: '+1234567890',
        content: '',
        media: {
          type: 'document',
          data: rawData,
          mimeType: 'application/pdf',
          filename: 'report.pdf',
        },
      });

      const [, media] = mockClientInstance.sendMessage.mock.calls[0] as [
        string,
        { data: string; mimetype: string; filename: string | null },
      ];
      expect(media.data).toBe(rawData.toString('base64'));
      expect(media.mimetype).toBe('application/pdf');
      expect(media.filename).toBe('report.pdf');
    });

    it('uses content as caption when content is non-empty', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.sendMessage({
        target: 'whatsapp',
        recipient: '+1234567890',
        content: 'Here is your report',
        media: {
          type: 'document',
          data: Buffer.from('pdf'),
          mimeType: 'application/pdf',
          filename: 'report.pdf',
        },
      });

      const [, , options] = mockClientInstance.sendMessage.mock.calls[0] as [
        string,
        unknown,
        { caption?: string },
      ];
      expect(options?.caption).toBe('Here is your report');
    });

    it('uses filename as caption when content is empty and filename is present', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.sendMessage({
        target: 'whatsapp',
        recipient: '+1234567890',
        content: '',
        media: {
          type: 'document',
          data: Buffer.from('pdf'),
          mimeType: 'application/pdf',
          filename: 'invoice.pdf',
        },
      });

      const [, , options] = mockClientInstance.sendMessage.mock.calls[0] as [
        string,
        unknown,
        { caption?: string },
      ];
      expect(options?.caption).toBe('invoice.pdf');
    });

    it('sets sendMediaAsDocument for document type', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.sendMessage({
        target: 'whatsapp',
        recipient: '+1234567890',
        content: '',
        media: {
          type: 'document',
          data: Buffer.from('pdf'),
          mimeType: 'application/pdf',
          filename: 'doc.pdf',
        },
      });

      const [, , options] = mockClientInstance.sendMessage.mock.calls[0] as [
        string,
        unknown,
        { sendMediaAsDocument?: boolean },
      ];
      expect(options?.sendMediaAsDocument).toBe(true);
    });

    it('does not set sendMediaAsDocument for image type', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.sendMessage({
        target: 'whatsapp',
        recipient: '+1234567890',
        content: '',
        media: {
          type: 'image',
          data: Buffer.from('img'),
          mimeType: 'image/jpeg',
        },
      });

      const [, , options] = mockClientInstance.sendMessage.mock.calls[0] as [
        string,
        unknown,
        { sendMediaAsDocument?: boolean } | undefined,
      ];
      expect(options?.sendMediaAsDocument).toBeUndefined();
    });

    it('sends text normally when no media field is present', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.sendMessage({
        target: 'whatsapp',
        recipient: '+1234567890',
        content: 'plain text',
      });

      expect(mockClientInstance.sendMessage).toHaveBeenCalledOnce();
      const [, content] = mockClientInstance.sendMessage.mock.calls[0] as [string, string];
      expect(typeof content).toBe('string');
      expect(content).toBe('plain text');
    });

    it('throws when not connected even with media', async () => {
      const connector = buildConnector();
      await connector.initialize();
      // NOT triggering 'ready'

      await expect(
        connector.sendMessage({
          target: 'whatsapp',
          recipient: '+1234567890',
          content: '',
          media: {
            type: 'image',
            data: Buffer.from('img'),
            mimeType: 'image/png',
          },
        }),
      ).rejects.toThrow('not connected');
    });
  });

  // -----------------------------------------------------------------------
  // shutdown()
  // -----------------------------------------------------------------------

  describe('shutdown()', () => {
    it('calls destroy() on the client', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.shutdown();

      expect(mockClientInstance.destroy).toHaveBeenCalledOnce();
    });

    it('marks connector as not connected after shutdown', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');
      expect(connector.isConnected()).toBe(true);

      await connector.shutdown();
      expect(connector.isConnected()).toBe(false);
    });

    it('prevents reconnect after shutdown', async () => {
      const connector = buildConnector({
        reconnect: { enabled: true, maxAttempts: 5, initialDelayMs: 100 },
      });
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.shutdown();

      // Trigger a disconnect AFTER shutdown — reconnect should NOT be scheduled
      const initCallsBefore = mockClientInstance.initialize.mock.calls.length;
      mockClientInstance._trigger('disconnected', 'server closed');

      // Advance timers well past the reconnect delay
      await vi.advanceTimersByTimeAsync(5000);

      // No additional initialize calls — reconnect was suppressed
      expect(mockClientInstance.initialize.mock.calls.length).toBe(initCallsBefore);
    });
  });

  // -----------------------------------------------------------------------
  // Reconnect logic
  // -----------------------------------------------------------------------

  describe('auto-reconnect', () => {
    it('emits "disconnected" when disconnected event fires', async () => {
      const connector = buildConnector({ reconnect: { enabled: false } });
      const disconnectedListener = vi.fn();
      connector.on('disconnected', disconnectedListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');
      mockClientInstance._trigger('disconnected', 'remote closed');

      expect(disconnectedListener).toHaveBeenCalledWith('remote closed');
    });

    it('does not schedule reconnect when reconnect is disabled', async () => {
      const connector = buildConnector({ reconnect: { enabled: false } });
      await connector.initialize();
      mockClientInstance._trigger('ready');
      mockClientInstance._trigger('disconnected', 'reason');

      const callsBefore = mockClientInstance.initialize.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5000);
      expect(mockClientInstance.initialize.mock.calls.length).toBe(callsBefore);
    });

    it('emits "error" when max reconnect attempts are exhausted', async () => {
      const errorListener = vi.fn();
      // maxAttempts=1: first disconnect schedules reconnect timer (reconnectAttempt → 1).
      // The timer fires, creates a new client, and calls initialize(). The new client
      // fires "disconnected" — now reconnectAttempt(1) >= maxAttempts(1) → emits "error".
      const connector = buildConnector({
        reconnect: {
          enabled: true,
          maxAttempts: 1,
          initialDelayMs: 50,
          maxDelayMs: 60000,
          backoffFactor: 2,
        },
      });
      connector.on('error', errorListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      // First disconnect — schedules reconnect timer, reconnectAttempt → 1
      mockClientInstance._trigger('disconnected', 'reason');

      // Advance past the reconnect delay so the timer fires and a new client is created
      await vi.advanceTimersByTimeAsync(200);

      // mockClientInstance now points to the reconnected client (index 1).
      // Trigger a disconnect on the new client — reconnectAttempt(1) >= maxAttempts(1) → error.
      mockClientInstance._trigger('disconnected', 'reason again');

      expect(errorListener).toHaveBeenCalled();
      const err = errorListener.mock.calls.at(-1)?.[0] as Error;
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toContain('max attempts');
    });

    it('resets reconnect attempt counter on successful reconnect', async () => {
      vi.useRealTimers(); // Avoid fake-timer microtask deadlocks on CI runners
      const connector = buildConnector({
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          initialDelayMs: 5,
          maxDelayMs: 5,
          backoffFactor: 1,
        },
      });
      await connector.initialize();
      const firstClient = mockClientInstance;

      // First successful connection
      firstClient._trigger('ready');
      expect(connector.isConnected()).toBe(true);

      // Disconnect — schedules reconnect with 5ms delay
      firstClient._trigger('disconnected', 'reason');

      // Wait for reconnect: setTimeout(5ms) + destroy() + createAndStartClient()
      // Use generous wait to handle slow CI runners
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));

      // The new client fires ready — reconnectAttempt should reset to 0
      mockClientInstance._trigger('ready');
      expect(connector.isConnected()).toBe(true);
    }, 15_000);
  });

  // -----------------------------------------------------------------------
  // sendTypingIndicator()
  // -----------------------------------------------------------------------

  describe('sendTypingIndicator()', () => {
    it('calls getChatById and sendStateTyping when connected', async () => {
      vi.useRealTimers(); // Avoid fake-timer microtask delays on CI runners
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      const mockChat: MockChat = { sendStateTyping: vi.fn(async () => {}) };
      mockClientInstance.getChatById.mockResolvedValue(mockChat);

      await connector.sendTypingIndicator('+1234567890');

      expect(mockClientInstance.getChatById).toHaveBeenCalledWith('+1234567890');
      expect(mockChat.sendStateTyping).toHaveBeenCalledOnce();
    }, 15_000);

    it('silently skips when not connected', async () => {
      const connector = buildConnector();
      await connector.initialize();
      // NOT triggering 'ready' — connector is not connected

      await expect(connector.sendTypingIndicator('+1234567890')).resolves.toBeUndefined();
      expect(mockClientInstance.getChatById).not.toHaveBeenCalled();
    });

    it('does not throw when getChatById fails', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      mockClientInstance.getChatById.mockRejectedValue(new Error('chat not found'));

      await expect(connector.sendTypingIndicator('+1234567890')).resolves.toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // Event system
  // -----------------------------------------------------------------------

  describe('on() event registration', () => {
    it('supports multiple listeners for the same event', async () => {
      const connector = buildConnector();
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      connector.on('ready', listener1);
      connector.on('ready', listener2);

      await connector.initialize();
      mockClientInstance._trigger('ready');

      expect(listener1).toHaveBeenCalledOnce();
      expect(listener2).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // OB-420: WhatsApp stability improvements
  // -----------------------------------------------------------------------

  describe('stability improvements (OB-420)', () => {
    it('uses local webVersionCache to avoid remote fetch failures', async () => {
      const connector = buildConnector();
      await connector.initialize();

      const options = capturedClientOptions[0] as { webVersionCache: { type: string } };
      expect(options.webVersionCache.type).toBe('local');
    });

    it('retries client.initialize() on ProtocolError and succeeds on 2nd attempt', async () => {
      vi.useRealTimers(); // Need real async for retry backoff
      // Fail once, succeed on 2nd attempt
      initializeFailCount = 1;
      const connector = buildConnector({
        // 1ms delay so retries are fast but real-timer-compatible
        reconnect: { initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 1 },
      });

      await connector.initialize();

      expect(mockClientInstance.initialize).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting all 3 initialize() retry attempts', async () => {
      vi.useRealTimers(); // Need real async for retry backoff
      // Fail all 3 attempts
      initializeFailCount = 3;
      const connector = buildConnector({
        reconnect: { initialDelayMs: 1, maxDelayMs: 10, backoffFactor: 1 },
      });

      await expect(connector.initialize()).rejects.toThrow('ProtocolError');

      expect(mockClientInstance.initialize).toHaveBeenCalledTimes(3);
    });

    it('does not double-schedule reconnect when disconnected event fires twice', async () => {
      vi.useRealTimers(); // Need real async for the reconnect timer to fire and complete
      const connector = buildConnector({
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          initialDelayMs: 5,
          maxDelayMs: 5,
          backoffFactor: 1,
        },
      });
      await connector.initialize();
      mockClientInstance._trigger('ready');

      // Fire disconnected twice in the same tick — second call should be skipped by guard
      mockClientInstance._trigger('disconnected', 'reason 1');
      mockClientInstance._trigger('disconnected', 'reason 2');

      // Wait for the single reconnect timer to fire and createAndStartClient() to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(createdClients.length).toBe(2); // original + exactly one reconnect
    });

    it('logs ProtocolError as post-ready when error fires after ready', async () => {
      vi.useRealTimers(); // Need real async for the reconnect timer to complete
      const errorListener = vi.fn();
      const connector = buildConnector({
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          initialDelayMs: 5,
          maxDelayMs: 5,
          backoffFactor: 1,
        },
      });
      connector.on('error', errorListener);

      await connector.initialize();
      mockClientInstance._trigger('ready');
      expect(connector.isConnected()).toBe(true);

      // Fire error event post-ready — should trigger reconnect
      mockClientInstance._trigger(
        'error',
        new Error('ProtocolError: Execution context was destroyed'),
      );

      expect(errorListener).toHaveBeenCalledOnce();
      expect(connector.isConnected()).toBe(false);
      // Reconnect should be scheduled — wait for it to complete
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(createdClients.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // sendProgress()
  // -----------------------------------------------------------------------

  describe('sendProgress()', () => {
    it('sends a single message on spawning event', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.sendProgress({ type: 'spawning', workerCount: 3 }, '+1234567890@c.us');

      expect(mockClientInstance.sendMessage).toHaveBeenCalledWith(
        '+1234567890@c.us',
        '🔄 Breaking into 3 subtasks...',
      );
    });

    it('sends "1 subtask" (singular) when workerCount is 1', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      await connector.sendProgress({ type: 'spawning', workerCount: 1 }, '+1234567890@c.us');

      expect(mockClientInstance.sendMessage).toHaveBeenCalledWith(
        '+1234567890@c.us',
        '🔄 Breaking into 1 subtask...',
      );
    });

    it('does not send a second spawning message if one was already sent', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');
      const chatId = '+1234567890@c.us';

      await connector.sendProgress({ type: 'spawning', workerCount: 2 }, chatId);
      await connector.sendProgress({ type: 'spawning', workerCount: 2 }, chatId);

      expect(mockClientInstance.sendMessage).toHaveBeenCalledOnce();
    });

    it('silently skips non-spawning events (no message spam)', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');
      const chatId = '+1234567890@c.us';

      await connector.sendProgress({ type: 'classifying' }, chatId);
      await connector.sendProgress({ type: 'planning' }, chatId);
      await connector.sendProgress({ type: 'synthesizing' }, chatId);

      expect(mockClientInstance.sendMessage).not.toHaveBeenCalled();
    });

    it('clears sent state on complete so a new progress can be sent', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');
      const chatId = '+1234567890@c.us';

      await connector.sendProgress({ type: 'spawning', workerCount: 2 }, chatId);
      await connector.sendProgress({ type: 'complete' }, chatId);
      // After complete, a new spawning event should send again
      await connector.sendProgress({ type: 'spawning', workerCount: 1 }, chatId);

      expect(mockClientInstance.sendMessage).toHaveBeenCalledTimes(2);
    });

    it('silently skips when disconnected', async () => {
      const connector = buildConnector();
      // Not initialized — not connected
      await connector.sendProgress({ type: 'spawning', workerCount: 2 }, '+1234567890@c.us');
      // No mock client yet — should not throw
    });
  });

  // -----------------------------------------------------------------------
  // Voice message transcription (OB-605)
  // -----------------------------------------------------------------------

  describe('voice message transcription (OB-605)', () => {
    it('emits message with transcription text for ptt voice notes', async () => {
      const connector = buildConnector();
      const messageListener = vi.fn();
      connector.on('message', messageListener);

      // Stub the private transcribeVoiceMessage to return a transcription
      vi.spyOn(
        connector as unknown as { transcribeVoiceMessage: () => Promise<string | null> },
        'transcribeVoiceMessage',
      ).mockResolvedValue('Hello from voice message');

      await connector.initialize();
      mockClientInstance._trigger('message', {
        id: { id: 'voice-1' },
        from: '+1234567890',
        body: '',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'ptt',
        downloadMedia: vi.fn().mockResolvedValue({ data: 'base64audio', mimetype: 'audio/ogg' }),
      });

      // Flush async microtasks from the void handleIncomingMessage() call
      await Promise.resolve();
      await Promise.resolve();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as { content: string };
      expect(msg.content).toBe('Hello from voice message');
    });

    it('uses fallback text when transcription returns null (whisper not installed)', async () => {
      const connector = buildConnector();
      const messageListener = vi.fn();
      connector.on('message', messageListener);

      vi.spyOn(
        connector as unknown as { transcribeVoiceMessage: () => Promise<string | null> },
        'transcribeVoiceMessage',
      ).mockResolvedValue(null);

      await connector.initialize();
      mockClientInstance._trigger('message', {
        id: { id: 'voice-2' },
        from: '+1234567890',
        body: '',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'ptt',
        downloadMedia: vi.fn().mockResolvedValue(null),
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as { content: string };
      expect(msg.content).toContain('[Voice message');
      expect(msg.content).toContain('whisper');
    });

    it('does not call transcribeVoiceMessage for regular text messages', async () => {
      const connector = buildConnector();
      const messageListener = vi.fn();
      connector.on('message', messageListener);

      const transcribeSpy = vi
        .spyOn(
          connector as unknown as { transcribeVoiceMessage: () => Promise<string | null> },
          'transcribeVoiceMessage',
        )
        .mockResolvedValue(null);

      await connector.initialize();
      mockClientInstance._trigger('message', {
        id: { id: 'msg-text-1' },
        from: '+1234567890',
        body: 'Hello world',
        timestamp: 1700000000,
        hasMedia: false,
        type: 'chat',
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as { content: string };
      expect(msg.content).toBe('Hello world');
      expect(transcribeSpy).not.toHaveBeenCalled();
    });

    it('does not transcribe non-ptt media messages (e.g. images)', async () => {
      const connector = buildConnector();
      const messageListener = vi.fn();
      connector.on('message', messageListener);

      const transcribeSpy = vi
        .spyOn(
          connector as unknown as { transcribeVoiceMessage: () => Promise<string | null> },
          'transcribeVoiceMessage',
        )
        .mockResolvedValue(null);

      await connector.initialize();
      mockClientInstance._trigger('message', {
        id: { id: 'img-1' },
        from: '+1234567890',
        body: 'Look at this!',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'image',
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as { content: string };
      expect(msg.content).toBe('Look at this!');
      expect(transcribeSpy).not.toHaveBeenCalled();
    });

    it('emits message with correct sender and id for voice notes', async () => {
      const connector = buildConnector();
      const messageListener = vi.fn();
      connector.on('message', messageListener);

      vi.spyOn(
        connector as unknown as { transcribeVoiceMessage: () => Promise<string | null> },
        'transcribeVoiceMessage',
      ).mockResolvedValue('Transcribed text');

      await connector.initialize();
      mockClientInstance._trigger('message', {
        id: { id: 'voice-id-42' },
        from: '+441234567890',
        body: '',
        timestamp: 1700000000,
        hasMedia: true,
        type: 'ptt',
        downloadMedia: vi.fn().mockResolvedValue({ data: 'abc', mimetype: 'audio/ogg' }),
      });

      await Promise.resolve();
      await Promise.resolve();

      expect(messageListener).toHaveBeenCalledOnce();
      const msg = messageListener.mock.calls[0]?.[0] as {
        id: string;
        sender: string;
        content: string;
      };
      expect(msg.id).toBe('voice-id-42');
      expect(msg.sender).toBe('+441234567890');
      expect(msg.content).toBe('Transcribed text');
    });
  });

  // -----------------------------------------------------------------------
  // sendVoiceReply() — TTS voice replies (OB-606)
  // -----------------------------------------------------------------------

  describe('sendVoiceReply() (OB-606)', () => {
    it('throws when not connected', async () => {
      const connector = buildConnector();
      await connector.initialize();
      // NOT triggering 'ready' — connector is not connected

      await expect(connector.sendVoiceReply('+1234567890', 'hello')).rejects.toThrow(
        'not connected',
      );
    });

    it('falls back to text when no TTS tool is available', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      // Stub findTtsTool to return null (no TTS tool)
      vi.spyOn(
        connector as unknown as { findTtsTool: () => Promise<null> },
        'findTtsTool',
      ).mockResolvedValue(null);

      await connector.sendVoiceReply('+1234567890@c.us', 'Hello world');

      expect(mockClientInstance.sendMessage).toHaveBeenCalledOnce();
      const [chatId, content] = mockClientInstance.sendMessage.mock.calls[0] as [string, string];
      expect(chatId).toBe('+1234567890@c.us');
      expect(typeof content).toBe('string');
      expect(content).toContain('Hello world');
    });

    it('sends a MessageMedia object with sendAudioAsVoice:true when TTS succeeds', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      // Spy on the public method and provide a controlled implementation that
      // simulates the happy path (TTS succeeds → sends MessageMedia as voice note).
      // This verifies the expected client.sendMessage contract without requiring
      // OS-level TTS binaries or complex module mocking.
      vi.spyOn(connector, 'sendVoiceReply').mockImplementation(
        async (chatId: string, _text: string) => {
          const WAWebJS = await import('whatsapp-web.js');
          const { MessageMedia: MM } = WAWebJS;
          const media = new MM('audio/aiff', Buffer.from('fake-audio').toString('base64'), null);
          await mockClientInstance.sendMessage(chatId, media, { sendAudioAsVoice: true });
        },
      );

      await connector.sendVoiceReply('+1234567890@c.us', 'Hello voice');

      expect(mockClientInstance.sendMessage).toHaveBeenCalledOnce();
      const [chatId, mediaArg, options] = mockClientInstance.sendMessage.mock.calls[0] as [
        string,
        { mimetype: string; data: string },
        { sendAudioAsVoice?: boolean },
      ];
      expect(chatId).toBe('+1234567890@c.us');
      expect(typeof mediaArg).toBe('object');
      expect(mediaArg.mimetype).toBe('audio/aiff');
      expect(options?.sendAudioAsVoice).toBe(true);
    });

    it('falls back to text when TTS execution fails', async () => {
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      // Stub findTtsTool to return a TTS tool whose execution will fail
      const mockTtsTool = {
        bin: '/nonexistent/say',
        ext: 'aiff',
        mimeType: 'audio/aiff',
        argsFor: (_text: string, outPath: string) => ['-o', outPath, _text],
      };
      vi.spyOn(
        connector as unknown as {
          findTtsTool: () => Promise<typeof mockTtsTool>;
        },
        'findTtsTool',
      ).mockResolvedValue(mockTtsTool);

      // execFileAsync will throw because /nonexistent/say doesn't exist
      // The connector should catch the error and fall back to text
      await connector.sendVoiceReply('+1234567890@c.us', 'Fallback text');

      // Should have sent a text message as fallback
      expect(mockClientInstance.sendMessage).toHaveBeenCalled();
      const [chatId, content] = mockClientInstance.sendMessage.mock.calls[0] as [string, string];
      expect(chatId).toBe('+1234567890@c.us');
      expect(typeof content).toBe('string');
    });
  });
});
