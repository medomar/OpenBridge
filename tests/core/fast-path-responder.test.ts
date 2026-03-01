/**
 * Unit tests for FastPathResponder (OB-924)
 *
 * Covers:
 *  - Single successful answer with workspace context
 *  - Chunk augmentation from MemoryManager
 *  - Concurrency limit (isBusy, pool at capacity)
 *  - Graceful fallback when AgentRunner fails
 *  - setMemory() wires memory for subsequent calls
 *  - activeSessions / maxSessions accessors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FastPathResponder } from '../../src/core/fast-path-responder.js';
import type { AgentRunner, SpawnOptions } from '../../src/core/agent-runner.js';
import type { MemoryManager } from '../../src/memory/index.js';
import type { Chunk } from '../../src/memory/chunk-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock AgentRunner that resolves with the given stdout. */
function makeRunner(stdout = 'The answer is 42.'): {
  runner: Partial<AgentRunner>;
  lastConfig: () => SpawnOptions | undefined;
} {
  let captured: SpawnOptions | undefined;
  const runner: Partial<AgentRunner> = {
    spawn: vi.fn().mockImplementation((config: SpawnOptions) => {
      captured = config;
      return Promise.resolve({ stdout, stderr: '', exitCode: 0 });
    }),
  };
  return { runner, lastConfig: () => captured };
}

function makeFailingRunner(error = new Error('CLI not found')): Partial<AgentRunner> {
  return {
    spawn: vi.fn().mockRejectedValue(error),
  };
}

function makeMemory(chunks: Chunk[] = []): Partial<MemoryManager> {
  return {
    searchContext: vi.fn().mockResolvedValue(chunks),
  };
}

function makeChunk(content: string): Chunk {
  return {
    id: 1,
    scope: 'workspace',
    category: 'structure',
    content,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    stale: false,
  };
}

