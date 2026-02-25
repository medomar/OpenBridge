import { randomUUID } from 'node:crypto';
import { createLogger } from '../core/logger.js';
import { AgentRunner, TOOLS_CODE_EDIT, DEFAULT_MAX_TURNS_TASK } from '../core/agent-runner.js';
import type { DiscoveredTool } from '../types/discovery.js';
import type { TaskRecord } from '../types/master.js';

const logger = createLogger('delegation');

const DEFAULT_DELEGATION_TIMEOUT = 300_000; // 5 minutes for delegated tasks

/**
 * Represents an active delegation to a non-master AI tool
 */
export interface ActiveDelegation {
  /** Unique delegation ID */
  id: string;
  /** Task being delegated */
  task: TaskRecord;
  /** AI tool handling this delegation */
  tool: DiscoveredTool;
  /** When this delegation started */
  startedAt: string;
  /** Timeout handle for this delegation */
  timeoutHandle: NodeJS.Timeout;
  /** Promise that resolves when delegation completes */
  promise: Promise<DelegationResult>;
}

/**
 * Result of a delegation operation
 */
export interface DelegationResult {
  /** Whether the delegation succeeded */
  success: boolean;
  /** Response from the delegated AI tool */
  response?: string;
  /** Error message if delegation failed */
  error?: string;
  /** Exit code from the AI tool process */
  exitCode: number;
  /** Duration of the delegation in milliseconds */
  durationMs: number;
}

/**
 * Options for delegating a task
 */
export interface DelegateOptions {
  /** Task description/prompt to send to the AI tool */
  prompt: string;
  /** Workspace path for the AI tool to operate in */
  workspacePath: string;
  /** AI tool to delegate to */
  tool: DiscoveredTool;
  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number;
  /** Task ID for tracking (auto-generated if not provided) */
  taskId?: string;
  /** Sender identifier */
  sender: string;
  /** Original user message */
  userMessage: string;
}

/**
 * Coordinates task delegation to non-master AI tools.
 *
 * The DelegationCoordinator manages:
 * - Active delegations to specialist AI tools
 * - Timeout handling for long-running delegations
 * - Result tracking and error handling
 * - Concurrent delegation limits
 */
export class DelegationCoordinator {
  private activeDelegations: Map<string, ActiveDelegation> = new Map();
  private readonly maxConcurrentDelegations: number;
  private readonly defaultTimeout: number;
  private readonly agentRunner: AgentRunner;

  constructor(options?: { maxConcurrentDelegations?: number; defaultTimeout?: number }) {
    this.maxConcurrentDelegations = options?.maxConcurrentDelegations ?? 3;
    this.defaultTimeout = options?.defaultTimeout ?? DEFAULT_DELEGATION_TIMEOUT;
    this.agentRunner = new AgentRunner();

    logger.info(
      {
        maxConcurrent: this.maxConcurrentDelegations,
        defaultTimeout: this.defaultTimeout,
      },
      'DelegationCoordinator initialized',
    );
  }

  /**
   * Delegate a task to a specialist AI tool.
   *
   * Returns a promise that resolves when the delegation completes.
   * The delegation is tracked and can be queried or cancelled.
   */
  public async delegate(options: DelegateOptions): Promise<DelegationResult> {
    // Check concurrent delegation limit
    if (this.activeDelegations.size >= this.maxConcurrentDelegations) {
      const error = `Maximum concurrent delegations (${this.maxConcurrentDelegations}) reached`;
      logger.warn({ active: this.activeDelegations.size }, error);
      return {
        success: false,
        error,
        exitCode: 1,
        durationMs: 0,
      };
    }

    const delegationId = randomUUID();
    const taskId = options.taskId ?? randomUUID();
    const timeout = options.timeout ?? this.defaultTimeout;
    const startedAt = new Date().toISOString();

    // Create task record
    const task: TaskRecord = {
      id: taskId,
      userMessage: options.userMessage,
      sender: options.sender,
      description: options.prompt,
      status: 'delegated',
      handledBy: 'master',
      delegatedTo: options.tool.name,
      createdAt: startedAt,
      startedAt,
      metadata: {
        delegationId,
        toolPath: options.tool.path,
        toolVersion: options.tool.version,
      },
    };

    logger.info(
      {
        delegationId,
        taskId,
        tool: options.tool.name,
        prompt: options.prompt.slice(0, 100),
      },
      'Starting delegation',
    );

    // Create delegation promise
    const promise = this.executeDelegation(options, task, delegationId, startedAt);

    // Create timeout handler
    const timeoutHandle = setTimeout(() => {
      this.handleTimeout(delegationId, taskId, options.tool.name);
    }, timeout);

    // Track active delegation
    const delegation: ActiveDelegation = {
      id: delegationId,
      task,
      tool: options.tool,
      startedAt,
      timeoutHandle,
      promise,
    };

    this.activeDelegations.set(delegationId, delegation);

    // Wait for completion and clean up
    try {
      const result = await promise;
      return result;
    } finally {
      this.cleanupDelegation(delegationId);
    }
  }

