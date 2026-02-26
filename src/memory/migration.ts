import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3';
import {
  WorkspaceMapSchema,
  AgentsRegistrySchema,
  MasterSessionSchema,
  ExplorationStateSchema,
  WorkspaceAnalysisMarkerSchema,
  ClassificationCacheSchema,
  LearningsRegistrySchema,
  PromptManifestSchema,
  TaskRecordSchema,
} from '../types/master.js';
import { WorkersRegistrySchema } from '../master/worker-registry.js';
import { ProfilesRegistrySchema } from '../types/agent.js';
import { storeChunks } from './chunk-store.js';
import { recordTask, recordLearning } from './task-store.js';

// ---------------------------------------------------------------------------
// Types for workspace_state and sessions tables
// ---------------------------------------------------------------------------

export interface WorkspaceState {
  commit_hash?: string;
  branch?: string;
  has_git?: boolean;
  analyzed_at: string;
  last_verified_at?: string;
  analysis_type: string;
  files_changed?: number;
}

export interface SessionRecord {
  id: string;
  type: 'master' | 'exploration';
  status: 'active' | 'ended' | 'crashed' | 'closed';
  restart_count?: number;
  message_count?: number;
  allowed_tools?: string;
  created_at: string;
  last_used_at: string;
}

interface WorkspaceStateRow {
  id: number;
  commit_hash: string | null;
  branch: string | null;
  has_git: number;
  analyzed_at: string;
  last_verified_at: string | null;
  analysis_type: string;
  files_changed: number;
}

interface SessionRow {
  id: string;
  type: string;
  status: string;
  restart_count: number;
  message_count: number;
  allowed_tools: string | null;
  created_at: string;
  last_used_at: string;
}

// ---------------------------------------------------------------------------
// Workspace State CRUD
// ---------------------------------------------------------------------------

export function getWorkspaceState(db: Database.Database): WorkspaceState | null {
  const row = db.prepare('SELECT * FROM workspace_state WHERE id = 1').get() as
    | WorkspaceStateRow
    | undefined;

  if (!row) return null;

  return {
    commit_hash: row.commit_hash ?? undefined,
    branch: row.branch ?? undefined,
    has_git: row.has_git === 1,
    analyzed_at: row.analyzed_at,
    last_verified_at: row.last_verified_at ?? undefined,
    analysis_type: row.analysis_type,
    files_changed: row.files_changed,
  };
}

export function updateWorkspaceState(db: Database.Database, state: WorkspaceState): void {
  const now = new Date().toISOString();

  db.prepare(
    `INSERT OR REPLACE INTO workspace_state
       (id, commit_hash, branch, has_git, analyzed_at, last_verified_at, analysis_type, files_changed)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    state.commit_hash ?? null,
    state.branch ?? null,
    state.has_git ? 1 : 0,
    state.analyzed_at || now,
    state.last_verified_at ?? null,
    state.analysis_type,
    state.files_changed ?? 0,
  );
}

// ---------------------------------------------------------------------------
// Sessions CRUD
// ---------------------------------------------------------------------------

export function getSession(db: Database.Database, type: string): SessionRecord | null {
  const row = db
    .prepare('SELECT * FROM sessions WHERE type = ? ORDER BY last_used_at DESC LIMIT 1')
    .get(type) as SessionRow | undefined;

  if (!row) return null;

  return {
    id: row.id,
    type: row.type as 'master' | 'exploration',
    status: row.status as 'active' | 'ended' | 'crashed' | 'closed',
    restart_count: row.restart_count,
    message_count: row.message_count,
    allowed_tools: row.allowed_tools ?? undefined,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  };
}

export function upsertSession(db: Database.Database, session: SessionRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO sessions
       (id, type, status, restart_count, message_count, allowed_tools, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.type,
    session.status,
    session.restart_count ?? 0,
    session.message_count ?? 0,
    session.allowed_tools ?? null,
    session.created_at,
    session.last_used_at,
  );
}

export function closeActiveSessions(db: Database.Database): void {
  const now = new Date().toISOString();
  db.prepare(`UPDATE sessions SET status = 'closed', last_used_at = ? WHERE status = 'active'`).run(
    now,
  );
}

// ---------------------------------------------------------------------------
// Individual file migrators
// ---------------------------------------------------------------------------

function migrateWorkspaceMap(db: Database.Database, filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = WorkspaceMapSchema.safeParse(JSON.parse(raw));
  if (!result.success) return;

  const map = result.data;
  const chunks: Parameters<typeof storeChunks>[1] = [];

  // Structure chunk: project overview, key files, entry points
  chunks.push({
    scope: 'workspace',
    category: 'structure',
    content: JSON.stringify({
      projectName: map.projectName,
      projectType: map.projectType,
      summary: map.summary,
      structure: map.structure,
      keyFiles: map.keyFiles,
      entryPoints: map.entryPoints,
    }),
  });

  // Dependencies chunk: frameworks and runtime/dev dependencies
  if (map.dependencies.length > 0 || map.frameworks.length > 0) {
    chunks.push({
      scope: 'workspace',
      category: 'dependencies',
      content: JSON.stringify({
        frameworks: map.frameworks,
        dependencies: map.dependencies,
      }),
    });
  }

  // Config chunk: available CLI commands
  if (Object.keys(map.commands).length > 0) {
    chunks.push({
      scope: 'workspace',
      category: 'config',
      content: JSON.stringify({ commands: map.commands }),
    });
  }

  storeChunks(db, chunks);
}

function migrateAgentsJson(db: Database.Database, filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = AgentsRegistrySchema.safeParse(JSON.parse(raw));
  if (!result.success) return;

  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`).run(
    'agents',
    JSON.stringify(result.data),
    now,
  );
}

