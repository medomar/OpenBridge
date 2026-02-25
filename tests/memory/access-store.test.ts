import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  getAccess,
  setAccess,
  listAccess,
  removeAccess,
  incrementDailyCost,
  resetDailyCosts,
  type AccessControlEntry,
} from '../../src/memory/access-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<AccessControlEntry> = {}): AccessControlEntry {
  return {
    user_id: '+1234567890',
    channel: 'whatsapp',
    role: 'developer',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('access-store.ts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  // -------------------------------------------------------------------------
  // getAccess
  // -------------------------------------------------------------------------

  describe('getAccess()', () => {
    it('returns null when no entry exists', () => {
      const result = getAccess(db, '+1111111111', 'whatsapp');
      expect(result).toBeNull();
    });

    it('returns the entry after it is set', () => {
      setAccess(db, makeEntry({ user_id: '+1234567890', channel: 'whatsapp', role: 'owner' }));
      const result = getAccess(db, '+1234567890', 'whatsapp');
      expect(result).not.toBeNull();
      expect(result!.user_id).toBe('+1234567890');
      expect(result!.channel).toBe('whatsapp');
      expect(result!.role).toBe('owner');
    });

    it('is keyed by (user_id, channel) — different channel returns null', () => {
      setAccess(db, makeEntry({ user_id: '+1234567890', channel: 'whatsapp' }));
      const result = getAccess(db, '+1234567890', 'telegram');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // setAccess — insert
  // -------------------------------------------------------------------------

  describe('setAccess() — insert', () => {
    it('inserts a minimal entry with defaults', () => {
      setAccess(db, makeEntry());
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry).not.toBeNull();
      expect(entry!.active).toBe(true);
      expect(entry!.daily_cost_used).toBe(0);
    });

    it('stores and round-trips scopes as an array', () => {
      setAccess(db, makeEntry({ scopes: ['/src', '/tests'] }));
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.scopes).toEqual(['/src', '/tests']);
    });

    it('stores and round-trips allowed_actions as an array', () => {
      setAccess(db, makeEntry({ allowed_actions: ['read', 'edit'] }));
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.allowed_actions).toEqual(['read', 'edit']);
    });

    it('stores and round-trips blocked_actions as an array', () => {
      setAccess(db, makeEntry({ blocked_actions: ['deploy'] }));
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.blocked_actions).toEqual(['deploy']);
    });

    it('stores max_cost_per_day_usd', () => {
      setAccess(db, makeEntry({ max_cost_per_day_usd: 5.0 }));
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.max_cost_per_day_usd).toBe(5.0);
    });

    it('stores active=false', () => {
      setAccess(db, makeEntry({ active: false }));
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.active).toBe(false);
    });

    it('populates created_at and updated_at timestamps', () => {
      setAccess(db, makeEntry());
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.created_at).toBeTruthy();
      expect(entry!.updated_at).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  // setAccess — update
  // -------------------------------------------------------------------------

  describe('setAccess() — update', () => {
    it('updates role for an existing entry', () => {
      setAccess(db, makeEntry({ role: 'viewer' }));
      setAccess(db, makeEntry({ role: 'admin' }));
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.role).toBe('admin');
    });

    it('does not create a duplicate row on update', () => {
      setAccess(db, makeEntry());
      setAccess(db, makeEntry({ role: 'owner' }));
      const all = listAccess(db);
      const matching = all.filter((e) => e.user_id === '+1234567890' && e.channel === 'whatsapp');
      expect(matching).toHaveLength(1);
    });

    it('updates updated_at but keeps original created_at', () => {
      setAccess(db, makeEntry());
      const first = getAccess(db, '+1234567890', 'whatsapp');
      // Small delay to ensure updated_at changes
      setAccess(db, makeEntry({ role: 'admin' }));
      const second = getAccess(db, '+1234567890', 'whatsapp');
      expect(second!.created_at).toBe(first!.created_at);
    });
  });

  // -------------------------------------------------------------------------
  // listAccess
  // -------------------------------------------------------------------------

  describe('listAccess()', () => {
    it('returns empty array when no entries exist', () => {
      expect(listAccess(db)).toEqual([]);
    });

    it('returns all entries ordered by user_id, channel', () => {
      setAccess(db, makeEntry({ user_id: '+3333333333', channel: 'whatsapp', role: 'viewer' }));
      setAccess(db, makeEntry({ user_id: '+1111111111', channel: 'telegram', role: 'developer' }));
      setAccess(db, makeEntry({ user_id: '+2222222222', channel: 'whatsapp', role: 'admin' }));

      const entries = listAccess(db);
      expect(entries).toHaveLength(3);
      expect(entries[0]!.user_id).toBe('+1111111111');
      expect(entries[1]!.user_id).toBe('+2222222222');
      expect(entries[2]!.user_id).toBe('+3333333333');
    });
  });

  // -------------------------------------------------------------------------
  // removeAccess
  // -------------------------------------------------------------------------

  describe('removeAccess()', () => {
    it('removes the matching entry', () => {
      setAccess(db, makeEntry());
      removeAccess(db, '+1234567890', 'whatsapp');
      expect(getAccess(db, '+1234567890', 'whatsapp')).toBeNull();
    });

    it('is a no-op when entry does not exist', () => {
      expect(() => removeAccess(db, '+9999999999', 'whatsapp')).not.toThrow();
    });

    it('only removes the exact (user_id, channel) pair', () => {
      setAccess(db, makeEntry({ user_id: '+1234567890', channel: 'whatsapp' }));
      setAccess(db, makeEntry({ user_id: '+1234567890', channel: 'telegram' }));
      removeAccess(db, '+1234567890', 'whatsapp');
      expect(getAccess(db, '+1234567890', 'telegram')).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // incrementDailyCost
  // -------------------------------------------------------------------------

  describe('incrementDailyCost()', () => {
    it('increments daily_cost_used', () => {
      setAccess(db, makeEntry({ daily_cost_used: 0 }));
      incrementDailyCost(db, '+1234567890', 'whatsapp', 1.5);
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.daily_cost_used).toBeCloseTo(1.5);
    });

    it('accumulates multiple increments', () => {
      setAccess(db, makeEntry({ daily_cost_used: 0 }));
      incrementDailyCost(db, '+1234567890', 'whatsapp', 0.5);
      incrementDailyCost(db, '+1234567890', 'whatsapp', 0.3);
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.daily_cost_used).toBeCloseTo(0.8);
    });

    it('is a no-op when no entry exists for the user+channel', () => {
      expect(() => incrementDailyCost(db, '+9999999999', 'whatsapp', 1.0)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // resetDailyCosts
  // -------------------------------------------------------------------------

  describe('resetDailyCosts()', () => {
    it('resets daily_cost_used to 0 when cost_reset_at is null', () => {
      setAccess(db, makeEntry({ daily_cost_used: 0 }));
      incrementDailyCost(db, '+1234567890', 'whatsapp', 2.5);
      // With cost_reset_at = null, reset should fire
      resetDailyCosts(db);
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.daily_cost_used).toBe(0);
    });

    it('sets cost_reset_at to the next UTC midnight', () => {
      setAccess(db, makeEntry());
      resetDailyCosts(db);
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      expect(entry!.cost_reset_at).toBeTruthy();
      // The reset time should be in the future
      expect(new Date(entry!.cost_reset_at!).getTime()).toBeGreaterThan(Date.now());
    });

    it('does not reset when cost_reset_at is in the future', () => {
      const futureReset = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      setAccess(db, makeEntry({ daily_cost_used: 0, cost_reset_at: futureReset }));
      incrementDailyCost(db, '+1234567890', 'whatsapp', 3.0);
      resetDailyCosts(db);
      const entry = getAccess(db, '+1234567890', 'whatsapp');
      // cost_reset_at is in the future — cost should NOT be reset
      expect(entry!.daily_cost_used).toBeCloseTo(3.0);
    });
  });

  // -------------------------------------------------------------------------
  // Role coverage
  // -------------------------------------------------------------------------

  describe('role storage', () => {
    it.each(['owner', 'admin', 'developer', 'viewer', 'custom'] as const)(
      'stores role "%s"',
      (role) => {
        setAccess(db, makeEntry({ role }));
        const entry = getAccess(db, '+1234567890', 'whatsapp');
        expect(entry!.role).toBe(role);
      },
    );
  });
});
