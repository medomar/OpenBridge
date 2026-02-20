import { randomUUID } from 'node:crypto';
import type { AIProvider, ProviderResult } from '../types/provider.js';
import type { InboundMessage } from '../types/message.js';
import type {
  Agent,
  TaskAgent,
  TaskItem,
  AgentStatus,
  ScriptEvent,
  ScriptEventType,
  ScriptEventListener,
} from '../types/agent.js';
import { createLogger } from './logger.js';

const logger = createLogger('orchestrator');

// ── Types ────────────────────────────────────────────────────────

/** Options for creating a task agent */
export interface CreateTaskAgentOptions {
  /** Human-readable agent name */
  name: string;
  /** Task list for this agent */
  tasks: Array<{ id: string; description: string }>;
  /** Workspace ID the agent operates in */
  workspaceId: string;
  /** Provider to use for AI processing */
  providerId: string;
  /** Parent agent ID */
  parentAgentId: string;
  /** Task ID in the parent's task list that this agent fulfills */
  parentTaskId: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Configuration for the Agent Orchestrator */
export interface OrchestratorConfig {
  /** Max concurrent task agents (default: 3) */
  maxConcurrentAgents?: number;
  /** Timeout for individual task execution in ms (default: 120000) */
  taskTimeoutMs?: number;
  /** Whether to enable multi-agent mode (default: true when available) */
  enableMultiAgent?: boolean;
}

/** Result of orchestrator processing */
export interface OrchestratorResult {
  /** The provider result to send back */
  result: ProviderResult;
  /** The main agent that handled the request */
  agent: Agent;
}

// ── Defaults ─────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENT = 3;
const DEFAULT_TASK_TIMEOUT_MS = 120_000;

// ── Agent Orchestrator ───────────────────────────────────────────

export class AgentOrchestrator {
  private readonly providers = new Map<string, AIProvider>();
  private readonly agents = new Map<string, Agent>();
  private readonly taskAgents = new Map<string, TaskAgent>();
  private readonly listeners: Map<ScriptEventType, ScriptEventListener[]> = new Map();
  private readonly maxConcurrentAgents: number;
  private readonly taskTimeoutMs: number;
  private readonly enableMultiAgent: boolean;
  private defaultProviderId: string;

  constructor(defaultProviderId: string, config: OrchestratorConfig = {}) {
    this.defaultProviderId = defaultProviderId;
    this.maxConcurrentAgents = config.maxConcurrentAgents ?? DEFAULT_MAX_CONCURRENT;
    this.taskTimeoutMs = config.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;
    this.enableMultiAgent = config.enableMultiAgent ?? true;

    logger.info(
      {
        defaultProviderId,
        maxConcurrentAgents: this.maxConcurrentAgents,
        enableMultiAgent: this.enableMultiAgent,
      },
      'Agent orchestrator initialized',
    );
  }

  /** Register an AI provider */
  addProvider(provider: AIProvider): void {
    this.providers.set(provider.name, provider);
  }

  /** Process an inbound message — decides whether to handle directly or delegate to agents */
  async process(message: InboundMessage): Promise<OrchestratorResult> {
    const workspaceId = (message.metadata?.['workspace'] as string) ?? 'default';
    const providerId = this.defaultProviderId;
    const provider = this.providers.get(providerId);

    if (!provider) {
      throw new Error(`Provider "${providerId}" not registered with orchestrator`);
    }

    // Create the main agent for this request
    const mainAgent = this.createAgent({
      name: `main-${message.sender}-${Date.now()}`,
      role: 'main',
      workspaceId,
      providerId,
      metadata: {
        sender: message.sender,
        messageId: message.id,
        workspaceMap: message.metadata?.['workspaceMap'],
      },
    });

    this.emitEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'agent_started',
      agentId: mainAgent.id,
      payload: {
        agentName: mainAgent.name,
        taskCount: 0,
      },
    });

    logger.info(
      { agentId: mainAgent.id, sender: message.sender, workspaceId },
      'Main agent created for request',
    );

