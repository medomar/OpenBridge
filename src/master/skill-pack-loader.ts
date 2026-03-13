import path from 'path';
import fs from 'fs/promises';

import { DocumentSkillSchema, SkillPackSchema } from '../types/agent.js';
import type { DocumentSkill, SkillPack } from '../types/agent.js';
import { createLogger } from '../core/logger.js';
import type { AgentRunner } from '../core/agent-runner.js';
import { TOOLS_READ_ONLY } from '../core/agent-runner.js';
import type { MemoryManager } from '../memory/index.js';
import type { LearningsSummary } from '../memory/task-store.js';

import { documentWriterSkill } from './skill-packs/document-writer.js';
import { presentationMakerSkill } from './skill-packs/presentation-maker.js';
import { spreadsheetBuilderSkill } from './skill-packs/spreadsheet-builder.js';
import { reportGeneratorSkill } from './skill-packs/report-generator.js';
import { BUILT_IN_SKILL_PACKS } from './skill-packs/index.js';

const logger = createLogger('skill-pack-loader');

/** Built-in skill packs shipped with OpenBridge */
const BUILT_IN_SKILLS: DocumentSkill[] = [
  documentWriterSkill,
  presentationMakerSkill,
  spreadsheetBuilderSkill,
  reportGeneratorSkill,
];

/** Result returned by {@link loadSkillPacks} */
export interface SkillPackLoaderResult {
  /** All available skill packs (built-in + custom), keyed by skill name */
  skills: Map<string, DocumentSkill>;
  /** Number of custom skill packs successfully loaded from `.openbridge/skill-packs/` */
  customCount: number;
}

/**
 * Discovers and loads skill packs from two sources:
 *
 * 1. **Built-in defaults** — the four packs shipped with OpenBridge
 *    (`document-writer`, `presentation-maker`, `spreadsheet-builder`, `report-generator`).
 * 2. **User-defined packs** — `.js` / `.cjs` / `.mjs` files placed in
 *    `<workspacePath>/.openbridge/skill-packs/`. Each file must export at least
 *    one value that validates against `DocumentSkillSchema`.
 *
 * Custom skill packs with the same `name` as a built-in pack **override** the
 * built-in (allowing workspace-specific customisation).
 *
 * @param workspacePath - Absolute path to the target workspace.
 * @returns A map of skill packs keyed by their `name` field, plus a count of
 *          custom packs loaded.
 */
export async function loadSkillPacks(workspacePath: string): Promise<SkillPackLoaderResult> {
  const skills = new Map<string, DocumentSkill>();

  // Seed with built-in skill packs
  for (const skill of BUILT_IN_SKILLS) {
    skills.set(skill.name, skill);
  }

  // Discover custom skill packs from .openbridge/skill-packs/
  const customDir = path.join(workspacePath, '.openbridge', 'skill-packs');
  let customCount = 0;

  let entries: string[];
  try {
    entries = await fs.readdir(customDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      // Directory does not exist — this is normal; only built-ins are used
      return { skills, customCount };
    }
    logger.warn({ customDir, err }, 'Error reading skill-packs directory');
    return { skills, customCount };
  }

  const jsFiles = entries.filter(
    (e) => e.endsWith('.js') || e.endsWith('.cjs') || e.endsWith('.mjs'),
  );

  for (const file of jsFiles) {
    const filePath = path.join(customDir, file);
    try {
      // Dynamic import — custom packs must be pre-compiled to JS
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const mod = await import(filePath);

      // Accept default export or any named export that validates as DocumentSkill
      const candidates = Object.values(mod as Record<string, unknown>);
      let loaded = false;

      for (const candidate of candidates) {
        const parsed = DocumentSkillSchema.safeParse(candidate);
        if (parsed.success) {
          skills.set(parsed.data.name, parsed.data);
          customCount++;
          loaded = true;
          logger.info({ skill: parsed.data.name, file }, 'Loaded custom skill pack');
          break; // One valid skill per file
        }
      }

      if (!loaded) {
        logger.warn({ file }, 'Custom skill pack file has no valid DocumentSkill export');
      }
    } catch (err) {
      logger.warn({ file, err }, 'Failed to load custom skill pack');
    }
  }

  return { skills, customCount };
}

