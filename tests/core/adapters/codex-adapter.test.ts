import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CodexAdapter } from '../../../src/core/adapters/codex-adapter.js';

const adapter = new CodexAdapter();

// Ensure OPENAI_API_KEY is present for all tests that exercise buildSpawnConfig.
// Tests that verify the missing-key error explicitly clear the variable themselves.
const ORIGINAL_API_KEY = process.env['OPENAI_API_KEY'];

beforeAll(() => {
  process.env['OPENAI_API_KEY'] = 'sk-test-key';
});

afterAll(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env['OPENAI_API_KEY'];
  } else {
    process.env['OPENAI_API_KEY'] = ORIGINAL_API_KEY;
  }
});

// ── buildSpawnConfig ────────────────────────────────────────────────

describe('CodexAdapter.buildSpawnConfig', () => {
  it('sets binary to "codex"', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Hello',
      workspacePath: '/tmp/test',
    });
    expect(config.binary).toBe('codex');
  });

  it('starts args with "exec" subcommand', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Hello',
      workspacePath: '/tmp/test',
    });
    expect(config.args[0]).toBe('exec');
  });

  it('builds minimal args: exec + --skip-git-repo-check + --sandbox read-only + --ephemeral + prompt', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'List all files',
      workspacePath: '/tmp/test',
    });
    expect(config.args).toEqual([
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      'List all files',
    ]);
  });

  it('always includes --skip-git-repo-check (required for non-git workspaces)', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Do something',
      workspacePath: '/tmp/test',
    });
    expect(config.args).toContain('--skip-git-repo-check');
    expect(config.args[1]).toBe('--skip-git-repo-check');
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

  it('maps read-only tools to --sandbox read-only', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Read files',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Glob', 'Grep'],
    });
    expect(config.args).toContain('--sandbox');
    expect(config.args).toContain('read-only');
  });

  it('maps code-edit tools to --sandbox workspace-write', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Fix bug',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep'],
    });
    expect(config.args).toContain('--sandbox');
    expect(config.args).toContain('workspace-write');
  });

  it('maps full-access tools (Bash(*)) to --full-auto', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Deploy',
      workspacePath: '/tmp/test',
      allowedTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
    });
    expect(config.args).toContain('--full-auto');
    // Should NOT use --sandbox when using --full-auto
    expect(config.args).not.toContain('--sandbox');
  });

  it('defaults to --sandbox read-only when no tools specified (safe default)', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Do something',
      workspacePath: '/tmp/test',
    });
    expect(config.args).toContain('--sandbox');
    expect(config.args).toContain('read-only');
    expect(config.args).not.toContain('--full-auto');
  });

  it('always includes --ephemeral', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Do something',
      workspacePath: '/tmp/test',
    });
    expect(config.args).toContain('--ephemeral');
  });

  it('sets stdin to pipe', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Hello',
      workspacePath: '/tmp/test',
    });
    expect(config.stdin).toBe('pipe');
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

  it('does not add --print (codex exec is non-interactive)', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    expect(config.args).not.toContain('--print');
  });

  it('throws when OPENAI_API_KEY is missing', () => {
    const saved = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      expect(() =>
        adapter.buildSpawnConfig({ prompt: 'Task', workspacePath: '/tmp/test' }),
      ).toThrow('Codex requires OPENAI_API_KEY environment variable');
    } finally {
      if (saved !== undefined) {
        process.env['OPENAI_API_KEY'] = saved;
      }
    }
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
  it('returns undefined (codex uses sandbox modes, not tool lists)', () => {
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
    expect(adapter.isValidModel('o4-mini')).toBe(true);
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
