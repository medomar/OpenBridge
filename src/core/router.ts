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
import type { EmailConfig } from '../types/config.js';
import type { MemoryManager, ActivityRecord, ExplorationProgressRow } from '../memory/index.js';
import { sendEmail } from './email-sender.js';
import { publishToGitHubPages } from './github-publisher.js';
import { ProviderError } from '../providers/claude-code/provider-error.js';
import { createLogger } from './logger.js';

const logger = createLogger('router');

/** Pattern matching [SEND:channel]recipient|content[/SEND] markers in AI output */
const SEND_MARKER_RE = /\[SEND:([^\]]+)\]([^|]+)\|([^[]*)\[\/SEND\]/g;

/** Pattern matching [VOICE]text[/VOICE] markers in AI output */
const VOICE_MARKER_RE = /\[VOICE\]([\s\S]*?)\[\/VOICE\]/g;

/** Pattern matching [SHARE:channel]/path/to/file[/SHARE] markers in AI output */
const SHARE_MARKER_RE = /\[SHARE:([^\]]+)\]([^[]*)\[\/SHARE\]/g;

/** Format a millisecond duration as a human-readable string (e.g. "2h 14m", "45s"). */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Render a simple Unicode progress bar of the given width (default 5 blocks). */
function makeProgressBar(pct: number, width = 5): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

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
  private readonly auditLogger?: AuditLogger;
  private readonly metrics?: MetricsCollector;
  private orchestrator?: AgentOrchestrator;
  private master?: MasterManager;
  private auth?: AuthService;
  private workspacePath?: string;
  private emailConfig?: EmailConfig;
  private memory?: MemoryManager;

  constructor(
    defaultProvider: string,
    _config?: RouterConfig,
    auditLogger?: AuditLogger,
    metrics?: MetricsCollector,
  ) {
    this.defaultProviderName = defaultProvider;
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

  /** Set the email config — enables [SHARE:email] marker support */
  setEmailConfig(config: EmailConfig): void {
    this.emailConfig = config;
  }

  /** Set the MemoryManager — enables the "status" command */
  setMemory(memory: MemoryManager): void {
    this.memory = memory;
    logger.info('Router configured with MemoryManager (status command enabled)');
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

    // Handle built-in "status" command — intercept before routing to Master AI
    if (message.content.trim().toLowerCase() === 'status') {
      await this.handleStatusCommand(message, connector);
      return;
    }

    // Handle built-in "stop" command — intercept before routing to Master AI
    if (/^stop(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleStopCommand(message, connector);
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

    // Send single acknowledgment (no cycling timer — progress events handle the rest)
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
    if (!this.emailConfig) {
      logger.warn('SHARE:email marker received but no email config is set — skipping');
      return;
    }

    if (!this.workspacePath) {
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

    const generatedDir = path.resolve(path.join(this.workspacePath, '.openbridge', 'generated'));
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
        this.emailConfig,
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
   * Handle the built-in "status" command.
   * Queries agent_activity and exploration_progress tables and returns a
   * text-based status report that works on all channels.
   */
  private async handleStatusCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const lines: string[] = ['*OpenBridge Status*'];

    if (!this.memory) {
      lines.push('Status tracking not available — memory system not initialized.');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: lines.join('\n'),
        replyTo: message.id,
      });
      return;
    }

    let agents: ActivityRecord[] = [];
    let exploration: ExplorationProgressRow[] = [];
    try {
      [agents, exploration] = await Promise.all([
        this.memory.getActiveAgents(),
        this.memory.getExplorationProgress(),
      ]);
    } catch (err) {
      logger.warn({ err }, 'handleStatusCommand: failed to query agent activity');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Status temporarily unavailable — could not query agent activity.',
        replyTo: message.id,
      });
      return;
    }

    const masters = agents.filter((a) => a.type === 'master');
    const workers = agents.filter((a) => a.type !== 'master');

    // Master AI section
    if (masters.length > 0) {
      const m = masters[0]!;
      const uptime = formatDuration(Date.now() - new Date(m.started_at).getTime());
      lines.push(`\n🤖 Master AI: ACTIVE (${m.model ?? 'unknown'})`);
      lines.push(`   Uptime: ${uptime}`);
      if (m.task_summary) lines.push(`   Current: ${m.task_summary}`);
    } else {
      lines.push('\n🤖 Master AI: idle');
    }

    // Active workers section
    if (workers.length > 0) {
      lines.push(`\nWorkers (${workers.length} active):`);
      for (const w of workers) {
        const elapsed = formatDuration(Date.now() - new Date(w.started_at).getTime());
        const bar = makeProgressBar(w.progress_pct ?? 0);
        const shortId = w.id.length > 8 ? `…${w.id.slice(-6)}` : w.id;
        const task = (w.task_summary ?? 'working...').slice(0, 32);
        lines.push(
          ` • ${shortId} | ${w.model ?? '?'} | ${w.profile ?? '?'} | ${task} | ${bar} | ${elapsed}`,
        );
      }
    } else {
      lines.push('\nWorkers: none active');
    }

    // Exploration progress section
    if (exploration.length > 0) {
      lines.push('\nExploration:');
      for (const ep of exploration) {
        const bar = makeProgressBar(ep.progress_pct ?? 0);
        const label = ep.target ?? ep.phase;
        lines.push(` ${label}: [${bar}] ${ep.progress_pct ?? 0}%`);
      }
    }

    // Cost summary — use getDailyCost to include all completed workers today (OB-746)
    let dailyCost = 0;
    try {
      dailyCost = await this.memory.getDailyCost();
    } catch (costErr) {
      logger.warn({ costErr }, 'handleStatusCommand: failed to query daily cost');
      // Fall back to summing active agents' costs
      dailyCost = agents.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0);
    }
    const workerCount = agents.filter((a) => a.type === 'worker').length;
    lines.push(
      `\nCost: $${dailyCost.toFixed(4)} today | ${workerCount} worker${workerCount !== 1 ? 's' : ''} spawned`,
    );

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });
    logger.info({ sender: message.sender }, 'Status command handled');
  }

  /**
   * Handle the built-in "stop" command.
   *
   * Syntax:
   *   "stop"        → kill all running workers
   *   "stop all"    → kill all running workers
   *   "stop <id>"   → kill the worker whose ID ends with <id> (partial match)
   *
   * Requires the Master AI to be configured. Returns a plain-text response
   * that works on all channels.
   */
  private async handleStopCommand(message: InboundMessage, connector: Connector): Promise<void> {
    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Stop command not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    // Access control — only owner and admin may stop workers
    if (this.auth) {
      const accessResult = this.auth.checkAccessControl(message.sender, message.source, 'stop');
      if (!accessResult.allowed) {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: accessResult.reason ?? 'You do not have permission to use the stop command.',
          replyTo: message.id,
        });
        return;
      }
    }

    const trimmed = message.content.trim();
    // Extract everything after "stop" (and optional whitespace)
    const rest = trimmed.slice(4).trim().toLowerCase();

    let responseText: string;

    if (rest === '' || rest === 'all') {
      // "stop" or "stop all" — kill every running worker
      const result = await this.master.killAllWorkers();
      responseText = result.message;
    } else {
      // "stop <partialId>" — find a worker whose ID ends with the partial ID
      const partialId = rest;
      const registry = this.master.getWorkerRegistry();
      const allWorkers = registry.getAllWorkers();

      // Match: exact ID, or ID ends with "-<partialId>", or ID contains <partialId>
      const matched = allWorkers.find(
        (w) => w.id === partialId || w.id.endsWith(`-${partialId}`) || w.id.includes(partialId),
      );

      if (!matched) {
        responseText = `Worker '${partialId}' not found. Use 'status' to list active workers.`;
      } else {
        const result = await this.master.killWorker(matched.id);
        responseText = result.message;
      }
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: responseText,
      replyTo: message.id,
    });
    logger.info({ sender: message.sender, command: trimmed }, 'Stop command handled');
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
