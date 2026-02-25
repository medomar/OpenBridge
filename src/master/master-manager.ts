import { DotFolderManager } from './dotfolder-manager.js';
import { ExplorationCoordinator } from './exploration-coordinator.js';
import { generateReExplorationPrompt } from './exploration-prompt.js';
import { generateIncrementalExplorationPrompt } from './exploration-prompts.js';
import { generateMasterSystemPrompt } from './master-system-prompt.js';
import { WorkspaceChangeTracker } from './workspace-change-tracker.js';
import type { WorkspaceChanges } from './workspace-change-tracker.js';
import { AgentRunner, TOOLS_READ_ONLY, DEFAULT_MAX_TURNS_TASK } from '../core/agent-runner.js';
import type { SpawnOptions, AgentResult } from '../core/agent-runner.js';
import { manifestToSpawnOptions } from '../core/agent-runner.js';
import { getRecommendedModel } from '../core/model-selector.js';
import type { Router } from '../core/router.js';
import type {
  MemoryManager,
  ConversationEntry,
  SessionRecord,
  WorkspaceState,
  TaskRecord as MemoryTaskRecord,
} from '../memory/index.js';
import { BUILT_IN_PROFILES } from '../types/agent.js';
import type { ToolProfile } from '../types/agent.js';
import { DelegationCoordinator } from './delegation.js';
import { parseSpawnMarkers, hasSpawnMarkers } from './spawn-parser.js';
import type { ParsedSpawnMarker } from './spawn-parser.js';
import { formatWorkerBatch } from './worker-result-formatter.js';
import { WorkerRegistry } from './worker-registry.js';
import { evolvePrompts } from './prompt-evolver.js';
import type {
  MasterState,
  ExplorationSummary,
  TaskRecord,
  AgentsRegistry,
  WorkspaceMap,
  MasterSession,
  PromptTemplate,
  ClassificationCacheEntry,
  ExplorationState,
  WorkspaceAnalysisMarker,
} from '../types/master.js';
import { WorkspaceMapSchema, ExplorationStateSchema } from '../types/master.js';
import type { DiscoveredTool } from '../types/discovery.js';
import type { InboundMessage, ProgressEvent } from '../types/message.js';
import { createLogger } from '../core/logger.js';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const logger = createLogger('master-manager');

const DEFAULT_TIMEOUT = 1_800_000; // 30 minutes for exploration
const DEFAULT_MESSAGE_TIMEOUT = 180_000; // 3 minutes for message processing

/** Idle time threshold (5 minutes) before triggering self-improvement cycle */
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
/** How often to check for idle state (1 minute) */
const IDLE_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

/**
 * Exit codes and stderr patterns that indicate a dead/unrecoverable Master session.
 * These warrant creating a new session rather than retrying the same one.
 */
const SESSION_DEAD_EXIT_CODES = new Set([
  143, // SIGTERM — timeout killed the process
  137, // SIGKILL — force-killed (OOM or external)
  1, // General error — may be context overflow or session corruption
]);

const SESSION_DEAD_PATTERNS = [
  'context window',
  'context length',
  'context_length',
  'too many tokens',
  'token limit',
  'maximum context',
  'session not found',
  'session expired',
  'invalid session',
  'conversation too long',
];

/** Maximum number of recent tasks to include in a context summary on restart */
const RESTART_CONTEXT_TASK_LIMIT = 10;

/**
 * Format an ISO timestamp as a human-readable "X ago" string.
 * Used to show the Master how fresh its workspace knowledge is.
 */
