/**
 * Integration test: exploration_progress populated after explore() (OB-895)
 *
 * Verifies that when ExplorationCoordinator.explore() is called with an
 * explorationId (and a MemoryManager), the exploration_progress table is
 * populated with rows for:
 *
 *  - Each non-directory phase (structure, classification, assembly)
 *  - Each significant directory identified in the structure scan
 *
 * Uses a real SQLite MemoryManager (temp file), a mock AgentRunner, and a
 * temporary workspace directory. The explorationId is pre-created as an
 * agent_activity row so the FK constraint is satisfied.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { MemoryManager } from '../../src/memory/index.js';
import { ExplorationCoordinator } from '../../src/master/exploration-coordinator.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { ExplorationProgressRecord } from '../../src/memory/activity-store.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

const mockSpawnFn = vi.fn();

vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: mockSpawnFn,
    stream: vi.fn(),
  })),
  TOOLS_READ_ONLY: ['Read', 'Glob', 'Grep'],
  TOOLS_CODE_EDIT: [
    'Read',
    'Edit',
    'Write',
    'Glob',
    'Grep',
    'Bash(git:*)',
    'Bash(npm:*)',
    'Bash(npx:*)',
  ],
  TOOLS_FULL: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  DEFAULT_MAX_TURNS_EXPLORATION: 15,
  DEFAULT_MAX_TURNS_TASK: 25,
  sanitizePrompt: vi.fn((s: string) => s),
  buildArgs: vi.fn(),
  isValidModel: vi.fn(() => true),
  MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
  AgentExhaustedError: class AgentExhaustedError extends Error {},
  resolveProfile: (profileName: string): string[] | undefined => {
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
    return profiles[profileName];
  },
  manifestToSpawnOptions: (manifest: Record<string, unknown>) => ({
    prompt: manifest.prompt,
    workspacePath: manifest.workspacePath,
    model: manifest.model,
    allowedTools: manifest.allowedTools,
    maxTurns: manifest.maxTurns,
    timeout: manifest.timeout,
  }),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const masterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  role: 'master',
  capabilities: ['code-analysis', 'task-execution'],
  available: true,
};

const NOW = new Date().toISOString();

/**
 * Phase 1: StructureScan with two significant directories.
 * src/ has 5 files, tests/ has 3 files → both trigger directory dives.
 */
const cannedStructureScan = {
  workspacePath: '',
  topLevelFiles: ['README.md', 'package.json'],
  topLevelDirs: ['src', 'tests'],
  directoryCounts: { src: 5, tests: 3 },
  configFiles: ['package.json'],
  skippedDirs: ['node_modules'],
  totalFiles: 10,
  scannedAt: NOW,
  durationMs: 50,
};

/** Phase 2: Classification */
const cannedClassification = {
  projectType: 'typescript',
  projectName: 'test-project',
  frameworks: ['node'],
  commands: { build: 'tsc', test: 'vitest' },
  dependencies: [{ name: 'typescript', version: '^5.0.0', type: 'dev' }],
  insights: ['TypeScript project detected'],
  classifiedAt: NOW,
  durationMs: 50,
};

/** Phase 3 — directory dive for src/ */
const cannedSrcDive = {
  path: 'src',
  purpose: 'Main source code',
  fileCount: 5,
  keyFiles: [{ path: 'src/index.ts', type: 'entry', purpose: 'Entry point' }],
  patterns: [],
  exploredAt: NOW,
  durationMs: 60,
};

/** Phase 3 — directory dive for tests/ */
const cannedTestsDive = {
  path: 'tests',
  purpose: 'Test suite',
  fileCount: 3,
  keyFiles: [{ path: 'tests/index.test.ts', type: 'test', purpose: 'Unit tests' }],
  patterns: [],
  exploredAt: NOW,
  durationMs: 40,
};

