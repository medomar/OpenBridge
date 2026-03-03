/**
 * Tests for WebChat connector history, upload, autocomplete, and feedback
 * endpoints (OB-1532).
 *
 * Covers:
 *   1. GET /api/sessions           → returns session list
 *   2. GET /api/sessions/:id       → returns messages for a session
 *   3. GET /api/sessions/search    → FTS5 search across conversations
 *   4. POST /api/upload            → accepts multipart file upload
 *   5. POST /api/upload (too large) → enforces 10 MB size limit
 *   6. GET /api/commands           → returns autocomplete command list
 *   7. POST /api/feedback          → stores thumbs-up/down rating
 */

import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
      on: vi.fn(),
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
  getOrCreateAuthToken: vi.fn().mockReturnValue('history-test-token'),
  hashPassword: vi.fn().mockImplementation(async (pw: string) => `hashed:${pw}`),
  verifyPassword: vi
    .fn()
    .mockImplementation(async (submitted: string, hash: string) => hash === `hashed:${submitted}`),
}));

vi.mock('../../../src/connectors/webchat/ui-bundle.js', () => ({
  WEBCHAT_HTML: '<html>chat</html>',
  WEBCHAT_LOGIN_HTML: '<html>login</html>',
  WEBCHAT_SW_JS: '/* sw */',
}));

vi.mock('../../../src/core/qr-store.js', () => ({
  getQrCode: vi.fn().mockReturnValue(null),
}));

// Mock fs/promises to avoid actual disk I/O during upload tests
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

