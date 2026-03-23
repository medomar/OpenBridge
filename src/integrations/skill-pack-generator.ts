import path from 'path';
import fs from 'fs/promises';
import type { OpenAPI, OpenAPIV3 } from 'openapi-types';

import { createLogger } from '../core/logger.js';
import type { AgentRunner } from '../core/agent-runner.js';
import { TOOLS_READ_ONLY } from '../core/agent-runner.js';
import { parseSkillPackMd, skillPackToMarkdown } from '../master/skill-pack-loader.js';
import { SkillPackSchema } from '../types/agent.js';

const logger = createLogger('skill-pack-generator');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a short API name from an OpenAPI document.
 * Falls back to 'api' if no title is found.
 */
function extractApiName(spec: OpenAPI.Document): string {
  const doc = spec as OpenAPIV3.Document;
  const title = doc.info?.title;
  if (!title) return 'api';
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'api'
  );
}

/**
 * Summarise an OpenAPI spec into a compact text representation suitable for
 * inclusion in an AI prompt. Keeps only the essentials: title, base URL,
 * auth schemes, and endpoint list with parameters.
 */
function summariseSpec(spec: OpenAPI.Document): string {
  const doc = spec as OpenAPIV3.Document;
  const lines: string[] = [];

  // Title + version
  if (doc.info) {
    lines.push(`API: ${doc.info.title ?? 'Unknown'} v${doc.info.version ?? '?'}`);
    if (doc.info.description) {
      lines.push(`Description: ${doc.info.description.slice(0, 300)}`);
    }
  }

  // Base URL
  if (doc.servers && doc.servers.length > 0) {
    lines.push(`Base URL: ${doc.servers[0]!.url}`);
  }

  // Auth schemes
  const securitySchemes = doc.components?.securitySchemes;
  if (securitySchemes) {
    const schemes = Object.entries(securitySchemes)
      .map(([name, s]) => {
        const scheme = s as OpenAPIV3.SecuritySchemeObject;
        return `${name} (${scheme.type})`;
      })
      .join(', ');
    lines.push(`Auth: ${schemes}`);
  }

  // Endpoints (method + path + summary)
  lines.push('');
  lines.push('Endpoints:');
  const paths = doc.paths ?? {};
  let endpointCount = 0;
  for (const [urlPath, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as
        | OpenAPIV3.OperationObject
        | undefined;
      if (!operation) continue;
      endpointCount++;
      const summary = operation.summary ?? operation.description?.slice(0, 80) ?? '';
      lines.push(`  ${method.toUpperCase()} ${urlPath}${summary ? ' — ' + summary : ''}`);
    }
  }

  if (endpointCount === 0) {
    lines.push('  (no endpoints found)');
  }

  return lines.join('\n');
}

// ── Generation prompt ────────────────────────────────────────────────────────

