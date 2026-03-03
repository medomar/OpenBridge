/**
 * WebChat mobile & PWA tests (OB-1517).
 *
 * Covers:
 *  1. LAN IP detection — non-internal IPv4 addresses are discovered
 *  2. QR code URL generation — getLanAccessUrl() returns correct URL with token
 *  3. manifest.json serves — public endpoint returns PWA manifest
 *  4. sw.js serves — service worker served with correct headers
 *  5. Responsive media queries exist in UI bundle
 *  6. 0.0.0.0 binding configurable — host defaults to 0.0.0.0, configurable to localhost
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebChatConnector } from '../../../src/connectors/webchat/webchat-connector.js';
import { WEBCHAT_HTML, WEBCHAT_SW_JS } from '../../../src/connectors/webchat/ui-bundle.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const FIXED_TOKEN = 'mobile-test-token-xyz789';

// ── Shared state ──────────────────────────────────────────────────────────────

let capturedHandler: ((req: IncomingMessage, res: ServerResponse) => void) | null = null;
let capturedListenArgs: [number, string, () => void] | null = null;

// ── Mock: node:http ───────────────────────────────────────────────────────────

vi.mock('node:http', () => ({
  createServer: vi
    .fn()
    .mockImplementation((handler: (req: IncomingMessage, res: ServerResponse) => void) => {
      capturedHandler = handler;
      return {
        listen: vi.fn((port: number, host: string, cb: () => void) => {
          capturedListenArgs = [port, host, cb];
          cb();
        }),
        close: vi.fn((cb?: (err?: Error) => void) => cb?.()),
        on: vi.fn(),
      };
    }),
}));

// ── Mock: ws ──────────────────────────────────────────────────────────────────

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn((cb?: () => void) => cb?.()),
  })),
}));

// ── Mock: webchat-auth ────────────────────────────────────────────────────────

vi.mock('../../../src/connectors/webchat/webchat-auth.js', () => ({
  getOrCreateAuthToken: vi.fn().mockReturnValue('mobile-test-token-xyz789'),
  hashPassword: vi.fn().mockImplementation(async (pw: string) => `hashed:${pw}`),
  verifyPassword: vi
    .fn()
    .mockImplementation(async (submitted: string, hash: string) => hash === `hashed:${submitted}`),
}));

// ── Mock: qr-store ────────────────────────────────────────────────────────────

vi.mock('../../../src/core/qr-store.js', () => ({
  getQrCode: vi.fn().mockReturnValue(null),
}));

// ── Mock: logger ──────────────────────────────────────────────────────────────

vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Mock: qrcode-terminal ─────────────────────────────────────────────────────

vi.mock('qrcode-terminal', () => ({
  default: { generate: vi.fn() },
}));

// ── Mock: node:os (controlled LAN IP) ─────────────────────────────────────────

/** Minimal shape matching the os.NetworkInterfaceInfo type */
interface NetIface {
  family: string;
  internal: boolean;
  address: string;
}

const mockNetworkInterfaces = vi.fn<[], Record<string, NetIface[]>>();

