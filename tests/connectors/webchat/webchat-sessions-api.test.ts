/**
 * Unit tests for the WebChat connector /api/sessions REST endpoints (OB-1038).
 *
 * Covers:
 *   GET /api/sessions        → list sessions (paginates, 503 without memory)
 *   GET /api/sessions/:id    → single session transcript (503 without memory)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';
import type {
  MemoryManager,
  SessionSummary,
  ConversationEntry,
} from '../../../src/memory/index.js';

// ---------------------------------------------------------------------------
// Capture the HTTP request handler from createServer
// ---------------------------------------------------------------------------

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

let capturedHandler: RequestHandler | null = null;

vi.mock('node:http', () => ({
  createServer: vi.fn().mockImplementation((handler: RequestHandler) => {
    capturedHandler = handler;
    return {
      listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
      close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
    };
  }),
}));

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn((cb?: () => void) => cb?.()),
  })),
}));

vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Note: vi.mock is hoisted — use a literal token value here
vi.mock('../../../src/connectors/webchat/webchat-auth.js', () => ({
  getOrCreateAuthToken: vi.fn().mockReturnValue('sessions-test-token'),
}));

// ---------------------------------------------------------------------------
// Mock request / response helpers
// ---------------------------------------------------------------------------

/** Bearer token returned by the mocked webchat-auth module */
const SESSIONS_TEST_TOKEN = 'sessions-test-token';

function makeReq(url: string): IncomingMessage {
  return {
    url,
    headers: { authorization: `Bearer ${SESSIONS_TEST_TOKEN}` },
  } as unknown as IncomingMessage;
}

interface MockRes {
  writeHead: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead: vi.fn((code: number, headers: Record<string, string>) => {
      res.statusCode = code;
      res.headers = headers;
    }),
    setHeader: vi.fn(),
    end: vi.fn((data: string) => {
      res.body = data;
    }),
  };
  return res;
}

/** Invoke the captured request handler and wait for any async IIFE to settle. */
async function callHandler(req: IncomingMessage, res: MockRes): Promise<void> {
  capturedHandler!(req, res as unknown as ServerResponse);
  // Allow the async IIFE inside the handler to resolve
  await vi.waitFor(() => expect(res.end).toHaveBeenCalled(), { timeout: 1000 });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: 'sess-abc',
    title: 'Test chat',
    first_message_at: '2026-01-01T10:00:00.000Z',
    last_message_at: '2026-01-01T11:00:00.000Z',
    message_count: 3,
    channel: 'webchat',
    user_id: 'webchat-user',
    ...overrides,
  };
}

function makeConversationEntry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    session_id: 'sess-abc',
    role: 'user',
    content: 'Hello there',
    created_at: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

