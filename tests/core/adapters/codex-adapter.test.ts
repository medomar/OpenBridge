import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { CodexAdapter, parseCodexJsonlOutput } from '../../../src/core/adapters/codex-adapter.js';

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

  it('starts args with "exec" subcommand', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Hello',
      workspacePath: '/tmp/test',
    });
    expect(config.args[0]).toBe('exec');
  });

  it('builds minimal args: exec + --skip-git-repo-check + --sandbox read-only + --ephemeral + --json + -o <file> + prompt', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'List all files',
      workspacePath: '/tmp/test',
    });
    // Core flags must be present in order; -o <tempFile> is injected before the prompt
    expect(config.args[0]).toBe('exec');
    expect(config.args[1]).toBe('--skip-git-repo-check');
    expect(config.args).toContain('--sandbox');
    expect(config.args).toContain('read-only');
    expect(config.args).toContain('--ephemeral');
    expect(config.args).toContain('--json');
    expect(config.args).toContain('-o');
    // Prompt must be last
    expect(config.args[config.args.length - 1]).toBe('List all files');
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

  it('does not set stdin (defaults to ignore in execOnce)', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Hello',
      workspacePath: '/tmp/test',
    });
    expect(config.stdin).toBeUndefined();
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

  it('includes --json for structured JSONL output', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    expect(config.args).toContain('--json');
  });

  it('places --json after --ephemeral and before the prompt', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    const ephemeralIdx = config.args.indexOf('--ephemeral');
    const jsonIdx = config.args.indexOf('--json');
    const promptIdx = config.args.indexOf('Task');
    expect(ephemeralIdx).toBeGreaterThanOrEqual(0);
    expect(jsonIdx).toBeGreaterThan(ephemeralIdx);
    expect(promptIdx).toBeGreaterThan(jsonIdx);
  });

  it('includes -o <tempFile> for reliable output capture', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    const oIdx = config.args.indexOf('-o');
    expect(oIdx).toBeGreaterThanOrEqual(0);
    const tempFile = config.args[oIdx + 1];
    expect(tempFile).toBeTruthy();
    expect(tempFile).toMatch(/ob-codex-\d+-[0-9a-f]+\.txt$/);
  });

  it('places -o before the prompt', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    const oIdx = config.args.indexOf('-o');
    const promptIdx = config.args.indexOf('Task');
    expect(oIdx).toBeGreaterThanOrEqual(0);
    expect(promptIdx).toBeGreaterThan(oIdx + 1); // -o <file> <prompt>
  });

  it('sets parseOutput to a function', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    expect(typeof config.parseOutput).toBe('function');
  });

  it('parseOutput reads from -o temp file when it exists', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    const oIdx = config.args.indexOf('-o');
    const tempFile = config.args[oIdx + 1];

    // Simulate Codex writing the final answer to the temp file
    writeFileSync(tempFile, 'Answer from temp file\n', 'utf-8');

    try {
      const result = config.parseOutput!('raw stdout content');
      expect(result).toBe('Answer from temp file');
      // Temp file should be cleaned up after read
      expect(existsSync(tempFile)).toBe(false);
    } finally {
      // Safety cleanup in case the test failed before cleanup
      try {
        unlinkSync(tempFile);
      } catch {
        /* already gone */
      }
    }
  });

  it('parseOutput falls back to JSONL parsing when temp file is missing', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    // Do NOT write the temp file — simulate Codex not writing it

    const jsonlStdout = JSON.stringify({ type: 'message', content: 'JSONL answer' });
    const result = config.parseOutput!(jsonlStdout);
    expect(result).toBe('JSONL answer');
  });

  it('parseOutput falls back to raw stdout when temp file missing and no JSONL', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    const raw = 'plain text output';
    expect(config.parseOutput!(raw)).toBe(raw);
  });

  it('each buildSpawnConfig call generates a unique temp file path', () => {
    const config1 = adapter.buildSpawnConfig({ prompt: 'T1', workspacePath: '/tmp/test' });
    const config2 = adapter.buildSpawnConfig({ prompt: 'T2', workspacePath: '/tmp/test' });
    const oIdx1 = config1.args.indexOf('-o');
    const oIdx2 = config2.args.indexOf('-o');
    expect(config1.args[oIdx1 + 1]).not.toBe(config2.args[oIdx2 + 1]);
  });

  it('passes -c <mcpConfigPath> when mcpConfigPath is set', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
      mcpConfigPath: '/tmp/mcp-config.json',
    });
    const cIdx = config.args.indexOf('-c');
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(config.args[cIdx + 1]).toBe('/tmp/mcp-config.json');
  });

  it('places -c <mcpConfigPath> before --json and the prompt', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
      mcpConfigPath: '/tmp/mcp-config.json',
    });
    const cIdx = config.args.indexOf('-c');
    const jsonIdx = config.args.indexOf('--json');
    const promptIdx = config.args.indexOf('Task');
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(jsonIdx).toBeGreaterThan(cIdx);
    expect(promptIdx).toBeGreaterThan(jsonIdx);
  });

  it('does not include -c flag when mcpConfigPath is not set', () => {
    const config = adapter.buildSpawnConfig({
      prompt: 'Task',
      workspacePath: '/tmp/test',
    });
    expect(config.args).not.toContain('-c');
  });

  it('builds config without requiring OPENAI_API_KEY (Codex supports codex login)', () => {
    const saved = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const config = adapter.buildSpawnConfig({ prompt: 'Task', workspacePath: '/tmp/test' });
      expect(config.binary).toBe('codex');
      expect(config.args[0]).toBe('exec');
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

// ── parseCodexJsonlOutput ────────────────────────────────────────────

describe('parseCodexJsonlOutput', () => {
  it('extracts content from a single message event', () => {
    const jsonl = JSON.stringify({ type: 'message', content: 'Hello, world!' });
    expect(parseCodexJsonlOutput(jsonl)).toBe('Hello, world!');
  });

  it('returns the last message content when multiple message events are present', () => {
    const lines = [
      JSON.stringify({ type: 'message', content: 'First answer' }),
      JSON.stringify({ type: 'tool_call', name: 'bash', input: 'ls' }),
      JSON.stringify({ type: 'tool_result', output: 'file.txt' }),
      JSON.stringify({ type: 'message', content: 'Final answer' }),
    ].join('\n');
    expect(parseCodexJsonlOutput(lines)).toBe('Final answer');
  });

  it('skips non-message events', () => {
    const lines = [
      JSON.stringify({ type: 'tool_call', name: 'bash', input: 'echo hi' }),
      JSON.stringify({ type: 'tool_result', output: 'hi' }),
      JSON.stringify({ type: 'message', content: 'Done' }),
    ].join('\n');
    expect(parseCodexJsonlOutput(lines)).toBe('Done');
  });

  it('falls back to raw stdout when no message events are present', () => {
    const lines = [
      JSON.stringify({ type: 'tool_call', name: 'bash', input: 'ls' }),
      JSON.stringify({ type: 'tool_result', output: 'file.txt' }),
    ].join('\n');
    expect(parseCodexJsonlOutput(lines)).toBe(lines);
  });

  it('falls back to raw stdout when output is not JSONL', () => {
    const raw = 'This is plain text output from codex';
    expect(parseCodexJsonlOutput(raw)).toBe(raw);
  });

  it('falls back to raw stdout when output is empty', () => {
    expect(parseCodexJsonlOutput('')).toBe('');
  });

  it('handles mixed valid and invalid JSON lines gracefully', () => {
    const lines = [
      'not json at all',
      JSON.stringify({ type: 'message', content: 'Valid message' }),
      '{broken json',
    ].join('\n');
    expect(parseCodexJsonlOutput(lines)).toBe('Valid message');
  });

  it('ignores message events without a string content field', () => {
    const lines = [
      JSON.stringify({ type: 'message', content: 42 }),
      JSON.stringify({ type: 'message', content: null }),
      JSON.stringify({ type: 'message' }),
    ].join('\n');
    // No valid message events — falls back to raw
    expect(parseCodexJsonlOutput(lines)).toBe(lines);
  });
});
