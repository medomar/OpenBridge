import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { AgentRunner, AgentExhaustedError } from '../../src/core/agent-runner.js';

// ── Mock logger ─────────────────────────────────────────────────────

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  }),
  setLogLevel: vi.fn(),
}));

// ── Mock node:fs/promises ───────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock child_process.spawn ────────────────────────────────────────

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid?: number;
  kill: ReturnType<typeof vi.fn>;
}

let mockChildren: MockChild[] = [];

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = Math.floor(Math.random() * 100000);
  (child as unknown as Record<string, unknown>).exitCode = null;
  child.kill = vi.fn((_signal?: string) => true);
  mockChildren.push(child);
  return child;
}

vi.mock('node:child_process', () => ({
  spawn: () => createMockChild(),
  execFile: vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, cb?: (...a: unknown[]) => void) => {
      if (cb) cb(null, '', '');
    },
  ),
}));

// ── Helpers ──────────────────────────────────────────────────────────

function lastChild(): MockChild {
  const child = mockChildren[mockChildren.length - 1];
  if (!child) throw new Error('No mock child created');
  return child;
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Kill race condition (OB-F162)', () => {
  beforeEach(() => {
    mockChildren = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('abort() during timeout grace period — SIGKILL sent only once', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'test',
      workspacePath: '/tmp/ws',
      timeout: 10_000,
      retries: 0,
    });

    const child = lastChild();

    // Advance to timeout — SIGTERM fires from the timeout handler
    await vi.advanceTimersByTimeAsync(10_000);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledTimes(1);

    // Now manually abort during the grace period — this sets killed=true,
    // clears the timeout's grace period timer, and sends another SIGTERM
    handle.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    // Two SIGTERMs: one from timeout, one from manual abort
    expect(child.kill).toHaveBeenCalledTimes(2);

    // Advance past both grace periods (original was cleared, only abort's remains)
    await vi.advanceTimersByTimeAsync(6_000);

    // Only ONE SIGKILL should have been sent (from abort's grace period)
    const killCalls = child.kill.mock.calls.map((c: string[]) => c[0]);
    const sigkillCount = killCalls.filter((s: string) => s === 'SIGKILL').length;
    expect(sigkillCount).toBe(1);

    // Total: 2 SIGTERM + 1 SIGKILL = 3
    expect(child.kill).toHaveBeenCalledTimes(3);

    // Settle the promise
    child.emit('close', null, 'SIGKILL');
    await handle.promise.catch(() => {});
  });

  it('timeout after manual abort() — timeout handler skips (killed flag)', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'test',
      workspacePath: '/tmp/ws',
      timeout: 10_000,
      retries: 0,
    });

    const child = lastChild();

    // Manually abort BEFORE timeout fires — sets killed=true, clears timeout timer
    handle.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledTimes(1);

    // Advance past abort's grace period (5s) — SIGKILL fires from abort
    await vi.advanceTimersByTimeAsync(5_000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(child.kill).toHaveBeenCalledTimes(2); // 1 SIGTERM + 1 SIGKILL

    // Advance past the original timeout (10s total) — should NOT fire a second
    // SIGTERM because the timeout timer was cleared by abort()
    await vi.advanceTimersByTimeAsync(6_000);

    // Still only 2 calls — timeout handler never ran
    expect(child.kill).toHaveBeenCalledTimes(2);

    // Settle the promise
    child.emit('close', null, 'SIGKILL');
    await handle.promise.catch(() => {});
  });

  it('process exits naturally before timeout — no kills after exit', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'test',
      workspacePath: '/tmp/ws',
      timeout: 10_000,
      retries: 0,
    });

    const child = lastChild();

    // Process exits normally before timeout
    child.stdout.emit('data', Buffer.from('done'));
    child.emit('close', 0, null);

    // Advance past timeout — should not fire (cleared by close handler)
    await vi.advanceTimersByTimeAsync(15_000);

    // No kill calls at all
    expect(child.kill).not.toHaveBeenCalled();

    await handle.promise;
  });

  it('timeout fires but SIGTERM fails — no grace period SIGKILL scheduled', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'test',
      workspacePath: '/tmp/ws',
      timeout: 5_000,
      retries: 0,
    });

    const child = lastChild();

    // Make SIGTERM fail (returns false)
    child.kill.mockReturnValue(false);

    // Capture the promise rejection before advancing timers
    const resultPromise = handle.promise.catch((error: unknown) => error);

    // Advance to timeout
    await vi.advanceTimersByTimeAsync(5_000);

    // SIGTERM was attempted
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledTimes(1);

    // Advance past grace period — no SIGKILL because SIGTERM failed
    await vi.advanceTimersByTimeAsync(6_000);
    expect(child.kill).toHaveBeenCalledTimes(1); // Still only the failed SIGTERM

    // The promise should have rejected with the timeout error
    const caughtError: unknown = await resultPromise;
    expect(caughtError).toBeInstanceOf(AgentExhaustedError);
  });

  it('double abort() — SIGKILL sent only once', async () => {
    const runner = new AgentRunner();
    const handle = runner.spawnWithHandle({
      prompt: 'test',
      workspacePath: '/tmp/ws',
      retries: 0,
    });

    const child = lastChild();

    // First abort
    handle.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(child.kill).toHaveBeenCalledTimes(1);

    // Second abort — sends another SIGTERM, clears first grace timer, sets new one
    handle.abort();
    expect(child.kill).toHaveBeenCalledTimes(2); // Two SIGTERMs

    // Advance past grace period — only one SIGKILL
    await vi.advanceTimersByTimeAsync(6_000);

    const killCalls = child.kill.mock.calls.map((c: string[]) => c[0]);
    const sigkillCount = killCalls.filter((s: string) => s === 'SIGKILL').length;
    expect(sigkillCount).toBe(1);

    // Settle
    child.emit('close', null, 'SIGKILL');
    await handle.promise.catch(() => {});
  });
});
