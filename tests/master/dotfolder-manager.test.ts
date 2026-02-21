import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  WorkspaceMap,
  AgentsRegistry,
  ExplorationLogEntry,
  TaskRecord,
} from '../../src/types/master.js';
import type { ToolProfile, ProfilesRegistry } from '../../src/types/agent.js';

const execAsync = promisify(exec);

describe('DotFolderManager', () => {
  let testWorkspace: string;
  let manager: DotFolderManager;

  beforeEach(async () => {
    // Create a temporary test workspace
    testWorkspace = path.join(process.cwd(), 'test-workspace-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });
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
      const tasksPathExists = await fs
        .access(path.join(manager.getDotFolderPath(), 'tasks'))
        .then(() => true)
        .catch(() => false);

      expect(dotFolderExists).toBe(true);
      expect(tasksPathExists).toBe(true);
    });

    it('should detect that .openbridge folder exists after creation', async () => {
      await manager.createFolder();
      const exists = await manager.exists();
      expect(exists).toBe(true);
    });
  });

  describe('Git Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
    });

    it('should initialize git repository', async () => {
      await manager.initGit();

      const gitPath = path.join(manager.getDotFolderPath(), '.git');
      const gitExists = await fs
        .access(gitPath)
        .then(() => true)
        .catch(() => false);

      expect(gitExists).toBe(true);
    });

    it('should create .gitignore file during git init', async () => {
      await manager.initGit();

      const gitignorePath = path.join(manager.getDotFolderPath(), '.gitignore');
      const content = await fs.readFile(gitignorePath, 'utf-8');

      expect(content).toContain('node_modules/');
      expect(content).toContain('.DS_Store');
    });

    it('should not re-initialize git if already initialized', async () => {
      await manager.initGit();

      // Write a test file and commit it
      const testFile = path.join(manager.getDotFolderPath(), 'test.txt');
      await fs.writeFile(testFile, 'test', 'utf-8');
      await manager.commitChanges('Add test file');

      // Get commit count
      const { stdout: beforeCount } = await execAsync('git rev-list --count HEAD', {
        cwd: manager.getDotFolderPath(),
      });

      // Try to init again
      await manager.initGit();

      // Commit count should be unchanged
      const { stdout: afterCount } = await execAsync('git rev-list --count HEAD', {
        cwd: manager.getDotFolderPath(),
      });
      expect(afterCount.trim()).toBe(beforeCount.trim());
    });

    it('should commit changes with message', async () => {
      await manager.initGit();

      // Write a test file
      const testFile = path.join(manager.getDotFolderPath(), 'test.txt');
      await fs.writeFile(testFile, 'test content', 'utf-8');

      await manager.commitChanges('Test commit message');

      // Verify commit exists
      const { stdout } = await execAsync('git log --oneline -1', {
        cwd: manager.getDotFolderPath(),
      });
      expect(stdout).toContain('Test commit message');
    });

    it('should not commit if there are no changes', async () => {
      await manager.initGit();

      // Get initial commit count
      const { stdout: beforeCount } = await execAsync('git rev-list --count HEAD', {
        cwd: manager.getDotFolderPath(),
      });

      // Try to commit with no changes
      await manager.commitChanges('No changes');

      // Commit count should be unchanged
      const { stdout: afterCount } = await execAsync('git rev-list --count HEAD', {
        cwd: manager.getDotFolderPath(),
      });
      expect(afterCount.trim()).toBe(beforeCount.trim());
    });

    it('should handle git user config errors gracefully', async () => {
      await manager.initGit();

      // Unset git user config in the test repo
      await execAsync('git config --unset user.email', { cwd: manager.getDotFolderPath() }).catch(
        () => {},
      );
      await execAsync('git config --unset user.name', { cwd: manager.getDotFolderPath() }).catch(
        () => {},
      );

      // Write a test file
      const testFile = path.join(manager.getDotFolderPath(), 'test.txt');
      await fs.writeFile(testFile, 'test', 'utf-8');

      // Should auto-configure and succeed
      await expect(manager.commitChanges('Auto-config test')).resolves.toBeUndefined();

      // Verify commit exists
      const { stdout } = await execAsync('git log --oneline -1', {
        cwd: manager.getDotFolderPath(),
      });
      expect(stdout).toContain('Auto-config test');
    });
  });

  describe('Workspace Map Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
    });

    it('should return null when reading non-existent workspace map', async () => {
      const map = await manager.readMap();
      expect(map).toBeNull();
    });

    it('should write and read workspace map', async () => {
      const testMap: WorkspaceMap = {
        workspacePath: testWorkspace,
        projectName: 'test-project',
        projectType: 'node',
        frameworks: ['typescript', 'vitest'],
        structure: {
          src: { path: 'src/', purpose: 'Source code', fileCount: 10 },
        },
        keyFiles: [{ path: 'package.json', type: 'config', purpose: 'Node.js config' }],
        entryPoints: ['src/index.ts'],
        commands: { test: 'npm test', build: 'npm run build' },
        dependencies: [{ name: 'vitest', version: '^1.0.0', type: 'dev' }],
        summary: 'Test workspace for unit tests',
        generatedAt: new Date().toISOString(),
        schemaVersion: '1.0.0',
      };

      await manager.writeMap(testMap);
      const readMap = await manager.readMap();

      expect(readMap).toEqual(testMap);
    });

    it('should validate workspace map schema before writing', async () => {
      const invalidMap = {
        projectName: 'test',
        // Missing required fields
      } as unknown as WorkspaceMap;

      await expect(manager.writeMap(invalidMap)).rejects.toThrow();
    });

    it('should return null for corrupted workspace map file', async () => {
      const mapPath = manager.getMapPath();
      await fs.writeFile(mapPath, 'invalid json {{{', 'utf-8');

      const map = await manager.readMap();
      expect(map).toBeNull();
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

    it('should return empty array when reading non-existent log', async () => {
      const entries = await manager.readLog();
      expect(entries).toEqual([]);
    });

    it('should append log entry', async () => {
      const entry: ExplorationLogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Test log entry',
        data: { foo: 'bar' },
      };

      await manager.appendLog(entry);

      const entries = await manager.readLog();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toEqual(entry);
    });

    it('should append multiple log entries in order', async () => {
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

      const entries = await manager.readLog();
      expect(entries).toHaveLength(2);
      expect(entries[0]?.message).toBe('First entry');
      expect(entries[1]?.message).toBe('Second entry');
    });

    it('should validate log entry schema before appending', async () => {
      const invalidEntry = {
        message: 'Test',
        // Missing required fields
      } as unknown as ExplorationLogEntry;

      await expect(manager.appendLog(invalidEntry)).rejects.toThrow();
    });

    it('should handle corrupted log file gracefully', async () => {
      const logPath = manager.getLogPath();
      await fs.writeFile(logPath, 'invalid json\n{broken', 'utf-8');

      const entries = await manager.readLog();
      expect(entries).toEqual([]);
    });
  });

  describe('Task Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
      await manager.initGit();
    });

    it('should return null when reading non-existent task', async () => {
      const task = await manager.readTask('nonexistent-id');
      expect(task).toBeNull();
    });

    it('should record and read task', async () => {
      const testTask: TaskRecord = {
        id: 'task-123',
        userMessage: '/ai test command',
        sender: '+1234567890',
        description: 'Test task',
        status: 'completed',
        handledBy: 'master',
        result: 'Task completed successfully',
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 1000,
        metadata: { source: 'whatsapp' },
      };

      await manager.recordTask(testTask);
      const readTask = await manager.readTask('task-123');

      expect(readTask).toEqual(testTask);
    });

    it('should read all tasks', async () => {
      const task1: TaskRecord = {
        id: 'task-1',
        userMessage: '/ai task 1',
        sender: '+1234567890',
        description: 'Task 1',
        status: 'completed',
        handledBy: 'master',
        createdAt: new Date().toISOString(),
      };

      const task2: TaskRecord = {
        id: 'task-2',
        userMessage: '/ai task 2',
        sender: '+1234567890',
        description: 'Task 2',
        status: 'processing',
        handledBy: 'master',
        createdAt: new Date().toISOString(),
      };

      await manager.recordTask(task1);
      await manager.recordTask(task2);

      const tasks = await manager.readAllTasks();
      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.id).sort()).toEqual(['task-1', 'task-2']);
    });

    it('should return empty array when tasks folder is empty', async () => {
      const tasks = await manager.readAllTasks();
      expect(tasks).toEqual([]);
    });

    it('should validate task schema before recording', async () => {
      const invalidTask = {
        id: 'test',
        // Missing required fields
      } as unknown as TaskRecord;

      await expect(manager.recordTask(invalidTask)).rejects.toThrow();
    });

    it('should commit task to git after recording', async () => {
      await manager.initGit();

      const testTask: TaskRecord = {
        id: 'task-git-test',
        userMessage: '/ai git commit test',
        sender: '+1234567890',
        description: 'Test task for git commit',
        status: 'completed',
        handledBy: 'master',
        createdAt: new Date().toISOString(),
      };

      await manager.recordTask(testTask);

      // Verify git commit was created
      const { stdout } = await execAsync('git log --oneline -1', {
        cwd: manager.getDotFolderPath(),
      });
      expect(stdout).toContain('chore(master): record task task-git-test - completed');
    });

    it('should use consistent commit message format', async () => {
      await manager.initGit();

      const testTask: TaskRecord = {
        id: 'task-123',
        userMessage: '/ai test message',
        sender: '+1234567890',
        description: 'Test task description',
        status: 'processing',
        handledBy: 'master',
        createdAt: new Date().toISOString(),
      };

      await manager.recordTask(testTask);

      // Verify commit message follows conventional commit format
      const { stdout } = await execAsync('git log --oneline -1', {
        cwd: manager.getDotFolderPath(),
      });
      expect(stdout).toContain('chore(master): record task task-123 - processing');
    });

    it('should update task file and commit when recording with same ID', async () => {
      await manager.initGit();

      const initialTask: TaskRecord = {
        id: 'task-update',
        userMessage: '/ai update test',
        sender: '+1234567890',
        description: 'Initial task state',
        status: 'pending',
        handledBy: 'master',
        createdAt: new Date().toISOString(),
      };

      await manager.recordTask(initialTask);

      // Get initial commit count
      const { stdout: beforeCount } = await execAsync('git rev-list --count HEAD', {
        cwd: manager.getDotFolderPath(),
      });

      // Update the task
      const updatedTask: TaskRecord = {
        ...initialTask,
        status: 'completed',
        description: 'Updated task state',
        completedAt: new Date().toISOString(),
      };

      await manager.recordTask(updatedTask);

      // Verify a new commit was created
      const { stdout: afterCount } = await execAsync('git rev-list --count HEAD', {
        cwd: manager.getDotFolderPath(),
      });
      expect(parseInt(afterCount.trim())).toBe(parseInt(beforeCount.trim()) + 1);

      // Verify the latest commit message reflects the update
      const { stdout } = await execAsync('git log --oneline -1', {
        cwd: manager.getDotFolderPath(),
      });
      expect(stdout).toContain('chore(master): record task task-update - completed');
    });
  });

  describe('Initialize', () => {
    it('should initialize folder and git if folder does not exist', async () => {
      await manager.initialize();

      const folderExists = await manager.exists();
      expect(folderExists).toBe(true);

      const gitPath = path.join(manager.getDotFolderPath(), '.git');
      const gitExists = await fs
        .access(gitPath)
        .then(() => true)
        .catch(() => false);
      expect(gitExists).toBe(true);
    });

    it('should not re-initialize if folder already exists', async () => {
      await manager.createFolder();
      await manager.initGit();

      // Write a test file and commit
      const testFile = path.join(manager.getDotFolderPath(), 'existing.txt');
      await fs.writeFile(testFile, 'existing content', 'utf-8');
      await manager.commitChanges('Existing commit');

      const { stdout: beforeCount } = await execAsync('git rev-list --count HEAD', {
        cwd: manager.getDotFolderPath(),
      });

      // Call initialize again
      await manager.initialize();

      // Commit count should be unchanged
      const { stdout: afterCount } = await execAsync('git rev-list --count HEAD', {
        cwd: manager.getDotFolderPath(),
      });
      expect(afterCount.trim()).toBe(beforeCount.trim());
    });
  });

  describe('Exploration State Operations', () => {
    beforeEach(async () => {
      await manager.createFolder();
      await manager.createExplorationDir();
    });

    it('should create exploration directory', async () => {
      const explorationPath = path.join(manager.getDotFolderPath(), 'exploration');
      const dirsPath = path.join(explorationPath, 'dirs');

      const explorationExists = await fs
        .access(explorationPath)
        .then(() => true)
        .catch(() => false);
      const dirsExists = await fs
        .access(dirsPath)
        .then(() => true)
        .catch(() => false);

      expect(explorationExists).toBe(true);
      expect(dirsExists).toBe(true);
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
      await manager.createExplorationDir();
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
      await manager.createExplorationDir();
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
      await manager.createExplorationDir();
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
});
