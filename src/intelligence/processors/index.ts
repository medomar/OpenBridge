/**
 * Processors — Format-specific document processors
 *
 * Each processor handles a specific file format:
 * - pdf-processor.ts — PDF with OCR fallback
 * - excel-processor.ts — XLSX and spreadsheets
 * - csv-processor.ts — CSV files
 * - word-processor.ts — DOCX documents
 * - image-processor.ts — Images with vision AI
 * - email-processor.ts — MIME email messages
 * - json-xml-processor.ts — JSON and XML documents
 *
 * TODO: Create individual processor implementations
 * TODO: Export processor registry
 */

export type ProcessorType = 'pdf' | 'xlsx' | 'csv' | 'docx' | 'image' | 'email' | 'json' | 'xml';

export interface Processor {
  canHandle(mimeType: string): boolean;
  process(filePath: string): Promise<unknown>;
}

/**
 * Get processor for MIME type
 *
 * @param _mimeType - MIME type to find processor for
 * @returns Processor instance or null if no match
 */
export function getProcessor(_mimeType: string): Processor | null {
  // TODO: Implement processor registry lookup
  // 1. Map MIME types to processor types
  // 2. Lazy-load processors
  // 3. Return matched processor
  return null;
}
