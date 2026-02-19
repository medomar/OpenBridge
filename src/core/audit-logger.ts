import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AuditConfig } from '../types/config.js';
import type { InboundMessage, OutboundMessage } from '../types/message.js';
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
  private dirEnsured = false;

  constructor(config: AuditConfig) {
    this.enabled = config.enabled;
    this.logPath = config.logPath;

    if (this.enabled) {
      logger.info({ logPath: this.logPath }, 'Audit logging enabled');
    }
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

    try {
      if (!this.dirEnsured) {
        await mkdir(dirname(this.logPath), { recursive: true });
        this.dirEnsured = true;
      }

      await appendFile(this.logPath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (err) {
      logger.error({ err, entry }, 'Failed to write audit log entry');
    }
  }
}
