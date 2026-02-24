import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSpawn = vi.fn();
vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: mockSpawn,
    stream: vi.fn(),
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

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { DelegationCoordinator } from '../../src/master/delegation.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';

describe('DelegationCoordinator', () => {
  let coordinator: DelegationCoordinator;

  beforeEach(() => {
    vi.clearAllMocks();
    coordinator = new DelegationCoordinator();
  });

  afterEach(() => {
    coordinator.shutdown();
  });

  const mockTool: DiscoveredTool = {
    name: 'codex',
    path: '/usr/local/bin/codex',
    version: '1.0.0',
    available: true,
    role: 'specialist',
    capabilities: ['code-generation'],
  };

  describe('Basic Delegation Flow', () => {
    it('should successfully delegate a task', async () => {
      const mockResult = {
        stdout: 'Task completed successfully',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
      mockSpawn.mockResolvedValue(mockResult);

      const result = await coordinator.delegate({
        prompt: 'Generate a test function',
        workspacePath: '/test/workspace',
        tool: mockTool,
        sender: '+1234567890',
        userMessage: '/ai generate test',
      });

      expect(result.success).toBe(true);
      expect(result.response).toBe('Task completed successfully');
      expect(result.exitCode).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should handle delegation failure', async () => {
      const mockResult = {
        stdout: '',
        stderr: 'Command failed',
        exitCode: 1,
        retryCount: 0,
        durationMs: 50,
      };
      mockSpawn.mockResolvedValue(mockResult);

      const result = await coordinator.delegate({
        prompt: 'Invalid task',
        workspacePath: '/test/workspace',
        tool: mockTool,
        sender: '+1234567890',
        userMessage: '/ai invalid',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Command failed');
      expect(result.exitCode).toBe(1);
    });

    it('should handle executor exceptions', async () => {
      mockSpawn.mockRejectedValue(new Error('Network timeout'));

      const result = await coordinator.delegate({
        prompt: 'Test task',
        workspacePath: '/test/workspace',
        tool: mockTool,
        sender: '+1234567890',
        userMessage: '/ai test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network timeout');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('Concurrent Delegation Limits', () => {
    it('should allow delegations up to the concurrent limit', async () => {
      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };

      mockSpawn.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockResult), 100);
          }),
      );

      // Start 3 concurrent delegations (default limit)
      const promises = [
        coordinator.delegate({
          prompt: 'Task 1',
          workspacePath: '/test',
          tool: mockTool,
          sender: 'user1',
          userMessage: '/ai task1',
        }),
        coordinator.delegate({
          prompt: 'Task 2',
          workspacePath: '/test',
          tool: mockTool,
          sender: 'user2',
          userMessage: '/ai task2',
        }),
        coordinator.delegate({
          prompt: 'Task 3',
          workspacePath: '/test',
          tool: mockTool,
          sender: 'user3',
          userMessage: '/ai task3',
        }),
      ];

      const results = await Promise.all(promises);

      // All should succeed
      results.forEach((result) => {
        expect(result.success).toBe(true);
      });
    });

    it('should reject delegations beyond concurrent limit', async () => {
      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 200,
      };

      mockSpawn.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockResult), 200);
          }),
      );

      // Start 3 delegations that will take time
      const runningPromises = [
        coordinator.delegate({
          prompt: 'Task 1',
          workspacePath: '/test',
          tool: mockTool,
          sender: 'user1',
          userMessage: '/ai task1',
        }),
        coordinator.delegate({
          prompt: 'Task 2',
          workspacePath: '/test',
          tool: mockTool,
          sender: 'user2',
          userMessage: '/ai task2',
        }),
        coordinator.delegate({
          prompt: 'Task 3',
          workspacePath: '/test',
          tool: mockTool,
          sender: 'user3',
          userMessage: '/ai task3',
        }),
      ];

      // Attempt a 4th delegation while others are running
      const result = await coordinator.delegate({
        prompt: 'Task 4',
        workspacePath: '/test',
        tool: mockTool,
        sender: 'user4',
        userMessage: '/ai task4',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Maximum concurrent delegations');
      expect(result.exitCode).toBe(1);

      // Clean up running delegations
      await Promise.all(runningPromises);
    });

    it('should allow new delegations after previous ones complete', async () => {
      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 50,
      };

      mockSpawn.mockResolvedValue(mockResult);

      // Complete first delegation
      await coordinator.delegate({
        prompt: 'Task 1',
        workspacePath: '/test',
        tool: mockTool,
        sender: 'user1',
        userMessage: '/ai task1',
      });

      // Should now accept a new delegation
      const result = await coordinator.delegate({
        prompt: 'Task 2',
        workspacePath: '/test',
        tool: mockTool,
        sender: 'user2',
        userMessage: '/ai task2',
      });

      expect(result.success).toBe(true);
    });

    it('should respect custom concurrent delegation limit', async () => {
      const customCoordinator = new DelegationCoordinator({ maxConcurrentDelegations: 1 });
      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 200,
      };

      mockSpawn.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve(mockResult), 200);
          }),
      );

      // Start first delegation
      const firstPromise = customCoordinator.delegate({
        prompt: 'Task 1',
        workspacePath: '/test',
        tool: mockTool,
        sender: 'user1',
        userMessage: '/ai task1',
      });

      // Attempt second delegation
      const secondResult = await customCoordinator.delegate({
        prompt: 'Task 2',
        workspacePath: '/test',
        tool: mockTool,
        sender: 'user2',
        userMessage: '/ai task2',
      });

      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain('Maximum concurrent delegations (1)');

      // Clean up
      await firstPromise;
      customCoordinator.shutdown();
    });
  });

  describe('Active Delegation Tracking', () => {
    it('should track and clean up delegations', async () => {
      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 50,
      };

      mockSpawn.mockResolvedValue(mockResult);

      expect(coordinator.getActiveDelegationCount()).toBe(0);

      // Start and complete delegation
      await coordinator.delegate({
        prompt: 'Task 1',
        workspacePath: '/test',
        tool: mockTool,
        sender: 'user1',
        userMessage: '/ai task1',
      });

      // Should be cleaned up after completion
      expect(coordinator.getActiveDelegationCount()).toBe(0);
    });

    it('should return empty delegation list when none active', () => {
      const delegations = coordinator.getActiveDelegations();
      expect(delegations).toEqual([]);
    });
  });

  describe('Delegation Cancellation', () => {
    it('should return false when cancelling non-existent delegation', () => {
      const cancelled = coordinator.cancelDelegation('nonexistent-id');
      expect(cancelled).toBe(false);
    });
  });

  describe('Timeout Handling', () => {
    it('should use default timeout when not specified', async () => {
      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 50,
      };
      mockSpawn.mockResolvedValue(mockResult);

      await coordinator.delegate({
        prompt: 'Test task',
        workspacePath: '/test',
        tool: mockTool,
        sender: 'user1',
        userMessage: '/ai test',
      });

      // Verify default timeout was used (300_000ms = 5 minutes)
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 300_000,
        }),
      );
    });

    it('should use custom default timeout from constructor', async () => {
      const customCoordinator = new DelegationCoordinator({ defaultTimeout: 60_000 });
      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 50,
      };
      mockSpawn.mockResolvedValue(mockResult);

      await customCoordinator.delegate({
        prompt: 'Test task',
        workspacePath: '/test',
        tool: mockTool,
        sender: 'user1',
        userMessage: '/ai test',
      });

      // Verify custom default timeout was used
      expect(mockSpawn).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 60_000,
        }),
      );

      customCoordinator.shutdown();
    });
  });

  describe('Shutdown', () => {
    it('should clear all delegations after shutdown', () => {
      coordinator.shutdown();

      expect(coordinator.getActiveDelegationCount()).toBe(0);
      expect(coordinator.getActiveDelegations()).toEqual([]);
    });
  });

  describe('Duration Tracking', () => {
    it('should track delegation duration', async () => {
      const mockResult = {
        stdout: 'Success',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };

      mockSpawn.mockResolvedValue(mockResult);

      const result = await coordinator.delegate({
        prompt: 'Test task',
        workspacePath: '/test',
        tool: mockTool,
        sender: 'user1',
        userMessage: '/ai test',
      });

      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      expect(result.durationMs).toBeLessThan(5000);
    });

    it('should include duration even on failure', async () => {
      const mockResult = {
        stdout: '',
        stderr: 'Error occurred',
        exitCode: 1,
        retryCount: 0,
        durationMs: 50,
      };

      mockSpawn.mockResolvedValue(mockResult);

      const result = await coordinator.delegate({
        prompt: 'Test task',
        workspacePath: '/test',
        tool: mockTool,
        sender: 'user1',
        userMessage: '/ai test',
      });

      expect(result.success).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});
