import { describe, it, expect } from 'vitest';
import { AiderAdapter } from '../../../src/core/adapters/aider-adapter.js';

const adapter = new AiderAdapter();

// ── buildSpawnConfig ────────────────────────────────────────────────

describe('AiderAdapter.buildSpawnConfig', () => {
  it('sets binary to "aider"', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Hello',
      workspacePath: '/tmp/test',
    });
    expect(config.binary).toBe('aider');
  });

  it('uses --message for the prompt', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Fix the bug',
      workspacePath: '/tmp/test',
    });
    const messageIndex = config.args.indexOf('--message');
    expect(messageIndex).toBeGreaterThan(-1);
    expect(config.args[messageIndex + 1]).toBe('Fix the bug');
  });

  it('always includes --yes for non-interactive mode', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Do something',
      workspacePath: '/tmp/test',
    });
    expect(config.args).toContain('--yes');
  });

  it('adds --model when specified', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
      model: 'gpt-4o',
    });
    expect(config.args).toContain('--model');
    expect(config.args).toContain('gpt-4o');
  });

  it('adds --no-auto-commits for read-only tools (no Edit/Write)', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'List files',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Glob', 'Grep'],
    });
    expect(config.args).toContain('--no-auto-commits');
  });

  it('does not add --no-auto-commits when Edit is present', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Fix code',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'],
    });
    expect(config.args).not.toContain('--no-auto-commits');
  });

  it('does not add --no-auto-commits when Write is present', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Create file',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Write', 'Glob'],
    });
    expect(config.args).not.toContain('--no-auto-commits');
  });

  it('does not add --no-auto-commits when no tools specified', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    expect(config.args).not.toContain('--no-auto-commits');
  });

  it('prepends systemPrompt to message text', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Do something',
      workspacePath: '/tmp/test',
      systemPrompt: 'You are an expert',
    });
    const messageIndex = config.args.indexOf('--message');
    expect(config.args[messageIndex + 1]).toBe('You are an expert\n\nDo something');
  });

  it('drops maxTurns silently', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
      maxTurns: 15,
    });
    expect(config.args).not.toContain('--max-turns');
  });

  it('drops maxBudgetUsd silently', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
      maxBudgetUsd: 5.0,
    });
    expect(config.args).not.toContain('--max-budget-usd');
  });

  it('drops session options silently', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
      sessionId: 'test-session',
      resumeSessionId: 'resume-123',
    });
    expect(config.args).not.toContain('--session-id');
    expect(config.args).not.toContain('--resume');
  });

  it('does not add --print (aider uses --message for non-interactive)', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    expect(config.args).not.toContain('--print');
  });
});

// ── cleanEnv ────────────────────────────────────────────────────────

describe('AiderAdapter.cleanEnv', () => {
  it('strips OPENAI_API_KEY and ANTHROPIC_API_KEY via deny patterns', () => {
    const env = {
      OPENAI_API_KEY: 'sk-test',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      CLAUDECODE: '1',
    };
    const cleaned = adapter.cleanEnv(env);
    expect(cleaned.OPENAI_API_KEY).toBeUndefined();
    expect(cleaned.ANTHROPIC_API_KEY).toBeUndefined();
    expect(cleaned.CLAUDECODE).toBeUndefined();
  });

  it('removes Claude env vars', () => {
    const env = { CLAUDE_CODE_FOO: 'bar', CLAUDE_AGENT_SDK_BAZ: 'qux' };
    const cleaned = adapter.cleanEnv(env);
    expect(cleaned.CLAUDE_CODE_FOO).toBeUndefined();
    expect(cleaned.CLAUDE_AGENT_SDK_BAZ).toBeUndefined();
  });
});

// ── mapCapabilityLevel ──────────────────────────────────────────────

describe('AiderAdapter.mapCapabilityLevel', () => {
  it('returns undefined (aider manages its own file access)', () => {
    expect(adapter.mapCapabilityLevel('read-only')).toBeUndefined();
    expect(adapter.mapCapabilityLevel('code-edit')).toBeUndefined();
    expect(adapter.mapCapabilityLevel('full-access')).toBeUndefined();
  });
});

// ── isValidModel ────────────────────────────────────────────────────

describe('AiderAdapter.isValidModel', () => {
  it('accepts any non-empty string (aider/litellm is very permissive)', () => {
    expect(adapter.isValidModel('gpt-4o')).toBe(true);
    expect(adapter.isValidModel('claude-3-sonnet')).toBe(true);
    expect(adapter.isValidModel('deepseek-chat')).toBe(true);
    expect(adapter.isValidModel('custom-model-v1')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(adapter.isValidModel('')).toBe(false);
  });
});

// ── name ────────────────────────────────────────────────────────────

describe('AiderAdapter.name', () => {
  it('is "aider"', () => {
    expect(adapter.name).toBe('aider');
  });
});
