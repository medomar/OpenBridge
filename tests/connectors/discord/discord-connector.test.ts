import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordConnector } from '../../../src/connectors/discord/discord-connector.js';
import type { InboundMessage } from '../../../src/types/message.js';

// ChannelType.DM = 1 (discord.js v14)
const CHANNEL_TYPE_DM = 1;
const CHANNEL_TYPE_GUILD_TEXT = 0;

interface MockDiscordMessage {
  id: string;
  content: string;
  author: { id: string; bot: boolean };
  channelId: string;
  channel: { type: number };
  createdTimestamp: number;
}

interface MockClientInstance {
  handlers: Map<string, ((...args: unknown[]) => void)[]>;
  loginToken: string | null;
  destroyed: boolean;
  channels: {
    fetch: ReturnType<typeof vi.fn>;
  };
  on: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  /** Simulate the ready event firing */
  simulateReady: () => void;
  /** Simulate a messageCreate event */
  simulateMessage: (msg: MockDiscordMessage) => void;
}

const createdClientInstances: MockClientInstance[] = [];

vi.mock('discord.js', () => {
  return {
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 512,
      MessageContent: 32768,
      DirectMessages: 4096,
    },
    Events: {
      ClientReady: 'ready',
      MessageCreate: 'messageCreate',
    },
    Client: vi.fn().mockImplementation(() => {
      const handlers = new Map<string, ((...args: unknown[]) => void)[]>();

      const mockMessage = {
        edit: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      };
      const mockChannel = {
        send: vi.fn().mockResolvedValue(mockMessage),
        isTextBased: vi.fn().mockReturnValue(true),
      };

      const instance: MockClientInstance = {
        handlers,
        loginToken: null,
        destroyed: false,
        channels: {
          fetch: vi.fn().mockResolvedValue(mockChannel),
        },
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers.has(event)) handlers.set(event, []);
          handlers.get(event)!.push(handler);
        }),
        login: vi.fn().mockImplementation((token: string) => {
          instance.loginToken = token;
          return Promise.resolve(token);
        }),
        destroy: vi.fn().mockImplementation(() => {
          instance.destroyed = true;
        }),
        simulateReady() {
          for (const h of handlers.get('ready') ?? []) {
            h();
          }
        },
        simulateMessage(msg: MockDiscordMessage) {
          for (const h of handlers.get('messageCreate') ?? []) {
            h(msg);
          }
        },
      };
      createdClientInstances.push(instance);
      return instance;
    }),
  };
});

vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

function latestClient(): MockClientInstance {
  const client = createdClientInstances[createdClientInstances.length - 1];
  if (!client) throw new Error('No client instance created');
  return client;
}

