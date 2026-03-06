import path from 'path';
import fs from 'fs/promises';

import { DocumentSkillSchema, SkillPackSchema } from '../types/agent.js';
import type { DocumentSkill, SkillPack } from '../types/agent.js';
import { createLogger } from '../core/logger.js';

import { documentWriterSkill } from './skill-packs/document-writer.js';
import { presentationMakerSkill } from './skill-packs/presentation-maker.js';
import { spreadsheetBuilderSkill } from './skill-packs/spreadsheet-builder.js';
import { reportGeneratorSkill } from './skill-packs/report-generator.js';

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
