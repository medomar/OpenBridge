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
import type { MemoryManager } from '../memory/index.js';
import type { MessageQueue } from './queue.js';
import type { RiskLevel, DeepPhase, DocumentFileFormat } from '../types/agent.js';
import { PROFILE_RISK_MAP, BuiltInProfileNameSchema } from '../types/agent.js';
import type { SkillManager } from '../master/skill-manager.js';
import type { IntegrationHub } from '../integrations/hub.js';
import type { CredentialStore } from '../integrations/credential-store.js';
import type { ParsedSpawnMarker } from '../master/spawn-parser.js';
import { extractTaskSummaries } from '../master/spawn-parser.js';
import type { FileServer } from './file-server.js';
import { ProviderError } from '../providers/claude-code/provider-error.js';
import { OutputMarkerProcessor } from './output-marker-processor.js';
import { AgentRunner, estimateCost, DEFAULT_MAX_TURNS_TASK } from './agent-runner.js';
import { FastPathResponder } from './fast-path-responder.js';
import { createLogger } from './logger.js';
import { CommandHandlers } from './command-handlers.js';
import type { CommandHandlerDeps } from './command-handlers.js';

// Re-export types that were moved to command-handlers.ts for backward compatibility
export type {
  PendingConfirmation,
  PendingSpawnEntry,
  PendingEscalation,
} from './command-handlers.js';

const logger = createLogger('router');

// SEND/VOICE/SHARE/APP marker regexes and getMimeType moved to output-marker-processor.ts (OB-1284)

/** Pattern matching [CONTINUE:batch-{id}] internal batch continuation messages */
const CONTINUE_MARKER_RE = /^\[CONTINUE:batch-([^\]]+)\]$/;

// formatDuration, makeProgressBar, escapeHtml moved to command-handlers.ts (OB-1283)
// getMimeType moved to output-marker-processor.ts (OB-1284)

