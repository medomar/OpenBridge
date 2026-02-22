/**
 * Integration tests for Telegram connector (OB-323).
 *
 * Verifies the full message flow:
 *   grammY text message → TelegramConnector emits → Bridge (auth / queue / router) →
 *   MockProvider processes → bot.api.sendMessage called with response
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramConnector } from '../../../src/connectors/telegram/telegram-connector.js';
import { Bridge } from '../../../src/core/bridge.js';
import { MockProvider } from '../../helpers/mock-provider.js';
import type { AppConfig } from '../../../src/types/config.js';

// ---------------------------------------------------------------------------
// Mock: grammY Bot
// ---------------------------------------------------------------------------

type TextHandler = (ctx: {
  message: { message_id: number; text?: string; date: number };
  from?: { id: number; username?: string; first_name: string };
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
}) => void;

interface MockBotInstance {
  api: {
    sendMessage: ReturnType<typeof vi.fn>;
    sendChatAction: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  simulateTextMessage(ctx: Parameters<TextHandler>[0]): void;
}

const createdBotInstances: MockBotInstance[] = [];

vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(() => {
    const handlers = new Map<string, TextHandler[]>();
    const instance: MockBotInstance = {
      api: {
        sendMessage: vi.fn().mockResolvedValue({}),
        sendChatAction: vi.fn().mockResolvedValue({}),
      },
      on: vi.fn((event: string, handler: TextHandler) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(handler);
      }),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      simulateTextMessage(ctx: Parameters<TextHandler>[0]) {
        for (const h of handlers.get('message:text') ?? []) h(ctx);
      },
    };
    createdBotInstances.push(instance);
    return instance;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function latestBot(): MockBotInstance {
  const bot = createdBotInstances[createdBotInstances.length - 1];
  if (!bot) throw new Error('No bot instance created');
  return bot;
}

function baseConfig(): AppConfig {
  return {
    defaultProvider: 'mock',
    connectors: [{ type: 'telegram', enabled: true, options: { token: 'test-token:ABC' } }],
    providers: [{ type: 'mock', enabled: true, options: {} }],
    auth: {
      whitelist: ['12345'],
      prefix: '/ai',
      rateLimit: { enabled: false, windowMs: 60000, maxMessages: 5 },
    },
    queue: { maxRetries: 0, retryDelayMs: 1 },
    audit: { enabled: false, logPath: 'audit.log' },
    logLevel: 'info',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Telegram connector integration (OB-323)', () => {
  let connector: TelegramConnector;
  let provider: MockProvider;
  let bridge: Bridge;

  beforeEach(() => {
    createdBotInstances.length = 0;
    vi.clearAllMocks();
    connector = new TelegramConnector({ token: 'test-token:ABC' });
    provider = new MockProvider();
    bridge = new Bridge(baseConfig());
    bridge.getRegistry().registerConnector('telegram', () => connector);
    bridge.getRegistry().registerProvider('mock', () => provider);
  });

  afterEach(async () => {
    await bridge.stop().catch(() => {});
  });

  it('routes a Telegram DM through the bridge and replies via bot.api.sendMessage', async () => {
    provider.setResponse({ content: 'Hello from AI' });

    await bridge.start();

    latestBot().simulateTextMessage({
      message: { message_id: 1, text: '/ai hello world', date: 1_700_000_000 },
      from: { id: 12345, first_name: 'Alice' },
      chat: { id: 12345, type: 'private' },
    });

    await new Promise((r) => setTimeout(r, 50));

    // Provider received the prefix-stripped content
    expect(provider.processedMessages).toHaveLength(1);
    expect(provider.processedMessages[0]?.content).toBe('hello world');

    // Response sent back via bot.api.sendMessage to the sender
    expect(latestBot().api.sendMessage).toHaveBeenCalledWith('12345', 'Hello from AI');
  });

  it('sends acknowledgment before the AI response', async () => {
    provider.setResponse({ content: 'AI reply' });

    await bridge.start();

    latestBot().simulateTextMessage({
      message: { message_id: 2, text: '/ai test', date: 1_700_000_001 },
      from: { id: 12345, first_name: 'Alice' },
      chat: { id: 12345, type: 'private' },
    });

    await new Promise((r) => setTimeout(r, 50));

    // First sendMessage call = ack; second = AI response
    expect(latestBot().api.sendMessage).toHaveBeenCalledTimes(2);
    expect(latestBot().api.sendMessage.mock.calls[0]![1]).toBe('Working on it...');
    expect(latestBot().api.sendMessage.mock.calls[1]![1]).toBe('AI reply');
  });

  it('ignores messages from non-whitelisted Telegram user IDs', async () => {
    await bridge.start();

    latestBot().simulateTextMessage({
      message: { message_id: 3, text: '/ai hello', date: 1_700_000_002 },
      from: { id: 99999, first_name: 'Stranger' }, // not in whitelist
      chat: { id: 99999, type: 'private' },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(provider.processedMessages).toHaveLength(0);
    expect(latestBot().api.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores messages without the /ai prefix', async () => {
    await bridge.start();

    latestBot().simulateTextMessage({
      message: { message_id: 4, text: 'just a regular message', date: 1_700_000_003 },
      from: { id: 12345, first_name: 'Alice' },
      chat: { id: 12345, type: 'private' },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(provider.processedMessages).toHaveLength(0);
    expect(latestBot().api.sendMessage).not.toHaveBeenCalled();
  });

  it('strips the /ai prefix before forwarding to the provider', async () => {
    provider.setResponse({ content: 'done' });

    await bridge.start();

    latestBot().simulateTextMessage({
      message: { message_id: 5, text: '/ai list files in src/', date: 1_700_000_004 },
      from: { id: 12345, first_name: 'Alice' },
      chat: { id: 12345, type: 'private' },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(provider.processedMessages[0]?.content).toBe('list files in src/');
  });

  it('routes a group @mention through the bridge when botUsername is configured', async () => {
    connector = new TelegramConnector({ token: 'test-token:ABC', botUsername: 'TestBot' });
    bridge = new Bridge(baseConfig());
    bridge.getRegistry().registerConnector('telegram', () => connector);
    bridge.getRegistry().registerProvider('mock', () => provider);
    provider.setResponse({ content: 'group reply' });

    await bridge.start();

    latestBot().simulateTextMessage({
      message: { message_id: 6, text: '/ai @TestBot what is 2+2?', date: 1_700_000_005 },
      from: { id: 12345, first_name: 'Alice' },
      chat: { id: -100123, type: 'group' },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(provider.processedMessages).toHaveLength(1);
    // Response is sent back to the sender ID (message.sender = '12345')
    expect(latestBot().api.sendMessage).toHaveBeenCalledWith('12345', 'group reply');
  });

  it('does not route group messages that lack a bot @mention', async () => {
    connector = new TelegramConnector({ token: 'test-token:ABC', botUsername: 'TestBot' });
    bridge = new Bridge(baseConfig());
    bridge.getRegistry().registerConnector('telegram', () => connector);
    bridge.getRegistry().registerProvider('mock', () => provider);

    await bridge.start();

    latestBot().simulateTextMessage({
      message: { message_id: 7, text: '/ai hello group', date: 1_700_000_006 },
      from: { id: 12345, first_name: 'Alice' },
      chat: { id: -100123, type: 'group' }, // group but no @TestBot mention
    });

    await new Promise((r) => setTimeout(r, 50));

    // TelegramConnector filters this out — bridge never sees it
    expect(provider.processedMessages).toHaveLength(0);
    expect(latestBot().api.sendMessage).not.toHaveBeenCalled();
  });

  it('allows all senders when the whitelist is empty', async () => {
    bridge = new Bridge({
      ...baseConfig(),
      auth: {
        whitelist: [],
        prefix: '/ai',
        rateLimit: { enabled: false, windowMs: 60000, maxMessages: 5 },
      },
    });
    bridge.getRegistry().registerConnector('telegram', () => connector);
    bridge.getRegistry().registerProvider('mock', () => provider);
    provider.setResponse({ content: 'ok' });

    await bridge.start();

    latestBot().simulateTextMessage({
      message: { message_id: 8, text: '/ai hi', date: 1_700_000_007 },
      from: { id: 99999, first_name: 'Anyone' }, // not in default whitelist
      chat: { id: 99999, type: 'private' },
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(provider.processedMessages).toHaveLength(1);
  });

  it('shuts down the bot on bridge.stop()', async () => {
    await bridge.start();

    expect(connector.isConnected()).toBe(true);

    await bridge.stop();

    expect(latestBot().stop).toHaveBeenCalledOnce();
    expect(connector.isConnected()).toBe(false);
  });
});
