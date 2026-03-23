import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WEBCHAT_HTML } from '../../../src/connectors/webchat/ui-bundle.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundleFilePath = path.resolve(__dirname, '../../../src/connectors/webchat/ui-bundle.ts');

// ---- Mock: node:http (captures the request handler) ----

interface MockResponse {
  writeHead: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

const capturedHandlers: Array<(req: { url?: string }, res: MockResponse) => void> = [];

vi.mock('node:http', () => ({
  createServer: vi
    .fn()
    .mockImplementation((handler: (req: { url?: string }, res: MockResponse) => void) => {
      capturedHandlers.push(handler);
      return {
        listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
        close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
        on: vi.fn(),
      };
    }),
}));

// ---- Mock: ws ----

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn((cb?: () => void) => cb?.()),
  })),
}));

// ---- Mock: logger ----

vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---- Mock: qr-store ----

vi.mock('../../../src/core/qr-store.js', () => ({
  getQrCode: vi.fn().mockReturnValue(null),
}));

// ---- Mock: webchat-auth (hoisted — use literal token) ----

vi.mock('../../../src/connectors/webchat/webchat-auth.js', () => ({
  getOrCreateAuthToken: vi.fn().mockReturnValue('ui-test-token'),
}));

// ---- Tests ----

describe('WebChat UI Bundle', () => {
  beforeEach(() => {
    capturedHandlers.length = 0;
  });

  it('bundled HTML is served with HTTP 200 on root path', async () => {
    const { WebChatConnector } =
      await import('../../../src/connectors/webchat/webchat-connector.js');
    const connector = new WebChatConnector({});
    await connector.initialize();

    expect(capturedHandlers.length).toBeGreaterThan(0);

    const handler = capturedHandlers[capturedHandlers.length - 1]!;
    const mockRes: MockResponse = {
      writeHead: vi.fn(),
      setHeader: vi.fn(),
      end: vi.fn(),
    };

    handler({ url: '/', headers: { authorization: 'Bearer ui-test-token' } }, mockRes);

    expect(mockRes.writeHead).toHaveBeenCalledWith(200, {
      'Content-Type': 'text/html; charset=utf-8',
    });
    expect(mockRes.end).toHaveBeenCalledWith(WEBCHAT_HTML);

    await connector.shutdown();
  });

  it('contains required UI elements', () => {
    expect(WEBCHAT_HTML).toMatch(/^<!DOCTYPE html>/i);
    expect(WEBCHAT_HTML).toContain('OpenBridge WebChat');
    expect(WEBCHAT_HTML).toContain('id="msgs"');
    expect(WEBCHAT_HTML).toContain('id="inp"');
    expect(WEBCHAT_HTML).toContain('id="send"');
    expect(WEBCHAT_HTML).toContain('id="form"');
    expect(WEBCHAT_HTML).toContain('role="log"');
    expect(WEBCHAT_HTML).toContain('role="status"');
  });

  it('supports dark mode toggle', () => {
    expect(WEBCHAT_HTML).toContain('id="theme-toggle"');
    expect(WEBCHAT_HTML).toContain('data-theme="light"');
    expect(WEBCHAT_HTML).toContain("data-theme='dark'");
    expect(WEBCHAT_HTML).toContain('Toggle dark mode');
  });

  it('contains markdown code block support', () => {
    expect(WEBCHAT_HTML).toContain('.code-block');
    expect(WEBCHAT_HTML).toContain('.bubble.ai code');
    expect(WEBCHAT_HTML).toContain('.bubble.ai pre');
    expect(WEBCHAT_HTML).toContain('hljs');
  });

  it('build script generates a valid bundle', () => {
    const bundleContent = readFileSync(bundleFilePath, 'utf8');
    expect(bundleContent).toContain('AUTO-GENERATED');
    expect(bundleContent).toContain('export const WEBCHAT_HTML');
    expect(bundleContent).toContain('<!DOCTYPE html>');
  });
});
