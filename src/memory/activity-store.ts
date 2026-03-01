import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExplorationProgressRecord {
  id?: number;
  exploration_id: string;
  phase: string;
  target?: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress_pct: number;
  files_processed: number;
  files_total?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export type ExplorationProgressUpdate = Partial<
  Pick<
    ExplorationProgressRecord,
    'status' | 'progress_pct' | 'files_processed' | 'completed_at' | 'started_at'
  >
>;

export interface ActivityRecord {
  id: string;
  type: 'master' | 'worker' | 'sub-master' | 'explorer';
  model?: string;
  profile?: string;
  task_summary?: string;
  status: 'starting' | 'running' | 'completing' | 'done' | 'failed';
  progress_pct?: number;
  parent_id?: string;
  pid?: number;
  cost_usd?: number;
  started_at: string;
  updated_at: string;
  completed_at?: string;
}

export type ActivityUpdate = Partial<
  Pick<
    ActivityRecord,
    'status' | 'progress_pct' | 'cost_usd' | 'completed_at' | 'task_summary' | 'model' | 'pid'
  >
> & { updated_at?: string };

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** Insert a new agent_activity row. */
export function insertActivity(db: Database.Database, activity: ActivityRecord): void {
  db.prepare(
    `INSERT OR IGNORE INTO agent_activity
       (id, type, model, profile, task_summary, status, progress_pct,
        parent_id, pid, cost_usd, started_at, updated_at, completed_at)
     VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    activity.id,
    activity.type,
    activity.model ?? null,
    activity.profile ?? null,
    activity.task_summary ?? null,
    activity.status,
    activity.progress_pct ?? null,
    activity.parent_id ?? null,
    activity.pid ?? null,
    activity.cost_usd ?? null,
    activity.started_at,
    activity.updated_at,
    activity.completed_at ?? null,
  );
}

/** Update an existing agent_activity row by id. Only provided fields are changed. */
export function updateActivity(db: Database.Database, id: string, updates: ActivityUpdate): void {
  const now = new Date().toISOString();
  const fields: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [updates.updated_at ?? now];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.progress_pct !== undefined) {
    fields.push('progress_pct = ?');
    values.push(updates.progress_pct);
  }
  if (updates.cost_usd !== undefined) {
    fields.push('cost_usd = ?');
    values.push(updates.cost_usd);
  }
  if (updates.completed_at !== undefined) {
    fields.push('completed_at = ?');
    values.push(updates.completed_at);
  }
  if (updates.task_summary !== undefined) {
    fields.push('task_summary = ?');
    values.push(updates.task_summary);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.pid !== undefined) {
    fields.push('pid = ?');
    values.push(updates.pid);
  }

  values.push(id);
  db.prepare(`UPDATE agent_activity SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/** Return all agents with an active status (starting / running / completing). */
export function getActiveAgents(db: Database.Database): ActivityRecord[] {
  return db
    .prepare(
      `SELECT * FROM agent_activity
       WHERE status IN ('starting', 'running', 'completing')
       ORDER BY started_at ASC`,
    )
    .all() as ActivityRecord[];
}

/**
 * Mark all in-flight agent_activity rows as 'done' on startup.
 * Any row still 'starting', 'running', or 'completing' from a previous
 * process is stale — the process that owned it is no longer alive.
 */
export function markStaleActivityDone(db: Database.Database): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE agent_activity
       SET status = 'done', completed_at = ?, updated_at = ?
       WHERE status IN ('starting', 'running', 'completing')`,
    )
    .run(now, now);
  return result.changes;
}

/**
 * Delete agent_activity rows whose completed_at is older than cutoffHours.
 * Rows with no completed_at (still running) are never deleted.
 */
export function cleanupOldActivity(db: Database.Database, cutoffHours = 24): void {
  const cutoff = new Date(Date.now() - cutoffHours * 60 * 60 * 1000).toISOString();
  db.prepare(
    `DELETE FROM agent_activity
     WHERE completed_at IS NOT NULL AND completed_at < ?`,
  ).run(cutoff);
}

// ---------------------------------------------------------------------------
// exploration_progress CRUD
// ---------------------------------------------------------------------------

/** Insert a new exploration_progress row and return its auto-increment id. */
export function insertExplorationProgress(
  db: Database.Database,
  record: Omit<ExplorationProgressRecord, 'id'>,
): number {
  const result = db
    .prepare(
      `INSERT INTO exploration_progress
         (exploration_id, phase, target, status, progress_pct, files_processed,
          files_total, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.exploration_id,
      record.phase,
      record.target ?? null,
      record.status,
      record.progress_pct,
      record.files_processed,
      record.files_total ?? null,
      record.started_at ?? null,
      record.completed_at ?? null,
    );
  return Number(result.lastInsertRowid);
}

/** Update an exploration_progress row by its id. Only provided fields are changed. */
export function updateExplorationProgressById(
  db: Database.Database,
  id: number,
  updates: ExplorationProgressUpdate,
): void {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.progress_pct !== undefined) {
    fields.push('progress_pct = ?');
    values.push(updates.progress_pct);
  }
  if (updates.files_processed !== undefined) {
    fields.push('files_processed = ?');
    values.push(updates.files_processed);
  }
  if (updates.completed_at !== undefined) {
    fields.push('completed_at = ?');
    values.push(updates.completed_at);
  }
  if (updates.started_at !== undefined) {
    fields.push('started_at = ?');
    values.push(updates.started_at);
  }

  if (fields.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE exploration_progress SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Return the total cost_usd accumulated across all agent_activity rows
 * whose started_at date matches the given date string (YYYY-MM-DD).
 * Defaults to today's date (UTC) when no date is provided.
 */
export function getDailyCost(db: Database.Database, date?: string): number {
  const day = date ?? new Date().toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total
       FROM agent_activity
       WHERE date(started_at) = ?`,
    )
    .get(day) as { total: number };
  return row.total;
}

/** Return all exploration_progress rows for a given exploration_id, ordered by id. */
export function getExplorationProgressByExplorationId(
  db: Database.Database,
  explorationId: string,
): ExplorationProgressRecord[] {
  return db
    .prepare(
      `SELECT * FROM exploration_progress
       WHERE exploration_id = ?
       ORDER BY id ASC`,
    )
    .all(explorationId) as ExplorationProgressRecord[];
}
