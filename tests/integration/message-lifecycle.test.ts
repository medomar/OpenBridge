/**
 * Integration tests for the full message lifecycle:
 *  - DLQ → error response delivery (OB-1667)
 *
 * Uses a mock 'telegram'-named connector and a mock provider to avoid real
 * network or CLI calls.  Tests cover the complete path from provider failure
 * through queue retry exhaustion to DLQ handling and user-facing error
 * delivery.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Bridge } from '../../src/core/bridge.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { AppConfig } from '../../src/types/config.js';
import type { Connector, ConnectorEvents } from '../../src/types/connector.js';
import type { InboundMessage, OutboundMessage, ProgressEvent } from '../../src/types/message.js';
import type { DeadLetterItem } from '../../src/core/queue.js';

// ---------------------------------------------------------------------------
// Named mock connector — simulates a 'telegram'-sourced channel
// ---------------------------------------------------------------------------

class TelegramMockConnector implements Connector {
  readonly name = 'telegram';
  readonly sentMessages: OutboundMessage[] = [];
  private connected = false;
  private readonly listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  async initialize(): Promise<void> {
    this.connected = true;
    this.emit('ready');
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {}

  async sendProgress(_event: ProgressEvent, _chatId: string): Promise<void> {}

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    (this.listeners[event] as ((...args: unknown[]) => void)[]).push(
      listener as (...args: unknown[]) => void,
    );
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  simulateMessage(...args: unknown[]): void {
    this.emit('message', ...args);
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners[event];
    if (handlers) {
      for (const handler of handlers) handler(...args);
    }
  }
}

// ---------------------------------------------------------------------------
// Config fixture
// ---------------------------------------------------------------------------

function baseConfig(): AppConfig {
  return {
    defaultProvider: 'mock',
    connectors: [{ type: 'telegram', enabled: true, options: {} }],
    providers: [{ type: 'mock', enabled: true, options: {} }],
    auth: {
      whitelist: ['+1234567890'],
      prefix: '/ai',
      rateLimit: { enabled: false, windowMs: 60_000, maxMessages: 5 },
    },
    // maxRetries: 0 → message goes straight to DLQ on first failure
    queue: { maxRetries: 0, retryDelayMs: 1 },
    audit: { enabled: false, logPath: '/tmp/test-audit.log' },
    logLevel: 'info',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestContext {
  bridge: Bridge;
  connector: TelegramMockConnector;
  provider: MockProvider;
}

function buildBridge(configOverride?: Partial<AppConfig>): TestContext {
  const config = { ...baseConfig(), ...configOverride };
  const connector = new TelegramMockConnector();
  const provider = new MockProvider();
  const bridge = new Bridge(config);
  bridge.getRegistry().registerConnector('telegram', () => connector);
  bridge.getRegistry().registerProvider('mock', () => provider);
  return { bridge, connector, provider };
}

/** Access internal Bridge fields for assertion purposes. */
function internalBridge(bridge: Bridge): {
  queue: { deadLetters: ReadonlyArray<DeadLetterItem>; drain(): Promise<void> };
  auditLogger: { logError: (messageId: string, error: string) => Promise<void> };
} {
  return bridge as unknown as {
    queue: { deadLetters: ReadonlyArray<DeadLetterItem>; drain(): Promise<void> };
    auditLogger: { logError: (messageId: string, error: string) => Promise<void> };
  };
}

// ---------------------------------------------------------------------------
// DLQ error response flow (OB-1667)
// ---------------------------------------------------------------------------

