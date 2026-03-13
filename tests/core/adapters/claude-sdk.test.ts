import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PermissionRelayFn } from '../../../src/core/adapters/claude-sdk.js';

// ── Mock @anthropic-ai/claude-agent-sdk ────────────────────────────

vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  return {
    query: vi.fn(),
  };
});

import { ClaudeSDKAdapter } from '../../../src/core/adapters/claude-sdk.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

const mockQuery = vi.mocked(query);

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Create a mock async generator that yields the given messages.
 */
function makeQueryIterator(
  messages: Array<Record<string, unknown>>,
): AsyncIterable<Record<string, unknown>> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const msg of messages) {
        yield msg;
      }
    },
  };
}

function makeResultMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'result',
    subtype: 'success',
    result: 'Task completed successfully',
    num_turns: 3,
    total_cost_usd: 0.005,
    session_id: 'session-abc123',
    is_error: false,
    ...overrides,
  };
}

// ── buildCanUseTool: auto-approve allowed tools ────────────────────

describe('ClaudeSDKAdapter.buildCanUseTool', () => {
  let adapter: ClaudeSDKAdapter;

  beforeEach(() => {
    adapter = new ClaudeSDKAdapter();
    vi.clearAllMocks();
  });

  describe('auto-approve allowed tools', () => {
    it('auto-approves an exact tool name in allowedTools', async () => {
      const canUseTool = adapter.buildCanUseTool(['Read', 'Glob', 'Grep']);
      const result = await canUseTool('Read', {}, {} as never);
      expect(result.behavior).toBe('allow');
    });

    it('auto-approves all tools in allowedTools', async () => {
      const canUseTool = adapter.buildCanUseTool(['Read', 'Edit', 'Write']);
      for (const tool of ['Read', 'Edit', 'Write']) {
        const result = await canUseTool(tool, {}, {} as never);
        expect(result.behavior).toBe('allow');
      }
    });

    it('auto-approves wildcard Bash(*) for any Bash tool name', async () => {
      const canUseTool = adapter.buildCanUseTool(['Bash(*)']);
      const result = await canUseTool('Bash', { command: 'ls -la' }, {} as never);
      expect(result.behavior).toBe('allow');
    });

    it('auto-approves Bash(git:*) when command starts with git', async () => {
      const canUseTool = adapter.buildCanUseTool(['Bash(git:*)']);
      const result = await canUseTool('Bash', { command: 'git status' }, {} as never);
      expect(result.behavior).toBe('allow');
    });

    it('denies Bash(git:*) when command starts with a different prefix', async () => {
      const canUseTool = adapter.buildCanUseTool(['Bash(git:*)']);
      const result = await canUseTool('Bash', { command: 'rm -rf /' }, {} as never);
      expect(result.behavior).toBe('deny');
    });
  });

  // ── delegates to permission relay for non-allowed tools ──────────

  describe('permission relay delegation', () => {
    it('calls permissionRelay for a tool not in allowed list', async () => {
      const relay: PermissionRelayFn = vi.fn().mockResolvedValue(true);
      const canUseTool = adapter.buildCanUseTool(['Read'], relay, 'user-1', 'webchat');

      const result = await canUseTool('Bash', { command: 'rm -rf /tmp/test' }, {} as never);
      expect(relay).toHaveBeenCalledWith({
        toolName: 'Bash',
        input: { command: 'rm -rf /tmp/test' },
        userId: 'user-1',
        channel: 'webchat',
      });
      expect(result.behavior).toBe('allow');
    });

    it('returns deny when permission relay returns false', async () => {
      const relay: PermissionRelayFn = vi.fn().mockResolvedValue(false);
      const canUseTool = adapter.buildCanUseTool(['Read'], relay, 'user-1', 'webchat');

      const result = await canUseTool('Write', { file_path: '/etc/passwd' }, {} as never);
      expect(relay).toHaveBeenCalled();
      expect(result.behavior).toBe('deny');
    });

    it('includes updatedInput on relay approval', async () => {
      const relay: PermissionRelayFn = vi.fn().mockResolvedValue(true);
      const canUseTool = adapter.buildCanUseTool(['Read'], relay, 'user-1', 'webchat');
      const input = { command: 'npm install' };

      const result = await canUseTool('Bash', input, {} as never);
      expect(result.behavior).toBe('allow');
      if (result.behavior === 'allow') {
        expect(result.updatedInput).toEqual(input);
      }
    });

    it('denies without relay when no permissionRelay is provided', async () => {
      const canUseTool = adapter.buildCanUseTool(['Read']);
      const result = await canUseTool('Write', {}, {} as never);
      expect(result.behavior).toBe('deny');
    });

    it('denies when relay is provided but userId/channel are missing', async () => {
      const relay: PermissionRelayFn = vi.fn().mockResolvedValue(true);
      // relay provided but no userId/channel → falls through to default deny
      const canUseTool = adapter.buildCanUseTool(['Read'], relay, undefined, undefined);
      const result = await canUseTool('Write', {}, {} as never);
      expect(relay).not.toHaveBeenCalled();
      expect(result.behavior).toBe('deny');
    });
  });

  // ── empty / undefined allowedTools ──────────────────────────────

  describe('empty or undefined allowedTools', () => {
    it('denies all tools when allowedTools is empty', async () => {
      const canUseTool = adapter.buildCanUseTool([]);
      const result = await canUseTool('Read', {}, {} as never);
      expect(result.behavior).toBe('deny');
    });

    it('denies all tools when allowedTools is undefined', async () => {
      const canUseTool = adapter.buildCanUseTool(undefined);
      const result = await canUseTool('Read', {}, {} as never);
      expect(result.behavior).toBe('deny');
    });
  });
});

