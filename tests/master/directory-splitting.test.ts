/**
 * Tests for OB-F26: Directory Splitting Feature
 *
 * Covers three features:
 * 1. ExplorationCoordinator.expandLargeDirectories() — splits large dirs into subdirs
 * 2. ExplorationCoordinator.calculateDiveTimeout() — per-directory timeout scaling
 * 3. WorkspaceChangeTracker.extractChangedScopes() — splitDirs-aware scope extraction
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Mock AgentRunner BEFORE any imports that depend on it ──────────

const mockSpawn = vi.fn();
vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: mockSpawn,
    stream: vi.fn(),
  })),
  TOOLS_READ_ONLY: ['Read', 'Glob', 'Grep'],
  TOOLS_CODE_EDIT: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)'],
  TOOLS_FULL: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  DEFAULT_MAX_TURNS_EXPLORATION: 15,
  DEFAULT_MAX_TURNS_TASK: 25,
  DEFAULT_MAX_FIX_ITERATIONS: 3,
  sanitizePrompt: vi.fn((s: string) => s),
  buildArgs: vi.fn(),
  isValidModel: vi.fn(() => true),
  MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
  AgentExhaustedError: class AgentExhaustedError extends Error {},
}));

import { ExplorationCoordinator } from '../../src/master/exploration-coordinator.js';
import { WorkspaceChangeTracker } from '../../src/master/workspace-change-tracker.js';
import type { StructureScan } from '../../src/types/master.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';

// ── Shared fixtures ────────────────────────────────────────────────

const mockMasterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  type: 'cli',
  capabilities: ['code', 'exploration', 'delegation'],
};

function makeStructureScan(overrides: Partial<StructureScan> = {}): StructureScan {
  return {
    workspacePath: '/tmp/test',
    topLevelFiles: [],
    topLevelDirs: [],
    directoryCounts: {},
    configFiles: [],
    skippedDirs: [],
    totalFiles: 0,
    scannedAt: new Date().toISOString(),
    durationMs: 100,
    splitDirs: {},
    ...overrides,
  };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. expandLargeDirectories()
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('ExplorationCoordinator.expandLargeDirectories', () => {
  let testWorkspace: string;
  let coordinator: ExplorationCoordinator;

  beforeEach(async () => {
    testWorkspace = path.join(
      os.tmpdir(),
      'test-dir-split-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    );
    await fs.mkdir(testWorkspace, { recursive: true });

    vi.clearAllMocks();
    mockSpawn.mockReset();

    coordinator = new ExplorationCoordinator({
      workspacePath: testWorkspace,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should keep a directory with fewer than 25 files as-is', async () => {
    // Create a real directory with a small file count
    await fs.mkdir(path.join(testWorkspace, 'lib'), { recursive: true });
    await fs.writeFile(path.join(testWorkspace, 'lib', 'index.ts'), '');

    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['lib'],
      directoryCounts: { lib: 10 },
    });

    const result = await coordinator.expandLargeDirectories(scan);

    expect(result).toEqual(['lib']);
    expect(scan.splitDirs).toEqual({});
  });

  it('should keep a directory with exactly 25 files as-is (threshold is >25)', async () => {
    await fs.mkdir(path.join(testWorkspace, 'utils'), { recursive: true });

    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['utils'],
      directoryCounts: { utils: 25 },
    });

    const result = await coordinator.expandLargeDirectories(scan);

    expect(result).toEqual(['utils']);
    expect(scan.splitDirs).toEqual({});
  });

  it('should split a directory with more than 25 files into subdirectories', async () => {
    // Create real filesystem structure: src/ with core/ and master/ subdirs
    const srcDir = path.join(testWorkspace, 'src');
    await fs.mkdir(path.join(srcDir, 'core'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'master'), { recursive: true });
    // Add some files in subdirs for the estimation logic
    await fs.writeFile(path.join(srcDir, 'core', 'bridge.ts'), '');
    await fs.writeFile(path.join(srcDir, 'core', 'router.ts'), '');
    await fs.writeFile(path.join(srcDir, 'master', 'manager.ts'), '');

    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['src'],
      directoryCounts: { src: 30 },
    });

    const result = await coordinator.expandLargeDirectories(scan);

    // src should be replaced by its subdirs
    expect(result).toContain('src/core');
    expect(result).toContain('src/master');
    expect(result).not.toContain('src');

    // splitDirs should record the mapping
    expect(scan.splitDirs['src']).toBeDefined();
    expect(scan.splitDirs['src']).toContain('src/core');
    expect(scan.splitDirs['src']).toContain('src/master');

    // directoryCounts should have estimated counts for subdirs
    expect(scan.directoryCounts['src/core']).toBeGreaterThan(0);
    expect(scan.directoryCounts['src/master']).toBeGreaterThan(0);
  });

  it('should skip hidden directories (starting with .)', async () => {
    const srcDir = path.join(testWorkspace, 'src');
    await fs.mkdir(path.join(srcDir, 'core'), { recursive: true });
    await fs.mkdir(path.join(srcDir, '.hidden'), { recursive: true });

    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['src'],
      directoryCounts: { src: 30 },
    });

    const result = await coordinator.expandLargeDirectories(scan);

    expect(result).toContain('src/core');
    expect(result).not.toContain('src/.hidden');
  });

  it('should skip SKIPPED_SUBDIRS (node_modules, .git, dist, etc.)', async () => {
    const srcDir = path.join(testWorkspace, 'src');
    await fs.mkdir(path.join(srcDir, 'core'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'dist'), { recursive: true });
    await fs.mkdir(path.join(srcDir, '.git'), { recursive: true });
    await fs.mkdir(path.join(srcDir, '.next'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'build'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'coverage'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'target'), { recursive: true });
    await fs.mkdir(path.join(srcDir, '.cache'), { recursive: true });
    await fs.mkdir(path.join(srcDir, '.openbridge'), { recursive: true });
    await fs.mkdir(path.join(srcDir, '__pycache__'), { recursive: true });
    await fs.mkdir(path.join(srcDir, '.venv'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'venv'), { recursive: true });

    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['src'],
      directoryCounts: { src: 50 },
    });

    const result = await coordinator.expandLargeDirectories(scan);

    expect(result).toContain('src/core');
    // None of the skipped dirs should appear
    expect(result).not.toContain('src/node_modules');
    expect(result).not.toContain('src/dist');
    expect(result).not.toContain('src/.git');
    expect(result).not.toContain('src/.next');
    expect(result).not.toContain('src/build');
    expect(result).not.toContain('src/coverage');
    expect(result).not.toContain('src/target');
    expect(result).not.toContain('src/.cache');
    expect(result).not.toContain('src/.openbridge');
    expect(result).not.toContain('src/__pycache__');
    expect(result).not.toContain('src/.venv');
    expect(result).not.toContain('src/venv');
  });

  it('should keep a large directory as-is if it contains only skipped subdirs', async () => {
    const libDir = path.join(testWorkspace, 'lib');
    await fs.mkdir(path.join(libDir, 'node_modules'), { recursive: true });
    await fs.mkdir(path.join(libDir, 'dist'), { recursive: true });
    await fs.mkdir(path.join(libDir, '.git'), { recursive: true });
    // Add a regular file (not a directory) — should not count as a subdir
    await fs.writeFile(path.join(libDir, 'index.ts'), '');

    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['lib'],
      directoryCounts: { lib: 30 },
    });

    const result = await coordinator.expandLargeDirectories(scan);

    // No valid subdirs found — original dir stays
    expect(result).toEqual(['lib']);
    expect(scan.splitDirs['lib']).toBeUndefined();
  });

  it('should keep an empty directory as-is', async () => {
    await fs.mkdir(path.join(testWorkspace, 'empty'), { recursive: true });

    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['empty'],
      directoryCounts: { empty: 0 },
    });

    const result = await coordinator.expandLargeDirectories(scan);

    // 0 files <= 25 threshold, so it stays as-is
    expect(result).toEqual(['empty']);
    expect(scan.splitDirs).toEqual({});
  });

  it('should handle a mix of small and large directories correctly', async () => {
    // Small dir — stays as-is
    await fs.mkdir(path.join(testWorkspace, 'docs'), { recursive: true });
    await fs.writeFile(path.join(testWorkspace, 'docs', 'README.md'), '');

    // Large dir — should be split
    const srcDir = path.join(testWorkspace, 'src');
    await fs.mkdir(path.join(srcDir, 'core'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'providers'), { recursive: true });
    await fs.writeFile(path.join(srcDir, 'core', 'bridge.ts'), '');
    await fs.writeFile(path.join(srcDir, 'providers', 'claude.ts'), '');

    // Another small dir
    await fs.mkdir(path.join(testWorkspace, 'scripts'), { recursive: true });

    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['docs', 'src', 'scripts'],
      directoryCounts: { docs: 5, src: 40, scripts: 3 },
    });

    const result = await coordinator.expandLargeDirectories(scan);

    // docs and scripts stay as-is
    expect(result).toContain('docs');
    expect(result).toContain('scripts');

    // src is split into subdirs
    expect(result).not.toContain('src');
    expect(result).toContain('src/core');
    expect(result).toContain('src/providers');

    // splitDirs only records the large dir
    expect(scan.splitDirs['src']).toBeDefined();
    expect(scan.splitDirs['docs']).toBeUndefined();
    expect(scan.splitDirs['scripts']).toBeUndefined();
  });

  it('should keep a large directory as-is if the directory does not exist on disk', async () => {
    // ghost-dir does not exist on the filesystem
    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['ghost-dir'],
      directoryCounts: { 'ghost-dir': 50 },
    });

    const result = await coordinator.expandLargeDirectories(scan);

    // Falls back to keeping the original when readdir fails
    expect(result).toEqual(['ghost-dir']);
    expect(scan.splitDirs['ghost-dir']).toBeUndefined();
  });

  it('should estimate file counts for subdirectories', async () => {
    const srcDir = path.join(testWorkspace, 'src');
    const coreDir = path.join(srcDir, 'core');
    await fs.mkdir(coreDir, { recursive: true });

    // Put 3 files and 1 subdir in core/
    await fs.writeFile(path.join(coreDir, 'a.ts'), '');
    await fs.writeFile(path.join(coreDir, 'b.ts'), '');
    await fs.writeFile(path.join(coreDir, 'c.ts'), '');
    await fs.mkdir(path.join(coreDir, 'utils'));

    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['src'],
      directoryCounts: { src: 30 },
    });

    await coordinator.expandLargeDirectories(scan);

    // Estimation: 3 files + 1 non-skipped dir * 5 = 8
    expect(scan.directoryCounts['src/core']).toBe(8);
  });

  it('should assign default estimate of 10 if subdir cannot be read', async () => {
    const srcDir = path.join(testWorkspace, 'src');
    await fs.mkdir(path.join(srcDir, 'readable'), { recursive: true });
    // Create a subdir we can read, plus we will test the fallback via a symlink to nowhere
    const brokenLink = path.join(srcDir, 'broken');
    await fs.mkdir(brokenLink, { recursive: true });
    // Make it unreadable by removing permissions
    await fs.chmod(brokenLink, 0o000);

    const scan = makeStructureScan({
      workspacePath: testWorkspace,
      topLevelDirs: ['src'],
      directoryCounts: { src: 30 },
    });

    await coordinator.expandLargeDirectories(scan);

    // The broken dir should get the default estimate of 10
    if (scan.directoryCounts['src/broken'] !== undefined) {
      expect(scan.directoryCounts['src/broken']).toBe(10);
    }

    // Restore permissions for cleanup
    await fs.chmod(brokenLink, 0o755);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. calculateDiveTimeout()
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('ExplorationCoordinator.calculateDiveTimeout', () => {
  let testWorkspace: string;
  let coordinator: ExplorationCoordinator;

  beforeEach(async () => {
    testWorkspace = path.join(
      os.tmpdir(),
      'test-timeout-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    );
    await fs.mkdir(testWorkspace, { recursive: true });

    vi.clearAllMocks();
    mockSpawn.mockReset();

    coordinator = new ExplorationCoordinator({
      workspacePath: testWorkspace,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('should return the floor (180,000 ms) for 10 files', () => {
    // 10 * 4000 = 40,000, which is below the floor of 180,000
    expect(coordinator.calculateDiveTimeout(10)).toBe(180_000);
  });

  it('should return the floor (180,000 ms) for 45 files (45 * 4000 = 180,000)', () => {
    // 45 * 4000 = 180,000 — exactly matches the floor
    expect(coordinator.calculateDiveTimeout(45)).toBe(180_000);
  });

  it('should return 400,000 ms for 100 files', () => {
    // 100 * 4000 = 400,000, within the range [180,000, 600,000]
    expect(coordinator.calculateDiveTimeout(100)).toBe(400_000);
  });

  it('should return the ceiling (600,000 ms) for 200 files', () => {
    // 200 * 4000 = 800,000, capped at 600,000
    expect(coordinator.calculateDiveTimeout(200)).toBe(600_000);
  });

  it('should return the floor for 0 files', () => {
    // 0 * 4000 = 0, floored to 180,000
    expect(coordinator.calculateDiveTimeout(0)).toBe(180_000);
  });

  it('should return the ceiling for very large file counts (1000+)', () => {
    // 1000 * 4000 = 4,000,000, capped at 600,000
    expect(coordinator.calculateDiveTimeout(1000)).toBe(600_000);
  });

  it('should scale linearly between floor and ceiling', () => {
    // 50 * 4000 = 200,000
    expect(coordinator.calculateDiveTimeout(50)).toBe(200_000);
    // 75 * 4000 = 300,000
    expect(coordinator.calculateDiveTimeout(75)).toBe(300_000);
    // 150 * 4000 = 600,000 — hits ceiling
    expect(coordinator.calculateDiveTimeout(150)).toBe(600_000);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. extractChangedScopes() with splitDirs
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('WorkspaceChangeTracker.extractChangedScopes', () => {
  let tracker: WorkspaceChangeTracker;

  beforeEach(() => {
    // WorkspaceChangeTracker only needs a workspace path for git operations;
    // extractChangedScopes is a pure function on the input arrays.
    tracker = new WorkspaceChangeTracker('/tmp/test-scopes');
  });

  describe('without splitDirs (1-level scoping)', () => {
    it('should extract 1-level scope from a file path', () => {
      const scopes = tracker.extractChangedScopes(['src/index.ts']);
      expect(scopes).toEqual(['src']);
    });

    it('should map root-level files to "."', () => {
      const scopes = tracker.extractChangedScopes(['package.json']);
      expect(scopes).toEqual(['.']);
    });

    it('should deduplicate scopes', () => {
      const scopes = tracker.extractChangedScopes([
        'src/core/bridge.ts',
        'src/master/manager.ts',
        'src/index.ts',
      ]);
      expect(scopes).toEqual(['src']);
    });

    it('should include deleted files in scope calculation', () => {
      const scopes = tracker.extractChangedScopes(['src/new-file.ts'], ['tests/old-file.test.ts']);
      expect(scopes).toContain('src');
      expect(scopes).toContain('tests');
    });

    it('should handle multiple top-level directories', () => {
      const scopes = tracker.extractChangedScopes([
        'src/core/bridge.ts',
        'tests/unit.test.ts',
        'docs/README.md',
      ]);
      expect(scopes.sort()).toEqual(['docs', 'src', 'tests']);
    });

    it('should handle empty input', () => {
      const scopes = tracker.extractChangedScopes([]);
      expect(scopes).toEqual([]);
    });

    it('should handle empty changed + empty deleted', () => {
      const scopes = tracker.extractChangedScopes([], []);
      expect(scopes).toEqual([]);
    });
  });

  describe('with splitDirs (2-level scoping for split directories)', () => {
    const splitDirs: Record<string, string[]> = {
      src: ['src/core', 'src/master', 'src/connectors'],
    };

    it('should use 2-level scope for files in a split subdir', () => {
      const scopes = tracker.extractChangedScopes(['src/core/bridge.ts'], [], splitDirs);
      expect(scopes).toEqual(['src/core']);
    });

    it('should use 2-level scope for files in another split subdir', () => {
      const scopes = tracker.extractChangedScopes(['src/master/foo.ts'], [], splitDirs);
      expect(scopes).toEqual(['src/master']);
    });

    it('should fall back to 1-level scope for files directly in a split dir (not in a subdir)', () => {
      // src/index.ts is directly under src/, not in a recognized subdir
      const scopes = tracker.extractChangedScopes(['src/index.ts'], [], splitDirs);
      expect(scopes).toEqual(['src']);
    });

    it('should use 1-level scope for directories NOT in splitDirs', () => {
      const scopes = tracker.extractChangedScopes(['tests/unit.test.ts'], [], splitDirs);
      expect(scopes).toEqual(['tests']);
    });

    it('should map root-level files to "." even with splitDirs', () => {
      const scopes = tracker.extractChangedScopes(['package.json'], [], splitDirs);
      expect(scopes).toEqual(['.']);
    });

    it('should handle a mix of split-subdir, top-level, and root files', () => {
      const scopes = tracker.extractChangedScopes(
        [
          'src/core/bridge.ts',
          'src/master/foo.ts',
          'src/index.ts',
          'tests/unit.test.ts',
          'package.json',
        ],
        [],
        splitDirs,
      );

      expect(scopes).toContain('src/core');
      expect(scopes).toContain('src/master');
      expect(scopes).toContain('src'); // src/index.ts — directly in top-level
      expect(scopes).toContain('tests'); // not in splitDirs — 1-level
      expect(scopes).toContain('.'); // root-level file
      expect(scopes).toHaveLength(5);
    });

    it('should handle deleted files with splitDirs', () => {
      const scopes = tracker.extractChangedScopes(
        ['src/core/new.ts'],
        ['src/connectors/old.ts'],
        splitDirs,
      );

      expect(scopes).toContain('src/core');
      expect(scopes).toContain('src/connectors');
      expect(scopes).toHaveLength(2);
    });

    it('should use 1-level scope for subdir NOT in the splitDirs list', () => {
      // src/types is under src/ but NOT in the splitDirs['src'] array
      const scopes = tracker.extractChangedScopes(['src/types/config.ts'], [], splitDirs);

      // src/types is not a known split path, so it falls back to 'src'
      expect(scopes).toEqual(['src']);
    });

    it('should deduplicate 2-level scopes', () => {
      const scopes = tracker.extractChangedScopes(
        ['src/core/bridge.ts', 'src/core/router.ts', 'src/core/auth.ts'],
        [],
        splitDirs,
      );

      expect(scopes).toEqual(['src/core']);
    });

    it('should handle backslash paths (Windows compat)', () => {
      const scopes = tracker.extractChangedScopes(['src\\core\\bridge.ts'], [], splitDirs);

      // The method normalises backslashes to forward slashes
      expect(scopes).toEqual(['src/core']);
    });

    it('should handle multiple split top-level dirs', () => {
      const multiSplitDirs: Record<string, string[]> = {
        src: ['src/core', 'src/master'],
        tests: ['tests/unit', 'tests/integration'],
      };

      const scopes = tracker.extractChangedScopes(
        ['src/core/bridge.ts', 'tests/integration/flow.test.ts', 'docs/readme.md'],
        [],
        multiSplitDirs,
      );

      expect(scopes).toContain('src/core');
      expect(scopes).toContain('tests/integration');
      expect(scopes).toContain('docs');
      expect(scopes).toHaveLength(3);
    });

    it('should handle empty splitDirs record', () => {
      const scopes = tracker.extractChangedScopes(['src/core/bridge.ts'], [], {});

      // Empty splitDirs = same as no splitDirs — 1-level scope
      expect(scopes).toEqual(['src']);
    });
  });
});
