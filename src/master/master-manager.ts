import { DotFolderManager } from './dotfolder-manager.js';
import { generateReExplorationPrompt } from './exploration-prompt.js';
import { ExplorationCoordinator } from './exploration-coordinator.js';
import {
  executeClaudeCode,
  streamClaudeCode,
} from '../providers/claude-code/claude-code-executor.js';
import { DelegationCoordinator } from './delegation.js';
import type {
  MasterState,
  ExplorationSummary,
  TaskRecord,
  AgentsRegistry,
  WorkspaceMap,
} from '../types/master.js';
import type { DiscoveredTool } from '../types/discovery.js';
import type { InboundMessage } from '../types/message.js';
import { createLogger } from '../core/logger.js';
import { randomUUID } from 'node:crypto';

const logger = createLogger('master-manager');

const DEFAULT_TIMEOUT = 600_000; // 10 minutes for exploration
const DEFAULT_MESSAGE_TIMEOUT = 60_000; // 1 minute for message processing

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

  private state: MasterState = 'idle';
  private explorationSummary: ExplorationSummary | null = null;
  private explorationCoordinator: ExplorationCoordinator | null = null;
  private sessionMap: Map<string, { sessionId: string; createdAt: number }> = new Map(); // sender → session info
  private sessionTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly sessionTTL = 30 * 60 * 1000; // 30 minutes

  constructor(options: MasterManagerOptions) {
    this.workspacePath = options.workspacePath;
    this.masterTool = options.masterTool;
    this.discoveredTools = options.discoveredTools;
    this.explorationTimeout = options.explorationTimeout ?? DEFAULT_TIMEOUT;
    this.messageTimeout = options.messageTimeout ?? DEFAULT_MESSAGE_TIMEOUT;
    this.skipAutoExploration = options.skipAutoExploration ?? false;
    this.dotFolder = new DotFolderManager(this.workspacePath);
    this.delegationCoordinator = new DelegationCoordinator();

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
   * Start the Master AI.
   * Resilient startup logic:
   * - If .openbridge/ doesn't exist → trigger fresh exploration
   * - If incomplete exploration detected → resume from checkpoint
   * - If map missing or corrupted → re-explore
   * - If valid map exists → skip exploration, enter ready state
   */
  public async start(): Promise<void> {
    if (this.state !== 'idle') {
      logger.warn({ currentState: this.state }, 'MasterManager already started');
      return;
    }

    logger.info('Starting MasterManager (resilient startup)');

    // Check if .openbridge folder exists
    const folderExists = await this.dotFolder.exists();

    if (!folderExists) {
      // Scenario 1: No .openbridge folder — trigger fresh exploration
      if (!this.skipAutoExploration) {
        logger.info('.openbridge folder does not exist, starting fresh exploration');
        await this.explore();
      } else {
        logger.info('Auto-exploration disabled, entering ready state');
        this.state = 'ready';
      }
      return;
    }

    // Folder exists — perform resilience checks
    logger.info('.openbridge folder exists, performing resilience checks');

    // Check for incomplete or failed exploration
    const explorationState = await this.dotFolder.readExplorationState();
    if (
      explorationState &&
      (explorationState.status === 'in_progress' || explorationState.status === 'failed')
    ) {
      // Scenario 2: Incomplete/failed exploration detected — resume/retry from checkpoint
      const statusLabel = explorationState.status === 'in_progress' ? 'Incomplete' : 'Failed';
      logger.info(
        { currentPhase: explorationState.currentPhase, status: explorationState.status },
        `${statusLabel} exploration detected, ${explorationState.status === 'failed' ? 'retrying' : 'resuming'} from checkpoint`,
      );
      if (!this.skipAutoExploration) {
        await this.explore();
      } else {
        logger.warn(
          `Auto-exploration disabled, but ${statusLabel.toLowerCase()} exploration exists. Entering ready state anyway.`,
        );
        this.state = 'ready';
      }
      return;
    }

    // Check if workspace map exists and is valid
    const map = await this.dotFolder.readMap();

    if (!map) {
      // Scenario 3: Folder exists but map missing or corrupted — re-explore
      logger.warn('.openbridge folder exists but workspace-map.json is missing or corrupted');
      if (!this.skipAutoExploration) {
        logger.info('Re-exploring workspace to regenerate map');
        await this.explore();
      } else {
        logger.warn('Auto-exploration disabled, entering ready state without valid map');
        this.state = 'ready';
      }
      return;
    }

    // Scenario 4: Valid map exists — skip exploration, enter ready state
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
  }

  /**
   * Autonomously explore the workspace and create .openbridge/ folder.
   * This is the Master AI's initialization step.
   *
   * Uses the incremental multi-pass exploration strategy via ExplorationCoordinator.
   */
  public async explore(): Promise<void> {
    if (this.state === 'exploring') {
      logger.warn('Exploration already in progress');
      return;
    }

    this.state = 'exploring';

    logger.info(
      { workspacePath: this.workspacePath },
      'Starting incremental workspace exploration',
    );

    try {
      // Initialize .openbridge folder
      await this.dotFolder.initialize();

      // Log exploration start
      const startedAt = new Date().toISOString();
      await this.dotFolder.appendLog({
        timestamp: startedAt,
        level: 'info',
        message: 'Incremental workspace exploration started',
        data: { masterTool: this.masterTool.name, version: this.masterTool.version },
      });

      // Delegate to ExplorationCoordinator for incremental multi-pass exploration
      this.explorationCoordinator = new ExplorationCoordinator({
        workspacePath: this.workspacePath,
        masterTool: this.masterTool,
        discoveredTools: this.discoveredTools,
      });

      this.explorationSummary = await this.explorationCoordinator.explore();

      this.state = 'ready';

      logger.info(
        {
          projectType: this.explorationSummary.projectType,
          frameworks: this.explorationSummary.frameworks,
          directoriesExplored: this.explorationSummary.directoriesExplored,
          status: this.explorationSummary.status,
        },
        'Incremental workspace exploration completed',
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
        message: 'Incremental workspace exploration failed',
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
   * Re-explore the workspace (e.g., after significant changes)
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

      // Generate re-exploration prompt
      const prompt = generateReExplorationPrompt(this.workspacePath);

      // Execute re-exploration (skip permissions — runs in background)
      const result = await executeClaudeCode({
        prompt,
        workspacePath: this.workspacePath,
        timeout: this.explorationTimeout,
        skipPermissions: true,
      });

      if (result.exitCode !== 0) {
        throw new Error(
          `Re-exploration failed with exit code ${result.exitCode}: ${result.stderr}`,
        );
      }

      // Update exploration summary
      const map = await this.dotFolder.readMap();
      if (map) {
        this.explorationSummary = {
          ...this.explorationSummary!,
          completedAt: new Date().toISOString(),
          projectType: map.projectType,
          frameworks: map.frameworks,
        };
      }

      const completedAt = new Date().toISOString();

      // Log re-exploration completion
      await this.dotFolder.appendLog({
        timestamp: completedAt,
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
   * Maintains session continuity across messages using --resume flag.
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

      // Get or create session ID for this sender
      const { sessionId, isNew } = this.getOrCreateSession(message.sender);

      // Execute message through Claude Code with session continuity (skip permissions — non-interactive)
      // Use --session-id for new sessions, --resume for existing sessions
      let result = await executeClaudeCode({
        prompt: message.content,
        workspacePath: this.workspacePath,
        timeout: this.messageTimeout,
        ...(isNew ? { sessionId } : { resumeSessionId: sessionId }),
        skipPermissions: true,
      });

      if (result.exitCode !== 0) {
        throw new Error(`Message processing failed: ${result.stderr}`);
      }

      let response = result.stdout.trim() || 'No response from AI';

      // Check for delegation markers in the response
      const delegations = this.parseDelegationMarkers(response);
      if (delegations && delegations.length > 0) {
        logger.info({ delegationCount: delegations.length }, 'Delegation markers detected');

        // Update task status to delegated
        task.status = 'delegated';
        await this.dotFolder.recordTask(task);

        // Handle delegations
        const delegationResults = await this.handleDelegations(delegations, message);

        // Feed delegation results back to Master session
        const feedbackPrompt = `The following delegation results are available:\n\n${delegationResults}\n\nPlease synthesize these results and provide a final response to the user.`;

        this.state = 'processing';
        // Always use resume here since we already started a session above
        result = await executeClaudeCode({
          prompt: feedbackPrompt,
          workspacePath: this.workspacePath,
          timeout: this.messageTimeout,
          resumeSessionId: sessionId,
          skipPermissions: true,
        });

        if (result.exitCode !== 0) {
          throw new Error(`Delegation feedback processing failed: ${result.stderr}`);
        }

        response = result.stdout.trim() || delegationResults;
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
   * Maintains session continuity across messages using --resume flag.
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

      // Get or create session ID for this sender
      const { sessionId, isNew } = this.getOrCreateSession(message.sender);

      // Stream message through Claude Code with session continuity
      // Use --session-id for new sessions, --resume for existing sessions
      let fullResponse = '';
      const stream = streamClaudeCode({
        prompt: message.content,
        workspacePath: this.workspacePath,
        timeout: this.messageTimeout,
        ...(isNew ? { sessionId } : { resumeSessionId: sessionId }),
      });

      for await (const chunk of stream) {
        fullResponse += chunk;
        yield chunk;
      }

      // Check for delegation markers in the response
      const delegations = this.parseDelegationMarkers(fullResponse);
      if (delegations && delegations.length > 0) {
        logger.info(
          { delegationCount: delegations.length },
          'Delegation markers detected in stream',
        );

        // Update task status to delegated
        task.status = 'delegated';
        await this.dotFolder.recordTask(task);

        // Handle delegations
        const delegationResults = await this.handleDelegations(delegations, message);

        // Feed delegation results back to Master session and stream the final response
        const feedbackPrompt = `The following delegation results are available:\n\n${delegationResults}\n\nPlease synthesize these results and provide a final response to the user.`;

        this.state = 'processing';
        // Always use resume here since we already started a session above
        const feedbackStream = streamClaudeCode({
          prompt: feedbackPrompt,
          workspacePath: this.workspacePath,
          timeout: this.messageTimeout,
          resumeSessionId: sessionId,
        });

        let finalResponse = '';
        for await (const chunk of feedbackStream) {
          finalResponse += chunk;
          yield chunk;
        }

        fullResponse = finalResponse.trim() || delegationResults;
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

    // Show detailed exploration progress if exploration is in progress
    // Try to get progress from coordinator or directly from state file
    let progress = null;
    if (this.explorationCoordinator) {
      progress = await this.explorationCoordinator.getProgress();
    } else if (this.state === 'exploring') {
      // Exploration in progress but coordinator not available (shouldn't happen but handle gracefully)
      const tempCoordinator = new ExplorationCoordinator({
        workspacePath: this.workspacePath,
        masterTool: this.masterTool,
        discoveredTools: this.discoveredTools,
      });
      progress = await tempCoordinator.getProgress();
    }

    if (this.state === 'exploring' && progress) {
      status += `\n**Exploration Progress: ${progress.completionPercent}%**\n`;
      status += `Current Phase: ${progress.currentPhase}\n\n`;

      // Show phase statuses
      status += `Phases:\n`;
      const phaseLabels: Record<string, string> = {
        structure_scan: 'Structure Scan',
        classification: 'Classification',
        directory_dives: 'Directory Dives',
        assembly: 'Assembly',
        finalization: 'Finalization',
      };
      for (const [phase, label] of Object.entries(phaseLabels)) {
        const phaseStatus = progress.phases[phase];
        const icon =
          phaseStatus === 'completed'
            ? '✅'
            : phaseStatus === 'in_progress'
              ? '🔄'
              : phaseStatus === 'failed'
                ? '❌'
                : '⏳';
        status += `  ${icon} ${label}: ${phaseStatus}\n`;
      }

      // Show directory dive details if in that phase
      if (progress.currentPhase === 'directory_dives' && progress.directoriesTotal > 0) {
        status += `\nDirectory Dives: ${progress.directoriesCompleted}/${progress.directoriesTotal} completed`;
        if (progress.directoriesFailed > 0) {
          status += ` (${progress.directoriesFailed} failed)`;
        }
        status += `\n`;
      }

      // Show performance metrics
      status += `\nAI Calls: ${progress.totalCalls}\n`;
      const totalTimeSeconds = Math.floor(progress.totalAITimeMs / 1000);
      status += `Total AI Time: ${totalTimeSeconds}s\n`;

      // Estimate time to completion
      if (progress.completionPercent > 0 && progress.completionPercent < 100) {
        const estimatedTotalTimeMs = (progress.totalAITimeMs / progress.completionPercent) * 100;
        const remainingTimeMs = estimatedTotalTimeMs - progress.totalAITimeMs;
        const remainingMinutes = Math.ceil(remainingTimeMs / 60000);
        status += `Estimated Time Remaining: ~${remainingMinutes} minute(s)\n`;
      }
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

    status += `\nActive Sessions: ${this.sessionMap.size}\n`;

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

    // Clear all session timeouts
    for (const timeout of this.sessionTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.sessionTimeouts.clear();
    this.sessionMap.clear();

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
   * Get or create a session ID for a sender.
   * Sessions are used to maintain conversation continuity.
   * Returns { sessionId, isNew } where isNew indicates if this is a fresh session.
   */
  private getOrCreateSession(sender: string): { sessionId: string; isNew: boolean } {
    // Clear existing timeout for this sender
    const existingTimeout = this.sessionTimeouts.get(sender);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    const now = Date.now();
    const existing = this.sessionMap.get(sender);
    let sessionId: string;
    let isNew: boolean;

    // Check if session exists and hasn't expired
    if (existing && now - existing.createdAt < this.sessionTTL) {
      sessionId = existing.sessionId;
      isNew = false;
      logger.debug({ sender, sessionId }, 'Resuming existing session');
    } else {
      if (existing) {
        logger.debug({ sender, oldSessionId: existing.sessionId }, 'Session expired, creating new');
      }
      sessionId = randomUUID();
      this.sessionMap.set(sender, { sessionId, createdAt: now });
      isNew = true;
      logger.debug({ sender, sessionId }, 'Created new session');
    }

    // Set new timeout to clear session after TTL
    const timeout = setTimeout(() => {
      this.sessionMap.delete(sender);
      this.sessionTimeouts.delete(sender);
      logger.debug({ sender, sessionId }, 'Session expired');
    }, this.sessionTTL);

    this.sessionTimeouts.set(sender, timeout);

    return { sessionId, isNew };
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
