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
import type { AppServer } from './app-server.js';
import type { InteractionRelay, RelayMessage } from './interaction-relay.js';
import type { SecretMatch } from './secret-scanner.js';
import type {
  MemoryManager,
  ActivityRecord,
  ConversationEntry,
  ExplorationProgressRow,
  SessionSummary,
} from '../memory/index.js';
import type { AccessRole } from '../memory/access-store.js';
import type { MessageQueue } from './queue.js';
import type { RiskLevel, ExecutionProfile, DeepPhase, DocumentFileFormat } from '../types/agent.js';
import { PROFILE_RISK_MAP, BuiltInProfileNameSchema } from '../types/agent.js';
import type { SkillManager } from '../master/skill-manager.js';
import type { ParsedSpawnMarker } from '../master/spawn-parser.js';
import { extractTaskSummaries } from '../master/spawn-parser.js';
import { sendEmail } from './email-sender.js';
import { publishToGitHubPages } from './github-publisher.js';
import type { FileServer } from './file-server.js';
import { ProviderError } from '../providers/claude-code/provider-error.js';
import { AgentRunner, estimateCost, DEFAULT_MAX_TURNS_TASK } from './agent-runner.js';
import { FastPathResponder } from './fast-path-responder.js';
import { CHECKS } from '../cli/doctor.js';
import type { CheckResult } from '../cli/doctor.js';
import { loadAllSkillPacks } from '../master/skill-pack-loader.js';
import { createLogger } from './logger.js';

const logger = createLogger('router');

