import { z } from 'zod';
import { createLogger } from '../../core/logger.js';
import type { EmailConfig } from '../../core/email-sender.js';
import { sendEmail } from '../../core/email-sender.js';
import type { StepResult } from '../../types/workflow.js';

const logger = createLogger('send-step');

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const SendConfigSchema = z
  .object({
    /**
     * Channel type: "whatsapp", "telegram", "discord", "email", or "webhook".
     * For "webhook" the `to` field is treated as the target URL.
     */
    channel: z.string().min(1),
    /**
     * Recipient identifier.
     * - whatsapp/telegram/discord: phone number or chat ID
     * - email: recipient email address
     * - webhook: full URL to POST to
     */
    to: z.string().min(1),
    /**
     * Message template — supports Mustache-style `{{field}}` substitution
     * using the incoming StepResult json data.
     */
    message: z.string().min(1),
    /**
     * Optional file paths (from StepResult.files or absolute paths) to attach
     * to the outgoing message.
     */
    attachments: z.array(z.string()).optional(),
    /**
     * For "email" channel: the subject line (supports {{field}} templates).
     */
    subject: z.string().optional(),
    /**
     * For "webhook" channel: additional HTTP headers to include.
     */
    headers: z.record(z.string()).optional(),
  })
  .strict();

export type SendConfig = z.infer<typeof SendConfigSchema>;

// ---------------------------------------------------------------------------
// External dependencies (injected by the engine)
// ---------------------------------------------------------------------------

/**
 * Context injected by the workflow engine so the send step can reach
 * real messaging infrastructure without importing it statically.
 */
export interface SendStepContext {
  /**
   * Send a text message (+ optional file attachments) through a connector
   * channel (WhatsApp, Telegram, Discord, etc.).
   *
   * @param to          - Recipient ID / phone number / chat ID
   * @param text        - Formatted message body
   * @param attachments - Optional list of file paths to attach
   */
  sendMessage?: (to: string, text: string, attachments?: string[]) => Promise<void>;

  /** SMTP email configuration required when `channel === "email"`. */
  emailConfig?: EmailConfig;
}

// ---------------------------------------------------------------------------
// Mustache-style template engine  ({{field}} and {{nested.field}})
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-path field reference from a data object.
 * e.g. "invoice.total" → data.invoice.total
 */
function resolveField(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined) return '';
    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current)) {
      const idx = Number(part);
      current = isNaN(idx) ? undefined : current[idx];
    } else {
      return '';
    }
  }
  return current ?? '';
}

/**
 * Replace all `{{field}}` tokens in `template` with values from `data`.
 * Unresolved tokens are replaced with an empty string.
 */
export function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const value = resolveField(data, path.trim());
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value as string | number | boolean);
  });
}

// ---------------------------------------------------------------------------
// Channel senders
// ---------------------------------------------------------------------------

async function sendViaConnector(
  context: SendStepContext,
  to: string,
  text: string,
  attachments: string[],
): Promise<void> {
  if (!context.sendMessage) {
    throw new Error(
      'sendMessage callback not provided — cannot send via connector channel. ' +
        'Inject a SendStepContext with sendMessage when wiring the workflow engine.',
    );
  }
  await context.sendMessage(to, text, attachments.length > 0 ? attachments : undefined);
}

async function sendViaEmail(
  context: SendStepContext,
  config: SendConfig,
  text: string,
): Promise<void> {
  if (!context.emailConfig) {
    throw new Error('emailConfig not provided in SendStepContext — required for channel "email".');
  }
  const subject = config.subject ? renderTemplate(config.subject, {}) : 'Workflow Notification';
  await sendEmail(context.emailConfig, config.to, subject, text);
}

async function sendViaWebhook(
  url: string,
  payload: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook POST to ${url} failed with status ${response.status}`);
  }
}

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------

/**
 * Execute a send step: format a message template with input data and deliver
 * it via the specified channel (WhatsApp/connector, email, or HTTP webhook).
 *
 * @param context - External dependencies (sendMessage callback, emailConfig)
 * @param config  - Step configuration (channel, to, message template, attachments)
 * @param input   - Incoming data envelope from the previous step
 * @returns The original input passed through unchanged (with sent metadata)
 */
export async function executeSendStep(
  context: SendStepContext,
  config: {
    channel: string;
    to: string;
    message: string;
    attachments?: string[];
    subject?: string;
    headers?: Record<string, string>;
  },
  input: StepResult,
): Promise<StepResult> {
  const parsed = SendConfigSchema.parse(config);

  // Render message template with input data
  const formattedMessage = renderTemplate(parsed.message, input.json);

  // Collect attachments: from config + from incoming files
  const attachments: string[] = [...(parsed.attachments ?? []), ...(input.files ?? [])];

  // Render `to` in case it also contains a template reference
  const to = renderTemplate(parsed.to, input.json);

  const channel = parsed.channel.toLowerCase();

  logger.debug({ channel, to, hasAttachments: attachments.length > 0 }, 'Sending message');

  try {
    if (channel === 'email') {
      const renderedSubject = parsed.subject
        ? renderTemplate(parsed.subject, input.json)
        : undefined;
      await sendViaEmail(context, { ...parsed, to, subject: renderedSubject }, formattedMessage);
    } else if (channel === 'webhook') {
      await sendViaWebhook(to, { message: formattedMessage, data: input.json }, parsed.headers);
    } else {
      // whatsapp, telegram, discord, console — any connector-backed channel
      await sendViaConnector(context, to, formattedMessage, attachments);
    }

    logger.info({ channel, to }, 'Send step completed');

    return {
      json: {
        ...input.json,
        _send_channel: channel,
        _send_to: to,
        _send_status: 'sent',
      },
      files: input.files,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ channel, to, error: errorMsg }, 'Send step failed');
    throw err;
  }
}
