/**
 * Model Selection Strategy
 *
 * Given a task description and tool profile, recommends a model.
 * Uses capability tiers (fast / balanced / powerful) resolved through
 * the ModelRegistry to stay provider-agnostic.
 *
 * Rules:
 * - read-only tasks → fast tier (exploration, information gathering)
 * - code-edit tasks → balanced tier (implementation, modification)
 * - complex reasoning → powerful tier (architecture, debugging, multi-step logic)
 *
 * The Master AI can call this or ignore it. An explicit model in the
 * TaskManifest always takes priority over the recommendation.
 */

import type { TaskManifest } from '../types/agent.js';
import type { MemoryManager } from '../memory/index.js';
import type { LearningEntry } from '../types/master.js';
import { createModelRegistry } from './model-registry.js';
import type { ModelTier, ModelRegistry } from './model-registry.js';
import { createLogger } from './logger.js';

const logger = createLogger('model-selector');

/** Lazily-created default registry (Claude) for backward compatibility */
let defaultRegistry: ModelRegistry | null = null;
function getDefaultRegistry(): ModelRegistry {
  if (!defaultRegistry) {
    defaultRegistry = createModelRegistry('claude');
  }
  return defaultRegistry;
}

/** Resolve a tier to a model ID, falling back through tiers if needed */
function resolveTier(tier: ModelTier, registry: ModelRegistry): string {
  const entry = registry.resolveWithFallback(tier);
  return entry?.id ?? tier;
}

/**
 * Keywords that signal complex reasoning (→ powerful tier).
 * Matched case-insensitively against the task description.
 */
const COMPLEX_KEYWORDS = [
  'architect',
  'debug',
  'refactor',
  'redesign',
  'optimize',
  'security',
  'vulnerability',
  'performance',
  'migration',
  'complex',
  'design',
  'strategy',
  'analyze',
  'investigate',
  'diagnose',
] as const;

/**
 * Keywords that signal code editing (→ balanced tier).
 * Matched case-insensitively against the task description.
 */
const CODE_EDIT_KEYWORDS = [
  'implement',
  'create',
  'add',
  'update',
  'modify',
  'fix',
  'write',
  'change',
  'build',
  'edit',
  'remove',
  'delete',
  'replace',
  'rename',
  'test',
] as const;

export interface ModelRecommendation {
  /** The recommended model ID (provider-specific, resolved from tier) */
  model: string;
  /** Why this model was chosen */
  reason: string;
}

/**
 * Recommend a model based on the tool profile name.
 *
 * - 'read-only'    → fast tier (cheap, fast)
 * - 'code-edit'    → balanced tier (implementation)
 * - 'full-access'  → balanced tier (capability, not complexity)
 * - unknown        → balanced tier (safe default)
 */
export function recommendByProfile(profile: string, registry?: ModelRegistry): ModelRecommendation {
  const reg = registry ?? getDefaultRegistry();

  switch (profile) {
    case 'read-only':
      return { model: resolveTier('fast', reg), reason: 'read-only profile — fast and cheap' };
    case 'code-edit':
      return {
        model: resolveTier('balanced', reg),
        reason: 'code-edit profile — balanced for implementation',
      };
    case 'full-access':
      return {
        model: resolveTier('balanced', reg),
        reason: 'full-access profile — balanced default',
      };
    default:
      return {
        model: resolveTier('balanced', reg),
        reason: `unknown profile "${profile}" — defaulting to balanced`,
      };
  }
}

/**
 * Recommend a model based on the task description.
 * Scans for keywords that indicate complexity level.
 *
 * - Complex reasoning keywords → powerful tier
 * - Code editing keywords → balanced tier
 * - Everything else (exploration, listing) → fast tier
 */
export function recommendByDescription(
  description: string,
  registry?: ModelRegistry,
): ModelRecommendation {
  const reg = registry ?? getDefaultRegistry();
  const lower = description.toLowerCase();

  for (const keyword of COMPLEX_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        model: resolveTier('powerful', reg),
        reason: `description contains "${keyword}" — complex reasoning`,
      };
    }
  }

  for (const keyword of CODE_EDIT_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        model: resolveTier('balanced', reg),
        reason: `description contains "${keyword}" — code editing`,
      };
    }
  }

  return { model: resolveTier('fast', reg), reason: 'no complexity signals — fast default' };
}

/** Minimum completed tasks required before trusting learning data. */
const MIN_TASKS_FOR_LEARNING = 5;

