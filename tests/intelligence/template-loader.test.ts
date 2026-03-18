import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadTemplate,
  applyTemplate,
  type IndustryTemplate,
} from '../../src/intelligence/template-loader.js';
import {
  ensureDocTypeStoreSchema,
  getDocTypeByName,
} from '../../src/intelligence/doctype-store.js';
import { createWorkflowStore } from '../../src/workflows/workflow-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureWorkflowSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id             TEXT    PRIMARY KEY,
      name           TEXT    NOT NULL,
      description    TEXT,
      enabled        INTEGER NOT NULL DEFAULT 1,
      trigger_type   TEXT    NOT NULL,
      trigger_config TEXT    NOT NULL,
      steps          TEXT    NOT NULL,
      created_by     TEXT    NOT NULL DEFAULT 'system',
      created_at     TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at     TEXT,
      last_run       TEXT,
      run_count      INTEGER NOT NULL DEFAULT 0,
      failure_count  INTEGER NOT NULL DEFAULT 0,
      success_count  INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function makeTestManifest(): IndustryTemplate {
  return {
    id: 'test-industry',
    name: 'Test Industry',
    description: 'A test industry template',
    doctypes: [
      {
        doctype: {
          name: 'test-item',
          label_singular: 'Test Item',
          label_plural: 'Test Items',
          table_name: 'dt_test_item',
          source: 'template' as const,
        },
        fields: [
          {
            name: 'item_name',
            label: 'Item Name',
            field_type: 'text' as const,
            required: true,
            searchable: true,
            sort_order: 0,
          } as const,
        ],
        states: [
          {
            name: 'active',
            label: 'Active',
            color: 'green',
            is_initial: true,
            sort_order: 0,
          },
        ],
      },
      {
        doctype: {
          name: 'test-order',
          label_singular: 'Test Order',
          label_plural: 'Test Orders',
          table_name: 'dt_test_order',
          source: 'template' as const,
        },
        fields: [
          {
            name: 'order_ref',
            label: 'Order Reference',
            field_type: 'text' as const,
            required: true,
            sort_order: 0,
          },
        ],
      },
    ],
    workflows: [
      {
        name: 'test-workflow-1',
        description: 'First test workflow',
        trigger: { type: 'schedule' as const, cron: '0 9 * * *' },
        steps: [
          {
            id: 'step-1',
            name: 'Summarize',
            type: 'ai' as const,
            config: { prompt: 'Summarize daily activity' },
            sort_order: 0,
            continue_on_error: false,
          },
        ],
        status: 'active' as const,
      },
      {
        name: 'test-workflow-2',
        description: 'Second test workflow',
        trigger: { type: 'schedule' as const, cron: '0 18 * * *' },
        steps: [
          {
            id: 'step-1',
            name: 'Report',
            type: 'ai' as const,
            config: { prompt: 'Send end of day report' },
            sort_order: 0,
            continue_on_error: false,
          },
        ],
        status: 'active' as const,
      },
    ],
    skillPack: '# Test Skill Pack\n\nThis is a test skill pack.',
    sampleQueries: ['How many items do we have?', 'Show me recent orders'],
  };
}

