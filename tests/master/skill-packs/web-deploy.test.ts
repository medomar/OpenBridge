/**
 * OB-1488 — Web deploy skill pack structure, prompt content,
 * auth token handling, and URL return instruction tests.
 */

import { describe, it, expect } from 'vitest';
import { webDeploySkillPack } from '../../../src/master/skill-packs/web-deploy.js';
import { BUILT_IN_SKILL_PACKS } from '../../../src/master/skill-packs/index.js';

// ── 1. Skill Pack Structure ───────────────────────────────────────────────────

describe('webDeploySkillPack — structure', () => {
  it('exports a skill pack with name "web-deploy"', () => {
    expect(webDeploySkillPack.name).toBe('web-deploy');
  });

  it('has a non-empty description', () => {
    expect(webDeploySkillPack.description.length).toBeGreaterThan(0);
  });

  it('has toolProfile "full-access"', () => {
    expect(webDeploySkillPack.toolProfile).toBe('full-access');
  });

  it('has a non-empty requiredTools array', () => {
    expect(Array.isArray(webDeploySkillPack.requiredTools)).toBe(true);
    expect(webDeploySkillPack.requiredTools.length).toBeGreaterThan(0);
  });

  it('requiredTools includes npx Bash pattern', () => {
    expect(webDeploySkillPack.requiredTools.some((t) => t.includes('npx'))).toBe(true);
  });

  it('requiredTools includes vercel Bash pattern', () => {
    expect(webDeploySkillPack.requiredTools.some((t) => t.includes('vercel'))).toBe(true);
  });

  it('requiredTools includes netlify Bash pattern', () => {
    expect(webDeploySkillPack.requiredTools.some((t) => t.includes('netlify'))).toBe(true);
  });

  it('requiredTools includes wrangler Bash pattern', () => {
    expect(webDeploySkillPack.requiredTools.some((t) => t.includes('wrangler'))).toBe(true);
  });

  it('has a tags array that includes "web-deploy"', () => {
    expect(Array.isArray(webDeploySkillPack.tags)).toBe(true);
    expect(webDeploySkillPack.tags).toContain('web-deploy');
  });

  it('tags include "vercel"', () => {
    expect(webDeploySkillPack.tags).toContain('vercel');
  });

  it('tags include "netlify"', () => {
    expect(webDeploySkillPack.tags).toContain('netlify');
  });

  it('tags include "cloudflare"', () => {
    expect(webDeploySkillPack.tags).toContain('cloudflare');
  });

  it('has isUserDefined=false', () => {
    expect(webDeploySkillPack.isUserDefined).toBe(false);
  });

  it('has a non-empty systemPromptExtension', () => {
    expect(typeof webDeploySkillPack.systemPromptExtension).toBe('string');
    expect(webDeploySkillPack.systemPromptExtension.length).toBeGreaterThan(0);
  });
});

// ── 2. Deploy CLI Detection Instructions ─────────────────────────────────────

describe('webDeploySkillPack — deploy CLI detection', () => {
  const prompt = webDeploySkillPack.systemPromptExtension;

  it('systemPromptExtension mentions vercel CLI detection', () => {
    expect(prompt).toContain('vercel');
  });

  it('systemPromptExtension mentions netlify CLI detection', () => {
    expect(prompt).toContain('netlify');
  });

  it('systemPromptExtension mentions wrangler CLI detection', () => {
    expect(prompt).toContain('wrangler');
  });

  it('systemPromptExtension includes --version check for CLI detection', () => {
    expect(prompt).toContain('--version');
  });

  it('systemPromptExtension suggests installing a deploy CLI when none are available', () => {
    expect(prompt.toLowerCase()).toContain('install');
  });

  it('systemPromptExtension includes npx vercel deploy command', () => {
    expect(prompt).toContain('npx vercel');
  });

  it('systemPromptExtension includes npx netlify deploy command', () => {
    expect(prompt).toContain('npx netlify');
  });

  it('systemPromptExtension includes npx wrangler pages deploy command', () => {
    expect(prompt).toContain('npx wrangler');
  });
});

// ── 3. Auth Token Handling ────────────────────────────────────────────────────

describe('webDeploySkillPack — auth token handling', () => {
  const prompt = webDeploySkillPack.systemPromptExtension;

  it('systemPromptExtension mentions VERCEL_TOKEN env variable', () => {
    expect(prompt).toContain('VERCEL_TOKEN');
  });

  it('systemPromptExtension mentions NETLIFY_AUTH_TOKEN env variable', () => {
    expect(prompt).toContain('NETLIFY_AUTH_TOKEN');
  });

  it('systemPromptExtension mentions CLOUDFLARE_API_TOKEN env variable', () => {
    expect(prompt).toContain('CLOUDFLARE_API_TOKEN');
  });

  it('systemPromptExtension describes interactive login flow', () => {
    expect(prompt.toLowerCase()).toContain('login');
  });

  it('systemPromptExtension mentions auth or authentication', () => {
    expect(prompt.toLowerCase()).toMatch(/auth/i);
  });
});

// ── 4. URL Return Instructions ────────────────────────────────────────────────

describe('webDeploySkillPack — URL return instruction', () => {
  const prompt = webDeploySkillPack.systemPromptExtension;

  it('systemPromptExtension instructs to return a live URL', () => {
    expect(prompt.toLowerCase()).toContain('url');
  });

  it('systemPromptExtension mentions "live" in the context of URLs', () => {
    expect(prompt.toLowerCase()).toContain('live');
  });

  it('systemPromptExtension describes a deployment success message format', () => {
    expect(prompt.toLowerCase()).toContain('deployment successful');
  });

  it('systemPromptExtension includes "Live URL:" in the response format', () => {
    expect(prompt).toContain('Live URL:');
  });

  it('systemPromptExtension mentions extracting the URL from CLI output', () => {
    expect(prompt.toLowerCase()).toContain('extract');
  });
});

// ── 5. Registration in BUILT_IN_SKILL_PACKS ───────────────────────────────────

describe('web-deploy in BUILT_IN_SKILL_PACKS', () => {
  it('BUILT_IN_SKILL_PACKS includes web-deploy pack', () => {
    const names = BUILT_IN_SKILL_PACKS.map((p) => p.name);
    expect(names).toContain('web-deploy');
  });

  it('web-deploy entry in BUILT_IN_SKILL_PACKS matches direct import', () => {
    const fromRegistry = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'web-deploy');
    expect(fromRegistry).toBe(webDeploySkillPack);
  });
});
