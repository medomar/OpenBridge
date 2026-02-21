import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { MasterManagerOptions } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
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

// Mock DotFolderManager to avoid git errors
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
  })),
}));

import { executeClaudeCode } from '../../src/providers/claude-code/claude-code-executor.js';

const mockExecuteClaudeCode = vi.mocked(executeClaudeCode);

describe('Session Continuity', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;
  let masterTool: DiscoveredTool;
  let discoveredTools: DiscoveredTool[];

  beforeEach(async () => {
    // Create temporary test workspace
    testWorkspace = path.join(process.cwd(), 'test-session-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    // Create .openbridge/tasks folder to avoid git errors
    const dotFolderPath = path.join(testWorkspace, '.openbridge');
    await fs.mkdir(dotFolderPath, { recursive: true });
    await fs.mkdir(path.join(dotFolderPath, 'tasks'), { recursive: true });

    // Create test tools
    masterTool = {
      name: 'claude',
      path: '/usr/local/bin/claude',
      version: '1.0.0',
      role: 'master',
      capabilities: ['code-analysis', 'task-execution'],
      available: true,
    };

    discoveredTools = [masterTool];

    // Clear mock call history
    vi.clearAllMocks();

    mockExecuteClaudeCode.mockResolvedValue({
      exitCode: 0,
      stdout: 'Response',
      stderr: '',
    });

    // Create master manager
    const options: MasterManagerOptions = {
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools,
      skipAutoExploration: true,
    };

    masterManager = new MasterManager(options);
    await masterManager.start();
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

  it('first message should use --session-id, second should use --resume', async () => {
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
    const call1 = mockExecuteClaudeCode.mock.calls[0]?.[0];
    expect(call1).toBeDefined();
    expect(call1?.sessionId).toBeDefined();
    expect(call1?.resumeSessionId).toBeUndefined();

    // Second call should use resumeSessionId (resume existing session)
    const call2 = mockExecuteClaudeCode.mock.calls[1]?.[0];
    expect(call2).toBeDefined();
    expect(call2?.resumeSessionId).toBeDefined();
    expect(call2?.sessionId).toBeUndefined();

    // Both should use the same session ID value
    expect(call2?.resumeSessionId).toBe(call1?.sessionId);
  });

  it('different senders should get different sessions', async () => {
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
});
