import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  SkillManager,
  parseSkillMarkdown,
  skillToMarkdown,
  normalizePattern,
  AUTO_CREATE_THRESHOLD,
} from '../../src/master/skill-manager.js';
import { formatSkillsSection } from '../../src/master/master-system-prompt.js';
import type { Skill } from '../../src/types/agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    name: 'code-review',
    description: 'Reviews code changes',
    toolProfile: 'read-only',
    toolsNeeded: ['Read', 'Glob'],
    examplePrompts: ['Review my PR', 'Check this diff'],
    constraints: ['Do not modify files'],
    isUserDefined: false,
    ...overrides,
  };
}

async function makeTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ob-skill-test-'));
}

// ---------------------------------------------------------------------------
// parseSkillMarkdown
// ---------------------------------------------------------------------------

describe('parseSkillMarkdown', () => {
  it('parses skill name from H1', () => {
    const md = '# my-skill\n\nA description.\n';
    const result = parseSkillMarkdown(md);
    expect(result.name).toBe('my-skill');
  });

  it('parses description (first paragraph after H1)', () => {
    const md = '# skill\n\nThis is the description.\n\n## Tool Profile\nread-only\n';
    const result = parseSkillMarkdown(md);
    expect(result.description).toBe('This is the description.');
  });

  it('parses toolProfile from ## Tool Profile section', () => {
    const md = '# skill\n\nDesc.\n\n## Tool Profile\ncode-edit\n';
    const result = parseSkillMarkdown(md);
    expect(result.toolProfile).toBe('code-edit');
  });

  it('parses toolsNeeded from ## Tools Needed bullets', () => {
    const md = '# skill\n\nDesc.\n\n## Tools Needed\n- Read\n- Glob\n- Write\n';
    const result = parseSkillMarkdown(md);
    expect(result.toolsNeeded).toEqual(['Read', 'Glob', 'Write']);
  });

  it('parses examplePrompts stripping surrounding quotes', () => {
    const md = '# skill\n\nDesc.\n\n## Example Prompts\n- "Review my PR"\n- \'Analyse diff\'\n';
    const result = parseSkillMarkdown(md);
    expect(result.examplePrompts).toEqual(['Review my PR', 'Analyse diff']);
  });

  it('parses constraints from ## Constraints bullets', () => {
    const md = '# skill\n\nDesc.\n\n## Constraints\n- Do not modify files\n- Read-only access\n';
    const result = parseSkillMarkdown(md);
    expect(result.constraints).toEqual(['Do not modify files', 'Read-only access']);
  });

  it('parses maxTurns from ## Max Turns section', () => {
    const md = '# skill\n\nDesc.\n\n## Max Turns\n15\n';
    const result = parseSkillMarkdown(md);
    expect(result.maxTurns).toBe(15);
  });

  it('parses systemPrompt from ## System Prompt section', () => {
    const md = '# skill\n\nDesc.\n\n## System Prompt\nYou are a reviewer.\nBe thorough.\n';
    const result = parseSkillMarkdown(md);
    expect(result.systemPrompt).toBe('You are a reviewer.\nBe thorough.');
  });

  it('handles empty content gracefully', () => {
    const result = parseSkillMarkdown('');
    expect(result.name).toBe('');
    expect(result.toolsNeeded).toEqual([]);
  });

  it('ignores unknown sections', () => {
    const md =
      '# skill\n\nDesc.\n\n## Unknown Section\nsome content\n\n## Tool Profile\nread-only\n';
    const result = parseSkillMarkdown(md);
    expect(result.toolProfile).toBe('read-only');
  });
});

// ---------------------------------------------------------------------------
// skillToMarkdown + round-trip
// ---------------------------------------------------------------------------

