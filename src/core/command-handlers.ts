/** CommandHandlers — extracted from Router (OB-1283, OB-F159). */

import type { AIProvider } from '../types/provider.js';
import type { InboundMessage } from '../types/message.js';
import type { Connector } from '../types/connector.js';
import type { AppServer } from './app-server.js';
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
import type { MasterManager } from '../master/master-manager.js';
import type { AuthService } from './auth.js';
import type { RiskLevel, ExecutionProfile, DeepPhase } from '../types/agent.js';
import { BuiltInProfileNameSchema } from '../types/agent.js';
import type { SkillManager } from '../master/skill-manager.js';
import type { ParsedSpawnMarker } from '../master/spawn-parser.js';
import type { IntegrationHub } from '../integrations/hub.js';
import type { CredentialStore } from '../integrations/credential-store.js';
import { CHECKS } from '../cli/doctor.js';
import type { CheckResult } from '../cli/doctor.js';
import { loadAllSkillPacks } from '../master/skill-pack-loader.js';
import type { ProcessedDocument, ExtractedEntity } from '../types/intelligence.js';
import type { FullDocType } from '../intelligence/doctype-store.js';
import { createLogger } from './logger.js';

const logger = createLogger('command-handlers');

// ---------------------------------------------------------------------------
// Module-level utility functions (exported for testing)
// ---------------------------------------------------------------------------

/** Format a millisecond duration as a human-readable string (e.g. "2h 14m", "45s"). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/** Render a simple Unicode progress bar of the given width (default 5 blocks). */
export function makeProgressBar(pct: number, width = 5): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Escape special HTML characters for safe WebChat output. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Pending confirmation / escalation types (re-exported from router.ts)
// ---------------------------------------------------------------------------

/** Pending stop-all confirmation entry, keyed by sender ID. */
export interface PendingConfirmation {
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

// ---------------------------------------------------------------------------
// Dependencies interface — callbacks + shared references from Router
// ---------------------------------------------------------------------------

export interface CommandHandlerDeps {
  // Mutable references via getters
  getMaster: () => MasterManager | undefined;
  getMemory: () => MemoryManager | undefined;
  getQueue: () => MessageQueue | undefined;
  getAuth: () => AuthService | undefined;
  getAppServer: () => AppServer | undefined;
  getSkillManager: () => SkillManager | undefined;
  getWorkspacePath: () => string | undefined;
  getIntegrationHub: () => IntegrationHub | undefined;
  getCredentialStore: () => CredentialStore | undefined;
  getConnectors: () => Map<string, Connector>;
  getProviders: () => Map<string, AIProvider>;

  // Pending confirmations/escalations
  getPendingStopConfirmations: () => Map<string, PendingConfirmation>;
  getSessionGrantedTools: () => Map<string, Set<string>>;

  // Scope/visibility state
  getDetectedSecrets: () => readonly SecretMatch[];
  getSessionExcludePatterns: () => readonly string[];
  getWorkspaceInclude: () => readonly string[];
  getWorkspaceExclude: () => readonly string[];

  // Delegated actions
  takePendingSpawnConfirmation: (sender: string) => PendingSpawnEntry | undefined;
  takePendingEscalation: (sender: string) => PendingEscalation | undefined;
  takeAllPendingEscalations: (sender: string) => PendingEscalation[];
  pendingEscalationCount: (sender: string) => number;
  route: (message: InboundMessage) => Promise<void>;
}

// ---------------------------------------------------------------------------
// CommandHandlers class
// ---------------------------------------------------------------------------

export class CommandHandlers {
  private deps: CommandHandlerDeps;

  constructor(deps: CommandHandlerDeps) {
    this.deps = deps;
  }

  /** Update mutable dependency references (e.g. after memory init). */
  updateDeps(partial: Partial<CommandHandlerDeps>): void {
    this.deps = { ...this.deps, ...partial };
  }

  // -------------------------------------------------------------------------
  // handleStatusCommand
  // -------------------------------------------------------------------------

  async handleStatusCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const memory = this.deps.getMemory();
    const lines: string[] = ['*OpenBridge Status*'];

    if (!memory) {
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
        memory.getActiveAgents(),
        memory.getExplorationProgress(),
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
    const queue = this.deps.getQueue();
    if (queue) {
      const queueSnapshot = queue.getQueueSnapshot();
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
      dailyCost = await memory.getDailyCost();
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

  // -------------------------------------------------------------------------
  // handleConfirmCommand
  // -------------------------------------------------------------------------

  /**
   * Handle a "confirm" message that follows a pending "stop all" request.
   * Executes killAllWorkers() if the confirmation arrived within the 30-second window;
   * otherwise reports that it has expired.
   */
  async handleConfirmCommand(
    message: InboundMessage,
    connector: Connector,
    pending: PendingConfirmation,
  ): Promise<void> {
    // Always remove the pending entry — one shot regardless of outcome
    this.deps.getPendingStopConfirmations().delete(message.sender);

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

    const master = this.deps.getMaster();
    if (!master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Stop command not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const result = await master.killAllWorkers(message.sender);
    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: result.message,
      replyTo: message.id,
    });
    logger.info({ sender: message.sender }, 'Stop all confirmed and executed');
  }

  // -------------------------------------------------------------------------
  // handleConfirmSpawnCommand
  // -------------------------------------------------------------------------

  /**
   * Handle "go" / "/confirm" — approve a pending high-risk spawn confirmation.
   *
   * Retrieves and removes the pending spawn entry for the sender. If found,
   * re-routes the original message so the Master AI dispatches the workers.
   * If no confirmation is pending, responds with "No pending confirmation."
   */
  async handleConfirmSpawnCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const entry = this.deps.takePendingSpawnConfirmation(message.sender);
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
    await this.deps.route(entry.message);
  }

  // -------------------------------------------------------------------------
  // handleSkipSpawnCommand
  // -------------------------------------------------------------------------

  /**
   * Handle "skip" / "/skip" — cancel a pending high-risk spawn confirmation.
   *
   * Retrieves and removes the pending spawn entry for the sender. If found,
   * notifies the user that the spawn has been cancelled. If no confirmation
   * is pending, responds with "No pending confirmation."
   */
  async handleSkipSpawnCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const entry = this.deps.takePendingSpawnConfirmation(message.sender);
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

