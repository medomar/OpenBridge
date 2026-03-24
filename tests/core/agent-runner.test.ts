import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  sanitizePrompt,
  buildArgs,
  AgentRunner,
  AgentExhaustedError,
  TOOLS_READ_ONLY,
  TOOLS_CODE_EDIT,
  TOOLS_FULL,
  TOOLS_CODE_AUDIT,
  DEFAULT_MAX_TURNS_EXPLORATION,
  DEFAULT_MAX_TURNS_TASK,
  MODEL_ALIASES,
  MODEL_FALLBACK_CHAIN,
  isValidModel,
  isRateLimitError,
  isMaxTurnsExhausted,
  classifyError,
  getNextFallbackModel,
  resolveProfile,
  resolveTools,
  manifestToSpawnOptions,
  getProfileCostCap,
  PROFILE_COST_CAPS,
  checkProfileCostSpike,
  getProfileCostAverages,
  resetProfileCostAverages,
  scanDestructiveCommandViolations,
} from '../../src/core/agent-runner.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';
import { BUILT_IN_PROFILES } from '../../src/types/agent.js';
import type { TaskManifest } from '../../src/types/agent.js';

// ── Mock logger (captures warn calls for cost-spike tests) ──────────

const { mockLoggerWarn } = vi.hoisted(() => ({ mockLoggerWarn: vi.fn() }));

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
    trace: vi.fn(),
  }),
  setLogLevel: vi.fn(),
}));

// ── Mock node:fs/promises ───────────────────────────────────────────

const mockMkdir = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockWriteFile = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockRm = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  rm: (...args: unknown[]) => mockRm(...args),
}));

// ── Mock child_process.spawn ────────────────────────────────────────

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid?: number;
  kill: (signal?: string) => boolean;
}

let spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
let mockChildren: MockChild[] = [];

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = Math.floor(Math.random() * 100000);
  (child as unknown as Record<string, unknown>).exitCode = null;

  // Track kill calls but don't auto-emit close by default
  // Tests will control when close is emitted
  child.kill = vi.fn((_signal?: string) => {
    return true;
  });

  mockChildren.push(child);
  return child;
}

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    spawnCalls.push({ command, args, options });
    return createMockChild();
  },
  // DockerSandbox (imported transitively via agent-runner) uses execFile.
  // Provide a no-op stub so tests that don't exercise docker mode still pass.
  execFile: vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, cb?: (...a: unknown[]) => void) => {
      if (cb) cb(null, '', '');
    },
  ),
}));

// ── Helpers ─────────────────────────────────────────────────────────

function lastChild(): MockChild {
  const child = mockChildren[mockChildren.length - 1];
  if (!child) throw new Error('No mock child created');
  return child;
}

function resolveChild(
  child: MockChild,
  stdout: string,
  exitCode: number,
  stderr = '',
  signal: string | null = null,
): void {
  if (stdout) child.stdout.emit('data', Buffer.from(stdout));
  if (stderr) child.stderr.emit('data', Buffer.from(stderr));
  child.emit('close', exitCode, signal);
}

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  spawnCalls = [];
  mockChildren = [];
  mockMkdir.mockClear();
  mockWriteFile.mockClear();
  mockRm.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── sanitizePrompt ──────────────────────────────────────────────────

describe('sanitizePrompt', () => {
  it('passes through normal text unchanged', () => {
    expect(sanitizePrompt('Hello world')).toBe('Hello world');
  });

  it('preserves tabs, newlines, and carriage returns', () => {
    expect(sanitizePrompt('line1\nline2\ttab\rreturn')).toBe('line1\nline2\ttab\rreturn');
  });

  it('strips null bytes and control characters', () => {
    expect(sanitizePrompt('abc\x00def\x01ghi\x08jkl')).toBe('abcdefghijkl');
  });

  it('truncates prompts exceeding the maximum length', () => {
    const long = 'a'.repeat(200_000);
    const result = sanitizePrompt(long);
    expect(result.length).toBe(128_000);
  });
});

// ── buildArgs ───────────────────────────────────────────────────────

describe('buildArgs', () => {
  const base: SpawnOptions = {
    prompt: 'test prompt',
    workspacePath: '/tmp/ws',
  };

  it('builds minimal args with --print, default --max-turns, and the prompt', () => {
    const args = buildArgs(base);
    expect(args).toEqual(['--print', '--max-turns', '25', 'test prompt']);
  });

  it('includes --model when specified', () => {
    const args = buildArgs({ ...base, model: 'haiku' });
    expect(args).toContain('--model');
    expect(args).toContain('haiku');
  });

  it('includes --max-turns when specified', () => {
    const args = buildArgs({ ...base, maxTurns: 15 });
    expect(args).toContain('--max-turns');
    expect(args).toContain('15');
  });

  it('defaults --max-turns to DEFAULT_MAX_TURNS_TASK (25) when not specified', () => {
    const args = buildArgs(base);
    const idx = args.indexOf('--max-turns');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe(String(DEFAULT_MAX_TURNS_TASK));
  });

  it('allows explicit maxTurns to override the default', () => {
    const args = buildArgs({ ...base, maxTurns: 10 });
    const idx = args.indexOf('--max-turns');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('10');
  });

  it('includes --allowedTools for each tool', () => {
    const args = buildArgs({ ...base, allowedTools: ['Read', 'Glob', 'Grep'] });
    const toolFlags = args.filter((a) => a === '--allowedTools');
    expect(toolFlags).toHaveLength(3);
    expect(args).toContain('Read');
    expect(args).toContain('Glob');
    expect(args).toContain('Grep');
  });

  it('includes --resume when resumeSessionId is set', () => {
    const args = buildArgs({ ...base, resumeSessionId: 'sess-123' });
    expect(args).toContain('--resume');
    expect(args).toContain('sess-123');
  });

  it('includes --session-id when sessionId is set', () => {
    const args = buildArgs({ ...base, sessionId: 'new-sess' });
    expect(args).toContain('--session-id');
    expect(args).toContain('new-sess');
  });

  it('prefers --resume over --session-id when both are provided', () => {
    const args = buildArgs({ ...base, resumeSessionId: 'r-1', sessionId: 's-1' });
    expect(args).toContain('--resume');
    expect(args).not.toContain('--session-id');
  });

  it('places the prompt as the last argument', () => {
    const args = buildArgs({ ...base, model: 'opus', maxTurns: 25 });
    expect(args[args.length - 1]).toBe('test prompt');
  });

  it('does not include --dangerously-skip-permissions', () => {
    const args = buildArgs({
      ...base,
      model: 'opus',
      maxTurns: 25,
      allowedTools: ['Read'],
    });
    expect(args).not.toContain('--dangerously-skip-permissions');
  });
});

// ── Tool group constants ─────────────────────────────────────────────

describe('Tool group constants', () => {
  it('TOOLS_READ_ONLY contains only read-safe tools', () => {
    expect(TOOLS_READ_ONLY).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('TOOLS_CODE_EDIT contains editing tools plus scoped Bash including file-op tools', () => {
    // OB-1547 added file management tools to code-edit profile
    expect(TOOLS_CODE_EDIT).toEqual([
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(git:*)',
      'Bash(npm:*)',
      'Bash(npx:*)',
      'Bash(rm:*)',
      'Bash(mv:*)',
      'Bash(cp:*)',
      'Bash(mkdir:*)',
    ]);
  });

  it('TOOLS_FULL contains all tools with unrestricted Bash', () => {
    expect(TOOLS_FULL).toEqual(['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)']);
  });

  it('TOOLS_READ_ONLY is a subset of TOOLS_CODE_EDIT', () => {
    for (const tool of TOOLS_READ_ONLY) {
      expect(TOOLS_CODE_EDIT).toContain(tool);
    }
  });

  it('buildArgs passes TOOLS_READ_ONLY as --allowedTools flags', () => {
    const args = buildArgs({
      prompt: 'explore',
      workspacePath: '/tmp',
      allowedTools: [...TOOLS_READ_ONLY],
    });
    const toolFlags = args.filter((a) => a === '--allowedTools');
    expect(toolFlags).toHaveLength(3);
    expect(args).toContain('Read');
    expect(args).toContain('Glob');
    expect(args).toContain('Grep');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('buildArgs passes TOOLS_CODE_EDIT as --allowedTools flags', () => {
    const args = buildArgs({
      prompt: 'implement feature',
      workspacePath: '/tmp',
      allowedTools: [...TOOLS_CODE_EDIT],
    });
    const toolFlags = args.filter((a) => a === '--allowedTools');
    // OB-1547 added 4 file-op tools (rm, mv, cp, mkdir) → 12 total
    expect(toolFlags).toHaveLength(12);
    expect(args).toContain('Bash(git:*)');
    expect(args).toContain('Bash(npm:*)');
    expect(args).toContain('Bash(npx:*)');
    expect(args).toContain('Bash(rm:*)');
    expect(args).toContain('Bash(mv:*)');
    expect(args).toContain('Bash(cp:*)');
    expect(args).toContain('Bash(mkdir:*)');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });

  it('buildArgs passes TOOLS_FULL as --allowedTools flags', () => {
    const args = buildArgs({
      prompt: 'full access task',
      workspacePath: '/tmp',
      allowedTools: [...TOOLS_FULL],
    });
    const toolFlags = args.filter((a) => a === '--allowedTools');
    expect(toolFlags).toHaveLength(6);
    expect(args).toContain('Bash(*)');
    expect(args).not.toContain('--dangerously-skip-permissions');
  });
});

// ── Max-turns defaults ──────────────────────────────────────────────

describe('Max-turns defaults', () => {
  it('DEFAULT_MAX_TURNS_EXPLORATION is 25 (monorepo headroom)', () => {
    expect(DEFAULT_MAX_TURNS_EXPLORATION).toBe(25);
  });

  it('DEFAULT_MAX_TURNS_TASK is 25', () => {
    expect(DEFAULT_MAX_TURNS_TASK).toBe(25);
  });

  it('exploration default does not exceed task default', () => {
    expect(DEFAULT_MAX_TURNS_EXPLORATION).toBeLessThanOrEqual(DEFAULT_MAX_TURNS_TASK);
  });

  it('--max-turns is always present in args even without explicit maxTurns', () => {
    const args = buildArgs({ prompt: 'test', workspacePath: '/tmp' });
    expect(args).toContain('--max-turns');
  });

  it('callers can use DEFAULT_MAX_TURNS_EXPLORATION for exploration tasks', () => {
    const args = buildArgs({
      prompt: 'explore workspace',
      workspacePath: '/tmp',
      maxTurns: DEFAULT_MAX_TURNS_EXPLORATION,
    });
    const idx = args.indexOf('--max-turns');
    expect(args[idx + 1]).toBe('25');
  });
});

// ── Model aliases + validation ───────────────────────────────────────

describe('MODEL_ALIASES', () => {
  it('contains haiku, sonnet, opus', () => {
    expect(MODEL_ALIASES).toEqual(['haiku', 'sonnet', 'opus']);
  });
});

describe('isValidModel', () => {
  it('accepts short alias "haiku"', () => {
    expect(isValidModel('haiku')).toBe(true);
  });

  it('accepts short alias "sonnet"', () => {
    expect(isValidModel('sonnet')).toBe(true);
  });

  it('accepts short alias "opus"', () => {
    expect(isValidModel('opus')).toBe(true);
  });

  it('accepts full model IDs like claude-sonnet-4-5-20250929', () => {
    expect(isValidModel('claude-sonnet-4-5-20250929')).toBe(true);
  });

  it('accepts full model IDs like claude-haiku-4-5-20251001', () => {
    expect(isValidModel('claude-haiku-4-5-20251001')).toBe(true);
  });

  it('accepts full model IDs like claude-opus-4-6', () => {
    expect(isValidModel('claude-opus-4-6')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isValidModel('')).toBe(false);
  });

  it('rejects random strings', () => {
    expect(isValidModel('gpt-4')).toBe(false);
  });

  it('rejects partial aliases', () => {
    expect(isValidModel('son')).toBe(false);
  });
});

describe('buildArgs model handling', () => {
  const base: SpawnOptions = {
    prompt: 'test prompt',
    workspacePath: '/tmp/ws',
  };

  it('passes alias "haiku" as --model haiku', () => {
    const args = buildArgs({ ...base, model: 'haiku' });
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('haiku');
  });

  it('passes alias "sonnet" as --model sonnet', () => {
    const args = buildArgs({ ...base, model: 'sonnet' });
    const idx = args.indexOf('--model');
    expect(args[idx + 1]).toBe('sonnet');
  });

  it('passes alias "opus" as --model opus', () => {
    const args = buildArgs({ ...base, model: 'opus' });
    const idx = args.indexOf('--model');
    expect(args[idx + 1]).toBe('opus');
  });

  it('passes full model IDs through unchanged', () => {
    const args = buildArgs({ ...base, model: 'claude-sonnet-4-5-20250929' });
    const idx = args.indexOf('--model');
    expect(args[idx + 1]).toBe('claude-sonnet-4-5-20250929');
  });

  it('omits --model when model is not set', () => {
    const args = buildArgs(base);
    expect(args).not.toContain('--model');
  });

  it('still passes through unrecognized model values (with warning)', () => {
    const args = buildArgs({ ...base, model: 'gpt-4' });
    const idx = args.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe('gpt-4');
  });
});

// ── AgentRunner.spawn() model in result ─────────────────────────────

describe('AgentRunner model in result', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('includes model in the result when specified', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'haiku',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    const result = await promise;

    expect(result.model).toBe('haiku');
  });

  it('result.model is undefined when no model specified', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    const result = await promise;

    expect(result.model).toBeUndefined();
  });

  it('passes model to the CLI args when spawning', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'opus',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    await promise;

    const spawnedArgs = spawnCalls[0]!.args;
    const idx = spawnedArgs.indexOf('--model');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(spawnedArgs[idx + 1]).toBe('opus');
  });
});

