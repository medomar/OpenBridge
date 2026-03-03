import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { isFileVisible } from '../../src/core/workspace-manager.js';

// Resolve os.tmpdir() to its canonical real path so that workspace + file
// path.relative() comparisons are consistent on macOS (where /var/folders
// is a symlink to /private/var/folders).
let realTmpDir: string;

beforeAll(async () => {
  realTmpDir = await fs.realpath(os.tmpdir());
});

describe('isFileVisible', () => {
  // ── Default exclusions ──────────────────────────────────────────────────────

  it('excludes .env by default', async () => {
    const visible = await isFileVisible('.env', { workspacePath: realTmpDir });
    expect(visible).toBe(false);
  });

  it('excludes .env.production by default', async () => {
    const visible = await isFileVisible('.env.production', { workspacePath: realTmpDir });
    expect(visible).toBe(false);
  });

  it('excludes *.pem files by default', async () => {
    const visible = await isFileVisible('server.pem', { workspacePath: realTmpDir });
    expect(visible).toBe(false);
  });

  it('allows a normal source file by default', async () => {
    const visible = await isFileVisible('src/index.ts', { workspacePath: realTmpDir });
    expect(visible).toBe(true);
  });

  // ── include restricts visible files ────────────────────────────────────────

  it('limits visible files to include patterns', async () => {
    const inScope = await isFileVisible('src/app.ts', {
      workspacePath: realTmpDir,
      workspace: { include: ['src/**'] },
    });
    expect(inScope).toBe(true);

    const outOfScope = await isFileVisible('docs/readme.md', {
      workspacePath: realTmpDir,
      workspace: { include: ['src/**'] },
    });
    expect(outOfScope).toBe(false);
  });

  // ── exclude takes priority ──────────────────────────────────────────────────

  it('exclude takes priority over include', async () => {
    // src/app.ts would be in scope for include=['src/**'],
    // but a user-supplied exclude for src/*.ts wins.
    const visible = await isFileVisible('src/app.ts', {
      workspacePath: realTmpDir,
      workspace: { include: ['src/**'], exclude: ['src/*.ts'] },
    });
    expect(visible).toBe(false);
  });

  // ── symlink escape guard ────────────────────────────────────────────────────

  it('rejects symlinks that point outside the workspace', async () => {
    // Create a canonical tmp root (no symlinks) to avoid path comparison issues
    const tmpRoot = await fs.realpath(await fs.mkdtemp(path.join(realTmpDir, 'ob-vis-')));
    const workspaceDir = path.join(tmpRoot, 'workspace');
    const outsideDir = path.join(tmpRoot, 'outside');

    await fs.mkdir(workspaceDir);
    await fs.mkdir(outsideDir);

    const outsideFile = path.join(outsideDir, 'secret.txt');
    await fs.writeFile(outsideFile, 'top secret');

    const symlinkPath = path.join(workspaceDir, 'link.txt');
    await fs.symlink(outsideFile, symlinkPath);

    try {
      const visible = await isFileVisible('link.txt', { workspacePath: workspaceDir });
      expect(visible).toBe(false);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  // ── path traversal guard ───────────────────────────────────────────────────

  it('blocks path traversal attempts', async () => {
    // Create a workspace directory with the canonical path
    const tmpRoot = await fs.realpath(await fs.mkdtemp(path.join(realTmpDir, 'ob-vis-')));
    const workspaceDir = path.join(tmpRoot, 'workspace');
    await fs.mkdir(workspaceDir);

    try {
      // ../../etc/passwd escapes two levels above the workspace
      const visible = await isFileVisible('../../etc/passwd', { workspacePath: workspaceDir });
      expect(visible).toBe(false);
    } finally {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
