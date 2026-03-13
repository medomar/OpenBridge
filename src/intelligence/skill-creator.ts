import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single step in a completed multi-step task */
export interface TaskStep {
  /** Step index (0-based) */
  index: number;
  /** What the step did (e.g., "query orders table", "compute totals") */
  action: string;
  /** Tool or integration used (e.g., "sqlite", "whatsapp", "api") */
  integration?: string;
  /** DocType involved (e.g., "order", "customer") */
  docType?: string;
  /** Whether this step succeeded */
  success: boolean;
  /** Duration in milliseconds */
  durationMs?: number;
}

/** A reusable skill extracted from a successful multi-step task */
export interface BusinessSkill {
  id: number;
  /** Short human-readable name (e.g., "weekly-sales-report") */
  name: string;
  /** What this skill does */
  description: string;
  /** Ordered steps to execute */
  steps: string[];
  /** Integrations required (e.g., ["sqlite", "whatsapp"]) */
  requiredIntegrations: string[];
  /** DocTypes this skill operates on */
  requiredDocTypes: string[];
  /** When this skill was created */
  createdAt: string;
  /** Schema version (incremented on structural changes) */
  version: number;
  /** Total number of times this skill has been executed */
  usageCount: number;
  /** Rolling average success rate (0–1) */
  successRate: number;
  /** Rolling average execution duration in milliseconds (null if never run) */
  avgDurationMs: number | null;
  /** ISO timestamp of the last execution (null if never run) */
  lastUsed: string | null;
}

// ---------------------------------------------------------------------------
// Row type for SQLite
// ---------------------------------------------------------------------------

interface BusinessSkillRow {
  id: number;
  name: string;
  description: string;
  steps: string;
  required_integrations: string;
  required_doc_types: string;
  created_at: string;
  version: number;
  usage_count: number;
  success_rate: number;
  avg_duration_ms: number | null;
  last_used: string | null;
}

function rowToSkill(row: BusinessSkillRow): BusinessSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    steps: JSON.parse(row.steps) as string[],
    requiredIntegrations: JSON.parse(row.required_integrations) as string[],
    requiredDocTypes: JSON.parse(row.required_doc_types) as string[],
    createdAt: row.created_at,
    version: row.version ?? 1,
    usageCount: row.usage_count ?? 0,
    successRate: row.success_rate ?? 0,
    avgDurationMs: row.avg_duration_ms ?? null,
    lastUsed: row.last_used ?? null,
  };
}

// ---------------------------------------------------------------------------
// Skill extraction logic
// ---------------------------------------------------------------------------

const MIN_STEPS = 3;

/**
 * Analyze a completed multi-step task and extract a reusable skill pattern.
 * Returns null if the task is too simple (fewer than 3 steps) or if it failed.
 */
export function createSkillFromTask(taskHistory: TaskStep[]): Omit<BusinessSkill, 'id'> | null {
  // Must have at least MIN_STEPS steps
  if (taskHistory.length < MIN_STEPS) return null;

  // All steps must have succeeded
  if (!taskHistory.every((s) => s.success)) return null;

  // Extract unique integrations and docTypes
  const integrations = [
    ...new Set(taskHistory.map((s) => s.integration).filter((v): v is string => !!v)),
  ];
  const docTypes = [...new Set(taskHistory.map((s) => s.docType).filter((v): v is string => !!v))];

  // Build step descriptions
  const steps = taskHistory.map((s) => s.action);

  // Generate a kebab-case name from step actions
  const name = generateSkillName(steps);

  // Generate a description summarizing the workflow
  const description = `${steps.length}-step workflow: ${steps.slice(0, 3).join(' → ')}${steps.length > 3 ? ` → ... (${steps.length} steps total)` : ''}`;

  return {
    name,
    description,
    steps,
    requiredIntegrations: integrations,
    requiredDocTypes: docTypes,
    createdAt: new Date().toISOString(),
    version: 1,
    usageCount: 0,
    successRate: 0,
    avgDurationMs: null,
    lastUsed: null,
  };
}

/**
 * Generate a kebab-case skill name from step action descriptions.
 * Takes the first 3–4 significant words from the first two steps.
 */
function generateSkillName(steps: string[]): string {
  const words = steps
    .slice(0, 2)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4);

  if (words.length === 0) return `skill-${Date.now()}`;
  return words.join('-');
}

