/**
 * Prompt Evolution (OB-734)
 *
 * Every 50 task completions, query for underperforming prompts (effectiveness < 0.7).
 * For each underperforming prompt, spawn a quick Haiku worker to suggest an improved
 * version. Save the improved version as a new prompt version with neutral effectiveness
 * (0.5). After 20 uses, compare effectiveness: if worse, deactivate and restore the
 * previous version.
 */

import type { AgentRunner } from '../core/agent-runner.js';
import { TOOLS_READ_ONLY } from '../core/agent-runner.js';
import type { MemoryManager, PromptRecord } from '../memory/index.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('prompt-evolver');

/** Minimum usage count a prompt must have before being considered for evolution. */
const MIN_USAGE_BEFORE_EVOLUTION = 10;

/** Effectiveness threshold below which a prompt is considered underperforming. */
const UNDERPERFORMING_THRESHOLD = 0.7;

/** Minimum uses of the new version before we compare it to the previous version. */
const MIN_USES_FOR_COMPARISON = 20;

/** If a new version's effectiveness drops below this compared to the old one, revert. */
const REVERT_EFFECTIVENESS_DELTA = 0.05;

/**
 * Build the prompt text to send to the Haiku worker asking for an improved version.
 */
function buildEvolutionPrompt(record: PromptRecord): string {
  const effectivenessPercent = Math.round(record.effectiveness * 100);
  return `You are a prompt engineering expert. The following system prompt has a ${effectivenessPercent}% success rate (${record.usage_count} uses, ${record.success_count} successes). Analyze it and suggest a concise, improved version that should increase its success rate.

Current prompt (name: "${record.name}", version: ${record.version}):
---
${record.content}
---

Respond with ONLY the improved prompt text. Do not add explanations, headers, or markdown code fences. Output the raw improved prompt text directly.`;
}

/**
 * Extract the improved prompt text from the worker's output.
 * If the worker wrapped it in a code fence, strip the fence.
 */
function extractImprovedPrompt(output: string): string {
  const trimmed = output.trim();

  // Strip markdown code fences if present
  const fenceMatch = trimmed.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  return trimmed;
}

/**
 * Attempt to evolve a single underperforming prompt.
 * Returns true if a new version was saved, false otherwise.
 */
async function evolvePrompt(
  prompt: PromptRecord,
  memory: MemoryManager,
  agentRunner: AgentRunner,
  workspacePath: string,
): Promise<boolean> {
  logger.info(
    { name: prompt.name, version: prompt.version, effectiveness: prompt.effectiveness },
    'Attempting to evolve underperforming prompt',
  );

  const evolutionPrompt = buildEvolutionPrompt(prompt);

  let result;
  try {
    result = await agentRunner.spawn({
      prompt: evolutionPrompt,
      workspacePath,
      model: 'haiku',
      allowedTools: [...TOOLS_READ_ONLY],
      maxTurns: 3,
      retries: 1,
    });
  } catch (err) {
    logger.warn({ err, name: prompt.name }, 'Prompt evolution worker failed');
    return false;
  }

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    logger.warn(
      { name: prompt.name, exitCode: result.exitCode },
      'Prompt evolution worker returned empty or failed output',
    );
    return false;
  }

  const improvedContent = extractImprovedPrompt(result.stdout);

  // Sanity check: improved prompt must be non-trivially different
  if (improvedContent === prompt.content || improvedContent.length < 20) {
    logger.info(
      { name: prompt.name },
      'Evolution worker returned unchanged or trivial content, skipping',
    );
    return false;
  }

  try {
    await memory.createPromptVersion(prompt.name, improvedContent);
    logger.info({ name: prompt.name }, 'New prompt version saved with neutral effectiveness (0.5)');
    return true;
  } catch (err) {
    logger.warn({ err, name: prompt.name }, 'Failed to save evolved prompt version');
    return false;
  }
}

/**
 * Check whether any recently-created prompt versions should be reverted.
 *
 * A version is reverted when:
 * - It has been used at least MIN_USES_FOR_COMPARISON times
 * - Its effectiveness is more than REVERT_EFFECTIVENESS_DELTA worse than the
 *   version that was active before it (version - 1)
 *
 * On revert: the new version is deactivated by creating a fresh version from
 * the previous content (restoring it as the active version).
 */
async function checkAndRevertIfWorse(memory: MemoryManager): Promise<void> {
  let allPromptNames: string[];
  try {
    // getUnderperformingPrompts returns active prompts below threshold.
    // We also need to check recently promoted prompts regardless of effectiveness.
    // We use a low threshold (0.0) to get ALL active prompts, then filter by usage.
    const allActive = await memory.getUnderperformingPrompts(1.1); // threshold > 1 = all
    allPromptNames = [...new Set(allActive.map((p) => p.name))];
  } catch {
    return;
  }

  for (const name of allPromptNames) {
    let versions: PromptRecord[];
    try {
      versions = await memory.getPromptStats(name);
    } catch {
      continue;
    }

    // versions are ordered by version DESC; [0] is the latest
    const latest = versions[0];
    const previous = versions[1];

    if (!latest || !previous) continue;

    // Only evaluate if the latest version has enough usage data
    if (latest.usage_count < MIN_USES_FOR_COMPARISON) continue;

    // Only revert if the new version is noticeably worse
    const delta = previous.effectiveness - latest.effectiveness;
    if (delta > REVERT_EFFECTIVENESS_DELTA) {
      logger.info(
        {
          name,
          latestVersion: latest.version,
          latestEffectiveness: latest.effectiveness,
          previousVersion: previous.version,
          previousEffectiveness: previous.effectiveness,
          delta,
        },
        'New prompt version underperforms predecessor — reverting to previous content',
      );

      try {
        // Restore previous content as a new active version
        await memory.createPromptVersion(name, previous.content);
        logger.info(
          { name },
          'Prompt reverted to previous content (new version created from old content)',
        );
      } catch (err) {
        logger.warn({ err, name }, 'Failed to revert prompt version');
      }
    }
  }
}

/**
 * Main entry point for prompt evolution.
 * Call this every 50 task completions.
 */
export async function evolvePrompts(
  memory: MemoryManager,
  agentRunner: AgentRunner,
  workspacePath: string,
): Promise<void> {
  logger.info('Running prompt evolution cycle');

  // First, check whether any recently-promoted versions should be reverted
  await checkAndRevertIfWorse(memory);

  // Find prompts that have enough usage and are underperforming
  let candidates: PromptRecord[];
  try {
    const underperforming = await memory.getUnderperformingPrompts(UNDERPERFORMING_THRESHOLD);
    candidates = underperforming.filter((p) => p.usage_count >= MIN_USAGE_BEFORE_EVOLUTION);
  } catch (err) {
    logger.warn({ err }, 'Failed to query underperforming prompts');
    return;
  }

  if (candidates.length === 0) {
    logger.info('No underperforming prompts eligible for evolution');
    return;
  }

  logger.info({ count: candidates.length }, 'Found underperforming prompts eligible for evolution');

  // Evolve each candidate (sequentially to avoid overwhelming the AI)
  for (const candidate of candidates) {
    await evolvePrompt(candidate, memory, agentRunner, workspacePath);
  }
}
