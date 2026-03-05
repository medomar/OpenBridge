import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { parseTurnIndicator, AgentRunner } from '../../src/core/agent-runner.js';
import type { TurnIndicator } from '../../src/core/agent-runner.js';

// ── Mock node:fs/promises ────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock node:child_process ──────────────────────────────────────────

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid?: number;
  kill: (signal?: string) => boolean;
}

let mockChildren: MockChild[] = [];

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = Math.floor(Math.random() * 100000) + 1;
  child.kill = vi.fn(() => true);
  mockChildren.push(child);
  return child;
}

vi.mock('node:child_process', () => ({
  spawn: () => createMockChild(),
  // DockerSandbox (imported transitively via agent-runner) uses execFile.
  // Provide a no-op stub so tests that don't exercise docker mode still pass.
  execFile: vi.fn(
    (_cmd: string, _args: string[], _opts: unknown, cb?: (...a: unknown[]) => void) => {
      if (cb) cb(null, '', '');
    },
  ),
}));

function lastChild(): MockChild {
  const child = mockChildren[mockChildren.length - 1];
  if (!child) throw new Error('No mock child created');
  return child;
}

beforeEach(() => {
  mockChildren = [];
});

// ── parseTurnIndicator() ─────────────────────────────────────────────

describe('parseTurnIndicator', () => {
  it('returns null for empty string', () => {
    expect(parseTurnIndicator('')).toBeNull();
  });

  it('returns null for plain text with no turn indicator', () => {
    expect(parseTurnIndicator('Reading file src/index.ts')).toBeNull();
  });

  it('returns null for whitespace-only chunk', () => {
    expect(parseTurnIndicator('   \n  ')).toBeNull();
  });

  it('parses "Turn 1" pattern', () => {
    const result = parseTurnIndicator('Turn 1\nUsing Read tool...');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(1);
  });

  it('parses "Turn 2" pattern', () => {
    const result = parseTurnIndicator('Turn 2');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(2);
  });

  it('parses "Turn 15" pattern (double-digit)', () => {
    const result = parseTurnIndicator('Turn 15: analyzing code');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(15);
  });

  it('parses "agentic turn" pattern (case-insensitive)', () => {
    const result = parseTurnIndicator('Running Agentic Turn 3 now...');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(3);
  });

  it('parses JSON turn pattern {"turn": 1}', () => {
    const result = parseTurnIndicator('{"turn": 1, "action": "read"}');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(1);
  });

  it('parses JSON turn pattern {"turn": 5}', () => {
    const result = parseTurnIndicator('status: {"turn": 5}');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(5);
  });

  it('parses "(N agentic turns used)" pattern', () => {
    const result = parseTurnIndicator('(3 agentic turns used)');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(3);
  });

  it('parses "(1 agentic turns used)" pattern', () => {
    const result = parseTurnIndicator('Progress: (1 agentic turns used) so far');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(1);
  });

  it('parses "Step N of M" pattern', () => {
    const result = parseTurnIndicator('Step 5 of 25: analyzing code');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(5);
  });

  it('parses "Step 1 of 25" pattern', () => {
    const result = parseTurnIndicator('Step 1 of 25');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(1);
  });

  it('returns null when turn number is 0 (invalid)', () => {
    const result = parseTurnIndicator('Turn 0');
    expect(result).toBeNull();
  });

  it('extracts lastAction from first non-empty line', () => {
    const result = parseTurnIndicator('Turn 2\nExecuting Read tool on src/index.ts');
    expect(result).not.toBeNull();
    expect(result!.lastAction).toBe('Turn 2');
  });

  it('extracts lastAction skipping leading empty lines', () => {
    const result = parseTurnIndicator('\n\nTurn 4\nRunning tests');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(4);
    expect(result!.lastAction).toBe('Turn 4');
  });

  it('returns TurnIndicator with lastAction when chunk has only the turn marker', () => {
    const result = parseTurnIndicator('Turn 5');
    expect(result).not.toBeNull();
    expect(result!.turnsUsed).toBe(5);
    expect(result!.lastAction).toBe('Turn 5');
  });

  it('returns TurnIndicator matching the TurnIndicator interface shape', () => {
    const result = parseTurnIndicator('Turn 7\nSome action');
    expect(result).toMatchObject<Partial<TurnIndicator>>({
      turnsUsed: 7,
    });
    expect(typeof result!.lastAction === 'string' || result!.lastAction === undefined).toBe(true);
  });
});

// ── AgentRunner.spawnWithStreamingHandle() — onProgress callback ─────

