import { mkdir, readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DocType, DocTypeHook, HookActionType } from '../types/doctype.js';
import { createLogger } from '../core/logger.js';
import { generateNextNumber } from './naming-series.js';
import { generatePdf } from './pdf-generator.js';
import { loadBranding } from './branding.js';
import { buildInvoiceDefinition } from './templates/invoice-template.js';
import { buildQuoteDefinition } from './templates/quote-template.js';
import { buildReceiptDefinition } from './templates/receipt-template.js';
import { buildReportDefinition } from './templates/report-template.js';
import type { InvoiceData, InvoiceItem } from './templates/invoice-template.js';
import type { QuoteData, QuoteItem } from './templates/quote-template.js';
import type { ReceiptData, ReceiptItem } from './templates/receipt-template.js';
import type { ReportSection } from './templates/report-template.js';

const logger = createLogger('hook-executor');

// ---------------------------------------------------------------------------
// Notification sender registry
// ---------------------------------------------------------------------------

/**
 * Sender function for a messaging channel (WhatsApp, etc.).
 * `to` is the channel-specific recipient identifier (phone number, chat ID, etc.).
 */
export type ChannelSenderFn = (
  to: string,
  message: string,
  attachments?: AttachmentPayload[],
) => Promise<void>;

/** Email sender function — sends a formatted email. */
export type EmailSenderFn = (
  to: string,
  subject: string,
  body: string,
  attachments?: AttachmentPayload[],
) => Promise<void>;

/** A resolved attachment ready to send. */
export interface AttachmentPayload {
  filename: string;
  content: Buffer;
  contentType: string;
}

/**
 * Registry of notification sender functions.
 * Wire up by calling `registerNotificationSenders()` from bridge.ts.
 */
const notificationSenders: {
  whatsapp?: ChannelSenderFn;
  telegram?: ChannelSenderFn;
  email?: EmailSenderFn;
} = {};

/**
 * Register sender functions so the send_notification hook can deliver messages.
 * Call this during bridge startup before any hooks execute.
 */
export function registerNotificationSenders(senders: {
  whatsapp?: ChannelSenderFn;
  telegram?: ChannelSenderFn;
  email?: EmailSenderFn;
}): void {
  if (senders.whatsapp) notificationSenders.whatsapp = senders.whatsapp;
  if (senders.telegram) notificationSenders.telegram = senders.telegram;
  if (senders.email) notificationSenders.email = senders.email;
  logger.debug({ channels: Object.keys(senders) }, 'Notification senders registered');
}

// ---------------------------------------------------------------------------
// Worker spawner registry (used by spawn_worker)
// ---------------------------------------------------------------------------

/**
 * Spawner function that runs an AI worker and returns its stdout.
 *
 * @param prompt        - The formatted prompt to send to the worker
 * @param workspacePath - Working directory for the worker process
 * @param skillPack     - Optional skill pack / tool profile name (e.g. 'read-only', 'code-edit')
 * @returns The worker's stdout output
 */
export type WorkerSpawnerFn = (
  prompt: string,
  workspacePath: string,
  skillPack?: string,
) => Promise<string>;

let workerSpawner: WorkerSpawnerFn | undefined;

/**
 * Register the worker spawner so the spawn_worker hook can launch AI workers.
 * Call this during bridge startup (same place as registerNotificationSenders).
 * Pass `undefined` to deregister (useful in tests).
 */
export function registerWorkerSpawner(spawner: WorkerSpawnerFn | undefined): void {
  workerSpawner = spawner;
  if (spawner) {
    logger.debug('Worker spawner registered for spawn_worker hook');
  } else {
    logger.debug('Worker spawner deregistered');
  }
}

// ---------------------------------------------------------------------------
// Stripe adapter registry (used by create_payment_link)
// ---------------------------------------------------------------------------

/**
 * Stripe adapter interface for the create_payment_link hook.
 * Phase 119 (Integration Hub) wires in the real Stripe adapter.
 * Until then, the registry remains empty and the hook logs a warning and skips.
 */
export interface StripeAdapter {
  /**
   * Create a Stripe payment link.
   * @param amount      - Amount in the currency's smallest unit (e.g. cents for USD)
   * @param description - Human-readable description shown on the payment page
   * @returns The payment link URL
   */
  createPaymentLink(amount: number, description: string): Promise<string>;
}

let stripeAdapter: StripeAdapter | undefined;

/**
 * Register the Stripe adapter so the create_payment_link hook can call it.
 * Call this during bridge startup after Phase 119's Integration Hub is initialised.
 * Pass `undefined` to deregister (useful in tests).
 */