describe('skillToMarkdown', () => {
  it('serialises a skill to markdown with correct H1', () => {
    const skill = makeSkill();
    const md = skillToMarkdown(skill);
    expect(md).toContain('# code-review');
  });

  it('includes tool profile section', () => {
    const skill = makeSkill({ toolProfile: 'read-only' });
    const md = skillToMarkdown(skill);
    expect(md).toContain('## Tool Profile');
    expect(md).toContain('read-only');
  });

  it('includes tools needed section when list is non-empty', () => {
    const skill = makeSkill({ toolsNeeded: ['Read', 'Glob'] });
    const md = skillToMarkdown(skill);
    expect(md).toContain('## Tools Needed');
    expect(md).toContain('- Read');
    expect(md).toContain('- Glob');
  });

  it('omits tools needed section when list is empty', () => {
    const skill = makeSkill({ toolsNeeded: [] });
    const md = skillToMarkdown(skill);
    expect(md).not.toContain('## Tools Needed');
  });

  it('includes example prompts section', () => {
    const skill = makeSkill({ examplePrompts: ['Review my PR'] });
    const md = skillToMarkdown(skill);
    expect(md).toContain('## Example Prompts');
    expect(md).toContain('"Review my PR"');
  });

  it('includes maxTurns section when defined', () => {
    const skill = makeSkill({ maxTurns: 10 });
    const md = skillToMarkdown(skill);
    expect(md).toContain('## Max Turns');
    expect(md).toContain('10');
  });

  it('omits maxTurns section when undefined', () => {
    const skill = makeSkill({ maxTurns: undefined });
    const md = skillToMarkdown(skill);
    expect(md).not.toContain('## Max Turns');
  });

  it('round-trips: parseSkillMarkdown(skillToMarkdown(skill)) === original fields', () => {
    const original = makeSkill({
      name: 'test-runner',
      description: 'Runs tests and reports coverage',
      toolProfile: 'code-edit',
      toolsNeeded: ['Bash'],
      examplePrompts: ['Run the tests'],
      constraints: ['Run in CI mode'],
      maxTurns: 20,
      systemPrompt: 'You are a test executor.',
    });

    const md = skillToMarkdown(original);
    const parsed = parseSkillMarkdown(md);

    expect(parsed.name).toBe(original.name);
    expect(parsed.description).toBe(original.description);
    expect(parsed.toolProfile).toBe(original.toolProfile);
    expect(parsed.toolsNeeded).toEqual(original.toolsNeeded);
    expect(parsed.examplePrompts).toEqual(original.examplePrompts);
    expect(parsed.constraints).toEqual(original.constraints);
    expect(parsed.maxTurns).toBe(original.maxTurns);
    expect(parsed.systemPrompt).toBe(original.systemPrompt);
  });
});

// ---------------------------------------------------------------------------
// normalizePattern
// ---------------------------------------------------------------------------

