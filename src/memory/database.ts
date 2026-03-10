import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { getConfigDir } from '../cli/utils.js';
import { applySchemaChanges } from './migration.js';

/**
 * Resolves the SQLite database path for a given workspace.
 *
 * - With a workspace path: returns `<workspacePath>/.openbridge/openbridge.db`
 * - Without a workspace path: returns `<getConfigDir()>/openbridge.db`
 *   In packaged mode (pkg binary) `getConfigDir()` = `~/.openbridge/`, ensuring
 *   the database lands on the writable host filesystem rather than the read-only
 *   pkg snapshot. In dev mode it falls back to `process.cwd()`.
 */
export function resolveDbPath(workspacePath?: string): string {
  if (workspacePath) {
    return join(workspacePath, '.openbridge', 'openbridge.db');
  }
  return join(getConfigDir(), 'openbridge.db');
}

/**
 * Opens (or creates) the SQLite database at the given path.
 * Configures WAL mode, PRAGMAs, and creates all tables on first run.
 */
export function openDatabase(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);

  // PRAGMAs for safety and performance
  db.pragma('journal_mode=WAL');
  db.pragma('synchronous=NORMAL');
  db.pragma('busy_timeout=5000');
  db.pragma('foreign_keys=ON');

  createSchema(db);
  applySchemaChanges(db);

  return db;
}

/** Closes the database connection. */
export function closeDatabase(db: Database.Database): void {
  db.close();
}

