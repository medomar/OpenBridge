import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createLogger } from './logger.js';

const execFileAsync = promisify(execFile);
const logger = createLogger('github-publisher');

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

function extractGitHubPagesUrl(remoteUrl: string, filename: string): string {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch) {
    const [, owner, repo] = httpsMatch;
    return `https://${owner}.github.io/${repo}/${filename}`;
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) {
    const [, owner, repo] = sshMatch;
    return `https://${owner}.github.io/${repo}/${filename}`;
  }

  return '';
}

/**
 * Publish a file to the gh-pages branch of the workspace git repository.
 * Creates the gh-pages branch as an orphan if it does not yet exist.
 * When the branch already exists its content is preserved and the file is added or replaced.
 * Requires git to be configured with push access to the remote.
 *
 * @param filePath - Absolute path to the file to publish.
 * @param repoUrl  - Remote URL override. If omitted, uses the `origin` remote from the workspace.
 * @returns The GitHub Pages URL for the published file, or empty string if URL cannot be determined.
 */
export async function publishToGitHubPages(filePath: string, repoUrl?: string): Promise<string> {
  const resolvedFilePath = path.resolve(filePath);
  const fileDir = path.dirname(resolvedFilePath);
  const filename = path.basename(resolvedFilePath);

  // Locate the git root from the file's directory
  let gitRoot: string;
  try {
    gitRoot = await runGit(['rev-parse', '--show-toplevel'], fileDir);
  } catch (err) {
    throw new Error(
      `Cannot locate git repository for path "${resolvedFilePath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Resolve remote URL
  let remote: string;
  if (repoUrl) {
    remote = repoUrl;
  } else {
    try {
      remote = await runGit(['remote', 'get-url', 'origin'], gitRoot);
    } catch (err) {
      throw new Error(
        `No remote "origin" configured in git repo at "${gitRoot}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Create a temp directory for the gh-pages working tree
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'openbridge-ghpages-'));

  try {
    // Check if gh-pages already exists on the remote
    let branchExists = false;
    try {
      const lsOutput = await runGit(['ls-remote', '--heads', remote, 'gh-pages'], gitRoot);
      branchExists = lsOutput.length > 0;
    } catch {
      // ls-remote failed — treat as branch not existing
      branchExists = false;
    }

    // Initialize a fresh git repo in the temp dir
    await runGit(['init'], tmpDir);
    await runGit(['remote', 'add', 'origin', remote], tmpDir);

    // Set a local git identity so commits don't fail in headless environments
    await runGit(['config', 'user.email', 'openbridge@localhost'], tmpDir);
    await runGit(['config', 'user.name', 'OpenBridge'], tmpDir);

    if (branchExists) {
      // Fetch the existing gh-pages branch (shallow for speed) and check it out
      await runGit(['fetch', '--depth=1', 'origin', 'gh-pages'], tmpDir);
      await runGit(['checkout', '-b', 'gh-pages', 'FETCH_HEAD'], tmpDir);
    } else {
      // Create a fresh orphan branch — no history, no parent commits
      await runGit(['checkout', '--orphan', 'gh-pages'], tmpDir);
    }

    // Copy the file into the working tree
    await copyFile(resolvedFilePath, path.join(tmpDir, filename));

    // Stage and commit
    await runGit(['add', filename], tmpDir);
    await runGit(['commit', '-m', `chore: publish ${filename} to GitHub Pages`], tmpDir);

    // Push to the gh-pages branch on the remote
    await runGit(['push', 'origin', 'HEAD:gh-pages'], tmpDir);

    const pagesUrl = extractGitHubPagesUrl(remote, filename);
    logger.info(
      { filename, remote, pagesUrl: pagesUrl || '(unknown)' },
      'Published to GitHub Pages',
    );

    return pagesUrl;
  } finally {
    // Clean up temp directory (best effort)
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
