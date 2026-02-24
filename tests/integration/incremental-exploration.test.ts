/**
 * Integration test: Incremental Exploration E2E (OB-410)
 *
 * Tests the full incremental-exploration flow end-to-end:
 *   1. Fresh workspace → full exploration + analysis-marker.json written
 *   2. New file added + committed → incremental update runs, marker updated
 *   3. No workspace changes on restart → exploration skipped entirely
 *   4. 200+ files changed → too large for incremental, triggers full re-exploration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { WorkspaceAnalysisMarker } from '../../src/types/master.js';
import type { WorkspaceMap } from '../../src/types/master.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockSpawn = vi.fn();
const mockStream = vi.fn();

vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: mockSpawn,
    stream: mockStream,
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

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Test helpers ───────────────────────────────────────────────────────────

/** A minimal valid WorkspaceMap for seeding .openbridge/workspace-map.json */
function makeMinimalMap(workspacePath: string): WorkspaceMap {
  return {
    workspacePath,
    projectName: 'test-project',
    projectType: 'typescript',
    frameworks: ['node'],
    structure: {},
    keyFiles: [],
    entryPoints: [],
    commands: {},
    dependencies: [],
    summary: 'A test project',
    generatedAt: new Date().toISOString(),
    schemaVersion: '1.0.0',
  };
}

/** Initialise a git workspace: git init, configure user, create README, commit */
async function setupGitWorkspace(dir: string): Promise<string> {
  await execAsync('git init -b main', { cwd: dir });
  await execAsync('git config user.email "test@openbridge.test"', { cwd: dir });
  await execAsync('git config user.name "OpenBridge Test"', { cwd: dir });
  await fs.writeFile(path.join(dir, 'README.md'), '# Test Project');
  await execAsync('git add -A && git commit -m "initial commit"', { cwd: dir });
  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: dir });
  return stdout.trim();
}

/**
 * Pre-populate .openbridge/ with a valid workspace map and analysis marker
 * so MasterManager sees an already-explored workspace on startup.
 */
async function seedOpenBridge(workspacePath: string, commitHash: string): Promise<void> {
  const dotFolder = new DotFolderManager(workspacePath);
  await dotFolder.initialize();

  await dotFolder.writeMap(makeMinimalMap(workspacePath));

  const marker: WorkspaceAnalysisMarker = {
    workspaceCommitHash: commitHash,
    workspaceBranch: 'main',
    workspaceHasGit: true,
    analyzedAt: new Date().toISOString(),
    analysisType: 'full',
    filesChanged: 0,
    schemaVersion: '1.0.0',
  };
  await dotFolder.writeAnalysisMarker(marker);

  await dotFolder.commitChanges('feat(master): seed initial exploration for test');
}

/** Shared master tool fixture */
const masterTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  role: 'master' as const,
  capabilities: ['code-analysis', 'task-execution'],
  available: true,
};

// ── Test suite ─────────────────────────────────────────────────────────────

