import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileServer } from '../../src/core/file-server.js';

const SAMPLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <rect width="200" height="100" fill="#4f46e5"/>
</svg>`;

describe('FileServer — SVG support', () => {
  let tempDir: string;
  let server: FileServer;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'file-server-svg-'));
    server = new FileServer(tempDir);
  });

  afterEach(async () => {
    try {
      await server.stop();
    } catch {
      // Server may not have been started
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // saveSvgContent
  // ---------------------------------------------------------------------------

  describe('saveSvgContent', () => {
    it('saves SVG content to the generated directory and returns its path', async () => {
      const filePath = await server.saveSvgContent(SAMPLE_SVG, 'logo.svg');

      expect(filePath).toContain(join(tempDir, '.openbridge', 'generated', 'logo.svg'));

      const written = await readFile(filePath, 'utf-8');
      expect(written).toBe(SAMPLE_SVG);
    });

    it('creates the generated directory if it does not exist', async () => {
      await server.saveSvgContent(SAMPLE_SVG, 'test.svg');

      const dirStat = await stat(join(tempDir, '.openbridge', 'generated'));
      expect(dirStat.isDirectory()).toBe(true);
    });

    it('auto-generates a filename when none is provided', async () => {
      const filePath = await server.saveSvgContent(SAMPLE_SVG);
      expect(filePath).toMatch(/svg-[a-f0-9-]+\.svg$/);
      const s = await stat(filePath);
      expect(s.isFile()).toBe(true);
    });

    it('throws on path traversal in filename', async () => {
      await expect(server.saveSvgContent(SAMPLE_SVG, '../evil.svg')).rejects.toThrow(
        'Invalid filename',
      );
    });

    it('throws on slash in filename', async () => {
      await expect(server.saveSvgContent(SAMPLE_SVG, 'sub/dir.svg')).rejects.toThrow(
        'Invalid filename',
      );
    });

    it('throws on backslash in filename', async () => {
      await expect(server.saveSvgContent(SAMPLE_SVG, 'sub\\dir.svg')).rejects.toThrow(
        'Invalid filename',
      );
    });

    it('overwrites an existing file with the same name', async () => {
      await server.saveSvgContent('<svg>first</svg>', 'overwrite.svg');
      await server.saveSvgContent('<svg>second</svg>', 'overwrite.svg');

      const filePath = join(tempDir, '.openbridge', 'generated', 'overwrite.svg');
      const content = await readFile(filePath, 'utf-8');
      expect(content).toBe('<svg>second</svg>');
    });
  });

  // ---------------------------------------------------------------------------
  // renderSvgToImage — Puppeteer not available in test env → returns null
  // ---------------------------------------------------------------------------

  describe('renderSvgToImage', () => {
    it('returns null when Puppeteer is unavailable (expected in CI)', async () => {
      // Save an SVG first
      await server.saveSvgContent(SAMPLE_SVG, 'circle.svg');

      // In test environment Puppeteer may not be installed → null is expected
      const result = await server.renderSvgToImage('circle.svg');
      // Either null (no Puppeteer) or a RenderResult (Puppeteer available)
      if (result !== null) {
        expect(result.outputPath).toMatch(/\.png$/);
        expect(result.format).toBe('png');
        expect(result.sizeBytes).toBeGreaterThan(0);
      } else {
        expect(result).toBeNull();
      }
    });

    it('throws when the specified SVG file does not exist', async () => {
      await expect(server.renderSvgToImage('nonexistent.svg')).rejects.toThrow();
    });

    it('throws on path traversal in SVG filename', async () => {
      await expect(server.renderSvgToImage('../escape.svg')).rejects.toThrow('Invalid filename');
    });
  });
});
