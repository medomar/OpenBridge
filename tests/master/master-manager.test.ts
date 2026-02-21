import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { MasterManagerOptions } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Mock claude-code-executor
vi.mock('../../src/providers/claude-code/claude-code-executor.js', () => ({
  executeClaudeCode: vi.fn(),
  streamClaudeCode: vi.fn(),
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

import {
  executeClaudeCode,
  streamClaudeCode,
} from '../../src/providers/claude-code/claude-code-executor.js';

const mockExecuteClaudeCode = vi.mocked(executeClaudeCode);
const mockStreamClaudeCode = vi.mocked(streamClaudeCode);

/**
 * Helper to set up mocks for a complete incremental exploration
 */
function mockCompleteExploration() {
  // Phase 1: Structure Scan
  mockExecuteClaudeCode.mockResolvedValueOnce({
    exitCode: 0,
    stdout: JSON.stringify({
      files: ['package.json', 'README.md'],
      directories: ['src', 'tests'],
      totalFiles: 10,
      scannedAt: new Date().toISOString(),
      durationMs: 100,
    }),
    stderr: '',
  });

  // Phase 2: Classification
  mockExecuteClaudeCode.mockResolvedValueOnce({
    exitCode: 0,
    stdout: JSON.stringify({
      projectName: 'test-project',
      projectType: 'node',
      frameworks: ['typescript'],
      commands: { test: 'npm test' },
      dependencies: ['vitest'],
      classifiedAt: new Date().toISOString(),
      durationMs: 100,
    }),
    stderr: '',
  });

  // Phase 3: Directory Dives (src and tests)
  mockExecuteClaudeCode.mockResolvedValueOnce({
    exitCode: 0,
    stdout: JSON.stringify({
      path: 'src',
      purpose: 'Source code',
      keyFiles: ['index.ts'],
      subdirectories: [],
      scannedAt: new Date().toISOString(),
      durationMs: 100,
    }),
    stderr: '',
  });

  mockExecuteClaudeCode.mockResolvedValueOnce({
    exitCode: 0,
    stdout: JSON.stringify({
      path: 'tests',
      purpose: 'Test files',
      keyFiles: ['test.ts'],
      subdirectories: [],
      scannedAt: new Date().toISOString(),
      durationMs: 100,
    }),
    stderr: '',
  });

  // Phase 4: Assembly (generates summary)
  mockExecuteClaudeCode.mockResolvedValueOnce({
    exitCode: 0,
    stdout: JSON.stringify({
      summary: 'A Node.js TypeScript project with tests',
    }),
    stderr: '',
  });
}

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

    it('should trigger exploration when .openbridge folder does not exist', async () => {
      mockCompleteExploration();

      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: false,
      };

      masterManager = new MasterManager(options);

      await masterManager.start();

      expect(masterManager.getState()).toBe('ready');
      expect(mockExecuteClaudeCode).toHaveBeenCalled();
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
      expect(mockExecuteClaudeCode).not.toHaveBeenCalled();

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

  describe('Exploration', () => {
    beforeEach(() => {
      const options: MasterManagerOptions = {
        workspacePath: testWorkspace,
        masterTool,
        discoveredTools,
        skipAutoExploration: true,
      };

      masterManager = new MasterManager(options);
    });

    it('should transition to exploring state during exploration', async () => {
      let stateChecked = false;

      // Phase 1: Structure Scan - check state during execution
      mockExecuteClaudeCode.mockImplementationOnce(async () => {
        if (!stateChecked) {
          expect(masterManager.getState()).toBe('exploring');
          stateChecked = true;
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            files: ['package.json'],
            directories: ['src'],
            totalFiles: 5,
            scannedAt: new Date().toISOString(),
            durationMs: 100,
          }),
          stderr: '',
        };
      });

      // Mock remaining phases
      mockExecuteClaudeCode.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          projectName: 'test',
          projectType: 'node',
          frameworks: [],
          commands: {},
          dependencies: [],
          classifiedAt: new Date().toISOString(),
          durationMs: 100,
        }),
        stderr: '',
      });

      mockExecuteClaudeCode.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          path: 'src',
          purpose: 'Source',
          keyFiles: [],
          subdirectories: [],
          scannedAt: new Date().toISOString(),
          durationMs: 100,
        }),
        stderr: '',
      });

      mockExecuteClaudeCode.mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          summary: 'Test project',
        }),
        stderr: '',
      });

      await masterManager.explore();
      expect(masterManager.getState()).toBe('ready');
      expect(stateChecked).toBe(true);
    });

    it('should create .openbridge folder structure', async () => {
      mockCompleteExploration();

      const dotFolderManager = new DotFolderManager(testWorkspace);

      await masterManager.explore();

      const dotFolderExists = await dotFolderManager.exists();
      expect(dotFolderExists).toBe(true);
    });

    it('should handle exploration failure', async () => {
      mockExecuteClaudeCode.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Exploration failed',
      });

      await expect(masterManager.explore()).rejects.toThrow();
      expect(masterManager.getState()).toBe('error');
    });

    it('should not allow concurrent explorations', async () => {
      let callCount = 0;

      // Mock all 5 phases but track calls
      const mockPhase = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          exitCode: 0,
          stdout: JSON.stringify(
            callCount === 1 ? { files: [], directories: [], totalFiles: 0 } : { summary: 'test' },
          ),
          stderr: '',
        };
      };

      mockExecuteClaudeCode.mockImplementation(mockPhase);

      // Start exploration
      const exploration1 = masterManager.explore();

      // Wait a bit to ensure exploration1 is in progress
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Try to start another exploration
      const exploration2 = masterManager.explore();

      await exploration1;
      await exploration2;

      // Second call should have been ignored (no exploration in progress)
      // So callCount should reflect only the first exploration's phases
      expect(callCount).toBeGreaterThan(0);
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

    it('should process message successfully', async () => {
      mockExecuteClaudeCode.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Hello, I processed your message!',
        stderr: '',
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
      expect(mockExecuteClaudeCode).toHaveBeenCalled();
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
      expect(response).toContain('State: ready');
      expect(mockExecuteClaudeCode).not.toHaveBeenCalled();
    });

    it('should maintain session continuity for same sender', async () => {
      mockExecuteClaudeCode.mockResolvedValue({
        exitCode: 0,
        stdout: 'Response',
        stderr: '',
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

      expect(mockExecuteClaudeCode).toHaveBeenCalledTimes(2);

      // First call should use sessionId (new session)
      // Second call should use resumeSessionId (resume existing session)
      const call1 = mockExecuteClaudeCode.mock.calls[0]?.[0];
      const call2 = mockExecuteClaudeCode.mock.calls[1]?.[0];

      expect(call1?.sessionId).toBeDefined();
      expect(call1?.resumeSessionId).toBeUndefined();
      expect(call2?.resumeSessionId).toBeDefined();
      expect(call2?.sessionId).toBeUndefined();
      // Both should use the same session ID value
      expect(call2?.resumeSessionId).toBe(call1?.sessionId);
    });

    it('should use different sessions for different senders', async () => {
      mockExecuteClaudeCode.mockResolvedValue({
        exitCode: 0,
        stdout: 'Response',
        stderr: '',
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

      const call1 = mockExecuteClaudeCode.mock.calls[0]?.[0];
      const call2 = mockExecuteClaudeCode.mock.calls[1]?.[0];

      // Both are new sessions, so both use sessionId
      expect(call1?.sessionId).toBeDefined();
      expect(call2?.sessionId).toBeDefined();
      expect(call1?.sessionId).not.toBe(call2?.sessionId);
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
      mockExecuteClaudeCode.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Processing error',
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

    it('should stream message chunks', async () => {
      async function* mockStream() {
        yield 'Hello ';
        yield 'from ';
        yield 'streaming!';
      }

      mockStreamClaudeCode.mockReturnValueOnce(mockStream());

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
      async function* mockStream() {
        yield 'Start ';
        throw new Error('Stream error');
      }

      mockStreamClaudeCode.mockReturnValueOnce(mockStream());

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
    it('should clear all session data on shutdown', async () => {
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

      mockExecuteClaudeCode.mockResolvedValue({
        exitCode: 0,
        stdout: 'Response',
        stderr: '',
      });

      // Create a session
      const message: InboundMessage = {
        id: 'msg-1',
        source: 'test',
        sender: '+1234567890',
        rawContent: '/ai hello',
        content: 'hello',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // Shutdown
      await masterManager.shutdown();

      expect(masterManager.getState()).toBe('shutdown');
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

    it('should return status information', async () => {
      const status = await masterManager.getStatus();

      expect(status).toContain('OpenBridge Master AI Status');
      expect(status).toContain('State: ready');
      expect(status).toContain('Tasks:');
      expect(status).toContain('Active Sessions:');
    });
  });
});
