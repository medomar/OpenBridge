/**
 * Tests for OB-F157: Monorepo detection and Phase 4 assembly
 *
 * Covers:
 * 1. detectMonorepoPattern() — identifies a workspace with 3 sub-projects as a monorepo
 * 2. Phase 4 assembly — produces a monorepo map with subProjects + sharedDirs
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

import { detectMonorepoPattern } from '../../src/master/monorepo-detector.js';
import { ExplorationCoordinator } from '../../src/master/exploration-coordinator.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type {
  ExplorationState,
  StructureScan,
  Classification,
  DirectoryDiveResult,
} from '../../src/types/master.js';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. detectMonorepoPattern() — unit tests
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('detectMonorepoPattern()', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      'monorepo-unit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('detects a monorepo with 3 sub-projects each having package.json', async () => {
    for (const name of ['pkg-a', 'pkg-b', 'pkg-c']) {
      await fs.mkdir(path.join(tmpDir, name), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, name, 'package.json'),
        JSON.stringify({ name, version: '1.0.0' }),
      );
    }

    const result = await detectMonorepoPattern(tmpDir);

    expect(result.isMonorepo).toBe(true);
    expect(result.subProjects).toHaveLength(3);

    const paths = result.subProjects.map((sp) => sp.path);
    expect(paths).toContain('pkg-a');
    expect(paths).toContain('pkg-b');
    expect(paths).toContain('pkg-c');

    for (const sp of result.subProjects) {
      expect(sp.type).toBe('node');
    }
  });

  it('returns isMonorepo=false for a single-project workspace', async () => {
    // Only one sub-directory with a package.json
    await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'src', 'package.json'),
      JSON.stringify({ name: 'single', version: '1.0.0' }),
    );

    const result = await detectMonorepoPattern(tmpDir);

    expect(result.isMonorepo).toBe(false);
    expect(result.subProjects).toHaveLength(0);
  });

  it('ignores excluded directories (node_modules, dist)', async () => {
    // One real sub-project
    await fs.mkdir(path.join(tmpDir, 'app'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'app', 'package.json'),
      JSON.stringify({ name: 'app', version: '1.0.0' }),
    );

    // Excluded dirs that should not count toward monorepo threshold
    for (const excluded of ['node_modules', 'dist']) {
      await fs.mkdir(path.join(tmpDir, excluded), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, excluded, 'package.json'),
        JSON.stringify({ name: excluded, version: '1.0.0' }),
      );
    }

    const result = await detectMonorepoPattern(tmpDir);

    expect(result.isMonorepo).toBe(false);
    expect(result.subProjects).toHaveLength(0);
  });

  it('detects sub-projects at depth 2 inside a packages/ directory', async () => {
    await fs.mkdir(path.join(tmpDir, 'packages'), { recursive: true });
    for (const name of ['core', 'ui', 'cli']) {
      await fs.mkdir(path.join(tmpDir, 'packages', name), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'packages', name, 'package.json'),
        JSON.stringify({ name, version: '1.0.0' }),
      );
    }

    const result = await detectMonorepoPattern(tmpDir);

    expect(result.isMonorepo).toBe(true);
    expect(result.subProjects).toHaveLength(3);

    const paths = result.subProjects.map((sp) => sp.path);
    expect(paths).toContain('packages/core');
    expect(paths).toContain('packages/ui');
    expect(paths).toContain('packages/cli');
  });

  it('detects mixed-language monorepo (go.mod, package.json, Cargo.toml)', async () => {
    await fs.mkdir(path.join(tmpDir, 'api'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'api', 'go.mod'), 'module api\n\ngo 1.21\n');

    await fs.mkdir(path.join(tmpDir, 'frontend'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'frontend', 'package.json'),
      JSON.stringify({ name: 'frontend', version: '0.1.0' }),
    );

    await fs.mkdir(path.join(tmpDir, 'worker'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'worker', 'Cargo.toml'),
      '[package]\nname = "worker"\nversion = "0.1.0"\n',
    );

    const result = await detectMonorepoPattern(tmpDir);

    expect(result.isMonorepo).toBe(true);
    expect(result.subProjects).toHaveLength(3);

    const byPath = Object.fromEntries(result.subProjects.map((sp) => [sp.path, sp.type]));
    expect(byPath['api']).toBe('go');
    expect(byPath['frontend']).toBe('node');
    expect(byPath['worker']).toBe('rust');
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. Phase 4 assembly — monorepo workspace
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Phase 4 assembly — monorepo workspace', () => {
  let testWorkspace: string;
  let coordinator: ExplorationCoordinator;
  let dotFolder: DotFolderManager;

  const mockMasterTool: DiscoveredTool = {
    name: 'claude',
    path: '/usr/local/bin/claude',
    version: '1.0.0',
    type: 'cli',
    capabilities: ['code', 'exploration', 'delegation'],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawn.mockReset();

    testWorkspace = path.join(
      os.tmpdir(),
      'monorepo-phase4-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    );
    await fs.mkdir(testWorkspace, { recursive: true });

    // Create 3 sub-project directories with package.json + a shared dir without one
    for (const name of ['pkg-a', 'pkg-b', 'pkg-c']) {
      await fs.mkdir(path.join(testWorkspace, name), { recursive: true });
      await fs.writeFile(
        path.join(testWorkspace, name, 'package.json'),
        JSON.stringify({ name, version: '1.0.0' }),
      );
    }
    await fs.mkdir(path.join(testWorkspace, 'shared'), { recursive: true });

    dotFolder = new DotFolderManager(testWorkspace);
    await dotFolder.initialize();
    await dotFolder.createExplorationDir();

    coordinator = new ExplorationCoordinator({
      workspacePath: testWorkspace,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
    });
  });

  afterEach(async () => {
    await fs.rm(testWorkspace, { recursive: true, force: true });
  });

  it('produces a monorepo map with 3 sub-projects and shared dirs when phases 1-3 are pre-completed', async () => {
    const now = new Date().toISOString();

    const subProjects = [
      { path: 'pkg-a', type: 'node' },
      { path: 'pkg-b', type: 'node' },
      { path: 'pkg-c', type: 'node' },
    ];

    // Set up exploration state with phases 1-3 already completed and sub-projects detected
    const state: ExplorationState = {
      currentPhase: 'assembly',
      status: 'in_progress',
      startedAt: now,
      phases: {
        structure_scan: 'completed',
        classification: 'completed',
        directory_dives: 'completed',
        assembly: 'pending',
        finalization: 'pending',
      },
      directoryDives: [
        { path: 'pkg-a', status: 'completed', outputFile: 'dirs/pkg-a.json' },
        { path: 'pkg-b', status: 'completed', outputFile: 'dirs/pkg-b.json' },
        { path: 'pkg-c', status: 'completed', outputFile: 'dirs/pkg-c.json' },
        { path: 'shared', status: 'completed', outputFile: 'dirs/shared.json' },
      ],
      totalCalls: 4,
      totalAITimeMs: 8000,
      subProjects,
    };
    await dotFolder.writeExplorationState(state);

    // Write structure scan
    const structureScan: StructureScan = {
      workspacePath: testWorkspace,
      topLevelFiles: [],
      topLevelDirs: ['pkg-a', 'pkg-b', 'pkg-c', 'shared'],
      directoryCounts: { 'pkg-a': 5, 'pkg-b': 5, 'pkg-c': 5, shared: 3 },
      configFiles: [],
      skippedDirs: [],
      totalFiles: 18,
      scannedAt: now,
      durationMs: 500,
    };
    await dotFolder.writeStructureScan(structureScan);

    // Write classification (non-monorepo type — Phase 4 should override to 'monorepo')
    const classification: Classification = {
      projectType: 'node',
      projectName: 'my-monorepo',
      frameworks: ['typescript'],
      commands: { test: 'npm test' },
      dependencies: [],
      insights: ['Multi-package repository'],
      classifiedAt: now,
      durationMs: 800,
    };
    await dotFolder.writeClassification(classification);

    // Write directory dive results for each sub-project and the shared dir
    const diveFixtures: Array<[string, string]> = [
      ['pkg-a', 'Package A — core library'],
      ['pkg-b', 'Package B — UI components'],
      ['pkg-c', 'Package C — CLI tool'],
      ['shared', 'Shared utilities'],
    ];
    for (const [name, purpose] of diveFixtures) {
      const dive: DirectoryDiveResult = {
        path: name,
        purpose,
        keyFiles: [{ path: `${name}/index.ts`, type: 'entry', purpose: `${name} entry` }],
        subdirectories: [],
        fileCount: name === 'shared' ? 3 : 5,
        insights: ['Uses TypeScript'],
        exploredAt: now,
        durationMs: 400,
      };
      await dotFolder.writeDirectoryDive(name, dive);
    }

    // Mock only the Phase 4 AI call (summary generation)
    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({ summary: 'A monorepo with 3 independent Node.js packages.' }),
      stderr: '',
      retryCount: 0,
      durationMs: 200,
    });

    const summary = await coordinator.explore();

    expect(summary.status).toBe('completed');

    // Read the written workspace-map.json directly to inspect passthrough fields
    const mapPath = path.join(testWorkspace, '.openbridge', 'workspace-map.json');
    const mapContent = await fs.readFile(mapPath, 'utf-8');
    const map = JSON.parse(mapContent) as Record<string, unknown>;

    // projectType must be 'monorepo'
    expect(map['projectType']).toBe('monorepo');

    // subProjects must contain all 3 sub-projects
    expect(Array.isArray(map['subProjects'])).toBe(true);
    const mapSubProjects = map['subProjects'] as Array<{
      name: string;
      path: string;
      type: string;
    }>;
    expect(mapSubProjects).toHaveLength(3);

    const subProjectPaths = mapSubProjects.map((sp) => sp.path);
    expect(subProjectPaths).toContain('pkg-a');
    expect(subProjectPaths).toContain('pkg-b');
    expect(subProjectPaths).toContain('pkg-c');

    for (const sp of mapSubProjects) {
      expect(sp.type).toBe('node');
    }

    // sharedDirs must include 'shared' (a dir that is not a sub-project)
    expect(Array.isArray(map['sharedDirs'])).toBe(true);
    const sharedDirs = map['sharedDirs'] as string[];
    expect(sharedDirs).toContain('shared');
    // Sub-project dirs must not appear in sharedDirs
    for (const sp of subProjects) {
      expect(sharedDirs).not.toContain(sp.path);
    }
  });

  it('sets projectType to the classified type when fewer than 2 sub-projects are detected', async () => {
    const now = new Date().toISOString();

    // Only 1 sub-project — not a monorepo
    const state: ExplorationState = {
      currentPhase: 'assembly',
      status: 'in_progress',
      startedAt: now,
      phases: {
        structure_scan: 'completed',
        classification: 'completed',
        directory_dives: 'completed',
        assembly: 'pending',
        finalization: 'pending',
      },
      directoryDives: [{ path: 'pkg-a', status: 'completed', outputFile: 'dirs/pkg-a.json' }],
      totalCalls: 2,
      totalAITimeMs: 3000,
      subProjects: [{ path: 'pkg-a', type: 'node' }],
    };
    await dotFolder.writeExplorationState(state);

    const structureScan: StructureScan = {
      workspacePath: testWorkspace,
      topLevelFiles: [],
      topLevelDirs: ['pkg-a'],
      directoryCounts: { 'pkg-a': 5 },
      configFiles: [],
      skippedDirs: [],
      totalFiles: 5,
      scannedAt: now,
      durationMs: 300,
    };
    await dotFolder.writeStructureScan(structureScan);

    const classification: Classification = {
      projectType: 'node',
      projectName: 'single-project',
      frameworks: ['typescript'],
      commands: {},
      dependencies: [],
      insights: [],
      classifiedAt: now,
      durationMs: 500,
    };
    await dotFolder.writeClassification(classification);

    const dive: DirectoryDiveResult = {
      path: 'pkg-a',
      purpose: 'Single package',
      keyFiles: [],
      subdirectories: [],
      fileCount: 5,
      insights: [],
      exploredAt: now,
      durationMs: 400,
    };
    await dotFolder.writeDirectoryDive('pkg-a', dive);

    mockSpawn.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({ summary: 'A single Node.js package.' }),
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    });

    const summary = await coordinator.explore();
    expect(summary.status).toBe('completed');

    const mapContent = await fs.readFile(
      path.join(testWorkspace, '.openbridge', 'workspace-map.json'),
      'utf-8',
    );
    const map = JSON.parse(mapContent) as Record<string, unknown>;

    // Must keep the original classified type — not override to 'monorepo'
    expect(map['projectType']).toBe('node');
    // subProjects extra field should not be present (or empty)
    expect(map['subProjects']).toBeUndefined();
  });
});