    try {
      // Process the message through the provider
      let result: ProviderResult;
      if (provider.streamMessage) {
        result = await this.consumeStream(provider.streamMessage(message));
      } else {
        result = await provider.processMessage(message);
      }

      // Update agent status
      this.updateAgentStatus(mainAgent.id, 'completed');

      this.emitEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'agent_done',
        agentId: mainAgent.id,
        payload: {
          completedTasks: mainAgent.tasks.filter((t) => t.status === 'completed').length,
          totalTasks: mainAgent.tasks.length,
        },
      });

      logger.info({ agentId: mainAgent.id }, 'Main agent completed');

      return { result, agent: this.agents.get(mainAgent.id)! };
    } catch (error) {
      this.updateAgentStatus(mainAgent.id, 'failed');

      this.emitEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'agent_failed',
        agentId: mainAgent.id,
        payload: {
          error: error instanceof Error ? error.message : String(error),
        },
      });

      logger.error({ agentId: mainAgent.id, error }, 'Main agent failed');
      throw error;
    }
  }

  /** Create a task agent to handle a subtask */
  createTaskAgent(options: CreateTaskAgentOptions): TaskAgent {
    const now = new Date().toISOString();
    const tasks: TaskItem[] = options.tasks.map((t) => ({
      id: t.id,
      description: t.description,
      status: 'pending' as const,
    }));

    const agent: TaskAgent = {
      id: randomUUID(),
      name: options.name,
      role: 'task',
      status: 'idle',
      workspaceId: options.workspaceId,
      providerId: options.providerId,
      tasks,
      createdAt: now,
      updatedAt: now,
      metadata: options.metadata ?? {},
      parentAgentId: options.parentAgentId,
      parentTaskId: options.parentTaskId,
    };

    this.taskAgents.set(agent.id, agent);
    this.agents.set(agent.id, agent);

    this.emitEvent({
      id: randomUUID(),
      timestamp: now,
      type: 'agent_started',
      agentId: agent.id,
      payload: {
        agentName: agent.name,
        taskCount: tasks.length,
      },
    });

    logger.info(
      { agentId: agent.id, parentAgentId: options.parentAgentId, taskCount: tasks.length },
      'Task agent created',
    );

    return agent;
  }

  /** Execute a task agent's task list sequentially */
  async executeTaskAgent(agentId: string): Promise<ProviderResult[]> {
    const agent = this.taskAgents.get(agentId);
    if (!agent) {
      throw new Error(`Task agent "${agentId}" not found`);
    }

    const provider = this.providers.get(agent.providerId);
    if (!provider) {
      throw new Error(`Provider "${agent.providerId}" not registered`);
    }

    this.updateAgentStatus(agentId, 'running');
    const results: ProviderResult[] = [];

    for (const task of agent.tasks) {
      if (task.status === 'completed' || task.status === 'skipped') continue;

      this.updateTaskStatus(agentId, task.id, 'in_progress');

      this.emitEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'task_started',
        agentId,
        payload: { taskId: task.id, description: task.description },
      });

      try {
        const taskMessage: InboundMessage = {
          id: `${agentId}-${task.id}`,
          source: 'orchestrator',
          sender: (agent.metadata['sender'] as string) ?? 'system',
          rawContent: task.description,
          content: task.description,
          timestamp: new Date(),
          metadata: {
            agentId,
            taskId: task.id,
            workspaceMap: agent.metadata['workspaceMap'],
          },
        };

        const result = await this.executeWithTimeout(provider, taskMessage);
        results.push(result);

        this.updateTaskStatus(agentId, task.id, 'completed', result.content);

        this.emitEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'task_complete',
          agentId,
          payload: { taskId: task.id, result: result.content.slice(0, 500) },
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.updateTaskStatus(agentId, task.id, 'failed', errorMsg);

        this.emitEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'task_failed',
          agentId,
          payload: { taskId: task.id, error: errorMsg, retryable: false },
        });

        logger.error({ agentId, taskId: task.id, error }, 'Task execution failed');
      }
    }

    // Determine final agent status
    const failedTasks = agent.tasks.filter((t) => t.status === 'failed');
    const completedTasks = agent.tasks.filter((t) => t.status === 'completed');

    if (failedTasks.length === agent.tasks.length) {
      this.updateAgentStatus(agentId, 'failed');
      this.emitEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'agent_failed',
        agentId,
        payload: {
          error: `All ${failedTasks.length} tasks failed`,
          failedTaskId: failedTasks[0]?.id,
        },
      });
    } else {
      this.updateAgentStatus(agentId, 'completed');
      this.emitEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'agent_done',
        agentId,
        payload: {
          completedTasks: completedTasks.length,
          totalTasks: agent.tasks.length,
        },
      });
    }

    return results;
  }

  // ── Agent Lifecycle ─────────────────────────────────────────────

  /** Get an agent by ID */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /** Get all active agents (not completed/failed/cancelled) */
  getActiveAgents(): Agent[] {
    return Array.from(this.agents.values()).filter(
      (a) => a.status === 'idle' || a.status === 'running' || a.status === 'waiting',
    );
  }

  /** Get all task agents for a given parent */
  getTaskAgentsForParent(parentAgentId: string): TaskAgent[] {
    return Array.from(this.taskAgents.values()).filter((a) => a.parentAgentId === parentAgentId);
  }

  /** Cancel an agent and all its child task agents */
  cancelAgent(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    this.updateAgentStatus(agentId, 'cancelled');

    // Cancel all child task agents
    for (const child of this.getTaskAgentsForParent(agentId)) {
      if (child.status === 'idle' || child.status === 'running' || child.status === 'waiting') {
        this.updateAgentStatus(child.id, 'cancelled');
      }
    }

    logger.info({ agentId }, 'Agent and children cancelled');
  }

  /** Remove completed/failed agents from tracking (cleanup) */
  pruneFinishedAgents(): number {
    let pruned = 0;
    for (const [id, agent] of this.agents) {
      if (
        agent.status === 'completed' ||
        agent.status === 'failed' ||
        agent.status === 'cancelled'
      ) {
        this.agents.delete(id);
        this.taskAgents.delete(id);
        pruned++;
      }
    }
    if (pruned > 0) {
      logger.info({ pruned }, 'Pruned finished agents');
    }
    return pruned;
  }

  /** Get a snapshot of orchestrator state for health reporting */
  getHealthSnapshot(): {
    totalAgents: number;
    activeAgents: number;
    taskAgents: number;
    byStatus: Record<string, number>;
  } {
    const byStatus: Record<string, number> = {};
    for (const agent of this.agents.values()) {
      byStatus[agent.status] = (byStatus[agent.status] ?? 0) + 1;
    }

    return {
      totalAgents: this.agents.size,
      activeAgents: this.getActiveAgents().length,
      taskAgents: this.taskAgents.size,
      byStatus,
    };
  }

  // ── Event System ───────────────────────────────────────────────

  /** Subscribe to script events */
  on(eventType: ScriptEventType, listener: ScriptEventListener): void {
    const existing = this.listeners.get(eventType) ?? [];
    existing.push(listener);
    this.listeners.set(eventType, existing);
  }

  /** Unsubscribe from script events */
  off(eventType: ScriptEventType, listener: ScriptEventListener): void {
    const existing = this.listeners.get(eventType);
    if (!existing) return;
    this.listeners.set(
      eventType,
      existing.filter((l) => l !== listener),
    );
  }

  /** Subscribe to all events */
  onAny(listener: ScriptEventListener): void {
    for (const type of [
      'agent_started',
      'agent_done',
      'agent_failed',
      'task_started',
      'task_complete',
      'task_failed',
      'task_progress',
    ] as ScriptEventType[]) {
      this.on(type, listener);
    }
  }

  // ── Shutdown ───────────────────────────────────────────────────

  /** Gracefully shut down — cancel active agents */
  shutdown(): void {
    logger.info('Shutting down orchestrator');

    for (const agent of this.getActiveAgents()) {
      this.cancelAgent(agent.id);
    }

    this.agents.clear();
    this.taskAgents.clear();
    this.listeners.clear();

    logger.info('Orchestrator shut down');
  }

  // ── Private Helpers ────────────────────────────────────────────

  private createAgent(options: {
    name: string;
    role: 'main' | 'task';
    workspaceId: string;
    providerId: string;
    metadata?: Record<string, unknown>;
  }): Agent {
    const now = new Date().toISOString();
    const agent: Agent = {
      id: randomUUID(),
      name: options.name,
      role: options.role,
      status: 'running',
      workspaceId: options.workspaceId,
      providerId: options.providerId,
      tasks: [],
      createdAt: now,
      updatedAt: now,
      metadata: options.metadata ?? {},
    };

    this.agents.set(agent.id, agent);
    return agent;
  }

  private updateAgentStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.status = status;
    agent.updatedAt = new Date().toISOString();

    // Also update in taskAgents map if it's a task agent
    const taskAgent = this.taskAgents.get(agentId);
    if (taskAgent) {
      taskAgent.status = status;
      taskAgent.updatedAt = agent.updatedAt;
    }
  }

  private updateTaskStatus(
    agentId: string,
    taskId: string,
    status: TaskItem['status'],
    result?: string,
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const task = agent.tasks.find((t) => t.id === taskId);
    if (!task) return;

    task.status = status;
    if (result !== undefined) task.result = result;

    const now = new Date().toISOString();
    if (status === 'in_progress') task.startedAt = now;
    if (status === 'completed' || status === 'failed') task.completedAt = now;

    agent.updatedAt = now;
  }

  private emitEvent(event: ScriptEvent): void {
    const listeners = this.listeners.get(event.type) ?? [];
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.warn({ eventType: event.type, error }, 'Event listener error');
      }
    }
  }

  private async consumeStream(
    stream: AsyncGenerator<string, ProviderResult>,
  ): Promise<ProviderResult> {
    let iterResult: IteratorResult<string, ProviderResult>;
    do {
      iterResult = await stream.next();
    } while (!iterResult.done);
    return iterResult.value;
  }

  private async executeWithTimeout(
    provider: AIProvider,
    message: InboundMessage,
  ): Promise<ProviderResult> {
    return new Promise<ProviderResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task execution timed out after ${this.taskTimeoutMs}ms`));
      }, this.taskTimeoutMs);

      const execute = async (): Promise<void> => {
        try {
          let result: ProviderResult;
          if (provider.streamMessage) {
            result = await this.consumeStream(provider.streamMessage(message));
          } else {
            result = await provider.processMessage(message);
          }
          clearTimeout(timer);
          resolve(result);
        } catch (error) {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      void execute();
    });
  }
}
