import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  insertObservation,
  getBySession,
  getByWorker,
  searchObservations,
  getRecentByType,
  type Observation,
} from '../../src/memory/observation-store.js';

describe('observation-store.ts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  const makeObs = (overrides: Partial<Observation> = {}): Observation => ({
    session_id: 'session-abc',
    worker_id: 'worker-001',
    type: 'investigation',
    title: 'Explored authentication module',
    narrative: 'Reviewed the auth middleware and found JWT verification logic.',
    facts: ['JWT used', 'tokens expire in 1h'],
    concepts: ['authentication', 'JWT'],
    files_read: ['src/core/auth.ts'],
    files_modified: [],
    ...overrides,
  });

  // ---------------------------------------------------------------------------
  // insertObservation
  // ---------------------------------------------------------------------------

  describe('insertObservation', () => {
    it('returns a positive integer row id', () => {
      const id = insertObservation(db, makeObs());
      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('stores all scalar fields correctly', () => {
      insertObservation(db, makeObs());
      const row = db.prepare('SELECT * FROM observations').get() as {
        session_id: string;
        worker_id: string;
        type: string;
        title: string;
        narrative: string;
      };
      expect(row.session_id).toBe('session-abc');
      expect(row.worker_id).toBe('worker-001');
      expect(row.type).toBe('investigation');
      expect(row.title).toBe('Explored authentication module');
      expect(row.narrative).toBe('Reviewed the auth middleware and found JWT verification logic.');
    });

    it('serializes JSON array columns (facts, concepts, files_read, files_modified)', () => {
      insertObservation(
        db,
        makeObs({
          facts: ['fact A', 'fact B'],
          concepts: ['concurrency', 'locking'],
          files_read: ['src/core/queue.ts', 'src/types/message.ts'],
          files_modified: ['src/core/bridge.ts'],
        }),
      );
      const row = db
        .prepare('SELECT facts, concepts, files_read, files_modified FROM observations')
        .get() as {
        facts: string;
        concepts: string;
        files_read: string;
        files_modified: string;
      };
      expect(JSON.parse(row.facts)).toEqual(['fact A', 'fact B']);
      expect(JSON.parse(row.concepts)).toEqual(['concurrency', 'locking']);
      expect(JSON.parse(row.files_read)).toEqual(['src/core/queue.ts', 'src/types/message.ts']);
      expect(JSON.parse(row.files_modified)).toEqual(['src/core/bridge.ts']);
    });

    it('defaults optional arrays to empty JSON arrays when omitted', () => {
      insertObservation(
        db,
        makeObs({
          facts: undefined,
          concepts: undefined,
          files_read: undefined,
          files_modified: undefined,
        }),
      );
      const row = db
        .prepare('SELECT facts, concepts, files_read, files_modified FROM observations')
        .get() as {
        facts: string;
        concepts: string;
        files_read: string;
        files_modified: string;
      };
      expect(JSON.parse(row.facts)).toEqual([]);
      expect(JSON.parse(row.concepts)).toEqual([]);
      expect(JSON.parse(row.files_read)).toEqual([]);
      expect(JSON.parse(row.files_modified)).toEqual([]);
    });

    it('inserts created_at when not provided', () => {
      insertObservation(db, makeObs());
      const row = db.prepare('SELECT created_at FROM observations').get() as { created_at: string };
      expect(row.created_at).toBeTruthy();
      expect(new Date(row.created_at).getTime()).not.toBeNaN();
    });

    it('uses provided created_at when supplied', () => {
      const ts = '2025-01-15T10:00:00.000Z';
      insertObservation(db, makeObs({ created_at: ts }));
      const row = db.prepare('SELECT created_at FROM observations').get() as { created_at: string };
      expect(row.created_at).toBe(ts);
    });

    it('increments ids for successive inserts', () => {
      const id1 = insertObservation(db, makeObs({ title: 'First observation' }));
      const id2 = insertObservation(db, makeObs({ title: 'Second observation' }));
      expect(id2).toBeGreaterThan(id1);
    });

    it('syncs the FTS5 index after insert', () => {
      insertObservation(db, makeObs({ title: 'unique-fts-word-in-title' }));
      const ftsRow = db
        .prepare(
          'SELECT rowid FROM observations_fts WHERE observations_fts MATCH \'"unique-fts-word-in-title"\'',
        )
        .get() as { rowid: number } | undefined;
      expect(ftsRow).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // getBySession
  // ---------------------------------------------------------------------------

  describe('getBySession', () => {
    beforeEach(() => {
      insertObservation(
        db,
        makeObs({ session_id: 'sess-A', title: 'Alpha obs', worker_id: 'w-1' }),
      );
      insertObservation(db, makeObs({ session_id: 'sess-A', title: 'Beta obs', worker_id: 'w-2' }));
      insertObservation(
        db,
        makeObs({ session_id: 'sess-B', title: 'Gamma obs', worker_id: 'w-3' }),
      );
    });

    it('returns only observations for the given session', () => {
      const results = getBySession(db, 'sess-A');
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.session_id === 'sess-A')).toBe(true);
    });

    it('returns an empty array for an unknown session', () => {
      const results = getBySession(db, 'sess-unknown');
      expect(results).toHaveLength(0);
    });

    it('does not include observations from other sessions', () => {
      const results = getBySession(db, 'sess-B');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Gamma obs');
    });

    it('deserializes JSON array columns back to arrays', () => {
      const results = getBySession(db, 'sess-A');
      for (const obs of results) {
        expect(Array.isArray(obs.facts)).toBe(true);
        expect(Array.isArray(obs.concepts)).toBe(true);
        expect(Array.isArray(obs.files_read)).toBe(true);
        expect(Array.isArray(obs.files_modified)).toBe(true);
      }
    });

    it('orders results newest first', () => {
      // Insert with explicit timestamps to control order
      const olderDb = openDatabase(':memory:');
      insertObservation(
        olderDb,
        makeObs({ session_id: 'sess-X', title: 'Older', created_at: '2025-01-01T00:00:00.000Z' }),
      );
      insertObservation(
        olderDb,
        makeObs({ session_id: 'sess-X', title: 'Newer', created_at: '2025-06-01T00:00:00.000Z' }),
      );
      const results = getBySession(olderDb, 'sess-X');
      expect(results[0].title).toBe('Newer');
      expect(results[1].title).toBe('Older');
      closeDatabase(olderDb);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        insertObservation(db, makeObs({ session_id: 'sess-big', title: `obs ${i}` }));
      }
      const results = getBySession(db, 'sess-big', 3);
      expect(results).toHaveLength(3);
    });
  });

  // ---------------------------------------------------------------------------
  // getByWorker
  // ---------------------------------------------------------------------------

  describe('getByWorker', () => {
    beforeEach(() => {
      insertObservation(
        db,
        makeObs({ worker_id: 'worker-X', title: 'X first', session_id: 'sess-1' }),
      );
      insertObservation(
        db,
        makeObs({ worker_id: 'worker-X', title: 'X second', session_id: 'sess-2' }),
      );
      insertObservation(
        db,
        makeObs({ worker_id: 'worker-Y', title: 'Y only', session_id: 'sess-3' }),
      );
    });

    it('returns only observations for the given worker', () => {
      const results = getByWorker(db, 'worker-X');
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.worker_id === 'worker-X')).toBe(true);
    });

    it('returns an empty array for an unknown worker', () => {
      const results = getByWorker(db, 'worker-unknown');
      expect(results).toHaveLength(0);
    });

    it('does not include observations from other workers', () => {
      const results = getByWorker(db, 'worker-Y');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Y only');
    });

    it('deserializes JSON array columns back to arrays', () => {
      const results = getByWorker(db, 'worker-X');
      for (const obs of results) {
        expect(Array.isArray(obs.facts)).toBe(true);
        expect(Array.isArray(obs.files_read)).toBe(true);
      }
    });

    it('orders results newest first', () => {
      const localDb = openDatabase(':memory:');
      insertObservation(
        localDb,
        makeObs({ worker_id: 'w-ord', title: 'Earlier', created_at: '2025-02-01T00:00:00.000Z' }),
      );
      insertObservation(
        localDb,
        makeObs({ worker_id: 'w-ord', title: 'Later', created_at: '2025-09-01T00:00:00.000Z' }),
      );
      const results = getByWorker(localDb, 'w-ord');
      expect(results[0].title).toBe('Later');
      closeDatabase(localDb);
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 6; i++) {
        insertObservation(db, makeObs({ worker_id: 'worker-many', title: `obs ${i}` }));
      }
      const results = getByWorker(db, 'worker-many', 4);
      expect(results).toHaveLength(4);
    });
  });

  // ---------------------------------------------------------------------------
  // searchObservations (FTS5)
  // ---------------------------------------------------------------------------

  describe('searchObservations', () => {
    beforeEach(() => {
      insertObservation(
        db,
        makeObs({
          title: 'Authentication middleware review',
          narrative: 'Found JWT token expiry logic.',
        }),
      );
      insertObservation(
        db,
        makeObs({
          title: 'Database migration fix',
          narrative: 'Applied ALTER TABLE for new columns.',
        }),
      );
      insertObservation(
        db,
        makeObs({
          title: 'Router refactor complete',
          narrative: 'Simplified message routing logic.',
        }),
      );
    });

    it('returns observations matching a title keyword', () => {
      const results = searchObservations(db, 'Authentication');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].title).toContain('Authentication');
    });

    it('returns observations matching a narrative keyword', () => {
      const results = searchObservations(db, 'migration');
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty array for empty query string', () => {
      const results = searchObservations(db, '');
      expect(results).toHaveLength(0);
    });

    it('returns empty array for whitespace-only query', () => {
      const results = searchObservations(db, '   ');
      expect(results).toHaveLength(0);
    });

    it('handles special FTS5 characters without throwing', () => {
      expect(() => searchObservations(db, 'auth*:')).not.toThrow();
      expect(() => searchObservations(db, '"quoted)')).not.toThrow();
      expect(() => searchObservations(db, '@#$%')).not.toThrow();
    });

    it('returns empty array for query with only special characters', () => {
      const results = searchObservations(db, '@#$%');
      expect(results).toHaveLength(0);
    });

    it('respects the limit parameter', () => {
      // Add more records matching a common word
      for (let i = 0; i < 5; i++) {
        insertObservation(
          db,
          makeObs({ title: `logic review ${i}`, narrative: 'logic everywhere' }),
        );
      }
      const results = searchObservations(db, 'logic', 2);
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('deserializes JSON array columns in search results', () => {
      const results = searchObservations(db, 'JWT');
      expect(results.length).toBeGreaterThan(0);
      for (const obs of results) {
        expect(Array.isArray(obs.facts)).toBe(true);
        expect(Array.isArray(obs.concepts)).toBe(true);
        expect(Array.isArray(obs.files_read)).toBe(true);
        expect(Array.isArray(obs.files_modified)).toBe(true);
      }
    });

    it('returns empty array when no observations match', () => {
      const results = searchObservations(db, 'xyznonexistentterm');
      expect(results).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getRecentByType
  // ---------------------------------------------------------------------------

  describe('getRecentByType', () => {
    beforeEach(() => {
      insertObservation(
        db,
        makeObs({
          type: 'bugfix',
          title: 'Fix null pointer',
          created_at: '2025-03-01T00:00:00.000Z',
        }),
      );
      insertObservation(
        db,
        makeObs({
          type: 'bugfix',
          title: 'Fix race condition',
          created_at: '2025-04-01T00:00:00.000Z',
        }),
      );
      insertObservation(
        db,
        makeObs({
          type: 'architecture',
          title: 'Design new queue',
          created_at: '2025-05-01T00:00:00.000Z',
        }),
      );
    });

    it('returns only observations of the given type', () => {
      const results = getRecentByType(db, 'bugfix');
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.type === 'bugfix')).toBe(true);
    });

    it('returns an empty array for a type with no observations', () => {
      const results = getRecentByType(db, 'security');
      expect(results).toHaveLength(0);
    });

    it('does not mix observations from other types', () => {
      const results = getRecentByType(db, 'architecture');
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Design new queue');
    });

    it('orders results newest first', () => {
      const results = getRecentByType(db, 'bugfix');
      expect(results[0].title).toBe('Fix race condition'); // April > March
      expect(results[1].title).toBe('Fix null pointer');
    });

    it('respects the limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        insertObservation(db, makeObs({ type: 'refactor', title: `refactor step ${i}` }));
      }
      const results = getRecentByType(db, 'refactor', 3);
      expect(results).toHaveLength(3);
    });

    it('deserializes JSON array columns', () => {
      const results = getRecentByType(db, 'bugfix');
      for (const obs of results) {
        expect(Array.isArray(obs.facts)).toBe(true);
        expect(Array.isArray(obs.files_read)).toBe(true);
      }
    });
  });
});
