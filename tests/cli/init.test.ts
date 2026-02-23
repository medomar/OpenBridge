import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildConfig, runInit } from '../../src/cli/init.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

/**
 * Creates a mock input stream that feeds lines one-at-a-time
 * only when data is requested (i.e. when readline calls question).
 * We listen for writes on the output stream as a signal that
 * readline has asked a question, then push the next line.
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
      // When readline writes a question prompt (contains '?') or a colon prompt, feed the next line
      if ((text.includes('?') || text.includes(':')) && lineIndex < lines.length) {
        const line = lines[lineIndex++]!;
        // Use setImmediate to avoid synchronous push during write
        setImmediate(() => {
          input.write(line + '\n');
          if (lineIndex >= lines.length) {
            // Signal end of input after a small delay
            setImmediate(() => input.end());
          }
        });
      }
      callback();
    },
  }) as Writable & { data: string };

  Object.defineProperty(output, 'data', {
    get: () => chunks.join(''),
  });

  return { input, output };
}

describe('buildConfig', () => {
  it('should build a whatsapp config with auth', () => {
    const config = buildConfig({
      connector: 'whatsapp',
      workspacePath: '/home/user/project',
      whitelist: ['+1234567890'],
      prefix: '/ai',
    });

    expect(config).toEqual({
      workspacePath: '/home/user/project',
      channels: [{ type: 'whatsapp', enabled: true }],
      auth: {
        whitelist: ['+1234567890'],
        prefix: '/ai',
      },
    });
  });

  it('should build a console config without auth', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/home/user/project',
    });

    expect(config).toEqual({
      workspacePath: '/home/user/project',
      channels: [{ type: 'console', enabled: true }],
    });
    expect(config).not.toHaveProperty('auth');
  });

  it('should build a webchat config without auth', () => {
    const config = buildConfig({
      connector: 'webchat',
      workspacePath: '/home/user/project',
    });

    expect(config).toEqual({
      workspacePath: '/home/user/project',
      channels: [{ type: 'webchat', enabled: true }],
    });
    expect(config).not.toHaveProperty('auth');
  });

  it('should support multiple whitelist numbers', () => {
    const config = buildConfig({
      connector: 'whatsapp',
      workspacePath: '/tmp/test',
      whitelist: ['+111', '+222', '+333'],
      prefix: '/bot',
    });

    expect(config).toEqual({
      workspacePath: '/tmp/test',
      channels: [{ type: 'whatsapp', enabled: true }],
      auth: {
        whitelist: ['+111', '+222', '+333'],
        prefix: '/bot',
      },
    });
  });
});

describe('runInit', () => {
  const testDir = tmpdir();
  let testConfigPath: string;

  beforeEach(() => {
    testConfigPath = join(testDir, `openbridge-test-${Date.now()}.json`);
    vi.mocked(existsSync).mockReturnValue(false);
  });

  afterEach(async () => {
    try {
      await unlink(testConfigPath);
    } catch {
      // File may not exist
    }
  });

  it('should generate a whatsapp config from interactive input', async () => {
    const { input, output } = createLineFeeder([
      'whatsapp', // connector
      '/home/user/my-project', // workspace path
      '+1234567890', // whitelist
      '/ai', // prefix
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toHaveProperty('workspacePath', '/home/user/my-project');
    expect(config).toHaveProperty('channels');
    expect(config).toHaveProperty('auth');

    const channels = config['channels'] as Array<{ type: string; enabled: boolean }>;
    expect(channels[0]?.type).toBe('whatsapp');
    expect(channels[0]?.enabled).toBe(true);

    const auth = config['auth'] as { whitelist: string[]; prefix: string };
    expect(auth.whitelist).toEqual(['+1234567890']);
    expect(auth.prefix).toBe('/ai');
  });

  it('should generate a console config without auth', async () => {
    const { input, output } = createLineFeeder([
      'console', // connector
      '/home/user/my-project', // workspace path
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toHaveProperty('workspacePath', '/home/user/my-project');

    const channels = config['channels'] as Array<{ type: string }>;
    expect(channels[0]?.type).toBe('console');
    expect(config).not.toHaveProperty('auth');
  });

  it('should default to console when connector answer is empty', async () => {
    const { input, output } = createLineFeeder([
      '', // empty = default console
      '/home/user/project', // workspace path
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const channels = config['channels'] as Array<{ type: string }>;
    expect(channels[0]?.type).toBe('console');
    expect(config).not.toHaveProperty('auth');
  });

  it('should apply prefix default when user presses enter', async () => {
    const { input, output } = createLineFeeder([
      'whatsapp', // connector
      '/home/user/project', // workspace path
      '+555', // whitelist
      '', // prefix — default /ai
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const auth = config['auth'] as { prefix: string };
    expect(auth.prefix).toBe('/ai');
  });

  it('should abort if workspace path is empty', async () => {
    const { input, output } = createLineFeeder([
      '', // connector (default console)
      '', // empty workspace path
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('workspace path is required');
  });

  it('should abort if whitelist is empty', async () => {
    const { input, output } = createLineFeeder([
      'whatsapp', // connector
      '/home/user/project', // workspace path
      '', // empty whitelist
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('at least one phone number is required');
  });

  it('should abort on invalid connector', async () => {
    const { input, output } = createLineFeeder([
      'telegram', // invalid connector
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('invalid connector');
  });

  it('should abort if user declines overwrite', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const { input, output } = createLineFeeder(['n']);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('Aborted');
  });

  it('should proceed if user confirms overwrite', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const { input, output } = createLineFeeder([
      'y', // confirm overwrite
      'whatsapp', // connector
      '/home/user/project', // workspace path
      '+1234567890', // whitelist
      '', // prefix
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toHaveProperty('workspacePath', '/home/user/project');
    expect(config).toHaveProperty('channels');
    expect(config).toHaveProperty('auth');
  });

  it('should show updated success message with both start options', async () => {
    const { input, output } = createLineFeeder(['console', '/home/user/project']);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('npm run dev');
    expect(output.data).toContain('node dist/index.js');
  });
});
