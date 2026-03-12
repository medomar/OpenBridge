import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../core/logger.js';
import type { AgentRunner } from '../../core/agent-runner.js';
import { DEFAULT_MAX_TURNS_TASK } from '../../core/agent-runner.js';
import type { StepResult } from '../../types/workflow.js';

const logger = createLogger('generate-step');

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const GenerateStepConfigSchema = z
  .object({
    /**
     * Output document type.
     * - "pdf"   — professional PDF document (uses pdf-generator when available)
     * - "html"  — responsive HTML page (web-designer skill pack)
     * - "chart" — interactive data chart (chart-generator skill pack)
     */
    type: z.enum(['pdf', 'html', 'chart']),
    /**
     * Optional template name or hint for the document type.
     * - pdf:   "invoice" | "quote" | "receipt" | "report"
     * - html:  "landing-page" | "email" | "report"
     * - chart: "bar" | "line" | "pie" | "scatter" | "area"
     */
    template: z.string().optional(),
    /**
     * Optional prompt template to guide the AI worker.
     * Supports Mustache-style `{{field}}` substitution with input data.
     * When omitted, a default prompt is built from the input data.
     */
    prompt: z.string().optional(),
  })
  .strict();

export type GenerateStepConfig = z.infer<typeof GenerateStepConfigSchema>;

// ---------------------------------------------------------------------------
// External dependencies (injected by the engine)
// ---------------------------------------------------------------------------

/**
 * Context injected by the workflow engine so the generate step can spawn
 * workers and optionally use the native pdf-generator (Phase 122).
 */
