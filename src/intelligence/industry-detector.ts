/**
 * Industry Detector — AI-powered business type classification
 *
 * Spawns a read-only worker via AgentRunner to analyze workspace context and
 * user messages, then classifies the business type and returns the best-match
 * industry template ID.
 *
 * Supported template IDs:
 * - restaurant
 * - retail
 * - services
 * - car-rental
 * - construction
 * - marketplace-seller
 */

import { createLogger } from '../core/logger.js';
import { parseAIResult } from '../master/result-parser.js';

const logger = createLogger('industry-detector');

/** Supported industry template IDs */
export const INDUSTRY_TEMPLATE_IDS = [
  'restaurant',
  'retail',
  'services',
  'car-rental',
  'construction',
  'marketplace-seller',
] as const;

export type IndustryTemplateId = (typeof INDUSTRY_TEMPLATE_IDS)[number];

/** Fallback template ID when classification fails */
const FALLBACK_TEMPLATE_ID: IndustryTemplateId = 'services';

/** Minimal AgentRunner typings to avoid circular import */
interface AgentRunnerResult {
  stdout: string;
  exitCode: number;
}

interface AgentRunnerLike {
  spawn(opts: {
    prompt: string;
    workspacePath: string;
    model?: string;
    allowedTools?: string[];
    maxTurns?: number;
    timeout?: number;
    retries?: number;
  }): Promise<AgentRunnerResult>;
}

/** Shape of the JSON we ask the AI to produce */
interface AIClassificationResponse {
  templateId?: string;
  confidence?: string;
  reasoning?: string;
}

/**
 * Build the classification prompt for the AI worker.
 */
function buildClassificationPrompt(workspaceContext: string, userMessages: string[]): string {
  const sections: string[] = [
    'Analyze the following workspace description and user messages to determine the best-match business type.',
    'Return ONLY a JSON object (no markdown fences, no explanation) with this exact structure:',
    '',
    '{',
    '  "templateId": "restaurant" | "retail" | "services" | "car-rental" | "construction" | "marketplace-seller",',
    '  "confidence": "high" | "medium" | "low",',
    '  "reasoning": "<one sentence explanation>"',
    '}',
    '',
    'Template descriptions:',
    '- restaurant: Food & beverage businesses — cafes, restaurants, food trucks, bakeries, catering',
    '- retail: Physical or online product sales — shops, stores, e-commerce, boutiques',
    '- services: Professional services — consulting, accounting, legal, cleaning, maintenance, freelancing',
    '- car-rental: Vehicle rental businesses — car rental, fleet management, vehicle leasing',
    '- construction: Construction & contracting — builders, contractors, renovation, real estate development',
    '- marketplace-seller: Multi-vendor or marketplace operations — platforms that connect buyers/sellers',
    '',
    'Rules:',
    '- Choose the single best-matching templateId from the list above.',
    '- If unsure, pick "services" as the default.',
    '- Do not invent new template IDs.',
    '',
  ];

  if (workspaceContext.trim().length > 0) {
    sections.push(`## Workspace Context\n${workspaceContext.trim()}\n`);
  }

  if (userMessages.length > 0) {
    sections.push('## Recent User Messages');
    for (const msg of userMessages) {
      sections.push(`- ${msg}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

/**
 * Parse the AI response and return a validated template ID.
 */
function parseClassificationResponse(stdout: string): IndustryTemplateId {
  const parsed = parseAIResult<AIClassificationResponse>(stdout, 'industry-detection');

  if (!parsed.success) {
    logger.warn({ error: parsed.error }, 'Failed to parse AI classification response');
    return FALLBACK_TEMPLATE_ID;
  }

  const templateId = parsed.data.templateId?.trim().toLowerCase();
  if (templateId && (INDUSTRY_TEMPLATE_IDS as readonly string[]).includes(templateId)) {
    return templateId as IndustryTemplateId;
  }

  logger.warn({ templateId }, 'Unrecognised template ID from AI — falling back to default');
  return FALLBACK_TEMPLATE_ID;
}

/**
 * Detect the industry type for a workspace.
 *
 * Spawns a read-only worker via AgentRunner with a prompt containing the
 * workspace description and recent user messages. Parses the worker's JSON
 * output to return the best-match industry template ID.
 *
 * @param workspaceContext - Workspace description (e.g. from workspace-map.json or memory.md)
 * @param userMessages     - Recent user messages that may hint at the business type
 * @returns The best-match template ID (e.g. "restaurant", "retail")
 */
export async function detectIndustry(
  workspaceContext: string,
  userMessages: string[],
): Promise<string> {
  const prompt = buildClassificationPrompt(workspaceContext, userMessages);

  // Dynamically import AgentRunner to avoid circular dependencies
  let AgentRunner: new () => AgentRunnerLike;
  try {
    const mod = (await import('../core/agent-runner.js')) as {
      AgentRunner: new () => AgentRunnerLike;
    };
    AgentRunner = mod.AgentRunner;
  } catch {
    logger.warn('AgentRunner not available, returning fallback industry template');
    return FALLBACK_TEMPLATE_ID;
  }

  const runner = new AgentRunner();
  try {
    const result = await runner.spawn({
      prompt,
      workspacePath: '.',
      allowedTools: ['Read', 'Glob', 'Grep'],
      maxTurns: 3,
      timeout: 60_000,
      retries: 1,
    });

    if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
      logger.warn(
        { exitCode: result.exitCode, outputLen: result.stdout.length },
        'Industry detection worker returned no useful output — falling back to default',
      );
      return FALLBACK_TEMPLATE_ID;
    }

    const templateId = parseClassificationResponse(result.stdout);

    logger.info({ templateId }, 'Industry detection complete');
    return templateId;
  } catch (err) {
    logger.error({ err }, 'Industry detection worker failed — falling back to default');
    return FALLBACK_TEMPLATE_ID;
  }
}
