import { describe, it, expect } from 'vitest';
import {
  ModelRegistry,
  createModelRegistry,
  MODEL_TIERS,
  TIER_FALLBACK,
} from '../../src/core/model-registry.js';
import type { ModelEntry } from '../../src/core/model-registry.js';

// ── ModelRegistry basics ────────────────────────────────────────

describe('ModelRegistry', () => {
  describe('registerProvider', () => {
    it('loads Claude defaults by provider name', () => {
      const registry = new ModelRegistry();
      registry.registerProvider('claude');

      const all = registry.getAll();
      expect(all).toHaveLength(3);
      expect(all.map((m) => m.id)).toEqual(['haiku', 'sonnet', 'opus']);
    });

    it('loads Codex defaults by provider name', () => {
      const registry = new ModelRegistry();
      registry.registerProvider('codex');

      const all = registry.getAll();
      expect(all).toHaveLength(3);
      expect(all.map((m) => m.id)).toContain('codex-mini');
    });

    it('loads Aider defaults by provider name', () => {
      const registry = new ModelRegistry();
      registry.registerProvider('aider');

      const all = registry.getAll();
      expect(all.map((m) => m.id)).toContain('gpt-4o-mini');
      expect(all.map((m) => m.id)).toContain('gpt-4o');
      expect(all.map((m) => m.id)).toContain('o1');
    });

    it('accepts custom model entries instead of defaults', () => {
      const custom: ModelEntry[] = [
        { id: 'my-fast-model', tier: 'fast', provider: 'custom' },
        { id: 'my-big-model', tier: 'powerful', provider: 'custom' },
      ];
      const registry = new ModelRegistry();
      registry.registerProvider('custom', custom);

      expect(registry.getAll()).toHaveLength(2);
      expect(registry.resolve('fast')?.id).toBe('my-fast-model');
      expect(registry.resolve('powerful')?.id).toBe('my-big-model');
    });

    it('does nothing for unknown provider with no custom entries', () => {
      const registry = new ModelRegistry();
      registry.registerProvider('unknown-provider');

      expect(registry.getAll()).toHaveLength(0);
    });

    it('replaces existing entries when re-registering a provider', () => {
      const registry = new ModelRegistry();
      registry.registerProvider('claude');
      expect(registry.resolve('fast')?.id).toBe('haiku');

      // Re-register with different models
      registry.registerProvider('claude', [
        { id: 'claude-flash', tier: 'fast', provider: 'claude' },
      ]);
      expect(registry.resolve('fast')?.id).toBe('claude-flash');
      expect(registry.getAll()).toHaveLength(1);
    });
  });

  // ── resolve ─────────────────────────────────────────────────

  describe('resolve', () => {
    it('resolves each tier to the correct model', () => {
      const registry = createModelRegistry('claude');

      expect(registry.resolve('fast')?.id).toBe('haiku');
      expect(registry.resolve('balanced')?.id).toBe('sonnet');
      expect(registry.resolve('powerful')?.id).toBe('opus');
    });

    it('returns undefined for unregistered tier', () => {
      const registry = new ModelRegistry();
      registry.registerProvider('custom', [{ id: 'only-fast', tier: 'fast', provider: 'custom' }]);

      expect(registry.resolve('powerful')).toBeUndefined();
    });
  });

  // ── resolveModelOrTier ──────────────────────────────────────

  describe('resolveModelOrTier', () => {
    it('resolves tier names to model IDs', () => {
      const registry = createModelRegistry('claude');

      expect(registry.resolveModelOrTier('fast')).toBe('haiku');
      expect(registry.resolveModelOrTier('balanced')).toBe('sonnet');
      expect(registry.resolveModelOrTier('powerful')).toBe('opus');
    });

    it('passes through own-provider and unknown model IDs unchanged', () => {
      const registry = createModelRegistry('claude');

      // Own-provider models stay unchanged
      expect(registry.resolveModelOrTier('haiku')).toBe('haiku');
      // Fully-qualified / unknown IDs pass through
      expect(registry.resolveModelOrTier('claude-sonnet-4-5-20250929')).toBe(
        'claude-sonnet-4-5-20250929',
      );
    });

    it('translates foreign provider models to equivalent tier', () => {
      const registry = createModelRegistry('claude');

      // gpt-4o is aider's "balanced" → claude's balanced is "sonnet"
      expect(registry.resolveModelOrTier('gpt-4o')).toBe('sonnet');
      // codex-mini is codex's "fast" → claude's fast is "haiku"
      expect(registry.resolveModelOrTier('codex-mini')).toBe('haiku');
    });

    it('returns tier name if no model registered for that tier', () => {
      const registry = new ModelRegistry();
      // Empty registry — no models registered
      expect(registry.resolveModelOrTier('fast')).toBe('fast');
    });
  });

  // ── getFallback ─────────────────────────────────────────────

  describe('getFallback', () => {
    it('follows tier fallback chain: powerful → balanced → fast → none', () => {
      const registry = createModelRegistry('claude');

      expect(registry.getFallback('opus')).toBe('sonnet'); // powerful → balanced
      expect(registry.getFallback('sonnet')).toBe('haiku'); // balanced → fast
      expect(registry.getFallback('haiku')).toBeUndefined(); // fast → none
    });

    it('works with non-Claude providers', () => {
      const registry = createModelRegistry('codex');

      expect(registry.getFallback('codex')).toBe('codex-mini'); // balanced → fast
      expect(registry.getFallback('codex-mini')).toBeUndefined(); // fast → none
    });

    it('returns undefined for unknown model IDs', () => {
      const registry = createModelRegistry('claude');
      expect(registry.getFallback('gpt-4o')).toBeUndefined();
    });
  });

  // ── isValid ─────────────────────────────────────────────────

  describe('isValid', () => {
    it('accepts tier names', () => {
      const registry = new ModelRegistry();
      expect(registry.isValid('fast')).toBe(true);
      expect(registry.isValid('balanced')).toBe(true);
      expect(registry.isValid('powerful')).toBe(true);
    });

    it('accepts registered model IDs', () => {
      const registry = createModelRegistry('claude');
      expect(registry.isValid('haiku')).toBe(true);
      expect(registry.isValid('sonnet')).toBe(true);
      expect(registry.isValid('opus')).toBe(true);
    });

    it('rejects unknown model IDs', () => {
      const registry = createModelRegistry('claude');
      expect(registry.isValid('gpt-4o')).toBe(false);
    });
  });

  // ── resolveWithFallback ─────────────────────────────────────

  describe('resolveWithFallback', () => {
    it('returns the entry for the requested tier if available', () => {
      const registry = createModelRegistry('claude');
      expect(registry.resolveWithFallback('powerful')?.id).toBe('opus');
    });

    it('falls back to a lower tier if requested tier is not available', () => {
      const registry = new ModelRegistry();
      registry.registerProvider('minimal', [
        { id: 'small-model', tier: 'fast', provider: 'minimal' },
      ]);

      // No 'powerful' or 'balanced' → falls back to fast
      expect(registry.resolveWithFallback('powerful')?.id).toBe('small-model');
      expect(registry.resolveWithFallback('balanced')?.id).toBe('small-model');
    });

    it('returns undefined if no tiers available at all', () => {
      const registry = new ModelRegistry();
      expect(registry.resolveWithFallback('fast')).toBeUndefined();
    });
  });
});