describe('DiscordConnector', () => {
  let connector: DiscordConnector;

  beforeEach(() => {
    createdClientInstances.length = 0;
    connector = new DiscordConnector({ token: 'Bot.test.token' });
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  it('should have name "discord"', () => {
    expect(connector.name).toBe('discord');
  });

  it('should start disconnected', () => {
    expect(connector.isConnected()).toBe(false);
  });

  it('should throw when constructing with missing token', () => {
    expect(() => new DiscordConnector({})).toThrow();
  });

  it('should create a Client and call login on initialize', async () => {
    await connector.initialize();
    const client = latestClient();

    expect(client.login).toHaveBeenCalledWith('Bot.test.token');
  });

  it('should emit ready after ClientReady event fires', async () => {
    const readyHandler = vi.fn();
    connector.on('ready', readyHandler);

    await connector.initialize();
    latestClient().simulateReady();

    expect(connector.isConnected()).toBe(true);
    expect(readyHandler).toHaveBeenCalledOnce();
  });

  it('should not be connected until ClientReady fires', async () => {
    await connector.initialize();

    // login called but ready event not yet fired
    expect(connector.isConnected()).toBe(false);
  });

  it('should emit message events for DM messages', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();
    latestClient().simulateReady();

    latestClient().simulateMessage({
      id: 'msg-001',
      content: 'hello there',
      author: { id: 'user-42', bot: false },
      channelId: 'chan-100',
      channel: { type: CHANNEL_TYPE_DM },
      createdTimestamp: 1_700_000_000_000,
    });

    expect(messageHandler).toHaveBeenCalledOnce();
    const msg = messageHandler.mock.calls[0]![0] as InboundMessage;
    expect(msg.source).toBe('discord');
    expect(msg.id).toBe('discord-msg-001');
    expect(msg.sender).toBe('user-42');
    expect(msg.rawContent).toBe('hello there');
    expect(msg.content).toBe('hello there');
    expect(msg.timestamp).toEqual(new Date(1_700_000_000_000));
    expect(msg.metadata).toEqual({ channelId: 'chan-100', isDM: true });
  });

  it('should emit message events for guild channel messages', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();
    latestClient().simulateReady();

    latestClient().simulateMessage({
      id: 'msg-002',
      content: 'deploy now',
      author: { id: 'user-99', bot: false },
      channelId: 'guild-chan-55',
      channel: { type: CHANNEL_TYPE_GUILD_TEXT },
      createdTimestamp: 1_700_000_001_000,
    });

    expect(messageHandler).toHaveBeenCalledOnce();
    const msg = messageHandler.mock.calls[0]![0] as InboundMessage;
    expect(msg.source).toBe('discord');
    expect(msg.sender).toBe('user-99');
    expect(msg.metadata).toEqual({ channelId: 'guild-chan-55', isDM: false });
  });

  it('should ignore messages from bots', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();
    latestClient().simulateReady();

    latestClient().simulateMessage({
      id: 'bot-msg-1',
      content: 'I am a bot',
      author: { id: 'bot-user', bot: true },
      channelId: 'chan-1',
      channel: { type: CHANNEL_TYPE_GUILD_TEXT },
      createdTimestamp: 1_700_000_002_000,
    });

    expect(messageHandler).not.toHaveBeenCalled();
  });

  it('should ignore messages with empty content', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();
    latestClient().simulateReady();

    latestClient().simulateMessage({
      id: 'empty-msg',
      content: '',
      author: { id: 'user-1', bot: false },
      channelId: 'chan-1',
      channel: { type: CHANNEL_TYPE_GUILD_TEXT },
      createdTimestamp: 1_700_000_003_000,
    });

    expect(messageHandler).not.toHaveBeenCalled();
  });

  it('should send messages via channels.fetch + channel.send', async () => {
    await connector.initialize();
    latestClient().simulateReady();

    await connector.sendMessage({
      target: 'discord',
      recipient: 'chan-777',
      content: 'Hello from AI',
    });

    const client = latestClient();
    expect(client.channels.fetch).toHaveBeenCalledWith('chan-777');
    const mockChannel = (await client.channels.fetch.mock.results[0]!.value) as {
      send: ReturnType<typeof vi.fn>;
    };
    expect(mockChannel.send).toHaveBeenCalledWith('Hello from AI');
  });

  it('should split long messages into multiple sends (2000 char limit)', async () => {
    await connector.initialize();
    latestClient().simulateReady();

    const longContent = 'Hello world. '.repeat(200); // ~2600 chars, over 2000 limit
    await connector.sendMessage({
      target: 'discord',
      recipient: 'chan-777',
      content: longContent,
    });

    const client = latestClient();
    const mockChannel = (await client.channels.fetch.mock.results[0]!.value) as {
      send: ReturnType<typeof vi.fn>;
    };

    // Should have been called multiple times (once per chunk)
    expect(mockChannel.send.mock.calls.length).toBeGreaterThan(1);
    // Each chunk should be under 2000 chars
    for (const call of mockChannel.send.mock.calls) {
      expect((call[0] as string).length).toBeLessThanOrEqual(2000);
    }
  });

  it('should throw when sending while disconnected', async () => {
    await expect(
      connector.sendMessage({
        target: 'discord',
        recipient: 'chan-1',
        content: 'test',
      }),
    ).rejects.toThrow('Discord connector is not connected');
  });

  it('should throw when channel is not found', async () => {
    await connector.initialize();
    latestClient().simulateReady();
    latestClient().channels.fetch.mockResolvedValueOnce(null);

    await expect(
      connector.sendMessage({
        target: 'discord',
        recipient: 'nonexistent-chan',
        content: 'test',
      }),
    ).rejects.toThrow('Discord channel not found: nonexistent-chan');
  });

  it('should silently skip typing indicator when disconnected', async () => {
    await expect(connector.sendTypingIndicator('chan-1')).resolves.toBeUndefined();
  });

  it('should call client.destroy and mark disconnected on shutdown', async () => {
    await connector.initialize();
    latestClient().simulateReady();
    expect(connector.isConnected()).toBe(true);
    const client = latestClient();

    await connector.shutdown();

    expect(client.destroy).toHaveBeenCalledOnce();
    expect(connector.isConnected()).toBe(false);
  });

  it('should emit error and disconnected when login fails', async () => {
    const errorHandler = vi.fn();
    const disconnectedHandler = vi.fn();
    connector.on('error', errorHandler);
    connector.on('disconnected', disconnectedHandler);

    const loginError = new Error('invalid token');

    // Create fresh connector with failing login
    createdClientInstances.length = 0;
    connector = new DiscordConnector({ token: 'bad-token' });
    connector.on('error', errorHandler);
    connector.on('disconnected', disconnectedHandler);

    vi.mocked((await import('discord.js')).Client).mockImplementationOnce(() => {
      const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
      return {
        handlers,
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
          if (!handlers.has(event)) handlers.set(event, []);
          handlers.get(event)!.push(handler);
        }),
        login: vi.fn().mockRejectedValue(loginError),
        destroy: vi.fn(),
        channels: { fetch: vi.fn() },
      };
    });

    await connector.initialize();
    // Wait for the rejected promise .catch to fire
    await new Promise((r) => setTimeout(r, 0));

    expect(errorHandler).toHaveBeenCalledWith(loginError);
    expect(disconnectedHandler).toHaveBeenCalledWith('invalid token');
  });

  it('should register both ready and messageCreate handlers on initialize', async () => {
    await connector.initialize();
    const client = latestClient();

    expect(client.on).toHaveBeenCalledWith('ready', expect.any(Function));
    expect(client.on).toHaveBeenCalledWith('messageCreate', expect.any(Function));
  });

  describe('sendProgress()', () => {
    it('should send the first progress event as a new message', async () => {
      await connector.initialize();
      latestClient().simulateReady();

      await connector.sendProgress({ type: 'classifying' }, 'chan-100');

      const client = latestClient();
      expect(client.channels.fetch).toHaveBeenCalledWith('chan-100');
      const channel = (await client.channels.fetch.mock.results[0]!.value) as {
        send: ReturnType<typeof vi.fn>;
      };
      expect(channel.send).toHaveBeenCalledWith('🔍 Analyzing request...');
    });

    it('should edit the existing message on subsequent events', async () => {
      await connector.initialize();
      latestClient().simulateReady();
      const client = latestClient();

      await connector.sendProgress({ type: 'classifying' }, 'chan-100');
      const channel = (await client.channels.fetch.mock.results[0]!.value) as {
        send: ReturnType<typeof vi.fn>;
      };
      const sentMsg = (await channel.send.mock.results[0]!.value) as {
        edit: ReturnType<typeof vi.fn>;
      };

      await connector.sendProgress({ type: 'planning' }, 'chan-100');

      // channels.fetch should only be called once (second event reuses stored message)
      expect(client.channels.fetch).toHaveBeenCalledOnce();
      expect(sentMsg.edit).toHaveBeenCalledWith('📋 Planning subtasks...');
    });

    it('should delete the message on complete', async () => {
      await connector.initialize();
      latestClient().simulateReady();
      const client = latestClient();

      await connector.sendProgress({ type: 'synthesizing' }, 'chan-100');
      const channel = (await client.channels.fetch.mock.results[0]!.value) as {
        send: ReturnType<typeof vi.fn>;
      };
      const sentMsg = (await channel.send.mock.results[0]!.value) as {
        delete: ReturnType<typeof vi.fn>;
      };

      await connector.sendProgress({ type: 'complete' }, 'chan-100');

      expect(sentMsg.delete).toHaveBeenCalledOnce();
    });

    it('should silently skip complete when no progress message was sent', async () => {
      await connector.initialize();
      latestClient().simulateReady();

      await expect(
        connector.sendProgress({ type: 'complete' }, 'chan-100'),
      ).resolves.toBeUndefined();
    });

    it('should silently skip when disconnected', async () => {
      await expect(
        connector.sendProgress({ type: 'classifying' }, 'chan-100'),
      ).resolves.toBeUndefined();
    });

    it('should not throw when channel fetch fails', async () => {
      await connector.initialize();
      latestClient().simulateReady();
      latestClient().channels.fetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        connector.sendProgress({ type: 'classifying' }, 'chan-bad'),
      ).resolves.toBeUndefined();
    });
  });
});
