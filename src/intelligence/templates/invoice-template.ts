import type { TDocumentDefinitions, Content } from '../pdf-generator.js';

/** Invoice record metadata */
export interface InvoiceData {
  invoiceNumber: string;
  date: string;
  dueDate?: string;
  customerName: string;
  customerEmail?: string;
  customerAddress?: string;
  customerPhone?: string;
  notes?: string;
  terms?: string;
  paymentLink?: string;
  taxRate?: number;
  currency?: string;
}

/** A single line item on an invoice */
export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total?: number;
}

/** Business branding for document generation */
export interface Branding {
  companyName: string;
  companyAddress?: string;
  companyEmail?: string;
  companyPhone?: string;
  primaryColor?: string;
  /** Base64 data URI for the company logo (e.g. "data:image/png;base64,...") */
  logoDataUri?: string;
}

/** Format a number as a currency string */
function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/**
 * Build a pdfmake document definition for a professional invoice.
 *
 * Features:
 * - Business logo (if provided via branding.logoDataUri)
 * - Invoice number, dates, client info
 * - Line items table (description, qty, unit price, amount)
 * - Subtotal / tax / total
 * - Payment QR code (if paymentLink provided)
 * - Footer with terms and conditions
 */
export function buildInvoiceDefinition(
  invoice: InvoiceData,
  items: InvoiceItem[],
  branding: Branding,
): TDocumentDefinitions {
  const primaryColor = branding.primaryColor ?? '#1a73e8';
  const currency = invoice.currency ?? 'USD';

  // Compute totals
  const lineItems = items.map((item) => ({
    ...item,
    total: item.total ?? item.quantity * item.unitPrice,
  }));

  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const tax = invoice.taxRate != null ? subtotal * invoice.taxRate : 0;
  const grandTotal = subtotal + tax;

  // ── Header: logo + company info (left) | invoice meta (right) ──────────

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
          { text: 'INVOICE', style: 'invoiceTitle' },
          { text: `#${invoice.invoiceNumber}`, style: 'invoiceNumber', color: primaryColor },
          { text: `Date: ${invoice.date}`, style: 'invoiceMeta' },
          ...(invoice.dueDate ? [{ text: `Due: ${invoice.dueDate}`, style: 'invoiceMeta' }] : []),
        ],
        width: 'auto',
        alignment: 'right' as const,
      },
    ],
    marginBottom: 20,
  };

  // ── Bill-to section ────────────────────────────────────────────────────

  const customerLines: Content[] = [{ text: invoice.customerName, style: 'customerName' }];
  if (invoice.customerEmail) {
    customerLines.push({ text: invoice.customerEmail, style: 'customerMeta' });
  }
  if (invoice.customerAddress) {
    customerLines.push({ text: invoice.customerAddress, style: 'customerMeta' });
  }
  if (invoice.customerPhone) {
    customerLines.push({ text: invoice.customerPhone, style: 'customerMeta' });
  }

  const billToContent: Content = {
    stack: [{ text: 'BILL TO', style: 'sectionHeader', color: primaryColor }, ...customerLines],
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

  // ── Totals block (right-aligned) ──────────────────────────────────────

  const totalRows: [unknown, unknown][] = [];
  if (invoice.taxRate != null) {
    totalRows.push(
      [
        { text: 'Subtotal', alignment: 'right' as const },
        { text: formatCurrency(subtotal, currency), alignment: 'right' as const },
      ],
      [
        {
          text: `Tax (${(invoice.taxRate * 100).toFixed(0)}%)`,
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

  // ── Payment QR code ───────────────────────────────────────────────────

  const paymentSection: Content[] = [];
  if (invoice.paymentLink) {
    paymentSection.push({
      columns: [
        {
          stack: [
            { text: 'Payment', style: 'sectionHeader', color: primaryColor, marginTop: 10 },
            {
              text: invoice.paymentLink,
              link: invoice.paymentLink,
              style: 'paymentLink',
              color: primaryColor,
            },
          ],
          width: '*',
        },
        {
          stack: [
            { qr: invoice.paymentLink, fit: 80, alignment: 'right' as const },
            {
              text: 'Scan to pay',
              alignment: 'right' as const,
              style: 'qrLabel',
              marginTop: 4,
            },
          ],
          width: 'auto',
        },
      ],
      marginBottom: 10,
    });
  }

  // ── Notes ─────────────────────────────────────────────────────────────

  const notesSection: Content[] = [];
  if (invoice.notes) {
    notesSection.push(
      { text: 'Notes', style: 'sectionHeader', color: primaryColor, marginTop: 10 },
      { text: invoice.notes, style: 'notes' },
    );
  }

  // ── Terms & conditions footer ─────────────────────────────────────────

  const termsSection: Content[] = [];
  if (invoice.terms) {
    termsSection.push({
      stack: [
        { text: 'Terms & Conditions', style: 'sectionHeader', color: primaryColor, marginTop: 15 },
        { text: invoice.terms, style: 'termsText' },
      ],
    });
  }

  // ── Images dictionary ─────────────────────────────────────────────────

  const images: Record<string, string> = {};
  if (branding.logoDataUri) {
    images['companyLogo'] = branding.logoDataUri;
  }

  // ── Assemble document ─────────────────────────────────────────────────

  const content: Content[] = [
    headerContent,
    billToContent,
    itemsTable,
    totalsSection,
    ...paymentSection,
    ...notesSection,
    ...termsSection,
  ];

  return {
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60] as [number, number, number, number],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.3 },
    ...(Object.keys(images).length > 0 ? { images } : {}),
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
      qrLabel: { fontSize: 8, color: '#888888' },
      termsText: { fontSize: 8, color: '#777777', lineHeight: 1.4 },
    },
    content,
  };
}
