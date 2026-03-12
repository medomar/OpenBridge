import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
/**
 * Declarative document definition accepted by pdfmake.
 * This is a minimal local definition that mirrors the pdfmake TDocumentDefinitions
 * interface. Full types are available via `@types/pdfmake` if needed directly.
 */
export interface TDocumentDefinitions {
  /** Page content — array of content nodes */
  content: Content[];
  /** Named style dictionary */
  styles?: Record<string, Record<string, unknown>>;
  /** Default style applied to all content */
  defaultStyle?: Record<string, unknown>;
  /** Page size — e.g. "A4", "LETTER", or { width, height } */
  pageSize?: string | { width: number; height: number };
  /** Page orientation */
  pageOrientation?: 'portrait' | 'landscape';
  /** Page margins [left, top, right, bottom] */
  pageMargins?: [number, number, number, number] | number;
  /** Page header (repeated on every page) */
  header?: Content | ((currentPage: number, pageCount: number) => Content);
  /** Page footer (repeated on every page) */
  footer?: Content | ((currentPage: number, pageCount: number) => Content);
  /** Page background */
  background?: Content | ((currentPage: number) => Content);
  /** Watermark */
  watermark?: { text: string; color?: string; opacity?: number; bold?: boolean; italics?: boolean };
  /** Images dictionary */
  images?: Record<string, string>;
  [key: string]: unknown;
}

/** A content node or array of content nodes in a pdfmake document */
export type Content = string | Record<string, unknown> | Content[];

/** A single line item on an invoice */
export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  /** Pre-computed total — defaults to quantity × unitPrice if omitted */
  total?: number;
}

/** Invoice record metadata */
export interface InvoiceRecord {
  invoiceNumber: string;
  date: string;
  dueDate?: string;
  /** Customer name or company */
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  /** Notes displayed at the bottom of the invoice */
  notes?: string;
  /** Payment URL included as a clickable link (optional) */
  paymentLink?: string;
  /** Tax rate as a decimal, e.g. 0.1 for 10% (optional) */
  taxRate?: number;
  currency?: string;
}

/** Business branding for generated documents */
export interface InvoiceBranding {
  /** Company / business name */
  companyName: string;
  /** Address lines shown in the header */
  companyAddress?: string;
  /** Contact email shown in the header */
  companyEmail?: string;
  /** Primary brand colour as a CSS hex string, e.g. "#1a73e8" */
  primaryColor?: string;
}

/** Resolved local path to the pdfmake package directory */
function pdfmakePkgDir(): string {
  const req = createRequire(import.meta.url);
  return path.dirname(req.resolve('pdfmake/package.json'));
}

/**
 * Generate a PDF file from a pdfmake declarative document definition.
 *
 * Writes the result to `<workspacePath>/.openbridge/generated/<uuid>.pdf`
 * and returns the absolute path to the created file.
 *
 * Roboto fonts bundled with pdfmake are used by default so no external
 * font assets are required.
 *
 * @param definition    pdfmake document definition
 * @param workspacePath Absolute path to the target workspace
 * @returns             Absolute path of the written PDF
 */
export async function generatePdf(
  definition: TDocumentDefinitions,
  workspacePath: string,
): Promise<string> {
  const outputDir = path.join(workspacePath, '.openbridge', 'generated');
  await fs.mkdir(outputDir, { recursive: true });

  const outputPath = path.join(outputDir, `${randomUUID()}.pdf`);

  // Dynamic import keeps pdfmake optional at module-load time.
  // pdfmake is a CommonJS module without TypeScript declarations for the
  // server-side API, so the `any` cast is intentional here.
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
  const pdfmakeModule = (await import('pdfmake')) as any;
  const instance: any = pdfmakeModule.default ?? pdfmakeModule;

  const fontDir = path.join(pdfmakePkgDir(), 'fonts', 'Roboto');
  instance.addFonts({
    Roboto: {
      normal: path.join(fontDir, 'Roboto-Regular.ttf'),
      bold: path.join(fontDir, 'Roboto-Medium.ttf'),
      italics: path.join(fontDir, 'Roboto-Italic.ttf'),
      bolditalics: path.join(fontDir, 'Roboto-MediumItalic.ttf'),
    },
  });

  // Ensure a default font is set
  const existingDefaultStyle = definition.defaultStyle;
  const defWithFont: TDocumentDefinitions = {
    ...definition,
    defaultStyle: {
      font: 'Roboto',
      ...existingDefaultStyle,
    },
  };

  const doc: any = instance.createPdf(defWithFont);
  await doc.write(outputPath);
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

  return outputPath;
}

// ─── Invoice helper ──────────────────────────────────────────────────────────

/** Format a number as a currency string */
function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/**
 * Build a pdfmake `TDocumentDefinitions` object for a professional invoice.
 *
 * @param record    Invoice metadata (number, dates, customer info)
 * @param items     Line items to display in the items table
 * @param branding  Business branding (company name, colours)
 * @returns         pdfmake document definition ready for `generatePdf()`
 */
