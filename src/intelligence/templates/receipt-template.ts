import type { TDocumentDefinitions, Content } from '../pdf-generator.js';
import type { Branding } from './invoice-template.js';

export type { Branding };

/** Receipt record metadata */
export interface ReceiptData {
  receiptNumber?: string;
  date: string;
  time?: string;
  customerName?: string;
  paymentMethod?: string;
  notes?: string;
  currency?: string;
}

/** A single line item on a receipt */
export interface ReceiptItem {
  description: string;
  quantity?: number;
  amount: number;
}

/** Format a number as a currency string */
function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

/**
 * Build a pdfmake document definition for a simple receipt.
 *
 * Features:
 * - Compact, minimal layout (no logo by default, but supported)
 * - Business name and contact info
 * - Date and time
 * - Simple item list
 * - Total amount
 * - Payment method
 * - "Thank you" message
 */
export function buildReceiptDefinition(
  receipt: ReceiptData,
  items: ReceiptItem[],
  branding: Branding,
): TDocumentDefinitions {
  const currency = receipt.currency ?? 'USD';

  // Compute total
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  // ── Header: company info ───────────────────────────────────────────────────

  const companyStack: Content[] = [
    { text: branding.companyName, style: 'companyName', alignment: 'center' as const },
  ];

  if (branding.companyAddress) {
    companyStack.push({
      text: branding.companyAddress,
      style: 'companyMeta',
      alignment: 'center' as const,
    });
  }
  if (branding.companyEmail) {
    companyStack.push({
      text: branding.companyEmail,
      style: 'companyMeta',
      alignment: 'center' as const,
    });
  }
  if (branding.companyPhone) {
    companyStack.push({
      text: branding.companyPhone,
      style: 'companyMeta',
      alignment: 'center' as const,
    });
  }

  const headerContent: Content = {
    stack: companyStack,
    marginBottom: 15,
  };

  // ── Receipt info (date, time, receipt number) ──────────────────────────────

  const receiptInfoLines: Content[] = [];

  if (receipt.receiptNumber) {
    receiptInfoLines.push({
      text: `Receipt #${receipt.receiptNumber}`,
      style: 'receiptNumber',
      alignment: 'center' as const,
    });
  }

  const dateTimeStr = receipt.time ? `${receipt.date} ${receipt.time}` : receipt.date;
  receiptInfoLines.push({
    text: dateTimeStr,
    style: 'receiptMeta',
    alignment: 'center' as const,
  });

  if (receipt.customerName) {
    receiptInfoLines.push({
      text: `Customer: ${receipt.customerName}`,
      style: 'receiptMeta',
      alignment: 'center' as const,
      marginTop: 5,
    });
  }

  const receiptInfoContent: Content = {
    stack: receiptInfoLines,
    marginBottom: 15,
  };

  // ── Divider line ───────────────────────────────────────────────────────────

  const dividerContent: Content = {
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 0,
        x2: 500,
        y2: 0,
        lineWidth: 1,
        lineColor: '#cccccc',
      },
    ],
    marginBottom: 10,
  };

  // ── Items list ─────────────────────────────────────────────────────────────

  const itemsContent: Content[] = [];

  items.forEach((item) => {
    const qtyStr = item.quantity ? `x${item.quantity} ` : '';
    itemsContent.push({
      columns: [
        {
          text: `${qtyStr}${item.description}`,
          width: '*',
        },
        {
          text: formatCurrency(item.amount, currency),
          width: 'auto',
          alignment: 'right' as const,
        },
      ],
      marginBottom: 5,
    });
  });

  // ── Divider line ───────────────────────────────────────────────────────────

  itemsContent.push({
    canvas: [
      {
        type: 'line',
        x1: 0,
        y1: 0,
        x2: 500,
        y2: 0,
        lineWidth: 1,
        lineColor: '#cccccc',
      },
    ],
    marginBottom: 10,
    marginTop: 10,
  });

  // ── Total ──────────────────────────────────────────────────────────────────

  itemsContent.push({
    columns: [
      {
        text: 'TOTAL',
        style: 'totalLabel',
      },
      {
        text: formatCurrency(total, currency),
        style: 'totalAmount',
        alignment: 'right' as const,
      },
    ],
    marginBottom: 15,
  });

  // ── Payment method ─────────────────────────────────────────────────────────

  const paymentContent: Content[] = [];
  if (receipt.paymentMethod) {
    paymentContent.push({
      text: `Payment: ${receipt.paymentMethod}`,
      style: 'paymentInfo',
      alignment: 'center' as const,
      marginBottom: 15,
    });
  }

  // ── Thank you message ──────────────────────────────────────────────────────

  const thankYouContent: Content = {
    text: 'Thank you for your business!',
    style: 'thankYou',
    alignment: 'center' as const,
    marginTop: 20,
  };

  // ── Notes ──────────────────────────────────────────────────────────────────

  const notesContent: Content[] = [];
  if (receipt.notes) {
    notesContent.push({
      text: receipt.notes,
      style: 'notes',
      alignment: 'center' as const,
      marginTop: 10,
    });
  }

  // ── Assemble document ──────────────────────────────────────────────────────

  const content: Content[] = [
    headerContent,
    receiptInfoContent,
    dividerContent,
    ...itemsContent,
    ...paymentContent,
    thankYouContent,
    ...notesContent,
  ];

  return {
    pageSize: { width: 280, height: 600 }, // Compact receipt width (80mm common thermal printer width)
    pageMargins: [20, 20, 20, 20] as [number, number, number, number],
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.2 },
    styles: {
      companyName: { fontSize: 13, bold: true, marginBottom: 2 },
      companyMeta: { fontSize: 8, color: '#666666', marginBottom: 1 },
      receiptNumber: { fontSize: 11, bold: true, color: '#333333', marginBottom: 3 },
      receiptMeta: { fontSize: 8, color: '#666666' },
      totalLabel: { fontSize: 11, bold: true },
      totalAmount: { fontSize: 11, bold: true },
      paymentInfo: { fontSize: 9, color: '#555555' },
      thankYou: { fontSize: 11, bold: true, color: '#1a73e8' },
      notes: { fontSize: 8, color: '#777777', italics: true },
    },
    content,
  };
}