export function registerStripeAdapter(adapter: StripeAdapter | undefined): void {
  stripeAdapter = adapter;
  if (adapter) {
    logger.debug('Stripe adapter registered for create_payment_link hook');
  } else {
    logger.debug('Stripe adapter deregistered');
  }
}

// ---------------------------------------------------------------------------
// Workspace path registry (used by generate_pdf)
// ---------------------------------------------------------------------------

let registeredWorkspacePath: string | undefined;

/**
 * Register the workspace path so the generate_pdf hook knows where to save files.
 * Call this during bridge startup (same place as registerNotificationSenders).
 */
export function registerWorkspacePath(workspacePath: string): void {
  registeredWorkspacePath = workspacePath;
  logger.debug({ workspacePath }, 'Workspace path registered for hook-executor');
}

// ---------------------------------------------------------------------------
// Hook row type for SQLite reads
// ---------------------------------------------------------------------------

interface HookRow {
  id: string;
  doctype_id: string;
  event: string;
  action_type: string;
  action_config: string;
  sort_order: number;
  enabled: number;
}

function rowToHook(row: HookRow): DocTypeHook {
  return {
    id: row.id,
    doctype_id: row.doctype_id,
    event: row.event,
    action_type: row.action_type as HookActionType,
    action_config: JSON.parse(row.action_config) as Record<string, unknown>,
    sort_order: row.sort_order,
    enabled: row.enabled === 1,
  };
}

// ---------------------------------------------------------------------------
// Hook handler dispatch map
// ---------------------------------------------------------------------------

/**
 * Handler function signature for a single hook type.
 * Returns void — side effects are applied directly to the record object.
 */
type HookHandler = (
  hook: DocTypeHook,
  record: Record<string, unknown>,
  db: Database.Database,
) => Promise<void> | void;

/**
 * Dispatch table: action_type → handler.
 *
 * Each handler is implemented in a dedicated task (OB-1377 through OB-1381).
 * Unknown types are handled by the fallback in executeHooks().
 */
const HOOK_HANDLERS: Partial<Record<HookActionType, HookHandler>> = {
  // OB-1377: generate_number — fills a naming-series field on create
  generate_number: handleGenerateNumber,

  // OB-1378: update_field — evaluates an expression and sets a field
  update_field: handleUpdateField,

  // OB-1379: send_notification — sends a formatted message via a channel
  send_notification: handleSendNotification,

  // OB-1380: generate_pdf — renders a PDF and stores the file path
  generate_pdf: handleGeneratePdf,

  // OB-1381: create_payment_link — calls Stripe to generate a payment URL
  create_payment_link: handleCreatePaymentLink,

  // OB-1382: spawn_worker — launches an AI worker with an injected record prompt
  spawn_worker: handleSpawnWorker,

  // OB-future: remaining action types
  run_workflow: handleNotImplemented('run_workflow'),
  call_integration: handleNotImplemented('call_integration'),
};

/**
 * Handler for `generate_number` hook action type.
 * On create event (before timing): parses action_config.pattern,
 * calls generateNextNumber() to get the next number in the sequence,
 * and sets the result on the field specified in action_config.field.
 */
function handleGenerateNumber(
  hook: DocTypeHook,
  record: Record<string, unknown>,
  db: Database.Database,
): void {
  const config = hook.action_config;

  // Extract pattern and field from config
  const pattern = config['pattern'] as string | undefined;
  const field = config['field'] as string | undefined;

  if (!pattern) {
    logger.warn({ hookId: hook.id }, 'generate_number hook missing "pattern" in action_config');
    return;
  }

  if (!field) {
    logger.warn({ hookId: hook.id }, 'generate_number hook missing "field" in action_config');
    return;
  }

  // Generate the next number
  const nextNumber = generateNextNumber(db, pattern);

  // Set the field value on the record
  record[field] = nextNumber;

  logger.debug(
    { hookId: hook.id, field, pattern, generatedNumber: nextNumber },
    'generate_number hook executed successfully',
  );
}

/**
 * Handler for `update_field` hook action type.
 * Evaluates a value expression and sets the result on a field in the record.
 *
 * Supported expression syntax:
 *   - `now()` → current ISO timestamp string
 *   - `{field_name}` → reference a field from the record
 *   - Literal values (strings, numbers, booleans)
 *
 * Examples:
 *   - `{ "field": "sent_at", "value": "now()" }`
 *   - `{ "field": "approved_by", "value": "{created_by}" }`
 *   - `{ "field": "is_active", "value": "true" }`
 */
