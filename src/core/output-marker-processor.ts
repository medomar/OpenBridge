/** OutputMarkerProcessor — extracted from Router (OB-1284, OB-F159). */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Connector } from '../types/connector.js';
import type { OutboundMessage } from '../types/message.js';
import type { EmailConfig } from '../types/config.js';
import type { AuthService } from './auth.js';
import type { AppServer } from './app-server.js';
import type { InteractionRelay } from './interaction-relay.js';
import type { FileServer } from './file-server.js';
import { sendEmail } from './email-sender.js';
import { publishToGitHubPages } from './github-publisher.js';
import { createLogger } from './logger.js';

const logger = createLogger('output-marker-processor');

// ---------------------------------------------------------------------------
// Regex patterns for output markers
// ---------------------------------------------------------------------------

/** Pattern matching [SEND:channel]recipient|content[/SEND] markers in AI output */
export const SEND_MARKER_RE = /\[SEND:([^\]]+)\]([^|]+)\|([^[]*)\[\/SEND\]/g;

/** Pattern matching [VOICE]text[/VOICE] markers in AI output */
export const VOICE_MARKER_RE = /\[VOICE\]([\s\S]*?)\[\/VOICE\]/g;

/** Pattern matching [SHARE:channel]/path/to/file[/SHARE] markers in AI output */
export const SHARE_MARKER_RE = /\[SHARE:([^\]]+)\]([^[]*)\[\/SHARE\]/g;

/** Pattern matching [APP:start]appPath[/APP] markers in AI output */
export const APP_START_MARKER_RE = /\[APP:start\]([^[]*)\[\/APP\]/g;

/** Pattern matching [APP:stop]appId[/APP] markers in AI output */
export const APP_STOP_MARKER_RE = /\[APP:stop\]([^[]*)\[\/APP\]/g;

/** Pattern matching [APP:update:appId]jsonData[/APP] markers in AI output */
export const APP_UPDATE_MARKER_RE = /\[APP:update:([^\]]+)\]([^[]*)\[\/APP\]/g;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map file extension to MIME type and media category */
export function getMimeType(filename: string): {
  mimeType: string;
  mediaType: 'document' | 'image' | 'audio' | 'video';
} {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<
    string,
    { mimeType: string; mediaType: 'document' | 'image' | 'audio' | 'video' }
  > = {
    pdf: { mimeType: 'application/pdf', mediaType: 'document' },
    html: { mimeType: 'text/html', mediaType: 'document' },
    htm: { mimeType: 'text/html', mediaType: 'document' },
    txt: { mimeType: 'text/plain', mediaType: 'document' },
    csv: { mimeType: 'text/csv', mediaType: 'document' },
    json: { mimeType: 'application/json', mediaType: 'document' },
    md: { mimeType: 'text/markdown', mediaType: 'document' },
    docx: {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      mediaType: 'document',
    },
    xlsx: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      mediaType: 'document',
    },
    pptx: {
      mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      mediaType: 'document',
    },
    png: { mimeType: 'image/png', mediaType: 'image' },
    jpg: { mimeType: 'image/jpeg', mediaType: 'image' },
    jpeg: { mimeType: 'image/jpeg', mediaType: 'image' },
    gif: { mimeType: 'image/gif', mediaType: 'image' },
    webp: { mimeType: 'image/webp', mediaType: 'image' },
    svg: { mimeType: 'image/svg+xml', mediaType: 'image' },
    mp4: { mimeType: 'video/mp4', mediaType: 'video' },
    mp3: { mimeType: 'audio/mpeg', mediaType: 'audio' },
    wav: { mimeType: 'audio/wav', mediaType: 'audio' },
  };
  return mimeMap[ext] ?? { mimeType: 'application/octet-stream', mediaType: 'document' };
}

// ---------------------------------------------------------------------------
// Dependency interface — mirrors Router's mutable state via getters
// ---------------------------------------------------------------------------

export interface OutputMarkerDeps {
  getWorkspacePath: () => string | undefined;
  getEmailConfig: () => EmailConfig | undefined;
  getFileServer: () => FileServer | undefined;
  getAppServer: () => AppServer | undefined;
  getRelay: () => InteractionRelay | undefined;
  getConnectors: () => Map<string, Connector>;
  getAuth: () => AuthService | undefined;
}

// ---------------------------------------------------------------------------
// OutputMarkerProcessor class
// ---------------------------------------------------------------------------

export class OutputMarkerProcessor {
  constructor(private readonly deps: OutputMarkerDeps) {}

  /**
   * Process all output markers in sequence: SHARE → APP → SEND → VOICE.
   * Returns the cleaned content with all markers stripped or replaced.
   */
  async processAll(
    content: string,
    connector: Connector,
    recipient: string,
    replyTo?: string,
  ): Promise<string> {
    const afterShare = await this.processShareMarkers(content, connector, recipient, replyTo);
    const afterApp = await this.processAppMarkers(afterShare);
    const afterSend = await this.processSendMarkers(afterApp);
    return this.processVoiceMarkers(afterSend, connector, recipient);
  }

  /**
   * Parse [SEND:channel]recipient|content[/SEND] markers from AI output,
   * dispatch proactive messages to whitelisted recipients, and return
   * the response with markers stripped.
   */
  async processSendMarkers(content: string): Promise<string> {
    let cleaned = content;
    const regex = new RegExp(SEND_MARKER_RE.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const fullMatch = match[0];
      const channel = match[1] ?? '';
      const recipient = match[2] ?? '';
      const body = match[3] ?? '';
      const trimmedRecipient = recipient.trim();
      const trimmedBody = body.trim();

      if (!channel || !trimmedRecipient) {
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      const auth = this.deps.getAuth();
      if (auth && !auth.isAuthorized(trimmedRecipient, channel)) {
        logger.warn(
          { channel, recipient: trimmedRecipient },
          'SEND marker blocked — recipient not in whitelist',
        );
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      const connectors = this.deps.getConnectors();
      const connector = connectors.get(channel);
      if (!connector) {
        logger.warn({ channel }, 'SEND marker: connector not found');
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      if (!connector.sendProactive) {
        logger.warn({ channel }, 'SEND marker: connector does not support sendProactive');
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      try {
        await connector.sendProactive(trimmedRecipient, trimmedBody);
        logger.info({ channel, recipient: trimmedRecipient }, 'Proactive SEND dispatched');
      } catch (err) {
        logger.warn({ channel, recipient: trimmedRecipient, err }, 'SEND marker dispatch failed');
      }

      cleaned = cleaned.replace(fullMatch, '');
    }

    return cleaned.trim();
  }

  /**
   * Parse [SHARE:channel]/path/to/file[/SHARE] markers from AI output, read the file,
   * validate it is under .openbridge/generated/ (security), send it as a media attachment
   * to the inbound message sender, and return the response with markers stripped.
   */
  async processShareMarkers(
    content: string,
    connector: Connector,
    recipient: string,
    replyTo?: string,
  ): Promise<string> {
    const workspacePath = this.deps.getWorkspacePath();
    if (!workspacePath) return content;

    const generatedDir = path.resolve(path.join(workspacePath, '.openbridge', 'generated'));

    let cleaned = content;
    const regex = new RegExp(SHARE_MARKER_RE.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const fullMatch = match[0];
      const channel = match[1] ?? '';
      let filePath = (match[2] ?? '').trim();

      // Master AI sometimes emits a JSON object instead of a plain path
      // e.g. {"path":"/Users/.../file.pdf"} — extract the actual path string
      if (filePath.startsWith('{') && filePath.endsWith('}')) {
        try {
          const parsed = JSON.parse(filePath) as Record<string, unknown>;
          if (typeof parsed['path'] === 'string') {
            filePath = parsed['path'].trim();
          }
        } catch {
          // Not valid JSON — fall through and use the raw value
        }
      }

      if (!channel || !filePath) {
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      // Resolve path: if relative, resolve against the generated dir
      const resolvedPath = path.resolve(
        path.isAbsolute(filePath) ? filePath : path.join(generatedDir, filePath),
      );

      // Security: file must be strictly under .openbridge/generated/
      if (!resolvedPath.startsWith(generatedDir + path.sep)) {
        logger.warn(
          { filePath: resolvedPath, generatedDir },
          'SHARE marker blocked — file not under .openbridge/generated/',
        );
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      // Handle email channel separately — it doesn't route through a connector
      if (channel === 'email') {
        await this.handleEmailShare(filePath, recipient, replyTo);
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      // Handle github-pages channel — push file to the gh-pages branch
      if (channel === 'github-pages') {
        await this.handleGitHubPagesShare(resolvedPath);
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      // Handle FILE channel — create a shareable link via the local file server,
      // and additionally send as a native attachment for connectors that support it (WhatsApp, Telegram).
      if (channel === 'FILE') {
        const fileServer = this.deps.getFileServer();
        if (fileServer) {
          const filename = path.basename(resolvedPath);
          try {
            const url = await fileServer.createShareableLink(filename);
            cleaned = cleaned.replace(fullMatch, url);
            logger.info({ filename, url }, 'SHARE:FILE link created');
          } catch (err) {
            logger.warn(
              { filePath: resolvedPath, err },
              'SHARE:FILE: failed to create shareable link',
            );
            cleaned = cleaned.replace(fullMatch, '');
          }
        } else {
          logger.warn(
            { filePath: resolvedPath },
            'SHARE:FILE marker received but file server is not running — skipping',
          );
          cleaned = cleaned.replace(fullMatch, '');
        }

        // Also deliver as a native file attachment when the connector supports it (e.g. WhatsApp, Telegram)
        if (connector.supportsFileAttachments) {
          try {
            const filename = path.basename(resolvedPath);
            const ext = path.extname(filename).slice(1).toLowerCase();
            let { mimeType, mediaType } = getMimeType(filename);
            let deliveryPath = resolvedPath;
            let deliveryFilename = filename;

            // SVG files aren't natively rendered by WhatsApp/Telegram — convert to PNG when possible
            if (ext === 'svg' && fileServer) {
              try {
                const renderResult = await fileServer.renderSvgToImage(filename);
                if (renderResult) {
                  deliveryPath = renderResult.outputPath;
                  deliveryFilename = path.basename(renderResult.outputPath);
                  mimeType = 'image/png';
                  mediaType = 'image';
                  logger.debug(
                    { svgFile: filename, pngFile: deliveryFilename },
                    'SVG converted to PNG for image delivery',
                  );
                }
              } catch (svgErr) {
                logger.debug(
                  { filename, err: svgErr },
                  'SVG-to-PNG conversion failed — sending SVG as document',
                );
                mediaType = 'document';
              }
            }

            const data = await readFile(deliveryPath);
            await connector.sendMessage({
              target: connector.name,
              recipient,
              content: '',
              replyTo,
              media: { type: mediaType, data, mimeType, filename: deliveryFilename },
            });
            logger.info(
              { filename: deliveryFilename, recipient, connector: connector.name },
              'SHARE:FILE attachment dispatched',
            );
          } catch (err) {
            logger.warn(
              { filePath: resolvedPath, err },
              'SHARE:FILE: failed to send native attachment',
            );
          }
        }

        continue;
      }

      // Route to the named connector if registered, otherwise the inbound connector
      const connectors = this.deps.getConnectors();
      const targetConnector = connectors.get(channel) ?? connector;

      // Read the file
      let data: Buffer;
      try {
        data = await readFile(resolvedPath);
      } catch (err) {
        logger.warn({ filePath: resolvedPath, err }, 'SHARE marker: failed to read file');
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      const filename = path.basename(resolvedPath);
      const { mimeType, mediaType } = getMimeType(filename);

      const shareMsg: OutboundMessage = {
        target: targetConnector.name,
        recipient,
        content: '',
        replyTo,
        media: { type: mediaType, data, mimeType, filename },
      };

      try {
        await targetConnector.sendMessage(shareMsg);
        logger.info({ channel, filePath: resolvedPath, recipient }, 'SHARE dispatched');
      } catch (err) {
        logger.warn({ channel, filePath: resolvedPath, err }, 'SHARE marker dispatch failed');
      }

      cleaned = cleaned.replace(fullMatch, '');
    }

    return cleaned.trim();
  }

  /**
   * Parse [VOICE]text[/VOICE] markers from AI output, dispatch TTS voice replies
   * via the connector's sendVoiceReply method, and return the response with markers stripped.
   * If the connector does not support voice, the text inside the marker is kept as plain text.
   */
  async processVoiceMarkers(
    content: string,
    connector: Connector,
    recipient: string,
  ): Promise<string> {
    let cleaned = content;
    const regex = new RegExp(VOICE_MARKER_RE.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const fullMatch = match[0];
      const voiceText = (match[1] ?? '').trim();

      if (!voiceText) {
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      if (!connector.sendVoiceReply) {
        // Connector doesn't support voice — keep text but strip marker tags
        cleaned = cleaned.replace(fullMatch, voiceText);
        continue;
      }

      try {
        await connector.sendVoiceReply(recipient, voiceText);
        logger.info({ connector: connector.name, recipient }, 'VOICE reply dispatched');
      } catch (err) {
        logger.warn({ err, connector: connector.name, recipient }, 'VOICE marker dispatch failed');
      }

      cleaned = cleaned.replace(fullMatch, '');
    }

    return cleaned.trim();
  }

  /**
   * Handle [SHARE:email]user@example.com|/path/to/file[/SHARE] markers.
   * The raw value from the SHARE marker capture group is `email|filePath`.
   * Validates the recipient against the email allowlist, reads the file from
   * .openbridge/generated/, and sends it as an email attachment.
   */
  private async handleEmailShare(
    rawValue: string,
    _recipient: string,
    _replyTo?: string,
  ): Promise<void> {
    const emailConfig = this.deps.getEmailConfig();
    if (!emailConfig) {
      logger.warn('SHARE:email marker received but no email config is set — skipping');
      return;
    }

    const workspacePath = this.deps.getWorkspacePath();
    if (!workspacePath) {
      logger.warn('SHARE:email marker received but workspacePath is not set — skipping');
      return;
    }

    // Parse email address and file path from raw value (format: "email|/path")
    const pipeIdx = rawValue.indexOf('|');
    if (pipeIdx === -1) {
      logger.warn({ rawValue }, 'SHARE:email marker has no pipe separator — expected email|path');
      return;
    }
    const emailAddress = rawValue.slice(0, pipeIdx).trim();
    const filePath = rawValue.slice(pipeIdx + 1).trim();

    if (!emailAddress || !filePath) {
      logger.warn({ rawValue }, 'SHARE:email marker: missing email address or file path');
      return;
    }

    const generatedDir = path.resolve(path.join(workspacePath, '.openbridge', 'generated'));
    const resolvedPath = path.resolve(
      path.isAbsolute(filePath) ? filePath : path.join(generatedDir, filePath),
    );

    // Security: file must be strictly under .openbridge/generated/
    if (!resolvedPath.startsWith(generatedDir + path.sep)) {
      logger.warn(
        { filePath: resolvedPath, generatedDir },
        'SHARE:email blocked — file not under .openbridge/generated/',
      );
      return;
    }

    let data: Buffer;
    try {
      data = await readFile(resolvedPath);
    } catch (err) {
      logger.warn({ filePath: resolvedPath, err }, 'SHARE:email: failed to read file');
      return;
    }

    const filename = path.basename(resolvedPath);
    const { mimeType } = getMimeType(filename);

    try {
      await sendEmail(
        emailConfig,
        emailAddress,
        `Shared file: ${filename}`,
        `Please find the attached file: ${filename}`,
        [{ filename, content: data, contentType: mimeType }],
      );
      logger.info({ emailAddress, filePath: resolvedPath }, 'SHARE:email dispatched');
    } catch (err) {
      logger.warn({ emailAddress, filePath: resolvedPath, err }, 'SHARE:email dispatch failed');
    }
  }

  /**
   * Handle [SHARE:github-pages]/path/to/file[/SHARE] markers.
   * Publishes the validated file (already confirmed to be under .openbridge/generated/)
   * to the gh-pages branch of the workspace git repository.
   */
  private async handleGitHubPagesShare(filePath: string): Promise<void> {
    try {
      const pagesUrl = await publishToGitHubPages(filePath);
      logger.info({ filePath, pagesUrl: pagesUrl || '(unknown)' }, 'SHARE:github-pages dispatched');
    } catch (err) {
      logger.warn({ filePath, err }, 'SHARE:github-pages: publish failed');
    }
  }

  /**
   * Parse [APP:start]appPath[/APP], [APP:stop]appId[/APP], and
   * [APP:update:appId]jsonData[/APP] markers from AI output.
   *
   * - [APP:start]appPath[/APP]: starts an app via AppServer.startApp(). The marker is
   *   replaced with the app URL (public URL if tunnel is active, otherwise local URL).
   * - [APP:stop]appId[/APP]: stops an app via AppServer.stopApp(). The marker is stripped.
   * - [APP:update:appId]jsonData[/APP]: sends data to a connected app via InteractionRelay.
   *   The jsonData body is parsed as JSON (falls back to raw string). The marker is stripped.
   *
   * APP:start and APP:stop require an AppServer. APP:update requires an InteractionRelay.
   * Markers for unconfigured components are stripped silently.
   */
  async processAppMarkers(content: string): Promise<string> {
    const appServer = this.deps.getAppServer();
    const relay = this.deps.getRelay();
    if (!appServer && !relay) return content;

    let cleaned = content;

    // Handle APP:start markers — replace each marker with the app URL
    if (appServer) {
      const startRegex = new RegExp(APP_START_MARKER_RE.source, 'g');
      let match: RegExpExecArray | null;
      while ((match = startRegex.exec(content)) !== null) {
        const fullMatch = match[0];
        const appPath = (match[1] ?? '').trim();

        if (!appPath) {
          cleaned = cleaned.replace(fullMatch, '');
          continue;
        }

        try {
          const instance = await appServer.startApp(appPath);
          const url = instance.publicUrl ?? instance.url;
          cleaned = cleaned.replace(fullMatch, `App started at ${url}`);
          logger.info({ appPath, url, appId: instance.id }, 'APP:start marker processed');
        } catch (err) {
          logger.warn({ appPath, err }, 'APP:start marker: failed to start app');
          cleaned = cleaned.replace(fullMatch, `Failed to start app at ${appPath}`);
        }
      }
    }

    // Handle APP:stop markers — strip each marker after stopping the app
    if (appServer) {
      const stopRegex = new RegExp(APP_STOP_MARKER_RE.source, 'g');
      let stopMatch: RegExpExecArray | null;
      while ((stopMatch = stopRegex.exec(cleaned)) !== null) {
        const fullMatch = stopMatch[0];
        const appId = (stopMatch[1] ?? '').trim();

        if (appId) {
          try {
            appServer.stopApp(appId);
            logger.info({ appId }, 'APP:stop marker processed');
          } catch (err) {
            logger.warn({ appId, err }, 'APP:stop marker: failed to stop app');
          }
        }

        cleaned = cleaned.replace(fullMatch, '');
        // Reset regex index after replacement to avoid skipping matches
        stopRegex.lastIndex = 0;
      }
    }

    // Handle APP:update markers — send JSON data to a connected app via InteractionRelay
    const updateRegex = new RegExp(APP_UPDATE_MARKER_RE.source, 'g');
    let updateMatch: RegExpExecArray | null;
    while ((updateMatch = updateRegex.exec(cleaned)) !== null) {
      const fullMatch = updateMatch[0];
      const appId = (updateMatch[1] ?? '').trim();
      const rawData = (updateMatch[2] ?? '').trim();

      if (appId) {
        let parsedData: unknown;
        try {
          parsedData = JSON.parse(rawData);
        } catch {
          parsedData = rawData;
        }

        if (relay) {
          const sent = relay.sendToApp(appId, 'update', parsedData);
          if (sent) {
            logger.info({ appId }, 'APP:update marker processed — data sent to app');
          } else {
            logger.warn({ appId }, 'APP:update marker: app not connected, data not delivered');
          }
        } else {
          logger.warn({ appId }, 'APP:update marker: no InteractionRelay configured');
        }
      }

      cleaned = cleaned.replace(fullMatch, '');
      // Reset regex index after replacement to avoid skipping matches
      updateRegex.lastIndex = 0;
    }

    return cleaned.trim();
  }
}
