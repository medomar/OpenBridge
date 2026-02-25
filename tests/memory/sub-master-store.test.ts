import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  registerSubMaster,
  getSubMaster,
  listSubMasters,
  updateSubMasterStatus,
  removeSubMaster,
  type SubMasterEntry,
} from '../../src/memory/sub-master-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _entrySeq = 0;

function makeEntry(overrides: Partial<SubMasterEntry> = {}): SubMasterEntry {
  const seq = ++_entrySeq;
  return {
    id: `sm-${seq}`,
    path: `/workspace/packages/pkg-${seq}`,
    name: `pkg-${seq}`,
    status: 'active',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sub-master-store.ts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  // -------------------------------------------------------------------------
  // registerSubMaster
  // -------------------------------------------------------------------------

  describe('registerSubMaster()', () => {
    it('inserts a minimal entry', () => {
      const entry = makeEntry({ id: 'sm-001', path: '/ws/api', name: 'api' });
      registerSubMaster(db, entry);
      const result = getSubMaster(db, 'sm-001');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('sm-001');
      expect(result!.path).toBe('/ws/api');
      expect(result!.name).toBe('api');
    });

    it('defaults status to "active" when not provided', () => {
      const entry = makeEntry({ id: 'sm-002' });
      delete entry.status;
      registerSubMaster(db, entry);
      const result = getSubMaster(db, 'sm-002');
      expect(result!.status).toBe('active');
    });

    it('stores capabilities as a structured object', () => {
      registerSubMaster(
        db,
        makeEntry({
          id: 'sm-003',
          capabilities: {
            frameworks: ['React', 'TypeScript'],
            languages: ['TypeScript'],
            patterns: ['REST API'],
          },
        }),
      );
      const result = getSubMaster(db, 'sm-003');
      expect(result!.capabilities).toEqual({
        frameworks: ['React', 'TypeScript'],
        languages: ['TypeScript'],
        patterns: ['REST API'],
      });
    });

    it('stores file_count', () => {
      registerSubMaster(db, makeEntry({ id: 'sm-004', file_count: 312 }));
      const result = getSubMaster(db, 'sm-004');
      expect(result!.file_count).toBe(312);
    });

    it('stores last_synced_at', () => {
      const now = new Date().toISOString();
      registerSubMaster(db, makeEntry({ id: 'sm-005', last_synced_at: now }));
      const result = getSubMaster(db, 'sm-005');
      expect(result!.last_synced_at).toBe(now);
    });

    it('replaces an existing entry when id matches (INSERT OR REPLACE)', () => {
      registerSubMaster(db, makeEntry({ id: 'sm-006', name: 'old-name', file_count: 100 }));
      registerSubMaster(db, makeEntry({ id: 'sm-006', name: 'new-name', file_count: 200 }));
      const result = getSubMaster(db, 'sm-006');
      expect(result!.name).toBe('new-name');
      expect(result!.file_count).toBe(200);
      // Only one row should exist
      const all = listSubMasters(db);
      expect(all.filter((e) => e.id === 'sm-006')).toHaveLength(1);
    });

    it('stores null capabilities gracefully', () => {
      registerSubMaster(db, makeEntry({ id: 'sm-007', capabilities: null }));
      const result = getSubMaster(db, 'sm-007');
      expect(result!.capabilities).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getSubMaster
  // -------------------------------------------------------------------------

  describe('getSubMaster()', () => {
    it('returns null when id does not exist', () => {
      expect(getSubMaster(db, 'does-not-exist')).toBeNull();
    });

    it('returns the correct entry by id', () => {
      registerSubMaster(db, makeEntry({ id: 'sm-A', name: 'alpha' }));
      registerSubMaster(db, makeEntry({ id: 'sm-B', name: 'beta' }));
      expect(getSubMaster(db, 'sm-A')!.name).toBe('alpha');
      expect(getSubMaster(db, 'sm-B')!.name).toBe('beta');
    });
  });

  // -------------------------------------------------------------------------
  // listSubMasters
  // -------------------------------------------------------------------------

  describe('listSubMasters()', () => {
    it('returns empty array when table is empty', () => {
      expect(listSubMasters(db)).toEqual([]);
    });

    it('returns all entries ordered by path', () => {
      registerSubMaster(db, makeEntry({ id: 'sm-C', path: '/ws/zzz', name: 'zzz' }));
      registerSubMaster(db, makeEntry({ id: 'sm-D', path: '/ws/aaa', name: 'aaa' }));
      registerSubMaster(db, makeEntry({ id: 'sm-E', path: '/ws/mmm', name: 'mmm' }));

      const entries = listSubMasters(db);
      expect(entries).toHaveLength(3);
      expect(entries[0]!.path).toBe('/ws/aaa');
      expect(entries[1]!.path).toBe('/ws/mmm');
      expect(entries[2]!.path).toBe('/ws/zzz');
    });
  });

  // -------------------------------------------------------------------------
  // updateSubMasterStatus
  // -------------------------------------------------------------------------

  describe('updateSubMasterStatus()', () => {
    it('changes status to "stale"', () => {
      registerSubMaster(db, makeEntry({ id: 'sm-F', status: 'active' }));
      updateSubMasterStatus(db, 'sm-F', 'stale');
      expect(getSubMaster(db, 'sm-F')!.status).toBe('stale');
    });

    it('changes status to "disabled"', () => {
      registerSubMaster(db, makeEntry({ id: 'sm-G', status: 'active' }));
      updateSubMasterStatus(db, 'sm-G', 'disabled');
      expect(getSubMaster(db, 'sm-G')!.status).toBe('disabled');
    });

    it('is a no-op when id does not exist', () => {
      expect(() => updateSubMasterStatus(db, 'nonexistent', 'stale')).not.toThrow();
    });

    it.each(['active', 'stale', 'disabled'] as const)('stores status "%s"', (status) => {
      const id = `sm-status-${status}`;
      registerSubMaster(db, makeEntry({ id, status: 'active' }));
      updateSubMasterStatus(db, id, status);
      expect(getSubMaster(db, id)!.status).toBe(status);
    });
  });

  // -------------------------------------------------------------------------
  // removeSubMaster
  // -------------------------------------------------------------------------

  describe('removeSubMaster()', () => {
    it('removes the entry by id', () => {
      registerSubMaster(db, makeEntry({ id: 'sm-H' }));
      removeSubMaster(db, 'sm-H');
      expect(getSubMaster(db, 'sm-H')).toBeNull();
    });

    it('is a no-op when id does not exist', () => {
      expect(() => removeSubMaster(db, 'nonexistent')).not.toThrow();
    });

    it('only removes the targeted entry', () => {
      registerSubMaster(db, makeEntry({ id: 'sm-I', name: 'keep' }));
      registerSubMaster(db, makeEntry({ id: 'sm-J', name: 'delete-me' }));
      removeSubMaster(db, 'sm-J');
      expect(getSubMaster(db, 'sm-I')).not.toBeNull();
      expect(getSubMaster(db, 'sm-J')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // CRUD lifecycle
  // -------------------------------------------------------------------------

  describe('full lifecycle', () => {
    it('register → list → update status → remove', () => {
      registerSubMaster(db, makeEntry({ id: 'lc-1', path: '/ws/lc', name: 'lc' }));
      expect(listSubMasters(db)).toHaveLength(1);

      updateSubMasterStatus(db, 'lc-1', 'stale');
      expect(getSubMaster(db, 'lc-1')!.status).toBe('stale');

      removeSubMaster(db, 'lc-1');
      expect(listSubMasters(db)).toHaveLength(0);
    });
  });
});
