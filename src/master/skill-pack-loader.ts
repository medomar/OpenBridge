import path from 'path';
import fs from 'fs/promises';

import { DocumentSkillSchema } from '../types/agent.js';
import type { DocumentSkill } from '../types/agent.js';
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
