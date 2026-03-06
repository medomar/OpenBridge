import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { SkillSchema } from '../types/agent.js';
import type { Skill } from '../types/agent.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('skill-manager');

/** Directory name inside `.openbridge/` where user-defined skills are stored */
const SKILLS_DIR = 'skills';

/** Supported user-defined skill file extensions */
const SUPPORTED_EXTENSIONS = ['.json', '.js', '.cjs', '.mjs', '.md'];

/**
 * Parse a SKILL.md file into a `Skill` object.
 *
 * Expected format:
 * ```markdown
 * # skill-name
 *
 * One-line description of what this skill does.
 *
 * ## Tool Profile
 * read-only
 *
 * ## Tools Needed
 * - Read
 * - Glob
 *
 * ## Example Prompts
 * - "Review my code changes"
 * - "Analyze this PR"
 *
 * ## Constraints
 * - Do not modify any files
 *
 * ## Max Turns
 * 10
 *
 * ## System Prompt
 * You are a specialized code reviewer...
 * ```
 *
 * Rules:
 * - H1 (`#`) → `name`
 * - First non-empty paragraph after H1 (before any H2) → `description`
 * - `## Tool Profile` section → `toolProfile` (first non-empty line)
 * - `## Tools Needed` section → bullet list → `toolsNeeded`
 * - `## Example Prompts` section → bullet list → `examplePrompts` (quotes stripped)
 * - `## Constraints` section → bullet list → `constraints`
 * - `## Max Turns` section → integer → `maxTurns`
 * - `## System Prompt` section → multi-line content → `systemPrompt`
 */
