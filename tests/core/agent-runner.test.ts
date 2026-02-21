import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  sanitizePrompt,
  buildArgs,
  AgentRunner,
  TOOLS_READ_ONLY,
  TOOLS_CODE_EDIT,
  TOOLS_FULL,
  DEFAULT_MAX_TURNS_EXPLORATION,
  DEFAULT_MAX_TURNS_TASK,
} from '../../src/core/agent-runner.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';

// ── Mock child_process.spawn ────────────────────────────────────────

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

let spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
let mockChildren: MockChild[] = [];

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  mockChildren.push(child);
  return child;
}

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    spawnCalls.push({ command, args, options });
    return createMockChild();
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────

function lastChild(): MockChild {
  const child = mockChildren[mockChildren.length - 1];
  if (!child) throw new Error('No mock child created');
  return child;
}

function resolveChild(child: MockChild, stdout: string, exitCode: number, stderr = ''): void {
  if (stdout) child.stdout.emit('data', Buffer.from(stdout));
  if (stderr) child.stderr.emit('data', Buffer.from(stderr));
  child.emit('close', exitCode);
}

// ── Setup ───────────────────────────────────────────────────────────

beforeEach(() => {
  spawnCalls = [];
  mockChildren = [];
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
    const long = 'a'.repeat(40_000);
    const result = sanitizePrompt(long);
    expect(result.length).toBe(32_768);
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

  it('TOOLS_CODE_EDIT contains editing tools plus scoped Bash', () => {
    expect(TOOLS_CODE_EDIT).toEqual([
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(git:*)',
      'Bash(npm:*)',
      'Bash(npx:*)',
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
    expect(toolFlags).toHaveLength(8);
    expect(args).toContain('Bash(git:*)');
    expect(args).toContain('Bash(npm:*)');
    expect(args).toContain('Bash(npx:*)');
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
  it('DEFAULT_MAX_TURNS_EXPLORATION is 15', () => {
    expect(DEFAULT_MAX_TURNS_EXPLORATION).toBe(15);
  });

  it('DEFAULT_MAX_TURNS_TASK is 25', () => {
    expect(DEFAULT_MAX_TURNS_TASK).toBe(25);
  });

  it('exploration default is lower than task default', () => {
    expect(DEFAULT_MAX_TURNS_EXPLORATION).toBeLessThan(DEFAULT_MAX_TURNS_TASK);
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
    expect(args[idx + 1]).toBe('15');
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

  it('returns last failed result after all retries exhausted', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 1,
      retryDelay: 500,
    });

    // First attempt
    resolveChild(lastChild(), 'out1', 143, 'killed');
    await vi.advanceTimersByTimeAsync(500);

    // Second attempt
    resolveChild(lastChild(), 'out2', 143, 'killed again');

    const result = await promise;

    expect(result.exitCode).toBe(143);
    expect(result.stdout).toBe('out2');
    expect(result.retryCount).toBe(1);
  });

  it('does not retry when retries is 0', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    resolveChild(lastChild(), '', 1, 'fail');
    const result = await promise;

    expect(result.exitCode).toBe(1);
    expect(result.retryCount).toBe(0);
    expect(spawnCalls).toHaveLength(1);
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

  it('passes timeout to the underlying spawn', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      timeout: 60_000,
      retries: 0,
    });

    resolveChild(lastChild(), '', 0);
    await promise;

    expect(spawnCalls[0]!.options['timeout']).toBe(60_000);
  });

  it('propagates spawn errors on final attempt', async () => {
    const promise = runner.spawn({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    lastChild().emit('error', new Error('ENOENT'));

    await expect(promise).rejects.toThrow('ENOENT');
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