describe('normalizePattern', () => {
  it('lowercases input', () => {
    expect(normalizePattern('REVIEW Code Changes')).toBe(normalizePattern('review code changes'));
  });

  it('strips file paths', () => {
    const result = normalizePattern('Review src/core/router.ts for security issues');
    expect(result).not.toContain('src');
    expect(result).toContain('review');
    expect(result).toContain('security');
  });

  it('strips file.ext tokens', () => {
    const result = normalizePattern('Fix bug in router.ts and config.json');
    expect(result).not.toContain('router');
    expect(result).not.toContain('config');
  });

  it('strips bare numbers', () => {
    const result = normalizePattern('Fix issue 42 in the codebase');
    expect(result).not.toMatch(/\b42\b/);
  });

  it('drops short words (length <= 2)', () => {
    const result = normalizePattern('Do a quick fix in it');
    expect(result).not.toContain(' a ');
    expect(result).not.toContain(' in ');
  });

  it('returns at most 5 significant words', () => {
    const words = normalizePattern(
      'analyse review refactor update improve restructure optimize architecture design patterns',
    ).split(' ');
    expect(words.length).toBeLessThanOrEqual(5);
  });

  it('returns empty string for empty input', () => {
    expect(normalizePattern('')).toBe('');
  });

  it('returns empty string when only stopwords / short words remain', () => {
    expect(normalizePattern('a b c d e f g')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// SkillManager — built-in registration
// ---------------------------------------------------------------------------

describe('SkillManager — built-in registration', () => {
  it('registerBuiltIn adds skill to in-memory map', async () => {
    const tmp = await makeTempWorkspace();
    const manager = new SkillManager(tmp);

    manager.registerBuiltIn(makeSkill({ name: 'code-review', isUserDefined: false }));

    expect(manager.getByName('code-review')).toBeDefined();
    expect(manager.size).toBe(1);
  });

  it('built-in skill isUserDefined is false', async () => {
    const tmp = await makeTempWorkspace();
    const manager = new SkillManager(tmp);

    manager.registerBuiltIn(makeSkill({ name: 'test-runner', isUserDefined: false }));

    const skill = manager.getByName('test-runner');
    expect(skill?.isUserDefined).toBe(false);
  });

  it('getBuiltIn returns only built-in skills', async () => {
    const tmp = await makeTempWorkspace();
    const manager = new SkillManager(tmp);

    manager.registerBuiltIn(makeSkill({ name: 'code-review' }));
    manager.registerBuiltIn(makeSkill({ name: 'test-runner' }));

    const builtIns = manager.getBuiltIn();
    expect(builtIns).toHaveLength(2);
    expect(builtIns.every((s) => !s.isUserDefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SkillManager — filesystem discovery
// ---------------------------------------------------------------------------

describe('SkillManager — filesystem discovery', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await makeTempWorkspace();
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('load() returns 0 when skills directory does not exist', async () => {
    const manager = new SkillManager(tmp);
    const count = await manager.load();
    expect(count).toBe(0);
  });

  it('load() reads a valid SKILL.md file and registers the skill', async () => {
    const skillsDir = path.join(tmp, '.openbridge', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    const md = [
      '# my-custom-skill',
      '',
      'Does something useful.',
      '',
      '## Tool Profile',
      'read-only',
      '',
      '## Tools Needed',
      '- Read',
      '',
      '## Example Prompts',
      '- "Do something"',
      '',
    ].join('\n');

    await fs.writeFile(path.join(skillsDir, 'my-custom-skill.md'), md, 'utf-8');

    const manager = new SkillManager(tmp);
    const count = await manager.load();

    expect(count).toBe(1);
    const skill = manager.getByName('my-custom-skill');
    expect(skill).toBeDefined();
    expect(skill?.isUserDefined).toBe(true);
    expect(skill?.toolProfile).toBe('read-only');
  });

  it('load() reads a valid JSON skill file', async () => {
    const skillsDir = path.join(tmp, '.openbridge', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    const skillData = {
      name: 'json-skill',
      description: 'A JSON-defined skill',
      toolProfile: 'code-edit',
      toolsNeeded: ['Bash'],
      examplePrompts: ['Run the script'],
      constraints: [],
      isUserDefined: false,
    };

    await fs.writeFile(path.join(skillsDir, 'json-skill.json'), JSON.stringify(skillData), 'utf-8');

    const manager = new SkillManager(tmp);
    const count = await manager.load();

    expect(count).toBe(1);
    expect(manager.getByName('json-skill')).toBeDefined();
  });

  it('load() skips dot-prefixed metadata files', async () => {
    const skillsDir = path.join(tmp, '.openbridge', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    // Stats and patterns files should be ignored
    await fs.writeFile(path.join(skillsDir, '.skill-stats.json'), '[]', 'utf-8');
    await fs.writeFile(path.join(skillsDir, '.task-patterns.json'), '[]', 'utf-8');

    const manager = new SkillManager(tmp);
    const count = await manager.load();
    expect(count).toBe(0);
  });

  it('load() skips invalid SKILL.md (missing required fields)', async () => {
    const skillsDir = path.join(tmp, '.openbridge', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    // Missing name and description — will fail SkillSchema validation
    await fs.writeFile(path.join(skillsDir, 'bad.md'), '## Tool Profile\nread-only\n', 'utf-8');

    const manager = new SkillManager(tmp);
    const count = await manager.load();
    expect(count).toBe(0);
  });

  it('user-defined skill overrides built-in with same name', async () => {
    const skillsDir = path.join(tmp, '.openbridge', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    const md = [
      '# code-review',
      '',
      'User-customised code review.',
      '',
      '## Tool Profile',
      'code-edit',
      '',
    ].join('\n');

    await fs.writeFile(path.join(skillsDir, 'code-review.md'), md, 'utf-8');

    const manager = new SkillManager(tmp);
    manager.registerBuiltIn(makeSkill({ name: 'code-review', toolProfile: 'read-only' }));

    await manager.load();

    const skill = manager.getByName('code-review');
    // User-defined version wins
    expect(skill?.toolProfile).toBe('code-edit');
    expect(skill?.isUserDefined).toBe(true);
  });

  it('load() is idempotent — second call without forceReload returns same count', async () => {
    const skillsDir = path.join(tmp, '.openbridge', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    const md = '# skill-a\n\nSome desc.\n\n## Tool Profile\nread-only\n';
    await fs.writeFile(path.join(skillsDir, 'skill-a.md'), md, 'utf-8');

    const manager = new SkillManager(tmp);
    await manager.load();
    const count2 = await manager.load(); // second call
    expect(count2).toBe(1);
    expect(manager.size).toBe(1);
  });

  it('forceReload re-reads the directory', async () => {
    const skillsDir = path.join(tmp, '.openbridge', 'skills');
    await fs.mkdir(skillsDir, { recursive: true });

    const manager = new SkillManager(tmp);
    await manager.load(); // empty load

    // Add a new skill file after initial load
    const md = '# late-skill\n\nLate addition.\n\n## Tool Profile\nread-only\n';
    await fs.writeFile(path.join(skillsDir, 'late-skill.md'), md, 'utf-8');

    const count = await manager.load(true); // forceReload
    expect(count).toBe(1);
    expect(manager.getByName('late-skill')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SkillManager — getByProfile
// ---------------------------------------------------------------------------

describe('SkillManager — getByProfile', () => {
  it('returns skills matching the given toolProfile', async () => {
    const tmp = await makeTempWorkspace();
    const manager = new SkillManager(tmp);

    manager.registerBuiltIn(makeSkill({ name: 'a', toolProfile: 'read-only' }));
    manager.registerBuiltIn(makeSkill({ name: 'b', toolProfile: 'code-edit' }));
    manager.registerBuiltIn(makeSkill({ name: 'c', toolProfile: 'read-only' }));

    const readOnly = manager.getByProfile('read-only');
    expect(readOnly).toHaveLength(2);
    expect(readOnly.every((s) => s.toolProfile === 'read-only')).toBe(true);
  });

  it('returns empty array for unknown profile', async () => {
    const tmp = await makeTempWorkspace();
    const manager = new SkillManager(tmp);
    expect(manager.getByProfile('nonexistent')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SkillManager — success tracking (recordSkillUsage / getSkillStats)
// ---------------------------------------------------------------------------

describe('SkillManager — success tracking', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await makeTempWorkspace();
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('recordSkillUsage creates a new stats entry on first use', async () => {
    const manager = new SkillManager(tmp);
    await manager.recordSkillUsage('code-review', true);

    const stats = await manager.getSkillStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]!.name).toBe('code-review');
    expect(stats[0]!.usageCount).toBe(1);
    expect(stats[0]!.successCount).toBe(1);
    expect(stats[0]!.failureCount).toBe(0);
    expect(stats[0]!.successRate).toBe(1);
  });

  it('recordSkillUsage accumulates usage counts across multiple calls', async () => {
    const manager = new SkillManager(tmp);
    await manager.recordSkillUsage('code-review', true);
    await manager.recordSkillUsage('code-review', true);
    await manager.recordSkillUsage('code-review', false);

    const stats = await manager.getSkillStats();
    const entry = stats.find((s) => s.name === 'code-review')!;
    expect(entry.usageCount).toBe(3);
    expect(entry.successCount).toBe(2);
    expect(entry.failureCount).toBe(1);
    expect(entry.successRate).toBeCloseTo(2 / 3);
  });

  it('getSkillStats sorts by usageCount descending', async () => {
    const manager = new SkillManager(tmp);
    await manager.recordSkillUsage('test-runner', true);
    await manager.recordSkillUsage('code-review', true);
    await manager.recordSkillUsage('code-review', true);

    const stats = await manager.getSkillStats();
    expect(stats[0]!.name).toBe('code-review');
    expect(stats[1]!.name).toBe('test-runner');
  });

  it('stats are persisted and reloaded by a new SkillManager instance', async () => {
    const manager1 = new SkillManager(tmp);
    await manager1.recordSkillUsage('code-review', true);
    await manager1.recordSkillUsage('code-review', false);

    // New instance reads from disk
    const manager2 = new SkillManager(tmp);
    const stats = await manager2.getSkillStats();
    const entry = stats.find((s) => s.name === 'code-review');
    expect(entry).toBeDefined();
    expect(entry!.usageCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// SkillManager — auto-creation from task patterns
// ---------------------------------------------------------------------------

describe('SkillManager — auto-creation from task patterns', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await makeTempWorkspace();
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('does NOT create skill before AUTO_CREATE_THRESHOLD successes', async () => {
    const manager = new SkillManager(tmp);
    const prompt = 'Review the codebase for security issues';

    for (let i = 0; i < AUTO_CREATE_THRESHOLD - 1; i++) {
      const result = await manager.maybeAutoCreateSkill(prompt, 'read-only', true);
      expect(result).toBeNull();
    }

    expect(manager.size).toBe(0);
  });

  it('creates skill exactly at AUTO_CREATE_THRESHOLD successes', async () => {
    const manager = new SkillManager(tmp);
    const prompt = 'Review the codebase for security vulnerabilities';
    let created: Skill | null = null;

    for (let i = 0; i < AUTO_CREATE_THRESHOLD; i++) {
      created = await manager.maybeAutoCreateSkill(prompt, 'read-only', true);
    }

    expect(created).not.toBeNull();
    expect(created!.name.startsWith('auto-')).toBe(true);
    expect(created!.toolProfile).toBe('read-only');
    expect(created!.isUserDefined).toBe(true);
  });

  it('auto-created skill is immediately available via getByName()', async () => {
    const manager = new SkillManager(tmp);
    const prompt = 'Analyse performance bottlenecks in the application';
    let created: Skill | null = null;

    for (let i = 0; i < AUTO_CREATE_THRESHOLD; i++) {
      created = await manager.maybeAutoCreateSkill(prompt, 'read-only', true);
    }

    expect(created).not.toBeNull();
    const retrieved = manager.getByName(created!.name);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe(created!.name);
  });

  it('auto-created skill is written to disk as a .md file', async () => {
    const manager = new SkillManager(tmp);
    const prompt = 'Run all the unit tests in the project suite';
    let created: Skill | null = null;

    for (let i = 0; i < AUTO_CREATE_THRESHOLD; i++) {
      created = await manager.maybeAutoCreateSkill(prompt, 'code-edit', true);
    }

    expect(created).not.toBeNull();

    const skillFile = path.join(tmp, '.openbridge', 'skills', `${created!.name}.md`);
    const content = await fs.readFile(skillFile, 'utf-8');
    expect(content).toContain(`# ${created!.name}`);
  });

  it('does not create skill again once already created (idempotent)', async () => {
    const manager = new SkillManager(tmp);
    const prompt = 'Audit dependencies for outdated packages vulnerabilities';

    // Reach threshold
    let created: Skill | null = null;
    for (let i = 0; i < AUTO_CREATE_THRESHOLD; i++) {
      created = await manager.maybeAutoCreateSkill(prompt, 'read-only', true);
    }
    expect(created).not.toBeNull();

    // One more success — should not create again
    const second = await manager.maybeAutoCreateSkill(prompt, 'read-only', true);
    expect(second).toBeNull();
  });

  it('failure increments failureCount but does not create skill', async () => {
    const manager = new SkillManager(tmp);
    const prompt = 'Generate API documentation from source code comments';

    for (let i = 0; i < AUTO_CREATE_THRESHOLD + 5; i++) {
      const result = await manager.maybeAutoCreateSkill(prompt, 'read-only', false);
      expect(result).toBeNull();
    }

    expect(manager.size).toBe(0);
  });

  it('different toolProfiles create separate pattern keys (no cross-profile merging)', async () => {
    const manager = new SkillManager(tmp);
    const prompt = 'Refactor the authentication module for clarity';

    // Alternate between profiles — threshold should not be reached for either
    for (let i = 0; i < AUTO_CREATE_THRESHOLD - 1; i++) {
      await manager.maybeAutoCreateSkill(prompt, 'read-only', true);
      await manager.maybeAutoCreateSkill(prompt, 'code-edit', true);
    }

    expect(manager.size).toBe(0);
  });

  it('patterns are persisted and restored by a new SkillManager instance', async () => {
    const manager1 = new SkillManager(tmp);
    const prompt = 'Scan workspace for configuration errors and issues';

    // Get close to threshold without hitting it
    for (let i = 0; i < AUTO_CREATE_THRESHOLD - 1; i++) {
      await manager1.maybeAutoCreateSkill(prompt, 'read-only', true);
    }

    // New instance loads persisted patterns and can trigger creation on next success
    const manager2 = new SkillManager(tmp);
    const result = await manager2.maybeAutoCreateSkill(prompt, 'read-only', true);

    expect(result).not.toBeNull();
    expect(result!.name.startsWith('auto-')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatSkillsSection — system prompt injection
// ---------------------------------------------------------------------------

describe('formatSkillsSection', () => {
  it('returns null for empty skills array', () => {
    expect(formatSkillsSection([])).toBeNull();
  });

  it('includes "## Available Skills" header', () => {
    const skills = [makeSkill()];
    const section = formatSkillsSection(skills);
    expect(section).toContain('## Available Skills');
  });

  it('includes each skill name', () => {
    const skills = [makeSkill({ name: 'code-review' }), makeSkill({ name: 'test-runner' })];
    const section = formatSkillsSection(skills)!;
    expect(section).toContain('code-review');
    expect(section).toContain('test-runner');
  });

  it('marks built-in skills as (built-in)', () => {
    const skill = makeSkill({ name: 'dependency-audit', isUserDefined: false });
    const section = formatSkillsSection([skill])!;
    expect(section).toContain('built-in');
  });

  it('marks user-defined skills as (user-defined)', () => {
    const skill = makeSkill({ name: 'custom-skill', isUserDefined: true });
    const section = formatSkillsSection([skill])!;
    expect(section).toContain('user-defined');
  });

  it('includes tool profile for each skill', () => {
    const skill = makeSkill({ toolProfile: 'read-only' });
    const section = formatSkillsSection([skill])!;
    expect(section).toContain('read-only');
  });

  it('includes example prompts (up to 3)', () => {
    const skill = makeSkill({ examplePrompts: ['Prompt A', 'Prompt B', 'Prompt C', 'Prompt D'] });
    const section = formatSkillsSection([skill])!;
    // Only first 3 should appear
    expect(section).toContain('Prompt A');
    expect(section).toContain('Prompt B');
    expect(section).toContain('Prompt C');
    expect(section).not.toContain('Prompt D');
  });

  it('includes maxTurns when defined', () => {
    const skill = makeSkill({ maxTurns: 12 });
    const section = formatSkillsSection([skill])!;
    expect(section).toContain('12');
  });
});
