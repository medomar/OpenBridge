/**
 * E2E Test Harness — Full WhatsApp Bridge Flow
 *
 * Tests the complete message path using a mock WhatsApp server:
 *   WhatsApp message → WhatsAppConnector → Bridge → Router → Provider → Bridge → WhatsAppConnector → WhatsApp response
 *
 * Unlike integration tests (which use MockConnector), these tests use the REAL
 * WhatsAppConnector with a mock WhatsApp server that simulates whatsapp-web.js.
 * This validates the full stack including WhatsApp message parsing, chunking,
 * typing indicators, and connection lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockWhatsAppServer,
  getWhatsAppMockModule,
  type MockWhatsAppServer,
} from '../helpers/mock-whatsapp-server.js';

// ---------------------------------------------------------------------------
// Mock whatsapp-web.js BEFORE importing any modules that use it
// ---------------------------------------------------------------------------

const waServer: MockWhatsAppServer = createMockWhatsAppServer();

vi.mock('whatsapp-web.js', () => getWhatsAppMockModule(waServer));

// ---------------------------------------------------------------------------
// Imports (after mock)
// ---------------------------------------------------------------------------

import { Bridge } from '../../src/core/bridge.js';
import { WhatsAppConnector } from '../../src/connectors/whatsapp/whatsapp-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { AppConfig } from '../../src/types/config.js';

// ---------------------------------------------------------------------------
// Config fixture — uses real WhatsApp connector + mock provider
// ---------------------------------------------------------------------------

function e2eConfig(overrides?: Partial<AppConfig>): AppConfig {
  return {
    defaultProvider: 'mock',
    connectors: [{ type: 'whatsapp', enabled: true, options: { reconnect: { enabled: false } } }],
    providers: [{ type: 'mock', enabled: true, options: {} }],
    auth: {
      whitelist: ['+212600000000'],
      prefix: '/ai',
      rateLimit: { enabled: false, windowMs: 60000, maxMessages: 100 },
    },
    queue: { maxRetries: 0, retryDelayMs: 1 },
    router: { progressIntervalMs: 999999 },
    audit: { enabled: false, logPath: 'audit.log' },
    health: { enabled: false, port: 0 },
    metrics: { enabled: false, port: 0 },
    logLevel: 'error',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for the async queue and event loop to process */
function waitForQueue(ms = 100): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// E2E Tests
// ---------------------------------------------------------------------------