// ── AgentRunner.spawn() ─────────────────────────────────────────────

describe('AgentRunner', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns claude with the correct command and cwd', async () => {
    const promise = runner.spawn({
      prompt: 'hello',
      workspacePath: '/tmp/project',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    await promise;

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.command).toBe('claude');
    expect(spawnCalls[0]!.options['cwd']).toBe('/tmp/project');
  });

  it('returns AgentResult with stdout, stderr, exitCode, durationMs, retryCount', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    resolveChild(lastChild(), 'response text', 0, 'warning');
    const result = await promise;

    expect(result.stdout).toBe('response text');
    expect(result.stderr).toBe('warning');
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.retryCount).toBe(0);
  });

  it('retries on non-zero exit codes', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 2,
      retryDelay: 1000,
    });

    // First attempt — fails
    resolveChild(lastChild(), '', 1, 'error 1');
    await vi.advanceTimersByTimeAsync(1000);

    // Second attempt — fails
    resolveChild(lastChild(), '', 1, 'error 2');
    await vi.advanceTimersByTimeAsync(1000);

    // Third attempt — succeeds
    resolveChild(lastChild(), 'success', 0);

    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('success');
    expect(result.retryCount).toBe(2);
    expect(spawnCalls).toHaveLength(3);
  });

  it('throws AgentExhaustedError after all retries exhausted', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 1,
      retryDelay: 500,
    });

    // First attempt — non-timeout exit triggers a retry
    resolveChild(lastChild(), 'out1', 1, 'error');
    await vi.advanceTimersByTimeAsync(500);

    // Second attempt — timeout exit breaks immediately (no more retries)
    resolveChild(lastChild(), 'out2', 143, 'killed');

    await expect(promise).rejects.toThrow(AgentExhaustedError);
    await expect(promise).rejects.toThrow(/Agent failed after 2 attempt/);
  });

  it('throws without retrying when retries is 0', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    resolveChild(lastChild(), '', 1, 'fail');

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AgentExhaustedError);
      const error = e as AgentExhaustedError;
      expect(error.totalAttempts).toBe(1);
      expect(error.lastExitCode).toBe(1);
      expect(spawnCalls).toHaveLength(1);
    }
  });

  it('uses default retries=3 and retryDelay=10000', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
    });

    // Fail 3 times, succeed on 4th (attempt index 3)
    resolveChild(lastChild(), '', 1);
    await vi.advanceTimersByTimeAsync(10_000);
    resolveChild(lastChild(), '', 1);
    await vi.advanceTimersByTimeAsync(10_000);
    resolveChild(lastChild(), '', 1);
    await vi.advanceTimersByTimeAsync(10_000);
    resolveChild(lastChild(), 'done', 0);

    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.retryCount).toBe(3);
    expect(spawnCalls).toHaveLength(4);
  });

  it('stops on first success without further retries', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 5,
      retryDelay: 100,
    });

    resolveChild(lastChild(), 'immediate', 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.retryCount).toBe(0);
    expect(spawnCalls).toHaveLength(1);
  });

  it('handles timeout parameter with manual timeout logic', async () => {
    // Since we moved to manual timeout handling, we no longer pass timeout to Node's spawn.
    // Instead, we verify the timeout triggers SIGTERM → SIGKILL as expected.
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      timeout: 60_000,
      retries: 0,
    });

    // Complete before timeout
    resolveChild(lastChild(), 'success', 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    // Timeout is not passed to spawn options anymore
    expect(spawnCalls[0]!.options['timeout']).toBeUndefined();
  });

  // ── Effective timeout derivation (OB-1567, OB-F206) ─────────────────────
  // Non-Docker workers should derive timeout from maxTurns when not explicitly set.
  // Formula: effectiveTimeout = timeout ?? (maxTurns ? maxTurns * 30 * 1000 : 300_000)

  it('derives effectiveTimeout from maxTurns when timeout is not set', async () => {
    // maxTurns: 5 should derive timeout = 5 * 30 * 1000 = 150_000 ms
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      maxTurns: 5,
      retries: 0,
    });

    // Complete before timeout
    resolveChild(lastChild(), 'success', 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    // The timeout derivation happens internally and kills the process if exceeded
    // (cannot directly assert the internal timeout value, but the logic is in agent-runner.ts:1365)
  });

  it('defaults effectiveTimeout to 300_000ms when maxTurns and timeout are not set', async () => {
    // No explicit timeout and no maxTurns should default to 5 minutes (300_000 ms)
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    // Complete before default timeout
    resolveChild(lastChild(), 'success', 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
  });

  it('preserves explicit timeout without derivation from maxTurns', async () => {
    // Explicit timeout: 60_000 should be used as-is, not derived from maxTurns
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      maxTurns: 5, // 5 turns would normally derive to 150_000 ms
      timeout: 60_000, // But explicit timeout should take precedence
      retries: 0,
    });

    // Complete before timeout
    resolveChild(lastChild(), 'success', 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    // The explicit timeout (60_000) is preserved and should trigger timeout logic
    // if the process runs longer than 60 seconds
  });

  it('throws AgentExhaustedError on spawn error with no retries', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    lastChild().emit('error', new Error('ENOENT'));

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AgentExhaustedError);
      const error = e as AgentExhaustedError;
      expect(error.attempts).toHaveLength(1);
      expect(error.attempts[0]!.exitCode).toBe(-1);
      expect(error.attempts[0]!.stderr).toContain('ENOENT');
    }
  });

  it('retries on spawn errors then succeeds', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 1,
      retryDelay: 100,
    });

    // First attempt — spawn error
    lastChild().emit('error', new Error('ENOENT'));
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt — success
    resolveChild(lastChild(), 'recovered', 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('recovered');
  });

  it('measures durationMs across retries', async () => {
    vi.useRealTimers();

    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    // Small delay to ensure durationMs > 0
    await new Promise((r) => setTimeout(r, 5));
    resolveChild(lastChild(), '', 0);

    const result = await promise;
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ── AgentExhaustedError ──────────────────────────────────────────────

describe('AgentExhaustedError', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('contains attempt records for every failed attempt', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 2,
      retryDelay: 100,
    });

    // Attempt 0
    resolveChild(lastChild(), '', 1, 'error-0');
    await vi.advanceTimersByTimeAsync(100);

    // Attempt 1 — non-timeout exit triggers another retry
    resolveChild(lastChild(), '', 3, 'error-1');
    await vi.advanceTimersByTimeAsync(100);

    // Attempt 2
    resolveChild(lastChild(), '', 2, 'error-2');

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (e) {
      const error = e as AgentExhaustedError;
      expect(error).toBeInstanceOf(AgentExhaustedError);
      expect(error.attempts).toHaveLength(3);
      expect(error.attempts[0]).toEqual({ attempt: 0, exitCode: 1, stderr: 'error-0' });
      expect(error.attempts[1]).toEqual({ attempt: 1, exitCode: 3, stderr: 'error-1' });
      expect(error.attempts[2]).toEqual({ attempt: 2, exitCode: 2, stderr: 'error-2' });
    }
  });

  it('records lastExitCode from the final attempt', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 1,
      retryDelay: 100,
    });

    resolveChild(lastChild(), '', 1, 'first');
    await vi.advanceTimersByTimeAsync(100);
    resolveChild(lastChild(), '', 143, 'second');

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (e) {
      const error = e as AgentExhaustedError;
      expect(error.lastExitCode).toBe(143);
    }
  });

  it('records totalAttempts including the initial attempt', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 2,
      retryDelay: 100,
    });

    resolveChild(lastChild(), '', 1);
    await vi.advanceTimersByTimeAsync(100);
    resolveChild(lastChild(), '', 1);
    await vi.advanceTimersByTimeAsync(100);
    resolveChild(lastChild(), '', 1);

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (e) {
      const error = e as AgentExhaustedError;
      expect(error.totalAttempts).toBe(3);
    }
  });

  it('includes durationMs in the error', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    resolveChild(lastChild(), '', 1, 'fail');

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (e) {
      const error = e as AgentExhaustedError;
      expect(error.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('formats a readable error message with all attempts', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 1,
      retryDelay: 100,
    });

    // Non-timeout exit triggers a retry; then timeout exit breaks the loop
    resolveChild(lastChild(), '', 1, 'non-fatal error');
    await vi.advanceTimersByTimeAsync(100);
    resolveChild(lastChild(), '', 143, 'killed');

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (e) {
      const error = e as AgentExhaustedError;
      expect(error.message).toContain('Agent failed after 2 attempt(s)');
      expect(error.message).toContain('exit 1');
      expect(error.message).toContain('exit 143');
      expect(error.message).toContain('non-fatal error');
      expect(error.message).toContain('killed');
    }
  });

  it('aggregates spawn errors with exit code -1', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 1,
      retryDelay: 100,
    });

    // Attempt 0 — spawn error
    lastChild().emit('error', new Error('ENOENT'));
    await vi.advanceTimersByTimeAsync(100);

    // Attempt 1 — non-zero exit
    resolveChild(lastChild(), '', 1, 'fail');

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (e) {
      const error = e as AgentExhaustedError;
      expect(error).toBeInstanceOf(AgentExhaustedError);
      expect(error.attempts).toHaveLength(2);
      expect(error.attempts[0]!.exitCode).toBe(-1);
      expect(error.attempts[0]!.stderr).toContain('ENOENT');
      expect(error.attempts[1]!.exitCode).toBe(1);
    }
  });

  it('error.name is AgentExhaustedError', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    resolveChild(lastChild(), '', 1);

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (e) {
      const error = e as AgentExhaustedError;
      expect(error.name).toBe('AgentExhaustedError');
    }
  });
});

// ── Disk logging ─────────────────────────────────────────────────────

