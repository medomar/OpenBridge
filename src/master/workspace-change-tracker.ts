import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLogger } from '../core/logger.js';
import type { WorkspaceAnalysisMarker } from '../types/master.js';

const execAsync = promisify(exec);
const logger = createLogger('workspace-change-tracker');

/** Maximum number of changed files before we fall back to full re-exploration */
const MAX_INCREMENTAL_FILES = 200;

/** Directories to exclude from change analysis */
const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.openbridge',
];

export interface WorkspaceChanges {
  /** Whether changes were detected */
  hasChanges: boolean;
  /** Detection method used */
  method: 'git-diff' | 'timestamp' | 'no-marker' | 'no-git';
  /** List of changed/added file paths (relative to workspace root) */
  changedFiles: string[];
  /** List of deleted file paths (relative to workspace root) */
  deletedFiles: string[];
  /** Current workspace HEAD commit hash (if git-based) */
  currentCommitHash?: string;
  /** Current workspace branch (if git-based) */
  currentBranch?: string;
  /** Whether the diff is too large for incremental update */
  tooLargeForIncremental: boolean;
  /** Summary message for logging */
  summary: string;
}

export class WorkspaceChangeTracker {
  private readonly workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  /**
   * Check if the workspace has a git repository.
   */
  public async hasGitRepo(): Promise<boolean> {
    try {
      await execAsync('git rev-parse --is-inside-work-tree', {
        cwd: this.workspacePath,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current HEAD commit hash of the workspace.
   */
  public async getHeadCommitHash(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git rev-parse HEAD', {
        cwd: this.workspacePath,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Get the current branch name of the workspace.
   */
  public async getCurrentBranch(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git rev-parse --abbrev-ref HEAD', {
        cwd: this.workspacePath,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /**
   * Detect workspace changes since the last analysis.
   *
   * Strategy:
   * 1. If no marker exists -> report no-marker (triggers full exploration)
   * 2. If workspace has git -> use git diff against stored commit hash
   * 3. If no git -> fall back to timestamp-based detection
   * 4. If too many changes -> flag for full re-exploration
   */
  public async detectChanges(marker: WorkspaceAnalysisMarker | null): Promise<WorkspaceChanges> {
    if (!marker) {
      return {
        hasChanges: true,
        method: 'no-marker',
        changedFiles: [],
        deletedFiles: [],
        tooLargeForIncremental: true,
        summary: 'No analysis marker found — full exploration needed',
      };
    }

    const hasGit = await this.hasGitRepo();

    if (hasGit && marker.workspaceCommitHash) {
      return this.detectChangesViaGit(marker);
    }

    if (hasGit && !marker.workspaceCommitHash) {
      const currentHash = await this.getHeadCommitHash();
      const currentBranch = await this.getCurrentBranch();
      return {
        hasChanges: true,
        method: 'no-marker',
        changedFiles: [],
        deletedFiles: [],
        currentCommitHash: currentHash ?? undefined,
        currentBranch: currentBranch ?? undefined,
        tooLargeForIncremental: true,
        summary: 'Workspace gained git repo since last analysis — full exploration needed',
      };
    }

    if (!hasGit) {
      return this.detectChangesViaTimestamp(marker);
    }

    return {
      hasChanges: true,
      method: 'no-git',
      changedFiles: [],
      deletedFiles: [],
      tooLargeForIncremental: true,
      summary: 'Unable to determine changes — full exploration needed',
    };
  }

  /**
   * Build a WorkspaceAnalysisMarker for the current workspace state.
   * Called after a successful exploration (full or incremental).
   */
  public async buildCurrentMarker(
    analysisType: 'full' | 'incremental',
    filesChanged: number,
  ): Promise<WorkspaceAnalysisMarker> {
    const hasGit = await this.hasGitRepo();
    const commitHash = hasGit ? await this.getHeadCommitHash() : null;
    const branch = hasGit ? await this.getCurrentBranch() : null;

    const now = new Date().toISOString();
    return {
      workspaceCommitHash: commitHash ?? undefined,
      workspaceBranch: branch ?? undefined,
      workspaceHasGit: hasGit,
      analyzedAt: now,
      lastVerifiedAt: now,
      analysisType,
      filesChanged,
      schemaVersion: '1.0.0',
    };
  }

  /**
   * Detect changes using git diff between the stored commit and current HEAD.
   */
  private async detectChangesViaGit(marker: WorkspaceAnalysisMarker): Promise<WorkspaceChanges> {
    const currentHash = await this.getHeadCommitHash();
    const currentBranch = await this.getCurrentBranch();

    // Same commit — no structural changes worth re-exploring.
    // Uncommitted working-tree changes are the developer actively editing code;
    // they rarely affect project type, frameworks, or directory structure, so
    // we skip re-exploration entirely and let the next commit trigger it.
    if (currentHash === marker.workspaceCommitHash) {
      return {
        hasChanges: false,
        method: 'git-diff',
        changedFiles: [],
        deletedFiles: [],
        currentCommitHash: currentHash ?? undefined,
        currentBranch: currentBranch ?? undefined,
        tooLargeForIncremental: false,
        summary: 'No new commits since last analysis',
      };
    }

    // Different commit — check if old commit still exists
    try {
      await execAsync(`git cat-file -t ${marker.workspaceCommitHash}`, {
        cwd: this.workspacePath,
      });
    } catch {
      return {
        hasChanges: true,
        method: 'git-diff',
        changedFiles: [],
        deletedFiles: [],
        currentCommitHash: currentHash ?? undefined,
        currentBranch: currentBranch ?? undefined,
        tooLargeForIncremental: true,
        summary: `Previous commit ${marker.workspaceCommitHash?.slice(0, 8)} no longer exists — full exploration needed`,
      };
    }

    // Get list of changed files between old and new commit
    const { stdout: diffOutput } = await execAsync(
      `git diff --name-status ${marker.workspaceCommitHash}...HEAD`,
      { cwd: this.workspacePath, maxBuffer: 10 * 1024 * 1024 },
    );

    const changedFiles: string[] = [];
    const deletedFiles: string[] = [];

    for (const line of diffOutput.split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const status = parts[0]?.charAt(0);
      const filePath = parts[parts.length - 1];

      if (!filePath) continue;
      if (status === 'D') {
        deletedFiles.push(filePath);
      } else {
        changedFiles.push(filePath);
      }
    }

    // Also include uncommitted changes
    const uncommitted = await this.getUncommittedChanges();
    for (const f of uncommitted) {
      if (!changedFiles.includes(f) && !deletedFiles.includes(f)) {
        changedFiles.push(f);
      }
    }

    const filteredChanged = this.filterExcludedPaths(changedFiles);
    const filteredDeleted = this.filterExcludedPaths(deletedFiles);
    const totalChanged = filteredChanged.length + filteredDeleted.length;

    return {
      hasChanges: totalChanged > 0,
      method: 'git-diff',
      changedFiles: filteredChanged,
      deletedFiles: filteredDeleted,
      currentCommitHash: currentHash ?? undefined,
      currentBranch: currentBranch ?? undefined,
      tooLargeForIncremental: totalChanged > MAX_INCREMENTAL_FILES,
      summary: `${filteredChanged.length} file(s) changed, ${filteredDeleted.length} deleted since commit ${marker.workspaceCommitHash?.slice(0, 8)}`,
    };
  }

  /**
   * Get uncommitted changes (both staged and unstaged) in the workspace.
   */
  private async getUncommittedChanges(): Promise<string[]> {
    try {
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: this.workspacePath,
      });
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((line) => line.slice(3).trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Detect changes using file modification timestamps.
   * Fallback for workspaces without git.
   */
  private async detectChangesViaTimestamp(
    marker: WorkspaceAnalysisMarker,
  ): Promise<WorkspaceChanges> {
    const analysisTime = new Date(marker.analyzedAt).getTime();
    const changedFiles: string[] = [];

    try {
      await this.findModifiedFiles(this.workspacePath, analysisTime, changedFiles, 0);
    } catch (error) {
      logger.warn({ error }, 'Timestamp-based change detection failed');
      return {
        hasChanges: true,
        method: 'timestamp',
        changedFiles: [],
        deletedFiles: [],
        tooLargeForIncremental: true,
        summary: 'Timestamp-based detection failed — full exploration needed',
      };
    }

    return {
      hasChanges: changedFiles.length > 0,
      method: 'timestamp',
      changedFiles,
      deletedFiles: [],
      tooLargeForIncremental: changedFiles.length > MAX_INCREMENTAL_FILES,
      summary: `${changedFiles.length} file(s) modified since ${marker.analyzedAt} (timestamp-based)`,
    };
  }

  /**
   * Recursively find files modified after a given timestamp.
   * Respects EXCLUDED_DIRS and caps depth at 10 levels.
   */
  private async findModifiedFiles(
    dirPath: string,
    sinceTimestamp: number,
    results: string[],
    depth: number,
  ): Promise<void> {
    if (depth > 10) return;
    if (results.length > MAX_INCREMENTAL_FILES) return;

    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (EXCLUDED_DIRS.includes(entry.name)) continue;

      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(this.workspacePath, fullPath);

      if (entry.isDirectory()) {
        await this.findModifiedFiles(fullPath, sinceTimestamp, results, depth + 1);
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath);
        if (stat.mtimeMs > sinceTimestamp) {
          results.push(relativePath);
        }
      }
    }
  }

  /**
   * Filter out paths that fall under excluded directories.
   */
  private filterExcludedPaths(paths: string[]): string[] {
    return paths.filter((p) => {
      const parts = p.split(path.sep);
      return !parts.some((part) => EXCLUDED_DIRS.includes(part));
    });
  }
}
