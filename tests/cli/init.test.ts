import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildConfig,
  runInit,
  promptAIToolInstallation,
  setupClaudeAuth,
} from '../../src/cli/init.js';
import {
  runCommand,
  detectOS,
  isCommandAvailable,
  printSuccess,
  printWarning,
} from '../../src/cli/utils.js';

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

  it('should include mcp section when mcpServers provided', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/home/user/project',
      mcpServers: [{ name: 'canva', command: 'npx -y @anthropic/canva-mcp-server' }],
    });

    expect(config).toHaveProperty('mcp');
    const mcp = config['mcp'] as Record<string, unknown>;
    expect(mcp['enabled']).toBe(true);
    expect(mcp['servers']).toEqual([
      { name: 'canva', command: 'npx -y @anthropic/canva-mcp-server' },
    ]);
    expect(mcp).not.toHaveProperty('configPath');
  });

  it('should include mcp section when mcpConfigPath provided', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/home/user/project',
      mcpConfigPath: '~/.claude/claude_desktop_config.json',
    });

    expect(config).toHaveProperty('mcp');
    const mcp = config['mcp'] as Record<string, unknown>;
    expect(mcp['enabled']).toBe(true);
    expect(mcp['servers']).toEqual([]);
    expect(mcp['configPath']).toBe('~/.claude/claude_desktop_config.json');
  });

  it('should include both servers and configPath in mcp section', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/home/user/project',
      mcpServers: [{ name: 'gmail', command: 'npx -y @anthropic/gmail-mcp-server' }],
      mcpConfigPath: '~/.claude/claude_desktop_config.json',
    });

    const mcp = config['mcp'] as Record<string, unknown>;
    expect(mcp['servers']).toHaveLength(1);
    expect(mcp['configPath']).toBe('~/.claude/claude_desktop_config.json');
  });

  it('should not include mcp section when no mcp data provided', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/home/user/project',
    });

    expect(config).not.toHaveProperty('mcp');
  });

  it('should include connector options in channel when connectorOptions provided', () => {
    const config = buildConfig({
      connector: 'telegram',
      workspacePath: '/home/user/project',
      connectorOptions: { token: '123456:ABC' },
    });

    const channels = config['channels'] as Array<{
      type: string;
      options?: Record<string, unknown>;
    }>;
    expect(channels[0]?.options).toEqual({ token: '123456:ABC' });
  });

  it('should not include options field when connectorOptions is empty', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/home/user/project',
      connectorOptions: {},
    });

    const channels = config['channels'] as Array<{ type: string; options?: unknown }>;
    expect(channels[0]).not.toHaveProperty('options');
  });
});

