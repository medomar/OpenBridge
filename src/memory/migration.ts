import * as fs from 'node:fs';
import { createRequire } from 'node:module';
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
import { storeChunks, computeContentHash } from './chunk-store.js';
import { recordTask, recordLearning } from './task-store.js';

// ---------------------------------------------------------------------------
// Schema migrations (ALTER TABLE for existing databases)
// ---------------------------------------------------------------------------

interface Migration {
  version: number;
  description: string;
  apply: (db: Database.Database) => void;
}

/**
 * Numbered schema migrations. Each entry maps to a row in schema_versions.
 * Migrations are guarded by column-existence checks so they are safe to
 * call on both fresh and pre-existing databases.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Add pid column to agent_activity',
    apply: (db): void => {
      const has =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('agent_activity') WHERE name='pid'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!has) {
        db.exec('ALTER TABLE agent_activity ADD COLUMN pid INTEGER');
      }
    },
  },
  {
    version: 2,
    description: 'Add title column to conversations',
    apply: (db): void => {
      const has =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('conversations') WHERE name='title'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!has) {
        db.exec('ALTER TABLE conversations ADD COLUMN title TEXT');
      }
    },
  },
  {
    version: 3,
    description: 'Add checkpoint_data column to sessions',
    apply: (db): void => {
      const has =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('sessions') WHERE name='checkpoint_data'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!has) {
        db.exec('ALTER TABLE sessions ADD COLUMN checkpoint_data TEXT');
      }
    },
  },
  {
    version: 4,
    description: 'Add qa_cache table and qa_cache_fts virtual table',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='qa_cache'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE qa_cache (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            question     TEXT    NOT NULL,
            answer       TEXT    NOT NULL,
            confidence   REAL    NOT NULL DEFAULT 0.5,
            file_paths   TEXT,
            created_at   TEXT    NOT NULL,
            accessed_at  TEXT    NOT NULL,
            access_count INTEGER NOT NULL DEFAULT 0
          );
          CREATE VIRTUAL TABLE qa_cache_fts
            USING fts5(question, content=qa_cache, content_rowid=id);
          CREATE INDEX idx_qa_cache_created    ON qa_cache(created_at);
          CREATE INDEX idx_qa_cache_confidence ON qa_cache(confidence);
        `);
      }
    },
  },
  {
    version: 5,
    description: 'Add consent_mode column to access_control',
    apply: (db): void => {
      const has =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('access_control') WHERE name='consent_mode'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!has) {
        db.exec(`ALTER TABLE access_control ADD COLUMN consent_mode TEXT DEFAULT 'always-ask'`);
      }
    },
  },
  {
    version: 6,
    description: 'Add execution_profile column to access_control',
    apply: (db): void => {
      const has =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('access_control') WHERE name='execution_profile'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!has) {
        db.exec(`ALTER TABLE access_control ADD COLUMN execution_profile TEXT DEFAULT 'fast'`);
      }
    },
  },
  {
    version: 7,
    description: 'Add model_preferences column to access_control',
    apply: (db): void => {
      const has =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('access_control') WHERE name='model_preferences'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!has) {
        db.exec(`ALTER TABLE access_control ADD COLUMN model_preferences TEXT DEFAULT NULL`);
      }
    },
  },
  {
    version: 8,
    description: 'Add approved_tool_escalations column to access_control',
    apply: (db): void => {
      const has =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('access_control') WHERE name='approved_tool_escalations'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!has) {
        db.exec(
          `ALTER TABLE access_control ADD COLUMN approved_tool_escalations TEXT DEFAULT '[]'`,
        );
      }
    },
  },
  {
    version: 9,
    description: 'Add observations table for structured worker output facts',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='observations'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE observations (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id     TEXT    NOT NULL,
            worker_id      TEXT    NOT NULL,
            type           TEXT    NOT NULL,
            title          TEXT    NOT NULL,
            narrative      TEXT    NOT NULL,
            facts          TEXT    NOT NULL DEFAULT '[]',
            concepts       TEXT    NOT NULL DEFAULT '[]',
            files_read     TEXT    NOT NULL DEFAULT '[]',
            files_modified TEXT    NOT NULL DEFAULT '[]',
            created_at     TEXT    NOT NULL
          );
          CREATE INDEX idx_observations_session ON observations(session_id);
          CREATE INDEX idx_observations_worker  ON observations(worker_id);
          CREATE INDEX idx_observations_type    ON observations(type);
          CREATE INDEX idx_observations_created ON observations(created_at);
        `);
      }
    },
  },
  {
    version: 10,
    description: 'Add summary_json column to agent_activity',
    apply: (db): void => {
      const has =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('agent_activity') WHERE name='summary_json'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!has) {
        db.exec('ALTER TABLE agent_activity ADD COLUMN summary_json TEXT');
      }
    },
  },
  {
    version: 11,
    description: 'Add content_hash column to context_chunks and backfill existing rows',
    apply: (db): void => {
      // Skip if context_chunks table does not exist (e.g. minimal test databases)
      const tableExists =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='context_chunks'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!tableExists) return;

      const hasColumn =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM pragma_table_info('context_chunks') WHERE name='content_hash'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasColumn) {
        db.exec('ALTER TABLE context_chunks ADD COLUMN content_hash TEXT');
      }

      // Backfill rows that have no content_hash yet
      const rows = db
        .prepare('SELECT id, content FROM context_chunks WHERE content_hash IS NULL')
        .all() as { id: number; content: string }[];

      if (rows.length > 0) {
        const update = db.prepare('UPDATE context_chunks SET content_hash = ? WHERE id = ?');
        db.transaction(() => {
          for (const row of rows) {
            update.run(computeContentHash(row.content), row.id);
          }
        })();
      }
    },
  },
  {
    version: 12,
    description: 'Add embeddings table for vector search and initialize sqlite-vec extension',
    apply: (db): void => {
      // Try to load sqlite-vec extension (optional dependency — skip if not installed)
      try {
        const req = createRequire(import.meta.url);
        const sqliteVec = req('sqlite-vec') as { load: (db: Database.Database) => void };
        sqliteVec.load(db);
      } catch {
        // sqlite-vec not installed — vector search will be unavailable
      }

      // Create embeddings table for existing databases that predate database.ts schema addition
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='embeddings'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE embeddings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            chunk_id    INTEGER NOT NULL,
            vector      BLOB    NOT NULL,
            model       TEXT    NOT NULL,
            dimensions  INTEGER NOT NULL,
            created_at  TEXT    NOT NULL,
            FOREIGN KEY (chunk_id) REFERENCES context_chunks(id) ON DELETE CASCADE
          );
          CREATE UNIQUE INDEX idx_embeddings_chunk ON embeddings(chunk_id);
          CREATE INDEX idx_embeddings_model ON embeddings(model);
        `);
      }
    },
  },
  {
    version: 13,
    description: 'Add compaction_history table for session compaction events',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='compaction_history'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE compaction_history (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id            TEXT    NOT NULL,
            trigger_reason        TEXT    NOT NULL,
            turns_summarized      INTEGER NOT NULL,
            identifiers_preserved TEXT    NOT NULL DEFAULT '{}',
            summary_length        INTEGER NOT NULL DEFAULT 0,
            created_at            TEXT    NOT NULL
          );
          CREATE INDEX idx_compaction_session ON compaction_history(session_id);
          CREATE INDEX idx_compaction_created ON compaction_history(created_at);
        `);
      }
    },
  },
  {
    version: 14,
    description: 'Add token_economics table for chunk token cost and retrieval ROI tracking',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='token_economics'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE token_economics (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            chunk_id          INTEGER NOT NULL UNIQUE,
            discovery_tokens  INTEGER NOT NULL DEFAULT 0,
            retrieval_count   INTEGER NOT NULL DEFAULT 0,
            total_read_tokens INTEGER NOT NULL DEFAULT 0,
            created_at        TEXT    NOT NULL,
            last_read_at      TEXT,
            FOREIGN KEY (chunk_id) REFERENCES context_chunks(id) ON DELETE CASCADE
          );
          CREATE INDEX idx_token_economics_chunk   ON token_economics(chunk_id);
          CREATE INDEX idx_token_economics_created ON token_economics(created_at);
        `);
      }
    },
  },
  {
    version: 15,
    description: 'Add pending_pairings table for cross-process pairing code persistence',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='pending_pairings'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE pending_pairings (
            code         TEXT PRIMARY KEY,
            sender_id    TEXT NOT NULL,
            channel      TEXT NOT NULL,
            requested_at TEXT NOT NULL,
            attempts     INTEGER NOT NULL DEFAULT 0
          );
        `);
      }
    },
  },
  {
    version: 16,
    description: 'Deduplicate prompt_versions: keep only latest id per (name, content) pair',
    apply: (db): void => {
      // Skip if the prompts table does not exist (e.g. minimal test databases)
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='prompts'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) return;

      // Delete all rows that are not the latest (highest id) for their (name, content) pair.
      db.exec(`
        DELETE FROM prompts
        WHERE id NOT IN (
          SELECT MAX(id)
          FROM prompts
          GROUP BY name, content
        )
      `);
    },
  },
  {
    version: 17,
    description:
      'Add processed_documents and processed_documents_fts tables for document intelligence',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='processed_documents'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE processed_documents (
            id           TEXT PRIMARY KEY,
            filename     TEXT NOT NULL,
            mime_type    TEXT NOT NULL,
            file_path    TEXT NOT NULL,
            doc_type     TEXT NOT NULL DEFAULT 'unknown',
            raw_text     TEXT NOT NULL DEFAULT '',
            entities     TEXT NOT NULL DEFAULT '[]',
            relations    TEXT NOT NULL DEFAULT '[]',
            tables       TEXT NOT NULL DEFAULT '[]',
            metadata     TEXT NOT NULL DEFAULT '{}',
            processed_at TEXT NOT NULL,
            source       TEXT
          );
          CREATE VIRTUAL TABLE processed_documents_fts
            USING fts5(raw_text, filename, content='processed_documents', content_rowid='rowid');
          CREATE INDEX idx_processed_documents_mime      ON processed_documents(mime_type);
          CREATE INDEX idx_processed_documents_processed ON processed_documents(processed_at);
        `);
      }
    },
  },
  {
    version: 18,
    description:
      'Add DocType metadata tables (doctypes, doctype_fields, doctype_states, doctype_transitions, doctype_hooks, doctype_relations, dt_series) and indexes',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='doctypes'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE doctypes (
            id              TEXT PRIMARY KEY,
            name            TEXT NOT NULL UNIQUE,
            label_singular  TEXT NOT NULL,
            label_plural    TEXT NOT NULL,
            icon            TEXT,
            table_name      TEXT NOT NULL UNIQUE,
            source          TEXT NOT NULL,
            template_id     TEXT,
            created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at      TEXT DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE doctype_fields (
            id              TEXT PRIMARY KEY,
            doctype_id      TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
            name            TEXT NOT NULL,
            label           TEXT NOT NULL,
            field_type      TEXT NOT NULL,
            required        INTEGER DEFAULT 0,
            default_value   TEXT,
            options         TEXT,
            formula         TEXT,
            depends_on      TEXT,
            searchable      INTEGER DEFAULT 0,
            sort_order      INTEGER NOT NULL,
            link_doctype    TEXT,
            child_doctype   TEXT,
            UNIQUE(doctype_id, name)
          );

          CREATE TABLE doctype_states (
            id              TEXT PRIMARY KEY,
            doctype_id      TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
            name            TEXT NOT NULL,
            label           TEXT NOT NULL,
            color           TEXT DEFAULT 'gray',
            is_initial      INTEGER DEFAULT 0,
            is_terminal     INTEGER DEFAULT 0,
            sort_order      INTEGER NOT NULL,
            UNIQUE(doctype_id, name)
          );

          CREATE TABLE doctype_transitions (
            id              TEXT PRIMARY KEY,
            doctype_id      TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
            from_state      TEXT NOT NULL,
            to_state        TEXT NOT NULL,
            action_name     TEXT NOT NULL,
            action_label    TEXT NOT NULL,
            allowed_roles   TEXT,
            condition       TEXT,
            UNIQUE(doctype_id, from_state, action_name)
          );

          CREATE TABLE doctype_hooks (
            id              TEXT PRIMARY KEY,
            doctype_id      TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
            event           TEXT NOT NULL,
            action_type     TEXT NOT NULL,
            action_config   TEXT NOT NULL,
            sort_order      INTEGER DEFAULT 0,
            enabled         INTEGER DEFAULT 1
          );

          CREATE TABLE doctype_relations (
            id              TEXT PRIMARY KEY,
            from_doctype    TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
            to_doctype      TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
            relation_type   TEXT NOT NULL,
            from_field      TEXT NOT NULL,
            to_field        TEXT DEFAULT 'id',
            label           TEXT
          );

          CREATE TABLE dt_series (
            prefix          TEXT PRIMARY KEY,
            current_value   INTEGER DEFAULT 0
          );

          CREATE INDEX idx_doctype_fields_doctype
            ON doctype_fields(doctype_id);
          CREATE INDEX idx_doctype_states_doctype
            ON doctype_states(doctype_id);
          CREATE INDEX idx_doctype_transitions_doctype
            ON doctype_transitions(doctype_id);
        `);
      }
    },
  },
  {
    version: 19,
    description: 'Add integration_credentials table for AES-256-GCM encrypted credential storage',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='integration_credentials'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE integration_credentials (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            integration_name TEXT    NOT NULL UNIQUE,
            encrypted        TEXT    NOT NULL,
            iv               TEXT    NOT NULL,
            auth_tag         TEXT    NOT NULL,
            health_status    TEXT    NOT NULL DEFAULT 'unknown',
            created_at       TEXT    NOT NULL,
            updated_at       TEXT    NOT NULL
          );
          CREATE INDEX idx_integration_credentials_name ON integration_credentials(integration_name);
        `);
      }
    },
  },
  {
    version: 20,
    description:
      'Add workflow engine tables (workflows, workflow_runs, workflow_approvals) and indexes',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='workflows'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
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

          CREATE INDEX idx_workflows_enabled     ON workflows(enabled);
          CREATE INDEX idx_workflows_trigger_type ON workflows(trigger_type);
          CREATE INDEX idx_workflow_runs_workflow ON workflow_runs(workflow_id);
          CREATE INDEX idx_workflow_runs_status   ON workflow_runs(status);
          CREATE INDEX idx_workflow_runs_started  ON workflow_runs(started_at);
          CREATE INDEX idx_workflow_approvals_run ON workflow_approvals(workflow_run_id);
        `);
      }
    },
  },
  {
    version: 21,
    description: 'Add integration_capabilities table for role-based capability tagging',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='integration_capabilities'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE integration_capabilities (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            integration_name TEXT    NOT NULL,
            capability_name  TEXT    NOT NULL,
            role             TEXT    NOT NULL,
            tagged_at        TEXT    NOT NULL,
            UNIQUE(integration_name, capability_name, role)
          );
          CREATE INDEX idx_integration_capabilities_name
            ON integration_capabilities(integration_name);
          CREATE INDEX idx_integration_capabilities_role
            ON integration_capabilities(integration_name, role);
        `);
      }
    },
  },
  {
    version: 22,
    description: 'Add integration_health_log table for API connection health monitoring',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='integration_health_log'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE integration_health_log (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            integration_name TEXT    NOT NULL,
            status           TEXT    NOT NULL,
            message          TEXT,
            endpoint_url     TEXT,
            http_status      INTEGER,
            latency_ms       INTEGER,
            checked_at       TEXT    NOT NULL
          );
          CREATE INDEX idx_integration_health_log_name
            ON integration_health_log(integration_name);
          CREATE INDEX idx_integration_health_log_checked
            ON integration_health_log(integration_name, checked_at);
        `);
      }
    },
  },
  {
    version: 23,
    description: 'Add business_skills table for learned skill patterns',
    apply: (db): void => {
      const hasTable =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name='business_skills'`,
            )
            .get() as { c: number }
        ).c > 0;
      if (!hasTable) {
        db.exec(`
          CREATE TABLE business_skills (
            id                    INTEGER PRIMARY KEY AUTOINCREMENT,
            name                  TEXT    NOT NULL,
            description           TEXT    NOT NULL,
            steps                 TEXT    NOT NULL DEFAULT '[]',
            required_integrations TEXT    NOT NULL DEFAULT '[]',
            required_doc_types    TEXT    NOT NULL DEFAULT '[]',
            created_at            TEXT    NOT NULL
          );
          CREATE INDEX idx_business_skills_name
            ON business_skills(name);
          CREATE INDEX idx_business_skills_created
            ON business_skills(created_at);
        `);
      }
    },
  },
];

/**
 * Apply all numbered schema migrations to the database.
 *
 * On each startup, queries MAX(version) from schema_versions to determine
 * the highest migration already applied. Only migrations with a version
 * greater than that maximum are executed. Each migration is wrapped in a
 * transaction so that a failure rolls back both the DDL change and the
 * schema_versions insert, leaving the database in a consistent state.
 */
