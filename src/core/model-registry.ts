/**
 * Model Registry — Provider-Agnostic Model Selection
 *
 * Maps abstract capability tiers (fast / balanced / powerful) to concrete
 * model IDs for whatever AI provider is active. This decouples the model
 * selection logic from any specific provider (Claude, Codex, Aider, etc.).
 *
 * Usage:
 *   const registry = new ModelRegistry();
 *   registry.registerProvider('claude');          // loads Claude defaults
 *   registry.resolve('fast');                     // → { id: 'haiku', tier: 'fast', provider: 'claude' }
 *   registry.resolveModelOrTier('balanced');      // → 'sonnet'
 *   registry.resolveModelOrTier('gpt-4o');        // → 'gpt-4o' (passthrough)
 */

import { createLogger } from './logger.js';

const logger = createLogger('model-registry');

// ── Types ───────────────────────────────────────────────────────

/** Capability tiers — provider-agnostic */
export type ModelTier = 'fast' | 'balanced' | 'powerful';

export const MODEL_TIERS: readonly ModelTier[] = ['fast', 'balanced', 'powerful'] as const;

/** A single model entry in a provider's model map */
export interface ModelEntry {
  /** Actual model ID passed to the CLI (e.g. 'haiku', 'codex-mini', 'gpt-4o-mini') */
  id: string;
  /** Capability tier this model maps to */
  tier: ModelTier;
  /** Provider name (e.g. 'claude', 'codex', 'aider') */
  provider: string;
  /** Model context window size in tokens (optional — Claude-specific) */
  contextTokens?: number;
  /** Maximum output tokens the model can produce (optional — Claude-specific) */
  maxOutputTokens?: number;
}

/** Tier-based fallback chain: powerful → balanced → fast → (none) */
export const TIER_FALLBACK: Record<ModelTier, ModelTier | undefined> = {
  powerful: 'balanced',
  balanced: 'fast',
  fast: undefined,
};

// ── Default Model Maps ──────────────────────────────────────────

/** Built-in model maps for known providers */
const DEFAULT_MODEL_MAPS: Record<string, ModelEntry[]> = {
  claude: [
    {
      id: 'haiku',
      tier: 'fast',
      provider: 'claude',
      contextTokens: 200_000,
      maxOutputTokens: 64_000,
    },
    {
      id: 'sonnet',
      tier: 'balanced',
      provider: 'claude',
      contextTokens: 1_000_000,
      maxOutputTokens: 64_000,
    },
    {
      id: 'opus',
      tier: 'powerful',
      provider: 'claude',
      contextTokens: 1_000_000,
      maxOutputTokens: 128_000,
    },
  ],
  codex: [
    // ChatGPT-account auth only supports gpt-5.2-codex (the default).
    // o3, o4-mini, codex-mini are rejected with "not supported when using Codex with a ChatGPT account".
    // All tiers map to the same model until Codex expands ChatGPT-auth model support.
    { id: 'gpt-5.2-codex', tier: 'fast', provider: 'codex' },
    { id: 'gpt-5.2-codex', tier: 'balanced', provider: 'codex' },
    // gpt-5.3-codex is 25% faster at the same pricing as gpt-5.2-codex.
    { id: 'gpt-5.3-codex', tier: 'powerful', provider: 'codex' },
  ],
  aider: [
    { id: 'gpt-4o-mini', tier: 'fast', provider: 'aider' },
    { id: 'gpt-4o', tier: 'balanced', provider: 'aider' },
    { id: 'o1', tier: 'powerful', provider: 'aider' },
  ],
};

// ── Registry ────────────────────────────────────────────────────

export class ModelRegistry {
  private models: ModelEntry[] = [];

