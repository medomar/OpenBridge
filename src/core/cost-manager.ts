/**
 * Cost management helpers for worker cost tracking, estimation, and cap enforcement.
 *
 * Extracted from agent-runner.ts (OB-1286) so cost management logic can be
 * imported independently without pulling in the full process-execution machinery.
 */

import { createLogger } from './logger.js';

const logger = createLogger('cost-manager');

/**
 * Default per-profile cost caps in USD.
 * If a worker's estimated cost exceeds the cap for its profile,
 * the agent is aborted and a WARNING is logged (OB-F101).
 */
export const PROFILE_COST_CAPS: Record<string, number> = {
  'read-only': 0.5,
  'code-edit': 1.0,
  'code-audit': 1.0,
  'full-access': 2.0,
};

/**
 * Get the cost cap in USD for a given tool profile.
 * Returns the cap from `overrides` first, then `PROFILE_COST_CAPS`.
 * Returns `undefined` if the profile is unknown or no cap is configured.
 */
export function getProfileCostCap(
  profile: string | undefined,
  overrides?: Record<string, number>,
): number | undefined {
  if (!profile) return undefined;
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, profile)) {
    return overrides[profile];
  }
  return PROFILE_COST_CAPS[profile];
}

/**
 * Module-level in-memory running average of worker costs per profile (OB-1673).
 * Tracks { sum, count } so we can compute mean without storing all values.
 * Resets on process restart — this is intentional (short-lived diagnostic signal).
 */
const _profileCostAccumulator: Map<string, { sum: number; count: number }> = new Map();

/**
 * Record a completed worker cost for its profile and warn if the cost is
 * more than 10x the running average for that profile.
 *
 * Only called after the agent has successfully produced a result (not on abort).
 * The average is updated AFTER the spike check so extreme outliers do not
 * immediately skew the baseline.
 */
export function checkProfileCostSpike(profile: string | undefined, costUsd: number): void {
  if (!profile || costUsd <= 0) return;

  const acc = _profileCostAccumulator.get(profile);
  if (acc && acc.count > 0) {
    const avg = acc.sum / acc.count;
    if (avg > 0 && costUsd > avg * 10) {
      const multiplier = (costUsd / avg).toFixed(0);
      logger.warn(
        { cost: costUsd, average: avg, multiplier: Number(multiplier), profile },
        `Worker cost $${costUsd.toFixed(4)} is ${multiplier}x average $${avg.toFixed(4)} for ${profile} profile`,
      );
    }
  }

  // Update accumulator after the check to keep baseline stable
  if (acc) {
    acc.sum += costUsd;
    acc.count += 1;
  } else {
    _profileCostAccumulator.set(profile, { sum: costUsd, count: 1 });
  }
}

/**
 * Return a snapshot of the current profile cost averages (for testing).
 */
export function getProfileCostAverages(): Record<string, { avg: number; count: number }> {
  const result: Record<string, { avg: number; count: number }> = {};
  for (const [profile, acc] of _profileCostAccumulator) {
    result[profile] = { avg: acc.count > 0 ? acc.sum / acc.count : 0, count: acc.count };
  }
  return result;
}

/**
 * Reset the cost accumulator (exposed for tests only).
 */
export function resetProfileCostAverages(): void {
  _profileCostAccumulator.clear();
}

/**
 * Check whether a worker's cumulative cost has exceeded its cap.
 *
 * Returns `true` when `currentCost >= maxCost`, indicating the worker should
 * be killed. Returns `false` when under the cap.
 */
export function checkCostCap(currentCost: number, maxCost: number): boolean {
  return currentCost >= maxCost;
}

/**
 * Build a consistent cost-cap warning message for logging and result summaries.
 *
 * @param workerId     Identifier for the worker (e.g. "worker-abc123")
 * @param currentCost  Cost accumulated so far in USD
 * @param maxCost      Cap threshold in USD
 * @param model        Model name (e.g. "claude-opus-4-6") or undefined
 */