export function applySchemaChanges(db: Database.Database): void {
  const now = new Date().toISOString();

  // Determine the highest migration version already recorded.
  const row = db.prepare('SELECT MAX(version) AS max_version FROM schema_versions').get() as
    | { max_version: number | null }
    | undefined;
  const maxVersion = row?.max_version ?? 0;

  const recordVersion = db.prepare(
    `INSERT OR IGNORE INTO schema_versions (version, applied_at, description) VALUES (?, ?, ?)`,
  );

  for (const migration of MIGRATIONS) {
    if (migration.version <= maxVersion) {
      continue; // Already applied — skip
    }

    // Wrap the migration and version recording in a single transaction so
    // a failure rolls back both the DDL change and the version record.
    db.transaction((): void => {
      migration.apply(db);
      recordVersion.run(migration.version, now, migration.description);
    })();
  }
}

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
  status: 'active' | 'ended' | 'crashed' | 'closed' | 'expired';
  restart_count?: number;
  message_count?: number;
  allowed_tools?: string;
  /** JSON-serialized checkpoint state (pending workers, results, message context) */
  checkpoint_data?: string;
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
  checkpoint_data: string | null;
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
    checkpoint_data: row.checkpoint_data ?? undefined,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
  };
}

export function upsertSession(db: Database.Database, session: SessionRecord): void {
  db.prepare(
    `INSERT OR REPLACE INTO sessions
       (id, type, status, restart_count, message_count, allowed_tools, checkpoint_data, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    session.id,
    session.type,
    session.status,
    session.restart_count ?? 0,
    session.message_count ?? 0,
    session.allowed_tools ?? null,
    session.checkpoint_data ?? null,
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

/**
 * On startup, mark any session that is still `active` but whose `last_used_at`
 * is more than 24 hours ago as `expired`.  These are sessions from a previous
 * process run that were never cleanly closed (e.g. the process was killed) and
 * are now too old to resume safely.  Returns the number of rows updated.
 */
export function markExpiredSessions(db: Database.Database, thresholdHours = 24): number {
  const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE sessions
       SET status = 'expired', last_used_at = ?
       WHERE status = 'active' AND last_used_at < ?`,
    )
    .run(now, cutoff);
  return result.changes;
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

  void storeChunks(db, chunks);
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

  const now = new Date().toISOString();
  db.prepare(`INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, ?)`).run(
    'exploration_state',
    JSON.stringify(result.data),
    now,
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
  // Drop the exploration_state table — exploration state is now stored in system_config
  db.exec('DROP TABLE IF EXISTS exploration_state');

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