function handleUpdateField(
  hook: DocTypeHook,
  record: Record<string, unknown>,
  _db: Database.Database,
): void {
  const config = hook.action_config;

  // Extract field and value from config
  const field = config['field'] as string | undefined;
  const valueExpr = config['value'] as string | undefined;

  if (!field) {
    logger.warn({ hookId: hook.id }, 'update_field hook missing "field" in action_config');
    return;
  }

  if (valueExpr === undefined) {
    logger.warn({ hookId: hook.id }, 'update_field hook missing "value" in action_config');
    return;
  }

  // Evaluate the value expression
  const evaluatedValue = evaluateValueExpression(valueExpr, record);

  // Set the field value on the record
  record[field] = evaluatedValue;

  logger.debug(
    { hookId: hook.id, field, expression: valueExpr, evaluatedValue },
    'update_field hook executed successfully',
  );
}

/**
 * Evaluate a value expression against a record.
 *
 * Supported syntax:
 *   - `now()` → current ISO timestamp
 *   - `{field_name}` → field reference from the record
 *   - Literal values: strings, numbers, booleans (case-insensitive `true`/`false`/`null`)
 *
 * @param expression - The expression string to evaluate
 * @param record - The record data to use for field references
 * @returns The evaluated value
 */
function evaluateValueExpression(expression: string, record: Record<string, unknown>): unknown {
  const trimmed = expression.trim();

  // Handle `now()` function
  if (trimmed === 'now()') {
    return new Date().toISOString();
  }

  // Handle field references `{field_name}`
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    const fieldName = trimmed.slice(1, -1);
    return record[fieldName] ?? null;
  }

  // Try to parse as a boolean literal
  if (trimmed.toLowerCase() === 'true') {
    return true;
  }
  if (trimmed.toLowerCase() === 'false') {
    return false;
  }

  // Try to parse as null
  if (trimmed.toLowerCase() === 'null') {
    return null;
  }

  // Try to parse as a number
  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber)) {
    return asNumber;
  }

  // String literal: remove surrounding quotes if present
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Default: return as-is (bare string)
  return trimmed;
}

/**
 * Format a Mustache-style template string with field values from a record.
 *
 * Replaces every `{{field}}` occurrence with the corresponding value from
 * the record. Unknown field references are left as empty strings.
 *
 * @param template - Template string, e.g. `"Hello {{name}}, your total is {{total}}"`
 * @param record   - Record data to substitute into the template
 * @returns Formatted string
 */
function formatTemplate(template: string, record: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, field: string) => {
    const value = record[field];
    if (value === undefined || value === null) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value as string | number | boolean);
  });
}

/**
 * Resolve a list of file paths to in-memory AttachmentPayload objects.
 * Files that cannot be read are skipped with a warning.
 */
async function resolveAttachments(paths: string[]): Promise<AttachmentPayload[]> {
  const attachments: AttachmentPayload[] = [];

  for (const filePath of paths) {
    try {
      const content = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();

      // Derive a reasonable MIME type from extension
      const mimeTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.txt': 'text/plain',
        '.csv': 'text/csv',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };

      attachments.push({
        filename: filePath.split('/').pop() ?? filePath,
        content,
        contentType: mimeTypes[ext] ?? 'application/octet-stream',
      });
    } catch (err) {
      logger.warn({ filePath, err }, 'send_notification: could not read attachment — skipping');
    }
  }

  return attachments;
}

/**
 * Handler for `send_notification` hook action type.
 *
 * Formats `action_config.template` using Mustache-style `{{field}}` substitution
 * from the record, then delivers the message via the specified channel.
 *
 * Supported channels:
 *   - `whatsapp` — sends via registered WhatsApp connector sender
 *   - `telegram` — sends via registered Telegram connector sender
 *   - `email`    — sends via registered email-sender (requires `subject` config)
 *   - `webhook`  — sends JSON POST to `action_config.url` via HTTP fetch
 *
 * action_config fields:
 *   - `channel`      (required) — delivery channel: `whatsapp` | `telegram` | `email` | `webhook`
 *   - `to`           (required for whatsapp/telegram/email) — recipient identifier
 *   - `template`     (required) — message body template with `{{field}}` placeholders
 *   - `subject`      (optional, used by email channel) — email subject line
 *   - `url`          (required for webhook) — URL to POST to
 *   - `attachments`  (optional) — array of file paths to attach
 */
