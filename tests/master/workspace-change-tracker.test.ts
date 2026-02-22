import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceChangeTracker } from '../../src/master/workspace-change-tracker.js';
import type { WorkspaceAnalysisMarker } from '../../src/types/master.js';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

describe('WorkspaceChangeTracker', () => {
  let testWorkspace: string;
  let tracker: WorkspaceChangeTracker;

  beforeEach(async () => {
    // Use /tmp to avoid being inside the project's git repo
    testWorkspace = path.join(
      os.tmpdir(),
      'test-ws-tracker-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    );
    await fs.mkdir(testWorkspace, { recursive: true });
    tracker = new WorkspaceChangeTracker(testWorkspace);
  });

  afterEach(async () => {
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('hasGitRepo', () => {
    it('should return false for non-git directory', async () => {
      expect(await tracker.hasGitRepo()).toBe(false);
    });

    it('should return true for git directory', async () => {
      await execAsync('git init', { cwd: testWorkspace });
      expect(await tracker.hasGitRepo()).toBe(true);
    });
  });

  describe('getHeadCommitHash', () => {
    it('should return null for non-git directory', async () => {
      expect(await tracker.getHeadCommitHash()).toBeNull();
    });

    it('should return commit hash for git repo with commits', async () => {
      await execAsync('git init', { cwd: testWorkspace });
      await execAsync('git config user.email "test@test.com"', { cwd: testWorkspace });
      await execAsync('git config user.name "Test"', { cwd: testWorkspace });
      await fs.writeFile(path.join(testWorkspace, 'file.txt'), 'hello');
      await execAsync('git add -A && git commit -m "init"', { cwd: testWorkspace });

      const hash = await tracker.getHeadCommitHash();
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe('getCurrentBranch', () => {
    it('should return null for non-git directory', async () => {
      expect(await tracker.getCurrentBranch()).toBeNull();
    });

    it('should return branch name for git repo', async () => {
      await execAsync('git init -b main', { cwd: testWorkspace });
      await execAsync('git config user.email "test@test.com"', { cwd: testWorkspace });
      await execAsync('git config user.name "Test"', { cwd: testWorkspace });
      await fs.writeFile(path.join(testWorkspace, 'file.txt'), 'hello');
      await execAsync('git add -A && git commit -m "init"', { cwd: testWorkspace });

      expect(await tracker.getCurrentBranch()).toBe('main');
    });
  });

  describe('detectChanges', () => {
    it('should return tooLargeForIncremental when no marker exists', async () => {
      const result = await tracker.detectChanges(null);
      expect(result.hasChanges).toBe(true);
      expect(result.method).toBe('no-marker');
      expect(result.tooLargeForIncremental).toBe(true);
    });

    it('should detect no changes when git commit matches marker', async () => {
      await execAsync('git init -b main', { cwd: testWorkspace });
      await execAsync('git config user.email "test@test.com"', { cwd: testWorkspace });
      await execAsync('git config user.name "Test"', { cwd: testWorkspace });
      await fs.writeFile(path.join(testWorkspace, 'file.txt'), 'hello');
      await execAsync('git add -A && git commit -m "init"', { cwd: testWorkspace });

      const hash = await tracker.getHeadCommitHash();
      const marker: WorkspaceAnalysisMarker = {
        workspaceCommitHash: hash!,
        workspaceBranch: 'main',
        workspaceHasGit: true,
        analyzedAt: new Date().toISOString(),
        analysisType: 'full',
        filesChanged: 0,
        schemaVersion: '1.0.0',
      };

      const result = await tracker.detectChanges(marker);
      expect(result.hasChanges).toBe(false);
      expect(result.method).toBe('git-diff');
      expect(result.changedFiles).toEqual([]);
      expect(result.deletedFiles).toEqual([]);
    });

    it('should detect committed changes since marker', async () => {
      await execAsync('git init -b main', { cwd: testWorkspace });
      await execAsync('git config user.email "test@test.com"', { cwd: testWorkspace });
      await execAsync('git config user.name "Test"', { cwd: testWorkspace });
      await fs.writeFile(path.join(testWorkspace, 'file.txt'), 'hello');
      await execAsync('git add -A && git commit -m "init"', { cwd: testWorkspace });

      const oldHash = await tracker.getHeadCommitHash();

      // Make a new commit
      await fs.writeFile(path.join(testWorkspace, 'new-file.md'), '# New');
      await execAsync('git add -A && git commit -m "add file"', { cwd: testWorkspace });

      const marker: WorkspaceAnalysisMarker = {
        workspaceCommitHash: oldHash!,
        workspaceBranch: 'main',
        workspaceHasGit: true,
        analyzedAt: new Date().toISOString(),
        analysisType: 'full',
        filesChanged: 0,
        schemaVersion: '1.0.0',
      };

      const result = await tracker.detectChanges(marker);
      expect(result.hasChanges).toBe(true);
      expect(result.method).toBe('git-diff');
      expect(result.changedFiles).toContain('new-file.md');
      expect(result.tooLargeForIncremental).toBe(false);
    });

    it('should detect uncommitted changes at same commit', async () => {
      await execAsync('git init -b main', { cwd: testWorkspace });
      await execAsync('git config user.email "test@test.com"', { cwd: testWorkspace });
      await execAsync('git config user.name "Test"', { cwd: testWorkspace });
      await fs.writeFile(path.join(testWorkspace, 'file.txt'), 'hello');
      await execAsync('git add -A && git commit -m "init"', { cwd: testWorkspace });

      const hash = await tracker.getHeadCommitHash();

      // Add untracked file without committing
      await fs.writeFile(path.join(testWorkspace, 'untracked.txt'), 'new');

      const marker: WorkspaceAnalysisMarker = {
        workspaceCommitHash: hash!,
        workspaceBranch: 'main',
        workspaceHasGit: true,
        analyzedAt: new Date().toISOString(),
        analysisType: 'full',
        filesChanged: 0,
        schemaVersion: '1.0.0',
      };

      const result = await tracker.detectChanges(marker);
      expect(result.hasChanges).toBe(true);
      expect(result.changedFiles).toContain('untracked.txt');
    });

    it('should detect deleted files', async () => {
      await execAsync('git init -b main', { cwd: testWorkspace });
      await execAsync('git config user.email "test@test.com"', { cwd: testWorkspace });
      await execAsync('git config user.name "Test"', { cwd: testWorkspace });
      await fs.writeFile(path.join(testWorkspace, 'a.txt'), 'hello');
      await fs.writeFile(path.join(testWorkspace, 'b.txt'), 'world');
      await execAsync('git add -A && git commit -m "init"', { cwd: testWorkspace });

      const oldHash = await tracker.getHeadCommitHash();

      // Delete a file and commit
      await fs.unlink(path.join(testWorkspace, 'b.txt'));
      await execAsync('git add -A && git commit -m "delete b"', { cwd: testWorkspace });

      const marker: WorkspaceAnalysisMarker = {
        workspaceCommitHash: oldHash!,
        workspaceBranch: 'main',
        workspaceHasGit: true,
        analyzedAt: new Date().toISOString(),
        analysisType: 'full',
        filesChanged: 0,
        schemaVersion: '1.0.0',
      };

      const result = await tracker.detectChanges(marker);
      expect(result.hasChanges).toBe(true);
      expect(result.deletedFiles).toContain('b.txt');
    });

    it('should filter out excluded directories', async () => {
      await execAsync('git init -b main', { cwd: testWorkspace });
      await execAsync('git config user.email "test@test.com"', { cwd: testWorkspace });
      await execAsync('git config user.name "Test"', { cwd: testWorkspace });
      await fs.writeFile(path.join(testWorkspace, 'file.txt'), 'hello');
      await execAsync('git add -A && git commit -m "init"', { cwd: testWorkspace });

      const oldHash = await tracker.getHeadCommitHash();

      // Add files in excluded dirs and a normal file
      await fs.mkdir(path.join(testWorkspace, 'node_modules'), { recursive: true });
      await fs.writeFile(path.join(testWorkspace, 'node_modules', 'pkg.json'), '{}');
      await fs.writeFile(path.join(testWorkspace, 'real-change.ts'), 'code');
      await execAsync('git add -A && git commit -m "add stuff"', { cwd: testWorkspace });

      const marker: WorkspaceAnalysisMarker = {
        workspaceCommitHash: oldHash!,
        workspaceBranch: 'main',
        workspaceHasGit: true,
        analyzedAt: new Date().toISOString(),
        analysisType: 'full',
        filesChanged: 0,
        schemaVersion: '1.0.0',
      };

      const result = await tracker.detectChanges(marker);
      expect(result.changedFiles).toContain('real-change.ts');
      expect(result.changedFiles).not.toContain('node_modules/pkg.json');
    });

    it('should return full-reexplore when old commit no longer exists', async () => {
      await execAsync('git init -b main', { cwd: testWorkspace });
      await execAsync('git config user.email "test@test.com"', { cwd: testWorkspace });
      await execAsync('git config user.name "Test"', { cwd: testWorkspace });
      await fs.writeFile(path.join(testWorkspace, 'file.txt'), 'hello');
      await execAsync('git add -A && git commit -m "init"', { cwd: testWorkspace });

      const marker: WorkspaceAnalysisMarker = {
        workspaceCommitHash: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        workspaceBranch: 'main',
        workspaceHasGit: true,
        analyzedAt: new Date().toISOString(),
        analysisType: 'full',
        filesChanged: 0,
        schemaVersion: '1.0.0',
      };

      const result = await tracker.detectChanges(marker);
      expect(result.hasChanges).toBe(true);
      expect(result.tooLargeForIncremental).toBe(true);
      expect(result.summary).toContain('no longer exists');
    });

    it('should use timestamp fallback for non-git workspace', async () => {
      // No git init — just files
      await fs.writeFile(path.join(testWorkspace, 'doc.txt'), 'hello');

      // Marker from the past
      const marker: WorkspaceAnalysisMarker = {
        workspaceHasGit: false,
        analyzedAt: new Date(Date.now() - 60_000).toISOString(), // 1 minute ago
        analysisType: 'full',
        filesChanged: 0,
        schemaVersion: '1.0.0',
      };

      const result = await tracker.detectChanges(marker);
      expect(result.method).toBe('timestamp');
      // The file was just created, so it's newer than the marker
      expect(result.hasChanges).toBe(true);
      expect(result.changedFiles).toContain('doc.txt');
    });

    it('should return full-reexplore when workspace gained git', async () => {
      await execAsync('git init -b main', { cwd: testWorkspace });
      await execAsync('git config user.email "test@test.com"', { cwd: testWorkspace });
      await execAsync('git config user.name "Test"', { cwd: testWorkspace });
      await fs.writeFile(path.join(testWorkspace, 'file.txt'), 'hello');
      await execAsync('git add -A && git commit -m "init"', { cwd: testWorkspace });

      // Marker without commit hash (was non-git workspace)
      const marker: WorkspaceAnalysisMarker = {
        workspaceHasGit: false,
        analyzedAt: new Date().toISOString(),
        analysisType: 'full',
        filesChanged: 0,
        schemaVersion: '1.0.0',
      };

      const result = await tracker.detectChanges(marker);
      expect(result.tooLargeForIncremental).toBe(true);
      expect(result.summary).toContain('gained git');
    });
  });

  describe('buildCurrentMarker', () => {
    it('should build marker for non-git workspace', async () => {
      const marker = await tracker.buildCurrentMarker('full', 0);
      expect(marker.workspaceHasGit).toBe(false);
      expect(marker.workspaceCommitHash).toBeUndefined();
      expect(marker.workspaceBranch).toBeUndefined();
      expect(marker.analysisType).toBe('full');
      expect(marker.filesChanged).toBe(0);
    });

    it('should build marker for git workspace', async () => {
      await execAsync('git init -b main', { cwd: testWorkspace });
      await execAsync('git config user.email "test@test.com"', { cwd: testWorkspace });
      await execAsync('git config user.name "Test"', { cwd: testWorkspace });
      await fs.writeFile(path.join(testWorkspace, 'file.txt'), 'hello');
      await execAsync('git add -A && git commit -m "init"', { cwd: testWorkspace });

      const marker = await tracker.buildCurrentMarker('incremental', 3);
      expect(marker.workspaceHasGit).toBe(true);
      expect(marker.workspaceCommitHash).toMatch(/^[0-9a-f]{40}$/);
      expect(marker.workspaceBranch).toBe('main');
      expect(marker.analysisType).toBe('incremental');
      expect(marker.filesChanged).toBe(3);
    });
  });
});
