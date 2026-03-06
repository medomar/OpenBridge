import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseSvgDimensions,
  HTMLRenderer,
  renderSvgToImage,
} from '../../src/core/html-renderer.js';

// ---------------------------------------------------------------------------
// parseSvgDimensions — pure function, no I/O
// ---------------------------------------------------------------------------

describe('parseSvgDimensions', () => {
  it('extracts width and height from viewBox (minX minY width height)', () => {
    expect(parseSvgDimensions('<svg viewBox="0 0 200 80">')).toEqual({ width: 200, height: 80 });
  });

  it('rounds decimal viewBox values to integers', () => {
    expect(parseSvgDimensions('<svg viewBox="0 0 300.5 150.7">')).toEqual({
      width: 301,
      height: 151,
    });
  });

  it('falls back to width/height attributes when viewBox is absent', () => {
    expect(parseSvgDimensions('<svg width="400" height="300">')).toEqual({
      width: 400,
      height: 300,
    });
  });

  it('handles px suffix on width/height attributes', () => {
    expect(parseSvgDimensions('<svg width="640px" height="480px">')).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('returns undefined dimensions for bare SVG with no size info', () => {
    const result = parseSvgDimensions('<svg>');
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
  });

  it('prefers viewBox over width/height attributes', () => {
    expect(parseSvgDimensions('<svg viewBox="0 0 100 50" width="200" height="100">')).toEqual({
      width: 100,
      height: 50,
    });
  });

  it('handles single-quoted attributes', () => {
    expect(parseSvgDimensions("<svg viewBox='0 0 500 250'>")).toEqual({ width: 500, height: 250 });
  });

  it('handles large social-media dimensions', () => {
    expect(parseSvgDimensions('<svg viewBox="0 0 1200 630">')).toEqual({
      width: 1200,
      height: 630,
    });
  });

  it('handles SVG favicon dimensions', () => {
    expect(parseSvgDimensions('<svg viewBox="0 0 32 32" width="32" height="32">')).toEqual({
      width: 32,
      height: 32,
    });
  });
});

// ---------------------------------------------------------------------------
// HTMLRenderer.isAvailable()
// ---------------------------------------------------------------------------

describe('HTMLRenderer.isAvailable', () => {
  it('returns a boolean without throwing', async () => {
    const result = await HTMLRenderer.isAvailable();
    expect(typeof result).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// HTMLRenderer.renderSvgFile — rejects on missing file
// ---------------------------------------------------------------------------

describe('HTMLRenderer.renderSvgFile', () => {
  let tempDir: string;
  let renderer: HTMLRenderer;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'html-renderer-'));
    renderer = new HTMLRenderer(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('throws when the SVG file does not exist', async () => {
    await expect(renderer.renderSvgFile('/nonexistent/file.svg')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// renderSvgToImage convenience export
// ---------------------------------------------------------------------------

describe('renderSvgToImage', () => {
  it('is a callable function export', () => {
    expect(typeof renderSvgToImage).toBe('function');
  });
});