async function handleSendNotification(
  hook: DocTypeHook,
  record: Record<string, unknown>,
  _db: Database.Database,
): Promise<void> {
  const config = hook.action_config;

  const channel = config['channel'] as string | undefined;
  const template = config['template'] as string | undefined;
  const to = config['to'] as string | undefined;
  const subject = config['subject'] as string | undefined;
  const webhookUrl = config['url'] as string | undefined;
  const attachmentPaths = Array.isArray(config['attachments'])
    ? (config['attachments'] as string[])
    : [];

  if (!channel) {
    logger.warn({ hookId: hook.id }, 'send_notification hook missing "channel" in action_config');
    return;
  }

  if (!template) {
    logger.warn({ hookId: hook.id }, 'send_notification hook missing "template" in action_config');
    return;
  }

  // Format the message template with record field values
  const message = formatTemplate(template, record);

  // Resolve attachments
  const attachments = attachmentPaths.length > 0 ? await resolveAttachments(attachmentPaths) : [];

  logger.debug(
    { hookId: hook.id, channel, to, attachmentCount: attachments.length },
    'send_notification: delivering message',
  );

  if (channel === 'webhook') {
    // Webhook delivery — HTTP POST with JSON body
    if (!webhookUrl) {
      logger.warn(
        { hookId: hook.id },
        'send_notification webhook channel missing "url" in action_config',
      );
      return;
    }

    const payload = {
      message,
      record,
      attachments: attachmentPaths,
      hook_id: hook.id,
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Webhook delivery failed: HTTP ${response.status.toString()} ${response.statusText}`,
      );
    }

    logger.info({ hookId: hook.id, url: webhookUrl }, 'send_notification: webhook delivered');
    return;
  }

  if (channel === 'email') {
    if (!to) {
      logger.warn(
        { hookId: hook.id },
        'send_notification email channel missing "to" in action_config',
      );
      return;
    }

    const emailSender = notificationSenders.email;
    if (!emailSender) {
      logger.warn({ hookId: hook.id }, 'send_notification: no email sender registered — skipping');
      return;
    }

    await emailSender(to, subject ?? 'Notification', message, attachments);
    logger.info({ hookId: hook.id, to }, 'send_notification: email delivered');
    return;
  }

  if (channel === 'whatsapp') {
    if (!to) {
      logger.warn(
        { hookId: hook.id },
        'send_notification whatsapp channel missing "to" in action_config',
      );
      return;
    }

    const whatsappSender = notificationSenders.whatsapp;
    if (!whatsappSender) {
      logger.warn(
        { hookId: hook.id },
        'send_notification: no whatsapp sender registered — skipping',
      );
      return;
    }

    await whatsappSender(to, message, attachments);
    logger.info({ hookId: hook.id, to }, 'send_notification: whatsapp message delivered');
    return;
  }

  if (channel === 'telegram') {
    if (!to) {
      logger.warn(
        { hookId: hook.id },
        'send_notification telegram channel missing "to" in action_config',
      );
      return;
    }

    const telegramSender = notificationSenders.telegram;
    if (!telegramSender) {
      logger.warn(
        { hookId: hook.id },
        'send_notification: no telegram sender registered — skipping',
      );
      return;
    }

    await telegramSender(to, message, attachments);
    logger.info({ hookId: hook.id, to }, 'send_notification: telegram message delivered');
    return;
  }

  logger.warn(
    { hookId: hook.id, channel },
    'send_notification: unknown channel — no delivery performed',
  );
}

// ---------------------------------------------------------------------------
// Record field extraction helpers
// ---------------------------------------------------------------------------

/** Safely read a string value from a record, checking camelCase then snake_case. */
function strField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): string | undefined {
  const v = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  if (v === undefined || v === null) return undefined;
  return String(v as string | number | boolean);
}

/** Safely read a numeric value from a record, checking camelCase then snake_case. */
function numField(
  record: Record<string, unknown>,
  camelKey: string,
  snakeKey?: string,
): number | undefined {
  const v = record[camelKey] ?? (snakeKey ? record[snakeKey] : undefined);
  if (v === undefined || v === null) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

/** Map a flat record to InvoiceData, supporting both camelCase and snake_case field names. */
function recordToInvoiceData(record: Record<string, unknown>): InvoiceData {
  return {
    invoiceNumber: strField(record, 'invoiceNumber', 'invoice_number') ?? '',
    date: strField(record, 'date') ?? new Date().toISOString().split('T')[0]!,
    dueDate: strField(record, 'dueDate', 'due_date'),
    customerName: strField(record, 'customerName', 'customer_name') ?? '',
    customerEmail: strField(record, 'customerEmail', 'customer_email'),
    customerAddress: strField(record, 'customerAddress', 'customer_address'),
    customerPhone: strField(record, 'customerPhone', 'customer_phone'),
    notes: strField(record, 'notes'),
    terms: strField(record, 'terms'),
    paymentLink: strField(record, 'paymentLink', 'payment_link'),
    taxRate: numField(record, 'taxRate', 'tax_rate'),
    currency: strField(record, 'currency'),
  };
}

/** Extract InvoiceItem[] from `record.items` or `record.line_items`. */
function recordToInvoiceItems(record: Record<string, unknown>): InvoiceItem[] {
  const raw = record['items'] ?? record['lineItems'] ?? record['line_items'];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      description: strField(r, 'description') ?? '',
      quantity: numField(r, 'quantity') ?? 1,
      unitPrice: numField(r, 'unitPrice', 'unit_price') ?? 0,
      total: numField(r, 'total'),
    };
  });
}

/** Map a flat record to QuoteData. */
function recordToQuoteData(record: Record<string, unknown>): QuoteData {
  return {
    quoteNumber: strField(record, 'quoteNumber', 'quote_number') ?? '',
    date: strField(record, 'date') ?? new Date().toISOString().split('T')[0]!,
    validUntil: strField(record, 'validUntil', 'valid_until'),
    customerName: strField(record, 'customerName', 'customer_name') ?? '',
    customerEmail: strField(record, 'customerEmail', 'customer_email'),
    customerAddress: strField(record, 'customerAddress', 'customer_address'),
    customerPhone: strField(record, 'customerPhone', 'customer_phone'),
    notes: strField(record, 'notes'),
    terms: strField(record, 'terms'),
    taxRate: numField(record, 'taxRate', 'tax_rate'),
    currency: strField(record, 'currency'),
  };
}

/** Extract QuoteItem[] from `record.items` or `record.line_items`. */
function recordToQuoteItems(record: Record<string, unknown>): QuoteItem[] {
  const raw = record['items'] ?? record['lineItems'] ?? record['line_items'];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      description: strField(r, 'description') ?? '',
      quantity: numField(r, 'quantity') ?? 1,
      unitPrice: numField(r, 'unitPrice', 'unit_price') ?? 0,
      total: numField(r, 'total'),
    };
  });
}

/** Map a flat record to ReceiptData. */
function recordToReceiptData(record: Record<string, unknown>): ReceiptData {
  return {
    receiptNumber: strField(record, 'receiptNumber', 'receipt_number'),
    date: strField(record, 'date') ?? new Date().toISOString().split('T')[0]!,
    time: strField(record, 'time'),
    customerName: strField(record, 'customerName', 'customer_name'),
    paymentMethod: strField(record, 'paymentMethod', 'payment_method'),
    notes: strField(record, 'notes'),
    currency: strField(record, 'currency'),
  };
}

/** Extract ReceiptItem[] from `record.items`. */
function recordToReceiptItems(record: Record<string, unknown>): ReceiptItem[] {
  const raw = record['items'] ?? record['lineItems'] ?? record['line_items'];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      description: strField(r, 'description') ?? '',
      quantity: numField(r, 'quantity'),
      amount: numField(r, 'amount') ?? numField(r, 'total') ?? 0,
    };
  });
}

/** Extract ReportSection[] from `record.sections`. */
function recordToReportSections(record: Record<string, unknown>): ReportSection[] {
  const raw = record['sections'];
  if (!Array.isArray(raw)) return [];
  return raw as ReportSection[];
}

// ---------------------------------------------------------------------------
// Minimal Puppeteer page type for PDF generation (fallback for custom templates)
// ---------------------------------------------------------------------------

interface PuppeteerPdfPage {
  setViewport(opts: { width: number; height: number }): Promise<void>;
  setContent(html: string, opts: { waitUntil: string }): Promise<void>;
  pdf(opts: { path: string; format: string; printBackground: boolean }): Promise<unknown>;
}

interface PuppeteerPdfBrowser {
  newPage(): Promise<PuppeteerPdfPage>;
  close(): Promise<void>;
}

interface PuppeteerModule {
  launch(opts: { headless: boolean; args: string[] }): Promise<PuppeteerPdfBrowser>;
}

/**
 * Build a simple HTML document for a record, using an optional HTML template.
 *
 * If `.openbridge/templates/{templateName}.html` exists in the workspace, it is
 * loaded and Mustache-style `{{field}}` placeholders are substituted with record
 * values. Otherwise, a generic HTML table listing all record fields is generated.
 */
async function buildPdfHtml(
  workspacePath: string,
  templateName: string,
  record: Record<string, unknown>,
): Promise<string> {
  const templatePath = join(workspacePath, '.openbridge', 'templates', `${templateName}.html`);

  try {
    const raw = await readFile(templatePath, 'utf-8');
    return formatTemplate(raw, record);
  } catch {
    // Template file not found — generate a generic HTML table
    const rows = Object.entries(record)
      .map(([k, v]) => {
        const display =
          v === null || v === undefined
            ? ''
            : typeof v === 'object'
              ? JSON.stringify(v)
              : String(v as string | number | boolean);
        return `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(display)}</td></tr>`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(templateName)}</title>
  <style>
    body { font-family: sans-serif; margin: 32px; color: #222; }
    h1 { font-size: 1.4em; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; }
    th { text-align: left; width: 35%; padding: 6px 10px; background: #f5f5f5; border: 1px solid #ddd; font-weight: 600; }
    td { padding: 6px 10px; border: 1px solid #ddd; }
    tr:nth-child(even) td { background: #fafafa; }
  </style>
</head>
<body>
  <h1>${escapeHtml(templateName)}</h1>
  <table>
    ${rows}
  </table>
</body>
</html>`;
  }
}

