/**
 * Structured Processor — Parse JSON and XML into structured tables
 *
 * TODO (OB-1343): Implement JSON parsing + xml2js for XML
 */

import type { ProcessorResult } from '../../types/intelligence.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function processStructured(
  _filePath: string,
  _mime: string,
): Promise<ProcessorResult> {
  // TODO (OB-1343): Implement JSON/XML processing with xml2js
  throw new Error('processStructured not yet implemented — see OB-1343');
}