  // -------------------------------------------------------------------------
  // handleAllowCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/allow" command — grant a pending tool escalation (OB-1586).
   *
   * Syntax:
   *   /allow <tool>               -> grant single tool, scope: once (default)
   *   /allow <profile>            -> upgrade to named profile, scope: once
   *   /allow <tool> --session     -> grant for the entire session
   *   /allow <tool> --permanent   -> grant permanently (stored in DB)
   *
   * Clears the pending escalation for the sender, sends a confirmation, and
   * stores the grant in the appropriate backing store (session Map or DB) per scope (OB-1588).
   */
  async handleAllowCommand(message: InboundMessage, connector: Connector): Promise<void> {
    // Parse: /allow all — grant all pending escalations at once (OB-1632)
    const trimmed = message.content.trim();
    const rest = trimmed.slice('/allow'.length).trim();

    if (/^all$/i.test(rest)) {
      await this.handleAllowAllCommand(message, connector);
      return;
    }

    const entry = this.deps.takePendingEscalation(message.sender);
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

    const remaining = this.deps.pendingEscalationCount(message.sender);
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
    const sessionGrantedTools = this.deps.getSessionGrantedTools();
    const memory = this.deps.getMemory();
    if (scope === 'session') {
      const existing = sessionGrantedTools.get(message.sender) ?? new Set<string>();
      existing.add(grantArg);
      sessionGrantedTools.set(message.sender, existing);
      logger.debug({ sender: message.sender, grantArg }, 'Session tool grant stored');
    } else if (scope === 'permanent' && memory) {
      try {
        const accessEntry = await memory.getAccess(message.sender, message.source);
        const existingActions = accessEntry?.allowed_actions ?? [];
        if (!existingActions.includes(grantArg)) {
          await memory.setAccess({
            ...(accessEntry ?? {}),
            user_id: message.sender,
            channel: message.source,
            role: accessEntry?.role ?? 'custom',
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

  // -------------------------------------------------------------------------
  // handleAllowAllCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the "/allow all" command — grant all pending tool escalations for the sender
   * at once (OB-1632).
   *
   * Drains the escalation queue, grants each worker's originally-requested tools, and
   * triggers their respawn callbacks sequentially.  Scope is always "once" — no
   * --session / --permanent modifiers are supported for bulk grants.
   */
  async handleAllowAllCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const entries = this.deps.takeAllPendingEscalations(message.sender);
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

  // -------------------------------------------------------------------------
  // handleDenyCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/deny" command — reject a pending tool escalation (OB-1587).
   *
   * Removes the pending escalation for the sender and notifies the user.
   * The Master AI is notified to continue the worker without the requested tools
   * or abort the worker if the task cannot proceed without them.
   */
  async handleDenyCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const entry = this.deps.takePendingEscalation(message.sender);
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

  // -------------------------------------------------------------------------
  // handleDenyAllCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the "/deny all" command — deny all pending tool escalations for the sender
   * at once (OB-1634).
   *
   * Drains the escalation queue and marks all queued workers as denied.
   */
  async handleDenyAllCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const entries = this.deps.takeAllPendingEscalations(message.sender);
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

  // -------------------------------------------------------------------------
  // handlePermissionsCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/permissions" command — show the current user's tool grants and consent
   * mode (OB-1589).
   *
   * Output:
   *   - Consent mode (always-ask / auto-approve-read / auto-approve-all)
   *   - Session grants (from in-memory sessionGrantedTools Map)
   *   - Permanent grants (from access_control DB via allowed_actions)
   */
  async handlePermissionsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const memory = this.deps.getMemory();
    const sessionGrantedTools = this.deps.getSessionGrantedTools();
    const lines: string[] = ['*Your Permissions*', ''];

    // Consent mode
    let consentMode: string = 'always-ask';
    if (memory) {
      try {
        consentMode = await memory.getConsentMode(message.sender, message.source);
      } catch {
        consentMode = 'always-ask';
      }
    }
    lines.push(`*Consent mode:* ${consentMode}`);
    lines.push('');

    // Session grants (in-memory, cleared on restart)
    const sessionGrants = sessionGrantedTools.get(message.sender);
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
    if (memory) {
      try {
        const entry = await memory.getAccess(message.sender, message.source);
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

  // -------------------------------------------------------------------------
  // handleTrustCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/trust" command — change the user's consent mode.
   *
   * Usage:
   *   /trust          — show current trust level
   *   /trust auto     — auto-approve all escalations (no prompts)
   *   /trust edit     — auto-approve up to code-edit (prompt for full-access)
   *   /trust ask      — always ask (default, safest)
   *
   * Inspired by OpenClaw's "identity first" security model: establish trust
   * level once at the identity layer, then let operations flow without
   * per-action confirmation friction.
   */
  async handleTrustCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const memory = this.deps.getMemory();
    const sender = message.sender;
    const channel = message.source;

    const arg = message.content
      .trim()
      .replace(/^\/trust\s*/i, '')
      .trim()
      .toLowerCase();

    // Map shorthand aliases to ConsentMode values
    const TRUST_ALIASES: Record<
      string,
      'always-ask' | 'auto-approve-up-to-edit' | 'auto-approve-all'
    > = {
      auto: 'auto-approve-all',
      all: 'auto-approve-all',
      edit: 'auto-approve-up-to-edit',
      'code-edit': 'auto-approve-up-to-edit',
      ask: 'always-ask',
      default: 'always-ask',
      off: 'always-ask',
      // Full names also accepted
      'auto-approve-all': 'auto-approve-all',
      'auto-approve-up-to-edit': 'auto-approve-up-to-edit',
      'always-ask': 'always-ask',
    };

    // No argument — show current trust level
    if (!arg) {
      let current = 'always-ask';
      if (memory) {
        try {
          current = await memory.getConsentMode(sender, channel);
        } catch {
          current = 'always-ask';
        }
      }
      const levelLabel =
        current === 'auto-approve-all'
          ? 'auto (approve everything)'
          : current === 'auto-approve-up-to-edit'
            ? 'edit (approve up to code-edit)'
            : 'ask (always ask)';

      await connector.sendMessage({
        target: channel,
        recipient: sender,
        content:
          `*Trust level:* ${levelLabel}\n\n` +
          'Change with:\n' +
          '• `/trust auto` — approve all escalations automatically\n' +
          '• `/trust edit` — auto-approve up to code-edit, prompt for full-access\n' +
          '• `/trust ask` — always ask before granting tools (safest)',
        replyTo: message.id,
      });
      return;
    }

    const newMode = TRUST_ALIASES[arg];
    if (!newMode) {
      await connector.sendMessage({
        target: channel,
        recipient: sender,
        content: `Unknown trust level: *${arg}*\n\n` + 'Valid options: `auto`, `edit`, `ask`',
        replyTo: message.id,
      });
      return;
    }

    if (!memory) {
      await connector.sendMessage({
        target: channel,
        recipient: sender,
        content: 'Cannot update trust level — memory system not initialised.',
        replyTo: message.id,
      });
      return;
    }

    await memory.setConsentMode(sender, channel, newMode);

    const confirmLabel =
      newMode === 'auto-approve-all'
        ? 'auto — all escalations will be approved automatically'
        : newMode === 'auto-approve-up-to-edit'
          ? 'edit — code-edit and below auto-approved, full-access still prompts'
          : 'ask — you will be prompted for every escalation';

    await connector.sendMessage({
      target: channel,
      recipient: sender,
      content: `✅ Trust level set to *${confirmLabel}*`,
      replyTo: message.id,
    });

    logger.info({ sender, channel, newMode }, 'Trust level updated via /trust command');
  }

  // -------------------------------------------------------------------------
  // handleWhoamiCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/whoami" command.
   *
   * Shows the user their role, channel, allowed actions, daily cost usage, and consent mode.
   * Requires no elevated permissions — any user can see their own identity info (OB-1720).
   */
  async handleWhoamiCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const memory = this.deps.getMemory();
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

    if (memory) {
      try {
        const entry = await memory.getAccess(sender, message.source);
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
    } else if (memory) {
      try {
        const totalCost = await memory.getDailyCost();
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
    if (memory) {
      try {
        consentMode = await memory.getConsentMode(sender, message.source);
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

  // -------------------------------------------------------------------------
  // handleRoleCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/role <user_id> <role>" command.
   *
   * Syntax: /role <user_id> <role>
   * Valid roles: owner, admin, developer, viewer, custom
   *
   * Only owner or admin callers may use this command.
   * Sets the role for the target user on the same channel (OB-1721).
   */
  async handleRoleCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const memory = this.deps.getMemory();
    const VALID_ROLES = new Set(['owner', 'admin', 'developer', 'viewer', 'custom']);

    const send = (content: string): Promise<void> =>
      connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content,
        replyTo: message.id,
      });

    // Check caller has owner or admin role
    if (memory) {
      try {
        const callerEntry = await memory.getAccess(message.sender, message.source);
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

    if (!memory) {
      await send('Role management is unavailable: memory system not initialised.');
      return;
    }

    try {
      const existing = await memory.getAccess(targetUserId, message.source);
      if (existing) {
        await memory.setAccess({ ...existing, role: newRole as AccessRole });
      } else {
        await memory.setAccess({
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

  // -------------------------------------------------------------------------
  // handleApproveCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/approve <code>" command.
   *
   * Owner or admin users can approve a pending pairing request by submitting
   * the 6-digit code that the unknown sender received. On success the sender
   * is added to access_control with the viewer role and the pending pairing
   * entry is removed (OB-1698).
   */
  async handleApproveCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const memory = this.deps.getMemory();
    const auth = this.deps.getAuth();

    const send = (content: string): Promise<void> =>
      connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content,
        replyTo: message.id,
      });

    // Only owner or admin may approve pairing requests
    if (memory) {
      try {
        const callerEntry = await memory.getAccess(message.sender, message.source);
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

    if (!auth) {
      await send('Pairing approval unavailable: auth service not initialised.');
      return;
    }

    const pairing = auth.getPairing(code);
    if (!pairing) {
      await send(
        `No pending pairing found for code *${code}*. It may have already been used or expired.`,
      );
      return;
    }

    // Grant access — role is configurable via auth.channelRoles / auth.defaultRole
    if (!memory) {
      await send('Pairing approval unavailable: memory system not initialised.');
      return;
    }

    try {
      const role = (auth.getRoleForChannel(pairing.channel) as AccessRole) ?? 'viewer';
      await memory.approvePairing(pairing.senderId, pairing.channel, role);

      auth.removePairing(code);

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

  // -------------------------------------------------------------------------
  // handleStopCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "stop" command.
   *
   * Syntax:
   *   "stop"        -> request confirmation then kill all running workers
   *   "stop all"    -> request confirmation then kill all running workers
   *   "stop <id>"   -> kill the worker whose ID ends with <id> (partial match, no confirmation)
   *
   * Requires the Master AI to be configured. Returns a plain-text response
   * that works on all channels.
   */
  async handleStopCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const master = this.deps.getMaster();
    const auth = this.deps.getAuth();

    if (!master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Stop command not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    // Access control — only owner and admin may stop workers
    if (auth) {
      const accessResult = auth.checkAccessControl(message.sender, message.source, 'stop');
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
      const running = master.getWorkerRegistry().getRunningWorkers();
      if (running.length === 0) {
        responseText = 'No workers are currently running.';
      } else {
        this.deps.getPendingStopConfirmations().set(message.sender, {
          action: 'kill-all',
          expiresAt: Date.now() + 30_000,
        });
        responseText = `This will terminate ${running.length} running worker${running.length !== 1 ? 's' : ''}. Reply 'confirm' within 30 seconds to proceed.`;
      }
    } else {
      // "stop <partialId>" — find a worker whose ID ends with the partial ID
      const partialId = rest;
      const registry = master.getWorkerRegistry();
      const allWorkers = registry.getAllWorkers();

      // Match: exact ID, or ID ends with "-<partialId>", or ID contains <partialId>
      const matched = allWorkers.find(
        (w) => w.id === partialId || w.id.endsWith(`-${partialId}`) || w.id.includes(partialId),
      );

      if (!matched) {
        responseText = `Worker '${partialId}' not found. Use 'status' to list active workers.`;
      } else {
        const result = await master.killWorker(matched.id, message.sender);
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

  // -------------------------------------------------------------------------
  // handleExploreCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "explore" command.
   * Triggers workspace re-exploration from any channel.
   *
   * Syntax:
   *   "explore"        -> quick re-exploration via Master session prompt
   *   "explore full"   -> full 5-phase re-exploration with ExplorationCoordinator
   *   "explore status" -> show current exploration state and progress
   */
  async handleExploreCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const master = this.deps.getMaster();
    const auth = this.deps.getAuth();

    if (!master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Explore command not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    // Access control — exploration classifies as 'read' action
    if (auth) {
      const accessResult = auth.checkAccessControl(message.sender, message.source, 'explore');
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

    const currentState = master.getState();

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
        await master.fullReExplore();
      } else {
        await master.reExplore();
      }

      const summary = master.getExplorationSummary();
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

  // -------------------------------------------------------------------------
  // handleExploreStatusSubcommand
  // -------------------------------------------------------------------------

  /**
   * Handle the "explore status" subcommand.
   * Shows last exploration timestamp, project type, and any in-progress phases.
   */
  async handleExploreStatusSubcommand(
    message: InboundMessage,
    connector: Connector,
  ): Promise<void> {
    const master = this.deps.getMaster()!;
    const memory = this.deps.getMemory();
    const lines: string[] = ['*Exploration Status*'];

    const state = master.getState();
    lines.push(`Master state: ${state}`);

    const summary = master.getExplorationSummary();
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

    if (memory) {
      try {
        const progress = await memory.getExplorationProgress();
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

  // -------------------------------------------------------------------------
  // handleAuditCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/audit" command.
   * Shows the last 10 worker spawns with task ID, profile, duration, estimated cost, and result status.
   * Reads from the agent_activity table via MemoryManager.
   *
   * Syntax:
   *   "/audit"   -> list last 10 worker spawns
   */
  async handleAuditCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const memory = this.deps.getMemory();
    if (!memory) {
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
      spawns = await memory.getRecentWorkerSpawns(10);
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

  // -------------------------------------------------------------------------
  // handleDeepCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/deep" command — starts Deep Mode, toggles it, or shows status.
   *
   * Syntax:
   *   /deep            -> toggle (start thorough if inactive, show status if active)
   *   /deep thorough   -> start automatic multi-phase execution
   *   /deep manual     -> start with pause between phases for user review
   *   /deep off        -> deactivate Deep Mode, abort all active sessions
   */
  async handleDeepCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const trimmed = message.content.trim();
    const rest = trimmed.slice(5).trim().toLowerCase(); // Remove "/deep"
    const master = this.deps.getMaster();

    if (!master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const deepMode = master.getDeepModeManager();
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

  // -------------------------------------------------------------------------
  // handleProceedCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/proceed" command — advances to the next Deep Mode phase.
   *
   * Behaviour per profile:
   *   manual   -> if the session is paused, resume it so the next phase can run.
   *              if the session is not paused (phase still running), inform the user.
   *   thorough -> no-op; Deep Mode auto-advances through phases without user input.
   *
   * Responds with "No active Deep Mode session" when no session exists.
   */
  async handleProceedCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const master = this.deps.getMaster();
    if (!master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const deepMode = master.getDeepModeManager();
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

  // -------------------------------------------------------------------------
  // handleFocusCommand
  // -------------------------------------------------------------------------

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
  async handleFocusCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const master = this.deps.getMaster();
    if (!master) {
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

    const deepMode = master.getDeepModeManager();
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
      const response = await master.processMessage(focusMessage);
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

  // -------------------------------------------------------------------------
  // handleSkipItemCommand
  // -------------------------------------------------------------------------

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
  async handleSkipItemCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const master = this.deps.getMaster();
    if (!master) {
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

    const deepMode = master.getDeepModeManager();
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

  // -------------------------------------------------------------------------
  // handlePhaseCommand
  // -------------------------------------------------------------------------

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
  async handlePhaseCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const master = this.deps.getMaster();
    if (!master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const deepMode = master.getDeepModeManager();
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

  // -------------------------------------------------------------------------
  // handleModelOverrideCommand
  // -------------------------------------------------------------------------

  /**
   * Handle natural language model override requests in Deep Mode (OB-1412).
   *
   * Parses phrases like:
   *   - "use opus for task 1"      -> override task 1 with 'powerful' tier
   *   - "use haiku for this"       -> override current task (index 0) with 'fast' tier
   *   - "use balanced for task 3"  -> override task 3 with 'balanced' tier
   *
   * Model name -> tier mapping:
   *   opus               -> powerful
   *   sonnet / claude    -> balanced
   *   haiku              -> fast
   *   powerful / balanced / fast   -> pass-through tier names
   *
   * Responds with a confirmation message that echoes the override back to the user.
   * Responds with an error if no active Deep Mode session exists.
   */
  async handleModelOverrideCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const master = this.deps.getMaster();
    if (!master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Deep Mode not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const deepMode = master.getDeepModeManager();
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

  // -------------------------------------------------------------------------
  // handleHistoryCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "history" command.
   * Lists the last 10 conversation sessions with title, message count, and date.
   * Formats output per channel (WhatsApp/Telegram/Discord = numbered list, Console = table, WebChat = HTML).
   *
   * Syntax:
   *   "history"               -> list last 10 sessions
   *   "history search <q>"    -> search sessions by keyword (OB-1034)
   *   "history <session-id>"  -> show full transcript (OB-1035)
   */
  async handleHistoryCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const memory = this.deps.getMemory();
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

      if (!memory) {
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
        sessions = await memory.searchSessions(query, 10);
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
      if (!memory) {
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
        entries = await memory.getSessionHistory(sessionId, 50);
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
    if (!memory) {
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
      sessions = await memory.listSessions(10, 0);
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

  // -------------------------------------------------------------------------
  // handleAppsCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/apps" command — list running app instances with URLs.
   *
   * Shows each running app's URL and public URL (if tunnel is active).
   * Responds with "No apps running" when there are no active instances.
   */
  async handleAppsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const appServer = this.deps.getAppServer();
    if (!appServer) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'App server is not enabled.',
        replyTo: message.id,
      });
      return;
    }

    const apps = appServer.listApps();

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

  // -------------------------------------------------------------------------
  // handleScopeCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/scope" command — show workspace visibility rules and detected secrets.
   *
   * Output sections:
   *   Visibility Rules — include (if set) and exclude patterns
   *   Sensitive Files  — detected files with severity, or "No sensitive files detected"
   */
  async handleScopeCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const detectedSecrets = this.deps.getDetectedSecrets();
    const sessionExcludePatterns = this.deps.getSessionExcludePatterns();
    const workspaceInclude = this.deps.getWorkspaceInclude();
    const workspaceExclude = this.deps.getWorkspaceExclude();

    const lines: string[] = ['*Workspace Scope*', ''];

    // --- Visibility Rules ---
    lines.push('*Visibility Rules*');

    if (workspaceInclude.length > 0) {
      lines.push('Include (only these visible):');
      for (const pattern of workspaceInclude) {
        lines.push(`  • ${pattern}`);
      }
    } else {
      lines.push('Include: all files (no include filter set)');
    }

    lines.push('');

    // Combine session-detected excludes with user-configured excludes for display
    const allUserExcludes = [...sessionExcludePatterns, ...workspaceExclude];
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

    if (detectedSecrets.length === 0) {
      lines.push('No sensitive files detected.');
    } else {
      for (const secret of detectedSecrets) {
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
      { sender: message.sender, secretCount: detectedSecrets.length },
      'Scope info shown via /scope',
    );
  }

  // -------------------------------------------------------------------------
  // handleSkillsCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/skills" command — list available skills with descriptions and usage counts.
   *
   * Output sections:
   *   Built-in skills  — shipped with OpenBridge (code-review, test-runner, etc.)
   *   User-defined     — workspace-specific skills from .openbridge/skills/
   *
   * Each skill line shows: name, description, tool profile, and usage count (if > 0).
   */
  async handleSkillsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const skillManager = this.deps.getSkillManager();
    if (!skillManager) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Skills not available — skill manager not initialized.',
        replyTo: message.id,
      });
      return;
    }

    // Reload user-defined skills to pick up any new files dropped since startup
    await skillManager.load();

    const allSkills = skillManager.getAll();

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
    const statsArray = await skillManager.getSkillStats();
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

  // -------------------------------------------------------------------------
  // handleSkillPacksCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/skill-packs" command — list available skill packs with descriptions.
   *
   * Shows built-in packs first, then user-defined overrides from
   * `.openbridge/skill-packs/`. Each entry shows the pack name, tool profile,
   * and description. User-defined packs are labelled with "(custom)".
   */
  async handleSkillPacksCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const workspacePath = this.deps.getWorkspacePath();
    if (!workspacePath) {
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
      ({ packs, userDefinedCount } = await loadAllSkillPacks(workspacePath));
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

  // -------------------------------------------------------------------------
  // handleWorkersCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/workers" command.
   * Lists all active workers (pending + running) with ID, status, profile, duration, and PID.
   * Also shows the count of orphaned workers.
   * Users can follow up with /kill <worker-id> to force-stop a stuck worker.
   */
  async handleWorkersCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const master = this.deps.getMaster();
    if (!master) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Workers command not available — Master AI not initialized.',
        replyTo: message.id,
      });
      return;
    }

    const registry = master.getWorkerRegistry();
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

  // -------------------------------------------------------------------------
  // handleKillWorkerCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/kill <worker-id>" command.
   * Force-stops a worker by partial or full ID match.
   * Delegates to master.killWorker().
   */
  async handleKillWorkerCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const master = this.deps.getMaster();
    if (!master) {
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

    const registry = master.getWorkerRegistry();
    const allWorkers = registry.getAllWorkers();

    // Match: exact ID, or ID ends with "-<partialId>", or ID contains <partialId>
    const matched = allWorkers.find(
      (w) => w.id === partialId || w.id.endsWith(`-${partialId}`) || w.id.includes(partialId),
    );

    let responseText: string;
    if (!matched) {
      responseText = `Worker '${partialId}' not found. Use /workers to list active workers.`;
    } else {
      const result = await master.killWorker(matched.id, message.sender);
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

  // -------------------------------------------------------------------------
  // handleStatsCommand
  // -------------------------------------------------------------------------

  /**
   * Handle the built-in "/stats" command — show exploration ROI summary.
   *
   * Queries the token_economics table for aggregate stats and formats a
   * human-readable message:
   *   "Explored with ~50K tokens, saved ~200K tokens across 15 retrievals (4x ROI)"
   *
   * Falls back gracefully when token_economics data is not yet available.
   */
  async handleStatsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const memory = this.deps.getMemory();
    if (!memory) {
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
      const stats = await memory.getTokenEconomicsStats();

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

  // -------------------------------------------------------------------------
  // handleDoctorCommand
  // -------------------------------------------------------------------------

  async handleDoctorCommand(message: InboundMessage, connector: Connector): Promise<void> {
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

  // -------------------------------------------------------------------------
  // handleProcessCommand
  // -------------------------------------------------------------------------

  async handleProcessCommand(message: InboundMessage, connector: Connector): Promise<void> {
    // Parse file path from "/process <path>"
    const match = /^\/process\s+(.+)$/i.exec(message.content.trim());
    if (!match) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Usage: /process <file-path>\nExample: /process /path/to/invoice.pdf',
        replyTo: message.id,
      });
      return;
    }

    const filePath = (match[1] ?? '').trim();

    // Send processing acknowledgement
    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: `Processing document: ${filePath}...`,
      replyTo: message.id,
    });

    let doc: ProcessedDocument;
    try {
      const { processDocument } = await import('../intelligence/document-processor.js');
      doc = await processDocument(filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ filePath, err }, '/process command: document processing failed');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Failed to process document: ${msg}`,
        replyTo: message.id,
      });
      return;
    }

    // Run entity extraction to get docType + entities
    let docType = doc.docType;
    let entities: ExtractedEntity[] = [];
    try {
      const { extractEntities } = await import('../intelligence/entity-extractor.js');
      const extraction = await extractEntities(
        {
          rawText: doc.rawText,
          tables: doc.tables,
          images: doc.images,
          metadata: doc.metadata,
        },
        `File: ${doc.filename}`,
      );
      docType = extraction.docType;
      entities = extraction.entities;
    } catch (err) {
      logger.warn(
        { filePath, err },
        '/process command: entity extraction failed, using raw result',
      );
    }

    // Format user-friendly summary
    const lines: string[] = [`*Document: ${doc.filename}*`, ''];
    lines.push(`Type: ${docType}`);
    lines.push(`Format: ${doc.mimeType}`);

    if (doc.tables.length > 0) {
      lines.push(`Tables: ${doc.tables.length}`);
    }

    if (entities.length > 0) {
      // Group entities by type
      const byType = new Map<string, string[]>();
      for (const e of entities) {
        const group = byType.get(e.type) ?? [];
        group.push(e.name);
        byType.set(e.type, group);
      }

      lines.push('');
      lines.push('*Extracted Entities*');
      for (const [type, names] of byType) {
        const label = type.charAt(0).toUpperCase() + type.slice(1);
        lines.push(`• ${label}: ${names.join(', ')}`);
      }
    } else if (doc.rawText.trim().length > 0) {
      // No entities — show a short text excerpt
      const excerpt = doc.rawText.trim().slice(0, 200);
      lines.push('');
      lines.push('*Preview*');
      lines.push(excerpt + (doc.rawText.length > 200 ? '…' : ''));
    } else {
      lines.push('');
      lines.push('No text content extracted.');
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info({ sender: message.sender, filePath, docType }, '/process command handled');
  }

  // -------------------------------------------------------------------------
  // handleDoctypesCommand — /doctypes (list all registered DocTypes)
  // -------------------------------------------------------------------------

  async handleDoctypesCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const memory = this.deps.getMemory();
    const db = memory?.getDb();
    if (!db) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'DocType registry unavailable — memory system not initialized.',
        replyTo: message.id,
      });
      return;
    }

    let doctypes: Array<{ name: string; label_plural: string; icon?: string | null }> = [];
    try {
      const { listDocTypes } = await import('../intelligence/doctype-store.js');
      doctypes = listDocTypes(db);
    } catch (err) {
      logger.warn({ err }, '/doctypes command: failed to list doctypes');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Failed to load DocTypes — database may not be initialized.',
        replyTo: message.id,
      });
      return;
    }

    if (doctypes.length === 0) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content:
          '*DocTypes*\n\nNo DocTypes registered yet.\nAsk the AI to create one: "I need to track invoices"',
        replyTo: message.id,
      });
      return;
    }

    const lines: string[] = ['*Registered DocTypes*', ''];
    for (const dt of doctypes) {
      const icon = dt.icon ? `${dt.icon} ` : '';
      lines.push(`• ${icon}${dt.label_plural} (/doctype ${dt.name})`);
    }
    lines.push('');
    lines.push('Use /doctype <name> to see fields and states.');
    lines.push('Use /dt <name> list to browse records.');

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info({ sender: message.sender, count: doctypes.length }, '/doctypes command handled');
  }

  // -------------------------------------------------------------------------
  // handleDoctypeCommand — /doctype {name} (show DocType details)
  // -------------------------------------------------------------------------

  async handleDoctypeCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const match = /^\/doctype\s+(\S+)/i.exec(message.content.trim());
    if (!match) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Usage: /doctype <name>\nExample: /doctype invoice\n\nUse /doctypes to see all.',
        replyTo: message.id,
      });
      return;
    }

    const name = (match[1] ?? '').trim();
    const memory = this.deps.getMemory();
    const db = memory?.getDb();
    if (!db) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'DocType registry unavailable — memory system not initialized.',
        replyTo: message.id,
      });
      return;
    }

    let full: FullDocType | null = null;
    try {
      const { getDocTypeByName } = await import('../intelligence/doctype-store.js');
      full = getDocTypeByName(db, name);
    } catch (err) {
      logger.warn({ err, name }, '/doctype command: failed to load doctype');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Failed to load DocType "${name}".`,
        replyTo: message.id,
      });
      return;
    }

    if (!full) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `DocType "${name}" not found.\nUse /doctypes to see all registered DocTypes.`,
        replyTo: message.id,
      });
      return;
    }

    const dt = full.doctype;
    const icon = dt.icon ? `${dt.icon} ` : '';
    const lines: string[] = [`*${icon}${dt.label_singular}* (${dt.name})`, ''];

    // Fields
    if (full.fields.length > 0) {
      lines.push('*Fields*');
      for (const f of full.fields) {
        const req = f.required ? ' ✱' : '';
        const computed = f.formula ? ' (computed)' : '';
        lines.push(`• ${f.label} [${f.field_type}]${req}${computed}`);
      }
      lines.push('');
    }

    // States
    if (full.states.length > 0) {
      lines.push('*States*');
      const stateList = full.states.map((s) => s.label).join(' → ');
      lines.push(stateList);
      lines.push('');
    }

    // Transitions
    if (full.transitions.length > 0) {
      lines.push('*Actions*');
      for (const t of full.transitions) {
        lines.push(`• ${t.action_label} (${t.from_state} → ${t.to_state})`);
      }
      lines.push('');
    }

    lines.push(`Use /dt ${dt.name} list to browse records.`);
    lines.push(`Use /dt ${dt.name} create to add a new record.`);

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: lines.join('\n'),
      replyTo: message.id,
    });

    logger.info({ sender: message.sender, name }, '/doctype command handled');
  }

  // -------------------------------------------------------------------------
  // handleDtCommand — /dt {doctype} list|create|{id}
  // -------------------------------------------------------------------------

  async handleDtCommand(message: InboundMessage, connector: Connector): Promise<void> {
    // Parse: /dt <doctype> <subcommand-or-id>
    const match = /^\/dt\s+(\S+)(?:\s+(.+))?$/i.exec(message.content.trim());
    if (!match) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content:
          'Usage:\n' +
          '  /dt <doctype> list — list records\n' +
          '  /dt <doctype> create — start creation flow\n' +
          '  /dt <doctype> <id> — show record details\n' +
          '\nExample: /dt invoice list',
        replyTo: message.id,
      });
      return;
    }

    const doctypeName = (match[1] ?? '').trim();
    const sub = (match[2] ?? '').trim().toLowerCase();

    const memory = this.deps.getMemory();
    const db = memory?.getDb();
    if (!db) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'DocType registry unavailable — memory system not initialized.',
        replyTo: message.id,
      });
      return;
    }

    let full: FullDocType | null = null;
    try {
      const { getDocTypeByName } = await import('../intelligence/doctype-store.js');
      full = getDocTypeByName(db, doctypeName);
    } catch (err) {
      logger.warn({ err, doctypeName }, '/dt command: failed to load doctype');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Failed to load DocType "${doctypeName}".`,
        replyTo: message.id,
      });
      return;
    }

    if (!full) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `DocType "${doctypeName}" not found.\nUse /doctypes to see all registered DocTypes.`,
        replyTo: message.id,
      });
      return;
    }

    const dt = full.doctype;
    const tableName = `"${dt.table_name.replace(/"/g, '""')}"`;

    /** Safely convert an unknown SQLite column value to a display string. */
    const toStr = (v: unknown, fallback = ''): string => {
      if (v === null || v === undefined) return fallback;
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return JSON.stringify(v);
    };

    // ── /dt <doctype> list ──────────────────────────────────────────────────
    if (!sub || sub === 'list') {
      try {
        const rows = db
          .prepare(`SELECT * FROM ${tableName} ORDER BY created_at DESC LIMIT 20`)
          .all() as Record<string, unknown>[];

        if (rows.length === 0) {
          await connector.sendMessage({
            target: message.source,
            recipient: message.sender,
            content: `*${dt.label_plural}*\n\nNo records found.\nUse /dt ${dt.name} create to add one.`,
            replyTo: message.id,
          });
          return;
        }

        // Pick a display column: prefer 'name', 'title', 'subject', then first text field
        const textFields = full.fields.filter(
          (f) => f.field_type === 'text' || f.field_type === 'email' || f.field_type === 'link',
        );
        const displayField =
          textFields.find((f) => ['name', 'title', 'subject', 'label'].includes(f.name)) ??
          textFields[0];

        const lines: string[] = [`*${dt.label_plural}* (${rows.length} shown)`, ''];
        for (const row of rows) {
          const id = toStr(row['id']).slice(-8);
          const label = displayField
            ? toStr(row[displayField.name], '—').slice(0, 50)
            : `Record ${id}`;
          const status = 'status' in row ? ` [${toStr(row['status']).slice(0, 20)}]` : '';
          lines.push(`• ${label}${status} — /dt ${dt.name} ${toStr(row['id'])}`);
        }

        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: lines.join('\n'),
          replyTo: message.id,
        });
      } catch (err) {
        logger.warn({ err, doctypeName }, '/dt list: failed to query records');
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: `Failed to list ${dt.label_plural} — table may not be initialized yet.`,
          replyTo: message.id,
        });
      }

      logger.info({ sender: message.sender, doctypeName, sub: 'list' }, '/dt list handled');
      return;
    }

    // ── /dt <doctype> create ────────────────────────────────────────────────
    if (sub === 'create') {
      const requiredFields = full.fields.filter((f) => f.required && !f.formula);
      const optionalFields = full.fields.filter((f) => !f.required && !f.formula);

      const lines: string[] = [`*Create ${dt.label_singular}*`, ''];

      if (requiredFields.length > 0) {
        lines.push('*Required fields:*');
        for (const f of requiredFields) {
          const hint = f.options?.length
            ? ` (${f.options.slice(0, 4).join(' | ')})`
            : f.field_type !== 'text'
              ? ` [${f.field_type}]`
              : '';
          lines.push(`• ${f.label}${hint}`);
        }
      }

      if (optionalFields.length > 0) {
        lines.push('');
        lines.push('*Optional fields:*');
        for (const f of optionalFields.slice(0, 6)) {
          lines.push(`• ${f.label} [${f.field_type}]`);
        }
        if (optionalFields.length > 6) {
          lines.push(`  … and ${optionalFields.length - 6} more`);
        }
      }

      lines.push('');
      lines.push(`Tell the AI: "Create a ${dt.label_singular} with <field values>"`);

      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: lines.join('\n'),
        replyTo: message.id,
      });

      logger.info({ sender: message.sender, doctypeName, sub: 'create' }, '/dt create handled');
      return;
    }

    // ── /dt <doctype> {id} ──────────────────────────────────────────────────
    const recordId = (match[2] ?? '').trim();
    try {
      const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(recordId) as
        | Record<string, unknown>
        | undefined;

      if (!row) {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content: `Record "${recordId}" not found in ${dt.label_plural}.\nUse /dt ${dt.name} list to browse records.`,
          replyTo: message.id,
        });
        return;
      }

      const lines: string[] = [`*${dt.label_singular} — ${recordId.slice(-8)}*`, ''];
      for (const f of full.fields) {
        const val = row[f.name];
        if (val !== null && val !== undefined && val !== '') {
          lines.push(`${f.label}: ${toStr(val).slice(0, 100)}`);
        }
      }

      // Include any system columns not in field list
      for (const col of ['status', 'created_at', 'updated_at', 'created_by']) {
        if (col in row && !full.fields.some((f) => f.name === col)) {
          lines.push(`${col}: ${toStr(row[col]).slice(0, 60)}`);
        }
      }

      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: lines.join('\n'),
        replyTo: message.id,
      });
    } catch (err) {
      logger.warn({ err, doctypeName, recordId }, '/dt {id}: failed to fetch record');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Failed to fetch record — table may not be initialized yet.`,
        replyTo: message.id,
      });
    }

    logger.info({ sender: message.sender, doctypeName, sub: 'record' }, '/dt record handled');
  }

  // -------------------------------------------------------------------------
  // handleHelpCommand
  // -------------------------------------------------------------------------

  async handleHelpCommand(message: InboundMessage, connector: Connector): Promise<void> {
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
      '• /process <file> — process a document file (PDF, DOCX, XLSX, image, etc.) and extract key entities, amounts, and dates',
      '• /doctypes — list all registered DocTypes (business data schemas)',
      '• /doctype <name> — show DocType details: fields, states, and available actions',
      '• /dt <name> list — list records for a DocType (most recent 20)',
      '• /dt <name> create — show creation form with required and optional fields',
      '• /dt <name> <id> — show a specific record by ID',
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
      '• /trust [auto|edit|ask] — set trust level (auto = no prompts, edit = prompt for full-access only, ask = always prompt)',
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

  // -------------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------------

  /**
   * Format the last N worker spawns for the given channel.
   *   webchat   -> HTML table
   *   console   -> ASCII table
   *   all other -> numbered list (WhatsApp, Telegram, Discord)
   */
  formatAuditLog(spawns: ActivityRecord[], channel: string): string {
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
   * Format a session list for the given channel.
   *   webchat   -> HTML table
   *   console   -> ASCII table
   *   all other -> numbered list (WhatsApp, Telegram, Discord)
   */
  formatSessionList(sessions: SessionSummary[], channel: string): string {
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

  // -------------------------------------------------------------------------
  // handleConnectCommand — /connect <integration> [<credential>]
  // -------------------------------------------------------------------------

  async handleConnectCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const trimmed = message.content.trim();
    // Parse: /connect [<integration> [<credential>]]
    const match = /^\/connect(?:\s+(\S+)(?:\s+(.+))?)?$/i.exec(trimmed);

    const sendHelp = async (): Promise<void> => {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content:
          '*Connect an Integration*\n\n' +
          'Usage:\n' +
          '  /connect stripe <api-key>        — Stripe payments\n' +
          '  /connect google-drive <api-key>  — Google Drive storage\n' +
          '  /connect api <swagger-url>        — Any OpenAPI/REST service\n\n' +
          'To get started, send the command without a credential to see what is required:\n' +
          '  /connect stripe',
        replyTo: message.id,
      });
    };

    if (!match || !match[1]) {
      await sendHelp();
      return;
    }

    const integrationName = match[1].toLowerCase();
    const credential = match[2]?.trim() ?? '';

    // If no credential provided, show integration-specific instructions
    if (!credential) {
      const instructions: Record<string, string> = {
        stripe:
          '*Connect Stripe*\n\nProvide your Stripe secret API key:\n  /connect stripe <sk_live_...or sk_test_...>\n\nFind it at: https://dashboard.stripe.com/apikeys',
        'google-drive':
          '*Connect Google Drive*\n\nProvide your Google service account JSON key or OAuth2 token:\n  /connect google-drive <api-key-or-token>\n\nSee Google Cloud Console for credentials.',
        api: '*Connect OpenAPI Service*\n\nProvide the Swagger/OpenAPI spec URL:\n  /connect api <https://api.example.com/openapi.json>',
      };

      const msg =
        instructions[integrationName] ??
        `*Connect ${integrationName}*\n\nProvide your API key or credential:\n  /connect ${integrationName} <credential>`;

      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: msg,
        replyTo: message.id,
      });
      return;
    }

    // Credential provided — encrypt and store
    const workspacePath = this.deps.getWorkspacePath();
    const memory = this.deps.getMemory();
    const db = memory?.getDb();

    if (!workspacePath || !db) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content:
          'Integration credentials cannot be stored — workspace not initialized. Start the bridge first.',
        replyTo: message.id,
      });
      return;
    }

    // Use credential store from deps if available, otherwise create a temporary one
    let credStore = this.deps.getCredentialStore();
    if (!credStore) {
      const { CredentialStore: CS } = await import('../integrations/credential-store.js');
      credStore = new CS(workspacePath);
    }

    const credData: Record<string, unknown> =
      integrationName === 'api' ? { swaggerUrl: credential } : { apiKey: credential };

    try {
      credStore.storeCredential(db, integrationName, credData);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ integrationName, err }, '/connect: failed to store credential');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Failed to store credential for "${integrationName}": ${msg}`,
        replyTo: message.id,
      });
      return;
    }

