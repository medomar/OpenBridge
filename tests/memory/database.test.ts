import { describe, it, expect, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase, resolveDbPath } from '../../src/memory/database.js';

describe('database.ts', () => {
  let db: Database.Database;

  afterEach(() => {
    try {
      if (db?.open) closeDatabase(db);
    } catch {
      // already closed
    }
  });

  describe('openDatabase', () => {
    it('opens an in-memory database without error', () => {
      db = openDatabase(':memory:');
      expect(db).toBeDefined();
      expect(db.open).toBe(true);
    });

    it('enables WAL journal mode for file-based databases', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ob-db-wal-test-'));
      const filePath = path.join(tmpDir, 'test.db');
      try {
        const fileDb = openDatabase(filePath);
        const mode = fileDb.pragma('journal_mode', { simple: true });
        fileDb.close();
        expect(mode).toBe('wal');
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('enables foreign keys', () => {
      db = openDatabase(':memory:');
      const fk = db.pragma('foreign_keys', { simple: true });
      expect(fk).toBe(1);
    });

    it('creates all base tables', () => {
      db = openDatabase(':memory:');
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);
      expect(names).toContain('context_chunks');
      expect(names).toContain('conversations');
      expect(names).toContain('tasks');
      expect(names).toContain('learnings');
      expect(names).toContain('prompts');
      expect(names).toContain('sessions');
      expect(names).toContain('workspace_state');
      expect(names).toContain('system_config');
      expect(names).not.toContain('exploration_state');
    });

    it('creates both FTS5 virtual tables', () => {
      db = openDatabase(':memory:');
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
        .all() as { name: string }[];
      const names = tables.map((t) => t.name);
      expect(names).toContain('context_chunks_fts');
      expect(names).toContain('conversations_fts');
    });

    it('creates all expected indexes', () => {
      db = openDatabase(':memory:');
      const indexes = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as {
        name: string;
      }[];
      const names = indexes.map((i) => i.name);
      expect(names).toContain('idx_tasks_type_status');
      expect(names).toContain('idx_conversations_session');
      expect(names).toContain('idx_context_scope');
      expect(names).toContain('idx_learnings_type');
      expect(names).toContain('idx_prompts_active');
    });

    it('is idempotent — calling openDatabase twice with same path does not throw', () => {
      db = openDatabase(':memory:');
      // A second call should not throw (CREATE IF NOT EXISTS)
      expect(() => openDatabase(':memory:')).not.toThrow();
    });
  });

  describe('closeDatabase', () => {
    it('closes an open database', () => {
      db = openDatabase(':memory:');
      expect(db.open).toBe(true);
      closeDatabase(db);
      expect(db.open).toBe(false);
    });
  });

  describe('resolveDbPath', () => {
    it('returns workspace-scoped path when workspacePath is given', () => {
      const result = resolveDbPath('/home/user/myproject');
      expect(result).toBe(path.join('/home/user/myproject', '.openbridge', 'openbridge.db'));
    });

    it('resolved path ends with openbridge.db', () => {
      const result = resolveDbPath('/some/workspace');
      expect(result.endsWith('openbridge.db')).toBe(true);
    });

    it('returns a path under getConfigDir() when no workspace is given (dev mode)', () => {
      // In dev mode getConfigDir() returns process.cwd()
      const result = resolveDbPath();
      expect(result.endsWith('openbridge.db')).toBe(true);
      expect(path.isAbsolute(result)).toBe(true);
    });

    it('returns path under ~/.openbridge when in packaged mode', () => {
      vi.stubGlobal('process', { ...process, pkg: {} });
      try {
        const result = resolveDbPath();
        const expected = path.join(os.homedir(), '.openbridge', 'openbridge.db');
        expect(result).toBe(expected);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
