import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Mock AgentRunner (used by MasterManager)
const mockSpawn = vi.fn();
const mockStream = vi.fn();
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

// Mock logger
vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('MasterManager - Worker-Level Retry', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;

  const masterTool: DiscoveredTool = {
    name: 'claude',
    path: '/usr/local/bin/claude',
    version: '1.0.0',
    available: true,
    role: 'master',
    capabilities: ['general'],
  };

  const discoveredTools: DiscoveredTool[] = [masterTool];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Use keyword-based classification by default
    vi.spyOn(MasterManager.prototype, 'classifyTask').mockImplementation(
      async (content: string) => {
        const lower = content.toLowerCase();
        if (
          ['implement', 'build', 'refactor', 'develop', 'set up', 'setup'].some((kw) =>
            lower.includes(kw),
          )
        )
          return 'complex-task';
        if (
          ['generate', 'create', 'write', 'fix', 'update file', 'add to', 'make a'].some((kw) =>
            lower.includes(kw),
          )
        )
          return 'tool-use';
        return 'quick-answer';
      },
    );

    testWorkspace = path.join(process.cwd(), 'test-workspace-retry-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    const dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools,
      skipAutoExploration: true,
      workerRetryDelayMs: 0, // No delay in tests
    });

    await masterManager.start();
  });

  afterEach(async () => {
    await masterManager.shutdown();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  function makeMessage(content: string): InboundMessage {
    return {
      id: 'msg-' + Date.now(),
      content,
      rawContent: '/ai ' + content,
      sender: '+1234567890',
      source: 'whatsapp',
      timestamp: new Date(),
    };
  }

  describe('Retryable Failures', () => {
    it('should retry a worker on transient failure (non-zero exit, not timeout)', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Fix the bug","model":"sonnet","retries":2}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker fails first attempt (transient)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Temporary API error',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 3: Worker succeeds on retry
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Bug fixed successfully',
        stderr: '',
        retryCount: 0,
        durationMs: 500,
      });

      // Call 4: Feedback to Master
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The bug has been fixed.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const response = await masterManager.processMessage(makeMessage('Fix the bug'));

      expect(response).toBe('The bug has been fixed.');
      // Master (1) + Worker attempt 1 (2) + Worker retry (3) + Feedback (4)
      expect(mockSpawn).toHaveBeenCalledTimes(4);

      // Verify worker was marked as completed (retry succeeded)
      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers.length).toBe(1);

      const worker = workers[0];
      expect(worker?.status).toBe('completed');
      expect(worker?.workerRetries).toBe(1);
    });

    it('should exhaust retries and mark worker as failed', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Flaky task","model":"sonnet","retries":2}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker fails (attempt 1 of 3)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: connection reset',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 3: Worker fails (retry 1 of 2)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: connection reset',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 4: Worker fails (retry 2 of 2 — exhausted)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: connection reset',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 5: Feedback with all failures
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The worker failed after multiple attempts.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const response = await masterManager.processMessage(makeMessage('Run flaky task'));

      expect(response).toBe('The worker failed after multiple attempts.');

      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers.length).toBe(1);

      const worker = workers[0];
      expect(worker?.status).toBe('failed');
      expect(worker?.workerRetries).toBe(2);
    });

    it('should default to 0 retries when retries not specified in SPAWN body', async () => {
      const responseWithSpawn = `[SPAWN:read-only]{"prompt":"Read files","model":"haiku"}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker fails — no retry (default retries = 0)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Transient error',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 3: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Worker failed.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Read files'));

      const registry = masterManager.getWorkerRegistry();
      const worker = registry.getAllWorkers()[0];
      expect(worker?.status).toBe('failed');
      expect(worker?.workerRetries).toBe(0); // default 0 retries
    });
  });

  describe('Non-Retryable Failures', () => {
    it('should NOT retry on timeout (SIGTERM exit code 143)', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Slow task","model":"sonnet","retries":3,"timeout":5000}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker times out with SIGTERM — should NOT retry
      mockSpawn.mockResolvedValueOnce({
        exitCode: 143,
        stdout: 'partial output',
        stderr: 'Timeout: process terminated',
        retryCount: 0,
        durationMs: 5100,
      });

      // Call 3: Feedback (no retry calls in between)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Worker timed out.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Run slow task'));

      // Only 3 calls: Master + Worker (no retry) + Feedback
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      const registry = masterManager.getWorkerRegistry();
      const worker = registry.getAllWorkers()[0];
      expect(worker?.status).toBe('failed');
      expect(worker?.workerRetries).toBe(0);
    });

    it('should NOT retry on SIGKILL (exit code 137)', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"OOM task","model":"sonnet","retries":3}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker killed with SIGKILL — should NOT retry
      mockSpawn.mockResolvedValueOnce({
        exitCode: 137,
        stdout: '',
        stderr: 'Killed',
        retryCount: 0,
        durationMs: 3000,
      });

      // Call 3: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Worker was killed.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Run OOM task'));

      expect(mockSpawn).toHaveBeenCalledTimes(3);

      const registry = masterManager.getWorkerRegistry();
      const worker = registry.getAllWorkers()[0];
      expect(worker?.status).toBe('failed');
      expect(worker?.workerRetries).toBe(0);
    });

    it('should NOT retry on context overflow (dead session pattern)', async () => {
      const responseWithSpawn = `[SPAWN:full-access]{"prompt":"Huge task","model":"opus","retries":3}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker hits context overflow — should NOT retry
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: context window exceeded, too many tokens in conversation',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 3: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Task too large for context window.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Run huge task'));

      // Only 3 calls: Master + Worker (no retry) + Feedback
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      const registry = masterManager.getWorkerRegistry();
      const worker = registry.getAllWorkers()[0];
      expect(worker?.status).toBe('failed');
      expect(worker?.workerRetries).toBe(0);
    });
  });

  describe('Worker Retry Metadata', () => {
    it('should record workerRetries in the worker record and persist to disk', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Flaky fix","model":"sonnet","retries":2}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker fails first attempt
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Transient error',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 3: Worker succeeds on retry
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Fixed!',
        stderr: '',
        retryCount: 0,
        durationMs: 400,
      });

      // Call 4: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Done.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Fix flaky thing'));

      // Check worker registry in memory
      const registry = masterManager.getWorkerRegistry();
      const worker = registry.getAllWorkers()[0];
      expect(worker?.workerRetries).toBe(1);
      expect(worker?.status).toBe('completed');

      // Check persisted worker registry on disk
      const dotFolder = new DotFolderManager(testWorkspace);
      const persistedRegistry = await dotFolder.readWorkers();
      const workerIds = Object.keys(persistedRegistry?.workers ?? {});
      const persistedWorker = persistedRegistry?.workers[workerIds[0]!];
      expect(persistedWorker?.workerRetries).toBe(1);
    });
  });
});
