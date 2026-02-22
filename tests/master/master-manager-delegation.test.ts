import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
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

describe('MasterManager - Delegation Integration', () => {
  let testWorkspace: string;
  let masterManager: MasterManager;

  const masterTool: DiscoveredTool = {
    name: 'claude',
    path: '/usr/local/bin/claude',
    version: '1.0.0',
    available: true,
    role: 'master',
    capabilities: ['general'],
  };

  const specialistTool: DiscoveredTool = {
    name: 'codex',
    path: '/usr/local/bin/codex',
    version: '1.0.0',
    available: true,
    role: 'specialist',
    capabilities: ['code-generation'],
  };

  const discoveredTools: DiscoveredTool[] = [masterTool, specialistTool];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create temporary test workspace
    testWorkspace = path.join(process.cwd(), 'test-workspace-delegation-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    // Initialize .openbridge folder with git
    const dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();

    // Create master manager (skip auto-exploration for tests)
    masterManager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools,
      skipAutoExploration: true,
    });

    await masterManager.start();
  });

  afterEach(async () => {
    await masterManager.shutdown();

    // Clean up test workspace
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Delegation Marker Parsing', () => {
    it('should detect delegation markers in response', async () => {
      const responseWithDelegation = `
I'll delegate this task to the code generation specialist.

[DELEGATE:codex]
Generate a function that calculates fibonacci numbers
[/DELEGATE]

I've delegated this to codex for better code generation.
      `;

      // First call: Master processes message and returns delegation markers
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithDelegation,
        stderr: '',
        retryCount: 0,
        durationMs: 500,
      });

      // Second call: Delegation to codex (via DelegationCoordinator's AgentRunner)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'function fibonacci(n) { /* implementation */ }',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      // Third call: Feedback to Master session
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Here is the generated fibonacci function with explanation.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        content: 'Generate a fibonacci function',
        rawContent: '/ai Generate a fibonacci function',
        sender: '+1234567890',
        source: 'whatsapp',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      expect(response).toBe('Here is the generated fibonacci function with explanation.');
      expect(mockSpawn).toHaveBeenCalledTimes(3);
    });

    it('should process messages without delegation markers normally', async () => {
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'This is a normal response without delegation.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        content: 'What is the project structure?',
        rawContent: '/ai What is the project structure?',
        sender: '+1234567890',
        source: 'whatsapp',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      expect(response).toBe('This is a normal response without delegation.');
      expect(mockSpawn).toHaveBeenCalledTimes(1); // No delegation, no feedback
    });
  });

  describe('Tool Finding', () => {
    it('should handle tool not found error', async () => {
      const responseWithUnknownTool = `
[DELEGATE:unknown-tool]
Do something with unknown tool
[/DELEGATE]
      `;

      // First call: Master processes message
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithUnknownTool,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Second call: Feedback with error result
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Tool not found, I cannot complete this delegation.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        content: 'Use unknown tool',
        rawContent: '/ai Use unknown tool',
        sender: '+1234567890',
        source: 'whatsapp',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      expect(response).toBe('Tool not found, I cannot complete this delegation.');
      expect(mockSpawn).toHaveBeenCalledTimes(2); // Initial + feedback (no delegation execution)
    });

    it('should find specialist tool by partial name match', async () => {
      const responseWithPartialName = `
[DELEGATE:cod]
Generate code
[/DELEGATE]
      `;

      // First call: Master processes message
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithPartialName,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Second call: Delegation to codex (matched by partial name)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Code generated',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      // Third call: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Code generation complete.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        content: 'Generate some code',
        rawContent: '/ai Generate some code',
        sender: '+1234567890',
        source: 'whatsapp',
        timestamp: new Date(),
      };

      const response = await masterManager.processMessage(message);

      expect(response).toBe('Code generation complete.');
    });
  });

  describe('Delegation Result Feedback', () => {
    it('should feed successful delegation results back to Master', async () => {
      const responseWithDelegation = `
[DELEGATE:codex]
Create helper function
[/DELEGATE]
      `;

      // First call: Master processes message
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithDelegation,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Second call: Delegation to codex
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Helper function created successfully',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      // Third call: Feedback
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The helper function has been created and is ready to use.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        content: 'Create a helper function',
        rawContent: '/ai Create a helper function',
        sender: '+1234567890',
        source: 'whatsapp',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // Check that feedback was sent to Master with delegation results
      const feedbackCall = getSpawnCallOpts(2);
      expect(feedbackCall).toBeDefined();
      expect(feedbackCall?.prompt).toContain('delegation results');
      expect(feedbackCall?.prompt).toContain('Helper function created successfully');
    });

    it('should feed delegation errors back to Master', async () => {
      const responseWithDelegation = `
[DELEGATE:codex]
Create invalid code
[/DELEGATE]
      `;

      // First call: Master processes message
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithDelegation,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Second call: Delegation to codex fails
      mockSpawn.mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'Syntax error in generated code',
        retryCount: 0,
        durationMs: 300,
      });

      // Third call: Feedback with error
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'The code generation failed due to a syntax error.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        content: 'Create invalid code',
        rawContent: '/ai Create invalid code',
        sender: '+1234567890',
        source: 'whatsapp',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // Check that error was fed back to Master
      const feedbackCall = getSpawnCallOpts(2);
      expect(feedbackCall?.prompt).toContain('Syntax error in generated code');
    });
  });

  describe('Session Continuity During Delegation', () => {
    it('should maintain Master session across delegation flow', async () => {
      const responseWithDelegation = `
[DELEGATE:codex]
Generate code
[/DELEGATE]
      `;

      // First call: Master processes message (new session → --session-id)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: responseWithDelegation,
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      // Second call: Delegation to codex (separate from Master session)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Code generated',
        stderr: '',
        retryCount: 0,
        durationMs: 300,
      });

      // Third call: Feedback to Master (resume → --resume)
      mockSpawn.mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Done.',
        stderr: '',
        retryCount: 0,
        durationMs: 200,
      });

      const message: InboundMessage = {
        id: 'msg-1',
        content: 'Generate code',
        rawContent: '/ai Generate code',
        sender: '+1234567890',
        source: 'whatsapp',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // processMessage() uses --print mode (non-interactive) — no sessionId on any call.
      // Context continuity is provided via systemPrompt (workspace map) injected each time.
      const initialCall = getSpawnCallOpts(0);
      const feedbackCall = getSpawnCallOpts(2);

      expect(initialCall?.sessionId).toBeUndefined();
      expect(initialCall?.resumeSessionId).toBeUndefined();
      expect(feedbackCall?.sessionId).toBeUndefined();
      expect(feedbackCall?.resumeSessionId).toBeUndefined();
    });
  });
});
