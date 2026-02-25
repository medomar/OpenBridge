import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createLogger } from './logger.js';

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

/** CORS headers for local development */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * FileServer — serves AI-generated content from `.openbridge/generated/` via HTTP.
 *
 * Routes:
 *   GET /shared/:filename  — serve a file from the generated/ directory
 *
 * Usage:
 *   const server = new FileServer('/path/to/workspace');
 *   await server.start();
 *   // Files at <workspacePath>/.openbridge/generated/report.html
 *   // are available at http://localhost:3001/shared/report.html
 *   await server.stop();
 */
export class FileServer {
  private readonly generatedDir: string;
  private readonly port: number;
  private server: Server | null = null;

  constructor(workspacePath: string, port: number = DEFAULT_PORT) {
    this.generatedDir = path.join(workspacePath, '.openbridge', 'generated');
    this.port = port;
  }

  /** Returns the base URL for the file server */
  get baseUrl(): string {
    return `http://localhost:${this.port}`;
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

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const match = url.match(/^\/shared\/([^/]+)$/);
    if (!match || req.method !== 'GET') {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('Not found');
      return;
    }

    const rawFilename = match[1]!;

    // Security: reject path traversal attempts
    if (rawFilename.includes('..') || rawFilename.includes('/') || rawFilename.includes('\\')) {
      res.writeHead(400, { 'Content-Type': 'text/plain', ...CORS_HEADERS });
      res.end('Invalid filename');
      return;
    }

    const filePath = path.join(this.generatedDir, rawFilename);
    const ext = path.extname(rawFilename).toLowerCase();
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
