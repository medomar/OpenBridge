import type { TDocumentDefinitions, Content } from '../pdf-generator.js';
import type { Branding } from './invoice-template.js';

export type { Branding };

/** Quote record metadata */
export interface QuoteData {
  quoteNumber: string;
  date: string;
  /** Date after which the quote is no longer valid */
  validUntil?: string;
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  customerPhone?: string;
  notes?: string;
  terms?: string;
  taxRate?: number;
  currency?: string;
}

/** A single line item on a quote */
export interface QuoteItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total?: number;
}

/** Format a number as a currency string */
function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/**
 * Build a pdfmake document definition for a professional quote/estimate.
 *
 * Features:
 * - Business logo (if provided via branding.logoDataUri)
 * - Quote number, dates, validity period, client info
 * - Line items table (description, qty, unit price, amount)
 * - Subtotal / tax / total
 * - Acceptance signature line
 * - Terms and conditions section
 */
export function buildQuoteDefinition(
  quote: QuoteData,
  items: QuoteItem[],
  branding: Branding,
): TDocumentDefinitions {
  const primaryColor = branding.primaryColor ?? '#1a73e8';
  const currency = quote.currency ?? 'USD';

  // Compute totals
  const lineItems = items.map((item) => ({
    ...item,
    total: item.total ?? item.quantity * item.unitPrice,
  }));

  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const tax = quote.taxRate != null ? subtotal * quote.taxRate : 0;
  const grandTotal = subtotal + tax;

  // ── Header: logo + company info (left) | quote meta (right) ─────────────

  const companyStack: Content[] = [];

  if (branding.logoDataUri) {
    companyStack.push({ image: 'companyLogo', width: 120, marginBottom: 8 });
  }

  companyStack.push({ text: branding.companyName, style: 'companyName' });

  if (branding.companyAddress) {
    companyStack.push({ text: branding.companyAddress, style: 'companyMeta' });
  }
  if (branding.companyEmail) {
    companyStack.push({ text: branding.companyEmail, style: 'companyMeta' });
  }
  if (branding.companyPhone) {
    companyStack.push({ text: branding.companyPhone, style: 'companyMeta' });
  }

  const headerContent: Content = {
    columns: [
      { stack: companyStack, width: '*' },
      {
        stack: [
          { text: 'QUOTE', style: 'quoteTitle' },
          { text: `#${quote.quoteNumber}`, style: 'quoteNumber', color: primaryColor },
          { text: `Date: ${quote.date}`, style: 'quoteMeta' },
          ...(quote.validUntil
            ? [
                {
                  text: `Valid Until: ${quote.validUntil}`,
                  style: 'quoteValidity',
                  color: primaryColor,
                },
              ]
            : []),
        ],
        width: 'auto',
        alignment: 'right' as const,
      },
    ],
    marginBottom: 20,
  };

  // ── Quote-to section ───────────────────────────────────────────────────

  const customerLines: Content[] = [{ text: quote.customerName, style: 'customerName' }];
  if (quote.customerEmail) {
    customerLines.push({ text: quote.customerEmail, style: 'customerMeta' });
  }
  if (quote.customerAddress) {
    customerLines.push({ text: quote.customerAddress, style: 'customerMeta' });
  }
  if (quote.customerPhone) {
    customerLines.push({ text: quote.customerPhone, style: 'customerMeta' });
  }

  const quoteToContent: Content = {
    stack: [{ text: 'QUOTE TO', style: 'sectionHeader', color: primaryColor }, ...customerLines],
    marginBottom: 20,
  };

  // ── Line items table ──────────────────────────────────────────────────

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
        text: 'Amount',
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
        {
          text: formatCurrency(item.total, currency),
          alignment: 'right' as const,
          fillColor: bg,
        },
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

  // ── Totals block (right-aligned) ─────────────────────────────────────

  const totalRows: [unknown, unknown][] = [];
  if (quote.taxRate != null) {
    totalRows.push(
      [
        { text: 'Subtotal', alignment: 'right' as const },
        { text: formatCurrency(subtotal, currency), alignment: 'right' as const },
      ],
      [
        {
          text: `Tax (${(quote.taxRate * 100).toFixed(0)}%)`,
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
    marginBottom: 20,
  };

  // ── Notes ─────────────────────────────────────────────────────────────

  const notesSection: Content[] = [];
  if (quote.notes) {
    notesSection.push(
      { text: 'Notes', style: 'sectionHeader', color: primaryColor, marginTop: 10 },
      { text: quote.notes, style: 'notes' },
    );
  }

  // ── Terms & conditions ─────────────────────────────────────────────────

  const termsSection: Content[] = [];
  if (quote.terms) {
    termsSection.push({
      stack: [
        { text: 'Terms & Conditions', style: 'sectionHeader', color: primaryColor, marginTop: 15 },
        { text: quote.terms, style: 'termsText' },
      ],
    });
  }

  // ── Acceptance signature line ──────────────────────────────────────────

  const signatureSection: Content = {
    marginTop: 30,
    stack: [
      {
        text: 'Acceptance',
        style: 'sectionHeader',
        color: primaryColor,
        marginBottom: 20,
      },
      {
        text: 'By signing below, you accept this quote and authorize the work described above.',
        style: 'signatureNote',
        marginBottom: 30,
      },
      {
        columns: [
          {
            stack: [
              {
                canvas: [
                  {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 180,
                    y2: 0,
                    lineWidth: 1,
                    lineColor: '#333333',
                  },
                ],
              },
              { text: 'Authorized Signature', style: 'signatureLabel', marginTop: 4 },
            ],
            width: 200,
          },
          { text: '', width: 40 },
          {
            stack: [
              {
                canvas: [
                  {
                    type: 'line',
                    x1: 0,
                    y1: 0,
                    x2: 120,
                    y2: 0,
                    lineWidth: 1,
                    lineColor: '#333333',
                  },
                ],
              },
              { text: 'Date', style: 'signatureLabel', marginTop: 4 },
            ],
            width: 140,
          },
        ],
      },
    ],
  };

  // ── Images dictionary ─────────────────────────────────────────────────

  const images: Record<string, string> = {};
  if (branding.logoDataUri) {
    images['companyLogo'] = branding.logoDataUri;
  }

  // ── Assemble document ─────────────────────────────────────────────────

  const content: Content[] = [
    headerContent,
    quoteToContent,
    itemsTable,
    totalsSection,
    ...notesSection,
    ...termsSection,
    signatureSection,
  ];

  return {
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60] as [number, number, number, number],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.3 },
    ...(Object.keys(images).length > 0 ? { images } : {}),
    styles: {
      companyName: { fontSize: 16, bold: true, marginBottom: 4 },
      companyMeta: { fontSize: 9, color: '#666666' },
      quoteTitle: { fontSize: 22, bold: true, color: '#333333', marginBottom: 4 },
      quoteNumber: { fontSize: 13, bold: true, marginBottom: 4 },
      quoteMeta: { fontSize: 9, color: '#666666' },
      quoteValidity: { fontSize: 9, bold: true, marginTop: 2 },
      sectionHeader: { fontSize: 9, bold: true, marginBottom: 4, marginTop: 10 },
      customerName: { fontSize: 11, bold: true, marginBottom: 2 },
      customerMeta: { fontSize: 9, color: '#666666' },
      tableHeader: { fontSize: 10, bold: true },
      totalLabel: { fontSize: 11, bold: true },
      totalAmount: { fontSize: 11, bold: true },
      notes: { fontSize: 9, color: '#555555', italics: true },
      termsText: { fontSize: 8, color: '#777777', lineHeight: 1.4 },
      signatureNote: { fontSize: 9, color: '#555555' },
      signatureLabel: { fontSize: 8, color: '#888888' },
    },
    content,
  };
}