export interface GenerateStepContext {
  /** AgentRunner instance used to spawn worker agents */
  runner: AgentRunner;
  /** Workspace path the worker agent will run in */
  workspacePath: string;
  /**
   * Optional pdf-generator function wired in Phase 122.
   * Receives the input data + template hint and returns the path to the
   * generated PDF file. When omitted, a print-ready HTML fallback is produced.
   */
  generatePdf?: (data: Record<string, unknown>, template?: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Mustache-style template engine  (mirrors send-step / ai-step pattern)
// ---------------------------------------------------------------------------

function resolveField(data: Record<string, unknown>, fieldPath: string): unknown {
  const parts = fieldPath.split('.');
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
  return template.replace(/\{\{([^}]+)\}\}/g, (_match, fieldPath: string) => {
    const resolved = resolveField(data, fieldPath.trim());
    if (resolved === null || resolved === undefined) return '';
    if (typeof resolved === 'object') return JSON.stringify(resolved);
    return String(resolved as string | number | boolean);
  });
}

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

async function ensureGeneratedDir(workspacePath: string): Promise<string> {
  const dir = path.join(workspacePath, '.openbridge', 'generated');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Generation strategies
// ---------------------------------------------------------------------------

async function generateHtmlDoc(
  context: GenerateStepContext,
  config: GenerateStepConfig,
  input: StepResult,
): Promise<string> {
  const generatedDir = await ensureGeneratedDir(context.workspacePath);
  const outputPath = path.join(generatedDir, `${randomUUID()}.html`);

  const dataJson = JSON.stringify(input.json, null, 2);
  const templateHint = config.template ? `\nDocument type / template hint: ${config.template}` : '';

  const prompt = config.prompt
    ? `${renderTemplate(config.prompt, input.json)}\n\nWrite the output to: ${outputPath}`
    : `Generate a polished, responsive HTML document from the following data.${templateHint}

Data:
${dataJson}

Requirements:
- Use HTML + Tailwind CDN for styling (self-contained, no build step needed)
- Make it print-friendly and visually professional
- Write the complete HTML file to exactly this path: ${outputPath}
- Do not output anything else — just write the file`;

  logger.debug({ outputPath, template: config.template }, 'Spawning web-designer worker');

  const result = await context.runner.spawn({
    prompt,
    workspacePath: context.workspacePath,
    model: 'sonnet',
    allowedTools: ['Read', 'Write', 'Bash(cat:*)'],
    maxTurns: DEFAULT_MAX_TURNS_TASK,
  });

  if (result.exitCode !== 0) {
    const msg = result.stderr.trim() || `exit code ${result.exitCode}`;
    throw new Error(`HTML generation worker failed: ${msg}`);
  }

  // Verify the worker wrote the file; if not, extract HTML from stdout as fallback
  const fileExists = await fs
    .access(outputPath)
    .then(() => true)
    .catch(() => false);

  if (!fileExists) {
    logger.warn({ outputPath }, 'Worker did not write file — extracting HTML from stdout');
    const htmlMatch =
      /<!DOCTYPE html[\s\S]*<\/html>/im.exec(result.stdout) ??
      /<html[\s\S]*<\/html>/im.exec(result.stdout);
    const content = htmlMatch ? htmlMatch[0] : result.stdout.trim();
    if (!content) {
      throw new Error('HTML generation produced no output');
    }
    await fs.writeFile(outputPath, content, 'utf-8');
  }

  return outputPath;
}

async function generateChartDoc(
  context: GenerateStepContext,
  config: GenerateStepConfig,
  input: StepResult,
): Promise<string> {
  const generatedDir = await ensureGeneratedDir(context.workspacePath);
  const outputPath = path.join(generatedDir, `${randomUUID()}.html`);

  const dataJson = JSON.stringify(input.json, null, 2);
  const chartTypeHint = config.template ? `\nPreferred chart type: ${config.template}` : '';

  const prompt = config.prompt
    ? `${renderTemplate(config.prompt, input.json)}\n\nWrite the output to: ${outputPath}`
    : `Generate a self-contained HTML page with a Chart.js data visualization from the following data.${chartTypeHint}

Data:
${dataJson}

Requirements:
- Use Chart.js via CDN (https://cdn.jsdelivr.net/npm/chart.js@4) — self-contained, no build step
- Default to Chart.js for standard charts; use D3.js only for complex custom layouts
- Include axis labels and a descriptive chart title
- Write the complete HTML file to exactly this path: ${outputPath}
- Do not output anything else — just write the file`;

  logger.debug({ outputPath, template: config.template }, 'Spawning chart-generator worker');

  const result = await context.runner.spawn({
    prompt,
    workspacePath: context.workspacePath,
    model: 'sonnet',
    allowedTools: ['Read', 'Write', 'Bash(cat:*)'],
    maxTurns: DEFAULT_MAX_TURNS_TASK,
  });

  if (result.exitCode !== 0) {
    const msg = result.stderr.trim() || `exit code ${result.exitCode}`;
    throw new Error(`Chart generation worker failed: ${msg}`);
  }

  const fileExists = await fs
    .access(outputPath)
    .then(() => true)
    .catch(() => false);

  if (!fileExists) {
    logger.warn({ outputPath }, 'Worker did not write file — extracting HTML from stdout');
    const htmlMatch =
      /<!DOCTYPE html[\s\S]*<\/html>/im.exec(result.stdout) ??
      /<html[\s\S]*<\/html>/im.exec(result.stdout);
    const content = htmlMatch ? htmlMatch[0] : result.stdout.trim();
    if (!content) {
      throw new Error('Chart generation produced no output');
    }
    await fs.writeFile(outputPath, content, 'utf-8');
  }

  return outputPath;
}

async function generatePdfDoc(
  context: GenerateStepContext,
  config: GenerateStepConfig,
  input: StepResult,
): Promise<string> {
  // If the pdf-generator is wired (Phase 122), delegate to it
  if (context.generatePdf) {
    logger.debug({ template: config.template }, 'Delegating to pdf-generator');
    return context.generatePdf(input.json, config.template);
  }

  // Fallback: produce a print-ready HTML file (pdf-generator not yet available)
  logger.warn('pdf-generator not wired (Phase 122 pending) — generating print-ready HTML fallback');

  const generatedDir = await ensureGeneratedDir(context.workspacePath);
  const outputPath = path.join(generatedDir, `${randomUUID()}.pdf.html`);

  const dataJson = JSON.stringify(input.json, null, 2);
  const templateHint = config.template ? `\nDocument template: ${config.template}` : '';

  const prompt = config.prompt
    ? `${renderTemplate(config.prompt, input.json)}\n\nWrite the output to: ${outputPath}`
    : `Generate a print-ready HTML document (formatted for PDF output) from the following data.${templateHint}

Data:
${dataJson}

Requirements:
- Use inline CSS only (no external stylesheets — print-safe)
- Include @media print CSS rules for clean PDF output
- Use a clean, professional layout with clear sections and typography
- Write the complete HTML file to exactly this path: ${outputPath}
- Do not output anything else — just write the file`;

  logger.debug({ outputPath, template: config.template }, 'Spawning PDF-fallback worker');

  const result = await context.runner.spawn({
    prompt,
    workspacePath: context.workspacePath,
    model: 'sonnet',
    allowedTools: ['Read', 'Write', 'Bash(cat:*)'],
    maxTurns: DEFAULT_MAX_TURNS_TASK,
  });

  if (result.exitCode !== 0) {
    const msg = result.stderr.trim() || `exit code ${result.exitCode}`;
    throw new Error(`PDF generation worker failed: ${msg}`);
  }

  const fileExists = await fs
    .access(outputPath)
    .then(() => true)
    .catch(() => false);

  if (!fileExists) {
    logger.warn({ outputPath }, 'Worker did not write file — extracting HTML from stdout');
    const htmlMatch =
      /<!DOCTYPE html[\s\S]*<\/html>/im.exec(result.stdout) ??
      /<html[\s\S]*<\/html>/im.exec(result.stdout);
    const content = htmlMatch ? htmlMatch[0] : result.stdout.trim();
    if (!content) {
      throw new Error('PDF generation produced no output');
    }
    await fs.writeFile(outputPath, content, 'utf-8');
  }

  return outputPath;
}

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------

/**
 * Execute a generate step: produce a document (PDF, HTML, or chart) from
 * the incoming step data.
 *
 * - pdf:   Delegates to the injected `generatePdf` function (Phase 122) when
 *          available; falls back to a print-ready HTML file otherwise.
 * - html:  Spawns a worker with the web-designer skill pack prompt style.
 * - chart: Spawns a worker with the chart-generator skill pack prompt style.
 *
 * All outputs are saved to `.openbridge/generated/` and the file path is
 * returned in both `json._generate_path` and `files`.
 *
 * @param context - Injected AgentRunner, workspacePath, and optional generatePdf
 * @param config  - Step configuration (type, template?, prompt?)
 * @param input   - Incoming data envelope from the previous step
 * @returns A StepResult with the generated file path appended to files
 */
export async function executeGenerateStep(
  context: GenerateStepContext,
  config: {
    type: 'pdf' | 'html' | 'chart';
    template?: string;
    prompt?: string;
  },
  input: StepResult,
): Promise<StepResult> {
  const parsed = GenerateStepConfigSchema.parse(config);

  logger.debug(
    { type: parsed.type, template: parsed.template, hasPrompt: !!parsed.prompt },
    'Executing generate step',
  );

  let filePath: string;

  switch (parsed.type) {
    case 'pdf':
      filePath = await generatePdfDoc(context, parsed, input);
      break;
    case 'html':
      filePath = await generateHtmlDoc(context, parsed, input);
      break;
    case 'chart':
      filePath = await generateChartDoc(context, parsed, input);
      break;
  }

  logger.info({ type: parsed.type, filePath }, 'Generate step completed');

  return {
    json: {
      ...input.json,
      _generate_type: parsed.type,
      _generate_path: filePath,
    },
    files: [...(input.files ?? []), filePath],
  };
}
