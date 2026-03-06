/**
 * Unit tests for graceful shutdown behavior (OB-1125).
 *
 * Tests:
 * (a) shutdownInProgress guard prevents double-shutdown (second call is a no-op)
 * (b) shutdown timeout fires after configured duration and calls process.exit(1)
 * (c) console.log is called with shutdown message when shutdown() is invoked
 *     (SIGINT triggers this same shutdown closure in src/index.ts)
 * (d) MasterManager.shutdown() calls saveMasterSessionToStore() before triggerMemoryUpdate()
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';

// ---------------------------------------------------------------------------
// Module mocks (required by MasterManager)
// ---------------------------------------------------------------------------

vi.mock('../../src/core/agent-runner.js', () => {
  const profiles: Record<string, string[]> = {
    'read-only': ['Read', 'Glob', 'Grep'],
    'code-edit': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)'],
    'full-access': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  };

  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: '',
        stderr: '',
        retryCount: 0,
        durationMs: 50,
      }),
      stream: vi.fn(),
      spawnWithHandle: vi.fn(),
      spawnWithStreamingHandle: vi.fn(),
    })),
    TOOLS_READ_ONLY: profiles['read-only'],
    TOOLS_CODE_EDIT: profiles['code-edit'],
    TOOLS_FULL: profiles['full-access'],
    DEFAULT_MAX_TURNS_EXPLORATION: 15,
    DEFAULT_MAX_TURNS_TASK: 25,
    DEFAULT_MAX_FIX_ITERATIONS: 3,
    sanitizePrompt: vi.fn((s: string) => s),
    buildArgs: vi.fn(),
    isValidModel: vi.fn(() => true),
    MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
    AgentExhaustedError: class AgentExhaustedError extends Error {},
    resolveProfile: (profileName: string): string[] | undefined => profiles[profileName],
    classifyError: () => 'unknown',
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

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers: Shutdown closure factory
//
// The shutdown logic in src/index.ts lives inside main() as a closure.
// We replicate the exact same pattern here so we can test it in isolation
// without needing to spin up the full application (config file, AI discovery, etc.).
// ---------------------------------------------------------------------------

interface MockBridge {
  stop: ReturnType<typeof vi.fn>;
}

function createMockBridge(options?: { hang?: boolean }): MockBridge {
  return {
    stop: options?.hang
      ? vi.fn().mockReturnValue(new Promise<void>(() => {})) // never resolves
      : vi.fn().mockResolvedValue(undefined),
  };
}

/**
 * Creates a shutdown closure equivalent to the one in src/index.ts main().
 * Returns the closure + the shared mutable state for inspection.
 */
function createShutdownClosure(
  mockBridge: MockBridge,
  timeoutMs = 10_000,
): {
  shutdown: () => Promise<void>;
  state: { shutdownInProgress: boolean };
} {
  const state = { shutdownInProgress: false };

  const shutdown = async (): Promise<void> => {
    if (state.shutdownInProgress) {
      return;
    }
    state.shutdownInProgress = true;
    console.log('\nShutting down gracefully... please wait');

    await Promise.race([
      mockBridge.stop(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Shutdown timeout')), timeoutMs),
      ),
    ]).catch((err: unknown) => {
      if (err instanceof Error && err.message === 'Shutdown timeout') {
        console.error('Shutdown timeout exceeded (10s) — forcing exit');
        process.exit(1);
      }
      throw err;
    });

    process.exit(0);
  };

  return { shutdown, state };
}

// ---------------------------------------------------------------------------
// Tests (a), (b), (c): Shutdown closure behavior
// ---------------------------------------------------------------------------

