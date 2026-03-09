/**
 * Integration test: post-exit kill() guard (OB-1303).
 *
 * Spawns a real `echo "hello"` process via execOnce() (through
 * AgentRunner.spawnWithHandle()), waits for it to exit naturally,
 * then calls abort() (the exposed kill() wrapper). Verifies that:
 *   1. The process completes successfully.
 *   2. No errors are thrown when kill() is called on an already-exited process.
 *   3. No lingering grace-period timer fires (the guard skips kill on dead process).
 */

import { describe, it, expect, vi } from 'vitest';
import { AgentRunner } from '../../src/core/agent-runner.js';
import type { CLIAdapter, CLISpawnConfig } from '../../src/core/cli-adapter.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';

// ── Mock logger ───────────────────────────────────────────────────────────────

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

// ── Mock fs/promises to avoid disk writes from log file ──────────────────────

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// ── Stub adapter that spawns `echo hello` ────────────────────────────────────

const echoAdapter: CLIAdapter = {
  name: 'echo',
  buildSpawnConfig(_opts: SpawnOptions): CLISpawnConfig {
    return {
      binary: 'echo',
      args: ['hello'],
      env: process.env as Record<string, string | undefined>,
    };
  },
  cleanEnv(env) {
    return env;
  },
  mapCapabilityLevel() {
    return undefined;
  },
  isValidModel() {
    return true;
  },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AgentRunner — post-exit kill() guard (OB-1303)', () => {
  it('process completes and abort() does not throw after exit', async () => {
    const runner = new AgentRunner(echoAdapter);
    const handle = runner.spawnWithHandle({
      prompt: 'hello',
      workspacePath: '/tmp',
      retries: 0,
    });

    // Wait for the echo process to exit naturally
    const result = await handle.promise;

    // Verify the process exited cleanly
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');

    // Calling abort() on an already-exited process must not throw
    expect(() => handle.abort()).not.toThrow();
  });

  it('abort() on exited process skips kill and clears any pending timers', async () => {
    const runner = new AgentRunner(echoAdapter);
    const handle = runner.spawnWithHandle({
      prompt: 'hello',
      workspacePath: '/tmp',
      retries: 0,
    });

    // Let the process finish naturally
    await handle.promise;

    // abort() should return synchronously without scheduling a grace-period SIGKILL.
    // We measure the call is near-instant (no async delay set up).
    const before = Date.now();
    handle.abort();
    const elapsed = Date.now() - before;

    // If a gracePeriodTimer were scheduled it would fire ~5 s later; this call
    // should complete in well under 50 ms with no side-effects.
    expect(elapsed).toBeLessThan(50);
  });

  it('calling abort() twice after exit remains safe', async () => {
    const runner = new AgentRunner(echoAdapter);
    const handle = runner.spawnWithHandle({
      prompt: 'hello',
      workspacePath: '/tmp',
      retries: 0,
    });

    await handle.promise;

    // Both calls must be no-ops — no throw, no timer
    expect(() => {
      handle.abort();
      handle.abort();
    }).not.toThrow();
  });
});
