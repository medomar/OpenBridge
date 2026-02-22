import { DotFolderManager } from './dotfolder-manager.js';
import { generateReExplorationPrompt } from './exploration-prompt.js';
import { generateMasterSystemPrompt } from './master-system-prompt.js';
import { AgentRunner, TOOLS_READ_ONLY } from '../core/agent-runner.js';
import type { SpawnOptions, AgentResult } from '../core/agent-runner.js';
import { manifestToSpawnOptions } from '../core/agent-runner.js';
import { BUILT_IN_PROFILES } from '../types/agent.js';
import type { ToolProfile } from '../types/agent.js';
import { DelegationCoordinator } from './delegation.js';
import { parseSpawnMarkers, hasSpawnMarkers } from './spawn-parser.js';
import type { ParsedSpawnMarker } from './spawn-parser.js';
import { formatWorkerBatch } from './worker-result-formatter.js';
import { WorkerRegistry } from './worker-registry.js';
import type {
  MasterState,
  ExplorationSummary,
  TaskRecord,
  AgentsRegistry,
  WorkspaceMap,
  MasterSession,
  PromptTemplate,
} from '../types/master.js';
import type { DiscoveredTool } from '../types/discovery.js';
import type { InboundMessage } from '../types/message.js';
import { createLogger } from '../core/logger.js';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const logger = createLogger('master-manager');