// ── executeQuery: output format matches expectations ──────────────

describe('ClaudeSDKAdapter.executeQuery', () => {
  let adapter: ClaudeSDKAdapter;

  beforeEach(() => {
    adapter = new ClaudeSDKAdapter();
    vi.clearAllMocks();
  });

  const baseSpawnOptions = {
    prompt: 'Do something',
    workspacePath: '/tmp/test-workspace',
  };

  it('returns stdout, numTurns, costUsd, sessionId on success', async () => {
    const resultMsg = makeResultMessage();
    mockQuery.mockReturnValue(makeQueryIterator([resultMsg]) as never);

    const result = await adapter.executeQuery({ spawnOptions: baseSpawnOptions });
    expect(result.stdout).toBe('Task completed successfully');
    expect(result.numTurns).toBe(3);
    expect(result.costUsd).toBe(0.005);
    expect(result.sessionId).toBe('session-abc123');
    expect(result.isError).toBe(false);
    expect(result.errorSubtype).toBeUndefined();
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns isError=true when result subtype is not success', async () => {
    const resultMsg = makeResultMessage({ subtype: 'error_max_turns', is_error: true });
    mockQuery.mockReturnValue(makeQueryIterator([resultMsg]) as never);

    const result = await adapter.executeQuery({ spawnOptions: baseSpawnOptions });
    expect(result.isError).toBe(true);
    expect(result.errorSubtype).toBe('error_max_turns');
    expect(result.stdout).toBe('');
  });

  it('returns empty stdout and isError=true when no result message is yielded', async () => {
    // iterator yields only non-result messages
    const assistantMsg = { type: 'assistant', content: 'thinking...' };
    mockQuery.mockReturnValue(makeQueryIterator([assistantMsg]) as never);

    const result = await adapter.executeQuery({ spawnOptions: baseSpawnOptions });
    expect(result.stdout).toBe('');
    expect(result.isError).toBe(true);
    expect(result.errorSubtype).toBe('no_result');
    expect(result.numTurns).toBe(0);
  });

  it('calls onMessage callback for each yielded message', async () => {
    const assistantMsg = { type: 'assistant', content: 'thinking' };
    const resultMsg = makeResultMessage();
    mockQuery.mockReturnValue(makeQueryIterator([assistantMsg, resultMsg]) as never);

    const onMessage = vi.fn();
    await adapter.executeQuery({ spawnOptions: baseSpawnOptions, onMessage });

    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenNthCalledWith(1, assistantMsg);
    expect(onMessage).toHaveBeenNthCalledWith(2, resultMsg);
  });

  it('propagates errors thrown by the query iterator', async () => {
    mockQuery.mockReturnValue({
      // eslint-disable-next-line require-yield
      [Symbol.asyncIterator]: async function* () {
        throw new Error('Network error');
      },
    } as never);

    await expect(adapter.executeQuery({ spawnOptions: baseSpawnOptions })).rejects.toThrow(
      'Network error',
    );
  });

  it('passes model to SDK options when specified', async () => {
    const resultMsg = makeResultMessage();
    mockQuery.mockReturnValue(makeQueryIterator([resultMsg]) as never);

    await adapter.executeQuery({
      spawnOptions: { ...baseSpawnOptions, model: 'claude-opus-4-6' },
    });

    const callArg = mockQuery.mock.calls[0]?.[0] as { options?: { model?: string } } | undefined;
    expect(callArg?.options?.model).toBe('claude-opus-4-6');
  });

  it('passes maxTurns to SDK options when specified', async () => {
    const resultMsg = makeResultMessage();
    mockQuery.mockReturnValue(makeQueryIterator([resultMsg]) as never);

    await adapter.executeQuery({
      spawnOptions: { ...baseSpawnOptions, maxTurns: 5 },
    });

    const callArg = mockQuery.mock.calls[0]?.[0] as { options?: { maxTurns?: number } } | undefined;
    expect(callArg?.options?.maxTurns).toBe(5);
  });
});

