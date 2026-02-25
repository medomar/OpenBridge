/**
 * Model Selection Strategy
 *
 * Given a task description and tool profile, recommends a model.
 *
 * Rules:
 * - read-only tasks → haiku (fast, cheap — exploration, information gathering)
 * - code-edit tasks → sonnet (balanced — implementation, modification)
 * - complex reasoning → opus (best — architecture, debugging, multi-step logic)
 *
 * The Master AI can call this or ignore it. An explicit model in the
 * TaskManifest always takes priority over the recommendation.
 */

import type { ModelAlias } from './agent-runner.js';
import type { TaskManifest } from '../types/agent.js';
import type { MemoryManager } from '../memory/index.js';
import { createLogger } from './logger.js';

const logger = createLogger('model-selector');

/**
 * Keywords that signal complex reasoning (→ opus).
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
 * Keywords that signal code editing (→ sonnet).
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
  /** The recommended model alias */
  model: ModelAlias;
  /** Why this model was chosen */
  reason: string;
}

/**
 * Recommend a model based on the tool profile name.
 *
 * - 'read-only'    → haiku (fast, cheap)
 * - 'code-edit'    → sonnet (balanced)
 * - 'full-access'  → sonnet (balanced — full-access is a capability, not complexity)
 * - unknown        → sonnet (safe default)
 */
export function recommendByProfile(profile: string): ModelRecommendation {
  switch (profile) {
    case 'read-only':
      return { model: 'haiku', reason: 'read-only profile — fast and cheap' };
    case 'code-edit':
      return { model: 'sonnet', reason: 'code-edit profile — balanced for implementation' };
    case 'full-access':
      return { model: 'sonnet', reason: 'full-access profile — balanced default' };
    default:
      return { model: 'sonnet', reason: `unknown profile "${profile}" — defaulting to balanced` };
  }
}

/**
 * Recommend a model based on the task description.
 * Scans for keywords that indicate complexity level.
 *
 * - Complex reasoning keywords → opus
 * - Code editing keywords → sonnet
 * - Everything else (exploration, listing) → haiku
 */
export function recommendByDescription(description: string): ModelRecommendation {
  const lower = description.toLowerCase();

  for (const keyword of COMPLEX_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        model: 'opus',
        reason: `description contains "${keyword}" — complex reasoning`,
      };
    }
  }

  for (const keyword of CODE_EDIT_KEYWORDS) {
    if (lower.includes(keyword)) {
      return {
        model: 'sonnet',
        reason: `description contains "${keyword}" — code editing`,
      };
    }
  }

  return { model: 'haiku', reason: 'no complexity signals — fast default' };
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
    if (learned.total_tasks < MIN_TASKS_FOR_LEARNING) {
      logger.debug(
        { taskType, total_tasks: learned.total_tasks, min: MIN_TASKS_FOR_LEARNING },
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
      model: learned.model as ModelAlias,
      reason: `learned: ${successPct}% success rate over ${learned.total_tasks} tasks`,
    };
  } catch {
    // No data or memory error — caller will use heuristic fallback
    return null;
  }
}

/**
 * Recommend a model for a TaskManifest.
 *
 * Priority:
 * 1. If `manifest.model` is set, return it as-is (explicit override wins)
 * 2. If `manifest.profile` is set, use profile-based recommendation
 * 3. Fall back to description-based recommendation using the prompt
 *
 * Returns a ModelRecommendation. The caller decides whether to use it.
 */
export function recommendModel(manifest: TaskManifest): ModelRecommendation {
  // Explicit model override — respect the caller's choice
  if (manifest.model) {
    logger.debug({ model: manifest.model }, 'Model explicitly set in manifest — using as-is');
    return {
      model: manifest.model as ModelAlias,
      reason: 'explicitly set in manifest',
    };
  }

  // Profile-based recommendation
  if (manifest.profile) {
    const rec = recommendByProfile(manifest.profile);
    logger.debug(
      { profile: manifest.profile, recommended: rec.model },
      'Model recommended by profile',
    );
    return rec;
  }

  // Description-based recommendation from the prompt
  const rec = recommendByDescription(manifest.prompt);
  logger.debug({ recommended: rec.model, reason: rec.reason }, 'Model recommended by description');
  return rec;
}
