import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { OutboundMessage } from '../../types/message.js';
import { WhatsAppConfigSchema } from './whatsapp-config.js';
import type { WhatsAppConfig } from './whatsapp-config.js';
import { parseWhatsAppMessage, splitForWhatsApp } from './whatsapp-message.js';
import { formatMarkdownForWhatsApp } from './whatsapp-formatter.js';
import { createLogger } from '../../core/logger.js';
import { unlink, readlink } from 'node:fs/promises';
import { join } from 'node:path';

const logger = createLogger('whatsapp');

type EventListeners = {
  [E in keyof ConnectorEvents]: ConnectorEvents[E][];
};

interface WAChat {
  sendStateTyping: () => Promise<void>;
}

interface WAClient {
  on: (event: string, handler: (...args: never[]) => void) => void;
  initialize: () => Promise<void>;
  sendMessage: (to: string, content: string) => Promise<void>;
  getChatById: (chatId: string) => Promise<WAChat>;
  destroy: () => Promise<void>;
}

export class WhatsAppConnector implements Connector {
  readonly name = 'whatsapp';
  private config: WhatsAppConfig;
  private connected = false;
  private client: WAClient | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;
  private readonly listeners: EventListeners = {
    message: [],
    ready: [],
    auth: [],
    error: [],
    disconnected: [],
  };

  constructor(options: Record<string, unknown>) {
    this.config = WhatsAppConfigSchema.parse(options);
  }

  async initialize(): Promise<void> {
    logger.info(
      {
        sessionName: this.config.sessionName,
        sessionPath: this.config.sessionPath ?? '.wwebjs_auth',
      },
      'Initializing WhatsApp connector — session will persist across restarts',
    );
    this.shuttingDown = false;
    await this.createAndStartClient();
  }