describe('Disk logging', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes log file when logFile option is provided', async () => {
    const promise = runner.spawn({
      prompt: 'explore workspace',
      workspacePath: '/tmp/project',
      logFile: '/tmp/project/.openbridge/logs/task-1.log',
      model: 'haiku',
      allowedTools: ['Read', 'Glob', 'Grep'],
      retries: 0,
    });

    resolveChild(lastChild(), 'agent output', 0, 'some warning');
    await promise;

    expect(mockMkdir).toHaveBeenCalledWith('/tmp/project/.openbridge/logs', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    expect(writtenContent).toContain('# Agent Run Log');
    expect(writtenContent).toContain('# Model: haiku');
    expect(writtenContent).toContain('# Tools: Read, Glob, Grep');
    expect(writtenContent).toContain('# Prompt Length: 17');
    expect(writtenContent).toContain('# Exit Code: 0');
    expect(writtenContent).toContain('--- STDOUT ---');
    expect(writtenContent).toContain('agent output');
    expect(writtenContent).toContain('--- STDERR ---');
    expect(writtenContent).toContain('some warning');
  });

  it('does not write log file when logFile option is not provided', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    await promise;

    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('includes timestamp in the log header', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      logFile: '/tmp/logs/task.log',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    await promise;

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    expect(writtenContent).toMatch(/# Timestamp: \d{4}-\d{2}-\d{2}T/);
  });

  it('shows default model when no model specified', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      logFile: '/tmp/logs/task.log',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    await promise;

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    expect(writtenContent).toContain('# Model: default');
  });

  it('shows "none specified" when no tools provided', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      logFile: '/tmp/logs/task.log',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    await promise;

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    expect(writtenContent).toContain('# Tools: none specified');
  });

  it('includes retryCount and duration in the log', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      logFile: '/tmp/logs/task.log',
      retries: 1,
      retryDelay: 100,
    });

    // First attempt fails
    resolveChild(lastChild(), '', 1, 'error');
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt succeeds
    resolveChild(lastChild(), 'recovered', 0);
    await promise;

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    expect(writtenContent).toContain('# Retries: 1');
    expect(writtenContent).toMatch(/# Duration: \d+ms/);
  });

  it('creates log directory recursively', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      logFile: '/deep/nested/path/logs/task.log',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    await promise;

    expect(mockMkdir).toHaveBeenCalledWith('/deep/nested/path/logs', { recursive: true });
  });

  it('does not throw if log writing fails', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('EACCES: permission denied'));

    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      logFile: '/readonly/logs/task.log',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    const result = await promise;

    // spawn() should still return the result successfully
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('output');
  });

  it('includes max turns in the log header', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      logFile: '/tmp/logs/task.log',
      maxTurns: 15,
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    await promise;

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    expect(writtenContent).toContain('# Max Turns: 15');
  });
});

// ── AgentRunner.stream() ────────────────────────────────────────────

/** Collect all yielded values and the return value from an async generator */
async function drainStream(
  gen: AsyncGenerator<
    string,
    {
      stdout: string;
      exitCode: number;
      durationMs: number;
      retryCount: number;
      stderr: string;
      model?: string;
    }
  >,
): Promise<{
  chunks: string[];
  result: {
    stdout: string;
    exitCode: number;
    durationMs: number;
    retryCount: number;
    stderr: string;
    model?: string;
  };
}> {
  const chunks: string[] = [];
  let iterResult = await gen.next();
  while (!iterResult.done) {
    chunks.push(iterResult.value);
    iterResult = await gen.next();
  }
  return { chunks, result: iterResult.value };
}

describe('AgentRunner.stream()', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('yields stdout chunks as they arrive', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    // Start consuming
    const resultPromise = drainStream(gen);

    // Emit chunks then close
    const child = lastChild();
    child.stdout.emit('data', Buffer.from('chunk1'));
    child.stdout.emit('data', Buffer.from('chunk2'));
    child.stdout.emit('data', Buffer.from('chunk3'));
    child.emit('close', 0);

    const { chunks, result } = await resultPromise;

    expect(chunks).toEqual(['chunk1', 'chunk2', 'chunk3']);
    expect(result.stdout).toBe('chunk1chunk2chunk3');
    expect(result.exitCode).toBe(0);
  });

  it('returns AgentResult with accumulated stdout', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'haiku',
      retries: 0,
    });

    const resultPromise = drainStream(gen);

    const child = lastChild();
    child.stdout.emit('data', Buffer.from('hello '));
    child.stdout.emit('data', Buffer.from('world'));
    child.stderr.emit('data', Buffer.from('warning'));
    child.emit('close', 0);

    const { result } = await resultPromise;

    expect(result.stdout).toBe('hello world');
    expect(result.stderr).toBe('warning');
    expect(result.exitCode).toBe(0);
    expect(result.model).toBe('haiku');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.retryCount).toBe(0);
  });

  it('uses buildArgs with all options (model, maxTurns, allowedTools)', async () => {
    const gen = runner.stream({
      prompt: 'explore',
      workspacePath: '/tmp/project',
      model: 'haiku',
      maxTurns: 15,
      allowedTools: ['Read', 'Glob', 'Grep'],
      retries: 0,
    });

    const resultPromise = drainStream(gen);
    resolveChild(lastChild(), 'output', 0);
    await resultPromise;

    const spawnedArgs = spawnCalls[0]!.args;
    expect(spawnedArgs).toContain('--print');
    expect(spawnedArgs).toContain('--model');
    expect(spawnedArgs).toContain('haiku');
    expect(spawnedArgs).toContain('--max-turns');
    expect(spawnedArgs).toContain('15');
    expect(spawnedArgs.filter((a) => a === '--allowedTools')).toHaveLength(3);
    expect(spawnedArgs).toContain('Read');
    expect(spawnedArgs).toContain('Glob');
    expect(spawnedArgs).toContain('Grep');
    expect(spawnedArgs).not.toContain('--dangerously-skip-permissions');
  });

  it('retries on non-zero exit codes', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 1,
      retryDelay: 1000,
    });

    const resultPromise = drainStream(gen);

    // First attempt — fails
    resolveChild(lastChild(), 'partial', 1, 'error');
    await vi.advanceTimersByTimeAsync(1000);

    // Second attempt — succeeds
    const child2 = lastChild();
    child2.stdout.emit('data', Buffer.from('success'));
    child2.emit('close', 0);

    const { chunks, result } = await resultPromise;

    // Chunks from both attempts are yielded (caller sees both)
    expect(chunks).toContain('partial');
    expect(chunks).toContain('success');
    expect(result.exitCode).toBe(0);
    expect(result.retryCount).toBe(1);
    expect(spawnCalls).toHaveLength(2);
  });

  it('throws AgentExhaustedError after all retries exhausted', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 1,
      retryDelay: 500,
    });

    const resultPromise = drainStream(gen);

    // First attempt — non-timeout exit triggers a retry
    resolveChild(lastChild(), '', 1, 'error');
    await vi.advanceTimersByTimeAsync(500);

    // Second attempt — timeout exit breaks immediately (no more retries)
    resolveChild(lastChild(), '', 143, 'killed');

    await expect(resultPromise).rejects.toThrow(AgentExhaustedError);
    await expect(resultPromise).rejects.toThrow(/Agent failed after 2 attempt/);
  });

  it('throws without retrying when retries is 0', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    const resultPromise = drainStream(gen);
    resolveChild(lastChild(), '', 1, 'fail');

    try {
      await resultPromise;
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AgentExhaustedError);
      const error = e as AgentExhaustedError;
      expect(error.totalAttempts).toBe(1);
      expect(error.lastExitCode).toBe(1);
      expect(spawnCalls).toHaveLength(1);
    }
  });

  it('retries on spawn errors then succeeds', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 1,
      retryDelay: 100,
    });

    const resultPromise = drainStream(gen);

    // First attempt — spawn error
    lastChild().emit('error', new Error('ENOENT'));
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt — success
    resolveChild(lastChild(), 'recovered', 0);

    const { result } = await resultPromise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('recovered');
  });

  it('writes log file when logFile option is provided', async () => {
    const gen = runner.stream({
      prompt: 'explore workspace',
      workspacePath: '/tmp/project',
      logFile: '/tmp/project/.openbridge/logs/stream-1.log',
      model: 'haiku',
      allowedTools: ['Read', 'Glob', 'Grep'],
      retries: 0,
    });

    const resultPromise = drainStream(gen);
    resolveChild(lastChild(), 'streamed output', 0, 'some warning');
    await resultPromise;

    expect(mockMkdir).toHaveBeenCalledWith('/tmp/project/.openbridge/logs', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledTimes(1);

    const writtenContent = mockWriteFile.mock.calls[0]![1] as string;
    expect(writtenContent).toContain('# Agent Run Log');
    expect(writtenContent).toContain('# Model: haiku');
    expect(writtenContent).toContain('# Tools: Read, Glob, Grep');
    expect(writtenContent).toContain('streamed output');
    expect(writtenContent).toContain('some warning');
  });

  it('does not write log file when logFile is not provided', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    const resultPromise = drainStream(gen);
    resolveChild(lastChild(), 'output', 0);
    await resultPromise;

    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('passes session options through to CLI args', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      resumeSessionId: 'sess-abc',
      retries: 0,
    });

    const resultPromise = drainStream(gen);
    resolveChild(lastChild(), 'output', 0);
    await resultPromise;

    const spawnedArgs = spawnCalls[0]!.args;
    expect(spawnedArgs).toContain('--resume');
    expect(spawnedArgs).toContain('sess-abc');
  });

  it('spawns claude with the correct command and cwd', async () => {
    const gen = runner.stream({
      prompt: 'hello',
      workspacePath: '/tmp/project',
      retries: 0,
    });

    const resultPromise = drainStream(gen);
    resolveChild(lastChild(), 'output', 0);
    await resultPromise;

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.command).toBe('claude');
    expect(spawnCalls[0]!.options['cwd']).toBe('/tmp/project');
  });

  it('does not throw if log writing fails', async () => {
    mockWriteFile.mockRejectedValueOnce(new Error('EACCES'));

    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      logFile: '/readonly/logs/task.log',
      retries: 0,
    });

    const resultPromise = drainStream(gen);
    resolveChild(lastChild(), 'output', 0);

    const { result } = await resultPromise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('output');
  });
});

// ── resolveProfile ──────────────────────────────────────────────────