/** Minimal HTML entity escaping for text content. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Built-in pdfmake template names — these bypass Puppeteer entirely. */
const PDFMAKE_TEMPLATES = new Set(['invoice', 'quote', 'receipt', 'report']);

/**
 * Handler for `generate_pdf` hook action type.
 *
 * Generates a PDF using:
 *   - pdfmake templates (invoice, quote, receipt, report) — no Chromium needed
 *   - Puppeteer HTML→PDF fallback for custom `.openbridge/templates/{name}.html` files
 *
 * Saves the file to `.openbridge/generated/` and updates `output_field` on the record.
 *
 * action_config fields:
 *   - `template`      (required) — "invoice" | "quote" | "receipt" | "report",
 *                                  or a custom HTML template name
 *   - `output_field`  (required) — record field to set with the generated PDF path
 */
async function handleGeneratePdf(
  hook: DocTypeHook,
  record: Record<string, unknown>,
  _db: Database.Database,
): Promise<void> {
  const config = hook.action_config;
  const templateName = config['template'] as string | undefined;
  const outputField = config['output_field'] as string | undefined;

  if (!templateName) {
    logger.warn({ hookId: hook.id }, 'generate_pdf hook missing "template" in action_config');
    return;
  }

  if (!outputField) {
    logger.warn({ hookId: hook.id }, 'generate_pdf hook missing "output_field" in action_config');
    return;
  }

  const workspacePath = registeredWorkspacePath;
  if (!workspacePath) {
    logger.warn(
      { hookId: hook.id },
      'generate_pdf hook: no workspace path registered — call registerWorkspacePath() on startup',
    );
    return;
  }

  let outputPath: string;

  if (PDFMAKE_TEMPLATES.has(templateName)) {
    // ── pdfmake route for known business document templates ─────────────────
    const branding = await loadBranding(workspacePath);

    let definition;
    if (templateName === 'invoice') {
      definition = buildInvoiceDefinition(
        recordToInvoiceData(record),
        recordToInvoiceItems(record),
        branding,
      );
    } else if (templateName === 'quote') {
      definition = buildQuoteDefinition(
        recordToQuoteData(record),
        recordToQuoteItems(record),
        branding,
      );
    } else if (templateName === 'receipt') {
      definition = buildReceiptDefinition(
        recordToReceiptData(record),
        recordToReceiptItems(record),
        branding,
      );
    } else {
      // templateName === 'report'
      const title = strField(record, 'title') ?? 'Report';
      definition = buildReportDefinition(title, recordToReportSections(record), branding);
    }

    outputPath = await generatePdf(definition, workspacePath);

    logger.info(
      { hookId: hook.id, outputPath, template: templateName },
      'generate_pdf hook: PDF written via pdfmake',
    );
  } else {
    // ── Puppeteer fallback for custom HTML templates ─────────────────────────
    const outputDir = join(workspacePath, '.openbridge', 'generated');
    await mkdir(outputDir, { recursive: true });

    const html = await buildPdfHtml(workspacePath, templateName, record);
    const outputFilename = `${templateName}-${randomUUID()}.pdf`;
    outputPath = join(outputDir, outputFilename);

    let puppeteer: PuppeteerModule;
    try {
      const mod = (await import('puppeteer')) as { default?: PuppeteerModule } & PuppeteerModule;
      puppeteer = mod.default ?? mod;
    } catch {
      throw new Error(
        'Puppeteer is not installed. Run `npm install puppeteer` to enable PDF generation.',
      );
    }

    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1240, height: 1754 }); // A4-ish at 150 dpi
      await page.setContent(html, { waitUntil: 'load' });
      await page.pdf({ path: outputPath, format: 'A4', printBackground: true });
    } finally {
      await browser.close();
    }

    const fileStat = await stat(outputPath);
    logger.info(
      { hookId: hook.id, outputPath, sizeBytes: fileStat.size },
      'generate_pdf hook: PDF written via Puppeteer',
    );
  }

  // Update the record field with the generated file path
  record[outputField] = outputPath;

  logger.debug(
    { hookId: hook.id, outputField, outputPath },
    'generate_pdf hook executed successfully',
  );
}

