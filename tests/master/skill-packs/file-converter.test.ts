/**
 * OB-1490 — File converter skill pack structure, prompt content,
 * OCR instructions, and tool prioritization tests.
 */

import { describe, it, expect } from 'vitest';
import { fileConverterSkillPack } from '../../../src/master/skill-packs/file-converter.js';
import { BUILT_IN_SKILL_PACKS } from '../../../src/master/skill-packs/index.js';

// ── 1. Skill Pack Structure ───────────────────────────────────────────────────

describe('fileConverterSkillPack — structure', () => {
  it('exports a skill pack with name "file-converter"', () => {
    expect(fileConverterSkillPack.name).toBe('file-converter');
  });

  it('has a non-empty description', () => {
    expect(fileConverterSkillPack.description.length).toBeGreaterThan(0);
  });

  it('has toolProfile "full-access"', () => {
    expect(fileConverterSkillPack.toolProfile).toBe('full-access');
  });

  it('has a non-empty requiredTools array', () => {
    expect(Array.isArray(fileConverterSkillPack.requiredTools)).toBe(true);
    expect(fileConverterSkillPack.requiredTools.length).toBeGreaterThan(0);
  });

  it('requiredTools includes Bash(pandoc:*)', () => {
    expect(fileConverterSkillPack.requiredTools).toContain('Bash(pandoc:*)');
  });

  it('requiredTools includes Bash(libreoffice:*)', () => {
    expect(fileConverterSkillPack.requiredTools).toContain('Bash(libreoffice:*)');
  });

  it('requiredTools includes Bash(tesseract:*)', () => {
    expect(fileConverterSkillPack.requiredTools).toContain('Bash(tesseract:*)');
  });

  it('requiredTools includes Bash(node:*)', () => {
    expect(fileConverterSkillPack.requiredTools).toContain('Bash(node:*)');
  });

  it('requiredTools includes Bash(npm:*)', () => {
    expect(fileConverterSkillPack.requiredTools).toContain('Bash(npm:*)');
  });

  it('has a tags array including "file-converter"', () => {
    expect(Array.isArray(fileConverterSkillPack.tags)).toBe(true);
    expect(fileConverterSkillPack.tags).toContain('file-converter');
  });

  it('tags include "pandoc"', () => {
    expect(fileConverterSkillPack.tags).toContain('pandoc');
  });

  it('tags include "ocr"', () => {
    expect(fileConverterSkillPack.tags).toContain('ocr');
  });

  it('tags include "pdf"', () => {
    expect(fileConverterSkillPack.tags).toContain('pdf');
  });

  it('has isUserDefined=false', () => {
    expect(fileConverterSkillPack.isUserDefined).toBe(false);
  });

  it('has a non-empty systemPromptExtension', () => {
    expect(typeof fileConverterSkillPack.systemPromptExtension).toBe('string');
    expect(fileConverterSkillPack.systemPromptExtension.length).toBeGreaterThan(0);
  });
});

// ── 2. Pandoc / LibreOffice / Node.js Detection Logic ────────────────────────

describe('fileConverterSkillPack — tool detection logic', () => {
  const prompt = fileConverterSkillPack.systemPromptExtension;

  it('systemPromptExtension includes pandoc detection command', () => {
    expect(prompt).toContain('which pandoc');
  });

  it('systemPromptExtension includes libreoffice detection command', () => {
    expect(prompt).toContain('which libreoffice');
  });

  it('systemPromptExtension includes Node.js detection command', () => {
    expect(prompt).toContain('which node');
  });

  it('systemPromptExtension mentions pandoc usage examples', () => {
    expect(prompt.toLowerCase()).toContain('pandoc');
  });

  it('systemPromptExtension mentions libreoffice --headless', () => {
    expect(prompt).toContain('libreoffice --headless');
  });

  it('systemPromptExtension covers Node.js package-based conversions', () => {
    expect(prompt).toContain('pdf-parse');
  });

  it('systemPromptExtension covers mammoth for DOCX conversion', () => {
    expect(prompt).toContain('mammoth');
  });

  it('systemPromptExtension covers puppeteer for HTML→PDF', () => {
    expect(prompt).toContain('puppeteer');
  });

  it('systemPromptExtension mentions npm install instructions', () => {
    expect(prompt).toContain('npm install');
  });
});

