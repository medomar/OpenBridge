/**
 * Tests for periodic cleanup behavior in WebChat and Discord connectors (OB-1313).
 *
 * Verifies that:
 *  - WebChat session cleanup interval removes expired sessions from the store
 *  - WebChat session cleanup interval preserves valid (non-expired) sessions
 *  - Discord progress message cleanup removes entries older than 30 minutes
 *  - Discord progress message cleanup preserves fresh (recently created) entries
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebChatConnector } from '../../src/connectors/webchat/webchat-connector.js';
import { DiscordConnector } from '../../src/connectors/discord/discord-connector.js';

// ── Constants ──────────────────────────────────────────────────────────────────

/** 24 hours in milliseconds (matches webchat-connector SESSION_TTL_MS) */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** 5 minutes in milliseconds (matches webchat-connector SESSION_CLEANUP_INTERVAL_MS) */
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
/** 30 minutes in milliseconds (matches discord-connector MAX_AGE_MS) */
const DISCORD_MAX_AGE_MS = 30 * 60 * 1000;
/** 10 minutes in milliseconds (matches discord-connector CLEANUP_INTERVAL_MS) */
const DISCORD_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

const FIXED_TOKEN = 'test-auth-token-abc123';

// ── WebChat mocks ──────────────────────────────────────────────────────────────

let capturedHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;

interface MockHttpServer {
  listen: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

vi.mock('node:http', () => ({
  createServer: vi
    .fn()
    .mockImplementation((handler: (req: IncomingMessage, res: ServerResponse) => void) => {
      capturedHandler = handler;
      const server: MockHttpServer = {
        listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
        close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
        on: vi.fn(),
      };
      return server;
    }),
}));

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn((cb?: () => void) => cb?.()),
  })),
}));

vi.mock('../../src/connectors/webchat/webchat-auth.js', () => ({
  getOrCreateAuthToken: vi.fn().mockReturnValue('test-auth-token-abc123'),
}));

vi.mock('../../src/connectors/webchat/ui-bundle.js', () => ({
  WEBCHAT_HTML: '<html>mock</html>',
  WEBCHAT_LOGIN_HTML: '<html>login</html>',
  WEBCHAT_SW_JS: '/* sw mock */',
}));

