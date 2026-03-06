import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  parseSkillPackMd,
  skillPackToMarkdown,
  loadSkillPackMarkdown,
} from '../../src/master/skill-pack-loader.js';
import type { SkillPack } from '../../src/types/agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePack(overrides: Partial<SkillPack> = {}): SkillPack {
  return {
    name: 'security-audit',
    description: 'Identifies security vulnerabilities in source code.',
    toolProfile: 'code-audit',
    systemPromptExtension: 'You are a security engineer. Focus on OWASP Top 10.',
    requiredTools: ['Bash(semgrep:*)'],
    tags: ['security', 'static-analysis'],
    isUserDefined: false,
    ...overrides,
  };
}

async function makeTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ob-skillpack-test-'));
}

// ---------------------------------------------------------------------------
// parseSkillPackMd
// ---------------------------------------------------------------------------

describe('parseSkillPackMd', () => {
  it('parses name from H1', () => {
    const md = '# security-audit\n\nSome description.\n';
    const result = parseSkillPackMd(md);
    expect(result.name).toBe('security-audit');
  });

  it('parses description from first paragraph after H1', () => {
    const md = '# pack\n\nThis is the description.\n\n## Tool Profile\nread-only\n';
    const result = parseSkillPackMd(md);
    expect(result.description).toBe('This is the description.');
  });

  it('parses toolProfile from ## Tool Profile section', () => {
    const md = '# pack\n\nDesc.\n\n## Tool Profile\ncode-audit\n';
    const result = parseSkillPackMd(md);
    expect(result.toolProfile).toBe('code-audit');
  });

  it('uses ## When to Use as description fallback when no first paragraph', () => {
    const md =
      '# pack\n\n## When to Use\nUse for security audits.\n\n## Tool Profile\ncode-audit\n';
    const result = parseSkillPackMd(md);
    expect(result.description).toBe('Use for security audits.');
  });

  it('parses requiredTools from ## Required Tools bullets', () => {
    const md = '# pack\n\nDesc.\n\n## Required Tools\n- Bash(semgrep:*)\n- Bash(grep:*)\n';
    const result = parseSkillPackMd(md);
    expect(result.requiredTools).toEqual(['Bash(semgrep:*)', 'Bash(grep:*)']);
  });

  it('parses tags from ## Tags bullets', () => {
    const md = '# pack\n\nDesc.\n\n## Tags\n- security\n- static-analysis\n';
    const result = parseSkillPackMd(md);
    expect(result.tags).toEqual(['security', 'static-analysis']);
  });

  it('parses systemPromptExtension from ## Prompt Extension section', () => {
    const md =
      '# pack\n\nDesc.\n\n## Prompt Extension\nYou are a security expert.\nFocus on OWASP.\n';
    const result = parseSkillPackMd(md);
    expect(result.systemPromptExtension).toBe('You are a security expert.\nFocus on OWASP.');
  });

  it('appends ## Constraints to systemPromptExtension', () => {
    const md =
      '# pack\n\nDesc.\n\n## Prompt Extension\nBase prompt.\n\n## Constraints\n- Never weaken checks\n';
    const result = parseSkillPackMd(md);
    expect(result.systemPromptExtension).toContain('Base prompt.');
    expect(result.systemPromptExtension).toContain('Constraints');
    expect(result.systemPromptExtension).toContain('Never weaken checks');
  });

  it('handles empty content gracefully', () => {
    const result = parseSkillPackMd('');
    expect(result.name).toBeUndefined();
    expect(result.requiredTools).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it('ignores unknown sections', () => {
    const md =
      '# pack\n\nDesc.\n\n## Some Unknown Section\nsome content\n\n## Tool Profile\nread-only\n';
    const result = parseSkillPackMd(md);
    expect(result.toolProfile).toBe('read-only');
  });

  it('parses a complete SKILLPACK.md with all sections', () => {
    const md = [
      '# code-review',
      '',
      'Reviews code changes for quality and best practices.',
      '',
      '## Tool Profile',
      'read-only',
      '',
      '## When to Use',
      'Use when reviewing PRs or checking code quality.',
      '',
      '## Required Tools',
      '- Read',
      '- Glob',
      '',
      '## Tags',
      '- review',
      '- quality',
      '',
      '## Prompt Extension',
      'You are an expert code reviewer.',
      'Look for logic errors and style issues.',
      '',
      '## Example Tasks',
      '- "Review my PR"',
      '- "Check this diff"',
      '',
      '## Constraints',
      '- Do not modify files',
      '- Read-only analysis only',
      '',
    ].join('\n');

    const result = parseSkillPackMd(md);
    expect(result.name).toBe('code-review');
    expect(result.description).toBe('Reviews code changes for quality and best practices.');
    expect(result.toolProfile).toBe('read-only');
    expect(result.requiredTools).toEqual(['Read', 'Glob']);
    expect(result.tags).toEqual(['review', 'quality']);
    expect(result.systemPromptExtension).toContain('You are an expert code reviewer.');
    expect(result.systemPromptExtension).toContain('Do not modify files');
  });
});

// ---------------------------------------------------------------------------
// skillPackToMarkdown
// ---------------------------------------------------------------------------

describe('skillPackToMarkdown', () => {
  it('serialises name as H1', () => {
    const pack = makePack();
    const md = skillPackToMarkdown(pack);
    expect(md).toContain('# security-audit');
  });

  it('includes description as first paragraph', () => {
    const pack = makePack({ description: 'Detect security issues.' });
    const md = skillPackToMarkdown(pack);
    expect(md).toContain('Detect security issues.');
  });

  it('includes ## Tool Profile section', () => {
    const pack = makePack({ toolProfile: 'code-audit' });
    const md = skillPackToMarkdown(pack);
    expect(md).toContain('## Tool Profile');
    expect(md).toContain('code-audit');
  });

  it('includes ## Required Tools when non-empty', () => {
    const pack = makePack({ requiredTools: ['Bash(semgrep:*)'] });
    const md = skillPackToMarkdown(pack);
    expect(md).toContain('## Required Tools');
    expect(md).toContain('- Bash(semgrep:*)');
  });

  it('omits ## Required Tools when empty', () => {
    const pack = makePack({ requiredTools: [] });
    const md = skillPackToMarkdown(pack);
    expect(md).not.toContain('## Required Tools');
  });

  it('includes ## Tags when non-empty', () => {
    const pack = makePack({ tags: ['security'] });
    const md = skillPackToMarkdown(pack);
    expect(md).toContain('## Tags');
    expect(md).toContain('- security');
  });

  it('includes ## Prompt Extension', () => {
    const pack = makePack({ systemPromptExtension: 'Focus on OWASP Top 10.' });
    const md = skillPackToMarkdown(pack);
    expect(md).toContain('## Prompt Extension');
    expect(md).toContain('Focus on OWASP Top 10.');
  });

  it('round-trips: parseSkillPackMd(skillPackToMarkdown(pack)) preserves all fields', () => {
    const original = makePack({
      name: 'data-analysis',
      description: 'Analyse CSV and JSON data.',
      toolProfile: 'read-only',
      systemPromptExtension: 'You are a data analyst.',
      requiredTools: ['Bash'],
      tags: ['data', 'analysis'],
    });

    const md = skillPackToMarkdown(original);
    const parsed = parseSkillPackMd(md);

    expect(parsed.name).toBe(original.name);
    expect(parsed.description).toBe(original.description);
    expect(parsed.toolProfile).toBe(original.toolProfile);
    expect(parsed.systemPromptExtension).toContain('You are a data analyst.');
    expect(parsed.requiredTools).toEqual(original.requiredTools);
    expect(parsed.tags).toEqual(original.tags);
  });
});

// ---------------------------------------------------------------------------
// loadSkillPackMarkdown
// ---------------------------------------------------------------------------

describe('loadSkillPackMarkdown', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await makeTempWorkspace();
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('returns count=0 when skill-packs directory does not exist', async () => {
    const result = await loadSkillPackMarkdown(tmp);
    expect(result.count).toBe(0);
    expect(result.packs.size).toBe(0);
  });

  it('loads a valid SKILLPACK.md file', async () => {
    const dir = path.join(tmp, '.openbridge', 'skill-packs');
    await fs.mkdir(dir, { recursive: true });

    const md = [
      '# security-audit',
      '',
      'Audits code for security vulnerabilities.',
      '',
      '## Tool Profile',
      'code-audit',
      '',
      '## Prompt Extension',
      'You are a security engineer. Focus on OWASP Top 10.',
      '',
    ].join('\n');

    await fs.writeFile(path.join(dir, 'security-audit.md'), md, 'utf-8');

    const result = await loadSkillPackMarkdown(tmp);
    expect(result.count).toBe(1);
    const pack = result.packs.get('security-audit');
    expect(pack).toBeDefined();
    expect(pack!.isUserDefined).toBe(true);
    expect(pack!.toolProfile).toBe('code-audit');
  });

  it('skips dot-prefixed files', async () => {
    const dir = path.join(tmp, '.openbridge', 'skill-packs');
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(
      path.join(dir, '.hidden.md'),
      '# hidden\n\nDesc.\n\n## Tool Profile\nread-only\n',
      'utf-8',
    );

    const result = await loadSkillPackMarkdown(tmp);
    expect(result.count).toBe(0);
  });

  it('skips SKILLPACK.md files that fail validation (missing required fields)', async () => {
    const dir = path.join(tmp, '.openbridge', 'skill-packs');
    await fs.mkdir(dir, { recursive: true });

    // Missing name and description — will fail SkillPackSchema validation
    await fs.writeFile(path.join(dir, 'bad.md'), '## Tool Profile\nread-only\n', 'utf-8');

    const result = await loadSkillPackMarkdown(tmp);
    expect(result.count).toBe(0);
  });

  it('loads multiple SKILLPACK.md files', async () => {
    const dir = path.join(tmp, '.openbridge', 'skill-packs');
    await fs.mkdir(dir, { recursive: true });

    const pack1 =
      '# security-audit\n\nSecurity checks.\n\n## Tool Profile\ncode-audit\n\n## Prompt Extension\nCheck for vulnerabilities.\n';
    const pack2 =
      '# code-review\n\nCode quality review.\n\n## Tool Profile\nread-only\n\n## Prompt Extension\nReview the code carefully.\n';

    await fs.writeFile(path.join(dir, 'security-audit.md'), pack1, 'utf-8');
    await fs.writeFile(path.join(dir, 'code-review.md'), pack2, 'utf-8');

    const result = await loadSkillPackMarkdown(tmp);
    expect(result.count).toBe(2);
    expect(result.packs.has('security-audit')).toBe(true);
    expect(result.packs.has('code-review')).toBe(true);
  });

  it('loaded packs have isUserDefined=true', async () => {
    const dir = path.join(tmp, '.openbridge', 'skill-packs');
    await fs.mkdir(dir, { recursive: true });

    const md =
      '# test-pack\n\nA test pack.\n\n## Tool Profile\nread-only\n\n## Prompt Extension\nBe helpful.\n';
    await fs.writeFile(path.join(dir, 'test-pack.md'), md, 'utf-8');

    const result = await loadSkillPackMarkdown(tmp);
    const pack = result.packs.get('test-pack');
    expect(pack!.isUserDefined).toBe(true);
  });

  it('non-.md files in skill-packs dir are not processed by loadSkillPackMarkdown', async () => {
    const dir = path.join(tmp, '.openbridge', 'skill-packs');
    await fs.mkdir(dir, { recursive: true });

    // .js file should be handled by loadSkillPacks(), not this function
    await fs.writeFile(path.join(dir, 'some.js'), 'export default {}', 'utf-8');

    const result = await loadSkillPackMarkdown(tmp);
    expect(result.count).toBe(0);
  });
});
