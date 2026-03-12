import type { Branding } from './invoice-template.js';
import type { InvoiceData, InvoiceItem } from './invoice-template.js';
import type { ReceiptData, ReceiptItem } from './receipt-template.js';

export type { Branding };

/** Client data for welcome emails */
export interface ClientData {
  name: string;
  email?: string;
  company?: string;
  phone?: string;
}

/** Result of a build*Email function */
export interface EmailContent {
  subject: string;
  html: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
}

function esc(value: string | number | undefined | null): string {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function baseStyles(primaryColor: string): string {
  return `
    body { margin: 0; padding: 0; background: #f4f4f4; font-family: Arial, Helvetica, sans-serif; font-size: 15px; color: #333333; }
    .wrapper { max-width: 600px; margin: 32px auto; background: #ffffff; border-radius: 6px; overflow: hidden; }
    .header { background: ${primaryColor}; padding: 28px 32px; }
    .header h1 { margin: 0; font-size: 22px; color: #ffffff; }
    .header p { margin: 4px 0 0; font-size: 13px; color: rgba(255,255,255,0.85); }
    .body { padding: 28px 32px; }
    .body p { margin: 0 0 14px; line-height: 1.6; }
    .info-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .info-table td { padding: 6px 0; vertical-align: top; }
    .info-table td:first-child { color: #666666; font-size: 13px; width: 140px; }
    .items-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    .items-table th { background: #f8f9fa; border-bottom: 2px solid #e0e0e0; padding: 8px 10px; text-align: left; font-size: 13px; color: #555555; }
    .items-table td { padding: 8px 10px; border-bottom: 1px solid #eeeeee; font-size: 14px; }
    .items-table td.right { text-align: right; }
    .totals { text-align: right; margin-bottom: 20px; }
    .totals table { display: inline-table; border-collapse: collapse; }
    .totals td { padding: 4px 10px; font-size: 14px; }
    .totals td:first-child { color: #666666; }
    .totals .total-row td { font-size: 16px; font-weight: bold; color: ${primaryColor}; border-top: 2px solid #e0e0e0; }
    .btn-wrap { text-align: center; margin: 24px 0; }
    .btn { display: inline-block; background: ${primaryColor}; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 4px; font-size: 15px; font-weight: bold; }
    .divider { border: none; border-top: 1px solid #eeeeee; margin: 20px 0; }
    .footer { background: #f8f9fa; padding: 18px 32px; font-size: 12px; color: #888888; text-align: center; }
    @media only screen and (max-width: 620px) {
      .wrapper { margin: 0; border-radius: 0; }
      .body, .header, .footer { padding: 20px 16px; }
      .info-table td:first-child { width: 110px; }
    }
  `.trim();
}

function layout(
  primaryColor: string,
  headerTitle: string,
  headerSubtitle: string,
  bodyHtml: string,
  companyName: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(headerTitle)}</title>
  <style>${baseStyles(primaryColor)}</style>
</head>
<body>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td>
      <div class="wrapper">
        <div class="header">
          <h1>${esc(headerTitle)}</h1>
          ${headerSubtitle ? `<p>${esc(headerSubtitle)}</p>` : ''}
        </div>
        <div class="body">
          ${bodyHtml}
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} ${esc(companyName)}. All rights reserved.
        </div>
      </div>
    </td></tr>
  </table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an invoice email — "Payment required" notification sent to a customer.
 *
 * Includes: invoice details, line items table, total, Pay Now action button.
 */
