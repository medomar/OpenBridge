/**
 * PDF Processor — Extract text and metadata from PDF files
 *
 * TODO (OB-1336): Implement using pdf-parse with OCR fallback via tesseract.js
 */

import type { ProcessorResult } from '../../types/intelligence.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function processPdf(_filePath: string): Promise<ProcessorResult> {
  // TODO (OB-1336): Implement PDF processing with pdf-parse + OCR fallback
  throw new Error('processPdf not yet implemented — see OB-1336');
}
