import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { MasterManagerOptions } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { Router } from '../../src/core/router.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import { MemoryManager } from '../../src/memory/index.js';
import type { AgentResult, SpawnOptions } from '../../src/core/agent-runner.js';
import type { KnowledgeRetriever } from '../../src/core/knowledge-retriever.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/** Helper to extract SpawnOptions from mock call args */
function getSpawnCallOpts(callIndex: number): SpawnOptions | undefined {
  return mockSpawn.mock.calls[callIndex]?.[0] as SpawnOptions | undefined;
}

// Mock AgentRunner (used by MasterManager, DelegationCoordinator)
const mockSpawn = vi.fn();
const mockStream = vi.fn();
const mockSpawnWithHandle = vi.fn();
vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: mockSpawn,
    stream: mockStream,
    spawnWithHandle: mockSpawnWithHandle,
    spawnWithStreamingHandle: mockSpawnWithHandle,
  })),
  TOOLS_READ_ONLY: ['Read', 'Glob', 'Grep'],
  TOOLS_CODE_EDIT: [
    'Read',
    'Edit',
    'Write',
    'Glob',
    'Grep',
    'Bash(git:*)',
    'Bash(npm:*)',
    'Bash(npx:*)',
  ],
  TOOLS_FULL: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  DEFAULT_MAX_TURNS_EXPLORATION: 15,
  DEFAULT_MAX_TURNS_TASK: 25,
  sanitizePrompt: vi.fn((s: string) => s),
  buildArgs: vi.fn(),
  isValidModel: vi.fn(() => true),
  MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
  AgentExhaustedError: class AgentExhaustedError extends Error {},
  resolveProfile: (profileName: string): string[] | undefined => {
    const profiles: Record<string, string[]> = {
      'read-only': ['Read', 'Glob', 'Grep'],
      'code-edit': [
        'Read',
        'Edit',
        'Write',
        'Glob',
        'Grep',
        'Bash(git:*)',
        'Bash(npm:*)',
        'Bash(npx:*)',
      ],
      'full-access': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
    };
    return profiles[profileName];
  },
  manifestToSpawnOptions: (
    manifest: Record<string, unknown>,
    customProfiles?: Record<string, unknown>,
  ) => {
    const profile = manifest.profile as string | undefined;
    const profiles: Record<string, string[]> = {
      'read-only': ['Read', 'Glob', 'Grep'],
      'code-edit': [
        'Read',
        'Edit',
        'Write',
        'Glob',
        'Grep',
        'Bash(git:*)',
        'Bash(npm:*)',
        'Bash(npx:*)',
      ],
      'full-access': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
    };
    const customAllowedTools =
      profile && customProfiles
        ? (customProfiles[profile] as { allowedTools?: string[] } | undefined)?.allowedTools
        : undefined;
    const allowedTools =
      (manifest.allowedTools as string[] | undefined) ??
      customAllowedTools ??
      (profile ? profiles[profile] : undefined);
    return Promise.resolve({
      spawnOptions: {
        prompt: manifest.prompt,
        workspacePath: manifest.workspacePath,
        model: manifest.model,
        allowedTools,
        maxTurns: manifest.maxTurns,
        timeout: manifest.timeout,
        retries: manifest.retries,
        retryDelay: manifest.retryDelay,
      },
      cleanup: async () => {},
    });
  },
}));

// Mock logger
vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

/** Original classifyTask method — captured before any spy is applied */
const _originalClassifyTask = MasterManager.prototype.classifyTask;

