/**
 * Integration test: stop command flow (OB-885)
 *
 * Verifies the end-to-end stop command path:
 *   Router intercepts "stop" → MasterManager.killWorker() → abort handle called →
 *   WorkerRegistry marks cancelled → agent_activity updated in DB →
 *   response sent back to connector.
 *
 * Uses:
 *  - Real SQLite MemoryManager (temp file on disk)
 *  - Mock AgentRunner (mockSpawn + mockSpawnWithHandle)
 *  - MasterManager with skipAutoExploration=true
 *  - Router + MockConnector to verify response delivery
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { MasterManager } from '../../src/master/master-manager.js';
import { Router } from '../../src/core/router.js';
import { MemoryManager } from '../../src/memory/index.js';
import { MockConnector } from '../helpers/mock-connector.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { AgentResult } from '../../src/core/agent-runner.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockSpawn = vi.fn();
const mockStream = vi.fn();
const mockSpawnWithHandle = vi.fn();

vi.mock('../../src/core/agent-runner.js', () => {
  const profiles: Record<string, string[]> = {
    'read-only': ['Read', 'Glob', 'Grep'],
    'code-edit': [
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(git:*)',
      'Bash(npm:*)',
      'Bash(npx:*)',
    ],
    'full-access': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  };

  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: mockSpawn,
      stream: mockStream,
      spawnWithHandle: mockSpawnWithHandle,
      spawnWithStreamingHandle: mockSpawnWithHandle,
    })),
    TOOLS_READ_ONLY: profiles['read-only'],
    TOOLS_CODE_EDIT: profiles['code-edit'],
    TOOLS_FULL: profiles['full-access'],
    DEFAULT_MAX_TURNS_EXPLORATION: 15,
    DEFAULT_MAX_TURNS_TASK: 25,
    sanitizePrompt: vi.fn((s: string) => s),
    buildArgs: vi.fn(),
    isValidModel: vi.fn(() => true),
    MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
    AgentExhaustedError: class AgentExhaustedError extends Error {},
    resolveProfile: (profileName: string) => profiles[profileName],
    isMaxTurnsExhausted: vi.fn((_stdout: string) => false),
    classifyError: (stderr: string, exitCode: number): string => {
      const lower = stderr.toLowerCase();
      if (
        lower.includes('rate limit') ||
        lower.includes('rate_limit') ||
        lower.includes('too many requests')
      )
        return 'rate-limit';
      if (
        lower.includes('context window') ||
        lower.includes('context length') ||
        lower.includes('too many tokens')
      )
        return 'context-overflow';
      if (
        lower.includes('invalid api key') ||
        lower.includes('unauthorized') ||
        lower.includes('authentication failed')
      )
        return 'auth';
      if (exitCode === 143 || exitCode === 137 || lower.includes('timeout')) return 'timeout';
      if (exitCode !== 0) return 'crash';
      return 'unknown';
    },
    manifestToSpawnOptions: (manifest: Record<string, unknown>) => {
      const profile = manifest.profile as string | undefined;
      const allowedTools =
        (manifest.allowedTools as string[] | undefined) ??
        (profile ? profiles[profile] : undefined);
      return Promise.resolve({
        spawnOptions: {
          prompt: manifest.prompt,
          workspacePath: manifest.workspacePath,
          model: manifest.model,
          allowedTools,
          maxTurns: manifest.maxTurns,
          timeout: manifest.timeout,
          retries: manifest.retries,
          retryDelay: manifest.retryDelay,
        },
        cleanup: async () => {},
      });
    },
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const masterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  available: true,
  role: 'master',
  capabilities: ['general'],
};

const discoveredTools: DiscoveredTool[] = [masterTool];

function makeMessage(content: string): InboundMessage {
  return {
    id: 'msg-' + Date.now(),
    content,
    rawContent: '/ai ' + content,
    sender: '+1234567890',
    source: 'mock',
    timestamp: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: stop command flow (OB-885)', () => {
  let testWorkspace: string;
  let memory: MemoryManager;
  let masterManager: MasterManager;
  let router: Router;
  let connector: MockConnector;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawnWithHandle.mockReset();

    // Default mockSpawnWithHandle behavior: delegates to mockSpawn
    mockSpawnWithHandle.mockImplementation((opts: Parameters<typeof mockSpawn>[0]) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    // Use /tmp to stay outside the project git repo (avoids git hook interference)
    testWorkspace = path.join(
      os.tmpdir(),
      `ob-stop-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    await fs.mkdir(testWorkspace, { recursive: true });

    // Real SQLite MemoryManager backed by a temp file
    const dbPath = path.join(testWorkspace, '.openbridge', 'openbridge.db');
    await fs.mkdir(path.join(testWorkspace, '.openbridge'), { recursive: true });
    memory = new MemoryManager(dbPath);
    await memory.init();

    // Stub classifyTask to avoid consuming extra spawn mocks
    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue('tool-use');

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools,
      skipAutoExploration: true,
      workerRetryDelayMs: 0,
      memory,
    });
    await masterManager.start();

    // Set up Router + MockConnector
    router = new Router('mock');
    connector = new MockConnector();
    await connector.initialize();
    router.addConnector(connector);
    router.setMaster(masterManager);
    masterManager.setRouter(router);
  });

  afterEach(async () => {
    await masterManager.shutdown();
    await memory.close();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  // -------------------------------------------------------------------------
  // No-workers scenarios
  // -------------------------------------------------------------------------

  describe('No workers running', () => {
    it('responds with "No workers are currently running" for "stop" with no workers', async () => {
      await router.route(makeMessage('stop'));

      const response = connector.sentMessages.find((m) =>
        m.content.includes('No workers are currently running'),
      );
      expect(response).toBeDefined();
      expect(response?.recipient).toBe('+1234567890');
    });

    it('responds with "No workers are currently running" for "stop all" with no workers', async () => {
      await router.route(makeMessage('stop all'));

      const response = connector.sentMessages.find((m) =>
        m.content.includes('No workers are currently running'),
      );
      expect(response).toBeDefined();
    });

    it('responds with not-found for "stop <unknownId>" when no workers exist', async () => {
      await router.route(makeMessage('stop unknownxyz'));

      const response = connector.sentMessages.find(
        (m) => m.content.includes('not found') || m.content.includes("'unknownxyz'"),
      );
      expect(response).toBeDefined();
      expect(response?.recipient).toBe('+1234567890');
    });
  });

  // -------------------------------------------------------------------------
  // Active worker stop — full chain
  // -------------------------------------------------------------------------

  describe('Active worker stop — full chain', () => {
    it('stops a running worker: abort called, registry cancelled, activity removed from active, response sent', async () => {
      const mockAbort = vi.fn();
      let resolveWorker!: (result: AgentResult) => void;

      // When abort is called, settle the worker deferred (simulates process killed by SIGTERM)
      mockAbort.mockImplementation(() => {
        resolveWorker({
          exitCode: 143, // SIGTERM
          stdout: '',
          stderr: 'Terminated',
          retryCount: 0,
          durationMs: 0,
        });
      });

      const workerDeferred = new Promise<AgentResult>((resolve) => {
        resolveWorker = resolve;
      });

      // Master returns a SPAWN marker (retries:0 so no retry after cancellation)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[SPAWN:code-edit]{"prompt":"Fix auth bug","model":"sonnet","retries":0}[/SPAWN]',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      // Worker spawnWithHandle returns a pending promise with the mock abort handle
      mockSpawnWithHandle.mockImplementationOnce((_opts: unknown) => ({
        promise: workerDeferred,
        pid: 55555,
        abort: mockAbort,
      }));

      // Master feedback call after the worker settles (called by processWorkerResult)
      mockSpawn.mockResolvedValue({
        exitCode: 0,
        stdout: 'Task was cancelled by user.',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      // Start processMessage without awaiting — it will block on the worker deferred
      const processingDone = masterManager.processMessage(makeMessage('Fix auth bug'));

      // Poll until the worker appears in the registry as "running"
      let workerId: string | undefined;
      for (let attempt = 0; attempt < 200 && !workerId; attempt++) {
        await new Promise<void>((r) => setTimeout(r, 5));
        const running = masterManager.getWorkerRegistry().getRunningWorkers();
        if (running.length > 0) {
          workerId = running[0]!.id;
        }
      }
      expect(workerId, 'Worker should appear in registry as running').toBeDefined();

      // Route "stop <shortId>" through Router — no confirmation required for single-worker stop
      const shortId = workerId!.split('-').pop()!;
      await router.route(makeMessage(`stop ${shortId}`));

      // 1. Abort handle was invoked (SIGTERM sent to worker process)
      expect(mockAbort).toHaveBeenCalled();

      // 2. WorkerRegistry has stopped the worker (cancelled or failed after SIGTERM settles).
      //    killWorker() sets 'cancelled'; the spawnWorker() continuation may later set 'failed'
      //    when the deferred resolves. Either state confirms the worker was stopped.
      const worker = masterManager.getWorkerRegistry().getWorker(workerId!);
      expect(worker?.status).not.toBe('running');
      expect(worker?.status).not.toBe('pending');

      // 3. agent_activity updated in DB — worker no longer in the active-agents list
      const activeAgents = await memory.getActiveAgents();
      const workerInActive = activeAgents.find((a) => a.id === workerId);
      expect(workerInActive).toBeUndefined();

      // 4. Response sent back to the connector
      const stopResponse = connector.sentMessages.find((m) => m.content.includes('Stopped worker'));
      expect(stopResponse).toBeDefined();
      expect(stopResponse?.recipient).toBe('+1234567890');

      // Allow processMessage to complete now that the worker deferred has settled
      await processingDone;
    });

    it('sends a worker-cancelled progress broadcast when a worker is stopped', async () => {
      const mockAbort = vi.fn();
      let resolveWorker!: (result: AgentResult) => void;

      mockAbort.mockImplementation(() => {
        resolveWorker({
          exitCode: 143,
          stdout: '',
          stderr: 'Terminated',
          retryCount: 0,
          durationMs: 0,
        });
      });

      const workerDeferred = new Promise<AgentResult>((resolve) => {
        resolveWorker = resolve;
      });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[SPAWN:code-edit]{"prompt":"Build feature","model":"sonnet","retries":0}[/SPAWN]',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      mockSpawnWithHandle.mockImplementationOnce((_opts: unknown) => ({
        promise: workerDeferred,
        pid: 66666,
        abort: mockAbort,
      }));

      mockSpawn.mockResolvedValue({
        exitCode: 0,
        stdout: 'Understood. Task cancelled.',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const processingDone = masterManager.processMessage(makeMessage('Build feature'));

      let workerId: string | undefined;
      for (let attempt = 0; attempt < 200 && !workerId; attempt++) {
        await new Promise<void>((r) => setTimeout(r, 5));
        const running = masterManager.getWorkerRegistry().getRunningWorkers();
        if (running.length > 0) {
          workerId = running[0]!.id;
        }
      }
      expect(workerId).toBeDefined();

      const shortId = workerId!.split('-').pop()!;
      await router.route(makeMessage(`stop ${shortId}`));

      // Verify a worker-cancelled progress event was broadcast to the connector
      const cancelledEvent = connector.progressEvents.find(
        (e) => e.event.type === 'worker-cancelled',
      );
      expect(cancelledEvent).toBeDefined();

      await processingDone;
    });
  });

  // -------------------------------------------------------------------------
  // "stop all" confirmation flow
  // -------------------------------------------------------------------------

  describe('"stop all" confirmation flow', () => {
    it('issues a confirmation prompt for "stop all" when workers are running', async () => {
      let resolveWorker!: (result: AgentResult) => void;
      const workerDeferred = new Promise<AgentResult>((resolve) => {
        resolveWorker = resolve;
      });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout:
          '[SPAWN:code-edit]{"prompt":"Long running task","model":"sonnet","retries":0}[/SPAWN]',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      mockSpawnWithHandle.mockImplementationOnce((_opts: unknown) => ({
        promise: workerDeferred,
        pid: 77777,
        abort: vi.fn().mockImplementation(() => {
          resolveWorker({ exitCode: 143, stdout: '', stderr: '', retryCount: 0, durationMs: 0 });
        }),
      }));

      mockSpawn.mockResolvedValue({
        exitCode: 0,
        stdout: 'Workers stopped.',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const processingDone = masterManager.processMessage(makeMessage('Run long task'));

      // Wait for worker to start
      let workerId: string | undefined;
      for (let attempt = 0; attempt < 200 && !workerId; attempt++) {
        await new Promise<void>((r) => setTimeout(r, 5));
        const running = masterManager.getWorkerRegistry().getRunningWorkers();
        if (running.length > 0) workerId = running[0]!.id;
      }
      expect(workerId).toBeDefined();

      // Send "stop all" — should get a confirmation prompt, not immediate kill
      await router.route(makeMessage('stop all'));

      const confirmPrompt = connector.sentMessages.find(
        (m) => m.content.includes('confirm') && m.content.includes('30 seconds'),
      );
      expect(confirmPrompt).toBeDefined();

      // Worker should still be running (not yet killed)
      const worker = masterManager.getWorkerRegistry().getWorker(workerId!);
      expect(worker?.status).toBe('running');

      // Resolve worker to allow cleanup
      resolveWorker({ exitCode: 0, stdout: '', stderr: '', retryCount: 0, durationMs: 0 });
      await processingDone;
    });

    it('executes kill when "confirm" is sent within 30 seconds', async () => {
      let resolveWorker!: (result: AgentResult) => void;
      const mockAbort = vi.fn();

      mockAbort.mockImplementation(() => {
        resolveWorker({ exitCode: 143, stdout: '', stderr: '', retryCount: 0, durationMs: 0 });
      });

      const workerDeferred = new Promise<AgentResult>((resolve) => {
        resolveWorker = resolve;
      });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[SPAWN:code-edit]{"prompt":"Task to cancel","model":"sonnet","retries":0}[/SPAWN]',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      mockSpawnWithHandle.mockImplementationOnce((_opts: unknown) => ({
        promise: workerDeferred,
        pid: 88888,
        abort: mockAbort,
      }));

      mockSpawn.mockResolvedValue({
        exitCode: 0,
        stdout: 'All workers stopped.',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const processingDone = masterManager.processMessage(makeMessage('Run cancellable task'));

      // Wait for worker to start
      let workerId: string | undefined;
      for (let attempt = 0; attempt < 200 && !workerId; attempt++) {
        await new Promise<void>((r) => setTimeout(r, 5));
        const running = masterManager.getWorkerRegistry().getRunningWorkers();
        if (running.length > 0) workerId = running[0]!.id;
      }
      expect(workerId).toBeDefined();

      // Send "stop all" — triggers confirmation
      await router.route(makeMessage('stop all'));

      // Confirm within the 30-second window
      await router.route(makeMessage('confirm'));

      // Worker should now be stopped (cancelled or failed after SIGTERM settles)
      const worker = masterManager.getWorkerRegistry().getWorker(workerId!);
      expect(worker?.status).not.toBe('running');
      expect(worker?.status).not.toBe('pending');

      // Abort was called
      expect(mockAbort).toHaveBeenCalled();

      // Response should include stopped worker info
      const stopResponse = connector.sentMessages.find(
        (m) => m.content.includes('Stopped') || m.content.includes('stopped'),
      );
      expect(stopResponse).toBeDefined();

      await processingDone;
    });
  });
});