function writeManifest(workspacePath: string, templateId: string, manifest: object): void {
  const templateDir = join(workspacePath, '.openbridge', 'industry-templates', templateId);
  mkdirSync(templateDir, { recursive: true });
  writeFileSync(join(templateDir, 'manifest.json'), JSON.stringify(manifest));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('loadTemplate', () => {
  let workspacePath: string;

  beforeEach(() => {
    workspacePath = mkdtempSync(join(tmpdir(), 'openbridge-test-'));
  });

  afterEach(() => {
    rmSync(workspacePath, { recursive: true, force: true });
  });

  it('loads a template from manifest.json', () => {
    const manifest = makeTestManifest();
    writeManifest(workspacePath, 'test-industry', manifest);

    const template = loadTemplate(workspacePath, 'test-industry');

    expect(template.id).toBe('test-industry');
    expect(template.name).toBe('Test Industry');
    expect(template.description).toBe('A test industry template');
    expect(template.doctypes).toHaveLength(2);
    expect(template.workflows).toHaveLength(2);
    expect(template.sampleQueries).toHaveLength(2);
    expect(template.skillPack).toContain('Test Skill Pack');
  });

  it('throws when manifest.json does not exist', () => {
    expect(() => loadTemplate(workspacePath, 'nonexistent')).toThrow(/manifest not found/i);
  });

  it('resolves a skillPack file reference to file contents', () => {
    const manifest = {
      ...makeTestManifest(),
      skillPack: 'skill-pack.md',
    };
    const templateDir = join(workspacePath, '.openbridge', 'industry-templates', 'test-industry');
    mkdirSync(templateDir, { recursive: true });
    writeFileSync(join(templateDir, 'manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(templateDir, 'skill-pack.md'), '# Resolved Skill Pack\n\nFrom file.');

    const template = loadTemplate(workspacePath, 'test-industry');

    expect(template.skillPack).toContain('Resolved Skill Pack');
    expect(template.skillPack).not.toBe('skill-pack.md');
  });

  it('keeps inline skillPack as-is (multi-line content)', () => {
    const inlineContent = '# Inline Pack\n\nFirst line.\nSecond line.';
    const manifest = { ...makeTestManifest(), skillPack: inlineContent };
    writeManifest(workspacePath, 'test-industry', manifest);

    const template = loadTemplate(workspacePath, 'test-industry');

    expect(template.skillPack).toBe(inlineContent);
  });
});

describe('applyTemplate', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    ensureDocTypeStoreSchema(db);
    ensureWorkflowSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('creates all DocTypes defined in the template', () => {
    const manifest = makeTestManifest();
    applyTemplate(db, manifest);

    const item = getDocTypeByName(db, 'test-item');
    expect(item).not.toBeNull();
    expect(item!.doctype.label_singular).toBe('Test Item');
    expect(item!.fields).toHaveLength(1);
    expect(item!.states).toHaveLength(1);

    const order = getDocTypeByName(db, 'test-order');
    expect(order).not.toBeNull();
    expect(order!.doctype.label_singular).toBe('Test Order');
    expect(order!.fields).toHaveLength(1);
  });

  it('creates all workflows defined in the template', () => {
    const manifest = makeTestManifest();
    applyTemplate(db, manifest);

    const store = createWorkflowStore(db);
    const workflows = store.listWorkflows();
    expect(workflows).toHaveLength(2);

    const names = workflows.map((w) => w.name);
    expect(names).toContain('test-workflow-1');
    expect(names).toContain('test-workflow-2');
  });

  it('is idempotent — applying the same template twice does not create duplicates', () => {
    const manifest = makeTestManifest();
    applyTemplate(db, manifest);
    applyTemplate(db, manifest);

    // DocTypes: no duplicates
    const item = getDocTypeByName(db, 'test-item');
    expect(item).not.toBeNull();
    const allDoctypeRows = db
      .prepare(`SELECT COUNT(*) AS c FROM doctypes WHERE name = 'test-item'`)
      .get() as { c: number };
    expect(allDoctypeRows.c).toBe(1);

    // Workflows: no duplicates
    const store = createWorkflowStore(db);
    const workflows = store.listWorkflows();
    expect(workflows).toHaveLength(2);
  });

  it('generates IDs for DocTypes and fields when not provided', () => {
    const manifest = makeTestManifest();
    applyTemplate(db, manifest);

    const item = getDocTypeByName(db, 'test-item');
    expect(item).not.toBeNull();
    // ID should be auto-generated as dt-<slug>
    expect(item!.doctype.id).toMatch(/^dt-/);
    // Field ID should be auto-generated
    expect(item!.fields[0].id).toBeTruthy();
  });

  it('sets source to "template" when not specified', () => {
    const manifest = makeTestManifest();
    applyTemplate(db, manifest);

    const item = getDocTypeByName(db, 'test-item');
    expect(item!.doctype.source).toBe('template');
  });
});
