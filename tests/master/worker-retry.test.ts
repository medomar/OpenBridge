import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';
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
        lower.includes('context_length') ||
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

    it('should default to 2 retries when retries not specified in SPAWN body (OB-905)', async () => {
      const responseWithSpawn = `[SPAWN:read-only]{"prompt":"Read files","model":"haiku"}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker fails (attempt 1 of 3) — classified as 'crash' (retryable)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Transient error',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 3: Worker fails (retry 1 of 2)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Transient error',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 4: Worker fails (retry 2 of 2 — exhausted)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Transient error',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 5: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Worker failed after retries.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Read files'));

      const registry = masterManager.getWorkerRegistry();
      const worker = registry.getAllWorkers()[0];
      expect(worker?.status).toBe('failed');
      expect(worker?.workerRetries).toBe(2); // default 2 retries exhausted
    });
  });

  describe('Non-Retryable Failures', () => {
    it('should retry on timeout (SIGTERM exit code 143) (OB-905)', async () => {
      // timeout is classified as a retryable error category (OB-904/OB-905)
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Slow task","model":"sonnet","retries":1,"timeout":5000}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker times out with SIGTERM — classified as 'timeout' (retryable)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 143,
        stdout: 'partial output',
        stderr: 'Timeout: process terminated',
        retryCount: 0,
        durationMs: 5100,
      });

      // Call 3: Retry succeeds
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Task completed on retry.',
        stderr: '',
        retryCount: 0,
        durationMs: 4000,
      });

      // Call 4: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Worker succeeded after timeout retry.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Run slow task'));

      // 4 calls: Master + Worker (timeout) + Retry (success) + Feedback
      expect(mockSpawn).toHaveBeenCalledTimes(4);

      const registry = masterManager.getWorkerRegistry();
      const worker = registry.getAllWorkers()[0];
      expect(worker?.status).toBe('completed');
      expect(worker?.workerRetries).toBe(1);
    });

    it('should retry on SIGKILL (exit code 137) (OB-905)', async () => {
      // exit code 137 is classified as 'timeout' (retryable) by classifyError
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"OOM task","model":"sonnet","retries":1}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker killed with SIGKILL — classified as 'timeout' (retryable)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 137,
        stdout: '',
        stderr: 'Killed',
        retryCount: 0,
        durationMs: 3000,
      });

      // Call 3: Retry succeeds
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Task completed on retry.',
        stderr: '',
        retryCount: 0,
        durationMs: 2000,
      });

      // Call 4: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Worker succeeded after SIGKILL retry.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Run OOM task'));

      // 4 calls: Master + Worker (SIGKILL) + Retry (success) + Feedback
      expect(mockSpawn).toHaveBeenCalledTimes(4);

      const registry = masterManager.getWorkerRegistry();
      const worker = registry.getAllWorkers()[0];
      expect(worker?.status).toBe('completed');
      expect(worker?.workerRetries).toBe(1);
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

  describe('Turn-Escalation Retry (OB-903)', () => {
    it('should re-spawn with 1.5x turns when turnsExhausted=true', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Fix the bug","model":"sonnet","maxTurns":10}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker hits max-turns (exits 0 but turnsExhausted=true)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Partial output — analyzed 5 of 10 files.',
        stderr: '',
        retryCount: 0,
        durationMs: 800,
        turnsExhausted: true,
      });

      // Call 3: Turn-escalation retry succeeds
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Bug fixed — all 10 files analyzed.',
        stderr: '',
        retryCount: 0,
        durationMs: 600,
      });

      // Call 4: Feedback to Master
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Done.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Fix the bug'));

      // Master (1) + Worker hits turns (2) + Escalation retry (3) + Feedback (4)
      expect(mockSpawn).toHaveBeenCalledTimes(4);

      // Verify escalation call used ceil(10 * 1.5) = 15 turns
      const escalationCall = mockSpawn.mock.calls[2] as [SpawnOptions];
      expect(escalationCall[0].maxTurns).toBe(15);
    });

    it('should include partial output as context in the escalation prompt', async () => {
      const responseWithSpawn = `[SPAWN:read-only]{"prompt":"Analyze files","model":"haiku","maxTurns":8}[/SPAWN]`;

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: responseWithSpawn,
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Analyzed: file1.ts, file2.ts. [INCOMPLETE: step 2/4]',
          stderr: '',
          retryCount: 0,
          durationMs: 400,
          turnsExhausted: true,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Analysis complete.',
          stderr: '',
          retryCount: 0,
          durationMs: 400,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Files analyzed.',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });

      await masterManager.processMessage(makeMessage('Analyze files'));

      const escalationCall = mockSpawn.mock.calls[2] as [SpawnOptions];
      const escalationPrompt: string = escalationCall[0].prompt;

      // Should include original prompt
      expect(escalationPrompt).toContain('Analyze files');
      // Should include partial output context
      expect(escalationPrompt).toContain('CONTEXT FROM PREVIOUS ATTEMPT');
      expect(escalationPrompt).toContain('Analyzed: file1.ts, file2.ts');
      // Should extract and use the INCOMPLETE marker hint
      expect(escalationPrompt).toContain('step 2/4');
    });

    it('should cap escalated turns at 50', async () => {
      // maxTurns=40 → 40 * 1.5 = 60 → capped at 50
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Big task","model":"opus","maxTurns":40}[/SPAWN]`;

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: responseWithSpawn,
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Partial...',
          stderr: '',
          retryCount: 0,
          durationMs: 1000,
          turnsExhausted: true,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Done.',
          stderr: '',
          retryCount: 0,
          durationMs: 500,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Complete.',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });

      await masterManager.processMessage(makeMessage('Run big task'));

      const escalationCall = mockSpawn.mock.calls[2] as [SpawnOptions];
      expect(escalationCall[0].maxTurns).toBe(50); // capped at 50
    });

    it('should only do ONE turn-escalation retry even if escalation also exhausts turns', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Huge task","model":"sonnet","maxTurns":10}[/SPAWN]`;

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: responseWithSpawn,
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Partial output A.',
          stderr: '',
          retryCount: 0,
          durationMs: 800,
          turnsExhausted: true,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Partial output B (still incomplete).',
          stderr: '',
          retryCount: 0,
          durationMs: 1000,
          turnsExhausted: true,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Task ran out of turns.',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });

      await masterManager.processMessage(makeMessage('Run huge task'));

      // Master (1) + Worker (2) + Escalation (3) + Feedback (4) — no second escalation
      expect(mockSpawn).toHaveBeenCalledTimes(4);
    });

    it('should NOT escalate when turnsExhausted is false', async () => {
      const responseWithSpawn = `[SPAWN:read-only]{"prompt":"Quick read","model":"haiku","maxTurns":5}[/SPAWN]`;

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: responseWithSpawn,
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Read complete.',
          stderr: '',
          retryCount: 0,
          durationMs: 200,
          // turnsExhausted not set (undefined / falsy)
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Done.',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });

      await masterManager.processMessage(makeMessage('Quick read'));

      // Only 3 calls: Master + Worker (no escalation) + Feedback
      expect(mockSpawn).toHaveBeenCalledTimes(3);
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