/**
 * Returns the built-in skill pack list synchronously (no file I/O).
 * Useful for quick lookups when custom skill packs are not needed.
 */
export function getBuiltInSkillPacks(): DocumentSkill[] {
  return [...BUILT_IN_SKILLS];
}

/**
 * Finds the first skill pack that produces the given file format.
 * Searches the full skill map returned by {@link loadSkillPacks}.
 *
 * @param skills - The skill map from `loadSkillPacks()`.
 * @param fileFormat - Target format string (e.g., `'docx'`, `'pdf'`, `'pptx'`).
 * @returns The matching `DocumentSkill`, or `undefined` if none found.
 */
export function findSkillByFormat(
  skills: Map<string, DocumentSkill>,
  fileFormat: string,
): DocumentSkill | undefined {
  for (const skill of skills.values()) {
    if (skill.fileFormat === fileFormat) return skill;
  }
  return undefined;
}

// ── SKILLPACK.md format ───────────────────────────────────────────────────────
//
// SKILLPACK.md files let users define domain-specific instruction bundles for
// workers without writing TypeScript. Each file maps to a `SkillPack` object.
//
// Format:
//
//   # <name>
//
//   <description — first paragraph>
//
//   ## Tool Profile
//   <toolProfile>
//
//   ## When to Use
//   <description override — used only if the first-paragraph description is absent>
//
//   ## Required Tools
//   - <tool1>
//   - <tool2>
//
//   ## Tags
//   - <tag1>
//   - <tag2>
//
//   ## Prompt Extension
//   <multi-line text injected into the worker system prompt>
//
//   ## Example Tasks
//   - "<example task description>"
//
//   ## Constraints
//   - <constraint — appended to Prompt Extension>
//
// Required fields: name (H1), description or ## When to Use, ## Tool Profile.
// All other sections are optional.

/**
 * Extracts bullet-list items from a section body string.
 * Handles `- item`, `* item` list markers.
 */
