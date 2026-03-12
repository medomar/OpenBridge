/**
 * Document Processor — Unified entry point for document processing pipeline
 *
 * Routes incoming files (PDF, XLSX, DOCX, images, etc.) to appropriate processors
 * based on MIME type detection using file-type (magic bytes).
 * Falls back to extension-based detection for plain-text formats (CSV, JSON).
 */

import { readFile } from 'fs/promises';
import { extname, basename } from 'path';
import { randomUUID } from 'crypto';
import { fileTypeFromBuffer } from 'file-type';

import type { ProcessedDocument, ProcessorResult } from '../types/intelligence.js';
import { processPdf } from './processors/pdf-processor.js';
import { processExcel } from './processors/excel-processor.js';
import { processCsv } from './processors/csv-processor.js';
import { processWord } from './processors/word-processor.js';
import { processImage } from './processors/image-processor.js';
import { processEmail } from './processors/email-processor.js';
import { processStructured } from './processors/structured-processor.js';

// ── MIME type constants ───────────────────────────────────────────

const MIME_PDF = 'application/pdf';
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MIME_XLS = 'application/vnd.ms-excel';
const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MIME_DOC = 'application/msword';
const MIME_CSV = 'text/csv';
const MIME_JSON = 'application/json';
const MIME_XML = 'application/xml';
const MIME_XML_TEXT = 'text/xml';
const MIME_EML = 'message/rfc822';

// ── Extension → MIME fallback map ────────────────────────────────

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.csv': MIME_CSV,
  '.json': MIME_JSON,
  '.xml': MIME_XML,
  '.eml': MIME_EML,
  '.pdf': MIME_PDF,
  '.xlsx': MIME_XLSX,
  '.xls': MIME_XLS,
  '.docx': MIME_DOCX,
  '.doc': MIME_DOC,
};

// ── MIME detection ────────────────────────────────────────────────

/**
 * Detect the MIME type of a file.
 *
 * Uses `file-type` (magic bytes) as the primary mechanism.
 * Falls back to extension-based detection for plain-text formats
 * that have no magic bytes (CSV, JSON, XML, EML).
 */
async function detectMimeType(filePath: string, buffer: Buffer): Promise<string> {
  const detected = await fileTypeFromBuffer(buffer);
  if (detected) {
    return detected.mime;
  }

  // Plain-text formats (no magic bytes) — use extension fallback
  const ext = extname(filePath).toLowerCase();
  const fallback = EXTENSION_MIME_MAP[ext];
  if (fallback) {
    return fallback;
  }

  return 'application/octet-stream';
}

// ── Processor routing ─────────────────────────────────────────────

/**
 * Route a file to the appropriate format-specific processor.
 *
 * Individual processors are implemented in ./processors/ and will be
 * fully wired in as they are completed (OB-1336 through OB-1343).
 */
async function routeToProcessor(filePath: string, mimeType: string): Promise<ProcessorResult> {
  if (mimeType === MIME_PDF) {
    return processPdf(filePath);
  }

  if (mimeType === MIME_XLSX || mimeType === MIME_XLS) {
    return processExcel(filePath);
  }

  if (mimeType === MIME_CSV) {
    return processCsv(filePath);
  }

  if (mimeType === MIME_DOCX || mimeType === MIME_DOC) {
    return processWord(filePath);
  }

  if (mimeType.startsWith('image/')) {
    return processImage(filePath);
  }

  if (mimeType === MIME_EML) {
    return processEmail(filePath);
  }

  if (mimeType === MIME_JSON || mimeType === MIME_XML || mimeType === MIME_XML_TEXT) {
    return processStructured(filePath, mimeType);
  }

  // Unknown format — return empty result
  return {
    rawText: '',
    tables: [],
    images: [],
    metadata: { mimeType, unrecognized: true },
  };
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Process a document file and extract structured content.
 *
 * @param filePath - Absolute path to the file to process
 * @returns Fully structured `ProcessedDocument` with detected MIME, raw text, tables, and metadata
 */
export async function processDocument(filePath: string): Promise<ProcessedDocument> {
  const buffer = await readFile(filePath);
  const mimeType = await detectMimeType(filePath, buffer);

  const result = await routeToProcessor(filePath, mimeType);

  return {
    id: randomUUID(),
    filename: basename(filePath),
    mimeType,
    filePath,
    docType: 'unknown',
    rawText: result.rawText,
    tables: result.tables,
    images: result.images as [],
    entities: [],
    relations: [],
    metadata: result.metadata,
    processedAt: new Date().toISOString(),
  };
}