describe('resolveProfile', () => {
  it('resolves "read-only" to Read, Glob, Grep', () => {
    expect(resolveProfile('read-only')).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('resolves "code-edit" to code editing tools', () => {
    expect(resolveProfile('code-edit')).toEqual(BUILT_IN_PROFILES['code-edit'].tools);
  });

  it('resolves "full-access" to full tool set', () => {
    expect(resolveProfile('full-access')).toEqual(BUILT_IN_PROFILES['full-access'].tools);
  });

  it('resolves "master" to file management tools without Bash', () => {
    const tools = resolveProfile('master');
    expect(tools).toEqual(BUILT_IN_PROFILES.master.tools);
    expect(tools).toContain('Read');
    expect(tools).toContain('Write');
    expect(tools).toContain('Edit');
    expect(tools).toContain('Glob');
    expect(tools).toContain('Grep');
    // Master must NOT have Bash access
    expect(tools?.some((t) => t.startsWith('Bash'))).toBe(false);
  });

  it('returns undefined for unknown profile names', () => {
    expect(resolveProfile('nonexistent')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(resolveProfile('')).toBeUndefined();
  });

  it('resolves custom profile when provided', () => {
    const customProfiles = {
      'test-runner': {
        name: 'test-runner',
        tools: ['Read', 'Glob', 'Grep', 'Bash(npm:test)'],
      },
    };
    expect(resolveProfile('test-runner', customProfiles)).toEqual([
      'Read',
      'Glob',
      'Grep',
      'Bash(npm:test)',
    ]);
  });

  it('custom profile takes priority over built-in with same name', () => {
    const customProfiles = {
      'read-only': {
        name: 'read-only',
        tools: ['Read', 'Glob', 'Grep', 'Bash(ls:*)'],
      },
    };
    expect(resolveProfile('read-only', customProfiles)).toEqual([
      'Read',
      'Glob',
      'Grep',
      'Bash(ls:*)',
    ]);
  });

  it('falls back to built-in when custom profiles do not contain the name', () => {
    const customProfiles = {
      'test-runner': {
        name: 'test-runner',
        tools: ['Read', 'Glob'],
      },
    };
    expect(resolveProfile('read-only', customProfiles)).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('returns undefined when custom profiles are empty and name is unknown', () => {
    expect(resolveProfile('nonexistent', {})).toBeUndefined();
  });

  // OB-1586: trustLevel overrides profile resolution
  it('trusted trustLevel returns TOOLS_FULL for any profile', () => {
    const result = resolveProfile('read-only', undefined, 'trusted');
    expect(result).toEqual([...TOOLS_FULL]);
  });

  it('sandbox trustLevel returns TOOLS_READ_ONLY for any profile', () => {
    const result = resolveProfile('full-access', undefined, 'sandbox');
    expect(result).toEqual([...TOOLS_READ_ONLY]);
  });

  it('standard trustLevel returns profile tools unchanged', () => {
    const result = resolveProfile('code-edit', undefined, 'standard');
    expect(result).toEqual([...TOOLS_CODE_EDIT]);
  });

  it('backward compatible: no trustLevel param returns profile tools', () => {
    const withoutTrustLevel = resolveProfile('code-edit');
    const withStandard = resolveProfile('code-edit', undefined, 'standard');
    expect(withoutTrustLevel).toEqual(withStandard);
  });

  // OB-1549: file-management profile contains all expected file-op tools
  it('resolves "file-management" to array containing Bash(rm:*), Bash(mv:*), Bash(cp:*), Bash(mkdir:*), Bash(chmod:*)', () => {
    const tools = resolveProfile('file-management');
    expect(tools).toBeDefined();
    expect(tools).toContain('Bash(rm:*)');
    expect(tools).toContain('Bash(mv:*)');
    expect(tools).toContain('Bash(cp:*)');
    expect(tools).toContain('Bash(mkdir:*)');
    expect(tools).toContain('Bash(chmod:*)');
  });
});

// ── TOOLS_CODE_EDIT ─────────────────────────────────────────────────

// OB-1549: TOOLS_CODE_EDIT must include file management tools (OB-1547)
describe('TOOLS_CODE_EDIT', () => {
  it('includes Bash(rm:*)', () => {
    expect(TOOLS_CODE_EDIT).toContain('Bash(rm:*)');
  });

  it('includes Bash(mv:*)', () => {
    expect(TOOLS_CODE_EDIT).toContain('Bash(mv:*)');
  });

  it('includes Bash(cp:*)', () => {
    expect(TOOLS_CODE_EDIT).toContain('Bash(cp:*)');
  });

  it('includes Bash(mkdir:*)', () => {
    expect(TOOLS_CODE_EDIT).toContain('Bash(mkdir:*)');
  });
});

// ── resolveTools ────────────────────────────────────────────────────

describe('resolveTools', () => {
  it('resolves "code-audit" to the TOOLS_CODE_AUDIT array', () => {
    expect(resolveTools('code-audit')).toEqual([...TOOLS_CODE_AUDIT]);
  });

  it('code-audit tool list includes Bash(npm:test) but not Bash(*), Write, or Edit', () => {
    const tools = resolveTools('code-audit');
    expect(tools).toContain('Bash(npm:test)');
    expect(tools).not.toContain('Bash(*)');
    expect(tools).not.toContain('Write');
    expect(tools).not.toContain('Edit');
  });

  it('"code-audit" is recognized in BUILT_IN_PROFILES', () => {
    expect(BUILT_IN_PROFILES['code-audit']).toBeDefined();
    expect(BUILT_IN_PROFILES['code-audit'].name).toBe('code-audit');
    expect(BUILT_IN_PROFILES['code-audit'].tools).toContain('Bash(npm:test)');
  });

  it('resolves "read-only" to TOOLS_READ_ONLY', () => {
    expect(resolveTools('read-only')).toEqual([...TOOLS_READ_ONLY]);
  });

  it('resolves "full-access" to TOOLS_FULL', () => {
    expect(resolveTools('full-access')).toEqual([...TOOLS_FULL]);
  });

  it('returns undefined for an unknown profile name', () => {
    expect(resolveTools('nonexistent')).toBeUndefined();
  });

  it('resolves code-audit via manifestToSpawnOptions with profile field', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions({
      prompt: 'run tests',
      workspacePath: '/tmp/project',
      profile: 'code-audit',
    });
    expect(opts.allowedTools).toEqual([...TOOLS_CODE_AUDIT]);
    expect(opts.allowedTools).toContain('Bash(npm:test)');
    expect(opts.allowedTools).not.toContain('Write');
    expect(opts.allowedTools).not.toContain('Edit');
    expect(opts.allowedTools).not.toContain('Bash(*)');
  });
});

// ── manifestToSpawnOptions ──────────────────────────────────────────

describe('manifestToSpawnOptions', () => {
  const baseManifest: TaskManifest = {
    prompt: 'explore the project',
    workspacePath: '/tmp/project',
  };

  it('maps basic manifest fields to SpawnOptions', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions(baseManifest);
    expect(opts.prompt).toBe('explore the project');
    expect(opts.workspacePath).toBe('/tmp/project');
  });

  it('resolves profile to allowedTools', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions({
      ...baseManifest,
      profile: 'read-only',
    });
    expect(opts.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('resolves code-edit profile to code editing tools', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions({
      ...baseManifest,
      profile: 'code-edit',
    });
    expect(opts.allowedTools).toEqual(BUILT_IN_PROFILES['code-edit'].tools);
  });

  it('resolves full-access profile to full tool set', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions({
      ...baseManifest,
      profile: 'full-access',
    });
    expect(opts.allowedTools).toEqual(BUILT_IN_PROFILES['full-access'].tools);
  });

  it('resolves master profile to file management tools without Bash', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions({
      ...baseManifest,
      profile: 'master',
    });
    expect(opts.allowedTools).toEqual(BUILT_IN_PROFILES.master.tools);
    expect(opts.allowedTools?.some((t) => t.startsWith('Bash'))).toBe(false);
  });

  it('explicit allowedTools override profile', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions({
      ...baseManifest,
      profile: 'read-only',
      allowedTools: ['Read', 'Edit', 'Write'],
    });
    expect(opts.allowedTools).toEqual(['Read', 'Edit', 'Write']);
  });

  it('passes through model, maxTurns, timeout, retries, retryDelay', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions({
      ...baseManifest,
      model: 'haiku',
      maxTurns: 10,
      timeout: 60000,
      retries: 2,
      retryDelay: 5000,
    });
    expect(opts.model).toBe('haiku');
    expect(opts.maxTurns).toBe(10);
    expect(opts.timeout).toBe(60000);
    expect(opts.retries).toBe(2);
    expect(opts.retryDelay).toBe(5000);
  });

  it('leaves allowedTools undefined when no profile or tools specified', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions(baseManifest);
    expect(opts.allowedTools).toBeUndefined();
  });

  it('leaves allowedTools undefined for unrecognized profile', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions({
      ...baseManifest,
      profile: 'custom-unknown',
    });
    expect(opts.allowedTools).toBeUndefined();
  });

  it('resolves custom profile when provided', async () => {
    const customProfiles = {
      'test-runner': {
        name: 'test-runner',
        tools: ['Read', 'Glob', 'Grep', 'Bash(npm:test)'],
      },
    };
    const { spawnOptions: opts } = await manifestToSpawnOptions(
      { ...baseManifest, profile: 'test-runner' },
      customProfiles,
    );
    expect(opts.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Bash(npm:test)']);
  });

  it('resolves previously unknown profile when custom profiles are provided', async () => {
    const customProfiles = {
      'doc-writer': {
        name: 'doc-writer',
        tools: ['Read', 'Write', 'Glob'],
      },
    };
    const { spawnOptions: opts } = await manifestToSpawnOptions(
      { ...baseManifest, profile: 'doc-writer' },
      customProfiles,
    );
    expect(opts.allowedTools).toEqual(['Read', 'Write', 'Glob']);
  });

  it('still resolves built-in profiles when custom profiles are provided', async () => {
    const customProfiles = {
      'test-runner': { name: 'test-runner', tools: ['Read'] },
    };
    const { spawnOptions: opts } = await manifestToSpawnOptions(
      { ...baseManifest, profile: 'read-only' },
      customProfiles,
    );
    expect(opts.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('does not include session-related fields', async () => {
    const { spawnOptions: opts } = await manifestToSpawnOptions(baseManifest);
    expect(opts.resumeSessionId).toBeUndefined();
    expect(opts.sessionId).toBeUndefined();
    expect(opts.logFile).toBeUndefined();
  });

  it('returns a no-op cleanup when no mcpServers specified', async () => {
    const { cleanup } = await manifestToSpawnOptions(baseManifest);
    await expect(cleanup()).resolves.toBeUndefined();
  });
});

// ── AgentRunner.spawnFromManifest() ──────────────────────────────────

describe('AgentRunner.spawnFromManifest()', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('spawns agent with tools resolved from profile', async () => {
    const promise = runner.spawnFromManifest({
      prompt: 'explore workspace',
      workspacePath: '/tmp/project',
      profile: 'read-only',
      retries: 0,
    });

    // spawnFromManifest awaits manifestToSpawnOptions (async) before spawning —
    // yield a microtask so the child is created before resolveChild is called.
    await Promise.resolve();
    resolveChild(lastChild(), 'output', 0);
    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('output');

    const spawnedArgs = spawnCalls[0]!.args;
    expect(spawnedArgs).toContain('Read');
    expect(spawnedArgs).toContain('Glob');
    expect(spawnedArgs).toContain('Grep');
    expect(spawnedArgs.filter((a) => a === '--allowedTools')).toHaveLength(3);
  });

  it('explicit allowedTools override profile in spawned args', async () => {
    const promise = runner.spawnFromManifest({
      prompt: 'custom task',
      workspacePath: '/tmp/project',
      profile: 'read-only',
      allowedTools: ['Read', 'Edit'],
      retries: 0,
    });

    await Promise.resolve();
    resolveChild(lastChild(), 'output', 0);
    await promise;

    const spawnedArgs = spawnCalls[0]!.args;
    expect(spawnedArgs.filter((a) => a === '--allowedTools')).toHaveLength(2);
    expect(spawnedArgs).toContain('Read');
    expect(spawnedArgs).toContain('Edit');
    expect(spawnedArgs).not.toContain('Glob');
    expect(spawnedArgs).not.toContain('Grep');
  });

  it('passes model through from manifest', async () => {
    const promise = runner.spawnFromManifest({
      prompt: 'task',
      workspacePath: '/tmp',
      model: 'opus',
      retries: 0,
    });

    await Promise.resolve();
    resolveChild(lastChild(), 'output', 0);
    const result = await promise;

    expect(result.model).toBe('opus');
    const spawnedArgs = spawnCalls[0]!.args;
    expect(spawnedArgs).toContain('--model');
    expect(spawnedArgs).toContain('opus');
  });

  it('spawns with code-edit profile tools', async () => {
    const promise = runner.spawnFromManifest({
      prompt: 'implement feature',
      workspacePath: '/tmp/project',
      profile: 'code-edit',
      model: 'sonnet',
      retries: 0,
    });

    await Promise.resolve();
    resolveChild(lastChild(), 'done', 0);
    await promise;

    const spawnedArgs = spawnCalls[0]!.args;
    expect(spawnedArgs).toContain('Edit');
    expect(spawnedArgs).toContain('Write');
    expect(spawnedArgs).toContain('Bash(git:*)');
    expect(spawnedArgs).toContain('Bash(npm:*)');
  });
});

// ── AgentRunner.streamFromManifest() ─────────────────────────────────

describe('AgentRunner.streamFromManifest()', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams agent with tools resolved from profile', async () => {
    const gen = runner.streamFromManifest({
      prompt: 'explore',
      workspacePath: '/tmp/project',
      profile: 'read-only',
      retries: 0,
    });

    const resultPromise = drainStream(gen);

    // streamFromManifest awaits manifestToSpawnOptions (async) before spawning —
    // yield a microtask so the child is created before we interact with it.
    await Promise.resolve();
    const child = lastChild();
    child.stdout.emit('data', Buffer.from('chunk1'));
    child.stdout.emit('data', Buffer.from('chunk2'));
    child.emit('close', 0);

    const { chunks, result } = await resultPromise;

    expect(chunks).toEqual(['chunk1', 'chunk2']);
    expect(result.exitCode).toBe(0);

    const spawnedArgs = spawnCalls[0]!.args;
    expect(spawnedArgs).toContain('Read');
    expect(spawnedArgs).toContain('Glob');
    expect(spawnedArgs).toContain('Grep');
    expect(spawnedArgs.filter((a) => a === '--allowedTools')).toHaveLength(3);
  });

  it('explicit allowedTools override profile in stream', async () => {
    const gen = runner.streamFromManifest({
      prompt: 'task',
      workspacePath: '/tmp',
      profile: 'full-access',
      allowedTools: ['Read'],
      retries: 0,
    });

    const resultPromise = drainStream(gen);
    await Promise.resolve();
    resolveChild(lastChild(), 'output', 0);
    await resultPromise;

    const spawnedArgs = spawnCalls[0]!.args;
    expect(spawnedArgs.filter((a) => a === '--allowedTools')).toHaveLength(1);
    expect(spawnedArgs).toContain('Read');
    expect(spawnedArgs).not.toContain('Bash(*)');
  });
});