export function formatCostWarning(
  workerId: string,
  currentCost: number,
  maxCost: number,
  model: string | undefined,
): string {
  const modelStr = model ?? 'unknown-model';
  return (
    `Worker ${workerId} cost-capped: $${currentCost.toFixed(4)} >= $${maxCost.toFixed(4)}` +
    ` (model: ${modelStr}) — output may be incomplete`
  );
}

/**
 * Estimate the cost in USD for a single agent call.
 * Uses a simple per-call heuristic scaled by output size.
 *
 * Pricing tiers (Anthropic pricing as of v0.1.0):
 *   Haiku 4.5   (claude-haiku-4-5-*): $1/MTok input,  $5/MTok output
 *     → base $0.001  + $0.00128 per KB output
 *   Sonnet 4.6  (claude-sonnet-4-6):  $3/MTok input, $15/MTok output
 *     → base $0.003  + $0.00384 per KB output
 *   Opus 4.6    (claude-opus-4-6):    $5/MTok input, $25/MTok output
 *     → base $0.005  + $0.0064  per KB output
 *
 * Per-KB multiplier derivation: price/MTok × (1024 bytes / 4 bytes-per-token) / 1_000_000
 * Falls back to Sonnet 4.6 pricing for unknown / undefined models.
 */
export function estimateCostUsd(model: string | undefined, outputBytes: number): number {
  const outputKb = outputBytes / 1024;
  const modelKey = (model ?? '').toLowerCase();

  // Haiku 4.5: $1/MTok input, $5/MTok output
  if (modelKey.includes('haiku') || /haiku.*4[.-]5/.test(modelKey)) {
    return 0.001 + outputKb * 0.00128;
  }
  // Opus 4.6: $5/MTok input, $25/MTok output
  if (modelKey.includes('opus') || /opus.*4[.-]6/.test(modelKey)) {
    return 0.005 + outputKb * 0.0064;
  }
  // Default / Sonnet 4.6: $3/MTok input, $15/MTok output
  return 0.003 + outputKb * 0.00384;
}

/**
 * Result returned by estimateCost().
 * Provides rough pre-execution cost and time estimates for display in the
 * user confirmation prompt before a high-risk worker is spawned.
 */
export interface CostEstimate {
  /** Expected number of agent turns (equals maxTurns — pessimistic worst-case estimate) */
  estimatedTurns: number;
  /** Human-readable cost estimate string, e.g. "~$0.30" */
  costString: string;
  /** Human-readable time estimate string, e.g. "~5 min" */
  timeString: string;
}

/**
 * Estimate the pre-execution cost and time for a worker spawn.
 *
 * Uses rough per-turn costs (pessimistic — assumes all turns are used):
 *   haiku / fast      = $0.01 / turn
 *   sonnet / balanced = $0.03 / turn
 *   opus / powerful   = $0.10 / turn
 *
 * Time estimate: ~10 seconds per turn.
 *
 * @param _profile   Profile name — reserved for future profile-based adjustments
 * @param maxTurns   Maximum turns the worker is allowed (used as the turn estimate)
 * @param modelTier  Model tier ('fast', 'balanced', 'powerful') or alias ('haiku', 'sonnet', 'opus')
 */
export function estimateCost(_profile: string, maxTurns: number, modelTier: string): CostEstimate {
  const tier = modelTier.toLowerCase();

  let costPerTurn: number;
  if (tier === 'fast' || tier.includes('haiku')) {
    costPerTurn = 0.01;
  } else if (tier === 'powerful' || tier.includes('opus')) {
    costPerTurn = 0.1;
  } else {
    // balanced / sonnet / unknown — default to sonnet pricing
    costPerTurn = 0.03;
  }

  const estimatedTurns = maxTurns;
  const totalCost = costPerTurn * estimatedTurns;
  const totalSeconds = estimatedTurns * 10;
  const totalMinutes = Math.ceil(totalSeconds / 60);

  const costString = `~$${totalCost.toFixed(2)}`;
  const timeString = totalMinutes <= 1 ? '~1 min' : `~${totalMinutes} min`;

  return { estimatedTurns, costString, timeString };
}
