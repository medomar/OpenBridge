import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join } from 'node:path';
import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { InboundMessage, OutboundMessage, ProgressEvent } from '../../types/message.js';
import { WebChatConfigSchema } from './webchat-config.js';
import type { WebChatConfig } from './webchat-config.js';
import { createLogger } from '../../core/logger.js';
import { getQrCode } from '../../core/qr-store.js';
import type { ActivityRecord } from '../../memory/activity-store.js';
import type { AccessControlEntry } from '../../memory/access-store.js';
import type { MemoryManager } from '../../memory/index.js';
import { WEBCHAT_HTML, WEBCHAT_LOGIN_HTML, WEBCHAT_SW_JS } from './ui-bundle.js';
import { getOrCreateAuthToken, hashPassword, verifyPassword } from './webchat-auth.js';

/** Name of the HTTP-only session cookie set after successful token validation */
const SESSION_COOKIE_NAME = 'ob_session';
/** Session lifetime: 24 hours in milliseconds */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Per-IP login rate limiting — max failures before a 30-min block */
const LOGIN_MAX_FAILURES = 5;
/** Sliding window for counting failures: 15 minutes */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Block duration after exceeding failure threshold: 30 minutes */
const LOGIN_BLOCK_MS = 30 * 60 * 1000;

interface IpRateEntry {
  failures: number;
  windowStart: number;
  blockedUntil?: number;
}

const logger = createLogger('webchat');

type EventListeners = {
  [E in keyof ConnectorEvents]: ConnectorEvents[E][];
};