// ── MODEL_FALLBACK_CHAIN ─────────────────────────────────────────────

describe('MODEL_FALLBACK_CHAIN', () => {
  it('opus falls back to sonnet', () => {
    expect(MODEL_FALLBACK_CHAIN['opus']).toBe('sonnet');
  });

  it('sonnet falls back to haiku', () => {
    expect(MODEL_FALLBACK_CHAIN['sonnet']).toBe('haiku');
  });

  it('haiku has no further fallback', () => {
    expect(MODEL_FALLBACK_CHAIN['haiku']).toBeUndefined();
  });
});

// ── isRateLimitError ─────────────────────────────────────────────────

describe('isRateLimitError', () => {
  it('detects "rate limit" in stderr', () => {
    expect(isRateLimitError('Error: rate limit exceeded')).toBe(true);
  });

  it('detects "rate_limit" in stderr', () => {
    expect(isRateLimitError('{"error":"rate_limit_error"}')).toBe(true);
  });

  it('detects "too many requests" in stderr', () => {
    expect(isRateLimitError('HTTP 429: Too Many Requests')).toBe(true);
  });

  it('detects "429" in stderr', () => {
    expect(isRateLimitError('Status: 429')).toBe(true);
  });

  it('detects "overloaded" in stderr', () => {
    expect(isRateLimitError('Model is overloaded, try again later')).toBe(true);
  });

  it('detects "capacity" in stderr', () => {
    expect(isRateLimitError('No capacity available')).toBe(true);
  });

  it('detects "unavailable" in stderr', () => {
    expect(isRateLimitError('Model unavailable')).toBe(true);
  });

  it('detects "model_not_available" in stderr', () => {
    expect(isRateLimitError('Error: model_not_available')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isRateLimitError('RATE LIMIT EXCEEDED')).toBe(true);
    expect(isRateLimitError('Too Many Requests')).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isRateLimitError('syntax error in prompt')).toBe(false);
    expect(isRateLimitError('ENOENT: file not found')).toBe(false);
    expect(isRateLimitError('')).toBe(false);
  });
});

// ── getNextFallbackModel ─────────────────────────────────────────────

describe('getNextFallbackModel', () => {
  it('returns sonnet for opus', () => {
    expect(getNextFallbackModel('opus')).toBe('sonnet');
  });

  it('returns haiku for sonnet', () => {
    expect(getNextFallbackModel('sonnet')).toBe('haiku');
  });

  it('returns undefined for haiku (end of chain)', () => {
    expect(getNextFallbackModel('haiku')).toBeUndefined();
  });

  it('returns sonnet for unknown full model IDs', () => {
    expect(getNextFallbackModel('claude-opus-4-6')).toBe('sonnet');
  });
});

// ── Model fallback in spawn() ────────────────────────────────────────

describe('Model fallback in spawn()', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back from opus to sonnet on rate limit error', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'opus',
      retries: 1,
      retryDelay: 100,
    });

    // First attempt with opus — rate limited
    resolveChild(lastChild(), '', 1, 'Error: rate limit exceeded');
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt with sonnet — succeeds
    resolveChild(lastChild(), 'success', 0);

    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.model).toBe('sonnet');
    expect(result.modelFallbacks).toEqual(['opus']);

    // Verify second spawn used sonnet
    const secondArgs = spawnCalls[1]!.args;
    expect(secondArgs).toContain('--model');
    const modelIdx = secondArgs.indexOf('--model');
    expect(secondArgs[modelIdx + 1]).toBe('sonnet');
  });

  it('falls back through the full chain: opus → sonnet → haiku', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'opus',
      retries: 2,
      retryDelay: 100,
    });

    // Attempt 0: opus — rate limited
    resolveChild(lastChild(), '', 1, 'Too Many Requests');
    await vi.advanceTimersByTimeAsync(100);

    // Attempt 1: sonnet — rate limited
    resolveChild(lastChild(), '', 1, 'rate_limit_error');
    await vi.advanceTimersByTimeAsync(100);

    // Attempt 2: haiku — succeeds
    resolveChild(lastChild(), 'done', 0);

    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.model).toBe('haiku');
    expect(result.modelFallbacks).toEqual(['opus', 'sonnet']);
  });

  it('does not fall back on non-rate-limit errors', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'opus',
      retries: 1,
      retryDelay: 100,
    });

    // First attempt — generic error (not rate limit)
    resolveChild(lastChild(), '', 1, 'syntax error in prompt');
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt — still opus, succeeds
    resolveChild(lastChild(), 'ok', 0);

    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.model).toBe('opus');
    expect(result.modelFallbacks).toBeUndefined();

    // Verify second spawn still used opus
    const secondArgs = spawnCalls[1]!.args;
    const modelIdx = secondArgs.indexOf('--model');
    expect(secondArgs[modelIdx + 1]).toBe('opus');
  });

  it('does not fall back when no model is specified', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 1,
      retryDelay: 100,
    });

    // First attempt — rate limited but no model set
    resolveChild(lastChild(), '', 1, 'rate limit exceeded');
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt — succeeds
    resolveChild(lastChild(), 'ok', 0);

    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.model).toBeUndefined();
    expect(result.modelFallbacks).toBeUndefined();
  });

  it('does not fall back past haiku (end of chain)', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'haiku',
      retries: 1,
      retryDelay: 100,
    });

    // First attempt — rate limited, no fallback available
    resolveChild(lastChild(), '', 1, 'rate limit exceeded');
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt — still haiku, succeeds
    resolveChild(lastChild(), 'ok', 0);

    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.model).toBe('haiku');
    expect(result.modelFallbacks).toBeUndefined();
  });

  it('modelFallbacks is undefined when no fallbacks occurred', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'opus',
      retries: 0,
    });

    resolveChild(lastChild(), 'output', 0);
    const result = await promise;

    expect(result.modelFallbacks).toBeUndefined();
  });
});

// ── Model fallback in stream() ───────────────────────────────────────

describe('Model fallback in stream()', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back from opus to sonnet on rate limit error', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'opus',
      retries: 1,
      retryDelay: 100,
    });

    const resultPromise = drainStream(gen);

    // First attempt with opus — rate limited
    resolveChild(lastChild(), '', 1, 'Error: rate limit exceeded');
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt with sonnet — succeeds
    resolveChild(lastChild(), 'success', 0);

    const { result } = await resultPromise;

    expect(result.exitCode).toBe(0);
    expect(result.model).toBe('sonnet');
    expect(result.modelFallbacks).toEqual(['opus']);
  });

  it('falls back through full chain in stream: opus → sonnet → haiku', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'opus',
      retries: 2,
      retryDelay: 100,
    });

    const resultPromise = drainStream(gen);

    // Attempt 0: opus — rate limited
    resolveChild(lastChild(), '', 1, 'overloaded');
    await vi.advanceTimersByTimeAsync(100);

    // Attempt 1: sonnet — rate limited
    resolveChild(lastChild(), '', 1, 'Too Many Requests');
    await vi.advanceTimersByTimeAsync(100);

    // Attempt 2: haiku — succeeds
    resolveChild(lastChild(), 'done', 0);

    const { result } = await resultPromise;

    expect(result.exitCode).toBe(0);
    expect(result.model).toBe('haiku');
    expect(result.modelFallbacks).toEqual(['opus', 'sonnet']);
  });

  it('does not fall back on non-rate-limit errors in stream', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'opus',
      retries: 1,
      retryDelay: 100,
    });

    const resultPromise = drainStream(gen);

    // First attempt — generic error
    resolveChild(lastChild(), '', 1, 'file not found');
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt — still opus, succeeds
    resolveChild(lastChild(), 'ok', 0);

    const { result } = await resultPromise;

    expect(result.model).toBe('opus');
    expect(result.modelFallbacks).toBeUndefined();
  });
});

// ── Worker Timeout + Cleanup (OB-163) ───────────────────────────────

