/**
 * Excel Processor — Extract tables and metadata from XLSX/XLS files using SheetJS (xlsx).
 *
 * Reads each sheet in the workbook, extracts column headers from the first row,
 * and returns data rows as structured tables. Formula cells use the computed
 * value (.v property) rather than the raw formula string.
 */

import { createLogger } from '../../core/logger.js';
import type { ExtractedTable, ProcessorResult } from '../../types/intelligence.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx') as {
  readFile: (path: string) => {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
    Props?: Record<string, unknown>;
  };
  utils: {
    sheet_to_json: (
      sheet: unknown,
      opts: { header: 1; defval: string; raw: boolean },
    ) => (string | number | boolean | null)[][];
  };
};

const logger = createLogger('excel-processor');

/**
 * Process an Excel file (XLSX/XLS/ODS) and extract structured table data.
 *
 * @param filePath - Absolute path to the Excel file
 * @returns ProcessorResult with structured tables, rawText (tab-delimited), and metadata
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function processExcel(filePath: string): Promise<ProcessorResult> {
  const workbook = XLSX.readFile(filePath);

  const sheetNames = workbook.SheetNames;
  const tables: ExtractedTable[] = [];
  const rawTextParts: string[] = [];

  for (const sheetName of sheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;

    // Convert sheet to array of arrays (formatted values, no formula strings)
    const aoa = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      raw: false,
    });

    if (aoa.length === 0) {
      logger.debug({ sheetName }, 'Sheet is empty, skipping');
      continue;
    }

    // First row is treated as headers (aoa.length > 0 checked above)
    const firstRow = aoa[0] ?? [];
    const headers = firstRow.map((h) => (h !== null && h !== undefined ? String(h) : ''));

    // Remaining rows are data; skip entirely-empty rows
    const rows = aoa.slice(1).filter((row) => row.some((cell) => cell !== '' && cell != null));

    tables.push({ sheetName, headers, rows });

    // Build plain-text representation for rawText
    const headerLine = headers.join('\t');
    const dataLines = rows.map((row) =>
      row.map((cell) => (cell !== null && cell !== undefined ? String(cell) : '')).join('\t'),
    );
    rawTextParts.push(`[Sheet: ${sheetName}]`, headerLine, ...dataLines);

    logger.debug(
      { sheetName, headerCount: headers.length, rowCount: rows.length },
      'Extracted sheet data',
    );
  }

  // Extract workbook-level metadata
  const props = workbook.Props ?? {};
  const metadata: Record<string, unknown> = {
    sheetCount: sheetNames.length,
    sheetNames,
  };
  if (props['Author']) metadata['author'] = props['Author'];
  if (props['Title']) metadata['title'] = props['Title'];
  if (props['CreatedDate']) metadata['createdDate'] = JSON.stringify(props['CreatedDate']);
  if (props['ModifiedDate']) metadata['modifiedDate'] = JSON.stringify(props['ModifiedDate']);
  if (props['Application']) metadata['application'] = props['Application'];

  logger.info(
    { filePath, sheetCount: sheetNames.length, tableCount: tables.length },
    'Excel processing complete',
  );

  return {
    rawText: rawTextParts.join('\n'),
    tables,
    images: [],
    metadata,
  };
}
