import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type {
  AgentsRegistry,
  ExplorationLogEntry,
  LearningEntry,
  LearningsRegistry,
} from '../../src/types/master.js';
import type { ToolProfile, ProfilesRegistry } from '../../src/types/agent.js';

describe('DotFolderManager', () => {
  let testWorkspace: string;
  let manager: DotFolderManager;

  beforeEach(async () => {
    // Create a unique temp workspace outside the project directory to avoid git race conditions
    // when parallel tests interact with .git hook files inside the project repo.
    testWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'openbridge-dfm-test-'));
    manager = new DotFolderManager(testWorkspace);
  });

  afterEach(async () => {
    // Clean up test workspace
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Path Methods', () => {
    it('should return correct .openbridge folder path', () => {
      const expected = path.join(testWorkspace, '.openbridge');
      expect(manager.getDotFolderPath()).toBe(expected);
    });

    it('should return correct workspace-map.json path', () => {
      const expected = path.join(testWorkspace, '.openbridge', 'workspace-map.json');
      expect(manager.getMapPath()).toBe(expected);
    });

    it('should return correct agents.json path', () => {
      const expected = path.join(testWorkspace, '.openbridge', 'agents.json');
      expect(manager.getAgentsPath()).toBe(expected);
    });

    it('should return correct exploration.log path', () => {
      const expected = path.join(testWorkspace, '.openbridge', 'exploration.log');
      expect(manager.getLogPath()).toBe(expected);
    });
  });

  describe('Folder Creation', () => {
    it('should detect that .openbridge folder does not exist initially', async () => {
      const exists = await manager.exists();
      expect(exists).toBe(false);
    });

    it('should create .openbridge folder structure', async () => {
      await manager.createFolder();

      const dotFolderExists = await fs
        .access(manager.getDotFolderPath())
        .then(() => true)
        .catch(() => false);
      const generatedPathExists = await fs
        .access(path.join(manager.getDotFolderPath(), 'generated'))
        .then(() => true)
        .catch(() => false);

      expect(dotFolderExists).toBe(true);
      expect(generatedPathExists).toBe(true);
    });

    it('should detect that .openbridge folder exists after creation', async () => {
      await manager.createFolder();
      const exists = await manager.exists();
      expect(exists).toBe(true);
    });
  });

  describe('Agents Registry Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
    });

    it('should return null when reading non-existent agents registry', async () => {
      const registry = await manager.readAgents();
      expect(registry).toBeNull();
    });

    it('should write and read agents registry', async () => {
      const testRegistry: AgentsRegistry = {
        master: {
          name: 'claude',
          path: '/usr/local/bin/claude',
          version: '1.0.0',
          role: 'master',
        },
        specialists: [
          {
            name: 'codex',
            path: '/usr/local/bin/codex',
            version: '2.0.0',
            role: 'specialist',
            capabilities: ['code-generation', 'refactoring'],
          },
        ],
        updatedAt: new Date().toISOString(),
      };

      await manager.writeAgents(testRegistry);
      const readRegistry = await manager.readAgents();

      expect(readRegistry).toEqual(testRegistry);
    });

    it('should validate agents registry schema before writing', async () => {
      const invalidRegistry = {
        master: { name: 'test' },
        // Missing required fields
      } as unknown as AgentsRegistry;

      await expect(manager.writeAgents(invalidRegistry)).rejects.toThrow();
    });
  });

  describe('Exploration Log Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
    });

    it('appendLog is a no-op — flat-file logging removed (OB-802)', async () => {
      const entry: ExplorationLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test log entry',
        data: { foo: 'bar' },
      };

      // appendLog() no longer writes to disk; logging goes to DB via memory.logExploration()
      await expect(manager.appendLog(entry)).resolves.toBeUndefined();

      // No log file is written
      const logPath = manager.getLogPath();
      const logExists = await fs
        .access(logPath)
        .then(() => true)
        .catch(() => false);
      expect(logExists).toBe(false);
    });

    it('appendLog does not throw for multiple calls (no-op)', async () => {
      const entry1: ExplorationLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'First entry',
      };

      const entry2: ExplorationLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: 'Second entry',
      };

      await manager.appendLog(entry1);
      await manager.appendLog(entry2);

      // No log file is written
      const logPath = manager.getLogPath();
      const logExists = await fs
        .access(logPath)
        .then(() => true)
        .catch(() => false);
      expect(logExists).toBe(false);
    });

    it('appendLog does not throw for any input (no-op, no validation)', async () => {
      const invalidEntry = {
        message: 'Test',
        // Missing required fields
      } as unknown as ExplorationLogEntry;

      // Previously would throw on Zod validation; now it's a no-op
      await expect(manager.appendLog(invalidEntry)).resolves.toBeUndefined();
    });
  });

  describe('Task Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
    });

    it('readAllTasks returns empty array when tasks dir does not exist (OB-813)', async () => {
      // tasks/ directory is no longer created; readAllTasks handles missing dir gracefully
      const tasks = await manager.readAllTasks();
      expect(tasks).toEqual([]);
    });
  });

  describe('Initialize', () => {
    it('should initialize folder if folder does not exist', async () => {
      await manager.initialize();

      const folderExists = await manager.exists();
      expect(folderExists).toBe(true);
    });

    it('should not re-initialize if folder already exists', async () => {
      await manager.createFolder();

      // Write a test file
      const testFile = path.join(manager.getDotFolderPath(), 'existing.txt');
      await fs.writeFile(testFile, 'existing content', 'utf-8');

      // Call initialize again — should not throw or overwrite
      await manager.initialize();

      // File should still exist
      const fileExists = await fs
        .access(testFile)
        .then(() => true)
        .catch(() => false);
      expect(fileExists).toBe(true);
    });
  });

  describe('Exploration State Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
      // Manually create exploration dirs since createExplorationDir() is now a no-op (OB-813)
      await fs.mkdir(path.join(manager.getDotFolderPath(), 'exploration'), { recursive: true });
      await fs.mkdir(path.join(manager.getDotFolderPath(), 'exploration', 'dirs'), {
        recursive: true,
      });
    });

    it('createExplorationDir is a no-op — exploration dirs not created on disk (OB-813)', async () => {
      const freshWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), 'openbridge-nodir-'));
      try {
        const freshManager = new DotFolderManager(freshWorkspace);
        await freshManager.createFolder();
        await freshManager.createExplorationDir();

        const explorationPath = path.join(freshManager.getDotFolderPath(), 'exploration');
        const explorationExists = await fs
          .access(explorationPath)
          .then(() => true)
          .catch(() => false);

        expect(explorationExists).toBe(false);
      } finally {
        await fs.rm(freshWorkspace, { recursive: true, force: true });
      }
    });

    it('should return null when reading non-existent exploration state', async () => {
      const state = await manager.readExplorationState();
      expect(state).toBeNull();
    });

    it('should write and read exploration state', async () => {
      const testState = {
        currentPhase: 'classification' as const,
        status: 'in_progress' as const,
        startedAt: new Date().toISOString(),
        phases: {
          structure_scan: 'completed' as const,
          classification: 'in_progress' as const,
          directory_dives: 'pending' as const,
          assembly: 'pending' as const,
          finalization: 'pending' as const,
        },
        directoryDives: [
          {
            path: 'src',
            status: 'pending' as const,
            attempts: 0,
          },
        ],
        totalCalls: 1,
        totalAITimeMs: 1500,
      };

      await manager.writeExplorationState(testState);
      const readState = await manager.readExplorationState();

      expect(readState).toEqual(testState);
    });

    it('should validate exploration state schema before writing', async () => {
      const invalidState = {
        currentPhase: 'invalid_phase',
        // Missing required fields
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(manager.writeExplorationState(invalidState as any)).rejects.toThrow();
    });
  });

  describe('Structure Scan Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
      await fs.mkdir(path.join(manager.getDotFolderPath(), 'exploration'), { recursive: true });
    });

    it('should return null when reading non-existent structure scan', async () => {
      const scan = await manager.readStructureScan();
      expect(scan).toBeNull();
    });

    it('should write and read structure scan', async () => {
      const testScan = {
        workspacePath: testWorkspace,
        topLevelFiles: ['README.md', 'package.json'],
        topLevelDirs: ['src', 'tests', 'docs'],
        directoryCounts: { src: 42, tests: 18, docs: 5 },
        configFiles: ['package.json', 'tsconfig.json'],
        skippedDirs: ['node_modules', '.git'],
        totalFiles: 65,
        scannedAt: new Date().toISOString(),
        durationMs: 1500,
      };

      await manager.writeStructureScan(testScan);
      const readScan = await manager.readStructureScan();

      expect(readScan).toEqual(testScan);
    });

    it('should validate structure scan schema before writing', async () => {
      const invalidScan = {
        workspacePath: testWorkspace,
        totalFiles: 'not-a-number',
        // Invalid type
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(manager.writeStructureScan(invalidScan as any)).rejects.toThrow();
    });
  });

  describe('Classification Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
      await fs.mkdir(path.join(manager.getDotFolderPath(), 'exploration'), { recursive: true });
    });

    it('should return null when reading non-existent classification', async () => {
      const classification = await manager.readClassification();
      expect(classification).toBeNull();
    });

    it('should write and read classification', async () => {
      const testClassification = {
        projectType: 'node',
        projectName: 'openbridge',
        frameworks: ['typescript', 'vitest', 'node'],
        commands: {
          dev: 'npm run dev',
          test: 'npm test',
          build: 'npm run build',
        },
        dependencies: [
          { name: 'typescript', version: '^5.7.0', type: 'dev' as const },
          { name: 'vitest', version: '^1.0.0', type: 'dev' as const },
        ],
        insights: ['TypeScript strict mode enabled', 'ESM-only project'],
        classifiedAt: new Date().toISOString(),
        durationMs: 2000,
      };

      await manager.writeClassification(testClassification);
      const readClassification = await manager.readClassification();

      expect(readClassification).toEqual(testClassification);
    });

    it('should validate classification schema before writing', async () => {
      const invalidClassification = {
        projectType: 'node',
        // Missing required fields
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(manager.writeClassification(invalidClassification as any)).rejects.toThrow();
    });
  });

  describe('Directory Dive Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
      await fs.mkdir(path.join(manager.getDotFolderPath(), 'exploration', 'dirs'), {
        recursive: true,
      });
    });

    it('should return null when reading non-existent directory dive', async () => {
      const dive = await manager.readDirectoryDive('src');
      expect(dive).toBeNull();
    });

    it('should write and read directory dive', async () => {
      const testDive = {
        path: 'src',
        purpose: 'Application source code — main implementation files',
        keyFiles: [
          { path: 'src/index.ts', type: 'entry', purpose: 'Main entry point' },
          { path: 'src/core/bridge.ts', type: 'core', purpose: 'Bridge orchestrator' },
        ],
        subdirectories: [
          { path: 'src/core', purpose: 'Core bridge engine' },
          { path: 'src/connectors', purpose: 'Messaging platform adapters' },
        ],
        fileCount: 8,
        insights: ['Uses ESM imports throughout', 'Follows plugin architecture pattern'],
        exploredAt: new Date().toISOString(),
        durationMs: 1200,
      };

      await manager.writeDirectoryDive('src', testDive);
      const readDive = await manager.readDirectoryDive('src');

      expect(readDive).toEqual(testDive);
    });

    it('should handle directory names with special characters', async () => {
      const testDive = {
        path: 'src/sub-dir',
        purpose: 'Subdirectory',
        keyFiles: [],
        subdirectories: [],
        fileCount: 5,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 1000,
      };

      await manager.writeDirectoryDive('src-sub-dir', testDive);
      const readDive = await manager.readDirectoryDive('src-sub-dir');

      expect(readDive).toEqual(testDive);
    });

    it('should validate directory dive schema before writing', async () => {
      const invalidDive = {
        path: 'src',
        fileCount: 'not-a-number',
        // Invalid type
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(manager.writeDirectoryDive('src', invalidDive as any)).rejects.toThrow();
    });

    it('should write multiple directory dives independently', async () => {
      const dive1 = {
        path: 'src',
        purpose: 'Source code',
        keyFiles: [],
        subdirectories: [],
        fileCount: 10,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 1000,
      };

      const dive2 = {
        path: 'tests',
        purpose: 'Test suite',
        keyFiles: [],
        subdirectories: [],
        fileCount: 5,
        insights: [],
        exploredAt: new Date().toISOString(),
        durationMs: 800,
      };

      await manager.writeDirectoryDive('src', dive1);
      await manager.writeDirectoryDive('tests', dive2);

      const readDive1 = await manager.readDirectoryDive('src');
      const readDive2 = await manager.readDirectoryDive('tests');

      expect(readDive1).toEqual(dive1);
      expect(readDive2).toEqual(dive2);
    });
  });

  describe('Profile Registry Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
    });

    it('should return correct profiles.json path', () => {
      const expected = path.join(testWorkspace, '.openbridge', 'profiles.json');
      expect(manager.getProfilesPath()).toBe(expected);
    });

    it('should return null when reading non-existent profiles', async () => {
      const registry = await manager.readProfiles();
      expect(registry).toBeNull();
    });

    it('should write and read profiles registry', async () => {
      const testRegistry: ProfilesRegistry = {
        profiles: {
          'test-runner': {
            name: 'test-runner',
            description: 'Run tests only',
            tools: ['Read', 'Glob', 'Grep', 'Bash(npm:test)'],
          },
        },
        updatedAt: new Date().toISOString(),
      };

      await manager.writeProfiles(testRegistry);
      const readRegistry = await manager.readProfiles();

      expect(readRegistry).toEqual(testRegistry);
    });

    it('should validate profiles registry schema before writing', async () => {
      const invalidRegistry = {
        profiles: 'not-an-object',
      } as unknown as ProfilesRegistry;

      await expect(manager.writeProfiles(invalidRegistry)).rejects.toThrow();
    });

    it('should return null for corrupted profiles file', async () => {
      const profilesPath = manager.getProfilesPath();
      await fs.writeFile(profilesPath, 'invalid json {{{', 'utf-8');

      const registry = await manager.readProfiles();
      expect(registry).toBeNull();
    });

    it('should add a profile to an empty registry', async () => {
      const profile: ToolProfile = {
        name: 'test-runner',
        description: 'Run tests only',
        tools: ['Read', 'Glob', 'Grep', 'Bash(npm:test)'],
      };

      await manager.addProfile(profile);
      const registry = await manager.readProfiles();

      expect(registry).not.toBeNull();
      expect(registry!.profiles['test-runner']).toEqual(profile);
      expect(registry!.updatedAt).toBeDefined();
    });

    it('should add multiple profiles', async () => {
      const profile1: ToolProfile = {
        name: 'test-runner',
        tools: ['Read', 'Glob', 'Grep', 'Bash(npm:test)'],
      };

      const profile2: ToolProfile = {
        name: 'doc-writer',
        description: 'Write documentation',
        tools: ['Read', 'Write', 'Glob', 'Grep'],
      };

      await manager.addProfile(profile1);
      await manager.addProfile(profile2);

      const registry = await manager.readProfiles();
      expect(Object.keys(registry!.profiles)).toHaveLength(2);
      expect(registry!.profiles['test-runner']).toEqual(profile1);
      expect(registry!.profiles['doc-writer']).toEqual(profile2);
    });

    it('should overwrite existing profile with same name', async () => {
      const original: ToolProfile = {
        name: 'test-runner',
        tools: ['Read', 'Glob'],
      };

      const updated: ToolProfile = {
        name: 'test-runner',
        description: 'Updated profile',
        tools: ['Read', 'Glob', 'Grep', 'Bash(npm:test)'],
      };

      await manager.addProfile(original);
      await manager.addProfile(updated);

      const registry = await manager.readProfiles();
      expect(Object.keys(registry!.profiles)).toHaveLength(1);
      expect(registry!.profiles['test-runner']).toEqual(updated);
    });

    it('should validate profile before adding', async () => {
      const invalidProfile = {
        name: '',
        tools: [],
      } as unknown as ToolProfile;

      await expect(manager.addProfile(invalidProfile)).rejects.toThrow();
    });

    it('should remove an existing profile', async () => {
      await manager.addProfile({
        name: 'test-runner',
        tools: ['Read', 'Glob', 'Grep'],
      });

      const removed = await manager.removeProfile('test-runner');
      expect(removed).toBe(true);

      const registry = await manager.readProfiles();
      expect(registry!.profiles['test-runner']).toBeUndefined();
      expect(Object.keys(registry!.profiles)).toHaveLength(0);
    });

    it('should return false when removing non-existent profile', async () => {
      const removed = await manager.removeProfile('nonexistent');
      expect(removed).toBe(false);
    });

    it('should return false when removing from empty registry', async () => {
      await manager.writeProfiles({
        profiles: {},
        updatedAt: new Date().toISOString(),
      });

      const removed = await manager.removeProfile('test-runner');
      expect(removed).toBe(false);
    });

    it('should get a single profile by name', async () => {
      const profile: ToolProfile = {
        name: 'test-runner',
        tools: ['Read', 'Glob', 'Grep', 'Bash(npm:test)'],
      };

      await manager.addProfile(profile);
      const result = await manager.getProfile('test-runner');

      expect(result).toEqual(profile);
    });

    it('should return null for non-existent profile name', async () => {
      const result = await manager.getProfile('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null for profile lookup when no registry exists', async () => {
      const result = await manager.getProfile('test-runner');
      expect(result).toBeNull();
    });
  });

  describe('Learnings Store (OB-171)', () => {
    beforeEach(async () => {
      await manager.createFolder();
    });

    it('should return null when learnings.json does not exist', async () => {
      const result = await manager.readLearnings();
      expect(result).toBeNull();
    });

    it('should write and read learnings registry', async () => {
      const registry: LearningsRegistry = {
        entries: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        schemaVersion: '1.0.0',
      };

      await manager.writeLearnings(registry);
      const result = await manager.readLearnings();

      expect(result).toBeDefined();
      expect(result?.entries).toEqual([]);
      expect(result?.schemaVersion).toBe('1.0.0');
    });

    it('should append a learning entry to registry', async () => {
      const entry: LearningEntry = {
        id: 'learning-001',
        taskType: 'refactoring',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 5000,
        notes: 'Worker completed successfully',
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      await manager.appendLearning(entry);
      const result = await manager.readLearnings();

      expect(result).toBeDefined();
      expect(result?.entries).toHaveLength(1);
      expect(result?.entries[0]).toMatchObject({
        id: 'learning-001',
        taskType: 'refactoring',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: true,
      });
    });

    it('should append multiple learning entries in order', async () => {
      const entry1: LearningEntry = {
        id: 'learning-001',
        taskType: 'feature',
        modelUsed: 'sonnet',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 8000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      const entry2: LearningEntry = {
        id: 'learning-002',
        taskType: 'bug-fix',
        modelUsed: 'haiku',
        profileUsed: 'read-only',
        success: false,
        durationMs: 2000,
        notes: 'Worker failed: exit code 1',
        recordedAt: new Date().toISOString(),
        exitCode: 1,
        retryCount: 2,
        metadata: {},
      };

      await manager.appendLearning(entry1);
      await manager.appendLearning(entry2);

      const result = await manager.readLearnings();

      expect(result?.entries).toHaveLength(2);
      expect(result?.entries[0]?.id).toBe('learning-001');
      expect(result?.entries[1]?.id).toBe('learning-002');
    });

    it('should create learnings.json if it does not exist on first append', async () => {
      const entry: LearningEntry = {
        id: 'learning-first',
        taskType: 'exploration',
        modelUsed: 'haiku',
        profileUsed: 'read-only',
        success: true,
        durationMs: 3000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      await manager.appendLearning(entry);

      const exists = await fs
        .access(manager.getLearningsPath())
        .then(() => true)
        .catch(() => false);

      expect(exists).toBe(true);
    });

    it('should get learnings by task type', async () => {
      const refactoringEntry: LearningEntry = {
        id: 'learning-001',
        taskType: 'refactoring',
        modelUsed: 'sonnet',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 10000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      const bugFixEntry: LearningEntry = {
        id: 'learning-002',
        taskType: 'bug-fix',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 3000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      await manager.appendLearning(refactoringEntry);
      await manager.appendLearning(bugFixEntry);
      await manager.appendLearning({ ...refactoringEntry, id: 'learning-003' });

      const refactoringResults = await manager.getLearningsByTaskType('refactoring');
      const bugFixResults = await manager.getLearningsByTaskType('bug-fix');

      expect(refactoringResults).toHaveLength(2);
      expect(bugFixResults).toHaveLength(1);
    });

    it('should get learnings by model', async () => {
      const haikuEntry: LearningEntry = {
        id: 'learning-001',
        taskType: 'feature',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 5000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      const sonnetEntry: LearningEntry = {
        id: 'learning-002',
        taskType: 'refactoring',
        modelUsed: 'sonnet',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 8000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      await manager.appendLearning(haikuEntry);
      await manager.appendLearning(sonnetEntry);
      await manager.appendLearning({ ...haikuEntry, id: 'learning-003' });

      const haikuResults = await manager.getLearningsByModel('haiku');
      const sonnetResults = await manager.getLearningsByModel('sonnet');

      expect(haikuResults).toHaveLength(2);
      expect(sonnetResults).toHaveLength(1);
    });

    it('should get learnings by profile', async () => {
      const readOnlyEntry: LearningEntry = {
        id: 'learning-001',
        taskType: 'exploration',
        modelUsed: 'haiku',
        profileUsed: 'read-only',
        success: true,
        durationMs: 2000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      const codeEditEntry: LearningEntry = {
        id: 'learning-002',
        taskType: 'feature',
        modelUsed: 'sonnet',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 7000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      await manager.appendLearning(readOnlyEntry);
      await manager.appendLearning(codeEditEntry);
      await manager.appendLearning({ ...readOnlyEntry, id: 'learning-003' });

      const readOnlyResults = await manager.getLearningsByProfile('read-only');
      const codeEditResults = await manager.getLearningsByProfile('code-edit');

      expect(readOnlyResults).toHaveLength(2);
      expect(codeEditResults).toHaveLength(1);
    });

    it('should get failed learnings only', async () => {
      const successEntry: LearningEntry = {
        id: 'learning-001',
        taskType: 'feature',
        modelUsed: 'sonnet',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 5000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      const failureEntry1: LearningEntry = {
        id: 'learning-002',
        taskType: 'refactoring',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: false,
        durationMs: 2000,
        notes: 'Worker failed: timeout',
        recordedAt: new Date().toISOString(),
        exitCode: 143,
        retryCount: 1,
        metadata: {},
      };

      const failureEntry2: LearningEntry = {
        id: 'learning-003',
        taskType: 'bug-fix',
        modelUsed: 'sonnet',
        profileUsed: 'code-edit',
        success: false,
        durationMs: 3000,
        notes: 'Worker failed: error',
        recordedAt: new Date().toISOString(),
        exitCode: 1,
        retryCount: 3,
        metadata: {},
      };

      await manager.appendLearning(successEntry);
      await manager.appendLearning(failureEntry1);
      await manager.appendLearning(failureEntry2);

      const failedResults = await manager.getFailedLearnings();

      expect(failedResults).toHaveLength(2);
      expect(failedResults.every((e) => !e.success)).toBe(true);
    });

    it('should calculate task type statistics correctly', async () => {
      const entry1: LearningEntry = {
        id: 'learning-001',
        taskType: 'refactoring',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 5000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      const entry2: LearningEntry = {
        id: 'learning-002',
        taskType: 'refactoring',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: false,
        durationMs: 3000,
        recordedAt: new Date().toISOString(),
        exitCode: 1,
        retryCount: 2,
        metadata: {},
      };

      const entry3: LearningEntry = {
        id: 'learning-003',
        taskType: 'refactoring',
        modelUsed: 'sonnet',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 7000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 1,
        metadata: {},
      };

      await manager.appendLearning(entry1);
      await manager.appendLearning(entry2);
      await manager.appendLearning(entry3);

      const stats = await manager.getTaskTypeStats('refactoring');

      expect(stats).toBeDefined();
      expect(stats?.totalCount).toBe(3);
      expect(stats?.successCount).toBe(2);
      expect(stats?.failureCount).toBe(1);
      expect(stats?.successRate).toBeCloseTo(0.6667, 2);
      expect(stats?.avgDurationMs).toBeCloseTo(5000, 0);
      expect(stats?.avgRetryCount).toBeCloseTo(1, 0);
    });

    it('should return null for task type stats when no entries exist', async () => {
      const stats = await manager.getTaskTypeStats('nonexistent');
      expect(stats).toBeNull();
    });

    it('should calculate model statistics correctly', async () => {
      const entry1: LearningEntry = {
        id: 'learning-001',
        taskType: 'feature',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 4000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      const entry2: LearningEntry = {
        id: 'learning-002',
        taskType: 'bug-fix',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 6000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 1,
        metadata: {},
      };

      await manager.appendLearning(entry1);
      await manager.appendLearning(entry2);

      const stats = await manager.getModelStats('haiku');

      expect(stats).toBeDefined();
      expect(stats?.totalCount).toBe(2);
      expect(stats?.successCount).toBe(2);
      expect(stats?.failureCount).toBe(0);
      expect(stats?.successRate).toBe(1.0);
      expect(stats?.avgDurationMs).toBe(5000);
      expect(stats?.avgRetryCount).toBe(0.5);
    });

    it('should return null for model stats when no entries exist', async () => {
      const stats = await manager.getModelStats('nonexistent');
      expect(stats).toBeNull();
    });

    it('should return empty array when filtering by task type with no matches', async () => {
      const entry: LearningEntry = {
        id: 'learning-001',
        taskType: 'feature',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 5000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      await manager.appendLearning(entry);

      const results = await manager.getLearningsByTaskType('refactoring');
      expect(results).toEqual([]);
    });

    it('should return empty array when getting failed learnings with no failures', async () => {
      const entry: LearningEntry = {
        id: 'learning-001',
        taskType: 'feature',
        modelUsed: 'haiku',
        profileUsed: 'code-edit',
        success: true,
        durationMs: 5000,
        recordedAt: new Date().toISOString(),
        exitCode: 0,
        retryCount: 0,
        metadata: {},
      };

      await manager.appendLearning(entry);

      const results = await manager.getFailedLearnings();
      expect(results).toEqual([]);
    });

    it('should return empty arrays for all query methods when no registry exists', async () => {
      const taskTypeResults = await manager.getLearningsByTaskType('refactoring');
      const modelResults = await manager.getLearningsByModel('haiku');
      const profileResults = await manager.getLearningsByProfile('code-edit');
      const failedResults = await manager.getFailedLearnings();

      expect(taskTypeResults).toEqual([]);
      expect(modelResults).toEqual([]);
      expect(profileResults).toEqual([]);
      expect(failedResults).toEqual([]);
    });
  });
});
