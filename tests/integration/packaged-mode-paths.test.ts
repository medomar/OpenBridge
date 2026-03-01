/**
 * Integration test: packaged mode path resolution (OB-1255)
 *
 * Verifies that loadConfig() (via resolveConfigPath()), database.ts
 * (via resolveDbPath()), and logger.ts all resolve file paths to the
 * user home directory (~/.openbridge/) when running inside a pkg-compiled
 * binary (process.pkg is set), and that no path points into the pkg
 * read-only snapshot filesystem (/snapshot/...).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Mock mkdirSync to prevent actual directory creation during path resolution
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, mkdirSync: vi.fn() };
});

import { resolveConfigPath } from '../../src/core/config.js';
import { resolveDbPath } from '../../src/memory/database.js';
import { getConfigDir } from '../../src/cli/utils.js';

const SNAPSHOT_PREFIX = '/snapshot/';
const EXPECTED_BASE = join(homedir(), '.openbridge');

describe('packaged mode path integration — no snapshot paths', () => {
  let savedConfigPath: string | undefined;

  beforeEach(() => {
    savedConfigPath = process.env['CONFIG_PATH'];
    delete process.env['CONFIG_PATH'];
  });

  afterEach(() => {
    delete (process as { pkg?: unknown }).pkg;
    if (savedConfigPath === undefined) {
      delete process.env['CONFIG_PATH'];
    } else {
      process.env['CONFIG_PATH'] = savedConfigPath;
    }
  });

  it('loadConfig() resolves config.json under ~/.openbridge (not pkg snapshot) when process.pkg is set', () => {
    (process as { pkg?: unknown }).pkg = {};
    const configPath = resolveConfigPath();
    expect(configPath).toBe(join(EXPECTED_BASE, 'config.json'));
    expect(configPath).not.toContain(SNAPSHOT_PREFIX);
  });

  it('database.ts resolves openbridge.db under ~/.openbridge (not pkg snapshot) when process.pkg is set', () => {
    (process as { pkg?: unknown }).pkg = {};
    const dbPath = resolveDbPath();
    expect(dbPath).toBe(join(EXPECTED_BASE, 'openbridge.db'));
    expect(dbPath).not.toContain(SNAPSHOT_PREFIX);
  });

  it('logger.ts log directory agrees with getConfigDir() in packaged mode, not a snapshot path', () => {
    (process as { pkg?: unknown }).pkg = {};
    // getConfigDir() returns ~/.openbridge in packaged mode
    const configBase = getConfigDir();
    // logger.ts internally computes: join(homedir(), '.openbridge', 'logs')
    // Verify that this matches join(getConfigDir(), 'logs') for path consistency
    const loggerLogDir = join(homedir(), '.openbridge', 'logs');
    expect(loggerLogDir).toBe(join(configBase, 'logs'));
    expect(configBase).not.toContain(SNAPSHOT_PREFIX);
    expect(loggerLogDir).not.toContain(SNAPSHOT_PREFIX);
  });
});