// ── createModelRegistry factory ─────────────────────────────────

describe('createModelRegistry', () => {
  it('returns a pre-loaded registry', () => {
    const registry = createModelRegistry('claude');
    expect(registry.getAll()).toHaveLength(3);
    expect(registry.resolve('fast')?.id).toBe('haiku');
  });

  it('accepts custom models as override', () => {
    const registry = createModelRegistry('my-provider', [
      { id: 'alpha', tier: 'fast', provider: 'my-provider' },
      { id: 'omega', tier: 'powerful', provider: 'my-provider' },
    ]);
    expect(registry.resolve('fast')?.id).toBe('alpha');
    expect(registry.resolve('powerful')?.id).toBe('omega');
    expect(registry.resolve('balanced')).toBeUndefined();
  });
});

// ── Constants ───────────────────────────────────────────────────

describe('Constants', () => {
  it('MODEL_TIERS contains all three tiers', () => {
    expect(MODEL_TIERS).toEqual(['fast', 'balanced', 'powerful']);
  });

  it('TIER_FALLBACK chain is correct', () => {
    expect(TIER_FALLBACK.powerful).toBe('balanced');
    expect(TIER_FALLBACK.balanced).toBe('fast');
    expect(TIER_FALLBACK.fast).toBeUndefined();
  });
});