// PendingConfirmation, PendingSpawnEntry, PendingEscalation moved to command-handlers.ts (OB-1283)
// Re-exported above for backward compatibility.
import type {
  PendingConfirmation,
  PendingSpawnEntry,
  PendingEscalation,
} from './command-handlers.js';

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
  private integrationHub?: IntegrationHub;
  private credentialStore?: CredentialStore;
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
  /** Extracted command handlers — delegates to CommandHandlers class (OB-1283). */
  private readonly commandHandlers: CommandHandlers;
  /** Extracted output marker processor — delegates to OutputMarkerProcessor class (OB-1284). */
  private readonly outputMarkerProcessor: OutputMarkerProcessor;

  constructor(
    defaultProvider: string,
    private readonly routerConfig?: RouterConfig,
    auditLogger?: AuditLogger,
    metrics?: MetricsCollector,
  ) {
    this.defaultProviderName = defaultProvider;
    this.auditLogger = auditLogger;
    this.metrics = metrics;

    // Initialize output marker processor with deps that reference Router's mutable state
    this.outputMarkerProcessor = new OutputMarkerProcessor({
      getWorkspacePath: () => this.workspacePath,
      getEmailConfig: () => this.emailConfig,
      getFileServer: () => this.fileServer,
      getAppServer: () => this.appServer,
      getRelay: () => this.relay,
      getConnectors: () => this.connectors,
      getAuth: () => this.auth,
    });

    // Initialize command handlers with deps that reference Router's mutable state
    const deps: CommandHandlerDeps = {
      getMaster: () => this.master,
      getMemory: () => this.memory,
      getQueue: () => this.queue,
      getAuth: () => this.auth,
      getAppServer: () => this.appServer,
      getSkillManager: () => this.skillManager,
      getWorkspacePath: () => this.workspacePath,
      getIntegrationHub: () => this.integrationHub,
      getCredentialStore: () => this.credentialStore,
      getConnectors: () => this.connectors,
      getProviders: () => this.providers,
      getPendingStopConfirmations: () => this.pendingStopConfirmations,
      getSessionGrantedTools: () => this.sessionGrantedTools,
      getDetectedSecrets: () => this.detectedSecrets,
      getSessionExcludePatterns: () => this.sessionExcludePatterns,
      getWorkspaceInclude: () => this.workspaceInclude,
      getWorkspaceExclude: () => this.workspaceExclude,
      takePendingSpawnConfirmation: (sender) => this.takePendingSpawnConfirmation(sender),
      takePendingEscalation: (sender) => this.takePendingEscalation(sender),
      takeAllPendingEscalations: (sender) => this.takeAllPendingEscalations(sender),
      pendingEscalationCount: (sender) => this.pendingEscalationCount(sender),
      route: (msg) => this.route(msg),
    };
    this.commandHandlers = new CommandHandlers(deps);
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

  /** Set the IntegrationHub — exposes connected integrations to command handlers */
  setIntegrationHub(hub: IntegrationHub): void {
    this.integrationHub = hub;
    logger.info('Router configured with IntegrationHub');
  }

  /** Set the CredentialStore — used by /connect to encrypt and persist integration credentials */
  setCredentialStore(store: CredentialStore): void {
    this.credentialStore = store;
    logger.info('Router configured with CredentialStore');
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

    // Clear any superseded pending confirmation for this sender before creating a new one.
    const existingConfirmation = this.pendingSpawnConfirmations.get(sender);
    if (existingConfirmation) {
      clearTimeout(existingConfirmation.timeoutHandle);
      logger.debug(
        {
          sender,
          profile: existingConfirmation.profile,
          riskLevel: existingConfirmation.riskLevel,
        },
        'Cleared superseded spawn confirmation timer — new request overwrites pending one',
      );
    }

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
   * Registers an auto-deny timeout (default 300s, configurable via `router.escalationTimeoutMs`) —
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

    // Check consent mode — auto-approve escalations based on user trust level (OB-1601).
    if (this.memory) {
      const consentMode = await this.memory.getConsentMode(sender, message.source);

      // auto-approve-all: skip all escalation prompts — user trusts the system fully.
      if (consentMode === 'auto-approve-all') {
        logger.info(
          { sender, workerId, requestedTools },
          'Auto-approving tool escalation — auto-approve-all mode',
        );
        await connector.sendMessage({
          target: message.source,
          recipient: sender,
          content: `✅ Auto-approved: *${toolsList}* for worker ${workerId}`,
        });
        if (respawn) {
          await respawn(requestedTools);
        }
        return;
      }

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
    const baseTimeoutMs = this.routerConfig?.escalationTimeoutMs ?? 300_000;
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

    // Handle built-in "/trust" command — change consent mode (auto/edit/ask)
    if (/^\/trust(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleTrustCommand(message, connector);
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

    // Handle built-in "/doctypes" command — list all DocTypes (OB-1386)
    if (/^\/doctypes$/i.test(message.content.trim())) {
      await this.handleDoctypesCommand(message, connector);
      return;
    }

    // Handle built-in "/doctype <name>" command — show DocType details (OB-1386)
    if (/^\/doctype\b/i.test(message.content.trim())) {
      await this.handleDoctypeCommand(message, connector);
      return;
    }

    // Handle built-in "/dt <doctype> <sub>" command — DocType record CRUD (OB-1386)
    if (/^\/dt\b/i.test(message.content.trim())) {
      await this.handleDtCommand(message, connector);
      return;
    }

    // Handle built-in "/connect <integration> [<credential>]" command — credential collection (OB-1397)
    if (/^\/connect(\s.*)?$/i.test(message.content.trim())) {
      await this.handleConnectCommand(message, connector);
      return;
    }

    // Handle built-in "/integrations" command — list all registered integrations (OB-1398)
    if (/^\/integrations\b/i.test(message.content.trim())) {
      await this.handleIntegrationsCommand(message, connector);
      return;
    }

    // Handle built-in "/process <file>" command — extract document entities (OB-1349)
    if (/^\/process(\s+.*)?$/i.test(message.content.trim())) {
      await this.handleProcessCommand(message, connector);
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
    let sessionCheckpointed = false;
    if (isUrgentCycle) {
      this.urgentCycleMessageIds.delete(message.id);
      if (this.master) {
        await this.master.checkpointSession();
        sessionCheckpointed = true;
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
    } finally {
      // Resume from checkpoint after urgent message handling (success or failure) — restores
      // the pre-interruption Master context so subsequent messages continue with correct state.
      if (sessionCheckpointed && this.master) {
        try {
          await this.master.resumeSession();
        } catch (resumeErr) {
          logger.error({ err: resumeErr }, 'Failed to resume session after urgent cycle');
        }
      }
    }

    this.metrics?.recordProcessed(Date.now() - startTime);

    // Parse and dispatch output markers (SHARE, APP, SEND, VOICE) before sending main reply
    const cleanedContent = await this.outputMarkerProcessor.processAll(
      result.content,
      connector,
      message.sender,
      message.id,
    );

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

  // processSendMarkers moved to output-marker-processor.ts (OB-1284)

  // processShareMarkers moved to output-marker-processor.ts (OB-1284)

  // processVoiceMarkers moved to output-marker-processor.ts (OB-1284)

  // handleEmailShare moved to output-marker-processor.ts (OB-1284)

  // handleGitHubPagesShare moved to output-marker-processor.ts (OB-1284)

  // processAppMarkers moved to output-marker-processor.ts (OB-1284)

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

  // ---------------------------------------------------------------------------
  // Command handlers — delegated to CommandHandlers (OB-1283, OB-F159)
  // ---------------------------------------------------------------------------

  private async handleStatusCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleStatusCommand(message, connector);
  }

  private async handleConfirmCommand(
    message: InboundMessage,
    connector: Connector,
    pending: PendingConfirmation,
  ): Promise<void> {
    return this.commandHandlers.handleConfirmCommand(message, connector, pending);
  }

  private async handleConfirmSpawnCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handleConfirmSpawnCommand(message, connector);
  }

  private async handleSkipSpawnCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handleSkipSpawnCommand(message, connector);
  }

  private async handleAllowCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleAllowCommand(message, connector);
  }

  private async handleAllowAllCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handleAllowAllCommand(message, connector);
  }

  private async handleDenyCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleDenyCommand(message, connector);
  }

  private async handleDenyAllCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleDenyAllCommand(message, connector);
  }

  private async handlePermissionsCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handlePermissionsCommand(message, connector);
  }

  private async handleTrustCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleTrustCommand(message, connector);
  }

  private async handleWhoamiCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleWhoamiCommand(message, connector);
  }

  private async handleRoleCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleRoleCommand(message, connector);
  }

  private async handleApproveCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleApproveCommand(message, connector);
  }

  private async handleStopCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleStopCommand(message, connector);
  }

  private async handleExploreCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleExploreCommand(message, connector);
  }

  private async handleExploreStatusSubcommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handleExploreStatusSubcommand(message, connector);
  }

  private async handleAuditCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleAuditCommand(message, connector);
  }

  private async handleDeepCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleDeepCommand(message, connector);
  }

  private async handleProceedCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleProceedCommand(message, connector);
  }

  private async handleFocusCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleFocusCommand(message, connector);
  }

  private async handleSkipItemCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handleSkipItemCommand(message, connector);
  }

  private async handlePhaseCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handlePhaseCommand(message, connector);
  }

  private async handleModelOverrideCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handleModelOverrideCommand(message, connector);
  }

  private async handleHistoryCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleHistoryCommand(message, connector);
  }

  private async handleAppsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleAppsCommand(message, connector);
  }

  private async handleScopeCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleScopeCommand(message, connector);
  }

  private async handleSkillsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleSkillsCommand(message, connector);
  }

  private async handleSkillPacksCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handleSkillPacksCommand(message, connector);
  }

  private async handleWorkersCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleWorkersCommand(message, connector);
  }

  private async handleKillWorkerCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handleKillWorkerCommand(message, connector);
  }

  private async handleStatsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleStatsCommand(message, connector);
  }

  private async handleDoctorCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleDoctorCommand(message, connector);
  }

  private async handleProcessCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleProcessCommand(message, connector);
  }

  private async handleConnectCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleConnectCommand(message, connector);
  }

  private async handleIntegrationsCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handleIntegrationsCommand(message, connector);
  }

  private async handleDoctypesCommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    return this.commandHandlers.handleDoctypesCommand(message, connector);
  }

  private async handleDoctypeCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleDoctypeCommand(message, connector);
  }

  private async handleDtCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleDtCommand(message, connector);
  }

  private async handleHelpCommand(message: InboundMessage, connector: Connector): Promise<void> {
    return this.commandHandlers.handleHelpCommand(message, connector);
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
