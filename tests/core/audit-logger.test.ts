import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditLogger } from '../../src/core/audit-logger.js';
import type { AuditEntry } from '../../src/core/audit-logger.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { OutboundMessage } from '../../src/types/message.js';

function createInbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: 'msg-1',
    source: 'whatsapp',
    sender: '+1234567890',
    rawContent: '/ai hello',
    content: 'hello',
    timestamp: new Date(),
    ...overrides,
  };
}

function createOutbound(overrides: Partial<OutboundMessage> = {}): OutboundMessage {
  return {
    target: 'whatsapp',
    recipient: '+1234567890',
    content: 'AI response here',
    replyTo: 'msg-1',
    ...overrides,
  };
}

describe('AuditLogger', () => {
  let logPath: string;

  beforeEach(() => {
    logPath = join(tmpdir(), `openbridge-audit-test-${Date.now()}.log`);
  });

  afterEach(async () => {
    try {
      await rm(logPath, { force: true });
    } catch {
      // ignore
    }
  });

  it('does not write when disabled', async () => {
    const logger = new AuditLogger({ enabled: false, logPath });

    await logger.logInbound(createInbound());

    await expect(readFile(logPath, 'utf-8')).rejects.toThrow();
  });

  it('writes inbound message entries as JSONL', async () => {
    const logger = new AuditLogger({ enabled: true, logPath });

    await logger.logInbound(createInbound());

    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]!) as AuditEntry;
    expect(entry.event).toBe('inbound');
    expect(entry.messageId).toBe('msg-1');
    expect(entry.sender).toBe('+1234567890');
    expect(entry.source).toBe('whatsapp');
    expect(entry.contentLength).toBe(5); // 'hello'.length
    expect(entry.timestamp).toBeDefined();
  });

  it('writes outbound message entries as JSONL', async () => {
    const logger = new AuditLogger({ enabled: true, logPath });

    await logger.logOutbound(createOutbound());

    const content = await readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim()) as AuditEntry;
    expect(entry.event).toBe('outbound');
    expect(entry.recipient).toBe('+1234567890');
    expect(entry.messageId).toBe('msg-1');
    expect(entry.contentLength).toBe(16); // 'AI response here'.length
  });

  it('writes auth_denied entries', async () => {
    const logger = new AuditLogger({ enabled: true, logPath });

    await logger.logAuthDenied('+9999999999');

    const content = await readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim()) as AuditEntry;
    expect(entry.event).toBe('auth_denied');
    expect(entry.sender).toBe('+9999999999');
  });

  it('writes rate_limited entries', async () => {
    const logger = new AuditLogger({ enabled: true, logPath });

    await logger.logRateLimited('+1234567890');

    const content = await readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim()) as AuditEntry;
    expect(entry.event).toBe('rate_limited');
    expect(entry.sender).toBe('+1234567890');
  });

  it('writes error entries', async () => {
    const logger = new AuditLogger({ enabled: true, logPath });

    await logger.logError('msg-1', 'Provider timeout');

    const content = await readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim()) as AuditEntry;
    expect(entry.event).toBe('error');
    expect(entry.messageId).toBe('msg-1');
    expect(entry.error).toBe('Provider timeout');
  });

  it('appends multiple entries to the same file', async () => {
    const logger = new AuditLogger({ enabled: true, logPath });

    await logger.logInbound(createInbound({ id: 'a' }));
    await logger.logInbound(createInbound({ id: 'b' }));
    await logger.logOutbound(createOutbound({ replyTo: 'a' }));

    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);

    const entries = lines.map((l) => JSON.parse(l) as AuditEntry);
    expect(entries[0]!.event).toBe('inbound');
    expect(entries[1]!.event).toBe('inbound');
    expect(entries[2]!.event).toBe('outbound');
  });

  it('creates parent directories if they do not exist', async () => {
    const nestedPath = join(tmpdir(), `ob-audit-${Date.now()}`, 'nested', 'audit.log');
    const logger = new AuditLogger({ enabled: true, logPath: nestedPath });

    await logger.logInbound(createInbound());

    const content = await readFile(nestedPath, 'utf-8');
    expect(content.trim()).toBeTruthy();

    // Clean up nested dirs
    await rm(join(tmpdir(), `ob-audit-${Date.now()}`), { recursive: true, force: true });
  });

  it('does not throw on write failure', async () => {
    // Use an invalid path (directory as file) to trigger write failure
    const logger = new AuditLogger({ enabled: true, logPath: '/dev/null/impossible' });

    // Should not throw — error is logged internally
    await expect(logger.logInbound(createInbound())).resolves.toBeUndefined();
  });

  it('includes ISO timestamp in entries', async () => {
    const logger = new AuditLogger({ enabled: true, logPath });

    await logger.logInbound(createInbound());

    const content = await readFile(logPath, 'utf-8');
    const entry = JSON.parse(content.trim()) as AuditEntry;
    // Should be a valid ISO date string
    expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
  });
});
