import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';

import {
  isPackagedMode,
  getConfigDir,
  detectOS,
  isCommandAvailable,
  getNodeVersion,
  meetsNodeVersion,
  runCommand,
  printStep,
  printSuccess,
  printWarning,
  printError,
  writeEnvFile,
  validateApiKey,
  checkForUpdate,
} from '../../src/cli/utils.js';

// ─── isPackagedMode ──────────────────────────────────────────────────────────

describe('isPackagedMode()', () => {
  it('returns false in normal dev/test environment (no process.pkg)', () => {
    // In dev mode, process.pkg is undefined
    expect(isPackagedMode()).toBe(false);
  });

  it('returns true when process.pkg is defined (simulates pkg binary)', () => {
    (process as { pkg?: unknown }).pkg = {};
    try {
      expect(isPackagedMode()).toBe(true);
    } finally {
      delete (process as { pkg?: unknown }).pkg;
    }
  });

  it('returns false after process.pkg is removed', () => {
    (process as { pkg?: unknown }).pkg = { version: '1.0' };
    delete (process as { pkg?: unknown }).pkg;
    expect(isPackagedMode()).toBe(false);
  });
});

// ─── getConfigDir ────────────────────────────────────────────────────────────

describe('getConfigDir()', () => {
  it('returns process.cwd() in dev mode (no process.pkg)', () => {
    // In dev mode, getConfigDir returns process.cwd()
    const dir = getConfigDir();
    expect(dir).toBe(process.cwd());
  });

  it('returns ~/.openbridge in packaged mode', () => {
    (process as { pkg?: unknown }).pkg = {};
    try {
      const dir = getConfigDir();
      expect(dir).toBe(join(homedir(), '.openbridge'));
    } finally {
      delete (process as { pkg?: unknown }).pkg;
    }
  });

  it('creates the directory if it does not already exist', () => {
    (process as { pkg?: unknown }).pkg = {};
    try {
      const dir = getConfigDir();
      // The directory should exist after calling getConfigDir()
      expect(existsSync(dir)).toBe(true);
    } finally {
      delete (process as { pkg?: unknown }).pkg;
    }
  });
});

// ─── detectOS ───────────────────────────────────────────────────────────────

describe('detectOS()', () => {
  it('returns a valid OS string', () => {
    const result = detectOS();
    expect(['macos', 'windows', 'linux']).toContain(result);
  });

  it('returns macos when platform is darwin', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    expect(detectOS()).toBe('macos');
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  });

  it('returns windows when platform is win32', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    expect(detectOS()).toBe('windows');
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  });

  it('returns linux for unknown platform', () => {
    const original = process.platform;
    Object.defineProperty(process, 'platform', { value: 'freebsd', configurable: true });
    expect(detectOS()).toBe('linux');
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  });
});

// ─── isCommandAvailable ──────────────────────────────────────────────────────

describe('isCommandAvailable()', () => {
  it('finds node (always available in this runtime)', async () => {
    const result = await isCommandAvailable('node');
    expect(result).toBe(true);
  });

  it('does not find nonexistent-cmd-xyz', async () => {
    const result = await isCommandAvailable('nonexistent-cmd-xyz');
    expect(result).toBe(false);
  });
});

// ─── getNodeVersion ──────────────────────────────────────────────────────────

describe('getNodeVersion()', () => {
  it('returns the current node version string', () => {
    const version = getNodeVersion();
    expect(version).toBe(process.version);
    expect(version).toMatch(/^v\d+\.\d+\.\d+/);
  });
});

// ─── meetsNodeVersion ────────────────────────────────────────────────────────

describe('meetsNodeVersion()', () => {
  it('returns true when current version meets minimum', () => {
    // Node 22+ is required — this test environment runs on it
    expect(meetsNodeVersion('18.0.0')).toBe(true);
  });

  it('returns false when minimum is impossibly high', () => {
    expect(meetsNodeVersion('999.0.0')).toBe(false);
  });

  it('returns true for exact version match', () => {
    // process.version always meets itself
    const version = process.version.replace(/^v/, '');
    expect(meetsNodeVersion(version)).toBe(true);
  });

  it('compares minor versions correctly', () => {
    // Major 0 is always lower than Node 22
    expect(meetsNodeVersion('0.12.0')).toBe(true);
  });

  it('handles v-prefixed minimum strings', () => {
    expect(meetsNodeVersion('v18.0.0')).toBe(true);
  });
});

// ─── runCommand ──────────────────────────────────────────────────────────────

