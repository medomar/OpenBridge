import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskRecord {
  id: string;
  type: 'exploration' | 'worker' | 'quick-answer' | 'tool-use' | 'complex';
  status: 'running' | 'completed' | 'failed' | 'timeout';
  prompt?: string;
  response?: string;
  model?: string;
  profile?: string;
  turns_used?: number;
  max_turns?: number;
  duration_ms?: number;
  exit_code?: number;
  retries?: number;
  parent_task_id?: string;
  created_at: string;
  completed_at?: string;
}

export interface LearnedParams {
  model: string;
  success_rate: number;
  avg_turns: number;
  total_tasks: number;
}

// ---------------------------------------------------------------------------
// Raw row shapes returned by better-sqlite3
// ---------------------------------------------------------------------------

interface TaskRow {
  id: string;
  type: TaskRecord['type'];
  status: TaskRecord['status'];
  prompt: string | null;
  response: string | null;
  model: string | null;
  profile: string | null;
  turns_used: number | null;
  max_turns: number | null;
  duration_ms: number | null;
  exit_code: number | null;
  retries: number;
  parent_task_id: string | null;
  created_at: string;
  completed_at: string | null;
}

interface LearningRow {
  model: string;
  success_rate: number;
  avg_turns: number;
  total_tasks: number;
}

function rowToTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    prompt: row.prompt ?? undefined,
    response: row.response ?? undefined,
    model: row.model ?? undefined,
    profile: row.profile ?? undefined,
    turns_used: row.turns_used ?? undefined,
    max_turns: row.max_turns ?? undefined,
    duration_ms: row.duration_ms ?? undefined,
    exit_code: row.exit_code ?? undefined,
    retries: row.retries,
    parent_task_id: row.parent_task_id ?? undefined,
    created_at: row.created_at,
    completed_at: row.completed_at ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Insert a task record into the `tasks` table.
 * On conflict (same id), updates the mutable fields (status, response, etc.).
 */
export function recordTask(db: Database.Database, task: TaskRecord): void {
  db.prepare(
    `INSERT INTO tasks
       (id, type, status, prompt, response, model, profile, turns_used,
        max_turns, duration_ms, exit_code, retries, parent_task_id,
        created_at, completed_at)
     VALUES
       (@id, @type, @status, @prompt, @response, @model, @profile,
        @turns_used, @max_turns, @duration_ms, @exit_code, @retries,
        @parent_task_id, @created_at, @completed_at)
     ON CONFLICT(id) DO UPDATE SET
       status       = excluded.status,
       response     = excluded.response,
       model        = COALESCE(excluded.model, model),
       profile      = COALESCE(excluded.profile, profile),
       turns_used   = excluded.turns_used,
       max_turns    = COALESCE(excluded.max_turns, max_turns),
       duration_ms  = excluded.duration_ms,
       exit_code    = excluded.exit_code,
       retries      = excluded.retries,
       completed_at = excluded.completed_at`,
  ).run({
    id: task.id,
    type: task.type,
    status: task.status,
    prompt: task.prompt ?? null,
    response: task.response ?? null,
    model: task.model ?? null,
    profile: task.profile ?? null,
    turns_used: task.turns_used ?? null,
    max_turns: task.max_turns ?? null,
    duration_ms: task.duration_ms ?? null,
    exit_code: task.exit_code ?? null,
    retries: task.retries ?? 0,
    parent_task_id: task.parent_task_id ?? null,
    created_at: task.created_at,
    completed_at: task.completed_at ?? null,
  });
}

/**
 * Return the most recent `limit` tasks of a given type.
 */
export function getTasksByType(
  db: Database.Database,
  type: TaskRecord['type'],
  limit = 20,
): TaskRecord[] {
  const rows = db
    .prepare(`SELECT * FROM tasks WHERE type = ? ORDER BY created_at DESC LIMIT ?`)
    .all(type, limit) as TaskRow[];
  return rows.map(rowToTask);
}

