import { appendFile, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { AuditConfig } from '../types/config.js';
import type { InboundMessage, OutboundMessage } from '../types/message.js';
import type { MemoryManager, AuditRecord } from '../memory/index.js';
import { createLogger } from './logger.js';

const logger = createLogger('audit');

export type AuditEventType = 'inbound' | 'outbound' | 'auth_denied' | 'rate_limited' | 'error';

/** Execution trace written to .openbridge/audit/ for each worker spawn. */
export interface WorkerSpawnTrace {
  /** Activity / task ID for this spawn */
  taskId: string;
  /** Tool profile used (read-only, code-audit, code-edit, full-access, master) */
  profile: string;
  /** Allowed tools list passed to the worker */
  tools: string[];
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Estimated cost in USD (undefined if unknown) */
  costUsd?: number;
  /** Number of files modified (heuristic count from worker output) */
  filesModified: number;
  /** Worker result status */
  result: 'success' | 'failed' | 'timeout' | 'error';
  /** Model used by the worker */
  model?: string;
  /** Short task description */
  taskSummary?: string;
}

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

/** How long to retain worker spawn trace files in .openbridge/audit/ (30 days). */
const AUDIT_FILE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export class AuditLogger {
  private readonly enabled: boolean;
  private readonly logPath: string;
  private memory: MemoryManager | null = null;
  private workspacePath: string | null = null;

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

  /** Set the workspace path — enables JSON trace files in .openbridge/audit/. */
  setWorkspacePath(workspacePath: string): void {
    this.workspacePath = workspacePath;
  }

  /**
   * Write an execution trace JSON file to .openbridge/audit/ for a completed worker spawn.
   * Filename: audit-{timestamp}-{taskId}.json
   * Also triggers cleanup of files older than 30 days.
   */
  async logWorkerSpawn(trace: WorkerSpawnTrace): Promise<void> {
    if (!this.workspacePath) return;

    const auditDir = join(this.workspacePath, '.openbridge', 'audit');
    try {
      await mkdir(auditDir, { recursive: true });
    } catch (err) {
      logger.error({ err, auditDir }, 'Failed to create .openbridge/audit directory');
      return;
    }

    // Build a filesystem-safe timestamp: 2026-03-02T12:00:00.000Z → 20260302T120000Z
    const ts = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
    const safeName = trace.taskId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    const filename = `audit-${ts}-${safeName}.json`;
    const filePath = join(auditDir, filename);

    const record = {
      timestamp: new Date().toISOString(),
      taskId: trace.taskId,
      profile: trace.profile,
      tools: trace.tools,
      durationMs: trace.durationMs,
      costUsd: trace.costUsd ?? null,
      filesModified: trace.filesModified,
      result: trace.result,
      model: trace.model ?? null,
      taskSummary: trace.taskSummary ?? null,
    };

    try {
      await writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8');
      logger.debug({ filePath, taskId: trace.taskId }, 'Worker spawn trace written');
    } catch (err) {
      logger.error({ err, filePath }, 'Failed to write worker spawn trace');
      return;
    }

    // Best-effort cleanup — do not await or propagate errors
    this.cleanupOldAuditFiles(auditDir).catch((err) => {
      logger.warn({ err, auditDir }, 'Audit file cleanup failed');
    });
  }

  /**
   * Remove audit trace files older than AUDIT_FILE_RETENTION_MS from the given directory.
   */
  private async cleanupOldAuditFiles(auditDir: string): Promise<void> {
    const cutoff = Date.now() - AUDIT_FILE_RETENTION_MS;
    let entries: string[];
    try {
      entries = await readdir(auditDir);
    } catch {
      return; // directory may not exist yet
    }

    for (const entry of entries) {
      if (!entry.startsWith('audit-') || !entry.endsWith('.json')) continue;
      const filePath = join(auditDir, entry);
      try {
        const info = await stat(filePath);
        if (info.mtimeMs < cutoff) {
          await unlink(filePath);
          logger.debug({ filePath }, 'Removed expired audit trace file');
        }
      } catch {
        // ignore per-file errors
      }
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