describe('Graceful shutdown closure — logic from src/index.ts (OB-1125)', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Mock process.exit: capture the call and throw so execution stops
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string) => {
      throw new Error(`process.exit(${String(code)})`);
    }) as unknown as ReturnType<typeof vi.spyOn>;
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // (a) shutdownInProgress guard prevents double-shutdown
  // -------------------------------------------------------------------------

  it('(a) shutdownInProgress guard prevents double-shutdown (second call is a no-op)', async () => {
    const mockBridge = createMockBridge();
    const { shutdown } = createShutdownClosure(mockBridge);

    // First shutdown — let it reach process.exit(0) which throws in our mock
    const p1 = shutdown().catch(() => {});
    await vi.runAllTimersAsync();
    await p1;

    // bridge.stop() must have been called exactly once
    expect(mockBridge.stop).toHaveBeenCalledTimes(1);
    // console.log called once for the shutdown message
    expect(consoleSpy).toHaveBeenCalledTimes(1);

    // Second shutdown — shutdownInProgress is now true, so it returns immediately
    const p2 = shutdown();
    await p2;

    // bridge.stop() and console.log still only called once (not twice)
    expect(mockBridge.stop).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // (b) shutdown timeout fires and calls process.exit(1)
  // -------------------------------------------------------------------------

  it('(b) timeout fires after configured duration and calls process.exit(1)', async () => {
    // Bridge that never resolves — simulates a hung stop() call
    const mockBridge = createMockBridge({ hang: true });
    const { shutdown } = createShutdownClosure(mockBridge, 500 /* 500ms timeout for test */);

    let capturedExitCode: number | undefined;
    processExitSpy.mockImplementation((code?: number | string) => {
      capturedExitCode = typeof code === 'number' ? code : undefined;
      throw new Error(`process.exit(${String(code)})`);
    });

    const p = shutdown().catch(() => {});

    // Advance past the 500ms timeout
    await vi.advanceTimersByTimeAsync(600);
    await p;

    // process.exit(1) should have been called — not process.exit(0)
    expect(capturedExitCode).toBe(1);
    // The timeout error message should appear in console.error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Shutdown timeout exceeded'),
    );
  });

  // -------------------------------------------------------------------------
  // (c) console.log is called with shutdown message when shutdown() is invoked
  //     (SIGINT → shutdown() → console.log in src/index.ts)
  // -------------------------------------------------------------------------

  it('(c) console.log is called with shutdown message when shutdown is invoked', async () => {
    const mockBridge = createMockBridge();
    const { shutdown } = createShutdownClosure(mockBridge);

    // Run shutdown (catches process.exit throw)
    await shutdown().catch(() => {});

    expect(consoleSpy).toHaveBeenCalledWith('\nShutting down gracefully... please wait');
  });

  it('(c) shutdown message is logged before bridge.stop() is awaited', async () => {
    const callOrder: string[] = [];

    const mockBridge: MockBridge = {
      stop: vi.fn().mockImplementation(async () => {
        callOrder.push('bridge.stop');
      }),
    };

    consoleSpy.mockImplementation((...args: unknown[]) => {
      if (typeof args[0] === 'string' && args[0].includes('Shutting down gracefully')) {
        callOrder.push('console.log');
      }
    });

    const { shutdown } = createShutdownClosure(mockBridge);
    await shutdown().catch(() => {});

    expect(callOrder[0]).toBe('console.log');
    expect(callOrder[1]).toBe('bridge.stop');
  });
});

// ---------------------------------------------------------------------------
// Test (d): MasterManager.shutdown() — saveMasterSessionToStore before triggerMemoryUpdate
// ---------------------------------------------------------------------------

const masterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  available: true,
  role: 'master',
  capabilities: ['general'],
};

/** Fake session with messageCount > 0 so triggerMemoryUpdate() is triggered on shutdown */
const fakeMasterSession = {
  sessionId: 'test-session-id',
  createdAt: new Date().toISOString(),
  lastUsedAt: new Date().toISOString(),
  messageCount: 5,
  allowedTools: ['Read', 'Write'],
  maxTurns: 50,
};

