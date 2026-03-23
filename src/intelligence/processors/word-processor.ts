/**
 * Word Processor — Extract text and tables from DOCX/DOC files using mammoth.
 *
 * Uses mammoth to:
 * - Extract plain text via extractRawText()
 * - Extract HTML via convertToHtml() for detecting and parsing tables
 *
 * HTML tables are parsed into structured ExtractedTable entries.
 */

import { createLogger } from '../../core/logger.js';
import type { ExtractedTable, ProcessorResult } from '../../types/intelligence.js';

// Lazy-loaded mammoth module (optional dependency)

interface MammothResult {
  value: string;
  messages: unknown[];
}

interface MammothModule {
  extractRawText(options: { path: string }): Promise<MammothResult>;
  convertToHtml(options: { path: string }): Promise<MammothResult>;
}

let mammothModule: MammothModule | undefined;

async function getMammoth(): Promise<MammothModule> {
  if (!mammothModule) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mammothModule = (await import('mammoth')) as any as MammothModule;
  }
  return mammothModule;
}

const logger = createLogger('word-processor');

/**
 * Parse HTML tables from a mammoth-generated HTML string.
 * Returns an array of ExtractedTable objects.
 */
function parseHtmlTables(html: string): ExtractedTable[] {
  const tables: ExtractedTable[] = [];

  // Match each <table>...</table> block
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableIndex = 0;

  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1] ?? '';

    // Extract all rows
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const allRows: string[][] = [];

    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1] ?? '';

      // Extract cells (th or td)
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells: string[] = [];

      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
        // Strip inner HTML tags and decode basic entities
        const cellText = (cellMatch[1] ?? '')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&nbsp;/g, ' ')
          .replace(/&quot;/g, '"')
          .trim();
        cells.push(cellText);
      }

      if (cells.length > 0) {
        allRows.push(cells);
      }
    }

    if (allRows.length === 0) continue;

    // First row is headers
    const headers = allRows[0] ?? [];
    const rows = allRows.slice(1);

    tables.push({
      sheetName: `Table ${tableIndex + 1}`,
      headers,
      rows,
    });

    tableIndex++;
    logger.debug(
      { tableIndex, headerCount: headers.length, rowCount: rows.length },
      'Parsed HTML table',
    );
  }

  return tables;
}

/**
 * Process a Word document (DOCX/DOC) and extract text and tables.
 *
 * @param filePath - Absolute path to the Word file
 * @returns ProcessorResult with rawText, extracted tables, and metadata
 */
export async function processWord(filePath: string): Promise<ProcessorResult> {
  const mammoth = await getMammoth();
  // Extract plain text
  const textResult = await mammoth.extractRawText({ path: filePath });
  const rawText = textResult.value;

  if (textResult.messages.length > 0) {
    logger.debug({ filePath, messages: textResult.messages }, 'mammoth extractRawText messages');
  }

  // Extract HTML for table detection
  const htmlResult = await mammoth.convertToHtml({ path: filePath });
  const html = htmlResult.value;

  if (htmlResult.messages.length > 0) {
    logger.debug({ filePath, messages: htmlResult.messages }, 'mammoth convertToHtml messages');
  }

  const tables = parseHtmlTables(html);

  logger.info(
    { filePath, textLength: rawText.length, tableCount: tables.length },
    'Word processing complete',
  );

  return {
    rawText,
    tables,
    images: [],
    metadata: {
      tableCount: tables.length,
    },
  };
}
