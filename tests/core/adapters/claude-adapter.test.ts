import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../../src/core/adapters/claude-adapter.js';
import { buildArgs } from '../../../src/core/agent-runner.js';
import type { SpawnOptions } from '../../../src/core/agent-runner.js';
import { SecurityConfigSchema } from '../../../src/types/config.js';

const adapter = new ClaudeAdapter();

// ── buildSpawnConfig produces identical args to buildArgs ────────────

describe('ClaudeAdapter.buildSpawnConfig', () => {
  /**
   * Helper: verify that the adapter produces the same args as the
   * existing buildArgs() function for a given set of SpawnOptions.
   */
  function expectSameArgs(opts: SpawnOptions): void {
    const config = adapter.buildSpawnConfig(opts);
    const expected = buildArgs(opts);
    expect(config.args).toEqual(expected);
    expect(config.binary).toBe('claude');
  }

  it('matches buildArgs for minimal options (prompt + workspace only)', () => {
    expectSameArgs({
      prompt: 'List all files',
      workspacePath: '/tmp/test',
    });
  });

  it('matches buildArgs with --print mode (no session)', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Hello',
      workspacePath: '/tmp/test',
    });
    expect(config.args[0]).toBe('--print');
  });

  it('matches buildArgs with --resume session', () => {
    expectSameArgs({
      prompt: 'Continue working',
      workspacePath: '/tmp/test',
      resumeSessionId: 'session-123',
    });
  });

  it('matches buildArgs with --session-id', () => {
    expectSameArgs({
      prompt: 'Start task',
      workspacePath: '/tmp/test',
      sessionId: 'new-session-456',
    });
  });

  it('matches buildArgs with model specified', () => {
    expectSameArgs({
      prompt: 'Debug this',
      workspacePath: '/tmp/test',
      model: 'sonnet',
    });
  });

  it('matches buildArgs with full model ID', () => {
    expectSameArgs({
      prompt: 'Debug this',
      workspacePath: '/tmp/test',
      model: 'claude-sonnet-4-5-20250929',
    });
  });

  it('matches buildArgs with max turns', () => {
    expectSameArgs({
      prompt: 'Quick task',
      workspacePath: '/tmp/test',
      maxTurns: 10,
    });
  });

  it('matches buildArgs with system prompt', () => {
    expectSameArgs({
      prompt: 'Do something',
      workspacePath: '/tmp/test',
      systemPrompt: 'You are a helpful assistant',
    });
  });

  it('matches buildArgs with max budget', () => {
    expectSameArgs({
      prompt: 'Expensive task',
      workspacePath: '/tmp/test',
      maxBudgetUsd: 5.0,
    });
  });

  it('matches buildArgs with allowed tools', () => {
    expectSameArgs({
      prompt: 'Read files',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Glob', 'Grep'],
    });
  });

  it('matches buildArgs with all options combined', () => {
    expectSameArgs({
      prompt: 'Full configuration test',
      workspacePath: '/tmp/test',
      model: 'opus',
      maxTurns: 15,
      systemPrompt: 'Custom system prompt',
      maxBudgetUsd: 2.5,
      allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
      sessionId: 'test-session',
    });
  });

  it('places prompt before --allowedTools (Commander.js positional arg order)', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'My prompt text',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Glob'],
    });

    const promptIndex = config.args.indexOf('My prompt text');
    const toolsIndex = config.args.indexOf('--allowedTools');
    expect(promptIndex).toBeGreaterThan(-1);
    expect(toolsIndex).toBeGreaterThan(-1);
    expect(promptIndex).toBeLessThan(toolsIndex);
  });

  it('uses default max turns (25) when not specified', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Test',
      workspacePath: '/tmp/test',
    });
    const maxTurnsIndex = config.args.indexOf('--max-turns');
    expect(config.args[maxTurnsIndex + 1]).toBe('25');
  });
});

// ── cleanEnv ────────────────────────────────────────────────────────

