/**
 * Unit tests for cost estimation in cost-manager.ts (OB-1624).
 *
 * Verifies that:
 *  1. Codex/OpenAI models use 2.5x higher per-token pricing than Sonnet
 *  2. Claude models (Haiku, Sonnet, Opus) use their correct pricing tiers
 *  3. Unknown models fall back to Sonnet pricing
 */

import { describe, it, expect } from 'vitest';
import { estimateCostUsd } from '../../src/core/cost-manager.js';

describe('estimateCostUsd — cost estimation', () => {
  it('gpt-5.2-codex with 30KB output uses Codex pricing (~$0.303)', () => {
    // Codex pricing: 0.008 + 30 * 0.0096 = 0.008 + 0.288 = 0.296 ≈ $0.303
    const cost = estimateCostUsd('gpt-5.2-codex', 30720);
    expect(cost).toBeGreaterThan(0.29);
    expect(cost).toBeLessThan(0.31);
  });

  it('gpt-4o with 10KB output uses Codex pricing (~$0.104)', () => {
    // Codex pricing: 0.008 + 10 * 0.0096 = 0.008 + 0.096 = 0.104
    const cost = estimateCostUsd('gpt-4o', 10240);
    expect(cost).toBeGreaterThan(0.1);
    expect(cost).toBeLessThan(0.11);
  });

  it('sonnet with 30KB output uses Sonnet pricing (~$0.121)', () => {
    // Sonnet pricing: 0.003 + 30 * 0.00384 = 0.003 + 0.1152 = 0.1182
    const cost = estimateCostUsd('sonnet', 30720);
    expect(cost).toBeGreaterThan(0.11);
    expect(cost).toBeLessThan(0.13);
  });

  it('haiku with 10KB output uses Haiku pricing (~$0.014)', () => {
    // Haiku pricing: 0.001 + 10 * 0.00128 = 0.001 + 0.0128 = 0.0138
    const cost = estimateCostUsd('haiku', 10240);
    expect(cost).toBeGreaterThan(0.013);
    expect(cost).toBeLessThan(0.015);
  });

  it('claude-opus-4-6 with 20KB output uses Opus pricing (~$0.141)', () => {
    // Opus pricing: 0.005 + 20 * 0.0064 = 0.005 + 0.128 = 0.133 ≈ $0.141
    const cost = estimateCostUsd('claude-opus-4-6', 20480);
    expect(cost).toBeGreaterThan(0.13);
    expect(cost).toBeLessThan(0.15);
  });

  it('claude-sonnet-4-6 with 5KB output uses Sonnet pricing (~$0.022)', () => {
    // Sonnet pricing: 0.003 + 5 * 0.00384 = 0.003 + 0.0192 = 0.0222
    const cost = estimateCostUsd('claude-sonnet-4-6', 5120);
    expect(cost).toBeGreaterThan(0.02);
    expect(cost).toBeLessThan(0.025);
  });

  it('claude-haiku-4-5 with 0KB output returns base cost (~$0.001)', () => {
    // Haiku pricing: 0.001 + 0 * 0.00128 = 0.001
    const cost = estimateCostUsd('claude-haiku-4-5-20251001', 0);
    expect(cost).toBe(0.001);
  });

  it('unknown model falls back to Sonnet pricing', () => {
    const unknownCost = estimateCostUsd('some-unknown-model', 10240);
    const sonnetCost = estimateCostUsd('claude-sonnet-4-6', 10240);
    expect(unknownCost).toBe(sonnetCost);
  });

  it('undefined model falls back to Sonnet pricing', () => {
    const undefinedCost = estimateCostUsd(undefined, 10240);
    const sonnetCost = estimateCostUsd('claude-sonnet-4-6', 10240);
    expect(undefinedCost).toBe(sonnetCost);
  });

  it('codex model name variants all use Codex pricing', () => {
    const cost1 = estimateCostUsd('gpt-5.2', 10240);
    const cost2 = estimateCostUsd('gpt-5.3', 10240);
    const cost3 = estimateCostUsd('codex-model', 10240);
    const codexCost = estimateCostUsd('gpt-4o', 10240);

    // All should be approximately the same (Codex pricing)
    expect(cost1).toBeCloseTo(codexCost, 5);
    expect(cost2).toBeCloseTo(codexCost, 5);
    expect(cost3).toBeCloseTo(codexCost, 5);
  });

  it('case-insensitive model matching', () => {
    const upperCost = estimateCostUsd('GPT-5.2-CODEX', 10240);
    const lowerCost = estimateCostUsd('gpt-5.2-codex', 10240);
    const mixedCost = estimateCostUsd('Gpt-5.2-Codex', 10240);

    expect(upperCost).toBe(lowerCost);
    expect(mixedCost).toBe(lowerCost);
  });
});