/**
 * Handler for `create_payment_link` hook action type.
 *
 * On transition events (after timing): reads amount and description from the
 * record using the configured field names, calls the registered Stripe adapter's
 * `createPaymentLink()`, and stores the returned URL in `action_config.output_field`.
 *
 * If the Stripe adapter has not been registered (Phase 119 not connected), the
 * hook logs a warning and skips without throwing.
 *
 * action_config fields:
 *   - `amount_field`      (required) — record field containing the payment amount
 *                                      (numeric, currency's smallest unit, e.g. cents)
 *   - `description_field` (required) — record field containing the payment description
 *   - `output_field`      (required) — record field to set with the generated payment link URL
 */
async function handleCreatePaymentLink(
  hook: DocTypeHook,
  record: Record<string, unknown>,
  _db: Database.Database,
): Promise<void> {
  const config = hook.action_config;
  const amountField = config['amount_field'] as string | undefined;
  const descriptionField = config['description_field'] as string | undefined;
  const outputField = config['output_field'] as string | undefined;

  if (!amountField) {
    logger.warn(
      { hookId: hook.id },
      'create_payment_link hook missing "amount_field" in action_config',
    );
    return;
  }

  if (!descriptionField) {
    logger.warn(
      { hookId: hook.id },
      'create_payment_link hook missing "description_field" in action_config',
    );
    return;
  }

  if (!outputField) {
    logger.warn(
      { hookId: hook.id },
      'create_payment_link hook missing "output_field" in action_config',
    );
    return;
  }

  if (!stripeAdapter) {
    logger.warn(
      { hookId: hook.id },
      'create_payment_link hook: Stripe integration not connected — skipping (register via registerStripeAdapter())',
    );
    return;
  }

  const amount = record[amountField];
  const description = record[descriptionField];

  if (amount === undefined || amount === null) {
    logger.warn(
      { hookId: hook.id, amountField },
      'create_payment_link hook: amount field is missing from record — skipping',
    );
    return;
  }

  const numericAmount = Number(amount);
  if (Number.isNaN(numericAmount)) {
    logger.warn(
      { hookId: hook.id, amountField, amount },
      'create_payment_link hook: amount field value is not numeric — skipping',
    );
    return;
  }

  let descriptionStr: string;
  if (description === undefined || description === null) {
    descriptionStr = '';
  } else if (typeof description === 'object') {
    descriptionStr = JSON.stringify(description);
  } else {
    descriptionStr = String(description as string | number | boolean);
  }

  logger.debug(
    { hookId: hook.id, amountField, descriptionField, amount: numericAmount },
    'create_payment_link: calling Stripe adapter',
  );

  const paymentUrl = await stripeAdapter.createPaymentLink(numericAmount, descriptionStr);

  record[outputField] = paymentUrl;

  logger.info(
    { hookId: hook.id, outputField, paymentUrl },
    'create_payment_link hook executed successfully',
  );
}

