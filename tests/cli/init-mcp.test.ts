/**
 * Unit tests for MCP configuration in the CLI init command (OB-1080):
 * - buildConfig() correctly generates (or omits) the mcp section
 * - runInit() interactive flow captures MCP servers and configPath
 * - Skipping MCP produces no mcp field
 * - Multiple servers are collected in the servers array
 * - configPath import is captured in the config
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildConfig, runInit } from '../../src/cli/init.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<object>();
  return { ...actual, existsSync: vi.fn(() => false) };
});

/**
 * Creates a mock input stream that feeds lines on demand.
 * Each time readline writes a prompt containing '?' or ':', the next line is pushed.
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

  Object.defineProperty(output, 'data', {
    get: () => chunks.join(''),
  });

  return { input, output };
}

// ── buildConfig() — MCP section logic ────────────────────────────────────────

describe('buildConfig() — mcp section', () => {
  it('omits mcp when no mcp data is supplied', () => {
    const config = buildConfig({ connector: 'console', workspacePath: '/proj' });
    expect(config).not.toHaveProperty('mcp');
  });

  it('omits mcp when mcpServers is an empty array and no configPath', () => {
    const config = buildConfig({ connector: 'console', workspacePath: '/proj', mcpServers: [] });
    expect(config).not.toHaveProperty('mcp');
  });

  it('includes mcp when one server is provided', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/proj',
      mcpServers: [{ name: 'canva', command: 'npx -y @anthropic/canva-mcp-server' }],
    });
    expect(config).toHaveProperty('mcp');
    const mcp = config['mcp'] as Record<string, unknown>;
    expect(mcp['enabled']).toBe(true);
    const servers = mcp['servers'] as Array<{ name: string; command: string }>;
    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('canva');
    expect(servers[0]?.command).toBe('npx -y @anthropic/canva-mcp-server');
  });

  it('includes mcp when multiple servers are provided', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/proj',
      mcpServers: [
        { name: 'canva', command: 'npx -y @anthropic/canva-mcp-server' },
        { name: 'gmail', command: 'npx -y @anthropic/gmail-mcp-server' },
        { name: 'slack', command: 'npx -y @anthropic/slack-mcp-server' },
      ],
    });
    const mcp = config['mcp'] as Record<string, unknown>;
    const servers = mcp['servers'] as Array<{ name: string }>;
    expect(servers).toHaveLength(3);
    expect(servers.map((s) => s.name)).toEqual(['canva', 'gmail', 'slack']);
  });

  it('includes mcp with configPath when only configPath is provided', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/proj',
      mcpConfigPath: '~/.claude/claude_desktop_config.json',
    });
    expect(config).toHaveProperty('mcp');
    const mcp = config['mcp'] as Record<string, unknown>;
    expect(mcp['enabled']).toBe(true);
    expect(mcp['servers']).toEqual([]);
    expect(mcp['configPath']).toBe('~/.claude/claude_desktop_config.json');
  });

  it('includes both servers and configPath in the mcp section', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/proj',
      mcpServers: [{ name: 'gmail', command: 'npx -y @anthropic/gmail-mcp-server' }],
      mcpConfigPath: '~/.claude/claude_desktop_config.json',
    });
    const mcp = config['mcp'] as Record<string, unknown>;
    const servers = mcp['servers'] as Array<{ name: string }>;
    expect(servers).toHaveLength(1);
    expect(mcp['configPath']).toBe('~/.claude/claude_desktop_config.json');
    expect(mcp['enabled']).toBe(true);
  });

  it('does not add configPath key when mcpConfigPath is not provided', () => {
    const config = buildConfig({
      connector: 'console',
      workspacePath: '/proj',
      mcpServers: [{ name: 'canva', command: 'npx -y @anthropic/canva-mcp-server' }],
    });
    const mcp = config['mcp'] as Record<string, unknown>;
    expect(mcp).not.toHaveProperty('configPath');
  });

  it('mcp section does not affect other config fields', () => {
    const config = buildConfig({
      connector: 'whatsapp',
      workspacePath: '/proj',
      whitelist: ['+1234567890'],
      prefix: '/ai',
      mcpServers: [{ name: 'canva', command: 'npx' }],
    });
    expect(config).toHaveProperty('workspacePath', '/proj');
    expect(config).toHaveProperty('channels');
    expect(config).toHaveProperty('auth');
    expect(config).toHaveProperty('mcp');
  });
});

// ── runInit() — MCP interactive flow ─────────────────────────────────────────

describe('runInit() — MCP interactive flow', () => {
  const testDir = tmpdir();
  let testConfigPath: string;

  beforeEach(() => {
    testConfigPath = join(testDir, `ob-mcp-test-${Date.now()}.json`);
  });

  afterEach(async () => {
    try {
      await unlink(testConfigPath);
    } catch {
      // File may not exist if the test aborted early
    }
  });

  it('produces no mcp field when user answers n to MCP prompt', async () => {
    const { input, output } = createLineFeeder([
      'console', // connector
      '/proj', // workspace path
      'n', // skip MCP
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).not.toHaveProperty('mcp');
  });

  it('produces no mcp field when user answers N (uppercase) to MCP prompt', async () => {
    const { input, output } = createLineFeeder([
      'console', // connector
      '/proj', // workspace path
      'N', // skip MCP
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).not.toHaveProperty('mcp');
  });

  it('generates valid mcp config with one server when user provides it', async () => {
    const { input, output } = createLineFeeder([
      'console', // connector
      '/proj', // workspace path
      'y', // enable MCP
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

  it('collects multiple servers in the servers array', async () => {
    const { input, output } = createLineFeeder([
      'console', // connector
      '/proj', // workspace path
      'y', // enable MCP
      'canva', // server 1 name
      'npx -y @anthropic/canva-mcp-server', // server 1 command
      'gmail', // server 2 name
      'npx -y @anthropic/gmail-mcp-server', // server 2 command
      'slack', // server 3 name
      'npx -y @anthropic/slack-mcp-server', // server 3 command
      'done', // finish servers
      '', // skip configPath
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const mcp = config['mcp'] as Record<string, unknown>;
    const servers = mcp['servers'] as Array<{ name: string; command: string }>;
    expect(servers).toHaveLength(3);
    expect(servers[0]?.name).toBe('canva');
    expect(servers[1]?.name).toBe('gmail');
    expect(servers[2]?.name).toBe('slack');
  });

  it('captures configPath import from Claude Desktop when provided', async () => {
    const { input, output } = createLineFeeder([
      'console', // connector
      '/proj', // workspace path
      'y', // enable MCP
      'done', // no inline servers
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

  it('does not add mcp section when user enables MCP but provides neither servers nor configPath', async () => {
    const { input, output } = createLineFeeder([
      'console', // connector
      '/proj', // workspace path
      'y', // enable MCP
      'done', // no inline servers
      '', // skip configPath
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    expect(config).not.toHaveProperty('mcp');
  });

  it('generates mcp with both servers and configPath when both provided', async () => {
    const { input, output } = createLineFeeder([
      'console', // connector
      '/proj', // workspace path
      'y', // enable MCP
      'gmail', // server name
      'npx -y @anthropic/gmail-mcp-server', // command
      'done', // finish servers
      '~/.claude/claude_desktop_config.json', // configPath
    ]);

    await runInit({ input, output, outputPath: testConfigPath });

    const raw = await readFile(testConfigPath, 'utf-8');
    const config = JSON.parse(raw) as Record<string, unknown>;
    const mcp = config['mcp'] as Record<string, unknown>;
    const servers = mcp['servers'] as Array<{ name: string }>;
    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe('gmail');
    expect(mcp['configPath']).toBe('~/.claude/claude_desktop_config.json');
  });
});