// ── 3. OCR Instructions ───────────────────────────────────────────────────────

describe('fileConverterSkillPack — OCR instructions', () => {
  const prompt = fileConverterSkillPack.systemPromptExtension;

  it('systemPromptExtension includes tesseract detection command', () => {
    expect(prompt).toContain('which tesseract');
  });

  it('systemPromptExtension includes tesseract usage example', () => {
    expect(prompt).toContain('tesseract');
  });

  it('systemPromptExtension covers image-to-text OCR', () => {
    expect(prompt.toLowerCase()).toMatch(/image.*text|ocr|tesseract.*input/i);
  });

  it('systemPromptExtension covers scanned PDF OCR workflow', () => {
    expect(prompt.toLowerCase()).toMatch(/scanned pdf|pdf.*ocr|pdftoppm/i);
  });

  it('systemPromptExtension mentions tesseract.js as Node.js fallback', () => {
    expect(prompt).toContain('tesseract.js');
  });

  it('systemPromptExtension mentions language option for tesseract', () => {
    expect(prompt).toContain('-l eng');
  });
});

// ── 4. Tool Prioritization by Availability ────────────────────────────────────

describe('fileConverterSkillPack — tool prioritization', () => {
  const prompt = fileConverterSkillPack.systemPromptExtension;

  it('systemPromptExtension includes a conversion decision matrix', () => {
    // The decision matrix is a table with columns for Best Tool and Fallback
    expect(prompt).toContain('Best Tool');
    expect(prompt).toContain('Fallback');
  });

  it('systemPromptExtension labels pandoc as preferred for text-based formats', () => {
    expect(prompt.toLowerCase()).toMatch(/pandoc.*preferred|preferred.*pandoc/i);
  });

  it('systemPromptExtension describes pandoc > libreoffice > Node.js priority order', () => {
    // The prompt should communicate that pandoc is ranked highest
    expect(prompt.toLowerCase()).toMatch(/pandoc.*>.*libreoffice|prefer.*pandoc/i);
  });

  it('systemPromptExtension instructs to detect tools before converting (Step 1)', () => {
    expect(prompt).toContain('Step 1');
  });

  it('systemPromptExtension instructs to choose best tool after detection (Step 2)', () => {
    expect(prompt).toContain('Step 2');
  });

  it('systemPromptExtension describes fallback behavior when a tool is missing', () => {
    expect(prompt.toLowerCase()).toMatch(/fallback|not installed|if.*missing|alternative/i);
  });

  it('systemPromptExtension includes error handling for missing tools', () => {
    expect(prompt.toLowerCase()).toContain('not installed');
  });

  it('systemPromptExtension covers output file verification step', () => {
    expect(prompt.toLowerCase()).toMatch(/verify|step 4/i);
  });

  it('systemPromptExtension emits [SHARE:FILE:] marker for delivery', () => {
    expect(prompt).toContain('[SHARE:FILE:');
  });
});

// ── 5. Registration in BUILT_IN_SKILL_PACKS ───────────────────────────────────

describe('file-converter in BUILT_IN_SKILL_PACKS', () => {
  it('BUILT_IN_SKILL_PACKS includes file-converter pack', () => {
    const names = BUILT_IN_SKILL_PACKS.map((p) => p.name);
    expect(names).toContain('file-converter');
  });

  it('file-converter entry in BUILT_IN_SKILL_PACKS matches direct import', () => {
    const fromRegistry = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'file-converter');
    expect(fromRegistry).toBe(fileConverterSkillPack);
  });
});