describe('ClaudeAdapter.cleanEnv', () => {
  it('removes CLAUDECODE env var', () => {
    const env = { CLAUDECODE: '1', PATH: '/usr/bin' };
    const cleaned = adapter.cleanEnv(env);
    expect(cleaned.CLAUDECODE).toBeUndefined();
    expect(cleaned.PATH).toBe('/usr/bin');
  });

  it('removes CLAUDE_CODE_* env vars', () => {
    const env = {
      CLAUDE_CODE_SESSION: 'abc',
      CLAUDE_CODE_VERSION: '1.0',
      HOME: '/home/user',
    };
    const cleaned = adapter.cleanEnv(env);
    expect(cleaned.CLAUDE_CODE_SESSION).toBeUndefined();
    expect(cleaned.CLAUDE_CODE_VERSION).toBeUndefined();
    expect(cleaned.HOME).toBe('/home/user');
  });

  it('removes CLAUDE_AGENT_SDK_* env vars', () => {
    const env = {
      CLAUDE_AGENT_SDK_FOO: 'bar',
      NODE_ENV: 'test',
    };
    const cleaned = adapter.cleanEnv(env);
    expect(cleaned.CLAUDE_AGENT_SDK_FOO).toBeUndefined();
    expect(cleaned.NODE_ENV).toBe('test');
  });

  it('strips secret env vars via deny patterns (e.g. OPENAI_API_KEY)', () => {
    const env = {
      OPENAI_API_KEY: 'sk-test',
      AWS_SECRET_ACCESS_KEY: 'secret',
      PATH: '/usr/bin',
    };
    const cleaned = adapter.cleanEnv(env);
    expect(cleaned.OPENAI_API_KEY).toBeUndefined();
    expect(cleaned.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(cleaned.PATH).toBe('/usr/bin');
  });

  it('preserves vars in allow list even if they match deny patterns', () => {
    const config = SecurityConfigSchema.parse({ envAllowPatterns: ['OPENAI_API_KEY'] });
    const adapterWithConfig = new ClaudeAdapter(config);
    const env = { OPENAI_API_KEY: 'sk-test', AWS_SECRET_KEY: 'secret' };
    const cleaned = adapterWithConfig.cleanEnv(env);
    expect(cleaned.OPENAI_API_KEY).toBe('sk-test');
    expect(cleaned.AWS_SECRET_KEY).toBeUndefined();
  });

  it('does not mutate the original env object', () => {
    const env = { CLAUDECODE: '1', PATH: '/usr/bin' };
    adapter.cleanEnv(env);
    expect(env.CLAUDECODE).toBe('1');
  });
});

// ── mapCapabilityLevel ──────────────────────────────────────────────

describe('ClaudeAdapter.mapCapabilityLevel', () => {
  it('maps read-only to Read, Glob, Grep', () => {
    expect(adapter.mapCapabilityLevel('read-only')).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('maps code-edit to editing tools + limited bash', () => {
    const tools = adapter.mapCapabilityLevel('code-edit');
    expect(tools).toContain('Read');
    expect(tools).toContain('Edit');
    expect(tools).toContain('Write');
    expect(tools).toContain('Bash(git:*)');
    expect(tools).toContain('Bash(npm:*)');
    expect(tools).toContain('Bash(npx:*)');
  });

  it('maps full-access to all tools including Bash(*)', () => {
    const tools = adapter.mapCapabilityLevel('full-access');
    expect(tools).toContain('Bash(*)');
    expect(tools).toContain('Read');
    expect(tools).toContain('Edit');
    expect(tools).toContain('Write');
  });
});

// ── isValidModel ────────────────────────────────────────────────────

describe('ClaudeAdapter.isValidModel', () => {
  it('accepts model aliases (haiku, sonnet, opus)', () => {
    expect(adapter.isValidModel('haiku')).toBe(true);
    expect(adapter.isValidModel('sonnet')).toBe(true);
    expect(adapter.isValidModel('opus')).toBe(true);
  });

  it('accepts full Claude model IDs', () => {
    expect(adapter.isValidModel('claude-sonnet-4-5-20250929')).toBe(true);
    expect(adapter.isValidModel('claude-haiku-3-5-20241022')).toBe(true);
  });

  it('rejects non-Claude model IDs', () => {
    expect(adapter.isValidModel('gpt-4o')).toBe(false);
    expect(adapter.isValidModel('codex-mini')).toBe(false);
    expect(adapter.isValidModel('random-model')).toBe(false);
  });
});

// ── name property ───────────────────────────────────────────────────

describe('ClaudeAdapter.name', () => {
  it('is "claude"', () => {
    expect(adapter.name).toBe('claude');
  });
});
