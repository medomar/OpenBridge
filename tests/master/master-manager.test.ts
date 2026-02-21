import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { MasterManagerOptions } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
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
      expect(session?.sessionId).toMatch(/^master-/);
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
        sessionId: 'master-existing-session',
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
      expect(session?.sessionId).toBe('master-existing-session');
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

    it('should use --session-id on first call and --resume on subsequent calls', async () => {
      mockSpawn.mockResolvedValue({
        exitCode: 0,
        stdout: 'Response',
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

      // First call should use sessionId (new session)
      const call1 = getSpawnCallOpts(0);
      expect(call1?.sessionId).toBeDefined();
      expect(call1?.sessionId).toMatch(/^master-/);
      expect(call1?.resumeSessionId).toBeUndefined();

      // Second call should use resumeSessionId
      const call2 = getSpawnCallOpts(1);
      expect(call2?.resumeSessionId).toBeDefined();
      expect(call2?.resumeSessionId).toBe(call1?.sessionId);
      expect(call2?.sessionId).toBeUndefined();
    });

    it('should use the same Master session for different senders', async () => {
      mockSpawn.mockResolvedValue({
        exitCode: 0,
        stdout: 'Response',
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

      // Both messages should use the same Master session
      const call1 = getSpawnCallOpts(0);
      const call2 = getSpawnCallOpts(1);

      // First call: --session-id, second call: --resume with same session ID
      expect(call1?.sessionId).toBeDefined();
      expect(call2?.resumeSessionId).toBe(call1?.sessionId);
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
      expect(call?.maxTurns).toBe(50);
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
});