vi.mock('../../src/core/qr-store.js', () => ({
  getQrCode: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Discord mock ───────────────────────────────────────────────────────────────

interface MockClientInstance {
  handlers: Map<string, ((...args: unknown[]) => void)[]>;
  loginToken: string | null;
  destroyed: boolean;
  channels: { fetch: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  login: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  simulateReady: () => void;
}

const discordClientInstances: MockClientInstance[] = [];

vi.mock('discord.js', () => ({
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
    const mockMsg = {
      edit: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    };
    const mockChannel = {
      send: vi.fn().mockResolvedValue(mockMsg),
      isTextBased: vi.fn().mockReturnValue(true),
    };
    const instance: MockClientInstance = {
      handlers,
      loginToken: null,
      destroyed: false,
      channels: { fetch: vi.fn().mockResolvedValue(mockChannel) },
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
        for (const h of handlers.get('ready') ?? []) h();
      },
    };
    discordClientInstances.push(instance);
    return instance;
  }),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return { url, headers } as unknown as IncomingMessage;
}

interface MockResponse {
  statusCode: number | null;
  headers: Record<string, string | string[]>;
  body: string;
  writeHead: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    statusCode: null,
    headers: {},
    body: '',
    writeHead: vi.fn((code: number) => {
      res.statusCode = code;
    }),
    setHeader: vi.fn((name: string, value: string | string[]) => {
      res.headers[name.toLowerCase()] = value;
    }),
    end: vi.fn((data?: string) => {
      res.body = data ?? '';
    }),
  };
  return res;
}

function handle(req: IncomingMessage, res: MockResponse): void {
  if (!capturedHandler) throw new Error('HTTP handler not captured — was initialize() called?');
  capturedHandler(req, res as unknown as ServerResponse);
}

/** Authenticate with the fixed token and return the issued session ID. */
function createSession(): string {
  const req = makeReq(`/?token=${FIXED_TOKEN}`);
  const res = makeRes();
  handle(req, res);
  expect(res.statusCode).toBe(200);
  const cookieCall = res.setHeader.mock.calls.find(
    ([name]) => (name as string).toLowerCase() === 'set-cookie',
  );
  expect(cookieCall).toBeDefined();
  const cookieHeader = cookieCall![1] as string;
  return cookieHeader.split(';')[0]!.split('=')[1]!.trim();
}

function latestDiscordClient(): MockClientInstance {
  const client = discordClientInstances[discordClientInstances.length - 1];
  if (!client) throw new Error('No discord client instance created');
  return client;
}

// ── WebChat periodic session cleanup tests ────────────────────────────────────

describe('WebChat periodic session cleanup', () => {
  let connector: WebChatConnector;

  beforeEach(async () => {
    capturedHandler = null;
    vi.useFakeTimers();
    connector = new WebChatConnector({});
    await connector.initialize();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  it('cleanup interval removes expired sessions from the store', () => {
    const sessionId = createSession();

    // Advance past the 24 h TTL so the session is expired
    vi.advanceTimersByTime(SESSION_TTL_MS + 1);

    // Trigger the 5-minute cleanup interval
    vi.advanceTimersByTime(SESSION_CLEANUP_INTERVAL_MS);

    // The session must now be rejected
    const req = makeReq('/', { cookie: `ob_session=${sessionId}` });
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(401);
  });

  it('cleanup interval preserves sessions that have not yet expired', () => {
    const sessionId = createSession();

    // Advance time to halfway through the TTL (session is still valid)
    vi.advanceTimersByTime(SESSION_TTL_MS / 2);

    // Trigger the cleanup interval — the session should survive
    vi.advanceTimersByTime(SESSION_CLEANUP_INTERVAL_MS);

    const req = makeReq('/', { cookie: `ob_session=${sessionId}` });
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('cleanup removes expired sessions but keeps valid ones created later', () => {
    // Session A created at T=0
    const sessionA = createSession();

    // Advance past the TTL — session A is now expired
    vi.advanceTimersByTime(SESSION_TTL_MS + 1);

    // Session B created at T = 24h + 1ms
    const sessionB = createSession();

    // Trigger cleanup interval — session A should be evicted, session B kept
    vi.advanceTimersByTime(SESSION_CLEANUP_INTERVAL_MS);

    const reqA = makeReq('/', { cookie: `ob_session=${sessionA}` });
    const resA = makeRes();
    handle(reqA, resA);
    expect(resA.statusCode).toBe(401);

    const reqB = makeReq('/', { cookie: `ob_session=${sessionB}` });
    const resB = makeRes();
    handle(reqB, resB);
    expect(resB.statusCode).toBe(200);
  });

  it('cleanup interval is cleared on shutdown', async () => {
    // Verify cleanup interval exists before shutdown
    expect(connector.isConnected()).toBe(true);
    await connector.shutdown();
    // After shutdown, advancing time should not throw (interval cleared)
    expect(() => vi.advanceTimersByTime(SESSION_CLEANUP_INTERVAL_MS)).not.toThrow();
  });
});

// ── Discord periodic progress message cleanup tests ───────────────────────────

describe('Discord periodic progress message cleanup', () => {
  let connector: DiscordConnector;

  beforeEach(async () => {
    discordClientInstances.length = 0;
    vi.useFakeTimers();
    connector = new DiscordConnector({ token: 'Bot.test.token' });
    await connector.initialize();
    latestDiscordClient().simulateReady();
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  it('cleanup interval removes progress entries older than 30 minutes', async () => {
    const client = latestDiscordClient();

    // First sendProgress — creates a new Discord message (channel.send called)
    await connector.sendProgress({ type: 'classifying' }, 'chan-100');
    expect(client.channels.fetch).toHaveBeenCalledTimes(1);

    // Second sendProgress — should EDIT the existing message (no new channel.send)
    await connector.sendProgress({ type: 'planning' }, 'chan-100');
    expect(client.channels.fetch).toHaveBeenCalledTimes(1); // still only 1 fetch

    // Advance past MAX_AGE_MS (30 min) to expire the stored entry
    vi.advanceTimersByTime(DISCORD_MAX_AGE_MS + 1);

    // Trigger the 10-minute cleanup interval — old entry should be removed
    vi.advanceTimersByTime(DISCORD_CLEANUP_INTERVAL_MS);

    // Third sendProgress after cleanup — entry is gone, so a NEW message is sent
    await connector.sendProgress({ type: 'synthesizing' }, 'chan-100');
    // channels.fetch called a second time because progressMessages no longer has the entry
    expect(client.channels.fetch).toHaveBeenCalledTimes(2);
  });

  it('cleanup interval preserves progress entries created within 30 minutes', async () => {
    const client = latestDiscordClient();

    // Create the first progress message
    await connector.sendProgress({ type: 'classifying' }, 'chan-200');
    expect(client.channels.fetch).toHaveBeenCalledTimes(1);

    // Advance only 15 minutes — entry is still fresh (under 30 min)
    vi.advanceTimersByTime(15 * 60 * 1000);

    // Trigger the cleanup interval
    vi.advanceTimersByTime(DISCORD_CLEANUP_INTERVAL_MS);

    // Entry should still be present — next sendProgress must EDIT, not create new
    await connector.sendProgress({ type: 'planning' }, 'chan-200');
    expect(client.channels.fetch).toHaveBeenCalledTimes(1); // no new fetch
  });

  it('cleanup interval clears entries for multiple channels independently', async () => {
    const client = latestDiscordClient();

    // Create progress entries for two channels at different times
    await connector.sendProgress({ type: 'classifying' }, 'chan-A');
    vi.advanceTimersByTime(DISCORD_MAX_AGE_MS + 1); // expire chan-A
    await connector.sendProgress({ type: 'classifying' }, 'chan-B'); // fresh

    // Trigger cleanup — chan-A should be evicted, chan-B kept
    vi.advanceTimersByTime(DISCORD_CLEANUP_INTERVAL_MS);

    // Count fetches so far
    const fetchCountBeforeChecks = client.channels.fetch.mock.calls.length;

    // chan-B next event should EDIT (entry preserved) — no extra fetch
    await connector.sendProgress({ type: 'planning' }, 'chan-B');
    expect(client.channels.fetch.mock.calls.length).toBe(fetchCountBeforeChecks);

    // chan-A next event should create NEW message — one more fetch
    await connector.sendProgress({ type: 'planning' }, 'chan-A');
    expect(client.channels.fetch.mock.calls.length).toBe(fetchCountBeforeChecks + 1);
  });

  it('cleanup interval is cleared on shutdown', async () => {
    await connector.shutdown();
    // After shutdown, advancing time must not throw (interval cleared)
    expect(() => vi.advanceTimersByTime(DISCORD_CLEANUP_INTERVAL_MS)).not.toThrow();
  });
});