/**
 * Query the learnings store for the best model for a given task type.
 *
 * Returns a ModelRecommendation when the learnings table has at least
 * MIN_TASKS_FOR_LEARNING completed tasks for the given task type.
 * Returns null when there is insufficient data or on any error, so the
 * caller can fall back to heuristic selection.
 */
export async function getRecommendedModel(
  memory: MemoryManager,
  taskType: string,
): Promise<ModelRecommendation | null> {
  try {
    const learned = await memory.getLearnedParams(taskType);
    if (!learned || learned.total_tasks < MIN_TASKS_FOR_LEARNING) {
      logger.debug(
        { taskType, total_tasks: learned?.total_tasks ?? 0, min: MIN_TASKS_FOR_LEARNING },
        'Insufficient learning data — skipping adaptive model selection',
      );
      return null;
    }
    const successPct = (learned.success_rate * 100).toFixed(0);
    logger.debug(
      { taskType, model: learned.model, success_rate: learned.success_rate },
      'Adaptive model selected from learnings',
    );
    return {
      model: learned.model,
      reason: `learned: ${successPct}% success rate over ${learned.total_tasks} tasks`,
    };
  } catch {
    // No data or memory error — caller will use heuristic fallback
    return null;
  }
}

/**
 * Recommend a model based on historical learnings for a specific task type.
 * Requires 5+ entries for the task type and 3+ uses per model to be statistically meaningful.
 * Returns null if insufficient data — caller should fall back to heuristics.
 *
 * This function is already provider-agnostic: it picks the best model from
 * actual performance data regardless of provider.
 */
export function recommendFromLearnings(
  taskType: string,
  learnings: LearningEntry[],
): ModelRecommendation | null {
  const filtered = learnings.filter((e) => e.taskType === taskType && e.modelUsed);
  if (filtered.length < 5) return null;

  // Group by model and compute success rate
  const modelStats = new Map<string, { total: number; success: number }>();
  for (const entry of filtered) {
    const model = entry.modelUsed!;
    const stats = modelStats.get(model) ?? { total: 0, success: 0 };
    stats.total++;
    if (entry.success) stats.success++;
    modelStats.set(model, stats);
  }

  // Find the model with the highest success rate (min 3 uses)
  let bestModel: string | null = null;
  let bestRate = -1;
  for (const [model, stats] of modelStats) {
    if (stats.total < 3) continue;
    const rate = stats.success / stats.total;
    if (rate > bestRate) {
      bestRate = rate;
      bestModel = model;
    }
  }

  if (!bestModel) return null;

  const stats = modelStats.get(bestModel)!;
  const pct = ((stats.success / stats.total) * 100).toFixed(0);

  logger.debug(
    { taskType, model: bestModel, successRate: pct, sampleSize: stats.total },
    'Model recommended from learnings',
  );

  return {
    model: bestModel,
    reason: `historical performance for "${taskType}" tasks: ${pct}% success (${stats.total} samples)`,
  };
}

/**
 * Recommend a model for a TaskManifest.
 *
 * Priority:
 * 1. If `manifest.model` is set, return it as-is (explicit override wins)
 * 2. If learnings data is available, use data-driven recommendation
 * 3. If `manifest.profile` is set, use profile-based recommendation
 * 4. Fall back to description-based recommendation using the prompt
 *
 * Returns a ModelRecommendation. The caller decides whether to use it.
 */
export function recommendModel(
  manifest: TaskManifest,
  options?: {
    learnings?: LearningEntry[];
    taskType?: string;
    registry?: ModelRegistry;
  },
): ModelRecommendation {
  const registry = options?.registry;

  // Explicit model override — respect the caller's choice
  if (manifest.model) {
    logger.debug({ model: manifest.model }, 'Model explicitly set in manifest — using as-is');
    return {
      model: manifest.model,
      reason: 'explicitly set in manifest',
    };
  }

  // Data-driven recommendation from learnings
  if (options?.learnings && options.taskType) {
    const rec = recommendFromLearnings(options.taskType, options.learnings);
    if (rec) return rec;
  }

  // Profile-based recommendation
  if (manifest.profile) {
    const rec = recommendByProfile(manifest.profile, registry);
    logger.debug(
      { profile: manifest.profile, recommended: rec.model },
      'Model recommended by profile',
    );
    return rec;
  }

  // Description-based recommendation from the prompt
  const rec = recommendByDescription(manifest.prompt, registry);
  logger.debug({ recommended: rec.model, reason: rec.reason }, 'Model recommended by description');
  return rec;
}