/** Pattern matching [SEND:channel]recipient|content[/SEND] markers in AI output */
const SEND_MARKER_RE = /\[SEND:([^\]]+)\]([^|]+)\|([^[]*)\[\/SEND\]/g;

/** Pattern matching [VOICE]text[/VOICE] markers in AI output */
const VOICE_MARKER_RE = /\[VOICE\]([\s\S]*?)\[\/VOICE\]/g;

/** Pattern matching [SHARE:channel]/path/to/file[/SHARE] markers in AI output */
const SHARE_MARKER_RE = /\[SHARE:([^\]]+)\]([^[]*)\[\/SHARE\]/g;

/** Pattern matching [APP:start]appPath[/APP] markers in AI output */
const APP_START_MARKER_RE = /\[APP:start\]([^[]*)\[\/APP\]/g;

/** Pattern matching [APP:stop]appId[/APP] markers in AI output */
const APP_STOP_MARKER_RE = /\[APP:stop\]([^[]*)\[\/APP\]/g;

/** Pattern matching [APP:update:appId]jsonData[/APP] markers in AI output */
const APP_UPDATE_MARKER_RE = /\[APP:update:([^\]]+)\]([^[]*)\[\/APP\]/g;

/** Pattern matching [CONTINUE:batch-{id}] internal batch continuation messages */
const CONTINUE_MARKER_RE = /^\[CONTINUE:batch-([^\]]+)\]$/;

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
  /** Auto-cancel timeout handle — cleared when user replies or entry is consumed */
  timeoutHandle: ReturnType<typeof setTimeout>;
}

/** A pending tool escalation request — queued when a worker needs additional tool access. */
export interface PendingEscalation {
  /** ID of the worker requesting additional tools */
  workerId: string;
  /** Tool names the worker is requesting access to */
  requestedTools: string[];
  /** Current tool profile the worker is running under */
  currentProfile: string;
  /** Reason from the worker failure explaining why additional tools are needed */
  reason: string;
  /** The original inbound message that triggered this worker */
  message: InboundMessage;
  /** Connector used to send the escalation prompt and receive the reply */
  connector: Connector;
  /** Auto-deny timeout handle — cleared when user replies with /allow or /deny */
  timeoutHandle: ReturnType<typeof setTimeout>;
  /**
   * Optional callback to re-spawn the worker with upgraded tools after the grant is
   * approved (OB-1594). Provided by MasterManager when calling requestToolEscalation().
   * Called with the granted tool/profile name(s) so the worker can retry.
   */
  respawn?: (grantedTools: string[]) => Promise<void>;
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
 * Creative intent types — maps to the skill packs in src/master/skill-packs/.
 * - diagram    → diagram-maker skill pack
 * - chart      → chart-generator skill pack
 * - design     → web-designer or slide-designer skill pack
 * - art        → generative-art skill pack
 * - brand      → brand-assets skill pack
 */
export type CreativeIntent = 'diagram' | 'chart' | 'design' | 'art' | 'brand';

/**
 * Classify a message to detect creative/visual output intent.
 *
 * Returns the creative intent type when the message is asking for a visual
 * output (diagram, chart, web design, generative art, brand assets), or
 * `null` if no creative intent is detected. Runs synchronously — no AI calls.
 *
 * Matching priority (highest to lowest):
 * 1. Explicit format or tool keywords (mermaid, d3, plantuml, p5.js, etc.)
 * 2. Output-type keywords (diagram, chart, logo, landing page, etc.)
 * 3. Verb + visual noun combinations
 */
export function classifyCreativeIntent(content: string): CreativeIntent | null {
  const lower = content.toLowerCase().trim();

  // Diagram — explicit tool or output-type keywords
  if (
    /\b(mermaid|plantuml|plant uml|d2 diagram|graphviz)\b/.test(lower) ||
    /\b(flowchart|flow chart|sequence diagram|er diagram|erd|class diagram|architecture diagram|network diagram|uml)\b/.test(
      lower,
    ) ||
    (/\bdiagram\b/.test(lower) &&
      /\b(create|generate|make|draw|build|produce|show|render)\b/.test(lower))
  )
    return 'diagram';

  // Chart — explicit tool or visualization keywords
  if (
    /\b(d3\.?js|chart\.?js|chartjs|d3 chart|recharts|vega)\b/.test(lower) ||
    /\b(bar chart|line chart|pie chart|scatter plot|histogram|area chart|bubble chart|heatmap|treemap)\b/.test(
      lower,
    ) ||
    (/\b(chart|graph|visualization|visualise|visualize)\b/.test(lower) &&
      /\b(create|generate|make|draw|build|produce|show|render|plot)\b/.test(lower))
  )
    return 'chart';

  // Brand assets — logos, favicons, social media images
  if (
    /\b(logo|favicon|brand asset|social media image|og image|twitter card|app icon)\b/.test(
      lower,
    ) &&
    /\b(create|generate|make|design|draw|build|produce)\b/.test(lower)
  )
    return 'brand';

  // Generative art — p5.js, algorithmic, creative coding
  if (
    /\b(p5\.?js|processing|generative art|algorithmic art|creative coding|svg pattern|svg art)\b/.test(
      lower,
    ) ||
    (/\b(generative|algorithmic|procedural)\b/.test(lower) &&
      /\b(art|image|pattern|design|visual)\b/.test(lower))
  )
    return 'art';

  // Design — web pages, landing pages, slides, HTML templates
  if (
    /\b(landing page|web page|webpage|email template|html template|marketing page|hero section)\b/.test(
      lower,
    ) ||
    /\b(presentation slide|html slide|slide deck)\b/.test(lower) ||
    (/\b(design|redesign)\b/.test(lower) &&
      /\b(website|webpage|web page|ui|interface|layout|page)\b/.test(lower))
  )
    return 'design';

  return null;
}

/**
 * Classify a message to detect document-generation intent.
 *
 * Returns the target file format when the message is asking for document
 * generation (docx, pptx, xlsx, or pdf), or `null` if no document intent
 * is detected. Runs synchronously — no AI calls.
 *
 * Matching priority (highest to lowest):
 * 1. Explicit format extension or acronym in the message (.docx, pptx, etc.)
 * 2. Document-type keywords (presentation, spreadsheet, report, …)
 * 3. Generic document-creation verb + "document" noun → defaults to docx
 */
export function classifyDocumentIntent(content: string): DocumentFileFormat | null {
  const lower = content.toLowerCase().trim();

  // Explicit format keywords — highest confidence
  if (lower.includes('.pptx') || /\bpptx\b/.test(lower)) return 'pptx';
  if (lower.includes('.xlsx') || /\bxlsx\b/.test(lower)) return 'xlsx';
  if (lower.includes('.docx') || /\bdocx\b/.test(lower)) return 'docx';
  if (lower.includes('.pdf') || /\bpdf\b/.test(lower)) return 'pdf';

  // Presentation / slides
  if (/\b(presentation|slide deck|slideshow|powerpoint|slides)\b/.test(lower)) return 'pptx';

  // Spreadsheet / Excel
  if (/\b(spreadsheet|excel|workbook)\b/.test(lower)) return 'xlsx';

  // Report — maps to PDF (report-generator skill pack)
  if (
    /\breport\b/.test(lower) &&
    /\b(generate|create|make|write|build|produce|draft)\b/.test(lower)
  )
    return 'pdf';

  // Word document — proposals, memos, letters, business documents
  if (/\b(word document|word doc|proposal|memo|business document|cover letter)\b/.test(lower))
    return 'docx';

  // Generic "write/create/draft a document" → default to docx
  if (/\b(write|create|generate|make|draft)\b/.test(lower) && /\bdocument\b/.test(lower))
    return 'docx';

  return null;
}

/**
 * Classify a message by priority using keyword heuristics.
 * Returns 1 (quick-answer), 2 (tool-use), or 3 (complex-task).
 * Runs synchronously — no AI calls, safe to call before enqueueing.
 */
export function classifyMessagePriority(content: string): MessagePriority {
  const lower = content.toLowerCase().trim();

  // Document-generation tasks — always complex (multi-step: plan → generate → write → deliver)
  if (classifyDocumentIntent(lower) !== null) {
    return 3;
  }

  // Creative/visual tasks — always complex (render pipeline: generate → render → deliver)
  if (classifyCreativeIntent(lower) !== null) {
    return 3;
  }

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

/**
 * Parse approximate counts of file reads, file modifications, and commands run
 * from a worker's stdout content. Uses heuristic regex patterns since the Claude
 * CLI --print mode outputs plain text rather than structured tool-call logs.
 *
 * Counts are best-effort: they reflect what the AI described doing, not raw tool calls.
 */
function parseWorkerStats(content: string): {
  filesRead: number;
  filesModified: number;
  commandsRun: number;
} {
  // File modification: action verbs before a backtick-wrapped file path
  const modifiedRe =
    /\b(?:edit(?:ed|ing)?|writ(?:e|ing|ten)|creat(?:e|ed|ing)|modif(?:y|ied|ying)|updat(?:e|ed|ing)|add(?:ed|ing)\s+to|rewrit(?:e|ing|ten))\b[^`\n]{0,50}`[^`]+\.[a-zA-Z0-9]{1,6}`/gi;

  // File reads: action verbs indicating a file was read
  const readRe =
    /\b(?:read(?:ing)?|examin(?:e|ed|ing)|analyz(?:e|ed|ing)|check(?:ed|ing)?|look(?:ed|ing)\s+at|review(?:ed|ing)?|inspect(?:ed|ing)?|open(?:ed|ing)?|search(?:ed|ing)?\s+(?:in|through))\b[^`\n]{0,50}`[^`]+\.[a-zA-Z0-9]{1,6}`/gi;

  // Shell commands: backtick-wrapped strings starting with common CLI tools
  const commandRe =
    /`(?:npm|yarn|pnpm|npx|git|bash|sh|node|python3?|pip3?|cargo|go|make|docker|kubectl|curl|wget|tsc|eslint|prettier|vitest|jest)\s[^`]+`/gi;

  const filesModified = (content.match(modifiedRe) ?? []).length;
  const filesReadRaw = (content.match(readRe) ?? []).length;
  const filesRead = Math.max(0, filesReadRaw - filesModified);
  const commandsRun = (content.match(commandRe) ?? []).length;

  return { filesRead, filesModified, commandsRun };
}

/**
 * Returns true only when the Q&A pair is worth caching.
 * Skips greetings, single-word acks, and error/refusal responses. (OB-1603)
 */
function isSubstantiveResponse(question: string, answer: string): boolean {
  const trimmedAnswer = answer.trim();

  // Too short to be useful
  if (trimmedAnswer.length < 30) return false;

  // Too-short question is likely a greeting or ack, not a cacheable Q
  if (question.trim().length < 5) return false;

  // Single-word / short acknowledgements
  const shortAckRe =
    /^(ok|okay|sure|got it|done|yes|no|hi|hello|hey|thanks|thank you|bye|goodbye|np|noted)[.!?\s]*$/i;
  if (shortAckRe.test(trimmedAnswer)) return false;

  // Error / refusal patterns
  const errorRe =
    /^(sorry|i (can'?t|cannot|am unable|don'?t know)|i'?m not able|there (was|is) an error|an error occurred)/i;
  if (errorRe.test(trimmedAnswer)) return false;

  return true;
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
  private fileServer?: FileServer;
  private memory?: MemoryManager;
  private queue?: MessageQueue;
  private appServer?: AppServer;
  private relay?: InteractionRelay;
  private skillManager?: SkillManager;
  /** Pending "stop all" confirmations — keyed by sender, value contains expiresAt timestamp. */
  private readonly pendingStopConfirmations = new Map<string, PendingConfirmation>();
  /** Pending high-risk spawn confirmations — keyed by sender, awaiting user "go" or "skip". */
  private readonly pendingSpawnConfirmations = new Map<string, PendingSpawnEntry>();
  /** Pending tool escalation requests — keyed by sender, queue of pending entries (FIFO). Each /allow pops the first. */
  private readonly pendingEscalations = new Map<string, PendingEscalation[]>();
  /** Tracks senders who have already received a 50% reminder for the current escalation batch (OB-1640). */
  private readonly escalationReminderSent = new Set<string>();
  /** Session-level tool grants — keyed by sender, value is the set of tool/profile names granted for this session. */
  private readonly sessionGrantedTools = new Map<string, Set<string>>();
  /** Security config — controls confirmation requirements for high-risk spawns. */
  private securityConfig?: SecurityConfig;
  /** Sensitive files detected by the startup secret scanner. Populated via setVisibilityState(). */
  private detectedSecrets: readonly SecretMatch[] = [];
  /** Workspace-relative patterns auto-excluded this session after secret scanning. */
  private sessionExcludePatterns: readonly string[] = [];
  /** User-configured include patterns (workspace.include). */
  private workspaceInclude: readonly string[] = [];
  /** User-configured exclude patterns (workspace.exclude). */
  private workspaceExclude: readonly string[] = [];
  /**
   * IDs of priority-1 messages that should trigger a checkpoint-handle-resume cycle.
   * Populated by the `onUrgentEnqueued` queue callback; consumed in `route()`.
   */
  private readonly urgentCycleMessageIds = new Set<string>();
  /** Pool of short-lived read-only agents for quick-answer responses during Master processing. */
  private readonly fastPathResponder = new FastPathResponder(new AgentRunner());

  constructor(
    defaultProvider: string,
    private readonly routerConfig?: RouterConfig,
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

  /** Set the SkillManager — enables the "/skills" command */
  setSkillManager(skillManager: SkillManager): void {
    this.skillManager = skillManager;
    logger.info('Router configured with SkillManager (/skills command enabled)');
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

  /** Set the file server — enables [SHARE:FILE] marker support (creates shareable links) */
  setFileServer(server: FileServer): void {
    this.fileServer = server;
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

  /** Set the AppServer — enables [APP:start] and [APP:stop] marker support */
  setAppServer(appServer: AppServer): void {
    this.appServer = appServer;
    logger.info('Router configured with AppServer (APP markers enabled)');
  }

  /** Set the InteractionRelay — routes app messages to Master as app-interaction InboundMessages */
  setInteractionRelay(relay: InteractionRelay): void {
    this.relay = relay;
    relay.onAppMessage((relayMsg) => this.handleAppInteraction(relayMsg));
    logger.info('Router configured with InteractionRelay (app interactions enabled)');
  }

  /**
   * Handle a message received from a served app via InteractionRelay.
   * Converts the relay message into an InboundMessage and passes it to Master AI.
   * No-op when Master is not configured.
   */
  private async handleAppInteraction(relayMsg: RelayMessage): Promise<void> {
    if (!this.master) {
      logger.warn(
        { appId: relayMsg.appId },
        'App interaction received but no Master is set — ignoring',
      );
      return;
    }

    const msgId = relayMsg.id ?? `relay-${relayMsg.appId}-${Date.now()}`;
    const dataStr =
      relayMsg.data !== null && relayMsg.data !== undefined
        ? JSON.stringify(relayMsg.data, null, 2)
        : '(no data)';

    const inboundMessage: InboundMessage = {
      id: msgId,
      source: 'interaction-relay',
      sender: `app:${relayMsg.appId}`,
      rawContent: dataStr,
      content: `[App: ${relayMsg.appId}] ${relayMsg.type}\n${dataStr}`,
      timestamp: relayMsg.timestamp ? new Date(relayMsg.timestamp) : new Date(),
      metadata: {
        type: 'app-interaction',
        appId: relayMsg.appId,
        data: relayMsg.data,
      },
    };

    logger.info(
      { appId: relayMsg.appId, type: relayMsg.type, msgId },
      'Routing app interaction to Master',
    );

    try {
      await this.master.processMessage(inboundMessage);
    } catch (err) {
      logger.error(
        { appId: relayMsg.appId, type: relayMsg.type, err },
        'Error processing app interaction',
      );
    }
  }

  /**
   * Inject a synthetic batch continuation message directly to Master AI.
   *
   * Bypasses all auth checks, rate limiting, and the message queue. Called by
   * MasterManager (OB-1613) after each batch item completes to trigger processing
   * of the next batch item. The `[CONTINUE:batch-{batchId}]` content is the internal
   * marker that route() recognises and forwards to Master without user-facing output.
   *
   * @param batchId  The active batch identifier.
   * @param sender   The original sender who initiated the batch (for message context).
   */
  async routeBatchContinuation(batchId: string, sender: string): Promise<void> {
    if (!this.master) {
      logger.warn({ batchId }, 'routeBatchContinuation: no Master configured — skipping');
      return;
    }

    const syntheticMsg: InboundMessage = {
      id: `batch-continue-${batchId}-${Date.now()}`,
      source: 'internal-batch',
      sender,
      rawContent: `[CONTINUE:batch-${batchId}]`,
      content: `[CONTINUE:batch-${batchId}]`,
      timestamp: new Date(),
      metadata: { internal: true, batchId, type: 'batch-continuation' },
    };

    logger.info(
      { batchId, sender, messageId: syntheticMsg.id },
      'Injecting batch continuation — routing to Master without auth/rate limiting',
    );

    try {
      await this.master.processMessage(syntheticMsg);
    } catch (err) {
      logger.error({ batchId, err }, 'Error processing batch continuation');
      // (OB-1616) Notify master of batch item failure so it can pause and alert the user.
      const reason = err instanceof Error ? err.message : String(err);
      await this.master.onBatchItemFailure(batchId, reason);
    }
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
   * Set workspace visibility state — populates data shown by the /scope command.
   * Called by Bridge after startup secret scanning and config wiring are complete.
   */
  setVisibilityState(
    detectedSecrets: readonly SecretMatch[],
    sessionExcludePatterns: readonly string[],
    workspaceInclude: readonly string[],
    workspaceExclude: readonly string[],
  ): void {
    this.detectedSecrets = detectedSecrets;
    this.sessionExcludePatterns = sessionExcludePatterns;
    this.workspaceInclude = workspaceInclude;
    this.workspaceExclude = workspaceExclude;
    logger.info(
      { secretCount: detectedSecrets.length, sessionExcludeCount: sessionExcludePatterns.length },
      'Router visibility state updated',
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

    // Check per-user consent preference — skip confirmation when the user has opted out
    if (this.memory) {
      const consentMode = await this.memory.getConsentMode(sender, message.source);
      if (consentMode === 'auto-approve-all') {
        logger.debug({ sender, consentMode }, 'Skipping spawn confirmation — auto-approve-all');
        return false;
      }
      if (consentMode === 'auto-approve-read') {
        const allLowRisk = markers.every((m) => {
          const risk = this.getProfileRisk(m.profile);
          return risk === 'low';
        });
        if (allLowRisk) {
          logger.debug(
            { sender, consentMode },
            'Skipping spawn confirmation — auto-approve-read with all low-risk profiles',
          );
          return false;
        }
      }
      if (consentMode === 'auto-approve-up-to-edit') {
        const allMediumOrLower = markers.every((m) => {
          const risk = this.getProfileRisk(m.profile);
          return risk === 'low' || risk === 'medium';
        });
        if (allMediumOrLower) {
          logger.debug(
            { sender, consentMode },
            'Skipping spawn confirmation — auto-approve-up-to-edit with all medium-or-lower-risk profiles',
          );
          return false;
        }
      }
    }

    const highRiskMarkers = markers.filter((m) => {
      const risk = this.getProfileRisk(m.profile);
      return risk === 'high' || risk === 'critical';
    });

    if (highRiskMarkers.length === 0) return false;

    const hasCritical = highRiskMarkers.some((m) => this.getProfileRisk(m.profile) === 'critical');
    const riskLevel: RiskLevel = hasCritical ? 'critical' : 'high';
    const firstHighRiskMarker = highRiskMarkers[0]!;
    const summaries = extractTaskSummaries(highRiskMarkers);

    const profileDisplay = firstHighRiskMarker.profile;
    const riskDisplay = riskLevel.toUpperCase();
    const taskList = summaries.map((s, i) => `${i + 1}. ${s}`).join('\n');

    // Aggregate cost estimate across all high-risk workers
    let totalTurns = 0;
    let totalCostUsd = 0;
    for (const marker of highRiskMarkers) {
      const maxTurns = marker.body.maxTurns ?? DEFAULT_MAX_TURNS_TASK;
      const modelTier = marker.body.model ?? 'balanced';
      const est = estimateCost(marker.profile, maxTurns, modelTier);
      totalTurns += est.estimatedTurns;
      totalCostUsd += parseFloat(est.costString.slice(2)); // strip leading "~$"
    }
    const aggCostString = `~$${totalCostUsd.toFixed(2)}`;
    const aggTimeMinutes = Math.ceil((totalTurns * 10) / 60);
    const aggTimeString = aggTimeMinutes <= 1 ? '~1 min' : `~${aggTimeMinutes} min`;
    const estimateText = `Estimated: ~${totalTurns} turns, ${aggCostString}, ${aggTimeString}`;

    const confirmText =
      `⚠️ Confirmation required — ${highRiskMarkers.length} worker(s) with ${riskDisplay} risk` +
      ` profile (${profileDisplay}):\n\n${taskList}\n\n${estimateText}\n\nReply "go" to proceed or "skip" to cancel.`;

    // Set a 60-second auto-cancel timeout. Stored in the entry so it can be cleared on reply.
    const timeoutHandle = setTimeout(() => {
      const stillPending = this.pendingSpawnConfirmations.get(sender);
      if (!stillPending) return;
      this.pendingSpawnConfirmations.delete(sender);

      const timeoutMsg: OutboundMessage = {
        target: message.source,
        recipient: sender,
        content: '⏱ Confirmation timed out — spawn cancelled. Send your request again to retry.',
      };
      connector.sendMessage(timeoutMsg).catch((err: unknown) => {
        logger.warn({ err, sender }, 'Failed to send spawn confirmation timeout notification');
      });

      logger.warn(
        { sender, profile: profileDisplay, riskLevel },
        'Spawn confirmation timed out — pending entry auto-cancelled',
      );
    }, 60_000);

    this.pendingSpawnConfirmations.set(sender, {
      markers,
      message,
      connector,
      taskSummaries: summaries,
      profile: firstHighRiskMarker.profile,
      riskLevel,
      timeoutHandle,
    });

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
   * Clears the auto-cancel timeout so it does not fire after the user has replied.
   * Returns `undefined` if no confirmation is pending for that sender.
   * Used by the /confirm and /skip command handlers (OB-1388).
   */
  public takePendingSpawnConfirmation(sender: string): PendingSpawnEntry | undefined {
    const entry = this.pendingSpawnConfirmations.get(sender);
    if (entry) {
      clearTimeout(entry.timeoutHandle);
      this.pendingSpawnConfirmations.delete(sender);
    }
    return entry;
  }

  /** Check whether a pending spawn confirmation exists for a sender. */
  public hasPendingSpawnConfirmation(sender: string): boolean {
    return this.pendingSpawnConfirmations.has(sender);
  }

  /**
   * Send a tool escalation prompt to the user and register a pending escalation.
   * Called when a worker needs additional tool access beyond its current profile.
   *
   * Sends: "Worker {id} needs {tools} access for: {reason}. Reply '/allow {tool}' or
   * '/allow {profile}' to grant, '/deny' to reject."
   *
   * Registers an auto-deny timeout (default 180s, configurable via `router.escalationTimeoutMs`) —
   * cleared when the user replies with /allow or /deny via the respective command handlers (OB-1586, OB-1587).
   */
  public async requestToolEscalation(
    workerId: string,
    requestedTools: string[],
    currentProfile: string,
    reason: string,
    message: InboundMessage,
    connector: Connector,
    respawn?: (grantedTools: string[]) => Promise<void>,
  ): Promise<void> {
    const sender = message.sender;
    const toolsList = requestedTools.join(', ');

    // Check consent mode for auto-approve-up-to-edit — auto-approve escalations to code-edit
    // or lower risk without prompting the user (OB-1601).
    if (this.memory) {
      const consentMode = await this.memory.getConsentMode(sender, message.source);
      if (consentMode === 'auto-approve-up-to-edit') {
        const allWithinEditLevel = requestedTools.every((tool) => {
          const parsed = BuiltInProfileNameSchema.safeParse(tool);
          if (parsed.success) {
            const risk = PROFILE_RISK_MAP[parsed.data];
            // Auto-approve low and medium risk profiles (read-only, code-audit, code-edit)
            return risk === 'low' || risk === 'medium';
          }
          // Specific tool names (not profile names) are single-tool grants — treat as within edit level
          return true;
        });
        if (allWithinEditLevel) {
          logger.info(
            { sender, workerId, requestedTools },
            'Auto-approving tool escalation — auto-approve-up-to-edit mode',
          );
          await connector.sendMessage({
            target: message.source,
            recipient: sender,
            content: `✅ Auto-approved tool escalation for worker ${workerId}: *${toolsList}* (auto-approve-up-to-edit mode)`,
          });
          if (respawn) {
            await respawn(requestedTools);
          }
          return;
        }
      }
    }

    // Get queue state BEFORE adding new entry to compute scaled timeout (OB-1639)
    const existingQueue = this.pendingEscalations.get(sender) ?? [];
    const pendingCount = existingQueue.length + 1; // includes the escalation being added

    // Scale timeout: base + 60s per additional pending escalation beyond the first, capped at 600s
    const baseTimeoutMs = this.routerConfig?.escalationTimeoutMs ?? 180_000;
    const scaledTimeoutMs = Math.min(baseTimeoutMs + (pendingCount - 1) * 60_000, 600_000);
    const scaledTimeoutSec = Math.round(scaledTimeoutMs / 1000);

    // Schedule a 50% reminder once per batch — only for the first escalation in a new batch (OB-1640)
    if (existingQueue.length === 0) {
      const reminderDelayMs = Math.round(scaledTimeoutMs / 2);
      setTimeout(() => {
        // Skip if the reminder was already sent for this sender (defensive guard)
        if (this.escalationReminderSent.has(sender)) return;
        const currentQueue = this.pendingEscalations.get(sender);
        if (!currentQueue || currentQueue.length === 0) return;
        this.escalationReminderSent.add(sender);
        const count = currentQueue.length;
        const reminderMsg: OutboundMessage = {
          target: message.source,
          recipient: sender,
          content: `⏰ Reminder: You have ${count} pending escalation request${count === 1 ? '' : 's'} — reply /allow, /allow all, or /deny.`,
        };
        connector.sendMessage(reminderMsg).catch((err: unknown) => {
          logger.warn({ err, sender }, 'Failed to send escalation reminder');
        });
        logger.info({ sender, count }, 'Escalation reminder sent at 50% timeout');
      }, reminderDelayMs);
    }

    // Set auto-deny timeout — removes only this entry from the queue
    const timeoutHandle = setTimeout(() => {
      const queue = this.pendingEscalations.get(sender);
      if (!queue) return;
      const idx = queue.findIndex((e) => e.workerId === workerId);
      if (idx === -1) return;
      queue.splice(idx, 1);
      if (queue.length === 0) {
        this.pendingEscalations.delete(sender);
        this.escalationReminderSent.delete(sender);
      }

      const timeoutMsg: OutboundMessage = {
        target: message.source,
        recipient: sender,
        content: `⏱ Escalation timed out — worker ${workerId} continuing with current profile (${currentProfile}).`,
      };
      connector.sendMessage(timeoutMsg).catch((err: unknown) => {
        logger.warn({ err, sender, workerId }, 'Failed to send escalation timeout notification');
      });

      logger.warn(
        { sender, workerId, requestedTools, currentProfile },
        'Tool escalation timed out — auto-denied',
      );

      // Mark the worker as cancelled in the registry (OB-1644)
      if (this.master) {
        const registry = this.master.getWorkerRegistry();
        const workerRecord = registry.getWorker(workerId);
        if (
          workerRecord &&
          workerRecord.status !== 'completed' &&
          workerRecord.status !== 'failed'
        ) {
          try {
            registry.markCancelled(workerId, 'escalation-timeout');
            logger.info({ workerId }, 'Worker marked cancelled after escalation timeout');
          } catch (err) {
            logger.warn(
              { workerId, err },
              'Failed to mark worker cancelled after escalation timeout',
            );
          }
        }
      }
    }, scaledTimeoutMs);

    const queueEntry: PendingEscalation = {
      workerId,
      requestedTools,
      currentProfile,
      reason,
      message,
      connector,
      timeoutHandle,
      respawn,
    };
    existingQueue.push(queueEntry);
    this.pendingEscalations.set(sender, existingQueue);

    // Build escalation prompt showing full queue state (OB-1635)
    const queueCount = existingQueue.length;
    let escalationText: string;
    if (queueCount === 1) {
      const allowExample =
        requestedTools.length === 1
          ? `/allow ${requestedTools[0]}`
          : `/allow ${requestedTools[0]} (or /allow code-edit)`;
      escalationText =
        `⚠️ Worker ${workerId} needs *${toolsList}* access for:\n${reason}\n\n` +
        `Current profile: ${currentProfile}\n\n` +
        `Reply '${allowExample}', '/allow all', or '/deny' to reject.\n` +
        `Auto-deny in ${scaledTimeoutSec} seconds if no reply.`;
    } else {
      const workerLines = existingQueue
        .map((e, i) => `(${i + 1}) ${e.workerId} needs ${e.requestedTools.join(', ')}`)
        .join('\n');
      escalationText =
        `⚠️ ${queueCount} workers requesting elevated access:\n${workerLines}\n\n` +
        `Reply /allow for next, /allow all for all, or /deny to reject next.\n` +
        `Auto-deny for first request in ${scaledTimeoutSec} seconds if no reply.`;
    }

    await connector.sendMessage({
      target: message.source,
      recipient: sender,
      content: escalationText,
      replyTo: message.id,
    });

    logger.info(
      { sender, workerId, requestedTools, currentProfile },
      'Tool escalation prompt sent to user',
    );
  }

  /**
   * Retrieve and remove the pending escalation entry for a sender.
   * Clears the auto-deny timeout so it does not fire after the user has replied.
   * Returns `undefined` if no escalation is pending for that sender.
   * Used by the /allow and /deny command handlers (OB-1586, OB-1587).
   */
  public takePendingEscalation(sender: string): PendingEscalation | undefined {
    const queue = this.pendingEscalations.get(sender);
    if (!queue || queue.length === 0) return undefined;
    const entry = queue.shift()!;
    clearTimeout(entry.timeoutHandle);
    if (queue.length === 0) {
      this.pendingEscalations.delete(sender);
      this.escalationReminderSent.delete(sender);
    }
    return entry;
  }

  /** Return the number of pending escalations queued for a sender. */
  public pendingEscalationCount(sender: string): number {
    return this.pendingEscalations.get(sender)?.length ?? 0;
  }

  /**
   * Retrieve and remove ALL pending escalation entries for a sender.
   * Clears all auto-deny timeouts. Returns an empty array if none are pending.
   * Used by the /allow all command handler (OB-1632).
   */
  public takeAllPendingEscalations(sender: string): PendingEscalation[] {
    const queue = this.pendingEscalations.get(sender);
    if (!queue || queue.length === 0) return [];
    this.pendingEscalations.delete(sender);
    this.escalationReminderSent.delete(sender);
    for (const entry of queue) clearTimeout(entry.timeoutHandle);
    return queue;
  }

  /** Check whether a pending tool escalation exists for a sender. */
  public hasPendingEscalation(sender: string): boolean {
    const queue = this.pendingEscalations.get(sender);
    return !!queue && queue.length > 0;
  }

  /**
   * Return the set of tool/profile names granted for this session for a sender.
   * Returns an empty set when no session grants exist for the sender.
   * Used by workers and Master to check session-level tool access without DB lookup.
   */
  public getSessionGrants(sender: string): ReadonlySet<string> {
    return this.sessionGrantedTools.get(sender) ?? new Set<string>();
  }

  /** Register an active connector */
  addConnector(connector: Connector): void {
    this.connectors.set(connector.name, connector);
  }

  /** Look up a registered connector by source name. Returns undefined when not found. */
  getConnector(source: string): Connector | undefined {
    return this.connectors.get(source);
  }

  /** Register an active provider */
  addProvider(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Send a progress event to a specific connector (best-effort).
   * Used by MasterManager to emit typed ProgressEvents to the right connector
   * without going through the full routing flow.
   *
   * When the event is `worker-result`, also sends a plain-text execution summary
   * to the user (OB-1391): "Worker completed (Ns, N turns): N files read, N files modified, N commands run".
   */
  async sendProgress(source: string, recipient: string, event: ProgressEvent): Promise<void> {
    const connector = this.connectors.get(source);
    if (!connector) return;
    if (connector.sendProgress) {
      try {
        await connector.sendProgress(event, recipient);
      } catch (err) {
        logger.warn({ err, source, recipient }, 'sendProgress: failed to send progress event');
      }
    }

    // Send execution summary after each worker completes (OB-1391)
    if (event.type === 'worker-result') {
      await this.sendWorkerExecutionSummary(connector, recipient, event);
    }

    // Send phase transition message when a Deep Mode phase completes (OB-1415)
    if (event.type === 'deep-phase' && event.status === 'completed') {
      await this.sendDeepPhaseTransitionMessage(connector, recipient, event);
    }
  }

  /**
   * Format and send a plain-text execution summary to the user after a worker completes.
   * Format: "Worker [N/T] completed (Xs, N turns): N files read, N files modified, N commands run"
   * Counts are parsed from the worker's stdout content using heuristic patterns (OB-1391).
   */
  private async sendWorkerExecutionSummary(
    connector: Connector,
    recipient: string,
    event: Extract<ProgressEvent, { type: 'worker-result' }>,
  ): Promise<void> {
    const durationSec = event.durationMs !== undefined ? Math.round(event.durationMs / 1000) : null;
    const { filesRead, filesModified, commandsRun } = parseWorkerStats(event.content);

    const timePart = durationSec !== null ? `${durationSec}s` : '?s';
    const turnsPart =
      event.turnsUsed !== undefined && event.turnsUsed > 0
        ? `${event.turnsUsed} turn${event.turnsUsed !== 1 ? 's' : ''}`
        : null;
    const durationStr = turnsPart ? `${timePart}, ${turnsPart}` : timePart;

    const status = event.success ? 'completed' : 'failed';
    const workerLabel = event.total > 1 ? `Worker ${event.workerIndex}/${event.total}` : 'Worker';

    const summary =
      `${workerLabel} ${status} (${durationStr}): ` +
      `${filesRead} file${filesRead !== 1 ? 's' : ''} read, ` +
      `${filesModified} file${filesModified !== 1 ? 's' : ''} modified, ` +
      `${commandsRun} command${commandsRun !== 1 ? 's' : ''} run`;

    const msg: OutboundMessage = {
      target: connector.name,
      recipient,
      content: summary,
    };

    try {
      await connector.sendMessage(msg);
      logger.debug(
        { recipient, workerIndex: event.workerIndex, total: event.total, durationSec },
        'Worker execution summary sent',
      );
    } catch (err) {
      logger.warn(
        { err, recipient },
        'sendWorkerExecutionSummary: failed to send execution summary',
      );
    }
  }

  /**
   * Build and send a phase transition message to the user after a Deep Mode phase completes.
   *
   * Includes a completion header with item count, a brief snippet of the phase output, and
   * per-phase guidance for the next available actions (/proceed, /focus N, /skip N, etc.).
   *
   * Called from sendProgress() when a deep-phase event with status 'completed' arrives (OB-1415).
   */
  private async sendDeepPhaseTransitionMessage(
    connector: Connector,
    recipient: string,
    event: Extract<ProgressEvent, { type: 'deep-phase' }>,
  ): Promise<void> {
    const { sessionId, phase } = event;

    // Try to get the full phase result for item counting and an extended snippet
    const fullResult = this.master
      ?.getDeepModeManager()
      .getPhaseResult(sessionId, phase as DeepPhase);

    const outputText = fullResult?.output ?? event.resultSummary ?? '';

    // Count numbered list items (e.g. "1. Finding" or "1) Task")
    const numberedCount = (outputText.match(/^\s*\d+[.)]\s/gm) ?? []).length;
    const itemCount = numberedCount > 0 ? numberedCount : undefined;

    // Build a concise summary snippet (first 300 chars of the result)
    const snippet =
      outputText.length > 0
        ? outputText.slice(0, 300).trimEnd() + (outputText.length > 300 ? '…' : '')
        : '';

    // Per-phase completion header and tailored next-action guidance
    const phaseMessages: Record<string, { header: string; guidance: string }> = {
      investigate: {
        header: `*Investigation complete*${itemCount !== undefined ? ` — ${itemCount} finding${itemCount !== 1 ? 's' : ''} identified` : ''}.`,
        guidance:
          'To dig deeper into a finding: `/focus N`\nTo proceed to the report phase: `/proceed`',
      },
      report: {
        header: `*Report ready*${itemCount !== undefined ? ` — ${itemCount} item${itemCount !== 1 ? 's' : ''}` : ''}.`,
        guidance:
          'To focus on a specific finding: `/focus N`\nTo proceed to the plan phase: `/proceed`',
      },
      plan: {
        header: `*Plan ready*${itemCount !== undefined ? ` — ${itemCount} task${itemCount !== 1 ? 's' : ''}` : ''}.`,
        guidance: 'To skip a task: `/skip N`\nTo execute the plan: `/proceed`',
      },
      execute: {
        header: '*Execution complete.*',
        guidance: 'To run verification checks: `/proceed`',
      },
      verify: {
        header: '*Verification complete. Deep Mode session finished.*',
        guidance: 'Send `/phase` to review the full results.',
      },
    };

    const phaseInfo = phaseMessages[phase];
    if (!phaseInfo) return; // Unknown phase — skip

    const parts: string[] = [phaseInfo.header];
    if (snippet) parts.push('', snippet);
    parts.push('', phaseInfo.guidance);

    try {
      await connector.sendMessage({ target: connector.name, recipient, content: parts.join('\n') });
      logger.debug({ recipient, sessionId, phase }, 'Deep Mode phase transition message sent');
    } catch (err) {
      logger.warn(
        { err, recipient, sessionId, phase },
        'sendDeepPhaseTransitionMessage: failed to send',
      );
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

    // Detect internal batch continuation messages — [CONTINUE:batch-{id}] — before connector
    // lookup so that synthetic messages (source='internal-batch') work without a registered
    // connector. These messages bypass all auth checks, rate limiting, and user-facing acks.
    const continueMatch = CONTINUE_MARKER_RE.exec(message.content.trim());
    if (continueMatch !== null) {
      const batchId = continueMatch[1]!;
      logger.info(
        { batchId, sender: message.sender, messageId: message.id },
        'Internal batch continuation detected — routing to Master directly',
      );
      if (this.master) {
        try {
          await this.master.processMessage(message);
        } catch (err) {
          logger.error({ batchId, err }, 'Error processing batch continuation');
          // (OB-1616) Notify master of batch item failure so it can pause and alert the user.
          const reason = err instanceof Error ? err.message : String(err);
          await this.master.onBatchItemFailure(batchId, reason);
        }
      } else {
        logger.warn({ batchId }, 'Batch continuation received but no Master is set — ignoring');
      }
      return;
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

    // Handle /pause command — pause active batch (OB-1619).
    if (/^\/pause$/i.test(message.content.trim())) {
      if (this.master) {
        const response = await this.master.handleBatchCommand(
          'pause',
          message.sender,
          message.source,
        );
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: response,
        });
      } else {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: 'No active batch.',
        });
      }
      return;
    }

    // Handle /continue command — resume paused batch (OB-1620).
    if (/^\/continue$/i.test(message.content.trim())) {
      if (this.master) {
        const response = await this.master.handleBatchCommand(
          'resume',
          message.sender,
          message.source,
        );
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: response,
        });
      } else {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: 'No active batch.',
        });
      }
      return;
    }

    // Handle /batch (no args) — show batch status (OB-1621).
    if (/^\/batch$/i.test(message.content.trim())) {
      const response = this.master ? this.master.getBatchStatus() : 'No active batch.';
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: response,
      });
      return;
    }

    // Handle batch control commands: /batch skip | /batch retry | /batch abort (OB-1616).
    // These are intercepted before routing to Master so they take effect immediately.
    const batchCmdMatch = /^\/batch\s+(skip|retry|abort)$/i.exec(message.content.trim());
    if (batchCmdMatch !== null) {
      const action = batchCmdMatch[1]!.toLowerCase() as 'skip' | 'retry' | 'abort';
      if (this.master) {
        const response = await this.master.handleBatchCommand(
          action,
          message.sender,
          message.source,
        );
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: response,
        });
      } else {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: 'No active batch.',
        });
      }
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

    // Handle "go" / "/confirm" for a pending high-risk spawn confirmation
    if (
      message.content.trim().toLowerCase() === 'go' ||
      message.content.trim().toLowerCase() === '/confirm'
    ) {
      // "go" with no pending spawn but Deep Mode active → treat as /proceed (OB-1413)
      if (
        message.content.trim().toLowerCase() === 'go' &&
        !this.pendingSpawnConfirmations.has(message.sender) &&
        this.master !== undefined &&
        this.master.getDeepModeManager().getActiveSessions().length > 0
      ) {
        await this.handleProceedCommand(message, connector);
        return;
      }
      await this.handleConfirmSpawnCommand(message, connector);
      return;
    }

    // Handle "skip" / "/skip" for a pending high-risk spawn cancellation
    if (
      message.content.trim().toLowerCase() === 'skip' ||
      message.content.trim().toLowerCase() === '/skip'
    ) {
      await this.handleSkipSpawnCommand(message, connector);
      return;
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

    // Handle built-in "/audit" command — intercept before routing to Master AI
    if (/^\/audit(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleAuditCommand(message, connector);
      return;
    }

    // Handle built-in "/deep" command — starts/toggles/configures Deep Mode (OB-1407)
    if (/^\/deep(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleDeepCommand(message, connector);
      return;
    }

    // Handle built-in "/proceed" command — advances to next Deep Mode phase (OB-1408)
    if (/^\/proceed(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleProceedCommand(message, connector);
      return;
    }

    // Handle built-in "/focus N" command — focused investigation on finding N (OB-1409)
    if (/^\/focus(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleFocusCommand(message, connector);
      return;
    }

    // Handle built-in "/skip N" command — skip item N from Deep Mode plan (OB-1410)
    if (/^\/skip\s+\d+/i.test(message.content.trim())) {
      await this.handleSkipItemCommand(message, connector);
      return;
    }

    // Handle built-in "/phase" command — shows current Deep Mode phase and progress (OB-1411)
    if (/^\/phase(\s+.*)?$/i.test(message.content.trim())) {
      await this.handlePhaseCommand(message, connector);
      return;
    }

    // Handle built-in "/help" command — lists all available commands (OB-1430)
    if (/^\/help$/i.test(message.content.trim())) {
      await this.handleHelpCommand(message, connector);
      return;
    }

    // Handle built-in "/skills" command — list available skills with descriptions and usage counts (OB-1712)
    if (/^\/skills$/i.test(message.content.trim())) {
      await this.handleSkillsCommand(message, connector);
      return;
    }

    // Handle built-in "/skill-packs" command — list available skill packs with descriptions (OB-1756)
    if (/^\/skill-packs$/i.test(message.content.trim())) {
      await this.handleSkillPacksCommand(message, connector);
      return;
    }

    // Handle built-in "/apps" command — shows running app instances with URLs (OB-1450)
    if (/^\/apps$/i.test(message.content.trim())) {
      await this.handleAppsCommand(message, connector);
      return;
    }

    // Handle built-in "/scope" command — shows visibility rules and detected secrets (OB-1472)
    if (/^\/scope$/i.test(message.content.trim())) {
      await this.handleScopeCommand(message, connector);
      return;
    }

    // Handle built-in "/allow" command — grant pending tool escalation (OB-1586)
    if (/^\/allow(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleAllowCommand(message, connector);
      return;
    }

    // Handle built-in "/deny all" command — reject all pending tool escalations (OB-1634)
    if (/^\/deny\s+all$/i.test(message.content.trim())) {
      await this.handleDenyAllCommand(message, connector);
      return;
    }

    // Handle built-in "/deny" command — reject pending tool escalation (OB-1587)
    if (/^\/deny$/i.test(message.content.trim())) {
      await this.handleDenyCommand(message, connector);
      return;
    }

    // Handle built-in "/permissions" command — show current user's grants and consent mode (OB-1589)
    if (/^\/permissions$/i.test(message.content.trim())) {
      await this.handlePermissionsCommand(message, connector);
      return;
    }

    // Handle built-in "/whoami" command — show user's role, channel, allowed actions, daily cost, consent mode (OB-1720)
    if (/^\/whoami$/i.test(message.content.trim())) {
      await this.handleWhoamiCommand(message, connector);
      return;
    }

    // Handle built-in "/role <user_id> <role>" command — owner/admin only, sets role for another user (OB-1721)
    if (/^\/role\b/i.test(message.content.trim())) {
      await this.handleRoleCommand(message, connector);
      return;
    }

    // Handle built-in "/workers" command — list active workers with ID, status, profile, duration, PID (OB-1646)
    if (/^\/workers$/i.test(message.content.trim())) {
      await this.handleWorkersCommand(message, connector);
      return;
    }

    // Handle built-in "/kill <worker-id>" command — force-stop a stuck worker (OB-1646)
    if (/^\/kill\s+\S+/i.test(message.content.trim())) {
      await this.handleKillWorkerCommand(message, connector);
      return;
    }

    // Handle built-in "/stats" command — show exploration ROI (OB-1680)
    if (/^\/stats$/i.test(message.content.trim())) {
      await this.handleStatsCommand(message, connector);
      return;
    }

    // Handle built-in "/doctor" command — run health checks and send summary (OB-1693)
    if (/^\/doctor$/i.test(message.content.trim())) {
      await this.handleDoctorCommand(message, connector);
      return;
    }

    // Handle built-in "/approve <code>" command — owner/admin approves a pairing code (OB-1698)
    if (/^\/approve\b/i.test(message.content.trim())) {
      await this.handleApproveCommand(message, connector);
      return;
    }

    // Detect natural language model overrides — "use opus for task 1" / "use haiku for this" (OB-1412)
    if (
      /\b(?:use|switch\s+to|change\s+to)\s+(?:\w+[-\s]?)?(opus|sonnet|haiku|fast|balanced|powerful)\b/i.test(
        message.content.trim(),
      ) &&
      this.master !== undefined &&
      this.master.getDeepModeManager().getActiveSessions().length > 0
    ) {
      await this.handleModelOverrideCommand(message, connector);
      return;
    }

    // Natural language Deep Mode navigation — regex checked first (short-circuit before
    // getDeepModeManager()) to avoid calling it on every message (OB-1413)
    {
      const trimmedNl = message.content.trim();

      // "proceed" / "next" / "continue" → /proceed
      if (
        /^(?:proceed|next|continue)\s*$/i.test(trimmedNl) &&
        this.master !== undefined &&
        this.master.getDeepModeManager().getActiveSessions().length > 0
      ) {
        await this.handleProceedCommand(message, connector);
        return;
      }

      // "focus on #3", "dig into finding 3", "investigate 3", "look at item 3" → /focus 3
      const focusNlMatch =
        /\b(?:focus\s+on|dig\s+into|investigate|look\s+at)\s+(?:finding\s+|item\s+|#)?(\d+)/i.exec(
          trimmedNl,
        );
      if (
        focusNlMatch !== null &&
        this.master !== undefined &&
        this.master.getDeepModeManager().getActiveSessions().length > 0
      ) {
        await this.handleFocusCommand(
          { ...message, content: `/focus ${focusNlMatch[1]}` },
          connector,
        );
        return;
      }

      // "skip item 2", "skip finding 2", "skip task 2", "skip 2" → /skip 2
      const skipNlMatch = /\bskip\s+(?:item\s+|finding\s+|task\s+|#)?(\d+)/i.exec(trimmedNl);
      if (
        skipNlMatch !== null &&
        this.master !== undefined &&
        this.master.getDeepModeManager().getActiveSessions().length > 0
      ) {
        await this.handleSkipItemCommand(
          { ...message, content: `/skip ${skipNlMatch[1]}` },
          connector,
        );
        return;
      }
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

    // Parse and dispatch [APP:start]/[APP:stop] app lifecycle markers
    const afterApp = await this.processAppMarkers(afterShare);

    // Parse and dispatch [SEND:channel] proactive markers before sending main reply
    const afterSend = await this.processSendMarkers(afterApp);

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

    // Cache Q&A pair after successful Master response (OB-1602)
    // Only cache substantive responses — skip greetings, short acks, and errors (OB-1603)
    if (
      useMaster &&
      this.memory?.qaCache &&
      isSubstantiveResponse(message.content, cleanedContent)
    ) {
      try {
        this.memory.qaCache.store({
          question: message.content,
          answer: cleanedContent,
          confidence: 0.9,
        });
      } catch {
        logger.debug({ messageId: message.id }, 'QA cache store failed (non-critical)');
      }
    }

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
      if (this.auth && !this.auth.isAuthorized(trimmedRecipient, channel)) {
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

      // Handle FILE channel — create a shareable link via the local file server,
      // and additionally send as a native attachment for connectors that support it (WhatsApp, Telegram).
      if (channel === 'FILE') {
        if (this.fileServer) {
          const filename = path.basename(resolvedPath);
          try {
            const url = await this.fileServer.createShareableLink(filename);
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
            const data = await readFile(resolvedPath);
            const filename = path.basename(resolvedPath);
            const { mimeType, mediaType } = getMimeType(filename);
            await connector.sendMessage({
              target: connector.name,
              recipient,
              content: '',
              replyTo,
              media: { type: mediaType, data, mimeType, filename },
            });
            logger.info(
              { filename, recipient, connector: connector.name },
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
  private async processAppMarkers(content: string): Promise<string> {
    if (!this.appServer && !this.relay) return content;

    let cleaned = content;

    // Handle APP:start markers — replace each marker with the app URL
    if (this.appServer) {
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
          const instance = await this.appServer.startApp(appPath);
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
    if (this.appServer) {
      const stopRegex = new RegExp(APP_STOP_MARKER_RE.source, 'g');
      let stopMatch: RegExpExecArray | null;
      while ((stopMatch = stopRegex.exec(cleaned)) !== null) {
        const fullMatch = stopMatch[0];
        const appId = (stopMatch[1] ?? '').trim();

        if (appId) {
          try {
            this.appServer.stopApp(appId);
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

        if (this.relay) {
          const sent = this.relay.sendToApp(appId, 'update', parsedData);
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
   * Handle "go" / "/confirm" — approve a pending high-risk spawn confirmation.
   *
   * Retrieves and removes the pending spawn entry for the sender. If found,
   * re-routes the original message so the Master AI dispatches the workers.
   * If no confirmation is pending, responds with "No pending confirmation."
   */
  private async handleConfirmSpawnCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    const entry = this.takePendingSpawnConfirmation(message.sender);
    if (!entry) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No pending confirmation.',
        replyTo: message.id,
      });
      logger.info({ sender: message.sender }, 'Spawn confirm: no pending entry');
      return;
    }

    logger.info(
      { sender: message.sender, markerCount: entry.markers.length },
      'Spawn confirmation approved — dispatching workers',
    );

    // Re-route the original message so the Master AI re-processes and dispatches workers
    await this.route(entry.message);
  }

  /**
   * Handle "skip" / "/skip" — cancel a pending high-risk spawn confirmation.
   *
   * Retrieves and removes the pending spawn entry for the sender. If found,
   * notifies the user that the spawn has been cancelled. If no confirmation
   * is pending, responds with "No pending confirmation."
   */
  private async handleSkipSpawnCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    const entry = this.takePendingSpawnConfirmation(message.sender);
    if (!entry) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No pending confirmation.',
        replyTo: message.id,
      });
      logger.info({ sender: message.sender }, 'Spawn skip: no pending entry');
      return;
    }

    logger.info(
      { sender: message.sender, markerCount: entry.markers.length },
      'Spawn confirmation rejected — spawn cancelled',
    );

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: 'Spawn cancelled.',
      replyTo: message.id,
    });
  }

  /**
   * Handle the built-in "/allow" command — grant a pending tool escalation (OB-1586).
   *
   * Syntax:
   *   /allow <tool>               → grant single tool, scope: once (default)
   *   /allow <profile>            → upgrade to named profile, scope: once
   *   /allow <tool> --session     → grant for the entire session
   *   /allow <tool> --permanent   → grant permanently (stored in DB)
   *
   * Clears the pending escalation for the sender, sends a confirmation, and
   * stores the grant in the appropriate backing store (session Map or DB) per scope (OB-1588).
   */
  private async handleAllowCommand(message: InboundMessage, connector: Connector): Promise<void> {
    // Parse: /allow all — grant all pending escalations at once (OB-1632)
    const trimmed = message.content.trim();
    const rest = trimmed.slice('/allow'.length).trim();

    if (/^all$/i.test(rest)) {
      await this.handleAllowAllCommand(message, connector);
      return;
    }

    const entry = this.takePendingEscalation(message.sender);
    if (!entry) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No pending tool escalation.',
        replyTo: message.id,
      });
      logger.info({ sender: message.sender }, 'Allow: no pending escalation');
      return;
    }

    // Extract scope suffix
    let scope: 'once' | 'session' | 'permanent' = 'once';
    let grantArg = rest;
    if (/--permanent$/i.test(rest)) {
      scope = 'permanent';
      grantArg = rest.replace(/\s*--permanent$/i, '').trim();
    } else if (/--session$/i.test(rest)) {
      scope = 'session';
      grantArg = rest.replace(/\s*--session$/i, '').trim();
    }

    // Determine whether grantArg is a built-in profile name or a single tool
    const isProfile = BuiltInProfileNameSchema.safeParse(grantArg).success;

    const scopeLabel =
      scope === 'once' ? 'this request' : scope === 'session' ? 'this session' : 'permanently';
    const grantDescription = isProfile ? `profile upgrade to *${grantArg}*` : `tool *${grantArg}*`;

    const remaining = this.pendingEscalationCount(message.sender);
    const remainingLine =
      remaining > 0
        ? `\n${remaining} more pending escalation(s) — reply /allow for next or /allow all for all`
        : '';
    const confirmText =
      `✅ Granted ${grantDescription} to worker ${entry.workerId} for ${scopeLabel}.\n` +
      `Worker will be notified to retry with the granted access.${remainingLine}`;

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: confirmText,
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, workerId: entry.workerId, grantArg, scope, isProfile },
      'Tool escalation granted via /allow',
    );

    // Wire scope-specific grant storage (OB-1588)
    if (scope === 'session') {
      const existing = this.sessionGrantedTools.get(message.sender) ?? new Set<string>();
      existing.add(grantArg);
      this.sessionGrantedTools.set(message.sender, existing);
      logger.debug({ sender: message.sender, grantArg }, 'Session tool grant stored');
    } else if (scope === 'permanent' && this.memory) {
      try {
        const entry = await this.memory.getAccess(message.sender, message.source);
        const existingActions = entry?.allowed_actions ?? [];
        if (!existingActions.includes(grantArg)) {
          await this.memory.setAccess({
            ...(entry ?? {}),
            user_id: message.sender,
            channel: message.source,
            role: entry?.role ?? 'custom',
            allowed_actions: [...existingActions, grantArg],
          });
          logger.debug({ sender: message.sender, grantArg }, 'Permanent tool grant stored in DB');
        }
      } catch (err) {
        logger.warn(
          { err, sender: message.sender, grantArg },
          'Failed to persist permanent tool grant',
        );
      }
    }

    // OB-1594: Re-spawn the worker with the granted tools/profile.
    // The respawn callback was registered by MasterManager when requestToolEscalation()
    // was called. Errors are non-fatal — the grant is already recorded.
    if (entry.respawn) {
      logger.info(
        { workerId: entry.workerId, grantArg },
        'Triggering worker re-spawn after tool grant',
      );
      entry.respawn([grantArg]).catch((err: unknown) => {
        logger.warn(
          { err, workerId: entry.workerId, grantArg },
          'Worker re-spawn after tool grant failed',
        );
      });
    }
  }

  /**
   * Handle the "/allow all" command — grant all pending tool escalations for the sender
   * at once (OB-1632).
   *
   * Drains the escalation queue, grants each worker's originally-requested tools, and
   * triggers their respawn callbacks sequentially.  Scope is always "once" — no
   * --session / --permanent modifiers are supported for bulk grants.
   */
  private async handleAllowAllCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    const entries = this.takeAllPendingEscalations(message.sender);
    if (entries.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No pending tool escalations.',
        replyTo: message.id,
      });
      logger.info({ sender: message.sender }, 'Allow all: no pending escalations');
      return;
    }

    const workerIds = entries.map((e) => e.workerId).join(', ');
    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: `✅ Granted all pending escalations (${entries.length} worker(s): ${workerIds}).\nEach worker will be notified to retry with the granted access.`,
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, count: entries.length, workerIds },
      'All pending tool escalations granted via /allow all',
    );

    for (const entry of entries) {
      if (entry.respawn) {
        logger.info(
          { workerId: entry.workerId, requestedTools: entry.requestedTools },
          'Triggering worker re-spawn after /allow all grant',
        );
        entry.respawn(entry.requestedTools).catch((err: unknown) => {
          logger.warn({ err, workerId: entry.workerId }, 'Worker re-spawn after /allow all failed');
        });
      }
    }
  }

  /**
   * Handle the built-in "/deny" command — reject a pending tool escalation (OB-1587).
   *
   * Removes the pending escalation for the sender and notifies the user.
   * The Master AI is notified to continue the worker without the requested tools
   * or abort the worker if the task cannot proceed without them.
   */
  private async handleDenyCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const entry = this.takePendingEscalation(message.sender);
    if (!entry) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No pending tool escalation.',
        replyTo: message.id,
      });
      logger.info({ sender: message.sender }, 'Deny: no pending escalation');
      return;
    }

    const denyText =
      `❌ Tool escalation denied for worker ${entry.workerId}.\n` +
      `The worker will continue with its current profile (*${entry.currentProfile}*) or abort if unable to proceed.`;

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: denyText,
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, workerId: entry.workerId, requestedTools: entry.requestedTools },
      'Tool escalation denied via /deny',
    );
  }

  /**
   * Handle the "/deny all" command — deny all pending tool escalations for the sender
   * at once (OB-1634).
   *
   * Drains the escalation queue and marks all queued workers as denied.
   */
  private async handleDenyAllCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const entries = this.takeAllPendingEscalations(message.sender);
    if (entries.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No pending tool escalations.',
        replyTo: message.id,
      });
      logger.info({ sender: message.sender }, 'Deny all: no pending escalations');
      return;
    }

    const workerIds = entries.map((e) => e.workerId).join(', ');
    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: `❌ Denied all pending escalations (${entries.length} worker(s): ${workerIds}).\nEach worker will continue with its current profile or abort if unable to proceed.`,
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, count: entries.length, workerIds },
      'All pending tool escalations denied via /deny all',
    );
  }

  /**
   * Handle the built-in "/permissions" command — show the current user's tool grants and consent
   * mode (OB-1589).
   *
   * Output:
   *   - Consent mode (always-ask / auto-approve-read / auto-approve-all)
   *   - Session grants (from in-memory sessionGrantedTools Map)
   *   - Permanent grants (from access_control DB via allowed_actions)
   */
  private async handlePermissionsCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    const lines: string[] = ['*Your Permissions*', ''];

    // Consent mode
    let consentMode: string = 'always-ask';
    if (this.memory) {
      try {
        consentMode = await this.memory.getConsentMode(message.sender, message.source);
      } catch {
        consentMode = 'always-ask';
      }
    }
    lines.push(`*Consent mode:* ${consentMode}`);
    lines.push('');

    // Session grants (in-memory, cleared on restart)
    const sessionGrants = this.sessionGrantedTools.get(message.sender);
    if (sessionGrants && sessionGrants.size > 0) {
      lines.push('*Session grants* (active until restart):');
      for (const grant of sessionGrants) {
        lines.push(`  • ${grant}`);
      }
    } else {
      lines.push('*Session grants:* none');
    }
    lines.push('');

    // Permanent grants (stored in DB)
    if (this.memory) {
      try {
        const entry = await this.memory.getAccess(message.sender, message.source);
        const permanentGrants = entry?.allowed_actions ?? [];
        if (permanentGrants.length > 0) {
          lines.push('*Permanent grants* (stored in DB):');
          for (const grant of permanentGrants) {
            lines.push(`  • ${grant}`);
          }
        } else {
          lines.push('*Permanent grants:* none');
        }
      } catch {
        lines.push('*Permanent grants:* (unavailable — DB error)');
      }
    } else {
      lines.push('*Permanent grants:* (unavailable — memory not initialised)');
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info({ sender: message.sender }, 'Permissions displayed via /permissions');
  }

  /**
   * Handle the built-in "/whoami" command.
   *
   * Shows the user their role, channel, allowed actions, daily cost usage, and consent mode.
   * Requires no elevated permissions — any user can see their own identity info (OB-1720).
   */
  private async handleWhoamiCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const lines: string[] = ['*Who Am I*', ''];

    // Sender (truncated for display)
    const sender = message.sender;
    const displaySender = sender.length > 20 ? `${sender.slice(0, 8)}…${sender.slice(-6)}` : sender;
    lines.push(`*User:* ${displaySender}`);
    lines.push(`*Channel:* ${message.source}`);
    lines.push('');

    // Role + allowed actions from access_control
    let role = 'owner'; // default fallback
    let allowedActions: string[] | null = null;
    let dailyCostUsed: number | null = null;
    let dailyCostLimit: number | null = null;

    if (this.memory) {
      try {
        const entry = await this.memory.getAccess(sender, message.source);
        if (entry) {
          role = entry.role;
          // Resolve effective allowed actions: explicit list takes precedence over role default
          if (entry.allowed_actions && entry.allowed_actions.length > 0) {
            allowedActions = entry.allowed_actions;
          } else {
            const roleDefaults: Record<string, string[] | null> = {
              owner: null,
              admin: null,
              developer: ['read', 'edit', 'test'],
              viewer: ['read'],
              custom: null,
            };
            allowedActions = roleDefaults[entry.role] ?? null;
          }
          dailyCostUsed = entry.daily_cost_used ?? null;
          dailyCostLimit = entry.max_cost_per_day_usd ?? null;
        }
      } catch {
        // leave defaults
      }
    }

    lines.push(`*Role:* ${role}`);

    if (allowedActions === null) {
      lines.push('*Allowed actions:* all (no restrictions)');
    } else {
      lines.push(`*Allowed actions:* ${allowedActions.join(', ')}`);
    }
    lines.push('');

    // Daily cost usage
    if (dailyCostUsed !== null) {
      const usedStr = `$${dailyCostUsed.toFixed(4)}`;
      const limitStr = dailyCostLimit != null ? ` / $${dailyCostLimit.toFixed(2)} limit` : '';
      lines.push(`*Daily cost:* ${usedStr}${limitStr}`);
    } else if (this.memory) {
      try {
        const totalCost = await this.memory.getDailyCost();
        lines.push(`*Daily cost (shared):* $${totalCost.toFixed(4)}`);
      } catch {
        lines.push('*Daily cost:* unavailable');
      }
    } else {
      lines.push('*Daily cost:* unavailable');
    }
    lines.push('');

    // Consent mode
    let consentMode = 'always-ask';
    if (this.memory) {
      try {
        consentMode = await this.memory.getConsentMode(sender, message.source);
      } catch {
        consentMode = 'always-ask';
      }
    }
    lines.push(`*Consent mode:* ${consentMode}`);

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info({ sender: message.sender }, 'Identity info displayed via /whoami');
  }

  /**
   * Handle the built-in "/role <user_id> <role>" command.
   *
   * Syntax: /role <user_id> <role>
   * Valid roles: owner, admin, developer, viewer, custom
   *
   * Only owner or admin callers may use this command.
   * Sets the role for the target user on the same channel (OB-1721).
   */
  private async handleRoleCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const VALID_ROLES = new Set(['owner', 'admin', 'developer', 'viewer', 'custom']);

    const send = (content: string): Promise<void> =>
      connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content,
        replyTo: message.id,
      });

    // Check caller has owner or admin role
    if (this.memory) {
      try {
        const callerEntry = await this.memory.getAccess(message.sender, message.source);
        const callerRole = callerEntry?.role ?? 'owner';
        if (callerRole !== 'owner' && callerRole !== 'admin') {
          await send(
            `Permission denied. The /role command requires owner or admin role. Your current role is *${callerRole}*.`,
          );
          return;
        }
      } catch {
        // allow fallthrough — default is owner
      }
    }

    // Parse: /role <user_id> <role>
    const parts = message.content.trim().split(/\s+/);
    // parts[0] = "/role", parts[1] = user_id, parts[2] = role
    const [, rawTargetUserId, rawNewRole] = parts;
    if (!rawTargetUserId || !rawNewRole) {
      await send(
        'Usage: /role <user_id> <role>\nValid roles: owner, admin, developer, viewer, custom',
      );
      return;
    }

    const targetUserId = rawTargetUserId;
    const newRole = rawNewRole.toLowerCase();

    if (!VALID_ROLES.has(newRole)) {
      await send(`Invalid role *${newRole}*. Valid roles: owner, admin, developer, viewer, custom`);
      return;
    }

    if (!this.memory) {
      await send('Role management is unavailable: memory system not initialised.');
      return;
    }

    try {
      const existing = await this.memory.getAccess(targetUserId, message.source);
      if (existing) {
        await this.memory.setAccess({ ...existing, role: newRole as AccessRole });
      } else {
        await this.memory.setAccess({
          user_id: targetUserId,
          channel: message.source,
          role: newRole as AccessRole,
        });
      }

      const displayTarget =
        targetUserId.length > 20
          ? `${targetUserId.slice(0, 8)}…${targetUserId.slice(-6)}`
          : targetUserId;
      await send(
        `Role updated: *${displayTarget}* is now *${newRole}* on channel *${message.source}*.`,
      );
      logger.info(
        { sender: message.sender, targetUserId, newRole, channel: message.source },
        'Role updated via /role command',
      );
    } catch (err) {
      logger.error({ err }, 'Failed to update role via /role command');
      await send('Failed to update role. Please try again.');
    }
  }

  /**
   * Handle the built-in "/approve <code>" command.
   *
   * Owner or admin users can approve a pending pairing request by submitting
   * the 6-digit code that the unknown sender received. On success the sender
   * is added to access_control with the viewer role and the pending pairing
   * entry is removed (OB-1698).
   */
  private async handleApproveCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const send = (content: string): Promise<void> =>
      connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content,
        replyTo: message.id,
      });

    // Only owner or admin may approve pairing requests
    if (this.memory) {
      try {
        const callerEntry = await this.memory.getAccess(message.sender, message.source);
        const callerRole = callerEntry?.role ?? 'owner';
        if (callerRole !== 'owner' && callerRole !== 'admin') {
          await send(
            `Permission denied. The /approve command requires owner or admin role. Your current role is *${callerRole}*.`,
          );
          return;
        }
      } catch {
        // allow fallthrough — default is owner
      }
    }

    // Parse: /approve <code>
    const parts = message.content.trim().split(/\s+/);
    const code = parts[1];
    if (!code) {
      await send('Usage: /approve <code>\nExample: /approve 482916');
      return;
    }

    if (!this.auth) {
      await send('Pairing approval unavailable: auth service not initialised.');
      return;
    }

    const pairing = this.auth.getPairing(code);
    if (!pairing) {
      await send(
        `No pending pairing found for code *${code}*. It may have already been used or expired.`,
      );
      return;
    }

    // Grant access — role is configurable via auth.channelRoles / auth.defaultRole
    if (!this.memory) {
      await send('Pairing approval unavailable: memory system not initialised.');
      return;
    }

    try {
      const role = (this.auth.getRoleForChannel(pairing.channel) as AccessRole) ?? 'viewer';
      await this.memory.approvePairing(pairing.senderId, pairing.channel, role);

      this.auth.removePairing(code);

      const displayId =
        pairing.senderId.length > 20
          ? `${pairing.senderId.slice(0, 8)}…${pairing.senderId.slice(-6)}`
          : pairing.senderId;
      await send(
        `Pairing approved. *${displayId}* has been granted *viewer* access on channel *${pairing.channel}*.`,
      );
      logger.info(
        { approver: message.sender, senderId: pairing.senderId, channel: pairing.channel, code },
        'Pairing approved via /approve command',
      );
    } catch (err) {
      logger.error({ err }, 'Failed to approve pairing via /approve command');
      await send('Failed to approve pairing. Please try again.');
    }
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
   * Handle the built-in "/audit" command.
   * Shows the last 10 worker spawns with task ID, profile, duration, estimated cost, and result status.
   * Reads from the agent_activity table via MemoryManager.
   *
   * Syntax:
   *   "/audit"   → list last 10 worker spawns
   */
  private async handleAuditCommand(message: InboundMessage, connector: Connector): Promise<void> {
    if (!this.memory) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Audit log not available — memory system not initialized.',
        replyTo: message.id,
      });
      return;
    }

    let spawns: ActivityRecord[];
    try {
      spawns = await this.memory.getRecentWorkerSpawns(10);
    } catch (err) {
      logger.warn({ err }, 'handleAuditCommand: failed to query worker spawns');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Audit log temporarily unavailable — could not query activity records.',
        replyTo: message.id,
      });
      return;
    }

    const content = this.formatAuditLog(spawns, connector.name);
    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content,
      replyTo: message.id,
    });
    logger.info({ sender: message.sender }, 'Audit command handled');
  }

  /**
   * Handle the built-in "/deep" command — starts Deep Mode, toggles it, or shows status.
   *
   * Syntax:
   *   /deep            → toggle (start thorough if inactive, show status if active)
   *   /deep thorough   → start automatic multi-phase execution
   *   /deep manual     → start with pause between phases for user review
   *   /deep off        → deactivate Deep Mode, abort all active sessions
   */
  private async handleDeepCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const trimmed = message.content.trim();
    const rest = trimmed.slice(5).trim().toLowerCase(); // Remove "/deep"

    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const deepMode = this.master.getDeepModeManager();
    const activeSessions = deepMode.getActiveSessions();

    // /deep off — abort all active sessions
    if (rest === 'off') {
      if (activeSessions.length === 0) {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: 'No active Deep Mode session to deactivate.',
          replyTo: message.id,
        });
        return;
      }
      for (const sessionId of activeSessions) {
        deepMode.abort(sessionId);
      }
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Deep Mode deactivated — ${activeSessions.length} session(s) aborted.`,
        replyTo: message.id,
      });
      logger.info(
        { sender: message.sender, count: activeSessions.length },
        'Deep Mode aborted via /deep off',
      );
      return;
    }

    // Unknown argument
    if (rest !== '' && rest !== 'thorough' && rest !== 'manual') {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: [
          'Unknown Deep Mode option. Usage:',
          '  /deep           — toggle (or show status if active)',
          '  /deep thorough  — start automatic multi-phase execution',
          '  /deep manual    — start with pause between phases',
          '  /deep off       — deactivate Deep Mode',
        ].join('\n'),
        replyTo: message.id,
      });
      return;
    }

    // If already active, show current status
    if (activeSessions.length > 0) {
      const lines: string[] = ['*Deep Mode Status*', ''];
      for (const sessionId of activeSessions) {
        const state = deepMode.getSessionState(sessionId);
        if (!state) continue;
        const paused = deepMode.isPaused(sessionId);
        const phase = state.currentPhase ?? 'done';
        const completedPhases = Object.keys(state.phaseResults);
        lines.push(`Profile: ${state.profile}`);
        lines.push(
          `Current phase: ${phase}${paused ? ' (paused — send /proceed to continue)' : ''}`,
        );
        if (completedPhases.length > 0) {
          lines.push(`Completed: ${completedPhases.join(', ')}`);
        }
        lines.push(`Task: ${state.taskSummary.slice(0, 100)}`);
      }
      lines.push('');
      lines.push('Send /deep off to deactivate.');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: lines.join('\n'),
        replyTo: message.id,
      });
      return;
    }

    // Start a new session — default to thorough when no arg provided (toggle on)
    const effectiveProfile: ExecutionProfile = rest === 'manual' ? 'manual' : 'thorough';
    const sessionId = deepMode.startSession(
      `User-initiated via /deep ${effectiveProfile}`,
      effectiveProfile,
    );

    if (!sessionId) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not started — fast profile skips multi-phase execution.',
        replyTo: message.id,
      });
      return;
    }

    const currentPhase = deepMode.getCurrentPhase(sessionId);
    const profileDescription =
      effectiveProfile === 'manual'
        ? 'I will pause after each phase for your review. Send /proceed to advance.'
        : 'I will run all phases automatically and report when complete.';

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: [
        `*Deep Mode started* (${effectiveProfile} profile)`,
        `Current phase: *${currentPhase ?? 'investigate'}*`,
        '',
        profileDescription,
        '',
        'Send your task description and Deep Mode will guide multi-phase execution.',
      ].join('\n'),
      replyTo: message.id,
    });
    logger.info(
      { sender: message.sender, sessionId, profile: effectiveProfile },
      'Deep Mode activated via /deep command',
    );
  }

  /**
   * Handle the built-in "/proceed" command — advances to the next Deep Mode phase.
   *
   * Behaviour per profile:
   *   manual   → if the session is paused, resume it so the next phase can run.
   *              if the session is not paused (phase still running), inform the user.
   *   thorough → no-op; Deep Mode auto-advances through phases without user input.
   *
   * Responds with "No active Deep Mode session" when no session exists.
   */
  private async handleProceedCommand(message: InboundMessage, connector: Connector): Promise<void> {
    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const deepMode = this.master.getDeepModeManager();
    const activeSessions = deepMode.getActiveSessions();

    if (activeSessions.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No active Deep Mode session.',
        replyTo: message.id,
      });
      return;
    }

    const lines: string[] = [];

    for (const sessionId of activeSessions) {
      const state = deepMode.getSessionState(sessionId);
      if (!state) continue;

      if (state.profile === 'thorough') {
        // Thorough profile auto-advances — /proceed is a no-op
        const phase = state.currentPhase ?? 'done';
        lines.push(
          `Deep Mode (thorough) is running automatically — no action needed.\nCurrent phase: *${phase}*`,
        );
      } else if (state.profile === 'manual') {
        if (deepMode.isPaused(sessionId)) {
          deepMode.resume(sessionId);
          const phase = state.currentPhase ?? 'done';
          lines.push(`Proceeding with Deep Mode — resuming *${phase}* phase.`);
          logger.info(
            { sender: message.sender, sessionId, phase },
            'Deep Mode resumed via /proceed',
          );
        } else {
          const phase = state.currentPhase ?? 'done';
          lines.push(
            `Deep Mode *${phase}* phase is still running — please wait for it to complete before sending /proceed.`,
          );
        }
      }
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n\n') || 'No actionable Deep Mode session found.',
      replyTo: message.id,
    });
  }

  /**
   * Handle the built-in "/focus N" command — digs deeper into finding number N.
   *
   * Behaviour:
   *   1. Records the focused item in the active Deep Mode session via focusOnItem().
   *   2. Builds a focused investigation message for the Master AI.
   *   3. Confirms to the user that investigation is starting.
   *   4. Routes the investigation to Master AI via processMessage() and sends the result.
   *
   * Responds with "No active Deep Mode session" when no session exists.
   * Responds with usage guidance when N is missing or invalid.
   */
  private async handleFocusCommand(message: InboundMessage, connector: Connector): Promise<void> {
    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    // Parse item number N from "/focus N"
    const trimmed = message.content.trim();
    const match = /^\/focus\s+(\d+)/i.exec(trimmed);
    if (!match) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Usage: /focus N — provide a finding number (e.g., /focus 3)',
        replyTo: message.id,
      });
      return;
    }

    const itemIndex = parseInt(match[1]!, 10);

    const deepMode = this.master.getDeepModeManager();
    const activeSessions = deepMode.getActiveSessions();

    if (activeSessions.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No active Deep Mode session.',
        replyTo: message.id,
      });
      return;
    }

    // Use the first active session
    const sessionId = activeSessions[0]!;
    const state = deepMode.getSessionState(sessionId);

    if (!state) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No active Deep Mode session.',
        replyTo: message.id,
      });
      return;
    }

    // Record the focused item in the session state
    deepMode.focusOnItem(sessionId, itemIndex);

    // Get the most recent phase result to provide context for the investigation
    const reportResult = deepMode.getPhaseResult(sessionId, 'report');
    const investigateResult = deepMode.getPhaseResult(sessionId, 'investigate');
    const latestResult = reportResult ?? investigateResult;

    const contextSnippet = latestResult
      ? `\n\nContext from ${latestResult.phase} phase:\n${latestResult.output.slice(0, 800)}`
      : '';

    // Build focused investigation prompt for the Master AI
    const focusContent =
      `[Deep Mode — Focused Investigation on Finding #${itemIndex}]\n` +
      `The user requested a deep-dive on finding #${itemIndex} from the current analysis.\n` +
      `Task: "${state.taskSummary}"${contextSnippet}\n\n` +
      `Please investigate finding #${itemIndex} thoroughly:\n` +
      `- Trace all code paths, dependencies, and side effects related to this finding\n` +
      `- Identify the root cause, not just the symptom\n` +
      `- List all files affected (with file:line references)\n` +
      `- Assess the severity and impact\n` +
      `- Suggest specific remediation steps`;

    // Confirm immediately to the user before the investigation begins
    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: `Investigating finding #${itemIndex} in depth — spawning focused worker.\nTask: "${state.taskSummary}"`,
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, sessionId, itemIndex, phase: state.currentPhase },
      'Deep Mode focused investigation requested via /focus',
    );

    // Spawn the focused investigation via Master AI and send the result back
    try {
      const focusMessage: InboundMessage = { ...message, content: focusContent };
      const response = await this.master.processMessage(focusMessage);
      if (response) {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: response,
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { sender: message.sender, sessionId, itemIndex, err: errMsg },
        'Deep Mode focused investigation failed',
      );
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Focused investigation of finding #${itemIndex} failed: ${errMsg}`,
      });
    }
  }

  /**
   * Handle the built-in "/skip N" command — marks plan item N as skipped in Deep Mode.
   *
   * Behaviour:
   *   1. Parses N from "/skip N".
   *   2. Marks item N as skipped in the active Deep Mode session via skipItem().
   *   3. Confirms to the user that the item has been skipped.
   *   4. The execute phase will not process skipped items.
   *
   * Responds with "No active Deep Mode session" when no session exists.
   * Responds with usage guidance when N is missing or invalid.
   */
  private async handleSkipItemCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    // Parse item number N from "/skip N"
    const trimmed = message.content.trim();
    const match = /^\/skip\s+(\d+)/i.exec(trimmed);
    if (!match) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Usage: /skip N — provide a task number (e.g., /skip 3)',
        replyTo: message.id,
      });
      return;
    }

    const itemIndex = parseInt(match[1]!, 10);

    const deepMode = this.master.getDeepModeManager();
    const activeSessions = deepMode.getActiveSessions();

    if (activeSessions.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No active Deep Mode session.',
        replyTo: message.id,
      });
      return;
    }

    // Use the first active session
    const sessionId = activeSessions[0]!;
    const state = deepMode.getSessionState(sessionId);

    if (!state) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No active Deep Mode session.',
        replyTo: message.id,
      });
      return;
    }

    // Mark the item as skipped in the session state
    deepMode.skipItem(sessionId, itemIndex);

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: `Task #${itemIndex} marked as skipped — it will not be processed in the execute phase.\nTask: "${state.taskSummary}"`,
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, sessionId, itemIndex, phase: state.currentPhase },
      'Deep Mode item skipped via /skip command',
    );
  }

  /**
   * Handle the built-in "/phase" command — shows current phase and progress for Deep Mode.
   *
   * Displays for each active Deep Mode session:
   *   - Profile name and task summary
   *   - Current phase (or "complete" if all phases done)
   *   - Completed phases with a brief output summary (first 200 chars)
   *   - Pending phases not yet started
   *   - Skipped items (if any)
   *
   * Responds with "No active Deep Mode session" when none exists.
   * Responds with "Deep Mode not available" when Master AI is not initialized.
   */
  private async handlePhaseCommand(message: InboundMessage, connector: Connector): Promise<void> {
    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const deepMode = this.master.getDeepModeManager();
    const activeSessions = deepMode.getActiveSessions();

    if (activeSessions.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No active Deep Mode session.',
        replyTo: message.id,
      });
      return;
    }

    const phaseOrder: DeepPhase[] = ['investigate', 'report', 'plan', 'execute', 'verify'];
    const sessionBlocks: string[] = [];

    for (const sessionId of activeSessions) {
      const state = deepMode.getSessionState(sessionId);
      if (!state) continue;

      const currentPhase = state.currentPhase;
      const completedPhaseNames = phaseOrder.filter((p) => state.phaseResults[p] !== undefined);
      const currentIndex = currentPhase ? phaseOrder.indexOf(currentPhase) : phaseOrder.length;
      const pendingPhases = phaseOrder.slice(currentPhase ? currentIndex + 1 : phaseOrder.length);

      const headerLines = [
        `*Deep Mode — Phase Status*`,
        `Profile: ${state.profile}`,
        `Task: "${state.taskSummary}"`,
        ``,
        `Current phase: ${currentPhase ? `*${currentPhase}*` : 'complete'}`,
      ];

      const completedLines: string[] = [];
      if (completedPhaseNames.length > 0) {
        completedLines.push('', 'Completed phases:');
        for (const phaseName of completedPhaseNames) {
          const result = deepMode.getPhaseResult(sessionId, phaseName);
          const snippet = result ? result.output.slice(0, 200).replace(/\n+/g, ' ').trim() : '';
          const ellipsis = result && result.output.length > 200 ? '…' : '';
          completedLines.push(`• ${phaseName} ✓${snippet ? ` — "${snippet}${ellipsis}"` : ''}`);
        }
      }

      const pendingLines: string[] = [];
      if (pendingPhases.length > 0) {
        pendingLines.push('', 'Pending phases:');
        for (const p of pendingPhases) {
          pendingLines.push(`• ${p}`);
        }
      }

      const skippedNote: string[] = [];
      if (state.skippedItems.length > 0) {
        skippedNote.push('', `Skipped items: ${state.skippedItems.join(', ')}`);
      }

      sessionBlocks.push(
        [...headerLines, ...completedLines, ...pendingLines, ...skippedNote].join('\n'),
      );
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: sessionBlocks.join('\n\n---\n\n') || 'No Deep Mode session details available.',
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, sessionCount: activeSessions.length },
      'Deep Mode phase status shown via /phase',
    );
  }

  /**
   * Handle natural language model override requests in Deep Mode (OB-1412).
   *
   * Parses phrases like:
   *   - "use opus for task 1"      → override task 1 with 'powerful' tier
   *   - "use haiku for this"       → override current task (index 0) with 'fast' tier
   *   - "use balanced for task 3"  → override task 3 with 'balanced' tier
   *
   * Model name → tier mapping:
   *   opus               → powerful
   *   sonnet / claude    → balanced
   *   haiku              → fast
   *   powerful / balanced / fast   → pass-through tier names
   *
   * Responds with a confirmation message that echoes the override back to the user.
   * Responds with an error if no active Deep Mode session exists.
   */
  private async handleModelOverrideCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const deepMode = this.master.getDeepModeManager();
    const activeSessions = deepMode.getActiveSessions();

    if (activeSessions.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No active Deep Mode session — model override has no effect.',
        replyTo: message.id,
      });
      return;
    }

    const text = message.content.trim();

    // Extract model name from the message
    const modelMatch =
      /\b(?:use|switch\s+to|change\s+to)\s+(?:\w+[-\s]?)?(opus|sonnet|haiku|fast|balanced|powerful)\b/i.exec(
        text,
      );
    if (!modelMatch) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Could not parse model name. Try: "use opus for task 1" or "use haiku for this".',
        replyTo: message.id,
      });
      return;
    }

    const modelName = modelMatch[1]!.toLowerCase();

    // Map model name to ModelTier
    const MODEL_NAME_TO_TIER: Record<string, 'fast' | 'balanced' | 'powerful'> = {
      opus: 'powerful',
      sonnet: 'balanced',
      claude: 'balanced',
      haiku: 'fast',
      fast: 'fast',
      balanced: 'balanced',
      powerful: 'powerful',
    };
    const modelTier = MODEL_NAME_TO_TIER[modelName];
    if (!modelTier) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Unknown model "${modelName}". Supported: opus (powerful), sonnet (balanced), haiku (fast).`,
        replyTo: message.id,
      });
      return;
    }

    // Extract task index from "for task N" or "for this"
    const taskMatch = /\bfor\s+task\s*#?\s*(\d+)\b/i.exec(text);
    const isThis = /\bfor\s+this\b|\bthis\s+task\b/i.test(text) && !taskMatch;
    const taskIndex = taskMatch ? parseInt(taskMatch[1]!, 10) : 0; // 0 = current task sentinel

    // Apply the override to all active sessions (typically only one)
    for (const sessionId of activeSessions) {
      deepMode.setTaskModelOverride(sessionId, taskIndex, modelTier);
    }

    // Build a human-readable confirmation
    const tierLabel =
      modelTier === 'powerful'
        ? 'opus (powerful)'
        : modelTier === 'balanced'
          ? 'sonnet (balanced)'
          : 'haiku (fast)';
    const scopeLabel = taskMatch
      ? `task ${taskIndex}`
      : isThis
        ? 'the current task'
        : 'the current task';

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: `Model override set — ${scopeLabel} will use *${tierLabel}*.\n\nThis applies when the execute phase processes that task. Use /phase to see current Deep Mode status.`,
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, modelTier, taskIndex, sessionCount: activeSessions.length },
      'Deep Mode model override applied via chat (OB-1412)',
    );
  }

  /**
   * Format the last N worker spawns for the given channel.
   *   webchat   → HTML table
   *   console   → ASCII table
   *   all other → numbered list (WhatsApp, Telegram, Discord)
   */
  private formatAuditLog(spawns: ActivityRecord[], channel: string): string {
    if (spawns.length === 0) {
      return '*Worker Audit Log*\n\nNo worker spawns recorded yet.';
    }

    const formatDate = (iso: string): string => iso.slice(0, 16).replace('T', ' ');
    const formatDurationMs = (startIso: string, endIso: string | undefined): string => {
      if (!endIso) return 'running';
      const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
      return formatDuration(ms);
    };
    const formatCost = (costUsd: number | undefined): string =>
      costUsd !== undefined ? `$${costUsd.toFixed(3)}` : 'n/a';
    const shortId = (id: string): string => id.slice(-8);

    if (channel === 'webchat') {
      const rows = spawns
        .map(
          (s) =>
            `<tr><td>${escapeHtml(shortId(s.id))}</td>` +
            `<td>${escapeHtml(s.profile ?? '—')}</td>` +
            `<td>${escapeHtml(s.model ?? '—')}</td>` +
            `<td>${formatDurationMs(s.started_at, s.completed_at)}</td>` +
            `<td>${formatCost(s.cost_usd)}</td>` +
            `<td>${escapeHtml(s.status)}</td>` +
            `<td>${escapeHtml((s.task_summary ?? '').slice(0, 60))}</td></tr>`,
        )
        .join('');
      return (
        '<b>Worker Audit Log</b>' +
        '<table><tr><th>ID</th><th>Profile</th><th>Model</th><th>Duration</th>' +
        '<th>Cost</th><th>Status</th><th>Task</th></tr>' +
        rows +
        '</table>'
      );
    }

    if (channel === 'console') {
      const header = ' # | ID       | Profile    | Duration | Cost    | Status    | Task';
      const sep = '-'.repeat(header.length);
      const rows = spawns.map((s, i) => {
        const idx = String(i + 1).padStart(2);
        const id = shortId(s.id).padEnd(8);
        const profile = (s.profile ?? '—').padEnd(10).slice(0, 10);
        const dur = formatDurationMs(s.started_at, s.completed_at).padEnd(8);
        const cost = formatCost(s.cost_usd).padEnd(7);
        const status = (s.status ?? '—').padEnd(9).slice(0, 9);
        const task = (s.task_summary ?? '').slice(0, 40);
        return ` ${idx} | ${id} | ${profile} | ${dur} | ${cost} | ${status} | ${task}`;
      });
      return ['*Worker Audit Log*', header, sep, ...rows, sep].join('\n');
    }

    // Default: WhatsApp, Telegram, Discord — numbered list
    const rowLines = spawns.map((s, i) => {
      const idx = i + 1;
      const id = shortId(s.id);
      const profile = s.profile ?? '—';
      const model = s.model ?? '—';
      const dur = formatDurationMs(s.started_at, s.completed_at);
      const cost = formatCost(s.cost_usd);
      const status = s.status;
      const task = (s.task_summary ?? '').slice(0, 80);
      const date = formatDate(s.started_at);
      return `${idx}. [${id}] ${profile} (${model})\n   ${date} · ${dur} · ${cost} · ${status}\n   ${task}`;
    });
    return ['*Worker Audit Log*', '', ...rowLines].join('\n');
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

  /**
   * Handle the built-in "/apps" command — list running app instances with URLs.
   *
   * Shows each running app's URL and public URL (if tunnel is active).
   * Responds with "No apps running" when there are no active instances.
   */
  private async handleAppsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    if (!this.appServer) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'App server is not enabled.',
        replyTo: message.id,
      });
      return;
    }

    const apps = this.appServer.listApps();

    if (apps.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No apps running.',
        replyTo: message.id,
      });
      return;
    }

    const lines: string[] = ['*Running Apps*', ''];
    for (const app of apps) {
      const displayUrl = app.publicUrl ?? app.url;
      lines.push(`• ${app.id.slice(0, 8)} — ${displayUrl}`);
      if (app.publicUrl) {
        lines.push(`  Local: ${app.url}`);
      }
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info({ sender: message.sender, appCount: apps.length }, 'Apps listed via /apps');
  }

  /**
   * Handle the built-in "/scope" command — show workspace visibility rules and detected secrets.
   *
   * Output sections:
   *   Visibility Rules — include (if set) and exclude patterns
   *   Sensitive Files  — detected files with severity, or "No sensitive files detected"
   */
  private async handleScopeCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const lines: string[] = ['*Workspace Scope*', ''];

    // --- Visibility Rules ---
    lines.push('*Visibility Rules*');

    if (this.workspaceInclude.length > 0) {
      lines.push('Include (only these visible):');
      for (const pattern of this.workspaceInclude) {
        lines.push(`  • ${pattern}`);
      }
    } else {
      lines.push('Include: all files (no include filter set)');
    }

    lines.push('');

    // Combine session-detected excludes with user-configured excludes for display
    const allUserExcludes = [...this.sessionExcludePatterns, ...this.workspaceExclude];
    if (allUserExcludes.length > 0) {
      lines.push('Exclude (hidden from AI):');
      for (const pattern of allUserExcludes) {
        lines.push(`  • ${pattern}`);
      }
    } else {
      lines.push('Exclude: default patterns only');
    }

    lines.push('');

    // --- Sensitive Files ---
    lines.push('*Sensitive Files*');

    if (this.detectedSecrets.length === 0) {
      lines.push('No sensitive files detected.');
    } else {
      for (const secret of this.detectedSecrets) {
        const basename = secret.path.split('/').pop() ?? secret.path;
        const severityLabel =
          secret.severity === 'critical'
            ? '🔴 critical'
            : secret.severity === 'high'
              ? '🟠 high'
              : '🟡 medium';
        lines.push(`  • ${basename} — ${severityLabel} (pattern: ${secret.pattern})`);
      }
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, secretCount: this.detectedSecrets.length },
      'Scope info shown via /scope',
    );
  }

  /**
   * Handle the built-in "/skills" command — list available skills with descriptions and usage counts.
   *
   * Output sections:
   *   Built-in skills  — shipped with OpenBridge (code-review, test-runner, etc.)
   *   User-defined     — workspace-specific skills from .openbridge/skills/
   *
   * Each skill line shows: name, description, tool profile, and usage count (if > 0).
   */
  private async handleSkillsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    if (!this.skillManager) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Skills not available — skill manager not initialized.',
        replyTo: message.id,
      });
      return;
    }

    // Reload user-defined skills to pick up any new files dropped since startup
    await this.skillManager.load();

    const allSkills = this.skillManager.getAll();

    if (allSkills.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No skills available.',
        replyTo: message.id,
      });
      return;
    }

    // Fetch usage stats (persisted to .skill-stats.json)
    const statsArray = await this.skillManager.getSkillStats();
    const statsMap = new Map(statsArray.map((s) => [s.name, s]));

    const builtIn = allSkills.filter((s) => !s.isUserDefined);
    const userDefined = allSkills.filter((s) => s.isUserDefined);

    const lines: string[] = ['*Available Skills*', ''];

    const formatSkill = (skill: {
      name: string;
      description: string;
      toolProfile: string;
    }): string => {
      const stats = statsMap.get(skill.name);
      const usageSuffix = stats && stats.usageCount > 0 ? ` (used ${stats.usageCount}×)` : '';
      return `• *${skill.name}* [${skill.toolProfile}]${usageSuffix} — ${skill.description}`;
    };

    if (builtIn.length > 0) {
      lines.push('*Built-in*');
      for (const skill of builtIn) {
        lines.push(formatSkill(skill));
      }
    }

    if (userDefined.length > 0) {
      if (builtIn.length > 0) lines.push('');
      lines.push('*Workspace Skills*');
      for (const skill of userDefined) {
        lines.push(formatSkill(skill));
      }
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, skillCount: allSkills.length },
      'Skills listed via /skills',
    );
  }

  /**
   * Handle the built-in "/skill-packs" command — list available skill packs with descriptions.
   *
   * Shows built-in packs first, then user-defined overrides from
   * `.openbridge/skill-packs/`. Each entry shows the pack name, tool profile,
   * and description. User-defined packs are labelled with "(custom)".
   */
  private async handleSkillPacksCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    if (!this.workspacePath) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Skill packs not available — workspace path not configured.',
        replyTo: message.id,
      });
      return;
    }

    let packs: Awaited<ReturnType<typeof loadAllSkillPacks>>['packs'];
    let userDefinedCount: number;
    try {
      ({ packs, userDefinedCount } = await loadAllSkillPacks(this.workspacePath));
    } catch (err) {
      logger.warn({ err }, 'handleSkillPacksCommand: failed to load skill packs');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Failed to load skill packs.',
        replyTo: message.id,
      });
      return;
    }

    if (packs.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'No skill packs available.',
        replyTo: message.id,
      });
      return;
    }

    const builtIn = packs.filter((p) => !p.isUserDefined);
    const userDefined = packs.filter((p) => p.isUserDefined);

    const lines: string[] = ['*Available Skill Packs*', ''];

    if (builtIn.length > 0) {
      lines.push('*Built-in*');
      for (const pack of builtIn) {
        lines.push(`• *${pack.name}* [${pack.toolProfile}] — ${pack.description}`);
      }
    }

    if (userDefined.length > 0) {
      if (builtIn.length > 0) lines.push('');
      lines.push('*Workspace (custom)*');
      for (const pack of userDefined) {
        lines.push(`• *${pack.name}* [${pack.toolProfile}] — ${pack.description}`);
      }
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, total: packs.length, userDefinedCount },
      'Skill packs listed via /skill-packs',
    );
  }

  /**
   * Handle the built-in "/help" command — list all available commands.
   *
   * Displays all built-in commands with brief descriptions, grouped by category:
   *   General: status, stop, explore, history, /audit
   *   Deep Mode: /deep, /proceed, /focus N, /skip N, /phase
   */
  /**
   * Handle the built-in "/workers" command.
   * Lists all active workers (pending + running) with ID, status, profile, duration, and PID.
   * Also shows the count of orphaned workers.
   * Users can follow up with /kill <worker-id> to force-stop a stuck worker.
   */
  private async handleWorkersCommand(message: InboundMessage, connector: Connector): Promise<void> {
    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Workers command not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const registry = this.master.getWorkerRegistry();
    const allWorkers = registry.getAllWorkers();
    const activeWorkers = allWorkers.filter(
      (w) => w.status === 'pending' || w.status === 'running',
    );
    const orphaned = registry.getOrphanedWorkers();

    const lines: string[] = ['*Active Workers*'];

    if (activeWorkers.length === 0) {
      lines.push('No workers are currently active.');
    } else {
      lines.push(`${activeWorkers.length} active worker${activeWorkers.length !== 1 ? 's' : ''}:`);
      lines.push('');
      for (const w of activeWorkers) {
        const elapsed = formatDuration(Date.now() - new Date(w.startedAt).getTime());
        const profile = w.taskManifest.profile ?? 'unknown';
        // Show last 8 chars of ID for readability
        const shortId = w.id.length > 16 ? `…${w.id.slice(-12)}` : w.id;
        const pidStr = w.pid !== undefined ? ` PID:${w.pid}` : '';
        lines.push(` • ${shortId} | ${w.status} | ${profile} | ${elapsed}${pidStr}`);
      }
    }

    if (orphaned.length > 0) {
      lines.push('');
      lines.push(
        `⚠️ ${orphaned.length} orphaned worker${orphaned.length !== 1 ? 's' : ''} (pending/running with no recent progress)`,
      );
    }

    if (activeWorkers.length > 0) {
      lines.push('');
      lines.push('Use /kill <worker-id> to force-stop a stuck worker.');
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info(
      { sender: message.sender, activeCount: activeWorkers.length },
      '/workers command handled',
    );
  }

  /**
   * Handle the built-in "/kill <worker-id>" command.
   * Force-stops a worker by partial or full ID match.
   * Delegates to master.killWorker().
   */
  private async handleKillWorkerCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    if (!this.master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Kill command not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const trimmed = message.content.trim();
    // Extract the worker ID argument after "/kill "
    const partialId = trimmed.slice(5).trim();

    if (!partialId) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Usage: /kill <worker-id>. Use /workers to list active workers.',
        replyTo: message.id,
      });
      return;
    }

    const registry = this.master.getWorkerRegistry();
    const allWorkers = registry.getAllWorkers();

    // Match: exact ID, or ID ends with "-<partialId>", or ID contains <partialId>
    const matched = allWorkers.find(
      (w) => w.id === partialId || w.id.endsWith(`-${partialId}`) || w.id.includes(partialId),
    );

    let responseText: string;
    if (!matched) {
      responseText = `Worker '${partialId}' not found. Use /workers to list active workers.`;
    } else {
      const result = await this.master.killWorker(matched.id, message.sender);
      responseText = result.message;
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: responseText,
      replyTo: message.id,
    });

    logger.info({ sender: message.sender, partialId }, '/kill command handled');
  }

  /**
   * Handle the built-in "/stats" command — show exploration ROI summary.
   *
   * Queries the token_economics table for aggregate stats and formats a
   * human-readable message:
   *   "Explored with ~50K tokens, saved ~200K tokens across 15 retrievals (4x ROI)"
   *
   * Falls back gracefully when token_economics data is not yet available.
   */
  private async handleStatsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    if (!this.memory) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Stats not available — memory not initialized.',
        replyTo: message.id,
      });
      return;
    }

    let content: string;

    try {
      const stats = await this.memory.getTokenEconomicsStats();

      if (!stats || stats.chunksTracked === 0) {
        content =
          '*Exploration Stats*\n\nNo data yet — stats are collected as the workspace is explored and queried.';
      } else {
        const { totalDiscoveryTokens, totalReadTokens, totalRetrievals, chunksTracked } = stats;

        // Format large numbers as "~50K" or "~1.2M"
        const fmt = (n: number): string => {
          if (n >= 1_000_000) return `~${(n / 1_000_000).toFixed(1)}M`;
          if (n >= 1_000) return `~${Math.round(n / 1_000)}K`;
          return `${n}`;
        };

        const roi =
          totalDiscoveryTokens > 0 ? (totalReadTokens / totalDiscoveryTokens).toFixed(1) : null;

        const roiStr = roi !== null ? ` (${roi}x ROI)` : '';

        const lines = [
          '*Exploration Stats*',
          '',
          `Explored with ${fmt(totalDiscoveryTokens)} tokens, saved ${fmt(totalReadTokens)} tokens across ${totalRetrievals} retrieval${totalRetrievals !== 1 ? 's' : ''}${roiStr}`,
          `Chunks tracked: ${chunksTracked}`,
        ];

        content = lines.join('\n');
      }
    } catch (err) {
      logger.warn({ err }, 'handleStatsCommand: failed to fetch token economics');
      content = 'Stats unavailable — could not read token economics data.';
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content,
      replyTo: message.id,
    });

    logger.info({ sender: message.sender }, '/stats command handled');
  }

  private async handleDoctorCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const lines: string[] = ['*OpenBridge Health*', ''];

    let failCount = 0;
    let warnCount = 0;

    for (const check of CHECKS) {
      let result: CheckResult;
      try {
        result = check.run();
      } catch (err) {
        result = { pass: false, message: `check threw: ${(err as Error).message}` };
      }

      let icon: string;
      if (result.pass === true) {
        icon = '✓';
      } else if (result.pass === 'warn') {
        icon = '⚠';
        warnCount++;
      } else {
        icon = '✗';
        failCount++;
      }

      lines.push(`${icon} ${check.label.padEnd(14)} ${result.message}`);
      if (result.pass !== true && result.fixHint) {
        lines.push(`  → ${result.fixHint}`);
      }
    }

    lines.push('');
    if (failCount === 0 && warnCount === 0) {
      lines.push('All checks passed.');
    } else if (failCount === 0) {
      lines.push(`${warnCount} warning${warnCount !== 1 ? 's' : ''} (non-critical).`);
    } else {
      lines.push(`${failCount} failed, ${warnCount} warning${warnCount !== 1 ? 's' : ''}.`);
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info({ sender: message.sender }, '/doctor command handled');
  }

  private async handleHelpCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const lines: string[] = [
      '*OpenBridge Commands*',
      '',
      '*General*',
      '• status — show active workers, exploration progress, and daily cost',
      '• stop — stop all active workers',
      '• explore — re-explore the workspace',
      '• history — show recent conversation history',
      '• /audit — list recent worker spawns',
      '• /apps — list running app instances with URLs',
      '• /scope — show workspace visibility rules and detected sensitive files',
      '• /workers — list active workers with ID, status, profile, duration, and PID',
      '• /kill <worker-id> — force-stop a stuck worker by ID (partial match supported)',
      '• /stats — show exploration ROI: tokens spent vs tokens saved across all retrievals',
      '• /doctor — run health checks (Node.js, AI tools, config, SQLite, channels) and show summary',
      '• /skills — list available skills with descriptions and usage counts',
      '• /skill-packs — list available skill packs (built-in + workspace custom)',
      '',
      '*Tool Escalation*',
      '• /allow <tool|profile> — grant a pending tool escalation (scope: once by default)',
      '• /allow <tool|profile> --session — grant for the entire session',
      '• /allow <tool|profile> --permanent — grant permanently',
      '• /allow all — grant all pending escalations at once',
      '• /deny — reject a pending tool escalation',
      '• /deny all — reject all pending escalations at once',
      '• /whoami — show your role, channel, allowed actions, daily cost, and consent mode',
      '• /role <user_id> <role> — (owner/admin) set role for another user on this channel',
      '• /approve <code> — (owner/admin) approve a pairing request using the 6-digit code',
      '• /permissions — show your consent mode, session grants, and permanent grants',
      '',
      '*Batch Control*',
      '• /batch — show batch status: current item, progress, cost, elapsed time, failed items',
      '• /pause — pause active batch (in-progress workers finish, no new items started)',
      '• /continue — resume a paused batch from where it left off',
      '• /batch abort — cancel remaining batch items and show completion summary',
      '• /batch skip — skip the current failed item and continue with the next',
      '',
      '*Deep Mode*',
      '• /deep — start a deep analysis session (investigate → report → plan → execute → verify)',
      '• /proceed — advance to the next Deep Mode phase',
      '• /focus N — dig deeper into finding number N from the current plan',
      '• /skip N — skip item N from the current Deep Mode plan',
      '• /phase — show current Deep Mode phase and progress',
    ];

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info({ sender: message.sender }, 'Help command shown via /help');
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