const BASE_REQUEST = {
  question: 'What is the main entry point?',
  workspacePath: '/tmp/workspace',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FastPathResponder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('answer()', () => {
    it('returns agent stdout for a successful call', async () => {
      const { runner } = makeRunner('src/index.ts is the main entry point.');
      const responder = new FastPathResponder(runner as AgentRunner);

      const reply = await responder.answer(BASE_REQUEST);

      expect(reply).toBe('src/index.ts is the main entry point.');
    });

    it('passes workspaceContext to agent when provided', async () => {
      const { runner, lastConfig } = makeRunner('OK');
      const responder = new FastPathResponder(runner as AgentRunner);

      await responder.answer({
        ...BASE_REQUEST,
        workspaceContext: 'Project: my-app (TypeScript)',
      });

      expect(lastConfig()?.prompt).toContain('Project: my-app (TypeScript)');
    });

    it('uses read-only tools and maxTurns=3 by default', async () => {
      const { runner, lastConfig } = makeRunner('OK');
      const responder = new FastPathResponder(runner as AgentRunner);

      await responder.answer(BASE_REQUEST);

      const cfg = lastConfig();
      expect(cfg?.maxTurns).toBe(3);
      expect(cfg?.allowedTools).toContain('Read');
      expect(cfg?.allowedTools).not.toContain('Edit');
    });

    it('respects custom maxTurns from options', async () => {
      const { runner, lastConfig } = makeRunner('OK');
      const responder = new FastPathResponder(runner as AgentRunner, undefined, { maxTurns: 5 });

      await responder.answer(BASE_REQUEST);

      expect(lastConfig()?.maxTurns).toBe(5);
    });

    it('returns fallback message when agent throws', async () => {
      const runner = makeFailingRunner();
      const responder = new FastPathResponder(runner as AgentRunner);

      const reply = await responder.answer(BASE_REQUEST);

      expect(reply).toContain('busy');
    });

    it('returns "No response" when stdout is empty', async () => {
      const { runner } = makeRunner('');
      const responder = new FastPathResponder(runner as AgentRunner);

      const reply = await responder.answer(BASE_REQUEST);

      expect(reply).toContain('No response');
    });
  });

  describe('concurrency pool', () => {
    it('isBusy is false when activeCount < maxConcurrent', () => {
      const { runner } = makeRunner('OK');
      const responder = new FastPathResponder(runner as AgentRunner, undefined, {
        maxConcurrent: 2,
      });
      expect(responder.isBusy).toBe(false);
      expect(responder.activeSessions).toBe(0);
      expect(responder.maxSessions).toBe(2);
    });

    it('returns busy message when at maxConcurrent capacity', async () => {
      let resolveFirst!: (val: unknown) => void;
      const runner: Partial<AgentRunner> = {
        spawn: vi.fn().mockImplementation(() => {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }),
      };

      const responder = new FastPathResponder(runner as AgentRunner, undefined, {
        maxConcurrent: 1,
      });

      // Start first call — occupies the only slot
      const first = responder.answer(BASE_REQUEST);
      // Give the microtask queue a tick to enter the async function
      await Promise.resolve();

      // Second call should be rejected immediately (pool full)
      const secondReply = await responder.answer(BASE_REQUEST);
      expect(secondReply).toContain('busy');

      // Release the first call
      resolveFirst({ stdout: 'done', stderr: '', exitCode: 0 });
      await first;

      expect(responder.activeSessions).toBe(0);
    });

    it('decrements activeCount after a successful call', async () => {
      const { runner } = makeRunner('OK');
      const responder = new FastPathResponder(runner as AgentRunner);

      await responder.answer(BASE_REQUEST);

      expect(responder.activeSessions).toBe(0);
    });

    it('decrements activeCount even when agent throws', async () => {
      const runner = makeFailingRunner();
      const responder = new FastPathResponder(runner as AgentRunner);

      await responder.answer(BASE_REQUEST);

      expect(responder.activeSessions).toBe(0);
    });
  });

  describe('context chunk augmentation', () => {
    it('searches memory and injects chunks into prompt', async () => {
      const { runner, lastConfig } = makeRunner('OK');
      const memory = makeMemory([makeChunk('Entry: src/index.ts')]);
      const responder = new FastPathResponder(runner as AgentRunner, memory as MemoryManager);

      await responder.answer(BASE_REQUEST);

      expect(lastConfig()?.prompt).toContain('Entry: src/index.ts');
      expect(memory.searchContext).toHaveBeenCalledWith(BASE_REQUEST.question, 3);
    });

    it('proceeds without chunks when searchContext throws', async () => {
      const { runner } = makeRunner('OK');
      const memory: Partial<MemoryManager> = {
        searchContext: vi.fn().mockRejectedValue(new Error('DB error')),
      };
      const responder = new FastPathResponder(runner as AgentRunner, memory as MemoryManager);

      const reply = await responder.answer(BASE_REQUEST);

      expect(reply).toBe('OK');
    });

    it('does not call searchContext when no memory is provided', async () => {
      const { runner } = makeRunner('OK');
      const responder = new FastPathResponder(runner as AgentRunner);

      await responder.answer(BASE_REQUEST);

      expect(runner.spawn).toHaveBeenCalledOnce();
    });
  });

  describe('setMemory()', () => {
    it('wires memory for subsequent answer() calls', async () => {
      const configs: SpawnOptions[] = [];
      const runner: Partial<AgentRunner> = {
        spawn: vi.fn().mockImplementation((config: SpawnOptions) => {
          configs.push(config);
          return Promise.resolve({ stdout: 'OK', stderr: '', exitCode: 0 });
        }),
      };
      const memory = makeMemory([makeChunk('context chunk')]);
      const responder = new FastPathResponder(runner as AgentRunner);

      // First call — no memory, no chunk injection
      await responder.answer(BASE_REQUEST);
      expect(configs[0]?.prompt).not.toContain('context chunk');

      // Wire memory
      responder.setMemory(memory as MemoryManager);
      await responder.answer(BASE_REQUEST);
      expect(configs[1]?.prompt).toContain('context chunk');
    });
  });

  describe('default options', () => {
    it('defaults maxConcurrent to 2', () => {
      const { runner } = makeRunner('OK');
      const responder = new FastPathResponder(runner as AgentRunner);
      expect(responder.maxSessions).toBe(2);
    });
  });
});
