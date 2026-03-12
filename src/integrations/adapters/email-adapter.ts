import nodemailer from 'nodemailer';
import type { gmail_v1 } from 'googleapis';
import { createLogger } from '../../core/logger.js';
import type {
  BusinessIntegration,
  HealthStatus,
  IntegrationCapability,
  IntegrationConfig,
} from '../../types/integration.js';

const logger = createLogger('email-adapter');

interface EmailMessage {
  id: string;
  from: string;
  to: string | string[];
  subject: string;
  date: string;
  snippet: string;
  hasAttachments: boolean;
}

interface EmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  data?: string; // base64-encoded content
}

/**
 * Email integration adapter.
 *
 * Capabilities:
 * - send_email: Send an email via SMTP (nodemailer)
 * - read_emails: Read recent emails from Gmail (oauth2) or IMAP
 * - search_emails: Search emails by query
 * - get_attachments: Download attachments from an email
 *
 * Credentials expected (from config.options):
 * - Auth type "oauth2" (Gmail):
 *     clientId: OAuth2 client ID
 *     clientSecret: OAuth2 client secret
 *     refreshToken: OAuth2 refresh token
 *     userEmail: Gmail address (used as sender + mailbox owner)
 * - Auth type "smtp" (generic SMTP + IMAP):
 *     smtpHost: SMTP server hostname
 *     smtpPort: SMTP port (default 587)
 *     imapHost: IMAP server hostname
 *     imapPort: IMAP port (default 993)
 *     user: Email username
 *     pass: Email password
 *     from: From address (defaults to user if not specified)
 */
export class EmailAdapter implements BusinessIntegration {
  readonly name = 'email';
  readonly type = 'communication' as const;

  private authType: 'oauth2' | 'smtp' = 'smtp';
  private config: IntegrationConfig | null = null;

  // Gmail-specific
  private gmailClient: gmail_v1.Gmail | null = null;
  private gmailUserId = 'me';

  // SMTP transporter (used for both auth types)
  private transporter: nodemailer.Transporter | null = null;

  async initialize(config: IntegrationConfig): Promise<void> {
    this.config = config;
    const opts = config.options;
    this.authType = ((opts['authType'] as string) ?? 'smtp') as 'oauth2' | 'smtp';

    if (this.authType === 'oauth2') {
      await this.initializeGmail(opts);
    } else {
      await this.initializeSmtp(opts);
    }

    logger.info({ authType: this.authType }, 'Email adapter initialized');
  }