describe('MasterManager.shutdown() — critical-first ordering (OB-1125)', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    testWorkspace = path.join(process.cwd(), 'test-mm-shutdown-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // -------------------------------------------------------------------------
  // (d) saveMasterSessionToStore() is called before triggerMemoryUpdate()
  // -------------------------------------------------------------------------

  it('(d) saveMasterSessionToStore() is called before triggerMemoryUpdate()', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    const callOrder: string[] = [];

    // Spy on the private methods via type-cast (private is compile-time only)
    const mm = masterManager as unknown as {
      saveMasterSessionToStore: (session: unknown) => Promise<void>;
      triggerMemoryUpdate: () => Promise<void>;
    };

    vi.spyOn(mm, 'saveMasterSessionToStore').mockImplementation(async () => {
      callOrder.push('saveMasterSessionToStore');
    });

    vi.spyOn(mm, 'triggerMemoryUpdate').mockImplementation(async () => {
      callOrder.push('triggerMemoryUpdate');
    });

    // Inject session state required for both branches to execute
    const internal = masterManager as unknown as Record<string, unknown>;
    internal['masterSession'] = { ...fakeMasterSession };
    internal['sessionInitialized'] = true;

    await masterManager.shutdown();

    expect(callOrder).toContain('saveMasterSessionToStore');
    expect(callOrder).toContain('triggerMemoryUpdate');

    const saveIdx = callOrder.indexOf('saveMasterSessionToStore');
    const updateIdx = callOrder.indexOf('triggerMemoryUpdate');
    expect(saveIdx).toBeLessThan(updateIdx);
  });

  // -------------------------------------------------------------------------
  // (d) saveMasterSessionToStore() completes even if triggerMemoryUpdate() throws
  // -------------------------------------------------------------------------

  it('(d) saveMasterSessionToStore() is called even when triggerMemoryUpdate() throws', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    let saveCalledCount = 0;

    const mm = masterManager as unknown as {
      saveMasterSessionToStore: (session: unknown) => Promise<void>;
      triggerMemoryUpdate: () => Promise<void>;
    };

    vi.spyOn(mm, 'saveMasterSessionToStore').mockImplementation(async () => {
      saveCalledCount++;
    });

    vi.spyOn(mm, 'triggerMemoryUpdate').mockImplementation(async () => {
      throw new Error('Memory update failed — simulated error');
    });

    const internal = masterManager as unknown as Record<string, unknown>;
    internal['masterSession'] = { ...fakeMasterSession };
    internal['sessionInitialized'] = true;

    // shutdown() must not throw even when triggerMemoryUpdate() throws
    await expect(masterManager.shutdown()).resolves.toBeUndefined();

    // saveMasterSessionToStore was still called despite the triggerMemoryUpdate failure
    expect(saveCalledCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // (a-MasterManager) shutdown is idempotent — calling twice is a no-op
  // -------------------------------------------------------------------------

  it('MasterManager.shutdown() is idempotent — second call is a no-op', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    let saveCalledCount = 0;

    const mm = masterManager as unknown as {
      saveMasterSessionToStore: (session: unknown) => Promise<void>;
      triggerMemoryUpdate: () => Promise<void>;
    };

    vi.spyOn(mm, 'saveMasterSessionToStore').mockImplementation(async () => {
      saveCalledCount++;
    });
    vi.spyOn(mm, 'triggerMemoryUpdate').mockResolvedValue(undefined);

    const internal = masterManager as unknown as Record<string, unknown>;
    internal['masterSession'] = { ...fakeMasterSession };
    internal['sessionInitialized'] = true;

    await masterManager.shutdown();
    await masterManager.shutdown(); // Second call — state is 'shutdown', should be no-op

    // saveMasterSessionToStore should only be called once (first shutdown)
    expect(saveCalledCount).toBe(1);
  });

  // -------------------------------------------------------------------------
  // triggerMemoryUpdate() skipped when messageCount === 0
  // -------------------------------------------------------------------------

  it('triggerMemoryUpdate() is NOT called when masterSession.messageCount === 0', async () => {
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    let updateCalled = false;

    const mm = masterManager as unknown as {
      saveMasterSessionToStore: (session: unknown) => Promise<void>;
      triggerMemoryUpdate: () => Promise<void>;
    };

    vi.spyOn(mm, 'saveMasterSessionToStore').mockResolvedValue(undefined);
    vi.spyOn(mm, 'triggerMemoryUpdate').mockImplementation(async () => {
      updateCalled = true;
    });

    const internal = masterManager as unknown as Record<string, unknown>;
    // messageCount === 0 — triggerMemoryUpdate should be skipped
    internal['masterSession'] = { ...fakeMasterSession, messageCount: 0 };
    internal['sessionInitialized'] = true;

    await masterManager.shutdown();

    expect(updateCalled).toBe(false);
  });
});
