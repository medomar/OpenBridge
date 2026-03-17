import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

// ── Mock the logger BEFORE importing PromptAssembler ───────────────────────
// vi.hoisted runs before vi.mock, allowing the factory to reference the spy.
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: mockWarn,
    debug: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

import {
  PromptAssembler,
  PRIORITY_IDENTITY,
  PRIORITY_WORKSPACE,
  PRIORITY_MEMORY,
  PRIORITY_RAG,
  PRIORITY_HISTORY,
  PRIORITY_LEARNINGS,
  PRIORITY_WORKER_NEXT,
  PRIORITY_ANALYSIS,
} from '../../src/core/prompt-assembler.js';

// ── Priority constants ──────────────────────────────────────────────────────

describe('Priority constants', () => {
  it('has descending values from IDENTITY down to ANALYSIS', () => {
    expect(PRIORITY_IDENTITY).toBe(100);
    expect(PRIORITY_WORKSPACE).toBe(80);
    expect(PRIORITY_MEMORY).toBe(70);
    expect(PRIORITY_RAG).toBe(60);
    expect(PRIORITY_HISTORY).toBe(50);
    expect(PRIORITY_LEARNINGS).toBe(40);
    expect(PRIORITY_WORKER_NEXT).toBe(30);
    expect(PRIORITY_ANALYSIS).toBe(20);
  });

  it('has strictly decreasing priority values', () => {
    const priorities = [
      PRIORITY_IDENTITY,
      PRIORITY_WORKSPACE,
      PRIORITY_MEMORY,
      PRIORITY_RAG,
      PRIORITY_HISTORY,
      PRIORITY_LEARNINGS,
      PRIORITY_WORKER_NEXT,
      PRIORITY_ANALYSIS,
    ];
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeLessThan(priorities[i - 1]);
    }
  });
});

// ── PromptAssembler ─────────────────────────────────────────────────────────