describe('Incremental Exploration E2E', () => {
  let testWorkspace: string;
  let manager: MasterManager | undefined;

  beforeEach(async () => {
    // Use os.tmpdir() to avoid collisions with the project's own git repo
    testWorkspace = path.join(
      os.tmpdir(),
      'ob-incr-e2e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    );
    await fs.mkdir(testWorkspace, { recursive: true });
    manager = undefined;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (manager) {
      await manager.shutdown();
      manager = undefined;
    }
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors — temp dir may already be removed
    }
  });

  // ── Scenario 1 ──────────────────────────────────────────────────────────

  describe('Scenario 1: fresh workspace → full exploration + marker written', () => {
    it('runs full exploration and writes analysis-marker.json with analysisType "full"', async () => {
      // No .openbridge/ exists yet — fresh workspace
      // ExplorationCoordinator uses agentRunner.spawn() for each phase
      mockSpawn.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({
          workspacePath: testWorkspace,
          topLevelFiles: ['README.md'],
          topLevelDirs: [],
          directoryCounts: {},
          configFiles: [],
          skippedDirs: [],
          totalFiles: 1,
          scannedAt: new Date().toISOString(),
          durationMs: 100,
          // Classification fields (Phase 2 reuses same mock)
          projectType: 'unknown',
          projectName: 'test',
          frameworks: [],
          commands: {},
          dependencies: [],
          insights: [],
          classifiedAt: new Date().toISOString(),
          // Summary fields (Phase 4)
          summary: 'Test workspace',
        }),
        stderr: '',
        durationMs: 100,
        retryCount: 0,
      });

      manager = new MasterManager({
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools: [masterTool],
      });

      await manager.start();

      expect(manager.getState()).toBe('ready');

      // Multi-agent exploration uses agentRunner.spawn() via ExplorationCoordinator
      expect(mockSpawn).toHaveBeenCalled();
      // stream() is NOT used for exploration anymore
      expect(mockStream).not.toHaveBeenCalled();

      // analysis-marker.json must exist and reflect a full analysis
      const dotFolder = new DotFolderManager(testWorkspace);
      const marker = await dotFolder.readAnalysisMarker();
      expect(marker).not.toBeNull();
      expect(marker?.analysisType).toBe('full');
      expect(marker?.filesChanged).toBe(0);
    });
  });

  // ── Scenario 2 ──────────────────────────────────────────────────────────

  describe('Scenario 2: new file added → incremental update runs', () => {
    it('detects committed changes and runs incremental exploration', async () => {
      // Workspace with git + initial commit
      const initialHash = await setupGitWorkspace(testWorkspace);

      // Seed .openbridge/ with map + marker at initial commit
      await seedOpenBridge(testWorkspace, initialHash);

      // Add a new file and commit it (simulates developer adding a feature)
      await fs.writeFile(path.join(testWorkspace, 'feature.ts'), 'export const value = 42;');
      await execAsync('git add -A && git commit -m "add feature.ts"', { cwd: testWorkspace });

      // Mock the incremental spawn (agentRunner.spawn is used for incremental)
      mockSpawn.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', durationMs: 100 });

      manager = new MasterManager({
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools: [masterTool],
      });

      await manager.start();

      expect(manager.getState()).toBe('ready');

      // Incremental uses spawn, NOT stream
      expect(mockSpawn).toHaveBeenCalled();
      expect(mockStream).not.toHaveBeenCalled();

      // Marker must be updated to incremental
      const dotFolder = new DotFolderManager(testWorkspace);
      const marker = await dotFolder.readAnalysisMarker();
      expect(marker).not.toBeNull();
      expect(marker?.analysisType).toBe('incremental');
      expect(marker?.filesChanged).toBeGreaterThan(0);
    });
  });

  // ── Scenario 3 ──────────────────────────────────────────────────────────

  describe('Scenario 3: no workspace changes → exploration skipped', () => {
    it('skips all exploration when workspace matches the existing marker', async () => {
      // Workspace with git + initial commit
      const initialHash = await setupGitWorkspace(testWorkspace);

      // Seed .openbridge/ with map + marker pointing at the same HEAD
      await seedOpenBridge(testWorkspace, initialHash);

      manager = new MasterManager({
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools: [masterTool],
      });

      await manager.start();

      expect(manager.getState()).toBe('ready');

      // No AgentRunner calls should be made — exploration is completely skipped
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockStream).not.toHaveBeenCalled();
    });
  });

  // ── Scenario 4 ──────────────────────────────────────────────────────────

  describe('Scenario 4: 200+ file changes → full re-exploration triggered', () => {
    it('triggers full re-exploration when changed file count exceeds threshold', async () => {
      // Workspace with git + initial commit
      const initialHash = await setupGitWorkspace(testWorkspace);

      // Seed .openbridge/ with map + marker at initial commit
      await seedOpenBridge(testWorkspace, initialHash);

      // Add 205 files (above the MAX_INCREMENTAL_FILES = 200 threshold) and commit
      await Promise.all(
        Array.from({ length: 205 }, (_, i) =>
          fs.writeFile(path.join(testWorkspace, `bulk-file-${i}.txt`), `content ${i}`),
        ),
      );
      await execAsync('git add -A && git commit -m "bulk add 205 files"', { cwd: testWorkspace });

      // ExplorationCoordinator uses agentRunner.spawn() for each phase
      mockSpawn.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({
          workspacePath: testWorkspace,
          topLevelFiles: ['README.md'],
          topLevelDirs: [],
          directoryCounts: {},
          configFiles: [],
          skippedDirs: [],
          totalFiles: 206,
          scannedAt: new Date().toISOString(),
          durationMs: 100,
          projectType: 'unknown',
          projectName: 'test',
          frameworks: [],
          commands: {},
          dependencies: [],
          insights: [],
          classifiedAt: new Date().toISOString(),
          summary: 'Test workspace with bulk files',
        }),
        stderr: '',
        durationMs: 100,
        retryCount: 0,
      });

      manager = new MasterManager({
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools: [masterTool],
      });

      await manager.start();

      expect(manager.getState()).toBe('ready');

      // Full re-exploration uses agentRunner.spawn() via ExplorationCoordinator
      expect(mockSpawn).toHaveBeenCalled();
      // stream() is NOT used for exploration anymore
      expect(mockStream).not.toHaveBeenCalled();

      // Marker must be updated to reflect a new full analysis
      const dotFolder = new DotFolderManager(testWorkspace);
      const marker = await dotFolder.readAnalysisMarker();
      expect(marker).not.toBeNull();
      expect(marker?.analysisType).toBe('full');
    });
  });
});
