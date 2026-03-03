import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { InboundMessage, OutboundMessage, ProgressEvent } from '../../types/message.js';
import { WebChatConfigSchema } from './webchat-config.js';
import type { WebChatConfig } from './webchat-config.js';
import { createLogger } from '../../core/logger.js';
import { getQrCode } from '../../core/qr-store.js';
import type { ActivityRecord } from '../../memory/activity-store.js';
import type { MemoryManager } from '../../memory/index.js';
import { WEBCHAT_HTML } from './ui-bundle.js';
import { getOrCreateAuthToken } from './webchat-auth.js';

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

  /** Returns the auth token, or null if initialize() has not been called yet. */
  getAuthToken(): string | null {
    return this.authToken;
  }

  /** Returns the full URL to access WebChat with the auth token appended, or null before initialize(). */
  getWebChatAccessUrl(): string | null {
    if (!this.authToken) return null;
    const host = this.config.host === '0.0.0.0' ? 'localhost' : this.config.host;
    return `http://${host}:${this.config.port}/?token=${this.authToken}`;
  }

  async initialize(): Promise<void> {
    // Generate or load persisted auth token before starting the server
    this.authToken = getOrCreateAuthToken(this.storeDir);

    const http = await import('node:http');

    const WsServer = (await import('ws')).WebSocketServer as unknown as new (opts: {
      server: unknown;
    }) => WssServer;

    const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/';

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
      res.end(WEBCHAT_HTML);
    });

    this.httpServer = server;

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
            sender: 'webchat-user',
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
            sender: 'webchat-user',
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
            sender: 'webchat-user',
            rawContent: 'stop all',
            content: 'stop all',
            timestamp: new Date(),
          };
          this.emit('message', message);
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

  private emit<E extends keyof ConnectorEvents>(
    event: E,
    ...args: Parameters<ConnectorEvents[E]>
  ): void {
    for (const listener of this.listeners[event]) {
      (listener as (...a: Parameters<ConnectorEvents[E]>) => void)(...args);
    }
  }
}
