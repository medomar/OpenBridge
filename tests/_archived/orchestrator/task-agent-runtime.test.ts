import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  TaskAgentRuntime,
  createTaskAgent,
  type TaskExecutor,
} from '../../src/orchestrator/task-agent-runtime.js';
import type { TaskAgent, ScriptEvent } from '../../src/types/agent.js';
import type { AIProvider, ProviderResult } from '../../src/types/provider.js';
import type { WorkspaceMap } from '../../src/types/workspace-map.js';

// ── Helpers ─────────────────────────────────────────────────────

function makeMinimalMap(): WorkspaceMap {
  return {
    version: '1.0',
    name: 'test-api',
    baseUrl: 'https://api.test.com',
    auth: { type: 'none' },
    source: 'manual',
    headers: {},
    endpoints: [
      {
        id: 'get-users',
        name: 'Get Users',
        method: 'GET',
        path: '/users',
        parameters: [],
        headers: {},
        tags: [],
      },
    ],
  };
}

function makeTaskAgent(overrides?: Partial<TaskAgent>): TaskAgent {
  const now = new Date().toISOString();
  return {
    id: 'agent-1',
    name: 'test-task-agent',
    role: 'task',
    status: 'idle',
    workspaceId: 'ws-1',
    providerId: 'claude-code',
    parentAgentId: 'main-1',
    parentTaskId: 'parent-task-1',
    tasks: [
      { id: 'task-1', description: 'First task', status: 'pending' },
      { id: 'task-2', description: 'Second task', status: 'pending' },
      { id: 'task-3', description: 'Third task', status: 'pending' },
    ],
    createdAt: now,
    updatedAt: now,
    metadata: {},
    ...overrides,
  };
}

