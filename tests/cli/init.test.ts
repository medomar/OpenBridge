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
  it('should build a valid config object from answers', () => {
    const config = buildConfig({
      workspacePath: '/home/user/project',
      whitelist: ['+1234567890'],
      prefix: '/ai',
      sessionName: 'my-session',
      logLevel: 'debug',
      rateLimit: true,
      healthCheck: false,
    });

    expect(config).toEqual({
      connectors: [
        {
          type: 'whatsapp',
          enabled: true,
          options: { sessionName: 'my-session', sessionPath: '.wwebjs_auth' },
        },
      ],
      providers: [
        {
          type: 'claude-code',
          enabled: true,
          options: { workspacePath: '/home/user/project', maxTokens: 4096 },
        },
      ],
      defaultProvider: 'claude-code',
      auth: {
        whitelist: ['+1234567890'],
        prefix: '/ai',
        rateLimit: { enabled: true, maxMessages: 10, windowMs: 60000 },
      },
      queue: { maxRetries: 3, retryDelayMs: 1000 },
      health: { enabled: false, port: 8080 },
      logLevel: 'debug',
    });
  });

  it('should support multiple whitelist numbers', () => {
    const config = buildConfig({
      workspacePath: '/tmp/test',
      whitelist: ['+111', '+222', '+333'],
      prefix: '/bot',
      sessionName: 'openbridge-default',
      logLevel: 'info',
      rateLimit: false,
      healthCheck: true,
    });

    expect(config.auth).toEqual(
      expect.objectContaining({
        whitelist: ['+111', '+222', '+333'],
        prefix: '/bot',
      }),
    );
    expect(config.health).toEqual({ enabled: true, port: 8080 });
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

  it('should generate a config file from interactive input', async () => {
    const { input, output } = createLineFeeder([
      '/home/user/my-project', // workspace path
      '+1234567890', // whitelist
      '/ai', // prefix
      'test-session', // session name
      'info', // log level
      'Y', // rate limiting
      'n', // health check
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toHaveProperty('connectors');
    expect(config).toHaveProperty('providers');
    expect(config).toHaveProperty('defaultProvider', 'claude-code');

    const providers = config['providers'] as Array<{ options: { workspacePath: string } }>;
    expect(providers[0]?.options.workspacePath).toBe('/home/user/my-project');
  });

  it('should apply defaults when user presses enter', async () => {
    const { input, output } = createLineFeeder([
      '/home/user/project', // workspace path (required)
      '+555', // whitelist
      '', // prefix — default /ai
      '', // session name — default openbridge-default
      '', // log level — default info
      '', // rate limiting — default Y
      '', // health check — default N
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const auth = config['auth'] as { prefix: string; rateLimit: { enabled: boolean } };
    expect(auth.prefix).toBe('/ai');
    expect(auth.rateLimit.enabled).toBe(true);
    expect(config['logLevel']).toBe('info');
  });

  it('should abort if workspace path is empty', async () => {
    const { input, output } = createLineFeeder(['']);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('workspace path is required');
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
      '/home/user/project', // workspace path
      '+1234567890', // whitelist
      '', // prefix
      '', // session name
      '', // log level
      '', // rate limiting
      '', // health check
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toHaveProperty('defaultProvider', 'claude-code');
  });
});
