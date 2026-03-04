/**
 * Batch Planner — Extracts ordered item lists from TASKS.md and FINDINGS.md.
 *
 * When a user triggers Batch Task Continuation ("implement all tasks", "go through
 * each one", etc.), BatchPlanner reads the appropriate source file and returns a
 * structured list of BatchPlanItems ready to be passed into BatchManager.createBatch().
 *
 * Supported sources:
 * - tasks-md   : Reads TASKS.md, extracts rows with "◻ Pending" status
 * - findings   : Reads FINDINGS.md, extracts rows where Status column is "Open"
 * - custom-list: Caller provides items directly (no file parsing needed)
 *
 * This class is pure file I/O + regex parsing — no AI calls.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createLogger } from '../core/logger.js';
import type { BatchPlanItem, BatchSourceType } from '../types/agent.js';

const logger = createLogger('batch-planner');

// ── Regex patterns ─────────────────────────────────────────────────

/**
 * Matches a TASKS.md table row that contains a task ID and a Pending status.
 *
 * Expected row format (pipe-separated Markdown table):
 *   | 4   | OB-1607 | Add batch plan generation — ... | ◻ Pending |
 *
 * Captures:
 *   [1] Task ID (e.g. OB-1607)
 *   [2] Description (trimmed)
 */
const TASK_ROW_RE = /^\|\s*\d+\s*\|\s*(OB-[\w-]+)\s*\|\s*(.+?)\s*\|\s*◻\s*Pending\s*\|/;

/**
 * Matches a FINDINGS.md table row where the last status cell is "Open".
 *
 * Expected row format:
 *   | OB-F89 | Codex worker streaming output is raw JSON | 🔴 Critical | ... | Open |
 *
 * Captures:
 *   [1] Finding ID (e.g. OB-F89)
 *   [2] Short description (second column, trimmed)
 */
const FINDING_ROW_RE = /^\|\s*(OB-F[\w-]+)\s*\|\s*(.+?)\s*\|(?:.*?\|)*\s*Open\s*\|/;

// ── BatchPlanner ───────────────────────────────────────────────────

export class BatchPlanner {
  /**
   * Build a batch plan from the given source.
   *
   * @param sourceType       Which source to parse.
   * @param workspacePath    Absolute path to the workspace root (for resolving docs/ paths).
   * @param customItems      Items to use when sourceType is 'custom-list'.
   * @param tasksFilePath    Override path to TASKS.md (defaults to docs/audit/TASKS.md).
   * @param findingsFilePath Override path to FINDINGS.md (defaults to docs/audit/FINDINGS.md).
   * @returns Ordered list of BatchPlanItems extracted from the source.
   */
  async buildPlan(
    sourceType: BatchSourceType,
    workspacePath: string,
    options: {
      customItems?: BatchPlanItem[];
      tasksFilePath?: string;
      findingsFilePath?: string;
    } = {},
  ): Promise<BatchPlanItem[]> {
    switch (sourceType) {
      case 'tasks-md':
        return this.extractPendingTasks(
          options.tasksFilePath ?? join(workspacePath, 'docs/audit/TASKS.md'),
        );
      case 'findings':
        return this.extractOpenFindings(
          options.findingsFilePath ?? join(workspacePath, 'docs/audit/FINDINGS.md'),
        );
      case 'custom-list':
        return options.customItems ?? [];
      default:
        logger.warn({ sourceType }, 'Unknown batch source type — returning empty plan');
        return [];
    }
  }

  /**
   * Detect the most likely source type from the user's message.
   *
   * - Mentions of "findings" or "bugs" → findings
   * - Mentions of "tasks" or the default → tasks-md
   * - Explicit item list in message → custom-list (caller must supply items)
   */
  detectSourceType(userMessage: string): BatchSourceType {
    const lower = userMessage.toLowerCase();
    if (lower.includes('finding') || lower.includes('bug') || lower.includes('issue')) {
      return 'findings';
    }
    return 'tasks-md';
  }

  // ── Private parsers ────────────────────────────────────────────

  /**
   * Read TASKS.md and extract all rows with "◻ Pending" status.
   * Preserves document order (top to bottom).
   */
  async extractPendingTasks(filePath: string): Promise<BatchPlanItem[]> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (err) {
      logger.warn({ filePath, err }, 'Could not read TASKS.md — returning empty plan');
      return [];
    }

    const items: BatchPlanItem[] = [];

    for (const line of content.split('\n')) {
      const match = TASK_ROW_RE.exec(line);
      if (match && match[1] && match[2]) {
        const id = match[1].trim();
        const description = match[2].trim();
        items.push({ id, description });
      }
    }

    logger.info({ filePath, count: items.length }, 'Extracted pending tasks from TASKS.md');
    return items;
  }

  /**
   * Read FINDINGS.md and extract all rows where the Status column is "Open".
   * Preserves document order (top to bottom).
   */
  async extractOpenFindings(filePath: string): Promise<BatchPlanItem[]> {
    let content: string;
    try {
      content = await readFile(filePath, 'utf8');
    } catch (err) {
      logger.warn({ filePath, err }, 'Could not read FINDINGS.md — returning empty plan');
      return [];
    }

    const items: BatchPlanItem[] = [];

    for (const line of content.split('\n')) {
      const match = FINDING_ROW_RE.exec(line);
      if (match && match[1] && match[2]) {
        const id = match[1].trim();
        const description = match[2].trim();
        items.push({ id, description });
      }
    }

    logger.info({ filePath, count: items.length }, 'Extracted open findings from FINDINGS.md');
    return items;
  }
}
