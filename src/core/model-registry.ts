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
    { id: 'haiku', tier: 'fast', provider: 'claude' },
    { id: 'sonnet', tier: 'balanced', provider: 'claude' },
    { id: 'opus', tier: 'powerful', provider: 'claude' },
  ],
  codex: [
    { id: 'codex-mini', tier: 'fast', provider: 'codex' },
    { id: 'codex', tier: 'balanced', provider: 'codex' },
    { id: 'codex', tier: 'powerful', provider: 'codex' },
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
   * Resolve a string that could be either a tier name or a raw model ID.
   * - If the value matches a tier name ('fast', 'balanced', 'powerful'), resolves to the model ID
   * - Otherwise, passes the value through as-is (backward compatibility with raw model IDs)
   */
  resolveModelOrTier(value: string): string {
    if (MODEL_TIERS.includes(value as ModelTier)) {
      const entry = this.resolve(value as ModelTier);
      return entry?.id ?? value;
    }
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
 * Create a ModelRegistry pre-loaded with a provider's defaults.
 * Convenience factory for the common case.
 */
export function createModelRegistry(provider: string, customModels?: ModelEntry[]): ModelRegistry {
  const registry = new ModelRegistry();
  registry.registerProvider(provider, customModels);
  return registry;
}
