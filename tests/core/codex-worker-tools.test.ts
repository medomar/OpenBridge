/**
 * Tests for Codex worker tool compatibility (OB-1579 / OB-F91).
 *
 * Covers:
 *  1. Codex adapter tool name mapping (allowedTools → sandbox mode)
 *  2. read-only profile injects system prompt constraints into the prompt arg
 *  3. Unsupported allowedTools handled gracefully (no crash, no --allowedTools flag)
 *  4. Worker prompt includes file-reading guidance via applyToolPromptPrefix
 */

import { describe, it, expect } from 'vitest';
import { CodexAdapter } from '../../src/core/adapters/codex-adapter.js';
import { AdapterRegistry } from '../../src/core/adapter-registry.js';
import { applyToolPromptPrefix, CODEX_WORKER_PREFIX } from '../../src/master/seed-prompts.js';
import type { SpawnOptions } from '../../src/core/agent-runner.js';

const BASE_OPTS: SpawnOptions = {
  prompt: 'List all TypeScript files in the project.',
  workspacePath: '/tmp/test-workspace',
  retries: 0,
};

// ── Test 1: Codex adapter tool name mapping ───────────────────────────────────

describe('CodexAdapter — tool name mapping (allowedTools → sandbox mode)', () => {
  it('maps Bash(*) to --full-auto (unrestricted access)', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      allowedTools: ['Bash(*)'],
    });
    expect(config.binary).toBe('codex');
    expect(config.args).toContain('--full-auto');
    // --sandbox should NOT appear alongside --full-auto
    expect(config.args).not.toContain('--sandbox');
  });

  it('maps Edit tool to --sandbox workspace-write', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      allowedTools: ['Read', 'Edit', 'Glob'],
    });
    const sandboxIdx = config.args.indexOf('--sandbox');
    expect(sandboxIdx).toBeGreaterThan(-1);
    expect(config.args[sandboxIdx + 1]).toBe('workspace-write');
    expect(config.args).not.toContain('--full-auto');
  });

  it('maps Write tool to --sandbox workspace-write', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      allowedTools: ['Read', 'Write', 'Glob'],
    });
    const sandboxIdx = config.args.indexOf('--sandbox');
    expect(sandboxIdx).toBeGreaterThan(-1);
    expect(config.args[sandboxIdx + 1]).toBe('workspace-write');
  });

  it('maps read-only tools (Read, Glob, Grep) to --sandbox read-only', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      allowedTools: ['Read', 'Glob', 'Grep'],
    });
    const sandboxIdx = config.args.indexOf('--sandbox');
    expect(sandboxIdx).toBeGreaterThan(-1);
    expect(config.args[sandboxIdx + 1]).toBe('read-only');
    expect(config.args).not.toContain('--full-auto');
  });

  it('defaults to --sandbox read-only when allowedTools is empty', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      allowedTools: [],
    });
    const sandboxIdx = config.args.indexOf('--sandbox');
    expect(sandboxIdx).toBeGreaterThan(-1);
    expect(config.args[sandboxIdx + 1]).toBe('read-only');
  });

  it('defaults to --sandbox read-only when allowedTools is undefined', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      // allowedTools intentionally omitted
    });
    const sandboxIdx = config.args.indexOf('--sandbox');
    expect(sandboxIdx).toBeGreaterThan(-1);
    expect(config.args[sandboxIdx + 1]).toBe('read-only');
  });

  it('does NOT pass --allowedTools to Codex (unsupported flag)', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      allowedTools: ['Read', 'Edit'],
    });
    // Codex doesn't accept --allowedTools — verify it's absent
    expect(config.args).not.toContain('--allowedTools');
    expect(config.args.join(' ')).not.toContain('allowedTools');
  });
});

// ── Test 2: read-only profile adds system prompt constraints ──────────────────

describe('CodexAdapter — read-only profile injects system prompt constraints', () => {
  it('prepends read-only constraint text for read-only tool list', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      allowedTools: ['Read', 'Glob', 'Grep'],
    });

    // The prompt positional arg is last in the args array
    const promptArg = config.args[config.args.length - 1]!;
    expect(promptArg).toContain('only READ files');
    expect(promptArg).toContain(BASE_OPTS.prompt);
    // Constraint comes BEFORE the task prompt
    expect(promptArg.indexOf('only READ files')).toBeLessThan(promptArg.indexOf(BASE_OPTS.prompt));
  });

  it('prepends workspace-write constraint text when Edit or Write in tool list', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      allowedTools: ['Read', 'Edit'],
    });

    const promptArg = config.args[config.args.length - 1]!;
    // workspace-write constraint is injected (not read-only)
    expect(promptArg).toContain('you can read and write files');
    expect(promptArg).not.toContain('only READ files');
    expect(promptArg).toContain(BASE_OPTS.prompt);
  });

  it('does NOT inject constraint for full-access (Bash(*))', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      allowedTools: ['Bash(*)'],
    });

    const promptArg = config.args[config.args.length - 1]!;
    // danger-full-access has no constraint in SANDBOX_CONSTRAINTS
    expect(promptArg).not.toContain('only READ files');
    expect(promptArg).not.toContain('you can read and write files');
    // Task prompt still present
    expect(promptArg).toContain(BASE_OPTS.prompt);
  });

  it('includes a user-supplied systemPrompt after the constraint', () => {
    const adapter = new CodexAdapter();
    const config = adapter.buildSpawnConfig({
      ...BASE_OPTS,
      allowedTools: ['Read', 'Glob'],
      systemPrompt: 'Focus on the src/ directory only.',
    });

    const promptArg = config.args[config.args.length - 1]!;
    expect(promptArg).toContain('only READ files');
    expect(promptArg).toContain('Focus on the src/ directory only.');
    expect(promptArg).toContain(BASE_OPTS.prompt);
    // Order: constraint → systemPrompt → task prompt
    expect(promptArg.indexOf('only READ files')).toBeLessThan(
      promptArg.indexOf('Focus on the src/'),
    );
    expect(promptArg.indexOf('Focus on the src/')).toBeLessThan(
      promptArg.indexOf(BASE_OPTS.prompt),
    );
  });
});

