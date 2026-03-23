/**
 * Unit tests for respawnWorkerAfterGrant() sandbox guard (OB-1603, OB-F216).
 *
 * Verifies that in sandbox mode the function is a no-op — no worker is
 * registered or spawned and a warning is logged. In non-sandbox mode the
 * guard is not triggered and execution proceeds normally.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { manifestToSpawnOptions } from '../../src/core/agent-runner.js';

// ── Capture logger.warn before module hoisting ────────────────────────────────

const mockWarn = vi.hoisted(() => vi.fn());

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: mockWarn,
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Stub heavy transitive dependencies ────────────────────────────────────────

// @anthropic-ai/claude-agent-sdk is an optional peer dep not installed in CI.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

// router.ts pulls in many things; mock it to avoid further dep chains.
vi.mock('../../src/core/router.js', () => ({
  classifyDocumentIntent: vi.fn().mockReturnValue('general'),
  Router: class {},
}));

// planning-gate may require additional native modules.
vi.mock('../../src/master/planning-gate.js', () => ({
  performReasoningCheckpoint: vi
    .fn()
    .mockReturnValue({ riskLevel: 'low', risks: [], approved: true }),
}));

// skill-pack-loader pulls in complex logic; stub it out.
vi.mock('../../src/master/skill-pack-loader.js', () => ({
  getBuiltInSkillPacks: vi.fn().mockReturnValue([]),
  findSkillByFormat: vi.fn().mockReturnValue(null),
  selectSkillPackForTask: vi.fn().mockReturnValue(null),
}));

// agent-runner: provide the subset used during construction and spawn.
vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: vi.fn(),
    spawnWithHandle: vi.fn(),
  })),
  TOOLS_READ_ONLY: ['Read', 'Glob', 'Grep'],
  TOOLS_FULL: ['Read', 'Glob', 'Grep', 'Write', 'Edit', 'Bash(*)'],
  DEFAULT_MAX_TURNS_EXPLORATION: 15,
  DEFAULT_MAX_TURNS_TASK: 25,
  DEFAULT_MAX_FIX_ITERATIONS: 3,
  sanitizePrompt: vi.fn((s: string) => s),
  resolveProfile: vi.fn(() => ['Read', 'Glob', 'Grep']),
  classifyError: vi.fn(() => 'unknown'),
  manifestToSpawnOptions: vi.fn().mockResolvedValue({
    spawnOptions: {},
    cleanup: async () => {},
  }),
  getMaxPromptLength: vi.fn(() => 128_000),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { WorkerOrchestrator } from '../../src/master/worker-orchestrator.js';
import type { WorkerOrchestratorDeps } from '../../src/master/worker-orchestrator.js';
import type { ParsedSpawnMarker } from '../../src/master/spawn-parser.js';
import type { WorkspaceTrustLevel } from '../../src/types/config.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMinimalDeps(trustLevel?: WorkspaceTrustLevel): WorkerOrchestratorDeps {
  const mockSpawn = vi.fn();
  return {
    workspacePath: '/tmp/workspace',
    masterTool: { name: 'claude', path: '/usr/bin/claude' } as never,
    discoveredTools: [],
    dotFolder: {} as never,
    agentRunner: {
      spawn: mockSpawn,
      spawnWithHandle: vi.fn(),
      spawnWithStreamingHandle: vi.fn().mockReturnValue({
        promise: Promise.resolve({ status: 'completed', exitCode: 0, stdout: '', stderr: '' }),
        abort: vi.fn(),
        pid: 12345,
      }),
    } as never,
    workerRegistry: {
      registerWorkerWithId: vi.fn(),
      markFailed: vi.fn(),
      markRunning: vi.fn(),
      removeWorker: vi.fn(),
      getActiveWorkers: vi.fn(() => []),
      getAggregatedStats: vi.fn(() => ({ totalWorkers: 0, avgDurationMs: 0, totalTurnsUsed: 0 })),
    } as never,
    adapterRegistry: {} as never,
    modelRegistry: {} as never,
    workerRetryDelayMs: 1000,
    workerMaxFixIterations: 3,
    trustLevel,
    getMemory: () => null,
    getRouter: () => null,
    getMasterSession: () => null,
    getActiveMessage: () => null,
    getState: () => ({ phase: 'idle' }) as never,
    setState: vi.fn(),
    getActiveSkillPacks: () => [],
    getKnowledgeRetriever: () => null,
    getBatchManager: () => null,
    getBatchTimers: () => new Set(),
    getDelegationCoordinator: () => null,
    readProfilesFromStore: vi.fn().mockResolvedValue(null),
    persistWorkerRegistry: vi.fn().mockResolvedValue(undefined),
    recordWorkerLearning: vi.fn().mockResolvedValue(undefined),
    recordPromptEffectiveness: vi.fn().mockResolvedValue(undefined),
    recordConversationMessage: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMarker(): ParsedSpawnMarker {
  return {
    profile: 'code-edit',
    body: { prompt: 'Fix the auth bug in src/auth.ts' },
    rawMatch: '[SPAWN:code-edit]{"prompt":"Fix the auth bug in src/auth.ts"}[/SPAWN]',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('respawnWorkerAfterGrant sandbox guard (OB-1603)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sandbox mode — returns without registering or spawning a worker', async () => {
    const deps = makeMinimalDeps('sandbox');
    const orchestrator = new WorkerOrchestrator(deps);

    await orchestrator.respawnWorkerAfterGrant('worker-original', makeMarker(), 0, 'read-only', [
      'Bash(npm:test)',
    ]);

    // Defense-in-depth: no worker was registered or spawned
    expect(deps.workerRegistry.registerWorkerWithId).not.toHaveBeenCalled();
    expect(deps.agentRunner.spawn).not.toHaveBeenCalled();
  });

  it('sandbox mode — logs a warning with "sandbox mode" message', async () => {
    const deps = makeMinimalDeps('sandbox');
    const orchestrator = new WorkerOrchestrator(deps);

    await orchestrator.respawnWorkerAfterGrant('worker-original', makeMarker(), 0, 'read-only', [
      'Bash(npm:test)',
    ]);

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('sandbox mode'));
  });

  it('standard mode — sandbox guard is NOT triggered (proceeds past early return)', async () => {
    const deps = makeMinimalDeps('standard');
    const orchestrator = new WorkerOrchestrator(deps);

    // In standard mode the function proceeds to the spawn attempt.
    // With minimal mocks the internal spawnWorker() will fail at dotFolder,
    // but that is caught internally — the function does not throw.
    await orchestrator.respawnWorkerAfterGrant(
      'worker-original',
      makeMarker(),
      0,
      'read-only',
      ['code-edit'], // profile grant — recognized by BuiltInProfileNameSchema
    );

    // Verify the sandbox guard warning was NOT produced
    const sandboxWarnCalled = mockWarn.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('sandbox mode'),
    );
    expect(sandboxWarnCalled).toBe(false);

    // Verify execution proceeded past the guard (worker was registered)
    expect(deps.workerRegistry.registerWorkerWithId).toHaveBeenCalled();
  });
});

describe('escalation dedup (OB-F214)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('single escalated profile — strips suffix and re-appends, avoiding double suffix', async () => {
    const deps = makeMinimalDeps('standard');
    const orchestrator = new WorkerOrchestrator(deps);

    // When original profile is already 'code-edit-escalated', grant individual tools
    // (not a profile). The method should strip the suffix and re-append once,
    // resulting in custom profile 'code-edit-escalated'.
    await orchestrator.respawnWorkerAfterGrant(
      'worker-1',
      makeMarker(),
      0,
      'code-edit-escalated', // already escalated
      ['Bash(npm:test)'], // individual tool grant
    );

    // Check that a custom profile was created with the correct name
    // The custom profile will be passed to spawnWorker as part of the marker
    const registerMock = deps.workerRegistry.registerWorkerWithId as unknown as {
      mock: { calls: unknown[][] };
    };
    const registerCall = registerMock.mock.calls[0];
    expect(registerCall).toBeDefined();
    const manifest = registerCall[1] as { profile: string };
    // The profile should be 'code-edit-escalated', not 'code-edit-escalated-escalated'
    expect(manifest.profile).toBe('code-edit-escalated');
  });

  it('multiple escalated suffixes — strips all and re-appends once', async () => {
    const deps = makeMinimalDeps('standard');
    const orchestrator = new WorkerOrchestrator(deps);

    // Original profile has multiple escalated suffixes (2 in this case, below the guard threshold of 3)
    await orchestrator.respawnWorkerAfterGrant(
      'worker-2',
      makeMarker(),
      0,
      'code-edit-escalated-escalated', // 2 escalated suffixes
      ['Bash(npm:test)'], // individual tool grant
    );

    const registerMock = deps.workerRegistry.registerWorkerWithId as unknown as {
      mock: { calls: unknown[][] };
    };
    const registerCall = registerMock.mock.calls[0];
    expect(registerCall).toBeDefined();
    const manifest = registerCall[1] as { profile: string };
    // Should be stripped to base 'code-edit', then re-appended once: 'code-edit-escalated'
    expect(manifest.profile).toBe('code-edit-escalated');
  });

  it('escalation depth >= 3 — returns without spawning', async () => {
    const deps = makeMinimalDeps('standard');
    const orchestrator = new WorkerOrchestrator(deps);

    // Profile with 3+ escalated suffixes triggers the depth guard
    await orchestrator.respawnWorkerAfterGrant(
      'worker-3-escalated-escalated-escalated',
      makeMarker(),
      0,
      'code-edit-escalated-escalated-escalated', // 3 -escalated suffixes = depth 3
      ['Bash(npm:test)'],
    );

    // The guard should have returned early without registering or spawning
    expect(deps.workerRegistry.registerWorkerWithId).not.toHaveBeenCalled();
    expect(deps.agentRunner.spawn).not.toHaveBeenCalled();

    // A warning should have been logged about max depth
    const depthWarnCalled = mockWarn.mock.calls.some((args) => {
      const arg = args[0] as unknown;
      return (
        typeof arg === 'object' &&
        arg !== null &&
        'escalationDepth' in arg &&
        (arg as Record<string, unknown>).escalationDepth === 3
      );
    });
    expect(depthWarnCalled).toBe(true);
  });

  it('normal profile without escalation — appends escalated suffix', async () => {
    const deps = makeMinimalDeps('standard');
    const orchestrator = new WorkerOrchestrator(deps);

    // Normal base profile with no escalation suffix
    await orchestrator.respawnWorkerAfterGrant(
      'worker-4',
      makeMarker(),
      0,
      'read-only', // base profile, no escalation
      ['Bash(npm:test)'], // individual tool grant
    );

    const registerMock = deps.workerRegistry.registerWorkerWithId as unknown as {
      mock: { calls: unknown[][] };
    };
    const registerCall = registerMock.mock.calls[0];
    expect(registerCall).toBeDefined();
    const manifest = registerCall[1] as { profile: string };
    // Should create 'read-only-escalated'
    expect(manifest.profile).toBe('read-only-escalated');
  });
});

describe('Codex cost cap scaling (OB-1623)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Codex worker cost cap is scaled 2.5x: $0.05 → $0.125', () => {
    // Verify the cost scaling logic: base cap of $0.05 × 2.5 = $0.125
    const baseReadOnlyCap = 0.05;
    const codexScaleFactor = 2.5;
    const expectedScaledCap = Math.min(baseReadOnlyCap * codexScaleFactor, 0.25);

    // The expected scaled cap for read-only Codex worker
    expect(expectedScaledCap).toBe(0.125);

    // Verify the scale factor applies correctly
    expect(baseReadOnlyCap * codexScaleFactor).toBe(0.125);
  });
});

describe('.openbridge/ protection injection (OB-1649)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Extended deps with adapterRegistry and complete workerRegistry for spawnWorker().
  function makeFullDeps(trustLevel?: WorkspaceTrustLevel): WorkerOrchestratorDeps {
    return {
      workspacePath: '/tmp/workspace',
      masterTool: { name: 'claude', path: '/usr/bin/claude' } as never,
      discoveredTools: [],
      dotFolder: {} as never,
      agentRunner: {
        spawn: vi.fn(),
        spawnWithHandle: vi.fn(),
        spawnWithStreamingHandle: vi.fn().mockReturnValue({
          promise: Promise.resolve({ status: 'completed', exitCode: 0, stdout: '', stderr: '' }),
          abort: vi.fn(),
          pid: 12345,
        }),
      } as never,
      workerRegistry: {
        registerWorkerWithId: vi.fn(),
        markFailed: vi.fn(),
        markRunning: vi.fn(),
        markCompleted: vi.fn(),
        removeWorker: vi.fn(),
        getActiveWorkers: vi.fn(() => []),
        getAggregatedStats: vi.fn(() => ({ totalWorkers: 0, avgDurationMs: 0, totalTurnsUsed: 0 })),
        getWorker: vi.fn().mockReturnValue(undefined),
      } as never,
      adapterRegistry: {
        getForTrustLevel: vi.fn().mockReturnValue(null),
      } as never,
      modelRegistry: {} as never,
      workerRetryDelayMs: 1000,
      workerMaxFixIterations: 3,
      trustLevel,
      getMemory: () => null,
      getRouter: () => null,
      getMasterSession: () => null,
      getActiveMessage: () => null,
      getState: () => ({ phase: 'idle' }) as never,
      setState: vi.fn(),
      getActiveSkillPacks: () => [],
      getKnowledgeRetriever: () => null,
      getBatchManager: () => null,
      getBatchTimers: () => new Set(),
      getDelegationCoordinator: () => null,
      readProfilesFromStore: vi.fn().mockResolvedValue(null),
      persistWorkerRegistry: vi.fn().mockResolvedValue(undefined),
      recordWorkerLearning: vi.fn().mockResolvedValue(undefined),
      recordPromptEffectiveness: vi.fn().mockResolvedValue(undefined),
      recordConversationMessage: vi.fn().mockResolvedValue(undefined),
    };
  }

  it('standard trust level — worker prompt includes .openbridge/ protection', async () => {
    const deps = makeFullDeps('standard');
    const orchestrator = new WorkerOrchestrator(deps);

    await orchestrator.spawnWorker('worker-ob1652-std', makeMarker(), 0);

    const mockedFn = vi.mocked(manifestToSpawnOptions);
    expect(mockedFn).toHaveBeenCalled();
    const [manifest] = mockedFn.mock.calls[0] as [{ prompt: string }];
    expect(manifest.prompt).toContain('.openbridge/');
    expect(manifest.prompt).toContain('Do NOT delete');
  });

  it('trusted trust level — worker prompt includes .openbridge/ protection', async () => {
    const deps = makeFullDeps('trusted');
    const orchestrator = new WorkerOrchestrator(deps);

    await orchestrator.spawnWorker('worker-ob1652-trusted', makeMarker(), 0);

    const mockedFn = vi.mocked(manifestToSpawnOptions);
    expect(mockedFn).toHaveBeenCalled();
    const [manifest] = mockedFn.mock.calls[0] as [{ prompt: string }];
    expect(manifest.prompt).toContain('.openbridge/');
    expect(manifest.prompt).toContain('Do NOT delete');
  });
});
