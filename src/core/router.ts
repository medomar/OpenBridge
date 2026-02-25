import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AIProvider, ProviderResult } from '../types/provider.js';
import type { InboundMessage, OutboundMessage, ProgressEvent } from '../types/message.js';
import type { Connector } from '../types/connector.js';
import type { RouterConfig } from '../types/config.js';
import type { AuditLogger } from './audit-logger.js';
import type { MetricsCollector } from './metrics.js';
import type { AgentOrchestrator } from './agent-orchestrator.js';
import type { MasterManager } from '../master/master-manager.js';
import type { AuthService } from './auth.js';
import { ProviderError } from '../providers/claude-code/provider-error.js';
import { createLogger } from './logger.js';

const logger = createLogger('router');

const PROGRESS_MESSAGES = [
  'Still working on it...',
  'This is taking a moment — hang tight...',
  'Still processing your request...',
  'Almost there — still working...',
];

/** Pattern matching [SEND:channel]recipient|content[/SEND] markers in AI output */
const SEND_MARKER_RE = /\[SEND:([^\]]+)\]([^|]+)\|([^[]*)\[\/SEND\]/g;

/** Pattern matching [VOICE]text[/VOICE] markers in AI output */
const VOICE_MARKER_RE = /\[VOICE\]([\s\S]*?)\[\/VOICE\]/g;

/** Pattern matching [SHARE:channel]/path/to/file[/SHARE] markers in AI output */
const SHARE_MARKER_RE = /\[SHARE:([^\]]+)\]([^[]*)\[\/SHARE\]/g;

/** Map file extension to MIME type and media category */
function getMimeType(filename: string): {
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
    png: { mimeType: 'image/png', mediaType: 'image' },
    jpg: { mimeType: 'image/jpeg', mediaType: 'image' },
    jpeg: { mimeType: 'image/jpeg', mediaType: 'image' },
    gif: { mimeType: 'image/gif', mediaType: 'image' },
    webp: { mimeType: 'image/webp', mediaType: 'image' },
    mp4: { mimeType: 'video/mp4', mediaType: 'video' },
    mp3: { mimeType: 'audio/mpeg', mediaType: 'audio' },
    wav: { mimeType: 'audio/wav', mediaType: 'audio' },
  };
  return mimeMap[ext] ?? { mimeType: 'application/octet-stream', mediaType: 'document' };
}

export class Router {
  private readonly connectors = new Map<string, Connector>();
  private readonly providers = new Map<string, AIProvider>();
  private defaultProviderName: string;
  private readonly progressIntervalMs: number;
  private readonly auditLogger?: AuditLogger;
  private readonly metrics?: MetricsCollector;
  private orchestrator?: AgentOrchestrator;
  private master?: MasterManager;
  private auth?: AuthService;
  private workspacePath?: string;

  constructor(
    defaultProvider: string,
    config?: RouterConfig,
    auditLogger?: AuditLogger,
    metrics?: MetricsCollector,
  ) {
    this.defaultProviderName = defaultProvider;
    this.progressIntervalMs = config?.progressIntervalMs ?? 15_000;
    this.auditLogger = auditLogger;
    this.metrics = metrics;
  }

  /** Set the agent orchestrator — when set, messages route through it instead of directly to a provider */
  setOrchestrator(orchestrator: AgentOrchestrator): void {
    this.orchestrator = orchestrator;
    logger.info('Router configured to use Agent Orchestrator');
  }

  /** Set the Master AI — when set, all messages route through it (priority over orchestrator/provider) */
  setMaster(master: MasterManager): void {
    this.master = master;
    logger.info('Router configured to use Master AI');
  }

  /** Set the auth service — used to whitelist-check recipients in SEND markers */
  setAuth(auth: AuthService): void {
    this.auth = auth;
  }

  /** Set the workspace path — used to validate file paths in SHARE markers */
  setWorkspacePath(workspacePath: string): void {
    this.workspacePath = workspacePath;
  }

  /** Register an active connector */
  addConnector(connector: Connector): void {
    this.connectors.set(connector.name, connector);
  }

