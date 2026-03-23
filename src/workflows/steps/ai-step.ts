import { z } from 'zod/v3';
import { createLogger } from '../../core/logger.js';
import type { AgentRunner } from '../../core/agent-runner.js';
import { DEFAULT_MAX_TURNS_TASK } from '../../core/agent-runner.js';
import type { StepResult } from '../../types/workflow.js';

const logger = createLogger('ai-step');

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const AIStepConfigSchema = z
  .object({
    /**
     * Prompt template to send to the AI worker.
     * Supports Mustache-style `{{field}}` substitution with input data.
     */
    prompt: z.string().min(1),
    /**
     * Optional skill pack name to restrict the worker's tool set.
     * Maps to a tool profile (e.g. "read-only", "code-edit", "full-access").
     */
    skill_pack: z.string().optional(),
    /**
     * Model to use: 'haiku', 'sonnet', 'opus', or a full model ID.
     * Defaults to 'sonnet' for balanced cost/quality.
     */
    model: z.string().optional(),
  })
  .strict();

export type AIStepConfig = z.infer<typeof AIStepConfigSchema>;

// ---------------------------------------------------------------------------
// External dependencies (injected by the engine)
// ---------------------------------------------------------------------------

/**
 * Context injected by the workflow engine so the AI step can spawn
 * workers without importing AgentRunner directly.
 */
export interface AIStepContext {
  /** AgentRunner instance used to spawn worker agents */
  runner: AgentRunner;
  /** Workspace path the worker agent will run in */
  workspacePath: string;
}

// ---------------------------------------------------------------------------
// Mustache-style template engine  (mirrors send-step / integration-step pattern)
// ---------------------------------------------------------------------------

function resolveField(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined) return '';
    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current)) {
      const idx = Number(part);
      current = isNaN(idx) ? undefined : current[idx];
    } else {
      return '';
    }
  }
  return current ?? '';
}

function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const resolved = resolveField(data, path.trim());
    if (resolved === null || resolved === undefined) return '';
    if (typeof resolved === 'object') return JSON.stringify(resolved);
    return String(resolved as string | number | boolean);
  });
}

// ---------------------------------------------------------------------------
// JSON extraction from worker stdout
// ---------------------------------------------------------------------------

/**
 * Try to extract a JSON object or array from raw worker stdout.
 * Returns null if no valid JSON is found.
 */
function extractJson(stdout: string): Record<string, unknown> | null {
  // Try direct parse first
  const trimmed = stdout.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    if (Array.isArray(parsed)) {
      return { records: parsed };
    }
  } catch {
    // fall through to extraction
  }

  // Try to extract first JSON object from mixed output
  const objectMatch = /\{[\s\S]*\}/m.exec(stdout);
  if (objectMatch) {
    try {
      const parsed: unknown = JSON.parse(objectMatch[0]);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not valid JSON
    }
  }

  // Try to extract a JSON array
  const arrayMatch = /\[[\s\S]*\]/m.exec(stdout);
  if (arrayMatch) {
    try {
      const parsed: unknown = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return { records: parsed };
      }
    } catch {
      // not valid JSON
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------

/**
 * Execute an AI step: spawn a worker via AgentRunner with the prompt
 * (templated with input data). Parse worker output as JSON.
 * Return in StepResult format.
 *
 * @param context - Injected AgentRunner + workspacePath
 * @param config  - Step configuration (prompt, skill_pack?, model?)
 * @param input   - Incoming data envelope from the previous step
 * @returns A StepResult with parsed AI output merged into json
 */
export async function executeAIStep(
  context: AIStepContext,
  config: {
    prompt: string;
    skill_pack?: string;
    model?: string;
  },
  input: StepResult,
): Promise<StepResult> {
  const parsed = AIStepConfigSchema.parse(config);
  const { runner, workspacePath } = context;

  // Template the prompt with input data
  const resolvedPrompt = renderTemplate(parsed.prompt, input.json);

  // Map skill_pack to allowed tools if provided
  // read-only, code-edit, full-access profiles match BUILT_IN_PROFILES
  const allowedTools = parsed.skill_pack ? getToolsForSkillPack(parsed.skill_pack) : undefined;

  logger.debug(
    {
      promptLength: resolvedPrompt.length,
      model: parsed.model,
      skillPack: parsed.skill_pack,
    },
    'Executing AI step',
  );

  let result;
  try {
    result = await runner.spawn({
      prompt: resolvedPrompt,
      workspacePath,
      model: parsed.model ?? 'sonnet',
      allowedTools,
      maxTurns: DEFAULT_MAX_TURNS_TASK,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ error: errorMsg }, 'AI step worker spawn failed');
    throw err;
  }

  if (result.exitCode !== 0) {
    const errorMsg = result.stderr.trim() || `Worker exited with code ${result.exitCode}`;
    logger.error({ exitCode: result.exitCode, stderr: result.stderr }, 'AI step worker failed');
    throw new Error(`AI step failed: ${errorMsg}`);
  }

  logger.info(
    { exitCode: result.exitCode, durationMs: result.durationMs },
    'AI step worker completed',
  );

  // Try to parse JSON from worker output
  const parsedJson = extractJson(result.stdout);

  if (parsedJson !== null) {
    return {
      json: { ...input.json, ...parsedJson, _ai_raw: result.stdout },
      files: input.files,
    };
  }

  // No JSON found — return raw text in _ai_output
  return {
    json: {
      ...input.json,
      _ai_output: result.stdout.trim(),
      _ai_raw: result.stdout,
    },
    files: input.files,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a skill_pack name to a list of allowed tool names.
 * Falls back to undefined (all tools) for unrecognised packs.
 */
function getToolsForSkillPack(skillPack: string): string[] | undefined {
  switch (skillPack) {
    case 'read-only':
      return ['Read', 'Glob', 'Grep'];
    case 'code-edit':
      return ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)'];
    case 'full-access':
      return undefined; // no restriction
    default:
      return undefined;
  }
}
