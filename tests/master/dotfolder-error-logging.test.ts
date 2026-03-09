/**
 * OB-1321 — DotFolderManager error logging for file I/O failures
 *
 * Verifies that `DotFolderManager.readWorkspaceMap()` returns `null` AND
 * logs a warning when `fs.readFile` throws an EACCES (permission denied)
 * error instead of silently swallowing the failure.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Spy variables ─────────────────────────────────────────────────────────────

const mockWarn = vi.fn();
const mockReadFile = vi.fn<() => Promise<string>>();

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...(args as [])),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  rm: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Import AFTER mocking so the module picks up the mocked logger and fs.
const { DotFolderManager } = await import('../../src/master/dotfolder-manager.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DotFolderManager — error logging on I/O failures', () => {
  let manager: InstanceType<typeof DotFolderManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new DotFolderManager('/fake/workspace');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readWorkspaceMap()', () => {
    it('returns null when readFile throws EACCES and logs a warning', async () => {
      const eaccesError = Object.assign(new Error('permission denied'), {
        code: 'EACCES',
      });

      mockReadFile.mockRejectedValueOnce(eaccesError);

      const result = await manager.readWorkspaceMap();

      expect(result).toBeNull();
      expect(mockWarn).toHaveBeenCalledOnce();

      const [context, message] = mockWarn.mock.calls[0] as [Record<string, unknown>, string];
      expect(context).toMatchObject({ err: eaccesError });
      expect(message).toMatch(/workspace-map/i);
    });

    it('returns null when readFile throws ENOENT and logs a warning', async () => {
      const enoentError = Object.assign(new Error('no such file or directory'), {
        code: 'ENOENT',
      });

      mockReadFile.mockRejectedValueOnce(enoentError);

      const result = await manager.readWorkspaceMap();

      expect(result).toBeNull();
      expect(mockWarn).toHaveBeenCalledOnce();
    });

    it('includes the file path in the warning context', async () => {
      const eaccesError = Object.assign(new Error('permission denied'), {
        code: 'EACCES',
      });

      mockReadFile.mockRejectedValueOnce(eaccesError);

      await manager.readWorkspaceMap();

      const [context] = mockWarn.mock.calls[0] as [Record<string, unknown>];
      expect(context).toHaveProperty('path');
      expect(typeof context['path']).toBe('string');
      expect(context['path']).toContain('workspace-map.json');
    });
  });
});