  /** Register an active provider */
  addProvider(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Send a progress event to a specific connector (best-effort).
   * Used by MasterManager to emit typed ProgressEvents to the right connector
   * without going through the full routing flow.
   */
  async sendProgress(source: string, recipient: string, event: ProgressEvent): Promise<void> {
    const connector = this.connectors.get(source);
    if (!connector?.sendProgress) return;
    try {
      await connector.sendProgress(event, recipient);
    } catch (err) {
      logger.warn({ err, source, recipient }, 'sendProgress: failed to send progress event');
    }
  }

  /**
   * Broadcast a progress event to all connected connectors (best-effort).
   * Used during workspace exploration when there is no specific message sender.
   */
  async broadcastProgress(event: ProgressEvent): Promise<void> {
    for (const [name, connector] of this.connectors) {
      if (connector.sendProgress) {
        try {
          await connector.sendProgress(event, '__system__');
        } catch (err) {
          logger.warn({ err, connector: name }, 'broadcastProgress: failed');
        }
      }
    }
  }

  /**
   * Send a message directly to a user on a specific connector (best-effort).
   * Used by MasterManager to deliver progress updates during worker delegation
   * without going through the full routing flow.
   */
  async sendDirect(
    source: string,
    recipient: string,
    content: string,
    replyTo?: string,
  ): Promise<void> {
    const connector = this.connectors.get(source);
    if (!connector) {
      logger.warn({ source }, 'sendDirect: connector not found');
      return;
    }
    const msg: OutboundMessage = { target: source, recipient, content, replyTo };
    try {
      await connector.sendMessage(msg);
    } catch (err) {
      logger.warn({ err, source, recipient }, 'sendDirect: failed to send message');
    }
  }

  /** Route an inbound message to the appropriate provider and send the response back */
  async route(message: InboundMessage): Promise<void> {
    // Validate routing target exists
    // Priority: Master → Orchestrator → Direct Provider
    if (!this.master && !this.orchestrator) {
      const provider = this.providers.get(this.defaultProviderName);
      if (!provider) {
        logger.error({ provider: this.defaultProviderName }, 'Default provider not found');
        return;
      }
    }

    const connector = this.connectors.get(message.source);
    if (!connector) {
      logger.error({ source: message.source }, 'Source connector not found');
      return;
    }

    const useMaster = !!this.master;
    const useOrchestrator = !useMaster && !!this.orchestrator;
    logger.info(
      {
        messageId: message.id,
        provider: this.defaultProviderName,
        source: message.source,
        routedVia: useMaster ? 'master' : useOrchestrator ? 'orchestrator' : 'direct',
      },
      'Routing message',
    );

    // Send acknowledgment
    const ack: OutboundMessage = {
      target: message.source,
      recipient: message.sender,
      content: 'Working on it...',
      replyTo: message.id,
    };
    await connector.sendMessage(ack);

    // Send typing indicator while AI processes (best-effort)
    if (connector.sendTypingIndicator) {
      await connector.sendTypingIndicator(message.sender);
    }

    // Start progress updates
    const stopProgress = this.startProgressUpdates(connector, message);

    // Process message — through Master, orchestrator, or directly via provider
    let result: ProviderResult;
    const startTime = Date.now();

    try {
      if (this.master) {
        // Route through Master AI
        const response = await this.master.processMessage(message);
        result = { content: response };
      } else if (this.orchestrator) {
        const orchestratorResult = await this.orchestrator.process(message);
        result = orchestratorResult.result;
      } else {
        const provider = this.providers.get(this.defaultProviderName)!;
        if (provider.streamMessage) {
          result = await this.consumeStream(provider.streamMessage(message));
        } else {
          result = await provider.processMessage(message);
        }
      }
    } catch (error) {
      stopProgress();
      const errorKind = error instanceof ProviderError ? error.kind : ('unknown' as const);
      this.metrics?.recordFailed(errorKind);
      if (error instanceof ProviderError) {
        let userMessage: string;
        if (error.exitCode === 124 || error.exitCode === 143) {
          userMessage = 'The request timed out. Try a simpler or shorter prompt.';
        } else if (error.kind === 'transient') {
          userMessage = 'The AI service is temporarily unavailable. Please try again in a moment.';
        } else {
          userMessage = `Request failed: ${error.message}`;
        }

        const errorResponse: OutboundMessage = {
          target: message.source,
          recipient: message.sender,
          content: userMessage,
          replyTo: message.id,
        };
        await connector.sendMessage(errorResponse);
      }
      void this.auditLogger?.logError(
        message.id,
        error instanceof Error ? error.message : 'Unknown error',
      );
      throw error;
    }

    stopProgress();
    this.metrics?.recordProcessed(Date.now() - startTime);

    // Parse and dispatch [SHARE:channel] file-sharing markers before sending main reply
    const afterShare = await this.processShareMarkers(
      result.content,
      connector,
      message.sender,
      message.id,
    );

    // Parse and dispatch [SEND:channel] proactive markers before sending main reply
    const afterSend = await this.processSendMarkers(afterShare);

    // Parse and dispatch [VOICE] TTS markers before sending main reply
    const cleanedContent = await this.processVoiceMarkers(afterSend, connector, message.sender);

    // Send result back
    const response: OutboundMessage = {
      target: message.source,
      recipient: message.sender,
      content: cleanedContent,
      replyTo: message.id,
      metadata: result.metadata,
    };
    await connector.sendMessage(response);
    void this.auditLogger?.logOutbound(response);

    logger.info({ messageId: message.id }, 'Message processed and response sent');
  }

  /**
   * Parse [SEND:channel]recipient|content[/SEND] markers from AI output,
   * dispatch proactive messages to whitelisted recipients, and return
   * the response with markers stripped.
   */
  private async processSendMarkers(content: string): Promise<string> {
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

      // Only allow sending to whitelisted numbers when auth is configured
      if (this.auth && !this.auth.isAuthorized(trimmedRecipient)) {
        logger.warn(
          { channel, recipient: trimmedRecipient },
          'SEND marker blocked — recipient not in whitelist',
        );
        cleaned = cleaned.replace(fullMatch, '');
        continue;
      }

      const connector = this.connectors.get(channel);
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
  private async processShareMarkers(
    content: string,
    connector: Connector,
    recipient: string,
    replyTo?: string,
  ): Promise<string> {
    if (!this.workspacePath) return content;

    const generatedDir = path.resolve(path.join(this.workspacePath, '.openbridge', 'generated'));

    let cleaned = content;
    const regex = new RegExp(SHARE_MARKER_RE.source, 'g');
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const fullMatch = match[0];
      const channel = match[1] ?? '';
      const filePath = (match[2] ?? '').trim();

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

      // Route to the named connector if registered, otherwise the inbound connector
      const targetConnector = this.connectors.get(channel) ?? connector;

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
  private async processVoiceMarkers(
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

  /** Start sending periodic progress updates, returns a stop function */
  private startProgressUpdates(connector: Connector, message: InboundMessage): () => void {
    let tickCount = 0;
    const timer = setInterval(() => {
      const progressMsg = PROGRESS_MESSAGES[tickCount % PROGRESS_MESSAGES.length]!;
      tickCount++;

      const update: OutboundMessage = {
        target: message.source,
        recipient: message.sender,
        content: progressMsg,
        replyTo: message.id,
      };

      connector.sendMessage(update).catch((err: unknown) => {
        logger.warn({ err, messageId: message.id }, 'Failed to send progress update');
      });

      // Refresh typing indicator (best-effort)
      if (connector.sendTypingIndicator) {
        connector.sendTypingIndicator(message.sender).catch(() => {
          // best-effort
        });
      }
    }, this.progressIntervalMs);

    return () => clearInterval(timer);
  }

  /** Drain a streaming provider response, returning the final ProviderResult */
  private async consumeStream(
    stream: AsyncGenerator<string, ProviderResult>,
  ): Promise<ProviderResult> {
    let iterResult: IteratorResult<string, ProviderResult>;

    do {
      iterResult = await stream.next();
    } while (!iterResult.done);

    // When done === true, value is the ProviderResult return value
    return iterResult.value;
  }

  get defaultProvider(): string {
    return this.defaultProviderName;
  }
}
