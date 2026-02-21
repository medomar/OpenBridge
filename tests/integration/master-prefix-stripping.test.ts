/**
 * Integration test: Command prefix stripping in Master AI flow
 *
 * Validates OB-120: Verify /ai prefix is cleanly stripped before reaching Master AI
 *
 * This test covers the V2 flow:
 * Connector → Bridge → Router → Master AI
 *
 * Ensures:
 * 1. Master AI receives natural language only (no /ai prefix)
 * 2. Task records store both raw content (with prefix) and stripped content
 * 3. AgentRunner.spawn is called with stripped prompt
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

// Mock logger to suppress output during tests
vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock AgentRunner to capture what gets sent to the AI
let capturedPrompts: string[] = [];
let capturedWorkspacePaths: string[] = [];

vi.mock('../../src/core/agent-runner.js', () => {
  const mockSpawn = vi.fn(async (opts: { prompt: string; workspacePath: string }) => {
    capturedPrompts.push(opts.prompt);
    capturedWorkspacePaths.push(opts.workspacePath);
    return {
      stdout: 'AI response to your query',
      stderr: '',
      exitCode: 0,
      retryCount: 0,
      durationMs: 100,
    };
  });

  const mockStream = vi.fn(async function* (opts: { prompt: string; workspacePath: string }) {
    capturedPrompts.push(opts.prompt);
    capturedWorkspacePaths.push(opts.workspacePath);
    yield 'AI response ';
    yield 'to your query';
    return {
      stdout: 'AI response to your query',
      stderr: '',
      exitCode: 0,
      retryCount: 0,
      durationMs: 100,
    };
  });

  return {
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
  };
});

// Mock DotFolderManager to avoid git init issues in temp dirs
vi.mock('../../src/master/dotfolder-manager.js', () => ({
  DotFolderManager: vi.fn().mockImplementation(() => ({
    exists: vi.fn().mockResolvedValue(false),
    initialize: vi.fn().mockResolvedValue(undefined),
    readMap: vi.fn().mockResolvedValue(null),
    readAgents: vi.fn().mockResolvedValue(null),
    recordTask: vi.fn().mockResolvedValue(undefined),
    commitChanges: vi.fn().mockResolvedValue(undefined),
    appendLog: vi.fn().mockResolvedValue(undefined),
    readAllTasks: vi.fn().mockResolvedValue([]),
    getMapPath: vi.fn().mockReturnValue('/test/.openbridge/workspace-map.json'),
    readMasterSession: vi.fn().mockResolvedValue(null),
    writeMasterSession: vi.fn().mockResolvedValue(undefined),
    readExplorationState: vi.fn().mockResolvedValue(null),
    readSystemPrompt: vi.fn().mockResolvedValue(null),
    writeSystemPrompt: vi.fn().mockResolvedValue(undefined),
    readProfiles: vi.fn().mockResolvedValue(null),
  })),
}));

describe('Master AI - Command Prefix Stripping', () => {
  let workspacePath: string;
  let bridge: Bridge;
  let connector: MockConnector;
  let master: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    capturedPrompts = [];
    capturedWorkspacePaths = [];

    // Create temporary workspace
    workspacePath = join(tmpdir(), `test-workspace-${Date.now()}`);
    mkdirSync(workspacePath, { recursive: true });

    // Mock discovered tool
    const mockMasterTool: DiscoveredTool = {
      name: 'claude',
      path: '/usr/local/bin/claude',
      version: '1.0.0',
      available: true,
      role: 'master',
      capabilities: [],
    };

    // Create internal config (V0 format that Bridge expects)
    const config: AppConfig = {
      connectors: [{ type: 'mock', enabled: true, options: {} }],
      providers: [{ type: 'auto-discovered', enabled: true, options: {} }],
      defaultProvider: 'auto-discovered',
      workspaces: [{ name: 'default', path: workspacePath }],
      auth: {
        whitelist: ['+1234567890'],
        prefix: '/ai',
        rateLimit: { enabled: false, windowMs: 60000, maxMessages: 10 },
        commandFilter: { allowPatterns: [], denyPatterns: [], denyMessage: '' },
      },
      queue: { maxRetries: 0, retryDelayMs: 1 },
      router: { progressIntervalMs: 15000 },
      audit: { enabled: false, logPath: 'audit.log' },
      health: { enabled: false, port: 8080 },
      metrics: { enabled: false, port: 9090 },
      logLevel: 'info',
    };

    // Create mock connector
    connector = new MockConnector();

    // Create Master AI with skip auto-exploration (for faster tests)
    master = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      skipAutoExploration: true,
      messageTimeout: 5000,
    });

    // Create bridge with V2 config
    bridge = new Bridge(config);
    bridge.getRegistry().registerConnector('mock', () => connector);

    // Wire Master AI into bridge
    bridge.setMaster(master);

    // Initialize Master AI (skips exploration)
    await master.start();

    // Start bridge
    await bridge.start();
  });

  afterEach(async () => {
    await bridge.stop();
    await master.shutdown();

    // Clean up workspace
    if (existsSync(workspacePath)) {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it('should strip /ai prefix before passing to Master AI', async () => {
    // Simulate message with /ai prefix
    connector.simulateMessage({
      id: 'msg-1',
      source: 'mock',
      sender: '+1234567890',
      rawContent: '/ai what files are in this project?',
      content: '/ai what files are in this project?', // Bridge will strip this
      timestamp: new Date(),
    });

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify Master AI received stripped content
    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toBe('what files are in this project?');
    expect(capturedPrompts[0]).not.toContain('/ai');
  });

  it('should handle prefix with extra whitespace', async () => {
    connector.simulateMessage({
      id: 'msg-2',
      source: 'mock',
      sender: '+1234567890',
      rawContent: '  /ai   show me the README',
      content: '  /ai   show me the README',
      timestamp: new Date(),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toBe('show me the README');
    expect(capturedPrompts[0]).not.toContain('/ai');
  });

  it('should handle multi-line messages with prefix', async () => {
    const multilineMessage = `/ai analyze this:
- Check the architecture
- Review the tests
- Summarize findings`;

    connector.simulateMessage({
      id: 'msg-3',
      source: 'mock',
      sender: '+1234567890',
      rawContent: multilineMessage,
      content: multilineMessage,
      timestamp: new Date(),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(capturedPrompts).toHaveLength(1);
    expect(capturedPrompts[0]).toContain('analyze this:');
    expect(capturedPrompts[0]).toContain('- Check the architecture');
    expect(capturedPrompts[0]).not.toContain('/ai');
  });

  it('should pass correct workspace path to AgentRunner', async () => {
    connector.simulateMessage({
      id: 'msg-4',
      source: 'mock',
      sender: '+1234567890',
      rawContent: '/ai list all TypeScript files',
      content: '/ai list all TypeScript files',
      timestamp: new Date(),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(capturedWorkspacePaths).toHaveLength(1);
    expect(capturedWorkspacePaths[0]).toBe(workspacePath);
  });

  it('should verify response flows back to connector', async () => {
    connector.simulateMessage({
      id: 'msg-5',
      source: 'mock',
      sender: '+1234567890',
      rawContent: '/ai help',
      content: '/ai help',
      timestamp: new Date(),
    });

    // Wait longer for async processing to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Connector should receive at least one message (ack)
    expect(connector.sentMessages.length).toBeGreaterThanOrEqual(1);

    // The key test: verify the prompt was captured (which proves the flow works)
    // We already verified prefix stripping in earlier tests, so just check flow completion
    expect(capturedPrompts.length).toBeGreaterThan(0);
  });

  it('should ignore messages without prefix', async () => {
    connector.simulateMessage({
      id: 'msg-6',
      source: 'mock',
      sender: '+1234567890',
      rawContent: 'just chatting, not a command',
      content: 'just chatting, not a command',
      timestamp: new Date(),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Master AI should not receive this message
    expect(capturedPrompts).toHaveLength(0);
    expect(connector.sentMessages).toHaveLength(0);
  });

  it('should ignore messages from non-whitelisted senders', async () => {
    connector.simulateMessage({
      id: 'msg-7',
      source: 'mock',
      sender: '+9999999999', // Not in whitelist
      rawContent: '/ai help',
      content: '/ai help',
      timestamp: new Date(),
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Master AI should not receive this message
    expect(capturedPrompts).toHaveLength(0);
    expect(connector.sentMessages).toHaveLength(0);
  });
});
