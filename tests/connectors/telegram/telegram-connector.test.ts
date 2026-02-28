import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramConnector } from '../../../src/connectors/telegram/telegram-connector.js';
import type { InboundMessage } from '../../../src/types/message.js';

// Minimal mock for grammY Bot
type TextHandler = (ctx: {
  message: { message_id: number; text?: string; date: number };
  from?: { id: number; username?: string; first_name: string };
  chat: { id: number; type: 'private' | 'group' | 'supergroup' | 'channel' };
}) => void;

interface MockBotInstance {
  handlers: Map<string, TextHandler[]>;
  startCalled: boolean;
  stopCalled: boolean;
  api: {
    sendMessage: ReturnType<typeof vi.fn>;
    sendChatAction: ReturnType<typeof vi.fn>;
    editMessageText: ReturnType<typeof vi.fn>;
    deleteMessage: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  /** Helper: simulate a text message arriving */
  simulateTextMessage: (ctx: Parameters<TextHandler>[0]) => void;
}

const createdBotInstances: MockBotInstance[] = [];

vi.mock('grammy', () => {
  return {
    Bot: vi.fn().mockImplementation(() => {
      const handlers = new Map<string, TextHandler[]>();
      const instance: MockBotInstance = {
        handlers,
        startCalled: false,
        stopCalled: false,
        api: {
          sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
          sendChatAction: vi.fn().mockResolvedValue({}),
          editMessageText: vi.fn().mockResolvedValue({}),
          deleteMessage: vi.fn().mockResolvedValue({}),
        },
        on: vi.fn((event: string, handler: TextHandler) => {
          if (!handlers.has(event)) handlers.set(event, []);
          handlers.get(event)!.push(handler);
        }),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        simulateTextMessage(ctx: Parameters<TextHandler>[0]) {
          for (const h of handlers.get('message:text') ?? []) {
            h(ctx);
          }
        },
      };
      createdBotInstances.push(instance);
      return instance;
    }),
  };
});

// Suppress logger output
vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function latestBot(): MockBotInstance {
  const bot = createdBotInstances[createdBotInstances.length - 1];
  if (!bot) throw new Error('No bot instance created');
  return bot;
}

describe('TelegramConnector', () => {
  let connector: TelegramConnector;

  beforeEach(() => {
    createdBotInstances.length = 0;
    connector = new TelegramConnector({ token: 'test-token:ABC' });
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  it('should have name "telegram"', () => {
    expect(connector.name).toBe('telegram');
  });

  it('should start disconnected', () => {
    expect(connector.isConnected()).toBe(false);
  });

  it('should throw when constructing with missing token', () => {
    expect(() => new TelegramConnector({})).toThrow();
  });

  it('should connect on initialize and emit ready', async () => {
    const readyHandler = vi.fn();
    connector.on('ready', readyHandler);

    await connector.initialize();

    expect(connector.isConnected()).toBe(true);
    expect(readyHandler).toHaveBeenCalledOnce();
  });

  it('should register message:text handler on initialize', async () => {
    await connector.initialize();
    const bot = latestBot();
    expect(bot.on).toHaveBeenCalledWith('message:text', expect.any(Function));
  });

  it('should start bot polling on initialize', async () => {
    await connector.initialize();
    const bot = latestBot();
    expect(bot.start).toHaveBeenCalledOnce();
  });

  it('should emit message events for DM text messages', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();

    latestBot().simulateTextMessage({
      message: { message_id: 42, text: 'hello world', date: 1_700_000_000 },
      from: { id: 12345, first_name: 'Alice' },
      chat: { id: 12345, type: 'private' },
    });

    expect(messageHandler).toHaveBeenCalledOnce();
    const msg = messageHandler.mock.calls[0]![0] as InboundMessage;
    expect(msg.source).toBe('telegram');
    expect(msg.id).toBe('telegram-42');
    expect(msg.sender).toBe('12345');
    expect(msg.rawContent).toBe('hello world');
    expect(msg.content).toBe('hello world');
    expect(msg.metadata).toEqual({ chatId: '12345' });
    expect(msg.timestamp).toEqual(new Date(1_700_000_000 * 1000));
  });

  it('should emit message events for group @mentions when botUsername is configured', async () => {
    connector = new TelegramConnector({
      token: 'test-token:ABC',
      botUsername: 'TestBot',
    });

    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();

    latestBot().simulateTextMessage({
      message: { message_id: 7, text: '@TestBot what is 2+2?', date: 1_700_000_001 },
      from: { id: 99, first_name: 'Bob' },
      chat: { id: -100123, type: 'group' },
    });

    expect(messageHandler).toHaveBeenCalledOnce();
    const msg = messageHandler.mock.calls[0]![0] as InboundMessage;
    expect(msg.content).toBe('@TestBot what is 2+2?');
    expect(msg.metadata).toEqual({ chatId: '-100123' });
  });

  it('should ignore group messages that do not @mention the bot', async () => {
    connector = new TelegramConnector({
      token: 'test-token:ABC',
      botUsername: 'TestBot',
    });

    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();

    latestBot().simulateTextMessage({
      message: { message_id: 8, text: 'hello group', date: 1_700_000_002 },
      from: { id: 99, first_name: 'Bob' },
      chat: { id: -100123, type: 'group' },
    });

    expect(messageHandler).not.toHaveBeenCalled();
  });

  it('should ignore group messages when botUsername is not configured', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();

    latestBot().simulateTextMessage({
      message: { message_id: 9, text: '@someone hello', date: 1_700_000_003 },
      from: { id: 99, first_name: 'Bob' },
      chat: { id: -100123, type: 'supergroup' },
    });

    expect(messageHandler).not.toHaveBeenCalled();
  });

  it('should use "unknown" as sender when ctx.from is missing', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();

    latestBot().simulateTextMessage({
      message: { message_id: 10, text: 'anonymous', date: 1_700_000_004 },
      from: undefined,
      chat: { id: 999, type: 'private' },
    });

    expect(messageHandler).toHaveBeenCalledOnce();
    const msg = messageHandler.mock.calls[0]![0] as InboundMessage;
    expect(msg.sender).toBe('unknown');
  });

  it('should send messages via bot.api.sendMessage', async () => {
    await connector.initialize();
    const bot = latestBot();

    await connector.sendMessage({
      target: 'telegram',
      recipient: '12345',
      content: 'Hello from AI',
    });

    expect(bot.api.sendMessage).toHaveBeenCalledWith('12345', 'Hello from AI');
  });

  it('should split long messages into multiple sends', async () => {
    await connector.initialize();
    const bot = latestBot();

    const longContent = 'Hello world. '.repeat(400); // ~5200 chars, over 4096 limit
    await connector.sendMessage({
      target: 'telegram',
      recipient: '12345',
      content: longContent,
    });

    // Should have been called multiple times (once per chunk)
    expect(bot.api.sendMessage.mock.calls.length).toBeGreaterThan(1);
    // Each chunk should be under 4096 chars
    for (const call of bot.api.sendMessage.mock.calls) {
      expect((call[1] as string).length).toBeLessThanOrEqual(4096);
    }
  });

  it('should send short messages as a single call', async () => {
    await connector.initialize();
    const bot = latestBot();

    await connector.sendMessage({
      target: 'telegram',
      recipient: '12345',
      content: 'Short message under limit',
    });

    expect(bot.api.sendMessage).toHaveBeenCalledOnce();
  });

  it('should throw when sending while disconnected', async () => {
    await expect(
      connector.sendMessage({
        target: 'telegram',
        recipient: '12345',
        content: 'test',
      }),
    ).rejects.toThrow('Telegram connector is not connected');
  });

  it('should send typing indicator via bot.api.sendChatAction', async () => {
    await connector.initialize();
    const bot = latestBot();

    await connector.sendTypingIndicator('12345');

    expect(bot.api.sendChatAction).toHaveBeenCalledWith('12345', 'typing');
  });

  it('should silently skip typing indicator when disconnected', async () => {
    // No initialize — connector not connected
    await expect(connector.sendTypingIndicator('12345')).resolves.toBeUndefined();
  });

  it('should stop bot and mark disconnected on shutdown', async () => {
    await connector.initialize();
    expect(connector.isConnected()).toBe(true);
    const bot = latestBot();

    await connector.shutdown();

    expect(bot.stop).toHaveBeenCalledOnce();
    expect(connector.isConnected()).toBe(false);
  });

  it('should emit error and disconnected when polling fails', async () => {
    const errorHandler = vi.fn();
    const disconnectedHandler = vi.fn();
    connector.on('error', errorHandler);
    connector.on('disconnected', disconnectedHandler);

    await connector.initialize();
    const bot = latestBot();

    // Simulate polling error by rejecting the start() promise
    const pollingError = new Error('network failure');
    // Manually invoke the .catch handler that was registered on bot.start()
    // We need to trigger it — get the rejection handler from the mock
    const startCall = bot.start.mock.results[0];
    // Override: make the bot.start reject then trigger
    bot.start.mockRejectedValueOnce(pollingError);

    // Re-initialize to get the error path triggered
    createdBotInstances.length = 0;
    connector = new TelegramConnector({ token: 'test-token:ABC' });
    connector.on('error', errorHandler);
    connector.on('disconnected', disconnectedHandler);

    // Mock start to reject immediately
    vi.mocked((await import('grammy')).Bot).mockImplementationOnce(() => {
      const handlers = new Map<string, TextHandler[]>();
      return {
        handlers,
        on: vi.fn((event: string, handler: TextHandler) => {
          if (!handlers.has(event)) handlers.set(event, []);
          handlers.get(event)!.push(handler);
        }),
        start: vi.fn().mockRejectedValue(pollingError),
        stop: vi.fn().mockResolvedValue(undefined),
        api: {
          sendMessage: vi.fn(),
          sendChatAction: vi.fn(),
        },
      };
    });

    await connector.initialize();

    // Wait a microtask for the .catch to fire
    await new Promise((r) => setTimeout(r, 0));

    expect(errorHandler).toHaveBeenCalledWith(pollingError);
    expect(disconnectedHandler).toHaveBeenCalledWith('network failure');

    // Mark as already shut down to avoid afterEach issue
    // (connector.isConnected() is now false)
    void startCall;
  });

  it('should accept optional botUsername config', () => {
    const c = new TelegramConnector({ token: 'tok', botUsername: 'MyBot' });
    expect(c.name).toBe('telegram');
  });

  describe('sendProgress()', () => {
    it('should send the first progress event as a new message', async () => {
      await connector.initialize();
      const bot = latestBot();
      bot.api.sendMessage.mockResolvedValueOnce({ message_id: 42 });

      await connector.sendProgress({ type: 'classifying' }, '12345');

      expect(bot.api.sendMessage).toHaveBeenCalledWith('12345', '🔍 Analyzing request...');
    });

    it('should edit the existing message on subsequent progress events', async () => {
      await connector.initialize();
      const bot = latestBot();
      bot.api.sendMessage.mockResolvedValueOnce({ message_id: 99 });

      await connector.sendProgress({ type: 'classifying' }, '12345');
      await connector.sendProgress({ type: 'planning' }, '12345');

      expect(bot.api.sendMessage).toHaveBeenCalledOnce();
      expect(bot.api.editMessageText).toHaveBeenCalledWith('12345', 99, '📋 Planning subtasks...');
    });

    it('should delete the progress message on complete', async () => {
      await connector.initialize();
      const bot = latestBot();
      bot.api.sendMessage.mockResolvedValueOnce({ message_id: 55 });

      await connector.sendProgress({ type: 'synthesizing' }, '12345');
      await connector.sendProgress({ type: 'complete' }, '12345');

      expect(bot.api.deleteMessage).toHaveBeenCalledWith('12345', 55);
    });

    it('should silently skip complete when no progress message was sent', async () => {
      await connector.initialize();
      const bot = latestBot();

      await connector.sendProgress({ type: 'complete' }, '12345');

      expect(bot.api.deleteMessage).not.toHaveBeenCalled();
    });

    it('should silently skip when disconnected', async () => {
      await expect(
        connector.sendProgress({ type: 'classifying' }, '12345'),
      ).resolves.toBeUndefined();
    });

    it('should not throw when API call fails', async () => {
      await connector.initialize();
      const bot = latestBot();
      bot.api.sendMessage.mockRejectedValueOnce(new Error('API error'));

      await expect(
        connector.sendProgress({ type: 'classifying' }, '12345'),
      ).resolves.toBeUndefined();
    });
  });
});
