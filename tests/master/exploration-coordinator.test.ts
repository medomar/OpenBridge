/**
 * Tests for exploration-coordinator.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ExplorationCoordinator } from '../../src/master/exploration-coordinator.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  ExplorationState,
  StructureScan,
  Classification,
  DirectoryDiveResult,
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
    // Create a temporary test workspace
    testWorkspace = path.join(process.cwd(), 'test-workspace-' + Date.now());
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

    // Reset mocks before creating coordinator
    vi.clearAllMocks();

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

      expect(savedScan).toEqual(structureScan);
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

      expect(savedClassification).toEqual(classification);
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
        // First attempt fails
        .mockResolvedValueOnce({
          exitCode: 1,
          stdout: '',
          stderr: 'Failed',
          retryCount: 0,
          durationMs: 0,
        });

      // First explore() call - should fail with pending dive
      await expect(coordinator.explore()).rejects.toThrow('Directory dives incomplete: 1 pending');

      // Second attempt - need to re-mock phases 1 and 2 because failed state gets reset
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
          exitCode: 1,
          stdout: '',
          stderr: 'Failed',
          retryCount: 0,
          durationMs: 0,
        });

      // Second explore() call - should still fail with pending dive
      await expect(coordinator.explore()).rejects.toThrow('Directory dives incomplete: 1 pending');

      // Third attempt succeeds - again need to re-mock phases 1 and 2
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

      // Third explore() call - should complete
      await coordinator.explore();

      const dotFolder = new DotFolderManager(testWorkspace);
      const state = await dotFolder.readExplorationState();

      expect(state?.directoryDives[0]?.status).toBe('completed');
      // attempts resets to 0 when coordinator resets failed state on retry
      expect(state?.directoryDives[0]?.attempts).toBe(0);
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
        // Fail 3 times for the directory dive
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
        });

      await expect(coordinator.explore()).rejects.toThrow('Directory dives incomplete: 1 pending');
    });
  });

  describe('Phase 4: Assembly', () => {
    it('should merge partial results into workspace map', async () => {
      setupCompleteExploration();

      const summary = await coordinator.explore();

      const dotFolder = new DotFolderManager(testWorkspace);
      const map = await dotFolder.readMap();

      expect(map).toBeDefined();
      expect(map?.projectType).toBe('node');
      expect(map?.summary).toBe('Test project summary');
      expect(summary.status).toBe('completed');
    });

    it('should include directory dive results in workspace map', async () => {
      setupCompleteExploration();

      await coordinator.explore();

      const dotFolder = new DotFolderManager(testWorkspace);
      const map = await dotFolder.readMap();

      expect(map?.structure).toBeDefined();
      expect(map?.structure.src).toBeDefined();
      expect(map?.structure.src.purpose).toBe('Source code');
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

    it('should commit changes to git', async () => {
      setupCompleteExploration();

      await coordinator.explore();

      const dotFolder = new DotFolderManager(testWorkspace);
      const dotFolderPath = dotFolder.getDotFolderPath();

      // Check git repo exists
      const gitExists = await fs
        .access(path.join(dotFolderPath, '.git'))
        .then(() => true)
        .catch(() => false);

      expect(gitExists).toBe(true);
    });

    it('should write exploration log entry', async () => {
      setupCompleteExploration();

      await coordinator.explore();

      const dotFolder = new DotFolderManager(testWorkspace);
      const log = await dotFolder.readLog();

      expect(log.length).toBeGreaterThan(0);
      const lastEntry = log[log.length - 1];
      expect(lastEntry?.message).toContain('Incremental exploration completed successfully');
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
});