  /**
   * Get information about an active delegation
   */
  public getDelegation(delegationId: string): ActiveDelegation | undefined {
    return this.activeDelegations.get(delegationId);
  }

  /**
   * Get all active delegations
   */
  public getActiveDelegations(): ActiveDelegation[] {
    return Array.from(this.activeDelegations.values());
  }

  /**
   * Get the number of active delegations
   */
  public getActiveDelegationCount(): number {
    return this.activeDelegations.size;
  }

  /**
   * Cancel an active delegation
   */
  public cancelDelegation(delegationId: string): boolean {
    const delegation = this.activeDelegations.get(delegationId);
    if (!delegation) {
      return false;
    }

    logger.info({ delegationId, taskId: delegation.task.id }, 'Cancelling delegation');

    // Clear timeout
    clearTimeout(delegation.timeoutHandle);

    // Remove from active delegations
    this.activeDelegations.delete(delegationId);

    return true;
  }

  /**
   * Shutdown the coordinator, cancelling all active delegations
   */
  public shutdown(): void {
    logger.info(
      { activeDelegations: this.activeDelegations.size },
      'Shutting down DelegationCoordinator',
    );

    // Cancel all active delegations
    for (const delegationId of this.activeDelegations.keys()) {
      this.cancelDelegation(delegationId);
    }

    this.activeDelegations.clear();
  }

  /**
   * Execute the delegation by calling the AI tool
   */
  private async executeDelegation(
    options: DelegateOptions,
    task: TaskRecord,
    delegationId: string,
    startedAt: string,
  ): Promise<DelegationResult> {
    try {
      const result = await this.agentRunner.spawn({
        prompt: options.prompt,
        workspacePath: options.workspacePath,
        timeout: options.timeout ?? this.defaultTimeout,
        allowedTools: [...TOOLS_CODE_EDIT],
        maxTurns: DEFAULT_MAX_TURNS_TASK,
        retries: 0,
      });

      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      if (result.exitCode === 0) {
        logger.info(
          {
            delegationId,
            taskId: task.id,
            tool: options.tool.name,
            durationMs,
          },
          'Delegation completed successfully',
        );

        return {
          success: true,
          response: result.stdout.trim(),
          exitCode: result.exitCode,
          durationMs,
        };
      } else {
        logger.warn(
          {
            delegationId,
            taskId: task.id,
            tool: options.tool.name,
            exitCode: result.exitCode,
            stderr: result.stderr,
          },
          'Delegation completed with errors',
        );

        return {
          success: false,
          error: result.stderr || 'Unknown error',
          exitCode: result.exitCode,
          durationMs,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const completedAt = new Date().toISOString();
      const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

      logger.error(
        {
          delegationId,
          taskId: task.id,
          tool: options.tool.name,
          error: errorMessage,
        },
        'Delegation failed with exception',
      );

      return {
        success: false,
        error: errorMessage,
        exitCode: 1,
        durationMs,
      };
    }
  }

  /**
   * Handle delegation timeout
   */
  private handleTimeout(delegationId: string, taskId: string, toolName: string): void {
    const delegation = this.activeDelegations.get(delegationId);
    if (!delegation) {
      return;
    }

    logger.warn(
      {
        delegationId,
        taskId,
        tool: toolName,
        timeout: this.defaultTimeout,
      },
      'Delegation timed out',
    );

    // Note: The timeout in the AgentRunner spawn call will handle actual process termination
    // This is just for tracking and cleanup
  }

  /**
   * Clean up a delegation after completion
   */
  private cleanupDelegation(delegationId: string): void {
    const delegation = this.activeDelegations.get(delegationId);
    if (!delegation) {
      return;
    }

    // Clear timeout
    clearTimeout(delegation.timeoutHandle);

    // Remove from active delegations
    this.activeDelegations.delete(delegationId);

    logger.debug({ delegationId, taskId: delegation.task.id }, 'Delegation cleaned up');
  }
}
