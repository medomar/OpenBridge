import nodemailer from 'nodemailer';
import { createLogger } from './logger.js';

const logger = createLogger('email-sender');

export interface EmailConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  /** Allowlist of email addresses that can receive emails */
  allowlist: string[];
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

/**
 * Send an email via SMTP using the provided config.
 * Only sends to addresses in the config allowlist.
 */
export async function sendEmail(
  config: EmailConfig,
  to: string,
  subject: string,
  body: string,
  attachments?: EmailAttachment[],
): Promise<void> {
  if (!config.allowlist.includes(to)) {
    logger.warn({ to }, 'Email blocked — recipient not in allowlist');
    throw new Error(`Recipient ${to} is not in the email allowlist`);
  }

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  await transporter.sendMail({
    from: config.from,
    to,
    subject,
    text: body,
    attachments: attachments?.map((att) => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType,
    })),
  });

  logger.info({ to, subject }, 'Email sent');
}
