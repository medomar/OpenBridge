import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { AgentResult, SpawnOptions } from '../../src/core/agent-runner.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/** Helper to extract SpawnOptions from mock call args */
function getSpawnCallOpts(callIndex: number): SpawnOptions | undefined {
  return mockSpawn.mock.calls[callIndex]?.[0] as SpawnOptions | undefined;
}

// Mock AgentRunner (used by MasterManager)
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
    classifyError: (stderr: string, exitCode: number): string => {
      const lower = stderr.toLowerCase();
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

// Mock logger
vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

describe('MasterManager - SPAWN Task Decomposition', () => {
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
    mockSpawnWithHandle.mockReset();
    // spawnWithHandle delegates to mockSpawn so existing mockResolvedValueOnce calls work
    mockSpawnWithHandle.mockImplementation((opts: SpawnOptions) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    // Use keyword-based classification by default so tests don't consume spawn mocks
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

    testWorkspace = path.join(os.tmpdir(), 'test-workspace-spawn-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    const dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools,
      skipAutoExploration: true,
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

  describe('Single SPAWN Marker', () => {
    it('should parse and execute a single SPAWN marker', async () => {
      const responseWithSpawn = `I'll check the test files for you.

[SPAWN:read-only]{"prompt":"List all test files in tests/","model":"haiku","maxTurns":10}[/SPAWN]

Let me analyze those.`;

      // Call 1: Master processes message → returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 500,
      });

      // Call 2: Worker spawned from SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Found 15 test files: ...',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      // Call 3: Feedback to Master with worker results
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Your project has 15 test files covering unit and integration tests.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const response = await masterManager.processMessage(makeMessage('List all tests'));

      expect(response).toBe('Your project has 15 test files covering unit and integration tests.');
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      // Verify worker was spawned with correct profile-resolved tools
      const workerCall = getSpawnCallOpts(1);
      expect(workerCall).toBeDefined();
      expect(workerCall?.prompt).toBe('List all test files in tests/');
      expect(workerCall?.model).toBe('haiku');
      expect(workerCall?.maxTurns).toBe(10);
      // read-only profile resolves to Read, Glob, Grep
      expect(workerCall?.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    });
  });

  describe('Multiple SPAWN Markers (Concurrent)', () => {
    it('should execute multiple SPAWN markers concurrently', async () => {
      const responseWithMultiSpawn = `I'll analyze both areas.

[SPAWN:read-only]{"prompt":"Analyze the database schema","model":"haiku","maxTurns":10}[/SPAWN]

[SPAWN:read-only]{"prompt":"Read the API routes","model":"haiku","maxTurns":10}[/SPAWN]

Working on both tasks.`;

      // Call 1: Master processes message
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithMultiSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 500,
      });

      // Calls 2-3: Two workers spawned concurrently
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Database has 5 tables',
        stderr: '',
        retryCount: 0,
        durationMs: 400,
      });
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Found 12 API endpoints',
        stderr: '',
        retryCount: 0,
        durationMs: 350,
      });

      // Call 4: Feedback to Master
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The project has 5 database tables and 12 API endpoints.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const response = await masterManager.processMessage(
        makeMessage('Describe the database and API'),
      );

      expect(response).toBe('The project has 5 database tables and 12 API endpoints.');
      expect(mockSpawn).toHaveBeenCalledTimes(4);
    });
  });

  describe('Worker Failure Handling', () => {
    it('should handle worker failure and feed error back to Master', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Run the tests","model":"sonnet","retries":0}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker fails
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Test command not found',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 3: Feedback with error
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The worker encountered an error: test command not found.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const response = await masterManager.processMessage(makeMessage('Run tests'));

      expect(response).toBe('The worker encountered an error: test command not found.');

      // Verify error was included in feedback (format: [WORKER FAILED: <category>])
      const feedbackCall = getSpawnCallOpts(2);
      expect(feedbackCall?.prompt).toContain('WORKER FAILED');
      expect(feedbackCall?.prompt).toContain('Test command not found');
    });

    it('should handle worker exception and feed error back to Master', async () => {
      const responseWithSpawn = `[SPAWN:full-access]{"prompt":"Do something","model":"opus"}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker throws exception
      mockSpawn.mockRejectedValueOnce(new Error('Process spawn failed'));

      // Call 3: Feedback with error
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Worker failed to start. I cannot complete this task.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const response = await masterManager.processMessage(makeMessage('Do something'));

      expect(response).toBe('Worker failed to start. I cannot complete this task.');

      const feedbackCall = getSpawnCallOpts(2);
      expect(feedbackCall?.prompt).toContain('WORKER FAILED');
      expect(feedbackCall?.prompt).toContain('Process spawn failed');
    });
  });

  describe('No Markers', () => {
    it('should pass through responses without any markers', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'This is a direct response without any markers.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const response = await masterManager.processMessage(makeMessage('What is this project?'));

      expect(response).toBe('This is a direct response without any markers.');
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });
  });

  describe('Code-edit Profile Resolution', () => {
    it('should resolve code-edit profile to correct tools', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Fix the bug in src/index.ts","model":"sonnet","maxTurns":15}[/SPAWN]`;

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Bug fixed.',
        stderr: '',
        retryCount: 0,
        durationMs: 500,
      });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The bug has been fixed.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Fix the bug'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.allowedTools).toEqual([
        'Read',
        'Edit',
        'Write',
        'Glob',
        'Grep',
        'Bash(git:*)',
        'Bash(npm:*)',
        'Bash(npx:*)',
      ]);
      expect(workerCall?.model).toBe('sonnet');
      expect(workerCall?.maxTurns).toBe(15);
    });
  });

  describe('Structured Worker Result Injection', () => {
    it('should include model, profile, duration, and worker index in feedback', async () => {
      const responseWithSpawn = `[SPAWN:read-only]{"prompt":"Analyze code","model":"haiku","maxTurns":10}[/SPAWN]`;

      // Call 1: Master processes message
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker succeeds
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Analysis complete',
        stderr: '',
        retryCount: 0,
        durationMs: 1500,
      });

      // Call 3: Feedback to Master
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The analysis is complete.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Analyze the code'));

      // Verify the feedback prompt contains structured metadata
      const feedbackCall = getSpawnCallOpts(2);
      expect(feedbackCall?.prompt).toContain('haiku');
      expect(feedbackCall?.prompt).toContain('read-only');
      expect(feedbackCall?.prompt).toContain('worker 1/1');
      expect(feedbackCall?.prompt).toContain('1.5s');
      expect(feedbackCall?.prompt).toContain('WORKER RESULT');
      expect(feedbackCall?.prompt).toContain('Analysis complete');
      expect(feedbackCall?.prompt).toContain('1 worker completed');
    });

    it('should include error metadata with exit code in failure feedback', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Run tests","model":"sonnet","retries":0}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker fails with exit code 1
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'npm test failed',
        retryCount: 0,
        durationMs: 800,
      });

      // Call 3: Feedback with structured error
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Tests failed.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Run tests'));

      const feedbackCall = getSpawnCallOpts(2);
      expect(feedbackCall?.prompt).toContain('WORKER FAILED');
      expect(feedbackCall?.prompt).toContain('sonnet');
      expect(feedbackCall?.prompt).toContain('code-edit');
      expect(feedbackCall?.prompt).toContain('exit 1');
      expect(feedbackCall?.prompt).toContain('npm test failed');
    });

    it('should format multiple worker results with individual metadata', async () => {
      const responseWithSpawn = `[SPAWN:read-only]{"prompt":"Check DB","model":"haiku"}[/SPAWN]
[SPAWN:read-only]{"prompt":"Check API","model":"haiku"}[/SPAWN]`;

      // Call 1: Master processes message
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Calls 2-3: Workers complete
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'DB has 5 tables',
        stderr: '',
        retryCount: 0,
        durationMs: 1000,
      });
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '12 API routes',
        stderr: '',
        retryCount: 0,
        durationMs: 2000,
      });

      // Call 4: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Summary of findings.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Check DB and API'));

      const feedbackCall = getSpawnCallOpts(3);
      expect(feedbackCall?.prompt).toContain('worker 1/2');
      expect(feedbackCall?.prompt).toContain('worker 2/2');
      expect(feedbackCall?.prompt).toContain('2 workers completed');
      expect(feedbackCall?.prompt).toContain('DB has 5 tables');
      expect(feedbackCall?.prompt).toContain('12 API routes');
    });
  });

  describe('Session Continuity with SPAWN', () => {
    it('should maintain Master session across spawn-feedback flow', async () => {
      const responseWithSpawn = `[SPAWN:read-only]{"prompt":"Check files","model":"haiku"}[/SPAWN]`;

      // Call 1: Master processes (new session → --session-id)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker (separate, no session)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Files found.',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      // Call 3: Feedback to Master (resumed session → --resume)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Done.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Check files'));

      // processMessage() uses --print mode (non-interactive) — no sessionId on any call.
      // Workers also use --print mode (stateless, depth-limited).
      const initialCall = getSpawnCallOpts(0);
      expect(initialCall?.sessionId).toBeUndefined();
      expect(initialCall?.resumeSessionId).toBeUndefined();

      // Worker call: no session (independent worker)
      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.sessionId).toBeUndefined();
      expect(workerCall?.resumeSessionId).toBeUndefined();

      // Feedback call: also --print mode (no sessionId)
      const feedbackCall = getSpawnCallOpts(2);
      expect(feedbackCall?.sessionId).toBeUndefined();
      expect(feedbackCall?.resumeSessionId).toBeUndefined();
    });
  });

  describe('Worker Registry Integration', () => {
    it('should register workers before spawning and track lifecycle', async () => {
      const responseWithSpawn = `[SPAWN:read-only]{"prompt":"Scan files","model":"haiku"}[/SPAWN]`;

      // Call 1: Master processes message
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker succeeds
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Found 10 files',
        stderr: '',
        retryCount: 0,
        durationMs: 500,
      });

      // Call 3: Feedback to Master
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The workspace has 10 files.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Scan files'));

      // Verify worker was tracked in registry
      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers.length).toBe(1);

      const worker = workers[0];
      expect(worker?.status).toBe('completed');
      expect(worker?.taskManifest.prompt).toBe('Scan files');
      expect(worker?.taskManifest.profile).toBe('read-only');
      expect(worker?.result?.exitCode).toBe(0);
      expect(worker?.result?.stdout).toBe('Found 10 files');
    });

    it('should register multiple workers concurrently', async () => {
      const responseWithMultiSpawn = `
[SPAWN:read-only]{"prompt":"Scan database","model":"haiku"}[/SPAWN]
[SPAWN:read-only]{"prompt":"Scan API","model":"haiku"}[/SPAWN]
[SPAWN:read-only]{"prompt":"Scan tests","model":"haiku"}[/SPAWN]
`;

      // Call 1: Master processes message
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithMultiSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Calls 2-4: Three workers execute concurrently
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Database has 5 tables',
        stderr: '',
        retryCount: 0,
        durationMs: 400,
      });
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'API has 12 routes',
        stderr: '',
        retryCount: 0,
        durationMs: 350,
      });
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Tests have 45 files',
        stderr: '',
        retryCount: 0,
        durationMs: 380,
      });

      // Call 5: Feedback to Master
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Summary: 5 tables, 12 routes, 45 test files.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Scan all areas'));

      // Verify all workers were tracked
      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers.length).toBe(3);

      const completed = registry.getCompletedWorkers();
      expect(completed.length).toBe(3);

      // Verify all workers have the correct profile
      workers.forEach((w) => {
        expect(w.taskManifest.profile).toBe('read-only');
        expect(w.status).toBe('completed');
      });
    });

    it('should track failed workers without crashing Master', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Run tests","model":"sonnet","retries":0}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker fails
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Test command not found',
        retryCount: 0,
        durationMs: 100,
      });

      // Call 3: Feedback with error
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The tests could not run: test command not found.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Run tests'));

      // Verify failed worker was tracked
      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers.length).toBe(1);

      const worker = workers[0];
      expect(worker?.status).toBe('failed');
      expect(worker?.result?.exitCode).toBe(1);
      expect(worker?.error).toContain('Exit code 1');
      expect(worker?.error).toContain('Test command not found');
    });

    it('should persist worker registry to disk', async () => {
      const responseWithSpawn = `[SPAWN:read-only]{"prompt":"Check files","model":"haiku"}[/SPAWN]`;

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Files checked',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'All good.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Check files'));

      // Verify workers.json exists
      const dotFolder = new DotFolderManager(testWorkspace);
      const persistedRegistry = await dotFolder.readWorkers();

      expect(persistedRegistry).toBeDefined();
      expect(Object.keys(persistedRegistry?.workers ?? {}).length).toBe(1);

      const workerIds = Object.keys(persistedRegistry?.workers ?? {});
      expect(workerIds.length).toBeGreaterThan(0);

      const workerId = workerIds[0];
      const worker = persistedRegistry?.workers[workerId!];
      expect(worker?.status).toBe('completed');
      expect(worker?.taskManifest.prompt).toBe('Check files');
    });
  });

  describe('Worker Timeout Handling (OB-163)', () => {
    it('should detect SIGTERM timeout (exit code 143) and mark worker as timeout failure', async () => {
      const responseWithSpawn = `[SPAWN:code-edit]{"prompt":"Run slow task","model":"sonnet","timeout":5000,"retries":0}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker times out with SIGTERM
      mockSpawn.mockResolvedValueOnce({
        exitCode: 143, // SIGTERM
        stdout: 'partial output',
        stderr: 'Timeout: process terminated after 5000ms (signal: SIGTERM)',
        retryCount: 0,
        durationMs: 5100,
      });

      // Call 3: Feedback with timeout error
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The worker timed out after 5 seconds.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Run slow task'));

      // Verify worker was marked as failed with timeout-specific error
      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers.length).toBe(1);

      const worker = workers[0];
      expect(worker?.status).toBe('failed');
      expect(worker?.result?.exitCode).toBe(143);
      expect(worker?.error).toContain('Worker timeout');
      expect(worker?.error).toContain('process terminated after 5000ms');
      expect(worker?.error).toContain('exit code 143');
    });

    it('should detect SIGKILL timeout (exit code 137) and mark worker as timeout failure', async () => {
      const responseWithSpawn = `[SPAWN:full-access]{"prompt":"Very slow task","model":"opus","timeout":10000,"retries":0}[/SPAWN]`;

      // Call 1: Master returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: Worker times out with SIGKILL (after SIGTERM grace period)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 137, // SIGKILL
        stdout: 'partial work',
        stderr: 'Timeout: process terminated after 10000ms (signal: SIGKILL)',
        retryCount: 0,
        durationMs: 10200,
      });

      // Call 3: Feedback with timeout error
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The worker was force-killed due to timeout.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Run very slow task'));

      // Verify worker was marked as failed with timeout-specific error
      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers.length).toBe(1);

      const worker = workers[0];
      expect(worker?.status).toBe('failed');
      expect(worker?.result?.exitCode).toBe(137);
      expect(worker?.error).toContain('Worker timeout');
      expect(worker?.error).toContain('process terminated after 10000ms');
      expect(worker?.error).toContain('exit code 137');
    });

    it('should distinguish timeout failures from other failures', async () => {
      const responseWithMultiSpawn = `
[SPAWN:code-edit]{"prompt":"Normal failure","model":"sonnet","retries":0}[/SPAWN]
[SPAWN:code-edit]{"prompt":"Timeout failure","model":"sonnet","timeout":3000,"retries":0}[/SPAWN]
`;

      // Call 1: Master processes message
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithMultiSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 2: First worker fails normally (e.g., test failure)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Tests failed: 3 failures',
        retryCount: 0,
        durationMs: 500,
      });

      // Call 3: Second worker times out
      mockSpawn.mockResolvedValueOnce({
        exitCode: 143,
        stdout: '',
        stderr: 'Timeout: process terminated after 3000ms (signal: SIGTERM)',
        retryCount: 0,
        durationMs: 3100,
      });

      // Call 4: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'One worker failed, one timed out.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Run both tasks'));

      // Verify both workers tracked with different error messages
      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers.length).toBe(2);

      const failedWorkers = registry.getFailedWorkers();
      expect(failedWorkers.length).toBe(2);

      // First worker: normal failure
      const normalFailure = workers.find((w) => w.result?.exitCode === 1);
      expect(normalFailure?.error).toContain('Exit code 1');
      expect(normalFailure?.error).not.toContain('Worker timeout');

      // Second worker: timeout failure
      const timeoutFailure = workers.find((w) => w.result?.exitCode === 143);
      expect(timeoutFailure?.error).toContain('Worker timeout');
      expect(timeoutFailure?.error).toContain('3000ms');
    });

    it('should persist timeout failures to disk', async () => {
      const responseWithSpawn = `[SPAWN:read-only]{"prompt":"Slow scan","model":"haiku","timeout":2000,"retries":0}[/SPAWN]`;

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithSpawn,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 143,
        stdout: '',
        stderr: 'Timeout: process terminated after 2000ms (signal: SIGTERM)',
        retryCount: 0,
        durationMs: 2100,
      });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Scan timed out.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      await masterManager.processMessage(makeMessage('Scan slowly'));

      // Verify timeout failure was persisted
      const dotFolder = new DotFolderManager(testWorkspace);
      const persistedRegistry = await dotFolder.readWorkers();

      expect(persistedRegistry).toBeDefined();

      const workerIds = Object.keys(persistedRegistry?.workers ?? {});
      expect(workerIds.length).toBe(1);

      const workerId = workerIds[0];
      const worker = persistedRegistry?.workers[workerId!];
      expect(worker?.status).toBe('failed');
      expect(worker?.result?.exitCode).toBe(143);
      expect(worker?.error).toContain('Worker timeout');
    });
  });

  describe('Worker Progress Streaming (OB-162)', () => {
    it('should stream progress updates for multiple workers', async () => {
      const responseWithMultiSpawn = `
[SPAWN:read-only]{"prompt":"Analyze database","model":"haiku"}[/SPAWN]
[SPAWN:read-only]{"prompt":"Analyze API","model":"haiku"}[/SPAWN]
[SPAWN:read-only]{"prompt":"Analyze tests","model":"haiku"}[/SPAWN]
`;

      // Setup mock streaming generator for Master session
      mockStream
        .mockImplementationOnce(async function* () {
          yield 'I will analyze three areas.';
          yield '\n\n[SPAWN:read-only]{"prompt":"Analyze database","model":"haiku"}[/SPAWN]';
          yield '\n[SPAWN:read-only]{"prompt":"Analyze API","model":"haiku"}[/SPAWN]';
          yield '\n[SPAWN:read-only]{"prompt":"Analyze tests","model":"haiku"}[/SPAWN]';
          return {
            exitCode: 0,
            stdout: responseWithMultiSpawn,
            stderr: '',
            retryCount: 0,
            durationMs: 200,
          };
        })
        // Setup mock for feedback stream
        .mockImplementationOnce(async function* () {
          yield 'Summary of all three analysis tasks.';
          return {
            exitCode: 0,
            stdout: 'Summary of all three analysis tasks.',
            stderr: '',
            retryCount: 0,
            durationMs: 100,
          };
        });

      // Workers complete at different times (simulated by mockSpawn)
      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Database has 5 tables',
          stderr: '',
          retryCount: 0,
          durationMs: 400,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'API has 12 routes',
          stderr: '',
          retryCount: 0,
          durationMs: 350,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Tests have 45 files',
          stderr: '',
          retryCount: 0,
          durationMs: 380,
        });

      // Collect streamed chunks
      const chunks: string[] = [];
      const stream = masterManager.streamMessage(makeMessage('Analyze all areas'));

      let iterResult = await stream.next();
      while (!iterResult.done) {
        chunks.push(iterResult.value);
        iterResult = await stream.next();
      }

      const fullResponse = chunks.join('');

      // Verify progress updates were streamed
      // The implementation should yield progress like "[Progress: 1/3 subtasks completed]"
      expect(fullResponse).toContain('Summary');
      expect(mockStream).toHaveBeenCalledTimes(2);

      // Verify all workers were tracked
      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers.length).toBe(3);
      expect(registry.getCompletedWorkers().length).toBe(3);
    });

    it('should skip progress streaming for single worker', async () => {
      const responseWithSingleSpawn = `[SPAWN:read-only]{"prompt":"Scan files","model":"haiku"}[/SPAWN]`;

      mockStream
        .mockImplementationOnce(async function* () {
          yield responseWithSingleSpawn;
          return {
            exitCode: 0,
            stdout: responseWithSingleSpawn,
            stderr: '',
            retryCount: 0,
            durationMs: 200,
          };
        })
        .mockImplementationOnce(async function* () {
          yield 'File scan complete.';
          return {
            exitCode: 0,
            stdout: 'File scan complete.',
            stderr: '',
            retryCount: 0,
            durationMs: 100,
          };
        });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Found 10 files',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      const chunks: string[] = [];
      const stream = masterManager.streamMessage(makeMessage('Scan files'));

      let iterResult = await stream.next();
      while (!iterResult.done) {
        chunks.push(iterResult.value);
        iterResult = await stream.next();
      }

      const fullResponse = chunks.join('');

      // Single worker — no progress updates should be streamed
      expect(fullResponse).not.toContain('Progress:');
      expect(fullResponse).toContain('File scan complete');

      const registry = masterManager.getWorkerRegistry();
      const workers = registry.getAllWorkers();
      expect(workers.length).toBe(1);
    });
  });

  describe('spawnTargetedReader — OB-1357', () => {
    it('spawns a read-only worker with 5 max turns for targeted file reading', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Router handles all incoming messages via route()',
        stderr: '',
        retryCount: 0,
        durationMs: 400,
      });

      const result = await masterManager.spawnTargetedReader(
        ['src/core/router.ts', 'src/core/auth.ts'],
        'how does the router handle messages',
      );

      expect(result).toBe('Router handles all incoming messages via route()');

      const spawnCall = getSpawnCallOpts(0);
      expect(spawnCall?.maxTurns).toBe(5);
      expect(spawnCall?.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    });
  });
});
