import { DotFolderManager } from './dotfolder-manager.js';
import { generateExplorationPrompt, generateReExplorationPrompt } from './exploration-prompt.js';
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
  private sessionMap: Map<string, string> = new Map(); // sender → sessionId
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
   * If auto-exploration is enabled and .openbridge/ doesn't exist, triggers autonomous exploration.
   */
  public async start(): Promise<void> {
    if (this.state !== 'idle') {
      logger.warn({ currentState: this.state }, 'MasterManager already started');
      return;
    }

    logger.info('Starting MasterManager');

    // Check if .openbridge folder exists
    const folderExists = await this.dotFolder.exists();

    if (!folderExists && !this.skipAutoExploration) {
      // No .openbridge folder — trigger exploration
      logger.info('.openbridge folder does not exist, starting autonomous exploration');
      await this.explore();
    } else if (folderExists) {
      // Folder exists — load existing workspace map and set state to ready
      logger.info('.openbridge folder exists, loading workspace map');

      const map = await this.dotFolder.readMap();
      if (map) {
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
      } else {
        logger.warn('Workspace map file exists but could not be parsed, entering ready state');
        this.state = 'ready';
      }
    } else {
      // Skip auto-exploration — enter ready state
      logger.info('Auto-exploration disabled, entering ready state');
      this.state = 'ready';
    }
  }

  /**
   * Autonomously explore the workspace and create .openbridge/ folder.
   * This is the Master AI's initialization step.
   */
  public async explore(): Promise<void> {
    if (this.state === 'exploring') {
      logger.warn('Exploration already in progress');
      return;
    }

    this.state = 'exploring';

    const startedAt = new Date().toISOString();
    this.explorationSummary = {
      startedAt,
      status: 'in_progress',
      filesScanned: 0,
      directoriesExplored: 0,
      frameworks: [],
      insights: [],
      gitInitialized: false,
    };

    logger.info({ workspacePath: this.workspacePath }, 'Starting workspace exploration');

    try {
      // Initialize .openbridge folder
      await this.dotFolder.initialize();

      // Log exploration start
      await this.dotFolder.appendLog({
        timestamp: startedAt,
        level: 'info',
        message: 'Autonomous workspace exploration started',
        data: { masterTool: this.masterTool.name, version: this.masterTool.version },
      });

      // Generate exploration prompt
      const prompt = generateExplorationPrompt(this.workspacePath);

      // Execute exploration (skip permissions — exploration runs in background without user interaction)
      const result = await executeClaudeCode({
        prompt,
        workspacePath: this.workspacePath,
        timeout: this.explorationTimeout,
        skipPermissions: true,
      });

      if (result.exitCode !== 0) {
        throw new Error(`Exploration failed with exit code ${result.exitCode}: ${result.stderr}`);
      }

      // Check if workspace map was created
      const map = await this.dotFolder.readMap();
      if (!map) {
        throw new Error('Exploration completed but workspace-map.json was not created');
      }

      // Check if agents.json exists, if not create it
      let agentsRegistry = await this.dotFolder.readAgents();
      if (!agentsRegistry) {
        agentsRegistry = this.createAgentsRegistry();
        await this.dotFolder.writeAgents(agentsRegistry);
        await this.dotFolder.commitChanges('Add agents.json');
      }

      const completedAt = new Date().toISOString();

      this.explorationSummary = {
        startedAt,
        completedAt,
        status: 'completed',
        filesScanned: 0,
        directoriesExplored: 0,
        projectType: map.projectType,
        frameworks: map.frameworks,
        insights: [],
        mapPath: this.dotFolder.getMapPath(),
        gitInitialized: true,
      };

      // Log exploration completion
      await this.dotFolder.appendLog({
        timestamp: completedAt,
        level: 'info',
        message: 'Autonomous workspace exploration completed',
        data: {
          projectType: map.projectType,
          frameworks: map.frameworks,
          summary: map.summary,
        },
      });

      this.state = 'ready';

      logger.info(
        {
          projectType: map.projectType,
          frameworks: map.frameworks,
          durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
        },
        'Workspace exploration completed',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.explorationSummary = {
        ...(this.explorationSummary ?? {}),
        startedAt: this.explorationSummary?.startedAt ?? startedAt,
        completedAt: new Date().toISOString(),
        status: 'failed',
        filesScanned: this.explorationSummary?.filesScanned ?? 0,
        directoriesExplored: this.explorationSummary?.directoriesExplored ?? 0,
        frameworks: this.explorationSummary?.frameworks ?? [],
        insights: this.explorationSummary?.insights ?? [],
        gitInitialized: this.explorationSummary?.gitInitialized ?? false,
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

      logger.error({ error, workspacePath: this.workspacePath }, 'Workspace exploration failed');

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
      logger.error({ error }, 'Workspace re-exploration failed');
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
      const sessionId = this.getOrCreateSession(message.sender);

      // Execute message through Claude Code with session continuity (skip permissions — non-interactive)
      let result = await executeClaudeCode({
        prompt: message.content,
        workspacePath: this.workspacePath,
        timeout: this.messageTimeout,
        resumeSessionId: sessionId,
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

      logger.error({ error, taskId, sender: message.sender }, 'Message processing failed');

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
      const sessionId = this.getOrCreateSession(message.sender);

      // Stream message through Claude Code with session continuity
      let fullResponse = '';
      const stream = streamClaudeCode({
        prompt: message.content,
        workspacePath: this.workspacePath,
        timeout: this.messageTimeout,
        resumeSessionId: sessionId,
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

      logger.error({ error, taskId, sender: message.sender }, 'Message streaming failed');

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

    if (this.explorationSummary) {
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
      logger.error({ error }, 'Failed to log shutdown');
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
   */
  private getOrCreateSession(sender: string): string {
    // Clear existing timeout for this sender
    const existingTimeout = this.sessionTimeouts.get(sender);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }

    // Get or create session ID
    let sessionId = this.sessionMap.get(sender);
    if (!sessionId) {
      sessionId = randomUUID();
      this.sessionMap.set(sender, sessionId);
      logger.debug({ sender, sessionId }, 'Created new session');
    }

    // Set new timeout to clear session after TTL
    const timeout = setTimeout(() => {
      this.sessionMap.delete(sender);
      this.sessionTimeouts.delete(sender);
      logger.debug({ sender, sessionId }, 'Session expired');
    }, this.sessionTTL);

    this.sessionTimeouts.set(sender, timeout);

    return sessionId;
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
