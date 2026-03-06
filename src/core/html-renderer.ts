import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createLogger } from './logger.js';

const logger = createLogger('html-renderer');

export type ImageFormat = 'png' | 'jpeg';

/** Parsed natural dimensions from an SVG element */
export interface SvgDimensions {
  width?: number;
  height?: number;
}

/**
 * Parse the natural width/height from an SVG string.
 * Reads `viewBox="minX minY width height"` first; falls back to `width`/`height` attributes.
 */
export function parseSvgDimensions(svg: string): SvgDimensions {
  // viewBox="minX minY width height" — capture the 3rd and 4th values
  const vbMatch = /viewBox\s*=\s*["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*["']/.exec(svg);
  if (vbMatch) {
    return {
      width: Math.round(parseFloat(vbMatch[1]!)),
      height: Math.round(parseFloat(vbMatch[2]!)),
    };
  }
  const wMatch = /\bwidth\s*=\s*["']([\d.]+)(?:px)?["']/.exec(svg);
  const hMatch = /\bheight\s*=\s*["']([\d.]+)(?:px)?["']/.exec(svg);
  return {
    width: wMatch ? Math.round(parseFloat(wMatch[1]!)) : undefined,
    height: hMatch ? Math.round(parseFloat(hMatch[1]!)) : undefined,
  };
}

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

  /**
   * Render an SVG string to an image file.
   *
   * The SVG is wrapped in a minimal HTML document sized to the SVG's natural dimensions
   * (derived from `viewBox` or `width`/`height` attributes). Dimensions can be overridden
   * via `options.width` / `options.height`.
   *
   * @param svg     Full SVG markup string
   * @param options Rendering options (width/height default to SVG's natural size, or 800×600)
   * @returns       RenderResult with the output file path and metadata
   */
  async renderSvgString(svg: string, options: RenderOptions = {}): Promise<RenderResult> {
    const dims = parseSvgDimensions(svg);
    const width = options.width ?? dims.width ?? 800;
    const height = options.height ?? dims.height ?? 600;

    // Wrap SVG in a minimal HTML page sized to match
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;overflow:hidden;}body{width:${width}px;height:${height}px;}</style></head><body>${svg}</body></html>`;
    return this.captureWithPuppeteer({ html }, { ...options, width, height });
  }

  /**
   * Render an SVG file to an image file.
   *
   * @param svgFilePath  Absolute path to the SVG file to render
   * @param options      Rendering options
   * @returns            RenderResult with the output file path and metadata
   */
  async renderSvgFile(svgFilePath: string, options: RenderOptions = {}): Promise<RenderResult> {
    const resolved = path.resolve(svgFilePath);
    await fs.access(resolved);
    const svgContent = await fs.readFile(resolved, 'utf-8');
    return this.renderSvgString(svgContent, options);
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

/**
 * Convenience function — render an SVG string to an image in the workspace's generated folder.
 *
 * @param workspacePath  Absolute path to the workspace (`.openbridge/generated/` is created inside)
 * @param svg            SVG markup string
 * @param options        Rendering options (width/height default to SVG's natural dimensions)
 * @returns              RenderResult
 */
export async function renderSvgToImage(
  workspacePath: string,
  svg: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const renderer = new HTMLRenderer(workspacePath);
  return renderer.renderSvgString(svg, options);
}

// ---------------------------------------------------------------------------
// Mermaid rendering support
// ---------------------------------------------------------------------------

export interface MermaidRenderOptions extends RenderOptions {
  /** Mermaid theme. Default: 'default' */
  theme?: 'default' | 'dark' | 'forest' | 'neutral';
  /** Background color (CSS color string). Default: 'white' */
  backgroundColor?: string;
}

export interface MermaidRenderResult extends RenderResult {
  /** The Mermaid definition that was rendered */
  definition: string;
  /** Which backend produced the image */
  backend: 'mermaid-ink' | 'puppeteer';
}

/**
 * MermaidRenderer — converts Mermaid diagram definitions to PNG images.
 *
 * Rendering backends (tried in order):
 *   1. mermaid.ink HTTP API  — no installation required, needs network access
 *   2. Puppeteer + Mermaid CDN — requires Puppeteer, renders locally via browser
 *
 * Usage:
 *   const renderer = new MermaidRenderer('/path/to/workspace');
 *   const result = await renderer.renderDefinition('graph TD; A-->B;');
 *   console.log(result.outputPath);
 */
export class MermaidRenderer {
  private readonly workspacePath: string;
  private readonly outputDir: string;

  private static readonly MERMAID_INK_BASE = 'https://mermaid.ink';

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.outputDir = path.join(workspacePath, '.openbridge', 'generated');
  }

  /**
   * Check whether any Mermaid rendering backend is potentially available.
   * Always returns true because mermaid.ink API requires no local installation.
   * Puppeteer availability is checked separately via HTMLRenderer.isAvailable().
   */
  static isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /**
   * Render a Mermaid diagram definition to an image file.
   *
   * Tries mermaid.ink API first; falls back to Puppeteer + Mermaid.js CDN.
   *
   * @param definition  Mermaid diagram definition string (e.g. "graph TD; A-->B;")
   * @param options     Rendering options
   * @returns           MermaidRenderResult with output path, metadata, and backend used
   */
  async renderDefinition(
    definition: string,
    options: MermaidRenderOptions = {},
  ): Promise<MermaidRenderResult> {
    await fs.mkdir(this.outputDir, { recursive: true });

    // Backend 1: mermaid.ink HTTP API
    try {
      return await this.renderViaMermaidInk(definition, options);
    } catch (inkErr) {
      logger.warn({ err: inkErr }, 'mermaid.ink API unavailable, falling back to Puppeteer');
    }

    // Backend 2: Puppeteer + Mermaid.js CDN
    try {
      return await this.renderViaPuppeteer(definition, options);
    } catch (puppeteerErr) {
      throw new Error(
        `Mermaid rendering failed. mermaid.ink is unreachable and Puppeteer is not available.\n` +
          `Install Puppeteer with \`npm install puppeteer\` for local rendering.\n` +
          `Puppeteer error: ${(puppeteerErr as Error).message}`,
      );
    }
  }

  /**
   * Render a Mermaid definition to an SVG string using the mermaid.ink API.
   *
   * @param definition  Mermaid diagram definition string
   * @param theme       Mermaid theme. Default: 'default'
   * @returns           SVG markup string
   */
  async renderToSvgString(
    definition: string,
    theme: MermaidRenderOptions['theme'] = 'default',
  ): Promise<string> {
    const payload = JSON.stringify({ code: definition, mermaid: { theme } });
    const encoded = Buffer.from(payload).toString('base64url');
    const url = `${MermaidRenderer.MERMAID_INK_BASE}/svg/${encoded}`;

    const response = await fetch(url, {
      headers: { Accept: 'image/svg+xml,*/*' },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      throw new Error(`mermaid.ink SVG request failed: ${response.status} ${response.statusText}`);
    }

    return response.text();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async renderViaMermaidInk(
    definition: string,
    options: MermaidRenderOptions,
  ): Promise<MermaidRenderResult> {
    const { theme = 'default', backgroundColor = 'white' } = options;

    // mermaid.ink accepts a JSON payload base64url-encoded in the URL path.
    // The `bgColor` param uses '!' instead of '#' for hex colors.
    const payload = JSON.stringify({ code: definition, mermaid: { theme } });
    const encoded = Buffer.from(payload).toString('base64url');
    const bgParam = backgroundColor.startsWith('#')
      ? `!${backgroundColor.slice(1)}`
      : backgroundColor;
    const url = `${MermaidRenderer.MERMAID_INK_BASE}/img/${encoded}?bgColor=${bgParam}`;

    const response = await fetch(url, {
      headers: { Accept: 'image/png,*/*' },
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) {
      throw new Error(`mermaid.ink request failed: ${response.status} ${response.statusText}`);
    }

    const outputFilename = `mermaid-${randomUUID()}.png`;
    const outputPath = path.join(this.outputDir, outputFilename);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(outputPath, buffer);

    const stat = await fs.stat(outputPath);

    logger.info({ outputPath, sizeBytes: stat.size }, 'Mermaid diagram rendered via mermaid.ink');

    return {
      outputPath,
      format: 'png',
      sizeBytes: stat.size,
      definition,
      backend: 'mermaid-ink',
    };
  }

  private async renderViaPuppeteer(
    definition: string,
    options: MermaidRenderOptions,
  ): Promise<MermaidRenderResult> {
    const { theme = 'default', format = 'png', width = 1280, height = 720, quality = 90 } = options;

    // Escape the definition for safe injection into an HTML attribute/script context
    const escaped = escapeHtmlAttribute(definition);

    const html = `<!DOCTYPE html>
<html><head>
  <meta charset="utf-8">
  <style>body{margin:0;padding:16px;background:white;}#diagram{display:inline-block;}</style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
</head><body>
  <div id="diagram" class="mermaid">${escaped}</div>
  <script>mermaid.initialize({ startOnLoad: true, theme: '${theme}' });</script>
</body></html>`;

    const htmlRenderer = new HTMLRenderer(this.workspacePath);
    const result = await htmlRenderer.renderHtmlString(html, {
      format,
      width,
      height,
      quality,
      waitForNetworkIdle: true,
    });

    logger.info({ outputPath: result.outputPath }, 'Mermaid diagram rendered via Puppeteer');

    return { ...result, definition, backend: 'puppeteer' };
  }
}

/** Escape a string for safe embedding as HTML text content (not attribute). */
function escapeHtmlAttribute(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convenience function — render a Mermaid diagram definition to a PNG image.
 *
 * @param workspacePath  Absolute path to the workspace (`.openbridge/generated/` is created inside)
 * @param definition     Mermaid diagram definition string
 * @param options        Rendering options (theme, backgroundColor, width, height)
 * @returns              MermaidRenderResult with output file path and metadata
 */
export async function renderMermaidToImage(
  workspacePath: string,
  definition: string,
  options: MermaidRenderOptions = {},
): Promise<MermaidRenderResult> {
  const renderer = new MermaidRenderer(workspacePath);
  return renderer.renderDefinition(definition, options);
}
