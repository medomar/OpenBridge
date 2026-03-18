/**
 * Unit tests for src/intelligence/processors/pdf-processor.ts
 *
 * Strategy:
 * - Use vi.doMock() + vi.resetModules() + dynamic import so that the SUT is
 *   reloaded fresh per test group, ensuring `require('pdf-parse')` picks up
 *   the mock registered via vi.doMock().
 * - Mock fs/promises (readFile) to avoid real file I/O.
 * - For the OCR fallback path: tesseract.js / puppeteer are loaded via
 *   dynamic import() inside ocrPdfPages() and are not installed as runtime
 *   deps, so the error branch is exercised naturally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProcessorResult } from '../../src/types/intelligence.js';

// ---------------------------------------------------------------------------
// Mock state shared across tests in this file
// ---------------------------------------------------------------------------

let mockReadFileFn: ReturnType<typeof vi.fn>;
let mockPdfParseFn: ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Dynamic SUT loader — reloads module with fresh mocks each time.
// ---------------------------------------------------------------------------

type PdfProcessorModule = { processPdf: (path: string) => Promise<ProcessorResult> };

async function loadSut(): Promise<PdfProcessorModule> {
  vi.resetModules();

  // Re-create fresh mock fns for this load so we get clean spies
  mockReadFileFn = vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake'));
  mockPdfParseFn = vi.fn();

  // Register mocks BEFORE the dynamic import so the SUT picks them up

  vi.doMock('fs/promises', (): any => ({ readFile: mockReadFileFn }));

  // The SUT does: (await import('pdf-parse')).default ?? module
  // So we need to expose the mock function as .default

  vi.doMock('pdf-parse', (): any => ({ default: mockPdfParseFn }));

  vi.doMock('../../src/core/logger.js', () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
  }));

  return import('../../src/intelligence/processors/pdf-processor.js') as Promise<PdfProcessorModule>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePdfData(
  text: string,
  pages = 1,
  info: Record<string, unknown> | null = null,
): { numpages: number; text: string; info: Record<string, unknown> | null } {
  return { numpages: pages, text, info };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processPdf', () => {
  let processPdf: PdfProcessorModule['processPdf'];

  beforeEach(async () => {
    const mod = await loadSut();
    processPdf = mod.processPdf;
  });

  afterEach(() => {
    vi.doUnmock('pdf-parse');
    vi.doUnmock('fs/promises');
    vi.doUnmock('../../src/core/logger.js');
  });

  // ── Happy path: text-based PDFs ──────────────────────────────────────────

  it('returns rawText and page metadata for a standard text PDF', async () => {
    const longText = 'Hello world '.repeat(20); // >> 50 chars/page
    mockPdfParseFn.mockResolvedValue(makePdfData(longText, 1));

    const result = await processPdf('/tmp/test.pdf');

    expect(result.rawText).toBe(longText);
    expect(result.tables).toEqual([]);
    expect(result.images).toEqual([]);
    expect(result.metadata).toMatchObject({ pages: 1 });
  });

  it('includes author, title, creator, producer, and creationDate from PDF info', async () => {
    const text = 'Contract text '.repeat(20);
    mockPdfParseFn.mockResolvedValue(
      makePdfData(text, 2, {
        Author: 'Alice Smith',
        Title: 'Service Agreement',
        Creator: 'LibreOffice',
        Producer: 'Adobe PDF',
        CreationDate: '2024-01-15',
      }),
    );

    const result = await processPdf('/tmp/contract.pdf');

    expect(result.metadata).toMatchObject({
      pages: 2,
      author: 'Alice Smith',
      title: 'Service Agreement',
      creator: 'LibreOffice',
      producer: 'Adobe PDF',
      creationDate: '2024-01-15',
    });
  });

  it('omits metadata fields that are empty strings', async () => {
    const text = 'Some content '.repeat(20);
    mockPdfParseFn.mockResolvedValue(
      makePdfData(text, 1, { Author: '', Title: 'My Doc', Creator: '' }),
    );

    const result = await processPdf('/tmp/empty-fields.pdf');

    expect(result.metadata['author']).toBeUndefined();
    expect(result.metadata['creator']).toBeUndefined();
    expect(result.metadata['title']).toBe('My Doc');
  });

  it('omits all optional metadata when info is null', async () => {
    const text = 'Some text content '.repeat(20);
    mockPdfParseFn.mockResolvedValue(makePdfData(text, 1, null));

    const result = await processPdf('/tmp/no-info.pdf');

    expect(result.metadata).toEqual({ pages: 1 });
  });

  it('handles multi-page PDFs with sufficient text per page', async () => {
    const text = 'Page content with enough text. '.repeat(10); // ~300 chars / 3 pages
    mockPdfParseFn.mockResolvedValue(makePdfData(text, 3, null));

    const result = await processPdf('/tmp/multipage.pdf');

    expect(result.rawText).toBe(text);
    expect(result.metadata['pages']).toBe(3);
  });

  // ── OCR fallback path ────────────────────────────────────────────────────

  it('sets ocrAttempted flag when OCR modules are unavailable (scanned PDF)', async () => {
    // Sparse text — 1 char / 1 page < 50 char/page threshold
    const sparseText = 'X';
    mockPdfParseFn.mockResolvedValue(makePdfData(sparseText, 1, null));

    const result = await processPdf('/tmp/scanned.pdf');

    // OCR path is entered but puppeteer/tesseract are absent → graceful fallback
    expect(result.rawText).toBe(sparseText);
    expect(result.metadata['ocrAttempted']).toBe(true);
    expect(typeof result.metadata['ocrError']).toBe('string');
    expect(result.tables).toEqual([]);
    expect(result.images).toEqual([]);
  });

  it('sets ocrAttempted flag for near-empty multi-page PDFs', async () => {
    const sparseText = '   \n  '; // well under 50 chars/page for 2 pages
    mockPdfParseFn.mockResolvedValue(makePdfData(sparseText, 2, null));

    const result = await processPdf('/tmp/sparse-multipage.pdf');

    expect(result.metadata['ocrAttempted']).toBe(true);
    expect(result.metadata['ocrError']).toBeDefined();
  });

  it('handles zero-page PDF (OCR path entered, rawText is empty string)', async () => {
    // numpages=0 → charsPerPage=0 < threshold → OCR path
    mockPdfParseFn.mockResolvedValue(makePdfData('', 0, null));

    const result = await processPdf('/tmp/empty.pdf');

    expect(result.rawText).toBe('');
    expect(result.metadata['pages']).toBe(0);
    // OCR path was triggered — either ocrApplied (succeeds with 0 pages) or
    // ocrAttempted (fails). Both confirm the OCR branch was entered.
    const ocrEntered =
      result.metadata['ocrApplied'] === true || result.metadata['ocrAttempted'] === true;
    expect(ocrEntered).toBe(true);
  });

  // ── Error propagation ────────────────────────────────────────────────────

  it('propagates readFile errors', async () => {
    mockReadFileFn.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    await expect(processPdf('/tmp/missing.pdf')).rejects.toThrow('ENOENT');
  });

  it('propagates pdf-parse errors', async () => {
    mockPdfParseFn.mockRejectedValue(new Error('PDF corrupted'));

    await expect(processPdf('/tmp/corrupt.pdf')).rejects.toThrow('PDF corrupted');
  });
});
