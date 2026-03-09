/**
 * OB-1317 — JSON parse safety for observation-store.ts
 *
 * Verifies that `rowToObservation()` returns empty arrays instead of throwing
 * when the database contains malformed JSON in the `facts`, `concepts`,
 * `files_read`, or `files_modified` columns.
 *
 * `rowToObservation` is not exported, so we exercise it through the public
 * read APIs (`getBySession`, `getByWorker`, `searchObservations`,
 * `getRecentByType`) after manually corrupting column values via raw SQL.
 */

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

describe('json-parse-safety — observation-store rowToObservation()', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  const baseObs = (): Observation => ({
    session_id: 'sess-safety',
    worker_id: 'worker-safety',
    type: 'investigation',
    title: 'Safety test observation',
    narrative: 'Testing malformed JSON resilience.',
    facts: ['valid fact'],
    concepts: ['valid concept'],
    files_read: ['src/index.ts'],
    files_modified: [],
  });

  /** Corrupt one or more JSON columns of the most-recently inserted row. */
  const corruptColumns = (
    overrides: Partial<Record<'facts' | 'concepts' | 'files_read' | 'files_modified', string>>,
  ) => {
    const sets = Object.entries(overrides)
      .map(([col]) => `${col} = @${col}`)
      .join(', ');
    const params = Object.fromEntries(Object.entries(overrides).map(([col, val]) => [col, val]));
    db.prepare(`UPDATE observations SET ${sets} WHERE id = (SELECT MAX(id) FROM observations)`).run(
      params,
    );
  };

  // ---------------------------------------------------------------------------
  // facts column
  // ---------------------------------------------------------------------------

  describe('malformed facts column', () => {
    it('returns [] for facts without throwing (via getBySession)', () => {
      insertObservation(db, baseObs());
      corruptColumns({ facts: '{not valid json' });

      const results = getBySession(db, 'sess-safety');
      expect(results).toHaveLength(1);
      expect(results[0].facts).toEqual([]);
    });

    it('returns [] for facts without throwing (via getByWorker)', () => {
      insertObservation(db, baseObs());
      corruptColumns({ facts: 'NOT_JSON' });

      const results = getByWorker(db, 'worker-safety');
      expect(results).toHaveLength(1);
      expect(results[0].facts).toEqual([]);
    });

    it('returns [] for facts without throwing (via getRecentByType)', () => {
      insertObservation(db, baseObs());
      corruptColumns({ facts: '[[broken' });

      const results = getRecentByType(db, 'investigation');
      expect(results).toHaveLength(1);
      expect(results[0].facts).toEqual([]);
    });

    it('returns [] for facts without throwing (via searchObservations)', () => {
      insertObservation(db, baseObs());
      corruptColumns({ facts: 'undefined' });

      const results = searchObservations(db, 'Safety');
      expect(results).toHaveLength(1);
      expect(results[0].facts).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // concepts column
  // ---------------------------------------------------------------------------

  describe('malformed concepts column', () => {
    it('returns [] for concepts without throwing', () => {
      insertObservation(db, baseObs());
      corruptColumns({ concepts: '{bad json}' });

      const results = getBySession(db, 'sess-safety');
      expect(results).toHaveLength(1);
      expect(results[0].concepts).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // files_read column
  // ---------------------------------------------------------------------------

  describe('malformed files_read column', () => {
    it('returns [] for files_read without throwing', () => {
      insertObservation(db, baseObs());
      corruptColumns({ files_read: 'not-an-array' });

      const results = getBySession(db, 'sess-safety');
      expect(results).toHaveLength(1);
      expect(results[0].files_read).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // files_modified column
  // ---------------------------------------------------------------------------

  describe('malformed files_modified column', () => {
    it('returns [] for files_modified without throwing', () => {
      insertObservation(db, baseObs());
      corruptColumns({ files_modified: '][' });

      const results = getBySession(db, 'sess-safety');
      expect(results).toHaveLength(1);
      expect(results[0].files_modified).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // all columns corrupted simultaneously
  // ---------------------------------------------------------------------------

  describe('all JSON columns malformed', () => {
    it('returns empty arrays for all fields without throwing', () => {
      insertObservation(db, baseObs());
      corruptColumns({
        facts: '{bad',
        concepts: 'null-ish',
        files_read: '>>>',
        files_modified: '<<<',
      });

      const results = getBySession(db, 'sess-safety');
      expect(results).toHaveLength(1);
      const obs = results[0];
      expect(obs.facts).toEqual([]);
      expect(obs.concepts).toEqual([]);
      expect(obs.files_read).toEqual([]);
      expect(obs.files_modified).toEqual([]);
      // Scalar fields should still be intact
      expect(obs.title).toBe('Safety test observation');
      expect(obs.narrative).toBe('Testing malformed JSON resilience.');
    });
  });

  // ---------------------------------------------------------------------------
  // Healthy rows are unaffected
  // ---------------------------------------------------------------------------

  describe('healthy rows alongside malformed rows', () => {
    it('parses valid rows correctly even when another row has malformed JSON', () => {
      insertObservation(db, baseObs());
      insertObservation(db, baseObs() /* good row – inserted second, gets higher id */);

      // Corrupt only the first (lower-id) row
      db.prepare(
        `UPDATE observations SET facts = '{bad' WHERE id = (SELECT MIN(id) FROM observations)`,
      ).run();

      const results = getBySession(db, 'sess-safety');
      expect(results).toHaveLength(2);

      // One row has corrupted facts → []
      const corrupted = results.find((r) => r.facts?.length === 0);
      expect(corrupted).toBeDefined();

      // The other row retains its valid facts
      const healthy = results.find((r) => (r.facts?.length ?? 0) > 0);
      expect(healthy).toBeDefined();
      expect(healthy!.facts).toContain('valid fact');
    });
  });
});
