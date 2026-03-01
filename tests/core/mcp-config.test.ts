/**
 * Unit tests for MCP core pipeline (OB-1076):
 * - MCPServerSchema / MCPConfigSchema validation
 * - manifestToSpawnOptions() with MCP servers
 * - ClaudeAdapter.buildSpawnConfig() --mcp-config / --strict-mcp-config flags
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MCPServerSchema, MCPConfigSchema } from '../../src/types/config.js';
import { manifestToSpawnOptions } from '../../src/core/agent-runner.js';
import { ClaudeAdapter } from '../../src/core/adapters/claude-adapter.js';
import type { TaskManifest } from '../../src/types/agent.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';

// ── Mock node:fs/promises ────────────────────────────────────────────────────

const mockWriteFile = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockRm = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  rm: (...args: unknown[]) => mockRm(...args),
}));

// ── Mock node:os ─────────────────────────────────────────────────────────────

vi.mock('node:os', () => ({
  tmpdir: () => '/tmp',
}));

// ── Mock node:crypto ─────────────────────────────────────────────────────────

vi.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid-1234',
}));

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockWriteFile.mockClear();
  mockRm.mockClear();
});

// ── MCPServerSchema ──────────────────────────────────────────────────────────

describe('MCPServerSchema', () => {
  it('accepts a minimal valid server (name + command only)', () => {
    const result = MCPServerSchema.safeParse({ name: 'canva', command: 'npx' });
    expect(result.success).toBe(true);
  });

  it('accepts a full server with args and env', () => {
    const result = MCPServerSchema.safeParse({
      name: 'gmail',
      command: 'npx',
      args: ['-y', '@anthropic/gmail-mcp'],
      env: { GMAIL_TOKEN: 'tok_abc123' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('gmail');
      expect(result.data.args).toEqual(['-y', '@anthropic/gmail-mcp']);
      expect(result.data.env).toEqual({ GMAIL_TOKEN: 'tok_abc123' });
    }
  });

  it('rejects when name is missing', () => {
    const result = MCPServerSchema.safeParse({ command: 'npx' });
    expect(result.success).toBe(false);
  });

  it('rejects when command is missing', () => {
    const result = MCPServerSchema.safeParse({ name: 'canva' });
    expect(result.success).toBe(false);
  });

  it('rejects when name is an empty string', () => {
    const result = MCPServerSchema.safeParse({ name: '', command: 'npx' });
    expect(result.success).toBe(false);
  });

  it('rejects when command is an empty string', () => {
    const result = MCPServerSchema.safeParse({ name: 'canva', command: '' });
    expect(result.success).toBe(false);
  });

  it('args defaults to undefined (not required)', () => {
    const result = MCPServerSchema.safeParse({ name: 'canva', command: 'npx' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.args).toBeUndefined();
    }
  });

  it('env defaults to undefined (not required)', () => {
    const result = MCPServerSchema.safeParse({ name: 'canva', command: 'npx' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.env).toBeUndefined();
    }
  });
});

// ── MCPConfigSchema ──────────────────────────────────────────────────────────

describe('MCPConfigSchema', () => {
  it('accepts empty config using defaults', () => {
    const result = MCPConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.servers).toEqual([]);
      expect(result.data.configPath).toBeUndefined();
    }
  });

  it('defaults enabled to true', () => {
    const result = MCPConfigSchema.safeParse({ servers: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
    }
  });

  it('defaults servers to empty array', () => {
    const result = MCPConfigSchema.safeParse({ enabled: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.servers).toEqual([]);
    }
  });

  it('accepts inline servers array', () => {
    const result = MCPConfigSchema.safeParse({
      enabled: true,
      servers: [
        { name: 'canva', command: 'npx', args: ['-y', '@anthropic/canva-mcp'] },
        { name: 'gmail', command: 'npx', args: ['-y', '@anthropic/gmail-mcp'] },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.servers).toHaveLength(2);
    }
  });

  it('accepts configPath as optional string', () => {
    const result = MCPConfigSchema.safeParse({
      configPath: '~/.claude/claude_desktop_config.json',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configPath).toBe('~/.claude/claude_desktop_config.json');
    }
  });

  it('accepts both inline servers and configPath together', () => {
    const result = MCPConfigSchema.safeParse({
      servers: [{ name: 'canva', command: 'npx' }],
      configPath: '~/.claude/config.json',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.servers).toHaveLength(1);
      expect(result.data.configPath).toBe('~/.claude/config.json');
    }
  });

  it('rejects servers with invalid entries', () => {
    const result = MCPConfigSchema.safeParse({
      servers: [{ name: 'canva' }], // missing command
    });
    expect(result.success).toBe(false);
  });
});

// ── manifestToSpawnOptions() — MCP isolation ─────────────────────────────────

describe('manifestToSpawnOptions() — MCP isolation', () => {
  const baseManifest: TaskManifest = {
    prompt: 'do something',
    workspacePath: '/workspace',
  };

  it('produces no mcpConfigPath when mcpServers is absent', async () => {
    const { spawnOptions } = await manifestToSpawnOptions(baseManifest);
    expect(spawnOptions.mcpConfigPath).toBeUndefined();
    expect(spawnOptions.strictMcpConfig).toBeUndefined();
  });

  it('produces no mcpConfigPath when mcpServers is empty', async () => {
    const { spawnOptions } = await manifestToSpawnOptions({
      ...baseManifest,
      mcpServers: [],
    });
    expect(spawnOptions.mcpConfigPath).toBeUndefined();
    expect(spawnOptions.strictMcpConfig).toBeUndefined();
  });

  it('does not call writeFile when mcpServers is empty', async () => {
    await manifestToSpawnOptions({ ...baseManifest, mcpServers: [] });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('writes a temp file when mcpServers is non-empty', async () => {
    await manifestToSpawnOptions({
      ...baseManifest,
      mcpServers: [{ name: 'canva', command: 'npx', args: ['-y', '@anthropic/canva-mcp'] }],
    });
    expect(mockWriteFile).toHaveBeenCalledOnce();
  });

  it('sets mcpConfigPath to the temp file path', async () => {
    const { spawnOptions } = await manifestToSpawnOptions({
      ...baseManifest,
      mcpServers: [{ name: 'canva', command: 'npx' }],
    });
    expect(spawnOptions.mcpConfigPath).toBe('/tmp/ob-mcp-test-uuid-1234.json');
  });

  it('sets strictMcpConfig to true when MCP servers are present', async () => {
    const { spawnOptions } = await manifestToSpawnOptions({
      ...baseManifest,
      mcpServers: [{ name: 'canva', command: 'npx' }],
    });
    expect(spawnOptions.strictMcpConfig).toBe(true);
  });

  it('writes only the requested servers to the temp file (not all global servers)', async () => {
    await manifestToSpawnOptions({
      ...baseManifest,
      mcpServers: [
        { name: 'canva', command: 'npx', args: ['-y', '@canva/mcp'] },
        { name: 'gmail', command: 'npx', env: { TOKEN: 'abc' } },
      ],
    });

    const written = mockWriteFile.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(written) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(parsed.mcpServers)).toEqual(['canva', 'gmail']);
  });

  it('includes args and env in the written config when present', async () => {
    await manifestToSpawnOptions({
      ...baseManifest,
      mcpServers: [
        {
          name: 'canva',
          command: 'npx',
          args: ['-y', '@anthropic/canva-mcp'],
          env: { CANVA_API_KEY: 'sk-test' },
        },
      ],
    });

    const written = mockWriteFile.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(written) as {
      mcpServers: { canva: { command: string; args: string[]; env: Record<string, string> } };
    };
    expect(parsed.mcpServers['canva']?.command).toBe('npx');
    expect(parsed.mcpServers['canva']?.args).toEqual(['-y', '@anthropic/canva-mcp']);
    expect(parsed.mcpServers['canva']?.env).toEqual({ CANVA_API_KEY: 'sk-test' });
  });

  it('omits args and env from written config when not specified', async () => {
    await manifestToSpawnOptions({
      ...baseManifest,
      mcpServers: [{ name: 'canva', command: 'npx' }],
    });

    const written = mockWriteFile.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(written) as {
      mcpServers: { canva: { args?: unknown; env?: unknown } };
    };
    expect(parsed.mcpServers['canva']?.args).toBeUndefined();
    expect(parsed.mcpServers['canva']?.env).toBeUndefined();
  });

  it('returns a cleanup function that deletes the temp file', async () => {
    const { cleanup } = await manifestToSpawnOptions({
      ...baseManifest,
      mcpServers: [{ name: 'canva', command: 'npx' }],
    });
    await cleanup();
    expect(mockRm).toHaveBeenCalledWith('/tmp/ob-mcp-test-uuid-1234.json', { force: true });
  });

  it('returns a no-op cleanup when no MCP servers provided', async () => {
    const { cleanup } = await manifestToSpawnOptions(baseManifest);
    await cleanup();
    expect(mockRm).not.toHaveBeenCalled();
  });

  it('preserves other spawn options alongside MCP config', async () => {
    const { spawnOptions } = await manifestToSpawnOptions({
      ...baseManifest,
      model: 'haiku',
      maxTurns: 10,
      mcpServers: [{ name: 'canva', command: 'npx' }],
    });
    expect(spawnOptions.model).toBe('haiku');
    expect(spawnOptions.maxTurns).toBe(10);
    expect(spawnOptions.prompt).toBe('do something');
  });
});

// ── ClaudeAdapter.buildSpawnConfig() — MCP flags ─────────────────────────────

describe('ClaudeAdapter.buildSpawnConfig() — MCP flags', () => {
  let adapter: ClaudeAdapter;

  beforeEach(() => {
    adapter = new ClaudeAdapter();
  });

  const base: SpawnOptions = {
    prompt: 'do something',
    workspacePath: '/workspace',
  };

  it('includes --mcp-config when mcpConfigPath is set', () => {
    const config = adapter.buildSpawnConfig({
      ...base,
      mcpConfigPath: '/tmp/ob-mcp-abc.json',
    });
    expect(config.args).toContain('--mcp-config');
    expect(config.args).toContain('/tmp/ob-mcp-abc.json');
  });

  it('includes --strict-mcp-config when strictMcpConfig is true', () => {
    const config = adapter.buildSpawnConfig({
      ...base,
      mcpConfigPath: '/tmp/ob-mcp-abc.json',
      strictMcpConfig: true,
    });
    expect(config.args).toContain('--strict-mcp-config');
  });

  it('does NOT include --mcp-config when mcpConfigPath is absent', () => {
    const config = adapter.buildSpawnConfig(base);
    expect(config.args).not.toContain('--mcp-config');
  });

  it('does NOT include --strict-mcp-config when strictMcpConfig is absent', () => {
    const config = adapter.buildSpawnConfig(base);
    expect(config.args).not.toContain('--strict-mcp-config');
  });

  it('does NOT include --strict-mcp-config when strictMcpConfig is false', () => {
    const config = adapter.buildSpawnConfig({
      ...base,
      mcpConfigPath: '/tmp/ob-mcp-abc.json',
      strictMcpConfig: false,
    });
    expect(config.args).not.toContain('--strict-mcp-config');
  });

  it('--mcp-config appears before the prompt in the args list', () => {
    const config = adapter.buildSpawnConfig({
      ...base,
      mcpConfigPath: '/tmp/ob-mcp-abc.json',
    });
    const mcpIdx = config.args.indexOf('--mcp-config');
    const promptIdx = config.args.indexOf('do something');
    expect(mcpIdx).toBeGreaterThanOrEqual(0);
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(mcpIdx).toBeLessThan(promptIdx);
  });

  it('--strict-mcp-config appears before the prompt in the args list', () => {
    const config = adapter.buildSpawnConfig({
      ...base,
      mcpConfigPath: '/tmp/ob-mcp-abc.json',
      strictMcpConfig: true,
    });
    const strictIdx = config.args.indexOf('--strict-mcp-config');
    const promptIdx = config.args.indexOf('do something');
    expect(strictIdx).toBeGreaterThanOrEqual(0);
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(strictIdx).toBeLessThan(promptIdx);
  });

  it('both --mcp-config and --strict-mcp-config appear when both options are set', () => {
    const config = adapter.buildSpawnConfig({
      ...base,
      mcpConfigPath: '/tmp/ob-mcp-abc.json',
      strictMcpConfig: true,
    });
    expect(config.args).toContain('--mcp-config');
    expect(config.args).toContain('/tmp/ob-mcp-abc.json');
    expect(config.args).toContain('--strict-mcp-config');
  });
});