/**
 * Handler for `spawn_worker` hook action type.
 *
 * On any event (after timing): formats `action_config.prompt` using Mustache-style
 * `{{field}}` substitution from the record, then spawns an AI worker via the
 * registered WorkerSpawnerFn. Captures the worker's stdout and optionally stores it
 * in the record field specified by `action_config.output_field`.
 *
 * If no worker spawner has been registered (registerWorkerSpawner() not called),
 * the hook logs a warning and skips without throwing.
 *
 * action_config fields:
 *   - `prompt`       (required) — worker prompt template with `{{field}}` placeholders
 *   - `skill_pack`   (optional) — tool profile / skill pack name passed to the spawner
 *                                 (e.g. 'read-only', 'code-edit', 'full-access')
 *   - `output_field` (optional) — record field to set with the worker's stdout output
 */
async function handleSpawnWorker(
  hook: DocTypeHook,
  record: Record<string, unknown>,
  _db: Database.Database,
): Promise<void> {
  const config = hook.action_config;

  const promptTemplate = config['prompt'] as string | undefined;
  const skillPack = config['skill_pack'] as string | undefined;
  const outputField = config['output_field'] as string | undefined;

  if (!promptTemplate) {
    logger.warn({ hookId: hook.id }, 'spawn_worker hook missing "prompt" in action_config');
    return;
  }

  if (!workerSpawner) {
    logger.warn(
      { hookId: hook.id },
      'spawn_worker hook: no worker spawner registered — skipping (register via registerWorkerSpawner())',
    );
    return;
  }

  const workspacePath = registeredWorkspacePath;
  if (!workspacePath) {
    logger.warn(
      { hookId: hook.id },
      'spawn_worker hook: no workspace path registered — call registerWorkspacePath() on startup',
    );
    return;
  }

  // Format the prompt template with record field values
  const formattedPrompt = formatTemplate(promptTemplate, record);

  logger.debug(
    { hookId: hook.id, skillPack, hasOutputField: Boolean(outputField) },
    'spawn_worker: launching AI worker',
  );

  const workerOutput = await workerSpawner(formattedPrompt, workspacePath, skillPack);

  if (outputField) {
    record[outputField] = workerOutput;
    logger.debug(
      { hookId: hook.id, outputField },
      'spawn_worker: worker output stored in record field',
    );
  }

  logger.info({ hookId: hook.id, skillPack }, 'spawn_worker hook executed successfully');
}