/** Minimal WS client interface — avoids importing ws types at module level */
interface WsClient {
  readyState: number;
  send(data: string): void;
  ping(): void;
  on(event: 'message', listener: (data: Buffer | string) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

/** Minimal WebSocketServer interface */
interface WssServer {
  on(event: 'connection', listener: (socket: WsClient) => void): void;
  on(event: 'close', listener: () => void): void;
  close(callback?: () => void): void;
}

/** WebSocket OPEN state constant */
const WS_OPEN = 1;

/** Maximum upload size: 10 MB */
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Parse the first file part from a multipart/form-data body.
 * Returns null if no file part is found.
 */
function parseMultipartFile(
  body: Buffer,
  boundary: string,
): { filename: string; mimeType: string; data: Buffer } | null {
  const delimiter = Buffer.from(`--${boundary}`);
  const crlfcrlf = Buffer.from('\r\n\r\n');

  // Find the first boundary
  let pos = body.indexOf(delimiter);
  if (pos === -1) return null;
  pos += delimiter.length;

  // Skip CRLF after opening boundary
  if (body[pos] === 0x0d && body[pos + 1] === 0x0a) pos += 2;

  // Find end of headers
  const headersEnd = body.indexOf(crlfcrlf, pos);
  if (headersEnd === -1) return null;

  const headersStr = body.subarray(pos, headersEnd).toString('utf8');
  pos = headersEnd + 4; // skip \r\n\r\n

  // Parse headers
  let filename = 'upload';
  let mimeType = 'application/octet-stream';
  for (const line of headersStr.split('\r\n')) {
    const lower = line.toLowerCase();
    if (lower.startsWith('content-disposition:')) {
      const m = line.match(/filename="([^"]+)"/i);
      if (m) filename = m[1]!;
    } else if (lower.startsWith('content-type:')) {
      const ct = line.slice('content-type:'.length).trim();
      if (ct) mimeType = ct;
    }
  }

  // Find end boundary (CRLF + -- + boundary)
  const endDelimiter = Buffer.from(`\r\n--${boundary}`);
  const dataEnd = body.indexOf(endDelimiter, pos);
  const data = dataEnd !== -1 ? body.subarray(pos, dataEnd) : body.subarray(pos);
  return { filename, mimeType, data };
}

/**
 * WebChat connector — serves a minimal HTML chat UI on localhost:3000
 * and exchanges messages via WebSocket.
 *
 * Uses Node.js built-in `http` module + the `ws` package.
 * No auth required for localhost connections.
 *
 * Usage in config.json:
 * ```json
 * {
 *   "channels": [{ "type": "webchat", "options": { "port": 3000 } }]
 * }
 * ```
 */
export class WebChatConnector implements Connector {
  readonly name = 'webchat';
  private config: WebChatConfig;
  private connected = false;
  private httpServer: { close(cb?: (err?: Error) => void): void } | null = null;
  private wss: WssServer | null = null;
  private clients = new Set<WsClient>();
  private messageCounter = 0;
  private readonly pendingDownloads = new Map<
    string,
    { data: Buffer; mimeType: string; filename?: string; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly listeners: EventListeners = {
    message: [],
    ready: [],
    auth: [],
    error: [],
    disconnected: [],
  };
  private memory: MemoryManager | null = null;
  private authToken: string | null = null;
  private storeDir: string = process.cwd();
  /** bcrypt hash of the configured password, or null when token auth is active */
  private passwordHash: string | null = null;
  /** Tunnel URL override for QR code — set before initialize() for tunnel-preferred QR */
  private tunnelUrl: string | null = null;
  /** In-memory session store: sessionId → expiry timestamp (ms since epoch) */
  private readonly sessions: Map<string, number> = new Map();
  /** Per-IP login failure tracker for rate limiting */
  private readonly loginRateLimiter: Map<string, IpRateEntry> = new Map();

  constructor(options: Record<string, unknown>) {
    this.config = WebChatConfigSchema.parse(options);
  }

  /** Wire the SQLite memory manager — enables the /api/sessions REST endpoint. */
  setMemory(memory: MemoryManager): void {
    this.memory = memory;
  }

  /**
   * Set the workspace path used for token persistence.
   * Must be called before initialize() to take effect.
   * Defaults to process.cwd() if not set.
   */
  setWorkspacePath(workspacePath: string): void {
    this.storeDir = workspacePath;
  }

  /** Returns the auth token, or null if initialize() has not been called yet or password mode is active. */
  getAuthToken(): string | null {
    return this.authToken;
  }

  /** Returns true when password-based auth is active (webchat.password was configured). */
  isPasswordMode(): boolean {
    return this.passwordHash !== null;
  }

  /** Returns the full URL to access WebChat with the auth token appended, or null before initialize(). */
  getWebChatAccessUrl(): string | null {
    if (!this.authToken) return null;
    const host = this.config.host === '0.0.0.0' ? 'localhost' : this.config.host;
    return `http://${host}:${this.config.port}/?token=${this.authToken}`;
  }

  /**
   * Returns the tunnel (public) URL with auth token appended when a tunnel is active,
   * or null if no tunnel URL has been set via setTunnelUrl().
   */
  getPublicUrl(): string | null {
    if (!this.tunnelUrl) return null;
    const token = this.authToken;
    const sep = this.tunnelUrl.includes('?') ? '&' : '?';
    return token ? `${this.tunnelUrl}${sep}token=${token}` : this.tunnelUrl;
  }

  /**
   * Set a tunnel public URL so that initialize() uses it as the QR code target
   * instead of the LAN IP. Must be called before initialize() to take effect.
   * The token is automatically appended when the QR is generated.
   */
  setTunnelUrl(url: string): void {
    this.tunnelUrl = url;
  }

  /**
   * Returns the best URL for QR code scanning (tunnel > first LAN IP > localhost).
   * The URL includes the auth token query parameter when token auth is active.
   * Returns null if initialize() has not been called yet (no auth token).
   */
  getLanAccessUrl(): string | null {
    const token = this.authToken;
    // Tunnel URL is preferred when set
    if (this.tunnelUrl) {
      const sep = this.tunnelUrl.includes('?') ? '&' : '?';
      return token ? `${this.tunnelUrl}${sep}token=${token}` : this.tunnelUrl;
    }
    // Otherwise use the first detected LAN IP
    const lanIps = this.getLanIps();
    if (lanIps.length > 0) {
      const suffix = token ? `/?token=${token}` : '/';
      return `http://${lanIps[0]!}:${this.config.port}${suffix}`;
    }
    // Fall back to localhost URL
    return this.getWebChatAccessUrl();
  }

  /**
   * Extract a bearer token from the request — checks (in order):
   *   1. `?token=<value>` query parameter
   *   2. `Authorization: Bearer <value>` header
   */
  private extractToken(url: string, req: IncomingMessage): string | null {
    try {
      const parsed = new URL(url, 'http://localhost');
      const tokenFromQuery = parsed.searchParams.get('token');
      if (tokenFromQuery) return tokenFromQuery;
    } catch {
      // malformed URL — fall through
    }
    const authHeader = req.headers?.['authorization'];
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    return null;
  }

  /** Extract the session ID from the `ob_session` cookie, or null if absent. */
  private extractSessionId(req: IncomingMessage): string | null {
    const cookieHeader = req.headers?.['cookie'];
    if (!cookieHeader) return null;
    for (const part of cookieHeader.split(';')) {
      const trimmed = part.trim();
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const name = trimmed.slice(0, eqIdx).trim();
      if (name === SESSION_COOKIE_NAME) {
        return trimmed.slice(eqIdx + 1).trim();
      }
    }
    return null;
  }

  /** Return true if the session exists and has not expired. Evicts on expiry. */
  private isValidSession(sessionId: string): boolean {
    const expiry = this.sessions.get(sessionId);
    if (expiry === undefined) return false;
    if (Date.now() > expiry) {
      this.sessions.delete(sessionId);
      return false;
    }
    return true;
  }

  /** Remove all expired sessions from the in-memory store. */
  private evictExpiredSessions(): void {
    const now = Date.now();
    for (const [id, expiry] of this.sessions) {
      if (now > expiry) this.sessions.delete(id);
    }
  }

  /** Extract the best-effort client IP from an incoming HTTP request. */
  private extractClientIp(req: IncomingMessage): string {
    const forwarded = req.headers?.['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return forwarded.split(',')[0]!.trim();
    }
    return req.socket?.remoteAddress ?? 'unknown';
  }

  /**
   * Check whether the given IP is currently rate-limited.
   * Returns true if the IP should be blocked (429).
   */
  private isLoginBlocked(ip: string): boolean {
    const entry = this.loginRateLimiter.get(ip);
    if (!entry) return false;
    const now = Date.now();
    if (entry.blockedUntil !== undefined && now < entry.blockedUntil) {
      return true;
    }
    // Reset if outside the sliding window
    if (now - entry.windowStart > LOGIN_WINDOW_MS) {
      this.loginRateLimiter.delete(ip);
      return false;
    }
    return false;
  }

  /**
   * Record a login failure for the given IP.
   * Blocks the IP for LOGIN_BLOCK_MS after LOGIN_MAX_FAILURES within LOGIN_WINDOW_MS.
   */
  private recordLoginFailure(ip: string): void {
    const now = Date.now();
    const entry = this.loginRateLimiter.get(ip);
    if (!entry || now - entry.windowStart > LOGIN_WINDOW_MS) {
      // Start a fresh window
      this.loginRateLimiter.set(ip, { failures: 1, windowStart: now });
      return;
    }
    entry.failures += 1;
    if (entry.failures >= LOGIN_MAX_FAILURES) {
      entry.blockedUntil = now + LOGIN_BLOCK_MS;
      logger.warn(
        { ip, failures: entry.failures },
        'WebChat login rate limit exceeded — IP blocked',
      );
    }
  }

  /** Reset the login failure counter for an IP on successful authentication. */
  private resetLoginFailures(ip: string): void {
    this.loginRateLimiter.delete(ip);
  }

  /**
   * Ensure the 'webchat-user' entry exists in the access-control store.
   * Called after a successful authentication event (token or password).
   * Creates the entry with a default 'viewer' role if none exists.
   * Preserves any existing entry (admin-customised roles are not overwritten).
   */
  private ensureWebchatAccessEntry(): void {
    if (!this.memory) return;
    void this.memory.getAccess('webchat-user', 'webchat').then((existing) => {
      if (!existing) {
        const entry: AccessControlEntry = {
          user_id: 'webchat-user',
          channel: 'webchat',
          role: 'viewer',
          active: true,
        };
        void this.memory!.setAccess(entry).then(() => {
          logger.debug('WebChat: created access-store entry for webchat-user');
        });
      }
    });
  }

  /**
   * Create a new session and set the `ob_session` HTTP-only cookie on the response.
   * Called when a valid bearer token is presented on an HTTP request.
   */
  private startSession(res: ServerResponse): void {
    this.evictExpiredSessions();
    const sessionId = randomUUID();
    const expiry = Date.now() + SESSION_TTL_MS;
    this.sessions.set(sessionId, expiry);
    const maxAge = Math.floor(SESSION_TTL_MS / 1000);
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}; Path=/`,
    );
  }

  /**
   * Check whether the incoming HTTP request carries a valid token or an active
   * session cookie.  Returns `{ ok, tokenProvided }`:
   *  - `ok` — whether the request is authorised
   *  - `tokenProvided` — true when the token itself (not a cookie) was used,
   *    so the caller can issue a new session cookie
   *
   * In password mode (`passwordHash !== null`), only valid session cookies are
   * accepted — token auth is disabled so that the login screen is the sole
   * entry point.
   */
  private isAuthenticated(
    url: string,
    req: IncomingMessage,
  ): { ok: boolean; tokenProvided: boolean } {
    // Password mode: only session cookies grant access
    if (this.passwordHash !== null) {
      const sessionId = this.extractSessionId(req);
      if (sessionId !== null && this.isValidSession(sessionId)) {
        return { ok: true, tokenProvided: false };
      }
      return { ok: false, tokenProvided: false };
    }

    // Token mode (default)
    if (this.authToken === null) {
      // Token not yet initialised — deny access
      return { ok: false, tokenProvided: false };
    }
    const token = this.extractToken(url, req);
    if (token !== null && token === this.authToken) {
      return { ok: true, tokenProvided: true };
    }
    const sessionId = this.extractSessionId(req);
    if (sessionId !== null && this.isValidSession(sessionId)) {
      return { ok: true, tokenProvided: false };
    }
    return { ok: false, tokenProvided: false };
  }

  async initialize(): Promise<void> {
    // Password mode: hash the configured password; skip token generation
    if (this.config.password) {
      this.passwordHash = await hashPassword(this.config.password);
      logger.info('WebChat running in password-auth mode');
    } else {
      // Token mode: generate or load persisted auth token
      this.authToken = getOrCreateAuthToken(this.storeDir);
    }

    const http = await import('node:http');

    const WsServer = (await import('ws')).WebSocketServer as unknown as new (opts: {
      server: unknown;
    }) => WssServer;

    const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/';

      // ── Password login endpoint (public — no auth guard) ───────────────────
      if (url === '/api/webchat/login' && req.method === 'POST') {
        if (this.passwordHash === null) {
          // Not in password mode — endpoint not available
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Password auth is not enabled' }));
          return;
        }

        const clientIp = this.extractClientIp(req);

        // Per-IP rate limit check
        if (this.isLoginBlocked(clientIp)) {
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '1800' });
          res.end(JSON.stringify({ error: 'Too many failed login attempts. Try again later.' }));
          logger.warn({ ip: clientIp }, 'WebChat login blocked — rate limit active');
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString();
          if (body.length > 1024) {
            req.destroy();
          }
        });
        req.on('end', () => {
          void (async (): Promise<void> => {
            let parsed: { password?: string };
            try {
              parsed = JSON.parse(body) as { password?: string };
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid JSON body' }));
              return;
            }
            if (typeof parsed.password !== 'string' || parsed.password.length === 0) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing password field' }));
              return;
            }
            const valid = await verifyPassword(parsed.password, this.passwordHash!);
            if (!valid) {
              this.recordLoginFailure(clientIp);
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid password' }));
              logger.warn({ ip: clientIp }, 'WebChat login failed — invalid password');
              return;
            }
            this.resetLoginFailures(clientIp);
            this.startSession(res);
            this.ensureWebchatAccessEntry();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
            logger.info('WebChat login successful — session created');
          })();
        });
        return;
      }
      // ──────────────────────────────────────────────────────────────────────

      // ── PWA manifest (public — no auth required) ────────────────────────────
      if (url === '/manifest.json') {
        const manifest = {
          name: 'OpenBridge WebChat',
          short_name: 'OpenBridge',
          description: 'AI Bridge WebChat — connect to your AI assistant',
          start_url: '/',
          display: 'standalone',
          theme_color: '#1a73e8',
          background_color: '#f0f2f5',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          ],
        };
        res.writeHead(200, { 'Content-Type': 'application/manifest+json' });
        res.end(JSON.stringify(manifest));
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────

      // ── Service Worker (public — no auth required, must be at root scope) ───
      if (url === '/sw.js') {
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Service-Worker-Allowed': '/',
          'Cache-Control': 'no-cache',
        });
        res.end(WEBCHAT_SW_JS);
        return;
      }
      // ─────────────────────────────────────────────────────────────────────────

      // ── Auth guard ─────────────────────────────────────────────────────────
      const auth = this.isAuthenticated(url, req);
      if (!auth.ok) {
        // In password mode, serve the login screen for page requests instead
        // of returning a bare 401 — only API and non-GET requests get 401.
        const isPageRequest =
          req.method === 'GET' &&
          this.passwordHash !== null &&
          (url === '/' || url === '' || url.startsWith('/?'));
        if (isPageRequest) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(WEBCHAT_LOGIN_HTML);
        } else {
          res.writeHead(401, { 'Content-Type': 'text/plain' });
          res.end('Unauthorized');
        }
        return;
      }
      // When the client authenticates with the bearer token, issue a session
      // cookie so subsequent requests (without the token in the URL) are also
      // allowed through.
      if (auth.tokenProvided) {
        this.startSession(res);
        this.ensureWebchatAccessEntry();
      }
      // ──────────────────────────────────────────────────────────────────────

      // QR code endpoint — serves a scannable QR page in headless mode
      if (url === '/qr') {
        const qrData = getQrCode();
        if (!qrData) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>WhatsApp QR</title>' +
              '<meta http-equiv="refresh" content="3"></head><body style="font-family:sans-serif;text-align:center;padding:40px">' +
              '<h2>Waiting for QR code...</h2><p>This page will auto-refresh.</p></body></html>',
          );
          return;
        }
        const html =
          '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Scan WhatsApp QR</title>' +
          '<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>' +
          '<style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f0f2f5}' +
          'h2{color:#128c7e}#qr{display:inline-block;padding:16px;background:#fff;border-radius:8px;' +
          'box-shadow:0 2px 12px rgba(0,0,0,0.12);margin:24px auto}</style></head>' +
          '<body><h2>Scan with WhatsApp</h2>' +
          '<p>Open WhatsApp → Linked Devices → Link a Device</p>' +
          '<div id="qr"></div>' +
          '<script>new QRCode(document.getElementById("qr"),' +
          JSON.stringify({ text: qrData, width: 256, height: 256 }) +
          ');</script></body></html>';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
        return;
      }

      const match = url.match(/^\/download\/([0-9a-f-]+)$/i);
      if (match) {
        const fileId = match[1]!;
        const entry = this.pendingDownloads.get(fileId);
        if (!entry) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
          return;
        }
        const filename = entry.filename ?? 'download';
        res.writeHead(200, {
          'Content-Type': entry.mimeType,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': entry.data.length,
        });
        res.end(entry.data);
        return;
      }

      // /api/upload — multipart file upload (POST)
      if (url === '/api/upload' && req.method === 'POST') {
        void (async (): Promise<void> => {
          const contentType = req.headers['content-type'] ?? '';
          const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
          if (!boundaryMatch) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing multipart boundary' }));
            return;
          }

          // Reject by Content-Length before reading the body
          const declaredLength = parseInt(req.headers['content-length'] ?? '0', 10);
          if (Number.isFinite(declaredLength) && declaredLength > UPLOAD_MAX_BYTES) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File too large (max 10MB)' }));
            return;
          }

          // Collect body, enforcing the size limit
          const chunks: Buffer[] = [];
          let totalSize = 0;
          let tooLarge = false;
          await new Promise<void>((resolve, reject) => {
            req.on('data', (chunk: Buffer) => {
              totalSize += chunk.length;
              if (totalSize > UPLOAD_MAX_BYTES) {
                tooLarge = true;
                req.destroy();
                resolve();
                return;
              }
              chunks.push(chunk);
            });
            req.on('end', resolve);
            req.on('error', reject);
          });

          if (tooLarge) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File too large (max 10MB)' }));
            return;
          }

          const body = Buffer.concat(chunks);
          const file = parseMultipartFile(body, boundaryMatch[1]!);
          if (!file) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No file found in upload' }));
            return;
          }

          // Store file in <storeDir>/.openbridge/uploads/<uuid><ext>
          const uploadsDir = join(this.storeDir, '.openbridge', 'uploads');
          await mkdir(uploadsDir, { recursive: true });

          const fileId = randomUUID();
          const ext = extname(file.filename);
          const storedName = `${fileId}${ext}`;
          const filePath = join(uploadsDir, storedName);
          await writeFile(filePath, file.data);

          logger.info(
            { fileId, filename: file.filename, size: file.data.length },
            'WebChat: file uploaded',
          );

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              fileId,
              filename: file.filename,
              size: file.data.length,
              mimeType: file.mimeType,
              path: filePath,
            }),
          );
        })();
        return;
      }

      // /api/sessions — JSON list of sessions for the WebChat history view
      if (url === '/api/sessions' || url.startsWith('/api/sessions?')) {
        void (async (): Promise<void> => {
          if (!this.memory) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Memory not available' }));
            return;
          }
          try {
            const parsed = new URL(url, 'http://localhost');
            const limitParam = parseInt(parsed.searchParams.get('limit') ?? '20', 10);
            const offsetParam = parseInt(parsed.searchParams.get('offset') ?? '0', 10);
            const limit = Number.isFinite(limitParam) ? Math.min(100, Math.max(1, limitParam)) : 20;
            const offset = Number.isFinite(offsetParam) ? Math.max(0, offsetParam) : 0;
            const sessions = await this.memory.listSessions(limit, offset);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(sessions));
          } catch (err) {
            logger.error({ err }, 'GET /api/sessions failed');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        })();
        return;
      }

      // /api/sessions/search — FTS5 full-text search across conversations
      if (url === '/api/sessions/search' || url.startsWith('/api/sessions/search?')) {
        void (async (): Promise<void> => {
          if (!this.memory) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Memory not available' }));
            return;
          }
          try {
            const parsed = new URL(url, 'http://localhost');
            const query = parsed.searchParams.get('q') ?? '';
            const limitParam = parseInt(parsed.searchParams.get('limit') ?? '20', 10);
            const limit = Number.isFinite(limitParam) ? Math.min(50, Math.max(1, limitParam)) : 20;
            if (!query.trim()) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify([]));
              return;
            }
            const results = await this.memory.searchConversations(query, limit);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(results));
          } catch (err) {
            logger.error({ err }, 'GET /api/sessions/search failed');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        })();
        return;
      }

      // /api/sessions/:id — full conversation JSON for one session
      const sessionMatch = url.match(/^\/api\/sessions\/([^/?#]+)(?:\?.*)?$/);
      if (sessionMatch) {
        const sessionId = decodeURIComponent(sessionMatch[1]!);
        void (async (): Promise<void> => {
          if (!this.memory) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Memory not available' }));
            return;
          }
          try {
            const parsed = new URL(url, 'http://localhost');
            const limitParam = parseInt(parsed.searchParams.get('limit') ?? '100', 10);
            const limit = Number.isFinite(limitParam)
              ? Math.min(500, Math.max(1, limitParam))
              : 100;
            const messages = await this.memory.getSessionHistory(sessionId, limit);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ session_id: sessionId, messages }));
          } catch (err) {
            logger.error({ err }, 'GET /api/sessions/:id failed');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        })();
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.buildHtmlPage());
    });

    this.httpServer = server;

    // ── WebSocket upgrade auth guard ──────────────────────────────────────────
    // Validate the auth token before the ws library accepts the upgrade.
    // Registered before WebSocketServer so this listener runs first.
    server.on('upgrade', (req, socket) => {
      const url = req.url ?? '/';
      const auth = this.isAuthenticated(url, req);
      if (!auth.ok) {
        socket.write(
          'HTTP/1.1 401 Unauthorized\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nUnauthorized',
        );
        socket.destroy();
        logger.warn({ url }, 'WebSocket upgrade rejected — invalid or missing auth token');
      }
    });
    // ─────────────────────────────────────────────────────────────────────────

    const wss = new WsServer({ server });
    this.wss = wss;

    // Keep WebSocket connections alive during long-running tasks (workers can take 10+ minutes)
    const PING_INTERVAL_MS = 30_000;
    const pingTimer = setInterval(() => {
      for (const client of this.clients) {
        if (client.readyState === WS_OPEN) {
          client.ping();
        }
      }
    }, PING_INTERVAL_MS);
    wss.on('close', () => clearInterval(pingTimer));

    wss.on('connection', (socket: WsClient) => {
      this.clients.add(socket);

      // Per-socket sender ID — rotated on each "new-session" message so that
      // the router and Master AI treat subsequent messages as a fresh conversation.
      let socketSender = 'webchat-user';

      socket.on('message', (raw: Buffer | string) => {
        let payload: { type: string; content?: string; workerId?: string };
        try {
          payload = JSON.parse(raw.toString()) as {
            type: string;
            content?: string;
            workerId?: string;
          };
        } catch {
          return;
        }

        if (payload.type === 'message' && typeof payload.content === 'string') {
          this.messageCounter++;
          const message: InboundMessage = {
            id: `webchat-${this.messageCounter.toString()}`,
            source: 'webchat',
            sender: socketSender,
            rawContent: payload.content,
            content: payload.content,
            timestamp: new Date(),
          };
          this.emit('message', message);
        } else if (payload.type === 'stop-worker' && typeof payload.workerId === 'string') {
          this.messageCounter++;
          const content = `stop ${payload.workerId}`;
          const message: InboundMessage = {
            id: `webchat-${this.messageCounter.toString()}`,
            source: 'webchat',
            sender: socketSender,
            rawContent: content,
            content,
            timestamp: new Date(),
          };
          this.emit('message', message);
        } else if (payload.type === 'stop-all') {
          this.messageCounter++;
          const message: InboundMessage = {
            id: `webchat-${this.messageCounter.toString()}`,
            source: 'webchat',
            sender: socketSender,
            rawContent: 'stop all',
            content: 'stop all',
            timestamp: new Date(),
          };
          this.emit('message', message);
        } else if (payload.type === 'new-session') {
          // Rotate the per-socket sender so the Master AI starts a fresh conversation.
          socketSender = `webchat-user-${randomUUID()}`;
          logger.debug({ sender: socketSender }, 'WebChat new session started');
        }
      });

      socket.on('close', () => {
        this.clients.delete(socket);
      });

      socket.on('error', (err: Error) => {
        this.clients.delete(socket);
        logger.warn({ err }, 'WebChat client error');
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(this.config.port, this.config.host, () => {
        this.connected = true;
        logger.info({ port: this.config.port, host: this.config.host }, 'WebChat connector ready');

        // Display LAN access URLs when binding to all interfaces
        if (this.config.host === '0.0.0.0') {
          const lanIps = this.getLanIps();
          if (lanIps.length > 0) {
            for (const ip of lanIps) {
              const suffix = this.authToken ? `/?token=${this.authToken}` : '/';
              const lanUrl = `http://${ip}:${this.config.port}${suffix}`;
              console.log(`  WebChat LAN URL: ${lanUrl}`);
              logger.info({ url: lanUrl }, 'WebChat LAN URL');
            }
          } else {
            logger.warn('WebChat: no LAN interfaces detected');
          }
        }

        // Display public (tunnel) URL when a tunnel is active
        const publicUrl = this.getPublicUrl();
        if (publicUrl) {
          console.log(`  WebChat Public URL: ${publicUrl}`);
          logger.info({ url: publicUrl }, 'WebChat Public URL (tunnel active)');
        }

        // Display QR code for phone scanning — prefer tunnel URL if set, else first LAN URL
        const qrUrl = this.getLanAccessUrl();
        if (qrUrl) {
          console.log('  Scan to open WebChat on your phone:');
          import('qrcode-terminal')
            .then((qrcodeTerminal) => {
              const mod = qrcodeTerminal.default ?? qrcodeTerminal;
              mod.generate(qrUrl, { small: true });
            })
            .catch(() => {
              // qrcode-terminal unavailable — URL printed above is sufficient
            });
        }

        this.emit('ready');
        resolve();
      });
    });
  }

  sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.connected) {
      return Promise.reject(new Error('WebChat connector is not connected'));
    }

    let payload: string;
    if (message.media) {
      const fileId = randomUUID();
      const { data, mimeType, filename } = message.media;
      const timer = setTimeout(
        () => {
          this.pendingDownloads.delete(fileId);
        },
        60 * 60 * 1000,
      ); // 1 hour
      this.pendingDownloads.set(fileId, { data, mimeType, filename, timer });
      payload = JSON.stringify({
        type: 'download',
        content: message.content,
        fileId,
        filename: filename ?? 'download',
        url: `/download/${fileId}`,
        mimeType,
        timestamp: new Date().toISOString(),
      });
    } else {
      payload = JSON.stringify({
        type: 'response',
        content: message.content,
        timestamp: new Date().toISOString(),
      });
    }

    for (const client of this.clients) {
      if (client.readyState === WS_OPEN) {
        client.send(payload);
      }
    }
    return Promise.resolve();
  }

  sendTypingIndicator(_chatId: string): Promise<void> {
    if (!this.connected) return Promise.resolve();
    const payload = JSON.stringify({ type: 'typing' });
    for (const client of this.clients) {
      if (client.readyState === WS_OPEN) {
        client.send(payload);
      }
    }
    return Promise.resolve();
  }

  sendProgress(event: ProgressEvent, _chatId: string): Promise<void> {
    if (!this.connected) return Promise.resolve();
    const payload = JSON.stringify({ type: 'progress', event });
    for (const client of this.clients) {
      if (client.readyState === WS_OPEN) {
        client.send(payload);
      }
    }
    return Promise.resolve();
  }

  /** Broadcast current agent activity to all connected WebSocket clients. */
  broadcastAgentStatus(agents: ActivityRecord[]): void {
    if (!this.connected || this.clients.size === 0) return;
    const payload = JSON.stringify({
      type: 'agent-status',
      agents,
      timestamp: new Date().toISOString(),
    });
    for (const client of this.clients) {
      if (client.readyState === WS_OPEN) {
        client.send(payload);
      }
    }
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    this.listeners[event].push(listener);
  }

  async shutdown(): Promise<void> {
    this.connected = false;
    this.clients.clear();

    for (const entry of this.pendingDownloads.values()) {
      clearTimeout(entry.timer);
    }
    this.pendingDownloads.clear();

    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.close((err?: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
      this.httpServer = null;
    }

    logger.info('WebChat connector shut down');
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Build the main HTML page, injecting the public tunnel URL when active.
   * Replaces the `window.__OB_PUBLIC_URL__ = null;` placeholder in the bundle
   * with the actual tunnel URL (including auth token) so the frontend can
   * display it in the header copy button.
   */
  private buildHtmlPage(): string {
    const publicUrl = this.getPublicUrl();
    if (!publicUrl) return WEBCHAT_HTML;
    return WEBCHAT_HTML.replace(
      'window.__OB_PUBLIC_URL__ = null;',
      `window.__OB_PUBLIC_URL__ = ${JSON.stringify(publicUrl)};`,
    );
  }

  /** Returns a list of non-internal IPv4 addresses for LAN URL display. */
  private getLanIps(): string[] {
    const nets = networkInterfaces();
    const results: string[] = [];
    for (const ifaces of Object.values(nets)) {
      if (!ifaces) continue;
      for (const net of ifaces) {
        if (net.family === 'IPv4' && !net.internal) {
          results.push(net.address);
        }
      }
    }
    return results;
  }

  private emit<E extends keyof ConnectorEvents>(
    event: E,
    ...args: Parameters<ConnectorEvents[E]>
  ): void {
    for (const listener of this.listeners[event]) {
      (listener as (...a: Parameters<ConnectorEvents[E]>) => void)(...args);
    }
  }
}
