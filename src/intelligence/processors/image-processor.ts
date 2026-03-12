/**
 * Image Processor — Extract text and data from images via AI vision + OCR
 *
 * TODO (OB-1341): Implement using AI worker (vision) + tesseract.js (OCR)
 */

import type { ProcessorResult } from '../../types/intelligence.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function processImage(_filePath: string): Promise<ProcessorResult> {
  // TODO (OB-1341): Implement image processing with AI vision + OCR
  throw new Error('processImage not yet implemented — see OB-1341');
}
