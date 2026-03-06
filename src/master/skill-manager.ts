import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { SkillSchema } from '../types/agent.js';
import type { Skill } from '../types/agent.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('skill-manager');

/** Directory name inside `.openbridge/` where user-defined skills are stored */
const SKILLS_DIR = 'skills';

/** Supported user-defined skill file extensions */
const SUPPORTED_EXTENSIONS = ['.json', '.js', '.cjs', '.mjs'];

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
 *    as `.json`, `.js`, `.cjs`, or `.mjs` files
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
      return await this.loadModuleSkill(filePath, fileName);
    } catch (err) {
      logger.warn({ file: fileName, err }, 'Failed to load skill file');
      return null;
    }
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