describe('MasterManager', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;
  let masterTool: DiscoveredTool;
  let discoveredTools: DiscoveredTool[];

  beforeEach(async () => {
    // Create temporary test workspace
    testWorkspace = path.join(os.tmpdir(), 'test-workspace-master-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    // Create test tools
    masterTool = {
      name: 'claude',
      path: '/usr/local/bin/claude',
      version: '1.0.0',
      role: 'master',
      capabilities: ['code-analysis', 'task-execution'],
      available: true,
    };

    discoveredTools = [
      masterTool,
      {
        name: 'codex',
        path: '/usr/local/bin/codex',
        version: '2.0.0',
        role: 'specialist',
        capabilities: ['code-generation'],
        available: true,
      },
    ];

    // Clear mock call history
    vi.clearAllMocks();
    mockSpawnWithHandle.mockReset();
    // spawnWithHandle delegates to mockSpawn so existing mockResolvedValueOnce calls work
    mockSpawnWithHandle.mockImplementation((opts: Parameters<typeof mockSpawn>[0]) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    // By default, make classifyTask use keyword heuristics (no AI call) so that
    // processMessage tests aren't affected by the classifier consuming spawn mocks.
    vi.spyOn(MasterManager.prototype, 'classifyTask').mockImplementation(
      async (content: string) => {
        const lower = content.toLowerCase();
        if (
          ['implement', 'build', 'refactor', 'develop', 'set up', 'setup'].some((kw) =>
            lower.includes(kw),
          )
        )
          return {
            class: 'complex-task' as const,
            maxTurns: 5,
            timeout: 5 * 30_000,
            reason: 'test mock: complex-task',
          };
        if (
          ['generate', 'create', 'write', 'fix', 'update file', 'add to', 'make a'].some((kw) =>
            lower.includes(kw),
          )
        )
          return {
            class: 'tool-use' as const,
            maxTurns: 10,
            timeout: 10 * 30_000,
            reason: 'test mock: tool-use',
          };
        return {
          class: 'quick-answer' as const,
          maxTurns: 3,
          timeout: 3 * 30_000,
          reason: 'test mock: quick-answer',
        };
      },
    );
  });

  afterEach(async () => {
    // Cleanup
    if (masterManager) {
      await masterManager.shutdown();
    }

    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Constructor and Initialization', () => {
    it('should create manager in idle state', () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      expect(masterManager.getState()).toBe('idle');
    });

    it('should accept custom timeout options', () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        explorationTimeout: 60000,
        messageTimeout: 30000,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      expect(masterManager.getState()).toBe('idle');
    });
  });

  describe('Start', () => {
    it('should transition from idle to ready when auto-exploration is skipped', async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      expect(masterManager.getState()).toBe('ready');
    });

    it('should create a Master session on start', async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      const session = masterManager.getMasterSession();
      expect(session).toBeDefined();
      expect(session?.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(session?.messageCount).toBe(0);
      expect(session?.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Write', 'Edit']);
      expect(session?.maxTurns).toBe(50);
    });

    it('should persist Master session to disk', async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      const dotFolder = new DotFolderManager(testWorkspace);
      const savedSession = await dotFolder.readMasterSession();

      expect(savedSession).toBeDefined();
      expect(savedSession?.sessionId).toBe(masterManager.getMasterSession()?.sessionId);
    });

    it('should resume existing Master session from disk', async () => {
      // Write a session to disk first
      const dotFolder = new DotFolderManager(testWorkspace);
      await dotFolder.initialize();
      await dotFolder.writeMasterSession({
        sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        messageCount: 5,
        allowedTools: ['Read', 'Glob', 'Grep', 'Write', 'Edit'],
        maxTurns: 50,
      });

      // Write workspace map to memory (OB-810: JSON fallback removed).
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const mapData = {
        workspacePath: testWorkspace,
        projectName: 'test',
        projectType: 'node',
        frameworks: [] as string[],
        structure: {},
        keyFiles: [] as unknown[],
        entryPoints: [] as string[],
        commands: {},
        dependencies: [] as string[],
        summary: 'Test',
        generatedAt: new Date().toISOString(),
        schemaVersion: '1.0.0',
      };
      await memory.storeChunks([
        { scope: '_workspace_map', category: 'structure', content: JSON.stringify(mapData) },
      ]);

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: false,
        memory,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      const session = masterManager.getMasterSession();
      expect(session?.sessionId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(session?.messageCount).toBe(5);
    });

    it('should load existing workspace map if .openbridge folder exists', async () => {
      // Write workspace map to memory (OB-810: JSON fallback removed).
      const memory = new MemoryManager(':memory:');
      await memory.init();
      const workspaceMap = {
        workspacePath: testWorkspace,
        projectName: 'existing-project',
        projectType: 'python',
        frameworks: ['django'],
        structure: {},
        keyFiles: [] as unknown[],
        entryPoints: [] as string[],
        commands: {},
        dependencies: [] as string[],
        summary: 'Existing workspace',
        generatedAt: new Date().toISOString(),
        schemaVersion: '1.0.0',
      };
      await memory.storeChunks([
        { scope: '_workspace_map', category: 'structure', content: JSON.stringify(workspaceMap) },
      ]);

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: false,
        memory,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      expect(masterManager.getState()).toBe('ready');
      expect(mockSpawn).not.toHaveBeenCalled();

      const summary = masterManager.getExplorationSummary();
      expect(summary?.projectType).toBe('python');
      expect(summary?.frameworks).toContain('django');
    });

    it('should not start twice', async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();
      await masterManager.start(); // Second call should be ignored

      expect(masterManager.getState()).toBe('ready');
    });
  });

  describe('Message Processing', () => {
    beforeEach(async () => {
      // Initialize .openbridge folder with git
      const dotFolderManager = new DotFolderManager(testWorkspace);
      await dotFolderManager.initialize();

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();
    });

    it('should process message successfully via AgentRunner', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Hello, I processed your message!',
        stderr: '',
        retryCount: 0,
        durationMs: 500,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      expect(response).toBe('Hello, I processed your message!');
      expect(masterManager.getState()).toBe('ready');
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('should call spawn for each message in --print mode (no session IDs)', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'First response',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Second response',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message1: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai first message',
        content: 'first message',
        timestamp: new Date(),
      };

      const message2: InboundMessage = {
        id: 'msg-2',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai second message',
        content: 'second message',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message1);
      await masterManager.processMessage(message2);

      expect(mockSpawn).toHaveBeenCalledTimes(2);

      // processMessage uses --print mode — no sessionId or resumeSessionId
      const call1 = getSpawnCallOpts(0);
      expect(call1?.sessionId).toBeUndefined();
      expect(call1?.resumeSessionId).toBeUndefined();

      const call2 = getSpawnCallOpts(1);
      expect(call2?.sessionId).toBeUndefined();
      expect(call2?.resumeSessionId).toBeUndefined();
    });

    it('should route messages from different senders through the same Master (--print mode)', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Response from sender1',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Response from sender2',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message1: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1111111111',
        rawContent: '/ai message',
        content: 'message',
        timestamp: new Date(),
      };

      const message2: InboundMessage = {
        id: 'msg-2',
        source: 'test',
        sender: '+2222222222',
        rawContent: '/ai message',
        content: 'message',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message1);
      await masterManager.processMessage(message2);

      // Both messages spawn separate --print calls via the same MasterManager
      expect(mockSpawn).toHaveBeenCalledTimes(2);
      const call1 = getSpawnCallOpts(0);
      const call2 = getSpawnCallOpts(1);
      expect(call1?.workspacePath).toBe(call2?.workspacePath);
      expect(call1?.allowedTools).toEqual(call2?.allowedTools);
    });

    it('should pass Master tools (allowedTools) to AgentRunner', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Response',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      const call = getSpawnCallOpts(0);
      expect(call?.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Write', 'Edit']);
      expect(call?.maxTurns).toBe(3); // quick-answer classification (no action keywords) → MESSAGE_MAX_TURNS_QUICK
    });

    it('should increment session messageCount after each message', async () => {
      mockSpawn.mockResolvedValue({
        exitCode: 0,
        stdout: 'Response',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      expect(masterManager.getMasterSession()?.messageCount).toBe(0);

      await masterManager.processMessage(message);
      expect(masterManager.getMasterSession()?.messageCount).toBe(1);

      await masterManager.processMessage({ ...message, id: 'msg-2', content: 'second' });
      expect(masterManager.getMasterSession()?.messageCount).toBe(2);
    });

    it('should handle status query without calling AI', async () => {
      const message: InboundMessage = {
        id: 'msg-status',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai status',
        content: 'status',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      expect(response).toContain('OpenBridge Master AI Status');
      // State is 'processing' because processMessage sets it before checking for status queries
      expect(response).toContain('State: processing');
      expect(response).toContain('Master Session:');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('should reject messages when not in ready state', async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      const idleManager = new MasterManager(options);

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      const response = await idleManager.processMessage(message);
      expect(response).toContain('currently idle');

      await idleManager.shutdown();
    });

    it('should queue messages during exploration and drain via router after exploration completes', async () => {
      // Initialize dotfolder for the exploring manager
      const dotFolderManager = new DotFolderManager(testWorkspace);
      await dotFolderManager.initialize();

      // Create manager with skipAutoExploration to reach 'ready' state first
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };
      const exploringManager = new MasterManager(options);
      await exploringManager.start(); // state = 'ready'

      // Set up a controlled exploration stream (hangs until released)
      let releaseExploration!: () => void;
      const explorationBarrier = new Promise<void>((resolve) => {
        releaseExploration = resolve;
      });

      async function* mockExplorationStream(): AsyncGenerator<
        string,
        { exitCode: number; stdout: string; stderr: string; durationMs: number; retryCount: number }
      > {
        await explorationBarrier;
        yield ''; // required: wait for barrier before returning final result
        return { exitCode: 0, stdout: '', stderr: '', durationMs: 1000, retryCount: 0 };
      }

      mockStream.mockReturnValueOnce(mockExplorationStream());

      // Set up mock router
      const mockRoute = vi.fn().mockResolvedValue(undefined);
      exploringManager.setRouter({ route: mockRoute } as unknown as Router);

      // Start exploration without awaiting (explore() sets state to 'exploring')
      const explorePromise = exploringManager.explore();

      // Wait a tick for async state transition
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(exploringManager.getState()).toBe('exploring');

      // Send a message during exploration — should be queued
      const message: InboundMessage = {
        id: 'msg-queued',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello during exploration',
        content: 'hello during exploration',
        timestamp: new Date(),
      };

      const queuedResponse = await exploringManager.processMessage(message);
      expect(queuedResponse).toBe(
        "I'm still exploring your workspace. Your message will be processed once exploration completes.",
      );

      // Release exploration — state transitions to 'ready' and drain runs
      releaseExploration();
      await explorePromise;

      // Router.route() should have been called with the queued message
      expect(mockRoute).toHaveBeenCalledTimes(1);
      expect(mockRoute).toHaveBeenCalledWith(message);

      await exploringManager.shutdown();
    });

    it('should handle message processing errors', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Processing error',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      try {
        await masterManager.processMessage(message);
        expect.fail('Should have thrown an error');
      } catch {
        // Error expected
      }

      expect(masterManager.getState()).toBe('ready');
    });
  });

  describe('Message Streaming', () => {
    beforeEach(async () => {
      // Initialize .openbridge folder with git
      const dotFolderManager = new DotFolderManager(testWorkspace);
      await dotFolderManager.initialize();

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();
    });

    it('should stream message chunks via AgentRunner', async () => {
      // Create a mock async generator for stream()
      async function* mockStreamGen(): AsyncGenerator<
        string,
        { exitCode: number; stderr: string; stdout: string; durationMs: number; retryCount: number }
      > {
        yield 'Hello ';
        yield 'from ';
        yield 'streaming!';
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'Hello from streaming!',
          durationMs: 100,
          retryCount: 0,
        };
      }

      mockStream.mockReturnValueOnce(mockStreamGen());

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai stream test',
        content: 'stream test',
        timestamp: new Date(),
      };

      const chunks: string[] = [];
      for await (const chunk of masterManager.streamMessage(message)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Hello ', 'from ', 'streaming!']);
      expect(masterManager.getState()).toBe('ready');
    });

    it('should handle streaming errors', async () => {
      async function* mockStreamGen(): AsyncGenerator<
        string,
        { exitCode: number; stderr: string; stdout: string; durationMs: number; retryCount: number }
      > {
        yield 'Start ';
        throw new Error('Stream error');
      }

      mockStream.mockReturnValueOnce(mockStreamGen());

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai stream test',
        content: 'stream test',
        timestamp: new Date(),
      };

      const chunks: string[] = [];
      for await (const chunk of masterManager.streamMessage(message)) {
        chunks.push(chunk);
      }

      expect(chunks).toContain('Start ');
      expect(chunks.some((c) => c.includes('Error'))).toBe(true);
      expect(masterManager.getState()).toBe('ready');
    });
  });

  describe('Shutdown', () => {
    it('should persist Master session on shutdown', async () => {
      const dotFolderManager = new DotFolderManager(testWorkspace);
      await dotFolderManager.initialize();

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      const sessionId = masterManager.getMasterSession()?.sessionId;

      await masterManager.shutdown();

      expect(masterManager.getState()).toBe('shutdown');

      // Session should be persisted to disk
      const savedSession = await dotFolderManager.readMasterSession();
      expect(savedSession?.sessionId).toBe(sessionId);
    });

    it('should be idempotent', async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      await masterManager.shutdown();
      await masterManager.shutdown(); // Second call should be safe

      expect(masterManager.getState()).toBe('shutdown');
    });
  });

  describe('Status', () => {
    beforeEach(async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();
    });

    it('should return status information including Master session', async () => {
      const status = await masterManager.getStatus();

      expect(status).toContain('OpenBridge Master AI Status');
      expect(status).toContain('State: ready');
      expect(status).toContain('Master Session:');
      expect(status).toContain('Session Messages: 0');
      expect(status).toContain('Tasks:');
    });

    it('should include exploration progress table when memory has in-progress rows (OB-894)', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();

      const explorationId = 'test-exploration-id';
      // Insert parent agent_activity row (required by FK constraint)
      await memory.insertActivity({
        id: explorationId,
        type: 'explorer',
        status: 'running',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      // Insert phase-level rows
      await memory.insertExplorationProgress({
        exploration_id: explorationId,
        phase: 'structure_scan',
        target: null,
        status: 'completed',
        progress_pct: 100,
        files_processed: 20,
        files_total: 20,
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      });
      await memory.insertExplorationProgress({
        exploration_id: explorationId,
        phase: 'classification',
        target: null,
        status: 'in_progress',
        progress_pct: 50,
        files_processed: 5,
        files_total: 10,
        started_at: new Date().toISOString(),
        completed_at: null,
      });
      // Insert a directory-level row
      await memory.insertExplorationProgress({
        exploration_id: explorationId,
        phase: 'directory-dive',
        target: 'src',
        status: 'in_progress',
        progress_pct: 30,
        files_processed: 3,
        files_total: 10,
        started_at: new Date().toISOString(),
        completed_at: null,
      });

      await masterManager.shutdown();

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
        memory,
      };
      masterManager = new MasterManager(options);
      await masterManager.start();

      const status = await masterManager.getStatus();

      expect(status).toContain('Exploration Progress:');
      expect(status).toContain('classification');
      expect(status).toContain('50%');
      expect(status).toContain('directory-dive (src)');
      expect(status).toContain('30%');
    });
  });

  describe('Master Tool Access Control (OB-155)', () => {
    beforeEach(async () => {
      const dotFolderManager = new DotFolderManager(testWorkspace);
      await dotFolderManager.initialize();

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();
    });

    it('should enforce Master profile tools (no Bash)', async () => {
      const session = masterManager.getMasterSession();
      expect(session?.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Write', 'Edit']);
      // Verify no Bash tools are present
      expect(session?.allowedTools.some((t) => t.startsWith('Bash'))).toBe(false);
    });

    it('should pass Master profile tools to AgentRunner on processMessage', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Response',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-access',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai do something',
        content: 'do something',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      const call = getSpawnCallOpts(0);
      expect(call?.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Write', 'Edit']);
      // Master must NOT get Bash access
      expect(call?.allowedTools?.some((t) => t.startsWith('Bash'))).toBe(false);
    });

    it('should pass Master profile tools to AgentRunner on explore', async () => {
      // Create a fresh manager that will trigger exploration
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      const exploringManager = new MasterManager(options);
      await exploringManager.start();

      // explore() uses agentRunner.stream() (not spawn) for real-time progress
      async function* explorationStreamGen(): AsyncGenerator<
        string,
        { exitCode: number; stderr: string; stdout: string; durationMs: number; retryCount: number }
      > {
        yield 'Exploring...';
        return { exitCode: 0, stdout: 'Explored', stderr: '', durationMs: 500, retryCount: 0 };
      }
      mockStream.mockReturnValueOnce(explorationStreamGen());

      await exploringManager.explore();

      // Verify stream was called with Master profile tools
      const streamCall = mockStream.mock.calls[0]?.[0] as { allowedTools?: string[] } | undefined;
      expect(streamCall?.allowedTools).toEqual(['Read', 'Glob', 'Grep', 'Write', 'Edit']);
      expect(streamCall?.allowedTools?.some((t: string) => t.startsWith('Bash'))).toBe(false);

      await exploringManager.shutdown();
    });
  });

  describe('System Prompt', () => {
    it('should seed the system prompt on first startup', async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      const dotFolder = new DotFolderManager(testWorkspace);
      const prompt = await dotFolder.readSystemPrompt();

      expect(prompt).not.toBeNull();
      expect(prompt).toContain('Master AI');
      expect(prompt).toContain(testWorkspace);
      expect(prompt).toContain('claude');
    });

    it('should not overwrite existing system prompt on restart', async () => {
      // Seed a custom prompt first
      const dotFolder = new DotFolderManager(testWorkspace);
      await dotFolder.initialize();
      const customPrompt = '# Custom Master Prompt\nEdited by the Master itself.';
      await dotFolder.writeSystemPrompt(customPrompt);

      // Write workspace map to memory so exploration is skipped (OB-810: JSON fallback removed).
      const memory = new MemoryManager(':memory:');
      await memory.init();
      await memory.storeChunks([
        {
          scope: '_workspace_map',
          category: 'structure',
          content: JSON.stringify({
            workspacePath: testWorkspace,
            projectName: 'test',
            projectType: 'node',
            frameworks: [],
            structure: {},
            keyFiles: [],
            entryPoints: [],
            commands: {},
            dependencies: [],
            summary: 'Test',
            generatedAt: new Date().toISOString(),
            schemaVersion: '1.0.0',
          }),
        },
      ]);

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: false,
        memory,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      // Custom prompt should NOT be overwritten
      const prompt = await dotFolder.readSystemPrompt();
      expect(prompt).toBe(customPrompt);
    });

    it('should inject system prompt into spawn options', async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Response',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-sys',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      const call = getSpawnCallOpts(0);
      expect(call?.systemPrompt).toBeDefined();
      expect(call?.systemPrompt).toContain('Master AI');
    });
  });

  describe('Graceful Master Restart (OB-156)', () => {
    beforeEach(async () => {
      // Reset spawn/stream mocks to clear any leaked mockResolvedValue/Once from prior describe blocks
      mockSpawn.mockReset();
      mockStream.mockReset();

      const dotFolderManager = new DotFolderManager(testWorkspace);
      await dotFolderManager.initialize();

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();
    });

    it('should detect SIGTERM (exit code 143) as dead session', async () => {
      // First call fails with SIGTERM (timeout)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 143,
        stdout: '',
        stderr: 'Process killed',
        retryCount: 0,
        durationMs: 60000,
      });

      // Context summary seed call (restart)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Context loaded',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Retry after restart succeeds
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Hello after restart!',
        stderr: '',
        retryCount: 0,
        durationMs: 500,
      });

      const message: InboundMessage = {
        id: 'msg-restart-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      expect(response).toBe('Hello after restart!');
      expect(masterManager.getState()).toBe('ready');
      expect(masterManager.getRestartCount()).toBe(1);
      // 3 spawn calls: original (failed), context seed, retry
      expect(mockSpawn).toHaveBeenCalledTimes(3);
    });

    it('should detect SIGKILL (exit code 137) as dead session', async () => {
      // First call fails with SIGKILL (OOM)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 137,
        stdout: '',
        stderr: '',
        retryCount: 0,
        durationMs: 5000,
      });

      // Context summary seed
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Context loaded',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Retry succeeds
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Recovered!',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      const message: InboundMessage = {
        id: 'msg-restart-2',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai test',
        content: 'test',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      expect(response).toBe('Recovered!');
      expect(masterManager.getRestartCount()).toBe(1);
    });

    it('should detect context overflow pattern in stderr', async () => {
      // Exit code 1 with context overflow pattern
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Error: context length exceeded maximum',
        retryCount: 0,
        durationMs: 1000,
      });

      // Context summary seed
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Context loaded',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Retry succeeds
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Fresh response',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      const message: InboundMessage = {
        id: 'msg-restart-3',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai question',
        content: 'question',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      expect(response).toBe('Fresh response');
      expect(masterManager.getRestartCount()).toBe(1);
    });

    it('should NOT restart on regular exit code 1 without session-dead patterns', async () => {
      // Regular error — not a dead session
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Some regular error',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-no-restart',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      await expect(masterManager.processMessage(message)).rejects.toThrow(
        'Message processing failed',
      );
      expect(masterManager.getRestartCount()).toBe(0);
      // Only 1 spawn call — no restart attempted
      expect(mockSpawn).toHaveBeenCalledTimes(1);
    });

    it('should create a new session ID after restart', async () => {
      const oldSessionId = masterManager.getMasterSession()?.sessionId;

      // SIGTERM triggers restart
      mockSpawn.mockResolvedValueOnce({
        exitCode: 143,
        stdout: '',
        stderr: '',
        retryCount: 0,
        durationMs: 60000,
      });

      // Context seed
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Context loaded',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Retry
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Response',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      const message: InboundMessage = {
        id: 'msg-new-session',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      const newSessionId = masterManager.getMasterSession()?.sessionId;
      expect(newSessionId).not.toBe(oldSessionId);
      expect(newSessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
    });

    it('should include workspace map in context summary', async () => {
      // Write workspace map to memory (OB-810: JSON fallback removed).
      const memory = new MemoryManager(':memory:');
      await memory.init();
      await memory.storeChunks([
        {
          scope: '_workspace_map',
          category: 'structure',
          content: JSON.stringify({
            workspacePath: testWorkspace,
            projectName: 'my-project',
            projectType: 'node',
            frameworks: ['express', 'typescript'],
            structure: {},
            keyFiles: [],
            entryPoints: [],
            commands: {},
            dependencies: [],
            summary: 'A Node.js project with Express',
            generatedAt: new Date().toISOString(),
            schemaVersion: '1.0.0',
          }),
        },
      ]);

      // Use a local masterManager with memory so the map is accessible on restart.
      const dotFolderManager = new DotFolderManager(testWorkspace);
      await dotFolderManager.initialize();
      const localManager = new MasterManager({
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
        memory,
      });
      await localManager.start();

      // SIGTERM triggers restart
      mockSpawn.mockResolvedValueOnce({
        exitCode: 143,
        stdout: '',
        stderr: '',
        retryCount: 0,
        durationMs: 60000,
      });

      // Context seed — capture what's sent
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Context loaded',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Retry
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Response',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      const message: InboundMessage = {
        id: 'msg-context',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      await localManager.processMessage(message);

      // The second spawn call should be the context summary seed
      const contextCall = getSpawnCallOpts(1);
      expect(contextCall?.prompt).toContain('Session Context Recovery');
      expect(contextCall?.prompt).toContain('my-project');
      expect(contextCall?.prompt).toContain('Node.js project with Express');
    });

    it('should show restart count in status', async () => {
      // Trigger a restart
      mockSpawn.mockResolvedValueOnce({
        exitCode: 143,
        stdout: '',
        stderr: '',
        retryCount: 0,
        durationMs: 60000,
      });
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Context',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'OK',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-status-restart',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      const status = await masterManager.getStatus();
      expect(status).toContain('Session Restarts: 1');
    });

    it('should handle restart during streaming', async () => {
      // Stream fails with SIGTERM
      async function* failingStream(): AsyncGenerator<
        string,
        { exitCode: number; stderr: string; stdout: string; durationMs: number; retryCount: number }
      > {
        yield 'partial ';
        return {
          exitCode: 143,
          stderr: '',
          stdout: 'partial ',
          durationMs: 60000,
          retryCount: 0,
        };
      }

      // Context seed (non-streaming spawn during restart)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Context loaded',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Retry stream succeeds
      async function* retryStream(): AsyncGenerator<
        string,
        { exitCode: number; stderr: string; stdout: string; durationMs: number; retryCount: number }
      > {
        yield 'recovered ';
        yield 'response';
        return {
          exitCode: 0,
          stderr: '',
          stdout: 'recovered response',
          durationMs: 300,
          retryCount: 0,
        };
      }

      mockStream.mockReturnValueOnce(failingStream());
      mockStream.mockReturnValueOnce(retryStream());

      const message: InboundMessage = {
        id: 'msg-stream-restart',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai streaming test',
        content: 'streaming test',
        timestamp: new Date(),
      };

      const chunks: string[] = [];
      for await (const chunk of masterManager.streamMessage(message)) {
        chunks.push(chunk);
      }

      // Should contain both the partial output and the recovered output
      expect(chunks).toContain('partial ');
      expect(chunks).toContain('recovered ');
      expect(chunks).toContain('response');
      expect(masterManager.getRestartCount()).toBe(1);
      expect(masterManager.getState()).toBe('ready');
    });

    it('should persist new session to disk after restart', async () => {
      // SIGTERM triggers restart
      mockSpawn.mockResolvedValueOnce({
        exitCode: 143,
        stdout: '',
        stderr: '',
        retryCount: 0,
        durationMs: 60000,
      });
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Context loaded',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'OK',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-persist',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      const dotFolder = new DotFolderManager(testWorkspace);
      const savedSession = await dotFolder.readMasterSession();

      expect(savedSession).toBeDefined();
      expect(savedSession?.sessionId).toBe(masterManager.getMasterSession()?.sessionId);
    });
  });

  describe('Worker Delegation (SPAWN Markers) (OB-311)', () => {
    beforeEach(async () => {
      mockSpawn.mockReset();
      mockStream.mockReset();

      // Create and start a fresh MasterManager for each test
      masterManager = new MasterManager({
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      });
      await masterManager.start();
    });

    it('should spawn a worker and include worker result in final response', async () => {
      const spawnMarkerResponse = `I'll read those files for you.\n\n[SPAWN:read-only]{"prompt":"List all TypeScript files in src/","model":"haiku","maxTurns":5}[/SPAWN]`;

      // Call 1: Master processes message → returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: spawnMarkerResponse,
        stderr: '',
        retryCount: 0,
        durationMs: 400,
      });

      // Call 2: Worker spawned from SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'worker result: found 42 TypeScript files',
        stderr: '',
        retryCount: 0,
        durationMs: 250,
      });

      // Call 3: Feedback to Master with worker results → final response
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The project contains 42 TypeScript files.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-spawn-e2e',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai list ts files',
        content: 'list ts files',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      // Final response is the Master's synthesis after worker results were injected
      expect(response).toBe('The project contains 42 TypeScript files.');
      // 3 spawn calls: (1) Master + message, (2) worker, (3) Master + worker feedback
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      // Verify worker was spawned with the correct prompt from the SPAWN marker
      const workerCall = mockSpawn.mock.calls[1]?.[0] as SpawnOptions | undefined;
      expect(workerCall?.prompt).toBe('List all TypeScript files in src/');
      expect(workerCall?.model).toBe('haiku');
      expect(workerCall?.maxTurns).toBe(5);
      // read-only profile → Read, Glob, Grep
      expect(workerCall?.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    });
  });

  describe('Task Classification + Auto-Delegation (OB-405)', () => {
    beforeEach(async () => {
      mockSpawn.mockReset();
      mockStream.mockReset();

      masterManager = new MasterManager({
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      });
      await masterManager.start();
    });

    // -----------------------------------------------------------------------
    // (1) classifyTask() correctly classifies 10+ example messages
    // -----------------------------------------------------------------------
    describe('classifyTask()', () => {
      beforeEach(() => {
        // Restore real classifyTask so we test AI + keyword-fallback behaviour.
        // Use the original prototype method captured before any spy was applied.
        MasterManager.prototype.classifyTask = _originalClassifyTask;
        // AI calls are mocked to reject by default, forcing keyword-heuristic fallback.
        mockSpawn.mockRejectedValue(new Error('classifier disabled in tests'));
      });

      it('classifies "what is this project?" as quick-answer', async () => {
        expect((await masterManager.classifyTask('what is this project?')).class).toBe(
          'quick-answer',
        );
      });

      it('classifies "how does the router work?" as quick-answer', async () => {
        expect((await masterManager.classifyTask('how does the router work?')).class).toBe(
          'quick-answer',
        );
      });

      it('classifies "explain the bridge architecture" as quick-answer', async () => {
        expect((await masterManager.classifyTask('explain the bridge architecture')).class).toBe(
          'quick-answer',
        );
      });

      it('classifies "list all files in src/" as quick-answer', async () => {
        expect((await masterManager.classifyTask('list all files in src/')).class).toBe(
          'quick-answer',
        );
      });

      it('classifies "show me the config schema" as quick-answer', async () => {
        expect((await masterManager.classifyTask('show me the config schema')).class).toBe(
          'quick-answer',
        );
      });

      it('classifies "generate an HTML report" as quick-answer (text-generation)', async () => {
        expect((await masterManager.classifyTask('generate an HTML report')).class).toBe(
          'quick-answer',
        );
      });

      it('classifies "create a new test file for auth.ts" as tool-use', async () => {
        expect((await masterManager.classifyTask('create a new test file for auth.ts')).class).toBe(
          'tool-use',
        );
      });

      it('classifies "write a README section about configuration" as quick-answer (text-generation)', async () => {
        expect(
          (await masterManager.classifyTask('write a README section about configuration')).class,
        ).toBe('quick-answer');
      });

      it('classifies "fix the bug in queue.ts line 42" as tool-use', async () => {
        expect((await masterManager.classifyTask('fix the bug in queue.ts line 42')).class).toBe(
          'tool-use',
        );
      });

      it('classifies "make a Dockerfile for this project" as tool-use', async () => {
        expect((await masterManager.classifyTask('make a Dockerfile for this project')).class).toBe(
          'tool-use',
        );
      });

      it('classifies "implement user authentication" as complex-task', async () => {
        expect((await masterManager.classifyTask('implement user authentication')).class).toBe(
          'complex-task',
        );
      });

      it('classifies "build a REST API for the dashboard" as complex-task', async () => {
        expect((await masterManager.classifyTask('build a REST API for the dashboard')).class).toBe(
          'complex-task',
        );
      });

      it('classifies "refactor the MasterManager to use async generators" as complex-task', async () => {
        expect(
          (await masterManager.classifyTask('refactor the MasterManager to use async generators'))
            .class,
        ).toBe('complex-task');
      });

      it('is case-insensitive (IMPLEMENT → complex-task)', async () => {
        expect((await masterManager.classifyTask('IMPLEMENT a login flow')).class).toBe(
          'complex-task',
        );
      });

      it('is case-insensitive (GENERATE → quick-answer / text-generation)', async () => {
        expect((await masterManager.classifyTask('GENERATE a config file')).class).toBe(
          'quick-answer',
        );
      });

      it('falls back to tool-use when AI returns an unrecognised response', async () => {
        mockSpawn.mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'I cannot determine the category',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });
        expect((await masterManager.classifyTask('provide me a HTML Preview')).class).toBe(
          'tool-use',
        );
      });

      it('uses AI result when it returns a valid JSON category', async () => {
        mockSpawn.mockResolvedValueOnce({
          exitCode: 0,
          stdout:
            '{"class":"complex-task","maxTurns":20,"reason":"full-stack app requires multi-step planning"}',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });
        // "provide" is not a keyword — keyword fallback would give quick-answer,
        // but AI correctly returns complex-task with a custom maxTurns
        const result = await masterManager.classifyTask('provide me a full-stack web app');
        expect(result.class).toBe('complex-task');
        expect(result.maxTurns).toBe(20);
        expect(result.timeout).toBe(20 * 30_000); // 600_000ms = 10 min
        expect(result.reason).toBe('full-stack app requires multi-step planning');
      });

      it('returns AI-suggested maxTurns and derived timeout in the result', async () => {
        mockSpawn.mockResolvedValueOnce({
          exitCode: 0,
          stdout:
            '{"class":"tool-use","maxTurns":15,"reason":"generating an HTML page takes more turns"}',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });
        const result = await masterManager.classifyTask('provide me a HTML Preview');
        expect(result.class).toBe('tool-use');
        expect(result.maxTurns).toBe(15);
        expect(result.timeout).toBe(15 * 30_000); // 450_000ms
      });

      it('result has a reason field', async () => {
        const result = await masterManager.classifyTask('what is this project?');
        expect(typeof result.reason).toBe('string');
      });

      it('returns per-class timeout derived from maxTurns (keyword heuristics)', async () => {
        const quick = await masterManager.classifyTask('what is this project?');
        expect(quick.class).toBe('quick-answer');
        expect(quick.timeout).toBe(5 * 30_000); // 150_000ms

        const toolUse = await masterManager.classifyTask('fix the bug in queue.ts');
        expect(toolUse.class).toBe('tool-use');
        expect(toolUse.timeout).toBe(15 * 30_000); // 450_000ms

        const complex = await masterManager.classifyTask('implement user authentication');
        expect(complex.class).toBe('complex-task');
        expect(complex.timeout).toBe(25 * 30_000); // 750_000ms
      });

      // OB-1302: execution / delegation keyword and phrase tests
      it('classifies "execute group A" as complex-task', async () => {
        expect((await masterManager.classifyTask('execute group A')).class).toBe('complex-task');
      });

      it('classifies "start the execution" as complex-task', async () => {
        expect((await masterManager.classifyTask('start the execution')).class).toBe(
          'complex-task',
        );
      });

      it('classifies "begin task 5" as complex-task', async () => {
        expect((await masterManager.classifyTask('begin task 5')).class).toBe('complex-task');
      });

      it('classifies "launch the workers" as complex-task', async () => {
        expect((await masterManager.classifyTask('launch the workers')).class).toBe('complex-task');
      });

      it('classifies "proceed with the plan" as complex-task', async () => {
        expect((await masterManager.classifyTask('proceed with the plan')).class).toBe(
          'complex-task',
        );
      });

      it('classifies "run tasks" as complex-task', async () => {
        expect((await masterManager.classifyTask('run tasks')).class).toBe('complex-task');
      });

      it('classifies "read file X" as tool-use (unchanged by new keywords)', async () => {
        expect((await masterManager.classifyTask('read file X')).class).toBe('tool-use');
      });

      it('classifies "what is X?" as quick-answer (unchanged by new keywords)', async () => {
        expect((await masterManager.classifyTask('what is X?')).class).toBe('quick-answer');
      });
    });

    // -----------------------------------------------------------------------
    // (1b) Classification cache — normalizeForCache + cache hit + feedback
    // -----------------------------------------------------------------------
    describe('classification cache', () => {
      beforeEach(() => {
        // Restore real classifyTask so we test caching behavior
        MasterManager.prototype.classifyTask = _originalClassifyTask;
        // AI calls reject by default — forcing keyword-heuristic fallback
        mockSpawn.mockRejectedValue(new Error('classifier disabled in tests'));
      });

      it('normalizeForCache lowercases and strips punctuation', () => {
        expect(masterManager.normalizeForCache('What is this?')).toBe('what is this');
        expect(masterManager.normalizeForCache('Create a README!')).toBe('create a readme');
        expect(masterManager.normalizeForCache('  multiple   spaces  ')).toBe('multiple spaces');
      });

      it('normalizeForCache treats same message with different case/punctuation as equal', () => {
        const a = masterManager.normalizeForCache('Generate an HTML report!');
        const b = masterManager.normalizeForCache('generate an html report');
        expect(a).toBe(b);
      });

      it('second call with same (normalized) message hits cache and returns same result', async () => {
        const msg1 = 'generate a config file';
        const msg2 = 'GENERATE A CONFIG FILE!';

        const result1 = await masterManager.classifyTask(msg1);
        // Clear spawn mock to confirm second call does not invoke AI
        mockSpawn.mockReset();

        const result2 = await masterManager.classifyTask(msg2);
        expect(result2.class).toBe(result1.class);
        expect(result2.maxTurns).toBe(result1.maxTurns);
        // AI should NOT have been called again
        expect(mockSpawn).not.toHaveBeenCalled();
      });

      it('cache miss classifies and populates cache', async () => {
        const msg = 'explain the bridge architecture unique-xyz';
        const result = await masterManager.classifyTask(msg);
        expect(result.class).toBe('quick-answer');

        // Second call hits cache
        mockSpawn.mockReset();
        const result2 = await masterManager.classifyTask(msg);
        expect(result2.class).toBe('quick-answer');
        expect(mockSpawn).not.toHaveBeenCalled();
      });

      it('recordClassificationFeedback records success feedback', async () => {
        // Prime the cache with a classification
        await masterManager.classifyTask('what is typescript?');
        const key = masterManager.normalizeForCache('what is typescript?');

        await masterManager.recordClassificationFeedback(key, true, false);
        // No error thrown — feedback recorded silently
      });

      it('recordClassificationFeedback does nothing for unknown key', async () => {
        // Should not throw for an unseen key
        await expect(
          masterManager.recordClassificationFeedback('nonexistent-key-xyz', true, false),
        ).resolves.not.toThrow();
      });

      it('repeated timeouts log warning but do not bump maxTurns', async () => {
        const msg = 'implement auth system for testing';
        // First classify to populate cache
        const initial = await masterManager.classifyTask(msg);
        const key = masterManager.normalizeForCache(msg);
        const originalMaxTurns = initial.maxTurns;

        // Record 2 timeout feedbacks
        await masterManager.recordClassificationFeedback(key, false, true);
        await masterManager.recordClassificationFeedback(key, false, true);

        // maxTurns stays the same — bumping turn budget doesn't help
        // wall-clock timeouts (the per-class timeout map is the proper fix)
        mockSpawn.mockReset();
        const updated = await masterManager.classifyTask(msg);
        expect(updated.maxTurns).toBe(originalMaxTurns);
        expect(updated.timeout).toBe(updated.maxTurns * 30_000);
      });
    });

    // -----------------------------------------------------------------------
    // OB-503: AI classification integration tests
    // -----------------------------------------------------------------------
    describe('AI classification integration (OB-503)', () => {
      beforeEach(() => {
        // Restore real classifyTask so AI spawn call is actually made
        MasterManager.prototype.classifyTask = _originalClassifyTask;
      });

      it('processMessage() uses AI-classified maxTurns for a tool-use task', async () => {
        // Call 0: AI classifier → tool-use with 12 turns
        mockSpawn.mockResolvedValueOnce({
          exitCode: 0,
          stdout:
            '{"class":"tool-use","maxTurns":12,"reason":"HTML generation is a single file task"}',
          stderr: '',
          retryCount: 0,
          durationMs: 90,
        });

        // Call 1: Master executes the tool-use task directly
        mockSpawn.mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'preview.html has been created.',
          stderr: '',
          retryCount: 0,
          durationMs: 300,
        });

        const message: InboundMessage = {
          id: 'msg-ai-tooluse',
          source: 'test',
          sender: '+1234567890',
          rawContent: '/ai provide me a HTML Preview',
          content: 'provide me a HTML Preview',
          timestamp: new Date(),
        };

        const response = await masterManager.processMessage(message);

        // Two spawn calls: AI classifier + task execution
        expect(mockSpawn).toHaveBeenCalledTimes(2);

        // First call is the AI classifier: haiku, maxTurns=1
        const classifierCall = getSpawnCallOpts(0);
        expect(classifierCall?.model).toBe('haiku');
        expect(classifierCall?.maxTurns).toBe(1);
        expect(classifierCall?.prompt).toContain('provide me a HTML Preview');

        // Second call uses the AI-classified maxTurns (12), not keyword default (3 or 10)
        const taskCall = getSpawnCallOpts(1);
        expect(taskCall?.maxTurns).toBe(12);
        // Timeout is derived from AI-classified maxTurns: 12 × 30s = 360s
        expect(taskCall?.timeout).toBe(12 * 30_000);

        expect(response).toBe('preview.html has been created.');
      });

      it('processMessage() with AI classification drives full delegation flow for complex tasks', async () => {
        // "provide me a full-stack auth system" — keywords would NOT classify this as complex-task
        // ("provide" is not in keyword list → quick-answer by keyword fallback)
        // AI correctly returns complex-task.

        // Call 0: AI classifier → complex-task
        mockSpawn.mockResolvedValueOnce({
          exitCode: 0,
          stdout:
            '{"class":"complex-task","maxTurns":20,"reason":"full-stack auth requires many steps"}',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        });

        // Call 1: Planning prompt → SPAWN markers
        mockSpawn.mockResolvedValueOnce({
          exitCode: 0,
          stdout:
            'Planning complete.\n\n' +
            '[SPAWN:code-edit]{"prompt":"Add auth routes to src/routes/auth.ts","model":"sonnet","maxTurns":15}[/SPAWN]',
          stderr: '',
          retryCount: 0,
          durationMs: 400,
        });

        // Call 2: Worker execution
        mockSpawn.mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Auth routes created in src/routes/auth.ts.',
          stderr: '',
          retryCount: 0,
          durationMs: 500,
        });

        // Call 3: Synthesis
        mockSpawn.mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'Authentication system has been set up. Routes added to src/routes/auth.ts.',
          stderr: '',
          retryCount: 0,
          durationMs: 200,
        });

        const message: InboundMessage = {
          id: 'msg-ai-complex-integration',
          source: 'test',
          sender: '+1234567890',
          rawContent: '/ai provide me a full-stack auth system',
          content: 'provide me a full-stack auth system',
          timestamp: new Date(),
        };

        const response = await masterManager.processMessage(message);

        // 4 calls: AI classifier, planning, worker, synthesis
        expect(mockSpawn).toHaveBeenCalledTimes(4);

        // Call 0: AI classifier with haiku
        const classifierCall = getSpawnCallOpts(0);
        expect(classifierCall?.model).toBe('haiku');
        expect(classifierCall?.maxTurns).toBe(1);

        // Call 1: Planning prompt (complex-task → planning flow)
        const planningCall = getSpawnCallOpts(1);
        expect(planningCall?.prompt).toContain('provide me a full-stack auth system');
        expect(planningCall?.prompt).toContain('SPAWN');
        expect(planningCall?.maxTurns).toBe(25); // MESSAGE_MAX_TURNS_PLANNING
        // Timeout derived from planning turns: 25 × 30s = 750s
        expect(planningCall?.timeout).toBe(25 * 30_000);

        // Call 2: Worker with code-edit profile tools
        const workerCall = getSpawnCallOpts(2);
        expect(workerCall?.prompt).toBe('Add auth routes to src/routes/auth.ts');
        expect(workerCall?.model).toBe('sonnet');
        expect(workerCall?.allowedTools).toContain('Edit');

        // Final response is the synthesis
        expect(response).toBe(
          'Authentication system has been set up. Routes added to src/routes/auth.ts.',
        );
      });

      it('processMessage() falls back to keyword heuristics when AI classifier fails during processing', async () => {
        // Call 0: AI classifier fails → keyword fallback gives tool-use for "fix"
        mockSpawn.mockRejectedValueOnce(new Error('AI unavailable'));

        // Call 1: Master processes the task with keyword-classified maxTurns
        mockSpawn.mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'queue.ts fixed.',
          stderr: '',
          retryCount: 0,
          durationMs: 200,
        });

        const message: InboundMessage = {
          id: 'msg-ai-fallback',
          source: 'test',
          sender: '+1234567890',
          rawContent: '/ai fix the bug in queue.ts',
          content: 'fix the bug in queue.ts',
          timestamp: new Date(),
        };

        const response = await masterManager.processMessage(message);

        // Two calls: (failed) AI classifier + task execution
        expect(mockSpawn).toHaveBeenCalledTimes(2);

        // Task execution uses keyword-fallback maxTurns for tool-use (15)
        const taskCall = getSpawnCallOpts(1);
        expect(taskCall?.maxTurns).toBe(15);
        // Timeout derived from keyword-fallback turns: 15 × 30s = 450s
        expect(taskCall?.timeout).toBe(15 * 30_000);

        expect(response).toBe('queue.ts fixed.');
      });
    });

    // -----------------------------------------------------------------------
    // Classification escalation guard — quick-answer must never be escalated
    // -----------------------------------------------------------------------
    describe('classification escalation guard', () => {
      let memoryManager: MemoryManager;

      beforeEach(() => {
        MasterManager.prototype.classifyTask = _originalClassifyTask;
        mockSpawn.mockRejectedValue(new Error('classifier disabled in tests'));

        // Create a MasterManager with memory so escalation logic can query learnings
        memoryManager = new MemoryManager(':memory:');
        masterManager = new MasterManager({
          workspacePath: testWorkspace,
          masterTool,
          discoveredTools,
          skipAutoExploration: true,
          memory: memoryManager,
        });
      });

      it('does NOT escalate quick-answer even when learned data favors tool-use', async () => {
        // Seed learnings: tool-use has high success rate
        vi.spyOn(memoryManager, 'getLearnedParams').mockResolvedValue({
          model: 'tool-use',
          success_rate: 0.8,
          avg_turns: 3,
          total_tasks: 50,
        });

        // "what is this project?" classifies as quick-answer by keywords
        const result = await masterManager.classifyTask('what is this project?');
        expect(result.class).toBe('quick-answer');
        expect(result.maxTurns).toBe(5);
        expect(result.timeout).toBe(5 * 30_000);
      });

      it('still escalates tool-use to complex-task when learned data supports it', async () => {
        // Seed learnings: complex-task has high success rate
        vi.spyOn(memoryManager, 'getLearnedParams').mockResolvedValue({
          model: 'complex-task',
          success_rate: 0.7,
          avg_turns: 10,
          total_tasks: 30,
        });

        // "fix the bug in queue.ts" classifies as tool-use by keywords
        const result = await masterManager.classifyTask('fix the bug in queue.ts');
        expect(result.class).toBe('complex-task');
        expect(result.maxTurns).toBe(25);
        expect(result.timeout).toBe(25 * 30_000);
        expect(result.reason).toContain('escalated');
      });
    });

    // -----------------------------------------------------------------------
    // (2) processMessage() with a complex task triggers SPAWN markers
    // -----------------------------------------------------------------------
    it('sends a planning prompt (not raw message) for complex tasks', async () => {
      mockSpawn.mockResolvedValue({
        exitCode: 0,
        stdout: 'No tasks to delegate right now.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-complex',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai implement oauth login',
        content: 'implement oauth login',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // The first spawn call should contain the planning prompt wrapper, not the raw message
      const masterCall = getSpawnCallOpts(0);
      expect(masterCall?.prompt).toContain('The user asked:');
      expect(masterCall?.prompt).toContain('implement oauth login');
      expect(masterCall?.prompt).toContain('SPAWN');
      // Planning prompt uses MESSAGE_MAX_TURNS_PLANNING = 25
      expect(masterCall?.maxTurns).toBe(25);
    });

    it('complex task triggers worker spawning when Master returns SPAWN markers', async () => {
      const spawnMarkerResponse =
        `Planning complete.\n\n` +
        `[SPAWN:code-edit]{"prompt":"Add OAuth routes to src/routes/auth.ts","model":"sonnet","maxTurns":15}[/SPAWN]`;

      // Call 1: Master planning → returns SPAWN marker
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: spawnMarkerResponse,
        stderr: '',
        retryCount: 0,
        durationMs: 400,
      });

      // Call 2: Worker executes the subtask
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'OAuth routes added successfully.',
        stderr: '',
        retryCount: 0,
        durationMs: 500,
      });

      // Call 3: Synthesis — Master summarises worker results
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'OAuth login has been implemented. Routes added to src/routes/auth.ts.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-complex-spawn',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai implement oauth login',
        content: 'implement oauth login',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      // Three calls: planning, worker, synthesis
      expect(mockSpawn).toHaveBeenCalledTimes(3);

      // Worker was spawned with correct options from the SPAWN marker
      const workerCall = getSpawnCallOpts(1);
      expect(workerCall?.prompt).toBe('Add OAuth routes to src/routes/auth.ts');
      expect(workerCall?.model).toBe('sonnet');
      // code-edit profile → Read, Edit, Write, Glob, Grep, Bash(git:*), Bash(npm:*), Bash(npx:*)
      expect(workerCall?.allowedTools).toContain('Edit');
      expect(workerCall?.allowedTools).toContain('Write');

      // Final response is the Master's synthesis
      expect(response).toBe(
        'OAuth login has been implemented. Routes added to src/routes/auth.ts.',
      );
    });

    // -----------------------------------------------------------------------
    // (3) Worker results are fed back and synthesized
    // -----------------------------------------------------------------------
    it('injects worker results into the feedback prompt for synthesis', async () => {
      const spawnMarkerResponse = `[SPAWN:read-only]{"prompt":"List key files","model":"haiku","maxTurns":5}[/SPAWN]`;

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: spawnMarkerResponse,
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Key files: src/index.ts, src/core/bridge.ts',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Capture the synthesis call
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Here are the key files in the project.',
        stderr: '',
        retryCount: 0,
        durationMs: 150,
      });

      const message: InboundMessage = {
        id: 'msg-synthesis',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai list key files',
        content: 'list key files',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // The synthesis call (3rd spawn) must include the worker's output
      const synthesisCall = getSpawnCallOpts(2);
      expect(synthesisCall?.prompt).toContain('Key files: src/index.ts, src/core/bridge.ts');
      // Synthesis uses MESSAGE_MAX_TURNS_SYNTHESIS = 5
      expect(synthesisCall?.maxTurns).toBe(5);
    });

    // -----------------------------------------------------------------------
    // Dispatch status message (OB-F77 / OB-1305)
    // -----------------------------------------------------------------------
    it('returns dispatch status message when cleanedOutput < 80 chars and synthesis returns empty', async () => {
      // Planning response: only SPAWN markers, no surrounding text (cleanedOutput = '')
      const spawnOnlyResponse = `[SPAWN:read-only]{"prompt":"List all TypeScript files in src/","model":"haiku","maxTurns":5}[/SPAWN]`;

      // Call 1: Master planning → returns only SPAWN marker (short cleanedOutput)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: spawnOnlyResponse,
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      // Call 2: Worker executes the subtask
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Found 42 TypeScript files.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Call 3: Synthesis — returns empty stdout to trigger status message fallback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-status-short',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai implement auth',
        content: 'implement auth',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      expect(response).toContain('Working on your request');
      expect(response).toContain('dispatching 1 worker(s)');
      expect(response).toContain('List all TypeScript files in src/');
    });

    it('returns synthesis response when cleanedOutput >= 80 chars (no status message override)', async () => {
      // Planning response: SPAWN marker WITH substantial surrounding text (cleanedOutput >= 80 chars)
      const richPlanningResponse =
        `I have analysed your request and broken it into the following concrete subtasks for delegation.\n\n` +
        `[SPAWN:code-edit]{"prompt":"Add OAuth routes to src/routes/auth.ts","model":"sonnet","maxTurns":15}[/SPAWN]`;

      // Call 1: Master planning → returns SPAWN marker with rich text (cleanedOutput >= 80 chars)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: richPlanningResponse,
        stderr: '',
        retryCount: 0,
        durationMs: 400,
      });

      // Call 2: Worker executes the subtask
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'OAuth routes added successfully.',
        stderr: '',
        retryCount: 0,
        durationMs: 500,
      });

      // Call 3: Synthesis — returns actual content
      const synthesisResponse =
        'OAuth login has been implemented. Routes added to src/routes/auth.ts.';
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: synthesisResponse,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-status-long',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai implement auth',
        content: 'implement auth',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      // The synthesis response should be used (not the status message)
      expect(response).toBe(synthesisResponse);
      expect(response).not.toContain('Working on your request');
      expect(response).not.toContain('dispatching');
    });

    // -----------------------------------------------------------------------
    // (4) Quick-answer messages complete in ≤ 3 turns
    // -----------------------------------------------------------------------
    it('quick-answer messages use maxTurns=3', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'TypeScript is a typed superset of JavaScript.',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-quick',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai what is TypeScript?',
        content: 'what is TypeScript?',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      // Only one spawn call — no workers, no synthesis
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      expect(response).toBe('TypeScript is a typed superset of JavaScript.');

      // maxTurns must be the quick-answer budget (3)
      const masterCall = getSpawnCallOpts(0);
      expect(masterCall?.maxTurns).toBe(3);
    });

    it('tool-use messages use maxTurns=10 (not 3 or 5)', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'File created.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-tool-use',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai generate a config file',
        content: 'generate a config file',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      const masterCall = getSpawnCallOpts(0);
      expect(masterCall?.maxTurns).toBe(10);
    });
  });

  describe('Progress Events (OB-513)', () => {
    beforeEach(async () => {
      const dotFolderManager = new DotFolderManager(testWorkspace);
      await dotFolderManager.initialize();

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();
    });

    it('emits classifying and complete events for a simple message', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The answer is 42.',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const progressEvents: string[] = [];
      const mockRouter = {
        sendProgress: vi.fn(async (_src: string, _recipient: string, event: { type: string }) => {
          progressEvents.push(event.type);
        }),
        sendDirect: vi.fn(),
      } as unknown as Router;
      masterManager.setRouter(mockRouter);

      const message: InboundMessage = {
        id: 'msg-p1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai what is the answer?',
        content: 'what is the answer?',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      expect(progressEvents).toContain('classifying');
      expect(progressEvents).toContain('complete');
      // complete must be last
      expect(progressEvents[progressEvents.length - 1]).toBe('complete');
    });

    it('emits planning event for complex tasks', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Done.',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const progressEvents: string[] = [];
      const mockRouter = {
        sendProgress: vi.fn(async (_src: string, _recipient: string, event: { type: string }) => {
          progressEvents.push(event.type);
        }),
        sendDirect: vi.fn(),
      } as unknown as Router;
      masterManager.setRouter(mockRouter);

      const message: InboundMessage = {
        id: 'msg-p2',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai implement a full auth system',
        content: 'implement a full auth system',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      expect(progressEvents).toContain('classifying');
      expect(progressEvents).toContain('planning');
    });

    it('emits spawning, worker-progress, synthesizing, complete for delegation', async () => {
      // First spawn: Master returns SPAWN markers
      mockSpawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout:
            '[SPAWN:read-only]{"prompt":"List files","workspacePath":"/tmp"}[/SPAWN]' +
            '[SPAWN:read-only]{"prompt":"Read README","workspacePath":"/tmp"}[/SPAWN]',
          stderr: '',
          retryCount: 0,
          durationMs: 100,
        })
        // Workers spawn
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'worker1 result',
          stderr: '',
          retryCount: 0,
          durationMs: 50,
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'worker2 result',
          stderr: '',
          retryCount: 0,
          durationMs: 50,
        })
        // Synthesis
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: 'All done.',
          stderr: '',
          retryCount: 0,
          durationMs: 80,
        });

      const progressEvents: Array<{ type: string; workerCount?: number; completed?: number }> = [];
      const mockRouter = {
        sendProgress: vi.fn(
          async (
            _src: string,
            _recipient: string,
            event: { type: string; workerCount?: number; completed?: number },
          ) => {
            progressEvents.push({
              type: event.type,
              workerCount: event.workerCount,
              completed: event.completed,
            });
          },
        ),
        sendDirect: vi.fn(),
      } as unknown as Router;
      masterManager.setRouter(mockRouter);

      const message: InboundMessage = {
        id: 'msg-p3',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai implement auth',
        content: 'implement auth',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      const types = progressEvents.map((e) => e.type);
      expect(types).toContain('classifying');
      expect(types).toContain('spawning');
      expect(types).toContain('synthesizing');
      expect(types).toContain('complete');

      // spawning event carries worker count
      const spawningEvent = progressEvents.find((e) => e.type === 'spawning');
      expect(spawningEvent?.workerCount).toBe(2);

      // worker-progress events
      const workerProgressEvents = progressEvents.filter((e) => e.type === 'worker-progress');
      expect(workerProgressEvents.length).toBeGreaterThanOrEqual(1);

      // complete is always last
      expect(types[types.length - 1]).toBe('complete');
    });

    it('emits complete even when processing fails', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'fatal error',
        retryCount: 0,
        durationMs: 100,
      });

      const progressEvents: string[] = [];
      const mockRouter = {
        sendProgress: vi.fn(async (_src: string, _recipient: string, event: { type: string }) => {
          progressEvents.push(event.type);
        }),
        sendDirect: vi.fn(),
      } as unknown as Router;
      masterManager.setRouter(mockRouter);

      const message: InboundMessage = {
        id: 'msg-p4',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai what is this?',
        content: 'what is this?',
        timestamp: new Date(),
      };

      await expect(masterManager.processMessage(message)).rejects.toThrow();

      // complete must still be emitted on error to clean up status bars
      expect(progressEvents).toContain('complete');
    });

    it('does not throw when no router is set (no progress reporter)', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'response',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      // No router set — makeProgressReporter returns undefined
      const message: InboundMessage = {
        id: 'msg-p5',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      await expect(masterManager.processMessage(message)).resolves.toBe('response');
    });
  });

  describe('Stuck Activity Cleanup (OB-962)', () => {
    it('should mark stuck agent_activity rows as failed on startup', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();

      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const now = new Date().toISOString();

      // Insert a stuck activity (older than 1 hour, still "running")
      await memory.insertActivity({
        id: 'stuck-worker-1',
        type: 'worker',
        status: 'running',
        task_summary: 'Stuck task from previous session',
        started_at: twoHoursAgo,
        updated_at: twoHoursAgo,
      });

      // Insert a stuck activity with status "starting"
      await memory.insertActivity({
        id: 'stuck-worker-2',
        type: 'worker',
        status: 'starting',
        task_summary: 'Another stuck task',
        started_at: twoHoursAgo,
        updated_at: twoHoursAgo,
      });

      // Insert a recent running activity (should NOT be cleaned up)
      await memory.insertActivity({
        id: 'recent-worker',
        type: 'worker',
        status: 'running',
        task_summary: 'Recent task',
        started_at: now,
        updated_at: now,
      });

      // Insert an already-completed activity (should NOT be touched)
      await memory.insertActivity({
        id: 'done-worker',
        type: 'worker',
        status: 'done',
        task_summary: 'Completed task',
        started_at: twoHoursAgo,
        updated_at: twoHoursAgo,
        completed_at: twoHoursAgo,
      });

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
        memory,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      // Verify ALL previous in-flight activities were marked as done on startup.
      // On a fresh process start, every row from the old process is stale.
      const activeAgents = await memory.getActiveAgents();
      const activeIds = activeAgents.map((a) => a.id);

      // None of the old workers should remain active
      expect(activeIds).not.toContain('recent-worker');
      expect(activeIds).not.toContain('stuck-worker-1');
      expect(activeIds).not.toContain('stuck-worker-2');
    });

    it('should not fail when memory is null', async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
        // No memory — cleanupStuckActivities should return early
      };

      masterManager = new MasterManager(options);

      // Should not throw
      await expect(masterManager.start()).resolves.not.toThrow();
      expect(masterManager.getState()).toBe('ready');
    });

    it('should clean up all in-flight activities regardless of age', async () => {
      const memory = new MemoryManager(':memory:');
      await memory.init();

      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

      await memory.insertActivity({
        id: 'recent-running',
        type: 'worker',
        status: 'running',
        task_summary: 'Recently started task',
        started_at: thirtyMinutesAgo,
        updated_at: thirtyMinutesAgo,
      });

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
        memory,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      const activeAgents = await memory.getActiveAgents();
      // On startup ALL previous in-flight rows are stale — the old process is gone.
      const activeWorkers = activeAgents.filter((a) => a.type === 'worker');
      expect(activeWorkers).toHaveLength(0);
    });
  });

  describe('Error Recovery (recover()) (OB-F58)', () => {
    it('should reset state from error to idle', async () => {
      // Arrange: force exploration to fail so state becomes 'error'
      mockSpawn.mockRejectedValue(new Error('Simulated exploration failure'));

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: false,
      };

      masterManager = new MasterManager(options);

      try {
        await masterManager.start();
      } catch {
        // Expected — exploration failure causes start() to throw
      }

      expect(masterManager.getState()).toBe('error');

      // Prevent the fire-and-forget re-exploration from changing state before assertion
      vi.spyOn(masterManager, 'explore').mockResolvedValue(undefined);

      // Act
      await masterManager.recover();

      // Assert: state is now 'idle'
      expect(masterManager.getState()).toBe('idle');
    });

    it('should be a no-op when state is not error', async () => {
      // Arrange: start manager normally — state will be 'ready'
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      expect(masterManager.getState()).toBe('ready');

      // Act
      await masterManager.recover();

      // Assert: state unchanged — recover() is a no-op outside 'error' state
      expect(masterManager.getState()).toBe('ready');
    });

    it('should call explore() to retry when explorationSummary.status is failed', async () => {
      // Arrange: force exploration to fail
      mockSpawn.mockRejectedValue(new Error('Simulated exploration failure'));

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: false,
      };

      masterManager = new MasterManager(options);

      try {
        await masterManager.start();
      } catch {
        // Expected
      }

      expect(masterManager.getExplorationSummary()?.status).toBe('failed');

      // Replace explore() with a spy so we can track calls without running actual exploration
      const exploreSpy = vi.spyOn(masterManager, 'explore').mockResolvedValue(undefined);

      // Act
      await masterManager.recover();

      // Assert: explore() was called once for the retry attempt
      expect(exploreSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Context Injection via KnowledgeRetriever (OB-1350)', () => {
    let mockRetriever: {
      query: ReturnType<typeof vi.fn>;
      formatKnowledgeContext: ReturnType<typeof vi.fn>;
    };

    beforeEach(async () => {
      const dotFolderManager = new DotFolderManager(testWorkspace);
      await dotFolderManager.initialize();

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      mockRetriever = {
        query: vi.fn(),
        formatKnowledgeContext: vi.fn(),
      };
    });

    it('should store the knowledge retriever via setKnowledgeRetriever()', async () => {
      // setKnowledgeRetriever() stores the retriever — verified by observing query() is called
      mockRetriever.query.mockResolvedValue({ chunks: [], confidence: 0.1, sources: [] });
      masterManager.setKnowledgeRetriever(mockRetriever as unknown as KnowledgeRetriever);

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Answer',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai what is this project?',
        content: 'what is this project?',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // If the retriever was stored, query() must have been called
      expect(mockRetriever.query).toHaveBeenCalledOnce();
    });

    it('should trigger retrieval for quick-answer (codebase question) task class', async () => {
      mockRetriever.query.mockResolvedValue({ chunks: [], confidence: 0.1, sources: [] });
      masterManager.setKnowledgeRetriever(mockRetriever as unknown as KnowledgeRetriever);

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Answer to question',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      // No action keywords → classifyTask mock returns quick-answer
      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai what does this project do?',
        content: 'what does this project do?',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      expect(mockRetriever.query).toHaveBeenCalledOnce();
      expect(mockRetriever.query).toHaveBeenCalledWith('what does this project do?');
    });

    it('should inject knowledge context into system prompt when confidence >= 0.3', async () => {
      // Use a unique marker so we can assert its presence regardless of base system prompt text
      const formattedContext =
        '## Relevant Knowledge\nSome relevant info — UNIQUE_RAG_MARKER_OB1350 about the codebase';
      mockRetriever.query.mockResolvedValue({
        chunks: [{ content: 'some content', source: 'src/core/router.ts', score: 0.9 }],
        confidence: 0.8,
        sources: ['src/core/router.ts'],
      });
      mockRetriever.formatKnowledgeContext.mockReturnValue(formattedContext);
      masterManager.setKnowledgeRetriever(mockRetriever as unknown as KnowledgeRetriever);

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Answer',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai explain the router',
        content: 'explain the router',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // formatKnowledgeContext should have been called with the high-confidence result
      expect(mockRetriever.formatKnowledgeContext).toHaveBeenCalledOnce();
      // The unique marker from the formatted context should appear in the system prompt
      const spawnOpts = getSpawnCallOpts(0);
      expect(spawnOpts?.systemPrompt).toContain('UNIQUE_RAG_MARKER_OB1350');
      expect(spawnOpts?.systemPrompt).toContain(formattedContext);
    });

    it('should NOT inject knowledge context when confidence < 0.3', async () => {
      mockRetriever.query.mockResolvedValue({ chunks: [], confidence: 0.1, sources: [] });
      masterManager.setKnowledgeRetriever(mockRetriever as unknown as KnowledgeRetriever);

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Answer',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai what is the config format?',
        content: 'what is the config format?',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // formatKnowledgeContext must NOT be called — confidence is below 0.3 threshold
      expect(mockRetriever.formatKnowledgeContext).not.toHaveBeenCalled();
      // The unique marker only present when RAG content is actually injected must be absent
      const spawnOpts = getSpawnCallOpts(0);
      expect(spawnOpts?.systemPrompt).not.toContain('UNIQUE_RAG_MARKER_OB1350');
    });

    it('should NOT trigger retrieval for complex-task class', async () => {
      masterManager.setKnowledgeRetriever(mockRetriever as unknown as KnowledgeRetriever);

      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: '[SPAWN:worker1:{}:SPAWN] Planning complete.',
        stderr: '',
        retryCount: 0,
        durationMs: 100,
      });

      // 'implement' triggers complex-task in the classifyTask mock
      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai implement a new feature',
        content: 'implement a new feature',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // retriever.query() must NOT be called for complex-task
      expect(mockRetriever.query).not.toHaveBeenCalled();
    });
  });
});
