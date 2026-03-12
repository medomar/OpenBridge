/**
 * Excel Processor — Extract tables and metadata from XLSX/XLS files
 *
 * TODO (OB-1338): Implement using xlsx (SheetJS) package
 */

import type { ProcessorResult } from '../../types/intelligence.js';

// eslint-disable-next-line @typescript-eslint/require-await
export async function processExcel(_filePath: string): Promise<ProcessorResult> {
  // TODO (OB-1338): Implement Excel processing with xlsx package
  throw new Error('processExcel not yet implemented — see OB-1338');
}