// ---------------------------------------------------------------------------
// SQLite CRUD
// ---------------------------------------------------------------------------

/**
 * Store a business skill in the `business_skills` table.
 * Returns the inserted row ID.
 */
export function storeSkill(db: Database.Database, skill: Omit<BusinessSkill, 'id'>): number {
  const result = db
    .prepare(
      `INSERT INTO business_skills
         (name, description, steps, required_integrations, required_doc_types, created_at,
          version, usage_count, success_rate, avg_duration_ms, last_used)
       VALUES (@name, @description, @steps, @required_integrations, @required_doc_types, @created_at,
               @version, @usage_count, @success_rate, @avg_duration_ms, @last_used)`,
    )
    .run({
      name: skill.name,
      description: skill.description,
      steps: JSON.stringify(skill.steps),
      required_integrations: JSON.stringify(skill.requiredIntegrations),
      required_doc_types: JSON.stringify(skill.requiredDocTypes),
      created_at: skill.createdAt,
      version: skill.version ?? 1,
      usage_count: skill.usageCount ?? 0,
      success_rate: skill.successRate ?? 0,
      avg_duration_ms: skill.avgDurationMs ?? null,
      last_used: skill.lastUsed ?? null,
    });
  return Number(result.lastInsertRowid);
}

/**
 * Retrieve a business skill by ID.
 */
export function getSkillById(db: Database.Database, id: number): BusinessSkill | null {
  const row = db.prepare('SELECT * FROM business_skills WHERE id = ?').get(id) as
    | BusinessSkillRow
    | undefined;
  return row ? rowToSkill(row) : null;
}

/**
 * Retrieve a business skill by name.
 */
export function getSkillByName(db: Database.Database, name: string): BusinessSkill | null {
  const row = db.prepare('SELECT * FROM business_skills WHERE name = ?').get(name) as
    | BusinessSkillRow
    | undefined;
  return row ? rowToSkill(row) : null;
}

/**
 * List all business skills, most recent first.
 */
export function listSkills(db: Database.Database, limit = 50): BusinessSkill[] {
  const rows = db
    .prepare('SELECT * FROM business_skills ORDER BY created_at DESC LIMIT ?')
    .all(limit) as BusinessSkillRow[];
  return rows.map(rowToSkill);
}

/**
 * Delete a business skill by ID.
 */
export function deleteSkill(db: Database.Database, id: number): boolean {
  const result = db.prepare('DELETE FROM business_skills WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Record a skill execution result.
 * Increments usage_count, updates success_rate (rolling average),
 * updates avg_duration_ms (rolling average), and sets last_used.
 *
 * Returns false if the skill ID does not exist.
 */
export function recordSkillExecution(
  db: Database.Database,
  id: number,
  success: boolean,
  durationMs?: number,
): boolean {
  const row = db
    .prepare('SELECT usage_count, success_rate, avg_duration_ms FROM business_skills WHERE id = ?')
    .get(id) as
    | { usage_count: number; success_rate: number; avg_duration_ms: number | null }
    | undefined;

  if (!row) return false;

  const newCount = row.usage_count + 1;
  // Rolling average: new_avg = old_avg + (new_value - old_avg) / new_count
  const newSuccessRate = row.success_rate + ((success ? 1 : 0) - row.success_rate) / newCount;

  let newAvgDuration: number | null = row.avg_duration_ms;
  if (durationMs !== undefined) {
    if (newAvgDuration === null) {
      newAvgDuration = durationMs;
    } else {
      newAvgDuration = newAvgDuration + (durationMs - newAvgDuration) / newCount;
    }
  }

  const result = db
    .prepare(
      `UPDATE business_skills
       SET usage_count = ?, success_rate = ?, avg_duration_ms = ?, last_used = ?
       WHERE id = ?`,
    )
    .run(newCount, newSuccessRate, newAvgDuration, new Date().toISOString(), id);

  return result.changes > 0;
}

/**
 * Return the most effective skills sorted by usage × success_rate (descending).
 * Skills with zero executions are included last (score = 0).
 */
export function getTopSkills(db: Database.Database, limit = 10): BusinessSkill[] {
  const rows = db
    .prepare(
      `SELECT * FROM business_skills
       ORDER BY (usage_count * success_rate) DESC, created_at DESC
       LIMIT ?`,
    )
    .all(limit) as BusinessSkillRow[];
  return rows.map(rowToSkill);
}
