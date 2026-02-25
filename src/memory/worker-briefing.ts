import type Database from 'better-sqlite3';
import type { AgentRunner } from '../core/agent-runner.js';
import type { Chunk } from './chunk-store.js';
import type { TaskRecord, LearnedParams } from './task-store.js';
import { hybridSearch } from './retrieval.js';
import { getSimilarTasks, getLearnedParams } from './task-store.js';

// ---------------------------------------------------------------------------
// Token budget
// ---------------------------------------------------------------------------

/** Rough character-to-token ratio (4 chars ≈ 1 token). */
const CHARS_PER_TOKEN = 4;
/** Maximum total tokens for the briefing (2000 token budget). */
const MAX_TOKENS = 2000;
const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN; // 8000 characters

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Truncate a string to at most `maxChars` characters, appending "…" when cut.
 */
function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + '…';
}

/**
 * Format a date string (ISO 8601) as "Mon DD" (e.g. "Feb 20").
 * Falls back to the raw string if parsing fails.
 */
function formatDate(isoDate: string | undefined): string {
  if (!isoDate) return 'unknown date';
  try {
    return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return isoDate;
  }
}

/**
 * Derive a task type label from a task prompt for use in `getLearnedParams`.
 * Uses simple heuristics: first word of the prompt lowercased.
 */
function inferTaskType(task: string): string {
  const first = task.trim().split(/\s+/)[0]?.toLowerCase() ?? 'worker';
  // Map common verbs to canonical task types used in the learnings table
  const mapping: Record<string, string> = {
    fix: 'worker',
    debug: 'worker',
    implement: 'worker',
    add: 'worker',
    create: 'worker',
    refactor: 'worker',
    update: 'worker',
    write: 'worker',
    explore: 'exploration',
    scan: 'exploration',
    analyse: 'exploration',
    analyze: 'exploration',
    answer: 'quick-answer',
    explain: 'quick-answer',
    summarize: 'quick-answer',
    summarise: 'quick-answer',
    what: 'quick-answer',
    how: 'quick-answer',
    why: 'quick-answer',
  };
  return mapping[first] ?? 'worker';
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildProjectContextSection(chunks: Chunk[], charBudget: number): string {
  if (chunks.length === 0) return '';

  const lines: string[] = ['## Project Context'];
  let used = lines[0]!.length + 1; // +1 for newline

  for (const chunk of chunks) {
    const line = `- ${truncate(chunk.content, 300)}`;
    if (used + line.length + 1 > charBudget) break;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

function buildRelevantHistorySection(tasks: TaskRecord[], charBudget: number): string {
  const completed = tasks.filter((t) => t.status === 'completed' || t.status === 'failed');
  if (completed.length === 0) return '';

  const lines: string[] = ['## Relevant History'];
  let used = lines[0]!.length + 1;

  for (const task of completed) {
    const status = task.status === 'completed' ? 'success' : 'failed';
    const turns = task.turns_used !== undefined ? `, ${task.turns_used} turns` : '';
    const model = task.model ? `, ${task.model}` : '';
    const date = formatDate(task.completed_at ?? task.created_at);
    const prompt = truncate(task.prompt ?? 'task', 80);
    const line = `- [${date}] ${prompt} (${status}${turns}${model})`;
    if (used + line.length + 1 > charBudget) break;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

function buildLearnedPatternsSection(
  learned: LearnedParams | null,
  taskType: string,
  charBudget: number,
): string {
  if (!learned) return '';

  const lines: string[] = ['## Learned Patterns'];
  let used = lines[0]!.length + 1;

  const successPct = Math.round(learned.success_rate * 100);
  const line1 = `- Best model for ${taskType} tasks: ${learned.model} (${successPct}% success rate, ${learned.total_tasks} tasks)`;
  if (used + line1.length + 1 <= charBudget) {
    lines.push(line1);
    used += line1.length + 1;
  }

  if (learned.avg_turns > 0) {
    const line2 = `- Average turns for this task type: ${learned.avg_turns.toFixed(1)}`;
    if (used + line2.length + 1 <= charBudget) {
      lines.push(line2);
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assemble a text briefing for a worker agent.
 *
 * Sections:
 *   1. Task line  — "TASK: <task>"
 *   2. Project Context — top chunks from FTS5 hybrid search
 *   3. Relevant History — recent similar tasks
 *   4. Learned Patterns — best model/profile from learnings table
 *
 * The total briefing is kept under 2000 tokens (~8000 chars).
 * Sections are trimmed individually when the budget is tight.
 *
 * @param db          Open SQLite database
 * @param task        The task description (used as the search query)
 * @param scope       Optional path prefix to filter context chunks
 * @param agentRunner Optional AgentRunner for AI reranking (passed to hybridSearch)
 */
export async function buildBriefing(
  db: Database.Database,
  task: string,
  scope?: string,
  agentRunner?: AgentRunner,
): Promise<string> {
  const taskLine = `TASK: ${task}`;
  let remaining = MAX_CHARS - taskLine.length - 2; // -2 for surrounding newlines

  // --- Section 1: Project Context ------------------------------------------
  const chunks = await hybridSearch(
    db,
    task,
    {
      scope,
      limit: 15, // Fetch extra so we can fill the budget
      excludeStale: true,
      rerank: agentRunner !== undefined && agentRunner !== null,
      workspacePath: process.cwd(),
    },
    agentRunner,
  );

  // Allocate up to 60% of the remaining budget to context
  const contextBudget = Math.floor(remaining * 0.6);
  const contextSection = buildProjectContextSection(chunks, contextBudget);
  remaining -= contextSection.length;

  // --- Section 2: Relevant History ------------------------------------------
  const similarTasks = getSimilarTasks(db, task, 10);

  // Allocate up to 50% of remaining budget to history
  const historyBudget = Math.floor(remaining * 0.5);
  const historySection = buildRelevantHistorySection(similarTasks, historyBudget);
  remaining -= historySection.length;

  // --- Section 3: Learned Patterns ------------------------------------------
  const taskType = inferTaskType(task);
  const learned = getLearnedParams(db, taskType);
  const patternsBudget = remaining;
  const patternsSection = buildLearnedPatternsSection(learned, taskType, patternsBudget);

  // --- Assembly -------------------------------------------------------------
  const sections = [taskLine, contextSection, historySection, patternsSection].filter(
    (s) => s.length > 0,
  );

  return sections.join('\n\n');
}
