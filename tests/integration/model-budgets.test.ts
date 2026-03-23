/**
 * Integration test: model-aware prompt pipeline (OB-1557)
 *
 * Verifies that the model-aware budget chain works end-to-end:
 *   ClaudeAdapter → getClaudePromptBudget → SessionCompactor config
 *   CodexAdapter.getPromptBudget()
 *   AiderAdapter.getPromptBudget(model)
 */

import { describe, it, expect, vi } from 'vitest';
import { ClaudeAdapter } from '../../src/core/adapters/claude-adapter.js';
import { CodexAdapter } from '../../src/core/adapters/codex-adapter.js';
import { AiderAdapter } from '../../src/core/adapters/aider-adapter.js';
import { getClaudePromptBudget } from '../../src/core/adapters/claude-budget.js';
import { SessionCompactor } from '../../src/master/session-compactor.js';
import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Helper: mock DB returning zero counts (we only need prompt-size behaviour)
// ---------------------------------------------------------------------------

function makeZeroDb(): Database.Database {
  const mockGet = vi
    .fn()
    .mockReturnValue({ message_count: 0 })
    .mockReturnValueOnce({ message_count: 0 })
    .mockReturnValueOnce({ count: 0 });

  return {
    prepare: vi.fn().mockReturnValue({ get: mockGet }),
  } as unknown as Database.Database;
}

// ---------------------------------------------------------------------------
// 1. ClaudeAdapter — model-aware budget for claude-opus-4-6
// ---------------------------------------------------------------------------

describe('ClaudeAdapter model-aware budget (claude-opus-4-6)', () => {
  const adapter = new ClaudeAdapter();

  it('returns maxPromptChars = 128_000 for claude-opus-4-6', () => {
    const budget = adapter.getPromptBudget('claude-opus-4-6');
    expect(budget.maxPromptChars).toBe(128_000);
  });

  it('returns maxSystemPromptChars = 800_000 for claude-opus-4-6', () => {
    const budget = adapter.getPromptBudget('claude-opus-4-6');
    expect(budget.maxSystemPromptChars).toBe(800_000);
  });
});

// ---------------------------------------------------------------------------
// 2. SessionCompactor — prompt size threshold with model-aware config
// ---------------------------------------------------------------------------

describe('SessionCompactor model-aware promptSizeLimit', () => {
  it('uses 800_000 limit for claude-opus-4-6 — triggers at ~640K (800K × 0.8)', () => {
    const compactor = new SessionCompactor({ maxTurns: 100, modelId: 'claude-opus-4-6' });

    // notifyPromptSize fires when chars >= floor(promptSizeLimit * 0.8)
    // For Opus 4.6: floor(800_000 * 0.8) = 640_000
    compactor.notifyPromptSize(639_999);
    const snapBelow = compactor.snapshotTurns(makeZeroDb(), 'test-session');
    expect(snapBelow.promptSizeExceeded).toBe(false);

    compactor.notifyPromptSize(640_000);
    const snapExceeded = compactor.snapshotTurns(makeZeroDb(), 'test-session');
    expect(snapExceeded.promptSizeExceeded).toBe(true);
    expect(snapExceeded.lastPromptChars).toBe(640_000);
  });

  it('uses 32_768 limit for unrecognized model — triggers at ~26K (32768 × 0.8), NOT at 640K', () => {
    const compactor = new SessionCompactor({ maxTurns: 100 }); // no modelId

    // For default: floor(32_768 * 0.8) = 26_214
    compactor.notifyPromptSize(26_213);
    const snapBelow = compactor.snapshotTurns(makeZeroDb(), 'test-session');
    expect(snapBelow.promptSizeExceeded).toBe(false);

    compactor.notifyPromptSize(26_214);
    const snapExceeded = compactor.snapshotTurns(makeZeroDb(), 'test-session');
    expect(snapExceeded.promptSizeExceeded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. getClaudePromptBudget — equivalent of getMaxPromptLength('claude-opus-4-6')
// ---------------------------------------------------------------------------

describe('getClaudePromptBudget (backing getMaxPromptLength)', () => {
  it('returns maxPromptChars = 128_000 for claude-opus-4-6', () => {
    const budget = getClaudePromptBudget('claude-opus-4-6');
    expect(budget.maxPromptChars).toBe(128_000);
  });

  it('returns maxPromptChars = 32_768 for claude-haiku-4-5-20251001', () => {
    const budget = getClaudePromptBudget('claude-haiku-4-5-20251001');
    expect(budget.maxPromptChars).toBe(32_768);
  });

  it('returns maxPromptChars = 128_000 for undefined (Sonnet-class default)', () => {
    const budget = getClaudePromptBudget(undefined);
    expect(budget.maxPromptChars).toBe(128_000);
  });
});

// ---------------------------------------------------------------------------
// 4. CodexAdapter — getPromptBudget returns 400_000
// ---------------------------------------------------------------------------

describe('CodexAdapter.getPromptBudget', () => {
  const adapter = new CodexAdapter();

  it('returns maxPromptChars = 400_000', () => {
    const budget = adapter.getPromptBudget();
    expect(budget.maxPromptChars).toBe(400_000);
  });

  it('returns maxSystemPromptChars = 400_000', () => {
    const budget = adapter.getPromptBudget();
    expect(budget.maxSystemPromptChars).toBe(400_000);
  });
});

// ---------------------------------------------------------------------------
// 5. AiderAdapter — getPromptBudget('o3') returns 200_000
// ---------------------------------------------------------------------------

describe('AiderAdapter.getPromptBudget', () => {
  const adapter = new AiderAdapter();

  it('returns 200_000 for o3', () => {
    const budget = adapter.getPromptBudget('o3');
    expect(budget.maxPromptChars).toBe(200_000);
    expect(budget.maxSystemPromptChars).toBe(200_000);
  });

  it('returns 400_000 for gpt-4.1', () => {
    const budget = adapter.getPromptBudget('gpt-4.1');
    expect(budget.maxPromptChars).toBe(400_000);
  });

  it('returns 100_000 for default (no model)', () => {
    const budget = adapter.getPromptBudget();
    expect(budget.maxPromptChars).toBe(100_000);
  });
});
