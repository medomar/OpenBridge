import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock node:child_process ────────────────────────────────────────────

const mockExecSync = vi.fn<(command: string, options?: object) => string | Buffer>();

vi.mock('node:child_process', () => ({
  execSync: (command: string, options?: object) => mockExecSync(command, options),
}));

// Import after mocking
import { scanForCLITools, selectMaster } from '../../src/discovery/tool-scanner.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Configure execSync so that NO tools are found (all which calls throw).
 */
function mockNoToolsAvailable(): void {
  mockExecSync.mockImplementation(() => {
    throw new Error('command not found');
  });
}

// ── scanForCLITools ────────────────────────────────────────────────────

describe('scanForCLITools', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  it('returns an empty array when no tools are found', () => {
    mockNoToolsAvailable();
    const tools = scanForCLITools();
    expect(tools).toEqual([]);
  });

  it('discovers claude when it is installed', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which claude') return '/usr/local/bin/claude\n';
      if (cmd === 'claude --version') return 'Claude 1.2.3\n';
      throw new Error(`Command not found: ${cmd}`);
    });

    const tools = scanForCLITools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('claude');
    expect(tools[0]!.path).toBe('/usr/local/bin/claude');
    expect(tools[0]!.available).toBe(true);
    expect(tools[0]!.role).toBe('none');
  });

  it('extracts version from claude --version output using pattern', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which claude') return '/usr/local/bin/claude\n';
      if (cmd === 'claude --version') return 'Claude CLI version 1.5.2\n';
      throw new Error(`Command not found: ${cmd}`);
    });

    const tools = scanForCLITools();
    expect(tools[0]!.version).toBe('1.5.2');
  });

  it('returns version "unknown" when --version output does not match pattern', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which claude') return '/usr/local/bin/claude\n';
      if (cmd === 'claude --version') throw new Error('version command failed');
      throw new Error(`Command not found: ${cmd}`);
    });

    const tools = scanForCLITools();
    expect(tools[0]!.version).toBe('unknown');
  });

  it('discovers codex when it is installed', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which codex') return '/usr/local/bin/codex\n';
      if (cmd === 'codex --version') return 'codex 0.9.1\n';
      throw new Error(`Command not found: ${cmd}`);
    });

    const tools = scanForCLITools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('codex');
    expect(tools[0]!.capabilities).toContain('code-generation');
  });

  it('discovers aider when it is installed', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which aider') return '/home/user/.local/bin/aider\n';
      if (cmd === 'aider --version') return 'aider v0.42.0\n';
      throw new Error(`Command not found: ${cmd}`);
    });

    const tools = scanForCLITools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('aider');
    expect(tools[0]!.capabilities).toContain('git-operations');
  });

  it('discovers multiple tools when several are installed', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which claude') return '/usr/local/bin/claude\n';
      if (cmd === 'which codex') return '/usr/local/bin/codex\n';
      if (cmd === 'claude --version') return 'Claude 1.2.3\n';
      if (cmd === 'codex --version') return 'codex 0.9.0\n';
      throw new Error(`Command not found: ${cmd}`);
    });

    const tools = scanForCLITools();
    expect(tools).toHaveLength(2);
    const names = tools.map((t) => t.name);
    expect(names).toContain('claude');
    expect(names).toContain('codex');
  });

  it('skips tools where getCommandPath returns null (second execSync throws)', () => {
    let callCount = 0;
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which claude') {
        callCount++;
        // First call (availability check via stdio:pipe buffer) → returns Buffer
        // Second call (getCommandPath with encoding:utf-8) → throw
        if (callCount === 1) return Buffer.from('/usr/local/bin/claude\n');
        throw new Error('path resolution failed');
      }
      throw new Error(`Command not found: ${cmd}`);
    });

    const tools = scanForCLITools();
    // If path resolution fails, tool is skipped
    expect(tools).toHaveLength(0);
  });

  it('returns correct capabilities for claude', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which claude') return '/usr/local/bin/claude\n';
      if (cmd === 'claude --version') return 'Claude 1.0.0\n';
      throw new Error(`Command not found: ${cmd}`);
    });

    const tools = scanForCLITools();
    expect(tools[0]!.capabilities).toContain('code-generation');
    expect(tools[0]!.capabilities).toContain('code-editing');
    expect(tools[0]!.capabilities).toContain('reasoning');
    expect(tools[0]!.capabilities).toContain('planning');
    expect(tools[0]!.capabilities).toContain('workspace-exploration');
    expect(tools[0]!.capabilities).toContain('multi-turn-conversation');
  });

  it('trims the path from which output (handles trailing newline)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'which claude') return '/usr/local/bin/claude\n\n';
      if (cmd === 'claude --version') return '1.0.0\n';
      throw new Error(`Command not found: ${cmd}`);
    });

    const tools = scanForCLITools();
    expect(tools[0]!.path).toBe('/usr/local/bin/claude');
  });
});