export function buildInvoiceEmail(
  invoice: InvoiceData,
  items: InvoiceItem[],
  branding: Branding,
): EmailContent {
  const primary = branding.primaryColor ?? '#1a73e8';
  const currency = invoice.currency ?? 'USD';

  const subtotal = items.reduce((sum, i) => sum + (i.total ?? i.unitPrice * i.quantity), 0);
  const taxRate = invoice.taxRate ?? 0;
  const tax = subtotal * (taxRate / 100);
  const total = subtotal + tax;

  const rows = items
    .map(
      (item) => `
      <tr>
        <td>${esc(item.description)}</td>
        <td class="right">${item.quantity}</td>
        <td class="right">${formatCurrency(item.unitPrice, currency)}</td>
        <td class="right">${formatCurrency(item.total ?? item.unitPrice * item.quantity, currency)}</td>
      </tr>`,
    )
    .join('');

  const taxRow =
    taxRate > 0
      ? `<tr><td>Tax (${taxRate}%)</td><td>${formatCurrency(tax, currency)}</td></tr>`
      : '';

  const payBtn = invoice.paymentLink
    ? `<div class="btn-wrap"><a class="btn" href="${esc(invoice.paymentLink)}">Pay Now</a></div>`
    : '';

  const body = `
    <p>Hi ${esc(invoice.customerName)},</p>
    <p>Please find your invoice details below. Payment is due${invoice.dueDate ? ` by <strong>${esc(invoice.dueDate)}</strong>` : ' upon receipt'}.</p>

    <table class="info-table">
      <tr><td>Invoice #</td><td><strong>${esc(invoice.invoiceNumber)}</strong></td></tr>
      <tr><td>Date</td><td>${esc(invoice.date)}</td></tr>
      ${invoice.dueDate ? `<tr><td>Due Date</td><td>${esc(invoice.dueDate)}</td></tr>` : ''}
      ${invoice.customerEmail ? `<tr><td>Bill To</td><td>${esc(invoice.customerName)}<br/>${esc(invoice.customerEmail)}</td></tr>` : ''}
    </table>

    <table class="items-table">
      <thead>
        <tr>
          <th>Description</th>
          <th class="right" style="text-align:right">Qty</th>
          <th class="right" style="text-align:right">Unit Price</th>
          <th class="right" style="text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td>Subtotal</td><td>${formatCurrency(subtotal, currency)}</td></tr>
        ${taxRow}
        <tr class="total-row"><td>Total</td><td>${formatCurrency(total, currency)}</td></tr>
      </table>
    </div>

    ${payBtn}
    ${invoice.notes ? `<hr class="divider"/><p style="font-size:13px;color:#666">${esc(invoice.notes)}</p>` : ''}
    ${invoice.terms ? `<p style="font-size:12px;color:#888">Terms: ${esc(invoice.terms)}</p>` : ''}

    <p>If you have questions, please contact us at ${esc(branding.companyEmail ?? branding.companyName)}.</p>
    <p>Thank you for your business!</p>
  `;

  return {
    subject: `Invoice ${invoice.invoiceNumber} from ${branding.companyName}`,
    html: layout(
      primary,
      `Invoice ${invoice.invoiceNumber}`,
      branding.companyName,
      body,
      branding.companyName,
    ),
  };
}

/**
 * Build a receipt email — confirmation sent after payment is received.
 *
 * Includes: receipt details, items paid, total, View Invoice button.
 */
