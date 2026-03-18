/**
 * OB-1564 — Worker prompt budget unit tests
 *
 * Tests for the pre-spawn prompt size validation added in OB-1562:
 * - A 200K workerPrompt with resolvedModel=undefined must be truncated to 128K (not 32K).
 * - getMaxPromptLength(undefined) returns 128K after the OB-1561 fix.
 */

import { describe, it, expect } from 'vitest';
import { getMaxPromptLength } from '../../src/core/agent-runner.js';

// ── Pre-spawn prompt size validation (OB-1562 logic) ─────────────────────────

/**
 * Inline replica of the OB-1562 truncation block from worker-orchestrator.ts.
 * Used here to unit-test the behaviour without requiring the full orchestrator.
 */
function applyPreSpawnTruncation(
  workerPrompt: string,
  resolvedModel: string | undefined,
): { prompt: string; wasTruncated: boolean } {
  const maxChars = getMaxPromptLength(resolvedModel);
  if (workerPrompt.length > maxChars) {
    return { prompt: workerPrompt.slice(0, maxChars), wasTruncated: true };
  }
  return { prompt: workerPrompt, wasTruncated: false };
}

describe('pre-spawn prompt size validation (OB-1562)', () => {
  it('truncates a 200K prompt to 128K when resolvedModel is undefined', () => {
    const BIG_PROMPT = 'A'.repeat(200_000);
    const { prompt, wasTruncated } = applyPreSpawnTruncation(BIG_PROMPT, undefined);

    expect(wasTruncated).toBe(true);
    // Must be truncated to the Sonnet-class limit (128K), NOT the old Haiku limit (32K).
    expect(prompt.length).toBe(128_000);
  });

  it('does NOT truncate a 128K prompt when resolvedModel is undefined', () => {
    const FITS_PROMPT = 'B'.repeat(128_000);
    const { prompt, wasTruncated } = applyPreSpawnTruncation(FITS_PROMPT, undefined);

    expect(wasTruncated).toBe(false);
    expect(prompt.length).toBe(128_000);
  });

  it('truncates a 200K prompt to 32K when resolvedModel is haiku', () => {
    const BIG_PROMPT = 'C'.repeat(200_000);
    const { prompt, wasTruncated } = applyPreSpawnTruncation(BIG_PROMPT, 'haiku');

    expect(wasTruncated).toBe(true);
    expect(prompt.length).toBe(32_768);
  });

  it('does NOT truncate a 50K prompt when resolvedModel is haiku (fits within 32K limit)', () => {
    // 32K = 32_768, so a 30K prompt should not be truncated
    const SMALL_PROMPT = 'D'.repeat(30_000);
    const { prompt, wasTruncated } = applyPreSpawnTruncation(SMALL_PROMPT, 'haiku');

    expect(wasTruncated).toBe(false);
    expect(prompt.length).toBe(30_000);
  });

  it('truncates a 200K prompt to 128K when resolvedModel is sonnet', () => {
    const BIG_PROMPT = 'E'.repeat(200_000);
    const { prompt, wasTruncated } = applyPreSpawnTruncation(BIG_PROMPT, 'sonnet');

    expect(wasTruncated).toBe(true);
    expect(prompt.length).toBe(128_000);
  });

  it('truncates a 200K prompt to 128K when resolvedModel is opus', () => {
    const BIG_PROMPT = 'F'.repeat(200_000);
    const { prompt, wasTruncated } = applyPreSpawnTruncation(BIG_PROMPT, 'opus');

    expect(wasTruncated).toBe(true);
    expect(prompt.length).toBe(128_000);
  });
});

// ── getMaxPromptLength returns 128K for undefined (OB-1561/OB-1564) ───────────

describe('getMaxPromptLength — undefined model returns 128K', () => {
  it('returns 128K for undefined (Sonnet-class default)', () => {
    expect(getMaxPromptLength(undefined)).toBe(128_000);
  });

  it('returns 128K — confirming NOT the old 32K Haiku fallback', () => {
    const result = getMaxPromptLength(undefined);
    expect(result).not.toBe(32_768);
    expect(result).toBe(128_000);
  });
});
