import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createLogger } from './logger.js';

const logger = createLogger('interaction-relay');

const DEFAULT_PORT = 3099;
const WS_OPEN = 1;

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
  on(
    event: 'connection',
    listener: (
      socket: WsClient,
      request: { headers: Record<string, string | string[] | undefined> },
    ) => void,
  ): void;
  close(callback?: () => void): void;
}

export interface RelayMessage {
  appId: string;
  type: string;
  data: unknown;
  id?: string;
  timestamp?: string;
}

export type AppMessageHandler = (message: RelayMessage) => void | Promise<void>;

interface AppConnection {
  appId: string;
  socket: WsClient;
  connectedAt: string;
}

/**
 * InteractionRelay — WebSocket server on port 3099.
 * Accepts connections from served apps and routes messages between apps and Master AI.
 */
export class InteractionRelay {
  private wss: WssServer | null = null;
  private readonly connections = new Map<string, AppConnection>();
  private messageHandlers: AppMessageHandler[] = [];
  private readonly port: number;
  private running = false;

  constructor(port = DEFAULT_PORT) {
    this.port = port;
  }

  /**
   * Start the WebSocket relay server.
   * Resolves when the server is listening.
   */
  async start(): Promise<void> {
    if (this.running) return;

    const inUse = await isPortInUse(this.port);
    if (inUse) {
      throw new Error(`InteractionRelay port ${this.port} is already in use`);
    }

    const { WebSocketServer } = (await import('ws')) as {
      WebSocketServer: new (options: { port: number }) => WssServer;
    };

    const wss = new WebSocketServer({ port: this.port });
    this.wss = wss;
    this.running = true;

    wss.on('connection', (socket, request) => {
      const connId = randomUUID();
      const appId = this.resolveAppId(request.headers, connId);

      const conn: AppConnection = {
        appId,
        socket,
        connectedAt: new Date().toISOString(),
      };
      this.connections.set(connId, conn);
      logger.info({ connId, appId }, 'App connected to relay');

      socket.on('message', (raw) => {
        let message: RelayMessage;
        try {
          message = JSON.parse(raw.toString()) as RelayMessage;
          // Ensure appId is always set from the connection
          message.appId = appId;
          if (!message.timestamp) {
            message.timestamp = new Date().toISOString();
          }
        } catch (err) {
          logger.warn({ connId, appId, err }, 'Failed to parse relay message — ignoring');
          return;
        }

        logger.debug({ connId, appId, type: message.type }, 'Relay received message from app');

        for (const handler of this.messageHandlers) {
          Promise.resolve(handler(message)).catch((handlerErr) => {
            logger.error({ err: handlerErr, appId }, 'Error in relay message handler');
          });
        }
      });

      socket.on('close', () => {
        this.connections.delete(connId);
        logger.info({ connId, appId }, 'App disconnected from relay');
      });

      socket.on('error', (err) => {
        logger.error({ connId, appId, err }, 'Relay socket error');
      });
    });

    logger.info({ port: this.port }, 'InteractionRelay started');
  }

  /**
   * Stop the relay server and close all connections.
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.wss || !this.running) {
        resolve();
        return;
      }

      this.running = false;
      this.connections.clear();
      this.wss.close(() => {
        this.wss = null;
        logger.info({ port: this.port }, 'InteractionRelay stopped');
        resolve();
      });
    });
  }

  /**
   * Send a message to a specific app by appId.
   * Returns true if the message was sent, false if the app is not connected.
   */
  sendToApp(appId: string, type: string, data: unknown): boolean {
    const conn = this.findConnectionByAppId(appId);
    if (!conn || conn.socket.readyState !== WS_OPEN) {
      logger.warn({ appId }, 'Cannot send to app — not connected');
      return false;
    }

    const message: RelayMessage = {
      appId,
      type,
      data,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    try {
      conn.socket.send(JSON.stringify(message));
      logger.debug({ appId, type }, 'Relay sent message to app');
      return true;
    } catch (err) {
      logger.error({ appId, type, err }, 'Failed to send message to app');
      return false;
    }
  }

  /**
   * Register a handler for messages received from apps.
   * Multiple handlers can be registered — all are called in registration order.
   */
  onAppMessage(handler: AppMessageHandler): void {
    this.messageHandlers.push(handler);
  }

  /**
   * Returns the number of currently connected apps.
   */
  get connectionCount(): number {
    return this.connections.size;
  }

  /**
   * Returns whether the relay server is currently running.
   */
  get isRunning(): boolean {
    return this.running;
  }

  /** Resolve appId from connection headers or generate one from connId */
  private resolveAppId(
    headers: Record<string, string | string[] | undefined>,
    connId: string,
  ): string {
    const header = headers['x-app-id'];
    if (typeof header === 'string' && header.trim().length > 0) {
      return header.trim();
    }
    return connId;
  }

  /** Find the first connection with the given appId */
  private findConnectionByAppId(appId: string): AppConnection | null {
    for (const conn of this.connections.values()) {
      if (conn.appId === appId) {
        return conn;
      }
    }
    return null;
  }
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close(() => resolve(false));
    });
    server.listen(port, '127.0.0.1');
  });
}