export function parseSkillMarkdown(content: string): Partial<Record<string, unknown>> {
  const lines = content.split('\n');

  let name = '';
  let description = '';
  let toolProfile = '';
  const toolsNeeded: string[] = [];
  const examplePrompts: string[] = [];
  const constraints: string[] = [];
  let maxTurns: number | undefined;
  let systemPrompt = '';

  type Section =
    | 'preamble'
    | 'tool-profile'
    | 'tools-needed'
    | 'example-prompts'
    | 'constraints'
    | 'max-turns'
    | 'system-prompt';

  let section: Section = 'preamble';
  const descriptionLines: string[] = [];
  const systemPromptLines: string[] = [];

  for (const raw of lines) {
    const line = raw.trimEnd();

    // H1 = skill name
    if (/^#\s+/.test(line) && !/^##/.test(line)) {
      name = line.replace(/^#\s+/, '').trim();
      section = 'preamble';
      continue;
    }

    // H2 = section switch
    if (/^##\s+/.test(line)) {
      const heading = line
        .replace(/^##\s+/, '')
        .trim()
        .toLowerCase();
      if (heading === 'tool profile') section = 'tool-profile';
      else if (heading === 'tools needed') section = 'tools-needed';
      else if (heading === 'example prompts') section = 'example-prompts';
      else if (heading === 'constraints') section = 'constraints';
      else if (heading === 'max turns') section = 'max-turns';
      else if (heading === 'system prompt') section = 'system-prompt';
      else section = 'preamble'; // unknown section — ignore content
      continue;
    }

    switch (section) {
      case 'preamble':
        // Collect description lines (first content block after H1)
        if (line.trim() || descriptionLines.length > 0) {
          descriptionLines.push(line);
        }
        break;

      case 'tool-profile':
        if (!toolProfile && line.trim()) {
          toolProfile = line.trim();
        }
        break;

      case 'tools-needed': {
        const item = parseBulletItem(line);
        if (item) toolsNeeded.push(item);
        break;
      }

      case 'example-prompts': {
        const item = parseBulletItem(line);
        if (item) examplePrompts.push(item.replace(/^["']|["']$/g, ''));
        break;
      }

      case 'constraints': {
        const item = parseBulletItem(line);
        if (item) constraints.push(item);
        break;
      }

      case 'max-turns': {
        if (maxTurns === undefined && line.trim()) {
          const n = parseInt(line.trim(), 10);
          if (!isNaN(n) && n > 0) maxTurns = n;
        }
        break;
      }

      case 'system-prompt':
        systemPromptLines.push(line);
        break;
    }
  }

  // Trim description to first non-empty paragraph
  description = (descriptionLines.join('\n').trim().split(/\n\n+/)[0] ?? '').trim();

  systemPrompt = systemPromptLines.join('\n').trim();

  return {
    name,
    description,
    toolProfile,
    toolsNeeded,
    examplePrompts,
    constraints,
    ...(maxTurns !== undefined ? { maxTurns } : {}),
    ...(systemPrompt ? { systemPrompt } : {}),
  };
}

/** Extract the text content of a markdown bullet list item (`- foo` or `* foo`). */
function parseBulletItem(line: string): string | null {
  const match = /^[*-]\s+(.+)$/.exec(line.trim());
  return match?.[1]?.trim() ?? null;
}

/**
 * Manages skill definitions for OpenBridge.
 *
 * Skills are reusable task templates that the Master AI can use to spawn
 * workers for common development tasks (code review, testing, dependency
 * audit, API docs generation, etc.).
 *
 * Skill definitions are loaded from two sources:
 * 1. **Built-in skills** — registered programmatically via `registerBuiltIn()`
 * 2. **User-defined skills** — discovered from `<workspacePath>/.openbridge/skills/`
 *    as `.md`, `.json`, `.js`, `.cjs`, or `.mjs` files
 *
 * User-defined skills with the same `name` as a built-in skill override the
 * built-in, allowing workspace-specific customisation.
 */
export class SkillManager {
  private readonly skillsPath: string;
  private readonly skills: Map<string, Skill> = new Map();
  private loaded = false;

  constructor(workspacePath: string) {
    this.skillsPath = path.join(workspacePath, '.openbridge', SKILLS_DIR);
  }

  /**
   * Register a built-in skill definition programmatically.
   * Must be called before `load()` to ensure correct override precedence.
   */
  registerBuiltIn(skill: Skill): void {
    this.skills.set(skill.name, { ...skill, isUserDefined: false });
  }

  /**
   * Discover and load user-defined skill definitions from `.openbridge/skills/`.
   *
   * Supported formats:
   * - `.md` — SKILL.md document parsed by `parseSkillMarkdown()`
   * - `.json` — plain JSON object validated against `SkillSchema`
   * - `.js` / `.cjs` / `.mjs` — ES/CJS module with a default export or any
   *   named export that validates against `SkillSchema`
   *
   * Safe to call multiple times — subsequent calls are no-ops unless
   * `forceReload` is `true`.
   *
   * @param forceReload - When `true`, re-reads the skills directory even if
   *   already loaded (useful after the user drops a new skill file).
   * @returns Number of user-defined skills successfully loaded.
   */
  async load(forceReload = false): Promise<number> {
    if (this.loaded && !forceReload) return this.countUserDefined();

    let entries: string[];
    try {
      entries = await fs.readdir(this.skillsPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Directory doesn't exist — normal; only built-ins are used
        this.loaded = true;
        return 0;
      }
      logger.warn({ skillsPath: this.skillsPath, err }, 'Error reading skills directory');
      this.loaded = true;
      return 0;
    }

    const skillFiles = entries.filter((e) => SUPPORTED_EXTENSIONS.some((ext) => e.endsWith(ext)));

    let loadedCount = 0;

    for (const file of skillFiles) {
      const filePath = path.join(this.skillsPath, file);
      const skill = await this.loadSkillFile(filePath, file);
      if (skill) {
        this.skills.set(skill.name, { ...skill, isUserDefined: true });
        loadedCount++;
        logger.info({ skill: skill.name, file }, 'Loaded user-defined skill');
      }
    }

    this.loaded = true;
    return loadedCount;
  }

  /**
   * Returns all registered skills (built-in + user-defined).
   * Callers should `await load()` first to include user-defined skills.
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Find a skill by exact name (case-sensitive).
   * Returns `undefined` if no skill with that name is registered.
   */
  getByName(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Find all skills whose `toolProfile` matches the given profile name.
   * Useful when the Master AI wants to pick a skill for a specific profile.
   */
  getByProfile(toolProfile: string): Skill[] {
    return this.getAll().filter((s) => s.toolProfile === toolProfile);
  }

  /**
   * Returns all user-defined skills (loaded from `.openbridge/skills/`).
   */
  getUserDefined(): Skill[] {
    return this.getAll().filter((s) => s.isUserDefined);
  }

  /**
   * Returns all built-in skills (registered via `registerBuiltIn()`).
   */
  getBuiltIn(): Skill[] {
    return this.getAll().filter((s) => !s.isUserDefined);
  }

  /**
   * Total number of registered skills (built-in + user-defined).
   */
  get size(): number {
    return this.skills.size;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private countUserDefined(): number {
    return this.getUserDefined().length;
  }

  private async loadSkillFile(filePath: string, fileName: string): Promise<Skill | null> {
    try {
      if (fileName.endsWith('.json')) {
        return await this.loadJsonSkill(filePath);
      }
      if (fileName.endsWith('.md')) {
        return await this.loadMarkdownSkill(filePath);
      }
      return await this.loadModuleSkill(filePath, fileName);
    } catch (err) {
      logger.warn({ file: fileName, err }, 'Failed to load skill file');
      return null;
    }
  }

  private async loadMarkdownSkill(filePath: string): Promise<Skill | null> {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = parseSkillMarkdown(content);
    const parsed = SkillSchema.safeParse(data);
    if (!parsed.success) {
      logger.warn({ filePath, errors: parsed.error.issues }, 'SKILL.md does not match SkillSchema');
      return null;
    }
    return parsed.data;
  }

  private async loadJsonSkill(filePath: string): Promise<Skill | null> {
    const raw = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(raw) as unknown;
    const parsed = SkillSchema.safeParse(data);
    if (!parsed.success) {
      logger.warn(
        { filePath, errors: parsed.error.issues },
        'Skill JSON does not match SkillSchema',
      );
      return null;
    }
    return parsed.data;
  }

  private async loadModuleSkill(filePath: string, fileName: string): Promise<Skill | null> {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const mod = await import(filePath);
    const candidates = Object.values(mod as Record<string, unknown>);

    for (const candidate of candidates) {
      const parsed = SkillSchema.safeParse(candidate);
      if (parsed.success) {
        return parsed.data;
      }
    }

    logger.warn({ file: fileName }, 'Skill module has no valid Skill export');
    return null;
  }
}
