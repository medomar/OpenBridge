import Database from 'better-sqlite3';

/**
 * Opens (or creates) the SQLite database at the given path.
 * Configures WAL mode, PRAGMAs, and creates all tables on first run.
 */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // PRAGMAs for safety and performance
  db.pragma('journal_mode=WAL');
  db.pragma('synchronous=NORMAL');
  db.pragma('busy_timeout=5000');
  db.pragma('foreign_keys=ON');

  createSchema(db);

  return db;
}

/** Closes the database connection. */
export function closeDatabase(db: Database.Database): void {
  db.close();
}

function createSchema(db: Database.Database): void {
  db.exec(`
    -- context_chunks: workspace knowledge, chunked for retrieval
    CREATE TABLE IF NOT EXISTS context_chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      scope       TEXT    NOT NULL,
      category    TEXT    NOT NULL,
      content     TEXT    NOT NULL,
      source_hash TEXT,
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL,
      stale       BOOLEAN DEFAULT 0
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

    -- exploration_state: resumability (replaces exploration-state.json)
    CREATE TABLE IF NOT EXISTS exploration_state (
      id              INTEGER PRIMARY KEY DEFAULT 1,
      current_phase   TEXT    NOT NULL,
      status          TEXT    NOT NULL,
      directory_dives TEXT,
      started_at      TEXT,
      completed_at    TEXT
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
      cost_usd     REAL,
      started_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL,
      completed_at TEXT,
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
  `);
}
