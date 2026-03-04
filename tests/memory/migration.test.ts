import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  applySchemaChanges,
  migrateJsonToSqlite,
  getWorkspaceState,
  updateWorkspaceState,
  getSession,
  upsertSession,
  type WorkspaceState,
  type SessionRecord,
} from '../../src/memory/migration.js';

describe('migration.ts', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = openDatabase(':memory:');
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-migration-test-'));
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------------------------------------------------------------------------
  // Workspace State CRUD
  // ---------------------------------------------------------------------------

  describe('updateWorkspaceState + getWorkspaceState', () => {
    it('returns null when no workspace state exists', () => {
      expect(getWorkspaceState(db)).toBeNull();
    });

    it('inserts and retrieves workspace state', () => {
      const state: WorkspaceState = {
        commit_hash: 'abc123',
        branch: 'main',
        has_git: true,
        analyzed_at: '2026-01-15T10:00:00.000Z',
        analysis_type: 'full',
        files_changed: 5,
      };
      updateWorkspaceState(db, state);
      const retrieved = getWorkspaceState(db);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.commit_hash).toBe('abc123');
      expect(retrieved!.branch).toBe('main');
      expect(retrieved!.has_git).toBe(true);
      expect(retrieved!.analysis_type).toBe('full');
    });

    it('replaces existing workspace state (upsert to id=1)', () => {
      updateWorkspaceState(db, {
        commit_hash: 'first',
        has_git: false,
        analyzed_at: '2026-01-01T00:00:00.000Z',
        analysis_type: 'initial',
      });
      updateWorkspaceState(db, {
        commit_hash: 'second',
        has_git: true,
        analyzed_at: '2026-01-02T00:00:00.000Z',
        analysis_type: 'incremental',
      });
      const state = getWorkspaceState(db);
      expect(state!.commit_hash).toBe('second');
      // Only one row should exist
      const count = (db.prepare('SELECT COUNT(*) as c FROM workspace_state').get() as { c: number })
        .c;
      expect(count).toBe(1);
    });

    it('stores optional fields as null when not provided', () => {
      updateWorkspaceState(db, {
        analyzed_at: '2026-01-01T00:00:00.000Z',
        analysis_type: 'quick',
      });
      const state = getWorkspaceState(db);
      expect(state!.commit_hash).toBeUndefined();
      expect(state!.branch).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Sessions CRUD
  // ---------------------------------------------------------------------------

  describe('upsertSession + getSession', () => {
    const makeSession = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
      id: 'sess-' + Math.random().toString(36).slice(2),
      type: 'master',
      status: 'active',
      restart_count: 0,
      message_count: 10,
      created_at: '2026-01-01T00:00:00.000Z',
      last_used_at: '2026-01-02T00:00:00.000Z',
      ...overrides,
    });

    it('returns null when no session of that type exists', () => {
      expect(getSession(db, 'master')).toBeNull();
    });

    it('inserts and retrieves a session by type', () => {
      const session = makeSession({ type: 'master' });
      upsertSession(db, session);
      const retrieved = getSession(db, 'master');
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(session.id);
      expect(retrieved!.status).toBe('active');
    });

    it('updates an existing session on re-insert (same id)', () => {
      const session = makeSession({ id: 'fixed-id', type: 'exploration', status: 'active' });
      upsertSession(db, session);
      upsertSession(db, { ...session, status: 'ended', message_count: 42 });
      const retrieved = getSession(db, 'exploration');
      expect(retrieved!.status).toBe('ended');
      expect(retrieved!.message_count).toBe(42);
    });

    it('returns the most recently used session when multiple exist for the same type', () => {
      upsertSession(db, makeSession({ type: 'master', last_used_at: '2026-01-01T00:00:00.000Z' }));
      upsertSession(db, makeSession({ type: 'master', last_used_at: '2026-01-03T00:00:00.000Z' }));
      const retrieved = getSession(db, 'master');
      expect(retrieved!.last_used_at).toBe('2026-01-03T00:00:00.000Z');
    });
  });

  // ---------------------------------------------------------------------------
  // migrateJsonToSqlite
  // ---------------------------------------------------------------------------

  describe('migrateJsonToSqlite', () => {
    it('completes without error when no JSON files exist (fresh install)', async () => {
      await expect(migrateJsonToSqlite(db, tmpDir)).resolves.toBeUndefined();
    });

    it('migrates workspace-map.json to context_chunks', async () => {
      const workspaceMap = {
        workspacePath: tmpDir,
        projectName: 'test-project',
        projectType: 'nodejs',
        summary: 'A test project for migration testing',
        structure: {},
        keyFiles: [],
        entryPoints: [],
        frameworks: ['express'],
        dependencies: [{ name: 'lodash', version: '4.0.0', type: 'prod' }],
        commands: { test: 'npm test' },
        generatedAt: '2026-01-01T00:00:00.000Z',
        schemaVersion: '1.0.0',
      };
      fs.writeFileSync(path.join(tmpDir, 'workspace-map.json'), JSON.stringify(workspaceMap));

      await migrateJsonToSqlite(db, tmpDir);

      const count = (db.prepare('SELECT COUNT(*) as c FROM context_chunks').get() as { c: number })
        .c;
      expect(count).toBeGreaterThan(0);
    });

    it('renames successfully migrated files to *.json.migrated', async () => {
      const workspaceMap = {
        workspacePath: tmpDir,
        projectName: 'test-project',
        projectType: 'nodejs',
        summary: 'A test project',
        structure: {},
        keyFiles: [],
        entryPoints: [],
        frameworks: [],
        dependencies: [],
        commands: {},
        analyzedAt: '2026-01-01T00:00:00.000Z',
        agentVersion: '1',
      };
      fs.writeFileSync(path.join(tmpDir, 'workspace-map.json'), JSON.stringify(workspaceMap));

      await migrateJsonToSqlite(db, tmpDir);

      expect(fs.existsSync(path.join(tmpDir, 'workspace-map.json'))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'workspace-map.json.migrated'))).toBe(true);
    });

    it('skips corrupt JSON files without throwing', async () => {
      fs.writeFileSync(path.join(tmpDir, 'workspace-map.json'), 'not-valid-json');
      await expect(migrateJsonToSqlite(db, tmpDir)).resolves.toBeUndefined();
    });

    it('migrates tasks/*.json to tasks table', async () => {
      const tasksDir = path.join(tmpDir, 'tasks');
      fs.mkdirSync(tasksDir);
      const taskRecord = {
        id: 'task-migrate-001',
        userMessage: 'fix bug',
        sender: '+1234567890',
        description: 'Fix authentication bug',
        result: 'done',
        status: 'completed',
        handledBy: 'master',
        durationMs: 2000,
        createdAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:01:00.000Z',
      };
      fs.writeFileSync(path.join(tasksDir, 'task-001.json'), JSON.stringify(taskRecord));

      await migrateJsonToSqlite(db, tmpDir);

      const row = db.prepare("SELECT * FROM tasks WHERE id = 'task-migrate-001'").get();
      expect(row).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // applySchemaChanges — version tracking, idempotency, rollback
  // ---------------------------------------------------------------------------

  describe('applySchemaChanges', () => {
    // The shared `db` from the outer beforeEach is opened via openDatabase(), which
    // already called applySchemaChanges() once. Tests in this block verify the
    // behaviour of calling it again and specific edge cases using raw databases.

    it('records each migration in schema_versions with version, applied_at, and description', () => {
      const rows = db
        .prepare('SELECT version, description, applied_at FROM schema_versions ORDER BY version')
        .all() as { version: number; description: string; applied_at: string }[];

      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0].version).toBe(1);
      expect(rows[0].description).toBe('Add pid column to agent_activity');
      expect(rows[1].version).toBe(2);
      expect(rows[1].description).toBe('Add title column to conversations');

      // applied_at must be a valid ISO timestamp
      expect(new Date(rows[0].applied_at).toISOString()).toBe(rows[0].applied_at);
    });

    it('is idempotent — calling applySchemaChanges twice does not create duplicate rows', () => {
      const countBefore = (
        db.prepare('SELECT COUNT(*) as c FROM schema_versions').get() as { c: number }
      ).c;

      // Second call — all migrations are already at or below MAX(version)
      applySchemaChanges(db);

      const countAfter = (
        db.prepare('SELECT COUNT(*) as c FROM schema_versions').get() as { c: number }
      ).c;
      expect(countAfter).toBe(countBefore);
    });

    it('does not re-apply column additions when database is already migrated', () => {
      // conversations.title should already exist (added by migration v2 during openDatabase)
      const titleCount = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM pragma_table_info('conversations') WHERE name='title'`,
          )
          .get() as { c: number }
      ).c;
      expect(titleCount).toBe(1);

      applySchemaChanges(db);

      // Still exactly one title column after second call
      const titleCountAfter = (
        db
          .prepare(
            `SELECT COUNT(*) as c FROM pragma_table_info('conversations') WHERE name='title'`,
          )
          .get() as { c: number }
      ).c;
      expect(titleCountAfter).toBe(1);
    });

    it('applies only migrations with version > MAX(version) in schema_versions', () => {
      // Build a minimal raw database: schema_versions + the tables touched by migrations,
      // but only pre-mark v1 as applied. This verifies only v2, v3, v4, v5 run.
      const rawDb = new Database(':memory:');
      rawDb.exec(`
        CREATE TABLE schema_versions (
          version    INTEGER PRIMARY KEY,
          applied_at TEXT    NOT NULL,
          description TEXT   NOT NULL
        );
        CREATE TABLE agent_activity (
          id         TEXT PRIMARY KEY,
          type       TEXT NOT NULL,
          status     TEXT NOT NULL,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          pid        INTEGER
        );
        CREATE TABLE conversations (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          role       TEXT NOT NULL,
          content    TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE TABLE sessions (
          id            TEXT PRIMARY KEY,
          type          TEXT NOT NULL,
          status        TEXT NOT NULL,
          restart_count INTEGER DEFAULT 0,
          message_count INTEGER DEFAULT 0,
          allowed_tools TEXT,
          created_at    TEXT NOT NULL,
          last_used_at  TEXT NOT NULL
        );
        CREATE TABLE access_control (
          id                   INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id              TEXT    NOT NULL,
          channel              TEXT    NOT NULL,
          role                 TEXT    NOT NULL DEFAULT 'viewer',
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
      `);

      // Pre-mark migration v1 as applied (pid column already present in the schema above)
      rawDb
        .prepare(
          `INSERT INTO schema_versions VALUES (1, '2026-01-01T00:00:00.000Z', 'Add pid column to agent_activity')`,
        )
        .run();

      // conversations.title should not exist yet
      const before = (
        rawDb
          .prepare(
            `SELECT COUNT(*) as c FROM pragma_table_info('conversations') WHERE name='title'`,
          )
          .get() as { c: number }
      ).c;
      expect(before).toBe(0);

      applySchemaChanges(rawDb);

      // Migration v2 should have run — title column now exists
      const after = (
        rawDb
          .prepare(
            `SELECT COUNT(*) as c FROM pragma_table_info('conversations') WHERE name='title'`,
          )
          .get() as { c: number }
      ).c;
      expect(after).toBe(1);

      // Migration v3 should have run — checkpoint_data column now exists on sessions
      const checkpointColCount = (
        rawDb
          .prepare(
            `SELECT COUNT(*) as c FROM pragma_table_info('sessions') WHERE name='checkpoint_data'`,
          )
          .get() as { c: number }
      ).c;
      expect(checkpointColCount).toBe(1);

      // All versions must be recorded in schema_versions
      const versions = rawDb
        .prepare('SELECT version FROM schema_versions ORDER BY version')
        .all() as { version: number }[];
      expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

      rawDb.close();
    });

    it('rolls back schema_versions insert when migration apply() throws', () => {
      // Build a raw database with schema_versions + agent_activity but WITHOUT conversations.
      // Migration v2 tries to ALTER TABLE conversations (non-existent) → throws.
      // The wrapping transaction must roll back so that version 2 is NOT recorded.
      const rawDb = new Database(':memory:');
      rawDb.exec(`
        CREATE TABLE schema_versions (
          version    INTEGER PRIMARY KEY,
          applied_at TEXT    NOT NULL,
          description TEXT   NOT NULL
        );
        CREATE TABLE agent_activity (
          id         TEXT PRIMARY KEY,
          type       TEXT NOT NULL,
          status     TEXT NOT NULL,
          started_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          pid        INTEGER
        );
      `);

      // Pre-mark v1 as applied so only v2 runs
      rawDb
        .prepare(
          `INSERT INTO schema_versions VALUES (1, '2026-01-01T00:00:00.000Z', 'Add pid column to agent_activity')`,
        )
        .run();

      // conversations table intentionally absent — migration v2 will fail
      expect(() => applySchemaChanges(rawDb)).toThrow();

      // Version 2 must NOT be present — the transaction was rolled back
      const v2Row = rawDb.prepare('SELECT version FROM schema_versions WHERE version = 2').get();
      expect(v2Row).toBeUndefined();

      // Version 1 must still be present — unaffected by the failed transaction
      const v1Row = rawDb.prepare('SELECT version FROM schema_versions WHERE version = 1').get();
      expect(v1Row).toBeDefined();

      rawDb.close();
    });
  });
});
