/**
 * Integration tests for remote file/app delivery via output markers.
 *
 * Phase 160 — Integration Tests for Remote Deploy Flow (OB-1635, OB-1636, OB-1637)
 *
 * These tests verify that:
 * - SHARE:telegram markers are processed into native Telegram file attachments (OB-1635)
 * - APP:start markers fall back to SHARE attachments for remote channels (OB-1636)
 * - APP:start markers use the auto-tunnel URL when cloudflared is available (OB-1637)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  OutputMarkerProcessor,
  type OutputMarkerDeps,
} from '../../src/core/output-marker-processor.js';
import type { AppServer } from '../../src/core/app-server.js';
import type { Connector, ConnectorEvents } from '../../src/types/connector.js';
import type { OutboundMessage } from '../../src/types/message.js';

// ---------------------------------------------------------------------------
// Mock Telegram connector with file attachment support
// ---------------------------------------------------------------------------

class MockTelegramConnector implements Connector {
  readonly name = 'telegram';
  readonly sentMessages: OutboundMessage[] = [];
  readonly supportsFileAttachments = true as const;
  private connected = false;
  private readonly listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  async initialize(): Promise<void> {
    this.connected = true;
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener as (...args: unknown[]) => void);
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

// ---------------------------------------------------------------------------
// Helper: build OutputMarkerDeps with minimal mocked dependencies
// ---------------------------------------------------------------------------

function buildDeps(
  workspacePath: string,
  telegramConnector: MockTelegramConnector,
  extraDeps: Partial<OutputMarkerDeps> = {},
): OutputMarkerDeps {
  const connectors = new Map<string, Connector>();
  connectors.set('telegram', telegramConnector);

  return {
    getWorkspacePath: () => workspacePath,
    getEmailConfig: () => undefined,
    getFileServer: () => undefined,
    getAppServer: () => undefined,
    getRelay: () => undefined,
    getConnectors: () => connectors,
    getAuth: () => undefined,
    getWorkflowStore: () => undefined,
    getWorkflowEngine: () => undefined,
    getWorkflowScheduler: () => undefined,
    getIntegrationHub: () => undefined,
    ...extraDeps,
  };
}

// ---------------------------------------------------------------------------
// OB-1635: SHARE:telegram fallback path
// ---------------------------------------------------------------------------

describe('OB-1635 — SHARE:telegram fallback: Master response → Telegram attachment', () => {
  let workspacePath: string;
  let generatedDir: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(os.tmpdir(), 'ob-1635-'));
    generatedDir = path.join(workspacePath, '.openbridge', 'generated');
    await mkdir(generatedDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('SHARE:telegram marker delivers PDF file as Telegram attachment', async () => {
    // Arrange: write a report PDF into the generated directory
    const reportFilename = 'quarterly-report.pdf';
    const reportContent = Buffer.from('%PDF-1.4 mock content');
    await writeFile(path.join(generatedDir, reportFilename), reportContent);

    const telegramConnector = new MockTelegramConnector();
    const processor = new OutputMarkerProcessor(buildDeps(workspacePath, telegramConnector));

    // Master AI response includes:
    // - Channel context header injected by OB-1625
    // - SHARE:telegram marker (Master chose this because it saw channel=telegram in the header)
    const masterResponse = [
      '[Context: channel=telegram, sender=+1234567890, role=owner]',
      '',
      'Your quarterly report is ready.',
      `[SHARE:telegram]${reportFilename}[/SHARE]`,
    ].join('\n');

    // Act
    const cleaned = await processor.processShareMarkers(
      masterResponse,
      telegramConnector,
      '+1234567890',
    );

    // Assert: SHARE marker stripped — no [SHARE:...] remaining
    expect(cleaned).not.toContain('[SHARE:telegram]');

    // Assert: no localhost URL in the processed output (OB-F220 regression guard)
    expect(cleaned).not.toMatch(/localhost:\d+/);

    // Assert: Telegram connector received the file as a native attachment
    expect(telegramConnector.sentMessages).toHaveLength(1);
    const msg = telegramConnector.sentMessages[0]!;
    expect(msg.recipient).toBe('+1234567890');
    expect(msg.media).toBeDefined();
    expect(msg.media!.filename).toBe(reportFilename);
    expect(msg.media!.mimeType).toBe('application/pdf');
    expect(msg.media!.type).toBe('document');
    expect(Buffer.isBuffer(msg.media!.data)).toBe(true);
    expect(msg.media!.data.toString()).toBe(reportContent.toString());
  });

  it('SHARE:telegram strips marker and delivers CSV attachment', async () => {
    // Arrange
    const csvFilename = 'data-export.csv';
    const csvContent = Buffer.from('id,name\n1,Alice\n2,Bob');
    await writeFile(path.join(generatedDir, csvFilename), csvContent);

    const telegramConnector = new MockTelegramConnector();
    const processor = new OutputMarkerProcessor(buildDeps(workspacePath, telegramConnector));

    // Content with channel context header (OB-1625) and SHARE marker
    const content = [
      '[Context: channel=telegram, sender=+1234567890, role=owner]',
      '',
      'Here is the data export.',
      `[SHARE:telegram]${csvFilename}[/SHARE]`,
    ].join('\n');

    // Act
    const result = await processor.processShareMarkers(content, telegramConnector, '+1234567890');

    // Assert: no localhost URL and no SHARE marker in output
    expect(result).not.toMatch(/localhost:\d+/);
    expect(result).not.toContain('[SHARE:');

    // Assert: file was delivered as attachment with correct MIME type
    expect(telegramConnector.sentMessages).toHaveLength(1);
    const msg = telegramConnector.sentMessages[0]!;
    expect(msg.media!.mimeType).toBe('text/csv');
    expect(msg.media!.filename).toBe(csvFilename);
  });

  it('does not deliver when file is not under .openbridge/generated/ (security)', async () => {
    const telegramConnector = new MockTelegramConnector();
    const processor = new OutputMarkerProcessor(buildDeps(workspacePath, telegramConnector));

    // Attempt path traversal: file outside generated dir
    const content = `[SHARE:telegram]/etc/passwd[/SHARE]`;

    const result = await processor.processShareMarkers(content, telegramConnector, '+1234567890');

    // Security check blocks the delivery — no messages sent
    expect(telegramConnector.sentMessages).toHaveLength(0);
    // Marker is stripped
    expect(result).not.toContain('[SHARE:');
  });

  it('processAll() pipeline: SHARE:telegram marker in full content is processed', async () => {
    // Arrange
    const htmlFilename = 'report.html';
    const htmlContent = Buffer.from('<html><body>Report</body></html>');
    await writeFile(path.join(generatedDir, htmlFilename), htmlContent);

    const telegramConnector = new MockTelegramConnector();
    const processor = new OutputMarkerProcessor(buildDeps(workspacePath, telegramConnector));

    // Master response: context header from OB-1625 + prose + SHARE marker
    const masterResponse = [
      '[Context: channel=telegram, sender=+1234567890, role=owner]',
      '',
      'I have generated the HTML report for you.',
      `[SHARE:telegram]${htmlFilename}[/SHARE]`,
    ].join('\n');

    // Act: run the full processAll() pipeline
    const result = await processor.processAll(
      masterResponse,
      telegramConnector,
      '+1234567890',
      'msg-001',
      'telegram',
    );

    // Assert: marker consumed, no localhost URL
    expect(result).not.toContain('[SHARE:');
    expect(result).not.toMatch(/localhost:\d+/);

    // Assert: Telegram received the HTML file as document attachment
    expect(telegramConnector.sentMessages).toHaveLength(1);
    const msg = telegramConnector.sentMessages[0]!;
    expect(msg.media!.filename).toBe(htmlFilename);
    expect(msg.media!.mimeType).toBe('text/html');
  });
});

// ---------------------------------------------------------------------------
// OB-1636: APP:start → SHARE fallback for remote channels (no tunnel)
// ---------------------------------------------------------------------------

describe('OB-1636 — APP:start → SHARE fallback for remote channels', () => {
  let workspacePath: string;
  let generatedDir: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(os.tmpdir(), 'ob-1636-'));
    generatedDir = path.join(workspacePath, '.openbridge', 'generated');
    await mkdir(generatedDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('APP:start with source=telegram and no publicUrl falls back to SHARE:telegram marker', async () => {
    const telegramConnector = new MockTelegramConnector();

    // Mock AppServer: startApp returns instance with no publicUrl
    const mockAppServer = {
      startApp: vi.fn().mockResolvedValue({
        id: 'app-001',
        url: 'http://localhost:4000',
        publicUrl: null,
        appPath: '/myapp',
      }),
      stopApp: vi.fn(),
    };

    const deps = buildDeps(workspacePath, telegramConnector, {
      getAppServer: () => mockAppServer as unknown as AppServer,
    });
    const processor = new OutputMarkerProcessor(deps);

    // Act: process APP:start marker with source=telegram and no ensureTunnel
    const content = `[APP:start]/myapp[/APP]`;
    const result = await processor.processAppMarkers(content, 'telegram');

    // Assert: the APP:start marker is replaced with a SHARE:telegram marker
    // (not a localhost URL)
    expect(result).not.toContain('localhost');
    expect(result).toContain('[SHARE:telegram]');
    expect(result).toContain('/myapp/index.html');
  });

  it('APP:start with source=console uses localhost URL (console can access localhost)', async () => {
    const telegramConnector = new MockTelegramConnector();

    const mockAppServer = {
      startApp: vi.fn().mockResolvedValue({
        id: 'app-002',
        url: 'http://localhost:4000',
        publicUrl: null,
        appPath: '/myapp',
      }),
      stopApp: vi.fn(),
    };

    const deps = buildDeps(workspacePath, telegramConnector, {
      getAppServer: () => mockAppServer as unknown as AppServer,
    });
    const processor = new OutputMarkerProcessor(deps);

    // Act: process APP:start marker with source=console
    const content = `[APP:start]/myapp[/APP]`;
    const result = await processor.processAppMarkers(content, 'console');

    // Assert: console channel gets the localhost URL
    expect(result).toContain('localhost');
    expect(result).not.toContain('[SHARE:');
  });
});

// ---------------------------------------------------------------------------
// OB-1637: APP:start → auto-tunnel URL when cloudflared is available
// ---------------------------------------------------------------------------

describe('OB-1637 — APP:start uses auto-tunnel URL for remote channels', () => {
  let workspacePath: string;

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(os.tmpdir(), 'ob-1637-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(workspacePath, { recursive: true, force: true });
  });

  it('APP:start for Telegram user uses tunnel URL when ensureTunnel() returns one', async () => {
    const telegramConnector = new MockTelegramConnector();

    const mockAppServer = {
      startApp: vi.fn().mockResolvedValue({
        id: 'app-003',
        url: 'http://localhost:4000',
        publicUrl: null,
        appPath: '/dashboard',
      }),
      stopApp: vi.fn(),
    };

    // Mock ensureTunnel returning a public URL (simulates cloudflared auto-start)
    const ensureTunnel = vi.fn().mockResolvedValue('https://abc123.trycloudflare.com');

    const deps = buildDeps(workspacePath, telegramConnector, {
      getAppServer: () => mockAppServer as unknown as AppServer,
      ensureTunnel,
    });
    const processor = new OutputMarkerProcessor(deps);

    const content = `[APP:start]/dashboard[/APP]`;
    const result = await processor.processAppMarkers(content, 'telegram');

    // Assert: tunnel was attempted
    expect(ensureTunnel).toHaveBeenCalledOnce();

    // Assert: result contains the public tunnel URL, not localhost
    expect(result).toContain('abc123.trycloudflare.com');
    expect(result).not.toContain('localhost');

    // Assert: NOT a SHARE marker — we have a real public URL
    expect(result).not.toContain('[SHARE:');
  });

  it('APP:start for Telegram user falls back to SHARE when tunnel returns null', async () => {
    const telegramConnector = new MockTelegramConnector();

    const mockAppServer = {
      startApp: vi.fn().mockResolvedValue({
        id: 'app-004',
        url: 'http://localhost:4000',
        publicUrl: null,
        appPath: '/dashboard',
      }),
      stopApp: vi.fn(),
    };

    // ensureTunnel returns null (cloudflared not available)
    const ensureTunnel = vi.fn().mockResolvedValue(null);

    const deps = buildDeps(workspacePath, telegramConnector, {
      getAppServer: () => mockAppServer as unknown as AppServer,
      ensureTunnel,
    });
    const processor = new OutputMarkerProcessor(deps);

    const content = `[APP:start]/dashboard[/APP]`;
    const result = await processor.processAppMarkers(content, 'telegram');

    // Assert: tunnel was attempted
    expect(ensureTunnel).toHaveBeenCalledOnce();

    // Assert: falls back to SHARE:telegram when tunnel unavailable
    expect(result).toContain('[SHARE:telegram]');
    expect(result).not.toContain('localhost');
  });
});