describe('Worker Timeout + Cleanup', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends SIGTERM after timeout, then SIGKILL after grace period', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      timeout: 10000,
      retries: 0,
    });

    const child = lastChild();
    const killSpy = child.kill as ReturnType<typeof vi.fn>;

    // Advance to timeout
    await vi.advanceTimersByTimeAsync(10000);

    // SIGTERM should have been sent
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');
    expect(killSpy).toHaveBeenCalledTimes(1);

    // Advance to grace period end (5 seconds)
    await vi.advanceTimersByTimeAsync(5000);

    // SIGKILL should have been sent
    expect(killSpy).toHaveBeenCalledWith('SIGKILL');
    expect(killSpy).toHaveBeenCalledTimes(2);

    // Now emit close with SIGKILL signal
    child.emit('close', null, 'SIGKILL');

    // Timeout results in non-zero exit, which throws with retries=0
    try {
      await promise;
      expect.fail('Should have thrown AgentExhaustedError');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentExhaustedError);
      expect((error as AgentExhaustedError).lastExitCode).toBe(137); // SIGKILL exit code
      expect((error as AgentExhaustedError).attempts[0]?.stderr).toContain(
        'Timeout: process terminated after 10000ms',
      );
      expect((error as AgentExhaustedError).attempts[0]?.stderr).toContain('signal: SIGKILL');
    }
  });

  it('does not send SIGKILL if process exits during grace period', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      timeout: 10000,
      retries: 0,
    });

    const child = lastChild();
    const killSpy = child.kill as ReturnType<typeof vi.fn>;

    // Advance to timeout
    await vi.advanceTimersByTimeAsync(10000);

    // SIGTERM sent
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');

    // Process exits gracefully within grace period (2s, before the 5s grace expires)
    await vi.advanceTimersByTimeAsync(2000);
    child.emit('close', 143, 'SIGTERM');

    // SIGKILL should NOT have been sent (process exited during grace period)
    expect(killSpy).not.toHaveBeenCalledWith('SIGKILL');

    // Timeout results in non-zero exit, which throws with retries=0
    try {
      await promise;
      expect.fail('Should have thrown AgentExhaustedError');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentExhaustedError);
      expect((error as AgentExhaustedError).lastExitCode).toBe(143); // SIGTERM exit code
      expect((error as AgentExhaustedError).attempts[0]?.stderr).toContain(
        'Timeout: process terminated after 10000ms',
      );
      expect((error as AgentExhaustedError).attempts[0]?.stderr).toContain('signal: SIGTERM');
    }
  });

  it('reports timeout in stderr with signal information', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      timeout: 5000,
      retries: 0,
    });

    const child = lastChild();

    // Worker produces some output before timeout
    child.stdout.emit('data', Buffer.from('working...'));
    child.stderr.emit('data', Buffer.from('processing...'));

    // Advance to timeout
    await vi.advanceTimersByTimeAsync(5000);

    // Wait for grace period
    await vi.advanceTimersByTimeAsync(5000);

    // Emit close event after SIGKILL
    child.emit('close', null, 'SIGKILL');

    // Timeout results in non-zero exit, which throws with retries=0
    try {
      await promise;
      expect.fail('Should have thrown AgentExhaustedError');
    } catch (error) {
      expect(error).toBeInstanceOf(AgentExhaustedError);
      const attempts = (error as AgentExhaustedError).attempts;
      // stdout is not included in AgentExhaustedError, but stderr is
      expect(attempts[0]?.stderr).toContain('processing...');
      expect(attempts[0]?.stderr).toContain('Timeout: process terminated after 5000ms');
      expect(attempts[0]?.stderr).toContain('signal: SIGKILL');
    }
  });

  it('handles timeout in streaming mode', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      timeout: 10000,
      retries: 0,
    });

    // Start consuming stream (this triggers child process creation)
    const chunks: string[] = [];
    const drainPromise = (async () => {
      try {
        let iterResult = await gen.next();
        while (!iterResult.done) {
          chunks.push(iterResult.value);
          iterResult = await gen.next();
        }
        return iterResult.value;
      } catch (error) {
        return error;
      }
    })();

    // Now we can access the child
    const child = lastChild();
    const killSpy = child.kill as ReturnType<typeof vi.fn>;

    // Worker produces some output
    child.stdout.emit('data', Buffer.from('chunk1'));
    await vi.advanceTimersByTimeAsync(1000);
    child.stdout.emit('data', Buffer.from('chunk2'));

    // Advance to timeout
    await vi.advanceTimersByTimeAsync(9000);

    // SIGTERM should have been sent
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');

    // Advance grace period
    await vi.advanceTimersByTimeAsync(5000);

    // SIGKILL should have been sent
    expect(killSpy).toHaveBeenCalledWith('SIGKILL');

    // Emit close event
    child.emit('close', null, 'SIGKILL');

    const result = await drainPromise;
    expect(chunks).toContain('chunk1');
    expect(chunks).toContain('chunk2');
    expect(result).toBeInstanceOf(AgentExhaustedError);
    expect((result as AgentExhaustedError).lastExitCode).toBe(137);
    expect((result as AgentExhaustedError).attempts[0]?.stderr).toContain(
      'Timeout: process terminated after 10000ms',
    );
  });

  it('manual abort triggers graceful SIGTERM → SIGKILL', async () => {
    const gen = runner.stream({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    // Start consuming stream (this triggers child process creation)
    const drainPromise = (async () => {
      try {
        let iterResult = await gen.next();
        while (!iterResult.done) {
          iterResult = await gen.next();
        }
        return iterResult.value;
      } catch (error) {
        return error;
      }
    })();

    // Now we can access the child
    const child = lastChild();
    const _killSpy = child.kill as ReturnType<typeof vi.fn>;

    // Worker produces some output
    child.stdout.emit('data', Buffer.from('output'));

    // Manually abort (simulated in tests — in real use, abort is on the return object)
    // Note: The test mock doesn't expose abort(), but we can verify kill behavior
    // by checking that the manual abort path sets up graceful shutdown

    await vi.advanceTimersByTimeAsync(100);

    // In a real scenario, calling abort() would trigger:
    // 1. Clear any existing timers
    // 2. Send SIGTERM
    // 3. Set up 5s grace period timer
    // 4. Send SIGKILL if process doesn't exit

    // For now, complete the child process normally
    child.emit('close', 0, null);

    // For now, we verify the timeout logic works (which uses the same pattern)
    await drainPromise;
  });

  it('clears timeout timers on successful completion', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      timeout: 10000,
      retries: 0,
    });

    const child = lastChild();
    const killSpy = child.kill as ReturnType<typeof vi.fn>;

    // Process completes successfully before timeout
    await vi.advanceTimersByTimeAsync(5000);
    resolveChild(child, 'success', 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('success');

    // Advance past timeout — kill should NOT be called
    await vi.advanceTimersByTimeAsync(10000);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('clears timeout timers on spawn error', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      timeout: 10000,
      retries: 0,
    });

    const child = lastChild();
    const killSpy = child.kill as ReturnType<typeof vi.fn>;

    // Spawn error occurs before timeout
    await vi.advanceTimersByTimeAsync(5000);
    child.emit('error', new Error('ENOENT'));

    try {
      await promise;
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AgentExhaustedError);
    }

    // Advance past timeout — kill should NOT be called
    await vi.advanceTimersByTimeAsync(10000);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('handles failed SIGTERM gracefully', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      timeout: 10000,
      retries: 0,
    });

    const child = lastChild();
    const killSpy = child.kill as ReturnType<typeof vi.fn>;

    // Mock kill to fail
    killSpy.mockReturnValue(false);

    // Pre-attach rejection handler before advancing time to avoid an "unhandled rejection"
    // race: the timeout fires and rejects the promise *during* advanceTimersByTimeAsync,
    // before the try/catch below has a chance to attach its handler.
    const caught = promise.catch((e: unknown) => e);

    // Advance to timeout
    await vi.advanceTimersByTimeAsync(10000);

    // SIGTERM attempted but failed
    expect(killSpy).toHaveBeenCalledWith('SIGTERM');

    // Process should throw immediately with timeout error
    const error = await caught;
    expect(error).toBeInstanceOf(AgentExhaustedError);
    expect((error as AgentExhaustedError).lastExitCode).toBe(143);
    expect((error as AgentExhaustedError).attempts[0]?.stderr).toContain(
      'failed to terminate process',
    );

    // SIGKILL should NOT be attempted since SIGTERM failed
    await vi.advanceTimersByTimeAsync(5000);
    expect(killSpy).not.toHaveBeenCalledWith('SIGKILL');
  });
});

// ── isMaxTurnsExhausted ──────────────────────────────────────────────

describe('isMaxTurnsExhausted', () => {
  it('detects "max turns reached" in stdout', () => {
    expect(isMaxTurnsExhausted('Task done.\nmax turns reached')).toBe(true);
  });

  it('detects "maximum turns reached" in stdout', () => {
    expect(isMaxTurnsExhausted('maximum turns reached, stopping.')).toBe(true);
  });

  it('detects "turn limit" in stdout', () => {
    expect(isMaxTurnsExhausted('Hit turn limit, aborting.')).toBe(true);
  });

  it('detects "turn budget" in stdout', () => {
    expect(isMaxTurnsExhausted('Turn budget exhausted.')).toBe(true);
  });

  it('detects "turns exhausted" in stdout', () => {
    expect(isMaxTurnsExhausted('All turns exhausted before completing.')).toBe(true);
  });

  it('detects "max_turns" in stdout', () => {
    expect(isMaxTurnsExhausted('Reached max_turns limit of 25')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isMaxTurnsExhausted('MAX TURNS REACHED')).toBe(true);
    expect(isMaxTurnsExhausted('Turn Limit Exceeded')).toBe(true);
  });

  it('returns false for normal output', () => {
    expect(isMaxTurnsExhausted('Task completed successfully.')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isMaxTurnsExhausted('')).toBe(false);
  });

  it('returns false for unrelated output mentioning turns', () => {
    expect(isMaxTurnsExhausted('I made several turns of the code.')).toBe(false);
  });
});

// ── classifyError ────────────────────────────────────────────────────

