/**
 * Unit tests for src/intelligence/processors/image-processor.ts
 *
 * Strategy:
 * - Use vi.doMock() + vi.resetModules() + dynamic import so that the SUT is
 *   reloaded fresh per test group, with mocks registered before each load.
 * - Mock fs/promises (stat + readFile) to avoid real file I/O.
 * - Mock tesseract.js (OCR path) and ../../src/core/agent-runner.js (AI vision).
 * - A minimal 1×1 PNG fixture is embedded as a base64 constant so tests
 *   don't depend on any file system resources.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ProcessorResult } from '../../src/types/intelligence.js';

// ---------------------------------------------------------------------------
// Minimal 1×1 transparent PNG (67 bytes) — used as the image fixture buffer
// ---------------------------------------------------------------------------

const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const TINY_PNG_BUFFER = Buffer.from(TINY_PNG_BASE64, 'base64');
const TINY_PNG_SIZE = TINY_PNG_BUFFER.length;

// ---------------------------------------------------------------------------
// Mock state shared across tests in this file
// ---------------------------------------------------------------------------

let mockStatFn: ReturnType<typeof vi.fn>;
let mockReadFileFn: ReturnType<typeof vi.fn>;
let mockTesseractWorkerRecognize: ReturnType<typeof vi.fn>;
let mockTesseractWorkerTerminate: ReturnType<typeof vi.fn>;
let mockTesseractCreateWorker: ReturnType<typeof vi.fn>;
let mockAgentRunnerSpawn: ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Dynamic SUT loader — reloads module with fresh mocks each time.
// ---------------------------------------------------------------------------

type ImageProcessorModule = { processImage: (path: string) => Promise<ProcessorResult> };

interface LoadSutOptions {
  /** If true, tesseract.js import will throw (module not installed) */
  tesseractUnavailable?: boolean;
  /** If true, AgentRunner import will throw (module not available) */
  agentRunnerUnavailable?: boolean;
}

