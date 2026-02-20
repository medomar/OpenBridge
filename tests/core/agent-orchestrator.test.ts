import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentOrchestrator } from '../../src/core/agent-orchestrator.js';
import type { AIProvider, ProviderResult } from '../../src/types/provider.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { ScriptEvent } from '../../src/types/agent.js';

// ── Helpers ─────────────────────────────────────────────────────

function makeMockProvider(name = 'mock'): AIProvider & {
  processedMessages: InboundMessage[];
  setResponse: (r: ProviderResult) => void;
  setStreamChunks: (chunks: string[]) => void;
} {
  let response: ProviderResult = { content: 'Mock response' };
  const processedMessages: InboundMessage[] = [];

  const provider: AIProvider & {
    processedMessages: InboundMessage[];
    setResponse: (r: ProviderResult) => void;
    setStreamChunks: (chunks: string[]) => void;
  } = {
    name,
    processedMessages,
    initialize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    processMessage: vi.fn(async (msg: InboundMessage) => {
      processedMessages.push(msg);
      return response;
    }),
    isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    shutdown: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    setResponse(r: ProviderResult) {
      response = r;
    },
    setStreamChunks(chunks: string[]) {
      provider.streamMessage = async function* (
        msg: InboundMessage,
      ): AsyncGenerator<string, ProviderResult> {
        processedMessages.push(msg);
        for (const chunk of chunks) {
          yield chunk;
        }
        return response;
      };
    },
  };

  return provider;
}

function makeMessage(overrides?: Partial<InboundMessage>): InboundMessage {
  return {
    id: 'msg-1',
    source: 'test',
    sender: '+1234567890',
    rawContent: '/ai hello',
    content: 'hello',
    timestamp: new Date(),
    metadata: {},
    ...overrides,
  };
}

function collectEvents(orchestrator: AgentOrchestrator): ScriptEvent[] {
  const events: ScriptEvent[] = [];
  orchestrator.onAny((event) => events.push(event));
  return events;
}

// ── Tests ───────────────────────────────────────────────────────

