import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
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
});