function formatTimeAgo(isoTimestamp: string): string {
  const ms = Date.now() - new Date(isoTimestamp).getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} day${days !== 1 ? 's' : ''} ago`;
  if (hours > 0) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (minutes > 0) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  return 'just now';
}

/**
 * Tools available to the Master AI session.
 * Resolved from the built-in 'master' profile: Read, Glob, Grep, Write, Edit.
 * Master can read, write, and edit files (for .openbridge/ management)
 * but NOT execute arbitrary commands — it delegates to workers for that.
 */
const MASTER_TOOLS = BUILT_IN_PROFILES.master.tools;

/**
 * Default max turns for the Master session per interaction.
 * Higher than workers because the Master needs room to reason + coordinate.
 */
const MASTER_MAX_TURNS = 50;

/**
 * Max turns for message processing — varies by task classification.
 * quick-answer: questions, lookups, explanations → 5 turns
 * tool-use: file generation, single edits, targeted fixes → 15 turns
 * complex-task (planning): forces Master to output SPAWN markers → 25 turns
 */
const MESSAGE_MAX_TURNS_QUICK = 5;
const MESSAGE_MAX_TURNS_TOOL_USE = 15;
const MESSAGE_MAX_TURNS_PLANNING = 25;
/** Synthesis call — feeds worker results back to Master for a final user-facing response. */
const MESSAGE_MAX_TURNS_SYNTHESIS = 5;

// ---------------------------------------------------------------------------
// Memory ↔ DotFolderManager type conversion helpers (OB-711)
// ---------------------------------------------------------------------------

/** Convert MasterSession → SessionRecord for SQLite storage */
function masterSessionToSessionRecord(session: MasterSession, restartCount = 0): SessionRecord {
  return {
    id: session.sessionId,
    type: 'master',
    status: 'active',
    restart_count: restartCount,
    message_count: session.messageCount,
    allowed_tools: JSON.stringify(session.allowedTools),
    created_at: session.createdAt,
    last_used_at: session.lastUsedAt,
  };
}

/** Convert SessionRecord → MasterSession */
function sessionRecordToMasterSession(record: SessionRecord): MasterSession {
  return {
    sessionId: record.id,
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at,
    messageCount: record.message_count ?? 0,
    allowedTools: record.allowed_tools
      ? (JSON.parse(record.allowed_tools) as string[])
      : [...MASTER_TOOLS],
    maxTurns: MASTER_MAX_TURNS,
  };
}

/** Convert WorkspaceAnalysisMarker → WorkspaceState for SQLite storage */
function markerToWorkspaceState(marker: WorkspaceAnalysisMarker): WorkspaceState {
  return {
    commit_hash: marker.workspaceCommitHash,
    branch: marker.workspaceBranch,
    has_git: marker.workspaceHasGit,
    analyzed_at: marker.analyzedAt,
    last_verified_at: marker.lastVerifiedAt,
    analysis_type: marker.analysisType,
    files_changed: marker.filesChanged,
  };
}

/** Convert WorkspaceState → WorkspaceAnalysisMarker */
function workspaceStateToMarker(state: WorkspaceState): WorkspaceAnalysisMarker {
  return {
    workspaceCommitHash: state.commit_hash,
    workspaceBranch: state.branch,
    workspaceHasGit: state.has_git ?? false,
    analyzedAt: state.analyzed_at,
    lastVerifiedAt: state.last_verified_at,
    analysisType: (state.analysis_type as 'full' | 'incremental') ?? 'full',
    filesChanged: state.files_changed ?? 0,
    schemaVersion: '1.0.0',
  };
}

/** Convert master TaskRecord (types/master.ts) → memory TaskRecord (memory/task-store.ts) */
function masterTaskToMemoryTask(
  task: TaskRecord,
  type: MemoryTaskRecord['type'] = 'worker',
): MemoryTaskRecord {
  const statusMap: Record<string, MemoryTaskRecord['status']> = {
    completed: 'completed',
    failed: 'failed',
    pending: 'running',
    processing: 'running',
    delegated: 'completed',
  };
  return {
    id: task.id,
    type,
    status: statusMap[task.status] ?? 'failed',
    prompt: task.userMessage,
    response: task.result,
    duration_ms: task.durationMs,
    created_at: task.createdAt,
    completed_at: task.completedAt,
  };
}

/**
 * Result returned by classifyTask() — includes class, suggested turn budget, and reasoning.
 * The maxTurns value is AI-suggested based on message content and workspace context,
 * replacing the fixed MESSAGE_MAX_TURNS_QUICK / MESSAGE_MAX_TURNS_TOOL_USE constants.
 */
export interface ClassificationResult {
  /** One of quick-answer, tool-use, or complex-task */
  class: 'quick-answer' | 'tool-use' | 'complex-task';
  /** AI-suggested turn budget for this specific message */
  maxTurns: number;
  /** Brief reason for the classification (for logging/debugging) */
  reason: string;
}

/**
 * Callback for emitting progress events — decouples MasterManager from Router.
 * Created per-message via makeProgressReporter(). No-op when no router is set.
 */
export type ProgressReporter = (event: ProgressEvent) => Promise<void>;

/**
 * Options for creating a MasterManager
 */
export interface MasterManagerOptions {
  /** Absolute path to the workspace */
  workspacePath: string;
  /** The Master AI tool discovered during tool scan */
  masterTool: DiscoveredTool;
  /** All discovered AI tools (for agents.json) */
  discoveredTools: DiscoveredTool[];
  /** Timeout for exploration in milliseconds */
  explorationTimeout?: number;
  /** Timeout for message processing in milliseconds */
  messageTimeout?: number;
  /** Whether to skip automatic exploration on startup */
  skipAutoExploration?: boolean;
  /** MemoryManager instance — when provided, enables SQLite-backed persistence (OB-711 will wire reads/writes) */
  memory?: MemoryManager;
}

/**
 * Manages the Master AI lifecycle and interaction.
 *
 * The Master AI runs as a persistent Claude session (not single-shot --print).
 * On startup, a session ID is created or loaded from .openbridge/master-session.json.
 * The session stays alive across user messages via --resume. This allows the
 * Master to accumulate context about the workspace and previous interactions.
 *
 * Lifecycle states:
 * - idle: Created but not yet started
 * - exploring: Autonomously exploring workspace
 * - ready: Exploration complete, ready for messages
 * - processing: Handling a user message
 * - delegating: Delegating task to another AI tool
 * - error: Encountered unrecoverable error
 * - shutdown: Shutting down
 */
export class MasterManager {
  private readonly workspacePath: string;
  private readonly masterTool: DiscoveredTool;
  private readonly discoveredTools: DiscoveredTool[];
  private readonly explorationTimeout: number;
  private readonly messageTimeout: number;
  private readonly skipAutoExploration: boolean;
  private readonly dotFolder: DotFolderManager;
  private readonly changeTracker: WorkspaceChangeTracker;
  private readonly delegationCoordinator: DelegationCoordinator;
  private readonly agentRunner: AgentRunner;
  private readonly workerRegistry: WorkerRegistry;
  readonly memory: MemoryManager | null;

  private state: MasterState = 'idle';
  private explorationSummary: ExplorationSummary | null = null;

  /** Messages queued while exploration is in progress — drained after exploration completes */
  private pendingMessages: InboundMessage[] = [];
  /** Router reference for sending pending message responses after exploration completes */
  private router: Router | null = null;

  /** Persistent Master session — shared across all user messages */
  private masterSession: MasterSession | null = null;
  /** Whether the session has been used (first call uses --session-id, subsequent use --resume) */
  private sessionInitialized = false;
  /** Cached system prompt content (loaded from .openbridge/prompts/master-system.md) */
  private systemPrompt: string | null = null;
  /** Number of times the Master session has been restarted */
  private restartCount = 0;
  /** Timestamp of last user message (for idle detection) */
  private lastMessageTimestamp: number | null = null;
  /** Idle detection timer (runs self-improvement when idle for >5 min) */
  private idleCheckTimer: NodeJS.Timeout | null = null;
  /** Whether self-improvement is currently running */
  private isSelfImproving = false;
  /** Number of successfully completed tasks — triggers prompt evolution every 50 (OB-734) */
  private completedTaskCount = 0;
  /** Cached workspace map summary (from workspace-map.json) for system prompt injection */
  private workspaceMapSummary: string | null = null;
  /** ISO timestamp of the most recent startup verification — for freshness indicator in system prompt */
  private mapLastVerifiedAt: string | null = null;
  /** In-memory classification cache — normalized key → cached result + feedback */
  private readonly classificationCache = new Map<string, ClassificationCacheEntry>();
  /** Whether the classification cache has been loaded from disk */
  private cacheLoaded = false;

  constructor(options: MasterManagerOptions) {
    this.workspacePath = options.workspacePath;
    this.masterTool = options.masterTool;
    this.discoveredTools = options.discoveredTools;
    this.explorationTimeout = options.explorationTimeout ?? DEFAULT_TIMEOUT;
    this.messageTimeout = options.messageTimeout ?? DEFAULT_MESSAGE_TIMEOUT;
    this.skipAutoExploration = options.skipAutoExploration ?? false;
    this.dotFolder = new DotFolderManager(this.workspacePath);
    this.changeTracker = new WorkspaceChangeTracker(this.workspacePath);
    this.delegationCoordinator = new DelegationCoordinator();
    this.agentRunner = new AgentRunner();
    this.workerRegistry = new WorkerRegistry();
    this.memory = options.memory ?? null;

    logger.info(
      {
        workspacePath: this.workspacePath,
        masterTool: this.masterTool.name,
        skipAutoExploration: this.skipAutoExploration,
      },
      'MasterManager created',
    );
  }

  // ---------------------------------------------------------------------------
  // Memory-aware store helpers (OB-711): route reads/writes through MemoryManager
  // when available, fall back to DotFolderManager when not.
  // ---------------------------------------------------------------------------

  /** Read workspace map from memory (chunks) or DotFolderManager (JSON file). */
  private async readWorkspaceMapFromStore(): Promise<WorkspaceMap | null> {
    if (this.memory) {
      try {
        const chunks = await this.memory.getChunksByScope('_workspace_map', 'structure');
        if (chunks.length > 0 && chunks[0]?.content) {
          return WorkspaceMapSchema.parse(JSON.parse(chunks[0].content));
        }
      } catch {
        // fall through to dotFolder
      }
      return null;
    }
    return this.dotFolder.readMap();
  }

  /** Write workspace map to memory (as chunk) or DotFolderManager (JSON file). */
  private async writeWorkspaceMapToStore(map: WorkspaceMap): Promise<void> {
    if (this.memory) {
      await this.memory.storeChunks([
        {
          scope: '_workspace_map',
          category: 'structure',
          content: JSON.stringify(map),
        },
      ]);
      return;
    }
    await this.dotFolder.writeMap(map);
  }

  /** Load master session from memory (sessions table) or DotFolderManager (JSON file). */
  private async loadMasterSessionFromStore(): Promise<MasterSession | null> {
    if (this.memory) {
      try {
        const record = await this.memory.getSession('master');
        if (!record) return null;
        return sessionRecordToMasterSession(record);
      } catch {
        return null;
      }
    }
    return this.dotFolder.readMasterSession();
  }

  /** Save master session to memory (sessions table) or DotFolderManager (JSON file). */
  private async saveMasterSessionToStore(session: MasterSession): Promise<void> {
    if (this.memory) {
      await this.memory.upsertSession(masterSessionToSessionRecord(session, this.restartCount));
      return;
    }
    await this.dotFolder.writeMasterSession(session);
  }

  /** Read analysis marker from memory (workspace_state table) or DotFolderManager (JSON file). */
  private async readAnalysisMarkerFromStore(): Promise<WorkspaceAnalysisMarker | null> {
    if (this.memory) {
      try {
        const state = await this.memory.getWorkspaceState();
        return workspaceStateToMarker(state);
      } catch {
        return null;
      }
    }
    return this.dotFolder.readAnalysisMarker();
  }

  /** Write analysis marker to memory (workspace_state table) or DotFolderManager (JSON file). */
  private async writeAnalysisMarkerToStore(marker: WorkspaceAnalysisMarker): Promise<void> {
    if (this.memory) {
      await this.memory.updateWorkspaceState(markerToWorkspaceState(marker));
      return;
    }
    await this.dotFolder.writeAnalysisMarker(marker);
  }

  /**
   * Read exploration state from memory (system_config) or DotFolderManager (JSON file).
   * Only a read is needed in master-manager.ts; writes happen in exploration-coordinator.ts.
   */
  private async readExplorationStateFromStore(): Promise<ExplorationState | null> {
    if (this.memory) {
      try {
        const json = await this.memory.getSystemConfig('exploration_state');
        if (json) return ExplorationStateSchema.parse(JSON.parse(json));
      } catch {
        return null;
      }
      return null;
    }
    return this.dotFolder.readExplorationState();
  }

  /**
   * Record a master-level task (user interaction) to memory or DotFolderManager.
   * When memory is available: write to SQLite tasks table.
   * When memory is null: write JSON file + git commit via DotFolderManager.
   */
  private async recordTaskToStore(
    task: TaskRecord,
    type: MemoryTaskRecord['type'] = 'worker',
  ): Promise<void> {
    if (this.memory) {
      try {
        await this.memory.recordTask(masterTaskToMemoryTask(task, type));
      } catch (err) {
        logger.warn({ err }, 'Failed to record task to memory store');
      }
      return;
    }
    await this.dotFolder.recordTask(task);
  }

  /**
   * Record a conversation message to the memory store (OB-730).
   * Silently skips when MemoryManager is unavailable or errors occur.
   */
  private async recordConversationMessage(
    sessionId: string,
    role: ConversationEntry['role'],
    content: string,
    channel?: string,
    userId?: string,
  ): Promise<void> {
    if (!this.memory) return;
    try {
      await this.memory.recordMessage({
        session_id: sessionId,
        role,
        content,
        channel,
        user_id: userId,
      });
    } catch (err) {
      logger.warn({ err, role }, 'Failed to record conversation message');
    }
  }

  /**
   * Retrieve relevant past conversation history for the given user message (OB-731).
   * Returns a formatted "## Previous context:" section or null when no history exists.
   */
  private async buildConversationContext(userMessage: string): Promise<string | null> {
    if (!this.memory) return null;
    try {
      const history = await this.memory.findRelevantHistory(userMessage, 5);
      // Only include user and master turns — skip worker/system noise
      const relevant = history.filter((e) => e.role === 'user' || e.role === 'master');
      if (relevant.length === 0) return null;

      const lines = relevant.map((e) => {
        const dateStr = e.created_at
          ? new Date(e.created_at).toISOString().replace('T', ' ').slice(0, 16)
          : '';
        const label = e.role === 'user' ? 'User' : 'Master';
        const snippet = e.content.length > 500 ? e.content.slice(0, 500) + '…' : e.content;
        return dateStr ? `[${dateStr}] ${label}: ${snippet}` : `${label}: ${snippet}`;
      });

      return '## Previous context:\n' + lines.join('\n');
    } catch (err) {
      logger.warn({ err }, 'Failed to retrieve conversation history for context injection');
      return null;
    }
  }

  /**
   * Increment the completed task counter and trigger prompt evolution every 50 tasks (OB-734).
   * Runs asynchronously in the background — never blocks the caller.
   */
  private onTaskCompleted(): void {
    this.completedTaskCount += 1;
    if (this.completedTaskCount % 50 === 0 && this.memory) {
      void evolvePrompts(this.memory, this.agentRunner, this.workspacePath).catch((err) => {
        logger.warn({ err }, 'Prompt evolution cycle failed');
      });
    }
  }

  /**
   * Read all task records from memory or DotFolderManager.
   * Memory returns MemoryTaskRecord (different schema) — converted to approximate MasterTaskRecord.
   * When memory is null, returns the full DotFolderManager records.
   */
  private async readAllTasksFromStore(): Promise<TaskRecord[]> {
    if (this.memory) {
      try {
        const types: MemoryTaskRecord['type'][] = ['worker', 'quick-answer', 'tool-use', 'complex'];
        const collected: MemoryTaskRecord[] = [];
        for (const t of types) {
          const batch = await this.memory.getTasksByType(t);
          collected.push(...batch);
        }
        const statusMap: Record<MemoryTaskRecord['status'], TaskRecord['status']> = {
          running: 'processing',
          completed: 'completed',
          failed: 'failed',
          timeout: 'failed',
        };
        return collected.map((t) => ({
          id: t.id,
          userMessage: t.prompt ?? '',
          sender: 'user',
          description: (t.prompt ?? '').slice(0, 200),
          status: statusMap[t.status] ?? 'failed',
          handledBy: 'master',
          result: t.response ?? undefined,
          createdAt: t.created_at,
          completedAt: t.completed_at ?? undefined,
          durationMs: t.duration_ms ?? undefined,
          metadata: {},
        }));
      } catch {
        return [];
      }
    }
    return this.dotFolder.readAllTasks();
  }

  /**
   * Get current state
   */
  public getState(): MasterState {
    return this.state;
  }

  /**
   * Get exploration summary (if exploration has been completed)
   */
  public getExplorationSummary(): ExplorationSummary | null {
    return this.explorationSummary;
  }

  /**
   * Get the workspace map (if exploration has been completed)
   */
  public async getWorkspaceMap(): Promise<WorkspaceMap | null> {
    return this.readWorkspaceMapFromStore();
  }

  /**
   * Get the persistent Master session info.
   */
  public getMasterSession(): MasterSession | null {
    return this.masterSession;
  }

  /**
   * Start the Master AI.
   * Resilient startup logic:
   * - If .openbridge/ doesn't exist → trigger fresh exploration
   * - If incomplete exploration detected → resume from checkpoint
   * - If map missing or corrupted → re-explore
   * - If valid map exists → skip exploration, enter ready state
   *
   * On ready, loads or creates a persistent Master session ID
   * stored in .openbridge/master-session.json.
   */
  public async start(): Promise<void> {
    if (this.state !== 'idle') {
      logger.warn({ currentState: this.state }, 'MasterManager already started');
      return;
    }

    logger.info('Starting MasterManager (resilient startup)');

    // Initialize .openbridge folder early so we can create the Master session
    await this.dotFolder.initialize();

    // Initialize Master session FIRST — so exploration can use it
    await this.initMasterSession();

    // Load worker registry from disk (if exists)
    await this.loadWorkerRegistry();

    // Check if .openbridge already has exploration data
    const folderExistedBefore = await this.dotFolder.exists();

    // Check if workspace map exists and is valid
    const map = await this.readWorkspaceMapFromStore();

    if (map) {
      // Check for workspace changes before deciding to skip exploration
      const changeResult = await this.checkWorkspaceChanges(map);

      if (changeResult === 'no-changes') {
        // Scenario 1a: Valid map + no workspace changes — skip exploration
        logger.info(
          { projectType: map.projectType },
          'Valid workspace map found, no workspace changes detected — skipping exploration',
        );

        this.explorationSummary = {
          startedAt: map.generatedAt,
          completedAt: map.generatedAt,
          status: 'completed',
          filesScanned: 0,
          directoriesExplored: 0,
          projectType: map.projectType,
          frameworks: map.frameworks,
          insights: [],
          mapPath: this.dotFolder.getMapPath(),
          gitInitialized: true,
        };

        this.workspaceMapSummary = this.buildMapSummary(map);
        this.state = 'ready';
        logger.info({ projectType: map.projectType }, 'Master AI ready (loaded existing map)');
        await this.drainPendingMessages();
        return;
      }

      if (changeResult === 'incremental') {
        // Scenario 1b: Valid map + small changes — incremental update done
        this.state = 'ready';
        logger.info('Master AI ready (incremental map update completed)');
        await this.drainPendingMessages();
        return;
      }

      // Scenario 1c: changeResult === 'full-reexplore' — fall through to full exploration
      logger.info('Workspace changes too large for incremental update — full re-exploration');
    }

    // Check for incomplete or failed exploration state
    const explorationState = await this.readExplorationStateFromStore();
    if (
      explorationState &&
      (explorationState.status === 'in_progress' || explorationState.status === 'failed')
    ) {
      const statusLabel = explorationState.status === 'in_progress' ? 'Incomplete' : 'Failed';
      logger.info(
        { currentPhase: explorationState.currentPhase, status: explorationState.status },
        `${statusLabel} exploration detected, ${explorationState.status === 'failed' ? 'retrying' : 'resuming'} from checkpoint`,
      );
    } else if (!folderExistedBefore || !map) {
      logger.info('No workspace map found, exploration needed');
    }

    // Trigger exploration (Master-driven or fallback)
    if (!this.skipAutoExploration) {
      await this.explore();
    } else {
      logger.info('Auto-exploration disabled, entering ready state');
      this.state = 'ready';
    }

    // Start idle detection timer for self-improvement cycle (OB-173)
    this.startIdleDetection();
  }

  /**
   * Initialize or resume the persistent Master session.
   * Loads existing session from .openbridge/master-session.json or creates a new one.
   * Also seeds and loads the Master system prompt.
   */
  private async initMasterSession(): Promise<void> {
    // Ensure .openbridge folder exists
    await this.dotFolder.initialize();

    // Seed system prompt if it doesn't exist yet
    await this.seedSystemPrompt();

    // Load the system prompt
    this.systemPrompt = await this.dotFolder.readSystemPrompt();
    if (this.systemPrompt) {
      logger.info('Loaded Master system prompt');
    }

    // Try to load existing session
    const existing = await this.loadMasterSessionFromStore();

    if (existing) {
      this.masterSession = existing;
      this.sessionInitialized = true; // Existing session — use --resume from the start
      logger.info(
        { sessionId: existing.sessionId, messageCount: existing.messageCount },
        'Loaded existing Master session',
      );
      return;
    }

    // Create new session — use raw UUID (Claude CLI requires valid UUID format)
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    this.masterSession = {
      sessionId,
      createdAt: now,
      lastUsedAt: now,
      messageCount: 0,
      allowedTools: [...MASTER_TOOLS],
      maxTurns: MASTER_MAX_TURNS,
    };

    this.sessionInitialized = false; // New session — first call uses --session-id

    // Persist to store (memory or JSON file)
    try {
      await this.saveMasterSessionToStore(this.masterSession);
      logger.info({ sessionId }, 'Created new Master session');
    } catch (error) {
      logger.warn({ error }, 'Failed to persist Master session to disk');
    }
  }

  /**
   * Seed the master system prompt if it doesn't already exist.
   * Generates the default prompt and writes it to .openbridge/prompts/master-system.md.
   */
  private async seedSystemPrompt(): Promise<void> {
    const existing = await this.dotFolder.readSystemPrompt();
    if (existing) {
      return; // Already seeded — don't overwrite (Master may have edited it)
    }

    const customProfiles = (await this.dotFolder.readProfiles())?.profiles;

    const promptContent = generateMasterSystemPrompt({
      workspacePath: this.workspacePath,
      masterToolName: this.masterTool.name,
      discoveredTools: this.discoveredTools,
      customProfiles,
    });

    try {
      await this.dotFolder.writeSystemPrompt(promptContent);
      logger.info('Seeded Master system prompt');
    } catch (error) {
      logger.warn({ error }, 'Failed to seed Master system prompt');
    }
  }

  /**
   * Build spawn options for a Master session call.
   * Uses --session-id on first call, --resume on subsequent calls.
   * Injects the system prompt via --append-system-prompt.
   */
  private buildMasterSpawnOptions(
    prompt: string,
    timeout?: number,
    maxTurns?: number,
  ): SpawnOptions {
    if (!this.masterSession) {
      throw new Error('Master session not initialized — call initMasterSession() first');
    }
    const session = this.masterSession;
    const opts: SpawnOptions = {
      prompt,
      workspacePath: this.workspacePath,
      allowedTools: [...session.allowedTools],
      maxTurns: maxTurns ?? MESSAGE_MAX_TURNS_QUICK,
      timeout: timeout ?? this.messageTimeout,
      retries: 0, // Master session calls don't auto-retry (caller handles)
    };

    // Inject the system prompt if available
    if (this.systemPrompt) {
      opts.systemPrompt = this.systemPrompt;
    }

    // Use --print mode (non-interactive). Interactive sessions (--session-id)
    // hang as headless child processes — no TTY for permission prompts.
    // No sessionId/resumeSessionId set → buildArgs() defaults to --print.

    // Inject workspace context for non-exploration calls
    if (this.explorationSummary?.status === 'completed') {
      const mapContext = this.getWorkspaceContextSummary();
      if (mapContext) {
        let contextText = mapContext;
        if (this.mapLastVerifiedAt) {
          contextText += `\n\nMap last verified: ${formatTimeAgo(this.mapLastVerifiedAt)}`;
        }
        opts.systemPrompt =
          (opts.systemPrompt ?? '') + '\n\n## Current Workspace Knowledge\n\n' + contextText;
      }
    }

    return opts;
  }

  /**
   * Build a concise workspace context string from the loaded workspace map.
   * Uses the cached map summary if available (much richer than exploration metadata).
   */
  private getWorkspaceContextSummary(): string | null {
    // Prefer the cached full map summary — it contains everything the AI needs
    if (this.workspaceMapSummary) {
      return this.workspaceMapSummary;
    }

    // Fallback to exploration metadata
    if (!this.explorationSummary) return null;
    const parts: string[] = [];
    if (this.explorationSummary.projectType) {
      parts.push(`Project type: ${this.explorationSummary.projectType}`);
    }
    if (this.explorationSummary.frameworks && this.explorationSummary.frameworks.length > 0) {
      parts.push(`Frameworks: ${this.explorationSummary.frameworks.join(', ')}`);
    }
    if (this.explorationSummary.insights && this.explorationSummary.insights.length > 0) {
      parts.push(
        `Key insights:\n${this.explorationSummary.insights.map((i) => `- ${i}`).join('\n')}`,
      );
    }
    if (this.explorationSummary.mapPath) {
      parts.push(`Full workspace map available at: ${this.explorationSummary.mapPath}`);
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }

  /**
   * Build a rich text summary from the workspace map for system prompt injection.
   * Includes project name, type, summary, frameworks, structure, and key files —
   * enough for the AI to answer most questions without needing tool calls.
   */
  private buildMapSummary(map: Record<string, unknown>): string {
    const parts: string[] = [];
    const str = (key: string): string | undefined => {
      const v = map[key];
      return typeof v === 'string' ? v : undefined;
    };

    const name = str('projectName');
    if (name) parts.push(`Project: ${name}`);
    const ptype = str('projectType');
    if (ptype) parts.push(`Type: ${ptype}`);
    const phase = str('projectPhase');
    if (phase) parts.push(`Phase: ${phase}`);
    const summary = str('summary');
    if (summary) parts.push(`\nSummary: ${summary}`);

    const frameworks = map['frameworks'];
    if (Array.isArray(frameworks) && frameworks.length > 0) {
      parts.push(`\nFrameworks: ${frameworks.map(String).join(', ')}`);
    }

    const structure = map['structure'];
    if (structure && typeof structure === 'object' && !Array.isArray(structure)) {
      const dirs = Object.entries(structure as Record<string, unknown>)
        .map(([dirName, info]) => {
          const purpose =
            info && typeof info === 'object' && 'purpose' in info
              ? String((info as Record<string, unknown>)['purpose'])
              : 'unknown';
          return `- ${dirName}/: ${purpose}`;
        })
        .join('\n');
      if (dirs) parts.push(`\nDirectory structure:\n${dirs}`);
    }

    const commands = map['commands'];
    if (commands && typeof commands === 'object' && !Array.isArray(commands)) {
      const cmds = Object.entries(commands as Record<string, unknown>)
        .map(([cmdName, cmd]) => `- ${cmdName}: ${String(cmd)}`)
        .join('\n');
      if (cmds) parts.push(`\nAvailable commands:\n${cmds}`);
    }

    const dependencies = map['dependencies'];
    if (Array.isArray(dependencies) && dependencies.length > 0) {
      const deps = dependencies
        .map((d: unknown) => {
          if (d && typeof d === 'object') {
            const dep = d as Record<string, unknown>;
            const depName = typeof dep['name'] === 'string' ? dep['name'] : '';
            const depPurpose = typeof dep['purpose'] === 'string' ? dep['purpose'] : '';
            return `- ${depName}${depPurpose ? `: ${depPurpose}` : ''}`;
          }
          return `- ${String(d)}`;
        })
        .join('\n');
      parts.push(`\nDependencies:\n${deps}`);
    }

    if (this.explorationSummary?.mapPath) {
      parts.push(`\nFull workspace map: ${this.explorationSummary.mapPath}`);
    }

    return parts.join('\n');
  }

  /**
   * Update Master session after a successful call.
   */
  private async updateMasterSession(): Promise<void> {
    if (!this.masterSession) return;

    this.sessionInitialized = true;
    this.masterSession.lastUsedAt = new Date().toISOString();
    this.masterSession.messageCount++;

    try {
      await this.saveMasterSessionToStore(this.masterSession);
    } catch (error) {
      logger.warn({ error }, 'Failed to persist Master session update');
    }
  }

  /**
   * Check whether a failed AgentResult indicates the Master session is dead
   * (crash, timeout, context overflow) and cannot be resumed.
   */
  private isSessionDead(exitCode: number, stderr: string): boolean {
    // Check exit code
    if (SESSION_DEAD_EXIT_CODES.has(exitCode)) {
      // Exit code 1 is only considered dead if stderr contains a session-related pattern
      if (exitCode === 1) {
        const lower = stderr.toLowerCase();
        return SESSION_DEAD_PATTERNS.some((pattern) => lower.includes(pattern));
      }
      return true;
    }

    // Check stderr patterns regardless of exit code
    const lower = stderr.toLowerCase();
    return SESSION_DEAD_PATTERNS.some((pattern) => lower.includes(pattern));
  }

  /**
   * Build a context summary for a restarted Master session.
   * Loads workspace-map.json and recent task history to seed the new session
   * with accumulated knowledge so the user sees no interruption.
   */
  private async buildContextSummary(): Promise<string> {
    const parts: string[] = [];

    parts.push(
      '# Session Context Recovery',
      '',
      'Your previous session ended unexpectedly. Here is the accumulated context to resume from:',
      '',
    );

    // Load workspace map
    const map = await this.readWorkspaceMapFromStore();
    if (map) {
      parts.push('## Workspace Summary');
      parts.push(`- **Project:** ${map.projectName} (${map.projectType})`);
      parts.push(`- **Path:** ${map.workspacePath}`);
      if (map.frameworks.length > 0) {
        parts.push(`- **Frameworks:** ${map.frameworks.join(', ')}`);
      }
      parts.push(`- **Summary:** ${map.summary}`);
      parts.push('');
    }

    // Load recent task history
    const tasks = await this.readAllTasksFromStore();
    if (tasks.length > 0) {
      // Sort by createdAt descending, take most recent
      const recentTasks = tasks
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, RESTART_CONTEXT_TASK_LIMIT);

      parts.push('## Recent Task History');
      for (const task of recentTasks) {
        const status = task.status === 'completed' ? 'completed' : task.status;
        parts.push(`- [${status}] "${task.description.slice(0, 100)}" (from ${task.sender})`);
        if (task.result) {
          parts.push(`  Result: ${task.result.slice(0, 200)}`);
        }
      }
      parts.push('');
    }

    parts.push('Continue operating normally. Respond to the next user message as usual.');

    return parts.join('\n');
  }

  /**
   * Restart the Master session after detecting it has died.
   * Saves the old session state, creates a new session, and seeds it
   * with a context summary so the user sees no interruption.
   */
  private async restartMasterSession(): Promise<void> {
    const oldSession = this.masterSession;
    this.restartCount++;

    logger.warn(
      {
        oldSessionId: oldSession?.sessionId,
        oldMessageCount: oldSession?.messageCount,
        restartCount: this.restartCount,
      },
      'Restarting Master session after failure',
    );

    // Log the restart
    await this.dotFolder.appendLog({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'Master session restarted',
      data: {
        oldSessionId: oldSession?.sessionId,
        oldMessageCount: oldSession?.messageCount,
        restartCount: this.restartCount,
      },
    });

    // Create a new session — use raw UUID (Claude CLI requires valid UUID format)
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    this.masterSession = {
      sessionId,
      createdAt: now,
      lastUsedAt: now,
      messageCount: 0,
      allowedTools: [...MASTER_TOOLS],
      maxTurns: MASTER_MAX_TURNS,
    };
    this.sessionInitialized = false;

    // Persist the new session
    try {
      await this.saveMasterSessionToStore(this.masterSession);
    } catch (error) {
      logger.warn({ error }, 'Failed to persist restarted Master session');
    }

    // Build and send context summary to seed the new session
    const contextSummary = await this.buildContextSummary();
    const spawnOpts = this.buildMasterSpawnOptions(contextSummary, this.messageTimeout);

    try {
      const result = await this.agentRunner.spawn(spawnOpts);
      await this.updateMasterSession();

      if (result.exitCode !== 0) {
        logger.warn(
          { exitCode: result.exitCode, stderr: result.stderr },
          'Context recovery prompt returned non-zero exit code',
        );
      } else {
        logger.info({ sessionId }, 'Master session restarted with context summary');
      }
    } catch (error) {
      // Context seeding failed — session is still usable, just without history
      logger.warn({ error }, 'Failed to seed restarted session with context summary');
      // Mark session as initialized even on failure so future calls use --resume
      this.sessionInitialized = true;
      await this.updateMasterSession();
    }
  }

  /**
   * Get the number of times the Master session has been restarted.
   */
  public getRestartCount(): number {
    return this.restartCount;
  }

  /**
   * Get the worker registry for external access.
   * Useful for status queries and debugging.
   */
  public getWorkerRegistry(): WorkerRegistry {
    return this.workerRegistry;
  }

  /**
   * Set the Router so pending messages can be routed after exploration completes.
   * Bridge calls this after setMaster() so the Master can deliver queued messages.
   */
  public setRouter(router: Router): void {
    this.router = router;
  }

  /**
   * Build a ProgressReporter for a specific message's source and sender.
   * Returns undefined when no router is set (e.g. in unit tests).
   */
  private makeProgressReporter(source: string, sender: string): ProgressReporter | undefined {
    if (!this.router) return undefined;
    const router = this.router;
    return async (event: ProgressEvent) => {
      await router.sendProgress(source, sender, event);
    };
  }

  /**
   * Load the worker registry from .openbridge/workers.json.
   * Called during start() to restore worker state from previous sessions.
   */
  private async loadWorkerRegistry(): Promise<void> {
    try {
      const registry = await this.dotFolder.readWorkers();
      if (registry) {
        this.workerRegistry.fromJSON(registry);
        logger.info(
          { workerCount: Object.keys(registry.workers).length },
          'Loaded worker registry from disk',
        );
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load worker registry from disk (will start fresh)');
    }
  }

  /**
   * Persist the worker registry to .openbridge/workers.json.
   * Called after worker state changes to maintain cross-restart visibility.
   */
  private async persistWorkerRegistry(): Promise<void> {
    try {
      const registry = this.workerRegistry.toJSON();
      await this.dotFolder.writeWorkers(registry);
    } catch (error) {
      logger.warn({ error }, 'Failed to persist worker registry to disk');
    }
  }

  /**
   * Detect which prompt template (if any) was used for this worker task.
   * Matches the task prompt against known template patterns.
   *
   * Returns the prompt ID or null if no template match found.
   */
  private detectPromptTemplate(prompt: string): string | null {
    // Check for exploration structure scan markers
    if (
      prompt.includes('Workspace Structure Scan') ||
      prompt.includes('topLevelFiles') ||
      prompt.includes('directoryCounts')
    ) {
      return 'exploration-structure-scan';
    }

    // Check for exploration classification markers
    if (
      prompt.includes('Project Classification') ||
      (prompt.includes('projectType') && prompt.includes('frameworks'))
    ) {
      return 'exploration-classification';
    }

    // Check for task execution markers
    if (
      prompt.includes('Execute User Request') ||
      prompt.includes('User Request') ||
      prompt.includes('Workspace Context')
    ) {
      return 'task-execute';
    }

    // Check for task verification markers
    if (
      prompt.includes('Verify Implementation') ||
      (prompt.includes('Verification Steps') && prompt.includes('verified'))
    ) {
      return 'task-verify';
    }

    return null;
  }

  /**
   * Validate worker output to determine if the prompt produced valid results.
   *
   * For exploration/verification prompts: checks if output is parseable JSON with expected fields
   * For task prompts: checks if exit code is 0 (successful execution)
   */
  private validateWorkerOutput(
    promptId: string | null,
    result: AgentResult,
    _taskRecord: TaskRecord,
  ): boolean {
    // If no prompt template detected, fall back to simple exit code check
    if (!promptId) {
      return result.exitCode === 0;
    }

    // Exit code must be 0 for all prompts
    if (result.exitCode !== 0) {
      return false;
    }

    const output = result.stdout.trim();

    // For exploration and verification prompts, validate JSON structure
    if (
      promptId === 'exploration-structure-scan' ||
      promptId === 'exploration-classification' ||
      promptId === 'task-verify'
    ) {
      try {
        const parsed = JSON.parse(output) as Record<string, unknown>;

        // Validate required fields based on prompt type
        switch (promptId) {
          case 'exploration-structure-scan':
            return (
              typeof parsed['workspacePath'] === 'string' &&
              Array.isArray(parsed['topLevelFiles']) &&
              Array.isArray(parsed['topLevelDirs']) &&
              typeof parsed['directoryCounts'] === 'object'
            );

          case 'exploration-classification':
            return (
              typeof parsed['projectType'] === 'string' &&
              typeof parsed['projectName'] === 'string' &&
              Array.isArray(parsed['frameworks'])
            );

          case 'task-verify':
            return typeof parsed['verified'] === 'boolean';

          default:
            return true;
        }
      } catch {
        // JSON parse failed — output is not valid
        return false;
      }
    }

    // For task execution prompts, success is based on exit code + non-empty output
    if (promptId === 'task-execute') {
      return result.exitCode === 0 && output.length > 0;
    }

    // Default: success based on exit code
    return result.exitCode === 0;
  }

  /**
   * Record prompt effectiveness after worker execution (OB-172: prompt effectiveness tracking).
   *
   * Detects which prompt template was used (if any) and validates the output.
   * Records success/failure to the prompt manifest for self-improvement.
   */
  private async recordPromptEffectiveness(
    taskRecord: TaskRecord,
    result: AgentResult,
  ): Promise<void> {
    try {
      const promptId = this.detectPromptTemplate(taskRecord.userMessage);

      if (!promptId) {
        // No template detected — skip effectiveness tracking
        logger.debug(
          { workerId: taskRecord.id },
          'No prompt template detected for worker — skipping effectiveness tracking',
        );
        return;
      }

      const isValid = this.validateWorkerOutput(promptId, result, taskRecord);

      await this.dotFolder.recordPromptUsage(promptId, isValid);

      if (this.memory) {
        await this.memory.recordPromptOutcome(promptId, isValid);
      }

      logger.debug(
        {
          workerId: taskRecord.id,
          promptId,
          isValid,
          exitCode: result.exitCode,
        },
        'Recorded prompt effectiveness',
      );
    } catch (error) {
      logger.warn(
        { error, workerId: taskRecord.id },
        'Failed to record prompt effectiveness — non-blocking',
      );
    }
  }

  /**
   * Record a learning entry for a completed worker execution (OB-171: learnings store).
   * After each task, the Master appends a learning entry with task type, model used,
   * profile used, success, duration, and notes. On startup, the Master reads this
   * history to inform future decisions (e.g., "haiku failed on refactoring tasks 3
   * times, use sonnet instead").
   */
  private async recordWorkerLearning(
    taskRecord: TaskRecord,
    result: AgentResult,
    profile: string,
    model?: string,
  ): Promise<void> {
    try {
      // Classify task type based on the prompt content
      const taskType = this.classifyTaskType(taskRecord.userMessage);

      // Determine success based on exit code and task status
      const success = result.exitCode === 0 && taskRecord.status === 'completed';

      // Extract notes from the task record or result
      const notes = success
        ? `Worker completed successfully using ${profile} profile` +
          (result.retryCount > 0 ? ` (${result.retryCount} retries required)` : '')
        : `Worker failed: ${taskRecord.error?.slice(0, 200) ?? 'Unknown error'}` +
          (result.retryCount > 0 ? ` (${result.retryCount} retries attempted)` : '');

      const learningEntry = {
        id: `learning-${taskRecord.id}`,
        taskType,
        modelUsed: result.model ?? model,
        profileUsed: profile,
        success,
        durationMs: result.durationMs,
        notes,
        recordedAt: new Date().toISOString(),
        exitCode: result.exitCode,
        retryCount: result.retryCount,
        metadata: {
          workerId: taskRecord.id,
          workerIndex: taskRecord.metadata?.['workerIndex'] as number | undefined,
          modelFallbacks: result.modelFallbacks,
        },
      };

      if (this.memory) {
        await this.memory.recordLearning(
          taskType,
          learningEntry.modelUsed ?? 'unknown',
          learningEntry.success,
          0, // turns not tracked in AgentResult
          learningEntry.durationMs,
        );
      } else {
        await this.dotFolder.appendLearning(learningEntry);
      }

      logger.debug(
        {
          learningId: learningEntry.id,
          taskType,
          model: learningEntry.modelUsed,
          profile,
          success,
        },
        'Learning entry recorded',
      );
    } catch (error) {
      logger.warn({ error, taskId: taskRecord.id }, 'Failed to record learning entry');
    }
  }

  /**
   * Classify task type based on prompt content.
   * Uses heuristics to categorize tasks for learning analysis.
   */
  private classifyTaskType(prompt: string): string {
    const lower = prompt.toLowerCase();

    // Check for common task patterns
    if (
      lower.includes('refactor') ||
      lower.includes('restructure') ||
      lower.includes('reorganize')
    ) {
      return 'refactoring';
    }
    if (
      lower.includes('bug') ||
      lower.includes('fix') ||
      lower.includes('error') ||
      lower.includes('issue')
    ) {
      return 'bug-fix';
    }
    if (lower.includes('test') || lower.includes('spec') || lower.includes('verify')) {
      return 'testing';
    }
    if (
      lower.includes('add') ||
      lower.includes('implement') ||
      lower.includes('create') ||
      lower.includes('feature')
    ) {
      return 'feature';
    }
    if (
      lower.includes('explore') ||
      lower.includes('analyze') ||
      lower.includes('investigate') ||
      lower.includes('find')
    ) {
      return 'exploration';
    }
    if (lower.includes('document') || lower.includes('explain') || lower.includes('describe')) {
      return 'documentation';
    }
    if (lower.includes('optimize') || lower.includes('improve') || lower.includes('performance')) {
      return 'optimization';
    }

    // Default to generic task type
    return 'task';
  }

  /**
   * Normalize a message for cache lookup.
   * Converts to lowercase, strips punctuation, and collapses whitespace.
   * This ensures "Create a README" and "create a readme" share the same cache entry.
   */
  public normalizeForCache(content: string): string {
    return content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // strip punctuation
      .replace(/\s+/g, ' ') // collapse whitespace
      .trim();
  }

  /**
   * Load the classification cache from disk into the in-memory map.
   * Called lazily on the first classifyTask() call. Non-blocking on failure.
   */
  private async loadClassificationCache(): Promise<void> {
    if (this.cacheLoaded) return;
    this.cacheLoaded = true;
    try {
      const stored = await this.dotFolder.readClassifications();
      if (stored) {
        for (const [key, entry] of Object.entries(stored.entries)) {
          this.classificationCache.set(key, entry);
        }
        logger.debug({ size: this.classificationCache.size }, 'Classification cache loaded');
      }
    } catch {
      // Cache load failure is non-fatal — we'll just re-classify
    }
  }

  /**
   * Persist the in-memory classification cache to .openbridge/classifications.json.
   * Called non-blockingly after cache updates. Failures are logged but not thrown.
   */
  private async persistClassificationCache(): Promise<void> {
    try {
      const entries: Record<string, ClassificationCacheEntry> = {};
      for (const [key, entry] of this.classificationCache) {
        entries[key] = entry;
      }
      await this.dotFolder.writeClassifications({
        entries,
        updatedAt: new Date().toISOString(),
        schemaVersion: '1.0.0',
      });
    } catch (err) {
      logger.warn({ err }, 'Failed to persist classification cache — non-fatal');
    }
  }

  /**
   * Record feedback for a classification after the task completes.
   * Updates the cached entry's feedback array and adjusts maxTurns if the
   * budget consistently proves insufficient.
   *
   * @param normalizedKey - The normalized message key (from normalizeForCache)
   * @param turnBudgetSufficient - Whether the task completed without timeout/error
   * @param timedOut - Whether the Master session timed out (exit code 143/137)
   */
  public async recordClassificationFeedback(
    normalizedKey: string,
    turnBudgetSufficient: boolean,
    timedOut: boolean,
  ): Promise<void> {
    const entry = this.classificationCache.get(normalizedKey);
    if (!entry) return;

    entry.feedback.push({
      recordedAt: new Date().toISOString(),
      turnBudgetSufficient,
      timedOut,
    });

    // If 2+ of the last 3 executions timed out, bump maxTurns by 50% (capped at 30)
    const recent = entry.feedback.slice(-3);
    const timeoutCount = recent.filter((f) => f.timedOut).length;
    if (recent.length >= 2 && timeoutCount >= 2) {
      const bumped = Math.min(Math.ceil(entry.result.maxTurns * 1.5), 30);
      if (bumped > entry.result.maxTurns) {
        logger.info(
          { normalizedKey, oldMaxTurns: entry.result.maxTurns, newMaxTurns: bumped },
          'Classification cache: bumping maxTurns due to repeated timeouts',
        );
        entry.result.maxTurns = bumped;
        entry.result.reason = `${entry.result.reason} (auto-adjusted: repeated timeouts)`;
      }
    }

    await this.persistClassificationCache();

    // Persist classification feedback to SQLite learnings table for aggregate learning (OB-732)
    if (this.memory) {
      void (async (): Promise<void> => {
        try {
          await this.memory!.recordLearning(
            'classification',
            entry.result.class,
            turnBudgetSufficient,
            0,
            0,
          );
        } catch (err) {
          logger.warn({ err }, 'Failed to record classification learning to DB — non-fatal');
        }
      })();
    }
  }

  /**
   * Keyword-based task classifier — instant fallback when the AI classifier
   * is unavailable or times out. Returns 'tool-use' as the default so that
   * borderline messages get enough turns instead of timing out.
   */
  private classifyTaskByKeywords(content: string): ClassificationResult {
    const lower = content.toLowerCase();

    // Complex task keywords — multi-step work requiring planning and delegation
    const complexKeywords = ['implement', 'build', 'refactor', 'develop', 'set up', 'setup'];
    if (complexKeywords.some((kw) => lower.includes(kw))) {
      return {
        class: 'complex-task',
        maxTurns: MESSAGE_MAX_TURNS_PLANNING,
        reason: 'keyword match: complex-task',
      };
    }

    // Tool-use keywords — single-action file generation or targeted edits
    const toolUseKeywords = [
      'generate',
      'create',
      'write',
      'fix',
      'update file',
      'add to',
      'make a',
    ];
    if (toolUseKeywords.some((kw) => lower.includes(kw))) {
      return {
        class: 'tool-use',
        maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
        reason: 'keyword match: tool-use',
      };
    }

    // Question/lookup patterns — no file changes needed
    // Only short messages ending with '?' are treated as quick questions.
    // Long messages (>80 chars) with '?' are usually complex action requests
    // phrased as questions (e.g. "can you reorganize the folder structure?").
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
    ];
    const trimmed = lower.trim();
    const isShortQuestion = trimmed.endsWith('?') && trimmed.length <= 80;
    const hasQuestionKeyword = questionPatterns.some((qp) => lower.includes(qp));
    if (isShortQuestion || (hasQuestionKeyword && trimmed.length <= 120)) {
      return {
        class: 'quick-answer',
        maxTurns: MESSAGE_MAX_TURNS_QUICK,
        reason: 'keyword match: quick-answer',
      };
    }

    // Default: tool-use for unclassified messages — safer than quick-answer since
    // most non-question messages require file operations (e.g. "Haifa 2 personne")
    return {
      class: 'tool-use',
      maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
      reason: 'keyword fallback: tool-use',
    };
  }

  /**
   * AI-powered task classifier using a 1-turn haiku call.
   * Returns a ClassificationResult with class, AI-suggested maxTurns, and reason.
   * Falls back to keyword heuristics if the AI call fails or takes >3s.
   * Falls back to 'tool-use' with default turns if the JSON cannot be parsed.
   *
   * The AI is given the workspace context (project type, frameworks) so it can
   * calibrate the turn budget based on scope (e.g. "full-stack app" → more turns
   * than "simple HTML page").
   */
  public async classifyTask(content: string): Promise<ClassificationResult> {
    const CLASSIFIER_TIMEOUT_MS = 5000;

    // Check in-memory cache first (0ms, avoids AI call for repeated patterns)
    await this.loadClassificationCache();
    const cacheKey = this.normalizeForCache(content);
    const cached = this.classificationCache.get(cacheKey);
    if (cached) {
      cached.hitCount++;
      logger.debug(
        { cacheKey, class: cached.result.class, hitCount: cached.hitCount },
        'Classification cache hit',
      );
      void this.persistClassificationCache();
      return { ...cached.result };
    }

    // Include workspace context so the AI can calibrate scope
    const workspaceCtx = this.getWorkspaceContextSummary();
    const contextSection = workspaceCtx ? `Workspace context:\n${workspaceCtx}\n\n` : '';

    const prompt =
      `You are a task classifier for an AI assistant. Analyze the user message and suggest how to handle it.\n\n` +
      contextSection +
      `User message: "${content}"\n\n` +
      `Classify the message and suggest a turn budget. Reply with ONLY a JSON object — no markdown, no explanation:\n` +
      `{"class":"<category>","maxTurns":<number>,"reason":"<brief reason>"}\n\n` +
      `Categories and turn guidance:\n` +
      `- "quick-answer": question, explanation, or lookup (no file changes) → maxTurns 1-5\n` +
      `- "tool-use": generate/create/write/fix a file or single targeted edit → maxTurns 5-20\n` +
      `- "complex-task": multi-step work requiring planning, many files, or full implementation → maxTurns 10-30`;

    let classificationResult: ClassificationResult;

    try {
      const result = await Promise.race([
        this.agentRunner.spawn({
          prompt,
          workspacePath: this.workspacePath,
          model: 'haiku',
          maxTurns: 1,
          retries: 0,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('classifier timeout')), CLASSIFIER_TIMEOUT_MS),
        ),
      ]);

      const raw = result.stdout.trim();

      // Extract JSON from the response (handle cases where AI wraps in markdown)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
          const cls = parsed['class'];
          const turns = parsed['maxTurns'];
          const reason = typeof parsed['reason'] === 'string' ? parsed['reason'] : '';

          if (cls === 'quick-answer' || cls === 'tool-use' || cls === 'complex-task') {
            const maxTurns =
              typeof turns === 'number' && turns > 0 && turns <= 50
                ? turns
                : cls === 'quick-answer'
                  ? MESSAGE_MAX_TURNS_QUICK
                  : cls === 'tool-use'
                    ? MESSAGE_MAX_TURNS_TOOL_USE
                    : MESSAGE_MAX_TURNS_PLANNING;
            logger.debug({ class: cls, maxTurns, reason }, 'AI classifier result');
            classificationResult = { class: cls, maxTurns, reason };
          } else {
            classificationResult = {
              class: 'tool-use',
              maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
              reason: 'parse failure default',
            };
          }
        } catch {
          // JSON parse error — fall through to text scan
          const lower = raw.toLowerCase();
          if (lower.includes('quick-answer')) {
            classificationResult = {
              class: 'quick-answer',
              maxTurns: MESSAGE_MAX_TURNS_QUICK,
              reason: 'text scan fallback',
            };
          } else if (lower.includes('complex-task')) {
            classificationResult = {
              class: 'complex-task',
              maxTurns: MESSAGE_MAX_TURNS_PLANNING,
              reason: 'text scan fallback',
            };
          } else if (lower.includes('tool-use')) {
            classificationResult = {
              class: 'tool-use',
              maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
              reason: 'text scan fallback',
            };
          } else {
            classificationResult = {
              class: 'tool-use',
              maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
              reason: 'parse failure default',
            };
          }
        }
      } else {
        // Last-chance text scan — response may contain the category without valid JSON
        const lower = raw.toLowerCase();
        if (lower.includes('quick-answer')) {
          classificationResult = {
            class: 'quick-answer',
            maxTurns: MESSAGE_MAX_TURNS_QUICK,
            reason: 'text scan fallback',
          };
        } else if (lower.includes('complex-task')) {
          classificationResult = {
            class: 'complex-task',
            maxTurns: MESSAGE_MAX_TURNS_PLANNING,
            reason: 'text scan fallback',
          };
        } else if (lower.includes('tool-use')) {
          classificationResult = {
            class: 'tool-use',
            maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
            reason: 'text scan fallback',
          };
        } else {
          // Parse failure → safe default (tool-use: enough turns without over-committing)
          logger.warn(
            { response: raw },
            'AI classifier returned unexpected response, defaulting to tool-use',
          );
          classificationResult = {
            class: 'tool-use',
            maxTurns: MESSAGE_MAX_TURNS_TOOL_USE,
            reason: 'parse failure default',
          };
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.debug({ reason }, 'AI classifier failed, falling back to keyword heuristics');
      classificationResult = this.classifyTaskByKeywords(content);
    }

    // Apply classification learning: if aggregate data shows this class underperforms,
    // escalate to the best-performing class seen in the learnings table (OB-732)
    if (this.memory) {
      try {
        const learned = await this.memory.getLearnedParams('classification');
        if (learned) {
          const classRank: Record<string, number> = {
            'quick-answer': 0,
            'tool-use': 1,
            'complex-task': 2,
          };
          const validClasses = new Set(['quick-answer', 'tool-use', 'complex-task']);
          const currentRank = classRank[classificationResult.class] ?? 0;
          const learnedRank = classRank[learned.model] ?? 0;
          if (
            validClasses.has(learned.model) &&
            learnedRank > currentRank &&
            learned.success_rate > 0.5
          ) {
            const escalatedClass = learned.model as ClassificationResult['class'];
            const escalatedMaxTurns =
              escalatedClass === 'quick-answer'
                ? MESSAGE_MAX_TURNS_QUICK
                : escalatedClass === 'tool-use'
                  ? MESSAGE_MAX_TURNS_TOOL_USE
                  : MESSAGE_MAX_TURNS_PLANNING;
            logger.info(
              {
                original: classificationResult.class,
                escalated: escalatedClass,
                successRate: learned.success_rate,
                totalTasks: learned.total_tasks,
              },
              'Classification escalated based on learning data',
            );
            classificationResult = {
              class: escalatedClass,
              maxTurns: escalatedMaxTurns,
              reason: `${classificationResult.reason} (escalated: ${Math.round(learned.success_rate * 100)}% success rate for ${escalatedClass})`,
            };
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to query classification learning — using original result');
      }
    }

    // Store result in cache for future lookups
    this.classificationCache.set(cacheKey, {
      normalizedKey: cacheKey,
      result: { ...classificationResult },
      recordedAt: new Date().toISOString(),
      hitCount: 0,
      feedback: [],
    });
    void this.persistClassificationCache();

    return classificationResult;
  }

  /**
   * Build a planning prompt for complex tasks.
   * Instructs the Master to decompose the request into SPAWN markers
   * without executing the tasks itself — forcing delegation within 3-5 turns.
   */
  private buildPlanningPrompt(userMessage: string): string {
    return (
      `The user asked: "${userMessage}"\n\n` +
      `Break this into 1-3 concrete subtasks. For each subtask, output a SPAWN marker ` +
      `with the appropriate profile, model, and instructions. ` +
      `Do NOT execute the tasks yourself — only plan and delegate.\n\n` +
      `Use this format for each subtask:\n` +
      `[SPAWN:profile]{"prompt":"...","model":"sonnet","maxTurns":15}[/SPAWN]\n\n` +
      `Available profiles: read-only (Read/Glob/Grep), code-edit (Read/Edit/Write/Glob/Grep/Bash(git:*)/Bash(npm:*)), full-access (all tools).`
    );
  }

  /**
   * Autonomously explore the workspace and create .openbridge/ folder.
   * This is the Master AI's initialization step.
   *
   * The Master AI session drives exploration — it decides how many passes,
   * which directories to explore, and what to record. The Master uses its
   * own tools (Read, Glob, Grep, Write, Edit) to explore and write the
   * workspace map directly to `.openbridge/`.
   *
   * The Master session is always initialized before explore() is called
   * (initMasterSession runs during start()). The Master decides its own
   * exploration strategy — no hardcoded phases.
   */
  public async explore(): Promise<void> {
    if (this.state === 'exploring') {
      logger.warn('Exploration already in progress');
      return;
    }

    this.state = 'exploring';

    logger.info(
      { workspacePath: this.workspacePath },
      'Starting Master-driven workspace exploration',
    );

    try {
      // Initialize .openbridge folder
      await this.dotFolder.initialize();

      // Log exploration start
      const startedAt = new Date().toISOString();
      await this.dotFolder.appendLog({
        timestamp: startedAt,
        level: 'info',
        message: 'Master-driven workspace exploration started',
        data: { masterTool: this.masterTool.name, version: this.masterTool.version },
      });

      // Master-driven exploration via the persistent session
      await this.masterDrivenExplore();

      this.state = 'ready';

      // Drain any messages queued while exploration was running
      await this.drainPendingMessages();

      logger.info(
        {
          projectType: this.explorationSummary?.projectType,
          frameworks: this.explorationSummary?.frameworks,
          directoriesExplored: this.explorationSummary?.directoriesExplored,
          status: this.explorationSummary?.status,
        },
        'Workspace exploration completed',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.explorationSummary = {
        startedAt: this.explorationSummary?.startedAt ?? new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'failed',
        filesScanned: 0,
        directoriesExplored: 0,
        frameworks: [],
        insights: [],
        gitInitialized: false,
        error: errorMessage,
      };

      // Log exploration failure
      await this.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'Workspace exploration failed',
        data: { error: errorMessage },
      });

      this.state = 'error';

      logger.error(
        { err: error, workspacePath: this.workspacePath },
        'Workspace exploration failed',
      );

      throw error;
    }
  }

  /**
   * Check for workspace changes since the last analysis and decide which
   * exploration path to take.
   * Returns 'no-changes', 'incremental', or 'full-reexplore'.
   */
  private async checkWorkspaceChanges(
    existingMap: WorkspaceMap,
  ): Promise<'no-changes' | 'incremental' | 'full-reexplore'> {
    const marker = await this.readAnalysisMarkerFromStore();

    // No marker but valid map exists = upgrade from before incremental tracking.
    // Write a marker now and treat as no-changes (skip re-exploration).
    if (!marker) {
      logger.info('No analysis marker found — writing initial marker for existing map');
      const initialMarker = await this.changeTracker.buildCurrentMarker('full', 0);
      await this.writeAnalysisMarkerToStore(initialMarker);
      this.mapLastVerifiedAt = initialMarker.lastVerifiedAt ?? initialMarker.analyzedAt;
      return 'no-changes';
    }

    const changes = await this.changeTracker.detectChanges(marker);

    logger.info(
      {
        method: changes.method,
        hasChanges: changes.hasChanges,
        changedCount: changes.changedFiles.length,
        deletedCount: changes.deletedFiles.length,
        tooLarge: changes.tooLargeForIncremental,
      },
      `Workspace change detection: ${changes.summary}`,
    );

    if (!changes.hasChanges) {
      // Update lastVerifiedAt to record this startup even if no changes detected
      const now = new Date().toISOString();
      await this.writeAnalysisMarkerToStore({ ...marker, lastVerifiedAt: now });
      this.mapLastVerifiedAt = now;
      return 'no-changes';
    }

    if (changes.tooLargeForIncremental) {
      return 'full-reexplore';
    }

    // Perform incremental exploration
    await this.incrementalExplore(existingMap, changes);
    return 'incremental';
  }

  /**
   * Perform an incremental exploration: send only the changed files to
   * the Master AI for a targeted map update.
   */
  private async incrementalExplore(
    existingMap: WorkspaceMap,
    changes: WorkspaceChanges,
  ): Promise<void> {
    this.state = 'exploring';

    const startedAt = new Date().toISOString();

    logger.info(
      {
        changedFiles: changes.changedFiles.length,
        deletedFiles: changes.deletedFiles.length,
      },
      'Starting incremental workspace exploration',
    );

    await this.dotFolder.appendLog({
      timestamp: startedAt,
      level: 'info',
      message: 'Incremental workspace exploration started',
      data: {
        method: changes.method,
        changedCount: changes.changedFiles.length,
        deletedCount: changes.deletedFiles.length,
        summary: changes.summary,
      },
    });

    try {
      // Mark affected memory chunks as stale so the search index reflects
      // that these directory scopes need refreshed data.
      if (this.memory) {
        const changedScopes = this.changeTracker.extractChangedScopes(
          changes.changedFiles,
          changes.deletedFiles,
        );
        if (changedScopes.length > 0) {
          try {
            await this.memory.markStale(changedScopes);
            logger.info({ changedScopes }, 'Marked stale memory scopes for incremental refresh');
          } catch (err) {
            logger.warn({ err }, 'Failed to mark stale scopes — continuing');
          }
        }
      }

      const prompt = generateIncrementalExplorationPrompt(
        this.workspacePath,
        existingMap,
        changes.changedFiles,
        changes.deletedFiles,
        changes.summary,
      );

      const spawnOpts = this.buildMasterSpawnOptions(prompt, this.explorationTimeout);
      // Scale maxTurns to change size — incremental is smaller scope
      spawnOpts.maxTurns = Math.min(
        MASTER_MAX_TURNS,
        Math.max(10, changes.changedFiles.length + 5),
      );

      const result = await this.agentRunner.spawn(spawnOpts);
      await this.updateMasterSession();

      if (result.exitCode !== 0) {
        throw new Error(
          `Incremental exploration failed (exit ${result.exitCode}): ${result.stderr}`,
        );
      }

      // Save the analysis marker with the current workspace state
      const totalChanged = changes.changedFiles.length + changes.deletedFiles.length;
      const newMarker = await this.changeTracker.buildCurrentMarker('incremental', totalChanged);
      await this.writeAnalysisMarkerToStore(newMarker);
      this.mapLastVerifiedAt = newMarker.lastVerifiedAt ?? newMarker.analyzedAt;

      // Reload the map into memory
      await this.loadExplorationSummary();

      // Update cached map summary
      const updatedMap = await this.readWorkspaceMapFromStore();
      if (updatedMap) {
        this.workspaceMapSummary = this.buildMapSummary(updatedMap);
      }

      // Re-explore any directories that were marked stale and store fresh chunks.
      // This replaces the stale memory data with up-to-date content without
      // triggering a full 5-phase re-exploration.
      if (this.memory) {
        const coordinator = new ExplorationCoordinator({
          workspacePath: this.workspacePath,
          masterTool: this.masterTool,
          discoveredTools: this.discoveredTools,
          memory: this.memory,
        });
        try {
          await coordinator.reexploreStaleDirs();
        } catch (err) {
          logger.warn({ err }, 'Stale dir re-exploration failed — continuing');
        }
      }

      await this.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Incremental exploration completed',
        data: { filesChanged: totalChanged, durationMs: result.durationMs },
      });

      logger.info(
        { filesChanged: totalChanged, durationMs: result.durationMs },
        'Incremental exploration completed',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'Incremental exploration failed — falling back to full re-explore',
        data: { error: errorMessage },
      });

      logger.warn(
        { error: errorMessage },
        'Incremental exploration failed, falling back to full re-exploration',
      );

      // Fall back to full exploration
      await this.explore();
    }
  }

  /**
   * Multi-agent exploration: delegates to ExplorationCoordinator which runs
   * a 5-phase pipeline with parallel directory dives. Falls back to a
   * single-agent monolithic approach if the coordinator fails.
   */
  private async masterDrivenExplore(): Promise<void> {
    logger.info('Starting multi-agent workspace exploration via ExplorationCoordinator');

    await this.dotFolder.appendLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Starting multi-agent workspace exploration',
      data: { workspacePath: this.workspacePath },
    });

    try {
      const coordinator = new ExplorationCoordinator({
        workspacePath: this.workspacePath,
        masterTool: this.masterTool,
        discoveredTools: this.discoveredTools,
        onProgress: async (event): Promise<void> => {
          await this.emitExplorationProgress(event);
        },
        memory: this.memory ?? undefined,
      });

      const summary = await coordinator.explore();

      // Write agents.json (coordinator writes its own, but ensure consistency)
      await this.writeAgentsRegistry();

      // Write analysis marker for incremental change detection on next startup
      const fullMarker = await this.changeTracker.buildCurrentMarker('full', 0);
      await this.writeAnalysisMarkerToStore(fullMarker);
      this.mapLastVerifiedAt = fullMarker.lastVerifiedAt ?? fullMarker.analyzedAt;

      // Load the workspace map into memory for system prompt injection
      await this.loadExplorationSummary();

      // Cache the map summary
      const map = await this.readWorkspaceMapFromStore();
      if (map) {
        this.workspaceMapSummary = this.buildMapSummary(map);
      }

      await this.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Multi-agent exploration completed',
        data: {
          directoriesExplored: summary.directoriesExplored,
          projectType: summary.projectType,
          frameworks: summary.frameworks,
        },
      });

      logger.info(
        {
          directoriesExplored: summary.directoriesExplored,
          projectType: summary.projectType,
        },
        'Multi-agent exploration completed successfully',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        { error: errorMessage },
        'Multi-agent exploration failed, falling back to monolithic exploration',
      );

      await this.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: 'Multi-agent exploration failed, falling back to monolithic exploration',
        data: { error: errorMessage },
      });

      await this.monolithicExplore();
    }
  }

  /**
   * Translate ExplorationCoordinator progress callbacks into ProgressEvents
   * and broadcast them to all connected connectors.
   */
  private async emitExplorationProgress(event: {
    phase: string;
    status: string;
    detail?: string;
    directoryProgress?: { completed: number; total: number; currentDir?: string };
  }): Promise<void> {
    const phaseLabels: Record<string, string> = {
      structure_scan: 'Scanning workspace structure',
      classification: 'Classifying project type',
      directory_dives: 'Exploring directories',
      assembly: 'Assembling workspace map',
      finalization: 'Finalizing exploration',
    };

    const phaseLabel = phaseLabels[event.phase] ?? event.phase;
    const statusSuffix = event.status === 'completed' ? ' (done)' : '...';

    logger.info(`${phaseLabel}${statusSuffix}`);

    // Broadcast to connectors if router is available
    if (this.router) {
      if (event.directoryProgress) {
        await this.router.broadcastProgress({
          type: 'exploring-directory',
          directory: event.directoryProgress.currentDir ?? '',
          completed: event.directoryProgress.completed,
          total: event.directoryProgress.total,
        });
      } else {
        await this.router.broadcastProgress({
          type: 'exploring',
          phase: phaseLabel,
          detail: event.detail,
        });
      }
    }
  }

  /**
   * Fallback: single-agent monolithic exploration via streaming.
   * Used when the multi-agent ExplorationCoordinator fails.
   */
  private async monolithicExplore(): Promise<void> {
    logger.info('Executing monolithic exploration via single agent');

    const explorationPrompt = `Explore the workspace at \`${this.workspacePath}\` and create a comprehensive understanding.

You are in charge of the exploration strategy. Use your tools (Read, Glob, Grep) to understand the project, then write your findings to \`.openbridge/workspace-map.json\` using the Write tool.

Follow the "Workspace Exploration" section in your system prompt for the schema and recommended strategy. Adapt the depth of exploration to the project's size and complexity.

Work silently — do not output conversational text, just explore and write the map file.`;

    const spawnOpts = this.buildMasterSpawnOptions(
      explorationPrompt,
      this.explorationTimeout,
      MASTER_MAX_TURNS,
    );

    const stream = this.agentRunner.stream(spawnOpts);

    // Consume the stream
    let iterResult = await stream.next();
    while (!iterResult.done) {
      iterResult = await stream.next();
    }

    const result = iterResult.value;
    await this.updateMasterSession();

    if (!result || result.exitCode !== 0) {
      const errorMessage = `Monolithic exploration failed with exit code ${result?.exitCode ?? 'unknown'}: ${result?.stderr ?? 'no error details'}`;
      throw new Error(errorMessage);
    }

    // Write agents.json
    await this.writeAgentsRegistry();

    // Write analysis marker for incremental change detection on next startup
    const fullMarker = await this.changeTracker.buildCurrentMarker('full', 0);
    await this.writeAnalysisMarkerToStore(fullMarker);
    this.mapLastVerifiedAt = fullMarker.lastVerifiedAt ?? fullMarker.analyzedAt;

    logger.info('Monolithic exploration completed successfully');

    await this.loadExplorationSummary();
  }

  /**
   * Write the agents.json registry based on discovered tools.
   */
  private async writeAgentsRegistry(): Promise<void> {
    const registry = this.createAgentsRegistry();
    await this.dotFolder.writeAgents(registry);
  }

  /**
   * Load exploration summary from the workspace map written by the Master.
   */
  private async loadExplorationSummary(): Promise<void> {
    const map = await this.readWorkspaceMapFromStore();

    if (map) {
      this.explorationSummary = {
        startedAt: map.generatedAt,
        completedAt: new Date().toISOString(),
        status: 'completed',
        filesScanned: 0,
        directoriesExplored: Object.keys(map.structure).length,
        projectType: map.projectType,
        frameworks: map.frameworks,
        insights: [],
        mapPath: this.dotFolder.getMapPath(),
        gitInitialized: true,
      };
    } else {
      // Master didn't write a map — still mark as completed with minimal info
      this.explorationSummary = {
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'completed',
        filesScanned: 0,
        directoriesExplored: 0,
        frameworks: [],
        insights: [],
        gitInitialized: true,
      };
    }
  }

  /**
   * Re-explore the workspace (e.g., after significant changes).
   * Uses the Master session to drive re-exploration, with a fallback to
   * a standalone AgentRunner call if no session is available.
   */
  public async reExplore(): Promise<void> {
    if (this.state !== 'ready') {
      logger.warn({ currentState: this.state }, 'Cannot re-explore: Master not in ready state');
      return;
    }

    const startedAt = new Date().toISOString();
    this.state = 'exploring';

    logger.info({ workspacePath: this.workspacePath }, 'Starting workspace re-exploration');

    try {
      // Log re-exploration start
      await this.dotFolder.appendLog({
        timestamp: startedAt,
        level: 'info',
        message: 'Workspace re-exploration started',
      });

      if (this.masterSession) {
        // Master-driven re-exploration via session
        const prompt = generateReExplorationPrompt(this.workspacePath);
        const spawnOpts = this.buildMasterSpawnOptions(prompt, this.explorationTimeout);
        const result = await this.agentRunner.spawn(spawnOpts);
        await this.updateMasterSession();

        if (result.exitCode !== 0) {
          throw new Error(
            `Re-exploration failed with exit code ${result.exitCode}: ${result.stderr}`,
          );
        }
      } else {
        // Fallback: standalone re-exploration with read-only tools
        const prompt = generateReExplorationPrompt(this.workspacePath);
        const result = await this.agentRunner.spawn({
          prompt,
          workspacePath: this.workspacePath,
          timeout: this.explorationTimeout,
          allowedTools: [...TOOLS_READ_ONLY],
          retries: 1,
        });

        if (result.exitCode !== 0) {
          throw new Error(
            `Re-exploration failed with exit code ${result.exitCode}: ${result.stderr}`,
          );
        }
      }

      // Update exploration summary from the map
      await this.loadExplorationSummary();

      // Log re-exploration completion
      await this.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Workspace re-exploration completed',
      });

      this.state = 'ready';

      logger.info('Workspace re-exploration completed');
    } catch (error) {
      logger.error({ err: error }, 'Workspace re-exploration failed');
      this.state = 'ready'; // Return to ready state even on failure
      throw error;
    }
  }

  /**
   * Reset the idle timer (called on each user message).
   * Tracks the timestamp of the last user interaction for idle detection.
   */
  private resetIdleTimer(): void {
    this.lastMessageTimestamp = Date.now();
  }

  /**
   * Drain messages that were queued during exploration.
   * Called after state transitions to 'ready'. Routes each queued message through
   * the Router (which sends the response back to the user's connector) if a router
   * is set, or processes silently and logs a warning if no router is available.
   */
  private async drainPendingMessages(): Promise<void> {
    if (this.pendingMessages.length === 0) return;

    const messages = [...this.pendingMessages];
    this.pendingMessages = [];

    logger.info({ count: messages.length }, 'Draining pending messages after exploration');

    for (const message of messages) {
      if (this.router) {
        try {
          await this.router.route(message);
        } catch (error) {
          logger.error({ error, sender: message.sender }, 'Failed to route pending message');
        }
      } else {
        logger.warn(
          { sender: message.sender },
          'No router set — pending message processed but response not delivered',
        );
        try {
          const response = await this.processMessage(message);
          logger.info(
            { sender: message.sender, responseLength: response.length },
            'Pending message processed (no router)',
          );
        } catch (error) {
          logger.error({ error, sender: message.sender }, 'Failed to process pending message');
        }
      }
    }
  }

  /**
   * Process a message from a user.
   * Uses the persistent Master session for conversation continuity.
   * All messages go through the same Master session regardless of sender.
   */
  public async processMessage(message: InboundMessage): Promise<string> {
    // Reset idle timer on new message
    this.resetIdleTimer();

    // Queue messages that arrive while the Master is exploring the workspace.
    // They will be processed once exploration completes and state transitions to 'ready'.
    if (this.state === 'exploring') {
      logger.info(
        { sender: message.sender },
        'Master is exploring workspace, queueing message for later processing',
      );
      this.pendingMessages.push(message);
      return "I'm still exploring your workspace. Your message will be processed once exploration completes.";
    }

    if (this.state !== 'ready') {
      logger.warn(
        { currentState: this.state, sender: message.sender },
        'Cannot process message: Master not ready',
      );
      return `The AI is currently ${this.state}. Please try again in a moment.`;
    }

    this.state = 'processing';

    const taskId = randomUUID();
    const startedAt = new Date().toISOString();

    logger.info({ taskId, sender: message.sender, content: message.content }, 'Processing message');

    // Create task record
    const task: TaskRecord = {
      id: taskId,
      userMessage: message.rawContent,
      sender: message.sender,
      description: message.content,
      status: 'processing',
      handledBy: 'master',
      createdAt: startedAt,
      startedAt,
      metadata: {
        messageId: message.id,
        source: message.source,
      },
    };

    // Build a ProgressReporter that maps events to the connector's sendProgress()
    const progress = this.makeProgressReporter(message.source, message.sender);

    // Stable session ID for grouping all turns of this conversation (OB-730)
    const sessionId = this.masterSession?.sessionId ?? taskId;

    try {
      // Record the inbound user message to conversation history (OB-730)
      await this.recordConversationMessage(
        sessionId,
        'user',
        message.content,
        message.source,
        message.sender,
      );

      // Check for status queries
      if (this.isStatusQuery(message.content)) {
        const status = await this.getStatus();
        this.state = 'ready';
        task.status = 'completed';
        task.result = status;
        task.completedAt = new Date().toISOString();
        task.durationMs =
          new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();
        await this.recordTaskToStore(task);
        return status;
      }

      // Retrieve relevant past conversation history to enrich the Master's context (OB-731)
      const conversationContext = await this.buildConversationContext(message.content);

      // (1) Emit classifying event — AI is analyzing the message
      await progress?.({ type: 'classifying' });

      // Classify message to determine appropriate turn budget
      const classification = await this.classifyTask(message.content);
      const taskClass = classification.class;
      const taskMaxTurns = classification.maxTurns;
      logger.info({ taskClass, taskMaxTurns, reason: classification.reason }, 'Message classified');

      // For complex tasks, send a planning prompt that forces the Master to output
      // SPAWN markers within a small turn budget instead of attempting execution itself.
      const promptToSend =
        taskClass === 'complex-task' ? this.buildPlanningPrompt(message.content) : message.content;
      // complex-task always uses planning turns; otherwise use AI-suggested budget
      const maxTurnsToUse =
        taskClass === 'complex-task' ? MESSAGE_MAX_TURNS_PLANNING : taskMaxTurns;

      if (taskClass === 'complex-task') {
        logger.info('Complex task — using planning prompt for auto-delegation');
        // (2) Emit planning event — Master is decomposing the task
        await progress?.({ type: 'planning' });
      }

      // Execute message through the persistent Master session
      const spawnOpts = this.buildMasterSpawnOptions(promptToSend, undefined, maxTurnsToUse);
      // Inject relevant conversation history into the Master's system prompt (OB-731)
      if (conversationContext) {
        spawnOpts.systemPrompt = (spawnOpts.systemPrompt ?? '') + '\n\n' + conversationContext;
      }
      let result = await this.agentRunner.spawn(spawnOpts);
      await this.updateMasterSession();

      // Detect dead session and restart transparently
      if (result.exitCode !== 0 && this.isSessionDead(result.exitCode, result.stderr)) {
        logger.warn(
          { exitCode: result.exitCode, stderr: result.stderr.slice(0, 200) },
          'Master session appears dead, attempting restart',
        );

        await this.restartMasterSession();

        // Retry with the same prompt (planning or raw) and the new session
        const retryOpts = this.buildMasterSpawnOptions(promptToSend, undefined, maxTurnsToUse);
        // Re-inject conversation history into retry opts as well
        if (conversationContext) {
          retryOpts.systemPrompt = (retryOpts.systemPrompt ?? '') + '\n\n' + conversationContext;
        }
        result = await this.agentRunner.spawn(retryOpts);
        await this.updateMasterSession();
      }

      if (result.exitCode !== 0) {
        throw new Error(`Message processing failed: ${result.stderr}`);
      }

      let response = result.stdout.trim() || 'No response from AI';

      // Check for SPAWN markers first (richer task decomposition protocol)
      if (hasSpawnMarkers(response)) {
        const spawnResult = parseSpawnMarkers(response);
        if (spawnResult.markers.length > 0) {
          logger.info({ spawnCount: spawnResult.markers.length }, 'SPAWN markers detected');

          task.status = 'delegated';
          await this.recordTaskToStore(task);

          const n = spawnResult.markers.length;

          // (3) Emit spawning event — N workers are being created
          await progress?.({ type: 'spawning', workerCount: n });

          // (4) Emit worker-progress events as each worker completes
          const feedbackPrompt = await this.handleSpawnMarkers(
            spawnResult.markers,
            async (completed: number, total: number): Promise<void> => {
              await progress?.({ type: 'worker-progress', completed, total });
            },
          );

          // (5) Emit synthesizing event — Master is combining worker results
          await progress?.({ type: 'synthesizing' });

          // Inject worker results back into the Master session
          this.state = 'processing';
          const feedbackOpts = this.buildMasterSpawnOptions(
            feedbackPrompt,
            undefined,
            MESSAGE_MAX_TURNS_SYNTHESIS,
          );
          result = await this.agentRunner.spawn(feedbackOpts);
          await this.updateMasterSession();

          if (result.exitCode !== 0) {
            throw new Error(`Worker feedback processing failed: ${result.stderr}`);
          }

          response = result.stdout.trim() || feedbackPrompt;
        }
      }

      // Check for legacy delegation markers (fallback)
      if (!hasSpawnMarkers(response)) {
        const delegations = this.parseDelegationMarkers(response);
        if (delegations && delegations.length > 0) {
          logger.info({ delegationCount: delegations.length }, 'Delegation markers detected');

          task.status = 'delegated';
          await this.recordTaskToStore(task);

          const delegationResults = await this.handleDelegations(delegations, message);

          const feedbackPrompt = `The following delegation results are available:\n\n${delegationResults}\n\nSummarize the delegation results into a clear, user-friendly response. If a file was created, tell the user its path and a brief description. Be concise.`;

          // Emit synthesizing event for legacy delegation path
          await progress?.({ type: 'synthesizing' });

          this.state = 'processing';
          const feedbackOpts = this.buildMasterSpawnOptions(
            feedbackPrompt,
            undefined,
            MESSAGE_MAX_TURNS_SYNTHESIS,
          );
          result = await this.agentRunner.spawn(feedbackOpts);
          await this.updateMasterSession();

          if (result.exitCode !== 0) {
            throw new Error(`Delegation feedback processing failed: ${result.stderr}`);
          }

          response = result.stdout.trim() || delegationResults;
        }
      }

      // Update task record
      task.status = 'completed';
      task.result = response;
      task.completedAt = new Date().toISOString();
      task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();

      await this.recordTaskToStore(task);

      // Record the Master AI response to conversation history (OB-730)
      await this.recordConversationMessage(sessionId, 'master', response);

      // Record classification feedback: task succeeded → turn budget was sufficient
      void this.recordClassificationFeedback(this.normalizeForCache(message.content), true, false);

      // Increment completed task counter and trigger prompt evolution every 50 tasks (OB-734)
      this.onTaskCompleted();

      this.state = 'ready';

      logger.info(
        { taskId, durationMs: task.durationMs, responseLength: response.length },
        'Message processed successfully',
      );

      // (6) Emit complete event — processing finished, status bar can be hidden
      await progress?.({ type: 'complete' });

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update task record with error
      task.status = 'failed';
      task.error = errorMessage;
      task.completedAt = new Date().toISOString();
      task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();

      await this.recordTaskToStore(task);

      // Record classification feedback: task failed — check if it was a timeout
      const timedOut =
        errorMessage.includes('SIGTERM') ||
        errorMessage.includes('SIGKILL') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('exit code 143') ||
        errorMessage.includes('exit code 137');
      void this.recordClassificationFeedback(
        this.normalizeForCache(message.content),
        false,
        timedOut,
      );

      this.state = 'ready';

      logger.error({ err: error, taskId, sender: message.sender }, 'Message processing failed');

      // Ensure complete event is always emitted so status bars are cleaned up
      await progress?.({ type: 'complete' });

      throw error;
    }
  }

  /**
   * Stream a message response, yielding chunks as they arrive.
   * Uses the persistent Master session for conversation continuity.
   */
  public async *streamMessage(message: InboundMessage): AsyncGenerator<string, void> {
    // Reset idle timer on new message
    this.resetIdleTimer();

    if (this.state !== 'ready') {
      logger.warn(
        { currentState: this.state, sender: message.sender },
        'Cannot stream message: Master not ready',
      );
      yield `The AI is currently ${this.state}. Please try again in a moment.`;
      return;
    }

    this.state = 'processing';

    const taskId = randomUUID();
    const startedAt = new Date().toISOString();

    logger.info({ taskId, sender: message.sender, content: message.content }, 'Streaming message');

    // Create task record
    const task: TaskRecord = {
      id: taskId,
      userMessage: message.rawContent,
      sender: message.sender,
      description: message.content,
      status: 'processing',
      handledBy: 'master',
      createdAt: startedAt,
      startedAt,
      metadata: {
        messageId: message.id,
        source: message.source,
      },
    };

    // Build a ProgressReporter that maps events to the connector's sendProgress()
    const streamProgress = this.makeProgressReporter(message.source, message.sender);

    // Stable session ID for grouping all turns of this conversation (OB-730)
    const streamSessionId = this.masterSession?.sessionId ?? taskId;

    try {
      // Record the inbound user message to conversation history (OB-730)
      await this.recordConversationMessage(
        streamSessionId,
        'user',
        message.content,
        message.source,
        message.sender,
      );

      // Check for status queries
      if (this.isStatusQuery(message.content)) {
        const status = await this.getStatus();
        this.state = 'ready';
        task.status = 'completed';
        task.result = status;
        task.completedAt = new Date().toISOString();
        task.durationMs =
          new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();
        await this.recordTaskToStore(task);
        yield status;
        return;
      }

      // Retrieve relevant past conversation history to enrich the Master's context (OB-731)
      const streamConversationContext = await this.buildConversationContext(message.content);

      // (1) Emit classifying event — AI is analyzing the message
      await streamProgress?.({ type: 'classifying' });

      // Classify message to determine appropriate turn budget and prompt
      const streamClassification = await this.classifyTask(message.content);
      const streamTaskClass = streamClassification.class;
      const streamPromptToSend =
        streamTaskClass === 'complex-task'
          ? this.buildPlanningPrompt(message.content)
          : message.content;
      // complex-task always uses planning turns; otherwise use AI-suggested budget
      const streamMaxTurns =
        streamTaskClass === 'complex-task'
          ? MESSAGE_MAX_TURNS_PLANNING
          : streamClassification.maxTurns;

      if (streamTaskClass === 'complex-task') {
        logger.info('Complex task — using planning prompt for auto-delegation (stream)');
        // (2) Emit planning event — Master is decomposing the task
        await streamProgress?.({ type: 'planning' });
      }

      // Stream message through the persistent Master session
      const spawnOpts = this.buildMasterSpawnOptions(streamPromptToSend, undefined, streamMaxTurns);
      // Inject relevant conversation history into the Master's system prompt (OB-731)
      if (streamConversationContext) {
        spawnOpts.systemPrompt =
          (spawnOpts.systemPrompt ?? '') + '\n\n' + streamConversationContext;
      }
      let fullResponse = '';
      const stream = this.agentRunner.stream(spawnOpts);

      let iterResult = await stream.next();
      while (!iterResult.done) {
        const chunk = iterResult.value;
        fullResponse += chunk;
        yield chunk;
        iterResult = await stream.next();
      }
      const streamResult = iterResult.value;
      await this.updateMasterSession();

      // Detect dead session and restart transparently
      if (
        streamResult.exitCode !== 0 &&
        this.isSessionDead(streamResult.exitCode, streamResult.stderr)
      ) {
        logger.warn(
          { exitCode: streamResult.exitCode, stderr: streamResult.stderr.slice(0, 200) },
          'Master session appears dead during streaming, attempting restart',
        );

        await this.restartMasterSession();

        // Retry with the same prompt (planning or raw) and the new session (streamed)
        const retryOpts = this.buildMasterSpawnOptions(
          streamPromptToSend,
          undefined,
          streamMaxTurns,
        );
        // Re-inject conversation history into retry opts as well
        if (streamConversationContext) {
          retryOpts.systemPrompt =
            (retryOpts.systemPrompt ?? '') + '\n\n' + streamConversationContext;
        }
        fullResponse = '';
        const retryStream = this.agentRunner.stream(retryOpts);

        let retryIter = await retryStream.next();
        while (!retryIter.done) {
          const chunk = retryIter.value;
          fullResponse += chunk;
          yield chunk;
          retryIter = await retryStream.next();
        }
        const retryResult = retryIter.value;
        await this.updateMasterSession();

        if (retryResult.exitCode !== 0) {
          throw new Error(`Stream failed after restart: ${retryResult.stderr}`);
        }
      } else if (streamResult.exitCode !== 0) {
        throw new Error(`Stream failed: ${streamResult.stderr}`);
      }

      // Check for SPAWN markers first (richer task decomposition protocol)
      if (hasSpawnMarkers(fullResponse)) {
        const spawnResult = parseSpawnMarkers(fullResponse);
        if (spawnResult.markers.length > 0) {
          logger.info(
            { spawnCount: spawnResult.markers.length },
            'SPAWN markers detected in stream',
          );

          task.status = 'delegated';
          await this.recordTaskToStore(task);

          const streamN = spawnResult.markers.length;

          // (3) Emit spawning event — N workers are being created
          await streamProgress?.({ type: 'spawning', workerCount: streamN });

          // Use progress-streaming variant if multiple workers are spawned
          let feedbackPrompt: string;
          if (spawnResult.markers.length > 1) {
            // Stream progress updates as workers complete, also emitting worker-progress events
            const progressGen = this.handleSpawnMarkersWithProgress(
              spawnResult.markers,
              async (completed: number, total: number): Promise<void> => {
                // (4) Emit worker-progress event per completed worker
                await streamProgress?.({ type: 'worker-progress', completed, total });
              },
            );
            let progressIter = await progressGen.next();
            while (!progressIter.done) {
              const progressChunk = progressIter.value;
              yield progressChunk;
              progressIter = await progressGen.next();
            }
            feedbackPrompt = progressIter.value;
          } else {
            // Single worker — emit worker-progress on completion
            feedbackPrompt = await this.handleSpawnMarkers(
              spawnResult.markers,
              async (completed: number, total: number): Promise<void> => {
                await streamProgress?.({ type: 'worker-progress', completed, total });
              },
            );
          }

          // (5) Emit synthesizing event — Master is combining worker results
          await streamProgress?.({ type: 'synthesizing' });

          // Inject worker results back into the Master session (streamed)
          this.state = 'processing';
          const feedbackOpts = this.buildMasterSpawnOptions(
            feedbackPrompt,
            undefined,
            MESSAGE_MAX_TURNS_SYNTHESIS,
          );
          const feedbackStream = this.agentRunner.stream(feedbackOpts);

          let finalResponse = '';
          let feedbackIter = await feedbackStream.next();
          while (!feedbackIter.done) {
            const chunk = feedbackIter.value;
            finalResponse += chunk;
            yield chunk;
            feedbackIter = await feedbackStream.next();
          }
          await this.updateMasterSession();

          fullResponse = finalResponse.trim() || feedbackPrompt;
        }
      }

      // Check for legacy delegation markers (fallback)
      if (!hasSpawnMarkers(fullResponse)) {
        const delegations = this.parseDelegationMarkers(fullResponse);
        if (delegations && delegations.length > 0) {
          logger.info(
            { delegationCount: delegations.length },
            'Delegation markers detected in stream',
          );

          task.status = 'delegated';
          await this.recordTaskToStore(task);

          const delegationResults = await this.handleDelegations(delegations, message);

          const feedbackPrompt = `The following delegation results are available:\n\n${delegationResults}\n\nSummarize the delegation results into a clear, user-friendly response. If a file was created, tell the user its path and a brief description. Be concise.`;

          // Emit synthesizing event for legacy delegation path
          await streamProgress?.({ type: 'synthesizing' });

          this.state = 'processing';
          const feedbackOpts = this.buildMasterSpawnOptions(
            feedbackPrompt,
            undefined,
            MESSAGE_MAX_TURNS_SYNTHESIS,
          );
          const feedbackStream = this.agentRunner.stream(feedbackOpts);

          let finalResponse = '';
          let feedbackIter = await feedbackStream.next();
          while (!feedbackIter.done) {
            const chunk = feedbackIter.value;
            finalResponse += chunk;
            yield chunk;
            feedbackIter = await feedbackStream.next();
          }
          await this.updateMasterSession();

          fullResponse = finalResponse.trim() || delegationResults;
        }
      }

      // Update task record
      task.status = 'completed';
      task.result = fullResponse.trim() || 'No response from AI';
      task.completedAt = new Date().toISOString();
      task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();

      await this.recordTaskToStore(task);

      // Record the Master AI response to conversation history (OB-730)
      await this.recordConversationMessage(streamSessionId, 'master', task.result);

      // Increment completed task counter and trigger prompt evolution every 50 tasks (OB-734)
      this.onTaskCompleted();

      this.state = 'ready';

      logger.info(
        { taskId, durationMs: task.durationMs, responseLength: fullResponse.length },
        'Message streamed successfully',
      );

      // (6) Emit complete event — processing finished, status bar can be hidden
      await streamProgress?.({ type: 'complete' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update task record with error
      task.status = 'failed';
      task.error = errorMessage;
      task.completedAt = new Date().toISOString();
      task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();

      await this.recordTaskToStore(task);

      this.state = 'ready';

      logger.error({ err: error, taskId, sender: message.sender }, 'Message streaming failed');

      // Ensure complete event is always emitted so status bars are cleaned up
      await streamProgress?.({ type: 'complete' });

      yield `Error: ${errorMessage}`;
    }
  }

  /**
   * Get system status
   */
  public async getStatus(): Promise<string> {
    const map = await this.readWorkspaceMapFromStore();
    const tasks = await this.readAllTasksFromStore();

    const completedTasks = tasks.filter((t) => t.status === 'completed').length;
    const failedTasks = tasks.filter((t) => t.status === 'failed').length;
    const processingTasks = tasks.filter(
      (t) => t.status === 'processing' || t.status === 'delegated',
    ).length;

    let status = `**OpenBridge Master AI Status**\n\n`;
    status += `State: ${this.state}\n`;

    // Show Master session info
    if (this.masterSession) {
      status += `Master Session: ${this.masterSession.sessionId}\n`;
      status += `Session Messages: ${this.masterSession.messageCount}\n`;
      if (this.restartCount > 0) {
        status += `Session Restarts: ${this.restartCount}\n`;
      }
    }

    // Show exploration status
    if (this.state === 'exploring') {
      status += `\nExploration: in progress (Master-driven)\n`;
    } else if (this.explorationSummary) {
      status += `Exploration: ${this.explorationSummary.status}\n`;
      if (this.explorationSummary.projectType) {
        status += `Project Type: ${this.explorationSummary.projectType}\n`;
      }
      if (this.explorationSummary.frameworks.length > 0) {
        status += `Frameworks: ${this.explorationSummary.frameworks.join(', ')}\n`;
      }
    }

    if (map) {
      status += `\nWorkspace: ${map.projectName}\n`;
      status += `Summary: ${map.summary}\n`;
    }

    status += `\nTasks: ${completedTasks} completed, ${failedTasks} failed, ${tasks.length} total\n`;

    // Show active delegations if any
    const activeDelegations = this.delegationCoordinator.getActiveDelegations();
    if (activeDelegations.length > 0) {
      status += `\nActive Delegations (${activeDelegations.length}):\n`;
      for (const delegation of activeDelegations) {
        const elapsed = Date.now() - new Date(delegation.startedAt).getTime();
        const elapsedSeconds = Math.floor(elapsed / 1000);
        status += `  - ${delegation.tool.name}: ${delegation.task.description.slice(0, 60)}... (${elapsedSeconds}s)\n`;
      }
    }

    // Show processing tasks if any
    if (processingTasks > 0) {
      status += `\nProcessing: ${processingTasks} task(s) in progress\n`;
    }

    return status;
  }

  /**
   * Start idle detection timer for self-improvement cycle (OB-173).
   * Checks every minute whether the Master has been idle for >5 minutes.
   * If idle, triggers a self-improvement cycle.
   */
  private startIdleDetection(): void {
    // Stop any existing timer
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
    }

    // Set initial timestamp
    this.lastMessageTimestamp = Date.now();

    // Start periodic idle check
    this.idleCheckTimer = setInterval(() => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.checkIdleAndImprove();
    }, IDLE_CHECK_INTERVAL_MS);

    logger.info('Idle detection timer started for self-improvement cycle');
  }

  /**
   * Stop idle detection timer (called on shutdown).
   */
  private stopIdleDetection(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer);
      this.idleCheckTimer = null;
      logger.info('Idle detection timer stopped');
    }
  }

  /**
   * Check if Master is idle and trigger self-improvement if needed.
   * Called periodically by the idle detection timer.
   */
  private async checkIdleAndImprove(): Promise<void> {
    // Skip if:
    // - Already running self-improvement
    // - Not in ready state
    // - No message timestamp yet
    if (this.isSelfImproving || this.state !== 'ready' || !this.lastMessageTimestamp) {
      return;
    }

    const idleTime = Date.now() - this.lastMessageTimestamp;

    // Check if idle threshold exceeded
    if (idleTime >= IDLE_THRESHOLD_MS) {
      logger.info(
        { idleTimeMs: idleTime },
        'Idle threshold exceeded, starting self-improvement cycle',
      );

      try {
        await this.runSelfImprovementCycle();
      } catch (error) {
        logger.error({ err: error }, 'Self-improvement cycle failed');
      }

      // Reset last message timestamp to prevent immediate re-trigger
      this.lastMessageTimestamp = Date.now();
    }
  }

  /**
   * Run the self-improvement cycle (OB-173).
   * Reviews learnings and performs improvements:
   * 1. Update prompts with low success rates
   * 2. Create new custom profiles for recurring task patterns
   * 3. Update workspace-map.json if project has changed
   */
  private async runSelfImprovementCycle(): Promise<void> {
    if (this.isSelfImproving) {
      logger.warn('Self-improvement cycle already running');
      return;
    }

    this.isSelfImproving = true;
    const startedAt = new Date().toISOString();

    logger.info('Starting self-improvement cycle');

    try {
      await this.dotFolder.appendLog({
        timestamp: startedAt,
        level: 'info',
        message: 'Self-improvement cycle started',
        data: {},
      });

      // Task 1: Identify and rewrite low-performing prompts
      const lowPerformingPrompts = await this.dotFolder.getLowPerformingPrompts(0.5);
      if (lowPerformingPrompts.length > 0) {
        logger.info(
          { promptCount: lowPerformingPrompts.length },
          'Found low-performing prompts to rewrite',
        );

        for (const prompt of lowPerformingPrompts) {
          await this.rewritePrompt(prompt);
        }
      }

      // Task 2: Analyze learnings for recurring task patterns and create custom profiles
      await this.createProfilesFromLearnings();

      // Task 3: Check if workspace has changed and update map if needed
      await this.updateWorkspaceMapIfChanged();

      await this.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Self-improvement cycle completed',
        data: {
          lowPerformingPrompts: lowPerformingPrompts.length,
          durationMs: new Date().getTime() - new Date(startedAt).getTime(),
        },
      });

      logger.info('Self-improvement cycle completed successfully');
    } catch (error) {
      logger.error({ err: error }, 'Self-improvement cycle encountered an error');

      await this.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'Self-improvement cycle failed',
        data: { error: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      this.isSelfImproving = false;
    }
  }

  /**
   * Rewrite a low-performing prompt using the Master AI session.
   * Asks the Master to analyze the prompt's failure patterns and suggest improvements.
   */
  private async rewritePrompt(prompt: PromptTemplate): Promise<void> {
    logger.info(
      { promptId: prompt.id, successRate: prompt.successRate, usageCount: prompt.usageCount },
      'Rewriting low-performing prompt',
    );

    try {
      // Read the current prompt content from disk
      const promptPath = path.join(this.dotFolder.getDotFolderPath(), 'prompts', prompt.filePath);
      const currentContent = await fs.readFile(promptPath, 'utf-8');

      // Build a self-improvement prompt for the Master
      const improvementPrompt = `You are reviewing your own prompt templates for effectiveness.

The following prompt template has a low success rate and needs to be rewritten:

**Prompt ID:** ${prompt.id}
**Description:** ${prompt.description}
**Success Rate:** ${(prompt.successRate ?? 0) * 100}% (${prompt.successCount}/${prompt.usageCount} uses)
**Current Content:**
\`\`\`
${currentContent}
\`\`\`

**Task:** Rewrite this prompt to improve its effectiveness. Focus on:
1. Clarity of instructions
2. Explicit output format requirements
3. Error handling guidance
4. Context that helps the worker succeed

**Output Format:** Return ONLY the rewritten prompt content (no explanations, no markdown fences, just the raw prompt text).`;

      const spawnOpts = this.buildMasterSpawnOptions(improvementPrompt, this.messageTimeout);
      const result = await this.agentRunner.spawn(spawnOpts);
      await this.updateMasterSession();

      if (result.exitCode !== 0) {
        logger.warn({ promptId: prompt.id, exitCode: result.exitCode }, 'Failed to rewrite prompt');
        return;
      }

      const rewrittenContent = result.stdout.trim();

      if (rewrittenContent.length === 0) {
        logger.warn({ promptId: prompt.id }, 'Master returned empty prompt rewrite');
        return;
      }

      // Update the prompt file
      await fs.writeFile(promptPath, rewrittenContent, 'utf-8');

      // Reset the prompt's usage stats (fresh start with new version)
      await this.dotFolder.resetPromptStats(prompt.id);

      logger.info({ promptId: prompt.id }, 'Successfully rewrote prompt');
    } catch (error) {
      logger.error({ err: error, promptId: prompt.id }, 'Failed to rewrite prompt (non-blocking)');
    }
  }

  /**
   * Analyze learnings to identify recurring task patterns and create custom profiles.
   * For example: if "test-runner" tasks consistently succeed with specific tools,
   * create a "test-runner" profile.
   */
  private async createProfilesFromLearnings(): Promise<void> {
    // Build a list of { taskType, successCount, failureCount, successRate } from either memory or JSON.
    type TaskTypeStat = {
      taskType: string;
      successCount: number;
      failureCount: number;
      successRate: number;
    };
    let taskTypeStats: TaskTypeStat[] = [];

    if (this.memory) {
      try {
        const rows = await this.memory.getLearnedTaskTypes();
        taskTypeStats = rows.map((r) => ({
          taskType: r.taskType,
          successCount: r.successCount,
          failureCount: r.failureCount,
          successRate: r.successRate,
        }));
      } catch {
        return;
      }
    } else {
      const learnings = await this.dotFolder.readLearnings();
      if (!learnings || learnings.entries.length < 10) {
        return;
      }
      logger.info(
        { learningCount: learnings.entries.length },
        'Analyzing learnings for profile patterns',
      );
      const byTaskType = new Map<string, typeof learnings.entries>();
      for (const entry of learnings.entries) {
        const existing = byTaskType.get(entry.taskType) ?? [];
        existing.push(entry);
        byTaskType.set(entry.taskType, existing);
      }
      for (const [taskType, entries] of byTaskType) {
        const successCount = entries.filter((e) => e.success).length;
        taskTypeStats.push({
          taskType,
          successCount,
          failureCount: entries.length - successCount,
          successRate: successCount / entries.length,
        });
      }
    }

    const totalEntries = taskTypeStats.reduce((s, r) => s + r.successCount + r.failureCount, 0);
    if (totalEntries < 10) {
      return;
    }

    // Look for task types with >5 total executions and >70% success rate
    for (const stat of taskTypeStats) {
      const total = stat.successCount + stat.failureCount;
      if (total < 5) continue;
      if (stat.successRate < 0.7) continue;

      // Check if a profile already exists for this task type
      const existingProfiles = await this.dotFolder.readProfiles();
      const profileId = `auto-${stat.taskType}`;
      if (existingProfiles?.profiles[profileId]) continue;

      // Default to 'code-edit' profile for auto-generated profiles
      const baseProfileName = 'code-edit';
      const builtInProfile = BUILT_IN_PROFILES[baseProfileName as keyof typeof BUILT_IN_PROFILES];
      if (!builtInProfile) continue;

      logger.info(
        {
          taskType: stat.taskType,
          profileId,
          successRate: stat.successRate,
          totalExecutions: total,
        },
        'Creating custom profile from learning patterns',
      );

      const newProfile: ToolProfile = {
        name: profileId,
        description: `Auto-generated profile for ${stat.taskType} tasks (success rate: ${(stat.successRate * 100).toFixed(1)}%)`,
        tools: [...builtInProfile.tools],
      };

      try {
        await this.dotFolder.addProfile(newProfile);
        logger.info({ profileId }, 'Successfully created custom profile from learnings');
      } catch (error) {
        logger.error({ err: error, profileId }, 'Failed to create custom profile (non-blocking)');
      }
    }
  }

  /**
   * Check if the workspace has changed significantly and update workspace-map.json if needed.
   * Detects changes by checking for new files, modified package.json, new directories, etc.
   */
  private async updateWorkspaceMapIfChanged(): Promise<void> {
    const map = await this.readWorkspaceMapFromStore();
    if (!map) {
      // No map to update
      return;
    }

    logger.info('Checking if workspace has changed significantly');

    // Check for significant changes:
    // 1. New top-level directories
    // 2. package.json modifications (dependencies changed)
    // 3. New frameworks detected

    try {
      const packageJsonPath = path.join(this.workspacePath, 'package.json');
      let hasPackageJsonChanged = false;

      try {
        const stats = await fs.stat(packageJsonPath);
        const mapGeneratedTime = new Date(map.generatedAt).getTime();
        const packageModifiedTime = stats.mtimeMs;

        hasPackageJsonChanged = packageModifiedTime > mapGeneratedTime;
      } catch {
        // package.json doesn't exist or can't be read
        hasPackageJsonChanged = false;
      }

      if (hasPackageJsonChanged) {
        logger.info(
          'package.json has changed since last map generation, triggering re-exploration',
        );
        await this.reExplore();
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to check workspace changes (non-blocking)');
    }
  }

  /**
   * Gracefully shut down the Master AI
   */
  public async shutdown(): Promise<void> {
    if (this.state === 'shutdown') {
      return;
    }

    logger.info('Shutting down MasterManager');

    this.state = 'shutdown';

    // Stop idle detection timer
    this.stopIdleDetection();

    // Shutdown delegation coordinator
    this.delegationCoordinator.shutdown();

    // Persist Master session before shutdown
    if (this.masterSession) {
      try {
        await this.saveMasterSessionToStore(this.masterSession);
      } catch (error) {
        logger.warn({ error }, 'Failed to persist Master session on shutdown');
      }
    }

    // Log shutdown
    try {
      await this.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Master AI shutting down',
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to log shutdown');
    }

    logger.info('MasterManager shutdown complete');
  }

  /**
   * Return the default maxTurns for a worker based on its profile.
   *
   * Profile-based defaults ensure workers have enough room to complete their
   * tasks without being cut off mid-execution:
   *   - code-edit / full-access: 15 turns (need to read context + write files)
   *   - read-only:               10 turns (exploration only, no file writes)
   *   - other / unknown:         DEFAULT_MAX_TURNS_TASK (25)
   */
  private defaultMaxTurnsForProfile(profile: string): number {
    if (profile === 'code-edit' || profile === 'full-access') return 15;
    if (profile === 'read-only') return 10;
    return DEFAULT_MAX_TURNS_TASK;
  }

  /**
   * Handle SPAWN markers found in Master output.
   * Spawns worker agents via AgentRunner based on parsed task manifests,
   * collects results, and returns a structured feedback prompt for injection
   * into the Master session.
   *
   * Workers are tracked in the WorkerRegistry with full lifecycle management:
   * pending → running → completed/failed. The registry enforces concurrency
   * limits and persists to .openbridge/workers.json for cross-restart visibility.
   *
   * Worker results include metadata (model, profile, duration, exit code)
   * so the Master can reason about what happened and synthesize a response.
   *
   * @param onProgress - Optional callback invoked after each worker completes.
   *   Receives (completedCount, totalCount) so the caller can send progress updates.
   */
  private async handleSpawnMarkers(
    markers: ParsedSpawnMarker[],
    onProgress?: (completed: number, total: number) => Promise<void>,
  ): Promise<string> {
    // Load custom profiles once for all workers
    const customProfilesRegistry = await this.dotFolder.readProfiles();
    const customProfiles = customProfilesRegistry?.profiles;

    // Register all workers in the registry BEFORE spawning
    // This checks concurrency limits and creates worker records
    const workerIds: string[] = [];
    const workerManifests = markers.map((marker) => ({
      prompt: marker.body.prompt,
      workspacePath: this.workspacePath,
      profile: marker.profile,
      model: marker.body.model,
      maxTurns: marker.body.maxTurns ?? this.defaultMaxTurnsForProfile(marker.profile),
      timeout: marker.body.timeout,
      retries: marker.body.retries,
      maxBudgetUsd: marker.body.maxBudgetUsd,
    }));

    for (const manifest of workerManifests) {
      try {
        const workerId = this.workerRegistry.addWorker(manifest);
        workerIds.push(workerId);
      } catch (error) {
        // Max concurrency reached — log and skip this worker
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to register worker (concurrency limit reached)',
        );
        // Add a placeholder so indices match
        workerIds.push('');
      }
    }

    // Persist registry after adding workers
    await this.persistWorkerRegistry();

    // Count only workers that were actually registered (not skipped)
    const total = workerIds.filter((id) => id !== '').length;
    let completedCount = 0;

    // Spawn all workers concurrently via Promise.allSettled
    const workerPromises = markers.map((marker, index) => {
      const workerId = workerIds[index];
      if (!workerId) {
        // Worker was skipped due to concurrency limit
        return Promise.resolve({
          exitCode: 1,
          stdout: '',
          stderr: 'Worker skipped: concurrency limit reached',
          durationMs: 0,
          retryCount: 0,
        } as AgentResult);
      }
      const workerPromise = this.spawnWorker(workerId, marker, index, customProfiles);
      if (onProgress) {
        return workerPromise.then(async (result) => {
          completedCount++;
          await onProgress(completedCount, total);
          return result;
        });
      }
      return workerPromise;
    });

    const settled = await Promise.allSettled(workerPromises);

    // Persist registry after all workers complete
    await this.persistWorkerRegistry();

    // Format all results with structured metadata and build the feedback prompt
    const { feedbackPrompt } = formatWorkerBatch(settled, markers);
    return feedbackPrompt;
  }

  /**
   * Handle SPAWN markers with progress streaming.
   * Yields progress updates as workers complete, allowing the user to see
   * real-time status (e.g., "Working on it... (3/5 subtasks done)").
   *
   * Returns the final feedback prompt after all workers complete.
   */
  private async *handleSpawnMarkersWithProgress(
    markers: ParsedSpawnMarker[],
    onProgress?: (completed: number, total: number) => Promise<void>,
  ): AsyncGenerator<string, string> {
    // Load custom profiles once for all workers
    const customProfilesRegistry = await this.dotFolder.readProfiles();
    const customProfiles = customProfilesRegistry?.profiles;

    // Register all workers in the registry BEFORE spawning
    const workerIds: string[] = [];
    const workerManifests = markers.map((marker) => ({
      prompt: marker.body.prompt,
      workspacePath: this.workspacePath,
      profile: marker.profile,
      model: marker.body.model,
      maxTurns: marker.body.maxTurns ?? this.defaultMaxTurnsForProfile(marker.profile),
      timeout: marker.body.timeout,
      retries: marker.body.retries,
      maxBudgetUsd: marker.body.maxBudgetUsd,
    }));

    for (const manifest of workerManifests) {
      try {
        const workerId = this.workerRegistry.addWorker(manifest);
        workerIds.push(workerId);
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          'Failed to register worker (concurrency limit reached)',
        );
        workerIds.push('');
      }
    }

    await this.persistWorkerRegistry();

    // Yield initial progress message
    const totalWorkers = workerIds.filter((id) => id !== '').length;
    yield `\n\n_[Starting ${totalWorkers} parallel subtasks...]_\n`;

    let progressCompletedCount = 0;

    // Spawn all workers concurrently
    const workerPromises = markers.map((marker, index) => {
      const workerId = workerIds[index];
      if (!workerId) {
        return Promise.resolve({
          exitCode: 1,
          stdout: '',
          stderr: 'Worker skipped: concurrency limit reached',
          durationMs: 0,
          retryCount: 0,
        } as AgentResult);
      }
      const workerPromise = this.spawnWorker(workerId, marker, index, customProfiles);
      if (onProgress) {
        return workerPromise.then(async (result) => {
          progressCompletedCount++;
          await onProgress(progressCompletedCount, totalWorkers);
          return result;
        });
      }
      return workerPromise;
    });

    // Wait for all workers to complete
    const finalSettled = await Promise.allSettled(workerPromises);

    // Yield final progress message
    const completedCount = finalSettled.filter(
      (r) => r.status === 'fulfilled' && r.value.exitCode === 0,
    ).length;
    yield `\n\n_[All subtasks complete: ${completedCount}/${totalWorkers} successful]_\n`;

    await this.persistWorkerRegistry();

    // Format all results and build the feedback prompt
    const { feedbackPrompt } = formatWorkerBatch(finalSettled, markers);
    return feedbackPrompt;
  }

  /**
   * Spawn a single worker from a parsed SPAWN marker.
   * Resolves the profile to tools via AgentRunner's manifest resolution.
   * Tracks the worker lifecycle in the registry: pending → running → completed/failed.
   * Logs each worker execution to .openbridge/tasks/ for audit trail and learning.
   *
   * **Depth Limiting (OB-164):**
   * Workers are spawned WITHOUT sessionId, so they get --print mode (single-turn, stateless).
   * This enforces maxSpawnDepth=1 — only the Master can spawn workers, workers cannot spawn.
   */
  private async spawnWorker(
    workerId: string,
    marker: ParsedSpawnMarker,
    index: number,
    customProfiles?: Record<string, ToolProfile>,
  ): Promise<AgentResult> {
    const { profile, body } = marker;

    logger.info(
      {
        workerId,
        workerIndex: index,
        profile,
        model: body.model,
        maxTurns: body.maxTurns,
        promptLength: body.prompt.length,
      },
      'Spawning worker from SPAWN marker',
    );

    // Adaptive model selection (OB-724): marker override → learned best model → heuristics
    let resolvedModel = body.model;
    if (!resolvedModel && this.memory) {
      const taskType = this.classifyTaskType(body.prompt);
      const learned = await getRecommendedModel(this.memory, taskType);
      if (learned) {
        resolvedModel = learned.model;
        logger.debug(
          { workerId, model: learned.model, reason: learned.reason },
          'Adaptive model selected for worker',
        );
      }
    }

    // NOTE: No sessionId provided here — workers get --print mode (depth limiting)
    const spawnOpts = manifestToSpawnOptions(
      {
        prompt: body.prompt,
        workspacePath: this.workspacePath,
        profile,
        model: resolvedModel,
        maxTurns: body.maxTurns ?? this.defaultMaxTurnsForProfile(profile),
        timeout: body.timeout,
        retries: body.retries,
        maxBudgetUsd: body.maxBudgetUsd,
      },
      customProfiles,
    );

    // Create task record for this worker execution (OB-165: task history + audit trail)
    const taskRecord: TaskRecord = {
      id: workerId,
      userMessage: body.prompt,
      sender: 'master',
      description: `Worker ${index}: ${body.prompt.slice(0, 100)}`,
      status: 'processing',
      handledBy: 'worker',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      metadata: {
        workerIndex: index,
        profile,
        model: body.model,
        maxTurns: body.maxTurns,
        timeout: body.timeout,
        retries: body.retries,
        manifest: {
          prompt: body.prompt,
          workspacePath: this.workspacePath,
          profile,
          model: body.model,
          maxTurns: body.maxTurns,
          timeout: body.timeout,
          retries: body.retries,
        },
      },
    };

    // Inject memory briefing as system prompt so the worker starts with project context (OB-723)
    if (this.memory) {
      try {
        const briefing = await this.memory.buildBriefing(body.prompt);
        if (briefing) {
          spawnOpts.systemPrompt = briefing;
        }
      } catch (briefingErr) {
        logger.warn(
          { workerId, error: briefingErr },
          'Failed to build worker briefing — proceeding without context',
        );
      }
    }

    try {
      // Note: We cannot get the actual PID from spawn() because it's an async call
      // that returns a promise. We mark it as running without a PID for now.
      // A future enhancement could expose the child process from AgentRunner.
      this.workerRegistry.markRunning(workerId, -1); // -1 indicates PID not available

      const result = await this.agentRunner.spawn(spawnOpts);

      // Update registry based on result
      if (result.exitCode === 0) {
        this.workerRegistry.markCompleted(workerId, result);
      } else {
        // Check if this is a timeout failure (SIGTERM = 143, SIGKILL = 137)
        const isTimeout = result.exitCode === 143 || result.exitCode === 137;
        const errorMessage = isTimeout
          ? `Worker timeout: process terminated after ${body.timeout ?? 'default'}ms (exit code ${result.exitCode})`
          : `Exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`;

        if (isTimeout) {
          logger.warn(
            {
              workerId,
              exitCode: result.exitCode,
              timeout: body.timeout,
              durationMs: result.durationMs,
            },
            'Worker terminated due to timeout',
          );
        }

        this.workerRegistry.markFailed(workerId, result, errorMessage);
      }

      // Persist registry after worker completion or failure
      await this.persistWorkerRegistry();

      // Update task record with result (OB-165)
      taskRecord.status = result.exitCode === 0 ? 'completed' : 'failed';
      taskRecord.result = result.exitCode === 0 ? result.stdout : undefined;
      taskRecord.error = result.exitCode === 0 ? undefined : result.stderr;
      taskRecord.completedAt = new Date().toISOString();
      taskRecord.durationMs = result.durationMs;
      taskRecord.metadata = {
        ...taskRecord.metadata,
        exitCode: result.exitCode,
        retryCount: result.retryCount,
        modelUsed: result.model,
        modelFallbacks: result.modelFallbacks,
        resolvedTools: spawnOpts.allowedTools,
      };

      // Write worker task to store (memory or JSON file) (OB-165: task history + audit trail)
      if (this.memory) {
        const statusMap: Record<string, MemoryTaskRecord['status']> = {
          completed: 'completed',
          failed: 'failed',
        };
        await this.memory.recordTask({
          id: taskRecord.id,
          type: 'worker',
          status: statusMap[taskRecord.status] ?? 'failed',
          prompt: taskRecord.userMessage,
          response: taskRecord.result,
          model: (taskRecord.metadata?.['modelUsed'] as string | undefined) ?? spawnOpts.model,
          profile,
          duration_ms: taskRecord.durationMs,
          exit_code: (taskRecord.metadata?.['exitCode'] as number | undefined) ?? result.exitCode,
          retries: result.retryCount,
          created_at: taskRecord.createdAt,
          completed_at: taskRecord.completedAt,
        });
      } else {
        await this.dotFolder.writeTask(taskRecord);
      }

      // Record worker output to conversation history (OB-730)
      if (result.exitCode === 0 && result.stdout.trim()) {
        const workerSessionId = this.masterSession?.sessionId ?? workerId;
        await this.recordConversationMessage(workerSessionId, 'worker', result.stdout.trim());
      }

      // Record learning entry for this worker execution (OB-171: learnings store)
      await this.recordWorkerLearning(taskRecord, result, profile, spawnOpts.model);

      // Record prompt effectiveness (OB-172: prompt effectiveness tracking)
      await this.recordPromptEffectiveness(taskRecord, result);

      return result;
    } catch (error) {
      // Worker threw an exception (spawn error, exhausted retries, etc.)
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedResult: AgentResult = {
        exitCode: -1,
        stdout: '',
        stderr: errorMessage,
        durationMs: 0,
        retryCount: 0,
      };

      this.workerRegistry.markFailed(workerId, failedResult, errorMessage);

      // Persist registry after exception
      await this.persistWorkerRegistry();

      // Update task record with error (OB-165)
      taskRecord.status = 'failed';
      taskRecord.error = errorMessage;
      taskRecord.completedAt = new Date().toISOString();
      taskRecord.durationMs = 0;
      taskRecord.metadata = {
        ...taskRecord.metadata,
        exitCode: -1,
        retryCount: 0,
        exceptionThrown: true,
      };

      // Write worker task to store (memory or JSON file) even on exception (OB-165)
      if (this.memory) {
        await this.memory.recordTask({
          id: taskRecord.id,
          type: 'worker',
          status: 'failed',
          prompt: taskRecord.userMessage,
          model: taskRecord.metadata?.['modelUsed'] as string | undefined,
          profile,
          duration_ms: 0,
          exit_code: -1,
          retries: 0,
          created_at: taskRecord.createdAt,
          completed_at: taskRecord.completedAt,
        });
      } else {
        await this.dotFolder.writeTask(taskRecord);
      }

      // Record learning entry even on exception (OB-171: learnings store)
      await this.recordWorkerLearning(taskRecord, failedResult, profile, body.model);

      // Record prompt effectiveness even on exception (OB-172: prompt effectiveness tracking)
      await this.recordPromptEffectiveness(taskRecord, failedResult);

      // Re-throw so Promise.allSettled captures it as rejected
      throw error;
    }
  }

  /**
   * Parse delegation markers from Master AI output.
   * Format: [DELEGATE:tool-name]prompt text[/DELEGATE]
   *
   * Returns parsed delegations or null if none found.
   */
  private parseDelegationMarkers(
    response: string,
  ): Array<{ toolName: string; prompt: string }> | null {
    const delegationPattern = /\[DELEGATE:([^\]]+)\]([\s\S]*?)\[\/DELEGATE\]/g;
    const delegations: Array<{ toolName: string; prompt: string }> = [];

    let match;
    while ((match = delegationPattern.exec(response)) !== null) {
      const toolName = match[1]?.trim();
      const prompt = match[2]?.trim();
      if (toolName && prompt) {
        delegations.push({ toolName, prompt });
      }
    }

    return delegations.length > 0 ? delegations : null;
  }

  /**
   * Find a specialist tool by name from the agents registry
   */
  private async findSpecialistTool(toolName: string): Promise<DiscoveredTool | null> {
    // First check discovered tools
    const tool = this.discoveredTools.find(
      (t) =>
        t.name.toLowerCase() === toolName.toLowerCase() ||
        t.name.toLowerCase().includes(toolName.toLowerCase()),
    );

    if (tool) {
      return tool;
    }

    // Check agents.json as fallback
    const agents = await this.dotFolder.readAgents();
    if (!agents) {
      return null;
    }

    const specialist = agents.specialists.find(
      (s) =>
        s.name.toLowerCase() === toolName.toLowerCase() ||
        s.name.toLowerCase().includes(toolName.toLowerCase()),
    );

    if (specialist) {
      // Convert specialist to DiscoveredTool format
      return {
        name: specialist.name,
        path: specialist.path,
        version: specialist.version,
        available: true,
        role: specialist.role,
        capabilities: specialist.capabilities,
      };
    }

    return null;
  }

  /**
   * Handle delegations found in Master AI output.
   * Executes delegations and returns results to feed back to Master.
   */
  private async handleDelegations(
    delegations: Array<{ toolName: string; prompt: string }>,
    message: InboundMessage,
  ): Promise<string> {
    const results: string[] = [];

    for (const delegation of delegations) {
      logger.info(
        { toolName: delegation.toolName, prompt: delegation.prompt.slice(0, 100) },
        'Handling delegation request',
      );

      // Find the specialist tool
      const tool = await this.findSpecialistTool(delegation.toolName);
      if (!tool) {
        const errorMsg = `Tool "${delegation.toolName}" not found in available specialists`;
        logger.warn({ toolName: delegation.toolName }, errorMsg);
        results.push(`[DELEGATION ERROR: ${errorMsg}]`);
        continue;
      }

      // Execute delegation
      this.state = 'delegating';
      const result = await this.delegationCoordinator.delegate({
        prompt: delegation.prompt,
        workspacePath: this.workspacePath,
        tool,
        sender: message.sender,
        userMessage: message.rawContent,
      });

      if (result.success) {
        results.push(
          `[DELEGATION RESULT from ${tool.name}]\n${result.response}\n[/DELEGATION RESULT]`,
        );
      } else {
        results.push(`[DELEGATION ERROR from ${tool.name}]\n${result.error}\n[/DELEGATION ERROR]`);
      }
    }

    return results.join('\n\n');
  }

  /**
   * Check if a message is a status query
   */
  private isStatusQuery(content: string): boolean {
    const normalized = content.toLowerCase().trim();
    return (
      normalized === 'status' ||
      normalized === 'progress' ||
      normalized.includes('what is your status') ||
      normalized.includes('how are you doing') ||
      normalized.includes('exploration status')
    );
  }

  /**
   * Create agents registry from discovered tools
   */
  private createAgentsRegistry(): AgentsRegistry {
    const master = this.masterTool;
    const specialists = this.discoveredTools
      .filter((tool) => tool.role === 'specialist' || tool.role === 'backup')
      .map((tool) => ({
        name: tool.name,
        path: tool.path,
        version: tool.version,
        role: tool.role as 'specialist' | 'backup',
        capabilities: tool.capabilities,
      }));

    return {
      master: {
        name: master.name,
        path: master.path,
        version: master.version,
        role: 'master',
      },
      specialists,
      updatedAt: new Date().toISOString(),
    };
  }
}
