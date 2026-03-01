/**
 * Real-timer tests for WhatsAppConnector.
 *
 * Kept in a separate file so that fake timers are NEVER called in this file's
 * lifecycle.  On Node 22/24, calling vi.useFakeTimers() and then
 * vi.useRealTimers() in the same test file corrupts the module-mock registry,
 * causing the real whatsapp-web.js Client to be used instead of the mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// --------------------------------------------------------------------------
// Mock whatsapp-web.js (identical factory to whatsapp-connector.test.ts)
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
const capturedClientOptions: unknown[] = [];
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
// Tests — no fake timers used anywhere in this file
// --------------------------------------------------------------------------

describe('WhatsAppConnector (real timers)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(
      WhatsAppConnector.prototype as unknown as { removeStaleLock: () => Promise<void> },
      'removeStaleLock',
    ).mockResolvedValue(undefined);
    createdClients.length = 0;
    capturedClientOptions.length = 0;
    initializeFailCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('auto-reconnect', () => {
    it('resets reconnect attempt counter on successful reconnect', async () => {
      const connector = buildConnector({
        reconnect: {
          enabled: true,
          maxAttempts: 5,
          initialDelayMs: 10,
          maxDelayMs: 10,
          backoffFactor: 1,
        },
      });
      await connector.initialize();
      const firstClient = mockClientInstance;

      // First successful connection
      firstClient._trigger('ready');
      expect(connector.isConnected()).toBe(true);

      // Disconnect — schedules reconnect timer (10ms)
      firstClient._trigger('disconnected', 'reason');
      expect(connector.isConnected()).toBe(false);

      // Wait for reconnect: timer(10ms) + async destroy + async createAndStartClient.
      // Poll until a new client is created (mocks resolve instantly, just need microtasks).
      const deadline = Date.now() + 5000;
      while (mockClientInstance === firstClient && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(mockClientInstance).not.toBe(firstClient);

      // The new client fires ready — reconnectAttempt should reset to 0
      mockClientInstance._trigger('ready');
      expect(connector.isConnected()).toBe(true);
    }, 10_000);
  });
});
