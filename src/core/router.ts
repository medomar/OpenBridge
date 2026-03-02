import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AIProvider, ProviderResult } from '../types/provider.js';
import type { InboundMessage, OutboundMessage, ProgressEvent } from '../types/message.js';
import type { Connector } from '../types/connector.js';
import type { RouterConfig, SecurityConfig } from '../types/config.js';
import type { AuditLogger } from './audit-logger.js';
import type { MetricsCollector } from './metrics.js';
import type { AgentOrchestrator } from './agent-orchestrator.js';
import type { MasterManager } from '../master/master-manager.js';
import type { AuthService } from './auth.js';
import type { EmailConfig } from '../types/config.js';
import type {
  MemoryManager,
  ActivityRecord,
  ConversationEntry,
  ExplorationProgressRow,
  SessionSummary,
} from '../memory/index.js';
import type { MessageQueue } from './queue.js';
import type { RiskLevel } from '../types/agent.js';
import { PROFILE_RISK_MAP, BuiltInProfileNameSchema } from '../types/agent.js';
import type { ParsedSpawnMarker } from '../master/spawn-parser.js';
import { extractTaskSummaries } from '../master/spawn-parser.js';
import { sendEmail } from './email-sender.js';
import { publishToGitHubPages } from './github-publisher.js';
import { ProviderError } from '../providers/claude-code/provider-error.js';
import { AgentRunner } from './agent-runner.js';
import { FastPathResponder } from './fast-path-responder.js';
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

/** Escape special HTML characters for safe WebChat output. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

/** Pending stop-all confirmation entry, keyed by sender ID. */
interface PendingConfirmation {
  action: 'kill-all';
  expiresAt: number;
}

/** A pending spawn confirmation entry — queued when a high-risk SPAWN is intercepted. */
export interface PendingSpawnEntry {
  /** The SPAWN markers that need user confirmation before dispatch */
  markers: ParsedSpawnMarker[];
  /** The original inbound message that triggered the SPAWN */
  message: InboundMessage;
  /** Connector used to send the confirmation prompt */
  connector: Connector;
  /** One-line summaries of each high-risk task */
  taskSummaries: string[];
  /** Profile of the highest-risk SPAWN marker */
  profile: string;
  /** Risk level of the highest-risk marker */
  riskLevel: RiskLevel;
}

/**
 * Message priority levels used for queue ordering.
 * Lower number = higher priority (processed first).
 *
 * 1 = quick-answer  — status, list, simple questions (no file changes)
 * 2 = tool-use      — generate, create, fix, single-file edits
 * 3 = complex-task  — implement, refactor, multi-step work
 */
export type MessagePriority = 1 | 2 | 3;

/**
 * Classify a message by priority using keyword heuristics.
 * Returns 1 (quick-answer), 2 (tool-use), or 3 (complex-task).
 * Runs synchronously — no AI calls, safe to call before enqueueing.
 */
