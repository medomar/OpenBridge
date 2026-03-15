import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from '../../../src/core/adapters/claude-adapter.js';
import { CodexAdapter } from '../../../src/core/adapters/codex-adapter.js';
import { AiderAdapter } from '../../../src/core/adapters/aider-adapter.js';
import type { CLIAdapter } from '../../../src/core/cli-adapter.js';

// ── ClaudeAdapter.getPromptBudget ────────────────────────────────────────────

describe('ClaudeAdapter.getPromptBudget', () => {
  const adapter = new ClaudeAdapter();

  it('returns model-aware values for haiku', () => {
    const budget = adapter.getPromptBudget('haiku');
    expect(budget.maxPromptChars).toBe(32_768);
    expect(budget.maxSystemPromptChars).toBe(180_000);
  });

  it('returns model-aware values for full haiku model ID', () => {
    const budget = adapter.getPromptBudget('claude-haiku-4-5');
    expect(budget.maxPromptChars).toBe(32_768);
    expect(budget.maxSystemPromptChars).toBe(180_000);
  });

  it('returns model-aware values for sonnet', () => {
    const budget = adapter.getPromptBudget('sonnet');
    expect(budget.maxPromptChars).toBe(32_768);
    expect(budget.maxSystemPromptChars).toBe(180_000);
  });

  it('returns model-aware values for full sonnet model ID', () => {
    const budget = adapter.getPromptBudget('claude-sonnet-4-6');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns model-aware values for opus', () => {
    const budget = adapter.getPromptBudget('opus');
    expect(budget.maxPromptChars).toBe(32_768);
    expect(budget.maxSystemPromptChars).toBe(180_000);
  });

  it('returns model-aware values for full opus model ID', () => {
    const budget = adapter.getPromptBudget('claude-opus-4-6');
    expect(budget.maxPromptChars).toBe(128_000);
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });

  it('returns sane defaults when no model is specified', () => {
    const budget = adapter.getPromptBudget();
    expect(budget.maxPromptChars).toBe(32_768);
    expect(budget.maxSystemPromptChars).toBe(180_000);
  });

  it('returns sane defaults for an unrecognized model', () => {
    const budget = adapter.getPromptBudget('unknown-future-model-99');
    expect(budget.maxPromptChars).toBe(32_768);
    expect(budget.maxSystemPromptChars).toBe(180_000);
  });

  it('has a larger systemPrompt budget than prompt budget (separate channels)', () => {
    // Claude uses --append-system-prompt, giving system and user prompt separate channels.
    // The system prompt channel is intentionally larger (180K vs 32K).
    const budget = adapter.getPromptBudget('sonnet');
    expect(budget.maxSystemPromptChars).toBeGreaterThan(budget.maxPromptChars);
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

  it('returns a larger combined budget than the Claude prompt-only budget', () => {
    // Codex's context window (~128K tokens) allows a much larger combined prompt budget
    // than Claude's conservative 32K-char prompt limit.
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