describe('PromptAssembler', () => {
  let assembler: PromptAssembler;

  beforeEach(() => {
    assembler = new PromptAssembler();
    mockWarn.mockClear();
  });

  // ── sectionCount ──────────────────────────────────────────────

  describe('sectionCount', () => {
    it('starts at zero', () => {
      expect(assembler.sectionCount).toBe(0);
    });

    it('increments after each non-empty addSection call', () => {
      assembler.addSection('a', 'content a', 10);
      expect(assembler.sectionCount).toBe(1);
      assembler.addSection('b', 'content b', 5);
      expect(assembler.sectionCount).toBe(2);
    });

    it('does not increment for empty content', () => {
      assembler.addSection('empty', '', 100);
      expect(assembler.sectionCount).toBe(0);
    });

    it('does not increment for whitespace-only content', () => {
      assembler.addSection('spaces', '   ', 100);
      assembler.addSection('newlines', '\n\n', 100);
      expect(assembler.sectionCount).toBe(0);
    });
  });

  // ── clear ─────────────────────────────────────────────────────

  describe('clear()', () => {
    it('resets sectionCount to zero', () => {
      assembler.addSection('a', 'hello', 10);
      assembler.addSection('b', 'world', 5);
      expect(assembler.sectionCount).toBe(2);

      assembler.clear();
      expect(assembler.sectionCount).toBe(0);
    });

    it('assemble() returns empty string after clear', () => {
      assembler.addSection('a', 'hello', 10);
      assembler.clear();
      expect(assembler.assemble(1000)).toBe('');
    });
  });

  // ── assemble — empty ──────────────────────────────────────────

  describe('assemble() with no sections', () => {
    it('returns empty string', () => {
      expect(assembler.assemble(10000)).toBe('');
    });
  });

  // ── priority ordering ─────────────────────────────────────────

  describe('priority ordering', () => {
    it('places higher-priority section before lower-priority section', () => {
      assembler.addSection('low', 'LOW_CONTENT', PRIORITY_ANALYSIS);
      assembler.addSection('high', 'HIGH_CONTENT', PRIORITY_IDENTITY);

      const result = assembler.assemble(100000);
      expect(result.indexOf('HIGH_CONTENT')).toBeLessThan(result.indexOf('LOW_CONTENT'));
    });

    it('preserves insertion order when priorities are equal', () => {
      assembler.addSection('first', 'FIRST', 50);
      assembler.addSection('second', 'SECOND', 50);

      const result = assembler.assemble(100000);
      // Both should be present
      expect(result).toContain('FIRST');
      expect(result).toContain('SECOND');
    });

    it('sorts multiple sections by priority descending', () => {
      assembler.addSection('analysis', 'ANALYSIS', PRIORITY_ANALYSIS);
      assembler.addSection('memory', 'MEMORY', PRIORITY_MEMORY);
      assembler.addSection('identity', 'IDENTITY', PRIORITY_IDENTITY);
      assembler.addSection('history', 'HISTORY', PRIORITY_HISTORY);

      const result = assembler.assemble(100000);
      const idxIdentity = result.indexOf('IDENTITY');
      const idxMemory = result.indexOf('MEMORY');
      const idxHistory = result.indexOf('HISTORY');
      const idxAnalysis = result.indexOf('ANALYSIS');

      expect(idxIdentity).toBeLessThan(idxMemory);
      expect(idxMemory).toBeLessThan(idxHistory);
      expect(idxHistory).toBeLessThan(idxAnalysis);
    });
  });

  // ── budget enforcement ────────────────────────────────────────

  describe('budget enforcement', () => {
    it('truncates a single oversized section to fit within budget', () => {
      // Single section — no separator, so result.length === budget exactly
      assembler.addSection('big', 'A'.repeat(1000), 100);

      const budget = 600;
      const result = assembler.assemble(budget);
      expect(result.length).toBeLessThanOrEqual(budget);
    });

    it('includes all sections when they fit within budget', () => {
      assembler.addSection('a', 'AAAA', 100);
      assembler.addSection('b', 'BBBB', 50);

      const result = assembler.assemble(10000);
      expect(result).toContain('AAAA');
      expect(result).toContain('BBBB');
    });

    it('joins sections with double newline separator', () => {
      assembler.addSection('a', 'FIRST', 100);
      assembler.addSection('b', 'SECOND', 50);

      const result = assembler.assemble(10000);
      expect(result).toBe('FIRST\n\nSECOND');
    });

    it('single section fits exactly at budget boundary', () => {
      const content = 'X'.repeat(100);
      assembler.addSection('exact', content, 100);

      const result = assembler.assemble(100);
      expect(result).toBe(content);
      expect(result.length).toBe(100);
    });
  });

  // ── section truncation ────────────────────────────────────────

  describe('section truncation', () => {
    it('truncates a single section that exceeds budget', () => {
      const content = 'A'.repeat(200);
      assembler.addSection('large', content, 100);

      const result = assembler.assemble(50);
      expect(result).toBe('A'.repeat(50));
      expect(result.length).toBe(50);
    });

    it('logs a warning when a section is truncated by budget', () => {
      assembler.addSection('big', 'X'.repeat(100), 50);
      assembler.assemble(30);

      expect(mockWarn).toHaveBeenCalled();
      const calls = mockWarn.mock.calls as unknown[][];
      const truncatedCall = calls.find((args) => {
        const obj = args[0] as Record<string, unknown>;
        return Array.isArray(obj.truncated);
      });
      expect(truncatedCall).toBeDefined();
    });

    it('truncates low-priority section when high-priority fills budget', () => {
      const highContent = 'H'.repeat(80);
      const lowContent = 'L'.repeat(80);
      assembler.addSection('high', highContent, PRIORITY_IDENTITY);
      assembler.addSection('low', lowContent, PRIORITY_ANALYSIS);

      const result = assembler.assemble(100);
      // High-priority section takes 80 chars, leaving 20 for low
      expect(result).toContain(highContent);
      expect(result).toContain('L'.repeat(20));
      expect(result).not.toContain(lowContent); // low is truncated, not full
    });
  });

  // ── section dropping ──────────────────────────────────────────

  describe('section dropping', () => {
    it('drops low-priority sections when budget is exhausted', () => {
      assembler.addSection('high', 'H'.repeat(100), PRIORITY_IDENTITY);
      assembler.addSection('low', 'LOW_DROPPED', PRIORITY_ANALYSIS);

      const result = assembler.assemble(100);
      expect(result).not.toContain('LOW_DROPPED');
    });

    it('logs a warning when sections are dropped', () => {
      assembler.addSection('high', 'H'.repeat(100), PRIORITY_IDENTITY);
      assembler.addSection('low', 'LOW_CONTENT', PRIORITY_ANALYSIS);
      assembler.assemble(100);

      expect(mockWarn).toHaveBeenCalled();
      const calls = mockWarn.mock.calls as unknown[][];
      const droppedCall = calls.find((args) => {
        const obj = args[0] as Record<string, unknown>;
        return Array.isArray(obj.dropped);
      });
      expect(droppedCall).toBeDefined();
    });

    it('drops all sections when budget is zero', () => {
      assembler.addSection('a', 'AAA', 100);
      assembler.addSection('b', 'BBB', 50);

      const result = assembler.assemble(0);
      expect(result).toBe('');
    });

    it('logs dropped warning for zero-budget assembly', () => {
      assembler.addSection('a', 'AAA', 100);
      assembler.assemble(0);

      const calls = mockWarn.mock.calls as unknown[][];
      const droppedCall = calls.find((args) => {
        const obj = args[0] as Record<string, unknown>;
        return Array.isArray(obj.dropped);
      });
      expect(droppedCall).toBeDefined();
    });
  });

  // ── per-section maxChars cap ──────────────────────────────────

  describe('per-section maxChars', () => {
    it('caps content to maxChars before budget check', () => {
      const content = 'C'.repeat(200);
      assembler.addSection('capped', content, 100, 50);

      const result = assembler.assemble(10000);
      expect(result).toBe('C'.repeat(50));
    });

    it('logs a truncation warning when maxChars cap is applied', () => {
      assembler.addSection('capped', 'X'.repeat(200), 100, 50);
      assembler.assemble(10000);

      const calls = mockWarn.mock.calls as unknown[][];
      const truncatedCall = calls.find((args) => {
        const obj = args[0] as Record<string, unknown>;
        return Array.isArray(obj.truncated);
      });
      expect(truncatedCall).toBeDefined();
    });

    it('does not apply maxChars when content is shorter', () => {
      const content = 'SHORT';
      assembler.addSection('short', content, 100, 1000);

      const result = assembler.assemble(10000);
      expect(result).toBe(content);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('applies maxChars then further truncates to budget', () => {
      // maxChars=60 caps to 60, then budget=30 truncates to 30
      assembler.addSection('double-truncate', 'D'.repeat(100), 100, 60);
      const result = assembler.assemble(30);
      expect(result).toBe('D'.repeat(30));
    });
  });

  // ── no warnings when everything fits ─────────────────────────

  describe('no spurious warnings', () => {
    it('emits no warnings when all sections fit within budget', () => {
      assembler.addSection('a', 'hello', 100);
      assembler.addSection('b', 'world', 50);
      assembler.assemble(1000);

      expect(mockWarn).not.toHaveBeenCalled();
    });
  });

  // ── large section budget — OB-F216 regression ─────────────────

  describe('large section budget — OB-F216 regression', () => {
    it('120K PRIORITY_IDENTITY section survives total budget assembly of 200K', () => {
      // The system prompt fix (OB-F216) raised the per-section cap to 120K+.
      // A 120K IDENTITY section must survive intact in a 200K total budget.
      const identityContent = 'I'.repeat(120_000);
      assembler.addSection('System Prompt', identityContent, PRIORITY_IDENTITY);

      const result = assembler.assemble(200_000);

      expect(result).toBe(identityContent);
      expect(result.length).toBe(120_000);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('120K PRIORITY_IDENTITY section present when lower-priority sections also added', () => {
      const identityContent = 'I'.repeat(120_000);
      const memoryContent = 'M'.repeat(4_000);
      const analysisContent = 'A'.repeat(5_000);

      assembler.addSection('System Prompt', identityContent, PRIORITY_IDENTITY);
      assembler.addSection('Memory', memoryContent, PRIORITY_MEMORY);
      assembler.addSection('Analysis', analysisContent, PRIORITY_ANALYSIS);

      // 120K + 4K + 5K = 129K — fits within 200K budget
      const result = assembler.assemble(200_000);

      expect(result).toContain(identityContent);
      expect(result).toContain(memoryContent);
      expect(result).toContain(analysisContent);
      expect(mockWarn).not.toHaveBeenCalled();
    });

    it('drops lower-priority sections first when total budget is exceeded by large IDENTITY section', () => {
      // IDENTITY = 180K, WORKSPACE = 20K, ANALYSIS = 50K
      // Budget = 200K — IDENTITY (180K) + WORKSPACE (20K) = 200K exactly; ANALYSIS dropped
      const identityContent = 'I'.repeat(180_000);
      const workspaceContent = 'W'.repeat(20_000);
      const analysisContent = 'ANALYSIS_DROPPED';

      assembler.addSection('System Prompt', identityContent, PRIORITY_IDENTITY);
      assembler.addSection('Workspace', workspaceContent, PRIORITY_WORKSPACE);
      assembler.addSection('Analysis', analysisContent, PRIORITY_ANALYSIS);

      const result = assembler.assemble(200_000);

      // High-priority sections included
      expect(result).toContain(identityContent);
      // ANALYSIS is the lowest priority — must be dropped (no budget left after IDENTITY + WORKSPACE)
      expect(result).not.toContain('ANALYSIS_DROPPED');

      // A drop warning must fire
      const warnCalls = mockWarn.mock.calls as unknown[][];
      const droppedWarning = warnCalls.find((args) => {
        const obj = args[0] as Record<string, unknown>;
        return Array.isArray(obj.dropped);
      });
      expect(droppedWarning).toBeDefined();
    });

    it('emits no truncation warning when 120K IDENTITY section fits within 200K budget', () => {
      assembler.addSection('System Prompt', 'I'.repeat(120_000), PRIORITY_IDENTITY);
      assembler.assemble(200_000);

      const warnCalls = mockWarn.mock.calls as unknown[][];
      const truncationWarning = warnCalls.find((args) => {
        const obj = args[0] as Record<string, unknown>;
        return Array.isArray(obj.truncated);
      });
      expect(truncationWarning).toBeUndefined();
    });
  });
});