export function classifyMessagePriority(content: string): MessagePriority {
  const lower = content.toLowerCase().trim();

  // Complex-task keywords — multi-step work requiring planning and delegation
  const complexKeywords = [
    'implement',
    'build',
    'refactor',
    'develop',
    'set up',
    'setup',
    'redesign',
    'migrate',
    'overhaul',
  ];
  if (complexKeywords.some((kw) => lower.includes(kw)) || /\barchitect\b/.test(lower)) {
    return 3;
  }

  // Compound action pattern — two verbs joined by "and" signal multi-step work
  const actionVerbs = [
    'review',
    'analyze',
    'audit',
    'check',
    'fix',
    'add',
    'update',
    'create',
    'remove',
    'test',
    'write',
    'optimize',
    'improve',
  ];
  const matchedVerbs = actionVerbs.filter((v) => lower.includes(v));
  if (matchedVerbs.length >= 2 && lower.includes(' and ')) {
    return 3;
  }

  // Tool-use keywords — single-action file generation or targeted edits
  const toolUseKeywords = ['generate', 'create', 'write', 'fix', 'update file', 'add to', 'make a'];
  if (toolUseKeywords.some((kw) => lower.includes(kw))) {
    return 2;
  }

  // Quick-answer patterns — questions and lookups (no file changes needed)
  const questionPatterns = [
    'what is',
    'what are',
    'how does',
    'how do',
    'explain',
    'describe',
    'show me',
    'list all',
    'list the',
    'tell me',
    'status',
  ];
  const isShortQuestion = lower.endsWith('?') && lower.length <= 80;
  const hasQuestionKeyword = questionPatterns.some((qp) => lower.includes(qp));
  if (isShortQuestion || (hasQuestionKeyword && lower.length <= 120)) {
    return 1;
  }

  // Default: tool-use — most non-question messages require file operations
  return 2;
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
  private queue?: MessageQueue;
  /** Pending "stop all" confirmations — keyed by sender, value contains expiresAt timestamp. */
  private readonly pendingStopConfirmations = new Map<string, PendingConfirmation>();
  /** Pending high-risk spawn confirmations — keyed by sender, awaiting user "go" or "skip". */
  private readonly pendingSpawnConfirmations = new Map<string, PendingSpawnEntry>();
  /** Security config — controls confirmation requirements for high-risk spawns. */
  private securityConfig?: SecurityConfig;
  /**
   * IDs of priority-1 messages that should trigger a checkpoint-handle-resume cycle.
   * Populated by the `onUrgentEnqueued` queue callback; consumed in `route()`.
   */
  private readonly urgentCycleMessageIds = new Set<string>();
  /** Pool of short-lived read-only agents for quick-answer responses during Master processing. */
  private readonly fastPathResponder = new FastPathResponder(new AgentRunner());

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

  /** Set the MemoryManager — enables the "status" command and fast-path context chunks */
  setMemory(memory: MemoryManager): void {
    this.memory = memory;
    this.fastPathResponder.setMemory(memory);
    logger.info('Router configured with MemoryManager (status command enabled)');
  }

  /** Set the MessageQueue — enables queue depth display in the "status" command */
  setQueue(queue: MessageQueue): void {
    this.queue = queue;
    // Register urgent-message callback: when a priority-1 message is enqueued while
    // the sender already has a message in flight, mark it for checkpoint-handle-resume.
    queue.onUrgentEnqueued((msg) => {
      if (this.master) {
        this.urgentCycleMessageIds.add(msg.id);
        logger.info(
          { messageId: msg.id },
          'Urgent message detected — session will be checkpointed before handling',
        );
      }
    });
  }

  /** Set the security config — controls confirmation requirements for high-risk spawns */
  setSecurityConfig(config: SecurityConfig): void {
    this.securityConfig = config;
    logger.info(
      { confirmHighRisk: config.confirmHighRisk },
      'Router configured with SecurityConfig',
    );
  }

  /**
   * Check whether a given tool-profile name maps to a high or critical risk level.
   * Unknown/custom profiles default to 'high' (conservative).
   */
  private getProfileRisk(profileName: string): RiskLevel {
    const parsed = BuiltInProfileNameSchema.safeParse(profileName);
    if (parsed.success) {
      return PROFILE_RISK_MAP[parsed.data];
    }
    return 'high';
  }

  /**
   * Intercept high-risk SPAWN markers before dispatch and request user confirmation.
   *
   * Called by MasterManager (via the router reference) before spawning workers.
   * When `security.confirmHighRisk` is enabled and any marker has a high or critical
   * risk profile, this method:
   *   1. Sends a confirmation prompt to the user listing the tasks and risk level.
   *   2. Stores the pending spawn entry keyed by sender.
   *   3. Returns `true` to signal the caller should defer dispatch.
   *
   * When confirmation is not required (low/medium risk, or confirmHighRisk disabled),
   * returns `false` so the caller proceeds immediately.
   */
  public async requestSpawnConfirmation(
    sender: string,
    connector: Connector,
    markers: ParsedSpawnMarker[],
    message: InboundMessage,
  ): Promise<boolean> {
    if (!this.securityConfig?.confirmHighRisk) return false;

    const highRiskMarkers = markers.filter((m) => {
      const risk = this.getProfileRisk(m.profile);
      return risk === 'high' || risk === 'critical';
    });

    if (highRiskMarkers.length === 0) return false;

    const hasCritical = highRiskMarkers.some((m) => this.getProfileRisk(m.profile) === 'critical');
    const riskLevel: RiskLevel = hasCritical ? 'critical' : 'high';
    const firstHighRiskMarker = highRiskMarkers[0]!;
    const summaries = extractTaskSummaries(highRiskMarkers);

    this.pendingSpawnConfirmations.set(sender, {
      markers,
      message,
      connector,
      taskSummaries: summaries,
      profile: firstHighRiskMarker.profile,
      riskLevel,
    });

    const profileDisplay = firstHighRiskMarker.profile;
    const riskDisplay = riskLevel.toUpperCase();
    const taskList = summaries.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const confirmText =
      `⚠️ Confirmation required — ${highRiskMarkers.length} worker(s) with ${riskDisplay} risk` +
      ` profile (${profileDisplay}):\n\n${taskList}\n\nReply "go" to proceed or "skip" to cancel.`;

    const confirmMsg: OutboundMessage = {
      target: message.source,
      recipient: sender,
      content: confirmText,
    };
    await connector.sendMessage(confirmMsg);

    logger.info(
      { sender, profile: profileDisplay, riskLevel, markerCount: highRiskMarkers.length },
      'High-risk SPAWN intercepted — confirmation prompt sent to user',
    );

    return true;
  }

  /**
   * Retrieve and remove the pending spawn confirmation entry for a sender.
   * Returns `undefined` if no confirmation is pending for that sender.
   * Used by the /confirm and /skip command handlers (OB-1388).
   */
  public takePendingSpawnConfirmation(sender: string): PendingSpawnEntry | undefined {
    const entry = this.pendingSpawnConfirmations.get(sender);
    this.pendingSpawnConfirmations.delete(sender);
    return entry;
  }

  /** Check whether a pending spawn confirmation exists for a sender. */
  public hasPendingSpawnConfirmation(sender: string): boolean {
    return this.pendingSpawnConfirmations.has(sender);
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

    // Handle "confirm" for a pending stop-all confirmation — intercept before routing to Master AI
    if (message.content.trim().toLowerCase() === 'confirm') {
      const pending = this.pendingStopConfirmations.get(message.sender);
      if (pending) {
        await this.handleConfirmCommand(message, connector, pending);
        return;
      }
    }

    // Handle built-in "stop" command — intercept before routing to Master AI
    if (/^stop(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleStopCommand(message, connector);
      return;
    }

    // Handle built-in "explore" command — intercept before routing to Master AI
    if (/^explore(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleExploreCommand(message, connector);
      return;
    }

    // Handle built-in "history" command — intercept before routing to Master AI
    if (/^history(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleHistoryCommand(message, connector);
      return;
    }

    // Checkpoint-handle-resume cycle for urgent messages.
    // When a priority-1 message was flagged by the queue (sender had a message in flight when
    // this arrived), checkpoint session state before processing so that:
    //   1. A crash during urgent handling is recoverable from the checkpoint.
    //   2. After the urgent message completes, we can restore pre-interruption context.
    const isUrgentCycle = this.urgentCycleMessageIds.has(message.id);
    if (isUrgentCycle) {
      this.urgentCycleMessageIds.delete(message.id);
      if (this.master) {
        await this.master.checkpointSession();
      }
    }

    // Fast-path: when Master is processing a complex task and a quick-answer message arrives,
    // spawn a lightweight read-only agent to answer immediately without waiting for Master.
    const messagePriority = classifyMessagePriority(message.content);
    if (messagePriority === 1 && this.master?.getState() === 'processing') {
      await this.runFastPath(message, connector);
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

    // Notify the Electron parent process (if running as a forked child) so it can show
    // notification badges without parsing log output. Guarded by OPENBRIDGE_ELECTRON so
    // this is a no-op in tests, CLI runs, and other non-Electron contexts.
    if (typeof process.send === 'function' && process.env['OPENBRIDGE_ELECTRON'] === '1') {
      process.send({ type: 'message-received', sender: message.sender, channel: message.source });
    }

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

    // Inject attachment context so Master AI and workers know about attached files
    if (message.attachments && message.attachments.length > 0) {
      const attachmentLines = message.attachments.map((a) => {
        const sizeKb = (a.sizeBytes / 1024).toFixed(1);
        const namePart = a.filename ? ` (${a.filename})` : '';
        return `- **${a.type}**${namePart}: \`${a.filePath}\` — ${a.mimeType} — ${sizeKb} KB`;
      });
      message.content = `${message.content}\n\n## Attachments\n${attachmentLines.join('\n')}`;
    }

    // Process message — through Master, orchestrator, or directly via provider
    let result: ProviderResult;
    const startTime = Date.now();

    try {
      if (this.master) {
        // Route through Master AI
        const response = await this.master.processMessage(message);
        result = { content: response };
        // Resume from checkpoint after urgent message is fully handled — restores the
        // pre-interruption Master context (worker history, pending messages) so that
        // subsequent messages continue with the correct session state.
        if (isUrgentCycle) {
          await this.master.resumeSession();
        }
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
   * Fast-path responder for quick-answer messages that arrive while Master is processing.
   *
   * Spawns a lightweight `claude --print` call with read-only tools (Read, Glob, Grep)
   * and maxTurns=3. Injects a compact workspace context from the cached workspace map
   * so the agent can answer questions about the project without waiting for Master.
   *
   * Falls back to a "Master is busy" message if the workspace path is not set or if
   * the fast-path agent itself fails.
   */
  private async runFastPath(message: InboundMessage, connector: Connector): Promise<void> {
    logger.info(
      { sender: message.sender },
      'Fast-path: Master is processing, routing quick-answer directly',
    );

    if (connector.sendTypingIndicator) {
      await connector.sendTypingIndicator(message.sender);
    }

    if (!this.workspacePath) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'The AI is busy processing a task. Please wait a moment before asking again.',
        replyTo: message.id,
      });
      return;
    }

    const workspaceContext = await this.buildWorkspaceContext();
    const reply = await this.fastPathResponder.answer({
      question: message.content,
      workspacePath: this.workspacePath,
      workspaceContext: workspaceContext || undefined,
    });

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: reply,
      replyTo: message.id,
    });
    logger.info({ sender: message.sender }, 'Fast-path response delivered');
  }

  /**
   * Build a compact workspace context string from the cached workspace map.
   * Used by the fast-path responder to give the lightweight agent project awareness.
   * Returns an empty string if no map is available.
   */
  private async buildWorkspaceContext(): Promise<string> {
    if (!this.master) return '';
    try {
      const map = await this.master.getWorkspaceMap();
      if (!map) return '';

      const lines: string[] = [];
      lines.push(`Project: ${map.projectName} (${map.projectType})`);
      if (map.frameworks.length > 0) {
        lines.push(`Frameworks: ${map.frameworks.join(', ')}`);
      }
      if (map.summary) {
        lines.push(`Summary: ${map.summary}`);
      }
      const commandEntries = Object.entries(map.commands);
      if (commandEntries.length > 0) {
        lines.push(`Commands: ${commandEntries.map(([k, v]) => `${k}: ${v}`).join(', ')}`);
      }
      if (map.keyFiles.length > 0) {
        const filesSummary = map.keyFiles
          .slice(0, 10)
          .map((f) => `  ${f.path}: ${f.purpose}`)
          .join('\n');
        lines.push(`Key files:\n${filesSummary}`);
      }
      return lines.join('\n');
    } catch {
      return '';
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

    // Queue depth + estimated completion time section (OB-923)
    if (this.queue) {
      const queueSnapshot = this.queue.getQueueSnapshot();
      if (queueSnapshot.length > 0) {
        lines.push('\nQueue:');
        for (const entry of queueSnapshot) {
          const waitStr =
            entry.estimatedWaitMs < 60_000
              ? `~${Math.ceil(entry.estimatedWaitMs / 1000)}s`
              : `~${Math.round(entry.estimatedWaitMs / 60_000)}m`;
          const shortSender =
            entry.sender.length > 12
              ? `${entry.sender.slice(0, 6)}…${entry.sender.slice(-4)}`
              : entry.sender;
          lines.push(
            ` • ${shortSender}: ${entry.pending} message${entry.pending !== 1 ? 's' : ''} waiting (est. ${waitStr})`,
          );
        }
      } else {
        lines.push('\nQueue: idle');
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
   * Handle a "confirm" message that follows a pending "stop all" request.
   * Executes killAllWorkers() if the confirmation arrived within the 30-second window;
   * otherwise reports that it has expired.
   */
  private async handleConfirmCommand(
    message: InboundMessage,
    connector: Connector,
    pending: PendingConfirmation,
  ): Promise<void> {
    // Always remove the pending entry — one shot regardless of outcome
    this.pendingStopConfirmations.delete(message.sender);

    if (Date.now() > pending.expiresAt) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: "Confirmation expired. Send 'stop all' again to retry.",
        replyTo: message.id,
      });
      logger.info({ sender: message.sender }, 'Stop all confirmation expired');
      return;
    }

    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Stop command not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const result = await this.master.killAllWorkers(message.sender);
    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: result.message,
      replyTo: message.id,
    });
    logger.info({ sender: message.sender }, 'Stop all confirmed and executed');
  }

  /**
   * Handle the built-in "stop" command.
   *
   * Syntax:
   *   "stop"        → request confirmation then kill all running workers
   *   "stop all"    → request confirmation then kill all running workers
   *   "stop <id>"   → kill the worker whose ID ends with <id> (partial match, no confirmation)
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
      // "stop" or "stop all" — require confirmation before killing all workers
      const running = this.master.getWorkerRegistry().getRunningWorkers();
      if (running.length === 0) {
        responseText = 'No workers are currently running.';
      } else {
        this.pendingStopConfirmations.set(message.sender, {
          action: 'kill-all',
          expiresAt: Date.now() + 30_000,
        });
        responseText = `This will terminate ${running.length} running worker${running.length !== 1 ? 's' : ''}. Reply 'confirm' within 30 seconds to proceed.`;
      }
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
        const result = await this.master.killWorker(matched.id, message.sender);
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

  /**
   * Handle the built-in "explore" command.
   * Triggers workspace re-exploration from any channel.
   *
   * Syntax:
   *   "explore"        -> quick re-exploration via Master session prompt
   *   "explore full"   -> full 5-phase re-exploration with ExplorationCoordinator
   *   "explore status" -> show current exploration state and progress
   */
  private async handleExploreCommand(message: InboundMessage, connector: Connector): Promise<void> {
    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Explore command not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    // Access control — exploration classifies as 'read' action
    if (this.auth) {
      const accessResult = this.auth.checkAccessControl(message.sender, message.source, 'explore');
      if (!accessResult.allowed) {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: accessResult.reason ?? 'You do not have permission to trigger exploration.',
          replyTo: message.id,
        });
        return;
      }
    }

    const trimmed = message.content.trim();
    const rest = trimmed.slice(7).trim().toLowerCase(); // slice past "explore"

    if (rest === 'status') {
      await this.handleExploreStatusSubcommand(message, connector);
      return;
    }

    const currentState = this.master.getState();

    if (currentState === 'exploring') {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Exploration is already in progress. Use "explore status" to check progress.',
        replyTo: message.id,
      });
      return;
    }

    if (currentState !== 'ready') {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Cannot start exploration — Master is currently in '${currentState}' state. Please wait until it is ready.`,
        replyTo: message.id,
      });
      return;
    }

    const isFull = rest === 'full';

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: isFull
        ? 'Starting full workspace re-exploration (5 phases). This may take a few minutes...'
        : 'Starting quick workspace re-exploration...',
      replyTo: message.id,
    });

    try {
      if (isFull) {
        await this.master.fullReExplore();
      } else {
        await this.master.reExplore();
      }

      const summary = this.master.getExplorationSummary();
      const completionParts = ['Workspace re-exploration completed.'];
      if (summary?.projectType) {
        completionParts.push(`Project type: ${summary.projectType}`);
      }
      if (summary?.frameworks && summary.frameworks.length > 0) {
        completionParts.push(`Frameworks: ${summary.frameworks.join(', ')}`);
      }
      if (summary?.directoriesExplored !== undefined) {
        completionParts.push(`Directories explored: ${summary.directoriesExplored}`);
      }

      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: completionParts.join('\n'),
        replyTo: message.id,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Exploration failed: ${errorMsg}`,
        replyTo: message.id,
      });
    }

    logger.info(
      { sender: message.sender, mode: isFull ? 'full' : 'quick' },
      'Explore command handled',
    );
  }

  /**
   * Handle the "explore status" subcommand.
   * Shows last exploration timestamp, project type, and any in-progress phases.
   */
  private async handleExploreStatusSubcommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    const lines: string[] = ['*Exploration Status*'];

    const state = this.master!.getState();
    lines.push(`Master state: ${state}`);

    const summary = this.master!.getExplorationSummary();
    if (summary) {
      if (summary.completedAt) {
        lines.push(`Last exploration: ${summary.completedAt}`);
      }
      if (summary.projectType) {
        lines.push(`Project type: ${summary.projectType}`);
      }
      if (summary.frameworks && summary.frameworks.length > 0) {
        lines.push(`Frameworks: ${summary.frameworks.join(', ')}`);
      }
      lines.push(`Directories explored: ${summary.directoriesExplored}`);
      lines.push(`Files scanned: ${summary.filesScanned}`);
    } else {
      lines.push('No exploration has been completed yet.');
    }

    if (this.memory) {
      try {
        const progress = await this.memory.getExplorationProgress();
        if (progress.length > 0) {
          lines.push('\nPhase progress:');
          for (const ep of progress) {
            const bar = makeProgressBar(ep.progress_pct ?? 0);
            const label = ep.target ?? ep.phase;
            lines.push(` ${label}: [${bar}] ${ep.progress_pct ?? 0}%`);
          }
        }
      } catch {
        // Silently skip if DB query fails
      }
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });
  }

  /**
   * Handle the built-in "history" command.
   * Lists the last 10 conversation sessions with title, message count, and date.
   * Formats output per channel (WhatsApp/Telegram/Discord = numbered list, Console = table, WebChat = HTML).
   *
   * Syntax:
   *   "history"               → list last 10 sessions
   *   "history search <q>"    → search sessions by keyword (OB-1034)
   *   "history <session-id>"  → show full transcript (OB-1035)
   */
  private async handleHistoryCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const trimmed = message.content.trim();
    const rest = trimmed.slice(7).trim(); // slice past "history"

    // history search <query> — OB-1034
    if (rest.toLowerCase().startsWith('search')) {
      const query = rest.slice(6).trim(); // slice past "search"
      if (!query) {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: 'Usage: history search <keyword>',
          replyTo: message.id,
        });
        return;
      }

      if (!this.memory) {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: 'History search not available — memory system not initialized.',
          replyTo: message.id,
        });
        return;
      }

      let sessions: SessionSummary[];
      try {
        sessions = await this.memory.searchSessions(query, 10);
      } catch (err) {
        logger.warn({ err }, 'handleHistoryCommand: failed to search sessions');
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: 'History search temporarily unavailable — could not query sessions.',
          replyTo: message.id,
        });
        return;
      }

      const content =
        sessions.length === 0
          ? `*Conversation History*\n\nNo sessions found matching "${query}".`
          : this.formatSessionList(sessions, connector.name);
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content,
        replyTo: message.id,
      });
      logger.info({ sender: message.sender, query }, 'History search command handled');
      return;
    }

    // history <session-id> — OB-1035
    if (rest.length > 0) {
      if (!this.memory) {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: 'History not available — memory system not initialized.',
          replyTo: message.id,
        });
        return;
      }

      const sessionId = rest;
      let entries: ConversationEntry[];
      try {
        entries = await this.memory.getSessionHistory(sessionId, 50);
      } catch (err) {
        logger.warn({ err }, 'handleHistoryCommand: failed to get session history');
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: 'History temporarily unavailable — could not query session.',
          replyTo: message.id,
        });
        return;
      }

      const content =
        entries.length === 0
          ? `No conversation found for session: ${sessionId}`
          : this.formatSessionTranscript(entries, connector.name);
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content,
        replyTo: message.id,
      });
      logger.info({ sender: message.sender, sessionId }, 'History transcript command handled');
      return;
    }

    // bare "history" — list last 10 sessions
    if (!this.memory) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'History not available — memory system not initialized.',
        replyTo: message.id,
      });
      return;
    }

    let sessions: SessionSummary[];
    try {
      sessions = await this.memory.listSessions(10, 0);
    } catch (err) {
      logger.warn({ err }, 'handleHistoryCommand: failed to list sessions');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'History temporarily unavailable — could not query sessions.',
        replyTo: message.id,
      });
      return;
    }

    const content = this.formatSessionList(sessions, connector.name);
    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content,
      replyTo: message.id,
    });
    logger.info({ sender: message.sender }, 'History command handled');
  }

  /**
   * Format a session list for the given channel.
   *   webchat   → HTML table
   *   console   → ASCII table
   *   all other → numbered list (WhatsApp, Telegram, Discord)
   */
  private formatSessionList(sessions: SessionSummary[], channel: string): string {
    if (sessions.length === 0) {
      return '*Conversation History*\n\nNo past sessions found.';
    }

    const formatDate = (iso: string): string => iso.slice(0, 10); // YYYY-MM-DD

    if (channel === 'webchat') {
      const rows = sessions
        .map(
          (s, i) =>
            `<tr><td>${i + 1}</td><td>${escapeHtml(s.title ?? 'Untitled')}</td>` +
            `<td>${s.message_count}</td><td>${formatDate(s.last_message_at)}</td></tr>`,
        )
        .join('');
      return (
        '<b>Conversation History</b>' +
        '<table><tr><th>#</th><th>Title</th><th>Msgs</th><th>Date</th></tr>' +
        rows +
        '</table>'
      );
    }

    if (channel === 'console') {
      const header = ' # | Title                | Msgs | Date      ';
      const sep = '---|----------------------|------|----------';
      const rowLines = sessions.map((s, i) => {
        const num = String(i + 1).padStart(2, ' ');
        const title = (s.title ?? 'Untitled').slice(0, 20).padEnd(20, ' ');
        const msgs = String(s.message_count).padStart(4, ' ');
        const date = formatDate(s.last_message_at);
        return `${num} | ${title} | ${msgs} | ${date}`;
      });
      return ['*Conversation History*', '', header, sep, ...rowLines].join('\n');
    }

    // Default: numbered list (WhatsApp, Telegram, Discord)
    const rowLines = sessions.map((s, i) => {
      const title = s.title ?? 'Untitled';
      const msgWord = s.message_count === 1 ? 'msg' : 'msgs';
      return `${i + 1}. ${title} — ${s.message_count} ${msgWord} — ${formatDate(s.last_message_at)}`;
    });
    return ['*Conversation History*', '', ...rowLines].join('\n');
  }

  /**
   * Format a session transcript for the given channel.
   *   webchat   → HTML message bubbles
   *   console   → plain text with separator line
   *   all other → plain text list (WhatsApp, Telegram, Discord)
   */
  private formatSessionTranscript(entries: ConversationEntry[], channel: string): string {
    const formatTime = (iso: string): string => iso.slice(0, 16).replace('T', ' '); // YYYY-MM-DD HH:MM
    const formatRole = (role: string): string => {
      if (role === 'user') return 'You';
      if (role === 'master' || role === 'worker') return 'AI';
      return 'System';
    };

    if (channel === 'webchat') {
      const items = entries
        .map((e) => {
          const time = formatTime(e.created_at ?? '');
          const role = formatRole(e.role);
          const content = escapeHtml(e.content.slice(0, 500));
          const cls = e.role === 'user' ? 'user' : 'ai';
          return (
            `<div class="msg ${cls}"><b>${escapeHtml(role)}</b> ` +
            `<span class="time">${time}</span><p>${content}</p></div>`
          );
        })
        .join('');
      return `<b>Conversation Transcript</b><div class="transcript">${items}</div>`;
    }

    const rows = entries.map((e) => {
      const time = formatTime(e.created_at ?? '');
      const role = formatRole(e.role);
      const snippet = e.content.slice(0, 300);
      return `[${time}] ${role}: ${snippet}`;
    });

    if (channel === 'console') {
      return ['*Conversation Transcript*', '─'.repeat(40), ...rows, '─'.repeat(40)].join('\n');
    }

    // Default: WhatsApp, Telegram, Discord
    return ['*Conversation Transcript*', '', ...rows].join('\n');
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
