/**
 * OB-1231: Unit tests for the enhanced init() wizard
 *
 * Covers:
 * - checkPrerequisites(): exits on missing Node, exits on missing npm, warns on missing git
 * - detectAITools(): reports available / missing tools correctly, calls the right print helpers
 * - health check is called with the generated config path inside runInit()
 * - .env file is written with the Codex API key via setupCodexAuth()
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInterface } from 'node:readline';
import { PassThrough, Writable } from 'node:stream';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { checkPrerequisites, detectAITools, runInit, setupCodexAuth } from '../../src/cli/init.js';
import {
  isCommandAvailable,
  meetsNodeVersion,
  printError,
  printSuccess,
  printWarning,
  runCommand,
} from '../../src/cli/utils.js';
import { runHealthCheck } from '../../src/core/health.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, mkdir: vi.fn(async () => undefined) };
});

vi.mock('../../src/cli/utils.js', () => ({
  detectOS: vi.fn(() => 'linux' as const),
  getNodeVersion: vi.fn(() => 'v22.0.0'),
  isCommandAvailable: vi.fn(async (cmd: string) => cmd === 'npm' || cmd === 'git'),
  meetsNodeVersion: vi.fn(() => true),
  printStep: vi.fn(),
  printSuccess: vi.fn(),
  printWarning: vi.fn(),
  printError: vi.fn(),
  runCommand: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
}));

vi.mock('../../src/core/health.js', () => ({
  runHealthCheck: vi.fn(() => ({
    passed: true,
    checks: [{ name: 'Config file', passed: true, message: 'config.json is valid' }],
  })),
}));

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Creates a mock input stream that feeds lines one-at-a-time only when the
 * output stream is written to (i.e. when readline prompts the user).
 */
function createLineFeeder(lines: string[]): {
  input: PassThrough;
  output: Writable & { data: string };
} {
  const input = new PassThrough();
  const chunks: string[] = [];
  let lineIndex = 0;

  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      const text = chunk.toString();
      if ((text.includes('?') || text.includes(':')) && lineIndex < lines.length) {
        const line = lines[lineIndex++]!;
        setImmediate(() => {
          input.write(line + '\n');
          if (lineIndex >= lines.length) {
            setImmediate(() => input.end());
          }
        });
      }
      callback();
    },
  }) as Writable & { data: string };

  Object.defineProperty(output, 'data', { get: () => chunks.join('') });

  return { input, output };
}

// ─── checkPrerequisites() ────────────────────────────────────────────────────

describe('checkPrerequisites()', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: string | number | null) => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it('exits with code 1 when Node.js version is below 22', async () => {
    vi.mocked(meetsNodeVersion).mockReturnValueOnce(false);

    await expect(checkPrerequisites()).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(vi.mocked(printError)).toHaveBeenCalledWith(expect.stringContaining('Node.js >= 22'));
  });

  it('exits with code 1 when npm is not available', async () => {
    vi.mocked(meetsNodeVersion).mockReturnValueOnce(true);
    vi.mocked(isCommandAvailable).mockImplementation(async (cmd: string) => {
      // npm unavailable; everything else is
      return cmd !== 'npm';
    });

    await expect(checkPrerequisites()).rejects.toThrow();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(vi.mocked(printError)).toHaveBeenCalledWith(expect.stringContaining('npm'));
  });

  it('warns but does not exit when git is not available', async () => {
    vi.mocked(meetsNodeVersion).mockReturnValueOnce(true);
    vi.mocked(isCommandAvailable).mockImplementation(async (cmd: string) => {
      return cmd === 'npm'; // git unavailable
    });

    const result = await checkPrerequisites();

    expect(result).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(vi.mocked(printWarning)).toHaveBeenCalledWith(expect.stringContaining('git'));
  });

  it('returns true and prints success for all checks when prerequisites are met', async () => {
    vi.mocked(meetsNodeVersion).mockReturnValueOnce(true);
    vi.mocked(isCommandAvailable).mockResolvedValue(true);

    const result = await checkPrerequisites();

    expect(result).toBe(true);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(vi.mocked(printSuccess)).toHaveBeenCalledWith(expect.stringContaining('Node.js'));
    expect(vi.mocked(printSuccess)).toHaveBeenCalledWith(expect.stringContaining('npm'));
    expect(vi.mocked(printSuccess)).toHaveBeenCalledWith(expect.stringContaining('git'));
  });
});

// ─── detectAITools() ─────────────────────────────────────────────────────────

describe('detectAITools()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all true when every AI tool is found', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValue(true);

    const status = await detectAITools();

    expect(status).toEqual({ claude: true, codex: true, aider: true });
  });

  it('returns all false when no AI tool is found', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValue(false);

    const status = await detectAITools();

    expect(status).toEqual({ claude: false, codex: false, aider: false });
  });

  it('returns partial status when only some tools are available', async () => {
    vi.mocked(isCommandAvailable).mockImplementation(async (cmd: string) => {
      return cmd === 'claude' || cmd === 'codex';
    });

    const status = await detectAITools();

    expect(status.claude).toBe(true);
    expect(status.codex).toBe(true);
    expect(status.aider).toBe(false);
  });

  it('calls printSuccess for found tools and printWarning for missing ones', async () => {
    vi.mocked(isCommandAvailable).mockImplementation(async (cmd: string) => {
      return cmd === 'claude'; // only claude found
    });

    await detectAITools();

    expect(vi.mocked(printSuccess)).toHaveBeenCalledWith(expect.stringContaining('claude'));
    expect(vi.mocked(printWarning)).toHaveBeenCalledWith(expect.stringContaining('codex'));
    expect(vi.mocked(printWarning)).toHaveBeenCalledWith(expect.stringContaining('aider'));
  });
});