// Mock voice-transcriber (imported by webchat-connector)
vi.mock('../../../src/core/voice-transcriber.js', () => ({
  transcribeAudio: vi.fn().mockResolvedValue(null),
  TRANSCRIPTION_FALLBACK_MESSAGE: '[Voice transcription unavailable]',
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bearer token returned by the mocked webchat-auth module */
const TEST_TOKEN = 'history-test-token';

// ---------------------------------------------------------------------------
// Request / response helpers
// ---------------------------------------------------------------------------

function makeGetReq(url: string): IncomingMessage {
  return {
    url,
    method: 'GET',
    headers: { authorization: `Bearer ${TEST_TOKEN}` },
    socket: { remoteAddress: '127.0.0.1' },
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
    writeHead: vi.fn((code: number, headers?: Record<string, string>) => {
      res.statusCode = code;
      if (headers) res.headers = { ...res.headers, ...headers };
    }),
    setHeader: vi.fn((name: string, value: string) => {
      res.headers[name] = value;
    }),
    end: vi.fn((data?: string) => {
      res.body = data ?? '';
    }),
  };
  return res;
}

/** Invoke the captured request handler and wait for the async IIFE to settle. */
async function callHandler(req: IncomingMessage, res: MockRes): Promise<void> {
  capturedHandler!(req, res as unknown as ServerResponse);
  await vi.waitFor(() => expect(res.end).toHaveBeenCalled(), { timeout: 2000 });
}

/**
 * Send a POST request with a JSON body.
 * Uses EventEmitter to drive the req.on('data') / req.on('end') flow.
 */
function postJson(url: string, body: unknown): Promise<MockRes> {
  const emitter = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(emitter, {
    url,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TEST_TOKEN}`,
    },
    socket: { remoteAddress: '127.0.0.1' },
  });

  const res = makeRes();
  const done = new Promise<MockRes>((resolve) => {
    res.end = vi.fn((data?: string) => {
      res.body = data ?? '';
      resolve(res);
    });
  });

  capturedHandler!(emitter, res as unknown as ServerResponse);
  (emitter as unknown as EventEmitter).emit('data', Buffer.from(JSON.stringify(body)));
  (emitter as unknown as EventEmitter).emit('end');

  return done;
}

/**
 * Build a minimal multipart/form-data buffer for a file upload.
 */
function buildMultipartBody(
  boundary: string,
  filename: string,
  mimeType: string,
  content: Buffer,
): Buffer {
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeType}\r\n` +
      '\r\n',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([head, content, tail]);
}

/**
 * POST to /api/upload with a multipart file body.
 */
function postUpload(body: Buffer, boundary: string, contentLength?: number): Promise<MockRes> {
  const emitter = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(emitter, {
    url: '/api/upload',
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(contentLength ?? body.length),
      authorization: `Bearer ${TEST_TOKEN}`,
    },
    socket: { remoteAddress: '127.0.0.1' },
  });

  const res = makeRes();
  const done = new Promise<MockRes>((resolve) => {
    res.end = vi.fn((data?: string) => {
      res.body = data ?? '';
      resolve(res);
    });
  });

  capturedHandler!(emitter, res as unknown as ServerResponse);
  (emitter as unknown as EventEmitter).emit('data', body);
  (emitter as unknown as EventEmitter).emit('end');

  return done;
}

/**
 * POST to /api/upload — body-less, used for Content-Length rejection tests.
 */
function postUploadNoBody(boundary: string, contentLength: number): Promise<MockRes> {
  const emitter = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(emitter, {
    url: '/api/upload',
    method: 'POST',
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(contentLength),
      authorization: `Bearer ${TEST_TOKEN}`,
    },
    socket: { remoteAddress: '127.0.0.1' },
  });

  const res = makeRes();
  const done = new Promise<MockRes>((resolve) => {
    res.end = vi.fn((data?: string) => {
      res.body = data ?? '';
      resolve(res);
    });
  });

  capturedHandler!(emitter, res as unknown as ServerResponse);
  // No data emitted — Content-Length check fires before reading body

  return done;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSessionSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    session_id: 'sess-001',
    title: 'Test conversation',
    first_message_at: '2026-01-01T10:00:00.000Z',
    last_message_at: '2026-01-01T11:00:00.000Z',
    message_count: 4,
    channel: 'webchat',
    user_id: 'webchat-user',
    ...overrides,
  };
}

function makeConversationEntry(overrides: Partial<ConversationEntry> = {}): ConversationEntry {
  return {
    session_id: 'sess-001',
    role: 'user',
    content: 'Hello',
    created_at: '2026-01-01T10:00:00.000Z',
    ...overrides,
  };
}

function createMockMemory(
  sessions: SessionSummary[] = [],
  entries: ConversationEntry[] = [],
  searchResults: ConversationEntry[] = [],
): Partial<MemoryManager> {
  return {
    listSessions: vi.fn().mockResolvedValue(sessions),
    getSessionHistory: vi.fn().mockResolvedValue(entries),
    searchConversations: vi.fn().mockResolvedValue(searchResults),
    recordPromptOutcome: vi.fn().mockResolvedValue(undefined),
    getAccess: vi.fn().mockResolvedValue(null),
    setAccess: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('WebChat history & interaction endpoints (OB-1532)', () => {
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

  // ── 1. GET /api/sessions ────────────────────────────────────────────────────

  describe('GET /api/sessions — returns session list', () => {
    it('returns 200 with a list of sessions when memory is wired', async () => {
      const sessions = [
        makeSessionSummary({ session_id: 'sess-1', title: 'First chat' }),
        makeSessionSummary({ session_id: 'sess-2', title: 'Second chat' }),
      ];
      connector.setMemory(createMockMemory(sessions) as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/sessions'), res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as SessionSummary[];
      expect(body).toHaveLength(2);
      expect(body[0]!.session_id).toBe('sess-1');
      expect(body[1]!.session_id).toBe('sess-2');
    });

    it('returns 503 when no memory manager is wired', async () => {
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/sessions'), res);

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe('Memory not available');
    });

    it('passes limit and offset query params to listSessions', async () => {
      const memory = createMockMemory([]);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/sessions?limit=5&offset=10'), res);

      expect(memory.listSessions).toHaveBeenCalledWith(5, 10);
    });
  });

  // ── 2. GET /api/sessions/:id ────────────────────────────────────────────────

  describe('GET /api/sessions/:id — returns messages for a session', () => {
    it('returns 200 with messages for the given session ID', async () => {
      const entries = [
        makeConversationEntry({ role: 'user', content: 'Hello AI' }),
        makeConversationEntry({ role: 'master', content: 'Hello human' }),
      ];
      connector.setMemory(createMockMemory([], entries) as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/sessions/sess-001'), res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { session_id: string; messages: ConversationEntry[] };
      expect(body.session_id).toBe('sess-001');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0]!.content).toBe('Hello AI');
      expect(body.messages[1]!.content).toBe('Hello human');
    });

    it('returns 503 when no memory manager is wired', async () => {
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/sessions/some-id'), res);

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe('Memory not available');
    });

    it('passes the session ID from the URL path to getSessionHistory', async () => {
      const memory = createMockMemory([], []);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/sessions/my-unique-session-123'), res);

      expect(memory.getSessionHistory).toHaveBeenCalledWith(
        'my-unique-session-123',
        expect.any(Number),
      );
    });
  });

  // ── 3. GET /api/sessions/search — FTS5 search ──────────────────────────────

  describe('GET /api/sessions/search — FTS5 search across conversations', () => {
    it('returns matching conversation entries for a query', async () => {
      const results = [
        makeConversationEntry({ content: 'deploy the frontend', session_id: 'sess-42' }),
      ];
      const memory = createMockMemory([], [], results);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/sessions/search?q=frontend'), res);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as ConversationEntry[];
      expect(body).toHaveLength(1);
      expect(body[0]!.content).toBe('deploy the frontend');
    });

    it('calls searchConversations with the query string', async () => {
      const memory = createMockMemory([], [], []);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/sessions/search?q=design'), res);

      expect(memory.searchConversations).toHaveBeenCalledWith('design', expect.any(Number));
    });

    it('returns empty array and does not call searchConversations when query is blank', async () => {
      const memory = createMockMemory([], [], []);
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/sessions/search?q='), res);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
      expect(memory.searchConversations).not.toHaveBeenCalled();
    });

    it('returns 503 when no memory manager is wired', async () => {
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/sessions/search?q=test'), res);

      expect(res.statusCode).toBe(503);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toBe('Memory not available');
    });
  });

  // ── 4. POST /api/upload — accepts multipart ─────────────────────────────────

  describe('POST /api/upload — accepts multipart file upload', () => {
    it('returns 200 with fileId, filename, size, mimeType, and path', async () => {
      await connector.initialize();

      const boundary = 'test-boundary-001';
      const fileContent = Buffer.from('hello world');
      const body = buildMultipartBody(boundary, 'hello.txt', 'text/plain', fileContent);

      const res = await postUpload(body, boundary);

      expect(res.statusCode).toBe(200);
      const parsed = JSON.parse(res.body) as {
        fileId: string;
        filename: string;
        size: number;
        mimeType: string;
        path: string;
      };
      expect(parsed.filename).toBe('hello.txt');
      expect(parsed.size).toBe(fileContent.length);
      expect(parsed.mimeType).toBe('text/plain');
      expect(typeof parsed.fileId).toBe('string');
      expect(parsed.fileId.length).toBeGreaterThan(0);
    });

    it('returns 400 when no multipart boundary is provided in Content-Type', async () => {
      await connector.initialize();

      const emitter = new EventEmitter() as unknown as IncomingMessage;
      Object.assign(emitter, {
        url: '/api/upload',
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          authorization: `Bearer ${TEST_TOKEN}`,
        },
        socket: { remoteAddress: '127.0.0.1' },
      });

      const res = makeRes();
      const done = new Promise<MockRes>((resolve) => {
        res.end = vi.fn((data?: string) => {
          res.body = data ?? '';
          resolve(res);
        });
      });

      capturedHandler!(emitter, res as unknown as ServerResponse);
      (emitter as unknown as EventEmitter).emit('end');

      const result = await done;
      expect(result.statusCode).toBe(400);
      const body = JSON.parse(result.body) as { error: string };
      expect(body.error).toContain('boundary');
    });
  });

  // ── 5. POST /api/upload — size limit enforced ───────────────────────────────

  describe('POST /api/upload — size limit (10 MB)', () => {
    it('rejects uploads declared larger than 10 MB via Content-Length header', async () => {
      await connector.initialize();

      const boundary = 'test-boundary-big';
      const TEN_MB_PLUS_ONE = 10 * 1024 * 1024 + 1;

      const result = await postUploadNoBody(boundary, TEN_MB_PLUS_ONE);

      expect(result.statusCode).toBe(413);
      const body = JSON.parse(result.body) as { error: string };
      expect(body.error).toContain('too large');
    });
  });

  // ── 6. GET /api/commands — autocomplete list ────────────────────────────────

  describe('GET /api/commands — returns autocomplete command list', () => {
    it('returns 200 with a JSON array of command objects', async () => {
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/commands'), res);

      expect(res.statusCode).toBe(200);
      const commands = JSON.parse(res.body) as Array<{ name: string; description: string }>;
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
    });

    it('each command entry has a name starting with "/" and a description', async () => {
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/commands'), res);

      const commands = JSON.parse(res.body) as Array<{ name: string; description: string }>;
      for (const cmd of commands) {
        expect(typeof cmd.name).toBe('string');
        expect(cmd.name.startsWith('/')).toBe(true);
        expect(typeof cmd.description).toBe('string');
      }
    });

    it('includes known commands: /history, /stop, /status, /help', async () => {
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/commands'), res);

      const commands = JSON.parse(res.body) as Array<{ name: string; description: string }>;
      const names = commands.map((c) => c.name);
      expect(names).toContain('/history');
      expect(names).toContain('/stop');
      expect(names).toContain('/status');
      expect(names).toContain('/help');
    });

    it('response includes a Cache-Control header for client-side caching', async () => {
      await connector.initialize();

      const res = makeRes();
      await callHandler(makeGetReq('/api/commands'), res);

      expect(res.headers['Cache-Control']).toBeDefined();
      const cacheControl: string = res.headers['Cache-Control'] as string;
      expect(cacheControl).toContain('max-age');
    });
  });

  // ── 7. POST /api/feedback — stores rating ──────────────────────────────────

  describe('POST /api/feedback — stores user thumbs-up/down rating', () => {
    it('returns 200 ok for a thumbs-up rating', async () => {
      connector.setMemory(createMockMemory() as MemoryManager);
      await connector.initialize();

      const res = await postJson('/api/feedback', {
        session: 'sess-001',
        message: 'msg-1',
        rating: 'up',
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
    });

    it('returns 200 ok for a thumbs-down rating', async () => {
      connector.setMemory(createMockMemory() as MemoryManager);
      await connector.initialize();

      const res = await postJson('/api/feedback', {
        session: 'sess-001',
        message: 'msg-2',
        rating: 'down',
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
    });

    it('calls recordPromptOutcome with success=true for thumbs-up', async () => {
      const memory = createMockMemory();
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      await postJson('/api/feedback', { rating: 'up' });

      await vi.waitFor(
        () => {
          expect(memory.recordPromptOutcome).toHaveBeenCalledWith('webchat-response-quality', true);
        },
        { timeout: 1000 },
      );
    });

    it('calls recordPromptOutcome with success=false for thumbs-down', async () => {
      const memory = createMockMemory();
      connector.setMemory(memory as MemoryManager);
      await connector.initialize();

      await postJson('/api/feedback', { rating: 'down' });

      await vi.waitFor(
        () => {
          expect(memory.recordPromptOutcome).toHaveBeenCalledWith(
            'webchat-response-quality',
            false,
          );
        },
        { timeout: 1000 },
      );
    });

    it('returns 400 when rating is missing from the payload', async () => {
      await connector.initialize();

      const res = await postJson('/api/feedback', { session: 'sess-001', message: 'msg-1' });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toContain('rating');
    });

    it('returns 400 when rating has an invalid value', async () => {
      await connector.initialize();

      const res = await postJson('/api/feedback', { rating: 'maybe' });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body) as { error: string };
      expect(body.error).toContain('rating');
    });

    it('succeeds without crash when no memory manager is wired', async () => {
      // memory is NOT set — feedback should still return 200 ok
      await connector.initialize();

      const res = await postJson('/api/feedback', { rating: 'up' });

      // Prompt outcome recording is fire-and-forget; no memory = no-op
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
    });
  });
});