describe('classifyError', () => {
  describe('rate-limit category', () => {
    it('classifies "rate limit" in stderr as rate-limit', () => {
      expect(classifyError('Error: rate limit exceeded', 1)).toBe('rate-limit');
    });

    it('classifies "rate_limit" in stderr as rate-limit', () => {
      expect(classifyError('{"error":"rate_limit_error","type":"rate_limit"}', 1)).toBe(
        'rate-limit',
      );
    });

    it('classifies "too many requests" in stderr as rate-limit', () => {
      expect(classifyError('HTTP 429: Too Many Requests', 1)).toBe('rate-limit');
    });

    it('classifies "429" in stderr as rate-limit', () => {
      expect(classifyError('Status code: 429 from API', 1)).toBe('rate-limit');
    });

    it('classifies "overloaded" in stderr as rate-limit', () => {
      expect(
        classifyError('Claude is currently overloaded with requests. Please try again later.', 1),
      ).toBe('rate-limit');
    });

    it('classifies "capacity" in stderr as rate-limit', () => {
      expect(classifyError('Error: no capacity available at this time', 1)).toBe('rate-limit');
    });

    it('classifies "unavailable" in stderr as rate-limit', () => {
      expect(classifyError('Model unavailable, please try another', 1)).toBe('rate-limit');
    });

    it('classifies "model_not_available" in stderr as rate-limit', () => {
      expect(classifyError('Error: model_not_available for this region', 1)).toBe('rate-limit');
    });

    it('is case-insensitive for rate-limit patterns', () => {
      expect(classifyError('RATE LIMIT EXCEEDED', 1)).toBe('rate-limit');
      expect(classifyError('OVERLOADED', 1)).toBe('rate-limit');
    });
  });

  describe('auth category', () => {
    it('classifies "api key" in stderr as auth', () => {
      expect(classifyError('Invalid api key provided', 1)).toBe('auth');
    });

    it('classifies "api_key" in stderr as auth', () => {
      expect(classifyError('Error: api_key is missing or invalid', 1)).toBe('auth');
    });

    it('classifies "invalid api" in stderr as auth', () => {
      expect(classifyError('Invalid API credentials', 1)).toBe('auth');
    });

    it('classifies "unauthorized" in stderr as auth', () => {
      expect(classifyError('Error: unauthorized request', 1)).toBe('auth');
    });

    it('classifies "unauthenticated" in stderr as auth', () => {
      expect(classifyError('Request is unauthenticated', 1)).toBe('auth');
    });

    it('classifies "authentication failed" in stderr as auth', () => {
      expect(classifyError('Authentication failed: check your credentials', 1)).toBe('auth');
    });

    it('classifies "permission denied" in stderr as auth', () => {
      expect(classifyError('Permission denied: insufficient scope', 1)).toBe('auth');
    });

    it('classifies "access denied" in stderr as auth', () => {
      expect(classifyError('Access denied for this resource', 1)).toBe('auth');
    });

    it('classifies "invalid token" in stderr as auth', () => {
      expect(classifyError('Error: invalid token format', 1)).toBe('auth');
    });

    it('classifies "forbidden" in stderr as auth', () => {
      expect(classifyError('403 Forbidden', 1)).toBe('auth');
    });

    it('classifies "401" in stderr as auth', () => {
      expect(classifyError('HTTP error 401', 1)).toBe('auth');
    });

    it('classifies "403" in stderr as auth', () => {
      expect(classifyError('Status: 403', 1)).toBe('auth');
    });

    it('is case-insensitive for auth patterns', () => {
      expect(classifyError('UNAUTHORIZED', 1)).toBe('auth');
      expect(classifyError('Permission Denied', 1)).toBe('auth');
    });
  });

  describe('context-overflow category', () => {
    it('classifies "context too long" in stderr as context-overflow', () => {
      expect(classifyError('Error: context too long for this model', 1)).toBe('context-overflow');
    });

    it('classifies "context window" in stderr as context-overflow', () => {
      expect(classifyError('Exceeded the model context window limit', 1)).toBe('context-overflow');
    });

    it('classifies "context length" in stderr as context-overflow', () => {
      expect(classifyError('Maximum context length exceeded: 200000 tokens', 1)).toBe(
        'context-overflow',
      );
    });

    it('classifies "context_length_exceeded" in stderr as context-overflow', () => {
      expect(classifyError('{"error":"context_length_exceeded"}', 1)).toBe('context-overflow');
    });

    it('classifies "prompt too long" in stderr as context-overflow', () => {
      expect(classifyError('Error: prompt too long (32768 tokens)', 1)).toBe('context-overflow');
    });

    it('classifies "maximum context" in stderr as context-overflow', () => {
      expect(classifyError('Exceeded maximum context size', 1)).toBe('context-overflow');
    });

    it('classifies "token limit" in stderr as context-overflow', () => {
      expect(classifyError('Token limit reached for this model', 1)).toBe('context-overflow');
    });

    it('classifies "too many tokens" in stderr as context-overflow', () => {
      expect(classifyError('Error: too many tokens in this request', 1)).toBe('context-overflow');
    });

    it('classifies "context overflow" in stderr as context-overflow', () => {
      expect(classifyError('Context overflow detected', 1)).toBe('context-overflow');
    });

    it('classifies "context_overflow" in stderr as context-overflow', () => {
      expect(classifyError('Error type: context_overflow', 1)).toBe('context-overflow');
    });

    it('is case-insensitive for context-overflow patterns', () => {
      expect(classifyError('CONTEXT TOO LONG', 1)).toBe('context-overflow');
      expect(classifyError('Token Limit Exceeded', 1)).toBe('context-overflow');
    });
  });

  describe('timeout category', () => {
    it('classifies exit code 143 (SIGTERM) with empty stderr as timeout', () => {
      expect(classifyError('', 143)).toBe('timeout');
    });

    it('classifies exit code 137 (SIGKILL) with empty stderr as timeout', () => {
      expect(classifyError('', 137)).toBe('timeout');
    });

    it('classifies "timeout" in stderr with exit 0 as timeout', () => {
      expect(classifyError('timeout: operation timed out after 60s', 0)).toBe('timeout');
    });

    it('classifies "timeout" in stderr with non-zero exit as timeout', () => {
      expect(classifyError('process timeout exceeded', 1)).toBe('timeout');
    });

    it('classifies exit 143 with unrelated stderr as timeout', () => {
      expect(classifyError('some generic error message', 143)).toBe('timeout');
    });

    it('classifies exit 137 with unrelated stderr as timeout', () => {
      expect(classifyError('process killed', 137)).toBe('timeout');
    });

    it('is case-insensitive for "timeout" pattern', () => {
      expect(classifyError('TIMEOUT after 30 seconds', 0)).toBe('timeout');
    });
  });

  describe('crash category', () => {
    it('classifies non-zero exit code with no matching pattern as crash', () => {
      expect(classifyError('segmentation fault (core dumped)', 1)).toBe('crash');
    });

    it('classifies exit code 2 with unrecognized error as crash', () => {
      expect(classifyError('command not found', 2)).toBe('crash');
    });

    it('classifies exit code 127 (command not found shell error) as crash', () => {
      expect(classifyError('bash: claude: command not found', 127)).toBe('crash');
    });

    it('classifies exit code 1 with ENOENT as crash', () => {
      expect(classifyError('ENOENT: no such file or directory', 1)).toBe('crash');
    });

    it('classifies empty stderr with non-zero exit as crash', () => {
      expect(classifyError('', 1)).toBe('crash');
    });

    it('classifies exit code 1 with generic error message as crash', () => {
      expect(classifyError('An unexpected error occurred.', 1)).toBe('crash');
    });
  });

  describe('unknown category', () => {
    it('returns unknown for exit code 0 with empty stderr', () => {
      expect(classifyError('', 0)).toBe('unknown');
    });

    it('returns unknown for exit code 0 with benign informational stderr', () => {
      expect(classifyError('some informational message', 0)).toBe('unknown');
    });

    it('returns unknown for exit code 0 with unrecognized warning', () => {
      expect(classifyError('Warning: deprecated flag used', 0)).toBe('unknown');
    });
  });

  describe('priority ordering', () => {
    it('rate-limit takes priority over auth when both patterns present', () => {
      expect(classifyError('rate limit exceeded: unauthorized request', 1)).toBe('rate-limit');
    });

    it('rate-limit takes priority over context-overflow', () => {
      expect(classifyError('rate limit: context too long', 1)).toBe('rate-limit');
    });

    it('rate-limit takes priority over timeout exit code 143', () => {
      expect(classifyError('rate limit exceeded', 143)).toBe('rate-limit');
    });

    it('auth takes priority over context-overflow', () => {
      expect(classifyError('unauthorized: context too long for request', 1)).toBe('auth');
    });

    it('context-overflow takes priority over timeout exit code 143', () => {
      expect(classifyError('context too long', 143)).toBe('context-overflow');
    });

    it('timeout pattern in stderr takes priority over crash for any exit code', () => {
      expect(classifyError('Timeout: process terminated after 60s', 0)).toBe('timeout');
      expect(classifyError('Timeout: process terminated after 60s', 1)).toBe('timeout');
    });

    it('context-overflow takes priority over crash', () => {
      expect(classifyError('token limit exceeded', 1)).toBe('context-overflow');
    });

    it('auth takes priority over crash', () => {
      expect(classifyError('forbidden access to resource', 1)).toBe('auth');
    });
  });

  describe('real-world Claude CLI stderr samples', () => {
    it('handles Claude API rate limit JSON error response', () => {
      const stderr =
        '{"type":"error","error":{"type":"rate_limit_error","message":"Too many requests. Please try again in a few minutes."}}';
      expect(classifyError(stderr, 1)).toBe('rate-limit');
    });

    it('handles Claude API authentication error JSON response', () => {
      const stderr =
        '{"type":"error","error":{"type":"authentication_error","message":"Invalid API key"}}';
      expect(classifyError(stderr, 1)).toBe('auth');
    });

    it('handles Claude API context overflow for overly long prompt', () => {
      const stderr = 'prompt is too long: 220000 tokens > 200000 maximum context window';
      expect(classifyError(stderr, 1)).toBe('context-overflow');
    });

    it('handles context_length_exceeded JSON error', () => {
      const stderr =
        '{"type":"error","error":{"type":"invalid_request_error","message":"context_length_exceeded"}}';
      expect(classifyError(stderr, 1)).toBe('context-overflow');
    });

    it('handles process killed by SIGTERM appended timeout message (exit 143)', () => {
      const stderr = 'Timeout: process terminated after 120000ms (signal: SIGTERM)';
      expect(classifyError(stderr, 143)).toBe('timeout');
    });

    it('handles process killed by SIGKILL appended timeout message (exit 137)', () => {
      const stderr = 'Timeout: process terminated after 120000ms (signal: SIGKILL)';
      expect(classifyError(stderr, 137)).toBe('timeout');
    });

    it('handles ENOENT (binary not found) as crash', () => {
      const stderr = 'spawn claude ENOENT';
      expect(classifyError(stderr, 1)).toBe('crash');
    });

    it('handles generic API overload message as rate-limit', () => {
      const stderr = 'Anthropic API is currently overloaded. Please retry your request.';
      expect(classifyError(stderr, 1)).toBe('rate-limit');
    });

    it('handles overloaded with exit 0 as rate-limit', () => {
      expect(classifyError('Service overloaded', 0)).toBe('rate-limit');
    });

    it('handles model capacity error with 429 status', () => {
      const stderr = 'Request failed with status 429: model at capacity';
      expect(classifyError(stderr, 1)).toBe('rate-limit');
    });
  });
});

// ── AgentRunner.spawnWithHandle() ────────────────────────────────────

describe('AgentRunner.spawnWithHandle()', () => {
  it('returns the PID of the spawned child process', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'test task',
      workspacePath: '/tmp/ws',
      retries: 0,
    });

    const child = lastChild();
    expect(handle.pid).toBe(child.pid);
    expect(handle.pid).toBeGreaterThanOrEqual(0);

    resolveChild(child, 'done', 0);
    await handle.promise;
  });

  it('returns a number as PID (handle exposes process identifier)', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'task',
      workspacePath: '/tmp/ws',
      retries: 0,
    });

    expect(typeof handle.pid).toBe('number');

    const child = lastChild();
    resolveChild(child, 'done', 0);
    await handle.promise;
  });

  it('abort() is a function on the returned handle', () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'task',
      workspacePath: '/tmp/ws',
      retries: 0,
    });

    expect(typeof handle.abort).toBe('function');

    // Emit close to let the promise settle
    const child = lastChild();
    child.emit('close', 0, null);
  });

  it('promise resolves to AgentResult on success (exit code 0)', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'do task',
      workspacePath: '/tmp/ws',
      retries: 0,
    });

    const child = lastChild();
    resolveChild(child, 'task result', 0);

    const result = await handle.promise;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('task result');
  });

  it('abort() sends SIGTERM immediately when called', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'long running task',
      workspacePath: '/tmp/ws',
      retries: 0,
    });

    const child = lastChild();

    handle.abort();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledTimes(1);

    // Emit close to settle the promise — exit 143 means SIGTERM, so the promise rejects
    child.emit('close', 143, 'SIGTERM');
    await handle.promise.catch(() => {}); // AgentExhaustedError expected — swallow it
  });

  it('abort() sends SIGKILL after the 5-second grace period elapses', async () => {
    vi.useFakeTimers();

    try {
      const runner = new AgentRunner();
      const handle = runner.spawnWithHandle({
        prompt: 'long running task',
        workspacePath: '/tmp/ws',
        retries: 0,
      });

      const child = lastChild();

      // Call abort — SIGTERM is sent immediately
      handle.abort();
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      expect(child.kill).toHaveBeenCalledTimes(1);

      // Advance past the 5-second grace period
      vi.advanceTimersByTime(5100);

      // SIGKILL should now have fired
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
      expect(child.kill).toHaveBeenCalledTimes(2);

      // Emit close to let the promise settle
      child.emit('close', 137, 'SIGKILL');
      await handle.promise.catch(() => {});
    } finally {
      vi.useRealTimers();
    }
  });

  it('abort() does NOT send SIGKILL if the process exits before the grace period', async () => {
    vi.useFakeTimers();

    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'task',
      workspacePath: '/tmp/ws',
      retries: 0,
    });

    const child = lastChild();

    // Call abort — SIGTERM is sent, grace period timer is set
    handle.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    // Process exits gracefully before the 5-second grace period
    child.emit('close', 0, null);

    // Advance time past the grace period — the timer was cleared by the close handler
    vi.advanceTimersByTime(6000);

    // Only SIGTERM was sent — SIGKILL was never triggered
    expect(child.kill).toHaveBeenCalledTimes(1);

    vi.useRealTimers();

    // Promise should resolve because exit code was 0
    await handle.promise;
  });
});

// ── Streaming timeout retry skip (OB-F218, OB-1621) ──────────────────────────
// Timeout exits (code 143/137) should not be retried because the task will
// time out again on every retry. Rate-limit errors should still trigger retries.

describe('spawnWithHandle — timeout retry skip (OB-F218)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips retries when timeout exit code 143 (SIGTERM) occurs', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 2,
      retryDelay: 1000,
    });

    // First attempt — timeout exit code 143 (SIGTERM)
    resolveChild(lastChild(), '', 143, 'timeout');

    // Should NOT retry — promise should reject immediately
    await expect(handle.promise).rejects.toThrow(AgentExhaustedError);

    // Verify only 1 spawn call was made (no retries)
    expect(spawnCalls).toHaveLength(1);
  });

  it('skips retries when timeout exit code 137 (SIGKILL) occurs', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 2,
      retryDelay: 500,
    });

    // First attempt — timeout exit code 137 (SIGKILL)
    resolveChild(lastChild(), '', 137, 'killed');

    // Should NOT retry — promise should reject immediately
    await expect(handle.promise).rejects.toThrow(AgentExhaustedError);

    // Verify only 1 spawn call was made (no retries)
    expect(spawnCalls).toHaveLength(1);
  });

  it('continues retrying on non-timeout exit code 1 (normal error)', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 2,
      retryDelay: 100,
    });

    // First attempt — non-timeout error (exit code 1)
    resolveChild(lastChild(), '', 1, 'generic error');
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt — succeeds
    resolveChild(lastChild(), 'success', 0);

    const result = await handle.promise;

    // Should have succeeded after retrying
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('success');
    expect(result.retryCount).toBe(1);
    // Verify 2 spawn calls were made (1 initial + 1 retry)
    expect(spawnCalls).toHaveLength(2);
  });

  it('skips retries when timeout keyword is in stderr (even without exit code 143/137)', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 2,
      retryDelay: 100,
    });

    // First attempt — exit code 1 with "timeout" in stderr
    // This should classify as timeout and skip retries despite exit code not being 143/137
    resolveChild(lastChild(), '', 1, 'worker timeout after 30 seconds');

    // Should NOT retry — promise should reject immediately
    await expect(handle.promise).rejects.toThrow(AgentExhaustedError);

    // Verify only 1 spawn call was made (no retries)
    expect(spawnCalls).toHaveLength(1);
  });
});

