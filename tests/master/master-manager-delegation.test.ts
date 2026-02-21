import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as executor from '../../src/providers/claude-code/claude-code-executor.js';

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

      const mockExecuteResult = {
        stdout: responseWithDelegation,
        stderr: '',
        exitCode: 0,
      };

      const mockDelegationResult = {
        stdout: 'function fibonacci(n) { /* implementation */ }',
        stderr: '',
        exitCode: 0,
      };

      const mockFeedbackResult = {
        stdout: 'Here is the generated fibonacci function with explanation.',
        stderr: '',
        exitCode: 0,
      };

      vi.spyOn(executor, 'executeClaudeCode')
        .mockResolvedValueOnce(mockExecuteResult) // Initial message processing
        .mockResolvedValueOnce(mockDelegationResult) // Delegation execution
        .mockResolvedValueOnce(mockFeedbackResult); // Feedback processing

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
      expect(executor.executeClaudeCode).toHaveBeenCalledTimes(3);
    });

    it('should process messages without delegation markers normally', async () => {
      const mockExecuteResult = {
        stdout: 'This is a normal response without delegation.',
        stderr: '',
        exitCode: 0,
      };

      vi.spyOn(executor, 'executeClaudeCode').mockResolvedValue(mockExecuteResult);

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
      expect(executor.executeClaudeCode).toHaveBeenCalledTimes(1); // No delegation, no feedback
    });
  });

  describe('Tool Finding', () => {
    it('should handle tool not found error', async () => {
      const responseWithUnknownTool = `
[DELEGATE:unknown-tool]
Do something with unknown tool
[/DELEGATE]
      `;

      const mockExecuteResult = {
        stdout: responseWithUnknownTool,
        stderr: '',
        exitCode: 0,
      };

      const mockFeedbackResult = {
        stdout: 'Tool not found, I cannot complete this delegation.',
        stderr: '',
        exitCode: 0,
      };

      vi.spyOn(executor, 'executeClaudeCode')
        .mockResolvedValueOnce(mockExecuteResult) // Initial message
        .mockResolvedValueOnce(mockFeedbackResult); // Feedback

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
      expect(executor.executeClaudeCode).toHaveBeenCalledTimes(2); // Initial + feedback (no delegation)
    });

    it('should find specialist tool by partial name match', async () => {
      const responseWithPartialName = `
[DELEGATE:cod]
Generate code
[/DELEGATE]
      `;

      const mockExecuteResult = {
        stdout: responseWithPartialName,
        stderr: '',
        exitCode: 0,
      };

      const mockDelegationResult = {
        stdout: 'Code generated',
        stderr: '',
        exitCode: 0,
      };

      const mockFeedbackResult = {
        stdout: 'Code generation complete.',
        stderr: '',
        exitCode: 0,
      };

      vi.spyOn(executor, 'executeClaudeCode')
        .mockResolvedValueOnce(mockExecuteResult)
        .mockResolvedValueOnce(mockDelegationResult)
        .mockResolvedValueOnce(mockFeedbackResult);

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

      const mockExecuteResult = {
        stdout: responseWithDelegation,
        stderr: '',
        exitCode: 0,
      };

      const mockDelegationResult = {
        stdout: 'Helper function created successfully',
        stderr: '',
        exitCode: 0,
      };

      const mockFeedbackResult = {
        stdout: 'The helper function has been created and is ready to use.',
        stderr: '',
        exitCode: 0,
      };

      const executeSpy = vi
        .spyOn(executor, 'executeClaudeCode')
        .mockResolvedValueOnce(mockExecuteResult)
        .mockResolvedValueOnce(mockDelegationResult)
        .mockResolvedValueOnce(mockFeedbackResult);

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
      const feedbackCall = executeSpy.mock.calls[2];
      expect(feedbackCall).toBeDefined();
      expect(feedbackCall?.[0]?.prompt).toContain('delegation results');
      expect(feedbackCall?.[0]?.prompt).toContain('Helper function created successfully');
    });

    it('should feed delegation errors back to Master', async () => {
      const responseWithDelegation = `
[DELEGATE:codex]
Create invalid code
[/DELEGATE]
      `;

      const mockExecuteResult = {
        stdout: responseWithDelegation,
        stderr: '',
        exitCode: 0,
      };

      const mockDelegationResult = {
        stdout: '',
        stderr: 'Syntax error in generated code',
        exitCode: 1,
      };

      const mockFeedbackResult = {
        stdout: 'The code generation failed due to a syntax error.',
        stderr: '',
        exitCode: 0,
      };

      const executeSpy = vi
        .spyOn(executor, 'executeClaudeCode')
        .mockResolvedValueOnce(mockExecuteResult)
        .mockResolvedValueOnce(mockDelegationResult)
        .mockResolvedValueOnce(mockFeedbackResult);

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
      const feedbackCall = executeSpy.mock.calls[2];
      expect(feedbackCall?.[0]?.prompt).toContain('Syntax error in generated code');
    });
  });

  describe('Session Continuity During Delegation', () => {
    it('should maintain session across delegation flow', async () => {
      const responseWithDelegation = `
[DELEGATE:codex]
Generate code
[/DELEGATE]
      `;

      const mockExecuteResult = {
        stdout: responseWithDelegation,
        stderr: '',
        exitCode: 0,
      };

      const mockDelegationResult = {
        stdout: 'Code generated',
        stderr: '',
        exitCode: 0,
      };

      const mockFeedbackResult = {
        stdout: 'Done.',
        stderr: '',
        exitCode: 0,
      };

      const executeSpy = vi
        .spyOn(executor, 'executeClaudeCode')
        .mockResolvedValueOnce(mockExecuteResult)
        .mockResolvedValueOnce(mockDelegationResult)
        .mockResolvedValueOnce(mockFeedbackResult);

      const message: InboundMessage = {
        id: 'msg-1',
        content: 'Generate code',
        rawContent: '/ai Generate code',
        sender: '+1234567890',
        source: 'whatsapp',
        timestamp: new Date(),
      };

      await masterManager.processMessage(message);

      // Initial call and feedback call should use the same session
      const initialCall = executeSpy.mock.calls[0];
      const feedbackCall = executeSpy.mock.calls[2];

      expect(initialCall?.[0]?.resumeSessionId).toBeDefined();
      expect(feedbackCall?.[0]?.resumeSessionId).toBe(initialCall?.[0]?.resumeSessionId);
    });
  });
});
