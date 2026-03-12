/**
 * CSV Processor — Extract tables from CSV files
 *
 * TODO (OB-1339): Implement using xlsx package (handles CSV natively)
 */

import type { ProcessorResult } from '../../types/intelligence.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function processCsv(_filePath: string): Promise<ProcessorResult> {
  // TODO (OB-1339): Implement CSV processing with xlsx package + delimiter detection
  throw new Error('processCsv not yet implemented — see OB-1339');
}
