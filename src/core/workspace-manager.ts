import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createLogger } from './logger.js';

const execFileAsync = promisify(execFile);
const logger = createLogger('workspace-manager');

const DEFAULT_PULL_INTERVAL_SECONDS = 300; // 5 minutes

export interface WorkspaceManagerOptions {
  /** Polling interval in seconds for remote workspace auto-pull (default: 300) */
  pullIntervalSeconds?: number;
  /** Callback invoked when git pull detects new commits — use to trigger re-exploration */
  onChangesDetected?: () => void | Promise<void>;
}

/**
 * Manages workspace setup for both local and remote (git URL) workspaces.
 *
 * For remote workspaces (https:// or git@ URLs):
 * - Clones the repo to ~/.openbridge/workspaces/{repo-name}/ on init
 * - Polls for upstream changes at a configurable interval
 * - Calls onChangesDetected when new commits are pulled
 *
 * For local workspaces:
 * - Returns the path as-is; no polling
 */
export class WorkspaceManager {
  private readonly originalPath: string;
  private localPath: string;
  private readonly options: WorkspaceManagerOptions;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastCommitHash: string | null = null;

  constructor(workspacePath: string, options: WorkspaceManagerOptions = {}) {
    this.originalPath = workspacePath;
    this.localPath = workspacePath;
    this.options = options;
  }

  /** Returns true if the given path is a remote git URL */
  public static isRemoteUrl(workspacePath: string): boolean {
    return workspacePath.startsWith('https://') || workspacePath.startsWith('git@');
  }

  /** Returns the resolved local workspace path (after possible clone) */
  public getLocalPath(): string {
    return this.localPath;
  }

  /**
   * Initialize the workspace:
   * - Remote URL → clone to ~/.openbridge/workspaces/{repo-name}/ (or pull if already cloned)
   * - Local path → use as-is
   *
   * @returns The local filesystem path to the workspace
   */
  public async init(): Promise<string> {
    if (!WorkspaceManager.isRemoteUrl(this.originalPath)) {
      this.localPath = this.originalPath;
      return this.localPath;
    }

    const repoName = WorkspaceManager.extractRepoName(this.originalPath);
    const workspacesDir = path.join(os.homedir(), '.openbridge', 'workspaces');
    this.localPath = path.join(workspacesDir, repoName);

    await fs.mkdir(workspacesDir, { recursive: true });

    const alreadyCloned = await this.isGitRepo(this.localPath);
    if (alreadyCloned) {
      logger.info(
        { localPath: this.localPath },
        'Remote workspace already cloned — pulling latest',
      );
      await this.pull();
    } else {
      logger.info(
        { url: this.originalPath, localPath: this.localPath },
        'Cloning remote workspace...',
      );
      await this.clone();
      logger.info({ localPath: this.localPath }, 'Clone complete');
    }

    this.lastCommitHash = await this.getHeadCommit();
    logger.info(
      { localPath: this.localPath, commit: this.lastCommitHash?.slice(0, 8) },
      'Remote workspace ready',
    );

    return this.localPath;
  }

  /**
   * Start polling for upstream changes.
   * No-op for local workspaces.
   * The poll timer is unref'd so it won't prevent process exit.
   */
  public startPolling(): void {
    if (!WorkspaceManager.isRemoteUrl(this.originalPath)) {
      return;
    }

    const intervalMs = (this.options.pullIntervalSeconds ?? DEFAULT_PULL_INTERVAL_SECONDS) * 1000;

    logger.info({ intervalSeconds: intervalMs / 1000 }, 'Starting remote workspace polling');

    this.pollTimer = setInterval(() => {
      void this.checkForRemoteChanges();
    }, intervalMs);

    // Unref so the timer doesn't prevent clean process exit
    this.pollTimer.unref();
  }

  /** Set or replace the callback invoked when remote changes are detected */
  public setOnChangesDetected(callback: () => void | Promise<void>): void {
    this.options.onChangesDetected = callback;
  }

  /** Stop the polling timer */
  public stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
      logger.debug('Remote workspace polling stopped');
    }
  }

  /** Pull latest commits and fire onChangesDetected if HEAD moved */
  private async checkForRemoteChanges(): Promise<void> {
    try {
      logger.debug({ localPath: this.localPath }, 'Checking remote workspace for changes...');
      const beforeHash = this.lastCommitHash ?? (await this.getHeadCommit());

      await this.pull();

      const afterHash = await this.getHeadCommit();

      if (afterHash && afterHash !== beforeHash) {
        this.lastCommitHash = afterHash;
        logger.info(
          { before: beforeHash?.slice(0, 8), after: afterHash.slice(0, 8) },
          'Remote workspace updated — triggering re-exploration',
        );
        if (this.options.onChangesDetected) {
          await this.options.onChangesDetected();
        }
      } else {
        logger.debug('No remote changes detected');
        this.lastCommitHash = afterHash ?? beforeHash;
      }
    } catch (error) {
      logger.warn({ err: error }, 'Remote workspace pull check failed — will retry next interval');
    }
  }

  /** Run `git clone` for a fresh checkout */
  private async clone(): Promise<void> {
    await execFileAsync('git', ['clone', '--', this.originalPath, this.localPath]);
  }

  /** Run `git pull --ff-only` in the local clone */
  private async pull(): Promise<void> {
    await execFileAsync('git', ['pull', '--ff-only'], { cwd: this.localPath });
  }

  /** Return HEAD commit hash, or null if unavailable */
  private async getHeadCommit(): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], {
        cwd: this.localPath,
      });
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /** Return true if `dirPath` is inside a git work tree */
  private async isGitRepo(dirPath: string): Promise<boolean> {
    try {
      await fs.access(dirPath);
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: dirPath });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Derive a safe directory name from a git URL.
   *
   * Examples:
   *   https://github.com/user/my-repo.git  → my-repo
   *   git@github.com:user/my-repo.git      → my-repo
   *   https://github.com/user/my-repo      → my-repo
   */
  public static extractRepoName(url: string): string {
    const normalized = url.replace(/\.git$/, '');
    const lastSlash = normalized.lastIndexOf('/');
    const lastColon = normalized.lastIndexOf(':');
    const start = Math.max(lastSlash, lastColon) + 1;
    const name = normalized.slice(start);
    // Keep only safe filesystem characters
    return name.replace(/[^a-zA-Z0-9\-_.]/g, '_') || 'workspace';
  }
}