function makeMockProvider(): AIProvider {
  return {
    name: 'mock-provider',
    initialize: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    processMessage: vi.fn<() => Promise<ProviderResult>>().mockResolvedValue({
      content: 'AI response',
      metadata: { durationMs: 100 },
    }),
    isAvailable: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    shutdown: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

function collectEvents(runtime: TaskAgentRuntime): ScriptEvent[] {
  const events: ScriptEvent[] = [];
  runtime.onAny((event) => events.push(event));
  return events;
}

// ── Tests ───────────────────────────────────────────────────────

describe('TaskAgentRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('creates runtime with minimal options', () => {
      const agent = makeTaskAgent();
      const runtime = new TaskAgentRuntime({ agent });
      const state = runtime.getAgent();
      expect(state.id).toBe('agent-1');
      expect(state.status).toBe('idle');
    });

    it('creates runtime with all options', () => {
      const agent = makeTaskAgent();
      const runtime = new TaskAgentRuntime({
        agent,
        workspaceMap: makeMinimalMap(),
        provider: makeMockProvider(),
        continueOnFailure: true,
        taskTimeoutMs: 5000,
      });
      expect(runtime.getAgent().id).toBe('agent-1');
    });

    it('deep-clones the agent to prevent external mutation', () => {
      const agent = makeTaskAgent();
      const runtime = new TaskAgentRuntime({ agent });
      agent.name = 'mutated';
      expect(runtime.getAgent().name).toBe('test-task-agent');
    });
  });

  describe('run — successful execution', () => {
    it('executes all tasks in order using custom executor', async () => {
      const agent = makeTaskAgent();
      const executionOrder: string[] = [];

      const executor: TaskExecutor = async (task) => {
        executionOrder.push(task.id);
        return `Done: ${task.description}`;
      };

      const runtime = new TaskAgentRuntime({ agent });
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('completed');
      expect(result.completedCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect(result.totalCount).toBe(3);
      expect(executionOrder).toEqual(['task-1', 'task-2', 'task-3']);
    });

    it('updates task status and results', async () => {
      const agent = makeTaskAgent();
      const executor: TaskExecutor = async (task) => `Result for ${task.id}`;

      const runtime = new TaskAgentRuntime({ agent });
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      for (const task of result.tasks) {
        expect(task.status).toBe('completed');
        expect(task.result).toBe(`Result for ${task.id}`);
        expect(task.startedAt).toBeDefined();
        expect(task.completedAt).toBeDefined();
      }
    });

    it('updates agent status to completed when all succeed', async () => {
      const agent = makeTaskAgent();
      const executor: TaskExecutor = async () => 'ok';

      const runtime = new TaskAgentRuntime({ agent });
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      const finalAgent = runtime.getAgent();
      expect(finalAgent.status).toBe('completed');
    });

    it('sets default result when executor returns undefined', async () => {
      const agent = makeTaskAgent();
      const executor: TaskExecutor = async () => undefined;

      const runtime = new TaskAgentRuntime({ agent });
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.tasks[0]!.result).toBe('Task completed successfully');
    });
  });

  describe('run — failure handling', () => {
    it('stops on first failure when continueOnFailure=false', async () => {
      const agent = makeTaskAgent();
      const executor: TaskExecutor = async (task) => {
        if (task.id === 'task-2') throw new Error('Task 2 failed');
        return 'ok';
      };

      const runtime = new TaskAgentRuntime({ agent, continueOnFailure: false });
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.completedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.skippedCount).toBe(1);
      expect(result.tasks[0]!.status).toBe('completed');
      expect(result.tasks[1]!.status).toBe('failed');
      expect(result.tasks[2]!.status).toBe('skipped');
    });

    it('continues after failure when continueOnFailure=true', async () => {
      const agent = makeTaskAgent();
      const executor: TaskExecutor = async (task) => {
        if (task.id === 'task-2') throw new Error('Task 2 failed');
        return 'ok';
      };

      const runtime = new TaskAgentRuntime({ agent, continueOnFailure: true });
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.completedCount).toBe(2);
      expect(result.failedCount).toBe(1);
      expect(result.skippedCount).toBe(0);
    });

    it('records error message in failed task result', async () => {
      const agent = makeTaskAgent();
      const executor: TaskExecutor = async () => {
        throw new Error('Something broke');
      };

      const runtime = new TaskAgentRuntime({ agent, continueOnFailure: false });
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.tasks[0]!.result).toBe('Something broke');
    });

    it('updates agent status to failed when tasks fail', async () => {
      const agent = makeTaskAgent();
      const executor: TaskExecutor = async () => {
        throw new Error('fail');
      };

      const runtime = new TaskAgentRuntime({ agent });
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(runtime.getAgent().status).toBe('failed');
    });
  });

  describe('run — abort', () => {
    it('skips remaining tasks after abort', async () => {
      const agent = makeTaskAgent();
      const runtime = new TaskAgentRuntime({ agent });

      const executor: TaskExecutor = async (task) => {
        if (task.id === 'task-1') {
          runtime.abort();
        }
        return 'ok';
      };
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('cancelled');
      expect(result.completedCount).toBe(1);
      expect(result.skippedCount).toBe(2);
    });
  });

  describe('run — task timeout', () => {
    it('fails task that exceeds timeout', async () => {
      const agent = makeTaskAgent({
        tasks: [{ id: 'slow', description: 'Slow task', status: 'pending' }],
      });

      const executor: TaskExecutor = async () => {
        // This task never resolves within timeout
        await new Promise((resolve) => setTimeout(resolve, 10_000));
        return 'done';
      };

      const runtime = new TaskAgentRuntime({ agent, taskTimeoutMs: 500 });
      const resultPromise = runtime.run(executor);
      await vi.advanceTimersByTimeAsync(600);
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.failedCount).toBe(1);
      expect(result.tasks[0]!.status).toBe('failed');
      expect(result.tasks[0]!.result).toContain('timed out');
    });
  });

  describe('run — skips non-pending tasks', () => {
    it('skips already-completed tasks', async () => {
      const agent = makeTaskAgent({
        tasks: [
          { id: 'task-1', description: 'Already done', status: 'completed', result: 'previous' },
          { id: 'task-2', description: 'Pending', status: 'pending' },
        ],
      });
      const executor: TaskExecutor = async () => 'new result';

      const runtime = new TaskAgentRuntime({ agent });
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.completedCount).toBe(2);
      expect(result.totalCount).toBe(2);
    });
  });

  describe('event emission', () => {
    it('emits agent_started with correct payload', async () => {
      const agent = makeTaskAgent();
      const runtime = new TaskAgentRuntime({ agent });
      const events = collectEvents(runtime);

      const executor: TaskExecutor = async () => 'ok';
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      const started = events.find((e) => e.type === 'agent_started');
      expect(started).toBeDefined();
      expect(started!.agentId).toBe('agent-1');
      if (started!.type === 'agent_started') {
        expect(started!.payload.agentName).toBe('test-task-agent');
        expect(started!.payload.taskCount).toBe(3);
      }
    });

    it('emits task_started and task_complete for each task', async () => {
      const agent = makeTaskAgent();
      const runtime = new TaskAgentRuntime({ agent });
      const events = collectEvents(runtime);

      const executor: TaskExecutor = async () => 'ok';
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      const taskStarted = events.filter((e) => e.type === 'task_started');
      const taskComplete = events.filter((e) => e.type === 'task_complete');
      expect(taskStarted).toHaveLength(3);
      expect(taskComplete).toHaveLength(3);
    });

    it('emits task_failed when a task errors', async () => {
      const agent = makeTaskAgent({
        tasks: [{ id: 't1', description: 'fail', status: 'pending' }],
      });
      const runtime = new TaskAgentRuntime({ agent });
      const events = collectEvents(runtime);

      const executor: TaskExecutor = async () => {
        throw new Error('boom');
      };
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      const failed = events.find((e) => e.type === 'task_failed');
      expect(failed).toBeDefined();
      if (failed?.type === 'task_failed') {
        expect(failed.payload.taskId).toBe('t1');
        expect(failed.payload.error).toBe('boom');
      }
    });

    it('emits agent_done when all tasks succeed', async () => {
      const agent = makeTaskAgent();
      const runtime = new TaskAgentRuntime({ agent });
      const events = collectEvents(runtime);

      const executor: TaskExecutor = async () => 'ok';
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      const done = events.find((e) => e.type === 'agent_done');
      expect(done).toBeDefined();
      if (done?.type === 'agent_done') {
        expect(done.payload.completedTasks).toBe(3);
        expect(done.payload.totalTasks).toBe(3);
      }
    });

    it('emits agent_failed when tasks fail', async () => {
      const agent = makeTaskAgent({
        tasks: [{ id: 't1', description: 'fail', status: 'pending' }],
      });
      const runtime = new TaskAgentRuntime({ agent });
      const events = collectEvents(runtime);

      const executor: TaskExecutor = async () => {
        throw new Error('fail');
      };
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      const failed = events.find((e) => e.type === 'agent_failed');
      expect(failed).toBeDefined();
      if (failed?.type === 'agent_failed') {
        expect(failed.payload.error).toContain('1 task(s) failed');
        expect(failed.payload.failedTaskId).toBe('t1');
      }
    });

    it('emits task_progress when reportProgress is called', async () => {
      const agent = makeTaskAgent({
        tasks: [{ id: 't1', description: 'progress', status: 'pending' }],
      });
      const runtime = new TaskAgentRuntime({ agent });
      const events = collectEvents(runtime);

      const executor: TaskExecutor = async (_task, ctx) => {
        ctx.reportProgress('Step 1 done', 50);
        return 'ok';
      };
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      const progress = events.find((e) => e.type === 'task_progress');
      expect(progress).toBeDefined();
      if (progress?.type === 'task_progress') {
        expect(progress.payload.taskId).toBe('t1');
        expect(progress.payload.message).toBe('Step 1 done');
        expect(progress.payload.percent).toBe(50);
      }
    });

    it('does not crash when event listener throws', async () => {
      const agent = makeTaskAgent({ tasks: [{ id: 't1', description: 'ok', status: 'pending' }] });
      const runtime = new TaskAgentRuntime({ agent });

      runtime.on('task_started', () => {
        throw new Error('listener error');
      });

      const executor: TaskExecutor = async () => 'ok';
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      // Should still complete despite listener error
      expect(result.status).toBe('completed');
    });
  });

  describe('on / onAny', () => {
    it('on() registers typed listener', async () => {
      const agent = makeTaskAgent({ tasks: [{ id: 't1', description: 'ok', status: 'pending' }] });
      const runtime = new TaskAgentRuntime({ agent });
      const started: string[] = [];

      runtime.on('task_started', (event) => {
        started.push(event.payload.taskId);
      });

      const executor: TaskExecutor = async () => 'ok';
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(started).toEqual(['t1']);
    });

    it('onAny() captures all event types', async () => {
      const agent = makeTaskAgent({ tasks: [{ id: 't1', description: 'ok', status: 'pending' }] });
      const runtime = new TaskAgentRuntime({ agent });
      const types: string[] = [];

      runtime.onAny((event) => types.push(event.type));

      const executor: TaskExecutor = async () => 'ok';
      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      expect(types).toContain('agent_started');
      expect(types).toContain('task_started');
      expect(types).toContain('task_complete');
      expect(types).toContain('agent_done');
    });
  });

  describe('TaskExecutionContext', () => {
    it('provides executeAPI that uses API executor', async () => {
      const map = makeMinimalMap();
      const agent = makeTaskAgent({
        tasks: [{ id: 't1', description: 'call api', status: 'pending' }],
      });
      const runtime = new TaskAgentRuntime({ agent, workspaceMap: map });

      const executor: TaskExecutor = async (_task, ctx) => {
        const result = await ctx.executeAPI({ endpointId: 'nonexistent' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe('ENDPOINT_NOT_FOUND');
        }
        return 'checked api';
      };

      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.status).toBe('completed');
    });

    it('executeAPI returns error when no workspace map', async () => {
      const agent = makeTaskAgent({
        tasks: [{ id: 't1', description: 'call api', status: 'pending' }],
      });
      const runtime = new TaskAgentRuntime({ agent });

      const executor: TaskExecutor = async (_task, ctx) => {
        const result = await ctx.executeAPI({ endpointId: 'test' });
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toContain('No workspace map');
        }
        return 'ok';
      };

      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;
    });

    it('askProvider sends message to provider', async () => {
      const provider = makeMockProvider();
      const agent = makeTaskAgent({
        tasks: [{ id: 't1', description: 'ask ai', status: 'pending' }],
      });
      const runtime = new TaskAgentRuntime({ agent, provider });

      const executor: TaskExecutor = async (_task, ctx) => {
        const result = await ctx.askProvider('What is 2+2?');
        expect(result.content).toBe('AI response');
        return 'done';
      };

      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      await resultPromise;

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.processMessage).toHaveBeenCalledOnce();
    });

    it('askProvider throws when no provider', async () => {
      const agent = makeTaskAgent({
        tasks: [{ id: 't1', description: 'ask ai', status: 'pending' }],
      });
      const runtime = new TaskAgentRuntime({ agent });

      const executor: TaskExecutor = async (_task, ctx) => {
        await ctx.askProvider('hello');
        return 'ok';
      };

      const resultPromise = runtime.run(executor);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.tasks[0]!.result).toContain('No AI provider');
    });
  });

  describe('default task executor', () => {
    it('uses provider to process task description when no custom executor', async () => {
      const provider = makeMockProvider();
      const agent = makeTaskAgent({
        tasks: [{ id: 't1', description: 'Sync inventory', status: 'pending' }],
      });
      const runtime = new TaskAgentRuntime({ agent, provider });

      const resultPromise = runtime.run();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('completed');
      expect(result.tasks[0]!.result).toBe('AI response');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(provider.processMessage).toHaveBeenCalledOnce();
    });

    it('completes with no result when no provider and no custom executor', async () => {
      const agent = makeTaskAgent({
        tasks: [{ id: 't1', description: 'task', status: 'pending' }],
      });
      const runtime = new TaskAgentRuntime({ agent });

      const resultPromise = runtime.run();
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result.status).toBe('completed');
      expect(result.tasks[0]!.result).toBe('Task completed successfully');
    });
  });
});

