/**
 * E2E test: stop all with confirmation — 3 workers (OB-886)
 *
 * Spawns 3 mock workers concurrently, sends "stop all" via console, verifies the
 * confirmation prompt, sends "confirm", verifies all 3 workers are cancelled, and
 * verifies broadcast notifications are sent to all connected connectors.
 *
 * Uses:
 *  - Real SQLite MemoryManager (temp file on disk)
 *  - Mock AgentRunner (mockSpawn + mockSpawnWithHandle)
 *  - MasterManager with skipAutoExploration=true
 *  - Router + two named TestConnectors to verify multi-connector broadcast
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { MasterManager } from '../../src/master/master-manager.js';
import { Router } from '../../src/core/router.js';
import { MemoryManager } from '../../src/memory/index.js';
import type { Connector, ConnectorEvents } from '../../src/types/connector.js';
import type { OutboundMessage, ProgressEvent } from '../../src/types/message.js';
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
      return {
        prompt: manifest.prompt,
        workspacePath: manifest.workspacePath,
        model: manifest.model,
        allowedTools,
        maxTurns: manifest.maxTurns,
        timeout: manifest.timeout,
        retries: manifest.retries,
        retryDelay: manifest.retryDelay,
      };
    },
  };
});

// ---------------------------------------------------------------------------
// TestConnector — lightweight Connector with a configurable name
// ---------------------------------------------------------------------------

class TestConnector implements Connector {
  readonly sentMessages: OutboundMessage[] = [];
  readonly progressEvents: Array<{ event: ProgressEvent; chatId: string }> = [];
  private connected = false;
  private readonly listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  constructor(readonly name: string) {}

  async initialize(): Promise<void> {
    this.connected = true;
    this.emit('ready');
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {}

  async sendProgress(event: ProgressEvent, chatId: string): Promise<void> {
    this.progressEvents.push({ event, chatId });
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener as (...args: unknown[]) => void);
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners[event];
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }
}

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

function makeMessage(content: string, sender = '+1234567890'): InboundMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    content,
    rawContent: `/ai ${content}`,
    sender,
    source: 'console',
    timestamp: new Date(),
  };
}

/** Master response with 3 SPAWN markers — simulates Master spawning 3 workers. */
const MASTER_SPAWN_THREE = [
  '[SPAWN:code-edit]{"prompt":"Fix auth bug","model":"sonnet","retries":0}[/SPAWN]',
  '[SPAWN:code-edit]{"prompt":"Write unit tests","model":"sonnet","retries":0}[/SPAWN]',
  '[SPAWN:code-edit]{"prompt":"Update documentation","model":"sonnet","retries":0}[/SPAWN]',
].join('\n');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('E2E: stop all with confirmation — 3 workers (OB-886)', () => {
  let testWorkspace: string;
  let memory: MemoryManager;
  let masterManager: MasterManager;
  let router: Router;
  let consoleConnector: TestConnector;
  let secondaryConnector: TestConnector;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawnWithHandle.mockReset();

    // Default mockSpawnWithHandle delegates to mockSpawn
    mockSpawnWithHandle.mockImplementation((opts: Parameters<typeof mockSpawn>[0]) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    testWorkspace = path.join(
      os.tmpdir(),
      `ob-stop-all-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    await fs.mkdir(testWorkspace, { recursive: true });

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

    // Two connectors to verify broadcast reaches all channels
    router = new Router('console');
    consoleConnector = new TestConnector('console');
    secondaryConnector = new TestConnector('secondary');
    await consoleConnector.initialize();
    await secondaryConnector.initialize();
    router.addConnector(consoleConnector);
    router.addConnector(secondaryConnector);
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
  // Core scenario: 3 workers, stop all → confirm → all cancelled + broadcast
  // -------------------------------------------------------------------------

  it('cancels all 3 running workers and broadcasts to all connectors after confirmation', async () => {
    // Build 3 deferred promises and abort handles (one per worker)
    const resolvers: Array<(result: AgentResult) => void> = [];
    const aborts = [vi.fn(), vi.fn(), vi.fn()];

    for (let i = 0; i < 3; i++) {
      const idx = i;
      const deferred = new Promise<AgentResult>((resolve) => {
        resolvers[idx] = resolve;
      });
      aborts[idx].mockImplementation(() => {
        resolvers[idx]!({
          exitCode: 143,
          stdout: '',
          stderr: 'Terminated',
          retryCount: 0,
          durationMs: 0,
        });
      });
      mockSpawnWithHandle.mockImplementationOnce((_opts: unknown) => ({
        promise: deferred,
        pid: 10000 + idx,
        abort: aborts[idx],
      }));
    }

    // Master returns 3 SPAWN markers for the first message
    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: MASTER_SPAWN_THREE,
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    // Master acknowledgment after workers settle
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'All tasks processed.',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    // Start processMessage — blocks until all workers settle
    const processingDone = masterManager.processMessage(makeMessage('Do all three tasks'));

    // Wait for all 3 workers to appear in the registry as running
    let workerIds: string[] = [];
    for (let attempt = 0; attempt < 400 && workerIds.length < 3; attempt++) {
      await new Promise<void>((r) => setTimeout(r, 5));
      const running = masterManager.getWorkerRegistry().getRunningWorkers();
      workerIds = running.map((w) => w.id);
    }
    expect(workerIds, 'Expected 3 workers to be running before stop all').toHaveLength(3);

    // Send "stop all" — should issue a confirmation prompt, NOT execute kills yet
    await router.route(makeMessage('stop all'));

    // Verify confirmation prompt was sent on the console connector
    const confirmPrompt = consoleConnector.sentMessages.find(
      (m) => m.content.includes('confirm') && m.content.includes('30 seconds'),
    );
    expect(confirmPrompt, 'Expected a confirmation prompt for "stop all"').toBeDefined();
    expect(confirmPrompt!.content).toContain('3'); // prompt must mention worker count

    // All 3 workers must still be running (no kill yet)
    const stillRunning = masterManager.getWorkerRegistry().getRunningWorkers();
    expect(stillRunning).toHaveLength(3);

    // No abort handle invoked yet
    for (const abort of aborts) {
      expect(abort).not.toHaveBeenCalled();
    }

    // Send "confirm" within the 30-second window
    await router.route(makeMessage('confirm'));

    // All 3 workers should now be stopped
    for (const workerId of workerIds) {
      const worker = masterManager.getWorkerRegistry().getWorker(workerId);
      expect(worker?.status, `Worker ${workerId} should not be running`).not.toBe('running');
      expect(worker?.status, `Worker ${workerId} should not be pending`).not.toBe('pending');
    }

    // All 3 abort handles were called (SIGTERM sent to each process)
    for (let i = 0; i < 3; i++) {
      expect(aborts[i], `abort[${i}] should have been called`).toHaveBeenCalled();
    }

    // Response sent back to the console connector after confirmation
    const stopResponse = consoleConnector.sentMessages.find((m) =>
      m.content.toLowerCase().includes('stopped'),
    );
    expect(stopResponse, 'Expected a stop confirmation response').toBeDefined();

    // Each connector should have received exactly 3 worker-cancelled progress events
    const cancelledEvents1 = consoleConnector.progressEvents.filter(
      (e) => e.event.type === 'worker-cancelled',
    );
    const cancelledEvents2 = secondaryConnector.progressEvents.filter(
      (e) => e.event.type === 'worker-cancelled',
    );
    expect(cancelledEvents1, 'consoleConnector should receive 3 cancelled events').toHaveLength(3);
    expect(cancelledEvents2, 'secondaryConnector should receive 3 cancelled events').toHaveLength(
      3,
    );

    // Each event should carry the correct cancelledBy value
    for (const { event } of cancelledEvents1) {
      if (event.type === 'worker-cancelled') {
        expect(event.cancelledBy).toBe('+1234567890');
      }
    }

    await processingDone;
  });

  // -------------------------------------------------------------------------
  // Confirmation prompt: shows "stop all" text without immediate kill
  // -------------------------------------------------------------------------

  it('does not kill workers immediately — requires explicit confirmation', async () => {
    let resolveWorker!: (result: AgentResult) => void;
    const mockAbort = vi.fn().mockImplementation(() => {
      resolveWorker({ exitCode: 143, stdout: '', stderr: '', retryCount: 0, durationMs: 0 });
    });

    const workerDeferred = new Promise<AgentResult>((resolve) => {
      resolveWorker = resolve;
    });

    mockSpawnWithHandle.mockImplementationOnce((_opts: unknown) => ({
      promise: workerDeferred,
      pid: 55555,
      abort: mockAbort,
    }));

    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout:
        '[SPAWN:code-edit]{"prompt":"Long running task","model":"sonnet","retries":0}[/SPAWN]',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'Task response.',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    const processingDone = masterManager.processMessage(makeMessage('Start long running task'));

    // Wait for worker to appear
    let workerId: string | undefined;
    for (let attempt = 0; attempt < 200 && !workerId; attempt++) {
      await new Promise<void>((r) => setTimeout(r, 5));
      const running = masterManager.getWorkerRegistry().getRunningWorkers();
      if (running.length > 0) workerId = running[0]!.id;
    }
    expect(workerId).toBeDefined();

    // Send "stop all" — should get confirmation prompt
    await router.route(makeMessage('stop all'));

    // Abort should NOT have been called (confirmation pending)
    expect(mockAbort).not.toHaveBeenCalled();

    // Worker should still be running
    const worker = masterManager.getWorkerRegistry().getWorker(workerId!);
    expect(worker?.status).toBe('running');

    // Resolve worker to allow cleanup
    resolveWorker({ exitCode: 0, stdout: '', stderr: '', retryCount: 0, durationMs: 0 });
    await processingDone;
  });

  // -------------------------------------------------------------------------
  // Timeout: confirmation request expires after 30 seconds
  // -------------------------------------------------------------------------

  it('rejects "confirm" after the 30-second window has expired', async () => {
    let resolveWorker!: (result: AgentResult) => void;
    const mockAbort = vi.fn().mockImplementation(() => {
      resolveWorker({ exitCode: 143, stdout: '', stderr: '', retryCount: 0, durationMs: 0 });
    });

    const workerDeferred = new Promise<AgentResult>((resolve) => {
      resolveWorker = resolve;
    });

    mockSpawnWithHandle.mockImplementationOnce((_opts: unknown) => ({
      promise: workerDeferred,
      pid: 33333,
      abort: mockAbort,
    }));

    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: '[SPAWN:code-edit]{"prompt":"Slow task","model":"sonnet","retries":0}[/SPAWN]',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'Task response.',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    const processingDone = masterManager.processMessage(makeMessage('Run slow task'));

    // Wait for worker to appear
    let workerId: string | undefined;
    for (let attempt = 0; attempt < 200 && !workerId; attempt++) {
      await new Promise<void>((r) => setTimeout(r, 5));
      const running = masterManager.getWorkerRegistry().getRunningWorkers();
      if (running.length > 0) workerId = running[0]!.id;
    }
    expect(workerId).toBeDefined();

    // Send "stop all" — triggers confirmation
    await router.route(makeMessage('stop all'));

    const confirmPrompt = consoleConnector.sentMessages.find(
      (m) => m.content.includes('confirm') && m.content.includes('30 seconds'),
    );
    expect(confirmPrompt).toBeDefined();

    // Advance Date.now() by 31 seconds so the confirmation expires
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);

    try {
      // Send "confirm" after the window has expired — should get an expiry message
      await router.route(makeMessage('confirm'));
    } finally {
      dateSpy.mockRestore();
    }

    // Should receive an expiry message, not a stop confirmation
    const expiredMsg = consoleConnector.sentMessages.find(
      (m) =>
        m.content.toLowerCase().includes('expir') || m.content.toLowerCase().includes('timed out'),
    );
    expect(expiredMsg, 'Expected an expiry message after 30-second timeout').toBeDefined();

    // Worker should still be running (abort was NOT called)
    expect(mockAbort).not.toHaveBeenCalled();
    const worker = masterManager.getWorkerRegistry().getWorker(workerId!);
    expect(worker?.status).toBe('running');

    // Cleanup
    resolveWorker({ exitCode: 0, stdout: '', stderr: '', retryCount: 0, durationMs: 0 });
    await processingDone;
  });

  // -------------------------------------------------------------------------
  // No workers: "stop all" without any running workers is handled gracefully
  // -------------------------------------------------------------------------

  it('responds immediately with "No workers running" for "stop all" when no workers exist', async () => {
    await router.route(makeMessage('stop all'));

    const response = consoleConnector.sentMessages.find((m) =>
      m.content.includes('No workers are currently running'),
    );
    expect(response).toBeDefined();
    expect(response?.recipient).toBe('+1234567890');
  });
});
