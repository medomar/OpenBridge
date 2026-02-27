/**
 * Integration test for clean .openbridge/ directory (OB-840)
 *
 * Validates that after Bridge + MasterManager initialization with a fresh workspace:
 *  (a) .openbridge/ contains ONLY openbridge.db (+ wal/shm) and generated/
 *  (b) No legacy JSON files exist: exploration/, prompts/, tasks/, agents.json,
 *      classifications.json, workers.json, profiles.json, learnings.json,
 *      workspace-map.json, exploration.log, master-session.json
 *  (c) The system_config table accepts and returns exploration_state, agents, workers
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Bridge } from '../../src/core/bridge.js';
import { MasterManager } from '../../src/master/master-manager.js';
import { MockConnector } from '../helpers/mock-connector.js';
import type { AppConfig } from '../../src/types/config.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Suppress log output during tests
vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// Mock AgentRunner to avoid real CLI calls
vi.mock('../../src/core/agent-runner.js', () => {
  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: vi.fn(async () => ({
        stdout: 'Clean dotfolder test response',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 50,
      })),
      stream: vi.fn(async function* () {
        yield 'Clean dotfolder test response';
        return {
          stdout: 'Clean dotfolder test response',
          stderr: '',
          exitCode: 0,
          retryCount: 0,
          durationMs: 50,
        };
      }),
    })),
    TOOLS_READ_ONLY: ['Read', 'Glob', 'Grep'],
    TOOLS_CODE_EDIT: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)'],
    TOOLS_FULL: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
    DEFAULT_MAX_TURNS_EXPLORATION: 15,
    DEFAULT_MAX_TURNS_TASK: 25,
    sanitizePrompt: vi.fn((s: string) => s),
    buildArgs: vi.fn(),
    isValidModel: vi.fn(() => true),
    MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
    AgentExhaustedError: class AgentExhaustedError extends Error {},
    manifestToSpawnOptions: vi.fn((m: unknown) =>
      Promise.resolve({ spawnOptions: m, cleanup: async () => {} }),
    ),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockMasterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  available: true,
  role: 'master',
  capabilities: [],
};

function buildConfig(workspacePath: string): AppConfig {
  return {
    connectors: [{ type: 'mock', enabled: true, options: {} }],
    providers: [],
    defaultProvider: 'auto-discovered',
    workspaces: [{ name: 'default', path: workspacePath }],
    auth: {
      whitelist: ['+1234567890'],
      prefix: '/ai',
      rateLimit: { enabled: false, windowMs: 60000, maxMessages: 10 },
    },
    queue: { maxRetries: 0, retryDelayMs: 1 },
    audit: { enabled: false, logPath: 'audit.log' },
    logLevel: 'silent',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Clean .openbridge/ directory (OB-840)', () => {
  let workspacePath: string;
  let dotFolderPath: string;
  let bridge: Bridge;
  let master: MasterManager;
  let connector: MockConnector;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create a fresh temp workspace — do NOT pre-create .openbridge/
    // Bridge.start() → memory.init() → openDatabase() will create it via mkdirSync
    workspacePath = join(tmpdir(), `ob-clean-dotfolder-${Date.now()}`);
    dotFolderPath = join(workspacePath, '.openbridge');
    mkdirSync(workspacePath, { recursive: true });

    const config = buildConfig(workspacePath);
    connector = new MockConnector();

    // Production startup pattern (mirrors src/index.ts):
    // 1. Bridge creates MemoryManager (uninitialized) in constructor
    bridge = new Bridge(config, { workspacePath });
    bridge.getRegistry().registerConnector('mock', () => connector);

    // 2. MasterManager receives the same (uninitialized) MemoryManager reference
    master = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      skipAutoExploration: true, // skip real exploration to keep test fast
      messageTimeout: 5000,
      memory: bridge.getMemory() ?? undefined,
    });

    // 3. Wire master into bridge
    bridge.setMaster(master);

    // 4. Start bridge first — initializes SQLite, creates .openbridge/ + generates/
    await bridge.start();

    // 5. Start master — initializes session in DB, writes agents to system_config
    await master.start();
  });

  afterEach(async () => {
    await bridge.stop();
    await master.shutdown();
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (a) .openbridge/ directory structure
  // ─────────────────────────────────────────────────────────────────────────

  describe('(a) .openbridge/ directory structure', () => {
    it('creates .openbridge/ directory on first startup', () => {
      expect(existsSync(dotFolderPath)).toBe(true);
    });

    it('creates openbridge.db inside .openbridge/', () => {
      expect(existsSync(join(dotFolderPath, 'openbridge.db'))).toBe(true);
    });

    it('creates generated/ subdirectory inside .openbridge/', () => {
      // DotFolderManager.createFolder() creates .openbridge/generated/
      expect(existsSync(join(dotFolderPath, 'generated'))).toBe(true);
    });

    it('.openbridge/ contains only database files, generated/, and context/ — no legacy JSON', () => {
      const entries = readdirSync(dotFolderPath);

      // Everything in .openbridge/ must be a db file, the generated/ directory, or context/
      const allowedNames = new Set([
        'openbridge.db',
        'openbridge.db-wal',
        'openbridge.db-shm',
        'generated',
        'context',
      ]);
      const unexpected = entries.filter((e) => !allowedNames.has(e));
      expect(
        unexpected,
        `Unexpected entries in .openbridge/: ${unexpected.join(', ')}`,
      ).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (b) Legacy JSON files and directories must not exist
  // ─────────────────────────────────────────────────────────────────────────

  describe('(b) No legacy JSON files or directories', () => {
    const legacyFiles = [
      'exploration.log',
      'workspace-map.json',
      'agents.json',
      'master-session.json',
      'classifications.json',
      'workers.json',
      'profiles.json',
      'learnings.json',
    ];

    const legacyDirs = ['exploration', 'prompts', 'tasks'];

    for (const file of legacyFiles) {
      it(`${file} does not exist in .openbridge/`, () => {
        expect(existsSync(join(dotFolderPath, file))).toBe(false);
      });
    }

    for (const dir of legacyDirs) {
      it(`${dir}/ directory does not exist in .openbridge/`, () => {
        expect(existsSync(join(dotFolderPath, dir))).toBe(false);
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (c) system_config table has required keys
  // ─────────────────────────────────────────────────────────────────────────

  describe('(c) system_config table accepts exploration_state, agents, workers', () => {
    it('MemoryManager is initialized after bridge.start()', () => {
      const memory = bridge.getMemory();
      expect(memory).not.toBeNull();
    });

    it('stores and retrieves exploration_state in system_config', async () => {
      const memory = bridge.getMemory()!;

      const state = {
        phase: 'structure_scan',
        completedPasses: ['structure'],
        startedAt: new Date().toISOString(),
        explorationId: 'clean-dotfolder-test-1',
      };

      await memory.upsertExplorationState(state);

      const stored = await memory.getExplorationState();
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(state);

      // Must NOT create any JSON file on disk
      expect(existsSync(join(dotFolderPath, 'exploration.log'))).toBe(false);
    });

    it('stores and retrieves agents key in system_config (not agents.json)', async () => {
      const memory = bridge.getMemory()!;

      const agents = {
        tools: [{ name: 'claude', role: 'master', available: true }],
        generatedAt: new Date().toISOString(),
        schemaVersion: '1.0.0',
      };

      await memory.setSystemConfig('agents', JSON.stringify(agents));

      const stored = await memory.getSystemConfig('agents');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!) as typeof agents;
      expect(parsed.tools).toHaveLength(1);
      expect(parsed.tools[0].name).toBe('claude');

      // Must NOT create agents.json on disk
      expect(existsSync(join(dotFolderPath, 'agents.json'))).toBe(false);
    });

    it('stores and retrieves workers key in system_config (not workers.json)', async () => {
      const memory = bridge.getMemory()!;

      const workers = {
        active: [],
        completed: [],
        failed: [],
        generatedAt: new Date().toISOString(),
        schemaVersion: '1.0.0',
      };

      await memory.setSystemConfig('workers', JSON.stringify(workers));

      const stored = await memory.getSystemConfig('workers');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!) as typeof workers;
      expect(parsed.active).toHaveLength(0);

      // Must NOT create workers.json on disk
      expect(existsSync(join(dotFolderPath, 'workers.json'))).toBe(false);
    });

    it('all three system_config keys are readable after being set', async () => {
      const memory = bridge.getMemory()!;

      // Write all three keys
      await memory.upsertExplorationState({
        phase: 'assembly',
        completedPasses: ['structure', 'classification', 'assembly'],
      });
      await memory.setSystemConfig('agents', JSON.stringify({ tools: [], schemaVersion: '1.0.0' }));
      await memory.setSystemConfig(
        'workers',
        JSON.stringify({ active: [], schemaVersion: '1.0.0' }),
      );

      // Read them back
      const explorationState = await memory.getExplorationState();
      const agents = await memory.getSystemConfig('agents');
      const workers = await memory.getSystemConfig('workers');

      expect(explorationState).not.toBeNull();
      expect(agents).not.toBeNull();
      expect(workers).not.toBeNull();

      // Directory must still be clean
      const entries = readdirSync(dotFolderPath);
      const allowedNames = new Set([
        'openbridge.db',
        'openbridge.db-wal',
        'openbridge.db-shm',
        'generated',
        'context',
      ]);
      const unexpected = entries.filter((e) => !allowedNames.has(e));
      expect(
        unexpected,
        `Unexpected entries after system_config writes: ${unexpected.join(', ')}`,
      ).toHaveLength(0);
    });
  });
});
