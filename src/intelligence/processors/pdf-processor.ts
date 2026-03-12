/**
 * PDF Processor — Extract text and metadata from PDF files using pdf-parse.
 *
 * Reads a PDF file buffer and extracts:
 * - Full plain text from all pages
 * - Page count and document metadata (author, title, creator)
 *
 * OCR fallback for scanned PDFs is handled in OB-1337.
 */

import { readFile } from 'fs/promises';
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

/**
 * Process a PDF file and extract text content and metadata.
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

  return {
    rawText: data.text,
    tables: [],
    images: [],
    metadata,
  };
}