function extractListItems(body: string): string[] {
  return body
    .split('\n')
    .map((line) =>
      line
        .replace(/^[-*]\s+/, '')
        .replace(/^["']|["']$/g, '')
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Parses a `SKILLPACK.md` file content into a partial `SkillPack` object.
 *
 * The caller should validate the result against `SkillPackSchema` before use.
 *
 * @param content - Raw markdown string.
 * @returns Partial SkillPack fields extracted from the markdown.
 */
export function parseSkillPackMd(content: string): Partial<SkillPack> {
  const result: Partial<SkillPack> & { requiredTools: string[]; tags: string[] } = {
    requiredTools: [],
    tags: [],
  };

  if (!content.trim()) return result;

  const lines = content.split('\n');

  // Track current H2 section name and its accumulated body lines
  let currentSection: string | null = null;
  const sectionLines: Record<string, string[]> = {};

  // Track lines before the first ## heading (after H1) for description
  let pastH1 = false;
  const preH2Lines: string[] = [];

  for (const line of lines) {
    if (!pastH1 && /^#\s+/.test(line)) {
      // H1 — extract name
      result.name = line.replace(/^#\s+/, '').trim();
      pastH1 = true;
      continue;
    }

    if (/^##\s+/.test(line)) {
      // H2 — start a new section
      currentSection = line.replace(/^##\s+/, '').trim();
      if (!sectionLines[currentSection]) {
        sectionLines[currentSection] = [];
      }
      continue;
    }

    if (currentSection !== null) {
      sectionLines[currentSection]!.push(line);
    } else if (pastH1) {
      preH2Lines.push(line);
    }
  }

  // Extract description from first non-empty paragraph before any H2
  const descPara = preH2Lines.join('\n').trim();
  if (descPara && !descPara.startsWith('#')) {
    result.description = descPara;
  }

  // Process each section
  for (const [heading, bodyLines] of Object.entries(sectionLines)) {
    const body = bodyLines.join('\n').trim();

    switch (heading) {
      case 'Tool Profile':
        result.toolProfile = body.split('\n')[0]!.trim();
        break;

      case 'When to Use':
        if (!result.description) {
          result.description = body;
        }
        break;

      case 'Required Tools':
        result.requiredTools = extractListItems(body);
        break;

      case 'Tags':
        result.tags = extractListItems(body);
        break;

      case 'Prompt Extension':
        result.systemPromptExtension = body;
        break;

      case 'Constraints': {
        const constraints = extractListItems(body);
        if (constraints.length > 0) {
          const constraintsSection = `\n\n## Constraints\n${constraints.map((c) => `- ${c}`).join('\n')}`;
          result.systemPromptExtension = (result.systemPromptExtension ?? '') + constraintsSection;
        }
        break;
      }

      // 'Example Tasks' — metadata only, not part of SkillPack schema; intentionally ignored
      default:
        break;
    }
  }

  return result;
}

/**
 * Keyword sets used to match task prompts to built-in skill packs.
 * Ordered by specificity so that more specific matches win over general ones.
 */
const SKILL_PACK_KEYWORDS: Record<string, string[]> = {
  'security-audit': [
    'security',
    'audit',
    'vulnerability',
    'vulnerabilities',
    'semgrep',
    'codeql',
    'owasp',
    'injection',
    'xss',
    'sql injection',
    'insecure',
    'cve',
    'exploit',
    'penetration',
    'pentest',
    'secure code',
    'security review',
    'threat',
  ],
  'code-review': [
    'review',
    'code review',
    'pull request',
    'pr review',
    'diff',
    'git diff',
    'feedback on',
    'review this',
    'check this code',
    'review the changes',
    'review my',
    'critique',
    'assess the code',
  ],
  'test-writer': [
    'write test',
    'write tests',
    'add test',
    'add tests',
    'create test',
    'create tests',
    'unit test',
    'unit tests',
    'test coverage',
    'tdd',
    'test-driven',
    'vitest',
    'jest',
    'mocha',
    'spec file',
    'test suite',
    'edge case',
    'edge cases',
  ],
  'data-analysis': [
    'analyse data',
    'analyze data',
    'data analysis',
    'csv',
    'json data',
    'ndjson',
    'statistics',
    'statistical',
    'dataset',
    'correlation',
    'distribution',
    'visuali',
    'chart',
    'histogram',
    'aggregate',
    'pivot',
    'parse data',
  ],
  documentation: [
    'write docs',
    'generate docs',
    'documentation',
    'api docs',
    'api reference',
    'readme',
    'changelog',
    'jsdoc',
    'tsdoc',
    'docstring',
    'document this',
    'document the',
    'write documentation',
    'update docs',
    'update the docs',
    'add docs',
  ],
  'web-deploy': [
    'deploy',
    'deployment',
    'vercel',
    'netlify',
    'cloudflare',
    'wrangler',
    'put this live',
    'go live',
    'publish site',
    'deploy to',
    'host this',
    'hosting',
    'static site',
    'deploy this',
    'ship this',
    'launch site',
    'deploy the app',
    'deploy the site',
  ],
  'spreadsheet-handler': [
    'spreadsheet',
    'excel',
    'xlsx',
    'xls',
    'csv',
    'read spreadsheet',
    'read excel',
    'modify spreadsheet',
    'modify excel',
    'update spreadsheet',
    'filter spreadsheet',
    'sort data',
    'aggregate data',
    'pivot table',
    'google sheets',
    'exceljs',
    'sheetjs',
  ],
  'file-converter': [
    'convert',
    'conversion',
    'convert file',
    'convert to pdf',
    'convert to docx',
    'convert to html',
    'convert to markdown',
    'pandoc',
    'libreoffice',
    'pdf to text',
    'docx to pdf',
    'markdown to pdf',
    'markdown to docx',
    'html to pdf',
    'docx to html',
    'docx to markdown',
    'extract text',
    'ocr',
    'tesseract',
    'mammoth',
    'pdf-parse',
    'format conversion',
    'file format',
    'epub',
    'rtf',
  ],
};

/**
 * Selects the most appropriate skill pack for a worker task based on keyword
 * matching against the task prompt.
 *
 * Scoring: each keyword match increments the pack's score by 1 (phrase matches
 * count as 2). The pack with the highest score wins. Returns `undefined` when
 * no pack scores above zero.
 *
 * @param prompt - The worker task prompt text.
 * @param packs  - Candidate skill packs to match against (typically {@link BUILT_IN_SKILL_PACKS}).
 * @returns The best-matching `SkillPack`, or `undefined` if no match.
 */
export function selectSkillPackForTask(prompt: string, packs: SkillPack[]): SkillPack | undefined {
  const lower = prompt.toLowerCase();
  let bestPack: SkillPack | undefined;
  let bestScore = 0;

  for (const pack of packs) {
    const keywords = SKILL_PACK_KEYWORDS[pack.name];
    if (!keywords) continue;

    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        // Phrase keywords (containing a space) worth 2 points for specificity
        score += kw.includes(' ') ? 2 : 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestPack = pack;
    }
  }

  return bestPack;
}

/**
 * Serialises a `SkillPack` to SKILLPACK.md format.
 * Useful for persisting auto-created or edited skill packs back to disk.
 *
 * @param pack - The SkillPack to serialise.
 * @returns A markdown string in SKILLPACK.md format.
 */
export function skillPackToMarkdown(pack: SkillPack): string {
  const lines: string[] = [];

  lines.push(`# ${pack.name}`, '');
  lines.push(pack.description, '');
  lines.push('## Tool Profile', pack.toolProfile, '');

  if (pack.requiredTools.length > 0) {
    lines.push('## Required Tools');
    for (const tool of pack.requiredTools) {
      lines.push(`- ${tool}`);
    }
    lines.push('');
  }

  if (pack.tags.length > 0) {
    lines.push('## Tags');
    for (const tag of pack.tags) {
      lines.push(`- ${tag}`);
    }
    lines.push('');
  }

  if (pack.systemPromptExtension) {
    // Strip any trailing Constraints section before re-serialising (they are
    // stored inline in systemPromptExtension and will be re-appended below)
    const basePrompt = pack.systemPromptExtension.replace(/\n\n## Constraints[\s\S]*$/, '').trim();
    if (basePrompt) {
      lines.push('## Prompt Extension', basePrompt, '');
    }

    // Re-extract constraints if they were appended
    const constraintsMatch = pack.systemPromptExtension.match(/\n\n## Constraints\n([\s\S]*)$/);
    if (constraintsMatch) {
      const items = extractListItems(constraintsMatch[1]!);
      if (items.length > 0) {
        lines.push('## Constraints');
        for (const item of items) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

/** Result returned by {@link loadSkillPackMarkdown} */
export interface SkillPackMarkdownLoaderResult {
  /** All loaded SkillPack objects keyed by name */
  packs: Map<string, SkillPack>;
  /** Number of successfully loaded packs */
  count: number;
}

/**
 * Discovers and loads `SKILLPACK.md` files from
 * `<workspacePath>/.openbridge/skill-packs/`.
 *
 * Files that fail to parse or fail Zod validation are skipped with a warning.
 * All loaded packs have `isUserDefined: true`.
 *
 * @param workspacePath - Absolute path to the target workspace.
 * @returns A map of SkillPack objects keyed by their `name` field.
 */
export async function loadSkillPackMarkdown(
  workspacePath: string,
): Promise<SkillPackMarkdownLoaderResult> {
  const packs = new Map<string, SkillPack>();
  const skillPacksDir = path.join(workspacePath, '.openbridge', 'skill-packs');

  let entries: string[];
  try {
    entries = await fs.readdir(skillPacksDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { packs, count: 0 };
    }
    logger.warn(
      { skillPacksDir, err },
      'Error reading skill-packs directory for SKILLPACK.md files',
    );
    return { packs, count: 0 };
  }

  const mdFiles = entries.filter((e) => e.endsWith('.md') && !e.startsWith('.'));

  for (const file of mdFiles) {
    const filePath = path.join(skillPacksDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const partial = parseSkillPackMd(content);

      const parsed = SkillPackSchema.safeParse({ ...partial, isUserDefined: true });
      if (parsed.success) {
        packs.set(parsed.data.name, parsed.data);
        logger.info({ name: parsed.data.name, file }, 'Loaded SKILLPACK.md');
      } else {
        logger.warn(
          { file, issues: parsed.error.issues },
          'SKILLPACK.md failed validation — skipping',
        );
      }
    } catch (err) {
      logger.warn({ file, err }, 'Failed to read or parse SKILLPACK.md');
    }
  }

  return { packs, count: packs.size };
}

/** Result returned by {@link loadAllSkillPacks} */
export interface AllSkillPacksResult {
  /** Merged skill packs (built-in + user-defined) — user-defined overrides built-ins by name */
  packs: SkillPack[];
  /** Number of user-defined packs loaded from .openbridge/skill-packs/ */
  userDefinedCount: number;
}

/**
 * Loads all skill packs — built-in defaults merged with user-defined overrides.
 *
 * User-defined packs discovered from `<workspacePath>/.openbridge/skill-packs/*.md`
 * take precedence over built-ins with the same `name`.
 *
 * @param workspacePath - Absolute path to the target workspace.
 * @returns Merged pack list and count of user-defined packs loaded.
 */
export async function loadAllSkillPacks(workspacePath: string): Promise<AllSkillPacksResult> {
  const merged = new Map<string, SkillPack>();

  for (const pack of BUILT_IN_SKILL_PACKS) {
    merged.set(pack.name, pack);
  }

  const { packs: userPacks, count: userDefinedCount } = await loadSkillPackMarkdown(workspacePath);

  for (const [name, pack] of userPacks) {
    if (merged.has(name)) {
      logger.info({ name }, 'User-defined skill pack overrides built-in');
    }
    merged.set(name, pack);
  }

  return { packs: Array.from(merged.values()), userDefinedCount };
}

// ── Skill Pack Synthesis ──────────────────────────────────────────────────────

/** Minimum number of successful tasks required to trigger skill pack synthesis. */
const MIN_TASKS_FOR_SYNTHESIS = 5;

/** Minimum success rate (0–1) for a task type to be eligible for synthesis. */
const MIN_SUCCESS_RATE_FOR_SYNTHESIS = 0.8;

/**
 * Task types that are too generic to benefit from a dedicated skill pack.
 * These are filtered out before synthesis is attempted.
 */
const GENERIC_TASK_TYPES = new Set(['task', 'exploration', 'classification']);

/**
 * Build the AI prompt asking a worker to synthesize a SKILLPACK.md for a task type.
 */
function buildSynthesisPrompt(taskType: string, totalTasks: number, successRate: number): string {
  const pct = Math.round(successRate * 100);
  return `You are a skill pack author for OpenBridge, an AI bridge system. Based on the task pattern described below, create a SKILLPACK.md that captures domain expertise and best practices for this type of work.

Task pattern:
- Type: "${taskType}"
- Total successful completions: ${totalTasks} (${pct}% success rate)

A SKILLPACK.md must follow this exact format:

# <name>

<one-paragraph description>

## Tool Profile
<one of: read-only, code-audit, code-edit, full-access>

## When to Use
<when to use this skill pack>

## Required Tools
- <tool1>
- <tool2>

## Tags
- <tag1>
- <tag2>

## Prompt Extension
<detailed, actionable instructions for workers performing this type of task — minimum 100 words>

## Constraints
- <constraint1>
- <constraint2>

Rules:
- Name must be a lowercase slug (hyphens only, no spaces, no special characters)
- Tool Profile must be exactly one of: read-only, code-audit, code-edit, full-access
- Prompt Extension must be at least 100 words and actionable
- Name must differ from built-ins: security-audit, code-review, test-writer, data-analysis, documentation

Respond with ONLY the SKILLPACK.md content. No explanations, no code fences.`;
}

/**
 * Synthesizes a single skill pack from a task type pattern using an AI worker.
 * Returns the created SkillPack on success, null on failure.
 */
async function synthesizeOneSkillPack(
  candidate: LearningsSummary,
  workspacePath: string,
  agentRunner: AgentRunner,
): Promise<SkillPack | null> {
  const { task_type: taskType, total_tasks: totalTasks, success_rate: successRate } = candidate;

  logger.info({ taskType, totalTasks, successRate }, 'Synthesizing skill pack from task pattern');

  const prompt = buildSynthesisPrompt(taskType, totalTasks, successRate);

  let result;
  try {
    result = await agentRunner.spawn({
      prompt,
      workspacePath,
      model: 'haiku',
      allowedTools: [...TOOLS_READ_ONLY],
      maxTurns: 3,
      retries: 1,
    });
  } catch (err) {
    logger.warn({ err, taskType }, 'Skill pack synthesis worker failed');
    return null;
  }

  if (result.exitCode !== 0 || !result.stdout.trim()) {
    logger.warn(
      { taskType, exitCode: result.exitCode },
      'Skill pack synthesis worker returned empty or failed output',
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
      { taskType, issues: parsed.error.issues },
      'Synthesized skill pack failed Zod validation — skipping',
    );
    return null;
  }

  // Persist to .openbridge/skill-packs/<name>.md
  const skillPacksDir = path.join(workspacePath, '.openbridge', 'skill-packs');
  try {
    await fs.mkdir(skillPacksDir, { recursive: true });
    const filePath = path.join(skillPacksDir, `${parsed.data.name}.md`);
    await fs.writeFile(filePath, skillPackToMarkdown(parsed.data), 'utf-8');
    logger.info(
      { name: parsed.data.name, taskType, file: filePath },
      'Synthesized skill pack saved to disk',
    );
  } catch (err) {
    logger.warn({ err, taskType }, 'Failed to save synthesized skill pack to disk');
    return null;
  }

  return parsed.data;
}

/**
 * Synthesizes new skill packs from successful task patterns stored in the learnings table.
 *
 * Scans learning records for task types that:
 * 1. Have at least {@link MIN_TASKS_FOR_SYNTHESIS} total completed tasks
 * 2. Have a success rate >= {@link MIN_SUCCESS_RATE_FOR_SYNTHESIS}
 * 3. Are not already covered by an existing built-in or user-defined skill pack
 * 4. Are not generic catch-all types (e.g., `'task'`, `'exploration'`, `'classification'`)
 *
 * For each eligible pattern, a Haiku worker is spawned to generate a SKILLPACK.md
 * which is validated and saved to `<workspacePath>/.openbridge/skill-packs/`.
 *
 * This extends the prompt evolution system — call it alongside {@link evolvePrompts}
 * every N task completions.
 *
 * @param memory        - MemoryManager for reading learning records.
 * @param agentRunner   - AgentRunner for spawning the synthesis worker.
 * @param workspacePath - Absolute path to the target workspace.
 * @returns Number of skill packs successfully synthesized and saved.
 */
export async function synthesizeSkillPacksFromPatterns(
  memory: MemoryManager,
  agentRunner: AgentRunner,
  workspacePath: string,
): Promise<number> {
  logger.info('Running skill pack synthesis cycle');

  // Query task types with high success rates across all models
  let candidates: LearningsSummary[];
  try {
    candidates = await memory.getHighSuccessLearnings(
      MIN_SUCCESS_RATE_FOR_SYNTHESIS,
      MIN_TASKS_FOR_SYNTHESIS,
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to query high-success learnings for skill pack synthesis');
    return 0;
  }

  if (candidates.length === 0) {
    logger.info('No task patterns eligible for skill pack synthesis');
    return 0;
  }

  // Load existing skill pack names (built-in + user-defined) to avoid duplicates
  const { packs: existingPacks } = await loadAllSkillPacks(workspacePath);
  const existingNames = new Set(existingPacks.map((p) => p.name));

  // Also map built-in pack names for fast lookup
  const builtInNames = new Set(BUILT_IN_SKILL_PACKS.map((p) => p.name));

  let synthesized = 0;

  for (const candidate of candidates) {
    const { task_type: taskType } = candidate;

    // Skip generic types that don't benefit from a skill pack
    if (GENERIC_TASK_TYPES.has(taskType)) continue;

    // Skip if a skill pack with the same name already exists
    if (builtInNames.has(taskType) || existingNames.has(taskType)) continue;

    const pack = await synthesizeOneSkillPack(candidate, workspacePath, agentRunner);
    if (pack) {
      existingNames.add(pack.name);
      synthesized++;
    }
  }

  logger.info({ synthesized }, 'Skill pack synthesis cycle complete');
  return synthesized;
}
