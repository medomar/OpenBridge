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

/** Number of successful completions of the same task pattern required before auto-creating a skill */
export const AUTO_CREATE_THRESHOLD = 3;

/** Internal metadata file names (dot-prefixed, skipped during skill loading) */
const STATS_FILE = '.skill-stats.json';
const PATTERNS_FILE = '.task-patterns.json';

// ── Interfaces ────────────────────────────────────────────────────────────

/**
 * Per-skill usage statistics — tracked across invocations and persisted to
 * `.openbridge/skills/.skill-stats.json`.
 */
export interface SkillStats {
  name: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
  /** Ratio of successful invocations (0–1). */
  successRate: number;
  lastUsedAt?: string;
}

/** Internal: tracks how often a normalised task-prompt pattern has succeeded. */
interface TaskPattern {
  /** Normalised prompt pattern (first 5 significant words, lowercase). */
  pattern: string;
  /** Tool profile the task was run with (e.g. 'read-only', 'code-edit'). */
  toolProfile: string;
  successCount: number;
  failureCount: number;
  /** Up to 3 raw prompts that contributed to this pattern (used as examplePrompts). */
  examplePrompts: string[];
  /** Skill name written to disk once the threshold is reached. */
  autoCreatedSkillName?: string;
  lastSucceededAt?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────

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
 * Serialise a `Skill` object to SKILL.md format.
 *
 * The output is parseable by `parseSkillMarkdown()` — round-trips cleanly.
 */
export function skillToMarkdown(skill: Skill): string {
  const lines: string[] = [];

  lines.push(`# ${skill.name}`);
  lines.push('');
  lines.push(skill.description);
  lines.push('');

  lines.push('## Tool Profile');
  lines.push(skill.toolProfile);
  lines.push('');

  if (skill.toolsNeeded.length > 0) {
    lines.push('## Tools Needed');
    for (const tool of skill.toolsNeeded) {
      lines.push(`- ${tool}`);
    }
    lines.push('');
  }

  if (skill.examplePrompts.length > 0) {
    lines.push('## Example Prompts');
    for (const prompt of skill.examplePrompts) {
      lines.push(`- "${prompt}"`);
    }
    lines.push('');
  }

  if (skill.constraints.length > 0) {
    lines.push('## Constraints');
    for (const constraint of skill.constraints) {
      lines.push(`- ${constraint}`);
    }
    lines.push('');
  }

  if (skill.maxTurns !== undefined) {
    lines.push('## Max Turns');
    lines.push(String(skill.maxTurns));
    lines.push('');
  }

  if (skill.systemPrompt) {
    lines.push('## System Prompt');
    lines.push(skill.systemPrompt);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Normalise a raw task prompt into a short, reusable pattern key.
 *
 * Strategy:
 * 1. Lowercase everything.
 * 2. Strip file paths (`src/...`, `./...`, absolute paths).
 * 3. Strip file-extension tokens (e.g. `router.ts`, `config.json`).
 * 4. Strip bare numbers.
 * 5. Strip punctuation.
 * 6. Take the first 5 significant words (length > 2).
 *
 * Examples:
 *   "Review src/core/router.ts for security issues" → "review for security issues"
 *   "Run the tests in tests/core/" → "run tests"
 *   "Analyse performance of the database queries" → "analyse performance database queries"
 */
export function normalizePattern(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/(?:src\/|\.\/|\/[\w/.-]+)\S*/g, '') // strip file paths
    .replace(/\b\w+\.\w{1,5}\b/g, '') // strip file.ext tokens
    .replace(/\b\d+\b/g, '') // strip bare numbers
    .replace(/[^a-z\s]/g, ' ') // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2) // drop short/stop words
    .slice(0, 5)
    .join(' ');
}

// ── SkillManager ──────────────────────────────────────────────────────────

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
 *
 * ## Success tracking
 *
 * Call `recordSkillUsage(name, success)` after every skill invocation.
 * Stats are persisted to `.openbridge/skills/.skill-stats.json` and can be
 * retrieved via `getSkillStats()`.
 *
 * ## Auto-creation from task patterns
 *
 * Call `maybeAutoCreateSkill(taskPrompt, toolProfile, success)` after every
 * worker completion (even when no explicit skill was selected). When the same
 * normalised prompt pattern succeeds `AUTO_CREATE_THRESHOLD` times the manager
 * writes a new `<name>.md` file to `.openbridge/skills/` and registers the
 * skill in memory. Pattern state is persisted to
 * `.openbridge/skills/.task-patterns.json`.
 */
export class SkillManager {
  private readonly skillsPath: string;
  private readonly statsPath: string;
  private readonly patternsPath: string;

  private readonly skills: Map<string, Skill> = new Map();
  private readonly statsMap: Map<string, SkillStats> = new Map();
  private readonly patternMap: Map<string, TaskPattern> = new Map();

  private loaded = false;
  private statsLoaded = false;
  private patternsLoaded = false;

  constructor(workspacePath: string) {
    this.skillsPath = path.join(workspacePath, '.openbridge', SKILLS_DIR);
    this.statsPath = path.join(this.skillsPath, STATS_FILE);
    this.patternsPath = path.join(this.skillsPath, PATTERNS_FILE);
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
   * Dot-prefixed files (`.skill-stats.json`, `.task-patterns.json`, etc.) are
   * skipped automatically.
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

    // Skip dot-prefixed metadata files (.skill-stats.json, .task-patterns.json, etc.)
    const skillFiles = entries.filter(
      (e) => !e.startsWith('.') && SUPPORTED_EXTENSIONS.some((ext) => e.endsWith(ext)),
    );

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

  // ── Success tracking ──────────────────────────────────────────────────

  /**
   * Record a skill invocation outcome.
   *
   * Updates the in-memory stats map and persists to
   * `.openbridge/skills/.skill-stats.json`.
   *
   * @param skillName - The `name` field of the invoked skill.
   * @param success - `true` if the worker completed without error.
   */
  async recordSkillUsage(skillName: string, success: boolean): Promise<void> {
    await this.ensureStatsLoaded();

    const now = new Date().toISOString();
    const existing = this.statsMap.get(skillName);

    if (existing) {
      existing.usageCount++;
      if (success) existing.successCount++;
      else existing.failureCount++;
      existing.successRate = existing.successCount / existing.usageCount;
      existing.lastUsedAt = now;
    } else {
      this.statsMap.set(skillName, {
        name: skillName,
        usageCount: 1,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        successRate: success ? 1 : 0,
        lastUsedAt: now,
      });
    }

    await this.saveStats();
  }

  /**
   * Returns usage statistics for all skills that have been invoked at least
   * once, sorted by `usageCount` descending.
   *
   * Note: loads persisted stats on first call.
   */
  async getSkillStats(): Promise<SkillStats[]> {
    await this.ensureStatsLoaded();
    return Array.from(this.statsMap.values()).sort((a, b) => b.usageCount - a.usageCount);
  }

  // ── Auto-creation from task patterns ──────────────────────────────────

  /**
   * Observe a worker task completion and, if the same normalised prompt
   * pattern has succeeded `AUTO_CREATE_THRESHOLD` times, auto-create a new
   * skill definition and write it to `.openbridge/skills/<name>.md`.
   *
   * The newly created skill is also registered in memory so it is immediately
   * available via `getAll()` / `getByName()`.
   *
   * @param taskPrompt  - The raw prompt sent to the worker.
   * @param toolProfile - The tool profile the worker ran with.
   * @param success     - Whether the worker completed successfully.
   * @returns The newly created `Skill`, or `null` if no skill was created.
   */
  async maybeAutoCreateSkill(
    taskPrompt: string,
    toolProfile: string,
    success: boolean,
  ): Promise<Skill | null> {
    await this.ensurePatternsLoaded();

    const pattern = normalizePattern(taskPrompt);
    if (!pattern) return null;

    const key = `${pattern}::${toolProfile}`;
    const now = new Date().toISOString();

    const existing = this.patternMap.get(key);

    if (existing) {
      if (success) {
        existing.successCount++;
        existing.lastSucceededAt = now;
        if (taskPrompt && !existing.examplePrompts.includes(taskPrompt)) {
          existing.examplePrompts = [...existing.examplePrompts, taskPrompt].slice(-3);
        }
      } else {
        existing.failureCount++;
      }

      // Auto-create once the threshold is hit and a skill hasn't been created yet
      if (existing.successCount >= AUTO_CREATE_THRESHOLD && !existing.autoCreatedSkillName) {
        const skill = this.buildSkillFromPattern(existing);
        if (skill) {
          await this.writeSkillFile(skill);
          this.skills.set(skill.name, skill);
          existing.autoCreatedSkillName = skill.name;
          logger.info(
            { skill: skill.name, pattern, successCount: existing.successCount },
            'Auto-created skill from task pattern',
          );
          await this.savePatterns();
          return skill;
        }
      }
    } else {
      this.patternMap.set(key, {
        pattern,
        toolProfile,
        successCount: success ? 1 : 0,
        failureCount: success ? 0 : 1,
        examplePrompts: taskPrompt ? [taskPrompt] : [],
        lastSucceededAt: success ? now : undefined,
      });
    }

    await this.savePatterns();
    return null;
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

  // ── Stats persistence ─────────────────────────────────────────────

  private async ensureStatsLoaded(): Promise<void> {
    if (this.statsLoaded) return;
    await this.loadStats();
  }

  private async loadStats(): Promise<void> {
    try {
      const raw = await fs.readFile(this.statsPath, 'utf-8');
      const data = JSON.parse(raw) as SkillStats[];
      if (Array.isArray(data)) {
        for (const s of data) {
          if (s && typeof s.name === 'string') {
            this.statsMap.set(s.name, s);
          }
        }
      }
    } catch {
      // File doesn't exist yet — start fresh
    }
    this.statsLoaded = true;
  }

  private async saveStats(): Promise<void> {
    await this.ensureSkillsDir();
    const data = Array.from(this.statsMap.values());
    await fs.writeFile(this.statsPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ── Pattern persistence ───────────────────────────────────────────

  private async ensurePatternsLoaded(): Promise<void> {
    if (this.patternsLoaded) return;
    await this.loadPatterns();
  }

  private async loadPatterns(): Promise<void> {
    try {
      const raw = await fs.readFile(this.patternsPath, 'utf-8');
      const data = JSON.parse(raw) as TaskPattern[];
      if (Array.isArray(data)) {
        for (const p of data) {
          if (p && typeof p.pattern === 'string' && typeof p.toolProfile === 'string') {
            const key = `${p.pattern}::${p.toolProfile}`;
            this.patternMap.set(key, p);
          }
        }
      }
    } catch {
      // File doesn't exist yet — start fresh
    }
    this.patternsLoaded = true;
  }

  private async savePatterns(): Promise<void> {
    await this.ensureSkillsDir();
    const data = Array.from(this.patternMap.values());
    await fs.writeFile(this.patternsPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  // ── Directory helper ──────────────────────────────────────────────

  private async ensureSkillsDir(): Promise<void> {
    try {
      await fs.mkdir(this.skillsPath, { recursive: true });
    } catch {
      // Already exists — ignore
    }
  }

  // ── Auto-creation helpers ─────────────────────────────────────────

  /**
   * Build a minimal `Skill` object from an accumulated task pattern.
   * Returns `null` if the pattern is too short or a skill with that name
   * already exists.
   */
  private buildSkillFromPattern(pattern: TaskPattern): Skill | null {
    const words = pattern.pattern.split(/\s+/).filter(Boolean).slice(0, 3);
    if (words.length === 0) return null;

    const skillName = `auto-${words.join('-')}`;

    // Don't overwrite an existing skill
    if (this.skills.has(skillName)) return null;

    const description = `Auto-created skill for tasks matching "${pattern.pattern}". Generated from ${pattern.successCount} successful completions.`;

    return SkillSchema.parse({
      name: skillName,
      description,
      toolProfile: pattern.toolProfile,
      toolsNeeded: [],
      examplePrompts: pattern.examplePrompts.slice(0, 3),
      constraints: [],
      isUserDefined: true,
    });
  }

  /**
   * Serialise a `Skill` to SKILL.md format and write it to
   * `.openbridge/skills/<name>.md`.
   */
  private async writeSkillFile(skill: Skill): Promise<void> {
    await this.ensureSkillsDir();
    const content = skillToMarkdown(skill);
    const filePath = path.join(this.skillsPath, `${skill.name}.md`);
    await fs.writeFile(filePath, content, 'utf-8');
    logger.info({ filePath, skill: skill.name }, 'Wrote auto-created skill file');
  }
}
