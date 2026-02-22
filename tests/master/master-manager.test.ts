import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { MasterManagerOptions } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { Router } from '../../src/core/router.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Helper to extract SpawnOptions from mock call args */
function getSpawnCallOpts(callIndex: number): SpawnOptions | undefined {
  return mockSpawn.mock.calls[callIndex]?.[0] as SpawnOptions | undefined;
}

// Mock AgentRunner (used by MasterManager, DelegationCoordinator)
const mockSpawn = vi.fn();
const mockStream = vi.fn();
vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: mockSpawn,
    stream: mockStream,
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
    return {
      prompt: manifest.prompt,
      workspacePath: manifest.workspacePath,
      model: manifest.model,
      allowedTools,
      maxTurns: manifest.maxTurns,
      timeout: manifest.timeout,
      retries: manifest.retries,
      retryDelay: manifest.retryDelay,
    };
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

describe('MasterManager', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;
  let masterTool: DiscoveredTool;
  let discoveredTools: DiscoveredTool[];

  beforeEach(async () => {
    // Create temporary test workspace
    testWorkspace = path.join(process.cwd(), 'test-workspace-master-' + Date.now());
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

      // Write a valid workspace map so exploration is skipped
      await dotFolder.writeMap({
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
      });

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: false,
      };

      masterManager = new MasterManager(options);
      await masterManager.start();

      const session = masterManager.getMasterSession();
      expect(session?.sessionId).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(session?.messageCount).toBe(5);
    });

    it('should load existing workspace map if .openbridge folder exists', async () => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: false,
      };

      // Initialize .openbridge folder with git and workspace map
      const dotFolderManager = new DotFolderManager(testWorkspace);
      await dotFolderManager.initialize();

      const workspaceMap = {
        workspacePath: testWorkspace,
        projectName: 'existing-project',
        projectType: 'python',
        frameworks: ['django'],
        structure: {},
        keyFiles: [],
        entryPoints: [],
        commands: {},
        dependencies: [],
        summary: 'Existing workspace',
        generatedAt: new Date().toISOString(),
        schemaVersion: '1.0.0',
      };

      await dotFolderManager.writeMap(workspaceMap);

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

      // Write a valid workspace map so exploration is skipped
      await dotFolder.writeMap({
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
      });

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: false,
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
      // Write a workspace map
      const dotFolder = new DotFolderManager(testWorkspace);
      await dotFolder.writeMap({
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
      });

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

      await masterManager.processMessage(message);

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
});
