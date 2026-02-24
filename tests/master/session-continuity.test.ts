import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { MasterManagerOptions } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Mock AgentRunner
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
    readMasterSession: vi.fn().mockResolvedValue(null),
    writeMasterSession: vi.fn().mockResolvedValue(undefined),
    readExplorationState: vi.fn().mockResolvedValue(null),
    readSystemPrompt: vi.fn().mockResolvedValue(null),
    writeSystemPrompt: vi.fn().mockResolvedValue(undefined),
    readProfiles: vi.fn().mockResolvedValue(null),
  })),
}));

/** Helper to extract SpawnOptions from mock call args */
function getSpawnCallOpts(callIndex: number): SpawnOptions | undefined {
  return mockSpawn.mock.calls[callIndex]?.[0] as SpawnOptions | undefined;
}

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

    // Use keyword-based classification by default so tests don't consume spawn mocks
    vi.spyOn(MasterManager.prototype, 'classifyTask').mockImplementation(
      async (content: string) => {
        const lower = content.toLowerCase();
        if (
          ['implement', 'build', 'refactor', 'develop', 'set up', 'setup'].some((kw) =>
            lower.includes(kw),
          )
        )
          return 'complex-task';
        if (
          ['generate', 'create', 'write', 'fix', 'update file', 'add to', 'make a'].some((kw) =>
            lower.includes(kw),
          )
        )
          return 'tool-use';
        return 'quick-answer';
      },
    );

    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'Response',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
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

  it('each message goes through the Master (two spawn calls in --print mode)', async () => {
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

    // processMessage() uses --print mode (non-interactive) to avoid headless TTY issues.
    // Context continuity is provided via the systemPrompt (workspace map) on each call.
    const call1 = getSpawnCallOpts(0);
    expect(call1).toBeDefined();
    expect(call1?.sessionId).toBeUndefined();
    expect(call1?.resumeSessionId).toBeUndefined();

    const call2 = getSpawnCallOpts(1);
    expect(call2).toBeDefined();
    expect(call2?.sessionId).toBeUndefined();
    expect(call2?.resumeSessionId).toBeUndefined();
  });

  it('messages from different senders both go through Master in --print mode', async () => {
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

    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // processMessage() uses --print mode (non-interactive) — no sessionId for either sender.
    // Workspace context is injected via systemPrompt on each call instead.
    const call1 = getSpawnCallOpts(0);
    const call2 = getSpawnCallOpts(1);
    expect(call1?.sessionId).toBeUndefined();
    expect(call1?.resumeSessionId).toBeUndefined();
    expect(call2?.sessionId).toBeUndefined();
    expect(call2?.resumeSessionId).toBeUndefined();
  });
});