// ─── runInit() — health check integration ────────────────────────────────────

describe('runInit() — health check integration', () => {
  let testConfigPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testConfigPath = join(tmpdir(), `ob-wizard-hc-${Date.now()}.json`);
    // Reset utils mocks to safe defaults so checkPrerequisites() passes cleanly
    vi.mocked(meetsNodeVersion).mockReturnValue(true);
    vi.mocked(isCommandAvailable).mockImplementation(
      async (cmd: string) => cmd === 'npm' || cmd === 'git',
    );
    vi.mocked(existsSync).mockImplementation((path) => {
      if (path === testConfigPath) return false;
      return true; // workspace path exists
    });
  });

  afterEach(async () => {
    try {
      await unlink(testConfigPath);
    } catch {
      // file may not exist
    }
  });

  it('calls runHealthCheck with the generated config path', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '/home/user/project', // workspace path
      '5', // connector: Console
      'n', // MCP: skip
      'Y', // Visibility: auto-hide sensitive files
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(vi.mocked(runHealthCheck)).toHaveBeenCalledWith(testConfigPath);
  });

  it('prints "you\'re ready!" when health check passes', async () => {
    vi.mocked(runHealthCheck).mockReturnValueOnce({
      passed: true,
      checks: [{ name: 'Config file', passed: true, message: 'config.json is valid' }],
    });

    const { input, output } = createLineFeeder(['4', '/home/user/project', '5', 'n', 'Y']);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(vi.mocked(printSuccess)).toHaveBeenCalledWith(expect.stringContaining("you're ready"));
  });

  it('prints issue count when health check reports failures', async () => {
    vi.mocked(runHealthCheck).mockReturnValueOnce({
      passed: false,
      checks: [
        { name: 'Config file', passed: true, message: 'config.json is valid' },
        { name: 'AI tools', passed: false, message: 'No AI tools found' },
      ],
    });

    const { input, output } = createLineFeeder(['4', '/home/user/project', '5', 'n', 'Y']);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(vi.mocked(printWarning)).toHaveBeenCalledWith(expect.stringContaining('1 issue'));
  });
});

// ─── setupCodexAuth() ────────────────────────────────────────────────────────

describe('setupCodexAuth()', () => {
  let tmpEnvPath: string;
  let savedApiKey: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpEnvPath = join(tmpdir(), `ob-codex-auth-${Date.now()}.env`);
    savedApiKey = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(async () => {
    // Restore original env var
    if (savedApiKey !== undefined) {
      process.env['OPENAI_API_KEY'] = savedApiKey;
    } else {
      delete process.env['OPENAI_API_KEY'];
    }
    try {
      await unlink(tmpEnvPath);
    } catch {
      // file may not exist
    }
  });

  it('skips auth setup when codex is not available', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(false);

    const { input, output } = createLineFeeder([]);
    const rl = createInterface({ input, output });
    const written: string[] = [];

    await setupCodexAuth(rl, (t) => written.push(t), tmpEnvPath);
    rl.close();

    expect(written.join('')).toBe('');
    expect(vi.mocked(runCommand)).not.toHaveBeenCalled();
  });

  it('shows already authenticated when OPENAI_API_KEY env var is set', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    process.env['OPENAI_API_KEY'] = 'sk-already-set';

    const { input, output } = createLineFeeder([]);
    const rl = createInterface({ input, output });

    await setupCodexAuth(rl, () => {}, tmpEnvPath);
    rl.close();

    expect(vi.mocked(printSuccess)).toHaveBeenCalledWith(
      expect.stringContaining('already authenticated'),
    );
    expect(vi.mocked(runCommand)).not.toHaveBeenCalled();
  });

  it('writes OPENAI_API_KEY to .env when user pastes a valid key', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    // codex auth status fails → not authenticated
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });

    const { input, output } = createLineFeeder(['2', 'sk-openai-key-123']);
    const rl = createInterface({ input, output });

    await setupCodexAuth(rl, () => {}, tmpEnvPath);
    rl.close();

    const envContent = await readFile(tmpEnvPath, 'utf-8');
    expect(envContent).toContain('OPENAI_API_KEY=sk-openai-key-123');
    expect(vi.mocked(printSuccess)).toHaveBeenCalledWith(expect.stringContaining('OPENAI_API_KEY'));
  });

  it('warns when API key does not start with sk-', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });

    const { input, output } = createLineFeeder(['2', 'invalid-key-format']);
    const rl = createInterface({ input, output });

    await setupCodexAuth(rl, () => {}, tmpEnvPath);
    rl.close();

    expect(vi.mocked(printWarning)).toHaveBeenCalledWith(
      expect.stringContaining('Invalid key format'),
    );
  });

  it('skips auth when user picks option 3 (skip)', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });

    const { input, output } = createLineFeeder(['3']);
    const rl = createInterface({ input, output });
    const written: string[] = [];

    await setupCodexAuth(rl, (t) => written.push(t), tmpEnvPath);
    rl.close();

    expect(written.join('')).toContain('Skipping');
    // Only the `codex auth status` call should have run
    expect(vi.mocked(runCommand)).toHaveBeenCalledTimes(1);
  });
});
