import { DotFolderManager } from './dotfolder-manager.js';
import { generateReExplorationPrompt } from './exploration-prompt.js';
import { generateMasterSystemPrompt } from './master-system-prompt.js';
import { AgentRunner, TOOLS_READ_ONLY } from '../core/agent-runner.js';
import type { SpawnOptions, AgentResult } from '../core/agent-runner.js';
import { manifestToSpawnOptions } from '../core/agent-runner.js';
import { DelegationCoordinator } from './delegation.js';
import { parseSpawnMarkers, hasSpawnMarkers } from './spawn-parser.js';
import type { ParsedSpawnMarker } from './spawn-parser.js';
import type {
  MasterState,
  ExplorationSummary,
  TaskRecord,
  AgentsRegistry,
  WorkspaceMap,
  MasterSession,
} from '../types/master.js';
import type { DiscoveredTool } from '../types/discovery.js';
import type { ToolProfile } from '../types/agent.js';
import type { InboundMessage } from '../types/message.js';
import { createLogger } from '../core/logger.js';
import { randomUUID } from 'node:crypto';

const logger = createLogger('master-manager');

const DEFAULT_TIMEOUT = 600_000; // 10 minutes for exploration
const DEFAULT_MESSAGE_TIMEOUT = 60_000; // 1 minute for message processing

/**
 * Tools available to the Master AI session.
 * Master can read, write, and edit files (for .openbridge/ management)
 * but NOT execute arbitrary commands — it delegates to workers for that.
 */
const MASTER_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Edit'] as const;

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

  private state: MasterState = 'idle';
  private explorationSummary: ExplorationSummary | null = null;

  /** Persistent Master session — shared across all user messages */
  private masterSession: MasterSession | null = null;
  /** Whether the session has been used (first call uses --session-id, subsequent use --resume) */
  private sessionInitialized = false;
  /** Cached system prompt content (loaded from .openbridge/prompts/master-system.md) */
  private systemPrompt: string | null = null;

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
   * Process a message from a user.
   * Uses the persistent Master session for conversation continuity.
   * All messages go through the same Master session regardless of sender.
   */
  public async processMessage(message: InboundMessage): Promise<string> {
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

          const workerResults = await this.handleSpawnMarkers(spawnResult.markers);

          // Feed worker results back to Master session
          const feedbackPrompt = `The following worker results are available:\n\n${workerResults}\n\nPlease synthesize these results and provide a final response to the user.`;

          this.state = 'processing';
          const feedbackOpts = this.buildMasterSpawnOptions(feedbackPrompt);
          result = await this.agentRunner.spawn(feedbackOpts);
          await this.updateMasterSession();

          if (result.exitCode !== 0) {
            throw new Error(`Worker feedback processing failed: ${result.stderr}`);
          }

          response = result.stdout.trim() || workerResults;
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

      if (streamResult.exitCode !== 0) {
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

          const workerResults = await this.handleSpawnMarkers(spawnResult.markers);

          const feedbackPrompt = `The following worker results are available:\n\n${workerResults}\n\nPlease synthesize these results and provide a final response to the user.`;

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

          fullResponse = finalResponse.trim() || workerResults;
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
   * Gracefully shut down the Master AI
   */
  public async shutdown(): Promise<void> {
    if (this.state === 'shutdown') {
      return;
    }

    logger.info('Shutting down MasterManager');

    this.state = 'shutdown';

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
   * collects results, and returns formatted output for feeding back to Master.
   */
  private async handleSpawnMarkers(markers: ParsedSpawnMarker[]): Promise<string> {
    const results: string[] = [];

    // Load custom profiles once for all workers
    const customProfilesRegistry = await this.dotFolder.readProfiles();
    const customProfiles = customProfilesRegistry?.profiles;

    // Spawn all workers concurrently via Promise.allSettled
    const workerPromises = markers.map((marker, index) =>
      this.spawnWorker(marker, index, customProfiles),
    );

    const settled = await Promise.allSettled(workerPromises);

    for (let i = 0; i < settled.length; i++) {
      const marker = markers[i]!;
      const outcome = settled[i]!;

      if (outcome.status === 'fulfilled') {
        const workerResult = outcome.value;
        if (workerResult.exitCode === 0) {
          results.push(
            `[WORKER RESULT (${marker.profile}, worker ${i + 1}/${markers.length})]\n${workerResult.stdout.trim()}\n[/WORKER RESULT]`,
          );
        } else {
          results.push(
            `[WORKER ERROR (${marker.profile}, worker ${i + 1}/${markers.length})]\nExit code ${workerResult.exitCode}: ${workerResult.stderr}\n[/WORKER ERROR]`,
          );
        }
      } else {
        const errorMsg =
          outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        results.push(
          `[WORKER ERROR (${marker.profile}, worker ${i + 1}/${markers.length})]\n${errorMsg}\n[/WORKER ERROR]`,
        );
      }
    }

    return results.join('\n\n');
  }

  /**
   * Spawn a single worker from a parsed SPAWN marker.
   * Resolves the profile to tools via AgentRunner's manifest resolution.
   */
  private async spawnWorker(
    marker: ParsedSpawnMarker,
    index: number,
    customProfiles?: Record<string, ToolProfile>,
  ): Promise<AgentResult> {
    const { profile, body } = marker;

    logger.info(
      {
        workerIndex: index,
        profile,
        model: body.model,
        maxTurns: body.maxTurns,
        promptLength: body.prompt.length,
      },
      'Spawning worker from SPAWN marker',
    );

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

    return this.agentRunner.spawn(spawnOpts);
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
