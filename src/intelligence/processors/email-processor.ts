/**
 * Email Processor — Extract content and attachments from .eml files
 *
 * Uses mailparser (simpleParser) to parse RFC 822 email messages.
 * Extracts headers (from, to, subject, date), body text, HTML tables,
 * and recursively processes attachments via the document processor.
 */

import { readFile, writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createLogger } from '../../core/logger.js';
import type { ExtractedTable, ProcessorResult } from '../../types/intelligence.js';

const logger = createLogger('email-processor');

// Dynamic import to avoid top-level require issues with ESM
interface AddressObject {
  value: Array<{ address?: string; name?: string }>;
  text: string;
}

interface ParsedMail {
  from?: AddressObject;
  to?: AddressObject | AddressObject[];
  subject?: string;
  date?: Date;
  text?: string;
  html?: string | false;
  attachments?: Array<{
    filename?: string;
    contentType: string;
    content: Buffer;
  }>;
}

/**
 * Parse HTML tables from an email HTML body.
 * Reuses the same regex-based approach as word-processor.ts.
 */
function parseHtmlTables(html: string): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableIndex = 0;

  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1] ?? '';
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const allRows: string[][] = [];

    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      const rowHtml = rowMatch[1] ?? '';
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells: string[] = [];

      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRegex.exec(rowHtml)) !== null) {
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

    const headers = allRows[0] ?? [];
    const rows = allRows.slice(1);

    tables.push({
      sheetName: `Table ${tableIndex + 1}`,
      headers,
      rows,
    });

    tableIndex++;
  }

  return tables;
}

/**
 * Format an address object to a readable string.
 */
function formatAddress(addr: AddressObject | AddressObject[] | undefined): string {
  if (!addr) return '';
  const list = Array.isArray(addr) ? addr : [addr];
  return list
    .flatMap((a) => a.value)
    .map((v) => (v.name ? `${v.name} <${v.address ?? ''}>` : (v.address ?? '')))
    .join(', ');
}

/**
 * Process attachments recursively by writing them to temp buffers
 * and calling processDocument() on each.
 */
async function processAttachments(
  attachments: ParsedMail['attachments'],
): Promise<ProcessorResult> {
  if (!attachments || attachments.length === 0) {
    return { rawText: '', tables: [], images: [], metadata: {} };
  }

  // Lazy import to avoid circular dependency at module load time
  const { processDocument } = await import('../document-processor.js');

  const mergedText: string[] = [];
  const mergedTables: ExtractedTable[] = [];

  for (const attachment of attachments) {
    const filename = attachment.filename ?? `attachment_${Date.now()}`;
    const tmpDir = await mkdtemp(join(tmpdir(), 'ob-email-'));
    const tmpPath = join(tmpDir, filename);

    try {
      await writeFile(tmpPath, attachment.content);
      const result = await processDocument(tmpPath);

      if (result.rawText) {
        mergedText.push(`--- Attachment: ${filename} ---\n${result.rawText}`);
      }
      mergedTables.push(...result.tables);

      logger.debug(
        { filename, mimeType: attachment.contentType, textLength: result.rawText.length },
        'Processed email attachment',
      );
    } catch (err) {
      logger.warn({ filename, err }, 'Failed to process email attachment');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  return {
    rawText: mergedText.join('\n\n'),
    tables: mergedTables,
    images: [],
    metadata: { attachmentCount: attachments.length },
  };
}

/**
 * Process an .eml email file and extract structured content.
 *
 * @param filePath - Absolute path to the .eml file
 * @returns ProcessorResult with email body, HTML tables, attachment content, and headers metadata
 */
export async function processEmail(filePath: string): Promise<ProcessorResult> {
  const source = await readFile(filePath);

  // Dynamic import for ESM compatibility
  const mailparserMod = (await import('mailparser')) as {
    simpleParser: (source: Buffer) => Promise<ParsedMail>;
  };
  const { simpleParser } = mailparserMod;

  const parsed = await simpleParser(source);

  const from = formatAddress(parsed.from);
  const to = formatAddress(parsed.to);
  const subject = parsed.subject ?? '';
  const date = parsed.date?.toISOString() ?? '';

  // Build header block for inclusion in rawText
  const headerBlock = [
    from ? `From: ${from}` : '',
    to ? `To: ${to}` : '',
    subject ? `Subject: ${subject}` : '',
    date ? `Date: ${date}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const bodyText = parsed.text ?? '';
  const html = typeof parsed.html === 'string' ? parsed.html : '';

  const tables = html ? parseHtmlTables(html) : [];

  // Recursively process attachments
  const attachmentResult = await processAttachments(parsed.attachments);

  const rawTextParts = [headerBlock, bodyText, attachmentResult.rawText].filter(Boolean);
  const rawText = rawTextParts.join('\n\n');

  const metadata: Record<string, unknown> = {
    from,
    to,
    subject,
    date,
    hasHtml: html.length > 0,
    tableCount: tables.length,
    attachmentCount: parsed.attachments?.length ?? 0,
  };

  logger.info(
    {
      filePath,
      subject,
      attachmentCount: metadata['attachmentCount'],
      tableCount: tables.length,
    },
    'Email processing complete',
  );

  return {
    rawText,
    tables: [...tables, ...attachmentResult.tables],
    images: [],
    metadata,
  };
}