describe('runInit', () => {
  const testDir = tmpdir();
  let testConfigPath: string;

  beforeEach(() => {
    testConfigPath = join(testDir, `openbridge-test-${Date.now()}.json`);
    vi.clearAllMocks();
    // Config file doesn't exist (no overwrite prompt), but workspace paths do exist
    vi.mocked(existsSync).mockImplementation((path) => {
      if (path === testConfigPath) return false;
      return true;
    });
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
      '4', // AI tool installation: skip
      '1', // connector: WhatsApp
      '/home/user/my-project', // workspace path
      '+1234567890', // whitelist
      '/ai', // prefix
      'n', // MCP: skip
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
      '4', // AI tool installation: skip
      '5', // connector: Console
      '/home/user/my-project', // workspace path
      'n', // MCP: skip
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
      '4', // AI tool installation: skip
      '', // empty = default console
      '/home/user/project', // workspace path
      'n', // MCP: skip
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
      '4', // AI tool installation: skip
      '1', // connector: WhatsApp
      '/home/user/project', // workspace path
      '+555', // whitelist
      '', // prefix — default /ai
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const auth = config['auth'] as { prefix: string };
    expect(auth.prefix).toBe('/ai');
  });

  it('should use current directory as default when workspace path is empty', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '', // connector (default console)
      '', // empty workspace path → defaults to cwd
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    // Should use process.cwd() as default workspace path
    expect(typeof config['workspacePath']).toBe('string');
    expect((config['workspacePath'] as string).length).toBeGreaterThan(0);
  });

  it('should abort if whitelist is empty', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '1', // connector: WhatsApp
      '/home/user/project', // workspace path
      '', // empty whitelist
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('at least one phone number is required');
  });

  it('should abort on invalid connector', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      'slack', // invalid connector
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('invalid connector');
  });

  it('should abort if user declines overwrite', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      'n', // decline overwrite
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('Aborted');
  });

  it('should proceed if user confirms overwrite', async () => {
    vi.mocked(existsSync).mockReturnValue(true);

    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      'y', // confirm overwrite
      '1', // connector: WhatsApp
      '/home/user/project', // workspace path
      '+1234567890', // whitelist
      '', // prefix
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toHaveProperty('workspacePath', '/home/user/project');
    expect(config).toHaveProperty('channels');
    expect(config).toHaveProperty('auth');
  });

  it('should generate config for telegram connector with bot token in options', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '2', // connector: Telegram
      '/home/user/project', // workspace path
      '123456:ABC-DEF', // bot token
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const channels = config['channels'] as Array<{
      type: string;
      options?: { token?: string };
    }>;
    expect(channels[0]?.type).toBe('telegram');
    expect(channels[0]?.options?.token).toBe('123456:ABC-DEF');
  });

  it('should abort if telegram bot token is empty', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '2', // connector: Telegram
      '/home/user/project', // workspace path
      '', // empty bot token
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('bot token is required');
  });

  it('should generate config for discord connector with token and applicationId in options', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '3', // connector: Discord
      '/home/user/project', // workspace path
      'MTk4NjIy.discord-token', // bot token
      '123456789012345678', // application ID
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const channels = config['channels'] as Array<{
      type: string;
      options?: { token?: string; applicationId?: string };
    }>;
    expect(channels[0]?.type).toBe('discord');
    expect(channels[0]?.options?.token).toBe('MTk4NjIy.discord-token');
    expect(channels[0]?.options?.applicationId).toBe('123456789012345678');
  });

  it('should abort if discord bot token is empty', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '3', // connector: Discord
      '/home/user/project', // workspace path
      '', // empty bot token
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('bot token is required');
  });

  it('should generate discord config without applicationId when skipped', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '3', // connector: Discord
      '/home/user/project', // workspace path
      'some-bot-token', // bot token
      '', // skip application ID
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const channels = config['channels'] as Array<{
      type: string;
      options?: { token?: string; applicationId?: string };
    }>;
    expect(channels[0]?.type).toBe('discord');
    expect(channels[0]?.options?.token).toBe('some-bot-token');
    expect(channels[0]?.options).not.toHaveProperty('applicationId');
  });

  it('should generate webchat config with custom port in options', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '4', // connector: WebChat
      '/home/user/project', // workspace path
      '8080', // custom port
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const channels = config['channels'] as Array<{
      type: string;
      options?: { port?: number };
    }>;
    expect(channels[0]?.type).toBe('webchat');
    expect(channels[0]?.options?.port).toBe(8080);
  });

  it('should use default port 3000 for webchat when no port entered', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '4', // connector: WebChat
      '/home/user/project', // workspace path
      '', // empty → default port 3000
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const channels = config['channels'] as Array<{
      type: string;
      options?: { port?: number };
    }>;
    expect(channels[0]?.options?.port).toBe(3000);
  });

  it('should warn when telegram token format is invalid', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '2', // connector: Telegram
      '/home/user/project', // workspace path
      'not-a-valid-token', // invalid token format
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('format looks unexpected');
  });

  it('should explain whatsapp QR code flow during setup', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '1', // connector: WhatsApp
      '/home/user/project', // workspace path
      '+1234567890', // whitelist
      '/ai', // prefix
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('QR code');
    expect(output.data).toContain('No token needed');
  });

  it('should show updated success message with both start options', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '5', // connector: Console
      '/home/user/project',
      'n', // MCP: skip
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    expect(output.data).toContain('npm run dev');
    expect(output.data).toContain('node dist/index.js');
  });

  it('should generate mcp section when user enables MCP with servers', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '5', // connector: Console
      '/home/user/project', // workspace path
      'y', // Enable MCP
      'canva', // server name
      'npx -y @anthropic/canva-mcp-server', // command
      'done', // finish servers
      '', // skip configPath
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toHaveProperty('mcp');
    const mcp = config['mcp'] as Record<string, unknown>;
    expect(mcp['enabled']).toBe(true);
    const servers = mcp['servers'] as Array<{ name: string; command: string }>;
    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('canva');
    expect(servers[0]?.command).toBe('npx -y @anthropic/canva-mcp-server');
    expect(mcp).not.toHaveProperty('configPath');
  });

  it('should generate mcp section with configPath when provided', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '5', // connector: Console
      '/home/user/project', // workspace path
      'y', // Enable MCP
      'done', // no servers
      '~/.claude/claude_desktop_config.json', // configPath
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).toHaveProperty('mcp');
    const mcp = config['mcp'] as Record<string, unknown>;
    expect(mcp['configPath']).toBe('~/.claude/claude_desktop_config.json');
    expect(mcp['servers']).toEqual([]);
  });

  it('should not add mcp section when user enables MCP but provides nothing', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '5', // connector: Console
      '/home/user/project', // workspace path
      'y', // Enable MCP
      'done', // no servers
      '', // skip configPath
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).not.toHaveProperty('mcp');
  });

  it('should generate mcp section with multiple servers', async () => {
    const { input, output } = createLineFeeder([
      '4', // AI tool installation: skip
      '5', // connector: Console
      '/home/user/project', // workspace path
      'y', // Enable MCP
      'canva', // server 1 name
      'npx -y @anthropic/canva-mcp-server', // server 1 command
      'gmail', // server 2 name
      'npx -y @anthropic/gmail-mcp-server', // server 2 command
      'done', // finish servers
      '', // skip configPath
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const mcp = config['mcp'] as Record<string, unknown>;
    const servers = mcp['servers'] as Array<{ name: string; command: string }>;
    expect(servers).toHaveLength(2);
    expect(servers[0]?.name).toBe('canva');
    expect(servers[1]?.name).toBe('gmail');
  });
});