export function createInvoicePdfDefinition(
  record: InvoiceRecord,
  items: InvoiceLineItem[],
  branding: InvoiceBranding,
): TDocumentDefinitions {
  const primaryColor = branding.primaryColor ?? '#1a73e8';
  const currency = record.currency ?? 'USD';

  // Compute totals
  const lineItems = items.map((item) => ({
    ...item,
    total: item.total ?? item.quantity * item.unitPrice,
  }));

  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const tax = record.taxRate != null ? subtotal * record.taxRate : 0;
  const grandTotal = subtotal + tax;

  // Header row — company info left, invoice metadata right
  const headerContent: Content = {
    columns: [
      {
        stack: [
          { text: branding.companyName, style: 'companyName' },
          ...(branding.companyAddress
            ? [{ text: branding.companyAddress, style: 'companyMeta' }]
            : []),
          ...(branding.companyEmail ? [{ text: branding.companyEmail, style: 'companyMeta' }] : []),
        ],
        width: '*',
      },
      {
        stack: [
          { text: 'INVOICE', style: 'invoiceTitle' },
          { text: `#${record.invoiceNumber}`, style: 'invoiceNumber', color: primaryColor },
          { text: `Date: ${record.date}`, style: 'invoiceMeta' },
          ...(record.dueDate ? [{ text: `Due: ${record.dueDate}`, style: 'invoiceMeta' }] : []),
        ],
        width: 'auto',
        alignment: 'right' as const,
      },
    ],
    marginBottom: 20,
  };

  // Bill-to section
  const billToContent: Content = {
    stack: [
      { text: 'BILL TO', style: 'sectionHeader', color: primaryColor },
      { text: record.customerName, style: 'customerName' },
      ...(record.customerEmail ? [{ text: record.customerEmail, style: 'customerMeta' }] : []),
      ...(record.customerAddress ? [{ text: record.customerAddress, style: 'customerMeta' }] : []),
    ],
    marginBottom: 20,
  };

  // Line items table body
  const tableBody: Content[][] = [
    [
      { text: 'Description', style: 'tableHeader', color: 'white', fillColor: primaryColor },
      {
        text: 'Qty',
        style: 'tableHeader',
        color: 'white',
        fillColor: primaryColor,
        alignment: 'right' as const,
      },
      {
        text: 'Unit Price',
        style: 'tableHeader',
        color: 'white',
        fillColor: primaryColor,
        alignment: 'right' as const,
      },
      {
        text: 'Total',
        style: 'tableHeader',
        color: 'white',
        fillColor: primaryColor,
        alignment: 'right' as const,
      },
    ],
    ...lineItems.map((item, idx) => {
      const bg = idx % 2 === 0 ? '#f8f9fa' : 'white';
      return [
        { text: item.description, fillColor: bg },
        { text: String(item.quantity), alignment: 'right' as const, fillColor: bg },
        {
          text: formatCurrency(item.unitPrice, currency),
          alignment: 'right' as const,
          fillColor: bg,
        },
        { text: formatCurrency(item.total, currency), alignment: 'right' as const, fillColor: bg },
      ];
    }),
  ];

  const itemsTable: Content = {
    table: {
      headerRows: 1,
      widths: ['*', 60, 80, 80],
      body: tableBody,
    },
    layout: 'lightHorizontalLines',
    marginBottom: 20,
  };

  // Totals block (right-aligned)
  const totalRows: [unknown, unknown][] = [];
  if (record.taxRate != null) {
    totalRows.push(
      [
        { text: 'Subtotal', alignment: 'right' as const },
        { text: formatCurrency(subtotal, currency), alignment: 'right' as const },
      ],
      [
        {
          text: `Tax (${(record.taxRate * 100).toFixed(0)}%)`,
          alignment: 'right' as const,
        },
        { text: formatCurrency(tax, currency), alignment: 'right' as const },
      ],
    );
  }
  totalRows.push([
    {
      text: 'TOTAL',
      style: 'totalLabel',
      alignment: 'right' as const,
      color: primaryColor,
    },
    {
      text: formatCurrency(grandTotal, currency),
      style: 'totalAmount',
      alignment: 'right' as const,
      color: primaryColor,
    },
  ]);

  const totalsSection: Content = {
    columns: [
      { text: '', width: '*' },
      {
        table: {
          widths: [120, 80],
          body: totalRows as Content[][],
        },
        layout: 'noBorders',
      },
    ],
  };

  // Optional footer content
  const footerItems: Content[] = [];
  if (record.notes) {
    footerItems.push(
      { text: 'Notes', style: 'sectionHeader', color: primaryColor, marginTop: 20 },
      { text: record.notes, style: 'notes' },
    );
  }
  if (record.paymentLink) {
    footerItems.push(
      { text: 'Payment', style: 'sectionHeader', color: primaryColor, marginTop: 20 },
      {
        text: record.paymentLink,
        link: record.paymentLink,
        style: 'paymentLink',
        color: primaryColor,
      },
    );
  }

  return {
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60] as [number, number, number, number],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.3 },
    styles: {
      companyName: { fontSize: 16, bold: true, marginBottom: 4 },
      companyMeta: { fontSize: 9, color: '#666666' },
      invoiceTitle: { fontSize: 22, bold: true, color: '#333333', marginBottom: 4 },
      invoiceNumber: { fontSize: 13, bold: true, marginBottom: 4 },
      invoiceMeta: { fontSize: 9, color: '#666666' },
      sectionHeader: { fontSize: 9, bold: true, marginBottom: 4, marginTop: 10 },
      customerName: { fontSize: 11, bold: true, marginBottom: 2 },
      customerMeta: { fontSize: 9, color: '#666666' },
      tableHeader: { fontSize: 10, bold: true },
      totalLabel: { fontSize: 11, bold: true },
      totalAmount: { fontSize: 11, bold: true },
      notes: { fontSize: 9, color: '#555555', italics: true },
      paymentLink: { fontSize: 10, decoration: 'underline' },
    },
    content: ([headerContent, billToContent, itemsTable, totalsSection] as Content[]).concat(
      footerItems,
    ),
  };
}
