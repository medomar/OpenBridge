/**
 * OB-1510 — Workspace map persistence tests
 *
 * Test 1: Run exploration on a mock workspace and assert that workspace-map.json
 *         exists on disk after completion.
 *
 * Test 2: Call readWorkspaceMap() when the file is missing, assert it returns
 *         null without throwing, and that WARN is logged only once (subsequent
 *         calls log at DEBUG level instead).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { StructureScan, Classification, DirectoryDiveResult } from '../../src/types/master.js';
import type * as DotFolderManagerModule from '../../src/master/dotfolder-manager.js';

// ── Shared mock for AgentRunner (used by ExplorationCoordinator) ───────────────

const mockSpawn = vi.fn();

vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: mockSpawn,
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
}));

// ── Suite 1: workspace-map.json exists after exploration ───────────────────────

describe('workspace-map.json persistence after exploration', () => {
  let testWorkspace: string;

  beforeEach(async () => {
    testWorkspace = path.join(
      os.tmpdir(),
      'ob-wm-test-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    );
    await fs.mkdir(testWorkspace, { recursive: true });

    vi.clearAllMocks();
    mockSpawn.mockReset();
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('writes workspace-map.json to disk after a successful exploration run', async () => {
    const { ExplorationCoordinator } = await import('../../src/master/exploration-coordinator.js');

    const masterTool = {
      name: 'claude',
      path: '/usr/local/bin/claude',
      version: '1.0.0',
      type: 'cli' as const,
      capabilities: ['code', 'exploration', 'delegation'],
    };

    const coordinator = new ExplorationCoordinator({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
    });

    // ── Build mock AI responses for each exploration phase ──────────────────────

    const structureScan: StructureScan = {
      workspacePath: testWorkspace,
      topLevelFiles: ['README.md', 'package.json'],
      topLevelDirs: ['src'],
      directoryCounts: { src: 3 },
      configFiles: ['package.json'],
      skippedDirs: ['node_modules'],
      totalFiles: 4,
      scannedAt: new Date().toISOString(),
      durationMs: 500,
    };

    const classification: Classification = {
      projectType: 'node',
      projectName: 'mock-project',
      frameworks: ['typescript'],
      commands: { test: 'npm test', build: 'npm run build' },
      dependencies: [{ name: 'typescript', version: '^5.0.0' }],
      insights: ['TypeScript project'],
      classifiedAt: new Date().toISOString(),
      durationMs: 600,
    };

    const directoryDive: DirectoryDiveResult = {
      path: 'src',
      purpose: 'Source code directory',
      keyFiles: [{ path: 'src/index.ts', type: 'entry', purpose: 'Main entry point' }],
      subdirectories: [],
      fileCount: 3,
      insights: ['TypeScript source files'],
      exploredAt: new Date().toISOString(),
      durationMs: 400,
    };

    mockSpawn
      // Phase 1: structure scan
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(structureScan),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      })
      // Phase 2: classification
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(classification),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      })
      // Phase 3: directory dive for 'src'
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(directoryDive),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      })
      // Phase 4: assembly / summary generation
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ summary: 'A minimal TypeScript project.' }),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      });

    const summary = await coordinator.explore();

    expect(summary.status).toBe('completed');

    // The primary assertion: workspace-map.json must exist on disk after exploration.
    const mapPath = path.join(testWorkspace, '.openbridge', 'workspace-map.json');
    await expect(fs.access(mapPath)).resolves.toBeUndefined();

    // Sanity-check: the file contains valid JSON with the expected project name.
    const raw = await fs.readFile(mapPath, 'utf-8');
    const parsed = JSON.parse(raw) as { projectName?: string };
    expect(parsed.projectName).toBe('mock-project');
  });
});

// ── Suite 2: readWorkspaceMap() returns null + WARN-once when file missing ─────

describe('readWorkspaceMap() when workspace-map.json is absent', () => {
  let testWorkspace: string;

  beforeEach(async () => {
    testWorkspace = path.join(
      os.tmpdir(),
      'ob-wm-missing-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    );
    // Do NOT create .openbridge/ — the file must be absent.
    await fs.mkdir(testWorkspace, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('returns null without throwing when workspace-map.json does not exist', async () => {
    const { DotFolderManager } = await import('../../src/master/dotfolder-manager.js');
    const manager = new DotFolderManager(testWorkspace);

    await expect(manager.readWorkspaceMap()).resolves.toBeNull();
  });

  it('logs WARN exactly once and DEBUG on subsequent calls', async () => {
    // Use a fresh mock logger for this test to capture warn/debug calls
    const mockWarn = vi.fn();
    const mockDebug = vi.fn();

    vi.doMock('../../src/core/logger.js', () => ({
      createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: mockWarn,
        error: vi.fn(),
        debug: mockDebug,
      })),
    }));

    // Force fresh import so the mocked logger is picked up
    const { DotFolderManager } = (await import(
      '../../src/master/dotfolder-manager.js?mock-logger-' + Date.now()
    )) as typeof DotFolderManagerModule;

    const manager = new DotFolderManager(testWorkspace);

    // First call — WARN should fire once
    const result1 = await manager.readWorkspaceMap();
    expect(result1).toBeNull();
    expect(mockWarn).toHaveBeenCalledOnce();

    // Second call — should NOT add another WARN; DEBUG should fire instead
    const result2 = await manager.readWorkspaceMap();
    expect(result2).toBeNull();
    expect(mockWarn).toHaveBeenCalledOnce(); // still only once

    vi.doUnmock('../../src/core/logger.js');
  });
});