// ── selectMaster ───────────────────────────────────────────────────────

describe('selectMaster', () => {
  it('returns null when no tools are provided', () => {
    expect(selectMaster([])).toBeNull();
  });

  it('selects the single tool as master when only one is provided', () => {
    const tool: DiscoveredTool = {
      name: 'claude',
      path: '/usr/local/bin/claude',
      version: '1.0.0',
      capabilities: ['code-generation'],
      role: 'none',
      available: true,
    };
    const master = selectMaster([tool]);
    expect(master).not.toBeNull();
    expect(master!.name).toBe('claude');
    expect(master!.role).toBe('master');
  });

  it('selects highest-priority tool as master (claude > codex)', () => {
    const tools: DiscoveredTool[] = [
      {
        name: 'codex',
        path: '/usr/bin/codex',
        version: '1.0',
        capabilities: [],
        role: 'none',
        available: true,
      },
      {
        name: 'claude',
        path: '/usr/bin/claude',
        version: '1.0',
        capabilities: [],
        role: 'none',
        available: true,
      },
    ];
    const master = selectMaster(tools);
    expect(master!.name).toBe('claude');
    expect(master!.role).toBe('master');
  });

  it('assigns "backup" role to non-master tools', () => {
    const tools: DiscoveredTool[] = [
      {
        name: 'claude',
        path: '/usr/bin/claude',
        version: '1.0',
        capabilities: [],
        role: 'none',
        available: true,
      },
      {
        name: 'codex',
        path: '/usr/bin/codex',
        version: '1.0',
        capabilities: [],
        role: 'none',
        available: true,
      },
      {
        name: 'aider',
        path: '/usr/bin/aider',
        version: '1.0',
        capabilities: [],
        role: 'none',
        available: true,
      },
    ];
    selectMaster(tools);
    const roles = tools.map((t) => t.role);
    expect(roles).toContain('master');
    expect(roles.filter((r) => r === 'backup')).toHaveLength(2);
  });

  it('selects codex as master when claude is not available', () => {
    const tools: DiscoveredTool[] = [
      {
        name: 'codex',
        path: '/usr/bin/codex',
        version: '1.0',
        capabilities: [],
        role: 'none',
        available: true,
      },
      {
        name: 'aider',
        path: '/usr/bin/aider',
        version: '1.0',
        capabilities: [],
        role: 'none',
        available: true,
      },
    ];
    const master = selectMaster(tools);
    expect(master!.name).toBe('codex');
  });

  it('selects aider as master when only aider is available', () => {
    const tools: DiscoveredTool[] = [
      {
        name: 'aider',
        path: '/usr/bin/aider',
        version: '1.0',
        capabilities: [],
        role: 'none',
        available: true,
      },
    ];
    const master = selectMaster(tools);
    expect(master!.name).toBe('aider');
  });

  it('uses priority order: claude(100) > codex(80) > aider(70) > cursor(60) > cody(50)', () => {
    const tools: DiscoveredTool[] = [
      { name: 'cody', path: '/p', version: '1', capabilities: [], role: 'none', available: true },
      { name: 'cursor', path: '/p', version: '1', capabilities: [], role: 'none', available: true },
      { name: 'aider', path: '/p', version: '1', capabilities: [], role: 'none', available: true },
      { name: 'codex', path: '/p', version: '1', capabilities: [], role: 'none', available: true },
      { name: 'claude', path: '/p', version: '1', capabilities: [], role: 'none', available: true },
    ];
    const master = selectMaster(tools);
    expect(master!.name).toBe('claude');
  });

  it('assigns priority 0 to unknown tools (they become backup)', () => {
    const tools: DiscoveredTool[] = [
      {
        name: 'unknown-tool',
        path: '/p',
        version: '1',
        capabilities: [],
        role: 'none',
        available: true,
      },
      { name: 'cody', path: '/p', version: '1', capabilities: [], role: 'none', available: true },
    ];
    const master = selectMaster(tools);
    // cody has priority 50, unknown has 0 → cody wins
    expect(master!.name).toBe('cody');
  });

  it('mutates the selected tool role in place', () => {
    const tool: DiscoveredTool = {
      name: 'claude',
      path: '/usr/bin/claude',
      version: '1.0.0',
      capabilities: [],
      role: 'none',
      available: true,
    };
    selectMaster([tool]);
    expect(tool.role).toBe('master');
  });
});