// ── Test 3: Unsupported allowedTools handled gracefully ───────────────────────

describe('CodexAdapter — unsupported allowedTools handled gracefully', () => {
  it('supportedProfiles() returns empty array (no native tool-list enforcement)', () => {
    const adapter = new CodexAdapter();
    expect(adapter.supportedProfiles()).toEqual([]);
  });

  it('AdapterRegistry.resolveProfileForAdapter returns supported:false for Codex', () => {
    const registry = new AdapterRegistry();
    expect(registry.resolveProfileForAdapter('codex', 'read-only')).toEqual({
      supported: false,
    });
    expect(registry.resolveProfileForAdapter('codex', 'code-edit')).toEqual({
      supported: false,
    });
    expect(registry.resolveProfileForAdapter('codex', 'full-access')).toEqual({
      supported: false,
    });
  });

  it('buildSpawnConfig does not throw for any allowedTools combination', () => {
    const adapter = new CodexAdapter();
    const toolCombinations = [
      undefined,
      [],
      ['Read'],
      ['Read', 'Glob', 'Grep'],
      ['Read', 'Edit', 'Write'],
      ['Bash(*)'],
      ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)'],
    ];

    for (const tools of toolCombinations) {
      expect(() => adapter.buildSpawnConfig({ ...BASE_OPTS, allowedTools: tools })).not.toThrow();
    }
  });

  it('mapCapabilityLevel() returns undefined (Codex uses sandbox, not tool lists)', () => {
    const adapter = new CodexAdapter();
    expect(adapter.mapCapabilityLevel('read-only')).toBeUndefined();
    expect(adapter.mapCapabilityLevel('code-edit')).toBeUndefined();
    expect(adapter.mapCapabilityLevel('full-access')).toBeUndefined();
  });
});

// ── Test 4: Worker prompt includes file-reading guidance ──────────────────────

describe('applyToolPromptPrefix — file-reading guidance for Codex workers', () => {
  it('prepends CODEX_WORKER_PREFIX when tool is "codex"', () => {
    const base = 'Read the package.json and list dependencies.';
    const result = applyToolPromptPrefix(base, 'codex');
    expect(result).toBe(CODEX_WORKER_PREFIX + base);
  });

  it('is case-insensitive for the tool name', () => {
    const base = 'Read the package.json and list dependencies.';
    const result = applyToolPromptPrefix(base, 'Codex');
    expect(result).toBe(CODEX_WORKER_PREFIX + base);

    const upperResult = applyToolPromptPrefix(base, 'CODEX');
    expect(upperResult).toBe(CODEX_WORKER_PREFIX + base);
  });

  it('returns prompt unchanged for "claude" (no prefix needed)', () => {
    const base = 'Analyze the codebase and report findings.';
    const result = applyToolPromptPrefix(base, 'claude');
    expect(result).toBe(base);
  });

  it('returns prompt unchanged for unknown tool names', () => {
    const base = 'Do something.';
    expect(applyToolPromptPrefix(base, 'aider')).toBe(base);
    expect(applyToolPromptPrefix(base, 'cursor')).toBe(base);
    expect(applyToolPromptPrefix(base, '')).toBe(base);
  });

  it('CODEX_WORKER_PREFIX contains file-reading guidance', () => {
    expect(CODEX_WORKER_PREFIX).toContain('Use file reading commands');
    expect(CODEX_WORKER_PREFIX).toContain('Do NOT use complex bash/shell scripts');
    expect(CODEX_WORKER_PREFIX).toContain('simple, direct commands');
  });

  it('result preserves the full original prompt text', () => {
    const longPrompt = 'Step 1: Read src/index.ts\nStep 2: Read package.json\nStep 3: Report.';
    const result = applyToolPromptPrefix(longPrompt, 'codex');
    expect(result).toContain(longPrompt);
    expect(result.endsWith(longPrompt)).toBe(true);
  });
});
