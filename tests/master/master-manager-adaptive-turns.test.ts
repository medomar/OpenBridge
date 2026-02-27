import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { AgentResult, SpawnOptions } from '../../src/core/agent-runner.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ── Mock AgentRunner ────────────────────────────────────────────────

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
        lower.includes('too many tokens')
      )
        return 'context-overflow';
      if (lower.includes('invalid api key') || lower.includes('unauthorized')) return 'auth';
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

// ── Mock logger ─────────────────────────────────────────────────────

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Helpers ─────────────────────────────────────────────────────────

function getSpawnCallOpts(callIndex: number): SpawnOptions | undefined {
  return mockSpawn.mock.calls[callIndex]?.[0] as SpawnOptions | undefined;
}

// ── Suite ───────────────────────────────────────────────────────────

describe('MasterManager — Adaptive Max-Turns (OB-909)', () => {
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

  beforeEach(async () => {
    // clearAllMocks() resets call history but NOT queued mockResolvedValueOnce values.
    // mockReset() also clears the queue, preventing bleed between tests.
    vi.clearAllMocks();
    mockSpawn.mockReset();
    mockStream.mockReset();
    mockSpawnWithHandle.mockReset();
    // spawnWithHandle delegates to mockSpawn so existing mockResolvedValueOnce calls work
    mockSpawnWithHandle.mockImplementation((opts: SpawnOptions) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue('tool-use');

    testWorkspace = path.join(process.cwd(), 'test-workspace-adaptive-turns-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    const dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();

    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    await masterManager.start();
  });

  afterEach(async () => {
    await masterManager.shutdown();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
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

  /** Set up 3 sequential mock spawn results for a single-worker flow. */
  function setupSingleWorkerMocks(masterResponse: string): void {
    // Call 0: Master processes user message → returns SPAWN marker
    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: masterResponse,
      stderr: '',
      retryCount: 0,
      durationMs: 200,
    });
    // Call 1: Worker executes and completes
    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'Worker done.',
      stderr: '',
      retryCount: 0,
      durationMs: 300,
    });
    // Call 2: Feedback injected back into Master
    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'Done.',
      stderr: '',
      retryCount: 0,
      durationMs: 200,
    });
  }

  // ── Prompt length scaling ──────────────────────────────────────────

  describe('Prompt length scaling', () => {
    it('scales maxTurns for code-edit profile: baseline(15) + ceil(2000/1000)=2 → 17', async () => {
      // code-edit baseline = 15, 2000-char prompt → extra = 2 → adaptive = 17
      const prompt = 'A'.repeat(2000);
      const marker = `[SPAWN:code-edit]${JSON.stringify({ prompt, model: 'sonnet' })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(17);
    });

    it('scales maxTurns for read-only profile: baseline(10) + ceil(5000/1000)=5 → 15', async () => {
      // read-only baseline = 10, 5000-char prompt → extra = 5 → adaptive = 15
      const prompt = 'B'.repeat(5000);
      const marker = `[SPAWN:read-only]${JSON.stringify({ prompt, model: 'haiku' })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(15);
    });

    it('scales maxTurns for full-access profile: baseline(15) + ceil(3000/1000)=3 → 18', async () => {
      // full-access baseline = 15, 3000-char prompt → extra = 3 → adaptive = 18
      const prompt = 'C'.repeat(3000);
      const marker = `[SPAWN:full-access]${JSON.stringify({ prompt, model: 'opus' })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(18);
    });

    it('adds 1 turn for a minimal valid prompt (ceil always rounds a non-zero fraction up)', async () => {
      // code-edit baseline = 15, 1-char prompt → extra = ceil(1/1000) = 1 → adaptive = 16
      // Note: the schema requires prompt.length >= 1, so 0-char prompts are rejected.
      // Even the shortest valid prompt contributes +1 turn due to Math.ceil rounding up.
      const prompt = 'A'; // 1 char
      const marker = `[SPAWN:code-edit]${JSON.stringify({ prompt, model: 'sonnet' })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(16); // 15 + ceil(1/1000)=1 = 16
    });

    it('adds 1 turn for a sub-1000-char prompt (ceil rounds up a fractional value)', async () => {
      // code-edit baseline = 15, 999-char prompt → extra = ceil(0.999) = 1 → adaptive = 16
      const prompt = 'A'.repeat(999);
      const marker = `[SPAWN:code-edit]${JSON.stringify({ prompt, model: 'sonnet' })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(16); // 15 + 1 = 16
    });

    it('adds exactly 1 turn for a 1000-char prompt (ceil(1000/1000)=1)', async () => {
      // code-edit baseline = 15, 1000-char prompt → extra = ceil(1) = 1 → adaptive = 16
      const prompt = 'A'.repeat(1000);
      const marker = `[SPAWN:code-edit]${JSON.stringify({ prompt, model: 'sonnet' })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(16); // 15 + 1 = 16
    });
  });

  // ── Explicit maxTurns overrides adaptive ──────────────────────────

  describe('Explicit SPAWN marker maxTurns overrides adaptive', () => {
    it('uses the explicit maxTurns even when it is lower than the adaptive value', async () => {
      // code-edit + 2000-char prompt would adaptively give 17, but explicit 10 wins
      const prompt = 'A'.repeat(2000);
      const marker = `[SPAWN:code-edit]${JSON.stringify({ prompt, model: 'sonnet', maxTurns: 10 })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(10);
    });

    it('uses the explicit maxTurns even when it is much lower than the adaptive value', async () => {
      // 20 000-char prompt on code-edit would give min(15+20, 50)=35 adaptively; explicit 5 wins
      const prompt = 'A'.repeat(20_000);
      const marker = `[SPAWN:code-edit]${JSON.stringify({ prompt, model: 'sonnet', maxTurns: 5 })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(5);
    });

    it('passes explicit maxTurns through without applying the 50-turn cap', async () => {
      // The 50-turn cap only applies to adaptive calculations; explicit values are untouched
      const prompt = 'A'.repeat(100);
      const marker = `[SPAWN:code-edit]${JSON.stringify({ prompt, model: 'sonnet', maxTurns: 60 })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(60);
    });

    it('uses explicit maxTurns when the SPAWN marker contains a standard value', async () => {
      const prompt = 'A'.repeat(500);
      const marker = `[SPAWN:read-only]${JSON.stringify({ prompt, model: 'haiku', maxTurns: 25 })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(25);
    });
  });

  // ── 50-turn cap on adaptive ───────────────────────────────────────

  describe('50-turn cap on adaptive calculation', () => {
    it('caps at 50 when code-edit + very long prompt would exceed the limit', async () => {
      // code-edit baseline = 15, 40 000-char prompt → 15 + 40 = 55 → capped at 50
      const prompt = 'A'.repeat(40_000);
      const marker = `[SPAWN:code-edit]${JSON.stringify({ prompt, model: 'sonnet' })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(50);
    });

    it('caps at 50 when read-only + very long prompt would exceed the limit', async () => {
      // read-only baseline = 10, 50 000-char prompt → 10 + 50 = 60 → capped at 50
      const prompt = 'B'.repeat(50_000);
      const marker = `[SPAWN:read-only]${JSON.stringify({ prompt, model: 'haiku' })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(50);
    });

    it('returns exactly 50 when prompt length hits the cap boundary', async () => {
      // code-edit baseline = 15, 35 000-char prompt → 15 + 35 = 50 (exactly at cap)
      const prompt = 'A'.repeat(35_000);
      const marker = `[SPAWN:code-edit]${JSON.stringify({ prompt, model: 'sonnet' })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(50);
    });

    it('does not cap when prompt length stays just under the cap boundary', async () => {
      // code-edit baseline = 15, 34 000-char prompt → 15 + 34 = 49 (one under the cap)
      const prompt = 'A'.repeat(34_000);
      const marker = `[SPAWN:code-edit]${JSON.stringify({ prompt, model: 'sonnet' })}[/SPAWN]`;
      setupSingleWorkerMocks(marker);

      await masterManager.processMessage(makeMessage('do something'));

      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.maxTurns).toBe(49);
    });
  });
});