describe('createTaskAgent', () => {
  it('creates a valid TaskAgent with all required fields', () => {
    const agent = createTaskAgent({
      name: 'inventory-sync',
      parentAgentId: 'main-1',
      parentTaskId: 'pt-1',
      workspaceId: 'ws-1',
      providerId: 'claude-code',
      tasks: [
        { id: 't1', description: 'Fetch products' },
        { id: 't2', description: 'Update inventory' },
      ],
    });

    expect(agent.id).toBeDefined();
    expect(agent.name).toBe('inventory-sync');
    expect(agent.role).toBe('task');
    expect(agent.status).toBe('idle');
    expect(agent.parentAgentId).toBe('main-1');
    expect(agent.parentTaskId).toBe('pt-1');
    expect(agent.workspaceId).toBe('ws-1');
    expect(agent.providerId).toBe('claude-code');
    expect(agent.tasks).toHaveLength(2);
    expect(agent.tasks[0]!.status).toBe('pending');
    expect(agent.tasks[1]!.status).toBe('pending');
    expect(agent.createdAt).toBeDefined();
    expect(agent.updatedAt).toBeDefined();
  });

  it('accepts optional metadata', () => {
    const agent = createTaskAgent({
      name: 'test',
      parentAgentId: 'main-1',
      parentTaskId: 'pt-1',
      workspaceId: 'ws-1',
      providerId: 'claude-code',
      tasks: [{ id: 't1', description: 'task' }],
      metadata: { priority: 'high' },
    });

    expect(agent.metadata).toEqual({ priority: 'high' });
  });

  it('defaults metadata to empty object', () => {
    const agent = createTaskAgent({
      name: 'test',
      parentAgentId: 'main-1',
      parentTaskId: 'pt-1',
      workspaceId: 'ws-1',
      providerId: 'claude-code',
      tasks: [{ id: 't1', description: 'task' }],
    });

    expect(agent.metadata).toEqual({});
  });
});