// ── buildSpawnConfig: compatibility shim ─────────────────────────

describe('ClaudeSDKAdapter.buildSpawnConfig', () => {
  let adapter: ClaudeSDKAdapter;

  beforeEach(() => {
    adapter = new ClaudeSDKAdapter();
  });

  it('returns a no-op config with __claude_sdk__ binary', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Hello',
      workspacePath: '/tmp/test',
    });
    expect(config.binary).toBe('__claude_sdk__');
    expect(config.args).toHaveLength(1);
  });

  it('isSDKAdapter() returns true', () => {
    expect(adapter.isSDKAdapter()).toBe(true);
  });
});

// ── error handling: same surface as CLI adapter ───────────────────

describe('ClaudeSDKAdapter error handling', () => {
  let adapter: ClaudeSDKAdapter;

  beforeEach(() => {
    adapter = new ClaudeSDKAdapter();
    vi.clearAllMocks();
  });

  it('returns isError=true and errorSubtype for max_turns subtype', async () => {
    const resultMsg = makeResultMessage({
      subtype: 'error_max_turns',
      is_error: true,
      result: undefined,
    });
    mockQuery.mockReturnValue(makeQueryIterator([resultMsg]) as never);

    const result = await adapter.executeQuery({
      spawnOptions: { prompt: 'task', workspacePath: '/tmp/ws' },
    });
    expect(result.isError).toBe(true);
    expect(result.errorSubtype).toBe('error_max_turns');
    expect(result.stdout).toBe('');
  });

  it('returns durationMs as a non-negative number even on error', async () => {
    mockQuery.mockReturnValue({
      // eslint-disable-next-line require-yield
      [Symbol.asyncIterator]: async function* () {
        throw new Error('fail');
      },
    } as never);

    await expect(
      adapter.executeQuery({ spawnOptions: { prompt: 'x', workspacePath: '/tmp/ws' } }),
    ).rejects.toThrow();
  });
});