  async healthCheck(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();

    if (this.authType === 'oauth2') {
      if (!this.gmailClient) {
        return { status: 'unhealthy', message: 'Not initialized', checkedAt, details: {} };
      }
      try {
        const res = await this.gmailClient.users.getProfile({ userId: this.gmailUserId });
        return {
          status: 'healthy',
          message: 'Gmail API reachable',
          checkedAt,
          details: {
            email: res.data.emailAddress ?? 'unknown',
            totalMessages: res.data.messagesTotal ?? 0,
          },
        };
      } catch (err) {
        return {
          status: 'unhealthy',
          message: err instanceof Error ? err.message : String(err),
          checkedAt,
          details: {},
        };
      }
    } else {
      if (!this.transporter) {
        return { status: 'unhealthy', message: 'Not initialized', checkedAt, details: {} };
      }
      try {
        await this.transporter.verify();
        return {
          status: 'healthy',
          message: 'SMTP connection verified',
          checkedAt,
          details: {},
        };
      } catch (err) {
        return {
          status: 'unhealthy',
          message: err instanceof Error ? err.message : String(err),
          checkedAt,
          details: {},
        };
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    this.gmailClient = null;
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }
    this.config = null;
    logger.info('Email adapter shut down');
  }

  describeCapabilities(): IntegrationCapability[] {
    return [
      {
        name: 'send_email',
        description:
          'Send an email. Params: to (string, recipient address), subject (string), body (string, plain text), html (string, optional HTML body).',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'read_emails',
        description:
          'Read recent emails. Params: folder (string, optional — e.g. "INBOX", default "INBOX"), limit (number, optional — default 20, max 50).',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'search_emails',
        description:
          'Search emails by query. Params: query (string — Gmail query syntax for oauth2, or plain search term for IMAP), limit (number, optional — default 20, max 50).',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'get_attachments',
        description:
          'Get attachments from a specific email. Params: messageId (string — email ID from read_emails/search_emails), includeData (boolean, optional — whether to include base64 attachment data, default false).',
        category: 'read',
        requiresApproval: false,
      },
    ];
  }

  async query(operation: string, params: Record<string, unknown>): Promise<unknown> {
    this.assertInitialized();

    switch (operation) {
      case 'read_emails':
        return await this.readEmails(params);
      case 'search_emails':
        return await this.searchEmails(params);
      case 'get_attachments':
        return await this.getAttachments(params);
      default:
        throw new Error(`Unknown query operation: ${operation}`);
    }
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<unknown> {
    this.assertInitialized();

    switch (operation) {
      case 'send_email':
        return await this.sendEmail(params);
      default:
        throw new Error(`Unknown execute operation: ${operation}`);
    }
  }

  // ── Private: initialization ─────────────────────────────────────

  private async initializeGmail(opts: Record<string, unknown>): Promise<void> {
    const { google } = await import('googleapis');

    const clientId = opts['clientId'] as string | undefined;
    const clientSecret = opts['clientSecret'] as string | undefined;
    const refreshToken = opts['refreshToken'] as string | undefined;
    const userEmail = opts['userEmail'] as string | undefined;

    if (!clientId || typeof clientId !== 'string') {
      throw new Error('Email adapter (oauth2) requires clientId in config.options');
    }
    if (!clientSecret || typeof clientSecret !== 'string') {
      throw new Error('Email adapter (oauth2) requires clientSecret in config.options');
    }
    if (!refreshToken || typeof refreshToken !== 'string') {
      throw new Error('Email adapter (oauth2) requires refreshToken in config.options');
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });

    this.gmailClient = google.gmail({ version: 'v1', auth });
    if (userEmail) {
      this.gmailUserId = userEmail;
    }

    // Verify access
    try {
      await this.gmailClient.users.getProfile({ userId: this.gmailUserId });
    } catch (err) {
      this.gmailClient = null;
      throw new Error(
        `Gmail initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Set up nodemailer OAuth2 transporter for sending
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: userEmail ?? this.gmailUserId,
        clientId,
        clientSecret,
        refreshToken,
      },
    });
  }

  private async initializeSmtp(opts: Record<string, unknown>): Promise<void> {
    const smtpHost = opts['smtpHost'] as string | undefined;
    const smtpPort = (opts['smtpPort'] as number | undefined) ?? 587;
    const user = opts['user'] as string | undefined;
    const pass = opts['pass'] as string | undefined;

    if (!smtpHost || typeof smtpHost !== 'string') {
      throw new Error('Email adapter (smtp) requires smtpHost in config.options');
    }
    if (!user || typeof user !== 'string') {
      throw new Error('Email adapter (smtp) requires user in config.options');
    }
    if (!pass || typeof pass !== 'string') {
      throw new Error('Email adapter (smtp) requires pass in config.options');
    }

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user, pass },
    });

    await this.transporter.verify();
  }

  // ── Private: operations ─────────────────────────────────────────

  private async sendEmail(
    params: Record<string, unknown>,
  ): Promise<{ success: boolean; messageId: string }> {
    const to = params['to'] as string;
    const subject = params['subject'] as string;
    const body = params['body'] as string;
    const html = params['html'] as string | undefined;

    if (!to || typeof to !== 'string') throw new Error('to is required');
    if (!subject || typeof subject !== 'string') throw new Error('subject is required');
    if (!body || typeof body !== 'string') throw new Error('body is required');

    const opts = this.config?.options ?? {};
    const from =
      this.authType === 'oauth2'
        ? ((opts['userEmail'] as string | undefined) ?? 'me')
        : ((opts['from'] as string | undefined) ?? (opts['user'] as string | undefined) ?? '');

    const result = (await this.transporter!.sendMail({
      from,
      to,
      subject,
      text: body,
      ...(html ? { html } : {}),
    })) as { messageId?: string };

    logger.info({ to, subject, messageId: result.messageId }, 'Email sent');
    return { success: true, messageId: result.messageId ?? '' };
  }

  private async readEmails(
    params: Record<string, unknown>,
  ): Promise<{ messages: EmailMessage[]; total: number }> {
    const limit = Math.min((params['limit'] as number | undefined) ?? 20, 50);

    if (this.authType === 'oauth2') {
      return await this.gmailReadEmails('', limit);
    } else {
      const folder = (params['folder'] as string | undefined) ?? 'INBOX';
      return await this.imapReadEmails(folder, '', limit);
    }
  }

  private async searchEmails(
    params: Record<string, unknown>,
  ): Promise<{ messages: EmailMessage[]; total: number }> {
    const query = (params['query'] as string | undefined) ?? '';
    const limit = Math.min((params['limit'] as number | undefined) ?? 20, 50);

    if (this.authType === 'oauth2') {
      return await this.gmailReadEmails(query, limit);
    } else {
      const folder = (params['folder'] as string | undefined) ?? 'INBOX';
      return await this.imapReadEmails(folder, query, limit);
    }
  }

  private async getAttachments(
    params: Record<string, unknown>,
  ): Promise<{ messageId: string; attachments: EmailAttachment[] }> {
    const messageId = params['messageId'] as string;
    const includeData = (params['includeData'] as boolean | undefined) ?? false;

    if (!messageId || typeof messageId !== 'string') throw new Error('messageId is required');

    if (this.authType === 'oauth2') {
      return await this.gmailGetAttachments(messageId, includeData);
    } else {
      return await this.imapGetAttachments(messageId, includeData);
    }
  }

  // ── Gmail helpers ───────────────────────────────────────────────

  private async gmailReadEmails(
    query: string,
    limit: number,
  ): Promise<{ messages: EmailMessage[]; total: number }> {
    const listRes = await this.gmailClient!.users.messages.list({
      userId: this.gmailUserId,
      q: query || undefined,
      maxResults: limit,
    });

    const messageList = listRes.data.messages ?? [];
    const total = listRes.data.resultSizeEstimate ?? messageList.length;

    const messages: EmailMessage[] = await Promise.all(
      messageList.map(async (m) => {
        const msg = await this.gmailClient!.users.messages.get({
          userId: this.gmailUserId,
          id: m.id ?? '',
          format: 'metadata',
          metadataHeaders: ['From', 'To', 'Subject', 'Date'],
        });

        const headers = msg.data.payload?.headers ?? [];
        const header = (name: string) =>
          headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? '';

        const hasAttachments = (msg.data.payload?.parts ?? []).some(
          (p) => p.filename && p.filename.length > 0,
        );

        return {
          id: m.id ?? '',
          from: header('From'),
          to: header('To'),
          subject: header('Subject'),
          date: header('Date'),
          snippet: msg.data.snippet ?? '',
          hasAttachments,
        };
      }),
    );

    return { messages, total };
  }

  private async gmailGetAttachments(
    messageId: string,
    includeData: boolean,
  ): Promise<{ messageId: string; attachments: EmailAttachment[] }> {
    const msg = await this.gmailClient!.users.messages.get({
      userId: this.gmailUserId,
      id: messageId,
      format: 'full',
    });

    const parts = msg.data.payload?.parts ?? [];
    const attachments: EmailAttachment[] = [];

    for (const part of parts) {
      if (!part.filename || part.filename.length === 0) continue;

      const att: EmailAttachment = {
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        size: part.body?.size ?? 0,
      };

      if (includeData && part.body?.attachmentId) {
        const attRes = await this.gmailClient!.users.messages.attachments.get({
          userId: this.gmailUserId,
          messageId,
          id: part.body.attachmentId,
        });
        att.data = attRes.data.data ?? undefined;
      } else if (includeData && part.body?.data) {
        att.data = part.body.data;
      }

      attachments.push(att);
    }

    return { messageId, attachments };
  }

  // ── IMAP helpers ────────────────────────────────────────────────

  private async imapReadEmails(
    folder: string,
    query: string,
    limit: number,
  ): Promise<{ messages: EmailMessage[]; total: number }> {
    const opts = this.config?.options ?? {};
    const imapHost = opts['imapHost'] as string | undefined;
    const imapPort = (opts['imapPort'] as number | undefined) ?? 993;
    const user = opts['user'] as string;
    const pass = opts['pass'] as string;

    if (!imapHost) {
      throw new Error('imapHost is required in config.options for IMAP email reading');
    }

    const Imap = (await import('imap')).default;

    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user,
        password: pass,
        host: imapHost,
        port: imapPort,
        tls: imapPort === 993,
        tlsOptions: { rejectUnauthorized: false },
      });

      const messages: EmailMessage[] = [];

      imap.once('ready', () => {
        imap.openBox(folder, true, (err, box) => {
          if (err) {
            imap.end();
            reject(err);
            return;
          }

          const total = box.messages.total;
          if (total === 0) {
            imap.end();
            resolve({ messages: [], total: 0 });
            return;
          }

          // Build search criteria
          const criteria: Array<string | string[]> = query ? ['ALL', ['TEXT', query]] : ['ALL'];

          imap.search(criteria, (searchErr, uids) => {
            if (searchErr) {
              imap.end();
              reject(searchErr);
              return;
            }

            if (!uids || uids.length === 0) {
              imap.end();
              resolve({ messages: [], total: 0 });
              return;
            }

            // Take last N messages
            const selectedUids = uids.slice(-limit);

            const fetch = imap.fetch(selectedUids, {
              bodies: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
              struct: true,
            });

            fetch.on('message', (msg, seqno) => {
              let headerData = '';
              const msgId = String(seqno);

              msg.on('body', (stream) => {
                stream.on('data', (chunk: Buffer) => {
                  headerData += chunk.toString('utf8');
                });
              });

              msg.once('attributes', (attrs: { struct?: Array<Record<string, unknown>> }) => {
                const struct = attrs.struct;
                const hasAttachments = struct
                  ? struct.some(
                      (p) =>
                        p['disposition'] &&
                        (p['disposition'] as Record<string, string>)['type']?.toLowerCase() ===
                          'attachment',
                    )
                  : false;

                msg.once('end', () => {
                  const parsed = parseImapHeaders(headerData);
                  messages.push({
                    id: msgId,
                    from: parsed['from'] ?? '',
                    to: parsed['to'] ?? '',
                    subject: parsed['subject'] ?? '',
                    date: parsed['date'] ?? '',
                    snippet: '',
                    hasAttachments,
                  });
                });
              });
            });

            fetch.once('error', (fetchErr) => {
              imap.end();
              reject(fetchErr);
            });

            fetch.once('end', () => {
              imap.end();
              resolve({ messages, total: uids.length });
            });
          });
        });
      });

      imap.once('error', reject);
      imap.connect();
    });
  }

  private async imapGetAttachments(
    messageId: string,
    includeData: boolean,
  ): Promise<{ messageId: string; attachments: EmailAttachment[] }> {
    const opts = this.config?.options ?? {};
    const imapHost = opts['imapHost'] as string | undefined;
    const imapPort = (opts['imapPort'] as number | undefined) ?? 993;
    const user = opts['user'] as string;
    const pass = opts['pass'] as string;
    const folder = (opts['defaultFolder'] as string | undefined) ?? 'INBOX';

    if (!imapHost) {
      throw new Error('imapHost is required in config.options for IMAP attachment retrieval');
    }

    const Imap = (await import('imap')).default;
    const seqno = parseInt(messageId, 10);

    if (isNaN(seqno)) {
      throw new Error(`Invalid messageId for IMAP: ${messageId} — must be a sequence number`);
    }

    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user,
        password: pass,
        host: imapHost,
        port: imapPort,
        tls: imapPort === 993,
        tlsOptions: { rejectUnauthorized: false },
      });

      const attachments: EmailAttachment[] = [];

      imap.once('ready', () => {
        imap.openBox(folder, true, (err) => {
          if (err) {
            imap.end();
            reject(err);
            return;
          }

          const fetch = imap.fetch([seqno], { bodies: '', struct: true });

          fetch.on('message', (msg) => {
            msg.once('attributes', (attrs: { struct?: ImapStruct[] }) => {
              const parts = flattenImapStruct(attrs.struct ?? []);

              for (const part of parts) {
                if (part.disposition?.type?.toLowerCase() !== 'attachment' || !part.partID) {
                  continue;
                }

                const att: EmailAttachment = {
                  filename:
                    part.disposition.params?.['filename'] ?? part.params?.['name'] ?? 'attachment',
                  mimeType: `${part.type}/${part.subtype}`,
                  size: part.size ?? 0,
                };

                if (includeData) {
                  // We need to fetch the part body separately
                  const partFetch = imap.fetch([seqno], { bodies: [part.partID] });
                  partFetch.on('message', (partMsg) => {
                    let data = Buffer.alloc(0);
                    partMsg.on('body', (stream) => {
                      stream.on('data', (chunk: Buffer) => {
                        data = Buffer.concat([data, chunk]);
                      });
                      stream.once('end', () => {
                        att.data = data.toString('base64');
                      });
                    });
                  });
                }

                attachments.push(att);
              }

              msg.once('end', () => {
                // small delay to allow part fetches to complete
                setTimeout(() => {
                  imap.end();
                  resolve({ messageId, attachments });
                }, 200);
              });
            });
          });

          fetch.once('error', (fetchErr) => {
            imap.end();
            reject(fetchErr);
          });
        });
      });

      imap.once('error', reject);
      imap.connect();
    });
  }

  private assertInitialized(): void {
    if (this.authType === 'oauth2' && !this.gmailClient) {
      throw new Error('Email adapter not initialized — call initialize() first');
    }
    if (this.authType === 'smtp' && !this.transporter) {
      throw new Error('Email adapter not initialized — call initialize() first');
    }
  }
}

// ── Utility helpers ─────────────────────────────────────────────

/** Parse simple IMAP header block into a key-value map */
function parseImapHeaders(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  let currentKey = '';

  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      // Continuation line
      result[currentKey] = (result[currentKey] ?? '') + ' ' + line.trim();
    } else {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        currentKey = line.slice(0, colonIdx).toLowerCase().trim();
        result[currentKey] = line.slice(colonIdx + 1).trim();
      }
    }
  }

  return result;
}

/** Minimal interface for IMAP struct parts */
interface ImapStruct {
  type?: string;
  subtype?: string;
  partID?: string;
  size?: number;
  disposition?: {
    type?: string;
    params?: Record<string, string>;
  };
  params?: Record<string, string>;
}

/** Flatten nested IMAP struct into a list of leaf parts */
function flattenImapStruct(struct: ImapStruct[] | ImapStruct): ImapStruct[] {
  const result: ImapStruct[] = [];
  if (Array.isArray(struct)) {
    for (const item of struct) {
      result.push(...flattenImapStruct(item));
    }
  } else if (struct && typeof struct === 'object') {
    result.push(struct);
  }
  return result;
}