describe('AgentRunner.spawnWithStreamingHandle() onProgress callback', () => {
  it('calls onProgress with TurnIndicator when a turn chunk arrives', async () => {
    const runner = new AgentRunner();
    const onProgress = vi.fn<(indicator: TurnIndicator) => void>();

    const handle = runner.spawnWithStreamingHandle(
      { prompt: 'test', workspacePath: '/tmp', retries: 0 },
      onProgress,
    );

    const child = lastChild();
    child.stdout.emit('data', Buffer.from('Turn 1\nReading files...'));
    child.emit('close', 0, null);

    const result = await handle.promise;
    expect(result.exitCode).toBe(0);
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress.mock.calls[0]![0].turnsUsed).toBe(1);
  });

  it('does not call onProgress for chunks without turn indicators', async () => {
    const runner = new AgentRunner();
    const onProgress = vi.fn<(indicator: TurnIndicator) => void>();

    const handle = runner.spawnWithStreamingHandle(
      { prompt: 'test', workspacePath: '/tmp', retries: 0 },
      onProgress,
    );

    const child = lastChild();
    child.stdout.emit('data', Buffer.from('Analyzing src/index.ts...'));
    child.stdout.emit('data', Buffer.from('Reading package.json...'));
    child.emit('close', 0, null);

    await handle.promise;
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('calls onProgress for each chunk that contains a turn indicator', async () => {
    const runner = new AgentRunner();
    const onProgress = vi.fn<(indicator: TurnIndicator) => void>();

    const handle = runner.spawnWithStreamingHandle(
      { prompt: 'test', workspacePath: '/tmp', retries: 0 },
      onProgress,
    );

    const child = lastChild();
    child.stdout.emit('data', Buffer.from('Turn 1\nReading index.ts'));
    child.stdout.emit('data', Buffer.from('Some plain output'));
    child.stdout.emit('data', Buffer.from('Turn 2\nEditing file'));
    child.stdout.emit('data', Buffer.from('Turn 3\nAll done'));
    child.emit('close', 0, null);

    await handle.promise;

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress.mock.calls[0]![0].turnsUsed).toBe(1);
    expect(onProgress.mock.calls[1]![0].turnsUsed).toBe(2);
    expect(onProgress.mock.calls[2]![0].turnsUsed).toBe(3);
  });

  it('accumulates all stdout chunks in the final AgentResult', async () => {
    const runner = new AgentRunner();

    const handle = runner.spawnWithStreamingHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    const child = lastChild();
    child.stdout.emit('data', Buffer.from('chunk1 '));
    child.stdout.emit('data', Buffer.from('Turn 1\n'));
    child.stdout.emit('data', Buffer.from('chunk3'));
    child.emit('close', 0, null);

    const result = await handle.promise;
    expect(result.stdout).toBe('chunk1 Turn 1\nchunk3');
  });

  it('works without an onProgress callback (does not throw)', async () => {
    const runner = new AgentRunner();

    const handle = runner.spawnWithStreamingHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    const child = lastChild();
    child.stdout.emit('data', Buffer.from('Turn 1\nSome output'));
    child.emit('close', 0, null);

    await expect(handle.promise).resolves.toMatchObject({ exitCode: 0 });
  });

  it('returns the correct pid synchronously before resolution', () => {
    const runner = new AgentRunner();

    const handle = runner.spawnWithStreamingHandle({
      prompt: 'test',
      workspacePath: '/tmp',
      retries: 0,
    });

    expect(handle.pid).toBeGreaterThan(0);

    // Settle the promise to avoid open handles
    lastChild().emit('close', 0, null);
    return handle.promise;
  });

  it('onProgress receives lastAction from the chunk text', async () => {
    const runner = new AgentRunner();
    const onProgress = vi.fn<(indicator: TurnIndicator) => void>();

    const handle = runner.spawnWithStreamingHandle(
      { prompt: 'test', workspacePath: '/tmp', retries: 0 },
      onProgress,
    );

    const child = lastChild();
    child.stdout.emit('data', Buffer.from('Turn 3\nCalling Bash tool'));
    child.emit('close', 0, null);

    await handle.promise;
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress.mock.calls[0]![0].lastAction).toBe('Turn 3');
  });

  it('onProgress is called with JSON-pattern turn indicators', async () => {
    const runner = new AgentRunner();
    const onProgress = vi.fn<(indicator: TurnIndicator) => void>();

    const handle = runner.spawnWithStreamingHandle(
      { prompt: 'test', workspacePath: '/tmp', retries: 0 },
      onProgress,
    );

    const child = lastChild();
    child.stdout.emit('data', Buffer.from('{"turn": 4, "action": "write"}'));
    child.emit('close', 0, null);

    await handle.promise;
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress.mock.calls[0]![0].turnsUsed).toBe(4);
  });
});
