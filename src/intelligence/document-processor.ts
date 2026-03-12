/**
 * Document Processor — Unified entry point for document processing pipeline
 *
 * Routes incoming files (PDF, XLSX, DOCX, images, etc.) to appropriate processors
 * based on MIME type detection.
 *
 * TODO: Implement MIME type detection and routing logic
 * TODO: Wire in processors from ./processors/ subdirectory
 */

export interface ProcessedDocument {
  rawText: string;
  tables?: unknown[];
  images?: unknown[];
  metadata?: Record<string, unknown>;
}

/**
 * Process a document file and extract structured content
 *
 * @param _filePath - Path to the file to process
 * @param _mimeType - MIME type of the file
 * @returns Processed document content
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function processDocument(
  _filePath: string,
  _mimeType: string,
): Promise<ProcessedDocument> {
  // TODO: Implement document processing pipeline
  // 1. Detect MIME type if not provided
  // 2. Route to appropriate processor
  // 3. Extract raw content
  // 4. Return structured result
  throw new Error('processDocument not yet implemented');
}