function migrateMasterSession(db: Database.Database, filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = MasterSessionSchema.safeParse(JSON.parse(raw));
  if (!result.success) return;

  const session = result.data;
  upsertSession(db, {
    id: session.sessionId,
    type: 'master',
    status: 'ended', // Historical session — mark as ended
    restart_count: 0,
    message_count: session.messageCount,
    allowed_tools: JSON.stringify(session.allowedTools),
    created_at: session.createdAt,
    last_used_at: session.lastUsedAt,
  });
}

function migrateExplorationState(db: Database.Database, filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = ExplorationStateSchema.safeParse(JSON.parse(raw));
  if (!result.success) return;

  const state = result.data;
  db.prepare(
    `INSERT OR REPLACE INTO exploration_state
       (id, current_phase, status, directory_dives, started_at, completed_at)
     VALUES (1, ?, ?, ?, ?, ?)`,
  ).run(
    state.currentPhase,
    state.status,
    JSON.stringify(state.directoryDives),
    state.startedAt,
    state.completedAt ?? null,
  );
}

function migrateAnalysisMarker(db: Database.Database, filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = WorkspaceAnalysisMarkerSchema.safeParse(JSON.parse(raw));
  if (!result.success) return;

  const marker = result.data;
  updateWorkspaceState(db, {
    commit_hash: marker.workspaceCommitHash,
    branch: marker.workspaceBranch,
    has_git: marker.workspaceHasGit,
    analyzed_at: marker.analyzedAt,
    last_verified_at: marker.lastVerifiedAt,
    analysis_type: marker.analysisType,
    files_changed: marker.filesChanged,
  });
}

function migrateClassifications(db: Database.Database, filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = ClassificationCacheSchema.safeParse(JSON.parse(raw));
  if (!result.success) return;

  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`).run(
    'classifications',
    JSON.stringify(result.data),
    now,
  );
}

function migrateLearnings(db: Database.Database, filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = LearningsRegistrySchema.safeParse(JSON.parse(raw));
  if (!result.success) return;

  for (const entry of result.data.entries) {
    if (!entry.modelUsed) continue; // Skip entries without a model
    recordLearning(
      db,
      entry.taskType,
      entry.modelUsed,
      entry.success,
      0, // turns not tracked in the old schema
      entry.durationMs,
    );
  }
}

function migrateProfiles(db: Database.Database, filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = ProfilesRegistrySchema.safeParse(JSON.parse(raw));
  if (!result.success) return;

  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`).run(
    'profiles',
    JSON.stringify(result.data),
    now,
  );
}

function migrateWorkers(db: Database.Database, filePath: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = WorkersRegistrySchema.safeParse(JSON.parse(raw));
  if (!result.success) return;

  for (const worker of Object.values(result.data.workers)) {
    const dbStatus = mapWorkerStatus(worker.status);
    recordTask(db, {
      id: worker.id,
      type: 'worker',
      status: dbStatus,
      prompt: worker.taskManifest.prompt,
      model: worker.taskManifest.model,
      profile: worker.taskManifest.profile,
      max_turns: worker.taskManifest.maxTurns,
      duration_ms: worker.result?.durationMs,
      exit_code: worker.result?.exitCode,
      retries: worker.result?.retryCount,
      created_at: worker.startedAt,
      completed_at: worker.completedAt,
    });
  }
}

function mapWorkerStatus(status: string): 'running' | 'completed' | 'failed' | 'timeout' {
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'cancelled') return 'failed';
  return 'running'; // 'pending' | 'running'
}

