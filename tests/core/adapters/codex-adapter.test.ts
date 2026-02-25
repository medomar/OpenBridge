import { describe, it, expect } from 'vitest';
import { CodexAdapter } from '../../../src/core/adapters/codex-adapter.js';

const adapter = new CodexAdapter();

// ── buildSpawnConfig ────────────────────────────────────────────────

describe('CodexAdapter.buildSpawnConfig', () => {
  it('sets binary to "codex"', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Hello',
      workspacePath: '/tmp/test',
    });
    expect(config.binary).toBe('codex');
  });

  it('builds minimal args: just the prompt', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'List all files',
      workspacePath: '/tmp/test',
    });
    expect(config.args).toEqual(['List all files']);
  });

  it('adds --model when specified', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Do something',
      workspacePath: '/tmp/test',
      model: 'codex-mini',
    });
    expect(config.args).toContain('--model');
    expect(config.args).toContain('codex-mini');
  });

  it('maps read-only tools to --approval-mode suggest', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Read files',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Glob', 'Grep'],
    });
    expect(config.args).toContain('--approval-mode');
    expect(config.args).toContain('suggest');
  });

  it('maps code-edit tools to --approval-mode auto-edit', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Fix bug',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'],
    });
    expect(config.args).toContain('--approval-mode');
    expect(config.args).toContain('auto-edit');
  });

  it('maps full-access tools (Bash(*)) to --approval-mode full-auto', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Deploy',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
    });
    expect(config.args).toContain('--approval-mode');
    expect(config.args).toContain('full-auto');
  });

  it('does not add --approval-mode when no tools specified', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Do something',
      workspacePath: '/tmp/test',
    });
    expect(config.args).not.toContain('--approval-mode');
  });

  it('prepends systemPrompt to prompt text', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Do something',
      workspacePath: '/tmp/test',
      systemPrompt: 'You are helpful',
    });
    const prompt = config.args[config.args.length - 1];
    expect(prompt).toBe('You are helpful\n\nDo something');
  });

  it('drops maxTurns silently (codex has no equivalent)', () => {
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

  it('does not add --print (codex is non-interactive by default)', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    expect(config.args).not.toContain('--print');
  });
});

// ── cleanEnv ────────────────────────────────────────────────────────

describe('CodexAdapter.cleanEnv', () => {
  it('preserves OPENAI_API_KEY', () => {
    const env = { OPENAI_API_KEY: 'sk-test', CLAUDECODE: '1' };
    const cleaned = adapter.cleanEnv(env);
    expect(cleaned.OPENAI_API_KEY).toBe('sk-test');
    expect(cleaned.CLAUDECODE).toBeUndefined();
  });

  it('removes Claude env vars', () => {
    const env = { CLAUDE_CODE_SESSION: 'abc', CLAUDE_AGENT_SDK_FOO: 'bar' };
    const cleaned = adapter.cleanEnv(env);
    expect(cleaned.CLAUDE_CODE_SESSION).toBeUndefined();
    expect(cleaned.CLAUDE_AGENT_SDK_FOO).toBeUndefined();
  });
});

// ── mapCapabilityLevel ──────────────────────────────────────────────

describe('CodexAdapter.mapCapabilityLevel', () => {
  it('returns undefined (codex uses approval modes, not tool lists)', () => {
    expect(adapter.mapCapabilityLevel('read-only')).toBeUndefined();
    expect(adapter.mapCapabilityLevel('code-edit')).toBeUndefined();
    expect(adapter.mapCapabilityLevel('full-access')).toBeUndefined();
  });
});

// ── isValidModel ────────────────────────────────────────────────────

describe('CodexAdapter.isValidModel', () => {
  it('accepts codex model names', () => {
    expect(adapter.isValidModel('codex-mini')).toBe(true);
    expect(adapter.isValidModel('codex')).toBe(true);
  });

  it('accepts OpenAI model names', () => {
    expect(adapter.isValidModel('gpt-4o')).toBe(true);
    expect(adapter.isValidModel('gpt-4o-mini')).toBe(true);
    expect(adapter.isValidModel('o1')).toBe(true);
    expect(adapter.isValidModel('o3-mini')).toBe(true);
  });

  it('rejects Claude model names', () => {
    expect(adapter.isValidModel('haiku')).toBe(false);
    expect(adapter.isValidModel('sonnet')).toBe(false);
  });
});

// ── name ────────────────────────────────────────────────────────────

describe('CodexAdapter.name', () => {
  it('is "codex"', () => {
    expect(adapter.name).toBe('codex');
  });
});