/** Phase 4: Assembly */
const cannedAssemblySummary = {
  summary: 'A minimal TypeScript test project.',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpawnResponse(data: unknown) {
  return {
    exitCode: 0,
    stdout: JSON.stringify(data),
    stderr: '',
    durationMs: 50,
    retryCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('exploration_progress populated after explore() (OB-895)', () => {
  let workspacePath: string;
  let memory: MemoryManager;
  let explorationId: string;

  beforeEach(async () => {
    workspacePath = path.join(
      os.tmpdir(),
      `ob-explore-progress-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'tests'), { recursive: true });

    fs.writeFileSync(
      path.join(workspacePath, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0' }),
    );
    fs.writeFileSync(path.join(workspacePath, 'README.md'), '# Test Project\n');
    fs.writeFileSync(path.join(workspacePath, 'src', 'index.ts'), 'export const x = 1;\n');
    fs.writeFileSync(path.join(workspacePath, 'tests', 'index.test.ts'), '// tests\n');

    // Real SQLite MemoryManager (file on disk — avoids :memory: FK issues)
    const dbPath = path.join(workspacePath, '.openbridge', 'openbridge.db');
    fs.mkdirSync(path.join(workspacePath, '.openbridge'), { recursive: true });
    memory = new MemoryManager(dbPath);
    await memory.init();

    // Pre-create the explorer agent_activity row so FK is satisfied
    explorationId = randomUUID();
    await memory.insertActivity({
      id: explorationId,
      type: 'explorer',
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    vi.clearAllMocks();

    // Configure mock responses in call order:
    //   Call 1 → Phase 1 (Structure Scan)
    //   Call 2 → Phase 2 (Classification)
    //   Call 3 → Phase 3 directory dive for src/
    //   Call 4 → Phase 3 directory dive for tests/
    //   Call 5 → Phase 4 (Assembly / Summary)
    mockSpawnFn
      .mockResolvedValueOnce(makeSpawnResponse({ ...cannedStructureScan, workspacePath }))
      .mockResolvedValueOnce(makeSpawnResponse(cannedClassification))
      .mockResolvedValueOnce(makeSpawnResponse(cannedSrcDive))
      .mockResolvedValueOnce(makeSpawnResponse(cannedTestsDive))
      .mockResolvedValueOnce(makeSpawnResponse(cannedAssemblySummary));
  });

  afterEach(async () => {
    await memory.close();
    try {
      await fsp.rm(workspacePath, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  it('exploration completes successfully', async () => {
    const coordinator = new ExplorationCoordinator({
      workspacePath,
      masterTool,
      discoveredTools: [masterTool],
      memory,
      explorationId,
    });

    const summary = await coordinator.explore();

    expect(summary.status).toBe('completed');
  });

  it('spawns AgentRunner for all 5 calls (structure, classification, 2 dives, assembly)', async () => {
    const coordinator = new ExplorationCoordinator({
      workspacePath,
      masterTool,
      discoveredTools: [masterTool],
      memory,
      explorationId,
    });

    await coordinator.explore();

    expect(mockSpawnFn).toHaveBeenCalledTimes(5);
  });

  it('creates exploration_progress rows for phase-level phases (structure, classification, assembly)', async () => {
    const coordinator = new ExplorationCoordinator({
      workspacePath,
      masterTool,
      discoveredTools: [masterTool],
      memory,
      explorationId,
    });

    await coordinator.explore();

    const rows = await memory.getExplorationProgressByExplorationId(explorationId);
    const phases = rows.map((r: ExplorationProgressRecord) => r.phase);

    expect(phases).toContain('structure');
    expect(phases).toContain('classification');
    expect(phases).toContain('assembly');
  });

  it('creates exploration_progress rows for directory-dive phases (src, tests)', async () => {
    const coordinator = new ExplorationCoordinator({
      workspacePath,
      masterTool,
      discoveredTools: [masterTool],
      memory,
      explorationId,
    });

    await coordinator.explore();

    const rows = await memory.getExplorationProgressByExplorationId(explorationId);
    const divRows = rows.filter((r: ExplorationProgressRecord) => r.phase === 'directory-dive');

    expect(divRows.length).toBeGreaterThanOrEqual(2);

    const targets = divRows.map((r: ExplorationProgressRecord) => r.target);
    expect(targets).toContain('src');
    expect(targets).toContain('tests');
  });

  it('phase-level rows have status=completed and progress_pct=100 after explore()', async () => {
    const coordinator = new ExplorationCoordinator({
      workspacePath,
      masterTool,
      discoveredTools: [masterTool],
      memory,
      explorationId,
    });

    await coordinator.explore();

    const rows = await memory.getExplorationProgressByExplorationId(explorationId);
    const phaseRows = rows.filter((r: ExplorationProgressRecord) => r.phase !== 'directory-dive');

    for (const row of phaseRows) {
      expect(row.status).toBe('completed');
      expect(row.progress_pct).toBe(100);
    }
  });

  it('directory-dive rows have status=completed and progress_pct=100 after explore()', async () => {
    const coordinator = new ExplorationCoordinator({
      workspacePath,
      masterTool,
      discoveredTools: [masterTool],
      memory,
      explorationId,
    });

    await coordinator.explore();

    const rows = await memory.getExplorationProgressByExplorationId(explorationId);
    const divRows = rows.filter((r: ExplorationProgressRecord) => r.phase === 'directory-dive');

    for (const row of divRows) {
      expect(row.status).toBe('completed');
      expect(row.progress_pct).toBe(100);
    }
  });

  it('directory-dive rows record files_processed matching fileCount from the dive result', async () => {
    const coordinator = new ExplorationCoordinator({
      workspacePath,
      masterTool,
      discoveredTools: [masterTool],
      memory,
      explorationId,
    });

    await coordinator.explore();

    const rows = await memory.getExplorationProgressByExplorationId(explorationId);
    const srcRow = rows.find(
      (r: ExplorationProgressRecord) => r.phase === 'directory-dive' && r.target === 'src',
    );
    const testsRow = rows.find(
      (r: ExplorationProgressRecord) => r.phase === 'directory-dive' && r.target === 'tests',
    );

    expect(srcRow?.files_processed).toBe(5); // matches cannedSrcDive.fileCount
    expect(testsRow?.files_processed).toBe(3); // matches cannedTestsDive.fileCount
  });

  it('all exploration_progress rows belong to the supplied explorationId', async () => {
    const coordinator = new ExplorationCoordinator({
      workspacePath,
      masterTool,
      discoveredTools: [masterTool],
      memory,
      explorationId,
    });

    await coordinator.explore();

    const rows = await memory.getExplorationProgressByExplorationId(explorationId);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.exploration_id).toBe(explorationId);
    }
  });

  describe('auto-registers explorationId when none is supplied', () => {
    it('returns a completed summary when no explorationId is provided', async () => {
      // No explorationId passed — coordinator should auto-register one internally
      const coordinator = new ExplorationCoordinator({
        workspacePath,
        masterTool,
        discoveredTools: [masterTool],
        memory,
        // explorationId intentionally omitted
      });

      mockSpawnFn
        .mockResolvedValueOnce(makeSpawnResponse({ ...cannedStructureScan, workspacePath }))
        .mockResolvedValueOnce(makeSpawnResponse(cannedClassification))
        .mockResolvedValueOnce(makeSpawnResponse(cannedSrcDive))
        .mockResolvedValueOnce(makeSpawnResponse(cannedTestsDive))
        .mockResolvedValueOnce(makeSpawnResponse(cannedAssemblySummary));

      const summary = await coordinator.explore();
      expect(summary.status).toBe('completed');
    });

    it('auto-creates a new agent_activity row of type=explorer', async () => {
      // Count existing explorer agents before the coordinator run
      const beforeAgents = await memory.getActiveAgents();
      const beforeCount = beforeAgents.filter((a) => a.type === 'explorer').length;

      // No explorationId passed — coordinator should auto-register one
      const coordinator = new ExplorationCoordinator({
        workspacePath,
        masterTool,
        discoveredTools: [masterTool],
        memory,
      });

      mockSpawnFn
        .mockResolvedValueOnce(makeSpawnResponse({ ...cannedStructureScan, workspacePath }))
        .mockResolvedValueOnce(makeSpawnResponse(cannedClassification))
        .mockResolvedValueOnce(makeSpawnResponse(cannedSrcDive))
        .mockResolvedValueOnce(makeSpawnResponse(cannedTestsDive))
        .mockResolvedValueOnce(makeSpawnResponse(cannedAssemblySummary));

      await coordinator.explore();

      // A new explorer activity row should have been added
      const afterAgents = await memory.getActiveAgents();
      const afterCount = afterAgents.filter((a) => a.type === 'explorer').length;
      expect(afterCount).toBeGreaterThan(beforeCount);
    });
  });
});
