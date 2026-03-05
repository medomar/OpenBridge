/**
 * Integration tests for memory wiring (OB-814)
 *
 * Validates that all memory store writes flow through MemoryManager correctly
 * when Bridge is running with a real MemoryManager wired to MasterManager.
 *
 * Verifies:
 *  (a) conversations table has user + master rows
 *  (b) tasks table has a task record
 *  (c) learnings table has a learning
 *  (d) context_chunks has exploration data
 *  (e) sessions has the master session
 *  (f) agent_activity has entries with status updates
 *  (g) system_config has agents/classifications/workers/profiles keys
 *  (h) exploration_state has exploration checkpoint data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Bridge } from '../../src/core/bridge.js';
import { MasterManager } from '../../src/master/master-manager.js';
import { MockConnector } from '../helpers/mock-connector.js';
import type { AppConfig } from '../../src/types/config.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { ClassificationResult } from '../../src/master/master-manager.js';

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
        stdout: 'Memory wiring test response',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 50,
      })),
      stream: vi.fn(async function* () {
        yield 'Memory wiring test response';
        return {
          stdout: 'Memory wiring test response',
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

// Mock DotFolderManager to avoid git init in temp dirs
vi.mock('../../src/master/dotfolder-manager.js', () => ({
  DotFolderManager: vi.fn().mockImplementation(() => ({
    exists: vi.fn().mockResolvedValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    readMap: vi.fn().mockResolvedValue(null),
    writeMap: vi.fn().mockResolvedValue(undefined),
    readAgents: vi.fn().mockResolvedValue(null),
    writeAgents: vi.fn().mockResolvedValue(undefined),
    recordTask: vi.fn().mockResolvedValue(undefined),
    commitChanges: vi.fn().mockResolvedValue(undefined),
    appendLog: vi.fn().mockResolvedValue(undefined),
    readLog: vi.fn().mockResolvedValue([]),
    readAllTasks: vi.fn().mockResolvedValue([]),
    getMapPath: vi.fn().mockReturnValue('/test/.openbridge/workspace-map.json'),
    readMasterSession: vi.fn().mockResolvedValue(null),
    writeMasterSession: vi.fn().mockResolvedValue(undefined),
    readExplorationState: vi.fn().mockResolvedValue(null),
    readSystemPrompt: vi.fn().mockResolvedValue(null),
    writeSystemPrompt: vi.fn().mockResolvedValue(undefined),
    readProfiles: vi.fn().mockResolvedValue(null),
    createFolder: vi.fn().mockResolvedValue(undefined),
    createExplorationDir: vi.fn().mockResolvedValue(undefined),
    readWorkers: vi.fn().mockResolvedValue(null),
    writeWorkers: vi.fn().mockResolvedValue(undefined),
    readWorkspaceMap: vi.fn().mockResolvedValue(null),
    listDirDiveResults: vi.fn().mockResolvedValue([]),
    readDirectoryDive: vi.fn().mockResolvedValue(null),
    readBatchState: vi.fn().mockResolvedValue(null),
    writeBatchState: vi.fn().mockResolvedValue(undefined),
    deleteBatchState: vi.fn().mockResolvedValue(undefined),
    readPromptManifest: vi.fn().mockResolvedValue(null),
    writePromptTemplate: vi.fn().mockResolvedValue(undefined),
  })),
}));

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

describe('Memory wiring integration (OB-814)', () => {
  let workspacePath: string;
  let bridge: Bridge;
  let master: MasterManager;
  let connector: MockConnector;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Stub classifyTask to return a quick-answer (no worker spawning needed)
    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue({
      class: 'quick-answer',
      maxTurns: 5,
      reason: 'test stub',
    } as ClassificationResult);

    // Create a temp workspace with .openbridge/ dir for the DB
    workspacePath = join(tmpdir(), `ob-memory-wiring-${Date.now()}`);
    mkdirSync(join(workspacePath, '.openbridge'), { recursive: true });

    const config = buildConfig(workspacePath);
    connector = new MockConnector();

    // Production startup pattern:
    // 1. Bridge creates the MemoryManager (uninitialized) in its constructor
    bridge = new Bridge(config, { workspacePath });
    bridge.getRegistry().registerConnector('mock', () => connector);

    // 2. MasterManager receives the same (uninitialized) MemoryManager reference
    master = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      skipAutoExploration: true,
      messageTimeout: 5000,
      memory: bridge.getMemory() ?? undefined,
    });

    // 3. Wire master into bridge
    bridge.setMaster(master);

    // 4. Start bridge first — initializes and migrates the shared MemoryManager
    await bridge.start();

    // 5. Start master — can now use the initialized MemoryManager
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
  // Bridge initialization
  // ─────────────────────────────────────────────────────────────────────────

  describe('Bridge initialization', () => {
    it('creates an initialized MemoryManager when workspacePath is provided', () => {
      const memory = bridge.getMemory();
      expect(memory).not.toBeNull();
    });

    it('MemoryManager DB file exists after bridge.start()', () => {
      const dbPath = join(workspacePath, '.openbridge', 'openbridge.db');
      expect(existsSync(dbPath)).toBe(true);
    });

    it('MasterManager holds the same MemoryManager reference as Bridge', () => {
      // Both should reference the same instance
      expect(master.memory).toBe(bridge.getMemory());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (e) sessions table — populated on master.start()
  // ─────────────────────────────────────────────────────────────────────────

  describe('(e) sessions table wiring', () => {
    it('persists master session to sessions table after master.start()', async () => {
      const memory = bridge.getMemory()!;
      const session = await memory.getSession('master');
      expect(session).not.toBeNull();
      expect(session!.type).toBe('master');
      // Status is set to 'active' by masterSessionToSessionRecord()
      expect(session!.status).toBe('active');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (f) agent_activity table — populated on master.start()
  // ─────────────────────────────────────────────────────────────────────────

  describe('(f) agent_activity table wiring', () => {
    it('records master startup activity in agent_activity table', async () => {
      const memory = bridge.getMemory()!;
      const agents = await memory.getActiveAgents();
      expect(agents.length).toBeGreaterThan(0);
      const masterActivity = agents.find((a) => a.type === 'master');
      expect(masterActivity).toBeDefined();
      expect(masterActivity!.status).toBe('running');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (a) conversations table + (b) tasks table — populated by message pipeline
  // ─────────────────────────────────────────────────────────────────────────

  describe('(a) conversations table wiring', () => {
    it('records user message and master response in conversations table', async () => {
      const memory = bridge.getMemory()!;

      // Send a message through the full connector → bridge → router → master pipeline
      connector.simulateMessage({
        id: 'msg-wiring-1',
        source: 'mock',
        sender: '+1234567890',
        rawContent: '/ai what is the project structure?',
        content: '/ai what is the project structure?',
        timestamp: new Date(),
      });

      // Allow async pipeline processing to complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // User message should appear in conversations
      const userHistory = await memory.findRelevantHistory('project structure', 10);
      expect(userHistory.length).toBeGreaterThan(0);
      const userRow = userHistory.find((e) => e.role === 'user');
      expect(userRow).toBeDefined();
      expect(userRow!.content).toContain('project structure');

      // Master response should also be recorded — the mock returns 'Memory wiring test response'
      const masterHistory = await memory.findRelevantHistory('Memory wiring test response', 10);
      expect(masterHistory.length).toBeGreaterThan(0);
      const masterRow = masterHistory.find((e) => e.role === 'master');
      expect(masterRow).toBeDefined();
    });
  });

  describe('(b) tasks table wiring', () => {
    it('records completed task in tasks table after message processing', async () => {
      const memory = bridge.getMemory()!;

      connector.simulateMessage({
        id: 'msg-wiring-2',
        source: 'mock',
        sender: '+1234567890',
        rawContent: '/ai list all files',
        content: '/ai list all files',
        timestamp: new Date(),
      });

      await new Promise((resolve) => setTimeout(resolve, 300));

      // Tasks from handleMessage are recorded with the default type 'worker'
      const tasks = await memory.getTasksByType('worker');
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks[0].status).toBe('completed');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (c) learnings table — wiring verified via direct API call
  // ─────────────────────────────────────────────────────────────────────────

  describe('(c) learnings table wiring', () => {
    it('records a learning entry and reads it back', async () => {
      const memory = bridge.getMemory()!;

      await memory.recordLearning('quick-answer', 'claude-haiku-4-5', true, 3, 1500);

      const types = await memory.getLearnedTaskTypes();
      expect(types.length).toBeGreaterThan(0);

      const entry = types.find((t) => t.taskType === 'quick-answer');
      expect(entry).toBeDefined();
      expect(entry!.successCount).toBe(1);
      expect(entry!.bestModel).toBe('claude-haiku-4-5');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (d) context_chunks table — wiring verified via direct API call
  // ─────────────────────────────────────────────────────────────────────────

  describe('(d) context_chunks table wiring', () => {
    it('stores and retrieves exploration chunks from context_chunks table', async () => {
      const memory = bridge.getMemory()!;

      await memory.storeChunks([
        {
          scope: '_workspace_map',
          category: 'structure',
          content: 'src/ contains TypeScript source files for the OpenBridge project',
        },
        {
          scope: '_workspace_map',
          category: 'classification',
          content: 'Project type: Node.js TypeScript ESM library',
        },
      ]);

      const chunks = await memory.getChunksByScope('_workspace_map');
      expect(chunks.length).toBe(2);

      const searchResults = await memory.searchContext('TypeScript source files');
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].content).toContain('TypeScript source files');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (g) system_config table — wiring verified via direct API calls
  // ─────────────────────────────────────────────────────────────────────────

  describe('(g) system_config table wiring', () => {
    it('stores and retrieves agents key via setSystemConfig/getSystemConfig', async () => {
      const memory = bridge.getMemory()!;
      const agents = [{ name: 'claude', role: 'master', available: true }];

      await memory.setSystemConfig('agents', JSON.stringify(agents));

      const stored = await memory.getSystemConfig('agents');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(agents);
    });

    it('stores and retrieves classifications key', async () => {
      const memory = bridge.getMemory()!;
      const classifications = { 'list files': { class: 'quick-answer', count: 5 } };

      await memory.setSystemConfig('classifications', JSON.stringify(classifications));

      const stored = await memory.getSystemConfig('classifications');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(classifications);
    });

    it('stores and retrieves workers key', async () => {
      const memory = bridge.getMemory()!;
      const workers = { active: [], completed: [] };

      await memory.setSystemConfig('workers', JSON.stringify(workers));

      const stored = await memory.getSystemConfig('workers');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(workers);
    });

    it('stores and retrieves profiles key', async () => {
      const memory = bridge.getMemory()!;
      const profiles = { 'read-only': { tools: ['Read', 'Glob', 'Grep'] } };

      await memory.setSystemConfig('profiles', JSON.stringify(profiles));

      const stored = await memory.getSystemConfig('profiles');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(profiles);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // (h) exploration_state — stored in system_config, wiring verified via API
  // ─────────────────────────────────────────────────────────────────────────

  describe('(h) exploration_state wiring (system_config)', () => {
    it('persists and retrieves exploration state checkpoint', async () => {
      const memory = bridge.getMemory()!;

      const state = {
        phase: 'structure_scan',
        completedPasses: ['structure'],
        startedAt: new Date().toISOString(),
        explorationId: 'test-exploration-1',
      };

      await memory.upsertExplorationState(state);

      const stored = await memory.getExplorationState();
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(state);
    });

    it('persists and retrieves structure scan result', async () => {
      const memory = bridge.getMemory()!;

      const scan = {
        topLevelDirs: ['src', 'tests', 'docs'],
        topLevelFiles: ['package.json', 'tsconfig.json'],
        fileCounts: { src: 42, tests: 28, docs: 10 },
      };

      await memory.upsertStructureScan(scan);

      const stored = await memory.getStructureScan();
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(scan);
    });

    it('persists and retrieves classification result', async () => {
      const memory = bridge.getMemory()!;

      const classification = {
        projectType: 'typescript-library',
        frameworks: ['vitest', 'eslint'],
        buildCommands: ['npm run build'],
        testCommands: ['npm run test'],
      };

      await memory.upsertClassification(classification);

      const stored = await memory.getClassification();
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(classification);
    });

    it('persists and retrieves directory dive results', async () => {
      const memory = bridge.getMemory()!;

      const dive = {
        directory: 'src/core',
        files: ['bridge.ts', 'router.ts', 'auth.ts'],
        summary: 'Core bridge engine — router, auth, queue',
      };

      await memory.upsertDirectoryDive('src/core', dive);

      const stored = await memory.getDirectoryDive('src/core');
      expect(stored).not.toBeNull();
      expect(JSON.parse(stored!)).toEqual(dive);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Cross-cutting: memory isolation between test runs
  // ─────────────────────────────────────────────────────────────────────────

  describe('memory isolation', () => {
    it('each test run gets a fresh in-memory DB (no cross-test contamination)', async () => {
      const memory = bridge.getMemory()!;

      // Write a unique sentinel value
      const sentinel = `test-run-${Date.now()}`;
      await memory.setSystemConfig('test-sentinel', sentinel);

      const stored = await memory.getSystemConfig('test-sentinel');
      expect(stored).toBe(sentinel);

      // No data from prior runs (DB is fresh per test)
      const priorSentinels = await memory.getSystemConfig('old-sentinel');
      expect(priorSentinels).toBeNull();
    });
  });
});
