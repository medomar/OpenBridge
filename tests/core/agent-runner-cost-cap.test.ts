/**
 * Tests for per-worker cost cap enforcement in AgentRunner (OB-1525).
 *
 * Covers:
 *  1. Streaming agent is killed after cumulative cost exceeds maxCostUsd
 *     (cost grows across 3 chunks; cap triggered on the third)
 *  2. Worker with no cost cap (maxCostUsd: undefined) runs to completion
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { AgentRunner } from '../../src/core/agent-runner.js';
import { estimateCostUsd } from '../../src/core/cost-manager.js';
import type { CLIAdapter, CLISpawnConfig } from '../../src/core/cli-adapter.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';

// ── Mock node:fs/promises ─────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock node:child_process ───────────────────────────────────────────────────

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
  child.pid = Math.floor(Math.random() * 100_000) + 1;
  child.kill = vi.fn(() => true);
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function lastChild(): MockChild {
  const child = mockChildren[mockChildren.length - 1];
  if (!child) throw new Error('No mock child created');
  return child;
}

/** Build a string of exactly `byteCount` ASCII characters. */
function makeChunk(byteCount: number): string {
  return 'x'.repeat(byteCount);
}

/** Minimal CLIAdapter stub — uses 'opus' model for cost estimation. */
function makeOpusAdapter(): CLIAdapter {
  return {
    name: 'stub-opus',
    buildSpawnConfig(_opts: SpawnOptions): CLISpawnConfig {
      return {
        binary: 'stub-cli',
        args: ['run'],
        env: {},
      };
    },
    mapCapabilityLevel: () => undefined,
    isValidModel: () => true,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  mockChildren = [];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── Test 1: Cost cap triggered on third chunk ─────────────────────────────────

describe('spawnWithStreamingHandle — per-worker cost cap', () => {
  it('kills the process and returns costCapped:true when cumulative cost exceeds maxCostUsd', async () => {
    /**
     * With model='claude-opus-4-6' the cost formula is:
     *   estimateCostUsd(model, bytes) = 0.05 + (bytes / 1024) * 0.005
     *
     * We emit 3 chunks and cap at $0.06:
     *   chunk1  512 B  → cumulative  512 B → cost ≈ $0.0525  (under cap)
     *   chunk2  512 B  → cumulative 1024 B → cost ≈ $0.0550  (under cap)
     *   chunk3 2048 B  → cumulative 3072 B → cost ≈ $0.0650  (exceeds $0.06 → cap!)
     */
    const CAP = 0.06;
    const CHUNK1 = makeChunk(512);
    const CHUNK2 = makeChunk(512);
    const CHUNK3 = makeChunk(2048);

    // Verify our byte-size expectations match the cost formula used in production.
    expect(estimateCostUsd('claude-opus-4-6', 512)).toBeLessThan(CAP);
    expect(estimateCostUsd('claude-opus-4-6', 1024)).toBeLessThan(CAP);
    expect(estimateCostUsd('claude-opus-4-6', 3072)).toBeGreaterThan(CAP);

    const opts: SpawnOptions = {
      prompt: 'test prompt',
      workspacePath: '/tmp/ws',
      model: 'claude-opus-4-6',
      retries: 0,
      maxCostUsd: CAP,
    };

    const runner = new AgentRunner(makeOpusAdapter());
    const handle = runner.spawnWithStreamingHandle(opts);

    const child = lastChild();

    // Emit 3 chunks synchronously before awaiting the promise.
    child.stdout.emit('data', Buffer.from(CHUNK1));
    child.stdout.emit('data', Buffer.from(CHUNK2));
    child.stdout.emit('data', Buffer.from(CHUNK3));
    child.emit('close', 0, null);

    const result = await handle.promise;

    // Process should have been killed via the abort callback.
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    // Result must be marked as cost-capped.
    expect(result.costCapped).toBe(true);
    expect(result.status).toBe('cost-capped');
    expect(result.exitCode).toBe(1);

    // Partial output — at minimum the first two chunks must be present.
    expect(result.stdout).toContain(CHUNK1);
    expect(result.stdout).toContain(CHUNK2);

    // Reported cost should be the value at the point the cap was triggered.
    expect(result.costUsd).toBeGreaterThan(CAP);
  });

  it('returns completed status when maxCostUsd is undefined, regardless of output size', async () => {
    // Emit 100 KB of data — well above any default cap — but no maxCostUsd is set.
    const LARGE_OUTPUT = makeChunk(100 * 1024);

    const opts: SpawnOptions = {
      prompt: 'test prompt',
      workspacePath: '/tmp/ws',
      model: 'claude-opus-4-6',
      retries: 0,
      // maxCostUsd intentionally absent — no per-worker cap applied
    };

    const runner = new AgentRunner(makeOpusAdapter());
    const handle = runner.spawnWithStreamingHandle(opts);

    const child = lastChild();
    child.stdout.emit('data', Buffer.from(LARGE_OUTPUT));
    child.emit('close', 0, null);

    const result = await handle.promise;

    // No kill should have been triggered by cost logic.
    expect(child.kill).not.toHaveBeenCalledWith('SIGTERM');

    // Run must complete normally.
    expect(result.costCapped).toBeUndefined();
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(LARGE_OUTPUT);
  });
});