export function buildReceiptEmail(
  receipt: ReceiptData,
  items: ReceiptItem[],
  branding: Branding,
): EmailContent {
  const primary = branding.primaryColor ?? '#1a73e8';
  const currency = receipt.currency ?? 'USD';
  const total = items.reduce((sum, i) => sum + i.amount, 0);

  const rows = items
    .map(
      (item) => `
      <tr>
        <td>${esc(item.description)}</td>
        ${item.quantity != null ? `<td class="right">${item.quantity}</td>` : '<td></td>'}
        <td class="right">${formatCurrency(item.amount, currency)}</td>
      </tr>`,
    )
    .join('');

  const body = `
    <p>Hi ${receipt.customerName ? esc(receipt.customerName) : 'there'},</p>
    <p>Thank you for your payment! Here is your receipt.</p>

    <table class="info-table">
      ${receipt.receiptNumber ? `<tr><td>Receipt #</td><td><strong>${esc(receipt.receiptNumber)}</strong></td></tr>` : ''}
      <tr><td>Date</td><td>${esc(receipt.date)}${receipt.time ? ` ${esc(receipt.time)}` : ''}</td></tr>
      ${receipt.paymentMethod ? `<tr><td>Payment</td><td>${esc(receipt.paymentMethod)}</td></tr>` : ''}
    </table>

    <table class="items-table">
      <thead>
        <tr>
          <th>Description</th>
          <th class="right" style="text-align:right">Qty</th>
          <th class="right" style="text-align:right">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <table>
        <tr class="total-row"><td>Total Paid</td><td>${formatCurrency(total, currency)}</td></tr>
      </table>
    </div>

    ${receipt.notes ? `<hr class="divider"/><p style="font-size:13px;color:#666">${esc(receipt.notes)}</p>` : ''}
    <p>We appreciate your business. Please keep this email as your payment confirmation.</p>
  `;

  return {
    subject: `Payment receipt from ${branding.companyName}`,
    html: layout(
      primary,
      'Payment Receipt',
      `${branding.companyName} — ${receipt.date}`,
      body,
      branding.companyName,
    ),
  };
}

/**
 * Build a payment reminder email — polite nudge sent when an invoice is overdue.
 *
 * Includes: overdue notice, invoice details, total outstanding, Pay Now button.
 */
export function buildReminderEmail(
  invoice: InvoiceData,
  items: InvoiceItem[],
  branding: Branding,
): EmailContent {
  const primary = branding.primaryColor ?? '#1a73e8';
  const currency = invoice.currency ?? 'USD';

  const subtotal = items.reduce((sum, i) => sum + (i.total ?? i.unitPrice * i.quantity), 0);
  const tax = subtotal * ((invoice.taxRate ?? 0) / 100);
  const total = subtotal + tax;

  const payBtn = invoice.paymentLink
    ? `<div class="btn-wrap"><a class="btn" href="${esc(invoice.paymentLink)}">Pay Now</a></div>`
    : '';

  const body = `
    <p>Hi ${esc(invoice.customerName)},</p>
    <p>This is a friendly reminder that invoice <strong>${esc(invoice.invoiceNumber)}</strong> is${invoice.dueDate ? ` due on <strong>${esc(invoice.dueDate)}</strong>` : ' outstanding'}.</p>
    <p>Please arrange payment at your earliest convenience to avoid any service interruptions.</p>

    <table class="info-table">
      <tr><td>Invoice #</td><td><strong>${esc(invoice.invoiceNumber)}</strong></td></tr>
      <tr><td>Invoice Date</td><td>${esc(invoice.date)}</td></tr>
      ${invoice.dueDate ? `<tr><td>Due Date</td><td><strong style="color:#d32f2f">${esc(invoice.dueDate)}</strong></td></tr>` : ''}
      <tr><td>Amount Due</td><td><strong>${formatCurrency(total, currency)}</strong></td></tr>
    </table>

    ${payBtn}

    <p>If you have already made this payment, please disregard this message — and thank you!</p>
    <p>If you have any questions or need to discuss payment arrangements, please contact us at ${esc(branding.companyEmail ?? branding.companyName)}.</p>
    <p>Thank you,<br/><strong>${esc(branding.companyName)}</strong></p>
  `;

  return {
    subject: `Payment reminder — Invoice ${invoice.invoiceNumber} from ${branding.companyName}`,
    html: layout(
      primary,
      'Payment Reminder',
      `Invoice ${invoice.invoiceNumber}`,
      body,
      branding.companyName,
    ),
  };
}

/**
 * Build a welcome email — onboarding message sent to a new client.
 *
 * Includes: greeting, company intro, contact info, View Account button.
 */
export function buildWelcomeEmail(
  client: ClientData,
  branding: Branding,
  options?: { accountUrl?: string },
): EmailContent {
  const primary = branding.primaryColor ?? '#1a73e8';

  const viewBtn = options?.accountUrl
    ? `<div class="btn-wrap"><a class="btn" href="${esc(options.accountUrl)}">View Your Account</a></div>`
    : '';

  const body = `
    <p>Hi ${esc(client.name)},</p>
    <p>Welcome to <strong>${esc(branding.companyName)}</strong>! We're thrilled to have you on board.</p>
    <p>Your account has been set up and you can now start working with us. We look forward to a great partnership.</p>

    ${
      client.company || client.phone || client.email
        ? `
    <table class="info-table">
      ${client.company ? `<tr><td>Company</td><td>${esc(client.company)}</td></tr>` : ''}
      ${client.email ? `<tr><td>Email</td><td>${esc(client.email)}</td></tr>` : ''}
      ${client.phone ? `<tr><td>Phone</td><td>${esc(client.phone)}</td></tr>` : ''}
    </table>`
        : ''
    }

    ${viewBtn}

    <hr class="divider"/>
    <p>If you have any questions or need assistance, please don't hesitate to reach out:</p>
    <table class="info-table">
      ${branding.companyEmail ? `<tr><td>Email</td><td>${esc(branding.companyEmail)}</td></tr>` : ''}
      ${branding.companyPhone ? `<tr><td>Phone</td><td>${esc(branding.companyPhone)}</td></tr>` : ''}
      ${branding.companyAddress ? `<tr><td>Address</td><td>${esc(branding.companyAddress)}</td></tr>` : ''}
    </table>

    <p>We look forward to working with you!</p>
    <p>The ${esc(branding.companyName)} Team</p>
  `;

  return {
    subject: `Welcome to ${branding.companyName}!`,
    html: layout(
      primary,
      `Welcome, ${client.name}!`,
      branding.companyName,
      body,
      branding.companyName,
    ),
  };
}
