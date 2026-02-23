import type { Interface as ReadlineInterface } from 'node:readline';
import type { Connector, ConnectorEvents } from '../../types/connector.js';
import type { InboundMessage, OutboundMessage, ProgressEvent } from '../../types/message.js';
import { ConsoleConfigSchema } from './console-config.js';
import type { ConsoleConfig } from './console-config.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('console');

function formatProgressEvent(event: ProgressEvent): string {
  switch (event.type) {
    case 'classifying':
      return 'Analyzing request...';
    case 'planning':
      return 'Planning subtasks...';
    case 'spawning':
      return `Spawning ${event.workerCount.toString()} worker${event.workerCount !== 1 ? 's' : ''}...`;
    case 'worker-progress':
      return `Worker ${event.completed.toString()}/${event.total.toString()} done${event.workerName ? ` (${event.workerName})` : ''}`;
    case 'synthesizing':
      return 'Preparing final response...';
    case 'complete':
      return 'Done';
  }
}

type EventListeners = {
  [E in keyof ConnectorEvents]: ConnectorEvents[E][];
};

/**
 * Example connector that reads from stdin and writes to stdout.
 *
 * This is a reference implementation showing how to build a connector plugin.
 * It demonstrates:
 * - Implementing the full Connector interface
 * - Config validation with Zod
 * - Event emission for message/ready/error/disconnected
 * - Typing indicator support
 * - Graceful shutdown
 *
 * Usage in config.json:
 * ```json
 * {
 *   "connectors": [{ "type": "console", "options": { "prompt": "> " } }]
 * }
 * ```
 */
export class ConsoleConnector implements Connector {
  readonly name = 'console';
  private config: ConsoleConfig;
  private connected = false;
  private rl: ReadlineInterface | null = null;
  private messageCounter = 0;
  private readonly listeners: EventListeners = {
    message: [],
    ready: [],
    auth: [],
    error: [],
    disconnected: [],
  };

  constructor(options: Record<string, unknown>) {
    this.config = ConsoleConfigSchema.parse(options);
  }

  async initialize(): Promise<void> {
    // Dynamic import to avoid requiring readline at module load
    const { createInterface } = await import('node:readline');

    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.config.prompt,
    });

    this.rl.on('line', (line: string) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;

      this.messageCounter++;
      const message: InboundMessage = {
        id: `console-${this.messageCounter.toString()}`,
        source: 'console',
        sender: this.config.userId,
        rawContent: trimmed,
        content: trimmed,
        timestamp: new Date(),
      };

      this.emit('message', message);
    });

    this.rl.on('close', () => {
      this.connected = false;
      this.emit('disconnected', 'stdin closed');
    });

    this.connected = true;
    logger.info({ userId: this.config.userId }, 'Console connector ready');
    this.emit('ready');
    this.rl.prompt();
  }

  sendMessage(message: OutboundMessage): Promise<void> {
    if (!this.connected) {
      return Promise.reject(new Error('Console connector is not connected'));
    }

    process.stdout.write(`\n${message.content}\n`);

    if (this.rl) {
      this.rl.prompt();
    }

    return Promise.resolve();
  }

  sendTypingIndicator(_chatId: string): Promise<void> {
    if (!this.connected) return Promise.resolve();
    process.stdout.write('...\n');
    return Promise.resolve();
  }

  sendProgress(event: ProgressEvent, _chatId: string): Promise<void> {
    if (!this.connected) return Promise.resolve();
    const label = formatProgressEvent(event);
    process.stdout.write(`[${label}]\n`);
    return Promise.resolve();
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    this.listeners[event].push(listener);
  }

  shutdown(): Promise<void> {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    this.connected = false;
    logger.info('Console connector shut down');
    return Promise.resolve();
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