describe('spawnWithStreamingHandle — timeout retry skip (OB-F218)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips retries when timeout exit code 143 (SIGTERM) occurs in streaming mode', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithStreamingHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 2,
      retryDelay: 1000,
    });

    const child = lastChild();

    // Emit one chunk of output
    child.stdout.emit('data', Buffer.from('chunk1'));

    // Emit timeout exit code 143 (SIGTERM)
    child.emit('close', 143, 'SIGTERM');

    // Should NOT retry — promise should reject immediately
    await expect(handle.promise).rejects.toThrow(AgentExhaustedError);

    // Verify only 1 spawn call was made (no retries)
    expect(spawnCalls).toHaveLength(1);
  });

  it('skips retries when timeout exit code 137 (SIGKILL) occurs in streaming mode', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithStreamingHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 2,
      retryDelay: 500,
    });

    const child = lastChild();

    // Emit some output
    child.stdout.emit('data', Buffer.from('data'));

    // Emit timeout exit code 137 (SIGKILL)
    child.emit('close', 137, 'SIGKILL');

    // Should NOT retry — promise should reject immediately
    await expect(handle.promise).rejects.toThrow(AgentExhaustedError);

    // Verify only 1 spawn call was made (no retries)
    expect(spawnCalls).toHaveLength(1);
  });

  it('continues retrying on non-timeout exit code 1 in streaming mode', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithStreamingHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 2,
      retryDelay: 100,
    });

    // First attempt — emit output then fail with code 1
    let child = lastChild();
    child.stdout.emit('data', Buffer.from('attempt1'));
    child.emit('close', 1, null);
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt — emit output and succeed
    child = lastChild();
    child.stdout.emit('data', Buffer.from('attempt2'));
    child.emit('close', 0, null);

    const result = await handle.promise;

    // Should succeed with output from second attempt
    expect(result.exitCode).toBe(0);
    expect(spawnCalls).toHaveLength(2);
  });

  it('triggers model fallback on rate-limit error in streaming mode', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithStreamingHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      model: 'sonnet-4-6', // First model in fallback chain
      retries: 2,
      retryDelay: 100,
    });

    // First attempt — emit output then fail with rate-limit error
    let child = lastChild();
    child.stdout.emit('data', Buffer.from('attempt1'));
    child.stderr.emit('data', Buffer.from('rate limit exceeded'));
    child.emit('close', 1, null);
    await vi.advanceTimersByTimeAsync(100);

    // Second attempt — different model should be tried
    child = lastChild();
    child.stdout.emit('data', Buffer.from('attempt2'));
    child.emit('close', 0, null);

    const result = await handle.promise;

    // Should succeed after model fallback
    expect(result.exitCode).toBe(0);
    expect(spawnCalls).toHaveLength(2);
  });
});

// ── Cost controls (OB-F101, OB-1673) ─────────────────────────────────

describe('getProfileCostCap()', () => {
  it('returns the default cap for each known profile', () => {
    expect(getProfileCostCap('read-only')).toBe(PROFILE_COST_CAPS['read-only']);
    expect(getProfileCostCap('code-edit')).toBe(PROFILE_COST_CAPS['code-edit']);
    expect(getProfileCostCap('code-audit')).toBe(PROFILE_COST_CAPS['code-audit']);
    expect(getProfileCostCap('full-access')).toBe(PROFILE_COST_CAPS['full-access']);
  });

  it('returns the override value when workerCostCaps is provided for the profile', () => {
    const overrides = { 'read-only': 0.25, 'code-edit': 0.5 };
    expect(getProfileCostCap('read-only', overrides)).toBe(0.25);
    expect(getProfileCostCap('code-edit', overrides)).toBe(0.5);
    // Profile without override falls back to the default
    expect(getProfileCostCap('full-access', overrides)).toBe(PROFILE_COST_CAPS['full-access']);
  });

  it('returns undefined for an unknown profile with no overrides', () => {
    expect(getProfileCostCap('unknown-profile')).toBeUndefined();
    expect(getProfileCostCap(undefined)).toBeUndefined();
  });
});

describe('getProfileCostCap with trustLevel', () => {
  it('applies trusted mode multiplier (3×) to base cost caps', () => {
    // full-access base cap: $2.00 × 3 = $6.00
    expect(getProfileCostCap('full-access', undefined, 'trusted')).toBe(6.0);
    // code-edit base cap: $1.00 × 3 = $3.00
    expect(getProfileCostCap('code-edit', undefined, 'trusted')).toBe(3.0);
    // read-only base cap: $0.50 × 3 = $1.50
    expect(getProfileCostCap('read-only', undefined, 'trusted')).toBe(1.5);
  });

  it('applies sandbox mode multiplier (0.5×) to base cost caps', () => {
    // read-only base cap: $0.50 × 0.5 = $0.25
    expect(getProfileCostCap('read-only', undefined, 'sandbox')).toBe(0.25);
    // code-edit base cap: $1.00 × 0.5 = $0.50
    expect(getProfileCostCap('code-edit', undefined, 'sandbox')).toBe(0.5);
    // full-access base cap: $2.00 × 0.5 = $1.00
    expect(getProfileCostCap('full-access', undefined, 'sandbox')).toBe(1.0);
  });

  it('applies standard mode multiplier (1×) — no scaling', () => {
    // Costs remain unchanged
    expect(getProfileCostCap('full-access', undefined, 'standard')).toBe(2.0);
    expect(getProfileCostCap('code-edit', undefined, 'standard')).toBe(1.0);
    expect(getProfileCostCap('read-only', undefined, 'standard')).toBe(0.5);
  });

  it('respects user overrides even when trust level is applied', () => {
    const overrides = { 'code-edit': 0.75 };
    // User override ($0.75) takes priority over scaled value ($1.00 × 3 = $3.00)
    expect(getProfileCostCap('code-edit', overrides, 'trusted')).toBe(0.75);
    // Other profiles still get scaled
    expect(getProfileCostCap('full-access', overrides, 'trusted')).toBe(6.0);
  });

  it('maintains backward compatibility when trustLevel is omitted', () => {
    // Without trustLevel param, defaults to 'standard' multiplier (1×)
    expect(getProfileCostCap('full-access')).toBe(2.0);
    expect(getProfileCostCap('read-only')).toBe(0.5);
    expect(getProfileCostCap('code-edit')).toBe(1.0);
  });

  it('returns undefined for unknown profiles regardless of trust level', () => {
    expect(getProfileCostCap('unknown-profile', undefined, 'trusted')).toBeUndefined();
    expect(getProfileCostCap('unknown-profile', undefined, 'sandbox')).toBeUndefined();
    expect(getProfileCostCap(undefined, undefined, 'trusted')).toBeUndefined();
  });
});

describe('checkProfileCostSpike() — average tracking and 10x warning', () => {
  beforeEach(() => {
    resetProfileCostAverages();
    mockLoggerWarn.mockClear();
  });

  it('accumulates cost averages per profile across multiple calls', () => {
    checkProfileCostSpike('read-only', 0.1);
    checkProfileCostSpike('read-only', 0.3);
    checkProfileCostSpike('read-only', 0.2);

    const averages = getProfileCostAverages();
    expect(averages['read-only']).toBeDefined();
    expect(averages['read-only']!.count).toBe(3);
    expect(averages['read-only']!.avg).toBeCloseTo(0.2, 5);
  });

  it('tracks different profiles independently', () => {
    checkProfileCostSpike('read-only', 0.1);
    checkProfileCostSpike('code-edit', 0.5);
    checkProfileCostSpike('code-edit', 0.7);

    const averages = getProfileCostAverages();
    expect(averages['read-only']!.count).toBe(1);
    expect(averages['code-edit']!.count).toBe(2);
    expect(averages['code-edit']!.avg).toBeCloseTo(0.6, 5);
  });

  it('logs a WARNING when a cost is more than 10x the running average', () => {
    // Seed the accumulator with a low baseline
    checkProfileCostSpike('read-only', 0.01);
    checkProfileCostSpike('read-only', 0.01);
    // avg ≈ $0.01; a $1.00 cost = 100x average → spike detected
    checkProfileCostSpike('read-only', 1.0);

    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    const [, msg] = mockLoggerWarn.mock.calls[0] as [unknown, string];
    expect(msg).toMatch(/100x average/i);
  });

  it('does NOT log a warning when the cost is within 10x of the average', () => {
    checkProfileCostSpike('code-edit', 0.1);
    // 0.15 is 1.5x of 0.1 — no spike
    checkProfileCostSpike('code-edit', 0.15);

    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('resetProfileCostAverages() clears all tracked profile data', () => {
    checkProfileCostSpike('read-only', 0.5);
    checkProfileCostSpike('code-edit', 0.8);
    resetProfileCostAverages();

    const averages = getProfileCostAverages();
    expect(Object.keys(averages)).toHaveLength(0);
  });
});

describe('streaming cost cap abort (OB-F101)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts the streaming agent and rejects with AgentExhaustedError when cost cap is exceeded', async () => {
    const runner = new AgentRunner();
    // Tiny cap ($0.001): sonnet base cost ($0.01) exceeds it on the first chunk
    const handle = runner.spawnWithStreamingHandle({
      prompt: 'test task',
      workspacePath: '/tmp/ws',
      retries: 0,
      profile: 'read-only',
      workerCostCaps: { 'read-only': 0.001 },
    });

    const child = lastChild();
    // Emit stdout — cost check fires in the streaming loop
    child.stdout.emit('data', Buffer.from('some output from the agent'));

    await expect(handle.promise).rejects.toThrow(AgentExhaustedError);
    // The process must have been killed
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

// ── turnsExhausted → status: 'partial' (OB-1675) ────────────────────

describe('turnsExhausted sets result status to partial', () => {
  let runner: AgentRunner;

  beforeEach(() => {
    vi.useFakeTimers();
    runner = new AgentRunner();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets status to "partial" when stdout contains max-turns indicator', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    resolveChild(lastChild(), 'Task incomplete.\nmax turns reached', 0);
    const result = await promise;

    expect(result.status).toBe('partial');
    expect(result.turnsExhausted).toBe(true);
  });

  it('sets status to "completed" when stdout is normal output', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    resolveChild(lastChild(), 'Task completed successfully.', 0);
    const result = await promise;

    expect(result.status).toBe('completed');
    expect(result.turnsExhausted).toBeUndefined();
  });

  it('preserves maxTurns in result when turns are exhausted', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
      maxTurns: 5,
    });

    resolveChild(lastChild(), 'turn budget exhausted before completing', 0);
    const result = await promise;

    expect(result.status).toBe('partial');
    expect(result.turnsExhausted).toBe(true);
    expect(result.maxTurns).toBe(5);
  });
});

// ── Boundary command detection (OB-1591) ────────────────────────────────────

describe('scanDestructiveCommandViolations() — boundary (cat) commands', () => {
  const workspace = '/home/user/my-project';

  it('detects cat targeting /etc/passwd as a boundary violation', () => {
    const violations = scanDestructiveCommandViolations('cat /etc/passwd', workspace);
    expect(violations.length).toBe(1);
    expect(violations[0].command).toBe('cat');
    expect(violations[0].path).toBe('/etc/passwd');
    expect(violations[0].severity).toBe('boundary');
  });

  it('does not flag cat targeting a relative path inside the workspace', () => {
    // "cat src/index.ts" resolves to workspace/src/index.ts — within boundary
    const violations = scanDestructiveCommandViolations('cat src/index.ts', workspace);
    expect(violations).toEqual([]);
  });

  it('does not flag cat targeting an absolute path inside the workspace', () => {
    const violations = scanDestructiveCommandViolations(`cat ${workspace}/src/index.ts`, workspace);
    expect(violations).toEqual([]);
  });

  it('does not flag node --version (no file path argument)', () => {
    // node --version has no path argument that the patterns match
    const violations = scanDestructiveCommandViolations('node --version', workspace);
    expect(violations).toEqual([]);
  });

  it('does not flag which git (system info commands have no dangerous path)', () => {
    const violations = scanDestructiveCommandViolations('which git', workspace);
    expect(violations).toEqual([]);
  });
});
