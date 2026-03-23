/**
 * OB-1487 — Cloud storage skill pack structure, prompt content,
 * and SHARE marker integration tests.
 */

import { describe, it, expect } from 'vitest';
import { cloudStorageSkillPack } from '../../../src/master/skill-packs/cloud-storage.js';
import { BUILT_IN_SKILL_PACKS } from '../../../src/master/skill-packs/index.js';

// ── 1. Skill Pack Structure ───────────────────────────────────────────────────

describe('cloudStorageSkillPack — structure', () => {
  it('exports a skill pack with name "cloud-storage"', () => {
    expect(cloudStorageSkillPack.name).toBe('cloud-storage');
  });

  it('has a non-empty description', () => {
    expect(cloudStorageSkillPack.description.length).toBeGreaterThan(0);
  });

  it('has toolProfile "full-access"', () => {
    expect(cloudStorageSkillPack.toolProfile).toBe('full-access');
  });

  it('has a non-empty requiredTools array', () => {
    expect(Array.isArray(cloudStorageSkillPack.requiredTools)).toBe(true);
    expect(cloudStorageSkillPack.requiredTools.length).toBeGreaterThan(0);
  });

  it('requiredTools includes rclone Bash pattern', () => {
    expect(cloudStorageSkillPack.requiredTools.some((t) => t.includes('rclone'))).toBe(true);
  });

  it('requiredTools includes aws Bash pattern', () => {
    expect(cloudStorageSkillPack.requiredTools.some((t) => t.includes('aws'))).toBe(true);
  });

  it('has a tags array that includes "cloud-storage"', () => {
    expect(Array.isArray(cloudStorageSkillPack.tags)).toBe(true);
    expect(cloudStorageSkillPack.tags).toContain('cloud-storage');
  });

  it('tags include "google-drive"', () => {
    expect(cloudStorageSkillPack.tags).toContain('google-drive');
  });

  it('tags include "s3"', () => {
    expect(cloudStorageSkillPack.tags).toContain('s3');
  });

  it('tags include "upload"', () => {
    expect(cloudStorageSkillPack.tags).toContain('upload');
  });

  it('has isUserDefined=false', () => {
    expect(cloudStorageSkillPack.isUserDefined).toBe(false);
  });

  it('has a non-empty systemPromptExtension', () => {
    expect(typeof cloudStorageSkillPack.systemPromptExtension).toBe('string');
    expect(cloudStorageSkillPack.systemPromptExtension.length).toBeGreaterThan(0);
  });
});

// ── 2. MCP Catalog Check Instructions ────────────────────────────────────────

describe('cloudStorageSkillPack — MCP catalog check instructions', () => {
  const prompt = cloudStorageSkillPack.systemPromptExtension;

  it('systemPromptExtension mentions "Available MCP Servers"', () => {
    expect(prompt).toContain('Available MCP Servers');
  });

  it('systemPromptExtension mentions google-drive MCP server', () => {
    expect(prompt).toContain('google-drive');
  });

  it('systemPromptExtension mentions dropbox MCP server', () => {
    expect(prompt).toContain('dropbox');
  });

  it('systemPromptExtension mentions onedrive MCP server', () => {
    expect(prompt).toContain('onedrive');
  });

  it('systemPromptExtension includes --mcp-config reference', () => {
    expect(prompt).toContain('--mcp-config');
  });

  it('systemPromptExtension describes MCP as preferred mechanism', () => {
    expect(prompt.toLowerCase()).toContain('preferred');
  });
});

// ── 3. CLI Fallback Instructions ──────────────────────────────────────────────

describe('cloudStorageSkillPack — CLI fallback instructions', () => {
  const prompt = cloudStorageSkillPack.systemPromptExtension;

  it('systemPromptExtension mentions rclone', () => {
    expect(prompt).toContain('rclone');
  });

  it('systemPromptExtension mentions gdrive', () => {
    expect(prompt).toContain('gdrive');
  });

  it('systemPromptExtension mentions aws s3 or aws cli', () => {
    expect(prompt).toContain('aws');
  });

  it('systemPromptExtension mentions dropbox-cli fallback', () => {
    expect(prompt).toContain('dropbox-cli');
  });

  it('systemPromptExtension describes fallback step for missing MCP', () => {
    expect(prompt.toLowerCase()).toContain('fallback');
  });

  it('systemPromptExtension includes rclone copy command example', () => {
    expect(prompt).toContain('rclone copy');
  });

  it('systemPromptExtension includes aws s3 cp command example', () => {
    expect(prompt).toContain('aws s3 cp');
  });

  it('systemPromptExtension includes which command for CLI detection', () => {
    expect(prompt).toContain('which');
  });
});

// ── 4. SHARE Marker Integration ───────────────────────────────────────────────

describe('cloudStorageSkillPack — SHARE marker integration', () => {
  const prompt = cloudStorageSkillPack.systemPromptExtension;

  it('systemPromptExtension references [SHARE: marker format', () => {
    expect(prompt).toContain('[SHARE:');
  });

  it('systemPromptExtension includes [SHARE:gdrive: marker', () => {
    expect(prompt).toContain('[SHARE:gdrive:');
  });

  it('systemPromptExtension includes [SHARE:dropbox: marker', () => {
    expect(prompt).toContain('[SHARE:dropbox:');
  });

  it('systemPromptExtension includes [SHARE:s3: marker', () => {
    expect(prompt).toContain('[SHARE:s3:');
  });

  it('systemPromptExtension instructs to return a shareable link', () => {
    expect(prompt.toLowerCase()).toContain('shareable link');
  });
});

// ── 5. Registration in BUILT_IN_SKILL_PACKS ───────────────────────────────────

describe('cloud-storage in BUILT_IN_SKILL_PACKS', () => {
  it('BUILT_IN_SKILL_PACKS includes cloud-storage pack', () => {
    const names = BUILT_IN_SKILL_PACKS.map((p) => p.name);
    expect(names).toContain('cloud-storage');
  });

  it('cloud-storage entry in BUILT_IN_SKILL_PACKS matches direct import', () => {
    const fromRegistry = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'cloud-storage');
    expect(fromRegistry).toBe(cloudStorageSkillPack);
  });
});