function migratePromptManifest(
  db: Database.Database,
  dotfolderPath: string,
  filePath: string,
): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const result = PromptManifestSchema.safeParse(JSON.parse(raw));
  if (!result.success) return;

  const now = new Date().toISOString();
  const insertPrompt = db.prepare(
    `INSERT OR IGNORE INTO prompts
       (name, version, content, effectiveness, usage_count, success_count, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  );

  for (const [id, template] of Object.entries(result.data.prompts)) {
    const effectiveness =
      template.usageCount > 0 ? template.successCount / template.usageCount : 0.5;

    // Try to read the actual prompt content from the markdown file
    let content = template.filePath; // Fall back to the file path as content
    const promptFilePath = path.isAbsolute(template.filePath)
      ? template.filePath
      : path.join(dotfolderPath, 'prompts', template.filePath);

    try {
      if (fs.existsSync(promptFilePath)) {
        content = fs.readFileSync(promptFilePath, 'utf8');
      }
    } catch {
      // Keep the file path as content if reading fails
    }

    insertPrompt.run(
      id,
      1, // version 1 for all migrated prompts
      content,
      effectiveness,
      template.usageCount,
      template.successCount,
      template.createdAt || now,
    );
  }
}

function migrateTaskFiles(db: Database.Database, tasksDir: string, migratedFiles: string[]): void {
  let files: string[];
  try {
    files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json'));
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = path.join(tasksDir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const result = TaskRecordSchema.safeParse(JSON.parse(raw));
      if (!result.success) continue;

      const task = result.data;
      const dbStatus = mapMasterTaskStatus(task.status);

      recordTask(db, {
        id: task.id,
        type: 'complex', // Master task records don't carry a DB type
        status: dbStatus,
        prompt: task.userMessage,
        response: task.result,
        duration_ms: task.durationMs,
        created_at: task.createdAt,
        completed_at: task.completedAt,
      });

      migratedFiles.push(filePath);
    } catch {
      // Skip individual corrupt files
    }
  }
}

function mapMasterTaskStatus(status: string): 'running' | 'completed' | 'failed' | 'timeout' {
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'running'; // 'pending' | 'processing' | 'delegated'
}

// ---------------------------------------------------------------------------
// Public: main migration entry point
// ---------------------------------------------------------------------------

/**
 * Migrate all .openbridge/ JSON files to the SQLite database.
 *
 * Each file is migrated independently — a failure on one file does not
 * prevent the rest from migrating. Successfully migrated files are renamed
 * to `*.json.migrated` so they are not re-migrated on the next startup.
 *
 * If no JSON files exist (fresh install), returns silently.
 */
export function migrateJsonToSqlite(db: Database.Database, dotfolderPath: string): Promise<void> {
  const migratedFiles: string[] = [];

  function tryMigrate(filePath: string, migrateFn: () => void): void {
    if (!fs.existsSync(filePath)) return;
    try {
      migrateFn();
      migratedFiles.push(filePath);
    } catch {
      // Log-and-continue: migration failures are non-fatal
    }
  }

  tryMigrate(path.join(dotfolderPath, 'workspace-map.json'), () =>
    migrateWorkspaceMap(db, path.join(dotfolderPath, 'workspace-map.json')),
  );

  tryMigrate(path.join(dotfolderPath, 'agents.json'), () =>
    migrateAgentsJson(db, path.join(dotfolderPath, 'agents.json')),
  );

  tryMigrate(path.join(dotfolderPath, 'master-session.json'), () =>
    migrateMasterSession(db, path.join(dotfolderPath, 'master-session.json')),
  );

  tryMigrate(path.join(dotfolderPath, 'exploration-state.json'), () =>
    migrateExplorationState(db, path.join(dotfolderPath, 'exploration-state.json')),
  );

  tryMigrate(path.join(dotfolderPath, 'analysis-marker.json'), () =>
    migrateAnalysisMarker(db, path.join(dotfolderPath, 'analysis-marker.json')),
  );

  tryMigrate(path.join(dotfolderPath, 'classifications.json'), () =>
    migrateClassifications(db, path.join(dotfolderPath, 'classifications.json')),
  );

  tryMigrate(path.join(dotfolderPath, 'learnings.json'), () =>
    migrateLearnings(db, path.join(dotfolderPath, 'learnings.json')),
  );

  tryMigrate(path.join(dotfolderPath, 'profiles.json'), () =>
    migrateProfiles(db, path.join(dotfolderPath, 'profiles.json')),
  );

  tryMigrate(path.join(dotfolderPath, 'workers.json'), () =>
    migrateWorkers(db, path.join(dotfolderPath, 'workers.json')),
  );

  tryMigrate(path.join(dotfolderPath, 'prompts', 'manifest.json'), () =>
    migratePromptManifest(db, dotfolderPath, path.join(dotfolderPath, 'prompts', 'manifest.json')),
  );

  // Migrate tasks/*.json directory (individual files tracked separately)
  const tasksDir = path.join(dotfolderPath, 'tasks');
  if (fs.existsSync(tasksDir)) {
    migrateTaskFiles(db, tasksDir, migratedFiles);
  }

  // Rename successfully migrated files to *.json.migrated
  for (const filePath of migratedFiles) {
    try {
      fs.renameSync(filePath, `${filePath}.migrated`);
    } catch {
      // Non-fatal: rename failure doesn't undo the migration
    }
  }

  return Promise.resolve();
}
