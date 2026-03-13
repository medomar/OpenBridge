import type Database from 'better-sqlite3';
import { createLogger } from '../core/logger.js';
import { listDocTypes } from '../intelligence/doctype-store.js';
import type { Workflow } from '../types/workflow.js';
import type { WorkflowStore } from './workflow-store.js';

const logger = createLogger('proactive-daily-analysis');

/** Well-known ID so we can detect duplicates */
const DAILY_ANALYSIS_WORKFLOW_ID = 'builtin:daily-analysis';

/**
 * Build the pre-built daily analysis workflow definition.
 *
 * Pipeline: schedule (9pm daily) → query each DocType for today's changes
 *           → AI step (compare today vs yesterday) → send summary via WhatsApp
 *
 * @param ownerPhone - WhatsApp phone number of the workspace owner
 * @param doctypeNames - Names of all DocTypes to query
 */
export function buildDailyAnalysisWorkflow(ownerPhone: string, doctypeNames: string[]): Workflow {
  const steps = [
    // Step 0: Query all DocTypes for today's records (results merged downstream by AI)
    {
      id: 'query-all-doctypes',
      name: "Query today's changes across all DocTypes",
      type: 'query' as const,
      config: {
        doctype: doctypeNames[0] ?? '',
        filters: {},
        _all_doctypes: doctypeNames,
      },
      sort_order: 0,
      continue_on_error: true,
    },
    // Step 1: AI analysis — compare today vs yesterday, identify anomalies
    {
      id: 'ai-daily-analysis',
      name: 'AI daily analysis',
      type: 'ai' as const,
      config: {
        prompt: [
          'You are a business analyst. Analyze the following data from our business system.',
          '',
          'DocTypes being tracked: {{_doctypes}}',
          '',
          'Records data:',
          '{{_records_summary}}',
          '',
          "Today's date: {{_today}}",
          '',
          'Instructions:',
          '- Compare today vs yesterday: identify anomalies, trends, and actionable insights.',
          '- Be specific with numbers (counts, totals, percentages).',
          '- Highlight any unusual patterns or missing expected activity.',
          '- Keep the summary concise (under 500 words) and actionable.',
          '- Format for WhatsApp (use *bold* for headers, bullet points for lists).',
          '- If there is no data or no changes, say so clearly.',
          '',
          'Respond with ONLY the analysis text, no JSON wrapping.',
        ].join('\n'),
        skill_pack: 'read-only',
        model: 'sonnet',
      },
      sort_order: 1,
      continue_on_error: false,
    },
    // Step 2: Send the analysis summary to the owner via WhatsApp
    {
      id: 'send-daily-summary',
      name: 'Send daily summary to owner',
      type: 'send' as const,
      config: {
        channel: 'whatsapp',
        to: ownerPhone,
        message: '*📊 Daily Business Analysis*\n\n{{_ai_output}}',
      },
      sort_order: 2,
      continue_on_error: false,
    },
  ];

  return {
    id: DAILY_ANALYSIS_WORKFLOW_ID,
    name: 'Daily Business Analysis',
    description:
      'Proactive daily analysis at 9pm — queries all DocTypes for changes, ' +
      'identifies anomalies and trends, sends summary via WhatsApp.',
    trigger: {
      type: 'schedule',
      cron: '0 21 * * *',
    },
    steps,
    status: 'active',
    run_count: 0,
    error_count: 0,
    created_at: new Date().toISOString(),
  };
}

/**
 * Check whether the proactive daily analysis workflow should be auto-installed.
 * Criteria: at least 2 DocTypes exist and each has at least 1 record.
 */
export function shouldInstallDailyAnalysis(db: Database.Database): {
  eligible: boolean;
  doctypeNames: string[];
} {
  let doctypes;
  try {
    doctypes = listDocTypes(db);
  } catch {
    return { eligible: false, doctypeNames: [] };
  }

  if (doctypes.length < 2) {
    return { eligible: false, doctypeNames: [] };
  }

  // Check each DocType has at least 1 record
  const populatedNames: string[] = [];
  for (const dt of doctypes) {
    try {
      const tableName = dt.table_name;
      const row = db
        .prepare(`SELECT COUNT(*) as c FROM "${tableName.replace(/"/g, '""')}"`)
        .get() as { c: number } | undefined;
      if (row && row.c > 0) {
        populatedNames.push(dt.name);
      }
    } catch {
      // Table might not exist yet — skip
    }
  }

  return {
    eligible: populatedNames.length >= 2,
    doctypeNames: populatedNames,
  };
}

/**
 * Auto-install the proactive daily analysis workflow if eligible.
 * No-op if the workflow already exists or eligibility criteria are not met.
 *
 * @param db         - SQLite database instance
 * @param store      - WorkflowStore for persistence
 * @param ownerPhone - Owner's WhatsApp phone number for delivery
 * @returns true if the workflow was installed, false otherwise
 */
export function autoInstallDailyAnalysis(
  db: Database.Database,
  store: WorkflowStore,
  ownerPhone: string,
): boolean {
  // Check if already installed
  const existing = store.getWorkflow(DAILY_ANALYSIS_WORKFLOW_ID);
  if (existing) {
    logger.debug('Daily analysis workflow already installed');
    return false;
  }

  const { eligible, doctypeNames } = shouldInstallDailyAnalysis(db);
  if (!eligible) {
    logger.debug(
      { doctypeCount: doctypeNames.length },
      'Not enough populated DocTypes for daily analysis (need ≥ 2)',
    );
    return false;
  }

  const workflow = buildDailyAnalysisWorkflow(ownerPhone, doctypeNames);

  try {
    store.createWorkflow(workflow);
    logger.info(
      { doctypeNames, ownerPhone: ownerPhone.slice(0, 4) + '***' },
      'Proactive daily analysis workflow auto-installed',
    );
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, 'Failed to auto-install daily analysis workflow');
    return false;
  }
}

/**
 * Prepare the input data for the daily analysis workflow execution.
 * Queries all tracked DocTypes and builds a summary for the AI step.
 */
export function prepareDailyAnalysisInput(
  db: Database.Database,
  doctypeNames: string[],
): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const summaries: Record<string, unknown> = {};

  for (const name of doctypeNames) {
    try {
      const row = db.prepare('SELECT table_name FROM doctypes WHERE name = ?').get(name) as
        | { table_name: string }
        | undefined;

      if (!row) continue;
      const table = `"${row.table_name.replace(/"/g, '""')}"`;

      // Total count
      const total = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };

      // Today's count (by created_at or updated_at)
      let todayCount = 0;
      try {
        const todayRow = db
          .prepare(`SELECT COUNT(*) as c FROM ${table} WHERE created_at >= ? OR updated_at >= ?`)
          .get(today, today) as { c: number } | undefined;
        todayCount = todayRow?.c ?? 0;
      } catch {
        // created_at/updated_at columns may not exist
      }

      summaries[name] = {
        total_records: total.c,
        today_changes: todayCount,
      };
    } catch {
      summaries[name] = { error: 'could not query' };
    }
  }

  return {
    _doctypes: doctypeNames.join(', '),
    _records_summary: JSON.stringify(summaries, null, 2),
    _today: today,
  };
}
