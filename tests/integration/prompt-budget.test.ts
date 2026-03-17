/**
 * Integration tests for the full prompt assembly pipeline.
 * Regression test for OB-F216 (system prompt budget truncation).
 *
 * Phase 160 — Integration Tests for Remote Deploy Flow (OB-1638)
 *
 * Verifies that:
 * - generateMasterSystemPrompt() produces a prompt > 8K (the old hard cap)
 * - The SHARE routing table and APP server docs are present in the full prompt
 * - After assembly with Sonnet budget (200K), those sections survive (not truncated)
 * - The old 8K cap would have truncated those sections (proving the fix was needed)
 */

import { describe, it, expect } from 'vitest';
import {
  generateMasterSystemPrompt,
  type MasterSystemPromptContext,
} from '../../src/master/master-system-prompt.js';
import { PromptAssembler, PRIORITY_IDENTITY } from '../../src/core/prompt-assembler.js';

// ---------------------------------------------------------------------------
// Minimal context for generating the Master system prompt in tests.
// Only required fields are set; optional fields are omitted.
// ---------------------------------------------------------------------------

const minimalContext: MasterSystemPromptContext = {
  workspacePath: '/tmp/test-workspace',
  masterToolName: 'claude',
  discoveredTools: [
    {
      name: 'claude',
      path: '/usr/local/bin/claude',
      version: '1.0.0',
      capabilities: ['read', 'write', 'execute'],
      role: 'master',
      available: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// OB-1638: Full prompt assembly pipeline regression tests
// ---------------------------------------------------------------------------

describe('OB-1638 — Prompt assembly pipeline: SHARE routing + APP docs survive Sonnet budget', () => {
  it('generated system prompt is larger than the old 8K hard cap (OB-F216 regression guard)', () => {
    const prompt = generateMasterSystemPrompt(minimalContext);

    // The old SECTION_BUDGET_SYSTEM_PROMPT = 8_000 would have truncated this.
    // The fix raised it to model-aware budget (min(adapterBudget * 0.6, 200K)).
    expect(prompt.length).toBeGreaterThan(8_000);
  });

  it('generated system prompt contains the SHARE routing table', () => {
    const prompt = generateMasterSystemPrompt(minimalContext);

    // "Smart Output Router" section header
    expect(prompt).toContain('## Smart Output Router');
    // Routing table row for raw data / structured exports
    expect(prompt).toContain('| Raw data, records, structured export |');
    // SHARE delivery targets referenced in routing examples
    expect(prompt).toContain('SHARE:whatsapp');
    expect(prompt).toContain('SHARE:telegram');
    expect(prompt).toContain('SHARE:github-pages');
  });

  it('generated system prompt contains the APP server docs', () => {
    const prompt = generateMasterSystemPrompt(minimalContext);

    // "Ephemeral App Server" section header
    expect(prompt).toContain('## Ephemeral App Server');
    // APP marker syntax
    expect(prompt).toContain('APP:start');
    expect(prompt).toContain('APP:stop');
  });

  it('SHARE routing table survives assembly with Sonnet budget (200K)', () => {
    const prompt = generateMasterSystemPrompt(minimalContext);

    // Simulate what buildMasterSpawnOptions() does with Sonnet/Opus adapter (800K budget):
    // systemPromptBudget = Math.min(800_000 * 0.6, 200_000) = 200_000
    const systemPromptBudget = Math.min(800_000 * 0.6, 200_000);
    const assembler = new PromptAssembler();
    assembler.addSection('System Prompt', prompt, PRIORITY_IDENTITY, systemPromptBudget);
    const assembled = assembler.assemble(systemPromptBudget);

    // SHARE routing table must be present after assembly — not truncated
    expect(assembled).toContain('## Smart Output Router');
    expect(assembled).toContain('| Raw data, records, structured export |');
    expect(assembled).toContain('SHARE:whatsapp');
    expect(assembled).toContain('SHARE:github-pages');
  });

  it('APP server docs survive assembly with Sonnet budget (200K)', () => {
    const prompt = generateMasterSystemPrompt(minimalContext);

    // Same Sonnet budget as above
    const systemPromptBudget = Math.min(800_000 * 0.6, 200_000);
    const assembler = new PromptAssembler();
    assembler.addSection('System Prompt', prompt, PRIORITY_IDENTITY, systemPromptBudget);
    const assembled = assembler.assemble(systemPromptBudget);

    // APP server docs must be present after assembly — not truncated
    expect(assembled).toContain('## Ephemeral App Server');
    expect(assembled).toContain('APP:start');
  });

  it('regression: old 8K cap would have truncated the SHARE routing table (OB-F216)', () => {
    const prompt = generateMasterSystemPrompt(minimalContext);

    // Reproduce the old bug: SECTION_BUDGET_SYSTEM_PROMPT was 8_000
    const OLD_SECTION_BUDGET = 8_000;
    const assembler = new PromptAssembler();
    assembler.addSection('System Prompt', prompt, PRIORITY_IDENTITY, OLD_SECTION_BUDGET);
    const assembled = assembler.assemble(OLD_SECTION_BUDGET);

    // With the old 8K cap, the SHARE routing table section (which appears later in the
    // prompt, past the 8K mark) would NOT be in the assembled output.
    // This confirms the fix was necessary.
    expect(assembled).not.toContain('## Smart Output Router');
  });

  it('SHARE routing table and APP docs survive assembly with Haiku budget (108K)', () => {
    const prompt = generateMasterSystemPrompt(minimalContext);

    // Haiku adapter: 180K budget → systemPromptBudget = Math.min(180_000 * 0.6, 200_000) = 108_000
    const systemPromptBudget = Math.min(180_000 * 0.6, 200_000);
    const assembler = new PromptAssembler();
    assembler.addSection('System Prompt', prompt, PRIORITY_IDENTITY, systemPromptBudget);
    const assembled = assembler.assemble(systemPromptBudget);

    // Both sections must be present even under Haiku's tighter budget
    expect(assembled).toContain('## Smart Output Router');
    expect(assembled).toContain('## Ephemeral App Server');
  });

  it('assembled prompt length equals system prompt length when it fits within budget', () => {
    const prompt = generateMasterSystemPrompt(minimalContext);

    // With a 200K budget and a ~49K prompt, the assembled output should equal the input
    const systemPromptBudget = 200_000;
    const assembler = new PromptAssembler();
    assembler.addSection('System Prompt', prompt, PRIORITY_IDENTITY, systemPromptBudget);
    const assembled = assembler.assemble(systemPromptBudget);

    // No truncation — assembled output is the full prompt
    expect(assembled.length).toBe(prompt.length);
  });
});