    logger.info({ integrationName, sender: message.sender }, '/connect: credential stored');

    // Attempt to initialize via IntegrationHub if the integration is registered
    const hub = this.deps.getIntegrationHub();
    let connectionStatus = 'Credential stored and encrypted.';

    if (hub) {
      try {
        const config = {
          name: integrationName,
          credentialKey: integrationName,
          options: credData,
        };
        await hub.initialize(integrationName, config);
        connectionStatus = 'Connected and verified successfully.';
        logger.info({ integrationName }, '/connect: integration initialized via hub');
      } catch (err) {
        // Integration may not be registered yet (adapters ship in Phase 120)
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('not found')) {
          connectionStatus =
            'Credential stored and encrypted. (Adapter not yet installed — will activate when available.)';
        } else {
          connectionStatus = `Credential stored, but connection test failed: ${errMsg}`;
          logger.warn({ integrationName, err }, '/connect: hub initialization failed');
        }
      }
    }

    await connector.sendMessage({
      target: message.source,
      recipient: message.sender,
      content: `*${integrationName}* integration: ${connectionStatus}`,
      replyTo: message.id,
    });

    logger.info({ sender: message.sender, integrationName }, '/connect command handled');
  }

  // -------------------------------------------------------------------------
  // handleIntegrationsCommand — /integrations (list all registered integrations)
  // -------------------------------------------------------------------------

  async handleIntegrationsCommand(message: InboundMessage, connector: Connector): Promise<void> {
    const hub = this.deps.getIntegrationHub();

    if (!hub) {
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: 'Integration system not available.',
        replyTo: message.id,
      });
      return;
    }

    try {
      const integrations = hub.list();

      if (integrations.length === 0) {
        await connector.sendMessage({
          target: message.source,
          recipient: message.sender,
          content:
            'No integrations registered.\n\nUse `/connect <integration-name>` to connect a service.',
          replyTo: message.id,
        });
        return;
      }

      // Build formatted list of integrations
      const lines: string[] = ['*Connected Integrations*', ''];

      for (const integration of integrations) {
        const status = integration.connected ? '✅ Connected' : '❌ Disconnected';
        const healthEmoji =
          integration.healthStatus === 'healthy'
            ? '💚'
            : integration.healthStatus === 'degraded'
              ? '🟡'
              : integration.healthStatus === 'unhealthy'
                ? '❌'
                : '❓';
        const healthLabel = `${healthEmoji} ${integration.healthStatus}`;
        const capCount = integration.capabilityCount;
        const capLabel = capCount === 1 ? 'capability' : 'capabilities';

        lines.push(`• *${integration.name}* (${integration.type})`);
        lines.push(`  Status: ${status}`);
        lines.push(`  Health: ${healthLabel}`);
        lines.push(`  Capabilities: ${capCount} ${capLabel}`);
        lines.push('');
      }

      lines.push(`Use \`/connect <name>\` to connect a new integration.`);

      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: lines.join('\n'),
        replyTo: message.id,
      });

      logger.info(
        { sender: message.sender, count: integrations.length },
        '/integrations command handled',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, '/integrations: failed to list integrations');
      await connector.sendMessage({
        target: message.source,
        recipient: message.sender,
        content: `Failed to list integrations: ${msg}`,
        replyTo: message.id,
      });
    }
  }

  /**
   * Format a session transcript for the given channel.
   *   webchat   -> HTML message bubbles
   *   console   -> plain text with separator line
   *   all other -> plain text list (WhatsApp, Telegram, Discord)
   */
  formatSessionTranscript(entries: ConversationEntry[], channel: string): string {
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
}
