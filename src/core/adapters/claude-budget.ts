/**
 * Shared prompt budget helper for Claude adapters.
 *
 * Used by both ClaudeAdapter (CLI-based) and ClaudeSDKAdapter (SDK-based) to
 * return identical model-aware prompt budgets. Centralised here to eliminate
 * duplication between the two adapters.
 *
 * Official context windows:
 *   Tier 1 — Opus 4.6 (claude-opus-4-6):    1M tokens (~3.4M chars), max output 128k tokens
 *            Sonnet 4.6 (claude-sonnet-4-6): 1M tokens (~3.4M chars), max output 64k tokens
 *     → maxPromptChars: 128_000, maxSystemPromptChars: 800_000
 *   Tier 2 — Haiku 4.5 (claude-haiku-4-5-20251001): 200k tokens (~680k chars), max output 64k tokens
 *     → maxPromptChars: 32_768, maxSystemPromptChars: 180_000
 *   Tier 3 — Unrecognized / unspecified: conservative fallback (same as Haiku 4.5)
 *     → maxPromptChars: 32_768, maxSystemPromptChars: 180_000
 */

export function getClaudePromptBudget(model?: string): {
  maxPromptChars: number;
  maxSystemPromptChars: number;
} {
  const isOpus46 = model != null && (/opus.*4[.-]6/i.test(model) || model === 'claude-opus-4-6');
  const isSonnet46 =
    model != null && (/sonnet.*4[.-]6/i.test(model) || model === 'claude-sonnet-4-6');

  if (isOpus46 || isSonnet46) {
    return { maxPromptChars: 128_000, maxSystemPromptChars: 800_000 };
  }

  // Haiku 4.5 and all older/unrecognized models — conservative limits.
  return { maxPromptChars: 32_768, maxSystemPromptChars: 180_000 };
}
