import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { InboundMessage, OutboundMessage } from '../../types/message.js';
import { WebChatConfigSchema } from './webchat-config.js';
import type { WebChatConfig } from './webchat-config.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('webchat');

type EventListeners = {
  [E in keyof ConnectorEvents]: ConnectorEvents[E][];
};

/** Minimal WS client interface — avoids importing ws types at module level */
interface WsClient {
  readyState: number;
  send(data: string): void;
  on(event: 'message', listener: (data: Buffer | string) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
}

/** Minimal WebSocketServer interface */
interface WssServer {
  on(event: 'connection', listener: (socket: WsClient) => void): void;
  close(callback?: () => void): void;
}

/** WebSocket OPEN state constant */
const WS_OPEN = 1;

const CHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>OpenBridge WebChat</title>
  <style>
    body { font-family: sans-serif; max-width: 700px; margin: 40px auto; padding: 0 16px; }
    #messages { border: 1px solid #ddd; border-radius: 8px; height: 400px; overflow-y: auto; padding: 12px; margin-bottom: 12px; }
    .msg { margin: 6px 0; }
    .msg.user { color: #1a73e8; }
    .msg.ai { color: #333; }
    .msg.system { color: #999; font-style: italic; }
    #form { display: flex; gap: 8px; }
    #input { flex: 1; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
    button { padding: 8px 16px; background: #1a73e8; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  </style>
</head>
<body>
  <h2>OpenBridge WebChat</h2>
  <div id="messages"></div>
  <form id="form">
    <input id="input" type="text" placeholder="Type a message..." autocomplete="off" />
    <button type="submit">Send</button>
  </form>
  <script>
    const messages = document.getElementById('messages');
    const form = document.getElementById('form');
    const input = document.getElementById('input');

    function addMsg(text, cls) {
      const div = document.createElement('div');
      div.className = 'msg ' + cls;
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    const ws = new WebSocket('ws://' + location.host);
    ws.onopen = () => addMsg('Connected to OpenBridge', 'system');
    ws.onclose = () => addMsg('Disconnected', 'system');
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'response') addMsg('AI: ' + data.content, 'ai');
        else if (data.type === 'typing') addMsg('AI is typing\u2026', 'system');
      } catch {}
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || ws.readyState !== WebSocket.OPEN) return;
      addMsg('You: ' + text, 'user');
      ws.send(JSON.stringify({ type: 'message', content: text }));
      input.value = '';
    };
  </script>
</body>
</html>`;

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
  private readonly listeners: EventListeners = {
    message: [],
    ready: [],
    auth: [],
    error: [],
    disconnected: [],
  };

  constructor(options: Record<string, unknown>) {
    this.config = WebChatConfigSchema.parse(options);
  }

  async initialize(): Promise<void> {
    const http = await import('node:http');

    const WsServer = (await import('ws')).WebSocketServer as unknown as new (opts: {
      server: unknown;
    }) => WssServer;

    const server = http.createServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(CHAT_HTML);
    });

    this.httpServer = server;

    const wss = new WsServer({ server });
    this.wss = wss;

    wss.on('connection', (socket: WsClient) => {
      this.clients.add(socket);

      socket.on('message', (raw: Buffer | string) => {
        let payload: { type: string; content?: string };
        try {
          payload = JSON.parse(raw.toString()) as { type: string; content?: string };
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
    const payload = JSON.stringify({ type: 'response', content: message.content });
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

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    this.listeners[event].push(listener);
  }

  async shutdown(): Promise<void> {
    this.connected = false;
    this.clients.clear();

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
