/**
 * Integration test: Exploration Pipeline End-to-End (OB-853)
 *
 * Validates the full exploration pipeline using ExplorationCoordinator with a
 * mock AgentRunner (returns canned JSON), real MemoryManager (SQLite in-memory),
 * and a temporary workspace directory:
 *
 *  (a) Creates a mock workspace with known files
 *  (b) Initializes MemoryManager and ExplorationCoordinator
 *  (c) Runs exploration with a mock agent runner (returns canned JSON)
 *  (d) Asserts workspace map is stored in memory
 *        (getChunksByScope('_workspace_map', 'structure'))
 *  (e) Asserts workspace-map.json JSON file exists on disk as fallback
 *  (f) Asserts exploration_state in system_config shows status: 'completed'
 *  (g) Modifies a file, runs WorkspaceChangeTracker.detectChanges(), and
 *        asserts it detects the change
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { MemoryManager } from '../../src/memory/index.js';
import { ExplorationCoordinator } from '../../src/master/exploration-coordinator.js';
import { WorkspaceChangeTracker } from '../../src/master/workspace-change-tracker.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { WorkspaceAnalysisMarker } from '../../src/types/master.js';

const execAsync = promisify(exec);

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
  DEFAULT_MAX_FIX_ITERATIONS: 3,
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
  manifestToSpawnOptions: (manifest: Record<string, unknown>) =>
    Promise.resolve({
      spawnOptions: {
        prompt: manifest.prompt,
        workspacePath: manifest.workspacePath,
        model: manifest.model,
        allowedTools: manifest.allowedTools,
        maxTurns: manifest.maxTurns,
        timeout: manifest.timeout,
      },
      cleanup: async () => {},
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

/** ISO timestamp for use in canned responses */
const NOW = new Date().toISOString();