// ── promptAIToolInstallation() ────────────────────────────────────────────────

describe('promptAIToolInstallation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRl(lines: string[]): {
    rl: ReturnType<typeof createInterface>;
    written: string[];
  } {
    const { input, output } = createLineFeeder(lines);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    return { rl, written };
  }

  it('shows "no tools detected" message when no tools are installed', async () => {
    const { input, output } = createLineFeeder(['4']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(written.join('')).toContain('No AI tools detected');
  });

  it('shows install menu when no tools are installed', async () => {
    const { input, output } = createLineFeeder(['4']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    const text = written.join('');
    expect(text).toContain('Claude Code');
    expect(text).toContain('OpenAI Codex');
    expect(text).toContain('Skip');
  });

  it('skips installation when user picks 4', async () => {
    const { input, output } = createLineFeeder(['4']);
    const rl = createInterface({ input, output });
    const write = (t: string) => void t;

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(vi.mocked(runCommand)).not.toHaveBeenCalled();
  });

  it('installs Claude Code when user picks 1', async () => {
    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });
    const write = (t: string) => void t;

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(vi.mocked(runCommand)).toHaveBeenCalledWith('npm', [
      'install',
      '-g',
      '@anthropic-ai/claude-code',
    ]);
  });

  it('installs OpenAI Codex when user picks 2', async () => {
    const { input, output } = createLineFeeder(['2']);
    const rl = createInterface({ input, output });
    const write = (t: string) => void t;

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(vi.mocked(runCommand)).toHaveBeenCalledWith('npm', ['install', '-g', '@openai/codex']);
  });

  it('installs both tools when user picks 3', async () => {
    const { input, output } = createLineFeeder(['3']);
    const rl = createInterface({ input, output });
    const write = (t: string) => void t;

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    const mock = vi.mocked(runCommand);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock).toHaveBeenCalledWith('npm', ['install', '-g', '@anthropic-ai/claude-code']);
    expect(mock).toHaveBeenCalledWith('npm', ['install', '-g', '@openai/codex']);
  });

  it('skips installation on invalid choice', async () => {
    const { input, output } = createLineFeeder(['9']);
    const rl = createInterface({ input, output });
    const write = (t: string) => void t;

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(vi.mocked(runCommand)).not.toHaveBeenCalled();
  });

  it('shows installed tools when some are available', async () => {
    const { input, output } = createLineFeeder(['n']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await promptAIToolInstallation(rl, { claude: true, codex: false, aider: false }, write);
    rl.close();

    expect(written.join('')).toContain('AI tools found');
    expect(written.join('')).toContain('claude');
  });

  it('skips additional install when user answers n (some tools available)', async () => {
    const { input, output } = createLineFeeder(['n']);
    const rl = createInterface({ input, output });
    const write = (t: string) => void t;

    await promptAIToolInstallation(rl, { claude: true, codex: false, aider: false }, write);
    rl.close();

    expect(vi.mocked(runCommand)).not.toHaveBeenCalled();
  });

  it('shows install menu when user answers y with some tools available', async () => {
    const { input, output } = createLineFeeder(['y', '4']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await promptAIToolInstallation(rl, { claude: true, codex: false, aider: false }, write);
    rl.close();

    const text = written.join('');
    expect(text).toContain('Claude Code');
    expect(text).toContain('OpenAI Codex');
  });

  it('shows installing message when tool is being installed', async () => {
    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(written.join('')).toContain('Installing Claude Code');
  });

  it('shows exact npm error message on install failure', async () => {
    vi.mocked(runCommand).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'npm ERR! code EACCES\nnpm ERR! permission denied',
    });

    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(written.join('')).toContain('npm ERR! code EACCES');
  });

  it('suggests sudo retry on unix when install fails', async () => {
    vi.mocked(runCommand).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'permission denied',
    });

    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(written.join('')).toContain('sudo npm install -g');
  });

  it('does not suggest sudo on windows when install fails', async () => {
    vi.mocked(detectOS).mockReturnValueOnce('windows');
    vi.mocked(runCommand).mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'permission denied',
    });

    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(written.join('')).not.toContain('sudo npm install -g');
  });

  it('suggests npx alternative when install fails', async () => {
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error' });

    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(written.join('')).toContain('npx @anthropic-ai/claude-code');
  });

  it('shows manual install link when install fails', async () => {
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error' });

    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(written.join('')).toContain('npmjs.com');
  });

  it('does not block wizard on install failure', async () => {
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error' });

    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });
    const written: string[] = [];
    const write = (t: string) => written.push(t);

    await expect(
      promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write),
    ).resolves.toBeUndefined();
    rl.close();

    expect(written.join('')).toContain('Continuing setup');
  });

  it('warns when all installs fail and no tools pre-installed', async () => {
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error' });

    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });
    const write = (t: string) => void t;

    await promptAIToolInstallation(rl, { claude: false, codex: false, aider: false }, write);
    rl.close();

    expect(vi.mocked(printWarning)).toHaveBeenCalledWith(expect.stringContaining('at least one'));
  });

  it('does not warn when install fails but a tool was pre-installed', async () => {
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error' });

    const { input, output } = createLineFeeder(['y', '2']);
    const rl = createInterface({ input, output });
    const write = (t: string) => void t;

    await promptAIToolInstallation(rl, { claude: true, codex: false, aider: false }, write);
    rl.close();

    expect(vi.mocked(printWarning)).not.toHaveBeenCalledWith(
      expect.stringContaining('at least one'),
    );
  });

  void makeRl; // suppress unused warning
});

