import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { OutboundMessage, ProgressEvent } from '../../types/message.js';
import { WhatsAppConfigSchema } from './whatsapp-config.js';
import type { WhatsAppConfig } from './whatsapp-config.js';
import { parseWhatsAppMessage, splitForWhatsApp } from './whatsapp-message.js';
import { formatMarkdownForWhatsApp } from './whatsapp-formatter.js';
import { createLogger } from '../../core/logger.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { unlink, readlink, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { MessageMedia } from 'whatsapp-web.js';

const execFileAsync = promisify(execFile);

const logger = createLogger('whatsapp');

type EventListeners = {
  [E in keyof ConnectorEvents]: ConnectorEvents[E][];
};

interface WAChat {
  sendStateTyping: () => Promise<void>;
}

interface WAMediaData {
  data: string; // base64-encoded audio
  mimetype: string;
}

interface WAMessage {
  id: { id: string };
  from: string;
  body: string;
  timestamp: number;
  hasMedia?: boolean;
  type?: string;
  downloadMedia?: () => Promise<WAMediaData | null>;
}

interface WASendOptions {
  caption?: string;
  sendMediaAsDocument?: boolean;
  sendAudioAsVoice?: boolean;
}

interface WAClient {
  on: (event: string, handler: (...args: never[]) => void) => void;
  initialize: () => Promise<void>;
  sendMessage: (
    to: string,
    content: string | MessageMedia,
    options?: WASendOptions,
  ) => Promise<void>;
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
  /** Tracks chat IDs that have received a progress status message (to avoid repeat sends). */
  private readonly progressSent = new Set<string>();
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
      // Use local cache to avoid remote fetch failures (GitHub URL can be unreachable)
      webVersionCache: {
        type: 'local',
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

    this.client.on('message', (msg: WAMessage) => {
      void this.handleIncomingMessage(msg);
    });

    this.client.on('disconnected', (reason: string) => {
      this.connected = false;
      logger.warn({ reason }, 'WhatsApp disconnected');
      this.emit('disconnected', reason);
      this.scheduleReconnect();
    });

    // Catch Puppeteer ProtocolError / browser crashes that don't trigger 'disconnected'.
    // Log the phase (pre-ready vs post-ready) to help diagnose where the error occurs.
    this.client.on('error', (err: Error) => {
      const phase = this.connected ? 'post-ready' : 'pre-ready';
      const isProtocolError =
        err.message.includes('ProtocolError') ||
        err.message.includes('Execution context was destroyed');
      if (isProtocolError) {
        logger.error(
          { err: err.message, phase },
          'WhatsApp ProtocolError — Chromium context destroyed',
        );
      } else {
        logger.error({ err: err.message, phase }, 'WhatsApp client error');
      }
      if (this.connected) {
        this.connected = false;
        this.emit('error', err);
        this.scheduleReconnect();
      }
    });

    // Retry initialize() up to 3 times with exponential backoff.
    // ProtocolError: Execution context was destroyed can occur transiently during startup.
    const MAX_INIT_ATTEMPTS = 3;
    const { initialDelayMs, backoffFactor, maxDelayMs } = this.config.reconnect;
    let lastInitError: Error | null = null;
    for (let attempt = 1; attempt <= MAX_INIT_ATTEMPTS; attempt++) {
      try {
        if (attempt > 1) {
          logger.info(
            { attempt, maxAttempts: MAX_INIT_ATTEMPTS },
            'Retrying client.initialize() after previous failure',
          );
        } else {
          logger.info('Launching Chromium and loading WhatsApp Web...');
        }
        await this.client.initialize();
        logger.info('WhatsApp client initialized successfully');
        return;
      } catch (err: unknown) {
        lastInitError = err instanceof Error ? err : new Error(String(err));
        logger.warn(
          { attempt, maxAttempts: MAX_INIT_ATTEMPTS, err: lastInitError.message },
          'client.initialize() failed',
        );
        if (attempt < MAX_INIT_ATTEMPTS) {
          const backoffMs = Math.min(
            initialDelayMs * Math.pow(backoffFactor, attempt - 1),
            maxDelayMs,
          );
          await new Promise<void>((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }
    throw lastInitError ?? new Error('client.initialize() failed after all retries');
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

  private async handleIncomingMessage(msg: WAMessage): Promise<void> {
    if (msg.hasMedia && msg.type === 'ptt') {
      const transcription = await this.transcribeVoiceMessage(msg);
      const content = transcription ?? '[Voice message — install whisper for auto-transcription]';
      const parsed = parseWhatsAppMessage(msg.id.id, msg.from, content, msg.timestamp);
      this.emit('message', parsed);
      return;
    }
    const parsed = parseWhatsAppMessage(msg.id.id, msg.from, msg.body, msg.timestamp);
    this.emit('message', parsed);
  }

  private async transcribeVoiceMessage(msg: WAMessage): Promise<string | null> {
    try {
      const media = await msg.downloadMedia?.();
      if (!media?.data) return null;

      const whisperPath = await this.findWhisper();
      if (!whisperPath) return null;

      const tmpPath = join(tmpdir(), `wa-voice-${Date.now()}.ogg`);
      await writeFile(tmpPath, Buffer.from(media.data, 'base64'));
      try {
        await execFileAsync(whisperPath, [
          tmpPath,
          '--output-format',
          'txt',
          '--output-dir',
          tmpdir(),
        ]);
        const txtPath = tmpPath.replace(/\.ogg$/, '.txt');
        const text = await readFile(txtPath, 'utf-8').catch(() => '');
        await unlink(txtPath).catch(() => {});
        return text.trim() || null;
      } finally {
        await unlink(tmpPath).catch(() => {});
      }
    } catch (err) {
      logger.warn({ err }, 'Voice message transcription failed');
      return null;
    }
  }

  private async findWhisper(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('which', ['whisper']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async findTtsTool(): Promise<{
    bin: string;
    ext: string;
    mimeType: string;
    argsFor: (text: string, outPath: string) => string[];
  } | null> {
    // macOS: 'say' command → AIFF output
    try {
      const { stdout } = await execFileAsync('which', ['say']);
      if (stdout.trim()) {
        return {
          bin: stdout.trim(),
          ext: 'aiff',
          mimeType: 'audio/aiff',
          argsFor: (text, outPath) => ['-o', outPath, text],
        };
      }
    } catch {
      // not found
    }
    // Linux: 'espeak' command → WAV output
    try {
      const { stdout } = await execFileAsync('which', ['espeak']);
      if (stdout.trim()) {
        return {
          bin: stdout.trim(),
          ext: 'wav',
          mimeType: 'audio/wav',
          argsFor: (text, outPath) => ['-w', outPath, text],
        };
      }
    } catch {
      // not found
    }
    return null;
  }

  async sendVoiceReply(chatId: string, text: string): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('WhatsApp connector is not connected');
    }

    const ttsTool = await this.findTtsTool();
    if (!ttsTool) {
      logger.warn({ chatId }, 'No TTS tool found — falling back to text for voice reply');
      const formatted = formatMarkdownForWhatsApp(text);
      const chunks = splitForWhatsApp(formatted);
      for (const chunk of chunks) {
        await this.client.sendMessage(chatId, chunk);
      }
      return;
    }

    const tmpPath = join(tmpdir(), `wa-tts-${Date.now()}.${ttsTool.ext}`);
    try {
      await execFileAsync(ttsTool.bin, ttsTool.argsFor(text, tmpPath));
      const audioData = await readFile(tmpPath);
      const base64 = audioData.toString('base64');
      const WAWebJS = await import('whatsapp-web.js');
      const { MessageMedia: MessageMediaClass } = WAWebJS;
      const media = new MessageMediaClass(ttsTool.mimeType, base64, null);
      await this.client.sendMessage(chatId, media, { sendAudioAsVoice: true });
      logger.debug({ chatId }, 'Voice reply sent via TTS');
    } catch (err) {
      logger.warn({ err, chatId }, 'TTS generation failed — falling back to text reply');
      const formatted = formatMarkdownForWhatsApp(text);
      const chunks = splitForWhatsApp(formatted);
      for (const chunk of chunks) {
        await this.client.sendMessage(chatId, chunk);
      }
    } finally {
      await unlink(tmpPath).catch(() => {});
    }
  }

  private scheduleReconnect(): void {
    const { enabled, maxAttempts, initialDelayMs, maxDelayMs, backoffFactor } =
      this.config.reconnect;

    if (this.shuttingDown || !enabled) {
      return;
    }

    // Guard against double-scheduling (e.g. both 'error' and 'disconnected' fire together)
    if (this.reconnectTimer !== null) {
      logger.debug('Reconnect already scheduled — skipping duplicate');
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

    if (message.media) {
      const WAWebJS = await import('whatsapp-web.js');
      const { MessageMedia: MessageMediaClass } = WAWebJS;
      const base64 = message.media.data.toString('base64');
      const media = new MessageMediaClass(
        message.media.mimeType,
        base64,
        message.media.filename ?? null,
      );
      const caption = message.content || message.media.filename;
      const options: WASendOptions = {};
      if (caption) options.caption = caption;
      if (message.media.type === 'document') options.sendMediaAsDocument = true;
      await this.client.sendMessage(message.recipient, media, options);
      logger.debug({ recipient: message.recipient, type: message.media.type }, 'Media sent');
      return;
    }

    const formatted = formatMarkdownForWhatsApp(message.content);
    const chunks = splitForWhatsApp(formatted);
    for (const chunk of chunks) {
      await this.client.sendMessage(message.recipient, chunk);
    }

    logger.debug({ recipient: message.recipient, chunks: chunks.length }, 'Message sent');
  }

  async sendProactive(recipient: string, content: string): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('WhatsApp connector is not connected');
    }

    // Normalize to WhatsApp chat ID format: digits only + @c.us
    const digits = recipient.replace(/\D/g, '');
    const chatId = digits.includes('@') ? recipient : `${digits}@c.us`;

    const formatted = formatMarkdownForWhatsApp(content);
    const chunks = splitForWhatsApp(formatted);
    for (const chunk of chunks) {
      await this.client.sendMessage(chatId, chunk);
    }

    logger.debug({ recipient: chatId, chunks: chunks.length }, 'Proactive message sent');
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

  async sendProgress(event: ProgressEvent, chatId: string): Promise<void> {
    if (!this.client || !this.connected) return;

    if (event.type === 'complete') {
      this.progressSent.delete(chatId);
      return;
    }

    // Only send one status message per conversation to avoid spamming the user.
    // The spawning event is the most informative — it tells the user how many subtasks are running.
    if (event.type === 'spawning' && !this.progressSent.has(chatId)) {
      const n = event.workerCount;
      const text = `🔄 Breaking into ${n.toString()} subtask${n !== 1 ? 's' : ''}...`;
      try {
        await this.client.sendMessage(chatId, text);
        this.progressSent.add(chatId);
      } catch (err: unknown) {
        logger.debug({ chatId, err }, 'Failed to send WhatsApp progress message');
      }
    }
    // All other events are silently skipped — avoid WhatsApp message spam
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    this.listeners[event].push(listener);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.progressSent.clear();

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