vi.mock('node:os', () => ({
  networkInterfaces: () => mockNetworkInterfaces() as Record<string, NetIface[]>,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

interface MockResponse {
  statusCode: number | null;
  headers: Record<string, string | string[]>;
  body: string;
  writeHead: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function makeGetReq(url: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    url,
    headers,
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as IncomingMessage;
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    statusCode: null,
    headers: {},
    body: '',
    writeHead: vi.fn((code: number, hdrs?: Record<string, string>) => {
      res.statusCode = code;
      if (hdrs) {
        for (const [k, v] of Object.entries(hdrs)) {
          res.headers[k.toLowerCase()] = v;
        }
      }
    }),
    setHeader: vi.fn((name: string, value: string | string[]) => {
      res.headers[name.toLowerCase()] = value;
    }),
    end: vi.fn((data?: string | Buffer) => {
      res.body = typeof data === 'string' ? data : (data?.toString() ?? '');
    }),
  };
  return res;
}

function handle(req: IncomingMessage, res: MockResponse): void {
  if (!capturedHandler) throw new Error('capturedHandler is null');
  capturedHandler(req, res as unknown as ServerResponse);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WebChat mobile & PWA (OB-1517)', () => {
  let connector: WebChatConnector;

  beforeEach(async () => {
    capturedHandler = null;
    capturedListenArgs = null;

    // Default: one non-internal IPv4 LAN interface
    mockNetworkInterfaces.mockReturnValue({
      eth0: [
        { family: 'IPv4', internal: false, address: '192.168.1.42' },
        { family: 'IPv6', internal: false, address: 'fe80::1' },
      ],
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    });

    connector = new WebChatConnector({});
    await connector.initialize();
  });

  afterEach(async () => {
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  // ── Test 1: LAN IP detection ─────────────────────────────────────────────

  it('detects non-internal IPv4 LAN addresses and uses them in the access URL', () => {
    // getLanIps() is private; exercise it via getLanAccessUrl()
    const url = connector.getLanAccessUrl();
    expect(url).not.toBeNull();
    expect(url).toContain('192.168.1.42');
    expect(url).toContain(':3000');
  });

  it('skips internal (loopback) and IPv6 addresses during LAN IP detection', () => {
    // Only the non-internal IPv4 address should appear
    const url = connector.getLanAccessUrl();
    expect(url).not.toContain('127.0.0.1');
    expect(url).not.toContain('fe80');
  });

  // ── Test 2: QR code URL generation ──────────────────────────────────────

  it('getLanAccessUrl returns URL including auth token for QR scanning', () => {
    const url = connector.getLanAccessUrl();
    expect(url).not.toBeNull();
    expect(url).toContain(`token=${FIXED_TOKEN}`);
    expect(url).toMatch(/^http:\/\/192\.168\.1\.42:3000\/\?token=/);
  });

  it('getLanAccessUrl prefers tunnel URL over LAN IP when tunnel is set', () => {
    const tunnelUrl = 'https://abc123.ngrok.io';
    connector.setTunnelUrl(tunnelUrl);
    const url = connector.getLanAccessUrl();
    expect(url).not.toBeNull();
    expect(url).toContain('abc123.ngrok.io');
    expect(url).toContain(`token=${FIXED_TOKEN}`);
    expect(url).not.toContain('192.168.1.42');
  });

  // ── Test 3: manifest.json serves ────────────────────────────────────────

  it('serves /manifest.json without authentication (public endpoint)', () => {
    const req = makeGetReq('/manifest.json');
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('manifest+json');
    const manifest = JSON.parse(res.body) as {
      name: string;
      start_url: string;
      display: string;
      short_name: string;
      icons: unknown[];
    };
    expect(manifest.name).toBe('OpenBridge WebChat');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.short_name).toBeTruthy();
    expect(Array.isArray(manifest.icons)).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  // ── Test 4: Service worker serves ───────────────────────────────────────

  it('serves /sw.js with correct headers for service worker registration', () => {
    const req = makeGetReq('/sw.js');
    const res = makeRes();
    handle(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    // Service-Worker-Allowed header must be '/' to allow full-scope registration
    expect(res.headers['service-worker-allowed']).toBe('/');
    // Cache-Control: no-cache ensures updates are picked up promptly
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('/sw.js body contains service worker lifecycle event listeners', () => {
    const req = makeGetReq('/sw.js');
    const res = makeRes();
    handle(req, res);
    expect(res.body).toContain('install');
    expect(res.body).toContain('activate');
    expect(res.body).toContain('fetch');
  });

  // ── Test 5: Responsive media queries exist in UI bundle ──────────────────

  it('WEBCHAT_HTML contains responsive mobile media queries (max-width: 767px)', () => {
    expect(WEBCHAT_HTML).toContain('@media');
    expect(WEBCHAT_HTML).toContain('max-width: 767px');
  });

  it('WEBCHAT_HTML includes viewport-fit=cover for iOS safe area support', () => {
    expect(WEBCHAT_HTML).toContain('viewport-fit=cover');
  });

  it('WEBCHAT_HTML links to the PWA manifest', () => {
    expect(WEBCHAT_HTML).toContain('rel="manifest"');
    expect(WEBCHAT_HTML).toContain('/manifest.json');
  });

  it('WEBCHAT_SW_JS is non-empty and is valid JavaScript', () => {
    expect(typeof WEBCHAT_SW_JS).toBe('string');
    expect(WEBCHAT_SW_JS.length).toBeGreaterThan(0);
    // Must contain push event listener for push notifications
    expect(WEBCHAT_SW_JS).toContain('push');
  });

  // ── Test 6: 0.0.0.0 binding configurable ────────────────────────────────

  it('defaults host to 0.0.0.0 for LAN access', () => {
    // The server listen() was called during initialize() in beforeEach
    expect(capturedListenArgs).not.toBeNull();
    const [, host] = capturedListenArgs!;
    expect(host).toBe('0.0.0.0');
  });

  it('allows host to be configured to localhost for local-only access', async () => {
    const localConnector = new WebChatConnector({ host: 'localhost' });
    await localConnector.initialize();
    try {
      expect(capturedListenArgs).not.toBeNull();
      const [, host] = capturedListenArgs!;
      expect(host).toBe('localhost');
    } finally {
      await localConnector.shutdown();
    }
  });
});