function buildGenerationPrompt(specSummary: string, context?: string): string {
  const contextSection = context ? `\n\nAdditional context from the user:\n${context}\n` : '';

  return `You are a skill pack author for OpenBridge, an AI bridge system that connects messaging channels to AI agents. Your job is to create a SKILLPACK.md that teaches the Master AI how to use this API naturally through conversation.

Here is the API specification:

${specSummary}${contextSection}

Create a skill pack (.md) that teaches the Master AI how to use this API naturally. Include:
1. Capability descriptions — what the API can do, expressed in plain language
2. Natural language command examples — how a user would ask for things via chat (e.g. "list my orders", "create a new customer")
3. Common workflows — multi-step sequences (e.g. "create product → set price → publish")
4. Error handling guidance — what to do when auth fails, rate limits hit, required fields missing
5. Parameter mapping — how to translate conversational requests to API parameters

The SKILLPACK.md must follow this exact format:

# <name>

<one-paragraph description of what this API integration enables>

## Tool Profile
full-access

## When to Use
<describe when to activate this skill pack — mention the API name and key use cases>

## Required Tools
- Bash(curl:*)

## Tags
- <tag1>
- <tag2>
- api-integration

## Prompt Extension
<detailed instructions for workers — must be at least 200 words. Include:
  - API overview and authentication setup
  - Natural language command mapping (user says X → call endpoint Y)
  - Common workflows as step-by-step sequences
  - Error handling: auth failures, rate limits, missing fields
  - Response formatting: how to present API responses to users conversationally
  - Parameter defaults and smart inference (e.g. "recent orders" = last 7 days)>

## Example Tasks
- "<natural language example 1>"
- "<natural language example 2>"
- "<natural language example 3>"

## Constraints
- Never expose API keys or auth tokens in responses
- Always validate required parameters before making API calls
- Handle rate limiting gracefully with retry guidance

Rules:
- Name must be a lowercase slug (hyphens only, no spaces, no special characters)
- Name should reflect the API (e.g. "stripe-api", "github-api", "my-crm-api")
- Prompt Extension must be at least 200 words and actionable
- Include at least 5 natural language command examples in the Prompt Extension
- Include at least 2 multi-step workflows in the Prompt Extension

Respond with ONLY the SKILLPACK.md content. No explanations, no code fences.`;
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * AI-generates a skill pack from a parsed OpenAPI specification.
 *
 * Spawns a worker with the parsed API spec summary and asks the AI to create
 * a SKILLPACK.md that teaches the Master AI how to use the API naturally.
 * The generated pack is validated, saved to `.openbridge/skill-packs/{api-name}.md`,
 * and can be picked up by the skill-pack-loader on next load.
 *
 * @param spec     - Parsed OpenAPI document (from swagger-parser or any parser).
 * @param context  - Optional user-provided context about how they use the API.
 * @returns Path to the saved skill pack file on success, null on failure.
 */
export async function generateSkillPack(
  spec: OpenAPI.Document,
  workspacePath: string,
  agentRunner: AgentRunner,
  context?: string,
): Promise<string | null> {
  const apiName = extractApiName(spec);
  logger.info({ apiName }, 'Generating skill pack from API spec');

  const specSummary = summariseSpec(spec);
  const prompt = buildGenerationPrompt(specSummary, context);

  let result;
  try {
    result = await agentRunner.spawn({
      prompt,
      workspacePath,
      model: 'sonnet',
      allowedTools: [...TOOLS_READ_ONLY],
      maxTurns: 3,
      retries: 1,
    });
  } catch (err) {
    logger.warn({ err, apiName }, 'Skill pack generation worker failed');
    return null;
  }

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    logger.warn(
      { apiName, exitCode: result.exitCode },
      'Skill pack generation worker returned empty or failed output',
    );
    return null;
  }

  // Strip markdown code fences if the worker wrapped the output
  const rawContent = result.stdout.trim();
  const fenceMatch = rawContent.match(/^```(?:\w+)?\n([\s\S]*?)\n```$/);
  const content = fenceMatch?.[1] ?? rawContent;

  const partial = parseSkillPackMd(content);
  const parsed = SkillPackSchema.safeParse({ ...partial, isUserDefined: true });

  if (!parsed.success) {
    logger.warn(
      { apiName, issues: parsed.error.issues },
      'Generated skill pack failed Zod validation',
    );
    return null;
  }

  // Persist to .openbridge/skill-packs/<api-name>.md
  const skillPacksDir = path.join(workspacePath, '.openbridge', 'skill-packs');
  const filePath = path.join(skillPacksDir, `${apiName}.md`);

  try {
    await fs.mkdir(skillPacksDir, { recursive: true });
    await fs.writeFile(filePath, skillPackToMarkdown(parsed.data), 'utf-8');
    logger.info({ name: parsed.data.name, apiName, file: filePath }, 'Generated skill pack saved');
  } catch (err) {
    logger.warn({ err, apiName }, 'Failed to save generated skill pack to disk');
    return null;
  }

  return filePath;
}
