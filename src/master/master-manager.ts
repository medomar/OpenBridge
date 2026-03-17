import { BatchManager } from './batch-manager.js';
import { BUILT_IN_SKILLS } from './skills/index.js';
import { BUILT_IN_SKILL_PACKS } from './skill-packs/index.js';
import {
  ClassificationEngine,
  classifyTaskType,
  turnsToTimeout,
  // MESSAGE_MAX_TURNS_QUICK moved to prompt-context-builder.ts (OB-1282)
  MESSAGE_MAX_TURNS_TOOL_USE,
  MESSAGE_MAX_TURNS_PLANNING,
} from './classification-engine.js';
import type { ClassificationResult } from './classification-engine.js';
// Re-export for backward compatibility — consumers import from master-manager.ts (OB-1279)
export type { ClassificationResult } from './classification-engine.js';
import { DotFolderManager } from './dotfolder-manager.js';
import { ExplorationManager } from './exploration-manager.js';
// Re-export for backward compatibility (OB-1280)
export type { ExplorationManagerDeps } from './exploration-manager.js';
import { WorkerOrchestrator } from './worker-orchestrator.js';
// Re-export for backward compatibility (OB-1281)
export type { WorkerOrchestratorDeps } from './worker-orchestrator.js';
import { PromptContextBuilder, SECTION_BUDGET_RAG } from './prompt-context-builder.js';
// Re-export for backward compatibility (OB-1282)
export type { PromptContextBuilderDeps, MasterContextSections } from './prompt-context-builder.js';
// predictToolRequirements, detectToolAccessFailure, ToolAccessFailure, ToolPrediction
// moved to worker-orchestrator.ts (OB-1281)
// ExplorationCoordinator, generateReExplorationPrompt, generateIncrementalExplorationPrompt
// moved to exploration-manager.ts (OB-1280)
import { generateMasterSystemPrompt } from './master-system-prompt.js';
import type { ConnectedIntegrationEntry } from './master-system-prompt.js';
// formatLearnedPatternsSection, formatWorkerNextStepsSection,
// formatPreFetchedKnowledgeSection, formatTargetedReaderSection, WorkerNextStepsEntry
// moved to prompt-context-builder.ts (OB-1282)
import { WorkspaceChangeTracker } from './workspace-change-tracker.js';
// WorkspaceChanges type moved to exploration-manager.ts (OB-1280)
import {
  AgentRunner,
  TOOLS_READ_ONLY,
  TOOLS_CODE_EDIT,
  DEFAULT_MAX_TURNS_TASK,
  DEFAULT_MAX_FIX_ITERATIONS,
  classifyError,
  resolveProfile,
} from '../core/agent-runner.js';
import type { SpawnOptions, AgentResult } from '../core/agent-runner.js';
import { manifestToSpawnOptions } from '../core/agent-runner.js';
import { getRecommendedModel, avoidHighFailureModel } from '../core/model-selector.js';
// PromptAssembler and PRIORITY_* constants moved to prompt-context-builder.ts (OB-1282)
import type { CLIAdapter } from '../core/cli-adapter.js';
import { AdapterRegistry } from '../core/adapter-registry.js';
import type { Router } from '../core/router.js';
import type {
  MemoryManager,
  ConversationEntry,
  SessionRecord,
  WorkspaceState,
  TaskRecord as MemoryTaskRecord,
  ActivityRecord,
} from '../memory/index.js';
import { BUILT_IN_PROFILES, BuiltInProfileNameSchema } from '../types/agent.js';
import type { ToolProfile, ProfilesRegistry, TaskManifest, SkillPack } from '../types/agent.js';
import { ProfilesRegistrySchema } from '../types/agent.js';
import { DelegationCoordinator } from './delegation.js';
import { SubMasterManager } from './sub-master-manager.js';
import type { SubMasterRecord } from './sub-master-manager.js';
// detectSubProjects moved to exploration-manager.ts (OB-1280)
import { openDatabase, closeDatabase } from '../memory/database.js';
import { buildBriefing } from '../memory/worker-briefing.js';
import { parseSpawnMarkers, hasSpawnMarkers, extractTaskSummaries } from './spawn-parser.js';
import type { ParsedSpawnMarker } from './spawn-parser.js';
// parseAIResult moved to exploration-manager.ts (OB-1280)
import { formatWorkerBatch } from './worker-result-formatter.js';
import { WorkerRegistry, WorkersRegistrySchema } from './worker-registry.js';
import type { WorkerRecord } from './worker-registry.js';
import { evolvePrompts } from './prompt-evolver.js';
import { MAX_PROMPT_VERSION_LENGTH } from '../memory/prompt-store.js';
import { applyToolPromptPrefix, seedPromptLibrary, SEED_PROMPTS } from './seed-prompts.js';
import type { KnowledgeRetriever } from '../core/knowledge-retriever.js';
import type { IntegrationHub } from '../integrations/hub.js';
import { DeepModeManager } from './deep-mode.js';
import type {
  MasterState,
  ExplorationSummary,
  TaskRecord,
  AgentsRegistry,
  WorkspaceMap,
  MasterSession,
  PromptTemplate,
  ExplorationState,
  WorkspaceAnalysisMarker,
  LearningEntry,
} from '../types/master.js';
import {
  WorkspaceMapSchema,
  ExplorationStateSchema,
  AgentsRegistrySchema,
} from '../types/master.js';
import type { DiscoveredTool } from '../types/discovery.js';
import type { MCPServer, DeepConfig, WorkspaceTrustLevel } from '../types/config.js';
import type { InboundMessage, ProgressEvent } from '../types/message.js';
import { createModelRegistry } from '../core/model-registry.js';
import type { ModelRegistry } from '../core/model-registry.js';
import { createLogger } from '../core/logger.js';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { SessionCompactor } from './session-compactor.js';
import type { ConversationTurn } from './session-compactor.js';
import {
  getBuiltInSkillPacks,
  findSkillByFormat,
  selectSkillPackForTask,
  loadAllSkillPacks,
} from './skill-pack-loader.js';
import { classifyDocumentIntent } from '../core/router.js';
import { PlanningGate, shouldBypassPlanning, performReasoningCheckpoint } from './planning-gate.js';

const logger = createLogger('master-manager');

const DEFAULT_TIMEOUT = 1_800_000; // 30 minutes for exploration
const DEFAULT_MESSAGE_TIMEOUT = 180_000; // 3 minutes for message processing
const DEFAULT_WORKER_TIMEOUT = 300_000; // 5 minutes for worker tasks

// turnsToTimeout imported from classification-engine.ts (OB-1279)

/** Initial idle time threshold (5 minutes) before triggering self-improvement cycle */
const IDLE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
/** Maximum idle threshold after exponential backoff (2 hours) */
const IDLE_THRESHOLD_MAX_MS = 2 * 60 * 60 * 1000; // 2 hours
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

// RESTART_CONTEXT_TASK_LIMIT and formatTimeAgo moved to prompt-context-builder.ts (OB-1282)

/** Result of a tool-access failure scan on a worker result. */
export interface ToolAccessFailure {
  /** The tool name extracted from the error message, if identifiable. */
  tool: string | undefined;
  /** The raw error snippet that matched a tool-access pattern. */
  reason: string;
}

/**
 * Pre-flight tool prediction result (OB-1595).
 * Returned by `predictToolRequirements()` when the task prompt suggests the
 * worker will need more tools than its current profile allows.
 */
export interface ToolPrediction {
  /** The minimum profile needed to execute this task. */
  suggestedProfile: string;
  /** Human-readable reason for the predicted upgrade. */
  reason: string;
  /** Keywords in the prompt that triggered the prediction. */
  triggerKeywords: string[];
}

/**
 * Rules mapping prompt keyword patterns to minimum required tool profiles.
 * Ordered from most-restrictive (full-access) to least, so the first match wins.
 */
const PREFLIGHT_RULES: Array<{
  pattern: RegExp;
  requiredProfile: 'code-edit' | 'full-access';
  label: string;
}> = [
  {
    // Unrestricted shell: deploy, docker, kubectl, system daemons, curl/wget scripts
    pattern:
      /\b(deploy(?:ment)?|docker\s+\w|kubectl\s+\w|apt(?:-get)?\s+\w|brew\s+install|curl\s+https?|wget\s+https?|systemctl\s+\w|pm2\s+\w|sh\s+\S|bash\s+\S)\b/i,
    requiredProfile: 'full-access',
    label: 'deploy/docker/system commands',
  },
  {
    // npm/npx/pip/cargo/make + common task verbs (test, lint, build, install)
    pattern:
      /\b(npm\s+(test|install|run\s+\w+|build|ci)|npx\s+\w|pip\s+install|cargo\s+(build|test|run)|make\s+\w|run\s+tests?|run\s+(?:the\s+)?(?:lint|build|test)|lint\s+(?:the\s+)?code|build\s+(?:the\s+)?(?:project|app|package)|compile\s+\w|typecheck|type-check|install\s+(?:packages?|dep(?:endencies)?s?))\b/i,
    requiredProfile: 'code-edit',
    label: 'build/test/install commands',
  },
];

/**
 * Predict the minimum tool profile needed to execute a task prompt (OB-1595).
 *
 * Scans the task prompt for keywords that suggest the worker will need
 * bash/shell access (test, lint, build, deploy, install, etc.).  Returns a
 * `ToolPrediction` when the predicted minimum profile exceeds the current
 * profile, so the caller can request upfront escalation before spawning.
 *
 * Returns `undefined` when:
 *  - The profile is already `full-access` or `master` (no escalation needed)
 *  - No prediction-triggering keywords are found
 *  - The predicted profile is ≤ the current profile
 */
export function predictToolRequirements(
  prompt: string,
  profile: string,
): ToolPrediction | undefined {
  if (profile === 'full-access' || profile === 'master') return undefined;

  // Profile capability order (ascending access level)
  const PROFILE_ORDER = ['read-only', 'code-audit', 'code-edit', 'full-access'];
  const currentIndex = PROFILE_ORDER.indexOf(profile);

  for (const rule of PREFLIGHT_RULES) {
    const match = rule.pattern.exec(prompt);
    if (!match) continue;

    const suggestedIndex = PROFILE_ORDER.indexOf(rule.requiredProfile);
    // Only escalate if the prediction exceeds the current profile
    if (suggestedIndex <= currentIndex) continue;

    const triggerKeywords = match[0]
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((k) => k.replace(/[^a-zA-Z0-9:*-]/g, ''));
    return {
      suggestedProfile: rule.requiredProfile,
      reason: rule.label,
      triggerKeywords,
    };
  }

  return undefined;
}

/**
 * Detect tool-access failures in a worker result (OB-1592).
 *
 * Scans both stdout and stderr for the error patterns the Claude CLI emits
 * when a tool call is blocked by `--allowedTools` restrictions:
 *   - "tool not allowed"
 *   - "permission denied"
 *   - "not in allowedTools"
 *
 * Returns a `ToolAccessFailure` describing the blocked tool when a match is
 * found, or `undefined` when no tool-access error is present.
 */
export function detectToolAccessFailure(result: {
  stdout: string;
  stderr: string;
}): ToolAccessFailure | undefined {
  const combined = `${result.stderr}\n${result.stdout}`.toLowerCase();

  const PATTERNS = [
    'tool not allowed',
    'permission denied',
    'not in allowedtools',
    'not allowed to use',
    'tool is not allowed',
  ] as const;

  const matched = PATTERNS.find((p) => combined.includes(p));
  if (!matched) return undefined;

  // Extract the tool name from the error line.
  // Common Claude CLI formats:
  //   "Tool 'Bash' is not allowed"
  //   "Bash is not in allowedTools"
  //   "not allowed to use tool: Bash"
  const searchText = `${result.stderr}\n${result.stdout}`;
  let tool: string | undefined;

  const patterns = [
    // "Tool 'Bash' is not allowed"  /  "tool 'Bash(npm:test)' is not allowed"
    /[Tt]ool\s+'([^']+)'/,
    // "Bash is not in allowedTools"
    /(\w[\w():*]*)\s+is\s+not\s+in\s+allowedTools/i,
    // "not allowed to use tool: Bash"
    /not\s+allowed\s+to\s+use\s+(?:tool:\s*)?([^\s,.:]+)/i,
    // "not in allowedTools: Bash"
    /not\s+in\s+allowedTools[:\s]+([^\s,.:]+)/i,
  ];

  for (const re of patterns) {
    const m = re.exec(searchText);
    if (m?.[1]) {
      tool = m[1];
      break;
    }
  }

  // Provide a short reason snippet (first matching line, truncated)
  const lines = searchText.split('\n');
  const matchedLine = lines.find((l) => PATTERNS.some((p) => l.toLowerCase().includes(p)));
  const reason = (matchedLine ?? matched).trim().slice(0, 200);

  return { tool, reason };
}

/**
 * Returns tools available to the Master AI session based on trust level.
 * - trusted:  full-access tools including Bash(*) — Master can execute commands directly.
 * - sandbox:  read-only tools (Read, Glob, Grep) — Master cannot modify files.
 * - standard: master profile (Read, Glob, Grep, Write, Edit) — delegates execution to workers.
 */
export function getMasterTools(trustLevel: WorkspaceTrustLevel): string[] {
  if (trustLevel === 'trusted') return [...BUILT_IN_PROFILES['full-access'].tools];
  if (trustLevel === 'sandbox') return ['Read', 'Glob', 'Grep'];
  return [...BUILT_IN_PROFILES.master.tools];
}

/**
 * Default max turns for the Master session per interaction.
 * Higher than workers because the Master needs room to reason + coordinate.
 */
const MASTER_MAX_TURNS = 50;

// MESSAGE_MAX_TURNS_* imported from classification-engine.ts (OB-1279)
/** Synthesis call — feeds worker results back to Master for a final user-facing response. */
const MESSAGE_MAX_TURNS_SYNTHESIS = 5;
/** Memory update call — Master writes memory.md; small budget, file write only. */
const MEMORY_UPDATE_MAX_TURNS = 5;
/** Trigger a memory.md update after this many completed tasks. */
const MEMORY_UPDATE_INTERVAL = 10;

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
      : getMasterTools('standard'),
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
    model: task.metadata?.['model'] as string | undefined,
    profile: task.metadata?.['profile'] as string | undefined,
    exit_code: task.metadata?.['exitCode'] as number | undefined,
    max_turns: task.metadata?.['maxTurns'] as number | undefined,
    turns_used: task.metadata?.['turnsUsed'] as number | undefined,
    duration_ms: task.durationMs,
    created_at: task.createdAt,
    completed_at: task.completedAt,
  };
}

// ClassificationResult re-exported from classification-engine.ts (see bottom of file)

/**
 * Callback for emitting progress events — decouples MasterManager from Router.
 * Created per-message via makeProgressReporter(). No-op when no router is set.
 */
export type ProgressReporter = (event: ProgressEvent) => Promise<void>;