/**
 * Find tasks whose prompt contains the query string (case-insensitive LIKE).
 * Returns the most recent `limit` matches.
 */
export function getSimilarTasks(db: Database.Database, prompt: string, limit = 10): TaskRecord[] {
  if (!prompt.trim()) return [];

  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE prompt LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(`%${prompt}%`, limit) as TaskRow[];
  return rows.map(rowToTask);
}

// ---------------------------------------------------------------------------
// Learnings
// ---------------------------------------------------------------------------

/**
 * UPSERT into `learnings` — increment success or failure counters and update
 * running totals for turns and duration.
 */
export function recordLearning(
  db: Database.Database,
  taskType: string,
  model: string,
  success: boolean,
  turns: number,
  durationMs: number,
): void {
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO learnings
       (task_type, model, success_count, failure_count,
        total_turns, total_duration_ms, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_type, model) DO UPDATE SET
       success_count     = success_count     + excluded.success_count,
       failure_count     = failure_count     + excluded.failure_count,
       total_turns       = total_turns       + excluded.total_turns,
       total_duration_ms = total_duration_ms + excluded.total_duration_ms,
       last_used_at      = excluded.last_used_at`,
  ).run(taskType, model, success ? 1 : 0, success ? 0 : 1, turns, durationMs, now);
}

export interface ModelStats {
  model: string;
  success_rate: number;
  total_tasks: number;
}

export interface LearningsSummary {
  task_type: string;
  success_rate: number;
  total_tasks: number;
  success_count: number;
}

/**
 * Return task types with sufficient total tasks and a high success rate,
 * aggregated across all models. Used by the skill pack synthesis heuristic.
 */
export function getHighSuccessLearnings(
  db: Database.Database,
  minSuccessRate = 0.8,
  minTotalTasks = 5,
): LearningsSummary[] {
  return db
    .prepare(
      `SELECT task_type,
              CAST(SUM(success_count) AS REAL) / NULLIF(SUM(success_count) + SUM(failure_count), 0) AS success_rate,
              SUM(success_count) + SUM(failure_count) AS total_tasks,
              SUM(success_count) AS success_count
       FROM learnings
       GROUP BY task_type
       HAVING total_tasks >= ? AND success_rate >= ?
       ORDER BY total_tasks DESC`,
    )
    .all(minTotalTasks, minSuccessRate) as LearningsSummary[];
}

/**
 * Return the success_rate and total task count for a specific (task_type, model) pair.
 * Returns null when no learning data exists for that combination.
 */
export function getModelStatsForTask(
  db: Database.Database,
  taskType: string,
  model: string,
): ModelStats | null {
  interface StatsRow {
    model: string;
    success_rate: number;
    total_tasks: number;
  }
  const row = db
    .prepare(
      `SELECT model, success_rate, (success_count + failure_count) AS total_tasks
       FROM learnings
       WHERE task_type = ? AND model = ?`,
    )
    .get(taskType, model) as StatsRow | undefined;

  if (!row) return null;

  return {
    model: row.model,
    success_rate: row.success_rate,
    total_tasks: row.total_tasks,
  };
}

/**
 * Return the best model for a given task type, ranked by success_rate.
 * Returns null when no learning data exists for that task type.
 */
export function getLearnedParams(db: Database.Database, taskType: string): LearnedParams | null {
  const row = db
    .prepare(
      `SELECT model, success_rate, avg_turns,
              (success_count + failure_count) AS total_tasks
       FROM learnings
       WHERE task_type = ?
       ORDER BY success_rate DESC, avg_turns ASC
       LIMIT 1`,
    )
    .get(taskType) as LearningRow | undefined;

  if (!row) return null;

  return {
    model: row.model,
    success_rate: row.success_rate,
    avg_turns: row.avg_turns,
    total_tasks: row.total_tasks,
  };
}
