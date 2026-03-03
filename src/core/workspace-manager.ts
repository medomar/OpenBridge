import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createLogger } from './logger.js';
import { DEFAULT_EXCLUDE_PATTERNS } from '../types/config.js';

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

// ── File visibility helpers ─────────────────────────────────────────────────

/**
 * Convert a glob pattern to a RegExp.
 * Supports * (single-segment wildcard) and ** (multi-segment wildcard).
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // ** matches any sequence of characters including path separators
        regexStr += '.*';
        i += 2;
        // Consume optional trailing '/' after **
        if (pattern[i] === '/') i++;
      } else {
        // * matches any character except '/'
        regexStr += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if ('.+^${}()|[\\]'.includes(ch)) {
      regexStr += '\\' + ch;
      i++;
    } else {
      regexStr += ch;
      i++;
    }
  }
  return new RegExp('^' + regexStr + '$');
}

/**
 * Check if a relative file path matches a single glob pattern.
 *
 * Semantics (gitignore-like):
 * - Pattern ending with '/'  → directory pattern; matches any file inside that
 *   directory at any depth (e.g. `node_modules/` hides all node_modules trees).
 * - Pattern without '/'      → matches against the file's basename at any depth
 *   (e.g. `*.pem` hides all .pem files regardless of location).
 * - Pattern with '/'         → matched against the full relative path from the
 *   workspace root (e.g. `src/**` matches everything under src/).
 */
function matchesGlob(relativePath: string, pattern: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');

  // Directory pattern — match any file inside that directory at any depth
  if (pattern.endsWith('/')) {
    const dirName = pattern.slice(0, -1);
    if (!dirName.includes('/')) {
      // No path separator in dir name → match at any depth
      const segments = normalizedPath.split('/');
      const dirRegex = globToRegex(dirName);
      return segments.some((seg, idx) => idx < segments.length - 1 && dirRegex.test(seg));
    }
    // Has separator → match from workspace root
    return normalizedPath === dirName || normalizedPath.startsWith(dirName + '/');
  }

  // No '/' in pattern → match against basename only
  if (!pattern.includes('/')) {
    const basename = normalizedPath.includes('/')
      ? normalizedPath.slice(normalizedPath.lastIndexOf('/') + 1)
      : normalizedPath;
    return globToRegex(pattern).test(basename);
  }

  // Pattern with '/' → match against full relative path
  return globToRegex(pattern).test(normalizedPath);
}

/**
 * Check whether a file should be visible to the AI based on workspace visibility rules.
 *
 * Algorithm:
 *   1. Normalize `workspacePath` to an absolute path via `path.resolve()` — eliminates
 *      any relative components before the path is used as a scope anchor.
 *   2. Resolve `filePath` to an absolute path using the normalized workspace root.
 *   3. Resolve symlinks via `fs.realpath()` so that symlinks pointing outside the
 *      workspace are treated as out-of-scope (prevents symlink escape attacks).
 *   4. Compute the relative path from the real workspace root to the real file.
 *      If the relative path escapes the workspace (starts with "..") → NOT visible.
 *      This also blocks path-traversal inputs like `../../etc/passwd`.
 *   5. Combine DEFAULT_EXCLUDE_PATTERNS with `config.workspace?.exclude`.
 *   6. If the resolved relative path matches any exclude pattern → NOT visible (exclude takes priority).
 *   7. If `config.workspace?.include` is set and non-empty:
 *        - File must match at least one include pattern to be visible.
 *   8. Otherwise → visible.
 *
 * @param filePath       Absolute or workspace-relative file path.
 * @param config         Object with `workspacePath` and optional `workspace` include/exclude arrays.
 */
export async function isFileVisible(
  filePath: string,
  config: {
    workspacePath: string;
    workspace?: { include?: string[]; exclude?: string[] };
  },
): Promise<boolean> {
  // Normalize workspace root to an absolute path first — eliminates any relative
  // components (e.g. "../secret") so that all subsequent path operations have a
  // stable, canonical anchor and path.relative() comparisons are reliable.
  const workspaceRoot = path.resolve(config.workspacePath);

  // Resolve to absolute path — path.resolve handles both relative and absolute
  // filePaths.  An absolute filePath (potential path-traversal attempt such as
  // ../../etc/passwd) is still caught by the scope check below.
  const absFile = path.resolve(workspaceRoot, filePath);

  // Resolve symlinks — prevents symlink escape to files outside the workspace.
  // Fall back to the unresolved path if the file does not exist yet.
  let realFile: string;
  try {
    realFile = await fs.realpath(absFile);
  } catch {
    realFile = absFile;
  }

  // Resolve the workspace root symlinks for an accurate containment check.
  let realWorkspace: string;
  try {
    realWorkspace = await fs.realpath(workspaceRoot);
  } catch {
    realWorkspace = workspaceRoot;
  }

  // Compute relative path from the resolved workspace root to the resolved file.
  const relative = path.relative(realWorkspace, realFile);

  // Symlink escape guard — if the real path is outside the workspace, reject.
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return false;
  }

  // Build combined exclude list: defaults first, then user overrides
  const excludePatterns: readonly string[] = [
    ...DEFAULT_EXCLUDE_PATTERNS,
    ...(config.workspace?.exclude ?? []),
  ];

  // Exclude takes priority — any match makes the file invisible
  for (const pattern of excludePatterns) {
    if (matchesGlob(relative, pattern)) {
      return false;
    }
  }

  // If an include list is specified, file must match at least one pattern
  const includePatterns = config.workspace?.include;
  if (includePatterns && includePatterns.length > 0) {
    return includePatterns.some((pattern) => matchesGlob(relative, pattern));
  }

  // No include restriction — file is visible
  return true;
}