/** Phase 1: StructureScan — no topLevelDirs so Phase 3 has zero dives */
const cannedStructureScan = {
  workspacePath: '', // filled in per-test
  topLevelFiles: ['README.md', 'package.json', 'src/index.ts'],
  topLevelDirs: [],
  directoryCounts: {},
  configFiles: ['package.json'],
  skippedDirs: ['node_modules'],
  totalFiles: 3,
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

/** Phase 4: Assembly — only the summary field is consumed from this response */
const cannedAssemblySummary = {
  summary: 'A minimal TypeScript test project with known structure for integration testing.',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Initialise a git workspace with a README and an initial commit. */
async function initGitWorkspace(dir: string): Promise<string> {
  await execAsync('git init -b main', { cwd: dir });
  await execAsync('git config user.email "test@openbridge.test"', { cwd: dir });
  await execAsync('git config user.name "OpenBridge Test"', { cwd: dir });
  await fsp.writeFile(path.join(dir, 'README.md'), '# Test Project\n');
  await execAsync('git add -A && git commit -m "initial commit"', { cwd: dir });
  const { stdout } = await execAsync('git rev-parse HEAD', { cwd: dir });
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Exploration Pipeline End-to-End (OB-853)', () => {
  let workspacePath: string;
  let memory: MemoryManager;

  beforeEach(async () => {
    workspacePath = path.join(
      os.tmpdir(),
      `ob-explore-pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    );
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.mkdirSync(path.join(workspacePath, 'src'), { recursive: true });

    // (a) Workspace with known files
    fs.writeFileSync(
      path.join(workspacePath, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0' }),
    );
    fs.writeFileSync(path.join(workspacePath, 'README.md'), '# Test Project\n');
    fs.writeFileSync(
      path.join(workspacePath, 'src', 'index.ts'),
      'export const hello = "world";\n',
    );

    // (b) Initialize MemoryManager with a fresh SQLite DB
    const dbPath = path.join(workspacePath, '.openbridge', 'openbridge.db');
    fs.mkdirSync(path.join(workspacePath, '.openbridge'), { recursive: true });
    memory = new MemoryManager(dbPath);
    await memory.init();

    vi.clearAllMocks();
  });

  afterEach(async () => {
    await memory.close();
    try {
      await fsp.rm(workspacePath, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (a) Workspace setup
  // ─────────────────────────────────────────────────────────────────────────

  it('(a) workspace has known files on disk', () => {
    expect(fs.existsSync(path.join(workspacePath, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, 'README.md'))).toBe(true);
    expect(fs.existsSync(path.join(workspacePath, 'src', 'index.ts'))).toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (b)–(f) Full exploration pipeline
  // ─────────────────────────────────────────────────────────────────────────

  describe('(b–f) exploration pipeline persists results correctly', () => {
    beforeEach(() => {
      // Configure mock to return canned responses for each spawn call in order:
      //   Call 1 → Phase 1 (Structure Scan)
      //   Call 2 → Phase 2 (Classification)
      //   Call 3 → Phase 4 (Assembly / Summary) — no Phase 3 dives (no dirs)
      mockSpawnFn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify({ ...cannedStructureScan, workspacePath }),
          stderr: '',
          durationMs: 50,
          retryCount: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(cannedClassification),
          stderr: '',
          durationMs: 50,
          retryCount: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(cannedAssemblySummary),
          stderr: '',
          durationMs: 50,
          retryCount: 0,
        });
    });

    it('(c) agentRunner.spawn() is called for each exploration phase', async () => {
      const coordinator = new ExplorationCoordinator({
        workspacePath,
        masterTool,
        discoveredTools: [masterTool],
        memory,
      });

      await coordinator.explore();

      // Phase 1 + Phase 2 + Phase 4 = 3 spawn calls (Phase 3 has 0 dirs, Phase 5 = no AI)
      expect(mockSpawnFn).toHaveBeenCalledTimes(3);
    });

    it('(d) workspace map is stored in memory after exploration', async () => {
      const coordinator = new ExplorationCoordinator({
        workspacePath,
        masterTool,
        discoveredTools: [masterTool],
        memory,
      });

      await coordinator.explore();

      const chunks = await memory.getChunksByScope('_workspace_map', 'structure');
      expect(chunks).toHaveLength(1);

      const storedMap = JSON.parse(chunks[0].content) as {
        projectType: string;
        projectName: string;
        summary: string;
      };
      expect(storedMap.projectType).toBe('typescript');
      expect(storedMap.projectName).toBe('test-project');
      expect(storedMap.summary).toContain('minimal TypeScript');
    });

    it('(e) workspace-map.json JSON fallback exists on disk', async () => {
      const coordinator = new ExplorationCoordinator({
        workspacePath,
        masterTool,
        discoveredTools: [masterTool],
        memory,
      });

      await coordinator.explore();

      const mapPath = path.join(workspacePath, '.openbridge', 'workspace-map.json');
      expect(fs.existsSync(mapPath)).toBe(true);

      const mapContent = JSON.parse(fs.readFileSync(mapPath, 'utf-8')) as {
        projectType: string;
        summary: string;
      };
      expect(mapContent.projectType).toBe('typescript');
      expect(mapContent.summary).toBeTruthy();
    });

    it('(f) exploration_state in system_config shows status: completed', async () => {
      const coordinator = new ExplorationCoordinator({
        workspacePath,
        masterTool,
        discoveredTools: [masterTool],
        memory,
      });

      await coordinator.explore();

      const raw = await memory.getExplorationState();
      expect(raw).not.toBeNull();

      const state = JSON.parse(raw!) as { status: string };
      expect(state.status).toBe('completed');
    });

    it('returns ExplorationSummary with status completed', async () => {
      const coordinator = new ExplorationCoordinator({
        workspacePath,
        masterTool,
        discoveredTools: [masterTool],
        memory,
      });

      const summary = await coordinator.explore();

      expect(summary.status).toBe('completed');
      expect(summary.projectType).toBe('typescript');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (g) Workspace change detection
  // ─────────────────────────────────────────────────────────────────────────

  describe('(g) workspace change detection detects modified files', () => {
    it('detectChanges returns hasChanges:true after a new file is committed', async () => {
      // Set up a git workspace so the tracker can use git-diff
      const commitHash = await initGitWorkspace(workspacePath);

      const marker: WorkspaceAnalysisMarker = {
        workspaceCommitHash: commitHash,
        workspaceBranch: 'main',
        workspaceHasGit: true,
        analyzedAt: new Date().toISOString(),
        analysisType: 'full',
        filesChanged: 0,
        schemaVersion: '1.0.0',
      };

      // Modify a file and commit it
      await fsp.writeFile(
        path.join(workspacePath, 'feature.ts'),
        'export const newFeature = true;\n',
      );
      await execAsync('git add -A && git commit -m "add feature.ts"', { cwd: workspacePath });

      const tracker = new WorkspaceChangeTracker(workspacePath);
      const changes = await tracker.detectChanges(marker);

      expect(changes.hasChanges).toBe(true);
      expect(changes.method).toBe('git-diff');
      expect(changes.changedFiles.length).toBeGreaterThan(0);
      expect(changes.tooLargeForIncremental).toBe(false);
    });

    it('detectChanges returns hasChanges:false when workspace matches the marker', async () => {
      const commitHash = await initGitWorkspace(workspacePath);

      const marker: WorkspaceAnalysisMarker = {
        workspaceCommitHash: commitHash,
        workspaceBranch: 'main',
        workspaceHasGit: true,
        analyzedAt: new Date().toISOString(),
        analysisType: 'full',
        filesChanged: 0,
        schemaVersion: '1.0.0',
      };

      // No changes since the marker was written
      const tracker = new WorkspaceChangeTracker(workspacePath);
      const changes = await tracker.detectChanges(marker);

      expect(changes.hasChanges).toBe(false);
      expect(changes.method).toBe('git-diff');
    });
  });
});
