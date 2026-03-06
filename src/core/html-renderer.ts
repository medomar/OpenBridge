import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLogger } from './logger.js';

const logger = createLogger('html-renderer');

export type ImageFormat = 'png' | 'jpeg';

export interface RenderOptions {
  /** Output image format. Default: 'png' */
  format?: ImageFormat;
  /** Viewport width in pixels. Default: 1280 */
  width?: number;
  /** Viewport height in pixels. Default: 720 */
  height?: number;
  /** JPEG quality (1-100, ignored for PNG). Default: 90 */
  quality?: number;
  /** Wait for network idle before capturing (slower but more reliable). Default: false */
  waitForNetworkIdle?: boolean;
  /** Full-page screenshot (captures content beyond viewport). Default: false */
  fullPage?: boolean;
}

export interface RenderResult {
  /** Absolute path to the rendered image file */
  outputPath: string;
  /** File format */
  format: ImageFormat;
  /** File size in bytes */
  sizeBytes: number;
}

// ---------------------------------------------------------------------------
// Minimal Puppeteer typings — avoids requiring @types/puppeteer at build time
// ---------------------------------------------------------------------------

interface PuppeteerPage {
  setViewport(opts: { width: number; height: number }): Promise<void>;
  setContent(html: string, opts: { waitUntil: string }): Promise<void>;
  goto(url: string, opts: { waitUntil: string }): Promise<unknown>;
  screenshot(opts: {
    path: string;
    type: 'png' | 'jpeg';
    quality?: number;
    fullPage?: boolean;
  }): Promise<unknown>;
}

interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}

interface PuppeteerModule {
  launch(opts: { headless: boolean; args: string[] }): Promise<PuppeteerBrowser>;
}

/**
 * HTMLRenderer — converts HTML content to PNG/JPEG images using Puppeteer.
 *
 * Puppeteer is an optional dependency. If not installed, `isAvailable()` returns false
 * and `render*` methods throw a descriptive error.
 *
 * Usage:
 *   const renderer = new HTMLRenderer('/path/to/workspace');
 *   if (await HTMLRenderer.isAvailable()) {
 *     const result = await renderer.renderHtmlString('<h1>Hello</h1>');
 *     console.log(result.outputPath);
 *   }
 */
export class HTMLRenderer {
  private readonly outputDir: string;

  constructor(workspacePath: string) {
    this.outputDir = path.join(workspacePath, '.openbridge', 'generated');
  }

  /**
   * Check whether Puppeteer is installed and usable.
   * This is a fast check — no browser launch.
   */
  static async isAvailable(): Promise<boolean> {
    try {
      await import('puppeteer');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Render an HTML string to an image file.
   *
   * @param html      Full HTML document string (or fragment — wrapped in a minimal document if no <html> tag)
   * @param options   Rendering options
   * @returns         RenderResult with the output file path and metadata
   */
  async renderHtmlString(html: string, options: RenderOptions = {}): Promise<RenderResult> {
    const trimmed = html.trim();
    const normalized =
      trimmed.toLowerCase().startsWith('<!doctype') || trimmed.includes('<html')
        ? html
        : `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;font-family:sans-serif;}</style></head><body>${html}</body></html>`;

    return this.captureWithPuppeteer({ html: normalized }, options);
  }

  /**
   * Render an HTML file to an image file.
   *
   * @param htmlFilePath  Absolute path to the HTML file to render
   * @param options       Rendering options
   * @returns             RenderResult with the output file path and metadata
   */
  async renderHtmlFile(htmlFilePath: string, options: RenderOptions = {}): Promise<RenderResult> {
    const resolved = path.resolve(htmlFilePath);
    // Ensure the file exists before launching browser
    await fs.access(resolved);
    return this.captureWithPuppeteer({ filePath: resolved }, options);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async loadPuppeteer(): Promise<PuppeteerModule> {
    try {
      const mod = (await import('puppeteer')) as { default?: PuppeteerModule } & PuppeteerModule;
      // Handle both CommonJS-wrapped and ESM puppeteer exports
      return mod.default ?? mod;
    } catch {
      throw new Error(
        'Puppeteer is not installed. Run `npm install puppeteer` to enable HTML-to-image rendering.',
      );
    }
  }

  private async captureWithPuppeteer(
    source: { html: string } | { filePath: string },
    options: RenderOptions,
  ): Promise<RenderResult> {
    const {
      format = 'png',
      width = 1280,
      height = 720,
      quality = 90,
      waitForNetworkIdle = false,
      fullPage = false,
    } = options;

    const puppeteer = await this.loadPuppeteer();

    await fs.mkdir(this.outputDir, { recursive: true });

    const ext = format === 'jpeg' ? 'jpg' : format;
    const outputFilename = `render-${randomUUID()}.${ext}`;
    const outputPath = path.join(this.outputDir, outputFilename);

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height });

      const waitUntil = waitForNetworkIdle ? 'networkidle0' : 'load';

      if ('html' in source) {
        await page.setContent(source.html, { waitUntil });
      } else {
        await page.goto(`file://${source.filePath}`, { waitUntil });
      }

      if (format === 'jpeg') {
        await page.screenshot({ path: outputPath, type: 'jpeg', quality, fullPage });
      } else {
        await page.screenshot({ path: outputPath, type: 'png', fullPage });
      }

      const stat = await fs.stat(outputPath);

      logger.info(
        { outputPath, format, sizeBytes: stat.size, width, height },
        'HTML rendered to image',
      );

      return { outputPath, format, sizeBytes: stat.size };
    } finally {
      await browser.close();
    }
  }
}

/**
 * Convenience function — render an HTML string to an image in the workspace's generated folder.
 *
 * @param workspacePath  Absolute path to the workspace (`.openbridge/generated/` is created inside)
 * @param html           HTML content to render
 * @param options        Rendering options
 * @returns              RenderResult
 */
export async function renderHtmlToImage(
  workspacePath: string,
  html: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const renderer = new HTMLRenderer(workspacePath);
  return renderer.renderHtmlString(html, options);
}
