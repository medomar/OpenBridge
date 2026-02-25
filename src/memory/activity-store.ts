import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActivityRecord {
  id: string;
  type: 'master' | 'worker' | 'sub-master' | 'explorer';
  model?: string;
  profile?: string;
  task_summary?: string;
  status: 'starting' | 'running' | 'completing' | 'done' | 'failed';
  progress_pct?: number;
  parent_id?: string;
  cost_usd?: number;
  started_at: string;
  updated_at: string;
  completed_at?: string;
}

export type ActivityUpdate = Partial<
  Pick<
    ActivityRecord,
    'status' | 'progress_pct' | 'cost_usd' | 'completed_at' | 'task_summary' | 'model'
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
        parent_id, cost_usd, started_at, updated_at, completed_at)
     VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    activity.id,
    activity.type,
    activity.model ?? null,
    activity.profile ?? null,
    activity.task_summary ?? null,
    activity.status,
    activity.progress_pct ?? null,
    activity.parent_id ?? null,
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