// MasterContextSections moved to prompt-context-builder.ts (OB-1282)
import type { MasterContextSections } from './prompt-context-builder.js';

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
  /** Base delay for worker-level retry backoff in milliseconds (default: 5000) */
  workerRetryDelayMs?: number;
  /** CLI adapter for spawning worker agents (defaults to ClaudeAdapter) */
  adapter?: CLIAdapter;
  /** Adapter registry for resolving per-worker CLIAdapters */
  adapterRegistry?: AdapterRegistry;
  /** MCP servers available for workers (from V2Config.mcp.servers, merged with configPath imports) */
  mcpServers?: MCPServer[];
  /** Deep Mode configuration — controls default execution profile and per-phase model overrides */
  deepConfig?: DeepConfig;
  /** Glob patterns for files to exclude — hidden from the AI (workspace.exclude from V2 config) */
  workspaceExclude?: readonly string[];
  /** Glob patterns for files to include — limits AI visibility to only these files (workspace.include from V2 config) */
  workspaceInclude?: readonly string[];
  /**
   * Maximum number of lint/test fix iterations before escalating to Master (OB-1791).
   * Sourced from `config.worker.maxFixIterations`. Defaults to DEFAULT_MAX_FIX_ITERATIONS (3).
   * Set to 0 to disable the cap.
   */
  workerMaxFixIterations?: number;
  /** Workspace trust level — controls Master AI tool access (OB-1583) */
  trustLevel?: WorkspaceTrustLevel;
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
  private _memory: MemoryManager | null = null;

  /** Getter for MemoryManager — null when SQLite init failed */
  get memory(): MemoryManager | null {
    return this._memory;
  }

  /** Setter for MemoryManager — nulls out SubMasterManager when memory becomes unavailable */
  set memory(value: MemoryManager | null) {
    this._memory = value;
    if (!value) {
      this.subMasterManager = null;
    }
    // Keep ClassificationEngine in sync with memory changes
    if (this.classificationEngine) {
      this.classificationEngine.updateDeps({ memory: value });
    }
  }
  /** Sub-master manager — null when no root DB is available (OB-755) */
  private subMasterManager: SubMasterManager | null = null;
  private readonly workerRetryDelayMs: number;
  private readonly modelRegistry: ModelRegistry;
  private readonly adapter?: CLIAdapter;
  private readonly adapterRegistry: AdapterRegistry;
  private mcpServers: MCPServer[];
  private readonly workspaceExclude: readonly string[];
  private readonly workspaceInclude: readonly string[];
  private activeConnectorNames: string[] = [];
  private fileServerPort: number | undefined;
  private tunnelUrl: string | null = null;

  private state: MasterState = 'idle';

  /** Exploration summary — delegated to ExplorationManager (OB-1280). */
  private get explorationSummary(): ExplorationSummary | null {
    return this.explorationManager?.explorationSummary ?? null;
  }
  private set explorationSummary(value: ExplorationSummary | null) {
    if (this.explorationManager) this.explorationManager.explorationSummary = value;
  }

  /** Messages queued while exploration is in progress — delegated to ExplorationManager (OB-1280). */
  private get pendingMessages(): InboundMessage[] {
    return this.explorationManager?.pendingMessages ?? [];
  }
  private set pendingMessages(value: InboundMessage[]) {
    if (this.explorationManager) this.explorationManager.pendingMessages = value;
  }
  /** Router reference for sending pending message responses after exploration completes */
  private router: Router | null = null;
  /** The InboundMessage currently being processed — set for the duration of processMessage/streamMessage so spawnWorker can escalate tool failures (OB-1593). */
  private activeMessage: InboundMessage | null = null;

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
  // lastExplorationAt moved to ExplorationManager (OB-1280)
  /** Idle detection timer (runs self-improvement when idle for >5 min) */
  private idleCheckTimer: NodeJS.Timeout | null = null;
  /** Whether self-improvement is currently running */
  private isSelfImproving = false;
  /** Consecutive idle cycles without a user message — drives exponential backoff */
  private consecutiveIdleCycles = 0;
  /** Consecutive no-op self-improvement cycles — suppresses cycles after 2 no-ops (OB-F210) */
  private consecutiveNoOpCycles = 0;
  /** Number of successfully completed tasks — triggers prompt evolution every 50 (OB-734) */
  private completedTaskCount = 0;
  /** Cached workspace map summary — delegated to ExplorationManager (OB-1280). */
  private get workspaceMapSummary(): string | null {
    return this.explorationManager?.workspaceMapSummary ?? null;
  }
  private set workspaceMapSummary(value: string | null) {
    if (this.explorationManager) this.explorationManager.workspaceMapSummary = value;
  }
  /** ISO timestamp of latest startup verification — delegated to ExplorationManager (OB-1280). */
  private get mapLastVerifiedAt(): string | null {
    return this.explorationManager?.mapLastVerifiedAt ?? null;
  }
  private set mapLastVerifiedAt(value: string | null) {
    if (this.explorationManager) this.explorationManager.mapLastVerifiedAt = value;
  }
  /** Cached summary of past learnings for injection into Master system prompt */
  private learningsSummary: string | null = null;
  /** Classification engine — extracted from MasterManager (OB-1279, OB-F158). */
  private readonly classificationEngine: ClassificationEngine;
  /** Exploration manager — extracted from MasterManager (OB-1280, OB-F158). */
  private readonly explorationManager: ExplorationManager;
  /** Worker orchestrator — extracted from MasterManager (OB-1281, OB-F158). */
  private readonly workerOrchestrator: WorkerOrchestrator;
  /** Prompt/context builder — extracted from MasterManager (OB-1282, OB-F158). */
  private readonly promptContextBuilder: PromptContextBuilder;
  /** Abort handles for running worker processes — delegated to WorkerOrchestrator (OB-1281). */
  private get workerAbortHandles(): Map<string, () => void> {
    return this.workerOrchestrator.workerAbortHandles;
  }
  /** Cancellation notifications queued for injection into the next Master call (OB-884). */
  private readonly pendingCancellationNotifications: string[] = [];
  /** Deep Mode resume offers queued for injection into the next Master call (OB-1405). */
  private readonly pendingDeepModeResumeOffers: string[] = [];
  /** KnowledgeRetriever for RAG-based context injection (OB-1344). Null until set via setKnowledgeRetriever(). */
  private knowledgeRetriever: KnowledgeRetriever | null = null;
  /** IntegrationHub for business integrations — null until set via setIntegrationHub(). */
  private integrationHub: IntegrationHub | null = null;
  /** Deep Mode manager — tracks multi-phase session state (OB-1403). */
  private readonly deepMode: DeepModeManager;
  /** Deep Mode configuration — controls default profile and per-phase model overrides (OB-1403). */
  private readonly deepConfig: DeepConfig | undefined;
  /** BatchManager for Batch Task Continuation — set via setBatchManager() (OB-1613). */
  private batchManager: BatchManager | null = null;
  /** Tracks active batch continuation timer handles for cleanup on shutdown (OB-1664). */
  private readonly batchTimers = new Set<NodeJS.Timeout>();
  /** Session compactor — monitors turn count and triggers memory.md compaction (OB-1672). */
  private compactor: SessionCompactor | null = null;
  /** Active skill packs — built-ins merged with user-defined overrides (OB-1754). */
  private activeSkillPacks: SkillPack[] = [...BUILT_IN_SKILL_PACKS];
  /** Planning gate — two-phase execution guard for complex tasks (OB-1779). */
  private readonly planningGate = new PlanningGate();
  /** Max lint/test fix iterations for workers before escalating to Master (OB-1791). */
  private readonly workerMaxFixIterations: number;
  /** Workspace trust level — controls Master/worker tool access (OB-1583) */
  private readonly trustLevel: WorkspaceTrustLevel;

  constructor(options: MasterManagerOptions) {
    this.workspacePath = options.workspacePath;
    this.masterTool = options.masterTool;
    this.discoveredTools = options.discoveredTools;
    this.explorationTimeout = options.explorationTimeout ?? DEFAULT_TIMEOUT;
    this.messageTimeout = options.messageTimeout ?? DEFAULT_MESSAGE_TIMEOUT;
    this.skipAutoExploration = options.skipAutoExploration ?? false;
    this.dotFolder = new DotFolderManager(this.workspacePath);
    this.changeTracker = new WorkspaceChangeTracker(this.workspacePath);
    this.adapter = options.adapter;
    this.delegationCoordinator = new DelegationCoordinator({ adapter: options.adapter });
    this.agentRunner = new AgentRunner(options.adapter);
    this.workerRegistry = new WorkerRegistry();
    this.memory = options.memory ?? null;
    this.workerRetryDelayMs = options.workerRetryDelayMs ?? 5000;
    this.modelRegistry = createModelRegistry(options.masterTool.name);
    this.mcpServers = options.mcpServers ?? [];
    this.deepConfig = options.deepConfig;
    this.workspaceExclude = options.workspaceExclude ?? [];
    this.workspaceInclude = options.workspaceInclude ?? [];
    this.workerMaxFixIterations = options.workerMaxFixIterations ?? DEFAULT_MAX_FIX_ITERATIONS;
    this.trustLevel = options.trustLevel ?? 'standard';

    // Instantiate DeepModeManager — multi-phase session state machine (OB-1403)
    this.deepMode = new DeepModeManager({ workspacePath: this.workspacePath });

    // Initialise SubMasterManager when MemoryManager is available (OB-755 / OB-812)
    if (this.memory) {
      this.subMasterManager = new SubMasterManager(
        this.memory,
        this.workspacePath,
        this.agentRunner,
        this.masterTool,
      );
    }

    // Initialise SessionCompactor — monitors Master turn count and triggers compaction (OB-1672)
    this.compactor = new SessionCompactor({ maxTurns: MASTER_MAX_TURNS });

    // Store adapter registry for per-worker tool resolution
    if (options.adapterRegistry) {
      this.adapterRegistry = options.adapterRegistry;
    } else {
      // Backward compatible: create minimal registry with just the master adapter
      this.adapterRegistry = new AdapterRegistry();
      if (options.adapter) {
        this.adapterRegistry.register(options.masterTool.name, options.adapter);
      }
    }

    // Initialise ClassificationEngine — extracted from MasterManager (OB-1279)
    this.classificationEngine = new ClassificationEngine({
      memory: this.memory,
      dotFolder: this.dotFolder,
      agentRunner: this.agentRunner,
      modelRegistry: this.modelRegistry,
      workspacePath: this.workspacePath,
      adapter: this.adapter,
      getWorkspaceContext: () => this.getWorkspaceContextSummary(),
    });

    // Initialise ExplorationManager — extracted from MasterManager (OB-1280)
    this.explorationManager = new ExplorationManager({
      workspacePath: this.workspacePath,
      masterTool: this.masterTool,
      discoveredTools: this.discoveredTools,
      dotFolder: this.dotFolder,
      changeTracker: this.changeTracker,
      agentRunner: this.agentRunner,
      explorationTimeout: this.explorationTimeout,
      adapter: this.adapter,
      getMemory: () => this.memory,
      getRouter: () => this.router,
      getSubMasterManager: () => this.subMasterManager,
      getMasterSession: () => this.masterSession,
      getState: () => this.state,
      setState: (s) => {
        this.state = s;
      },
      buildMasterSpawnOptions: (prompt, timeout, maxTurns, sections, skip) =>
        this.buildMasterSpawnOptions(prompt, timeout, maxTurns, sections, skip),
      updateMasterSession: () => this.updateMasterSession(),
      processMessage: (msg) => this.processMessage(msg),
      readWorkspaceMapFromStore: () => this.readWorkspaceMapFromStore(),
      writeWorkspaceMapToStore: (map) => this.writeWorkspaceMapToStore(map),
      readAnalysisMarkerFromStore: () => this.readAnalysisMarkerFromStore(),
      writeAnalysisMarkerToStore: (marker) => this.writeAnalysisMarkerToStore(marker),
      readExplorationStateFromStore: () => this.readExplorationStateFromStore(),
    });

    // Initialise WorkerOrchestrator — extracted from MasterManager (OB-1281)
    this.workerOrchestrator = new WorkerOrchestrator({
      workspacePath: this.workspacePath,
      masterTool: this.masterTool,
      discoveredTools: this.discoveredTools,
      dotFolder: this.dotFolder,
      agentRunner: this.agentRunner,
      workerRegistry: this.workerRegistry,
      adapterRegistry: this.adapterRegistry,
      modelRegistry: this.modelRegistry,
      workerRetryDelayMs: this.workerRetryDelayMs,
      workerMaxFixIterations: this.workerMaxFixIterations,
      trustLevel: this.trustLevel,
      getMemory: () => this.memory,
      getRouter: () => this.router,
      getMasterSession: () => this.masterSession,
      getActiveMessage: () => this.activeMessage,
      getState: () => this.state,
      setState: (s) => {
        this.state = s;
      },
      getActiveSkillPacks: () => this.activeSkillPacks,
      getKnowledgeRetriever: () => this.knowledgeRetriever,
      getBatchManager: () => this.batchManager,
      getBatchTimers: () => this.batchTimers,
      getDelegationCoordinator: () => this.delegationCoordinator,
      readProfilesFromStore: () => this.readProfilesFromStore(),
      persistWorkerRegistry: () => this.persistWorkerRegistry(),
      recordWorkerLearning: (task, result, profile, model) =>
        this.recordWorkerLearning(task, result, profile, model),
      recordPromptEffectiveness: (task, result) => this.recordPromptEffectiveness(task, result),
      recordConversationMessage: (sessionId, role, content) =>
        this.recordConversationMessage(sessionId, role, content),
    });

    // Initialise PromptContextBuilder — extracted from MasterManager (OB-1282)
    this.promptContextBuilder = new PromptContextBuilder({
      workspacePath: this.workspacePath,
      dotFolder: this.dotFolder,
      adapter: this.adapter,
      messageTimeout: this.messageTimeout,
      getMemory: () => this.memory,
      getSystemPrompt: () => this.systemPrompt,
      getMasterSession: () => this.masterSession,
      getMapLastVerifiedAt: () => this.mapLastVerifiedAt,
      getLearningsSummary: () => this.learningsSummary,
      getExplorationSummary: () => this.explorationSummary,
      getWorkspaceContextSummary: () => this.getWorkspaceContextSummary(),
      getBatchManager: () => this.batchManager,
      drainCancellationNotifications: () => this.pendingCancellationNotifications.splice(0),
      drainDeepModeResumeOffers: () => this.pendingDeepModeResumeOffers.splice(0),
      readWorkspaceMapFromStore: () => this.readWorkspaceMapFromStore(),
      readAllTasksFromStore: () => this.readAllTasksFromStore(),
    });

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
        // ignore — map not yet stored
      }
    } else {
      logger.warn('Memory not available — falling back to JSON for workspace map read');
    }
    const jsonMap = await this.dotFolder.readWorkspaceMap();
    if (jsonMap) return jsonMap;
    return null;
  }

  /** Write workspace map to memory (as chunk). JSON fallback removed (OB-810). */
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
    logger.warn('Memory not available — skipping workspace map write');
  }

  /** Load master session from memory (sessions table) or DotFolderManager (JSON file). */
  private async loadMasterSessionFromStore(): Promise<MasterSession | null> {
    if (this.memory) {
      try {
        const record = await this.memory.getSession('master');
        if (record) return sessionRecordToMasterSession(record);
      } catch {
        // Fall through to JSON fallback
      }
    }
    return this.dotFolder.readMasterSession();
  }

  /** Save master session to memory (sessions table) or DotFolderManager (JSON fallback). */
  private async saveMasterSessionToStore(session: MasterSession): Promise<void> {
    if (this.memory) {
      await this.memory.upsertSession(masterSessionToSessionRecord(session, this.restartCount));
    } else {
      await this.dotFolder.writeMasterSession(session);
    }
  }

  /**
   * Checkpoint the current Master session state to the `sessions` table.
   *
   * Serializes pending workers, accumulated results, and queued message context
   * so that a future `resumeSession()` call can restore them without data loss.
   *
   * No-op when memory is unavailable (SQLite not configured).
   *
   * @returns true if checkpoint was saved, false if skipped (no memory / no session).
   */
  public async checkpointSession(): Promise<boolean> {
    if (!this.memory || !this.masterSession) return false;

    const now = new Date().toISOString();

    // Collect worker state from the in-memory registry
    const allWorkers = this.workerRegistry.getAllWorkers();
    const pendingWorkers = allWorkers.filter(
      (w) => w.status === 'pending' || w.status === 'running',
    );
    const completedWorkers = allWorkers.filter(
      (w) => w.status === 'completed' || w.status === 'failed',
    );

    // Serialize pending messages — convert Date timestamps to ISO strings
    const serializedMessages = this.pendingMessages.map((msg) => ({
      ...msg,
      timestamp: msg.timestamp instanceof Date ? msg.timestamp.toISOString() : msg.timestamp,
    }));

    const checkpoint = {
      checkpointedAt: now,
      pendingWorkers,
      completedWorkers,
      pendingMessages: serializedMessages,
    };

    try {
      const record = masterSessionToSessionRecord(this.masterSession, this.restartCount);
      record.checkpoint_data = JSON.stringify(checkpoint);
      await this.memory.upsertSession(record);
      logger.info(
        {
          sessionId: this.masterSession.sessionId,
          pendingWorkers: pendingWorkers.length,
          completedWorkers: completedWorkers.length,
          pendingMessages: serializedMessages.length,
        },
        'Session checkpointed',
      );
      return true;
    } catch (error) {
      logger.warn({ error }, 'Failed to checkpoint session');
      return false;
    }
  }

  /**
   * Restore Master session state from the `sessions` table after a checkpoint.
   *
   * Reads the latest `master` session with `checkpoint_data`, restores the
   * `masterSession` object, re-queues interrupted pending messages, and reloads
   * the worker history.  Workers that were `pending` or `running` at checkpoint
   * time are marked `failed` (their processes no longer exist); completed/failed
   * workers are restored for context and stats.
   *
   * No-op when memory is unavailable or no checkpointed session exists.
   *
   * @returns An object describing what was restored, or `null` if skipped.
   */
  public async resumeSession(): Promise<{
    restored: boolean;
    pendingMessages: number;
    restoredWorkers: number;
    failedWorkers: number;
  } | null> {
    if (!this.memory) return null;

    let record: SessionRecord | null;
    try {
      record = await this.memory.getSession('master');
    } catch (error) {
      logger.warn({ error }, 'Failed to read session for resume');
      return null;
    }

    if (!record?.checkpoint_data) return null;

    let checkpoint: {
      checkpointedAt: string;
      pendingWorkers: WorkerRecord[];
      completedWorkers: WorkerRecord[];
      pendingMessages: Array<Record<string, unknown>>;
    };
    try {
      checkpoint = JSON.parse(record.checkpoint_data) as typeof checkpoint;
    } catch (error) {
      logger.warn({ error }, 'Failed to parse checkpoint data');
      return null;
    }

    // Restore master session from the stored record
    this.masterSession = sessionRecordToMasterSession(record);
    this.sessionInitialized = true;

    // Restore worker history — completed/failed workers kept as-is for context and stats.
    // Pending/running workers are marked failed (their processes no longer exist).
    const workersToRestore: Record<string, WorkerRecord> = {};

    for (const worker of checkpoint.completedWorkers ?? []) {
      workersToRestore[worker.id] = worker;
    }

    let failedWorkerCount = 0;
    for (const worker of checkpoint.pendingWorkers ?? []) {
      workersToRestore[worker.id] = {
        ...worker,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: 'Interrupted by session checkpoint',
      };
      failedWorkerCount++;
    }

    if (Object.keys(workersToRestore).length > 0) {
      try {
        this.workerRegistry.fromJSON({
          workers: workersToRestore,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        logger.warn({ error }, 'Failed to restore workers from checkpoint');
      }
    }

    // Restore pending messages — deserialize ISO timestamps back to Date objects
    const restoredMessages: InboundMessage[] = [];
    for (const rawMsg of checkpoint.pendingMessages ?? []) {
      try {
        restoredMessages.push({
          ...(rawMsg as Omit<InboundMessage, 'timestamp'>),
          timestamp: new Date(rawMsg['timestamp'] as string),
        } as InboundMessage);
      } catch {
        // Skip malformed messages
      }
    }
    this.pendingMessages = restoredMessages;

    const restoredWorkerCount = Object.keys(workersToRestore).length - failedWorkerCount;
    logger.info(
      {
        sessionId: this.masterSession.sessionId,
        pendingMessages: restoredMessages.length,
        restoredWorkers: restoredWorkerCount,
        failedWorkers: failedWorkerCount,
        checkpointedAt: checkpoint.checkpointedAt,
      },
      'Session resumed from checkpoint',
    );

    return {
      restored: true,
      pendingMessages: restoredMessages.length,
      restoredWorkers: restoredWorkerCount,
      failedWorkers: failedWorkerCount,
    };
  }

  /** Read analysis marker from memory (workspace_state table) or DotFolderManager (JSON file). */
  private async readAnalysisMarkerFromStore(): Promise<WorkspaceAnalysisMarker | null> {
    if (this.memory) {
      try {
        const state = await this.memory.getWorkspaceState();
        return workspaceStateToMarker(state);
      } catch {
        /* fall through to dotFolder */
      }
    }
    return this.dotFolder.readAnalysisMarker();
  }

  /** Write analysis marker to memory (workspace_state table) or DotFolderManager (JSON file). */
  private async writeAnalysisMarkerToStore(marker: WorkspaceAnalysisMarker): Promise<void> {
    if (this.memory) {
      await this.memory.updateWorkspaceState(markerToWorkspaceState(marker));
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

  /** Read profiles registry from DB (system_config) first, fall back to dotFolder JSON. */
  private async readProfilesFromStore(): Promise<ProfilesRegistry | null> {
    if (this.memory) {
      try {
        const raw = await this.memory.getSystemConfig('profiles');
        if (raw) return ProfilesRegistrySchema.parse(JSON.parse(raw));
      } catch {
        // Fall through to JSON fallback
      }
    }
    return this.dotFolder.readProfiles();
  }

  /**
   * Record a master-level task (user interaction) to memory (SQLite tasks table).
   * If memory is not available, logs a warning — no JSON fallback.
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
    logger.warn({ taskId: task.id }, 'MemoryManager not available — task record not persisted');
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

  /** Retrieve conversation context. Delegated to PromptContextBuilder (OB-1282). */
  private async buildConversationContext(
    userMessage: string,
    sessionId?: string,
    sender?: string,
  ): Promise<string | null> {
    return this.promptContextBuilder.buildConversationContext(userMessage, sessionId, sender);
  }

  /** Build learned patterns context. Delegated to PromptContextBuilder (OB-1282). */
  private async buildLearnedPatternsContext(): Promise<string | null> {
    return this.promptContextBuilder.buildLearnedPatternsContext();
  }

  /** Build worker next steps context. Delegated to PromptContextBuilder (OB-1282). */
  private async buildWorkerNextStepsContext(): Promise<string | null> {
    return this.promptContextBuilder.buildWorkerNextStepsContext();
  }

  /**
   * Increment the completed task counter and trigger prompt evolution every 50 tasks (OB-734).
   * Also triggers a memory.md update every MEMORY_UPDATE_INTERVAL tasks (OB-1023).
   * Runs asynchronously in the background — never blocks the caller.
   */
  private onTaskCompleted(): void {
    this.completedTaskCount += 1;
    if (this.completedTaskCount % 50 === 0 && this.memory) {
      void evolvePrompts(this.memory, this.agentRunner, this.workspacePath).catch((err) => {
        logger.warn({ err }, 'Prompt evolution cycle failed');
      });
    }
    if (this.completedTaskCount % MEMORY_UPDATE_INTERVAL === 0) {
      void this.triggerMemoryUpdate().catch((err) => {
        logger.warn({ err }, 'Periodic memory update failed');
      });
    }
  }

  /** Write exploration summary to memory.md. Delegated to ExplorationManager (OB-1280). */
  private async writeExplorationSummaryToMemory(): Promise<void> {
    return this.explorationManager.writeExplorationSummaryToMemory();
  }

  /**
   * Send an "update memory" prompt to the Master session so it can write
   * `.openbridge/context/memory.md` via its Write tool (OB-1023).
   * Non-blocking — caller should fire-and-forget with void.
   */
  private async triggerMemoryUpdate(): Promise<void> {
    if (!this.masterSession || this.state === 'shutdown') return;

    const recentMessages = (await this.memory?.getRecentMessages(20)) ?? [];

    logger.info({ messageCount: recentMessages.length }, 'Starting memory update');

    const memoryPath = this.dotFolder.getMemoryFilePath();

    let historySection = '';
    if (recentMessages.length > 0) {
      const lines = recentMessages.map((msg) => {
        const ts = msg.created_at ? msg.created_at.slice(0, 16).replace('T', ' ') : '';
        const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
        const content = msg.content.length > 300 ? msg.content.slice(0, 300) + '…' : msg.content;
        return `[${ts}] ${role}: ${content}`;
      });
      historySection = `## Recent conversation history:\n${lines.join('\n')}\n\n`;
    }

    const prompt =
      historySection +
      `Update your memory file at ${memoryPath}.\n` +
      `Keep it under 200 lines. Remove outdated info. Merge related topics.\n` +
      `Only write what is worth remembering across sessions: user preferences, ` +
      `project state, decisions made, active threads, and known issues.\n` +
      `Write your updated notes to ${memoryPath}.`;

    // Capture mtime before update to verify the file was actually written (OB-1615).
    let mtimeBefore: number | null = null;
    try {
      const stat = await fs.stat(memoryPath);
      mtimeBefore = stat.mtimeMs;
    } catch {
      // File doesn't exist yet — any write will count as a modification.
    }

    try {
      const opts = this.buildMasterSpawnOptions(prompt, undefined, MEMORY_UPDATE_MAX_TURNS);
      const result = await this.agentRunner.spawn(opts);
      await this.updateMasterSession();
      if (result.exitCode !== 0) {
        logger.warn({ exitCode: result.exitCode }, 'Memory update prompt returned non-zero exit');
        // OB-1616: Master write failed — fall back to direct write from conversation history.
        await this.applyMemoryFallback(recentMessages);
      } else {
        // Verify memory.md was actually written/modified (OB-1615).
        try {
          const stat = await fs.stat(memoryPath);
          const wasModified = mtimeBefore === null || stat.mtimeMs > mtimeBefore;
          if (wasModified) {
            logger.info(
              { mtimeBefore, mtimeAfter: stat.mtimeMs },
              'Memory update completed — file verified',
            );
          } else {
            logger.warn(
              { memoryPath, mtimeBefore, mtimeAfter: stat.mtimeMs },
              'Memory update completed but memory.md was NOT modified — Master may have skipped the write',
            );
            // OB-1616: Master skipped the write — fall back to direct write.
            await this.applyMemoryFallback(recentMessages);
          }
        } catch {
          logger.warn(
            { memoryPath },
            'Memory update completed but memory.md is missing — Master did not write the file',
          );
          // OB-1616: memory.md missing after update — fall back to direct write.
          await this.applyMemoryFallback(recentMessages);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Memory update prompt failed');
      // OB-1616: Spawn itself failed — fall back to direct write from conversation history.
      await this.applyMemoryFallback(recentMessages);
    }
  }

  /**
   * Fallback memory write (OB-1616): write memory.md directly from conversation history
   * when the Master AI fails to produce or write an update.
   */
  private async applyMemoryFallback(
    messages: ReadonlyArray<{ role: string; content: string; created_at?: string }>,
  ): Promise<void> {
    try {
      await this.dotFolder.writeMemoryFallback(messages);
      logger.info(
        { messageCount: messages.length },
        'Memory fallback written from conversation history',
      );
    } catch (err) {
      logger.warn({ err }, 'Memory fallback write failed');
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
   * Recover from an error state.
   * Resets state from 'error' to 'idle' and optionally retries exploration
   * if the previous error occurred during explore().
   * After recovery, processMessage() can accept new messages again.
   */
  public recover(): Promise<void> {
    if (this.state !== 'error') {
      logger.warn(
        { currentState: this.state },
        'recover() called but state is not error — ignoring',
      );
      return Promise.resolve();
    }

    logger.warn(
      { workspacePath: this.workspacePath, previousError: this.explorationSummary?.error },
      'Recovering from error state',
    );

    this.state = 'idle';

    // If exploration previously failed, retry it so the Master can become ready.
    // explore() synchronously sets state to 'exploring' before its first await,
    // so subsequent processMessage() calls will queue correctly as pending messages.
    if (this.explorationSummary?.status === 'failed') {
      logger.info('Retrying exploration after recovery');
      void this.explore();
    }

    return Promise.resolve();
  }

  /**
   * Get the model registry (for provider-agnostic model resolution)
   */
  public getModelRegistry(): ModelRegistry {
    return this.modelRegistry;
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
   * Get the list of pending messages awaiting processing.
   * Used primarily for testing and diagnostics.
   */
  public getPendingMessages(): InboundMessage[] {
    return [...this.pendingMessages];
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

    // Load user-defined skill packs — overrides built-ins by name (OB-1754)
    try {
      const { packs, userDefinedCount } = await loadAllSkillPacks(this.workspacePath);
      this.activeSkillPacks = packs;
      if (userDefinedCount > 0) {
        logger.info({ userDefinedCount }, 'Loaded user-defined skill packs');
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load user-defined skill packs — using built-ins');
    }

    // Initialize BatchManager (OB-1609): load any persisted batch state.
    if (!this.batchManager) {
      this.batchManager = new BatchManager(this.dotFolder);
    }
    await this.batchManager.initialize();

    // Clean up stale agent_activity rows from previous process BEFORE
    // creating the new master session, so the fresh 'running' row isn't wiped.
    this.cleanupStuckActivities();

    // Check system_config for incomplete Deep Mode sessions from a previous run.
    // Must run after dotFolder.initialize() (memory is ready) and after
    // cleanupStuckActivities() (so we don't interfere with activity cleanup).
    // Reads from system_config which is never touched by agent_activity cleanup (OB-1405).
    await this.checkIncompleteDeepModeSessions();

    // OB-1617: Detect stale or missing memory.md on startup — regenerate from SQLite.
    if (this.memory) {
      try {
        const isStale = await this.dotFolder.isMemoryStale();
        if (isStale) {
          const recentMessages = await this.memory.getRecentMessages(20);
          await this.dotFolder.writeMemoryFallback(recentMessages);
          logger.info(
            { messageCount: recentMessages.length },
            'Regenerated stale memory.md from SQLite on startup (OB-1617)',
          );
        }
      } catch (err) {
        logger.warn({ err }, 'Failed to check/regenerate stale memory.md on startup');
      }
    }

    // Initialize Master session — so exploration can use it
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

        // OB-1569: Ensure FTS5 has indexed chunks even when exploration is skipped.
        // If the chunk store is empty, decompose the workspace map into searchable chunks.
        // OB-1573: Also re-index if searchContext() returns 0 results — covers the case
        // where the raw _workspace_map JSON chunk exists (countChunks > 0) but structured
        // FTS5 chunks were never created, so typical user queries still return nothing.
        if (this.memory) {
          try {
            const chunkCount = await this.memory.countChunks();
            if (chunkCount === 0) {
              logger.warn(
                'FTS5 chunk store is empty after skip-exploration — indexing workspace map (OB-1569)',
              );
              await this.indexWorkspaceMapAsChunks(map);
            } else {
              // OB-1573: Probe FTS5 with a workspace-derived query to confirm results are
              // returned. If the probe returns 0 chunks, structured FTS5 chunks are missing
              // and we re-index the workspace map to ensure RAG has something to search.
              const probeQuery = map.projectName || map.projectType;
              const probeResults = await this.memory.searchContext(probeQuery, 1);
              if (probeResults.length === 0) {
                logger.warn(
                  { chunkCount, probeQuery },
                  'FTS5 searchContext returns 0 results for workspace probe — indexing structured chunks (OB-1573)',
                );
                await this.indexWorkspaceMapAsChunks(map);
              } else {
                logger.info({ chunkCount }, 'FTS5 chunk store has indexed content — RAG ready');
              }
            }
          } catch (err) {
            logger.warn(
              { err },
              'Failed to verify/index FTS5 chunks after skip-exploration (OB-1569)',
            );
          }
        }

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
        await this.logRagHealthDiagnostic();
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
      // Check whether exploration produced a valid workspace map
      if (this.explorationSummary?.status !== 'completed') {
        logger.warn(
          { status: this.explorationSummary?.status },
          'Exploration did not produce a workspace map — will re-explore on next startup',
        );
      }
    } else {
      logger.info('Auto-exploration disabled, entering ready state');
      this.state = 'ready';
    }

    // RAG health diagnostic — covers Scenarios 1c (full re-explore), no-map,
    // and skipAutoExploration paths. Scenarios 1a and 1b log their own counts.
    await this.logRagHealthDiagnostic();

    // Start idle detection timer for self-improvement cycle (OB-173)
    this.startIdleDetection();
  }

  /**
   * Mark stuck agent_activity rows as failed at startup.
   *
   * When the process crashes or is killed, running activities are never
   * transitioned to a terminal status. On the next startup we scan for
   * rows with status in ('starting', 'running', 'completing') whose
   * started_at is older than 1 hour and mark them as failed so they
   * don't pollute the active-agents list or confuse the dashboard.
   */
  private cleanupStuckActivities(): void {
    if (!this.memory) return;

    try {
      // On startup every in-flight row is stale — the previous process is gone.
      const cleaned = this.memory.markStaleActivityDone();
      if (cleaned > 0) {
        logger.info({ cleaned }, 'Marked stale agent_activity rows as done on startup');
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to clean up stuck agent_activity rows');
    }
  }

  /**
   * Persist the current in-memory state of a Deep Mode session to SQLite.
   *
   * Stores the full DeepModeState JSON in system_config under
   * `deep_mode:sessions:<sessionId>`.  Because system_config is never wiped by
   * the agent_activity startup cleanup, the state survives process restarts and
   * can be found by checkIncompleteDeepModeSessions() on the next run (OB-1405).
   *
   * Also inserts (or updates) a tracking row in agent_activity with type='deep-mode'
   * for dashboard/audit visibility.
   */
  private async persistDeepModeSession(sessionId: string): Promise<void> {
    if (!this.memory) return;

    const state = this.deepMode.getSessionState(sessionId);
    if (!state) return;

    // Store full state JSON — this survives the startup agent_activity cleanup
    await this.memory.upsertDeepModeState(sessionId, state);

    // Insert / update the audit row in agent_activity
    const now = new Date().toISOString();
    const isActive = state.currentPhase !== undefined;
    try {
      await this.memory.insertActivity({
        id: sessionId,
        type: 'deep-mode',
        profile: state.profile,
        task_summary: state.taskSummary.slice(0, 200),
        status: isActive ? 'running' : 'done',
        started_at: state.startedAt,
        updated_at: now,
        ...(isActive ? {} : { completed_at: now }),
      });
    } catch {
      // Row may already exist (INSERT OR IGNORE) — update instead
      await this.memory.updateActivity(sessionId, {
        status: isActive ? 'running' : 'done',
        ...(isActive ? {} : { completed_at: now }),
      });
    }

    logger.debug(
      { sessionId, currentPhase: state.currentPhase },
      'Deep Mode session state persisted to SQLite',
    );
  }

  /**
   * Check system_config for Deep Mode sessions from a previous process run that
   * did not complete all phases.  Queues resume offers into
   * pendingDeepModeResumeOffers so the Master AI notifies the user on the next
   * message (OB-1405).
   *
   * Called once during start() after cleanupStuckActivities().
   */
  private async checkIncompleteDeepModeSessions(): Promise<void> {
    if (!this.memory) return;

    try {
      const incomplete = await this.memory.listIncompleteDeepModeSessions();
      if (incomplete.length === 0) return;

      logger.info(
        { count: incomplete.length },
        'Found incomplete Deep Mode sessions from previous run',
      );

      for (const { sessionId, stateJson } of incomplete) {
        try {
          const state = JSON.parse(stateJson) as {
            taskSummary?: string;
            currentPhase?: string;
            profile?: string;
          };
          const summary = state.taskSummary ?? '(unknown task)';
          const phase = state.currentPhase ?? '(unknown phase)';
          const profile = state.profile ?? 'thorough';

          this.pendingDeepModeResumeOffers.push(
            `There is an incomplete Deep Mode session (${profile} profile, paused at **${phase}** phase) ` +
              `for the task: "${summary}". Session ID: ${sessionId}. ` +
              `Inform the user and offer to resume or discard the session.`,
          );
        } catch {
          // Skip malformed entries
        }
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to check for incomplete Deep Mode sessions on startup');
    }
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

    // Seed prompt library if not already seeded (first startup only)
    const existingManifest = await this.dotFolder.readPromptManifest();
    if (!existingManifest || Object.keys(existingManifest.prompts).length === 0) {
      try {
        await seedPromptLibrary(this.dotFolder);
        logger.info('Seeded prompt library');
        // Also seed worker prompt IDs into SQLite so recordPromptOutcome() can track them (OB-1612)
        if (this.memory) {
          for (const prompt of SEED_PROMPTS) {
            try {
              // Skip insertion if this prompt already exists in the DB (OB-1254)
              let alreadyExists = false;
              try {
                await this.memory.getActivePrompt(prompt.id);
                alreadyExists = true;
              } catch {
                // getActivePrompt rejects when no active prompt exists — proceed with insert
              }
              if (!alreadyExists) {
                await this.memory.createPromptVersion(prompt.id, prompt.content);
              }
            } catch (dbErr) {
              logger.warn(
                { error: dbErr, promptId: prompt.id },
                'Failed to seed worker prompt to DB — non-blocking',
              );
            }
          }
          logger.info('Seeded worker prompt IDs to SQLite for outcome tracking');
        }
      } catch (error) {
        logger.warn({ error }, 'Failed to seed prompt library');
      }
    }

    // Load the system prompt — prefer DB, fall back to file
    if (this.memory) {
      try {
        const dbPrompt = await this.memory.getActivePrompt('master-system');
        this.systemPrompt = dbPrompt.content;
      } catch {
        this.systemPrompt = await this.dotFolder.readSystemPrompt();
      }
    } else {
      this.systemPrompt = await this.dotFolder.readSystemPrompt();
    }
    if (this.systemPrompt) {
      logger.info('Loaded Master system prompt');
    }

    // Load learnings and build summary for system prompt injection
    try {
      const learnings = await this.dotFolder.readLearnings();
      if (learnings && learnings.entries.length > 0) {
        this.learningsSummary = this.buildLearningsSummary(learnings.entries);
        logger.info(
          { entryCount: learnings.entries.length, summaryLength: this.learningsSummary?.length },
          'Loaded learnings summary for Master context',
        );
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to load learnings — continuing without history');
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

      // Re-register master activity so the dashboard shows on restart (OB-742)
      if (this.memory) {
        try {
          const now = new Date().toISOString();
          await this.memory.insertActivity({
            id: existing.sessionId,
            type: 'master',
            model: this.masterTool.name,
            task_summary: 'Master AI session resumed',
            status: 'running',
            started_at: existing.createdAt ?? now,
            updated_at: now,
          });
        } catch {
          // INSERT OR IGNORE — silently skipped if row already exists
        }
      }
      return;
    }

    // Close any stale active sessions before creating a new one
    if (this.memory) {
      try {
        await this.memory.closeActiveSessions();
        logger.info('Closed stale active sessions before creating new Master session');
      } catch (error) {
        logger.warn({ error }, 'Failed to close stale sessions — continuing anyway');
      }
    }

    // Create new session — use raw UUID (Claude CLI requires valid UUID format)
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    this.masterSession = {
      sessionId,
      createdAt: now,
      lastUsedAt: now,
      messageCount: 0,
      allowedTools: getMasterTools(this.trustLevel),
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

    // Record master agent startup in agent_activity (OB-742)
    if (this.memory) {
      try {
        await this.memory.insertActivity({
          id: sessionId,
          type: 'master',
          model: this.masterTool.name,
          task_summary: 'Master AI session started',
          status: 'running',
          started_at: now,
          updated_at: now,
        });
      } catch (actErr) {
        logger.warn({ error: actErr }, 'Failed to record master activity');
      }
    }
  }

  /**
   * Seed the master system prompt if it doesn't already exist.
   * Generates the default prompt and writes it to .openbridge/prompts/master-system.md.
   */
  private async seedSystemPrompt(): Promise<void> {
    // Check DB first — if we have an active prompt, it's already seeded
    if (this.memory) {
      try {
        await this.memory.getActivePrompt('master-system');
        return; // Already in DB — don't overwrite
      } catch {
        // Not in DB yet — fall through to file check
      }
    }

    const existing = await this.dotFolder.readSystemPrompt();
    if (existing) {
      // Migrate file → DB (one-time)
      if (this.memory) {
        try {
          await this.memory.createPromptVersion('master-system', existing);
        } catch (dbErr) {
          logger.warn({ error: dbErr }, 'Failed to migrate system prompt to DB');
        }
      }
      return; // Already seeded — don't overwrite (Master may have edited it)
    }

    const customProfiles = (await this.readProfilesFromStore())?.profiles;

    const promptContent = generateMasterSystemPrompt({
      workspacePath: this.workspacePath,
      masterToolName: this.masterTool.name,
      discoveredTools: this.discoveredTools,
      customProfiles,
      modelRegistry: this.modelRegistry,
      mcpServers: this.mcpServers.length > 0 ? this.mcpServers : undefined,
      activeConnectorNames:
        this.activeConnectorNames.length > 0 ? this.activeConnectorNames : undefined,
      fileServerPort: this.fileServerPort,
      tunnelUrl: this.tunnelUrl ?? undefined,
      workspaceExclude: this.workspaceExclude.length > 0 ? this.workspaceExclude : undefined,
      workspaceInclude: this.workspaceInclude.length > 0 ? this.workspaceInclude : undefined,
      availableSkills: BUILT_IN_SKILLS,
      availableSkillPacks: this.activeSkillPacks,
      connectedIntegrations: this.buildConnectedIntegrations(),
      trustLevel: this.trustLevel,
    });

    try {
      if (this.memory) {
        if (promptContent.length > MAX_PROMPT_VERSION_LENGTH) {
          logger.warn(
            { size: promptContent.length, max: MAX_PROMPT_VERSION_LENGTH },
            'System prompt exceeds DB size cap — falling back to file storage',
          );
          await this.dotFolder.writeSystemPrompt(promptContent);
        } else {
          try {
            await this.memory.createPromptVersion('master-system', promptContent);
          } catch (dbErr) {
            logger.warn({ error: dbErr }, 'DB prompt save failed — falling back to file storage');
            await this.dotFolder.writeSystemPrompt(promptContent);
          }
        }
      } else {
        await this.dotFolder.writeSystemPrompt(promptContent);
      }
      logger.info('Seeded Master system prompt');
    } catch (error) {
      logger.warn({ error }, 'Failed to seed Master system prompt');
    }
  }

  /** Assemble SpawnOptions for a Master AI call. Delegated to PromptContextBuilder (OB-1282). */
  private buildMasterSpawnOptions(
    prompt: string,
    timeout?: number,
    maxTurns?: number,
    contextSections?: MasterContextSections,
    skipWorkspaceContext?: boolean,
  ): SpawnOptions {
    return this.promptContextBuilder.buildMasterSpawnOptions(
      prompt,
      timeout,
      maxTurns,
      contextSections,
      skipWorkspaceContext,
    );
  }

  /** Get workspace context summary. Delegated to ExplorationManager (OB-1280). */
  private getWorkspaceContextSummary(): string | null {
    return this.explorationManager.getWorkspaceContextSummary();
  }

  /** Build learnings summary. Delegated to PromptContextBuilder (OB-1282). */
  private buildLearningsSummary(entries: LearningEntry[]): string | null {
    return this.promptContextBuilder.buildLearningsSummary(entries);
  }

  /** Build map summary. Delegated to ExplorationManager (OB-1280). */
  private buildMapSummary(map: Record<string, unknown>): string {
    return this.explorationManager.buildMapSummary(map);
  }

  /** Index workspace map as FTS5 chunks. Delegated to ExplorationManager (OB-1280). */
  private async indexWorkspaceMapAsChunks(map: WorkspaceMap): Promise<void> {
    return this.explorationManager.indexWorkspaceMapAsChunks(map);
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
   * Check whether the current Master session needs compaction and trigger it
   * if the threshold has been reached (OB-1672).
   *
   * Called after every Master turn via `updateMasterSession()`. Silently
   * no-ops when the compactor, memory manager, or session are unavailable.
   */
  private async _checkCompaction(): Promise<void> {
    if (!this.compactor || !this.memory || !this.masterSession) return;

    try {
      const db = this.memory.getDb();
      if (!db) return;

      const { sessionId } = this.masterSession;
      const memoryPath = this.dotFolder.getMemoryFilePath();

      await this.compactor.triggerIfNeeded(db, sessionId, async (snapshot) => {
        // Fetch conversation history to build a structured summary.
        let turns: ConversationTurn[] = [];
        try {
          const entries = await this.memory!.getSessionHistory(sessionId, 50);
          turns = entries.map((e) => ({
            role: e.role === 'user' ? 'user' : e.role === 'system' ? 'system' : 'assistant',
            content: e.content,
          }));
        } catch (err) {
          logger.warn({ err, sessionId }, 'Compaction: failed to load session history');
        }

        const summary = this.compactor!.compactTurns(turns);
        logger.info(
          {
            sessionId,
            totalTurns: snapshot.totalTurns,
            thresholdTurns: snapshot.thresholdTurns,
            turnCount: summary.turnCount,
          },
          'Compaction: writing summary to memory.md',
        );
        await this.compactor!.writeCompactionSummaryToMemory(summary, memoryPath);
      });
    } catch (err) {
      logger.warn({ err }, 'Compaction check failed — continuing session without compaction');
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

  /** Build context summary for session restart. Delegated to PromptContextBuilder (OB-1282). */
  private async buildContextSummary(): Promise<string> {
    return this.promptContextBuilder.buildContextSummary();
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
    if (this.memory) {
      await this.memory.logExploration({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: 'Master session restarted',
        data: {
          oldSessionId: oldSession?.sessionId,
          oldMessageCount: oldSession?.messageCount,
          restartCount: this.restartCount,
        },
      });
    } else {
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
    }

    // Create a new session — use raw UUID (Claude CLI requires valid UUID format)
    const sessionId = randomUUID();
    const now = new Date().toISOString();

    this.masterSession = {
      sessionId,
      createdAt: now,
      lastUsedAt: now,
      messageCount: 0,
      allowedTools: getMasterTools(this.trustLevel),
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

    // Clear pending cancellation notifications after they've been injected into the spawn options.
    // This prevents duplicate injection on subsequent session restarts (OB-F173).
    this.pendingCancellationNotifications.length = 0;

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

  /** Return the DeepModeManager for external command handling (e.g. Router /deep command). */
  public getDeepModeManager(): DeepModeManager {
    return this.deepMode;
  }

  /**
   * Format a concise worker summary string for stop command responses.
   * Returns "<shortId> (<model>, '<task preview>', <elapsed>)".
   */
  private formatWorkerSummary(worker: WorkerRecord): string {
    const shortId = worker.id.split('-').pop() ?? worker.id;
    const model = worker.taskManifest.model ?? 'default';
    const summary = worker.taskManifest.prompt.slice(0, 40).replace(/\n/g, ' ');
    const elapsedMs = worker.startedAt
      ? Date.now() - new Date(worker.startedAt).getTime()
      : undefined;
    const elapsedStr = elapsedMs !== undefined ? `${Math.round(elapsedMs / 1000)}s` : 'unknown';
    return `${shortId} (${model}, '${summary}', ${elapsedStr})`;
  }

  /**
   * Kill a running worker by ID.
   *
   * Retrieves the abort handle stored in workerAbortHandles, calls it
   * (SIGTERM → 5s grace → SIGKILL), then marks the worker as cancelled in
   * WorkerRegistry and agent_activity.
   *
   * Edge cases handled:
   *   - Invalid / unknown workerId → success:false
   *   - Worker already completed / failed / cancelled → success:false
   *   - No abort handle (legacy PID -1) → log warning, still mark cancelled
   */
  public async killWorker(
    workerId: string,
    cancelledBy = 'user',
  ): Promise<{ success: boolean; message: string }> {
    const worker = this.workerRegistry.getWorker(workerId);

    if (!worker) {
      return { success: false, message: `Worker ${workerId} not found.` };
    }

    if (
      worker.status === 'completed' ||
      worker.status === 'failed' ||
      worker.status === 'cancelled'
    ) {
      const shortId = workerId.split('-').pop() ?? workerId;
      return { success: false, message: `Worker ${shortId} has already ${worker.status}.` };
    }

    // Invoke the abort handle (SIGTERM → grace period → SIGKILL)
    const abortHandle = this.workerAbortHandles.get(workerId);
    if (abortHandle) {
      abortHandle();
      this.workerAbortHandles.delete(workerId);
    } else {
      // Legacy / PID -1 case — no handle available, mark cancelled without sending a signal
      logger.warn(
        { workerId, pid: worker.pid ?? -1 },
        'killWorker: no abort handle found (legacy PID -1?) — marking cancelled without kill signal',
      );
    }

    // Mark cancelled in WorkerRegistry
    try {
      this.workerRegistry.markCancelled(workerId, 'Cancelled by user');
    } catch (err) {
      logger.warn({ workerId, err }, 'killWorker: failed to mark worker as cancelled in registry');
    }

    // Update agent_activity in DB
    if (this.memory) {
      try {
        await this.memory.updateActivity(workerId, {
          status: 'failed',
          completed_at: new Date().toISOString(),
        });
      } catch (actErr) {
        logger.warn({ workerId, error: actErr }, 'killWorker: failed to update agent_activity');
      }
    }

    // Build descriptive message: "Stopped worker <shortId> (<model>, '<summary>', <elapsed>)"
    const message = `Stopped worker ${this.formatWorkerSummary(worker)}`;
    logger.info({ workerId, pid: worker.pid }, 'Worker killed by user request');

    // Queue cancellation notification for the Master AI (OB-884).
    // On the next Master call, buildMasterSpawnOptions() will inject this so the
    // Master knows not to re-spawn this worker unless the user explicitly asks.
    const shortId = workerId.split('-').pop() ?? workerId;
    const taskSummary = worker.taskManifest.prompt.slice(0, 80).replace(/\n/g, ' ');
    this.pendingCancellationNotifications.push(
      `Worker ${shortId} was CANCELLED by user ${cancelledBy}. Task: "${taskSummary}". Do NOT retry this task unless the user explicitly asks.`,
    );

    // Broadcast cancellation to all connected channels (OB-883)
    if (this.router) {
      const shortId = workerId.split('-').pop() ?? workerId;
      try {
        await this.router.broadcastProgress({
          type: 'worker-cancelled',
          workerId: shortId,
          cancelledBy,
        });
      } catch (broadcastErr) {
        logger.warn({ workerId, broadcastErr }, 'killWorker: failed to broadcast cancellation');
      }
    }

    return { success: true, message };
  }

  /**
   * Kill all currently running workers.
   *
   * Calls killWorker() for each running worker and aggregates the results.
   * Returns an object with the list of stopped worker IDs and a human-readable
   * summary message.
   */
  public async killAllWorkers(
    cancelledBy = 'user',
  ): Promise<{ stopped: string[]; message: string }> {
    const running = this.workerRegistry.getRunningWorkers();

    if (running.length === 0) {
      return { stopped: [], message: 'No workers are currently running.' };
    }

    const stopped: string[] = [];
    const lines: string[] = [];

    for (const worker of running) {
      const result = await this.killWorker(worker.id, cancelledBy);
      if (result.success) {
        stopped.push(worker.id);
        lines.push(`- ${this.formatWorkerSummary(worker)}`);
      }
    }

    const count = stopped.length;
    const message = `Stopped ${count} worker${count !== 1 ? 's' : ''}:\n${lines.join('\n')}`;
    return { stopped, message };
  }

  /**
   * Set the Router so pending messages can be routed after exploration completes.
   * Bridge calls this after setMaster() so the Master can deliver queued messages.
   */
  public setRouter(router: Router): void {
    this.router = router;
  }

  /**
   * Set the BatchManager for Batch Task Continuation (OB-1613).
   * Called by Bridge after construction so the MasterManager can schedule
   * continuation triggers after each processed message.
   */
  public setBatchManager(bm: BatchManager): void {
    this.batchManager = bm;
  }

  /**
   * Handle a batch item failure — pauses the batch and sends a failure message to the user.
   *
   * Called by the Router when processMessage throws during a CONTINUE:batch message (OB-1616).
   * Looks up the original sender info (stored when the batch was first scheduled) to route
   * the failure notification to the correct connector.
   *
   * @param batchId  The batch that was being processed when the failure occurred.
   * @param reason   Short human-readable failure reason (e.g. error message).
   */
  public async onBatchItemFailure(batchId: string, reason: string): Promise<void> {
    if (!this.batchManager || !this.router) return;

    await this.batchManager.pauseBatch(batchId);

    const senderInfo = this.batchManager.getSenderInfo(batchId);
    if (!senderInfo) {
      logger.warn(
        { batchId },
        'onBatchItemFailure: no sender info — cannot deliver failure message',
      );
      return;
    }

    const failureMsg = this.batchManager.buildFailureMessage(batchId, reason);
    if (failureMsg) {
      void this.router.sendDirect(senderInfo.source, senderInfo.sender, failureMsg);
      logger.info({ batchId, sender: senderInfo.sender }, 'Batch failure message sent to user');
    }
  }

  /**
   * Handle a user-issued batch control command: skip, retry, or abort (OB-1616).
   *
   * These commands are intercepted by the Router and forwarded here.
   * Returns a human-readable response string to be sent back to the user.
   *
   * @param action  One of 'skip', 'retry', or 'abort'.
   * @param sender  Original sender ID (for scheduling the next continuation).
   * @param source  Original connector source (for response routing).
   * @returns       Response message to send back to the user.
   */
  public async handleBatchCommand(
    action: 'pause' | 'resume' | 'skip' | 'retry' | 'abort',
    sender: string,
    source: string,
  ): Promise<string> {
    if (!this.batchManager) return 'No active batch.';

    const batchId = this.batchManager.getCurrentBatchId();
    if (!batchId) return 'No active batch found.';

    // Update stored sender info in case it changed (e.g. source connector switch) (OB-1667).
    this.batchManager.setSenderInfo(batchId, { sender, source });

    if (action === 'pause') {
      await this.batchManager.pauseBatch(batchId);
      const state = this.batchManager.getStatus(batchId);
      const current = state ? state.currentIndex + 1 : '?';
      const total = state ? state.totalItems : '?';
      logger.info({ batchId, current, total }, 'Batch paused by user command (OB-1619)');
      return `⏸ Batch paused at item ${current}/${total}. Reply '/continue' to resume.`;
    }

    if (action === 'resume') {
      const resumed = await this.batchManager.resumeBatch(batchId);
      if (!resumed) return 'No paused batch found to resume.';
      const state = this.batchManager.getStatus(batchId);
      const current = state ? state.currentIndex + 1 : '?';
      logger.info({ batchId, current }, 'Batch resumed by user command (OB-1620)');
      // Re-inject continuation to trigger the next item
      if (this.router) {
        const router = this.router;
        const handle = setTimeout(() => {
          this.batchTimers.delete(handle);
          if (this.state === 'shutdown') return;
          router.routeBatchContinuation(batchId, sender).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            void this.batchManager?.pauseBatch(batchId);
            void router.sendDirect(source, sender, `Batch paused due to error: ${msg}`);
            logger.error(
              { batchId, err },
              'routeBatchContinuation failed — batch paused (OB-1666)',
            );
          });
        }, 500);
        this.batchTimers.add(handle);
      }
      return `▶ Resuming batch from item ${current}...`;
    }

    if (action === 'abort') {
      await this.batchManager.abortBatch(batchId);
      this.batchManager.deleteSenderInfo(batchId);
      logger.info({ batchId }, 'Batch aborted by user command');
      // Retrieve the abort summary built by abortBatch() before state was deleted (OB-1622).
      const abortSummary = this.batchManager.popCompletionSummary();
      return abortSummary ?? '🛑 Batch aborted.';
    }

    if (action === 'skip') {
      const result = await this.batchManager.skipCurrentItem(batchId);
      if (!result) return 'Failed to skip — batch not found.';
      if (result.finished) {
        this.batchManager.deleteSenderInfo(batchId);
        return '⏭ Item skipped. Batch complete — no more items.';
      }
      // Schedule next continuation
      if (this.router) {
        const router = this.router;
        const handle = setTimeout(() => {
          this.batchTimers.delete(handle);
          if (this.state === 'shutdown') return;
          router.routeBatchContinuation(batchId, sender).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            void this.batchManager?.pauseBatch(batchId);
            void router.sendDirect(source, sender, `Batch paused due to error: ${msg}`);
            logger.error(
              { batchId, err },
              'routeBatchContinuation failed — batch paused (OB-1666)',
            );
          });
        }, 1000);
        this.batchTimers.add(handle);
      }
      logger.info(
        { batchId, nextIndex: result.nextIndex },
        'Batch item skipped, continuing (OB-1623)',
      );
      return '⏭ Item skipped. Continuing with next item...';
    }

    // action === 'retry'
    const retried = await this.batchManager.retryCurrentItem(batchId);
    if (!retried) return 'Failed to retry — batch not found.';
    // Schedule continuation (same index, so same item runs again)
    if (this.router) {
      const router = this.router;
      const handle = setTimeout(() => {
        this.batchTimers.delete(handle);
        if (this.state === 'shutdown') return;
        router.routeBatchContinuation(batchId, sender).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          void this.batchManager?.pauseBatch(batchId);
          void router.sendDirect(source, sender, `Batch paused due to error: ${msg}`);
          logger.error({ batchId, err }, 'routeBatchContinuation failed — batch paused (OB-1666)');
        });
      }, 1000);
      this.batchTimers.add(handle);
    }
    logger.info({ batchId }, 'Batch item retry scheduled by user command');
    return '🔄 Retrying item...';
  }

  /**
   * Return a formatted batch status message for the `/batch` command (OB-1621).
   *
   * Shows the current item, progress (N/total), elapsed time, accumulated cost,
   * and a list of failed items. Returns "No active batch." when no batch is running.
   */
  public getBatchStatus(): string {
    if (!this.batchManager) return 'No active batch.';

    const batchId = this.batchManager.getCurrentBatchId();
    if (!batchId) return 'No active batch.';

    const state = this.batchManager.getStatus(batchId);
    if (!state) return 'No active batch.';

    const current = state.currentIndex + 1;
    const total = state.totalItems;
    const currentItem = state.plan[state.currentIndex];

    // Elapsed time
    const elapsedMs = Date.now() - new Date(state.startedAt).getTime();
    const totalSeconds = Math.round(elapsedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    let elapsedStr: string;
    if (hours > 0) {
      elapsedStr = `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      elapsedStr = `${minutes}m ${seconds}s`;
    } else {
      elapsedStr = `${seconds}s`;
    }

    const costStr = state.totalCostUsd > 0 ? `$${state.totalCostUsd.toFixed(4)}` : 'not tracked';
    const statusIcon = state.paused ? '⏸ Paused' : '▶ Running';

    const lines: string[] = [
      `📋 Batch Status: ${statusIcon}`,
      `**Progress:** ${current}/${total} items`,
    ];

    if (currentItem) {
      const desc = currentItem.description ? ` — ${currentItem.description}` : '';
      lines.push(`**Current item:** ${currentItem.id}${desc}`);
    }

    lines.push(`**Elapsed:** ${elapsedStr}`);
    lines.push(`**Cost:** ${costStr}`);

    if (state.failedItems.length > 0) {
      lines.push(`**Failed:** ${state.failedItems.join(', ')}`);
    }

    logger.info({ batchId, current, total }, 'Batch status queried by user (OB-1621)');
    return lines.join('\n');
  }

  /**
   * Set the KnowledgeRetriever for RAG-based context injection (OB-1344).
   * Bridge calls this after MemoryManager is initialized and DotFolderManager is ready.
   */
  public setKnowledgeRetriever(retriever: KnowledgeRetriever): void {
    this.knowledgeRetriever = retriever;
  }

  /**
   * Set the IntegrationHub — exposes connected integrations to the Master AI.
   * Called by Bridge.start() after the hub is created.
   */
  public setIntegrationHub(hub: IntegrationHub): void {
    this.integrationHub = hub;
  }

  /**
   * Build the list of connected integrations for the Master system prompt.
   * Only returns integrations that have been successfully initialized (connected=true).
   */
  private buildConnectedIntegrations(): ConnectedIntegrationEntry[] | undefined {
    if (!this.integrationHub) return undefined;
    const all = this.integrationHub.list();
    const connected = all.filter((info) => info.connected);
    if (connected.length === 0) return undefined;
    return connected.map((info) => {
      const integration = this.integrationHub!.get(info.name);
      return {
        name: info.name,
        type: info.type,
        capabilities: integration.describeCapabilities(),
      };
    });
  }

  /**
   * Set the names of active connectors so they can be included in the Master system prompt.
   * Called by the startup flow after Bridge.start() completes and connectors are initialized.
   */
  public setActiveConnectorNames(names: string[]): void {
    this.activeConnectorNames = [...names];
  }

  /**
   * Set the port the local file server is listening on so it can be included in the Master system prompt.
   * Called by the startup flow after bridge.start() successfully starts the file server.
   */
  public setFileServerPort(port: number): void {
    this.fileServerPort = port;
  }

  /**
   * Set the public tunnel URL so it can be included in the Master system prompt.
   * Pass null to clear the tunnel URL (e.g. when the tunnel stops).
   * Called by the startup flow after bridge.start() successfully starts a tunnel.
   */
  public setTunnelUrl(url: string | null): void {
    this.tunnelUrl = url;
  }

  /**
   * Replace the active MCP server list and mark the cached system prompt as stale.
   * Called by Bridge.onConfigChange() when config.json is hot-reloaded.
   * The next Master session call will regenerate the system prompt with the new servers.
   */
  public reloadMcpServers(servers: MCPServer[]): void {
    this.mcpServers = [...servers];
    // Null out the cached prompt so buildMasterSpawnOptions() reloads it
    // on the next message, incorporating the updated MCP server list.
    this.systemPrompt = null;
    logger.info({ count: servers.length }, 'MCP servers hot-reloaded — system prompt marked stale');
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
   * Load the worker registry from DB (system_config) or .openbridge/workers.json fallback.
   * Called during start() to restore worker state from previous sessions.
   */
  private async loadWorkerRegistry(): Promise<void> {
    try {
      let registry = null;

      // Try DB first
      if (this.memory) {
        const raw = await this.memory.getSystemConfig('workers');
        if (raw) {
          try {
            registry = WorkersRegistrySchema.parse(JSON.parse(raw));
          } catch {
            // fall through to JSON file
          }
        }
      }

      // Fall back to JSON file
      if (!registry) {
        registry = await this.dotFolder.readWorkers();
      }

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
   * Persist the worker registry to system_config (DB) and .openbridge/workers.json (fallback).
   * Called after worker state changes to maintain cross-restart visibility.
   */
  private async persistWorkerRegistry(): Promise<void> {
    try {
      const registry = this.workerRegistry.toJSON();
      if (this.memory) {
        await this.memory.setSystemConfig('workers', JSON.stringify(registry));
      } else {
        await this.dotFolder.writeWorkers(registry);
      }
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

    // Check for code audit markers
    if (prompt.includes('Task: Code Audit') || prompt.includes('Code Audit')) {
      return 'task-code-audit';
    }

    // Check for generate output markers
    if (prompt.includes('Generate Output File') || prompt.includes('SHARE marker')) {
      return 'task-generate-output';
    }

    // Check for targeted read markers
    if (prompt.includes('Targeted File Read') || prompt.includes('Files to Read')) {
      return 'task-targeted-read';
    }

    // Check for build app markers
    if (prompt.includes('Build Web App') || prompt.includes('APP:start')) {
      return 'task-build-app';
    }

    // Check for Deep Mode markers (most specific first to avoid cross-matching)
    if (prompt.includes('Deep Mode') && prompt.includes('Verify Phase')) {
      return 'deep-verify';
    }
    if (prompt.includes('Deep Mode') && prompt.includes('Execute Phase')) {
      return 'deep-execute';
    }
    if (prompt.includes('Deep Mode') && prompt.includes('Plan Phase')) {
      return 'deep-plan';
    }
    if (prompt.includes('Deep Mode') && prompt.includes('Report Phase')) {
      return 'deep-report';
    }
    if (prompt.includes('Deep Mode') && prompt.includes('Investigate Phase')) {
      return 'deep-investigate';
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

      if (this.memory) {
        await this.memory.recordPromptOutcome(promptId, isValid);
      }

      // Also record in dotfolder manifest (used by prompt evolution / evolvePrompts) (OB-1612)
      await this.dotFolder.recordPromptUsage(promptId, isValid);

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
      const taskType = classifyTaskType(taskRecord.userMessage);

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
          result.turnsUsed ?? 0,
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

  /** Delegate to ClassificationEngine (OB-1279). */
  public normalizeForCache(content: string): string {
    return this.classificationEngine.normalizeForCache(content);
  }

  /** Delegate to ClassificationEngine (OB-1279). */
  public async recordClassificationFeedback(
    normalizedKey: string,
    turnBudgetSufficient: boolean,
    timedOut: boolean,
    turnsUsed?: number,
  ): Promise<void> {
    return this.classificationEngine.recordClassificationFeedback(
      normalizedKey,
      turnBudgetSufficient,
      timedOut,
      turnsUsed,
    );
  }

  /** Delegate to ClassificationEngine (OB-1279). */
  public async classifyTask(content: string, sessionId?: string): Promise<ClassificationResult> {
    return this.classificationEngine.classifyTask(content, sessionId);
  }

  /** @deprecated — delegate to ClassificationEngine. Remove once all internal callers use engine directly. */
  private classifyTaskByKeywords(
    content: string,
    recentUserMessages?: string[],
    lastBotResponse?: string,
  ): ClassificationResult {
    return this.classificationEngine.classifyTaskByKeywords(
      content,
      recentUserMessages,
      lastBotResponse,
    );
  }

  /**
   * Build a per-message context header with channel and role information (OB-1625).
   * Injected at the start of every prompt so the Master can make channel-aware decisions.
   */
  private async getMessageContextHeader(message: InboundMessage): Promise<string> {
    let role = 'owner';
    if (this.memory) {
      try {
        const entry = await this.memory.getAccess(message.sender, message.source);
        if (entry) role = entry.role;
      } catch {
        /* default to owner */
      }
    }
    return `[Context: channel=${message.source}, sender=${message.sender}, role=${role}]\n\n`;
  }

  /**
   * Build a planning prompt for complex tasks.
   * Instructs the Master to decompose the request into SPAWN markers
   * without executing the tasks itself — forcing delegation within 3-5 turns.
   */
  private buildPlanningPrompt(userMessage: string): string {
    const availableTools = this.discoveredTools.filter((t) => t.available);
    const hasMultipleTools = availableTools.length > 1;

    // When multiple tools are available, include tool field in the example format
    const spawnExample = hasMultipleTools
      ? `[SPAWN:profile]{"prompt":"...","tool":"<tool>","model":"balanced","maxTurns":15}[/SPAWN]`
      : `[SPAWN:profile]{"prompt":"...","model":"balanced","maxTurns":15}[/SPAWN]`;

    let prompt =
      `The user asked: "${userMessage}"\n\n` +
      `Break this into 1-3 concrete subtasks. For each subtask, output a SPAWN marker ` +
      `with the appropriate profile, model, and instructions. ` +
      `Do NOT execute the tasks yourself — only plan and delegate.\n\n` +
      `Use this format for each subtask:\n` +
      `${spawnExample}\n\n` +
      `Model tiers: \`fast\` (cheap, mechanical tasks), \`balanced\` (default), \`powerful\` (complex reasoning). ` +
      `Always use tier names — they auto-resolve to the correct model per tool.\n\n` +
      `Available profiles: read-only (Read/Glob/Grep), code-edit (Read/Edit/Write/Glob/Grep/Bash(git:*)/Bash(npm:*)), full-access (all tools).`;

    // When multiple tools are available, strongly guide the Master to pick the best tool per worker
    if (hasMultipleTools) {
      const toolStrengths: Record<string, string> = {
        claude: 'deep reasoning, complex architecture, code review',
        codex: 'quick code edits, simple refactors, mechanical changes',
        aider: 'git-aware refactors, multi-file renames, commit-driven workflows',
      };

      const toolLines = availableTools
        .map((t) => {
          const strength = toolStrengths[t.name] ?? 'general-purpose';
          return `  - \`${t.name}\`: ${strength}`;
        })
        .join('\n');

      prompt +=
        `\n\n**IMPORTANT — Tool Selection:** You MUST choose the best AI tool for each worker using the \`"tool"\` field. ` +
        `Available tools:\n${toolLines}\n\n` +
        `Route each subtask to the tool best suited for it. ` +
        `For example, use \`"tool":"codex"\` for straightforward code edits and \`"tool":"claude"\` for tasks requiring deep understanding. ` +
        `Do NOT default all workers to \`${this.masterTool.name}\` — distribute work across tools based on task fit.`;
    }

    return prompt;
  }

  /**
   * Autonomously explore the workspace and create .openbridge/ folder.
   * Delegated to ExplorationManager (OB-1280).
   */
  public async explore(): Promise<void> {
    return this.explorationManager.explore();
  }

  /**
   * Check for workspace changes since the last analysis and decide which
   * exploration path to take. Delegated to ExplorationManager (OB-1280).
   */
  private async checkWorkspaceChanges(
    existingMap: WorkspaceMap,
  ): Promise<'no-changes' | 'incremental' | 'full-reexplore'> {
    return this.explorationManager.checkWorkspaceChanges(existingMap);
  }

  // incrementalExplore() moved to ExplorationManager (OB-1280)

  // masterDrivenExplore() moved to ExplorationManager (OB-1280)

  // emitExplorationProgress() moved to ExplorationManager (OB-1280)

  // monolithicExplore() moved to ExplorationManager (OB-1280)

  /** Write the agents registry — delegates to ExplorationManager (OB-1280). */
  private async writeAgentsRegistry(): Promise<void> {
    return this.explorationManager.writeAgentsRegistry();
  }

  /** Load exploration summary — delegates to ExplorationManager (OB-1280). */
  private async loadExplorationSummary(): Promise<void> {
    return this.explorationManager.loadExplorationSummary();
  }

  /** Re-explore the workspace. Delegated to ExplorationManager (OB-1280). */
  public async reExplore(): Promise<void> {
    return this.explorationManager.reExplore();
  }

  /** Full re-exploration. Delegated to ExplorationManager (OB-1280). */
  public async fullReExplore(): Promise<void> {
    return this.explorationManager.fullReExplore();
  }

  /**
   * Reset the idle timer (called on each user message).
   * Tracks the timestamp of the last user interaction for idle detection.
   */
  private resetIdleTimer(): void {
    this.lastMessageTimestamp = Date.now();
    this.consecutiveIdleCycles = 0;
    this.consecutiveNoOpCycles = 0;
  }

  /** Drain pending messages. Delegated to ExplorationManager (OB-1280). */
  private async drainPendingMessages(): Promise<void> {
    return this.explorationManager.drainPendingMessages();
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

    // Recover from error state instead of permanently rejecting messages.
    // recover() resets state to 'idle' and re-triggers exploration if needed,
    // which transitions state to 'exploring' before returning.
    if (this.state === 'error') {
      logger.info(
        { sender: message.sender },
        'Master in error state — attempting recovery before processing message',
      );
      await this.recover();
      // After recover(), state is 'exploring' (exploration retry fired).
      // Queue this message so it is processed once exploration completes.
      this.pendingMessages.push(message);
      return 'The AI encountered an exploration error and is retrying. Your message will be processed once recovery completes.';
    }

    if (this.state !== 'ready') {
      logger.warn(
        { currentState: this.state, sender: message.sender },
        'Cannot process message: Master not ready',
      );
      return `The AI is currently ${this.state}. Please try again in a moment.`;
    }

    const originalContent = message.content;
    const originalRawContent = message.rawContent;
    let activeBatchId: string | undefined;
    let activeBatchItemId: string | undefined;

    // If a batch is active, process the next batch item instead of re-parsing the incoming message.
    if (this.batchManager && this.batchManager.isActive()) {
      const currentBatchId = this.batchManager.getCurrentBatchId();
      if (currentBatchId) {
        const state = this.batchManager.getStatus(currentBatchId);
        const currentItem = state?.plan[state.currentIndex];
        if (currentItem) {
          activeBatchId = currentBatchId;
          activeBatchItemId = currentItem.id;
          const batchPrompt = currentItem.description?.trim() || currentItem.id;
          message.content = batchPrompt;
          message.rawContent = batchPrompt;
          logger.info(
            { batchId: currentBatchId, itemId: currentItem.id },
            'Batch active — processing next item',
          );
        } else {
          logger.warn(
            { batchId: currentBatchId },
            'Batch active but no current item found — falling back to incoming message',
          );
        }
      }
    }

    this.state = 'processing';
    this.activeMessage = message;

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
    if (activeBatchId && activeBatchItemId) {
      task.metadata = {
        ...task.metadata,
        batchId: activeBatchId,
        batchItemId: activeBatchItemId,
        originalUserMessage: originalRawContent,
        originalUserContent: originalContent,
      };
    }

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
      // and fetch learned patterns for system prompt enrichment (OB-735)
      const [
        conversationContext,
        learnedPatternsContext,
        workerNextStepsContext,
        templateSelectionContext,
      ] = await Promise.all([
        this.buildConversationContext(message.content, sessionId, message.sender),
        this.buildLearnedPatternsContext(),
        this.buildWorkerNextStepsContext(),
        this.promptContextBuilder.buildTemplateSelectionContext(),
      ]);

      // (1) Emit classifying event — AI is analyzing the message
      await progress?.({ type: 'classifying' });

      // Classify message to determine appropriate turn budget
      const classification = await this.classifyTask(message.content, sessionId);
      let taskClass = classification.class;
      let taskMaxTurns = classification.maxTurns;
      logger.info({ taskClass, taskMaxTurns, reason: classification.reason }, 'Message classified');

      // Attachment escalation — OB-1257
      // If the message has file attachments and was classified as quick-answer,
      // escalate to tool-use: file analysis needs tool access and a larger turn budget.
      if (taskClass === 'quick-answer' && message.attachments && message.attachments.length > 0) {
        logger.info(
          { attachmentCount: message.attachments.length, from: 'quick-answer', to: 'tool-use' },
          'Attachment detected — escalating quick-answer to tool-use (15 turns, 510s)',
        );
        taskClass = 'tool-use';
        taskMaxTurns = MESSAGE_MAX_TURNS_TOOL_USE;
      }

      // DocType creation intent — OB-1384
      // When the classifier detects doctype-creation phrases, override the prompt so the Master
      // spawns a worker to design and register a DocType with appropriate fields, states, and hooks.
      if (classification.doctypeCreation && classification.doctypeEntity) {
        const entity = classification.doctypeEntity;
        logger.info({ entity }, 'DocType creation intent detected — injecting design prompt');
        // Escalate to complex-task if not already
        taskClass = 'complex-task';
        taskMaxTurns = MESSAGE_MAX_TURNS_PLANNING;
      }

      // Deep Mode activation — OB-1403
      // If the configured default profile is 'thorough' or 'manual' and the task class is
      // 'complex-task', start a multi-phase Deep Mode session beginning with investigate phase.
      // Fast profile (default) skips Deep Mode entirely and falls through to normal processing.
      if (taskClass === 'complex-task') {
        const effectiveProfile = this.deepConfig?.defaultProfile ?? 'fast';
        if (effectiveProfile === 'thorough' || effectiveProfile === 'manual') {
          const deepSessionId = this.deepMode.startSession(
            message.content,
            effectiveProfile,
            progress,
          );
          if (deepSessionId) {
            // Persist new session to SQLite so it survives process restarts (OB-1405)
            await this.persistDeepModeSession(deepSessionId);

            const currentPhase = this.deepMode.getCurrentPhase(deepSessionId);
            const phasePrompt = this.deepMode.getPhaseSystemPrompt(deepSessionId);
            logger.info(
              { deepSessionId, profile: effectiveProfile, currentPhase },
              'Deep Mode activated — starting with investigate phase',
            );
            // Return an early response indicating Deep Mode has started.
            // Per-phase worker execution is wired in subsequent tasks (OB-1417+).
            const response = [
              `Deep Mode started (${effectiveProfile} profile) — **${currentPhase ?? 'investigate'} phase**`,
              '',
              phasePrompt
                ? phasePrompt.split('\n')[0]
                : 'Exploring and identifying relevant context.',
              '',
              effectiveProfile === 'manual'
                ? 'I will pause after each phase for your review. Reply with `/proceed` to advance to the next phase.'
                : 'I will run all phases automatically and report when complete.',
            ].join('\n');
            task.status = 'completed';
            task.result = response;
            task.completedAt = new Date().toISOString();
            task.durationMs =
              new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();
            task.metadata = { ...task.metadata, deepSessionId };
            await this.recordTaskToStore(task);
            await this.recordConversationMessage(sessionId, 'master', response);
            void this.recordClassificationFeedback(
              this.normalizeForCache(message.content),
              true,
              false,
            );
            this.onTaskCompleted();
            this.state = 'ready';
            await progress?.({ type: 'complete' });
            return response;
          }
        }
      }

      // Knowledge retrieval for codebase questions and single-tool tasks (OB-1345, OB-1349)
      // Query pre-indexed knowledge before building the Master prompt.
      // Run for 'quick-answer' (codebase questions) and 'tool-use' (targeted edits/lookups)
      // where pre-fetched context helps the Master answer or act without spawning extra workers.
      // Skip for 'complex-task' — Master needs to plan and delegate; RAG context is not useful
      // at planning time and adds noise to the delegation prompt.
      let knowledgeContext: string | undefined;
      let targetedReaderContext: string | undefined;
      if ((taskClass === 'quick-answer' || taskClass === 'tool-use') && this.knowledgeRetriever) {
        const knowledgeResult = await this.knowledgeRetriever.query(message.content);
        logger.info(
          {
            question: message.content.slice(0, 80),
            confidence: knowledgeResult.confidence,
            chunkCount: knowledgeResult.chunks.length,
            sources: knowledgeResult.sources,
          },
          'RAG query completed',
        );
        // RAG retry with classifier description (OB-1569): when the raw user message
        // (e.g. Arabizi/Darija) returns zero chunks, retry with the AI classifier's English
        // description, which has already translated the user's intent.
        let effectiveKnowledgeResult = knowledgeResult;
        if (knowledgeResult.chunks.length === 0 && classification.ragQuery) {
          const retryResult = await this.knowledgeRetriever.query(classification.ragQuery);
          logger.info(
            {
              originalQueryLen: message.content.length,
              retryQueryLen: classification.ragQuery.length,
              retryChunkCount: retryResult.chunks.length,
              retryConfidence: retryResult.confidence,
            },
            'RAG retry with classifier description',
          );
          if (retryResult.chunks.length > 0) {
            effectiveKnowledgeResult = retryResult;
          }
        }
        if (effectiveKnowledgeResult.confidence < 0.3) {
          logger.debug(
            { confidence: effectiveKnowledgeResult.confidence },
            'Low confidence, worker may be needed',
          );
          // Targeted reader: suggest files from workspace map and spawn a focused
          // read-only worker to answer the question. (OB-1354)
          const workspaceMap = await this.dotFolder.readWorkspaceMap();
          if (workspaceMap) {
            const suggestedFiles = this.knowledgeRetriever.suggestTargetFiles(
              message.content,
              workspaceMap,
            );
            if (suggestedFiles.length > 0) {
              logger.debug(
                { fileCount: suggestedFiles.length },
                'Low RAG confidence — spawning targeted reader',
              );
              const readerResult = await this.spawnTargetedReader(suggestedFiles, message.content);
              if (readerResult) {
                targetedReaderContext = readerResult;
              }
            } else {
              logger.debug('No target files identified, falling back to Master handling');
            }
          }
          // Workspace-map summary fallback (OB-1570): when RAG returns low confidence
          // and targeted reader also fails, inject a workspace overview so workers
          // get basic project context even when FTS5 fails completely.
          if (!knowledgeContext && !targetedReaderContext && workspaceMap) {
            knowledgeContext = `## Workspace Overview (fallback)\n\n${JSON.stringify(workspaceMap.projectType ?? 'unknown')} project with ${Object.keys(workspaceMap.structure ?? {}).length} directories.\nKey files: ${(
              workspaceMap.keyFiles ?? []
            )
              .slice(0, 10)
              .map((f) => f.path)
              .join(', ')}`;
            if (knowledgeContext.length > SECTION_BUDGET_RAG) {
              knowledgeContext = knowledgeContext.slice(0, SECTION_BUDGET_RAG);
            }
            logger.info('Workspace-map summary fallback injected (OB-1570)');
          }
        }
        if (effectiveKnowledgeResult.confidence >= 0.3) {
          knowledgeContext =
            this.knowledgeRetriever.formatKnowledgeContext(effectiveKnowledgeResult);
        }
      }

      // For complex tasks, send a planning prompt that forces the Master to output
      // SPAWN markers within a small turn budget instead of attempting execution itself.
      let promptToSend =
        taskClass === 'complex-task' ? this.buildPlanningPrompt(message.content) : message.content;
      // For menu-selection, inject the selected option text so Master sees context, not just a digit (OB-1659).
      // E.g., user sends "3" → Master sees "User selected option 3: 'Deploy to staging'"
      if (classification.menuSelection) {
        const digit = message.content.trim();
        promptToSend = classification.selectedOptionText
          ? `User selected option ${digit}: '${classification.selectedOptionText}'`
          : `User selected option ${digit}`;
      }
      // DocType creation — inject a design prompt so Master spawns a worker to build the DocType (OB-1384)
      if (classification.doctypeCreation && classification.doctypeEntity) {
        const entity = classification.doctypeEntity;
        promptToSend =
          `The user wants to track "${entity}". ` +
          `Design a "${entity}" DocType with appropriate fields (name, status, dates, amounts, references), ` +
          `states (e.g. draft → active → completed), computed fields where useful, and lifecycle hooks. ` +
          `Use the DocType system in src/intelligence/ to register it. ` +
          `Original request: ${message.content}`;
      }
      // Prepend channel + role context header so Master can make channel-aware decisions (OB-1625)
      promptToSend = (await this.getMessageContextHeader(message)) + promptToSend;
      // complex-task always uses planning turns; otherwise use AI-suggested budget
      const maxTurnsToUse =
        taskClass === 'complex-task' ? MESSAGE_MAX_TURNS_PLANNING : taskMaxTurns;
      // Derive timeout from the actual turns used (complex-task overrides to planning turns)
      const timeoutToUse =
        taskClass === 'complex-task'
          ? turnsToTimeout(MESSAGE_MAX_TURNS_PLANNING)
          : classification.timeout;
      // Clamp to message timeout boundary so no classification can exceed it (OB-F217)
      const safeTimeout = Math.min(timeoutToUse, DEFAULT_MESSAGE_TIMEOUT - 10_000);
      if (safeTimeout < timeoutToUse) {
        logger.warn(
          { originalTimeout: timeoutToUse, safeTimeout },
          'Timeout clamped to message timeout boundary',
        );
      }

      if (taskClass === 'complex-task') {
        logger.info('Complex task — using planning prompt for auto-delegation');
        // (2) Emit planning event — Master is decomposing the task
        await progress?.({ type: 'planning' });
      }

      // ── Planning Gate (OB-1779) ─────────────────────────────────────────────
      // Reset the gate for each new message so no state leaks between user turns.
      // For complex tasks, run up to 2 read-only analysis workers before the Master
      // generates SPAWN execution markers — gating execution on prior investigation.
      this.planningGate.reset();
      let analysisContext: string | null = null;
      if (taskClass === 'complex-task') {
        const bypassDecision = shouldBypassPlanning(message.content);
        if (bypassDecision.bypass) {
          this.planningGate.bypass(message.content, bypassDecision.reason);
          logger.debug({ reason: bypassDecision.reason }, 'Planning gate: bypassed');
        } else {
          // Analysis phase — spawn read-only workers to investigate before execution (OB-1776)
          const analysisSpecs = this.planningGate.buildAnalysisWorkerSpecs(message.content);
          this.planningGate.startAnalysis(message.content);
          await Promise.all(
            analysisSpecs.map(async (spec) => {
              this.planningGate.recordAnalysisWorker({
                id: spec.id,
                prompt: spec.prompt,
                spawnedAt: new Date().toISOString(),
              });
              const analysisOpts: SpawnOptions = {
                workspacePath: this.workspacePath,
                prompt: spec.prompt,
                allowedTools: [...TOOLS_READ_ONLY],
                maxTurns: spec.maxTurns,
              };
              try {
                const ar = await this.agentRunner.spawn(analysisOpts);
                const out =
                  ar.exitCode === 0
                    ? ar.stdout.trim()
                    : `[analysis worker error: ${ar.stderr.slice(0, 300)}]`;
                this.planningGate.completeAnalysisWorker(spec.id, out);
              } catch (err) {
                this.planningGate.completeAnalysisWorker(
                  spec.id,
                  `[analysis worker failed: ${err instanceof Error ? err.message : String(err)}]`,
                );
              }
            }),
          );
          if (this.planningGate.canCompleteAnalysis) {
            const aggregated = this.planningGate.aggregateWorkerOutputs();
            this.planningGate.completeAnalysis(aggregated);
            this.planningGate.confirmApproach('Proceeding with execution workers');
            analysisContext = `## Pre-task Analysis\n\n${aggregated}`;
            logger.info(
              { workerCount: this.planningGate.completedAnalysisWorkerCount },
              'Planning gate: analysis complete, execution phase unlocked',
            );
          } else {
            // Partial analysis — bypass gate rather than block execution
            logger.warn('Planning gate: not all analysis workers completed — bypassing gate');
            this.planningGate.bypass(message.content, 'analysis workers incomplete — fallback');
          }
        }
      } else {
        this.planningGate.bypass(
          message.content,
          `task class '${taskClass}' does not require planning`,
        );
      }
      // ── End Planning Gate ───────────────────────────────────────────────────

      // Check if task targets a specific sub-master's scope (OB-755)
      // For non-trivial tasks, detect file-path mentions that belong to a sub-project
      // and route directly to that sub-master's context instead of the root Master.
      if (taskClass !== 'quick-answer' && this.subMasterManager) {
        const allSubMasters = await this.subMasterManager.listSubMasters();
        const activeSubMasters = allSubMasters.filter((sm) => sm.status === 'active');
        if (activeSubMasters.length > 0) {
          const routing = this.detectSubMasterRouting(message.content, activeSubMasters);
          if (routing) {
            logger.info(
              { type: routing.type, count: routing.subMasters.length },
              'Routing task to sub-master(s)',
            );
            await progress?.({ type: 'spawning', workerCount: routing.subMasters.length });

            const subMasterResponse = await this.handleSubMasterDelegation(
              routing,
              message.content,
              progress,
            );

            task.status = 'completed';
            task.result = subMasterResponse;
            task.completedAt = new Date().toISOString();
            task.durationMs =
              new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();
            await this.recordTaskToStore(task);
            await this.recordConversationMessage(sessionId, 'master', subMasterResponse);
            void this.recordClassificationFeedback(
              this.normalizeForCache(message.content),
              true,
              false,
            );
            this.onTaskCompleted();
            this.state = 'ready';
            await progress?.({ type: 'complete' });
            return subMasterResponse;
          }
        }
      }

      // Execute message through the persistent Master session (OB-1246: budget-aware assembly)
      const masterContext: MasterContextSections = {
        conversationContext,
        learnedPatternsContext,
        workerNextStepsContext,
        knowledgeContext,
        targetedReaderContext,
        analysisContext,
        templateSelectionContext,
      };
      const spawnOpts = this.buildMasterSpawnOptions(
        promptToSend,
        safeTimeout,
        maxTurnsToUse,
        masterContext,
      );
      let result = await this.agentRunner.spawn(spawnOpts);
      await this.updateMasterSession();
      void this._checkCompaction();

      // Detect dead session and restart transparently
      if (result.exitCode !== 0 && this.isSessionDead(result.exitCode, result.stderr)) {
        logger.warn(
          { exitCode: result.exitCode, stderr: result.stderr.slice(0, 200) },
          'Master session appears dead, attempting restart',
        );

        await this.restartMasterSession();

        // Retry with the same prompt and context sections (OB-1246: budget-aware assembly)
        const retryOpts = this.buildMasterSpawnOptions(
          promptToSend,
          safeTimeout,
          maxTurnsToUse,
          masterContext,
        );
        result = await this.agentRunner.spawn(retryOpts);
        await this.updateMasterSession();
        void this._checkCompaction();
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

          // If the cleaned output (text outside SPAWN markers) is very short, prepare
          // a status message to show the user instead of a near-empty stub response.
          const cleanedOutput = spawnResult.cleanedOutput;
          const originalLength = response.length;
          const cleanedLength = cleanedOutput.length;
          const spawnSummaries = extractTaskSummaries(spawnResult.markers);
          logger.debug(
            { originalLength, cleanedLength, spawnCount: n, spawnSummaries },
            'SPAWN marker stripping applied',
          );
          if (cleanedLength < 80 && originalLength > 200) {
            logger.warn(
              { originalLength, cleanedLength, spawnCount: n },
              'Response truncated after SPAWN marker removal — generating status message',
            );
          }
          let statusMessage: string | undefined;
          if (cleanedLength === 0) {
            // Entire response was SPAWN markers — build a numbered summary from extracted prompts
            const numbered = spawnSummaries.map((s, i) => `${i + 1}) ${s}`).join(', ');
            statusMessage = `I'm spawning ${n} worker${n === 1 ? '' : 's'}: ${numbered}`;
          } else if (cleanedLength < 80) {
            statusMessage =
              `Working on your request — dispatching ${n} worker(s) for:\n` +
              spawnSummaries.map((s) => `• ${s}`).join('\n');
          }

          // (3) Emit spawning event — N workers are being created
          await progress?.({ type: 'spawning', workerCount: n });

          // Planning gate guard (OB-1779): warn if execution workers are spawning
          // without a completed planning phase (e.g. gate was bypassed or not run).
          if (!this.planningGate.allowsExecution) {
            logger.warn(
              { gateStatus: this.planningGate.status },
              'Planning gate: spawning execution workers without completed analysis phase',
            );
          }

          // (4) Emit worker-progress + worker-result events as each worker completes
          const feedbackPrompt = await this.handleSpawnMarkers(
            spawnResult.markers,
            async (
              completed: number,
              total: number,
              workerResult?: AgentResult,
              workerMarker?: ParsedSpawnMarker,
            ): Promise<void> => {
              await progress?.({ type: 'worker-progress', completed, total });

              // Stream each worker's output to the user immediately
              if (workerResult && workerMarker) {
                const raw =
                  workerResult.exitCode === 0
                    ? workerResult.stdout.trim()
                    : `Error: ${(workerResult.stderr || workerResult.stdout).trim().slice(0, 500)}`;
                const maxLen = 2000;
                const content =
                  raw.length > maxLen ? raw.slice(0, maxLen) + '\n...(truncated)' : raw;
                await progress?.({
                  type: 'worker-result',
                  workerIndex: completed,
                  total,
                  profile: workerMarker.profile,
                  tool: workerMarker.body.tool,
                  content,
                  success: workerResult.exitCode === 0,
                  durationMs: workerResult.durationMs,
                  turnsUsed: workerResult.turnsUsed,
                });
              }
            },
            message.attachments,
            taskClass,
          );

          // (5) Emit synthesizing event — Master is combining worker results
          await progress?.({ type: 'synthesizing' });

          // Inject worker results back into the Master session for synthesis.
          // If synthesis fails or times out, fall back gracefully — the user
          // already received each worker's output via worker-result events.
          this.state = 'processing';
          const feedbackOpts = this.buildMasterSpawnOptions(
            feedbackPrompt,
            undefined,
            MESSAGE_MAX_TURNS_SYNTHESIS,
          );

          try {
            result = await this.agentRunner.spawn(feedbackOpts);
            await this.updateMasterSession();
            void this._checkCompaction();

            if (result.exitCode !== 0) {
              logger.warn({ exitCode: result.exitCode }, 'Synthesis failed — returning fallback');
              response =
                statusMessage ??
                'All subtask results were shown above. The summary step could not complete.';
            } else {
              const synthesisOutput = result.stdout.trim();
              // Use status message only if synthesis produced no content at all
              response =
                synthesisOutput.length > 0 ? synthesisOutput : (statusMessage ?? feedbackPrompt);
            }
          } catch (synthesisError) {
            logger.warn({ err: synthesisError }, 'Synthesis timed out — returning fallback');
            response =
              statusMessage ?? 'All subtask results were shown above. The summary step timed out.';
          }
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

      // Guard: detect abnormally large final responses (likely the Master echoing its
      // system prompt or documentation). Real user-facing responses rarely exceed 50K chars.
      // Applied after SPAWN/delegation processing so worker prompts are unaffected.
      const MAX_RESPONSE_CHARS = 50_000;
      if (response.length > MAX_RESPONSE_CHARS) {
        logger.warn(
          { responseLength: response.length, maxAllowed: MAX_RESPONSE_CHARS },
          'Master produced abnormally large response — likely echoed system prompt, truncating',
        );
        const tail = response.slice(-2000).trim();
        if (tail.length > 50 && !tail.includes('${')) {
          response = tail;
        } else {
          response =
            'I encountered an issue processing your request. Could you please rephrase or simplify it?';
        }
      }

      // Update task record
      task.status = 'completed';
      task.result = response;
      task.completedAt = new Date().toISOString();
      task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();
      task.metadata = {
        ...task.metadata,
        model: result.model,
        exitCode: result.exitCode,
        maxTurns: maxTurnsToUse,
        turnsUsed: result.turnsUsed,
      };

      await this.recordTaskToStore(task);

      // Record the Master AI response to conversation history (OB-730)
      await this.recordConversationMessage(sessionId, 'master', response);

      // Advance batch state after successfully completing the current batch item (OB-1609).
      if (this.batchManager && activeBatchId && activeBatchItemId) {
        const normalized = response.replace(/\s+/g, ' ').trim();
        const summary =
          normalized.length > 160 ? normalized.slice(0, 157) + '...' : normalized || 'Completed';
        try {
          await this.batchManager.advanceBatch(
            activeBatchId,
            {
              id: activeBatchItemId,
              summary,
              status: 'completed',
            },
            result.costUsd ?? 0,
          );
        } catch (err) {
          logger.warn(
            { batchId: activeBatchId, itemId: activeBatchItemId, err },
            'Failed to advance batch state after item completion',
          );
        }
      }

      // Record classification feedback: task succeeded → turn budget was sufficient
      void this.recordClassificationFeedback(
        this.normalizeForCache(message.content),
        true,
        false,
        result.turnsUsed,
      );

      // Increment completed task counter and trigger prompt evolution every 50 tasks (OB-734)
      this.onTaskCompleted();

      this.state = 'ready';
      this.activeMessage = null;

      logger.info(
        { taskId, durationMs: task.durationMs, responseLength: response.length },
        'Message processed successfully',
      );

      // (6) Emit complete event — processing finished, status bar can be hidden
      await progress?.({ type: 'complete' });

      // (7) Schedule batch continuation if a batch is active (OB-1613).
      // The 2s delay ensures the current response is fully delivered to the user
      // before the next batch item begins processing.

      // Capture the active batch ID before the isActive() check so we can detect
      // completion transitions (batch was active → is now done) for OB-1618.
      const preBatchId = this.batchManager?.getCurrentBatchId();

      if (this.batchManager !== null && this.router !== null && this.batchManager.isActive()) {
        const activeBatchId = this.batchManager.getCurrentBatchId();
        if (activeBatchId !== undefined) {
          const batchSender = message.sender;
          const batchSource = message.source;
          const router = this.router;

          // (OB-1616) Track the original sender's connector so failure messages can be
          // delivered even when subsequent CONTINUE messages use source='internal-batch'.
          // Persisted to disk via BatchManager so routing survives process restarts (OB-1667).
          if (batchSource !== 'internal-batch') {
            this.batchManager.setSenderInfo(activeBatchId, {
              sender: batchSender,
              source: batchSource,
            });
          }

          logger.info(
            { batchId: activeBatchId, sender: batchSender },
            'Batch active after message processing — scheduling continuation trigger in 2s',
          );

          // (OB-1614) Send progress message to user before the next item starts.
          const progressMsg = this.batchManager.buildProgressMessage(activeBatchId);
          if (progressMsg !== null) {
            void router.sendDirect(batchSource, batchSender, progressMsg);
            logger.info(
              { batchId: activeBatchId, sender: batchSender },
              'Batch progress message sent',
            );
          }

          // (OB-1615) Spawn a git-commit worker when commitAfterEach is set.
          // The commit worker runs before scheduling the next batch item so changes
          // from the current item are committed before the next item begins.
          const scheduleNext = (): void => {
            const handle = setTimeout(() => {
              this.batchTimers.delete(handle);
              if (this.state === 'shutdown') return;
              router.routeBatchContinuation(activeBatchId, batchSender).catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                void this.batchManager?.pauseBatch(activeBatchId);
                void router.sendDirect(
                  batchSource,
                  batchSender,
                  `Batch paused due to error: ${msg}`,
                );
                logger.error(
                  { batchId: activeBatchId, err },
                  'routeBatchContinuation failed — batch paused (OB-1666)',
                );
              });
            }, 2000);
            this.batchTimers.add(handle);
          };

          if (this.batchManager.shouldCommitAfterEach(activeBatchId)) {
            const commitPrompt = this.batchManager.buildCommitPrompt(activeBatchId);
            if (commitPrompt !== null) {
              void (async (): Promise<void> => {
                logger.info({ batchId: activeBatchId }, 'Spawning commit worker after batch item');
                try {
                  await this.agentRunner.spawn({
                    prompt: commitPrompt,
                    workspacePath: this.workspacePath,
                    allowedTools: resolveProfile('code-edit'),
                    maxTurns: 3,
                    model: 'fast',
                    retries: 1,
                  });
                  logger.info({ batchId: activeBatchId }, 'Commit worker completed');
                } catch (commitErr) {
                  logger.warn(
                    { batchId: activeBatchId, err: commitErr },
                    'Commit worker failed — continuing batch',
                  );
                }
                scheduleNext();
              })();
            } else {
              scheduleNext();
            }
          } else {
            scheduleNext();
          }
        }
      } else if (
        // (OB-1618) Batch just completed — the batch was active before processing but is now done.
        // Send the completion summary to the original sender.
        this.batchManager !== null &&
        this.router !== null &&
        preBatchId !== undefined &&
        !this.batchManager.isActive(preBatchId)
      ) {
        const completionSummary = this.batchManager.popCompletionSummary();
        if (completionSummary !== null) {
          const senderInfo = this.batchManager.getSenderInfo(preBatchId);
          if (senderInfo) {
            void this.router.sendDirect(senderInfo.source, senderInfo.sender, completionSummary);
            logger.info(
              { batchId: preBatchId, sender: senderInfo.sender },
              'Batch completion summary sent to user',
            );
          } else {
            // Fallback: send to the current message sender
            void this.router.sendDirect(message.source, message.sender, completionSummary);
            logger.info(
              { batchId: preBatchId, sender: message.sender },
              'Batch completion summary sent to current sender (no stored senderInfo)',
            );
          }
          this.batchManager.deleteSenderInfo(preBatchId);
        }
      }

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
      this.activeMessage = null;

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
    this.activeMessage = message;

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
      // and fetch learned patterns for system prompt enrichment (OB-735)
      const [
        streamConversationContext,
        streamLearnedPatternsContext,
        streamWorkerNextStepsContext,
      ] = await Promise.all([
        this.buildConversationContext(message.content, streamSessionId, message.sender),
        this.buildLearnedPatternsContext(),
        this.buildWorkerNextStepsContext(),
      ]);

      // (1) Emit classifying event — AI is analyzing the message
      await streamProgress?.({ type: 'classifying' });

      // Classify message to determine appropriate turn budget and prompt
      const streamClassification = await this.classifyTask(message.content, streamSessionId);
      const streamTaskClass = streamClassification.class;
      let streamPromptToSend =
        streamTaskClass === 'complex-task'
          ? this.buildPlanningPrompt(message.content)
          : message.content;
      // Prepend channel + role context header so Master can make channel-aware decisions (OB-1627)
      streamPromptToSend = (await this.getMessageContextHeader(message)) + streamPromptToSend;
      // complex-task always uses planning turns; otherwise use AI-suggested budget
      const streamMaxTurns =
        streamTaskClass === 'complex-task'
          ? MESSAGE_MAX_TURNS_PLANNING
          : streamClassification.maxTurns;
      // Derive timeout from the actual turns used (complex-task overrides to planning turns)
      const streamTimeoutToUse =
        streamTaskClass === 'complex-task'
          ? turnsToTimeout(MESSAGE_MAX_TURNS_PLANNING)
          : streamClassification.timeout;

      if (streamTaskClass === 'complex-task') {
        logger.info('Complex task — using planning prompt for auto-delegation (stream)');
        // (2) Emit planning event — Master is decomposing the task
        await streamProgress?.({ type: 'planning' });
      }

      // Stream message through the persistent Master session (OB-1246: budget-aware assembly)
      const streamContext: MasterContextSections = {
        conversationContext: streamConversationContext,
        learnedPatternsContext: streamLearnedPatternsContext,
        workerNextStepsContext: streamWorkerNextStepsContext,
      };
      const spawnOpts = this.buildMasterSpawnOptions(
        streamPromptToSend,
        streamTimeoutToUse,
        streamMaxTurns,
        streamContext,
      );
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

        // Retry with the same prompt and context sections (OB-1246: budget-aware assembly)
        const retryOpts = this.buildMasterSpawnOptions(
          streamPromptToSend,
          streamTimeoutToUse,
          streamMaxTurns,
          streamContext,
        );
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

          // If the cleaned output (text outside SPAWN markers) is very short, prepare
          // a status message to show the user instead of a near-empty stub response.
          const streamCleanedOutput = spawnResult.cleanedOutput;
          const streamOriginalLength = fullResponse.length;
          const streamCleanedLength = streamCleanedOutput.length;
          const streamSpawnSummaries = extractTaskSummaries(spawnResult.markers);
          logger.debug(
            {
              originalLength: streamOriginalLength,
              cleanedLength: streamCleanedLength,
              spawnCount: streamN,
              spawnSummaries: streamSpawnSummaries,
            },
            'SPAWN marker stripping applied',
          );
          if (streamCleanedLength < 80 && streamOriginalLength > 200) {
            logger.warn(
              {
                originalLength: streamOriginalLength,
                cleanedLength: streamCleanedLength,
                spawnCount: streamN,
              },
              'Response truncated after SPAWN marker removal — generating status message',
            );
          }
          let streamStatusMessage: string | undefined;
          if (streamCleanedLength === 0) {
            // Entire response was SPAWN markers — build a numbered summary from extracted prompts
            const streamNumbered = streamSpawnSummaries.map((s, i) => `${i + 1}) ${s}`).join(', ');
            streamStatusMessage = `I'm spawning ${streamN} worker${streamN === 1 ? '' : 's'}: ${streamNumbered}`;
          } else if (streamCleanedLength < 80) {
            streamStatusMessage =
              `Working on your request — dispatching ${streamN} worker(s) for:\n` +
              streamSpawnSummaries.map((s) => `• ${s}`).join('\n');
          }

          // (3) Emit spawning event — N workers are being created
          await streamProgress?.({ type: 'spawning', workerCount: streamN });

          // Callback that emits both worker-progress and worker-result events
          const workerCallback = async (
            completed: number,
            total: number,
            workerResult?: AgentResult,
            workerMarker?: ParsedSpawnMarker,
          ): Promise<void> => {
            await streamProgress?.({ type: 'worker-progress', completed, total });

            if (workerResult && workerMarker) {
              const raw =
                workerResult.exitCode === 0
                  ? workerResult.stdout.trim()
                  : `Error: ${(workerResult.stderr || workerResult.stdout).trim().slice(0, 500)}`;
              const maxLen = 2000;
              const content = raw.length > maxLen ? raw.slice(0, maxLen) + '\n...(truncated)' : raw;
              await streamProgress?.({
                type: 'worker-result',
                workerIndex: completed,
                total,
                profile: workerMarker.profile,
                tool: workerMarker.body.tool,
                content,
                success: workerResult.exitCode === 0,
                durationMs: workerResult.durationMs,
                turnsUsed: workerResult.turnsUsed,
              });
            }
          };

          // Use progress-streaming variant if multiple workers are spawned
          let feedbackPrompt: string;
          if (spawnResult.markers.length > 1) {
            // Stream progress updates as workers complete, also emitting worker-progress events
            const progressGen = this.handleSpawnMarkersWithProgress(
              spawnResult.markers,
              workerCallback,
              message.attachments,
              streamTaskClass,
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
              workerCallback,
              message.attachments,
              streamTaskClass,
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

          const streamFinalResponse = finalResponse.trim();
          // Use status message only if synthesis produced no content at all
          fullResponse =
            streamFinalResponse.length > 0
              ? streamFinalResponse
              : (streamStatusMessage ?? feedbackPrompt);
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
      task.metadata = {
        ...task.metadata,
        turnsUsed: streamResult.turnsUsed,
      };

      await this.recordTaskToStore(task);

      // Record the Master AI response to conversation history (OB-730)
      await this.recordConversationMessage(streamSessionId, 'master', task.result);

      // Increment completed task counter and trigger prompt evolution every 50 tasks (OB-734)
      this.onTaskCompleted();

      this.state = 'ready';
      this.activeMessage = null;

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
      this.activeMessage = null;

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

    // Show exploration progress table from memory (OB-894)
    if (this.memory) {
      try {
        const progressRows = await this.memory.getExplorationProgress();
        if (progressRows.length > 0) {
          status += `\nExploration Progress:\n`;
          for (const row of progressRows) {
            const label = row.target ? `${row.phase} (${row.target})` : row.phase;
            const pct = Math.round(row.progress_pct);
            const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
            status += `  ${label}: ${bar} ${pct}% [${row.status}]\n`;
          }
        }
      } catch {
        // memory not available — skip
      }
    }

    return status;
  }

  /**
   * Log the current RAG health status (FTS5 chunk count) for startup diagnostics.
   * OB-1571: Provides visibility into whether the FTS5 index has content so that
   * operators can identify an empty RAG index before it causes silent failures.
   */
  private async logRagHealthDiagnostic(): Promise<void> {
    if (!this.memory) return;
    try {
      const chunkCount = await this.memory.countChunks();
      logger.info({ chunkCount }, 'RAG startup diagnostic: FTS5 chunk store status');
      if (chunkCount === 0) {
        logger.warn('RAG has no indexed chunks — retrieval will return empty results');
      }
    } catch (err) {
      logger.warn({ err }, 'RAG startup diagnostic: failed to count FTS5 chunks');
    }
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
   *
   * Uses exponential backoff: first cycle fires after 5 min idle,
   * subsequent cycles double the threshold (10m, 20m, 40m, ...) up to 2h.
   * Resets to 5 min when a user message arrives (via resetIdleTimer).
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

    // Exponential backoff: threshold doubles each cycle, capped at IDLE_THRESHOLD_MAX_MS
    const currentThreshold = Math.min(
      IDLE_THRESHOLD_MS * Math.pow(2, this.consecutiveIdleCycles),
      IDLE_THRESHOLD_MAX_MS,
    );

    // Check if idle threshold exceeded
    if (idleTime >= currentThreshold) {
      this.consecutiveIdleCycles++;

      // Suppress self-improvement after 2 consecutive no-ops (OB-F210)
      if (this.consecutiveNoOpCycles >= 2) {
        logger.debug(
          'Self-improvement paused: 2 consecutive no-op cycles — waiting for next user message',
        );
        return;
      }

      logger.info(
        {
          idleTimeMs: idleTime,
          cycle: this.consecutiveIdleCycles,
          nextThresholdMs: Math.min(
            IDLE_THRESHOLD_MS * Math.pow(2, this.consecutiveIdleCycles),
            IDLE_THRESHOLD_MAX_MS,
          ),
        },
        'Idle threshold exceeded, starting self-improvement cycle',
      );

      try {
        const workDone = await this.runSelfImprovementCycle();
        if (workDone) {
          this.consecutiveNoOpCycles = 0;
        } else {
          this.consecutiveNoOpCycles++;
        }
      } catch (error) {
        logger.error({ err: error }, 'Self-improvement cycle failed');
        this.consecutiveNoOpCycles++;
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
  private async runSelfImprovementCycle(): Promise<boolean> {
    if (this.isSelfImproving) {
      logger.warn('Self-improvement cycle already running');
      return false;
    }

    this.isSelfImproving = true;
    const startedAt = new Date().toISOString();

    logger.info('Starting self-improvement cycle');

    let workDone = false;

    try {
      if (this.memory) {
        await this.memory.logExploration({
          timestamp: startedAt,
          level: 'info',
          message: 'Self-improvement cycle started',
          data: {},
        });
      } else {
        await this.dotFolder.appendLog({
          timestamp: startedAt,
          level: 'info',
          message: 'Self-improvement cycle started',
          data: {},
        });
      }

      // Task 0: Detect degraded prompts (rewrites that made things worse) and rollback
      const rollbackCount = await this.rollbackDegradedPrompts();

      // Task 1: Identify and rewrite low-performing prompts via dot-folder manifest
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
      const profileCreated = await this.createProfilesFromLearnings();

      // Task 3: Check if workspace has changed and update map if needed
      const workspaceChanged = await this.updateWorkspaceMapIfChanged();

      // Determine if any productive work was done (OB-F210)
      workDone =
        rollbackCount > 0 || lowPerformingPrompts.length > 0 || profileCreated || workspaceChanged;

      if (this.memory) {
        await this.memory.logExploration({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Self-improvement cycle completed',
          data: {
            rollbackCount,
            lowPerformingPrompts: lowPerformingPrompts.length,
            profileCreated,
            workspaceChanged,
            workDone,
            durationMs: new Date().getTime() - new Date(startedAt).getTime(),
          },
        });
      } else {
        await this.dotFolder.appendLog({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Self-improvement cycle completed',
          data: {
            rollbackCount,
            lowPerformingPrompts: lowPerformingPrompts.length,
            profileCreated,
            workspaceChanged,
            workDone,
            durationMs: new Date().getTime() - new Date(startedAt).getTime(),
          },
        });
      }

      logger.info({ workDone }, 'Self-improvement cycle completed');
    } catch (error) {
      logger.error({ err: error }, 'Self-improvement cycle encountered an error');

      if (this.memory) {
        await this.memory.logExploration({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Self-improvement cycle failed',
          data: { error: error instanceof Error ? error.message : String(error) },
        });
      } else {
        await this.dotFolder.appendLog({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Self-improvement cycle failed',
          data: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    } finally {
      this.isSelfImproving = false;
    }

    return workDone;
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
      // Read the current prompt content — prefer DB, fall back to file
      let currentContent: string;
      if (this.memory) {
        try {
          const dbRecord = await this.memory.getActivePrompt(prompt.id);
          currentContent = dbRecord.content;
        } catch {
          const promptPath = path.join(
            this.dotFolder.getDotFolderPath(),
            'prompts',
            prompt.filePath,
          );
          currentContent = await fs.readFile(promptPath, 'utf-8');
        }
      } else {
        const promptPath = path.join(this.dotFolder.getDotFolderPath(), 'prompts', prompt.filePath);
        currentContent = await fs.readFile(promptPath, 'utf-8');
      }

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

      // Store the previous version content for rollback before overwriting
      const manifest = this.memory
        ? await this.memory.getPromptManifest()
        : await this.dotFolder.readPromptManifest();
      const existingEntry = manifest?.prompts[prompt.id];
      if (manifest && existingEntry) {
        existingEntry.previousVersion = currentContent;
        manifest.updatedAt = new Date().toISOString();
        if (this.memory) {
          await this.memory.setPromptManifest(manifest);
        } else {
          await this.dotFolder.writePromptManifest(manifest);
        }
      }

      // Update the prompt — write to DB (primary) or file (fallback)
      if (this.memory) {
        await this.memory.createPromptVersion(prompt.id, rewrittenContent);
      } else {
        const promptPath = path.join(this.dotFolder.getDotFolderPath(), 'prompts', prompt.filePath);
        await fs.writeFile(promptPath, rewrittenContent, 'utf-8');
      }

      // Reset the prompt's usage stats (fresh start with new version)
      await this.dotFolder.resetPromptStats(prompt.id);

      logger.info({ promptId: prompt.id }, 'Successfully rewrote prompt');
    } catch (error) {
      logger.error({ err: error, promptId: prompt.id }, 'Failed to rewrite prompt (non-blocking)');
    }
  }

  /**
   * Detect prompts where a recent rewrite made performance worse, and rollback
   * to the previous version. A prompt is "degraded" when:
   * - It has a previousVersion stored (was rewritten)
   * - It has a previousSuccessRate recorded
   * - Its current successRate < previousSuccessRate
   * - It has been used 5+ times since the rewrite (enough signal)
   */
  private async rollbackDegradedPrompts(): Promise<number> {
    const manifest = this.memory
      ? await this.memory.getPromptManifest()
      : await this.dotFolder.readPromptManifest();
    if (!manifest) return 0;

    let rollbackCount = 0;

    for (const prompt of Object.values(manifest.prompts)) {
      if (
        prompt.previousVersion &&
        prompt.previousSuccessRate !== undefined &&
        prompt.usageCount >= 5 &&
        (prompt.successRate ?? 0) < prompt.previousSuccessRate
      ) {
        logger.warn(
          {
            promptId: prompt.id,
            currentRate: prompt.successRate,
            previousRate: prompt.previousSuccessRate,
          },
          'Degraded prompt detected — rolling back to previous version',
        );

        try {
          if (!this.memory) {
            const promptPath = path.join(
              this.dotFolder.getDotFolderPath(),
              'prompts',
              prompt.filePath,
            );

            // Restore the previous version content to disk (no memory available)
            await fs.writeFile(promptPath, prompt.previousVersion, 'utf-8');
          } else {
            // Restore version through DB when memory is available
            await this.memory.createPromptVersion(prompt.id, prompt.previousVersion);
          }

          // Restore previous success rate and clear rollback fields
          prompt.successRate = prompt.previousSuccessRate;
          prompt.usageCount = 0;
          prompt.successCount = 0;
          prompt.previousVersion = undefined;
          prompt.previousSuccessRate = undefined;
          prompt.updatedAt = new Date().toISOString();

          if (this.memory) {
            await this.memory.setPromptManifest(manifest);
          } else {
            await this.dotFolder.writePromptManifest(manifest);
          }

          logger.info({ promptId: prompt.id }, 'Successfully rolled back degraded prompt');
          rollbackCount++;
        } catch (error) {
          logger.error({ err: error, promptId: prompt.id }, 'Failed to rollback degraded prompt');
        }
      }
    }

    return rollbackCount;
  }

  /**
   * Analyze learnings to identify recurring task patterns and create custom profiles.
   * For example: if "test-runner" tasks consistently succeed with specific tools,
   * create a "test-runner" profile.
   * Returns true if at least one profile was created.
   */
  private async createProfilesFromLearnings(): Promise<boolean> {
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
        return false;
      }
    } else {
      const learnings = await this.dotFolder.readLearnings();
      if (!learnings || learnings.entries.length < 10) {
        return false;
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
      return false;
    }

    let profileCreated = false;

    // Look for task types with >5 total executions and >70% success rate
    for (const stat of taskTypeStats) {
      const total = stat.successCount + stat.failureCount;
      if (total < 5) continue;
      if (stat.successRate < 0.7) continue;

      // Check if a profile already exists for this task type
      const existingProfiles = await this.readProfilesFromStore();
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
        if (this.memory) {
          const updated = await this.dotFolder.readProfiles();
          if (updated) {
            await this.memory.setSystemConfig('profiles', JSON.stringify(updated));
          }
        }
        logger.info({ profileId }, 'Successfully created custom profile from learnings');
        profileCreated = true;
      } catch (error) {
        logger.error({ err: error, profileId }, 'Failed to create custom profile (non-blocking)');
      }
    }

    return profileCreated;
  }

  /**
   * Check if the workspace has changed significantly and update workspace-map.json if needed.
   * Detects changes by checking for new files, modified package.json, new directories, etc.
   * Returns true if workspace changed and was updated.
   */
  private async updateWorkspaceMapIfChanged(): Promise<boolean> {
    const map = await this.readWorkspaceMapFromStore();
    if (!map) {
      // No map to update
      return false;
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
        return true;
      }

      return false;
    } catch (error) {
      logger.error({ err: error }, 'Failed to check workspace changes (non-blocking)');
      return false;
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

    // Clear all pending batch continuation timers (OB-1665)
    for (const handle of this.batchTimers) {
      clearTimeout(handle);
    }
    this.batchTimers.clear();

    // Shutdown delegation coordinator
    this.delegationCoordinator.shutdown();

    // Persist Master session first (fast, <100ms SQLite write) — critical data
    if (this.masterSession) {
      try {
        await this.saveMasterSessionToStore(this.masterSession);
      } catch (error) {
        logger.warn({ error }, 'Failed to persist Master session on shutdown');
      }
    }

    // Trigger a memory update after session state is saved so the Master
    // can persist what it learned in this session (OB-1023).
    // Runs after saveMasterSessionToStore() so a timeout cannot lose session state.
    if (this.sessionInitialized && this.masterSession && this.masterSession.messageCount > 0) {
      try {
        await this.triggerMemoryUpdate();
      } catch (err) {
        logger.warn({ err }, 'Memory update on shutdown failed — continuing');
      }
    }

    // Close active sessions after memory is saved (OB-1605)
    if (this.memory) {
      try {
        await this.memory.closeActiveSessions();
        logger.info('Closed active sessions on shutdown');
      } catch (error) {
        logger.warn({ error }, 'Failed to close active sessions on shutdown — continuing');
      }
    }

    // Log shutdown
    try {
      if (this.memory) {
        await this.memory.logExploration({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Master AI shutting down',
        });
      } else {
        await this.dotFolder.appendLog({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Master AI shutting down',
        });
      }
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
   * Return the maximum allowed turns for a worker based on its profile (OB-1677).
   *
   * Profile-specific caps prevent runaway workers while giving complex tasks
   * enough headroom to complete:
   *   - read-only:               25 turns
   *   - code-edit / full-access: 40 turns
   *   - other / unknown:         50 turns
   */
  private maxTurnsCapForProfile(profile: string): number {
    if (profile === 'read-only') return 25;
    if (profile === 'code-edit' || profile === 'full-access') return 40;
    return 50;
  }

  /**
   * Compute adaptive max-turns for a worker based on profile baseline + prompt heuristics (OB-902, OB-1677).
   *
   * If the SPAWN marker explicitly set maxTurns, that value is used directly (caller's
   * responsibility). This method only computes the fallback value when maxTurns is absent.
   *
   * Formula:
   *   1. baselineTurns (profile-based)
   *   2. + ceil(promptLength / 1000)   — scales with prompt complexity
   *   3. + 5 if promptLength > 200     — longer tasks need more room (OB-1677)
   *   4. + 10 if prompt contains "thorough", "comprehensive", or "detailed" (OB-1677)
   *   5. capped at maxTurnsCapForProfile(profile)
   *
   * Examples (code-edit, baseline 15, cap 40):
   *   200-char prompt, no keywords → 15 + 1 = 16 turns
   *   500-char prompt, no keywords → 15 + 1 + 5 = 21 turns
   *   500-char prompt + "thorough" → 15 + 1 + 5 + 10 = 31 turns
   */
  private computeAdaptiveMaxTurns(profile: string, prompt: string): number {
    const baselineTurns = this.defaultMaxTurnsForProfile(profile);
    const profileCap = this.maxTurnsCapForProfile(profile);

    const promptExtra = Math.ceil(prompt.length / 1000);

    // OB-1677: Add 5 turns for prompts longer than 200 chars (more context = more work).
    const longPromptExtra = prompt.length > 200 ? 5 : 0;

    // OB-1677: Add 10 turns when the task explicitly requests thoroughness.
    const THOROUGHNESS_KEYWORDS = ['thorough', 'comprehensive', 'detailed'];
    const lowerPrompt = prompt.toLowerCase();
    const keywordExtra = THOROUGHNESS_KEYWORDS.some((kw) => lowerPrompt.includes(kw)) ? 10 : 0;

    const adaptive = Math.min(
      baselineTurns + promptExtra + longPromptExtra + keywordExtra,
      profileCap,
    );

    logger.debug(
      {
        profile,
        baselineTurns,
        profileCap,
        promptLength: prompt.length,
        promptExtra,
        longPromptExtra,
        keywordExtra,
        adaptive,
      },
      'Computed adaptive max-turns for worker',
    );
    return adaptive;
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
    onProgress?: (
      completed: number,
      total: number,
      result?: AgentResult,
      marker?: ParsedSpawnMarker,
    ) => Promise<void>,
    attachments?: InboundMessage['attachments'],
    taskClass?: string,
  ): Promise<string> {
    // Load custom profiles once for all workers
    const customProfilesRegistry = await this.readProfilesFromStore();
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
      timeout: marker.body.timeout ?? DEFAULT_WORKER_TIMEOUT,
      retries: marker.body.retries,
      maxBudgetUsd: marker.body.maxBudgetUsd,
    }));

    for (const manifest of workerManifests) {
      try {
        const workerId = this.workerRegistry.addWorker(manifest);
        workerIds.push(workerId);
      } catch {
        // Max concurrency reached — wait for a slot to free up (backpressure)
        logger.info(
          { runningCount: this.workerRegistry.getRunningCount() },
          'Concurrency limit reached — waiting for a worker slot',
        );
        try {
          await this.workerRegistry.waitForSlot();
          // Slot freed — retry registration
          const workerId = this.workerRegistry.addWorker(manifest);
          workerIds.push(workerId);
        } catch (waitError) {
          // Timeout waiting for slot — skip this worker
          logger.warn(
            { error: waitError instanceof Error ? waitError.message : String(waitError) },
            'Timed out waiting for worker slot — skipping worker',
          );
          workerIds.push('');
        }
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
      const workerPromise = this.spawnWorker(workerId, marker, index, customProfiles, attachments);
      if (onProgress) {
        return workerPromise.then(async (result) => {
          completedCount++;
          await onProgress(completedCount, total, result, marker);
          return result;
        });
      }
      return workerPromise;
    });

    const settled = await Promise.allSettled(workerPromises);

    // Persist registry after all workers complete
    await this.persistWorkerRegistry();

    // Log aggregated worker batch stats for observability
    const stats = this.workerRegistry.getAggregatedStats();
    logger.info(stats, 'Worker batch stats');

    // Record task efficiency metrics for escalation suppression (OB-1572)
    if (this.memory && taskClass) {
      this.memory
        .recordTaskEfficiency(taskClass, {
          turnsUsed: stats.totalTurnsUsed ?? 0,
          workerCount: stats.totalWorkers,
          durationMs: stats.avgDurationMs * stats.totalWorkers,
        })
        .catch((err) => logger.warn({ err, taskClass }, 'Failed to record task efficiency'));
    }

    // Format all results with structured metadata and build the feedback prompt
    const { feedbackPrompt, observations, workerSummaries } = formatWorkerBatch(
      settled,
      markers,
      workerIds,
      this.masterSession?.sessionId,
    );

    // Persist extracted observations (fire-and-forget — don't block the response)
    if (observations.length > 0 && this.memory) {
      Promise.all(observations.map((obs) => this.memory!.insertObservation(obs))).catch((err) =>
        logger.warn({ err }, 'Failed to store worker observations'),
      );
    }

    // Append learned items from worker summaries to memory.md (OB-1636)
    if (workerSummaries.length > 0) {
      this.dotFolder
        .appendLearnedToMemory(workerSummaries)
        .catch((err) => logger.warn({ err }, 'Failed to append learned items to memory.md'));
    }

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
    onProgress?: (
      completed: number,
      total: number,
      result?: AgentResult,
      marker?: ParsedSpawnMarker,
    ) => Promise<void>,
    attachments?: InboundMessage['attachments'],
    taskClass?: string,
  ): AsyncGenerator<string, string> {
    // Load custom profiles once for all workers
    const customProfilesRegistry = await this.readProfilesFromStore();
    const customProfiles = customProfilesRegistry?.profiles;

    // Register all workers in the registry BEFORE spawning
    const workerIds: string[] = [];
    const workerManifests = markers.map((marker) => ({
      prompt: marker.body.prompt,
      workspacePath: this.workspacePath,
      profile: marker.profile,
      model: marker.body.model,
      maxTurns: marker.body.maxTurns ?? this.defaultMaxTurnsForProfile(marker.profile),
      timeout: marker.body.timeout ?? DEFAULT_WORKER_TIMEOUT,
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
      const workerPromise = this.spawnWorker(workerId, marker, index, customProfiles, attachments);
      if (onProgress) {
        return workerPromise.then(async (result) => {
          progressCompletedCount++;
          await onProgress(progressCompletedCount, totalWorkers, result, marker);
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

    // Record task efficiency metrics for escalation suppression (OB-1572)
    if (this.memory && taskClass) {
      const progressStats = this.workerRegistry.getAggregatedStats();
      this.memory
        .recordTaskEfficiency(taskClass, {
          turnsUsed: progressStats.totalTurnsUsed ?? 0,
          workerCount: progressStats.totalWorkers,
          durationMs: progressStats.avgDurationMs * progressStats.totalWorkers,
        })
        .catch((err) => logger.warn({ err, taskClass }, 'Failed to record task efficiency'));
    }

    // Format all results and build the feedback prompt
    const { feedbackPrompt, observations, workerSummaries } = formatWorkerBatch(
      finalSettled,
      markers,
      workerIds,
      this.masterSession?.sessionId,
    );

    // Persist extracted observations (fire-and-forget — don't block the response)
    if (observations.length > 0 && this.memory) {
      Promise.all(observations.map((obs) => this.memory!.insertObservation(obs))).catch((err) =>
        logger.warn({ err }, 'Failed to store worker observations'),
      );
    }

    // Append learned items from worker summaries to memory.md (OB-1636)
    if (workerSummaries.length > 0) {
      this.dotFolder
        .appendLearnedToMemory(workerSummaries)
        .catch((err) => logger.warn({ err }, 'Failed to append learned items to memory.md'));
    }

    return feedbackPrompt;
  }

  /**
   * Re-spawn a worker with upgraded tool access after a user grant (OB-1594).
   *
   * Called by the respawn callback registered in requestToolEscalation(). Receives the
   * granted tool/profile name(s) from the /allow command handler and re-submits the
   * original SPAWN marker with an upgraded profile or merged tool list.
   *
   * - If grantedTools contains a built-in profile name (e.g. "code-edit"), the marker
   *   is re-submitted with that profile, overriding the original.
   * - If grantedTools contains individual tool names (e.g. "Bash(npm:test)"), they are
   *   merged with the original profile's tools and passed via a transient custom profile.
   */
  private async respawnWorkerAfterGrant(
    originalWorkerId: string,
    marker: ParsedSpawnMarker,
    index: number,
    originalProfile: string,
    grantedTools: string[],
    attachments?: InboundMessage['attachments'],
  ): Promise<void> {
    const newWorkerId = `${originalWorkerId}-escalated`;

    // Determine whether the grant is a profile upgrade or individual tool names.
    const profileGrant = grantedTools.find((g) => BuiltInProfileNameSchema.safeParse(g).success);

    let upgradedMarker: ParsedSpawnMarker;
    let customProfiles: Record<string, ToolProfile> | undefined;

    if (profileGrant) {
      // Profile upgrade — re-submit the marker under the higher profile.
      upgradedMarker = { ...marker, profile: profileGrant };
      logger.info(
        { originalWorkerId, newWorkerId, originalProfile, upgradedProfile: profileGrant },
        'Worker re-spawned with profile upgrade after grant',
      );
    } else {
      // Individual tool grant — merge with the original profile's tool list.
      const baseTools = resolveProfile(originalProfile) ?? [];
      const mergedTools = [...new Set([...baseTools, ...grantedTools])];
      const upgradedProfileName = `${originalProfile}-escalated`;
      customProfiles = {
        [upgradedProfileName]: {
          name: upgradedProfileName,
          description: `${originalProfile} + escalated access (${grantedTools.join(', ')})`,
          tools: mergedTools,
        },
      };
      upgradedMarker = { ...marker, profile: upgradedProfileName };
      logger.info(
        { originalWorkerId, newWorkerId, originalProfile, mergedTools },
        'Worker re-spawned with merged tool access after grant',
      );
    }

    // Register the escalated worker in the WorkerRegistry BEFORE spawning so that
    // markRunning / markCompleted / markFailed can find it by ID (OB-1626).
    // Registration is inside the try block (OB-1645) so that if registration itself
    // fails (e.g. capacity exceeded), the original worker is still marked as failed
    // rather than left orphaned in 'pending' state.
    const escalatedManifest: TaskManifest = {
      prompt: upgradedMarker.body.prompt,
      workspacePath: this.workspacePath,
      profile: upgradedMarker.profile,
      model: upgradedMarker.body.model,
      maxTurns: upgradedMarker.body.maxTurns,
      timeout: upgradedMarker.body.timeout,
      retries: upgradedMarker.body.retries,
      maxBudgetUsd: upgradedMarker.body.maxBudgetUsd,
    };

    try {
      this.workerRegistry.registerWorkerWithId(newWorkerId, escalatedManifest);
      await this.spawnWorker(newWorkerId, upgradedMarker, index, customProfiles, attachments);
    } catch (spawnError) {
      const errorMessage = spawnError instanceof Error ? spawnError.message : String(spawnError);
      logger.error(
        { originalWorkerId, newWorkerId, error: errorMessage },
        'Worker re-spawn failed after grant',
      );

      // Mark escalated worker as failed and clean up to prevent orphaned state (OB-1627, OB-1628).
      const failedResult: AgentResult = {
        exitCode: -1,
        stdout: '',
        stderr: errorMessage,
        durationMs: 0,
        retryCount: 0,
        status: 'completed',
      };
      try {
        this.workerRegistry.markFailed(newWorkerId, failedResult, 'respawn-failed');
      } catch (markErr) {
        logger.warn({ newWorkerId, err: markErr }, 'Failed to mark escalated worker as failed');
        // OB-1628: If markFailed fails, remove the entry entirely to prevent the worker
        // from remaining orphaned in 'pending' state in the registry.
        this.workerRegistry.removeWorker(newWorkerId);
      }

      // Also attempt to mark original worker as failed (OB-1627).
      // The original may already be in a terminal state — guard with try-catch.
      try {
        this.workerRegistry.markFailed(originalWorkerId, failedResult, 'respawn-failed');
      } catch {
        // Original worker already in a terminal state — this is expected.
      }

      // Notify the user so they can retry (OB-1627).
      if (this.router && this.activeMessage) {
        void this.router.sendDirect(
          this.activeMessage.source,
          this.activeMessage.sender,
          'Worker re-spawn failed after grant, please retry',
        );
      }
    }
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
    attachments?: InboundMessage['attachments'],
  ): Promise<AgentResult> {
    const { body } = marker;
    // profile may be overridden by skill pack selection (OB-1753)
    let profile = marker.profile;

    // OB-1596: Compute session-level tool grants for this sender.
    // If the user approved tools earlier this session via /allow, auto-apply them
    // to every subsequent worker spawn so we don't re-ask for the same permissions.
    const senderSessionGrants: ReadonlySet<string> =
      this.router && this.activeMessage
        ? this.router.getSessionGrants(this.activeMessage.sender)
        : new Set<string>();
    // Expand profile-name grants (e.g. "code-edit") to their individual tool lists
    // so we can check coverage and merge them into allowedTools uniformly.
    const expandedSessionGrants = new Set<string>();
    for (const grant of senderSessionGrants) {
      if (BuiltInProfileNameSchema.safeParse(grant).success) {
        const profileTools = resolveProfile(grant) ?? [];
        profileTools.forEach((t) => expandedSessionGrants.add(t));
      } else {
        expandedSessionGrants.add(grant);
      }
    }

    // OB-1600: Fetch permanent tool grants for this user from the DB.
    // These survive session restarts — once granted via /allow-permanent they
    // are always merged into worker allowedTools without re-asking the user.
    const permanentGrants: string[] =
      this.memory && this.activeMessage
        ? await this.memory
            .getApprovedEscalations(this.activeMessage.sender, this.activeMessage.source)
            .catch(() => [])
        : [];

    // If the originating message had attachments, prepend a ## Referenced Files section
    // so the worker knows which files to read and analyze (OB-1148).
    let workerPrompt = body.prompt;
    if (attachments && attachments.length > 0) {
      const fileLines = attachments
        .map((att) => {
          const name = att.filename ? ` (${att.filename})` : '';
          const sizeMb = (att.sizeBytes / (1024 * 1024)).toFixed(2);
          return `- **${att.type}**${name}: \`${att.filePath}\` — ${att.mimeType}, ${sizeMb} MB`;
        })
        .join('\n');
      workerPrompt = `## Referenced Files\n\nThe following files were attached to the user's message and are available for analysis:\n\n${fileLines}\n\n---\n\n${body.prompt}`;
    }

    // Resolve per-worker tool and adapter
    let workerRunner = this.agentRunner;
    let resolvedModel = body.model;
    const requestedTool = body.tool;
    const toolUsed = requestedTool ?? this.masterTool.name;

    if (requestedTool && requestedTool !== this.masterTool.name) {
      const tool = this.resolveDiscoveredTool(requestedTool);
      const toolAdapter = tool ? this.adapterRegistry.get(requestedTool) : undefined;

      if (!tool || !toolAdapter) {
        logger.warn(
          { requestedTool, workerId },
          'Requested tool not available — falling back to master tool',
        );
      } else {
        workerRunner = new AgentRunner(toolAdapter);
        logger.info({ requestedTool, workerId }, 'Worker using tool-specific adapter');
      }
    }

    // Apply tool-specific worker prompt prefix (OB-1576).
    // Codex workers waste turns on shell gymnastics — the prefix steers them
    // toward simple, direct file-reading commands (OB-F91).
    workerPrompt = applyToolPromptPrefix(workerPrompt, toolUsed);

    // OB-1737: Inject skill pack prompt extension when the worker task involves
    // document generation. classifyDocumentIntent maps task text to a file format
    // (docx, pptx, xlsx, pdf), then we locate the matching built-in skill pack and
    // append its workerPrompt section so the worker has precise generation guidance.
    const docFormat = classifyDocumentIntent(body.prompt);
    if (docFormat) {
      const skillPacks = new Map(getBuiltInSkillPacks().map((s) => [s.name, s]));
      const skill = findSkillByFormat(skillPacks, docFormat);
      if (skill) {
        workerPrompt = `${workerPrompt}\n\n---\n\n${skill.prompts.workerPrompt}`;
        logger.debug(
          { workerId, skillName: skill.name, docFormat },
          'Injected skill pack prompt extension into worker',
        );
      }
    }

    // OB-1752: Select the best-matching SkillPack for this worker based on task
    // type and inject its systemPromptExtension into the worker prompt. Only
    // runs when no document-generation skill was already applied (avoids double
    // injection). Uses keyword scoring to match security-audit, code-review,
    // test-writer, data-analysis, and documentation packs.
    let selectedPack: SkillPack | undefined;
    if (!docFormat) {
      selectedPack = selectSkillPackForTask(body.prompt, this.activeSkillPacks);
      if (selectedPack) {
        workerPrompt = `${workerPrompt}\n\n---\n\n${selectedPack.systemPromptExtension}`;
        logger.debug(
          { workerId, skillPack: selectedPack.name },
          'Injected skill pack prompt extension into worker',
        );
      }
    }

    // OB-1753: Apply the selected skill pack's toolProfile to the effective
    // profile. When a pack like security-audit specifies toolProfile:'code-audit',
    // the worker should use that profile instead of a broader one (e.g. code-edit)
    // to enforce the pack's read-only constraints. The pack profile is only
    // applied when it differs from the SPAWN marker profile — an explicit user
    // grant or a more-permissive SPAWN marker is respected over the pack default.
    if (selectedPack?.toolProfile && selectedPack.toolProfile !== profile) {
      logger.debug(
        {
          workerId,
          previousProfile: profile,
          newProfile: selectedPack.toolProfile,
          skillPack: selectedPack.name,
        },
        'Skill pack tool profile applied to worker',
      );
      profile = selectedPack.toolProfile;
    }

    // Adaptive model selection (OB-724): marker override → learned best model → heuristics
    if (!resolvedModel && this.memory) {
      const taskType = classifyTaskType(body.prompt);
      const learned = await getRecommendedModel(this.memory, taskType);
      if (learned) {
        resolvedModel = learned.model;
        logger.debug(
          { workerId, model: learned.model, reason: learned.reason },
          'Adaptive model selected for worker',
        );
      }
    }

    // Always resolve model tiers to concrete model IDs for the target provider.
    // This handles "fast" → "haiku" (claude), "fast" → "codex-mini" (codex), etc.
    if (resolvedModel) {
      const providerName =
        requestedTool && this.resolveDiscoveredTool(requestedTool)
          ? requestedTool
          : this.masterTool.name;
      const modelRegistry = createModelRegistry(providerName);
      resolvedModel = modelRegistry.resolveModelOrTier(resolvedModel);
    }

    // Avoid high-failure-rate models (OB-907): if the resolved model has >50% failure rate
    // for this task type (with ≥3 data points), prefer a better-performing alternative.
    if (resolvedModel && this.memory) {
      const taskTypeForAvoidance = classifyTaskType(body.prompt);
      const alternative = await avoidHighFailureModel(
        this.memory,
        taskTypeForAvoidance,
        resolvedModel,
      );
      if (alternative) {
        logger.info(
          {
            workerId,
            previousModel: resolvedModel,
            newModel: alternative.model,
            reason: alternative.reason,
          },
          'Model replaced due to high failure rate in learnings',
        );
        resolvedModel = alternative.model;
      }
    }

    // Adaptive max-turns (OB-902): scale budget by prompt length when the SPAWN marker
    // didn't explicitly specify maxTurns. A longer prompt usually means a more complex
    // task that needs more turns to complete.
    const resolvedMaxTurns = body.maxTurns ?? this.computeAdaptiveMaxTurns(profile, body.prompt);

    logger.info(
      {
        workerId,
        workerIndex: index,
        profile,
        model: resolvedModel,
        tool: toolUsed,
        maxTurns: resolvedMaxTurns,
        maxTurnsSource: body.maxTurns != null ? 'spawn-marker' : 'adaptive',
        promptLength: body.prompt.length,
      },
      'Spawning worker from SPAWN marker',
    );

    // OB-1780: Reasoning checkpoint — "What could go wrong?" before full-access workers.
    // Scans the task prompt for destructive, broad-scope, and security-sensitive patterns.
    // The checkpoint is analytical only (does not block execution); it surfaces risks in
    // the log so engineers and the audit trail can review the reasoning before a high-
    // privilege worker modifies files, installs packages, or runs system commands.
    if (profile === 'full-access') {
      const checkpoint = performReasoningCheckpoint(body.prompt);
      logger.info(
        {
          workerId,
          riskLevel: checkpoint.riskLevel,
          risks: checkpoint.risks.map((r) => ({ pattern: r.pattern, level: r.level })),
          riskCount: checkpoint.risks.length,
        },
        'Reasoning checkpoint: pre-spawn risk analysis for full-access worker',
      );
    }

    // Pre-flight tool prediction (OB-1595): before spending any turns, analyze the
    // task prompt for keywords that suggest the worker will need tools beyond what
    // its current profile allows (e.g. "npm test" with a read-only profile).
    // When a mismatch is predicted, request escalation upfront — the user is asked
    // before the worker is spawned, and the actual spawn is deferred to the respawn
    // callback so no turns are wasted on a predictably blocked worker.
    const toolPrediction = predictToolRequirements(body.prompt, profile);
    if (toolPrediction && this.router && this.activeMessage) {
      logger.info(
        {
          workerId,
          currentProfile: profile,
          suggestedProfile: toolPrediction.suggestedProfile,
          triggerKeywords: toolPrediction.triggerKeywords,
          reason: toolPrediction.reason,
        },
        'Pre-flight tool prediction: requesting upfront escalation before spawn',
      );
      const origMessage = this.activeMessage;
      const connector = this.router.getConnector(origMessage.source);
      if (connector) {
        const suggestedTools = resolveProfile(toolPrediction.suggestedProfile) ?? [];
        const currentTools = resolveProfile(profile) ?? [];
        const additionalTools = suggestedTools.filter((t) => !currentTools.includes(t));

        // OB-1596/OB-1600: If session or permanent grants already cover all additional
        // tools, skip escalation — they will be auto-merged into allowedTools below.
        const grantsCoversTools =
          additionalTools.length > 0 &&
          additionalTools.every((t) => expandedSessionGrants.has(t) || permanentGrants.includes(t));

        if (!grantsCoversTools) {
          const respawnCallback = async (grantedTools: string[]): Promise<void> => {
            await this.respawnWorkerAfterGrant(
              workerId,
              marker,
              index,
              profile,
              grantedTools,
              attachments,
            );
          };

          await this.router.requestToolEscalation(
            workerId,
            additionalTools.length > 0 ? additionalTools : [toolPrediction.suggestedProfile],
            profile,
            `Pre-flight prediction: ${toolPrediction.reason} (keywords: ${toolPrediction.triggerKeywords.join(', ')})`,
            origMessage,
            connector,
            respawnCallback,
          );

          // Return a deferred result — the actual spawn happens asynchronously
          // via respawnCallback when the user grants tool access.
          return {
            stdout: `[Pre-flight] Tool grant requested for worker ${workerId}: ${toolPrediction.reason}. Spawn deferred pending user confirmation.`,
            stderr: '',
            exitCode: 0,
            durationMs: 0,
            retryCount: 0,
            status: 'completed' as const,
          };
        }

        logger.info(
          {
            workerId,
            additionalTools,
            sessionGrants: [...senderSessionGrants],
            permanentGrants,
          },
          'Pre-flight: required tools already granted (session or permanent) — skipping escalation',
        );
      }
    }

    // OB-1787: Per-worker test modification permission grant.
    // The Master AI is instructed (via system prompt) to include either:
    //   a) "Do not modify test files ... unless explicitly authorized." — protection
    //   b) "AUTHORIZED: test modification permitted"                   — explicit grant
    // Additionally, the SPAWN marker may carry allowTestModification:true as a
    // structured alternative to the in-prompt text marker.
    //
    // Enforcement logic for code-edit and full-access workers:
    // 1. If test modification is explicitly granted (flag OR in-prompt marker):
    //    - Log the authorization for the audit trail.
    //    - Ensure the authorization header is present at the top of the prompt
    //      so the worker receives a clear, unambiguous grant even if the Master
    //      placed the text mid-prompt.
    // 2. If NOT granted and no protection instruction is already present:
    //    - Inject the protection reminder so workers always have an explicit guard,
    //      regardless of whether the Master included it in the prompt.
    const TEST_PROTECTION_PROFILES = new Set(['code-edit', 'full-access']);
    const AUTHORIZED_MARKER = 'AUTHORIZED: test modification permitted';
    const TEST_PROTECTION_INSTRUCTION =
      'Do not modify test files (files in `tests/`, `__tests__/`, or files matching ' +
      '`*.test.ts`, `*.spec.ts`, `*.test.js`, `*.spec.js`) unless explicitly authorized.';

    if (TEST_PROTECTION_PROFILES.has(profile)) {
      const hasAuthFlag = body.allowTestModification === true;
      const hasAuthText = workerPrompt.includes(AUTHORIZED_MARKER);
      const hasProtectionText = workerPrompt.includes(TEST_PROTECTION_INSTRUCTION.slice(0, 40));

      if (hasAuthFlag || hasAuthText) {
        // Grant: worker is authorized to touch test files.
        logger.info(
          { workerId, profile, source: hasAuthFlag ? 'spawn-flag' : 'prompt-marker' },
          'Test modification permission granted for this worker',
        );
        // Normalize: ensure the authorization header is at the very top of the prompt
        // so the worker cannot miss it (it may have been buried mid-prompt by the Master).
        if (!workerPrompt.startsWith(AUTHORIZED_MARKER)) {
          // Remove any existing AUTHORIZED marker to avoid duplication, then prepend.
          const cleaned = workerPrompt.replace(AUTHORIZED_MARKER, '').trimStart();
          workerPrompt = `${AUTHORIZED_MARKER}\n\n${cleaned}`;
        }
      } else if (!hasProtectionText) {
        // No grant and no protection text — the Master omitted the guard. Inject it.
        logger.debug(
          { workerId, profile },
          'Test protection instruction injected (Master omitted it)',
        );
        workerPrompt = `${TEST_PROTECTION_INSTRUCTION}\n\n${workerPrompt}`;
      }
    }

    // NOTE: No sessionId provided here — workers get --print mode (depth limiting)
    // manifestToSpawnOptions is async: when manifest.mcpServers is set, it writes a
    // per-worker temp MCP config file and returns a cleanup callback to delete it.
    const { spawnOptions: spawnOpts, cleanup: mcpCleanup } = await manifestToSpawnOptions(
      {
        prompt: workerPrompt,
        workspacePath: this.workspacePath,
        profile,
        model: resolvedModel,
        maxTurns: resolvedMaxTurns,
        timeout: body.timeout ?? DEFAULT_WORKER_TIMEOUT,
        retries: body.retries,
        maxBudgetUsd: body.maxBudgetUsd,
      },
      customProfiles,
    );

    // OB-1791: Apply configurable fix iteration cap to workers.
    // Sourced from config.worker.maxFixIterations (default: 3).
    spawnOpts.maxFixIterations = this.workerMaxFixIterations;

    // OB-1596: Auto-merge session-granted tools into this worker's allowedTools.
    // Tools previously approved by the user this session (via /allow) are applied
    // automatically so repeated worker spawns don't re-ask for the same permissions.
    if (expandedSessionGrants.size > 0) {
      const existing = spawnOpts.allowedTools ?? [];
      const toolsToAdd = [...expandedSessionGrants].filter((t) => !existing.includes(t));
      if (toolsToAdd.length > 0) {
        spawnOpts.allowedTools = [...existing, ...toolsToAdd];
        logger.debug(
          { workerId, toolsAdded: toolsToAdd },
          'Session grants auto-merged into worker allowedTools',
        );
      }
    }

    // OB-1600: Auto-merge permanent tool grants from the DB into this worker's allowedTools.
    // These are tools the user permanently approved (via /allow-permanent or the access CLI).
    // They persist across sessions and are applied without asking the user again.
    if (permanentGrants.length > 0) {
      const existing = spawnOpts.allowedTools ?? [];
      const toolsToAdd = permanentGrants.filter((t) => !existing.includes(t));
      if (toolsToAdd.length > 0) {
        spawnOpts.allowedTools = [...existing, ...toolsToAdd];
        logger.debug(
          { workerId, toolsAdded: toolsToAdd },
          'Permanent grants auto-merged into worker allowedTools',
        );
      }
    }

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
        model: resolvedModel,
        tool: toolUsed,
        maxTurns: resolvedMaxTurns,
        timeout: body.timeout,
        retries: body.retries,
        manifest: {
          prompt: body.prompt,
          workspacePath: this.workspacePath,
          profile,
          model: resolvedModel,
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

    // INSERT agent_activity row with status='starting' (OB-742)
    const workerStartedAt = new Date().toISOString();
    if (this.memory) {
      try {
        const masterSessionId = this.masterSession?.sessionId;
        const workerActivity: ActivityRecord = {
          id: workerId,
          type: 'worker',
          model: resolvedModel ?? body.model ?? undefined,
          profile,
          task_summary: body.prompt.slice(0, 120),
          status: 'starting',
          parent_id: masterSessionId,
          started_at: workerStartedAt,
          updated_at: workerStartedAt,
        };
        await this.memory.insertActivity(workerActivity);
      } catch (actErr) {
        logger.warn({ workerId, error: actErr }, 'Failed to record worker activity (starting)');
      }
    }

    try {
      // Build a streaming progress callback — broadcasts worker-turn-progress events
      // to all connectors as each agent turn is parsed from stdout (OB-1051).
      const routerRef = this.router;
      const workerMaxTurns = spawnOpts.maxTurns ?? DEFAULT_MAX_TURNS_TASK;
      const onTurnProgress = routerRef
        ? (indicator: { turnsUsed: number; lastAction?: string }): void => {
            void routerRef.broadcastProgress({
              type: 'worker-turn-progress',
              workerId,
              turnsUsed: indicator.turnsUsed,
              turnsMax: workerMaxTurns,
              lastAction: indicator.lastAction,
            });
          }
        : undefined;

      // Use spawnWithStreamingHandle() to capture the real PID and abort function (OB-873)
      // and broadcast real-time turn progress via worker-turn-progress events (OB-1051).
      let currentHandle = workerRunner.spawnWithStreamingHandle(spawnOpts, onTurnProgress);
      this.workerAbortHandles.set(workerId, currentHandle.abort);
      this.workerRegistry.markRunning(workerId, currentHandle.pid);
      logger.debug(
        { workerId, pid: currentHandle.pid },
        'Worker process started — real PID captured',
      );

      // UPDATE agent_activity to 'running' now that spawn is about to start (OB-742)
      if (this.memory) {
        try {
          await this.memory.updateActivity(workerId, { status: 'running' });
        } catch (actErr) {
          logger.warn({ workerId, error: actErr }, 'Failed to update worker activity (running)');
        }
      }

      // Worker-level retry with exponential backoff (OB-905).
      // Default retries = 2. Only retry on retryable error categories:
      //   retryable:     'rate-limit', 'timeout', 'crash'
      //   non-retryable: 'auth', 'context-overflow', 'unknown'
      const maxWorkerRetries = body.retries ?? 2;
      let workerRetryCount = 0;
      let result: AgentResult;
      let isFirstWorkerAttempt = true;

      while (true) {
        if (isFirstWorkerAttempt) {
          result = await currentHandle.promise;
          isFirstWorkerAttempt = false;
        } else {
          // Worker-level retry — spawn a new process and update the abort handle (OB-873)
          currentHandle = workerRunner.spawnWithStreamingHandle(spawnOpts, onTurnProgress);
          this.workerAbortHandles.set(workerId, currentHandle.abort);
          result = await currentHandle.promise;
        }

        if (result.exitCode === 0) {
          break; // Success — no retry needed
        }

        // Classify the error to decide retry strategy (OB-904, OB-905)
        const errorCategory = classifyError(result.stderr, result.exitCode);
        const isRetryable =
          errorCategory === 'rate-limit' ||
          errorCategory === 'timeout' ||
          errorCategory === 'crash';

        if (!isRetryable) {
          // Non-retryable failure (auth, context-overflow, unknown) — break immediately
          logger.warn(
            {
              workerId,
              exitCode: result.exitCode,
              errorCategory,
              durationMs: result.durationMs,
            },
            'Worker failed with non-retryable error',
          );
          break;
        }

        // Check if we have retries left
        if (workerRetryCount >= maxWorkerRetries) {
          break; // Exhausted retries
        }

        // Retryable failure — apply exponential backoff and retry
        workerRetryCount++;
        const delay = this.workerRetryDelayMs * Math.pow(2, workerRetryCount - 1);
        logger.info(
          {
            workerId,
            workerRetry: workerRetryCount,
            maxWorkerRetries,
            exitCode: result.exitCode,
            errorCategory,
            delayMs: delay,
            stderrPreview: result.stderr.slice(0, 150),
          },
          'Worker failed with retryable error — retrying after backoff',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Update worker record with retry count
      const workerRecord = this.workerRegistry.getWorker(workerId);
      if (workerRecord) {
        workerRecord.workerRetries = workerRetryCount;
      }

      // Detect max-turns exhaustion: Claude exits 0 but work may be incomplete (OB-900)
      // Auto-retry with an escalated turn budget (OB-903): max 1 turn-escalation retry.
      // Skip for non-Claude tools — --max-turns is a Claude-only feature. Other tools
      // (Codex, Aider) may produce false positives from pattern matching on their output.
      if (result.turnsExhausted && toolUsed === 'claude') {
        const originalMaxTurns = spawnOpts.maxTurns ?? DEFAULT_MAX_TURNS_TASK;
        logger.warn(
          {
            workerId,
            maxTurns: originalMaxTurns,
            model: result.model,
            durationMs: result.durationMs,
          },
          'Worker hit max-turns limit — attempting turn-escalation retry',
        );

        const escalatedMaxTurns = Math.min(Math.ceil(originalMaxTurns * 1.5), 50);
        const partialOutput = result.stdout.trim();

        // Extract [INCOMPLETE: step X/Y] marker injected by the worker (OB-901)
        const incompleteMatch = partialOutput.match(/\[INCOMPLETE:\s*([^\]]+)\]/i);
        const incompleteHint =
          incompleteMatch && incompleteMatch[1] ? incompleteMatch[1].trim() : null;

        const continuationNote = incompleteHint
          ? `Previous attempt was incomplete: ${incompleteHint}. Continue from where it left off.`
          : 'Previous attempt hit the turn limit before completing. Continue from where it left off.';

        // Append partial output (last 2 000 chars) as context so the worker can resume
        const escalationPrompt = [
          body.prompt,
          '',
          '---',
          'CONTEXT FROM PREVIOUS ATTEMPT (partial output):',
          partialOutput.slice(-2000),
          '---',
          continuationNote,
        ].join('\n');

        const escalatedSpawnOpts: SpawnOptions = {
          ...spawnOpts,
          prompt: escalationPrompt,
          maxTurns: escalatedMaxTurns,
        };

        logger.info(
          { workerId, originalMaxTurns, escalatedMaxTurns, incompleteHint },
          'Turn-escalation retry: re-spawning with higher turn budget',
        );

        // Use spawnWithStreamingHandle() so the abort handle stays current during escalation (OB-873)
        // Pass a dedicated callback with the escalated max-turns value (OB-1051).
        const escalationHandle = workerRunner.spawnWithStreamingHandle(
          escalatedSpawnOpts,
          routerRef
            ? (indicator): void => {
                void routerRef.broadcastProgress({
                  type: 'worker-turn-progress',
                  workerId,
                  turnsUsed: indicator.turnsUsed,
                  turnsMax: escalatedMaxTurns,
                  lastAction: indicator.lastAction,
                });
              }
            : undefined,
        );
        this.workerAbortHandles.set(workerId, escalationHandle.abort);
        result = await escalationHandle.promise;

        if (result.turnsExhausted) {
          logger.warn(
            { workerId, escalatedMaxTurns },
            'Turn-escalation retry also exhausted — returning partial result',
          );
        }
      }

      // Update registry based on final result
      if (result.exitCode === 0) {
        this.workerRegistry.markCompleted(workerId, result);
      } else {
        const isTimeout = result.exitCode === 143 || result.exitCode === 137;
        const errorMessage = isTimeout
          ? `Worker timeout: process terminated after ${body.timeout ?? 'default'}ms (exit code ${result.exitCode})`
          : `Exit code ${result.exitCode}: ${result.stderr.slice(0, 200)}`;

        this.workerRegistry.markFailed(workerId, result, errorMessage);
      }

      // Persist registry after worker completion or failure
      await this.persistWorkerRegistry();

      // Detect tool-access failures in the worker result (OB-1592).
      // Even a zero-exit worker may report a tool-denial in its output.
      const toolFailure = detectToolAccessFailure(result);
      if (toolFailure) {
        logger.warn(
          {
            workerId,
            tool: toolFailure.tool,
            profile,
            reason: toolFailure.reason,
            exitCode: result.exitCode,
          },
          'Worker tool-access failure detected — tool was blocked by allowedTools restrictions',
        );
        // Store on the result metadata for audit trail.
        taskRecord.metadata = {
          ...taskRecord.metadata,
          toolAccessFailure: { tool: toolFailure.tool, reason: toolFailure.reason },
        };

        // Wire to Router escalation (OB-1593): ask the user to approve the needed tool.
        // Only fires when a router and an active user message are available (i.e. during
        // processMessage / streamMessage — not during background exploration workers).
        if (this.router && this.activeMessage) {
          const origMessage = this.activeMessage;
          const connector = this.router.getConnector(origMessage.source);
          if (connector) {
            const requestedTools = toolFailure.tool ? [toolFailure.tool] : [];
            // OB-1594: Provide a respawn callback so /allow can re-spawn the worker
            // with the granted tools merged into its profile.
            const respawnCallback = async (grantedTools: string[]): Promise<void> => {
              await this.respawnWorkerAfterGrant(
                workerId,
                marker,
                index,
                profile,
                grantedTools,
                attachments,
              );
            };
            await this.router.requestToolEscalation(
              workerId,
              requestedTools,
              profile,
              toolFailure.reason,
              origMessage,
              connector,
              respawnCallback,
            );
          } else {
            logger.warn(
              { workerId, source: origMessage.source },
              'Tool escalation skipped — connector not found for source',
            );
          }
        }
      }

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
        workerRetries: workerRetryCount,
        modelUsed: result.model,
        modelFallbacks: result.modelFallbacks,
        resolvedTools: spawnOpts.allowedTools,
      };

      // Write worker task to store (memory) (OB-165: task history + audit trail)
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
          max_turns: spawnOpts.maxTurns,
          duration_ms: taskRecord.durationMs,
          exit_code: (taskRecord.metadata?.['exitCode'] as number | undefined) ?? result.exitCode,
          retries: result.retryCount,
          created_at: taskRecord.createdAt,
          completed_at: taskRecord.completedAt,
        });
      } else {
        logger.warn({ workerId }, 'MemoryManager not available — worker task record not persisted');
      }

      // UPDATE agent_activity to 'done' or 'failed' with cost (OB-742, OB-746)
      if (this.memory) {
        try {
          const activityStatus = result.exitCode === 0 ? 'done' : 'failed';
          await this.memory.updateActivity(workerId, {
            status: activityStatus,
            progress_pct: result.exitCode === 0 ? 100 : undefined,
            completed_at: taskRecord.completedAt,
            cost_usd: result.costUsd,
          });
        } catch (actErr) {
          logger.warn({ workerId, error: actErr }, 'Failed to update worker activity (completion)');
        }
      }

      // Record worker output to conversation history (OB-730)
      if (result.exitCode === 0 && result.stdout.trim()) {
        const workerSessionId = this.masterSession?.sessionId ?? workerId;
        await this.recordConversationMessage(workerSessionId, 'worker', result.stdout.trim());
      }

      // Auto-store worker results in chunk store for future RAG retrieval (OB-1570)
      if (result.exitCode === 0 && result.stdout.trim() && this.knowledgeRetriever) {
        try {
          await this.knowledgeRetriever.storeWorkerResult(result.stdout.trim(), body.prompt, []);
        } catch (storeErr) {
          logger.warn(
            { workerId, error: storeErr },
            'Failed to store worker result in chunk store',
          );
        }
      }

      // Record learning entry for this worker execution (OB-171: learnings store)
      await this.recordWorkerLearning(taskRecord, result, profile, spawnOpts.model);

      // Record prompt effectiveness (OB-172: prompt effectiveness tracking)
      await this.recordPromptEffectiveness(taskRecord, result);

      // Clean up per-worker MCP temp file (no-op when no MCP servers were requested)
      await mcpCleanup();

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
        status: 'completed',
      };

      this.workerRegistry.markFailed(workerId, failedResult, errorMessage);

      // Remove worker from registry to free the concurrency slot and prevent orphaned
      // pending workers from accumulating (OB-1264 / OB-F153)
      this.workerRegistry.removeWorker(workerId);

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

      // Write worker task to store (memory) even on exception (OB-165)
      if (this.memory) {
        await this.memory.recordTask({
          id: taskRecord.id,
          type: 'worker',
          status: 'failed',
          prompt: taskRecord.userMessage,
          model: taskRecord.metadata?.['modelUsed'] as string | undefined,
          profile,
          max_turns: spawnOpts.maxTurns,
          duration_ms: 0,
          exit_code: -1,
          retries: 0,
          created_at: taskRecord.createdAt,
          completed_at: taskRecord.completedAt,
        });
      } else {
        logger.warn(
          { workerId },
          'MemoryManager not available — worker exception task record not persisted',
        );
      }

      // UPDATE agent_activity to 'failed' on exception (OB-742)
      if (this.memory) {
        try {
          await this.memory.updateActivity(workerId, {
            status: 'failed',
            completed_at: taskRecord.completedAt,
          });
        } catch (actErr) {
          logger.warn({ workerId, error: actErr }, 'Failed to update worker activity (failed)');
        }
      }

      // Record learning entry even on exception (OB-171: learnings store)
      await this.recordWorkerLearning(taskRecord, failedResult, profile, body.model);

      // Record prompt effectiveness even on exception (OB-172: prompt effectiveness tracking)
      await this.recordPromptEffectiveness(taskRecord, failedResult);

      // Clean up per-worker MCP temp file even on exception
      await mcpCleanup();

      // Re-throw so Promise.allSettled captures it as rejected
      throw error;
    } finally {
      // Always clean up abort handle — ensures no stale handles even on pre-spawn
      // exceptions (escalation timeout, slot wait timeout, spawn error). (OB-F171)
      this.workerAbortHandles.delete(workerId);
    }
  }

  /**
   * Spawns a lightweight read-only worker to answer a focused question about
   * specific files. Used by the targeted reader path when RAG confidence < 0.3.
   *
   * OB-1353
   */
  public async spawnTargetedReader(filePaths: string[], question: string): Promise<string> {
    const fileList = filePaths.map((p) => `- ${p}`).join('\n');
    const prompt = [
      'Read these files and answer the following question.',
      '',
      '## Files to Read',
      fileList,
      '',
      '## Question',
      question,
    ].join('\n');

    const model = this.modelRegistry.resolveModelOrTier('fast');

    logger.debug(
      { fileCount: filePaths.length, question: question.slice(0, 80) },
      'Spawning targeted reader worker',
    );

    const result = await this.agentRunner.spawn({
      prompt,
      workspacePath: this.workspacePath,
      allowedTools: [...TOOLS_READ_ONLY],
      maxTurns: 5,
      model,
    });

    if (result.exitCode !== 0) {
      logger.warn(
        { exitCode: result.exitCode, fileCount: filePaths.length },
        'Targeted reader worker failed',
      );
      return '';
    }

    return result.stdout.trim();
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
  /**
   * Resolve a discovered tool by name (synchronous, exact match only).
   * Used for per-worker tool selection from SPAWN markers.
   */
  private resolveDiscoveredTool(toolName: string): DiscoveredTool | undefined {
    return this.discoveredTools.find((t) => t.name === toolName && t.available);
  }

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

    // Check agents registry — DB first, JSON fallback
    let agents = null;
    if (this.memory) {
      const raw = await this.memory.getSystemConfig('agents');
      if (raw) {
        try {
          agents = AgentsRegistrySchema.parse(JSON.parse(raw));
        } catch {
          // fall through to JSON file
        }
      }
    }
    if (!agents) {
      agents = await this.dotFolder.readAgents();
    }
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

  /** Create agents registry. Delegated to ExplorationManager (OB-1280). */
  private createAgentsRegistry(): AgentsRegistry {
    return this.explorationManager.createAgentsRegistry();
  }

  // ---------------------------------------------------------------------------
  // Sub-master routing helpers (OB-755)
  // ---------------------------------------------------------------------------

  /**
   * Detect which active sub-masters (if any) are relevant for the given message content.
   *
   * Scans the message text for path-like references that start with a sub-master's
   * relative path (e.g. "backend/", "frontend/"). Returns routing info when at
   * least one sub-master is matched.
   *
   * Examples of matched patterns:
   *   "Update backend/src/auth.ts"   → matches sub-master with path "backend"
   *   "Fix the frontend/app/index"   → matches sub-master with path "frontend"
   *   "backend and frontend changes" → cross-cutting (matches both)
   *
   * Returns null when no sub-master scope is detected.
   */
  private detectSubMasterRouting(
    content: string,
    activeSubMasters: SubMasterRecord[],
  ): { type: 'single' | 'cross-cutting'; subMasters: SubMasterRecord[] } | null {
    const normalizedContent = content.toLowerCase();
    const matched: SubMasterRecord[] = [];

    for (const subMaster of activeSubMasters) {
      // subMaster.path is a relative path like "backend" or "packages/api"
      const subPath = subMaster.path.toLowerCase();
      // Match references like "backend/", "./backend", or standalone "backend" at word boundary
      const hasPathRef =
        normalizedContent.includes(`${subPath}/`) ||
        normalizedContent.includes(`./${subPath}`) ||
        new RegExp(`\\b${subPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(
          normalizedContent,
        );
      if (hasPathRef) {
        matched.push(subMaster);
      }
    }

    if (matched.length === 0) return null;

    return {
      type: matched.length === 1 ? 'single' : 'cross-cutting',
      subMasters: matched,
    };
  }

  /**
   * Delegate a task to a single sub-master.
   *
   * Opens the sub-master's DB, builds a context briefing from its exploration
   * data, then spawns a worker scoped to the sub-master's workspace directory.
   * Falls back gracefully if the sub-master DB doesn't exist yet.
   */
  private async delegateToSubMaster(
    subMaster: SubMasterRecord,
    taskContent: string,
  ): Promise<string> {
    const subMasterAbsPath = path.join(this.workspacePath, subMaster.path);
    const subMasterDbPath = path.join(subMasterAbsPath, '.openbridge', 'openbridge.db');

    let briefingContext = '';
    let subDb = null;
    try {
      subDb = openDatabase(subMasterDbPath);
      const briefing = await buildBriefing(subDb, taskContent, undefined, this.agentRunner);
      briefingContext = briefing;
      logger.info(
        { subMasterPath: subMaster.path, briefingLength: briefing.length },
        'Built sub-master briefing',
      );
    } catch (err) {
      // Sub-master DB may not exist yet (exploration still in progress or stale).
      // Fall through and spawn the worker without briefing context.
      logger.warn(
        { error: err, subMasterPath: subMaster.path },
        'Could not read sub-master briefing — proceeding without context',
      );
    } finally {
      if (subDb) {
        closeDatabase(subDb);
      }
    }

    const prompt = briefingContext
      ? `${briefingContext}\n\n## Task\n\n${taskContent}`
      : taskContent;

    const result = await this.agentRunner.spawn({
      prompt,
      workspacePath: subMasterAbsPath,
      model: 'sonnet',
      allowedTools: [...TOOLS_CODE_EDIT],
      maxTurns: DEFAULT_MAX_TURNS_TASK,
    });

    if (result.exitCode !== 0) {
      logger.warn(
        { subMasterPath: subMaster.path, exitCode: result.exitCode },
        'Sub-master worker exited with non-zero code',
      );
    }

    return (
      result.stdout.trim() ||
      `Sub-master task for ${subMaster.name} completed with exit code ${result.exitCode}.`
    );
  }

  /**
   * Orchestrate delegation to one or more sub-masters.
   *
   * Single sub-master: delegate directly and return its response.
   * Cross-cutting (multiple sub-masters): spawn one worker per affected
   * sub-master concurrently, then collect and combine their results into
   * a unified response string for the Master to relay to the user.
   */
  private async handleSubMasterDelegation(
    routing: { type: 'single' | 'cross-cutting'; subMasters: SubMasterRecord[] },
    taskContent: string,
    progress?: ProgressReporter,
  ): Promise<string> {
    if (routing.type === 'single') {
      const [subMaster] = routing.subMasters;
      logger.info({ subMasterPath: subMaster!.path }, 'Delegating task to single sub-master');
      const result = await this.delegateToSubMaster(subMaster!, taskContent);
      await progress?.({ type: 'worker-progress', completed: 1, total: 1 });
      return result;
    }

    // Cross-cutting: decompose into per-sub-master sub-tasks and run concurrently
    logger.info(
      { count: routing.subMasters.length, paths: routing.subMasters.map((s) => s.path) },
      'Delegating cross-cutting task to multiple sub-masters',
    );

    let completedCount = 0;
    const total = routing.subMasters.length;

    const settled = await Promise.allSettled(
      routing.subMasters.map((subMaster) =>
        this.delegateToSubMaster(subMaster, taskContent).then(async (res) => {
          completedCount++;
          await progress?.({ type: 'worker-progress', completed: completedCount, total });
          return { name: subMaster.name, path: subMaster.path, result: res };
        }),
      ),
    );

    const parts: string[] = [];
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        parts.push(`### ${outcome.value.name} (${outcome.value.path})\n\n${outcome.value.result}`);
      } else {
        const err =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        parts.push(`### Sub-master delegation failed\n\n${err}`);
      }
    }

    return parts.join('\n\n---\n\n');
  }
}