async function loadSut(opts: LoadSutOptions = {}): Promise<ImageProcessorModule> {
  vi.resetModules();

  // Fresh mock functions for this load
  mockStatFn = vi.fn().mockResolvedValue({ size: TINY_PNG_SIZE });
  mockReadFileFn = vi.fn().mockResolvedValue(TINY_PNG_BUFFER);

  mockTesseractWorkerTerminate = vi.fn().mockResolvedValue(undefined);
  mockTesseractWorkerRecognize = vi
    .fn()
    .mockResolvedValue({ data: { text: 'OCR extracted text', confidence: 95 } });
  mockTesseractCreateWorker = vi.fn().mockResolvedValue({
    recognize: mockTesseractWorkerRecognize,
    terminate: mockTesseractWorkerTerminate,
  });

  mockAgentRunnerSpawn = vi
    .fn()
    .mockResolvedValue({ stdout: 'AI vision description', exitCode: 0 });

  // Register mocks BEFORE the dynamic import
  vi.doMock('fs/promises', (): any => ({
    readFile: mockReadFileFn,
    stat: mockStatFn,
  }));

  vi.doMock('../../src/core/logger.js', () => ({
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  }));

  if (opts.tesseractUnavailable) {
    vi.doMock('tesseract.js', () => {
      throw new Error('Cannot find module tesseract.js');
    });
  } else {
    vi.doMock('tesseract.js', (): any => ({
      default: { createWorker: mockTesseractCreateWorker },
    }));
  }

  if (opts.agentRunnerUnavailable) {
    vi.doMock('../../src/core/agent-runner.js', () => {
      throw new Error('AgentRunner not available in this environment');
    });
  } else {
    vi.doMock('../../src/core/agent-runner.js', () => ({
      AgentRunner: class MockAgentRunner {
        spawn = mockAgentRunnerSpawn;
      },
    }));
  }

  return import('../../src/intelligence/processors/image-processor.js') as Promise<ImageProcessorModule>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processImage', () => {
  let processImage: ImageProcessorModule['processImage'];

  afterEach(() => {
    vi.doUnmock('fs/promises');
    vi.doUnmock('tesseract.js');
    vi.doUnmock('../../src/core/agent-runner.js');
    vi.doUnmock('../../src/core/logger.js');
  });

  // ── Happy path: both OCR and AI vision succeed ───────────────────────────

  describe('when both OCR and AI vision succeed', () => {
    beforeEach(async () => {
      const mod = await loadSut();
      processImage = mod.processImage;
    });

    it('returns combined rawText with AI description first, then OCR text', async () => {
      const result = await processImage('/tmp/test.png');

      expect(result.rawText).toContain('AI vision description');
      expect(result.rawText).toContain('OCR extracted text');
      // AI description comes before OCR section
      expect(result.rawText.indexOf('AI vision description')).toBeLessThan(
        result.rawText.indexOf('OCR extracted text'),
      );
    });

    it('includes OCR section separator when AI vision is present', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.rawText).toContain('--- OCR Text ---');
    });

    it('sets aiVisionApplied and ocrApplied metadata flags', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.metadata['aiVisionApplied']).toBe(true);
      expect(result.metadata['ocrApplied']).toBe(true);
    });

    it('captures OCR confidence in metadata', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.metadata['ocrConfidence']).toBe(95);
    });

    it('includes mimeType and fileSize in metadata', async () => {
      const result = await processImage('/tmp/image.jpg');
      expect(result.metadata['mimeType']).toBe('image/jpeg');
      expect(result.metadata['fileSize']).toBe(TINY_PNG_SIZE);
    });

    it('returns empty tables array', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.tables).toEqual([]);
    });

    it('returns image entry in images array with filePath, mimeType, size', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.images).toHaveLength(1);
      expect(result.images[0]).toMatchObject({
        filePath: '/tmp/test.png',
        mimeType: 'image/png',
        size: TINY_PNG_SIZE,
      });
    });
  });

  // ── MIME type inference ──────────────────────────────────────────────────

  describe('MIME type inference from file extension', () => {
    beforeEach(async () => {
      const mod = await loadSut();
      processImage = mod.processImage;
    });

    it.each([
      ['.png', 'image/png'],
      ['.jpg', 'image/jpeg'],
      ['.jpeg', 'image/jpeg'],
      ['.gif', 'image/gif'],
      ['.bmp', 'image/bmp'],
      ['.webp', 'image/webp'],
      ['.tiff', 'image/tiff'],
      ['.tif', 'image/tiff'],
      ['.bin', 'application/octet-stream'],
    ])('maps %s → %s', async (ext, expectedMime) => {
      const result = await processImage(`/tmp/file${ext}`);
      expect(result.metadata['mimeType']).toBe(expectedMime);
    });
  });

  // ── File size limit ──────────────────────────────────────────────────────

  describe('file size validation', () => {
    beforeEach(async () => {
      const mod = await loadSut();
      processImage = mod.processImage;
    });

    it('throws when image exceeds 20 MB limit', async () => {
      const oversizedBytes = 21 * 1024 * 1024;
      mockStatFn.mockResolvedValue({ size: oversizedBytes });

      await expect(processImage('/tmp/huge.png')).rejects.toThrow(/exceeds/);
    });

    it('accepts image exactly at the 20 MB limit', async () => {
      const exactLimit = 20 * 1024 * 1024;
      mockStatFn.mockResolvedValue({ size: exactLimit });

      // Should not throw — processing continues
      await expect(processImage('/tmp/large.png')).resolves.toBeDefined();
    });
  });

  // ── OCR-only path (no AgentRunner) ───────────────────────────────────────

  describe('when AgentRunner is unavailable', () => {
    beforeEach(async () => {
      const mod = await loadSut({ agentRunnerUnavailable: true });
      processImage = mod.processImage;
    });

    it('returns OCR text as rawText without AI description', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.rawText).toBe('OCR extracted text');
    });

    it('does not set aiVisionApplied flag', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.metadata['aiVisionApplied']).toBeUndefined();
    });

    it('still sets ocrApplied flag', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.metadata['ocrApplied']).toBe(true);
    });
  });

  // ── AI vision-only path (OCR fails) ─────────────────────────────────────

  describe('when tesseract.js is unavailable', () => {
    beforeEach(async () => {
      const mod = await loadSut({ tesseractUnavailable: true });
      processImage = mod.processImage;
    });

    it('returns AI description as rawText', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.rawText).toContain('AI vision description');
    });

    it('sets aiVisionApplied flag', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.metadata['aiVisionApplied']).toBe(true);
    });

    it('does not set ocrApplied flag', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.metadata['ocrApplied']).toBeUndefined();
    });

    it('records ocrError in metadata', async () => {
      const result = await processImage('/tmp/test.png');
      expect(typeof result.metadata['ocrError']).toBe('string');
    });
  });

  // ── Both paths fail ──────────────────────────────────────────────────────

  describe('when both OCR and AI vision fail', () => {
    beforeEach(async () => {
      const mod = await loadSut({ tesseractUnavailable: true, agentRunnerUnavailable: true });
      processImage = mod.processImage;
    });

    it('returns empty rawText', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.rawText).toBe('');
    });

    it('sets extractionFailed flag in metadata', async () => {
      const result = await processImage('/tmp/test.png');
      expect(result.metadata['extractionFailed']).toBe(true);
    });
  });

  // ── AI vision with empty / non-zero exit code ────────────────────────────

  describe('AI vision edge cases', () => {
    beforeEach(async () => {
      const mod = await loadSut();
      processImage = mod.processImage;
    });

    it('ignores AI vision output when exitCode is non-zero', async () => {
      mockAgentRunnerSpawn.mockResolvedValue({ stdout: 'ignored output', exitCode: 1 });

      const result = await processImage('/tmp/test.png');
      // Falls back to OCR only
      expect(result.metadata['aiVisionApplied']).toBeUndefined();
      expect(result.metadata['ocrApplied']).toBe(true);
    });

    it('ignores AI vision output when stdout is empty', async () => {
      mockAgentRunnerSpawn.mockResolvedValue({ stdout: '   ', exitCode: 0 });

      const result = await processImage('/tmp/test.png');
      expect(result.metadata['aiVisionApplied']).toBeUndefined();
    });

    it('ignores AI vision when spawn throws', async () => {
      mockAgentRunnerSpawn.mockRejectedValue(new Error('spawn failed'));

      const result = await processImage('/tmp/test.png');
      expect(result.metadata['aiVisionApplied']).toBeUndefined();
      // OCR still applied
      expect(result.metadata['ocrApplied']).toBe(true);
    });
  });

  // ── OCR edge cases ───────────────────────────────────────────────────────

  describe('OCR edge cases', () => {
    beforeEach(async () => {
      const mod = await loadSut({ agentRunnerUnavailable: true });
      processImage = mod.processImage;
    });

    it('does not set ocrApplied when OCR text is empty whitespace', async () => {
      mockTesseractWorkerRecognize.mockResolvedValue({
        data: { text: '   \n  ', confidence: 10 },
      });

      const result = await processImage('/tmp/blank.png');
      // OCR ran but text was empty after trim — ocrApplied still set, rawText empty
      expect(result.metadata['ocrApplied']).toBe(true);
      expect(result.rawText).toBe('');
    });

    it('terminates tesseract worker even when recognize throws', async () => {
      mockTesseractWorkerRecognize.mockRejectedValue(new Error('recognition failed'));

      const result = await processImage('/tmp/test.png');
      // Worker was terminated despite error
      expect(mockTesseractWorkerTerminate).toHaveBeenCalled();
      // OCR error captured in metadata
      expect(result.metadata['ocrError']).toBeDefined();
    });
  });

  // ── I/O error propagation ────────────────────────────────────────────────

  describe('I/O errors', () => {
    beforeEach(async () => {
      const mod = await loadSut();
      processImage = mod.processImage;
    });

    it('propagates stat errors', async () => {
      mockStatFn.mockRejectedValue(new Error('ENOENT: no such file'));

      await expect(processImage('/tmp/missing.png')).rejects.toThrow('ENOENT');
    });

    it('propagates readFile errors', async () => {
      mockReadFileFn.mockRejectedValue(new Error('EACCES: permission denied'));

      await expect(processImage('/tmp/noaccess.png')).rejects.toThrow('EACCES');
    });
  });

  // ── AI vision worker spawn options (OB-1567) ──────────────────────────

  describe('AI vision worker spawn options', () => {
    beforeEach(async () => {
      const mod = await loadSut();
      processImage = mod.processImage;
    });

    it('passes timeout: 180_000 and retries: 0 to AgentRunner.spawn()', async () => {
      await processImage('/tmp/test.png');

      // Verify spawn was called with correct options
      expect(mockAgentRunnerSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 180_000,
          retries: 0,
        }),
      );
    });

    it('spawn options include maxTurns: 3', async () => {
      await processImage('/tmp/test.png');

      expect(mockAgentRunnerSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          maxTurns: 3,
        }),
      );
    });

    it('spawn options include read-only allowedTools', async () => {
      await processImage('/tmp/test.png');

      expect(mockAgentRunnerSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          allowedTools: ['Read', 'Glob', 'Grep'],
        }),
      );
    });
  });
});