  /**
   * Register a provider's models. If no custom entries are provided,
   * loads from the built-in defaults for the provider name.
   * Unknown providers with no custom entries result in an empty registry.
   */
  registerProvider(provider: string, models?: ModelEntry[]): void {
    const entries = models ?? DEFAULT_MODEL_MAPS[provider];

    if (!entries) {
      logger.warn({ provider }, 'No default model map for provider — registry will be empty');
      return;
    }

    // Remove any existing entries for this provider
    this.models = this.models.filter((m) => m.provider !== provider);
    this.models.push(...entries);

    logger.debug(
      { provider, modelCount: entries.length, models: entries.map((m) => m.id) },
      'Registered provider models',
    );
  }

  /**
   * Resolve a capability tier to a concrete model entry.
   * Returns the first matching entry, or undefined if no model is registered for that tier.
   */
  resolve(tier: ModelTier): ModelEntry | undefined {
    return this.models.find((m) => m.tier === tier);
  }

  /**
   * Resolve a string that could be either a tier name, a raw model ID, or a
   * foreign provider's model alias (e.g. "haiku" passed to a codex registry).
   *
   * Resolution order:
   * 1. Tier name ('fast', 'balanced', 'powerful') → resolve to this provider's model
   * 2. Known model from another provider → translate to equivalent tier's model
   * 3. Unknown string → pass through as-is (backward compat)
   */
  resolveModelOrTier(value: string): string {
    // 1. Tier names resolve directly
    if (MODEL_TIERS.includes(value as ModelTier)) {
      const entry = this.resolve(value as ModelTier);
      return entry?.id ?? value;
    }

    // 2. If this model belongs to the current provider, pass through
    if (this.models.some((m) => m.id === value)) {
      return value;
    }

    // 3. Check if it's a known model from another provider — translate via tier
    const foreignEntry = findForeignModel(value);
    if (foreignEntry) {
      const localEntry = this.resolve(foreignEntry.tier);
      if (localEntry) {
        logger.debug(
          { from: value, to: localEntry.id, tier: foreignEntry.tier },
          'Cross-provider model translation',
        );
        return localEntry.id;
      }
    }

    // 4. Unknown — pass through as-is
    return value;
  }

  /**
   * Get the fallback model for a given model ID.
   * Finds the model's tier, then looks up the next tier in the fallback chain.
   * Returns undefined if no fallback exists (fast tier) or model is unknown.
   */
  getFallback(modelId: string): string | undefined {
    const entry = this.models.find((m) => m.id === modelId);
    if (!entry) return undefined;

    const nextTier = TIER_FALLBACK[entry.tier];
    if (!nextTier) return undefined;

    const fallback = this.resolve(nextTier);
    return fallback?.id;
  }

  /**
   * Check if a model string is valid (known in the registry).
   */
  isValid(model: string): boolean {
    // Tier names are always valid
    if (MODEL_TIERS.includes(model as ModelTier)) return true;
    // Check against registered models
    return this.models.some((m) => m.id === model);
  }

  /** Get all registered model entries */
  getAll(): ModelEntry[] {
    return [...this.models];
  }

  /** Get the model entry for a specific tier, with tier fallback if not found */
  resolveWithFallback(tier: ModelTier): ModelEntry | undefined {
    const entry = this.resolve(tier);
    if (entry) return entry;

    const nextTier = TIER_FALLBACK[tier];
    if (!nextTier) return undefined;

    return this.resolveWithFallback(nextTier);
  }
}

/**
 * Look up a model ID across all known providers' default model maps.
 * Returns the matching entry (with tier info) if found, undefined otherwise.
 */
function findForeignModel(modelId: string): ModelEntry | undefined {
  for (const entries of Object.values(DEFAULT_MODEL_MAPS)) {
    const entry = entries.find((m) => m.id === modelId);
    if (entry) return entry;
  }
  return undefined;
}

/**
 * Create a ModelRegistry pre-loaded with a provider's defaults.
 * Convenience factory for the common case.
 */
export function createModelRegistry(provider: string, customModels?: ModelEntry[]): ModelRegistry {
  const registry = new ModelRegistry();
  registry.registerProvider(provider, customModels);
  return registry;
}