function createSchema(db: Database.Database): void {
  db.exec(`
    -- schema_versions: tracks applied schema migrations
    CREATE TABLE IF NOT EXISTS schema_versions (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT    NOT NULL,
      description TEXT   NOT NULL
    );

    -- context_chunks: workspace knowledge, chunked for retrieval
    CREATE TABLE IF NOT EXISTS context_chunks (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      scope        TEXT    NOT NULL,
      category     TEXT    NOT NULL,
      content      TEXT    NOT NULL,
      source_hash  TEXT,
      content_hash TEXT,
      created_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL,
      stale        BOOLEAN DEFAULT 0
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS context_chunks_fts
      USING fts5(content, scope, category);

    -- conversations: every user<->Master message exchange
    CREATE TABLE IF NOT EXISTS conversations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT    NOT NULL,
      role       TEXT    NOT NULL,
      content    TEXT    NOT NULL,
      channel    TEXT,
      user_id    TEXT,
      created_at TEXT    NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS conversations_fts
      USING fts5(content);

    -- tasks: execution records (replaces tasks/*.json + workers.json)
    CREATE TABLE IF NOT EXISTS tasks (
      id             TEXT    PRIMARY KEY,
      type           TEXT    NOT NULL,
      status         TEXT    NOT NULL,
      prompt         TEXT,
      response       TEXT,
      model          TEXT,
      profile        TEXT,
      turns_used     INTEGER,
      max_turns      INTEGER,
      duration_ms    INTEGER,
      exit_code      INTEGER,
      retries        INTEGER DEFAULT 0,
      parent_task_id TEXT,
      created_at     TEXT    NOT NULL,
      completed_at   TEXT,
      FOREIGN KEY (parent_task_id) REFERENCES tasks(id)
    );

    -- learnings: aggregated model/task-type performance stats
    CREATE TABLE IF NOT EXISTS learnings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type        TEXT    NOT NULL,
      model            TEXT    NOT NULL,
      success_count    INTEGER DEFAULT 0,
      failure_count    INTEGER DEFAULT 0,
      total_turns      INTEGER DEFAULT 0,
      total_duration_ms INTEGER DEFAULT 0,
      avg_turns        REAL    GENERATED ALWAYS AS (
                         CASE WHEN (success_count + failure_count) > 0
                         THEN CAST(total_turns AS REAL) / (success_count + failure_count)
                         ELSE 0 END) STORED,
      success_rate     REAL    GENERATED ALWAYS AS (
                         CASE WHEN (success_count + failure_count) > 0
                         THEN CAST(success_count AS REAL) / (success_count + failure_count)
                         ELSE 0 END) STORED,
      last_used_at     TEXT    NOT NULL,
      UNIQUE(task_type, model)
    );

    -- prompts: versioned with effectiveness tracking
    CREATE TABLE IF NOT EXISTS prompts (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      version       INTEGER NOT NULL,
      content       TEXT    NOT NULL,
      effectiveness REAL    DEFAULT 0.5,
      usage_count   INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      active        BOOLEAN DEFAULT 1,
      created_at    TEXT    NOT NULL,
      UNIQUE(name, version)
    );

    -- sessions: Master session state (replaces master-session.json)
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT    PRIMARY KEY,
      type          TEXT    NOT NULL,
      status        TEXT    NOT NULL,
      restart_count INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      allowed_tools TEXT,
      created_at    TEXT    NOT NULL,
      last_used_at  TEXT    NOT NULL
    );

    -- workspace_state: git change detection (replaces analysis-marker.json)
    CREATE TABLE IF NOT EXISTS workspace_state (
      id               INTEGER PRIMARY KEY DEFAULT 1,
      commit_hash      TEXT,
      branch           TEXT,
      has_git          BOOLEAN,
      analyzed_at      TEXT    NOT NULL,
      last_verified_at TEXT,
      analysis_type    TEXT    NOT NULL,
      files_changed    INTEGER DEFAULT 0
    );

    -- system_config: key-value store (replaces agents.json, profiles.json)
    CREATE TABLE IF NOT EXISTS system_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- agent_activity: real-time agent/worker status tracking
    CREATE TABLE IF NOT EXISTS agent_activity (
      id           TEXT    PRIMARY KEY,
      type         TEXT    NOT NULL,
      model        TEXT,
      profile      TEXT,
      task_summary TEXT,
      status       TEXT    NOT NULL,
      progress_pct INTEGER,
      parent_id    TEXT,
      pid          INTEGER,
      cost_usd     REAL,
      started_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL,
      completed_at TEXT,
      summary_json TEXT,
      FOREIGN KEY (parent_id) REFERENCES agent_activity(id)
    );

    -- exploration_progress: granular exploration tracking
    CREATE TABLE IF NOT EXISTS exploration_progress (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      exploration_id TEXT    NOT NULL,
      phase          TEXT    NOT NULL,
      target         TEXT,
      status         TEXT    NOT NULL,
      progress_pct   INTEGER DEFAULT 0,
      files_processed INTEGER DEFAULT 0,
      files_total    INTEGER,
      started_at     TEXT,
      completed_at   TEXT,
      FOREIGN KEY (exploration_id) REFERENCES agent_activity(id)
    );

    -- access_control: per-user role-based permissions
    CREATE TABLE IF NOT EXISTS access_control (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id              TEXT    NOT NULL,
      channel              TEXT    NOT NULL,
      role                 TEXT    NOT NULL DEFAULT 'owner',
      scopes               TEXT,
      allowed_actions      TEXT,
      blocked_actions      TEXT,
      max_cost_per_day_usd REAL,
      daily_cost_used      REAL    DEFAULT 0,
      cost_reset_at        TEXT,
      active               BOOLEAN DEFAULT 1,
      created_at           TEXT    NOT NULL,
      updated_at           TEXT    NOT NULL,
      UNIQUE(user_id, channel)
    );

    -- sub_masters: registry of sub-project master AI instances
    CREATE TABLE IF NOT EXISTS sub_masters (
      id             TEXT    PRIMARY KEY,
      path           TEXT    NOT NULL UNIQUE,
      name           TEXT    NOT NULL,
      capabilities   TEXT,
      file_count     INTEGER,
      last_synced_at TEXT,
      status         TEXT    NOT NULL DEFAULT 'active'
    );

    -- observations: structured facts extracted from worker outputs
    CREATE TABLE IF NOT EXISTS observations (
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

    CREATE INDEX IF NOT EXISTS idx_observations_session   ON observations(session_id);
    CREATE INDEX IF NOT EXISTS idx_observations_worker    ON observations(worker_id);
    CREATE INDEX IF NOT EXISTS idx_observations_type      ON observations(type);
    CREATE INDEX IF NOT EXISTS idx_observations_created   ON observations(created_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts
      USING fts5(title, narrative, content=observations, content_rowid=id);

    CREATE TRIGGER IF NOT EXISTS observations_fts_ai AFTER INSERT ON observations BEGIN
      INSERT INTO observations_fts(rowid, title, narrative)
        VALUES (new.id, new.title, new.narrative);
    END;

    CREATE TRIGGER IF NOT EXISTS observations_fts_ad AFTER DELETE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, title, narrative)
        VALUES ('delete', old.id, old.title, old.narrative);
    END;

    CREATE TRIGGER IF NOT EXISTS observations_fts_au AFTER UPDATE ON observations BEGIN
      INSERT INTO observations_fts(observations_fts, rowid, title, narrative)
        VALUES ('delete', old.id, old.title, old.narrative);
      INSERT INTO observations_fts(rowid, title, narrative)
        VALUES (new.id, new.title, new.narrative);
    END;

    -- compaction_history: records each session compaction event
    CREATE TABLE IF NOT EXISTS compaction_history (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id            TEXT    NOT NULL,
      trigger_reason        TEXT    NOT NULL,
      turns_summarized      INTEGER NOT NULL,
      identifiers_preserved TEXT    NOT NULL DEFAULT '{}',
      summary_length        INTEGER NOT NULL DEFAULT 0,
      created_at            TEXT    NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_compaction_session  ON compaction_history(session_id);
    CREATE INDEX IF NOT EXISTS idx_compaction_created  ON compaction_history(created_at);

    -- token_economics: tracks token cost and retrieval ROI per chunk
    CREATE TABLE IF NOT EXISTS token_economics (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id          INTEGER NOT NULL UNIQUE,
      discovery_tokens  INTEGER NOT NULL DEFAULT 0,
      retrieval_count   INTEGER NOT NULL DEFAULT 0,
      total_read_tokens INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT    NOT NULL,
      last_read_at      TEXT,
      FOREIGN KEY (chunk_id) REFERENCES context_chunks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_token_economics_chunk   ON token_economics(chunk_id);
    CREATE INDEX IF NOT EXISTS idx_token_economics_created ON token_economics(created_at);

    -- embeddings: vector representations of context chunks for semantic search
    CREATE TABLE IF NOT EXISTS embeddings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id    INTEGER NOT NULL,
      vector      BLOB    NOT NULL,
      model       TEXT    NOT NULL,
      dimensions  INTEGER NOT NULL,
      created_at  TEXT    NOT NULL,
      FOREIGN KEY (chunk_id) REFERENCES context_chunks(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_embeddings_chunk ON embeddings(chunk_id);
    CREATE INDEX IF NOT EXISTS idx_embeddings_model ON embeddings(model);

    -- audit_log: structured audit trail (replaces flat-file JSONL)
    CREATE TABLE IF NOT EXISTS audit_log (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp      TEXT    NOT NULL,
      event          TEXT    NOT NULL,
      message_id     TEXT,
      sender         TEXT,
      source         TEXT,
      recipient      TEXT,
      content_length INTEGER,
      error          TEXT,
      metadata       TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS audit_log_fts
      USING fts5(event, sender, source, recipient, error);

    -- qa_cache: cached Q&A pairs for instant retrieval
    CREATE TABLE IF NOT EXISTS qa_cache (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      question     TEXT    NOT NULL,
      answer       TEXT    NOT NULL,
      confidence   REAL    NOT NULL DEFAULT 0.5,
      file_paths   TEXT,
      created_at   TEXT    NOT NULL,
      accessed_at  TEXT    NOT NULL,
      access_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS qa_cache_fts
      USING fts5(question, content=qa_cache, content_rowid=id);

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_tasks_type_status   ON tasks(type, status);
    CREATE INDEX IF NOT EXISTS idx_tasks_created       ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
    CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
    CREATE INDEX IF NOT EXISTS idx_context_scope       ON context_chunks(scope);
    CREATE INDEX IF NOT EXISTS idx_context_stale       ON context_chunks(stale);
    CREATE INDEX IF NOT EXISTS idx_learnings_type      ON learnings(task_type);
    CREATE INDEX IF NOT EXISTS idx_prompts_active      ON prompts(name, active);
    CREATE INDEX IF NOT EXISTS idx_agent_activity_status  ON agent_activity(status);
    CREATE INDEX IF NOT EXISTS idx_agent_activity_type    ON agent_activity(type);
    CREATE INDEX IF NOT EXISTS idx_exploration_id         ON exploration_progress(exploration_id);
    CREATE INDEX IF NOT EXISTS idx_exploration_status     ON exploration_progress(status);
    CREATE INDEX IF NOT EXISTS idx_audit_event            ON audit_log(event);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp        ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_sender           ON audit_log(sender);
    CREATE INDEX IF NOT EXISTS idx_qa_cache_created       ON qa_cache(created_at);
    CREATE INDEX IF NOT EXISTS idx_qa_cache_confidence    ON qa_cache(confidence);

    -- pending_pairings: temporary pairing codes for unknown senders (5-minute TTL)
    CREATE TABLE IF NOT EXISTS pending_pairings (
      code         TEXT PRIMARY KEY,
      sender_id    TEXT NOT NULL,
      channel      TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      attempts     INTEGER NOT NULL DEFAULT 0
    );
  `);
}