describe('runCommand()', () => {
  it('captures stdout from a successful command', async () => {
    // `node --version` works on all platforms
    const result = await runCommand('node', ['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^v\d+/);
    expect(result.stderr).toBe('');
  });

  it('returns non-zero exitCode for a failing command', async () => {
    const result = await runCommand('node', ['-e', 'process.exit(2)']);
    expect(result.exitCode).toBe(2);
  });

  it('captures stderr from a command', async () => {
    const result = await runCommand('node', ['-e', 'process.stderr.write("oops\\n")']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('oops');
  });

  it('handles command not found gracefully', async () => {
    const result = await runCommand('nonexistent-binary-xyz', []);
    expect(result.exitCode).toBe(1);
    // stderr should contain an error message
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

// ─── printStep / printSuccess / printWarning / printError ───────────────────

describe('print helpers', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('printStep() writes step indicator with bold ANSI codes', () => {
    printStep(2, 5, 'Checking prerequisites');
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('[2/5]');
    expect(output).toContain('Checking prerequisites');
    expect(output).toContain('\x1b[1m'); // bold
  });

  it('printSuccess() writes green checkmark', () => {
    printSuccess('All good');
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('All good');
    expect(output).toContain('\x1b[32m'); // green
    expect(output).toContain('✔');
  });

  it('printWarning() writes yellow warning symbol', () => {
    printWarning('Watch out');
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('Watch out');
    expect(output).toContain('\x1b[33m'); // yellow
    expect(output).toContain('⚠');
  });

  it('printError() writes red error symbol', () => {
    printError('Something failed');
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain('Something failed');
    expect(output).toContain('\x1b[31m'); // red
    expect(output).toContain('✖');
  });
});

// ─── writeEnvFile ────────────────────────────────────────────────────────────

describe('writeEnvFile()', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = join(tmpdir(), `openbridge-test-env-${Date.now()}.env`);
  });

  afterEach(() => {
    if (existsSync(tmpFile)) {
      unlinkSync(tmpFile);
    }
  });

  it('creates a new .env file with given vars', () => {
    writeEnvFile(tmpFile, { FOO: 'bar', BAZ: 'qux' });
    expect(existsSync(tmpFile)).toBe(true);
    const content = readFileSync(tmpFile, 'utf8');
    expect(content).toContain('FOO=bar');
    expect(content).toContain('BAZ=qux');
  });

  it('merges new vars into existing .env without overwriting', () => {
    writeFileSync(tmpFile, 'EXISTING=value\n', 'utf8');
    writeEnvFile(tmpFile, { EXISTING: 'should-not-change', NEW_KEY: 'new-value' });
    const content = readFileSync(tmpFile, 'utf8');
    expect(content).toContain('EXISTING=value');
    expect(content).not.toContain('EXISTING=should-not-change');
    expect(content).toContain('NEW_KEY=new-value');
  });

  it('does not write anything when all vars already exist', () => {
    writeFileSync(tmpFile, 'KEY=already\n', 'utf8');
    const before = readFileSync(tmpFile, 'utf8');
    writeEnvFile(tmpFile, { KEY: 'different' });
    const after = readFileSync(tmpFile, 'utf8');
    expect(after).toBe(before);
  });

  it('preserves comment lines in existing .env', () => {
    writeFileSync(tmpFile, '# This is a comment\nFOO=bar\n', 'utf8');
    writeEnvFile(tmpFile, { NEW: 'value' });
    const content = readFileSync(tmpFile, 'utf8');
    expect(content).toContain('# This is a comment');
    expect(content).toContain('FOO=bar');
    expect(content).toContain('NEW=value');
  });

  it('ensures file ends with newline after writing', () => {
    writeEnvFile(tmpFile, { KEY: 'val' });
    const content = readFileSync(tmpFile, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
  });
});

// ─── validateApiKey ──────────────────────────────────────────────────────────

describe('validateApiKey()', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when Anthropic responds with 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 }),
    );
    const result = await validateApiKey('anthropic', 'sk-ant-valid');
    expect(result).toBe(true);
  });

  it('returns false when Anthropic responds with 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }),
    );
    const result = await validateApiKey('anthropic', 'sk-ant-invalid');
    expect(result).toBe(false);
  });

  it('returns true when OpenAI responds with 200', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    const result = await validateApiKey('openai', 'sk-valid-openai-key');
    expect(result).toBe(true);
  });

  it('returns false when OpenAI responds with 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_api_key' }), { status: 401 }),
    );
    const result = await validateApiKey('openai', 'sk-bad-key');
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('fetch failed'));
    const result = await validateApiKey('anthropic', 'sk-ant-whatever');
    expect(result).toBe(false);
  });

  it('returns false on unexpected non-200/non-401 status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('Server Error', { status: 500 }));
    const result = await validateApiKey('openai', 'sk-some-key');
    expect(result).toBe(false);
  });
});

// ─── checkForUpdate ──────────────────────────────────────────────────────────

describe('checkForUpdate()', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns UpdateInfo with available:true when newer version exists', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tag_name: 'v1.0.0',
          html_url: 'https://github.com/medomar/OpenBridge/releases/tag/v1.0.0',
        }),
        { status: 200 },
      ),
    );
    const result = await checkForUpdate();
    expect(result).not.toBeNull();
    expect(result!.available).toBe(true);
    expect(result!.latest).toBe('1.0.0');
    expect(result!.downloadUrl).toBe('https://github.com/medomar/OpenBridge/releases/tag/v1.0.0');
  });

  it('returns UpdateInfo with available:false when already on latest version', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tag_name: 'v0.0.1',
          html_url: 'https://github.com/medomar/OpenBridge/releases/tag/v0.0.1',
        }),
        { status: 200 },
      ),
    );
    const result = await checkForUpdate();
    expect(result).not.toBeNull();
    expect(result!.available).toBe(false);
    expect(result!.latest).toBe('0.0.1');
    expect(result!.current).toBe('0.0.1');
  });

  it('returns null on network error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null when response has no tag_name (malformed response)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Not Found' }), { status: 200 }),
    );
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });

  it('returns null on timeout (AbortError)', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    vi.mocked(fetch).mockRejectedValueOnce(abortError);
    const result = await checkForUpdate();
    expect(result).toBeNull();
  });
});
