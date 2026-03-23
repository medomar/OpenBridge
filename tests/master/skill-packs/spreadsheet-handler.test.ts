/**
 * OB-1489 — Spreadsheet handler skill pack structure, prompt content,
 * Google Sheets MCP fallback, and common operation coverage tests.
 */

import { describe, it, expect } from 'vitest';
import { spreadsheetHandlerSkillPack } from '../../../src/master/skill-packs/spreadsheet-handler.js';
import { BUILT_IN_SKILL_PACKS } from '../../../src/master/skill-packs/index.js';

// ── 1. Skill Pack Structure ───────────────────────────────────────────────────

describe('spreadsheetHandlerSkillPack — structure', () => {
  it('exports a skill pack with name "spreadsheet-handler"', () => {
    expect(spreadsheetHandlerSkillPack.name).toBe('spreadsheet-handler');
  });

  it('has a non-empty description', () => {
    expect(spreadsheetHandlerSkillPack.description.length).toBeGreaterThan(0);
  });

  it('has toolProfile "full-access"', () => {
    expect(spreadsheetHandlerSkillPack.toolProfile).toBe('full-access');
  });

  it('has a non-empty requiredTools array', () => {
    expect(Array.isArray(spreadsheetHandlerSkillPack.requiredTools)).toBe(true);
    expect(spreadsheetHandlerSkillPack.requiredTools.length).toBeGreaterThan(0);
  });

  it('requiredTools includes Bash(node:*)', () => {
    expect(spreadsheetHandlerSkillPack.requiredTools).toContain('Bash(node:*)');
  });

  it('requiredTools includes Bash(npm:*)', () => {
    expect(spreadsheetHandlerSkillPack.requiredTools).toContain('Bash(npm:*)');
  });

  it('has a tags array that includes "spreadsheet"', () => {
    expect(Array.isArray(spreadsheetHandlerSkillPack.tags)).toBe(true);
    expect(spreadsheetHandlerSkillPack.tags).toContain('spreadsheet');
  });

  it('tags include "xlsx"', () => {
    expect(spreadsheetHandlerSkillPack.tags).toContain('xlsx');
  });

  it('tags include "csv"', () => {
    expect(spreadsheetHandlerSkillPack.tags).toContain('csv');
  });

  it('tags include "google-sheets"', () => {
    expect(spreadsheetHandlerSkillPack.tags).toContain('google-sheets');
  });

  it('has isUserDefined=false', () => {
    expect(spreadsheetHandlerSkillPack.isUserDefined).toBe(false);
  });

  it('has a non-empty systemPromptExtension', () => {
    expect(typeof spreadsheetHandlerSkillPack.systemPromptExtension).toBe('string');
    expect(spreadsheetHandlerSkillPack.systemPromptExtension.length).toBeGreaterThan(0);
  });
});

// ── 2. Read/Write Operations ──────────────────────────────────────────────────

describe('spreadsheetHandlerSkillPack — read/write operations', () => {
  const prompt = spreadsheetHandlerSkillPack.systemPromptExtension;

  it('systemPromptExtension mentions exceljs', () => {
    expect(prompt.toLowerCase()).toContain('exceljs');
  });

  it('systemPromptExtension mentions xlsx or SheetJS for reading', () => {
    expect(prompt).toContain('xlsx');
  });

  it('systemPromptExtension includes readFile instruction', () => {
    expect(prompt).toContain('readFile');
  });

  it('systemPromptExtension includes writeFile instruction', () => {
    expect(prompt).toContain('writeFile');
  });

  it('systemPromptExtension covers .xlsx files', () => {
    expect(prompt).toContain('.xlsx');
  });

  it('systemPromptExtension covers .xls files', () => {
    expect(prompt).toContain('.xls');
  });

  it('systemPromptExtension covers .csv files', () => {
    expect(prompt).toContain('.csv');
  });

  it('systemPromptExtension describes cell modification', () => {
    expect(prompt.toLowerCase()).toContain('cell');
  });

  it('systemPromptExtension describes row operations', () => {
    expect(prompt.toLowerCase()).toContain('row');
  });

  it('systemPromptExtension mentions sheet names or worksheets', () => {
    expect(prompt.toLowerCase()).toMatch(/sheet/);
  });

  it('systemPromptExtension includes formula support', () => {
    expect(prompt.toLowerCase()).toContain('formula');
  });
});

// ── 3. Google Sheets MCP Fallback ─────────────────────────────────────────────

describe('spreadsheetHandlerSkillPack — Google Sheets MCP fallback', () => {
  const prompt = spreadsheetHandlerSkillPack.systemPromptExtension;

  it('systemPromptExtension mentions "Available MCP Servers"', () => {
    expect(prompt).toContain('Available MCP Servers');
  });

  it('systemPromptExtension mentions google-sheets MCP server', () => {
    expect(prompt.toLowerCase()).toContain('google-sheets');
  });

  it('systemPromptExtension mentions --mcp-config for Google Sheets', () => {
    expect(prompt).toContain('--mcp-config');
  });

  it('systemPromptExtension describes fallback when no MCP server is available', () => {
    expect(prompt.toLowerCase()).toMatch(/no mcp|if no mcp|mcp server.*not|export.*xlsx/i);
  });
});

// ── 4. Common Operations (filter, sort, aggregate) ────────────────────────────

describe('spreadsheetHandlerSkillPack — common operations coverage', () => {
  const prompt = spreadsheetHandlerSkillPack.systemPromptExtension;

  it('systemPromptExtension covers filter operation', () => {
    expect(prompt.toLowerCase()).toContain('filter');
  });

  it('systemPromptExtension covers sort operation', () => {
    expect(prompt.toLowerCase()).toContain('sort');
  });

  it('systemPromptExtension covers aggregate operation', () => {
    expect(prompt.toLowerCase()).toMatch(/aggregat|sum|total/i);
  });

  it('systemPromptExtension covers pivot operation', () => {
    expect(prompt.toLowerCase()).toContain('pivot');
  });

  it('systemPromptExtension describes output file conventions', () => {
    expect(prompt).toContain('[SHARE:FILE:');
  });

  it('systemPromptExtension mentions data safety / avoiding overwrite', () => {
    expect(prompt.toLowerCase()).toMatch(/overwrite|original file|safety/i);
  });
});

// ── 5. Registration in BUILT_IN_SKILL_PACKS ───────────────────────────────────

describe('spreadsheet-handler in BUILT_IN_SKILL_PACKS', () => {
  it('BUILT_IN_SKILL_PACKS includes spreadsheet-handler pack', () => {
    const names = BUILT_IN_SKILL_PACKS.map((p) => p.name);
    expect(names).toContain('spreadsheet-handler');
  });

  it('spreadsheet-handler entry in BUILT_IN_SKILL_PACKS matches direct import', () => {
    const fromRegistry = BUILT_IN_SKILL_PACKS.find((p) => p.name === 'spreadsheet-handler');
    expect(fromRegistry).toBe(spreadsheetHandlerSkillPack);
  });
});
