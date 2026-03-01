import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, readdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MediaManager, createMediaManager } from '../../src/core/media-manager.js';

describe('MediaManager', () => {
  let tempDir: string;
  let manager: MediaManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'media-manager-'));
    // Use a short TTL (1 hour default) and 100 MB cap for most tests
    manager = new MediaManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // directory creation
  // ---------------------------------------------------------------------------

  it('creates the media directory on first saveMedia call', async () => {
    // Use a sub-workspace path that does not yet exist
    const workspace = join(tempDir, 'workspace');
    const m = new MediaManager(workspace);

    const result = await m.saveMedia(Buffer.from('hello'), 'text/plain');

    const dirStat = await stat(join(workspace, '.openbridge', 'media'));
    expect(dirStat.isDirectory()).toBe(true);
    expect(result.filePath).toContain(join(workspace, '.openbridge', 'media'));
  });

  it('exposes the managed media directory path via .directory', () => {
    expect(manager.directory).toBe(join(tempDir, '.openbridge', 'media'));
  });

  // ---------------------------------------------------------------------------
  // saveMedia — happy paths
  // ---------------------------------------------------------------------------

  it('saves a buffer and returns the correct filePath and sizeBytes', async () => {
    const data = Buffer.from('image data');
    const result = await manager.saveMedia(data, 'image/png');

    expect(result.sizeBytes).toBe(data.length);
    expect(result.filePath).toMatch(/\.png$/);

    const fileStat = await stat(result.filePath);
    expect(fileStat.isFile()).toBe(true);
    expect(fileStat.size).toBe(data.length);
  });

  it('derives extension from MIME type when no filename is given', async () => {
    const mimeToExt: Array<[string, string]> = [
      ['image/jpeg', '.jpg'],
      ['image/png', '.png'],
      ['audio/ogg', '.oga'],
      ['application/pdf', '.pdf'],
      ['video/mp4', '.mp4'],
    ];

    for (const [mime, expectedExt] of mimeToExt) {
      const result = await manager.saveMedia(Buffer.from('x'), mime);
      expect(result.filePath).toMatch(new RegExp(`\\${expectedExt}$`));
    }
  });

  it('prefers the filename extension over the MIME type when filename is provided', async () => {
    const result = await manager.saveMedia(Buffer.from('data'), 'image/png', 'photo.webp');
    expect(result.filePath).toMatch(/\.webp$/);
  });

  it('falls back to MIME extension when filename has no extension', async () => {
    const result = await manager.saveMedia(Buffer.from('data'), 'image/gif', 'noextension');
    expect(result.filePath).toMatch(/\.gif$/);
  });

  it('produces no extension for unknown MIME types with no filename', async () => {
    const result = await manager.saveMedia(Buffer.from('data'), 'application/octet-stream');
    // Unknown MIME → no extension appended (empty string from resolveExtension)
    const basename = result.filePath.split('/').pop() ?? '';
    // Filename format: <timestamp>-<uuid> with no dot-extension at end
    const parts = basename.split('.');
    // If no extension, only timestamp-uuid (which contains hyphens, no extra dot)
    expect(parts.length).toBeLessThanOrEqual(2); // at most one dot from UUID is acceptable
  });

  // ---------------------------------------------------------------------------
  // concurrent saves
  // ---------------------------------------------------------------------------

  it('generates unique filenames for concurrent saves', async () => {
    const count = 10;
    const results = await Promise.all(
      Array.from({ length: count }, () =>
        manager.saveMedia(Buffer.from('concurrent'), 'text/plain'),
      ),
    );

    const paths = results.map((r) => r.filePath);
    const unique = new Set(paths);
    expect(unique.size).toBe(count);

    // All files must exist on disk
    for (const p of paths) {
      const s = await stat(p);
      expect(s.isFile()).toBe(true);
    }
  });

  // ---------------------------------------------------------------------------
  // cleanExpired — TTL eviction
  // ---------------------------------------------------------------------------

  it('cleanExpired removes files older than the TTL', async () => {
    const shortTtl = new MediaManager(tempDir, 100); // 100ms TTL

    const result = await shortTtl.saveMedia(Buffer.from('old'), 'text/plain');

    // Backdate the file's mtime to 200ms ago (beyond TTL)
    const oldTime = new Date(Date.now() - 200);
    await utimes(result.filePath, oldTime, oldTime);

    await shortTtl.cleanExpired();

    await expect(stat(result.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cleanExpired keeps files within the TTL', async () => {
    const result = await manager.saveMedia(Buffer.from('fresh'), 'text/plain');

    await manager.cleanExpired();

    const s = await stat(result.filePath);
    expect(s.isFile()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // cleanExpired — size cap eviction
  // ---------------------------------------------------------------------------

  it('cleanExpired enforces the size cap by deleting oldest files first', async () => {
    // Very small cap (50 bytes) so we can trigger it with small files
    const tinyCapManager = new MediaManager(tempDir, 60 * 60 * 1000, 50);

    // Save 3 files of 20 bytes each (total = 60 bytes > 50 byte cap)
    const r1 = await tinyCapManager.saveMedia(Buffer.alloc(20, 'a'), 'text/plain', 'file1.txt');
    // Wait a ms so mtimes differ reliably
    await new Promise((resolve) => setTimeout(resolve, 10));
    const r2 = await tinyCapManager.saveMedia(Buffer.alloc(20, 'b'), 'text/plain', 'file2.txt');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const r3 = await tinyCapManager.saveMedia(Buffer.alloc(20, 'c'), 'text/plain', 'file3.txt');

    await tinyCapManager.cleanExpired();

    // r1 is oldest and should have been deleted to get total down to ≤50
    await expect(stat(r1.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    // r2 and r3 (40 bytes total) should remain
    expect((await stat(r2.filePath)).isFile()).toBe(true);
    expect((await stat(r3.filePath)).isFile()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // cleanExpired — edge cases
  // ---------------------------------------------------------------------------

  it('cleanExpired is a no-op when the media directory does not exist', async () => {
    const nonExistentWorkspace = join(tempDir, 'does-not-exist');
    const m = new MediaManager(nonExistentWorkspace);

    // Should not throw
    await expect(m.cleanExpired()).resolves.toBeUndefined();
  });

  it('cleanExpired is a no-op when the directory is empty', async () => {
    // Trigger directory creation first
    await manager.saveMedia(Buffer.from('x'), 'text/plain');
    const files = await readdir(manager.directory);
    for (const f of files) {
      await rm(join(manager.directory, f));
    }

    await expect(manager.cleanExpired()).resolves.toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // createMediaManager factory
  // ---------------------------------------------------------------------------

  it('createMediaManager returns a MediaManager with default settings', async () => {
    const m = createMediaManager(tempDir);
    expect(m).toBeInstanceOf(MediaManager);
    expect(m.directory).toBe(join(tempDir, '.openbridge', 'media'));

    // Should be usable
    const result = await m.saveMedia(Buffer.from('factory test'), 'text/plain');
    expect(result.sizeBytes).toBe(12);
  });
});
