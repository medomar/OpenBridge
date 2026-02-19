import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

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

vi.mock('whatsapp-web.js', () => {
  class MockClient {
    private handlers: Map<string, ((...args: unknown[]) => void)[]> = new Map();

    on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (!this.handlers.has(event)) {
        this.handlers.set(event, []);
      }
      this.handlers.get(event)!.push(handler);
    });

    initialize = vi.fn(async () => {});
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

  return {
    Client: vi.fn(function (this: MockClientInstance) {
      const instance = new MockClient() as unknown as MockClientInstance;
      createdClients.push(instance);
      mockClientInstance = instance;
      return instance;
    }),
    LocalAuth,
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
    createdClients.length = 0;
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
      // Use 0ms delay so the reconnect fires immediately when timers advance
      const connector = buildConnector({
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          initialDelayMs: 0,
          maxDelayMs: 0,
          backoffFactor: 1,
        },
      });
      await connector.initialize();

      // First successful connection
      mockClientInstance._trigger('ready');
      expect(connector.isConnected()).toBe(true);

      // Disconnect — schedules reconnect with 0ms delay
      mockClientInstance._trigger('disconnected', 'reason');

      // Advance timers to fire the 0ms reconnect setTimeout, then flush promises
      await vi.advanceTimersByTimeAsync(1);

      // The new client fires ready — reconnectAttempt should reset to 0
      mockClientInstance._trigger('ready');
      expect(connector.isConnected()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // sendTypingIndicator()
  // -----------------------------------------------------------------------

  describe('sendTypingIndicator()', () => {
    it('calls getChatById and sendStateTyping when connected', async () => {
      vi.useRealTimers();
      const connector = buildConnector();
      await connector.initialize();
      mockClientInstance._trigger('ready');

      const mockChat: MockChat = { sendStateTyping: vi.fn(async () => {}) };
      mockClientInstance.getChatById.mockResolvedValue(mockChat);

      await connector.sendTypingIndicator('+1234567890');

      expect(mockClientInstance.getChatById).toHaveBeenCalledWith('+1234567890');
      expect(mockChat.sendStateTyping).toHaveBeenCalledOnce();
    });

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
});