describe('AgentOrchestrator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('creates orchestrator with default config', () => {
      const orch = new AgentOrchestrator('mock');
      expect(orch.getActiveAgents()).toEqual([]);
      expect(orch.getHealthSnapshot().totalAgents).toBe(0);
    });

    it('creates orchestrator with custom config', () => {
      const orch = new AgentOrchestrator('mock', {
        maxConcurrentAgents: 5,
        taskTimeoutMs: 60_000,
        enableMultiAgent: false,
      });
      // Config accepted — no errors
      expect(orch.getHealthSnapshot().totalAgents).toBe(0);
    });
  });

  describe('addProvider', () => {
    it('registers a provider by name', async () => {
      const orch = new AgentOrchestrator('mock');
      const provider = makeMockProvider();
      orch.addProvider(provider);

      // Provider is now available for processing
      const msg = makeMessage();
      const resultPromise = orch.process(msg);
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.result.content).toBe('Mock response');
    });

    it('allows multiple providers', () => {
      const orch = new AgentOrchestrator('provider-a');
      orch.addProvider(makeMockProvider('provider-a'));
      orch.addProvider(makeMockProvider('provider-b'));
      // No error — both registered
      expect(orch.getHealthSnapshot().totalAgents).toBe(0);
    });
  });

  describe('process', () => {
    it('creates a main agent and routes message to default provider', async () => {
      const provider = makeMockProvider();
      provider.setResponse({ content: 'Hello from AI' });
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const msg = makeMessage({ content: 'What time is it?' });
      const resultPromise = orch.process(msg);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.result.content).toBe('Hello from AI');
      expect(result.agent).toBeDefined();
      expect(result.agent.role).toBe('main');
      expect(result.agent.status).toBe('completed');
    });

    it('creates a main agent with sender metadata', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const msg = makeMessage({ sender: '+9876543210' });
      const resultPromise = orch.process(msg);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.agent.metadata['sender']).toBe('+9876543210');
    });

    it('uses workspace from message metadata', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const msg = makeMessage({ metadata: { workspace: 'my-project' } });
      const resultPromise = orch.process(msg);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.agent.workspaceId).toBe('my-project');
    });

    it('defaults workspace to "default" when not provided', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const msg = makeMessage({ metadata: {} });
      const resultPromise = orch.process(msg);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.agent.workspaceId).toBe('default');
    });

    it('throws when provider is not registered', async () => {
      const orch = new AgentOrchestrator('nonexistent');

      const msg = makeMessage();
      await expect(orch.process(msg)).rejects.toThrow(
        'Provider "nonexistent" not registered with orchestrator',
      );
    });

    it('propagates provider errors and marks agent as failed', async () => {
      const provider = makeMockProvider();
      (provider.processMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Provider crashed'),
      );
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const msg = makeMessage();
      await expect(orch.process(msg)).rejects.toThrow('Provider crashed');
    });

    it('handles streaming providers', async () => {
      const provider = makeMockProvider();
      provider.setResponse({ content: 'Streamed result' });
      provider.setStreamChunks(['chunk1', 'chunk2', 'chunk3']);

      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const msg = makeMessage();
      const resultPromise = orch.process(msg);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.result.content).toBe('Streamed result');
      expect(result.agent.status).toBe('completed');
    });

    it('tracks the main agent in agents map', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const msg = makeMessage();
      const resultPromise = orch.process(msg);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      const agent = orch.getAgent(result.agent.id);
      expect(agent).toBeDefined();
      expect(agent!.id).toBe(result.agent.id);
    });
  });

  describe('createTaskAgent', () => {
    it('creates a task agent with correct properties', () => {
      const orch = new AgentOrchestrator('mock');

      const taskAgent = orch.createTaskAgent({
        name: 'inventory-sync',
        tasks: [
          { id: 't1', description: 'Fetch products' },
          { id: 't2', description: 'Update inventory' },
        ],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      expect(taskAgent.id).toBeDefined();
      expect(taskAgent.name).toBe('inventory-sync');
      expect(taskAgent.role).toBe('task');
      expect(taskAgent.status).toBe('idle');
      expect(taskAgent.workspaceId).toBe('ws-1');
      expect(taskAgent.parentAgentId).toBe('parent-1');
      expect(taskAgent.parentTaskId).toBe('pt-1');
      expect(taskAgent.tasks).toHaveLength(2);
      expect(taskAgent.tasks[0]!.status).toBe('pending');
      expect(taskAgent.tasks[1]!.status).toBe('pending');
    });

    it('registers task agent in both agents and taskAgents maps', () => {
      const orch = new AgentOrchestrator('mock');

      const taskAgent = orch.createTaskAgent({
        name: 'test',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      expect(orch.getAgent(taskAgent.id)).toBeDefined();
      expect(orch.getTaskAgentsForParent('parent-1')).toHaveLength(1);
    });

    it('accepts optional metadata', () => {
      const orch = new AgentOrchestrator('mock');

      const taskAgent = orch.createTaskAgent({
        name: 'test',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { priority: 'high' },
      });

      expect(taskAgent.metadata).toEqual({ priority: 'high' });
    });

    it('defaults metadata to empty object', () => {
      const orch = new AgentOrchestrator('mock');

      const taskAgent = orch.createTaskAgent({
        name: 'test',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      expect(taskAgent.metadata).toEqual({});
    });

    it('emits agent_started event on creation', () => {
      const orch = new AgentOrchestrator('mock');
      const events = collectEvents(orch);

      orch.createTaskAgent({
        name: 'test-agent',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      const started = events.find((e) => e.type === 'agent_started');
      expect(started).toBeDefined();
      if (started?.type === 'agent_started') {
        expect(started.payload.agentName).toBe('test-agent');
        expect(started.payload.taskCount).toBe(1);
      }
    });
  });

  describe('executeTaskAgent', () => {
    it('executes all tasks sequentially through the provider', async () => {
      const provider = makeMockProvider();
      provider.setResponse({ content: 'task result' });
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [
          { id: 't1', description: 'First task' },
          { id: 't2', description: 'Second task' },
        ],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      const resultPromise = orch.executeTaskAgent(taskAgent.id);
      await vi.runAllTimersAsync();
      const results = await resultPromise;

      expect(results).toHaveLength(2);
      expect(results[0]!.content).toBe('task result');
      expect(results[1]!.content).toBe('task result');
    });

    it('updates agent status to completed when all tasks succeed', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      const resultPromise = orch.executeTaskAgent(taskAgent.id);
      await vi.runAllTimersAsync();
      await resultPromise;

      const agent = orch.getAgent(taskAgent.id);
      expect(agent!.status).toBe('completed');
    });

    it('marks agent as failed when all tasks fail', async () => {
      const provider = makeMockProvider();
      (provider.processMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('task error'),
      );
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      const resultPromise = orch.executeTaskAgent(taskAgent.id);
      await vi.runAllTimersAsync();
      await resultPromise;

      const agent = orch.getAgent(taskAgent.id);
      expect(agent!.status).toBe('failed');
    });

    it('marks agent completed when some tasks fail but not all', async () => {
      let callCount = 0;
      const provider = makeMockProvider();
      (provider.processMessage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new Error('first fails');
        return { content: 'ok' };
      });
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [
          { id: 't1', description: 'will fail' },
          { id: 't2', description: 'will succeed' },
        ],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      const resultPromise = orch.executeTaskAgent(taskAgent.id);
      await vi.runAllTimersAsync();
      await resultPromise;

      const agent = orch.getAgent(taskAgent.id);
      expect(agent!.status).toBe('completed');
    });

    it('throws when task agent not found', async () => {
      const orch = new AgentOrchestrator('mock');
      await expect(orch.executeTaskAgent('nonexistent')).rejects.toThrow(
        'Task agent "nonexistent" not found',
      );
    });

    it('throws when provider not registered', async () => {
      const orch = new AgentOrchestrator('mock');
      // Create a task agent with a provider that isn't registered
      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'unregistered',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      await expect(orch.executeTaskAgent(taskAgent.id)).rejects.toThrow(
        'Provider "unregistered" not registered',
      );
    });

    it('skips already-completed and skipped tasks', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [
          { id: 't1', description: 'already done' },
          { id: 't2', description: 'pending task' },
        ],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      // Manually mark first task as completed before execution
      const agent = orch.getAgent(taskAgent.id)!;
      agent.tasks[0]!.status = 'completed';

      const resultPromise = orch.executeTaskAgent(taskAgent.id);
      await vi.runAllTimersAsync();
      const results = await resultPromise;

      // Only the pending task should be processed
      expect(results).toHaveLength(1);
    });

    it('emits task_started and task_complete events', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);
      const events = collectEvents(orch);

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      const resultPromise = orch.executeTaskAgent(taskAgent.id);
      await vi.runAllTimersAsync();
      await resultPromise;

      const taskStarted = events.filter((e) => e.type === 'task_started');
      const taskComplete = events.filter((e) => e.type === 'task_complete');
      expect(taskStarted).toHaveLength(1);
      expect(taskComplete).toHaveLength(1);
    });

    it('emits task_failed event when a task errors', async () => {
      const provider = makeMockProvider();
      (provider.processMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);
      const events = collectEvents(orch);

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      const resultPromise = orch.executeTaskAgent(taskAgent.id);
      await vi.runAllTimersAsync();
      await resultPromise;

      const taskFailed = events.find((e) => e.type === 'task_failed');
      expect(taskFailed).toBeDefined();
      if (taskFailed?.type === 'task_failed') {
        expect(taskFailed.payload.taskId).toBe('t1');
        expect(taskFailed.payload.error).toBe('boom');
      }
    });

    it('emits agent_done event on successful completion', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);
      const events = collectEvents(orch);

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      const resultPromise = orch.executeTaskAgent(taskAgent.id);
      await vi.runAllTimersAsync();
      await resultPromise;

      const agentDone = events.find((e) => e.type === 'agent_done');
      expect(agentDone).toBeDefined();
      if (agentDone?.type === 'agent_done') {
        expect(agentDone.payload.completedTasks).toBe(1);
        expect(agentDone.payload.totalTasks).toBe(1);
      }
    });

    it('emits agent_failed event when all tasks fail', async () => {
      const provider = makeMockProvider();
      (provider.processMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('error'));
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);
      const events = collectEvents(orch);

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      const resultPromise = orch.executeTaskAgent(taskAgent.id);
      await vi.runAllTimersAsync();
      await resultPromise;

      const agentFailed = events.find((e) => e.type === 'agent_failed');
      expect(agentFailed).toBeDefined();
      if (agentFailed?.type === 'agent_failed') {
        expect(agentFailed.payload.error).toContain('1 tasks failed');
        expect(agentFailed.payload.failedTaskId).toBe('t1');
      }
    });
  });

  describe('getAgent', () => {
    it('returns undefined for unknown agent', () => {
      const orch = new AgentOrchestrator('mock');
      expect(orch.getAgent('unknown')).toBeUndefined();
    });

    it('returns agent after process()', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const msg = makeMessage();
      const resultPromise = orch.process(msg);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(orch.getAgent(result.agent.id)).toBeDefined();
    });
  });

  describe('getActiveAgents', () => {
    it('returns empty array initially', () => {
      const orch = new AgentOrchestrator('mock');
      expect(orch.getActiveAgents()).toEqual([]);
    });

    it('excludes completed agents', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const msg = makeMessage();
      const resultPromise = orch.process(msg);
      await vi.runAllTimersAsync();
      await resultPromise;

      // Agent completed, so not active
      expect(orch.getActiveAgents()).toHaveLength(0);
    });

    it('includes idle task agents', () => {
      const orch = new AgentOrchestrator('mock');

      orch.createTaskAgent({
        name: 'worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      // Idle agents are active
      expect(orch.getActiveAgents()).toHaveLength(1);
    });
  });

  describe('getTaskAgentsForParent', () => {
    it('returns empty array for unknown parent', () => {
      const orch = new AgentOrchestrator('mock');
      expect(orch.getTaskAgentsForParent('unknown')).toEqual([]);
    });

    it('returns task agents belonging to specified parent', () => {
      const orch = new AgentOrchestrator('mock');

      orch.createTaskAgent({
        name: 'child-1',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-A',
        parentTaskId: 'pt-1',
      });

      orch.createTaskAgent({
        name: 'child-2',
        tasks: [{ id: 't2', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-A',
        parentTaskId: 'pt-2',
      });

      orch.createTaskAgent({
        name: 'other-child',
        tasks: [{ id: 't3', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-B',
        parentTaskId: 'pt-3',
      });

      const children = orch.getTaskAgentsForParent('parent-A');
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.name).sort()).toEqual(['child-1', 'child-2']);
    });
  });

  describe('cancelAgent', () => {
    it('marks agent as cancelled', () => {
      const orch = new AgentOrchestrator('mock');

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      orch.cancelAgent(taskAgent.id);

      const agent = orch.getAgent(taskAgent.id);
      expect(agent!.status).toBe('cancelled');
    });

    it('cancels child task agents when parent is cancelled', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      // Process a message to create a main agent
      const msg = makeMessage();
      // Make provider slow so agent stays running
      (provider.processMessage as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'ok' }), 10_000)),
      );

      const processPromise = orch.process(msg);

      // Wait for the agent to be created but not completed
      await vi.advanceTimersByTimeAsync(100);

      // Find the main agent
      const activeAgents = orch.getActiveAgents();
      expect(activeAgents).toHaveLength(1);
      const mainAgent = activeAgents[0]!;

      // Create child task agents for this main agent
      const child1 = orch.createTaskAgent({
        name: 'child-1',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: mainAgent.id,
        parentTaskId: 'pt-1',
      });

      const child2 = orch.createTaskAgent({
        name: 'child-2',
        tasks: [{ id: 't2', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: mainAgent.id,
        parentTaskId: 'pt-2',
      });

      // Cancel the main agent
      orch.cancelAgent(mainAgent.id);

      expect(orch.getAgent(mainAgent.id)!.status).toBe('cancelled');
      expect(orch.getAgent(child1.id)!.status).toBe('cancelled');
      expect(orch.getAgent(child2.id)!.status).toBe('cancelled');

      // Let the process complete (it will error but we don't care)
      await vi.runAllTimersAsync();
      await processPromise.catch(() => {});
    });

    it('does nothing for unknown agent ID', () => {
      const orch = new AgentOrchestrator('mock');
      // Should not throw
      orch.cancelAgent('nonexistent');
    });

    it('does not cancel already-completed children', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const child = orch.createTaskAgent({
        name: 'child',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      // Execute to completion
      const resultPromise = orch.executeTaskAgent(child.id);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(orch.getAgent(child.id)!.status).toBe('completed');

      // Now cancel the parent
      orch.cancelAgent('parent-1');

      // Child should still be completed, not cancelled
      expect(orch.getAgent(child.id)!.status).toBe('completed');
    });
  });

  describe('pruneFinishedAgents', () => {
    it('returns 0 when no agents exist', () => {
      const orch = new AgentOrchestrator('mock');
      expect(orch.pruneFinishedAgents()).toBe(0);
    });

    it('removes completed agents', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const msg = makeMessage();
      const resultPromise = orch.process(msg);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(orch.getHealthSnapshot().totalAgents).toBe(1);

      const pruned = orch.pruneFinishedAgents();
      expect(pruned).toBe(1);
      expect(orch.getAgent(result.agent.id)).toBeUndefined();
      expect(orch.getHealthSnapshot().totalAgents).toBe(0);
    });

    it('removes failed agents', async () => {
      const provider = makeMockProvider();
      (provider.processMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'));
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      try {
        await orch.process(makeMessage());
      } catch {
        // Expected
      }

      const pruned = orch.pruneFinishedAgents();
      expect(pruned).toBe(1);
    });

    it('removes cancelled agents', () => {
      const orch = new AgentOrchestrator('mock');

      const taskAgent = orch.createTaskAgent({
        name: 'worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      orch.cancelAgent(taskAgent.id);

      const pruned = orch.pruneFinishedAgents();
      expect(pruned).toBe(1);
    });

    it('preserves active agents', () => {
      const orch = new AgentOrchestrator('mock');

      orch.createTaskAgent({
        name: 'active-worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      const pruned = orch.pruneFinishedAgents();
      expect(pruned).toBe(0);
      expect(orch.getHealthSnapshot().totalAgents).toBe(1);
    });
  });

  describe('getHealthSnapshot', () => {
    it('returns zeros for empty orchestrator', () => {
      const orch = new AgentOrchestrator('mock');
      const snapshot = orch.getHealthSnapshot();
      expect(snapshot.totalAgents).toBe(0);
      expect(snapshot.activeAgents).toBe(0);
      expect(snapshot.taskAgents).toBe(0);
      expect(snapshot.byStatus).toEqual({});
    });

    it('counts agents by status', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      // Create an idle task agent
      orch.createTaskAgent({
        name: 'idle-worker',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      // Process a message (creates completed main agent)
      const resultPromise = orch.process(makeMessage());
      await vi.runAllTimersAsync();
      await resultPromise;

      const snapshot = orch.getHealthSnapshot();
      expect(snapshot.totalAgents).toBe(2);
      expect(snapshot.activeAgents).toBe(1); // idle task agent
      expect(snapshot.taskAgents).toBe(1);
      expect(snapshot.byStatus['idle']).toBe(1);
      expect(snapshot.byStatus['completed']).toBe(1);
    });
  });

  describe('event system', () => {
    it('on() subscribes to specific event type', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const agentNames: string[] = [];
      orch.on('agent_started', (event) => {
        if (event.type === 'agent_started') {
          agentNames.push(event.payload.agentName);
        }
      });

      const resultPromise = orch.process(makeMessage());
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(agentNames).toHaveLength(1);
    });

    it('off() unsubscribes from events', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const events: ScriptEvent[] = [];
      const listener = (event: ScriptEvent) => events.push(event);

      orch.on('agent_started', listener);
      orch.off('agent_started', listener);

      const resultPromise = orch.process(makeMessage());
      await vi.runAllTimersAsync();
      await resultPromise;

      const started = events.filter((e) => e.type === 'agent_started');
      expect(started).toHaveLength(0);
    });

    it('off() does nothing for unknown event type', () => {
      const orch = new AgentOrchestrator('mock');
      const listener = () => {};
      // Should not throw
      orch.off('agent_started', listener);
    });

    it('onAny() captures all event types', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const types = new Set<string>();
      orch.onAny((event) => types.add(event.type));

      const resultPromise = orch.process(makeMessage());
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(types.has('agent_started')).toBe(true);
      expect(types.has('agent_done')).toBe(true);
    });

    it('emits agent_started on process()', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);
      const events = collectEvents(orch);

      const resultPromise = orch.process(makeMessage({ sender: '+111' }));
      await vi.runAllTimersAsync();
      await resultPromise;

      const started = events.find((e) => e.type === 'agent_started');
      expect(started).toBeDefined();
      if (started?.type === 'agent_started') {
        expect(started.payload.taskCount).toBe(0);
      }
    });

    it('emits agent_done on successful process()', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);
      const events = collectEvents(orch);

      const resultPromise = orch.process(makeMessage());
      await vi.runAllTimersAsync();
      await resultPromise;

      const done = events.find((e) => e.type === 'agent_done');
      expect(done).toBeDefined();
    });

    it('emits agent_failed on process() error', async () => {
      const provider = makeMockProvider();
      (provider.processMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('provider error'),
      );
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);
      const events = collectEvents(orch);

      try {
        await orch.process(makeMessage());
      } catch {
        // Expected
      }

      const failed = events.find((e) => e.type === 'agent_failed');
      expect(failed).toBeDefined();
      if (failed?.type === 'agent_failed') {
        expect(failed.payload.error).toBe('provider error');
      }
    });

    it('does not crash when event listener throws', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      orch.on('agent_started', () => {
        throw new Error('listener explosion');
      });

      const resultPromise = orch.process(makeMessage());
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      // Should still complete despite listener error
      expect(result.result.content).toBe('Mock response');
    });
  });

  describe('shutdown', () => {
    it('cancels all active agents', () => {
      const orch = new AgentOrchestrator('mock');

      orch.createTaskAgent({
        name: 'worker-1',
        tasks: [{ id: 't1', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
      });

      orch.createTaskAgent({
        name: 'worker-2',
        tasks: [{ id: 't2', description: 'task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-2',
      });

      orch.shutdown();

      expect(orch.getHealthSnapshot().totalAgents).toBe(0);
      expect(orch.getActiveAgents()).toEqual([]);
    });

    it('clears all listeners', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      const events: ScriptEvent[] = [];
      orch.onAny((event) => events.push(event));

      orch.shutdown();

      // Re-register provider after shutdown
      orch.addProvider(provider);

      // Events should not be collected after shutdown cleared listeners
      const resultPromise = orch.process(makeMessage());
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(events).toHaveLength(0);
    });

    it('is safe to call multiple times', () => {
      const orch = new AgentOrchestrator('mock');
      orch.shutdown();
      orch.shutdown();
      // Should not throw
    });
  });

  describe('task timeout', () => {
    it('times out task execution after configured timeout', async () => {
      const provider = makeMockProvider();
      (provider.processMessage as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ content: 'ok' }), 200_000)),
      );

      const orch = new AgentOrchestrator('mock', { taskTimeoutMs: 500 });
      orch.addProvider(provider);

      const taskAgent = orch.createTaskAgent({
        name: 'slow-worker',
        tasks: [{ id: 't1', description: 'slow task' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: 'parent-1',
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      const resultPromise = orch.executeTaskAgent(taskAgent.id);
      await vi.advanceTimersByTimeAsync(600);
      const results = await resultPromise;

      // Task should have failed due to timeout
      expect(results).toHaveLength(0);
      const agent = orch.getAgent(taskAgent.id)!;
      expect(agent.tasks[0]!.status).toBe('failed');
      expect(agent.tasks[0]!.result).toContain('timed out');
    });
  });

  describe('multi-agent flow', () => {
    it('processes a message and creates task agents for the main agent', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      // Process a message to create a main agent
      const resultPromise = orch.process(makeMessage());
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      // Now create task agents under that main agent
      const child1 = orch.createTaskAgent({
        name: 'subtask-1',
        tasks: [{ id: 't1', description: 'Sub task 1' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: result.agent.id,
        parentTaskId: 'pt-1',
        metadata: { sender: 'user-1' },
      });

      const child2 = orch.createTaskAgent({
        name: 'subtask-2',
        tasks: [{ id: 't2', description: 'Sub task 2' }],
        workspaceId: 'ws-1',
        providerId: 'mock',
        parentAgentId: result.agent.id,
        parentTaskId: 'pt-2',
        metadata: { sender: 'user-1' },
      });

      // Verify children are linked to parent
      const children = orch.getTaskAgentsForParent(result.agent.id);
      expect(children).toHaveLength(2);

      // Execute both task agents
      const exec1 = orch.executeTaskAgent(child1.id);
      const exec2 = orch.executeTaskAgent(child2.id);
      await vi.runAllTimersAsync();
      const [r1, r2] = await Promise.all([exec1, exec2]);

      expect(r1).toHaveLength(1);
      expect(r2).toHaveLength(1);

      // All agents should be completed
      expect(orch.getAgent(child1.id)!.status).toBe('completed');
      expect(orch.getAgent(child2.id)!.status).toBe('completed');
    });

    it('health snapshot reflects multi-agent state', async () => {
      const provider = makeMockProvider();
      const orch = new AgentOrchestrator('mock');
      orch.addProvider(provider);

      // Create several task agents
      for (let i = 0; i < 3; i++) {
        orch.createTaskAgent({
          name: `worker-${i}`,
          tasks: [{ id: `t${i}`, description: `task ${i}` }],
          workspaceId: 'ws-1',
          providerId: 'mock',
          parentAgentId: 'parent-1',
          parentTaskId: `pt-${i}`,
        });
      }

      const snapshot = orch.getHealthSnapshot();
      expect(snapshot.totalAgents).toBe(3);
      expect(snapshot.activeAgents).toBe(3);
      expect(snapshot.taskAgents).toBe(3);
      expect(snapshot.byStatus['idle']).toBe(3);
    });
  });
});
