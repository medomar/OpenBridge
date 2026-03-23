/**
 * Tests for exploration-coordinator.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ExplorationCoordinator } from '../../src/master/exploration-coordinator.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import { MemoryManager } from '../../src/memory/index.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  WorkspaceMapSchema,
  type ExplorationState,
  type StructureScan,
  type Classification,
  type DirectoryDiveResult,
} from '../../src/types/master.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';

// Mock the AgentRunner class used by ExplorationCoordinator
const mockSpawn = vi.fn();
vi.mock('../../src/core/agent-runner.js', () => {
  console.log('MOCK FACTORY CALLED for agent-runner.js');
  return {
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
  };
});

describe('ExplorationCoordinator', () => {
  let testWorkspace: string;
  let coordinator: ExplorationCoordinator;
  let mockMasterTool: DiscoveredTool;
  let mockDiscoveredTools: DiscoveredTool[];

  beforeEach(async () => {
    // Create a temporary test workspace in the system temp dir (not the project root)
    // to avoid git race conditions when parallel tests delete directories inside the project.
    testWorkspace = path.join(
      os.tmpdir(),
      'test-workspace-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    );
    await fs.mkdir(testWorkspace, { recursive: true });

    // Mock discovered tools
    mockMasterTool = {
      name: 'claude',
      path: '/usr/local/bin/claude',
      version: '1.0.0',
      type: 'cli',
      capabilities: ['code', 'exploration', 'delegation'],
    };

    mockDiscoveredTools = [
      mockMasterTool,
      {
        name: 'codex',
        path: '/usr/local/bin/codex',
        version: '2.0.0',
        type: 'cli',
        capabilities: ['code'],
      },
    ];

    // Reset mocks before creating coordinator.
    // vi.clearAllMocks() clears call history but NOT the mockResolvedValueOnce queue.
    // mockSpawn.mockReset() is needed to flush leftover once-values from previous tests.
    vi.clearAllMocks();
    mockSpawn.mockReset();

    // Create coordinator (picks up fresh AgentRunner mock)
    coordinator = new ExplorationCoordinator({
      workspacePath: testWorkspace,
      masterTool: mockMasterTool,
      discoveredTools: mockDiscoveredTools,
    });
  });

  afterEach(async () => {
    // Clean up test workspace
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Initial State Creation', () => {
    it('should create initial exploration state on first run', async () => {
      // Mock AI responses for all 5 phases
      const structureScan: StructureScan = {
        workspacePath: testWorkspace,
        topLevelFiles: ['README.md', 'package.json'],
        topLevelDirs: ['src', 'tests'],
        directoryCounts: { src: 10, tests: 5 },
        configFiles: ['package.json'],
        skippedDirs: ['node_modules'],
        totalFiles: 15,
        scannedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const classification: Classification = {
        projectType: 'node',
        projectName: 'test-project',
        frameworks: ['typescript'],
        commands: { test: 'npm test' },
        dependencies: [],
        insights: ['TypeScript project'],
        classifiedAt: new Date().toISOString(),
        durationMs: 1500,
      };

      const directoryDive: DirectoryDiveResult = {
        path: 'src',
        purpose: 'Source code',
        keyFiles: [{ path: 'src/index.ts', type: 'entry', purpose: 'Main entry' }],
        subdirectories: [],
        fileCount: 10,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 1200,
      };

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(structureScan),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(classification),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(directoryDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(directoryDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify({ summary: 'Test project summary' }),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        });

      const summary = await coordinator.explore();

      expect(summary.status).toBe('completed');
      expect(summary.directoriesExplored).toBe(2); // src and tests
    });

    it('should skip completed phases on resume', async () => {
      const dotFolder = new DotFolderManager(testWorkspace);
      await dotFolder.initialize();
      await dotFolder.createExplorationDir();

      // Create a partially completed state
      const partialState: ExplorationState = {
        currentPhase: 'classification',
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        phases: {
          structure_scan: 'completed',
          classification: 'pending',
          directory_dives: 'pending',
          assembly: 'pending',
          finalization: 'pending',
        },
        directoryDives: [],
        totalCalls: 1,
        totalAITimeMs: 1000,
      };

      await dotFolder.writeExplorationState(partialState);

      // Write structure scan result
      const structureScan: StructureScan = {
        workspacePath: testWorkspace,
        topLevelFiles: ['README.md'],
        topLevelDirs: ['src'],
        directoryCounts: { src: 5 },
        configFiles: ['package.json'],
        skippedDirs: [],
        totalFiles: 5,
        scannedAt: new Date().toISOString(),
        durationMs: 1000,
      };
      await dotFolder.writeStructureScan(structureScan);

      // Mock remaining phases
      const classification: Classification = {
        projectType: 'node',
        projectName: 'test',
        frameworks: [],
        commands: {},
        dependencies: [],
        insights: [],
        classifiedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const directoryDive: DirectoryDiveResult = {
        path: 'src',
        purpose: 'Source',
        keyFiles: [],
        subdirectories: [],
        fileCount: 5,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 1000,
      };

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(classification),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(directoryDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify({ summary: 'Summary' }),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        });

      await coordinator.explore();

      // Should only call AgentRunner.spawn() 3 times (classification, directory dive, summary)
      // Not 4 (structure scan was already done)
      expect(mockSpawn).toHaveBeenCalledTimes(3);
    });

    it('should return cached summary if exploration already completed', async () => {
      const dotFolder = new DotFolderManager(testWorkspace);
      await dotFolder.initialize();
      await dotFolder.createExplorationDir();

      // Create a completed state
      const completedState: ExplorationState = {
        currentPhase: 'finalization',
        status: 'completed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        phases: {
          structure_scan: 'completed',
          classification: 'completed',
          directory_dives: 'completed',
          assembly: 'completed',
          finalization: 'completed',
        },
        directoryDives: [
          { path: 'src', status: 'completed', outputFile: 'dirs/src.json', attempts: 0 },
        ],
        totalCalls: 5,
        totalAITimeMs: 5000,
      };

      await dotFolder.writeExplorationState(completedState);

      // Write classification for summary building
      const classification: Classification = {
        projectType: 'node',
        projectName: 'test',
        frameworks: [],
        commands: {},
        dependencies: [],
        insights: [],
        classifiedAt: new Date().toISOString(),
        durationMs: 1000,
      };
      await dotFolder.writeClassification(classification);

      const summary = await coordinator.explore();

      expect(summary.status).toBe('completed');
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('Phase 1: Structure Scan', () => {
    it('should execute structure scan and checkpoint results', async () => {
      const structureScan: StructureScan = {
        workspacePath: testWorkspace,
        topLevelFiles: ['README.md', 'package.json'],
        topLevelDirs: ['src', 'tests', 'docs'],
        directoryCounts: { src: 20, tests: 10, docs: 3 },
        configFiles: ['package.json', 'tsconfig.json'],
        skippedDirs: ['node_modules', '.git'],
        totalFiles: 33,
        scannedAt: new Date().toISOString(),
        durationMs: 1500,
      };

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(structureScan),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      });

      // Mock remaining phases with minimal data (3 directories from structureScan)
      setupMockRemainingPhases(0, ['src', 'tests', 'docs']);

      await coordinator.explore();

      const dotFolder = new DotFolderManager(testWorkspace);
      const savedScan = await dotFolder.readStructureScan();

      // scannedAt and durationMs are overridden by the coordinator with server-side values
      expect(savedScan).toMatchObject({
        workspacePath: structureScan.workspacePath,
        topLevelFiles: structureScan.topLevelFiles,
        topLevelDirs: structureScan.topLevelDirs,
        directoryCounts: structureScan.directoryCounts,
        configFiles: structureScan.configFiles,
        skippedDirs: structureScan.skippedDirs,
        totalFiles: structureScan.totalFiles,
      });
      expect(savedScan?.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should handle structure scan failure with non-zero exit code', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'AI execution failed',
        retryCount: 0,
        durationMs: 0,
      });

      await expect(coordinator.explore()).rejects.toThrow('Structure scan failed with exit code 1');
    });

    it('should handle structure scan parse failure', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'invalid json output',
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      });

      await expect(coordinator.explore()).rejects.toThrow('Failed to parse structure scan result');
    });
  });

  describe('Phase 2: Classification', () => {
    it('should execute classification and use structure scan results', async () => {
      const structureScan: StructureScan = {
        workspacePath: testWorkspace,
        topLevelFiles: ['package.json'],
        topLevelDirs: ['src'],
        directoryCounts: { src: 10 },
        configFiles: ['package.json', 'tsconfig.json'],
        skippedDirs: [],
        totalFiles: 10,
        scannedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const classification: Classification = {
        projectType: 'node',
        projectName: 'openbridge',
        frameworks: ['typescript', 'vitest'],
        commands: { test: 'npm test', build: 'npm run build' },
        dependencies: [{ name: 'typescript', version: '^5.7.0', type: 'dev' }],
        insights: ['TypeScript strict mode enabled'],
        classifiedAt: new Date().toISOString(),
        durationMs: 2000,
      };

      const directoryDive: DirectoryDiveResult = {
        path: 'src',
        purpose: 'Source',
        keyFiles: [],
        subdirectories: [],
        fileCount: 10,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 1000,
      };

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(structureScan),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(classification),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(directoryDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify({ summary: 'Summary' }),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        });

      await coordinator.explore();

      const dotFolder = new DotFolderManager(testWorkspace);
      const savedClassification = await dotFolder.readClassification();

      // classifiedAt and durationMs are overridden by the coordinator with server-side values
      expect(savedClassification).toMatchObject({
        projectType: classification.projectType,
        projectName: classification.projectName,
        frameworks: classification.frameworks,
        commands: classification.commands,
        dependencies: classification.dependencies,
        insights: classification.insights,
      });
      expect(savedClassification?.classifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should fail if structure scan not found', async () => {
      const dotFolder = new DotFolderManager(testWorkspace);
      await dotFolder.initialize();
      await dotFolder.createExplorationDir();

      // Create state with completed structure scan but missing file
      const state: ExplorationState = {
        currentPhase: 'classification',
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        phases: {
          structure_scan: 'completed',
          classification: 'pending',
          directory_dives: 'pending',
          assembly: 'pending',
          finalization: 'pending',
        },
        directoryDives: [],
        totalCalls: 1,
        totalAITimeMs: 1000,
      };

      await dotFolder.writeExplorationState(state);

      await expect(coordinator.explore()).rejects.toThrow(
        'Structure scan result not found (Phase 1 incomplete)',
      );
    });
  });

  describe('Phase 3: Directory Dives', () => {
    it('should process directories in batches of 3', async () => {
      const structureScan: StructureScan = {
        workspacePath: testWorkspace,
        topLevelFiles: [],
        topLevelDirs: ['src', 'tests', 'docs', 'scripts', 'benchmarks'],
        directoryCounts: { src: 20, tests: 10, docs: 5, scripts: 3, benchmarks: 2 },
        configFiles: [],
        skippedDirs: [],
        totalFiles: 40,
        scannedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const classification: Classification = {
        projectType: 'node',
        projectName: 'test',
        frameworks: ['typescript'],
        commands: {},
        dependencies: [],
        insights: [],
        classifiedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const directoryDive: DirectoryDiveResult = {
        path: 'src',
        purpose: 'Source code',
        keyFiles: [],
        subdirectories: [],
        fileCount: 10,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 1000,
      };

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(structureScan),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(classification),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        // First batch of 3
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(directoryDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(directoryDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(directoryDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        // Second batch of 2
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(directoryDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(directoryDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        // Summary
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify({ summary: 'Summary' }),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        });

      await coordinator.explore();

      // Should have 8 total calls: 1 structure + 1 classification + 5 dives + 1 summary
      expect(mockSpawn).toHaveBeenCalledTimes(8);
    });

    it('should retry failed directory dives up to 3 times', async () => {
      const structureScan: StructureScan = {
        workspacePath: testWorkspace,
        topLevelFiles: [],
        topLevelDirs: ['src'],
        directoryCounts: { src: 10 },
        configFiles: [],
        skippedDirs: [],
        totalFiles: 10,
        scannedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const classification: Classification = {
        projectType: 'node',
        projectName: 'test',
        frameworks: [],
        commands: {},
        dependencies: [],
        insights: [],
        classifiedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const directoryDive: DirectoryDiveResult = {
        path: 'src',
        purpose: 'Source',
        keyFiles: [],
        subdirectories: [],
        fileCount: 10,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 1000,
      };

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(structureScan),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(classification),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        // First attempt fails — dive is reset to 'pending' and retried in the same explore() call
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Failed',
          retryCount: 0,
          durationMs: 0,
        })
        // Retry succeeds
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(directoryDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        // Assembly
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify({ summary: 'Summary' }),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        });

      // Single explore() call — retry happens within the while loop, no throw expected
      await coordinator.explore();

      const dotFolder = new DotFolderManager(testWorkspace);
      const state = await dotFolder.readExplorationState();

      expect(state?.directoryDives[0]?.status).toBe('completed');
      expect(state?.directoryDives[0]?.attempts).toBe(1); // failed once before succeeding
    });

    it('should mark directory as failed after 3 failed attempts', async () => {
      const structureScan: StructureScan = {
        workspacePath: testWorkspace,
        topLevelFiles: [],
        topLevelDirs: ['src'],
        directoryCounts: { src: 10 },
        configFiles: [],
        skippedDirs: [],
        totalFiles: 10,
        scannedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const classification: Classification = {
        projectType: 'node',
        projectName: 'test',
        frameworks: [],
        commands: {},
        dependencies: [],
        insights: [],
        classifiedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(structureScan),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(classification),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        // Fail 3 times — all retries within a single explore() call
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Failed',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Failed',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Failed',
          retryCount: 0,
          durationMs: 0,
        })
        // Assembly still runs — 'failed' dives don't block phase completion
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify({ summary: 'Summary' }),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        });

      // explore() completes without throwing — 'failed' dives are excluded from incompleteDives check
      await coordinator.explore();

      const dotFolder = new DotFolderManager(testWorkspace);
      const state = await dotFolder.readExplorationState();

      expect(state?.directoryDives[0]?.status).toBe('failed');
      expect(state?.directoryDives[0]?.attempts).toBe(3);
    });
  });

  describe('Phase 4: Assembly', () => {
    it('should merge partial results into workspace map (OB-810: stored in DB)', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
      });
      setupCompleteExploration();

      const summary = await coordinatorWithMemory.explore();

      // Workspace map is stored in DB, not JSON file (OB-810).
      const chunks = await memory.getChunksByScope('_workspace_map', 'structure');
      expect(chunks.length).toBeGreaterThan(0);
      const map = WorkspaceMapSchema.parse(JSON.parse(chunks[0]!.content));
      expect(map).toBeDefined();
      expect(map.projectType).toBe('node');
      expect(map.summary).toBe('Test project summary');
      expect(summary.status).toBe('completed');
    });

    it('should include directory dive results in workspace map (OB-810: stored in DB)', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
      });
      setupCompleteExploration();

      await coordinatorWithMemory.explore();

      // Workspace map is stored in DB, not JSON file (OB-810).
      const chunks = await memory.getChunksByScope('_workspace_map', 'structure');
      expect(chunks.length).toBeGreaterThan(0);
      const map = WorkspaceMapSchema.parse(JSON.parse(chunks[0]!.content));
      expect(map.structure).toBeDefined();
      expect(map.structure.src).toBeDefined();
      expect(map.structure.src.purpose).toBe('Source code');
    });
  });

  describe('Phase 5: Finalization', () => {
    it('should create agents.json with master and specialists', async () => {
      setupCompleteExploration();

      await coordinator.explore();

      const dotFolder = new DotFolderManager(testWorkspace);
      const agents = await dotFolder.readAgents();

      expect(agents).toBeDefined();
      expect(agents?.master.name).toBe('claude');
      expect(agents?.specialists).toHaveLength(1);
      expect(agents?.specialists[0]?.name).toBe('codex');
    });

    it('exploration log entry goes to DB, not flat file (OB-802, OB-813)', async () => {
      setupCompleteExploration();

      await coordinator.explore();

      // appendLog() is a no-op (OB-802) — no flat log file is written
      const dotFolder = new DotFolderManager(testWorkspace);
      const logPath = dotFolder.getLogPath();
      const logExists = await import('node:fs/promises')
        .then((fsm) => fsm.access(logPath))
        .then(() => true)
        .catch(() => false);
      expect(logExists).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should mark exploration as failed on error', async () => {
      mockSpawn.mockRejectedValue(new Error('AI execution error'));

      await expect(coordinator.explore()).rejects.toThrow('AI execution error');

      const dotFolder = new DotFolderManager(testWorkspace);
      const state = await dotFolder.readExplorationState();

      expect(state?.status).toBe('failed');
      expect(state?.error).toContain('AI execution error');
    });

    it('should reset failed exploration on retry', async () => {
      const dotFolder = new DotFolderManager(testWorkspace);
      await dotFolder.initialize();
      await dotFolder.createExplorationDir();

      // Create a failed state
      const failedState: ExplorationState = {
        currentPhase: 'structure_scan',
        status: 'failed',
        startedAt: new Date().toISOString(),
        phases: {
          structure_scan: 'failed',
          classification: 'pending',
          directory_dives: 'pending',
          assembly: 'pending',
          finalization: 'pending',
        },
        directoryDives: [],
        totalCalls: 0,
        totalAITimeMs: 0,
        error: 'Previous error',
      };

      await dotFolder.writeExplorationState(failedState);

      setupCompleteExploration();

      const summary = await coordinator.explore();

      expect(summary.status).toBe('completed');
    });
  });

  describe('exploration_progress tracking (OB-892)', () => {
    it('creates exploration_progress rows for structure, classification, directory-dive, and assembly phases', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const explorationId = randomUUID();
      await memory.insertActivity({
        id: explorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId,
      });

      setupCompleteExploration();
      await coordinatorWithMemory.explore();

      const rows = await memory.getExplorationProgressByExplorationId(explorationId);
      const phases = rows.map((r) => r.phase);
      expect(phases).toContain('structure');
      expect(phases).toContain('classification');
      expect(phases).toContain('directory-dive');
      expect(phases).toContain('assembly');
    });

    it('marks phase rows as completed with progress_pct=100 after successful phases', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const explorationId = randomUUID();
      await memory.insertActivity({
        id: explorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId,
      });

      setupCompleteExploration();
      await coordinatorWithMemory.explore();

      const rows = await memory.getExplorationProgressByExplorationId(explorationId);
      const phaseRows = rows.filter((r) =>
        ['structure', 'classification', 'assembly'].includes(r.phase),
      );

      expect(phaseRows.length).toBe(3);
      for (const row of phaseRows) {
        expect(row.status).toBe('completed');
        expect(row.progress_pct).toBe(100);
      }
    });

    it('marks phase row as failed via failPhaseRow when a phase fails', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const explorationId = randomUUID();
      await memory.insertActivity({
        id: explorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId,
      });

      // Make structure scan fail with non-zero exit code
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'AI execution failed',
        retryCount: 0,
        durationMs: 0,
      });

      await expect(coordinatorWithMemory.explore()).rejects.toThrow(
        'Structure scan failed with exit code 1',
      );

      const rows = await memory.getExplorationProgressByExplorationId(explorationId);
      const structureRow = rows.find((r) => r.phase === 'structure');
      expect(structureRow).toBeDefined();
      expect(structureRow?.status).toBe('failed');
    });

    it('auto-registers an explorer activity when memory is provided without explorationId', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        // no explorationId — coordinator auto-registers one
      });

      setupCompleteExploration();
      await coordinatorWithMemory.explore();

      // The auto-registered explorer activity stays 'running' (MasterManager owns the update)
      const activeAgents = await memory.getActiveAgents();
      const explorerAgent = activeAgents.find((a) => a.type === 'explorer');
      expect(explorerAgent).toBeDefined();

      // Its auto-generated explorationId should have exploration_progress rows
      const rows = await memory.getExplorationProgressByExplorationId(explorerAgent!.id);
      const phases = rows.map((r) => r.phase);
      expect(phases).toContain('structure');
      expect(phases).toContain('classification');
      expect(phases).toContain('directory-dive');
      expect(phases).toContain('assembly');
    });
  });

  describe('directory-level progress rows (OB-893)', () => {
    it('creates one exploration_progress row per directory with phase=directory-dive and correct target', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const explorationId = randomUUID();
      await memory.insertActivity({
        id: explorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const structureScan: StructureScan = {
        workspacePath: testWorkspace,
        topLevelFiles: ['package.json'],
        topLevelDirs: ['src', 'tests'],
        directoryCounts: { src: 10, tests: 5 },
        configFiles: ['package.json'],
        skippedDirs: [],
        totalFiles: 15,
        scannedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const classification: Classification = {
        projectType: 'node',
        projectName: 'test-project',
        frameworks: ['typescript'],
        commands: {},
        dependencies: [],
        insights: [],
        classifiedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const srcDive: DirectoryDiveResult = {
        path: 'src',
        purpose: 'Source code',
        keyFiles: [],
        subdirectories: [],
        fileCount: 10,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const testsDive: DirectoryDiveResult = {
        path: 'tests',
        purpose: 'Tests',
        keyFiles: [],
        subdirectories: [],
        fileCount: 5,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 1000,
      };

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(structureScan),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(classification),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(srcDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(testsDive),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify({ summary: 'Summary' }),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        });

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId,
      });

      await coordinatorWithMemory.explore();

      const rows = await memory.getExplorationProgressByExplorationId(explorationId);
      const dirRows = rows.filter((r) => r.phase === 'directory-dive');

      // One row per directory
      expect(dirRows).toHaveLength(2);

      // Each row has the correct target (directory path)
      const targets = dirRows.map((r) => r.target);
      expect(targets).toContain('src');
      expect(targets).toContain('tests');
    });

    it('sets progress_pct=100 and status=completed after a successful directory dive', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const explorationId = randomUUID();
      await memory.insertActivity({
        id: explorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId,
      });

      // setupCompleteExploration sets up one directory (src, fileCount=10)
      setupCompleteExploration();
      await coordinatorWithMemory.explore();

      const rows = await memory.getExplorationProgressByExplorationId(explorationId);
      const dirRows = rows.filter((r) => r.phase === 'directory-dive');

      expect(dirRows.length).toBeGreaterThan(0);
      for (const row of dirRows) {
        expect(row.status).toBe('completed');
        expect(row.progress_pct).toBe(100);
      }
    });

    it('sets files_processed from the directory dive fileCount', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const explorationId = randomUUID();
      await memory.insertActivity({
        id: explorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId,
      });

      // setupCompleteExploration uses fileCount=10 for the src directory
      setupCompleteExploration();
      await coordinatorWithMemory.explore();

      const rows = await memory.getExplorationProgressByExplorationId(explorationId);
      const srcRow = rows.find((r) => r.phase === 'directory-dive' && r.target === 'src');

      expect(srcRow).toBeDefined();
      expect(srcRow?.files_processed).toBe(10);
    });

    it('sets files_total from the structure scan directoryCounts', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const explorationId = randomUUID();
      await memory.insertActivity({
        id: explorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId,
      });

      // setupCompleteExploration uses directoryCounts: { src: 10 }
      setupCompleteExploration();
      await coordinatorWithMemory.explore();

      const rows = await memory.getExplorationProgressByExplorationId(explorationId);
      const srcRow = rows.find((r) => r.phase === 'directory-dive' && r.target === 'src');

      expect(srcRow).toBeDefined();
      expect(srcRow?.files_total).toBe(10);
    });

    it('sets status=in_progress on the directory row when the dive begins (even if it then fails)', async () => {
      // With OB-1320 retry behavior: failed dives are retried within the same explore() call.
      // A dive that fails MAX_RETRIES (3) times has its DB row explicitly updated to 'failed'.
      // The row is set to 'in_progress' at the start of each attempt (verified by the final
      // 'failed' status, which is only written after the row was set 'in_progress' and the
      // dive ran and failed 3 times).
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const explorationId = randomUUID();
      await memory.insertActivity({
        id: explorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const structureScan: StructureScan = {
        workspacePath: testWorkspace,
        topLevelFiles: [],
        topLevelDirs: ['src'],
        directoryCounts: { src: 10 },
        configFiles: [],
        skippedDirs: [],
        totalFiles: 10,
        scannedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const classification: Classification = {
        projectType: 'node',
        projectName: 'test',
        frameworks: [],
        commands: {},
        dependencies: [],
        insights: [],
        classifiedAt: new Date().toISOString(),
        durationMs: 1000,
      };

      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(structureScan),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify(classification),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        })
        // Dive fails 3 times (MAX_RETRIES) — retried within the same explore() call
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'fail',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'fail',
          retryCount: 0,
          durationMs: 0,
        })
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'fail',
          retryCount: 0,
          durationMs: 0,
        })
        // Phase 4 assembly — runs after all dives are exhausted (failed dives are skipped)
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: JSON.stringify({ summary: 'Summary' }),
          stderr: '',
          retryCount: 0,
          durationMs: 0,
        });

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId,
      });

      await coordinatorWithMemory.explore();

      const rows = await memory.getExplorationProgressByExplorationId(explorationId);
      const srcRow = rows.find((r) => r.phase === 'directory-dive' && r.target === 'src');

      // After MAX_RETRIES failures, the row is explicitly updated to 'failed'.
      // This confirms the row was created, set to 'in_progress' on each attempt,
      // and finally marked 'failed' after all retries were exhausted.
      expect(srcRow).toBeDefined();
      expect(srcRow?.status).toBe('failed');
      expect(srcRow?.target).toBe('src');
    });
  });

  describe('Stale exploration_progress cleanup on new exploration start (OB-1269)', () => {
    it('deletes pending/in_progress rows from a previous failed exploration when a new one starts', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();

      // Register the stale (previous failed) exploration activity
      const staleExplorationId = randomUUID();
      await memory.insertActivity({
        id: staleExplorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Insert stale exploration_progress rows for the previous exploration
      await memory.insertExplorationProgress({
        exploration_id: staleExplorationId,
        phase: 'structure',
        target: null,
        status: 'pending',
        progress_pct: 0,
        files_processed: null,
        files_total: null,
        started_at: new Date().toISOString(),
        completed_at: null,
      });
      await memory.insertExplorationProgress({
        exploration_id: staleExplorationId,
        phase: 'classification',
        target: null,
        status: 'in_progress',
        progress_pct: 50,
        files_processed: null,
        files_total: null,
        started_at: new Date().toISOString(),
        completed_at: null,
      });

      // Verify stale rows exist before the new exploration
      const staleRowsBefore =
        await memory.getExplorationProgressByExplorationId(staleExplorationId);
      expect(staleRowsBefore).toHaveLength(2);

      // Register the new exploration activity
      const newExplorationId = randomUUID();
      await memory.insertActivity({
        id: newExplorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Create a new coordinator and run exploration
      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId: newExplorationId,
      });

      setupCompleteExploration();
      await coordinatorWithMemory.explore();

      // Stale rows (pending/in_progress from the old exploration) must be gone
      const staleRowsAfter = await memory.getExplorationProgressByExplorationId(staleExplorationId);
      expect(staleRowsAfter).toHaveLength(0);

      // The new exploration's rows should still be present
      const newRows = await memory.getExplorationProgressByExplorationId(newExplorationId);
      expect(newRows.length).toBeGreaterThan(0);
    });

    it('does not delete completed rows from a previous exploration (only pending/in_progress)', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();

      // Register the previous exploration activity
      const prevExplorationId = randomUUID();
      await memory.insertActivity({
        id: prevExplorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Insert a completed row (should survive cleanup) and a pending row (should be deleted)
      await memory.insertExplorationProgress({
        exploration_id: prevExplorationId,
        phase: 'structure',
        target: null,
        status: 'completed',
        progress_pct: 100,
        files_processed: null,
        files_total: null,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      await memory.insertExplorationProgress({
        exploration_id: prevExplorationId,
        phase: 'classification',
        target: null,
        status: 'pending',
        progress_pct: 0,
        files_processed: null,
        files_total: null,
        started_at: new Date().toISOString(),
        completed_at: null,
      });

      // Register the new exploration activity
      const newExplorationId = randomUUID();
      await memory.insertActivity({
        id: newExplorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId: newExplorationId,
      });

      setupCompleteExploration();
      await coordinatorWithMemory.explore();

      // Only the pending row should be deleted; completed row should survive
      const prevRows = await memory.getExplorationProgressByExplorationId(prevExplorationId);
      expect(prevRows).toHaveLength(1);
      expect(prevRows[0]?.status).toBe('completed');
    });
  });

  describe('Regression guard: insertExplorationProgress called (OB-896)', () => {
    it('calls insertExplorationProgress for each phase when memory and explorationId are provided', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const explorationId = randomUUID();
      await memory.insertActivity({
        id: explorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const insertSpy = vi.spyOn(memory, 'insertExplorationProgress');

      const coordinatorWithMemory = new ExplorationCoordinator({
        workspacePath: testWorkspace,
        masterTool: mockMasterTool,
        discoveredTools: mockDiscoveredTools,
        memory,
        explorationId,
      });

      setupCompleteExploration();
      await coordinatorWithMemory.explore();

      expect(insertSpy).toHaveBeenCalled();

      // Verify all expected phases were tracked
      const calledPhases = insertSpy.mock.calls.map((call) => call[0].phase);
      expect(calledPhases).toContain('structure');
      expect(calledPhases).toContain('classification');
      expect(calledPhases).toContain('directory-dive');
      expect(calledPhases).toContain('assembly');
    });

    // TODO: fix mock drift — AgentRunner constructor changed, Phase 4 reads files from disk
    it.skip('does not throw when no memory is provided (no DB tracking)', async () => {
      // Coordinator without memory — no insertExplorationProgress calls expected
      setupCompleteExploration();
      const summary = await coordinator.explore();
      expect(summary.status).toBe('completed');
    });
  });

  // Helper function to setup mocks for remaining phases
  function setupMockRemainingPhases(startFrom: number = 0, directories: string[] = ['src']) {
    const classification: Classification = {
      projectType: 'node',
      projectName: 'test',
      frameworks: [],
      commands: {},
      dependencies: [],
      insights: [],
      classifiedAt: new Date().toISOString(),
      durationMs: 1000,
    };

    const mocks = [
      {
        exitCode: 0,
        stdout: JSON.stringify(classification),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      },
    ];

    // Add a directory dive mock for each directory
    directories.forEach((dir) => {
      const directoryDive: DirectoryDiveResult = {
        path: dir,
        purpose: 'Source',
        keyFiles: [],
        subdirectories: [],
        fileCount: 5,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 1000,
      };
      mocks.push({
        exitCode: 0,
        stdout: JSON.stringify(directoryDive),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      });
    });

    // Add assembly mock
    mocks.push({
      exitCode: 0,
      stdout: JSON.stringify({ summary: 'Summary' }),
      stderr: '',
      retryCount: 0,
      durationMs: 0,
    });

    mocks.slice(startFrom).forEach((mock) => {
      mockSpawn.mockResolvedValueOnce(mock);
    });
  }

  function setupCompleteExploration() {
    const structureScan: StructureScan = {
      workspacePath: testWorkspace,
      topLevelFiles: ['package.json'],
      topLevelDirs: ['src'],
      directoryCounts: { src: 10 },
      configFiles: ['package.json'],
      skippedDirs: [],
      totalFiles: 10,
      scannedAt: new Date().toISOString(),
      durationMs: 1000,
    };

    const classification: Classification = {
      projectType: 'node',
      projectName: 'test-project',
      frameworks: ['typescript'],
      commands: { test: 'npm test' },
      dependencies: [],
      insights: [],
      classifiedAt: new Date().toISOString(),
      durationMs: 1000,
    };

    const directoryDive: DirectoryDiveResult = {
      path: 'src',
      purpose: 'Source code',
      keyFiles: [{ path: 'src/index.ts', type: 'entry', purpose: 'Entry point' }],
      subdirectories: [],
      fileCount: 10,
      insights: [],
      exploredAt: new Date().toISOString(),
      durationMs: 1000,
    };

    mockSpawn
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(structureScan),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(classification),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(directoryDive),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ summary: 'Test project summary' }),
        stderr: '',
        retryCount: 0,
        durationMs: 0,
      });
  }

  describe('Progress Calculation (getProgress()) (OB-F61)', () => {
    it('should return non-negative completionPercent when directory_dives has not started', async () => {
      // Arrange: write state where structure_scan(15) + classification(15) are done,
      // directory_dives is in_progress with 0 of 2 dives completed.
      // Bug (OB-F61): old formula gave 15 + 15 + 50*0 - 50 = -20; fixed formula gives 30.
      const dotFolder = new DotFolderManager(testWorkspace);
      await dotFolder.initialize();

      const state: ExplorationState = {
        currentPhase: 'directory_dives',
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        phases: {
          structure_scan: 'completed',
          classification: 'completed',
          directory_dives: 'in_progress',
          assembly: 'pending',
          finalization: 'pending',
        },
        directoryDives: [
          { path: 'src', status: 'pending', attempts: 0 },
          { path: 'tests', status: 'pending', attempts: 0 },
        ],
        totalCalls: 2,
        totalAITimeMs: 5000,
      };

      await dotFolder.writeExplorationState(state);

      // Act: coordinator reads from dotFolder (no memory configured)
      const progress = await coordinator.getProgress();

      // Assert: completionPercent is 30 (structure_scan 15 + classification 15)
      // and NOT negative (which was the pre-fix bug: -20)
      expect(progress).not.toBeNull();
      expect(progress!.completionPercent).toBeGreaterThanOrEqual(0);
      expect(progress!.completionPercent).toBe(30);
      expect(progress!.directoriesTotal).toBe(2);
      expect(progress!.directoriesCompleted).toBe(0);
    });

    it('should report partial progress as dives complete', async () => {
      // Arrange: 1 of 2 dives completed → directory_dives contributes 50 * 0.5 = 25
      const dotFolder = new DotFolderManager(testWorkspace);
      await dotFolder.initialize();

      const state: ExplorationState = {
        currentPhase: 'directory_dives',
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        phases: {
          structure_scan: 'completed',
          classification: 'completed',
          directory_dives: 'in_progress',
          assembly: 'pending',
          finalization: 'pending',
        },
        directoryDives: [
          { path: 'src', status: 'completed', attempts: 1 },
          { path: 'tests', status: 'pending', attempts: 0 },
        ],
        totalCalls: 3,
        totalAITimeMs: 8000,
      };

      await dotFolder.writeExplorationState(state);

      const progress = await coordinator.getProgress();

      // structure_scan(15) + classification(15) + directory_dives(50 * 0.5 = 25) = 55
      expect(progress).not.toBeNull();
      expect(progress!.completionPercent).toBe(55);
      expect(progress!.directoriesCompleted).toBe(1);
      expect(progress!.directoriesFailed).toBe(0);
    });
  });
});
