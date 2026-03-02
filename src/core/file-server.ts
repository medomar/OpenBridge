import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLogger } from './logger.js';
import type MemoryManager from '../memory/index.js';

const logger = createLogger('file-server');

/** MIME type map for supported file extensions */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Default port for the file server (separate from WebChat's 3000) */
const DEFAULT_PORT = 3001;

/** Default expiry for shareable links: 24 hours in ms */
const DEFAULT_EXPIRY_HOURS = 24;

/** system_config key used to persist shareable link mappings */
const SHARED_LINKS_CONFIG_KEY = 'shared_links';

/** CORS headers for local development */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** One entry in the shared-links map */
interface SharedLinkEntry {
  filename: string;
  filePath: string;
  expiresAt: string; // ISO-8601
}

/** Full map stored in system_config under SHARED_LINKS_CONFIG_KEY */
type SharedLinksMap = Record<string, SharedLinkEntry>;

/**
 * FileServer — serves AI-generated content from `.openbridge/generated/` via HTTP.
 *
 * Routes:
 *   GET /shared/:filename          — serve a file directly by name
 *   GET /shared/:uuid/:filename    — serve a file via a shareable UUID link (expiry checked)
 *
 * Usage:
 *   const server = new FileServer('/path/to/workspace');
 *   await server.start();
 *   // Serve by name:
 *   //   http://localhost:3001/shared/report.html
 *   // Create a shareable link:
 *   const url = await server.createShareableLink('report.html');
 *   //   http://localhost:3001/shared/<uuid>/report.html  (expires in 24 h)
 *   await server.stop();
 */
export class FileServer {
  private readonly generatedDir: string;
  private readonly port: number;
  private server: Server | null = null;

  /** Optional MemoryManager for persistent UUID → file mappings */
  private readonly memory: MemoryManager | null;

  /**
   * In-memory fallback when MemoryManager is unavailable.
   * Keys are UUIDs; values are SharedLinkEntry objects.
   */
  private readonly inMemoryLinks: SharedLinksMap = {};

  /** Public tunnel URL when a tunnel is active, null otherwise */
  private publicUrl: string | null = null;

  constructor(
    workspacePath: string,
    port: number = DEFAULT_PORT,
    memory: MemoryManager | null = null,
  ) {
    this.generatedDir = path.join(workspacePath, '.openbridge', 'generated');
    this.port = port;
    this.memory = memory;
  }

  /** Returns the base URL for the file server */
  get baseUrl(): string {
    return `http://localhost:${this.port}`;
  }

  /** Set the public tunnel URL. Pass null to clear and fall back to localhost. */
  setPublicUrl(url: string | null): void {
    this.publicUrl = url;
    logger.info({ publicUrl: url }, 'File server public URL updated');
  }

  /** Returns the public URL when a tunnel is active, localhost URL otherwise. */
  getFileUrl(): string {
    return this.publicUrl ?? this.baseUrl;
  }

  /** Returns the path to the generated files directory */
  get directory(): string {
    return this.generatedDir;
  }

  async start(): Promise<void> {
    // Ensure the generated directory exists
    await fs.mkdir(this.generatedDir, { recursive: true });

    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      void this.handleRequest(req, res);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.listen(this.port, 'localhost', () => {
        logger.info(
          { port: this.port, dir: this.generatedDir },
          'File server started — serving generated content',
        );
        resolve();
      });
      this.server!.on('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server!.close((err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
    this.server = null;
    logger.info('File server stopped');
  }

  /**
   * Create a shareable UUID link for a file in the generated directory.
   *
   * @param filename  Name of the file in `.openbridge/generated/` (no path separators)
   * @param expiryHours  Hours until the link expires (default 24)
   * @returns Full URL like `http://localhost:3001/shared/<uuid>/report.html`
   */
  async createShareableLink(
    filename: string,
    expiryHours: number = DEFAULT_EXPIRY_HOURS,
  ): Promise<string> {
    // Security: reject path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Invalid filename');
    }

    const filePath = path.join(this.generatedDir, filename);

    // Verify the file exists
    await fs.access(filePath);

    const uuid = randomUUID();
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

    const entry: SharedLinkEntry = { filename, filePath, expiresAt };

    await this.saveLink(uuid, entry);

    const url = `${this.getFileUrl()}/shared/${uuid}/${encodeURIComponent(filename)}`;
    logger.info({ uuid, filename, expiresAt }, 'Shareable link created');
    return url;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Load the full shared-links map from storage */
  private async loadLinks(): Promise<SharedLinksMap> {
    if (this.memory) {
      try {
        const raw = await this.memory.getSystemConfig(SHARED_LINKS_CONFIG_KEY);
        if (raw) return JSON.parse(raw) as SharedLinksMap;
      } catch {
        // Fall through to empty map
      }
      return {};
    }
    return { ...this.inMemoryLinks };
  }

  /** Persist the full shared-links map to storage */
  private async persistLinks(map: SharedLinksMap): Promise<void> {
    if (this.memory) {
      await this.memory.setSystemConfig(SHARED_LINKS_CONFIG_KEY, JSON.stringify(map));
    } else {
      // Update in-memory store
      for (const [k, v] of Object.entries(map)) {
        this.inMemoryLinks[k] = v;
      }
      // Remove keys that are no longer present
      for (const k of Object.keys(this.inMemoryLinks)) {
        if (!(k in map)) delete this.inMemoryLinks[k];
      }
    }
  }

  /** Save a single link entry */
  private async saveLink(uuid: string, entry: SharedLinkEntry): Promise<void> {
    const map = await this.loadLinks();
    map[uuid] = entry;
    await this.persistLinks(map);
  }

  /** Retrieve and validate a link entry; returns null if not found or expired */
  private async resolveLink(uuid: string): Promise<SharedLinkEntry | null> {
    const map = await this.loadLinks();
    const entry = map[uuid];
    if (!entry) return null;

    if (new Date(entry.expiresAt) < new Date()) {
      // Clean up expired entry
      delete map[uuid];
      await this.persistLinks(map);
      return null;
    }

    return entry;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (req.method !== 'GET') {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('Not found');
      return;
    }

    // Route: GET /shared/:uuid/:filename  (UUID-based shareable link)
    const uuidMatch = url.match(/^\/shared\/([^/]+)\/([^/]+)$/);
    if (uuidMatch) {
      await this.handleShareableLink(res, uuidMatch[1]!, uuidMatch[2]!);
      return;
    }

    // Route: GET /shared/:filename  (direct filename)
    const directMatch = url.match(/^\/shared\/([^/]+)$/);
    if (directMatch) {
      await this.handleDirectFile(res, directMatch[1]!);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
    res.end('Not found');
  }

  /** Serve a file via its UUID shareable link */
  private async handleShareableLink(
    res: ServerResponse,
    uuid: string,
    rawFilename: string,
  ): Promise<void> {
    // Security: reject path traversal in either segment
    if (uuid.includes('/') || uuid.includes('\\') || uuid.includes('..')) {
      res.writeHead(400, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('Invalid link');
      return;
    }

    const entry = await this.resolveLink(uuid);
    if (!entry) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('Link not found or expired');
      return;
    }

    // Decode the filename from the URL and verify it matches the stored entry
    const decodedFilename = decodeURIComponent(rawFilename);
    if (decodedFilename !== entry.filename) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('File not found');
      return;
    }

    await this.serveFile(res, entry.filePath, entry.filename);
  }

  /** Serve a file directly by name from the generated directory */
  private async handleDirectFile(res: ServerResponse, rawFilename: string): Promise<void> {
    // Security: reject path traversal attempts
    if (rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('Invalid filename');
      return;
    }

    const filePath = path.join(this.generatedDir, rawFilename);
    await this.serveFile(res, filePath, rawFilename);
  }

  /** Read and write a file to the response */
  private async serveFile(res: ServerResponse, filePath: string, filename: string): Promise<void> {
    const ext = path.extname(filename).toLowerCase();
    const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';

    let data: Buffer;
    try {
      data = await fs.readFile(filePath);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('File not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': data.length,
      ...CORS_HEADERS,
    });
    res.end(data);
  }
}
