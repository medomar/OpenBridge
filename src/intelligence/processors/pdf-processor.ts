/**
 * PDF Processor — Extract text and metadata from PDF files using pdf-parse.
 *
 * Reads a PDF file buffer and extracts:
 * - Full plain text from all pages
 * - Page count and document metadata (author, title, creator)
 *
 * OCR fallback: If pdf-parse returns near-empty text (< 50 chars per page),
 * pages are rendered to images via Puppeteer and processed with tesseract.js.
 */

import { readFile } from 'fs/promises';
import { createLogger } from '../../core/logger.js';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (
  buffer: Buffer,
  options?: Record<string, unknown>,
) => Promise<{
  numpages: number;
  text: string;
  info: Record<string, unknown> | null | undefined;
}>;

import type { ProcessorResult } from '../../types/intelligence.js';

const logger = createLogger('pdf-processor');

/** Minimum average chars per page before OCR fallback triggers */
const OCR_THRESHOLD_CHARS_PER_PAGE = 50;

/**
 * Process a PDF file and extract text content and metadata.
 * Falls back to OCR via tesseract.js if pdf-parse returns near-empty text.
 *
 * @param filePath - Absolute path to the PDF file
 * @returns ProcessorResult with rawText, empty tables/images, and PDF metadata
 */
export async function processPdf(filePath: string): Promise<ProcessorResult> {
  const buffer = await readFile(filePath);
  const data = await pdfParse(buffer);

  const metadata: Record<string, unknown> = {
    pages: data.numpages,
  };

  const info = data.info;
  if (info) {
    if (typeof info['Author'] === 'string' && info['Author']) {
      metadata['author'] = info['Author'];
    }
    if (typeof info['Title'] === 'string' && info['Title']) {
      metadata['title'] = info['Title'];
    }
    if (typeof info['Creator'] === 'string' && info['Creator']) {
      metadata['creator'] = info['Creator'];
    }
    if (typeof info['Producer'] === 'string' && info['Producer']) {
      metadata['producer'] = info['Producer'];
    }
    if (typeof info['CreationDate'] === 'string' && info['CreationDate']) {
      metadata['creationDate'] = info['CreationDate'];
    }
  }

  const textLength = data.text.trim().length;
  const charsPerPage = data.numpages > 0 ? textLength / data.numpages : textLength;

  // If text extraction yielded meaningful content, return it directly
  if (charsPerPage >= OCR_THRESHOLD_CHARS_PER_PAGE) {
    return {
      rawText: data.text,
      tables: [],
      images: [],
      metadata,
    };
  }

  // Scanned PDF detected — attempt OCR fallback
  logger.info(
    { filePath, pages: data.numpages, charsPerPage: Math.round(charsPerPage) },
    'PDF text extraction yielded near-empty text, attempting OCR fallback',
  );

  try {
    const ocrText = await ocrPdfPages(filePath, data.numpages);
    metadata['ocrApplied'] = true;
    return {
      rawText: ocrText,
      tables: [],
      images: [],
      metadata,
    };
  } catch (err) {
    logger.warn({ err, filePath }, 'OCR fallback failed, returning original (sparse) text');
    metadata['ocrAttempted'] = true;
    metadata['ocrError'] = err instanceof Error ? err.message : String(err);
    return {
      rawText: data.text,
      tables: [],
      images: [],
      metadata,
    };
  }
}

// ---------------------------------------------------------------------------
// OCR helpers — Puppeteer renders PDF pages to images, tesseract.js reads them
// ---------------------------------------------------------------------------

/** Minimal Puppeteer typings to avoid requiring @types/puppeteer at build time */
interface PuppeteerPage {
  setViewport(opts: { width: number; height: number }): Promise<void>;
  goto(url: string, opts: { waitUntil: string }): Promise<unknown>;
  screenshot(opts: { type: 'png'; encoding: 'binary' }): Promise<Buffer>;
  close(): Promise<void>;
}

interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
}

interface PuppeteerModule {
  launch(opts: { headless: boolean; args: string[] }): Promise<PuppeteerBrowser>;
}

/** Minimal tesseract.js typings */
interface TesseractWorker {
  recognize(image: Buffer): Promise<{ data: { text: string } }>;
  terminate(): Promise<void>;
}

interface TesseractModule {
  createWorker(lang: string): Promise<TesseractWorker>;
}

/**
 * Render each PDF page to an image via Puppeteer and OCR it with tesseract.js.
 * Returns the merged OCR text for all pages.
 */
async function ocrPdfPages(filePath: string, pageCount: number): Promise<string> {
  let puppeteer: PuppeteerModule;
  try {
    const mod = (await import('puppeteer')) as unknown as {
      default?: PuppeteerModule;
    } & PuppeteerModule;
    puppeteer = mod.default ?? mod;
  } catch {
    throw new Error('Puppeteer is not installed. Run `npm install puppeteer` to enable PDF OCR.');
  }

  let Tesseract: TesseractModule;
  try {
    const mod = (await import('tesseract.js')) as unknown as {
      default?: TesseractModule;
    } & TesseractModule;
    Tesseract = mod.default ?? mod;
  } catch {
    throw new Error(
      'tesseract.js is not installed. Run `npm install tesseract.js` to enable PDF OCR.',
    );
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const worker = await Tesseract.createWorker('eng');

  try {
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 1600 });

      // pdf.js viewer renders a specific page when given #page=N fragment
      const fileUrl = `file://${filePath}#page=${pageNum}`;
      await page.goto(fileUrl, { waitUntil: 'networkidle0' });

      const screenshot = await page.screenshot({ type: 'png', encoding: 'binary' });
      await page.close();

      const { data } = await worker.recognize(screenshot);
      pageTexts.push(data.text);

      logger.debug(
        { filePath, page: pageNum, ocrChars: data.text.length },
        'OCR completed for page',
      );
    }

    const mergedText = pageTexts.join('\n\n');
    logger.info(
      { filePath, pages: pageCount, totalOcrChars: mergedText.length },
      'PDF OCR completed successfully',
    );
    return mergedText;
  } finally {
    await worker.terminate();
    await browser.close();
  }
}