const DEFAULT_TIMEOUT = 600_000; // 10 minutes for exploration
const DEFAULT_MESSAGE_TIMEOUT = 60_000; // 1 minute for message processing

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
  private readonly delegationCoordinator: DelegationCoordinator;
  private readonly agentRunner: AgentRunner;
  private readonly workerRegistry: WorkerRegistry;

  private state: MasterState = 'idle';
  private explorationSummary: ExplorationSummary | null = null;

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

  constructor(options: MasterManagerOptions) {
    this.workspacePath = options.workspacePath;
    this.masterTool = options.masterTool;
    this.discoveredTools = options.discoveredTools;
    this.explorationTimeout = options.explorationTimeout ?? DEFAULT_TIMEOUT;
    this.messageTimeout = options.messageTimeout ?? DEFAULT_MESSAGE_TIMEOUT;
    this.skipAutoExploration = options.skipAutoExploration ?? false;
    this.dotFolder = new DotFolderManager(this.workspacePath);
    this.delegationCoordinator = new DelegationCoordinator();
    this.agentRunner = new AgentRunner();
    this.workerRegistry = new WorkerRegistry();

    logger.info(
      {
        workspacePath: this.workspacePath,
        masterTool: this.masterTool.name,
        skipAutoExploration: this.skipAutoExploration,
      },
      'MasterManager created',
    );
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
    return this.dotFolder.readMap();
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
    const map = await this.dotFolder.readMap();

    if (map) {
      // Scenario 1: Valid map exists — skip exploration, enter ready state
      logger.info(
        { projectType: map.projectType },
        'Valid workspace map found, skipping exploration',
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

      this.state = 'ready';
      logger.info({ projectType: map.projectType }, 'Master AI ready (loaded existing map)');
      return;
    }

    // Check for incomplete or failed exploration state
    const explorationState = await this.dotFolder.readExplorationState();
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
    const existing = await this.dotFolder.readMasterSession();

    if (existing) {
      this.masterSession = existing;
      this.sessionInitialized = true; // Existing session — use --resume from the start
      logger.info(
        { sessionId: existing.sessionId, messageCount: existing.messageCount },
        'Loaded existing Master session',
      );
      return;
    }

    // Create new session
    const sessionId = `master-${randomUUID()}`;
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

    // Persist to disk
    try {
      await this.dotFolder.writeMasterSession(this.masterSession);
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
  private buildMasterSpawnOptions(prompt: string, timeout?: number): SpawnOptions {
    const session = this.masterSession!;
    const opts: SpawnOptions = {
      prompt,
      workspacePath: this.workspacePath,
      allowedTools: [...session.allowedTools],
      maxTurns: session.maxTurns,
      timeout: timeout ?? this.messageTimeout,
      retries: 0, // Master session calls don't auto-retry (caller handles)
    };

    // Inject the system prompt if available
    if (this.systemPrompt) {
      opts.systemPrompt = this.systemPrompt;
    }

    if (this.sessionInitialized) {
      opts.resumeSessionId = session.sessionId;
    } else {
      opts.sessionId = session.sessionId;
    }

    return opts;
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
      await this.dotFolder.writeMasterSession(this.masterSession);
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
    const map = await this.dotFolder.readMap();
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
    const tasks = await this.dotFolder.readAllTasks();
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

    // Create a new session
    const sessionId = `master-${randomUUID()}`;
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
      await this.dotFolder.writeMasterSession(this.masterSession);
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

      await this.dotFolder.appendLearning(learningEntry);

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
   * Master-driven exploration: sends an exploration prompt through the
   * persistent Master session. The Master uses its own tools to explore
   * the workspace and write results to `.openbridge/`.
   */
  private async masterDrivenExplore(): Promise<void> {
    logger.info('Executing Master-driven exploration via session');

    const explorationPrompt = this.buildExplorationPrompt();
    const spawnOpts = this.buildMasterSpawnOptions(explorationPrompt, this.explorationTimeout);
    const result = await this.agentRunner.spawn(spawnOpts);
    await this.updateMasterSession();

    if (result.exitCode !== 0) {
      throw new Error(
        `Master-driven exploration failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }

    // Write agents.json (Master can't spawn workers, so we do this mechanically)
    await this.writeAgentsRegistry();

    // Commit exploration results
    await this.dotFolder.commitChanges('feat(master): Master-driven workspace exploration');

    // Log completion
    await this.dotFolder.appendLog({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Master-driven exploration completed',
      data: { durationMs: result.durationMs },
    });

    // Build summary from whatever the Master wrote
    await this.loadExplorationSummary();
  }

  /**
   * Build the exploration prompt sent to the Master session.
   * Instructs the Master to autonomously explore the workspace and write workspace-map.json.
   * The Master decides its own exploration strategy — no hardcoded phases.
   */
  private buildExplorationPrompt(): string {
    return `Explore the workspace at \`${this.workspacePath}\` and create a comprehensive understanding.

You are in charge of the exploration strategy. Use your tools (Read, Glob, Grep) to understand the project, then write your findings to \`.openbridge/workspace-map.json\` using the Write tool.

Follow the "Workspace Exploration" section in your system prompt for the schema and recommended strategy. Adapt the depth of exploration to the project's size and complexity.

Work silently — do not output conversational text, just explore and write the map file.`;
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
    const map = await this.dotFolder.readMap();

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
   * Process a message from a user.
   * Uses the persistent Master session for conversation continuity.
   * All messages go through the same Master session regardless of sender.
   */
  public async processMessage(message: InboundMessage): Promise<string> {
    // Reset idle timer on new message
    this.resetIdleTimer();

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

    try {
      // Check for status queries
      if (this.isStatusQuery(message.content)) {
        const status = await this.getStatus();
        this.state = 'ready';
        task.status = 'completed';
        task.result = status;
        task.completedAt = new Date().toISOString();
        task.durationMs =
          new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();
        await this.dotFolder.recordTask(task);
        return status;
      }

      // Execute message through the persistent Master session
      const spawnOpts = this.buildMasterSpawnOptions(message.content);
      let result = await this.agentRunner.spawn(spawnOpts);
      await this.updateMasterSession();

      // Detect dead session and restart transparently
      if (result.exitCode !== 0 && this.isSessionDead(result.exitCode, result.stderr)) {
        logger.warn(
          { exitCode: result.exitCode, stderr: result.stderr.slice(0, 200) },
          'Master session appears dead, attempting restart',
        );

        await this.restartMasterSession();

        // Retry the original message with the new session
        const retryOpts = this.buildMasterSpawnOptions(message.content);
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
          await this.dotFolder.recordTask(task);

          const feedbackPrompt = await this.handleSpawnMarkers(spawnResult.markers);

          // Inject worker results back into the Master session
          this.state = 'processing';
          const feedbackOpts = this.buildMasterSpawnOptions(feedbackPrompt);
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
          await this.dotFolder.recordTask(task);

          const delegationResults = await this.handleDelegations(delegations, message);

          const feedbackPrompt = `The following delegation results are available:\n\n${delegationResults}\n\nPlease synthesize these results and provide a final response to the user.`;

          this.state = 'processing';
          const feedbackOpts = this.buildMasterSpawnOptions(feedbackPrompt);
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

      await this.dotFolder.recordTask(task);
      await this.dotFolder.commitChanges(`Task ${taskId}: ${message.content.slice(0, 50)}`);

      this.state = 'ready';

      logger.info(
        { taskId, durationMs: task.durationMs, responseLength: response.length },
        'Message processed successfully',
      );

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update task record with error
      task.status = 'failed';
      task.error = errorMessage;
      task.completedAt = new Date().toISOString();
      task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();

      await this.dotFolder.recordTask(task);

      this.state = 'ready';

      logger.error({ err: error, taskId, sender: message.sender }, 'Message processing failed');

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

    try {
      // Check for status queries
      if (this.isStatusQuery(message.content)) {
        const status = await this.getStatus();
        this.state = 'ready';
        task.status = 'completed';
        task.result = status;
        task.completedAt = new Date().toISOString();
        task.durationMs =
          new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();
        await this.dotFolder.recordTask(task);
        yield status;
        return;
      }

      // Stream message through the persistent Master session
      const spawnOpts = this.buildMasterSpawnOptions(message.content);
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

        // Retry the message with the new session (streamed)
        const retryOpts = this.buildMasterSpawnOptions(message.content);
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
          await this.dotFolder.recordTask(task);

          // Use progress-streaming variant if multiple workers are spawned
          let feedbackPrompt: string;
          if (spawnResult.markers.length > 1) {
            // Stream progress updates as workers complete
            const progressGen = this.handleSpawnMarkersWithProgress(spawnResult.markers);
            let progressIter = await progressGen.next();
            while (!progressIter.done) {
              const progressChunk = progressIter.value;
              yield progressChunk;
              progressIter = await progressGen.next();
            }
            feedbackPrompt = progressIter.value;
          } else {
            // Single worker — no progress streaming needed
            feedbackPrompt = await this.handleSpawnMarkers(spawnResult.markers);
          }

          // Inject worker results back into the Master session (streamed)
          this.state = 'processing';
          const feedbackOpts = this.buildMasterSpawnOptions(feedbackPrompt);
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
          await this.dotFolder.recordTask(task);

          const delegationResults = await this.handleDelegations(delegations, message);

          const feedbackPrompt = `The following delegation results are available:\n\n${delegationResults}\n\nPlease synthesize these results and provide a final response to the user.`;

          this.state = 'processing';
          const feedbackOpts = this.buildMasterSpawnOptions(feedbackPrompt);
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

      await this.dotFolder.recordTask(task);
      await this.dotFolder.commitChanges(`Task ${taskId}: ${message.content.slice(0, 50)}`);

      this.state = 'ready';

      logger.info(
        { taskId, durationMs: task.durationMs, responseLength: fullResponse.length },
        'Message streamed successfully',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Update task record with error
      task.status = 'failed';
      task.error = errorMessage;
      task.completedAt = new Date().toISOString();
      task.durationMs = new Date(task.completedAt).getTime() - new Date(task.startedAt!).getTime();

      await this.dotFolder.recordTask(task);

      this.state = 'ready';

      logger.error({ err: error, taskId, sender: message.sender }, 'Message streaming failed');

      yield `Error: ${errorMessage}`;
    }
  }

  /**
   * Get system status
   */
  public async getStatus(): Promise<string> {
    const map = await this.dotFolder.readMap();
    const tasks = await this.dotFolder.readAllTasks();

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

      // Commit the rewrite
      await this.dotFolder.commitChanges(
        `feat(master): rewrite ${prompt.id} prompt (low success rate: ${(prompt.successRate ?? 0) * 100}%)`,
      );

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
    const learnings = await this.dotFolder.readLearnings();
    if (!learnings || learnings.entries.length < 10) {
      // Need at least 10 learnings to identify patterns
      return;
    }

    logger.info(
      { learningCount: learnings.entries.length },
      'Analyzing learnings for profile patterns',
    );

    // Group learnings by task type
    const byTaskType = new Map<string, typeof learnings.entries>();
    for (const entry of learnings.entries) {
      const existing = byTaskType.get(entry.taskType) ?? [];
      existing.push(entry);
      byTaskType.set(entry.taskType, existing);
    }

    // Look for task types with >5 entries and >70% success rate
    for (const [taskType, entries] of byTaskType) {
      if (entries.length < 5) continue;

      const successCount = entries.filter((e) => e.success).length;
      const successRate = successCount / entries.length;

      if (successRate < 0.7) continue;

      // Check if a profile already exists for this task type
      const existingProfiles = await this.dotFolder.readProfiles();
      const profileId = `auto-${taskType}`;

      if (existingProfiles?.profiles[profileId]) {
        // Profile already exists
        continue;
      }

      // Analyze which profile was most commonly used for successful tasks
      const successfulProfiles = entries
        .filter((e) => e.success && e.profileUsed !== undefined)
        .map((e) => e.profileUsed as string); // Safe because we filtered out undefined above

      // Find most common profile
      const profileCounts = new Map<string, number>();
      for (const profile of successfulProfiles) {
        profileCounts.set(profile, (profileCounts.get(profile) ?? 0) + 1);
      }

      const [mostCommonProfile, count] = [...profileCounts.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0] ?? [null, 0];

      if (!mostCommonProfile || count < 3) {
        // Not enough evidence for a pattern
        continue;
      }

      // Find the tools from the most common profile
      const builtInProfile = BUILT_IN_PROFILES[mostCommonProfile as keyof typeof BUILT_IN_PROFILES];
      if (!builtInProfile) {
        continue;
      }

      logger.info(
        {
          taskType,
          profileId,
          baseProfile: mostCommonProfile,
          successRate,
          usageCount: entries.length,
        },
        'Creating custom profile from learning patterns',
      );

      // Create new profile
      const newProfile: ToolProfile = {
        name: profileId,
        description: `Auto-generated profile for ${taskType} tasks (success rate: ${(successRate * 100).toFixed(1)}%)`,
        tools: [...builtInProfile.tools],
      };

      try {
        await this.dotFolder.addProfile(newProfile);
        await this.dotFolder.commitChanges(
          `feat(master): create custom profile ${profileId} from learnings (${entries.length} samples, ${(successRate * 100).toFixed(1)}% success)`,
        );

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
    const map = await this.dotFolder.readMap();
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
        await this.dotFolder.writeMasterSession(this.masterSession);
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
   */
  private async handleSpawnMarkers(markers: ParsedSpawnMarker[]): Promise<string> {
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
      maxTurns: marker.body.maxTurns,
      timeout: marker.body.timeout,
      retries: marker.body.retries,
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
      return this.spawnWorker(workerId, marker, index, customProfiles);
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
      maxTurns: marker.body.maxTurns,
      timeout: marker.body.timeout,
      retries: marker.body.retries,
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
      return this.spawnWorker(workerId, marker, index, customProfiles);
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

    // NOTE: No sessionId provided here — workers get --print mode (depth limiting)
    const spawnOpts = manifestToSpawnOptions(
      {
        prompt: body.prompt,
        workspacePath: this.workspacePath,
        profile,
        model: body.model,
        maxTurns: body.maxTurns,
        timeout: body.timeout,
        retries: body.retries,
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

      // Write worker task to disk without git commit (OB-165: task history + audit trail)
      // Workers are batched, so we don't commit each one individually to avoid git lock contention
      await this.dotFolder.writeTask(taskRecord);

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

      // Write worker task to disk even on exception (OB-165: task history + audit trail)
      // Workers are batched, so we don't commit each one individually to avoid git lock contention
      await this.dotFolder.writeTask(taskRecord);

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