  private async createAndStartClient(): Promise<void> {
    // Dynamic import to avoid requiring whatsapp-web.js at module load
    // whatsapp-web.js is CJS — Client is a named export, but LocalAuth is only on .default
    const WAWebJS = await import('whatsapp-web.js');
    const { Client } = WAWebJS;
    const { LocalAuth } = WAWebJS.default;

    const localAuthOptions: { clientId: string; dataPath?: string } = {
      clientId: this.config.sessionName,
    };
    if (this.config.sessionPath) {
      localAuthOptions.dataPath = this.config.sessionPath;
    }

    // Remove stale SingletonLock — left behind when Chromium crashes or the process is killed.
    // Without this, Puppeteer hangs trying to connect to a dead browser.
    await this.removeStaleLock();

    this.client = new Client({
      authStrategy: new LocalAuth(localAuthOptions),
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/nicokant/nicokant.github.io/main/nicokant/',
      },
      puppeteer: {
        headless: this.config.headless,
        protocolTimeout: 300_000, // 5 min — WhatsApp Web can be slow to load
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--disable-extensions',
          '--single-process',
        ],
      },
    }) as unknown as WAClient;

    this.client.on('qr', (qr: string) => {
      logger.info('QR code received — scan with WhatsApp');
      // Render QR code to terminal so the user can scan it
      import('qrcode-terminal')
        .then((qrcodeTerminal) => {
          const mod = qrcodeTerminal.default ?? qrcodeTerminal;
          mod.generate(qr, { small: true });
        })
        .catch(() => {
          // Fallback: print raw QR string if qrcode-terminal is not available
          logger.info({ qr }, 'Install qrcode-terminal to display QR in terminal');
        });
      this.emit('auth', qr);
    });

    this.client.on('authenticated', () => {
      logger.info('WhatsApp session authenticated — restoring saved session');
    });

    this.client.on('auth_failure', (message: string) => {
      logger.error(
        { message },
        'WhatsApp authentication failed — saved session invalid, re-scan QR required',
      );
      this.emit('error', new Error(`WhatsApp auth failure: ${message}`));
    });

    this.client.on('ready', () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      logger.info('WhatsApp client ready');
      this.emit('ready');
    });

    this.client.on(
      'message',
      (msg: { id: { id: string }; from: string; body: string; timestamp: number }) => {
        const parsed = parseWhatsAppMessage(msg.id.id, msg.from, msg.body, msg.timestamp);
        this.emit('message', parsed);
      },
    );

    this.client.on('disconnected', (reason: string) => {
      this.connected = false;
      logger.warn({ reason }, 'WhatsApp disconnected');
      this.emit('disconnected', reason);
      this.scheduleReconnect();
    });

    logger.info('Launching Chromium and loading WhatsApp Web...');
    await this.client.initialize();
    logger.info('WhatsApp client initialized successfully');
  }

  /**
   * Remove stale SingletonLock from the Chromium profile directory.
   * This lock is a symlink like `Mac-<PID>`. If the PID is no longer running,
   * the lock is stale and will prevent Puppeteer from launching.
   */
  private async removeStaleLock(): Promise<void> {
    const dataPath = this.config.sessionPath ?? '.wwebjs_auth';
    const lockPath = join(dataPath, `session-${this.config.sessionName}`, 'SingletonLock');

    try {
      const target = await readlink(lockPath);
      // Target format: "Mac-<PID>" or "<hostname>-<PID>"
      const pidMatch = target.match(/-(\d+)$/);
      if (!pidMatch?.[1]) return;

      const pid = parseInt(pidMatch[1], 10);
      try {
        // signal 0 = check if process exists without sending a signal
        process.kill(pid, 0);
        // Process is alive — lock is valid, don't remove
        logger.debug({ pid }, 'SingletonLock held by running process');
      } catch {
        // Process doesn't exist — lock is stale
        await unlink(lockPath);
        logger.info({ pid }, 'Removed stale SingletonLock from previous Chromium crash');
      }
    } catch {
      // Lock doesn't exist or can't be read — nothing to do
    }
  }

  private scheduleReconnect(): void {
    const { enabled, maxAttempts, initialDelayMs, maxDelayMs, backoffFactor } =
      this.config.reconnect;

    if (this.shuttingDown || !enabled) {
      return;
    }

    if (maxAttempts > 0 && this.reconnectAttempt >= maxAttempts) {
      logger.error({ maxAttempts }, 'WhatsApp reconnect: max attempts reached, giving up');
      this.emit('error', new Error('WhatsApp reconnect failed: max attempts reached'));
      return;
    }

    const delay = Math.min(
      initialDelayMs * Math.pow(backoffFactor, this.reconnectAttempt),
      maxDelayMs,
    );
    this.reconnectAttempt++;

    logger.info(
      { attempt: this.reconnectAttempt, delayMs: delay },
      'WhatsApp scheduling reconnect',
    );

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (this.shuttingDown) return;

      logger.info({ attempt: this.reconnectAttempt }, 'WhatsApp attempting reconnect');

      if (this.client) {
        await this.client.destroy().catch((err: unknown) => {
          logger.warn({ err }, 'Error destroying old WhatsApp client before reconnect');
        });
        this.client = null;
      }

      try {
        await this.createAndStartClient();
      } catch (err: unknown) {
        logger.error({ err }, 'WhatsApp reconnect failed');
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
        this.scheduleReconnect();
      }
    }, delay);
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('WhatsApp connector is not connected');
    }

    const formatted = formatMarkdownForWhatsApp(message.content);
    const chunks = splitForWhatsApp(formatted);
    for (const chunk of chunks) {
      await this.client.sendMessage(message.recipient, chunk);
    }

    logger.debug({ recipient: message.recipient, chunks: chunks.length }, 'Message sent');
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.client || !this.connected) {
      return; // Best-effort — silently skip if not connected
    }

    try {
      const chat = await this.client.getChatById(chatId);
      await chat.sendStateTyping();
      logger.debug({ chatId }, 'Typing indicator sent');
    } catch (err) {
      logger.warn({ chatId, err }, 'Failed to send typing indicator');
    }
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    this.listeners[event].push(listener);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      await this.client.destroy();
      this.connected = false;
      logger.info('WhatsApp connector shut down');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  private emit<E extends keyof ConnectorEvents>(
    event: E,
    ...args: Parameters<ConnectorEvents[E]>
  ): void {
    for (const listener of this.listeners[event]) {
      (listener as (...args: Parameters<ConnectorEvents[E]>) => void)(...args);
    }
  }
}