function createMockMemory(
  sessions: SessionSummary[] = [],
  entries: ConversationEntry[] = [],
): Partial<MemoryManager> {
  return {
    listSessions: vi.fn().mockResolvedValue(sessions),
    getSessionHistory: vi.fn().mockResolvedValue(entries),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebChat /api/sessions REST endpoints', () => {
  let connector: WebChatConnector;

  beforeEach(() => {
    capturedHandler = null;
    connector = new WebChatConnector({});
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/sessions
  // -------------------------------------------------------------------------
  describe('GET /api/sessions', () => {
    it('returns 503 when no memory is wired', async () => {
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions'), res);

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ error: 'Memory not available' });
    });

    it('returns 200 with session list when memory is available', async () => {
      const sessions = [
        makeSessionSummary({ session_id: 'sess-1', title: 'First' }),
        makeSessionSummary({ session_id: 'sess-2', title: 'Second' }),
      ];
      connector.setMemory(createMockMemory(sessions) as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions'), res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/json');
      const parsed = JSON.parse(res.body) as SessionSummary[];
      expect(parsed).toHaveLength(2);
      expect(parsed[0]!.session_id).toBe('sess-1');
      expect(parsed[1]!.session_id).toBe('sess-2');
    });

    it('calls listSessions with default limit=20 and offset=0', async () => {
      const memory = createMockMemory([]);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions'), res);

      expect(memory.listSessions).toHaveBeenCalledWith(20, 0);
    });

    it('respects limit query parameter', async () => {
      const memory = createMockMemory([]);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions?limit=5'), res);

      expect(memory.listSessions).toHaveBeenCalledWith(5, 0);
    });

    it('respects offset query parameter', async () => {
      const memory = createMockMemory([]);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions?limit=10&offset=20'), res);

      expect(memory.listSessions).toHaveBeenCalledWith(10, 20);
    });

    it('clamps limit to maximum of 100', async () => {
      const memory = createMockMemory([]);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions?limit=500'), res);

      expect(memory.listSessions).toHaveBeenCalledWith(100, 0);
    });

    it('clamps limit to minimum of 1', async () => {
      const memory = createMockMemory([]);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions?limit=0'), res);

      expect(memory.listSessions).toHaveBeenCalledWith(1, 0);
    });

    it('clamps negative offset to 0', async () => {
      const memory = createMockMemory([]);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions?offset=-5'), res);

      expect(memory.listSessions).toHaveBeenCalledWith(20, 0);
    });

    it('returns 500 when listSessions throws', async () => {
      const memory = createMockMemory();
      (memory.listSessions as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('DB error'),
      );
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions'), res);

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body)).toEqual({ error: 'Internal server error' });
    });

    it('returns empty array when no sessions exist', async () => {
      connector.setMemory(createMockMemory([]) as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions'), res);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/sessions/:id
  // -------------------------------------------------------------------------
  describe('GET /api/sessions/:id', () => {
    it('returns 503 when no memory is wired', async () => {
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions/sess-abc'), res);

      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body)).toEqual({ error: 'Memory not available' });
    });

    it('returns 200 with session messages when memory is available', async () => {
      const entries = [
        makeConversationEntry({ role: 'user', content: 'Hello' }),
        makeConversationEntry({ role: 'master', content: 'Hi there' }),
      ];
      connector.setMemory(createMockMemory([], entries) as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions/sess-abc'), res);

      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/json');
      const parsed = JSON.parse(res.body) as { session_id: string; messages: ConversationEntry[] };
      expect(parsed.session_id).toBe('sess-abc');
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0]!.content).toBe('Hello');
      expect(parsed.messages[1]!.content).toBe('Hi there');
    });

    it('extracts session ID from URL path', async () => {
      const memory = createMockMemory([], []);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions/my-session-uuid-1234'), res);

      expect(memory.getSessionHistory).toHaveBeenCalledWith(
        'my-session-uuid-1234',
        expect.any(Number),
      );
    });

    it('decodes URL-encoded session IDs', async () => {
      const memory = createMockMemory([], []);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions/sess%2Fwith%2Fslashes'), res);

      expect(memory.getSessionHistory).toHaveBeenCalledWith(
        'sess/with/slashes',
        expect.any(Number),
      );
    });

    it('uses default limit of 100 messages', async () => {
      const memory = createMockMemory([], []);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions/sess-abc'), res);

      expect(memory.getSessionHistory).toHaveBeenCalledWith('sess-abc', 100);
    });

    it('respects limit query parameter', async () => {
      const memory = createMockMemory([], []);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions/sess-abc?limit=25'), res);

      expect(memory.getSessionHistory).toHaveBeenCalledWith('sess-abc', 25);
    });

    it('clamps limit to maximum of 500', async () => {
      const memory = createMockMemory([], []);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions/sess-abc?limit=1000'), res);

      expect(memory.getSessionHistory).toHaveBeenCalledWith('sess-abc', 500);
    });

    it('returns 500 when getSessionHistory throws', async () => {
      const memory = createMockMemory([], []);
      (memory.getSessionHistory as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('DB error'),
      );
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions/sess-abc'), res);

      expect(res.statusCode).toBe(500);
      expect(JSON.parse(res.body)).toEqual({ error: 'Internal server error' });
    });

    it('returns empty messages array for unknown session', async () => {
      connector.setMemory(createMockMemory([], []) as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeReq('/api/sessions/nonexistent-session'), res);

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as { session_id: string; messages: unknown[] };
      expect(parsed.messages).toHaveLength(0);
    });
  });
});
