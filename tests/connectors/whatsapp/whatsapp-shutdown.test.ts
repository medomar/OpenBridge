import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';

// --------------------------------------------------------------------------
// Mock whatsapp-web.js (same factory as whatsapp-connector.test.ts)
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

  const ClientConstructor = vi.fn(function (this: MockClientInstance, _options: unknown) {
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

type ConnectorPrivate = {
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

function buildConnector(options: Record<string, unknown> = {}): WhatsAppConnector {
  return new WhatsAppConnector(options);
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('WhatsAppConnector — shutdown() clears reconnect timer', () => {
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

  it('sets reconnectTimer to null after shutdown() clears a pending timer', async () => {
    const connector = buildConnector({
      reconnect: { enabled: true, maxAttempts: 5, initialDelayMs: 5000 },
    });
    await connector.initialize();
    mockClientInstance._trigger('ready');

    // Trigger disconnect — schedules a reconnect timer (5000ms delay)
    mockClientInstance._trigger('disconnected', 'server closed');

    // Verify timer was scheduled (non-null before shutdown)
    const priv = connector as unknown as ConnectorPrivate;
    expect(priv.reconnectTimer).not.toBeNull();

    // Shutdown while timer is still pending
    await connector.shutdown();

    // After shutdown, reconnectTimer must be null
    expect(priv.reconnectTimer).toBeNull();
  });

  it('does not attempt reconnection after shutdown() clears a pending timer', async () => {
    const connector = buildConnector({
      reconnect: { enabled: true, maxAttempts: 5, initialDelayMs: 100 },
    });
    await connector.initialize();
    const firstClient = mockClientInstance;
    mockClientInstance._trigger('ready');

    // Trigger disconnect — schedules a reconnect timer
    firstClient._trigger('disconnected', 'server closed');
    const initCallsAfterDisconnect = firstClient.initialize.mock.calls.length;

    // Shutdown before the timer fires
    await connector.shutdown();

    // Advance timers well past the reconnect delay
    await vi.advanceTimersByTimeAsync(10_000);

    // No new clients should have been created and no additional initialize calls
    expect(createdClients.length).toBe(1);
    expect(firstClient.initialize.mock.calls.length).toBe(initCallsAfterDisconnect);
  });

  it('reconnectTimer is null immediately when shutdown() is called without a pending timer', async () => {
    const connector = buildConnector({
      reconnect: { enabled: true, maxAttempts: 5, initialDelayMs: 5000 },
    });
    await connector.initialize();
    mockClientInstance._trigger('ready');

    // No disconnect triggered — no timer scheduled
    const priv = connector as unknown as ConnectorPrivate;
    expect(priv.reconnectTimer).toBeNull();

    await connector.shutdown();

    // Still null after shutdown
    expect(priv.reconnectTimer).toBeNull();
  });
});