/**
 * Returns a stub handler that logs a "not yet implemented" warning and returns
 * without throwing, so it does not block other hooks in the sequence.
 */
function handleNotImplemented(actionType: string): HookHandler {
  return (_hook, _record, _db) => {
    logger.warn({ actionType }, 'Hook action type not yet implemented — skipping');
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute lifecycle hooks for a given (event, timing) combination.
 *
 * Loads hooks from the `doctype_hooks` metadata table filtered by:
 *   - `doctype_id` matches the given DocType
 *   - `event` matches `${timing}_${event}` (e.g. `before_create`, `after_transition`)
 *   - `enabled = 1`
 *   - Ordered by `sort_order` ASC
 *
 * Hooks are executed **sequentially** in sort_order. Errors are caught per hook
 * so that one failing hook does not prevent subsequent hooks from running.
 *
 * @param db      - better-sqlite3 Database instance (must have doctype_hooks table)
 * @param doctype - DocType definition (used for its `id`)
 * @param event   - Event name without timing prefix (e.g. `create`, `update`, `transition`)
 * @param record  - The current data record (may be mutated by before-hooks like generate_number)
 * @param timing  - Whether these are `before` or `after` hooks
 */
export async function executeHooks(
  db: Database.Database,
  doctype: DocType,
  event: string,
  record: Record<string, unknown>,
  timing: 'before' | 'after',
): Promise<void> {
  const fullEvent = `${timing}_${event}`;

  // Load hooks from the metadata table
  const rows = db
    .prepare(
      `SELECT * FROM doctype_hooks
       WHERE doctype_id = ? AND event = ? AND enabled = 1
       ORDER BY sort_order ASC`,
    )
    .all(doctype.id, fullEvent) as HookRow[];

  if (rows.length === 0) {
    logger.debug({ doctypeId: doctype.id, event: fullEvent }, 'No hooks to execute');
    return;
  }

  const hooks = rows.map(rowToHook);

  logger.debug(
    { doctypeId: doctype.id, event: fullEvent, hookCount: hooks.length },
    'Executing lifecycle hooks',
  );

  for (const hook of hooks) {
    logger.debug(
      { hookId: hook.id, actionType: hook.action_type, sortOrder: hook.sort_order },
      'Executing hook',
    );

    const handler = HOOK_HANDLERS[hook.action_type];

    if (!handler) {
      logger.warn(
        { hookId: hook.id, actionType: hook.action_type },
        'Unknown hook action_type — skipping',
      );
      continue;
    }

    try {
      await handler(hook, record, db);
      logger.debug({ hookId: hook.id, actionType: hook.action_type }, 'Hook executed successfully');
    } catch (err) {
      // Error isolation: log and continue — one failed hook must not block others
      logger.error(
        { err, hookId: hook.id, actionType: hook.action_type, doctypeId: doctype.id },
        'Hook execution failed — continuing with remaining hooks',
      );
    }
  }

  logger.debug(
    { doctypeId: doctype.id, event: fullEvent, hookCount: hooks.length },
    'All hooks processed',
  );
}

// ---------------------------------------------------------------------------
// Handler registration (used by sub-tasks OB-1377 through OB-1382)
// ---------------------------------------------------------------------------

/**
 * Register a handler for a specific hook action type.
 * Subsequent tasks (OB-1377+) call this to register their implementations,
 * overriding the default stub handlers.
 */
export function registerHookHandler(actionType: HookActionType, handler: HookHandler): void {
  HOOK_HANDLERS[actionType] = handler;
}

// Re-export the handler type for sub-task use
export type { HookHandler };
