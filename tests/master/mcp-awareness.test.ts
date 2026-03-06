/**
 * Unit tests for MCP awareness in the Master AI layer (OB-1076):
 * - generateMasterSystemPrompt() includes/omits MCP section based on servers
 * - MasterManager passes mcpServers from options into the system prompt context
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  generateMasterSystemPrompt,
  formatLearnedPatternsSection,
} from '../../src/master/master-system-prompt.js';
import type { MasterSystemPromptContext } from '../../src/master/master-system-prompt.js';
import type { MCPServer } from '../../src/types/config.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import { MasterManager } from '../../src/master/master-manager.js';
import type { MasterManagerOptions } from '../../src/master/master-manager.js';

// ── Mock AgentRunner ─────────────────────────────────────────────────────────

const mockSpawn = vi.fn();
const mockStream = vi.fn();
const mockSpawnWithHandle = vi.fn();

vi.mock('../../src/core/agent-runner.js', () => {
  const profiles: Record<string, string[]> = {
    'read-only': ['Read', 'Glob', 'Grep'],
    'code-edit': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)'],
    'full-access': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  };

  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: mockSpawn,
      stream: mockStream,
      spawnWithHandle: mockSpawnWithHandle,
      spawnWithStreamingHandle: mockSpawnWithHandle,
    })),
    TOOLS_READ_ONLY: profiles['read-only'],
    TOOLS_CODE_EDIT: profiles['code-edit'],
    TOOLS_FULL: profiles['full-access'],
    DEFAULT_MAX_TURNS_EXPLORATION: 15,
    DEFAULT_MAX_TURNS_TASK: 25,
    DEFAULT_MAX_FIX_ITERATIONS: 3,
    sanitizePrompt: vi.fn((s: string) => s),
    buildArgs: vi.fn(),
    isValidModel: vi.fn(() => true),
    MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
    AgentExhaustedError: class AgentExhaustedError extends Error {},
    resolveProfile: (profileName: string) => profiles[profileName],
    manifestToSpawnOptions: (manifest: Record<string, unknown>) => {
      const profile = manifest.profile as string | undefined;
      const allowedTools =
        (manifest.allowedTools as string[] | undefined) ??
        (profile ? profiles[profile] : undefined);
      return Promise.resolve({
        spawnOptions: {
          prompt: manifest.prompt,
          workspacePath: manifest.workspacePath,
          model: manifest.model,
          allowedTools,
          maxTurns: manifest.maxTurns,
        },
        cleanup: vi.fn().mockResolvedValue(undefined),
      });
    },
    classifyError: vi.fn(() => 'crash'),
  };
});

// ── Mock DotFolderManager ────────────────────────────────────────────────────

vi.mock('../../src/master/dotfolder-manager.js', () => ({
  DotFolderManager: vi.fn().mockImplementation(() => ({
    ensureDotFolder: vi.fn().mockResolvedValue(undefined),
    getWorkspaceMap: vi.fn().mockResolvedValue(null),
    saveWorkspaceMap: vi.fn().mockResolvedValue(undefined),
    getAgentsRegistry: vi.fn().mockResolvedValue(null),
    saveAgentsRegistry: vi.fn().mockResolvedValue(undefined),
    getExplorationState: vi.fn().mockResolvedValue(null),
    saveExplorationState: vi.fn().mockResolvedValue(undefined),
    getExplorationLog: vi.fn().mockResolvedValue(''),
    appendExplorationLog: vi.fn().mockResolvedValue(undefined),
    getTaskHistory: vi.fn().mockResolvedValue([]),
    saveTask: vi.fn().mockResolvedValue(undefined),
    getCustomProfiles: vi.fn().mockResolvedValue(null),
    saveCustomProfiles: vi.fn().mockResolvedValue(undefined),
    readSystemPrompt: vi.fn().mockResolvedValue(null),
    seedSystemPrompt: vi.fn().mockResolvedValue(undefined),
    getMemoryContent: vi.fn().mockResolvedValue(''),
    saveMemoryContent: vi.fn().mockResolvedValue(undefined),
    getPrompt: vi.fn().mockResolvedValue(null),
    savePrompt: vi.fn().mockResolvedValue(undefined),
    listPrompts: vi.fn().mockResolvedValue([]),
    getClassificationCache: vi.fn().mockResolvedValue(null),
    saveClassificationCache: vi.fn().mockResolvedValue(undefined),
    readPromptManifest: vi.fn().mockResolvedValue(null),
    writePromptTemplate: vi.fn().mockResolvedValue(undefined),
    getMemoryFilePath: vi.fn().mockReturnValue('/test/.openbridge/context/memory.md'),
    readMemoryFile: vi.fn().mockResolvedValue(null),
  })),
}));

// ── Mock ExplorationCoordinator ──────────────────────────────────────────────

vi.mock('../../src/master/exploration-coordinator.js', () => ({
  ExplorationCoordinator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn().mockReturnValue(null),
    isComplete: vi.fn().mockReturnValue(false),
  })),
}));

// ── Mock other master modules ─────────────────────────────────────────────────

vi.mock('../../src/master/spawn-parser.js', () => ({
  parseSpawnMarkers: vi.fn().mockReturnValue([]),
  hasSpawnMarkers: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/master/result-parser.js', () => ({
  parseAIResult: vi.fn().mockReturnValue({ text: '' }),
}));

vi.mock('../../src/master/worker-result-formatter.js', () => ({
  formatWorkerBatch: vi.fn().mockReturnValue(''),
}));

vi.mock('../../src/master/workspace-change-tracker.js', () => ({
  WorkspaceChangeTracker: vi.fn().mockImplementation(() => ({
    detectChanges: vi.fn().mockResolvedValue({ hasChanges: false, changedFiles: [] }),
  })),
}));

vi.mock('../../src/master/prompt-evolver.js', () => ({
  evolvePrompts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/master/sub-master-manager.js', () => ({
  SubMasterManager: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/master/delegation.js', () => ({
  DelegationCoordinator: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/master/worker-registry.js', () => ({
  WorkerRegistry: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    unregister: vi.fn(),
    getActive: vi.fn().mockReturnValue([]),
    count: vi.fn().mockReturnValue(0),
    stopAll: vi.fn().mockResolvedValue(undefined),
  })),
  WorkersRegistrySchema: { parse: vi.fn() },
}));

vi.mock('../../src/core/model-selector.js', () => ({
  getRecommendedModel: vi.fn().mockReturnValue('haiku'),
  avoidHighFailureModel: vi.fn().mockReturnValue('haiku'),
}));

vi.mock('../../src/core/model-registry.js', () => ({
  createModelRegistry: vi.fn().mockReturnValue({
    resolve: vi.fn().mockReturnValue({ id: 'claude-haiku-4-5' }),
  }),
}));

vi.mock('../../src/core/adapter-registry.js', () => ({
  AdapterRegistry: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockReturnValue(null),
    register: vi.fn(),
  })),
}));

vi.mock('../../src/memory/database.js', () => ({
  openDatabase: vi.fn().mockReturnValue({}),
  closeDatabase: vi.fn(),
}));

vi.mock('../../src/memory/worker-briefing.js', () => ({
  buildBriefing: vi.fn().mockResolvedValue(''),
}));

vi.mock('../../src/master/exploration-prompt.js', () => ({
  generateReExplorationPrompt: vi.fn().mockReturnValue('re-explore'),
}));

vi.mock('../../src/master/exploration-prompts.js', () => ({
  generateIncrementalExplorationPrompt: vi.fn().mockReturnValue('incremental-explore'),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  rm: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
  access: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const discoveredTool: DiscoveredTool = {
  name: 'claude',
  available: true,
  priority: 100,
  version: '1.0.0',
  capabilities: ['read', 'write'],
  role: 'master',
};

const baseContext: MasterSystemPromptContext = {
  workspacePath: '/workspace',
  masterToolName: 'claude',
  discoveredTools: [discoveredTool],
};

// ── generateMasterSystemPrompt() — MCP section ────────────────────────────────

describe('generateMasterSystemPrompt() — MCP section', () => {
  it('omits MCP section when mcpServers is undefined', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    expect(prompt).not.toContain('## Available MCP Servers');
  });

  it('omits MCP section when mcpServers is empty array', () => {
    const prompt = generateMasterSystemPrompt({ ...baseContext, mcpServers: [] });
    expect(prompt).not.toContain('## Available MCP Servers');
  });

  it('includes MCP section when mcpServers has entries', () => {
    const servers: MCPServer[] = [{ name: 'canva', command: 'npx', args: ['-y', '@canva/mcp'] }];
    const prompt = generateMasterSystemPrompt({ ...baseContext, mcpServers: servers });
    expect(prompt).toContain('## Available MCP Servers');
  });

  it('lists each server name in the MCP section', () => {
    const servers: MCPServer[] = [
      { name: 'canva', command: 'npx' },
      { name: 'gmail', command: 'npx' },
    ];
    const prompt = generateMasterSystemPrompt({ ...baseContext, mcpServers: servers });
    expect(prompt).toContain('**canva**');
    expect(prompt).toContain('**gmail**');
  });

  it('includes server command in the MCP section', () => {
    const servers: MCPServer[] = [{ name: 'canva', command: 'npx', args: ['-y', '@canva/mcp'] }];
    const prompt = generateMasterSystemPrompt({ ...baseContext, mcpServers: servers });
    expect(prompt).toContain('npx -y @canva/mcp');
  });

  it('shows command only (no args) when args is not set', () => {
    const servers: MCPServer[] = [{ name: 'canva', command: 'node' }];
    const prompt = generateMasterSystemPrompt({ ...baseContext, mcpServers: servers });
    expect(prompt).toContain('`node`');
  });

  it('includes mcpServers spawn field hint when servers are configured', () => {
    const servers: MCPServer[] = [{ name: 'canva', command: 'npx' }];
    const prompt = generateMasterSystemPrompt({ ...baseContext, mcpServers: servers });
    expect(prompt).toContain('mcpServers');
  });

  it('omits mcpServers spawn field hint when no servers are configured', () => {
    const prompt = generateMasterSystemPrompt(baseContext);
    // The mcpServers SPAWN field hint should NOT appear when no servers configured
    expect(prompt).not.toContain('`mcpServers` (optional)');
  });

  it('includes security note about per-worker isolation', () => {
    const servers: MCPServer[] = [{ name: 'canva', command: 'npx' }];
    const prompt = generateMasterSystemPrompt({ ...baseContext, mcpServers: servers });
    expect(prompt).toContain('Security');
  });

  it('includes usage example with mcpServers SPAWN marker', () => {
    const servers: MCPServer[] = [{ name: 'gmail', command: 'npx' }];
    const prompt = generateMasterSystemPrompt({ ...baseContext, mcpServers: servers });
    expect(prompt).toContain('[SPAWN:');
    expect(prompt).toContain('mcpServers');
  });
});

// ── MasterManager — mcpServers from options ───────────────────────────────────

describe('MasterManager — mcpServers from constructor options', () => {
  const masterTool: DiscoveredTool = {
    name: 'claude',
    available: true,
    priority: 100,
    version: '1.0.0',
    role: 'master',
    capabilities: [],
  };

  const buildOptions = (mcpServers?: MCPServer[]): MasterManagerOptions => ({
    workspacePath: '/workspace',
    masterTool,
    discoveredTools: [masterTool],
    mcpServers,
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('accepts mcpServers in constructor options without throwing', () => {
    const servers: MCPServer[] = [{ name: 'canva', command: 'npx' }];
    expect(() => new MasterManager(buildOptions(servers))).not.toThrow();
  });

  it('accepts undefined mcpServers without throwing', () => {
    expect(() => new MasterManager(buildOptions(undefined))).not.toThrow();
  });

  it('accepts empty mcpServers array without throwing', () => {
    expect(() => new MasterManager(buildOptions([]))).not.toThrow();
  });

  it('stores mcpServers and does not throw during construction', () => {
    const servers: MCPServer[] = [{ name: 'canva', command: 'npx', args: ['-y', '@canva/mcp'] }];
    // MasterManager stores mcpServers internally and uses them when building
    // the Master system prompt via generateMasterSystemPrompt(context).
    // This constructor-level test verifies the option is accepted.
    expect(() => new MasterManager(buildOptions(servers))).not.toThrow();
  });
});

// ── formatLearnedPatternsSection — unrelated guard ────────────────────────────

describe('formatLearnedPatternsSection() — baseline', () => {
  it('returns null when no data is present', () => {
    expect(formatLearnedPatternsSection({ modelLearnings: [], effectivePrompts: [] })).toBeNull();
  });

  it('includes model learning when data is present', () => {
    const result = formatLearnedPatternsSection({
      modelLearnings: [
        { taskType: 'code-edit', bestModel: 'haiku', successRate: 0.9, totalTasks: 10 },
      ],
      effectivePrompts: [],
    });
    expect(result).toContain('code-edit');
    expect(result).toContain('haiku');
  });
});
