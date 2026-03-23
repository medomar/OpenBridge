/**
 * Unit tests for proactive daily analysis workflow (OB-1472)
 *
 * Tests:
 * 1. buildDailyAnalysisWorkflow creates correct workflow structure
 * 2. shouldInstallDailyAnalysis returns false with < 2 DocTypes
 * 3. shouldInstallDailyAnalysis returns false when DocTypes have no data
 * 4. shouldInstallDailyAnalysis returns true with 2+ populated DocTypes
 * 5. autoInstallDailyAnalysis skips when already installed
 * 6. autoInstallDailyAnalysis installs when eligible
 * 7. prepareDailyAnalysisInput builds correct summary data
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildDailyAnalysisWorkflow,
  shouldInstallDailyAnalysis,
  autoInstallDailyAnalysis,
  prepareDailyAnalysisInput,
} from '../../src/workflows/proactive-daily-analysis.js';
import { createWorkflowStore } from '../../src/workflows/workflow-store.js';
import type { WorkflowStore } from '../../src/workflows/workflow-store.js';

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const WORKFLOW_DDL = `
  CREATE TABLE workflows (
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

  CREATE TABLE workflow_runs (
    id           TEXT    PRIMARY KEY,
    workflow_id  TEXT    NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    started_at   TEXT    NOT NULL,
    completed_at TEXT,
    status       TEXT    NOT NULL,
    trigger_data TEXT,
    step_results TEXT,
    error        TEXT,
    duration_ms  INTEGER
  );

  CREATE TABLE workflow_approvals (
    id              TEXT    PRIMARY KEY,
    workflow_run_id TEXT    NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    step_index      INTEGER NOT NULL,
    message         TEXT    NOT NULL,
    options         TEXT    NOT NULL,
    sent_to         TEXT    NOT NULL,
    sent_at         TEXT    NOT NULL,
    responded_at    TEXT,
    response        TEXT,
    timeout_at      TEXT    NOT NULL
  );
`;

const DOCTYPE_DDL = `
  CREATE TABLE doctypes (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL UNIQUE,
    label_singular TEXT NOT NULL,
    label_plural   TEXT NOT NULL,
    icon           TEXT,
    table_name     TEXT NOT NULL UNIQUE,
    source         TEXT NOT NULL DEFAULT 'user',
    template_id    TEXT,
    created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('proactive-daily-analysis', () => {
  let db: Database.Database;
  let store: WorkflowStore;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(WORKFLOW_DDL);
    db.exec(DOCTYPE_DDL);
    store = createWorkflowStore(db);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // buildDailyAnalysisWorkflow
  // -------------------------------------------------------------------------

  describe('buildDailyAnalysisWorkflow', () => {
    it('creates a workflow with correct structure', () => {
      const wf = buildDailyAnalysisWorkflow('+1234567890', ['Invoice', 'Order']);

      expect(wf.id).toBe('builtin:daily-analysis');
      expect(wf.name).toBe('Daily Business Analysis');
      expect(wf.status).toBe('active');
      expect(wf.trigger.type).toBe('schedule');
      expect(wf.trigger.cron).toBe('0 21 * * *');
      expect(wf.steps).toHaveLength(3);

      // Step 0: query
      expect(wf.steps[0]!.type).toBe('query');
      expect(wf.steps[0]!.config['_all_doctypes']).toEqual(['Invoice', 'Order']);

      // Step 1: ai
      expect(wf.steps[1]!.type).toBe('ai');
      expect(wf.steps[1]!.config['skill_pack']).toBe('read-only');

      // Step 2: send
      expect(wf.steps[2]!.type).toBe('send');
      expect(wf.steps[2]!.config['channel']).toBe('whatsapp');
      expect(wf.steps[2]!.config['to']).toBe('+1234567890');
    });
  });

  // -------------------------------------------------------------------------
  // shouldInstallDailyAnalysis
  // -------------------------------------------------------------------------

  describe('shouldInstallDailyAnalysis', () => {
    it('returns false with no DocTypes', () => {
      const result = shouldInstallDailyAnalysis(db);
      expect(result.eligible).toBe(false);
      expect(result.doctypeNames).toEqual([]);
    });

    it('returns false with only 1 DocType', () => {
      db.exec(`
        INSERT INTO doctypes (id, name, label_singular, label_plural, table_name)
        VALUES ('dt1', 'Invoice', 'Invoice', 'Invoices', 'dt_invoices');
      `);
      db.exec(`
        CREATE TABLE dt_invoices (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT);
        INSERT INTO dt_invoices (id) VALUES ('inv-1');
      `);

      const result = shouldInstallDailyAnalysis(db);
      expect(result.eligible).toBe(false);
    });

    it('returns false when DocTypes exist but have no data', () => {
      db.exec(`
        INSERT INTO doctypes (id, name, label_singular, label_plural, table_name)
        VALUES ('dt1', 'Invoice', 'Invoice', 'Invoices', 'dt_invoices'),
               ('dt2', 'Order', 'Order', 'Orders', 'dt_orders');
      `);
      db.exec(`
        CREATE TABLE dt_invoices (id TEXT PRIMARY KEY);
        CREATE TABLE dt_orders (id TEXT PRIMARY KEY);
      `);

      const result = shouldInstallDailyAnalysis(db);
      expect(result.eligible).toBe(false);
      expect(result.doctypeNames).toEqual([]);
    });

    it('returns true with 2+ populated DocTypes', () => {
      db.exec(`
        INSERT INTO doctypes (id, name, label_singular, label_plural, table_name)
        VALUES ('dt1', 'Invoice', 'Invoice', 'Invoices', 'dt_invoices'),
               ('dt2', 'Order', 'Order', 'Orders', 'dt_orders');
      `);
      db.exec(`
        CREATE TABLE dt_invoices (id TEXT PRIMARY KEY);
        INSERT INTO dt_invoices (id) VALUES ('inv-1');
        CREATE TABLE dt_orders (id TEXT PRIMARY KEY);
        INSERT INTO dt_orders (id) VALUES ('ord-1');
      `);

      const result = shouldInstallDailyAnalysis(db);
      expect(result.eligible).toBe(true);
      expect(result.doctypeNames).toEqual(['Invoice', 'Order']);
    });
  });

  // -------------------------------------------------------------------------
  // autoInstallDailyAnalysis
  // -------------------------------------------------------------------------

  describe('autoInstallDailyAnalysis', () => {
    it('skips when already installed', () => {
      // Manually insert the workflow
      const wf = buildDailyAnalysisWorkflow('+1234567890', ['Invoice', 'Order']);
      store.createWorkflow(wf);

      const installed = autoInstallDailyAnalysis(db, store, '+1234567890');
      expect(installed).toBe(false);
    });

    it('skips when not eligible', () => {
      const installed = autoInstallDailyAnalysis(db, store, '+1234567890');
      expect(installed).toBe(false);
    });

    it('installs when eligible and not yet installed', () => {
      db.exec(`
        INSERT INTO doctypes (id, name, label_singular, label_plural, table_name)
        VALUES ('dt1', 'Invoice', 'Invoice', 'Invoices', 'dt_invoices'),
               ('dt2', 'Order', 'Order', 'Orders', 'dt_orders');
      `);
      db.exec(`
        CREATE TABLE dt_invoices (id TEXT PRIMARY KEY);
        INSERT INTO dt_invoices (id) VALUES ('inv-1');
        CREATE TABLE dt_orders (id TEXT PRIMARY KEY);
        INSERT INTO dt_orders (id) VALUES ('ord-1');
      `);

      const installed = autoInstallDailyAnalysis(db, store, '+1234567890');
      expect(installed).toBe(true);

      // Verify the workflow was persisted
      const wf = store.getWorkflow('builtin:daily-analysis');
      expect(wf).not.toBeNull();
      expect(wf!.name).toBe('Daily Business Analysis');
      expect(wf!.status).toBe('active');
      expect(wf!.trigger.cron).toBe('0 21 * * *');
      expect(wf!.steps).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // prepareDailyAnalysisInput
  // -------------------------------------------------------------------------

  describe('prepareDailyAnalysisInput', () => {
    it('builds summary data for tracked DocTypes', () => {
      db.exec(`
        INSERT INTO doctypes (id, name, label_singular, label_plural, table_name)
        VALUES ('dt1', 'Invoice', 'Invoice', 'Invoices', 'dt_invoices'),
               ('dt2', 'Order', 'Order', 'Orders', 'dt_orders');
      `);
      db.exec(`
        CREATE TABLE dt_invoices (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT);
        INSERT INTO dt_invoices (id, created_at) VALUES ('inv-1', '2020-01-01');
        INSERT INTO dt_invoices (id, created_at) VALUES ('inv-2', '2020-01-01');
        CREATE TABLE dt_orders (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT);
        INSERT INTO dt_orders (id, created_at) VALUES ('ord-1', '2020-01-01');
      `);

      const input = prepareDailyAnalysisInput(db, ['Invoice', 'Order']);

      expect(input['_doctypes']).toBe('Invoice, Order');
      expect(input['_today']).toBe(new Date().toISOString().slice(0, 10));

      const summary = JSON.parse(input['_records_summary'] as string) as Record<
        string,
        { total_records: number }
      >;
      expect(summary['Invoice']!.total_records).toBe(2);
      expect(summary['Order']!.total_records).toBe(1);
    });

    it('handles missing DocType gracefully', () => {
      const input = prepareDailyAnalysisInput(db, ['NonExistent']);
      expect(input['_doctypes']).toBe('NonExistent');
    });
  });
});
