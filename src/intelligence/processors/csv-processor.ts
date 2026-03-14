/**
 * CSV Processor — Extract tables from CSV files
 *
 * Uses the xlsx package (SheetJS), which handles CSV natively.
 * Detects delimiter (comma, semicolon, tab) via first-line heuristic.
 * Returns a single table with headers and rows.
 */

import { readFileSync } from 'node:fs';
import { createLogger } from '../../core/logger.js';
import type { ExtractedTable, ProcessorResult } from '../../types/intelligence.js';

// Lazy-loaded xlsx module (optional dependency)

interface XLSXSheet {
  [key: string]: unknown;
}

interface XLSXWorkbook {
  SheetNames: string[];
  Sheets: Record<string, XLSXSheet>;
}

interface XLSXUtils {
  sheet_to_json(ws: XLSXSheet, opts?: Record<string, unknown>): unknown[];
}

interface XLSXModule {
  utils: XLSXUtils;
  readFile(path: string, opts?: Record<string, unknown>): XLSXWorkbook;
}

let xlsxModule: XLSXModule | undefined;

async function getXLSX(): Promise<XLSXModule> {
  if (!xlsxModule) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    xlsxModule = (await import('xlsx')) as any as XLSXModule;
  }
  return xlsxModule;
}

const logger = createLogger('csv-processor');

/**
 * Detect the delimiter used in a CSV file by analyzing the first line.
 * Checks for comma, semicolon, and tab; returns the most likely one.
 *
 * @param filePath - Path to the CSV file
 * @returns The detected delimiter character
 */
function detectDelimiter(filePath: string): string {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const firstLine = content.split('\n')[0] ?? '';

    if (!firstLine) {
      logger.debug('Empty file, defaulting to comma delimiter');
      return ',';
    }

    // Count occurrences of each candidate delimiter
    const commaCount = (firstLine.match(/,/g) ?? []).length;
    const semicolonCount = (firstLine.match(/;/g) ?? []).length;
    const tabCount = (firstLine.match(/\t/g) ?? []).length;

    logger.debug({ commaCount, semicolonCount, tabCount }, 'Delimiter counts in first line');

    // Return the delimiter with the highest count; default to comma if all are zero
    if (semicolonCount > commaCount && semicolonCount > tabCount) {
      logger.debug('Detected semicolon delimiter');
      return ';';
    }
    if (tabCount > commaCount && tabCount > semicolonCount) {
      logger.debug('Detected tab delimiter');
      return '\t';
    }

    logger.debug('Defaulting to comma delimiter');
    return ',';
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Error detecting delimiter, defaulting to comma',
    );
    return ',';
  }
}

/**
 * Process a CSV file and extract structured table data.
 *
 * @param filePath - Absolute path to the CSV file
 * @returns ProcessorResult with a single table, rawText, and metadata
 */
export async function processCsv(filePath: string): Promise<ProcessorResult> {
  const XLSX = await getXLSX();
  const delimiter = detectDelimiter(filePath);

  // Read the CSV file using xlsx with the detected delimiter
  const workbook = XLSX.readFile(filePath, { delimiter });
  const sheetNames = workbook.SheetNames;

  if (sheetNames.length === 0) {
    logger.warn({ filePath }, 'CSV file has no sheets');
    return {
      rawText: '',
      tables: [],
      images: [],
      metadata: { delimiter },
    };
  }

  // Use the first sheet (CSV typically has only one)
  // sheetNames.length > 0 is guaranteed by the check above
  const sheetName = sheetNames[0];
  const worksheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!worksheet) {
    logger.warn({ filePath }, 'CSV file could not be parsed');
    return {
      rawText: '',
      tables: [],
      images: [],
      metadata: { delimiter },
    };
  }

  // Convert sheet to array of arrays (formatted values, no formula strings)
  const aoa = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as (string | number | boolean | null)[][];

  if (aoa.length === 0) {
    logger.debug({ filePath }, 'CSV file is empty');
    return {
      rawText: '',
      tables: [],
      images: [],
      metadata: { delimiter },
    };
  }

  // First row is treated as headers (aoa.length > 0 checked above)
  const firstRow = aoa[0] ?? [];
  const headers = firstRow.map((h) => (h !== null && h !== undefined ? String(h) : ''));

  // Remaining rows are data; skip entirely-empty rows
  const rows = aoa.slice(1).filter((row) => row.some((cell) => cell !== '' && cell != null));

  const table: ExtractedTable = { headers, rows };

  // Build plain-text representation for rawText
  const headerLine = headers.join('\t');
  const dataLines = rows.map((row) =>
    row.map((cell) => (cell !== null && cell !== undefined ? String(cell) : '')).join('\t'),
  );
  const rawText = [headerLine, ...dataLines].join('\n');

  logger.info(
    { filePath, delimiter, headerCount: headers.length, rowCount: rows.length },
    'CSV processing complete',
  );

  return {
    rawText,
    tables: [table],
    images: [],
    metadata: { delimiter },
  };
}