// ── setupClaudeAuth() ─────────────────────────────────────────────────────────

describe('setupClaudeAuth', () => {
  let tmpEnvPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tmpEnvPath = join(tmpdir(), `openbridge-auth-${Date.now()}.env`);
  });

  afterEach(async () => {
    try {
      await unlink(tmpEnvPath);
    } catch {
      // file may not exist
    }
  });

  it('skips auth setup when claude is not available', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(false);
    const { input, output } = createLineFeeder([]);
    const rl = createInterface({ input, output });
    const written: string[] = [];

    await setupClaudeAuth(rl, (t) => written.push(t), tmpEnvPath);
    rl.close();

    expect(written.join('')).toBe('');
    expect(vi.mocked(runCommand)).not.toHaveBeenCalled();
  });

  it('shows already authenticated when auth status succeeds', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 0, stdout: 'Logged in', stderr: '' });
    const { input, output } = createLineFeeder([]);
    const rl = createInterface({ input, output });

    await setupClaudeAuth(rl, () => {}, tmpEnvPath);
    rl.close();

    expect(vi.mocked(printSuccess)).toHaveBeenCalledWith(
      expect.stringContaining('already authenticated'),
    );
  });

  it('shows auth options and URL when not authenticated', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });
    const { input, output } = createLineFeeder(['3']);
    const rl = createInterface({ input, output });
    const written: string[] = [];

    await setupClaudeAuth(rl, (t) => written.push(t), tmpEnvPath);
    rl.close();

    const text = written.join('');
    expect(text).toContain('console.anthropic.com');
    expect(text).toContain('claude auth login');
  });

  it('runs claude auth login when user picks 1', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    vi.mocked(runCommand)
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' }) // auth status
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // auth login
    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });

    await setupClaudeAuth(rl, () => {}, tmpEnvPath);
    rl.close();

    expect(vi.mocked(runCommand)).toHaveBeenCalledWith('claude', ['auth', 'login']);
    expect(vi.mocked(printSuccess)).toHaveBeenCalledWith(expect.stringContaining('authenticated'));
  });

  it('shows warning when claude auth login fails', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    vi.mocked(runCommand)
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' }) // auth status
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'login failed' }); // auth login fails
    const { input, output } = createLineFeeder(['1']);
    const rl = createInterface({ input, output });

    await setupClaudeAuth(rl, () => {}, tmpEnvPath);
    rl.close();

    expect(vi.mocked(printWarning)).toHaveBeenCalled();
  });

  it('writes ANTHROPIC_API_KEY to .env when user picks 2', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });
    const { input, output } = createLineFeeder(['2', 'sk-ant-test123']);
    const rl = createInterface({ input, output });

    await setupClaudeAuth(rl, () => {}, tmpEnvPath);
    rl.close();

    const envContent = await readFile(tmpEnvPath, 'utf-8');
    expect(envContent).toContain('ANTHROPIC_API_KEY=sk-ant-test123');
  });

  it('warns when no API key is entered on choice 2', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });
    const { input, output } = createLineFeeder(['2', '']);
    const rl = createInterface({ input, output });

    await setupClaudeAuth(rl, () => {}, tmpEnvPath);
    rl.close();

    expect(vi.mocked(printWarning)).toHaveBeenCalledWith(expect.stringContaining('No API key'));
  });

  it('skips auth and shows skip message when user picks 3', async () => {
    vi.mocked(isCommandAvailable).mockResolvedValueOnce(true);
    vi.mocked(runCommand).mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });
    const { input, output } = createLineFeeder(['3']);
    const rl = createInterface({ input, output });
    const written: string[] = [];

    await setupClaudeAuth(rl, (t) => written.push(t), tmpEnvPath);
    rl.close();

    expect(written.join('')).toContain('Skipping');
    expect(vi.mocked(runCommand)).toHaveBeenCalledTimes(1); // only auth status check
  });
});
