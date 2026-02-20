/**
 * Mock WhatsApp Server — simulates the whatsapp-web.js Client
 * for E2E testing without a real WhatsApp connection.
 *
 * Usage:
 *   1. Call `vi.mock('whatsapp-web.js', () => createWhatsAppMock(server))`
 *      before importing any module that uses whatsapp-web.js.
 *   2. Use `server.triggerReady()` to simulate a successful connection.
 *   3. Use `server.injectMessage(...)` to simulate an inbound WhatsApp message.
 *   4. Read `server.sentMessages` to inspect outbound messages.
 */

import type { Mock } from 'vitest';
import { vi } from 'vitest';

export interface SentMessage {
  recipient: string;
  content: string;
}

export interface MockWhatsAppServer {
  /** All outbound messages sent via the connector */
  readonly sentMessages: SentMessage[];
  /** All typing indicators sent via the connector */
  readonly typingIndicators: string[];
  /** Trigger the 'ready' event on the current client (simulates QR scan + auth) */
  triggerReady(): void;
  /** Trigger the 'qr' event with a QR code string */
  triggerQr(qr: string): void;
  /** Inject a simulated inbound WhatsApp message */
  injectMessage(id: string, from: string, body: string, timestamp?: number): void;
  /** Trigger a disconnection event */
  triggerDisconnect(reason: string): void;
  /** Get the number of client instances created (useful for reconnect tests) */
  readonly clientCount: number;
  /** Reset all state between tests */
  reset(): void;
}

interface MockClientInstance {
  on: Mock;
  initialize: Mock;
  sendMessage: Mock;
  getChatById: Mock;
  destroy: Mock;
  _handlers: Map<string, ((...args: unknown[]) => void)[]>;
  _trigger(event: string, ...args: unknown[]): void;
}

export function createMockWhatsAppServer(): MockWhatsAppServer {
  const sentMessages: SentMessage[] = [];
  const typingIndicators: string[] = [];
  const clients: MockClientInstance[] = [];

  function latestClient(): MockClientInstance {
    const client = clients[clients.length - 1];
    if (!client) {
      throw new Error('MockWhatsAppServer: no client instance created yet');
    }
    return client;
  }

  const server: MockWhatsAppServer = {
    get sentMessages() {
      return sentMessages;
    },
    get typingIndicators() {
      return typingIndicators;
    },
    get clientCount() {
      return clients.length;
    },
    triggerReady() {
      latestClient()._trigger('ready');
    },
    triggerQr(qr: string) {
      latestClient()._trigger('qr', qr);
    },
    injectMessage(id: string, from: string, body: string, timestamp?: number) {
      latestClient()._trigger('message', {
        id: { id },
        from,
        body,
        timestamp: timestamp ?? Math.floor(Date.now() / 1000),
      });
    },
    triggerDisconnect(reason: string) {
      latestClient()._trigger('disconnected', reason);
    },
    reset() {
      sentMessages.length = 0;
      typingIndicators.length = 0;
      clients.length = 0;
    },
  };

  // Factory for creating mock Client instances
  function createMockClient(): MockClientInstance {
    const handlers = new Map<string, ((...args: unknown[]) => void)[]>();

    const instance: MockClientInstance = {
      _handlers: handlers,
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!handlers.has(event)) {
          handlers.set(event, []);
        }
        handlers.get(event)!.push(handler);
      }),
      initialize: vi.fn(async () => {}),
      sendMessage: vi.fn(async (_to: string, _content: string) => {
        sentMessages.push({ recipient: _to, content: _content });
      }),
      getChatById: vi.fn(async () => ({
        sendStateTyping: vi.fn(async () => {
          typingIndicators.push('typing');
        }),
      })),
      destroy: vi.fn(async () => {}),
      _trigger(event: string, ...args: unknown[]) {
        const eventHandlers = handlers.get(event) ?? [];
        for (const h of eventHandlers) {
          h(...args);
        }
      },
    };

    clients.push(instance);
    return instance;
  }

  // Attach the factory to the server object for use in vi.mock
  (server as unknown as { _createMockClient: () => MockClientInstance })._createMockClient =
    createMockClient;

  return server;
}

/**
 * Create the vi.mock return value for 'whatsapp-web.js'.
 * Call this inside vi.mock('whatsapp-web.js', () => getWhatsAppMockModule(server))
 */
export function getWhatsAppMockModule(server: MockWhatsAppServer) {
  const createClient = (server as unknown as { _createMockClient: () => MockClientInstance })
    ._createMockClient;

  class LocalAuth {}

  const ClientConstructor = vi.fn(function () {
    return createClient();
  });

  return {
    Client: ClientConstructor,
    LocalAuth,
    // whatsapp-web.js is CJS — in ESM dynamic import, LocalAuth lives on .default
    default: { Client: ClientConstructor, LocalAuth },
  };
}
