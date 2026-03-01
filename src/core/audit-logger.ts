import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditConfig } from '../types/config.js';
import type { InboundMessage, OutboundMessage } from '../types/message.js';
import type { MemoryManager, AuditRecord } from '../memory/index.js';
import { createLogger } from './logger.js';

const logger = createLogger('audit');

export type AuditEventType = 'inbound' | 'outbound' | 'auth_denied' | 'rate_limited' | 'error';

export interface AuditEntry {
  timestamp: string;
  event: AuditEventType;
  messageId?: string;
  sender?: string;
  source?: string;
  recipient?: string;
  contentLength?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export class AuditLogger {
  private readonly enabled: boolean;
  private readonly logPath: string;
  private memory: MemoryManager | null = null;

  constructor(config: AuditConfig) {
    this.enabled = config.enabled;
    this.logPath = config.logPath;

    if (this.enabled) {
      logger.info({ logPath: this.logPath }, 'Audit logging enabled');
    }
  }

  /** Attach a MemoryManager for SQLite persistence. */
  setMemory(memory: MemoryManager): void {
    this.memory = memory;
  }

  async logInbound(message: InboundMessage): Promise<void> {
    await this.write({
      timestamp: new Date().toISOString(),
      event: 'inbound',
      messageId: message.id,
      sender: message.sender,
      source: message.source,
      contentLength: message.content.length,
    });
  }

  async logOutbound(message: OutboundMessage): Promise<void> {
    await this.write({
      timestamp: new Date().toISOString(),
      event: 'outbound',
      messageId: message.replyTo,
      recipient: message.recipient,
      contentLength: message.content.length,
    });
  }

  async logAuthDenied(sender: string): Promise<void> {
    await this.write({
      timestamp: new Date().toISOString(),
      event: 'auth_denied',
      sender,
    });
  }

  async logRateLimited(sender: string): Promise<void> {
    await this.write({
      timestamp: new Date().toISOString(),
      event: 'rate_limited',
      sender,
    });
  }

  async logError(messageId: string, error: string): Promise<void> {
    await this.write({
      timestamp: new Date().toISOString(),
      event: 'error',
      messageId,
      error,
    });
  }

  private async write(entry: AuditEntry): Promise<void> {
    if (!this.enabled) return;

    // Secondary sink: Pino structured log (always, for real-time console visibility)
    logger.info({ audit: entry }, `audit:${entry.event}`);

    // Primary sink: JSONL flat file
    try {
      await mkdir(dirname(this.logPath), { recursive: true });
      await appendFile(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      logger.error({ err, entry }, 'Failed to write audit log entry');
    }

    // Secondary sink: SQLite (when memory is attached)
    if (this.memory) {
      try {
        const record: AuditRecord = {
          timestamp: entry.timestamp,
          event: entry.event,
          message_id: entry.messageId ?? null,
          sender: entry.sender ?? null,
          source: entry.source ?? null,
          recipient: entry.recipient ?? null,
          content_length: entry.contentLength ?? null,
          error: entry.error ?? null,
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        };
        await this.memory.insertAuditEntry(record);
      } catch (err) {
        logger.error({ err, entry }, 'Failed to write audit entry to SQLite');
      }
    }
  }
}
