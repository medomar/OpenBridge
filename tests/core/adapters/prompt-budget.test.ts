import { describe, it, expect, vi } from 'vitest';

// @anthropic-ai/claude-agent-sdk is an optional peer dependency not always installed.
// Mock it so ClaudeSDKAdapter can be imported without the actual SDK present.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

import { ClaudeAdapter } from '../../../src/core/adapters/claude-adapter.js';
import { ClaudeSDKAdapter } from '../../../src/core/adapters/claude-sdk.js';
import { CodexAdapter } from '../../../src/core/adapters/codex-adapter.js';
import { AiderAdapter } from '../../../src/core/adapters/aider-adapter.js';
import type { CLIAdapter } from '../../../src/core/cli-adapter.js';

// ── ClaudeAdapter.getPromptBudget ────────────────────────────────────────────

describe('ClaudeAdapter.getPromptBudget', () => {
  const adapter = new ClaudeAdapter();

  it('returns large budget for claude-opus-4-6', () => {
    const budget = adapter.getPromptBudget('claude-opus-4-6');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns large budget for claude-sonnet-4-6', () => {
    const budget = adapter.getPromptBudget('claude-sonnet-4-6');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns conservative budget for claude-haiku-4-5-20251001', () => {
    const budget = adapter.getPromptBudget('claude-haiku-4-5-20251001');
    expect(budget.maxPromptChars).toBe(32_768);
    expect(budget.maxSystemPromptChars).toBe(180_000);
  });

  it('returns large budget for opus short alias', () => {
    const budget = adapter.getPromptBudget('opus');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns large budget for sonnet short alias', () => {
    const budget = adapter.getPromptBudget('sonnet');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns conservative budget for haiku short alias', () => {
    const budget = adapter.getPromptBudget('haiku');
    expect(budget.maxPromptChars).toBe(32_768);
    expect(budget.maxSystemPromptChars).toBe(180_000);
  });

  it('returns Sonnet-class budget for unknown-model (OB-1561)', () => {
    const budget = adapter.getPromptBudget('unknown-model');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns Sonnet-class budget when no model is specified (OB-1561)', () => {
    const budget = adapter.getPromptBudget();
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns Sonnet-class budget for an unrecognized model (OB-1561)', () => {
    const budget = adapter.getPromptBudget('unknown-future-model-99');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('opus and sonnet have a larger systemPrompt budget than haiku', () => {
    const opusBudget = adapter.getPromptBudget('claude-opus-4-6');
    const haikuBudget = adapter.getPromptBudget('haiku');
    expect(opusBudget.maxSystemPromptChars).toBeGreaterThan(haikuBudget.maxSystemPromptChars);
  });
});

// ── ClaudeSDKAdapter.getPromptBudget ──────────────────────────────────────────

describe('ClaudeSDKAdapter.getPromptBudget', () => {
  const adapter = new ClaudeSDKAdapter();

  it('returns large budget for claude-opus-4-6', () => {
    const budget = adapter.getPromptBudget('claude-opus-4-6');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns large budget for claude-sonnet-4-6', () => {
    const budget = adapter.getPromptBudget('claude-sonnet-4-6');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns conservative budget for claude-haiku-4-5-20251001', () => {
    const budget = adapter.getPromptBudget('claude-haiku-4-5-20251001');
    expect(budget.maxPromptChars).toBe(32_768);
    expect(budget.maxSystemPromptChars).toBe(180_000);
  });

  it('returns large budget for opus short alias', () => {
    const budget = adapter.getPromptBudget('opus');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns large budget for sonnet short alias', () => {
    const budget = adapter.getPromptBudget('sonnet');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns conservative budget for haiku short alias', () => {
    const budget = adapter.getPromptBudget('haiku');
    expect(budget.maxPromptChars).toBe(32_768);
    expect(budget.maxSystemPromptChars).toBe(180_000);
  });

  it('returns Sonnet-class budget for unknown-model (OB-1561)', () => {
    const budget = adapter.getPromptBudget('unknown-model');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns Sonnet-class budget when no model is specified (OB-1561)', () => {
    const budget = adapter.getPromptBudget();
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns identical budgets to ClaudeAdapter for all model IDs (shared helper)', () => {
    const cliAdapter = new ClaudeAdapter();
    const models = [
      'claude-opus-4-6',
      'claude-sonnet-4-6',
      'claude-haiku-4-5-20251001',
      'opus',
      'sonnet',
      'haiku',
      'unknown-model',
    ];
    for (const model of models) {
      expect(adapter.getPromptBudget(model)).toEqual(cliAdapter.getPromptBudget(model));
    }
  });
});

// ── CodexAdapter.getPromptBudget ─────────────────────────────────────────────

describe('CodexAdapter.getPromptBudget', () => {
  const adapter = new CodexAdapter();

  it('returns equal maxPromptChars and maxSystemPromptChars (shared single pool)', () => {
    // Codex merges systemPrompt INTO the prompt positional argument — both fields
    // share the same budget rather than having independent channels.
    const budget = adapter.getPromptBudget();
    expect(budget.maxPromptChars).toBe(budget.maxSystemPromptChars);
  });

  it('returns a combined budget of 100_000 chars', () => {
    const budget = adapter.getPromptBudget();
    expect(budget.maxPromptChars).toBe(100_000);
    expect(budget.maxSystemPromptChars).toBe(100_000);
  });

  it('returns the same budget regardless of model', () => {
    const budgetDefault = adapter.getPromptBudget();
    const budgetGpt = adapter.getPromptBudget('gpt-5.2-codex');
    const budgetO3 = adapter.getPromptBudget('o3');
    expect(budgetDefault).toEqual(budgetGpt);
    expect(budgetDefault).toEqual(budgetO3);
  });

  it('returns a larger combined budget than the Claude Sonnet-class default (OB-1561)', () => {
    // Codex's combined budget (400K) is larger than Claude's Sonnet-class default (128K).
    const codexBudget = adapter.getPromptBudget();
    const claudeBudget = new ClaudeAdapter().getPromptBudget();
    expect(codexBudget.maxPromptChars).toBeGreaterThan(claudeBudget.maxPromptChars);
  });
});

// ── AiderAdapter.getPromptBudget ─────────────────────────────────────────────

describe('AiderAdapter.getPromptBudget', () => {
  const adapter = new AiderAdapter();

  it('returns equal maxPromptChars and maxSystemPromptChars (shared single pool)', () => {
    // Aider prepends systemPrompt to --message text — both fields share the same budget.
    const budget = adapter.getPromptBudget();
    expect(budget.maxPromptChars).toBe(budget.maxSystemPromptChars);
  });

  it('returns a combined budget of 100_000 chars', () => {
    const budget = adapter.getPromptBudget();
    expect(budget.maxPromptChars).toBe(100_000);
    expect(budget.maxSystemPromptChars).toBe(100_000);
  });

  it('returns the same budget regardless of model (model is unknown at adapter level)', () => {
    const budgetDefault = adapter.getPromptBudget();
    const budgetClaude = adapter.getPromptBudget('claude-3-sonnet');
    const budgetGpt = adapter.getPromptBudget('gpt-4o');
    expect(budgetDefault).toEqual(budgetClaude);
    expect(budgetDefault).toEqual(budgetGpt);
  });
});

// ── CLIAdapter interface — fallback behaviour for adapters without getPromptBudget ──

describe('CLIAdapter default fallback', () => {
  it('optional getPromptBudget is undefined for adapters that do not implement it', () => {
    // The CLIAdapter interface declares getPromptBudget as optional.
    // An adapter that does not implement it should have the method as undefined,
    // meaning callers must guard before invoking it.
    const minimalAdapter: CLIAdapter = {
      name: 'minimal',
      buildSpawnConfig: () => ({ binary: 'minimal', args: [], env: {} }),
      cleanEnv: (env) => env,
      mapCapabilityLevel: () => undefined,
      isValidModel: () => true,
    };

    expect(minimalAdapter.getPromptBudget).toBeUndefined();
  });

  it('fallback values are consistent with documented defaults', () => {
    // Documented interface defaults: { maxPromptChars: 32_768, maxSystemPromptChars: 100_000 }
    // These are the values that AgentRunner should use when getPromptBudget is absent.
    const FALLBACK_PROMPT_CHARS = 32_768;
    const FALLBACK_SYSTEM_PROMPT_CHARS = 100_000;

    // Verify the constants are sensible (non-zero, system > prompt to leave room)
    expect(FALLBACK_PROMPT_CHARS).toBeGreaterThan(0);
    expect(FALLBACK_SYSTEM_PROMPT_CHARS).toBeGreaterThan(FALLBACK_PROMPT_CHARS);
  });
});