describe('E2E: WhatsApp → Bridge → Provider → WhatsApp', () => {
  let bridge: Bridge;
  let provider: MockProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    waServer.reset();
    provider = new MockProvider();
  });

  afterEach(async () => {
    if (bridge) {
      await bridge.stop();
    }
  });

  async function startBridge(configOverrides?: Partial<AppConfig>): Promise<void> {
    const config = e2eConfig(configOverrides);
    bridge = new Bridge(config);
    bridge.getRegistry().registerConnector('whatsapp', (opts) => new WhatsAppConnector(opts));
    bridge.getRegistry().registerProvider('mock', () => provider);
    await bridge.start();
    waServer.triggerReady();
  }

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('delivers AI response back through WhatsApp for a valid command', async () => {
      provider.setResponse({ content: 'Here are the project files.' });
      await startBridge();

      waServer.injectMessage('msg-1', '+212600000000', '/ai list files');
      await waitForQueue();

      // Provider received the stripped message
      expect(provider.processedMessages).toHaveLength(1);
      expect(provider.processedMessages[0]?.content).toBe('list files');

      // WhatsApp server received ack + response
      expect(waServer.sentMessages.length).toBeGreaterThanOrEqual(2);
      expect(waServer.sentMessages[0]?.content).toBe('Working on it...');
      expect(waServer.sentMessages[waServer.sentMessages.length - 1]?.content).toBe(
        'Here are the project files.',
      );
    });

    it('sends response to the correct recipient', async () => {
      provider.setResponse({ content: 'done' });
      await startBridge();

      waServer.injectMessage('msg-2', '+212600000000', '/ai do something');
      await waitForQueue();

      for (const msg of waServer.sentMessages) {
        expect(msg.recipient).toBe('+212600000000');
      }
    });

    it('handles multiple sequential messages from the same user', async () => {
      let callCount = 0;
      provider.streamMessage = async function* (msg) {
        callCount++;
        yield `Response to: ${msg.content}`;
        return { content: `Response to: ${msg.content}` };
      };
      await startBridge();

      waServer.injectMessage('msg-a', '+212600000000', '/ai first command');
      waServer.injectMessage('msg-b', '+212600000000', '/ai second command');
      await waitForQueue(200);

      expect(callCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Auth & filtering
  // -------------------------------------------------------------------------

  describe('auth and filtering', () => {
    it('ignores messages from non-whitelisted senders', async () => {
      await startBridge();

      waServer.injectMessage('msg-3', '+999999999', '/ai hack the planet');
      await waitForQueue();

      expect(provider.processedMessages).toHaveLength(0);
      expect(waServer.sentMessages).toHaveLength(0);
    });

    it('ignores messages without the /ai prefix', async () => {
      await startBridge();

      waServer.injectMessage('msg-4', '+212600000000', 'just a normal chat message');
      await waitForQueue();

      expect(provider.processedMessages).toHaveLength(0);
      expect(waServer.sentMessages).toHaveLength(0);
    });

    it('allows all senders when whitelist is empty', async () => {
      provider.setResponse({ content: 'open sesame' });
      await startBridge({
        auth: {
          whitelist: [],
          prefix: '/ai',
          rateLimit: { enabled: false, windowMs: 60000, maxMessages: 100 },
        },
      });

      waServer.injectMessage('msg-5', '+000000000', '/ai hello');
      await waitForQueue();

      expect(provider.processedMessages).toHaveLength(1);
    });

    it('enforces rate limiting', async () => {
      provider.setResponse({ content: 'ok' });
      await startBridge({
        auth: {
          whitelist: ['+212600000000'],
          prefix: '/ai',
          rateLimit: { enabled: true, windowMs: 60000, maxMessages: 1 },
        },
      });

      waServer.injectMessage('m1', '+212600000000', '/ai first');
      waServer.injectMessage('m2', '+212600000000', '/ai second');
      await waitForQueue();

      // Only one message should reach the provider
      expect(provider.processedMessages).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // WhatsApp-specific features
  // -------------------------------------------------------------------------

  describe('WhatsApp-specific features', () => {
    it('splits long responses into multiple WhatsApp-safe chunks', async () => {
      const longResponse = 'x'.repeat(5000);
      provider.setResponse({ content: longResponse });
      await startBridge();

      waServer.injectMessage('msg-long', '+212600000000', '/ai generate long text');
      await waitForQueue();

      // Should have ack + multiple chunks
      const responseMessages = waServer.sentMessages.filter(
        (m) => m.content !== 'Working on it...',
      );
      expect(responseMessages.length).toBeGreaterThan(1);

      // Every chunk must be ≤ 4096 chars
      for (const msg of responseMessages) {
        expect(msg.content.length).toBeLessThanOrEqual(4096);
      }
    });

    it('sends typing indicator while processing', async () => {
      provider.setResponse({ content: 'done' });
      await startBridge();

      waServer.injectMessage('msg-typing', '+212600000000', '/ai do work');
      await waitForQueue();

      expect(waServer.typingIndicators.length).toBeGreaterThan(0);
    });

    it('parses WhatsApp message format correctly (id, sender, body, timestamp)', async () => {
      provider.setResponse({ content: 'parsed' });
      await startBridge();

      const ts = 1700000000;
      waServer.injectMessage('wa-msg-42', '+212600000000', '/ai check parsing', ts);
      await waitForQueue();

      const processed = provider.processedMessages[0];
      expect(processed).toBeDefined();
      expect(processed?.id).toBe('wa-msg-42');
      expect(processed?.sender).toBe('+212600000000');
      expect(processed?.source).toBe('whatsapp');
      expect(processed?.content).toBe('check parsing');
    });
  });

  // -------------------------------------------------------------------------
  // Streaming
  // -------------------------------------------------------------------------

  describe('streaming responses', () => {
    it('delivers streamed response via WhatsApp', async () => {
      provider.setStreamChunks(['chunk1', 'chunk2', 'chunk3']);
      provider.setResponse({ content: 'final streamed result' });
      await startBridge();

      waServer.injectMessage('msg-stream', '+212600000000', '/ai stream me');
      await waitForQueue();

      // Should have received the final streamed result
      const lastMessage = waServer.sentMessages[waServer.sentMessages.length - 1];
      expect(lastMessage?.content).toBe('final streamed result');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('handles provider errors gracefully without crashing the bridge', async () => {
      provider.streamMessage = async function* () {
        throw new Error('AI is down');
        yield 'unreachable';
        return { content: 'unreachable' };
      };
      await startBridge();

      waServer.injectMessage('msg-err', '+212600000000', '/ai break things');
      await waitForQueue();

      // Bridge should still be running — send another message
      provider.streamMessage = undefined;
      provider.setResponse({ content: 'recovered' });

      waServer.injectMessage('msg-ok', '+212600000000', '/ai try again');
      await waitForQueue();

      expect(provider.processedMessages).toHaveLength(1);
      expect(provider.processedMessages[0]?.content).toBe('try again');
    });
  });

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('bridge lifecycle', () => {
    it('bridge.stop() shuts down cleanly after E2E flow', async () => {
      provider.setResponse({ content: 'hello' });
      await startBridge();

      waServer.injectMessage('msg-life', '+212600000000', '/ai hello');
      await waitForQueue();

      // Stop should not throw
      await expect(bridge.stop()).resolves.toBeUndefined();
    });
  });
});