describe('DLQ error response flow (OB-1667)', () => {
  let ctx: TestContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = buildBridge();
  });

  afterEach(async () => {
    try {
      await ctx.bridge.stop();
    } catch {
      // ignore — bridge may not have started
    }
  });

  it('sends error response to the connector when a message reaches the DLQ', async () => {
    ctx.provider.processMessage = vi.fn().mockRejectedValue(new Error('provider exploded'));

    await ctx.bridge.start();

    ctx.connector.simulateMessage({
      id: 'msg-dlq-1',
      source: 'telegram',
      sender: '+1234567890',
      rawContent: '/ai do something',
      content: 'do something',
      timestamp: new Date(),
    });

    // Allow the async queue to process and trigger the DLQ callback
    await new Promise((r) => setTimeout(r, 100));

    // The user must receive the DLQ error response
    const errorMsg = ctx.connector.sentMessages.find((m) =>
      m.content.includes("Sorry, I wasn't able to complete"),
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg?.recipient).toBe('+1234567890');
  });

  it('records the failed message in the DLQ', async () => {
    ctx.provider.processMessage = vi.fn().mockRejectedValue(new Error('persistent failure'));

    await ctx.bridge.start();

    ctx.connector.simulateMessage({
      id: 'msg-dlq-2',
      source: 'telegram',
      sender: '+1234567890',
      rawContent: '/ai run task',
      content: 'run task',
      timestamp: new Date(),
    });

    await new Promise((r) => setTimeout(r, 100));

    const dlqItems = internalBridge(ctx.bridge).queue.deadLetters;
    expect(dlqItems).toHaveLength(1);
    expect(dlqItems[0]!.message.id).toBe('msg-dlq-2');
    expect(dlqItems[0]!.error).toContain('persistent failure');
  });

  it('records an error event in the audit log', async () => {
    ctx.provider.processMessage = vi.fn().mockRejectedValue(new Error('audit test error'));

    // Spy before start so all calls are captured
    const logErrorSpy = vi.spyOn(internalBridge(ctx.bridge).auditLogger, 'logError');

    await ctx.bridge.start();

    ctx.connector.simulateMessage({
      id: 'msg-dlq-3',
      source: 'telegram',
      sender: '+1234567890',
      rawContent: '/ai audit check',
      content: 'audit check',
      timestamp: new Date(),
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(logErrorSpy).toHaveBeenCalledWith(
      'msg-dlq-3',
      expect.stringContaining('audit test error'),
    );
  });

  it('does not propagate when DLQ error response delivery fails', async () => {
    ctx.provider.processMessage = vi.fn().mockRejectedValue(new Error('always fails'));

    // Make sendMessage throw only for the DLQ error response to simulate delivery failure
    vi.spyOn(ctx.connector, 'sendMessage').mockImplementation(async (msg: OutboundMessage) => {
      if (msg.content.includes("Sorry, I wasn't able to complete")) {
        throw new Error('connector send failed');
      }
      // Allow other messages (ack, etc.) through silently
    });

    await ctx.bridge.start();

    ctx.connector.simulateMessage({
      id: 'msg-dlq-4',
      source: 'telegram',
      sender: '+1234567890',
      rawContent: '/ai safe test',
      content: 'safe test',
      timestamp: new Date(),
    });

    // If an unhandled rejection propagated, Vitest would fail this test automatically.
    await new Promise((r) => setTimeout(r, 150));

    // Reached here without unhandled rejection — the DLQ callback is exception-safe.
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Processing queue flow (OB-1668)
// ---------------------------------------------------------------------------

describe('Processing queue flow (OB-1668)', () => {
  let ctx: TestContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = buildBridge();
  });

  afterEach(async () => {
    try {
      await ctx.bridge.stop();
    } catch {
      // ignore — bridge may not have started
    }
  });

  it('queues messages 2 and 3 while message 1 is processing, then drains all three in order', async () => {
    // Gate that blocks message 1's processing until we release it
    let releaseMsg1!: () => void;
    const msg1Gate = new Promise<void>((resolve) => {
      releaseMsg1 = resolve;
    });

    const processOrder: string[] = [];

    ctx.provider.processMessage = vi
      .fn()
      .mockImplementationOnce(async (msg: InboundMessage) => {
        processOrder.push(msg.id);
        await msg1Gate; // block until released
        return { content: `Response to ${msg.id}` };
      })
      .mockImplementation(async (msg: InboundMessage) => {
        processOrder.push(msg.id);
        return { content: `Response to ${msg.id}` };
      });

    await ctx.bridge.start();

    // (1) Send message 1 — starts processing immediately, blocked by msg1Gate
    ctx.connector.simulateMessage({
      id: 'msg-q-1',
      source: 'telegram',
      sender: '+1234567890',
      rawContent: '/ai task one',
      content: 'task one',
      timestamp: new Date(),
    });

    // Allow the async routing chain to reach provider.processMessage
    await new Promise((r) => setTimeout(r, 30));

    // Message 1 is now in-flight (blocked at msg1Gate)
    expect(processOrder).toHaveLength(1);
    expect(processOrder[0]).toBe('msg-q-1');

    // (2) Send messages 2 and 3 while message 1 is still processing — they must be queued
    ctx.connector.simulateMessage({
      id: 'msg-q-2',
      source: 'telegram',
      sender: '+1234567890',
      rawContent: '/ai task two',
      content: 'task two',
      timestamp: new Date(),
    });
    ctx.connector.simulateMessage({
      id: 'msg-q-3',
      source: 'telegram',
      sender: '+1234567890',
      rawContent: '/ai task three',
      content: 'task three',
      timestamp: new Date(),
    });

    // Provider must NOT have been called for msgs 2 or 3 yet (they are queued, not dropped)
    expect(processOrder).toHaveLength(1);

    // Register drain resolver before releasing so the resolver is in place
    const drainPromise = internalBridge(ctx.bridge).queue.drain();

    // (3) Release message 1 — messages 2 and 3 drain sequentially after it completes
    releaseMsg1();
    await drainPromise;

    // All three processed in FIFO arrival order
    expect(processOrder).toEqual(['msg-q-1', 'msg-q-2', 'msg-q-3']);

    // (4) All three messages received responses via the connector
    const responseMsgs = ctx.connector.sentMessages.filter((m) =>
      m.content.startsWith('Response to'),
    );
    expect(responseMsgs).toHaveLength(3);
    expect(responseMsgs.map((m) => m.content)).toEqual([
      'Response to msg-q-1',
      'Response to msg-q-2',
      'Response to msg-q-3',
    ]);
  });
});
