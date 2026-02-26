/**
 * Tests for access control enforcement in AuthService.
 *
 * Covers: role-based permission checks, daily cost limits, scope enforcement,
 * and the interaction between AuthService and the access_control DB table.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import { setAccess } from '../../src/memory/access-store.js';
import { AuthService } from '../../src/core/auth.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAuth(overrides: Partial<{ whitelist: string[]; prefix: string }> = {}): AuthService {
  return new AuthService({
    whitelist: overrides.whitelist ?? ['+1234567890'],
    prefix: overrides.prefix ?? '/ai',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService — access control', () => {
  let db: Database.Database;
  let auth: AuthService;

  beforeEach(() => {
    db = openDatabase(':memory:');
    auth = makeAuth();
    auth.setDatabase(db);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  // -------------------------------------------------------------------------
  // No DB attached — backward-compatible default
  // -------------------------------------------------------------------------

  describe('without DB attached', () => {
    it('allows access when no DB is set', () => {
      const authNoDb = makeAuth();
      // No setDatabase() called
      const result = authNoDb.checkAccessControl('+1234567890', 'whatsapp', 'fix the bug');
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // No entry in DB — defaults to owner (backward-compatible)
  // -------------------------------------------------------------------------

  describe('no access_control entry', () => {
    it('allows access when no entry exists (defaults to owner)', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy the app');
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Active check
  // -------------------------------------------------------------------------

  describe('active check', () => {
    it('denies access when entry is inactive', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        active: false,
      });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/revoked/i);
    });

    it('allows access when entry is active', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        active: true,
      });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'read the file');
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Daily cost enforcement
  // -------------------------------------------------------------------------

  describe('daily cost enforcement', () => {
    // Use a future cost_reset_at to prevent automatic reset during the test.
    const futureReset = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    it('denies when daily_cost_used >= max_cost_per_day_usd', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        max_cost_per_day_usd: 5.0,
        daily_cost_used: 5.0,
        cost_reset_at: futureReset,
      });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'run tests');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/limit/i);
    });

    it('denies when daily_cost_used exceeds max_cost_per_day_usd', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        max_cost_per_day_usd: 2.0,
        daily_cost_used: 3.5,
        cost_reset_at: futureReset,
      });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp');
      expect(result.allowed).toBe(false);
    });

    it('allows when daily_cost_used is below max_cost_per_day_usd', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        max_cost_per_day_usd: 10.0,
        daily_cost_used: 1.5,
      });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'read the file');
      expect(result.allowed).toBe(true);
    });

    it('does not enforce cost limit when max_cost_per_day_usd is null', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        max_cost_per_day_usd: null,
        daily_cost_used: 9999,
      });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'read the file');
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Role-based action checks
  // -------------------------------------------------------------------------

  describe('viewer role', () => {
    beforeEach(() => {
      setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'viewer' });
    });

    it('allows read-classified messages', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'what files are here?');
      expect(result.allowed).toBe(true);
    });

    it('denies edit-classified messages', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'edit the config file');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/not permitted/i);
    });

    it('denies deploy-classified messages', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy the app now');
      expect(result.allowed).toBe(false);
    });

    it('denies test-classified messages', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'run the tests');
      expect(result.allowed).toBe(false);
    });
  });

  describe('developer role', () => {
    beforeEach(() => {
      setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'developer' });
    });

    it('allows read actions', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'show me the code');
      expect(result.allowed).toBe(true);
    });

    it('allows edit actions', () => {
      const result = auth.checkAccessControl(
        '+1234567890',
        'whatsapp',
        'fix the authentication bug',
      );
      expect(result.allowed).toBe(true);
    });

    it('allows test actions', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'run the test suite');
      expect(result.allowed).toBe(true);
    });

    it('denies deploy actions', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy to production');
      expect(result.allowed).toBe(false);
    });
  });

  describe('admin role', () => {
    beforeEach(() => {
      setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'admin' });
    });

    it('allows all actions including deploy', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy to production');
      expect(result.allowed).toBe(true);
    });

    it('allows stop action', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'stop');
      expect(result.allowed).toBe(true);
    });
  });

  describe('owner role', () => {
    beforeEach(() => {
      setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'owner' });
    });

    it('allows all actions', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy the app');
      expect(result.allowed).toBe(true);
    });

    it('allows stop action', () => {
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'stop');
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Stop action — owner/admin only
  // -------------------------------------------------------------------------

  describe('stop action access control', () => {
    it('denies stop for viewer role', () => {
      setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'viewer' });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'stop');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/not permitted/i);
    });

    it('denies stop for developer role', () => {
      setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'developer' });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'stop');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/not permitted/i);
    });

    it('allows stop for admin role', () => {
      setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'admin' });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'stop');
      expect(result.allowed).toBe(true);
    });

    it('allows stop for owner role', () => {
      setAccess(db, { user_id: '+1234567890', channel: 'whatsapp', role: 'owner' });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'stop');
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // blocked_actions
  // -------------------------------------------------------------------------

  describe('blocked_actions', () => {
    it('denies action in blocked list regardless of role', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'owner',
        blocked_actions: ['deploy'],
      });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'deploy to production');
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/not permitted/i);
    });

    it('allows action not in blocked list', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'owner',
        blocked_actions: ['deploy'],
      });
      const result = auth.checkAccessControl('+1234567890', 'whatsapp', 'read the code');
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scope enforcement
  // -------------------------------------------------------------------------

  describe('scope enforcement', () => {
    it('allows access when file path is within an allowed scope', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        scopes: ['/src'],
      });
      const result = auth.checkAccessControl(
        '+1234567890',
        'whatsapp',
        'fix the bug in /src/auth.ts',
      );
      expect(result.allowed).toBe(true);
    });

    it('denies access when file path is outside all allowed scopes', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        scopes: ['/src'],
      });
      const result = auth.checkAccessControl(
        '+1234567890',
        'whatsapp',
        'edit the /config/secrets.env file',
      );
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/scope/i);
    });

    it('allows when no file paths are detected in message (even with scopes)', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        scopes: ['/src'],
      });
      const result = auth.checkAccessControl(
        '+1234567890',
        'whatsapp',
        'what is this project about?',
      );
      expect(result.allowed).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // incrementDailyCost
  // -------------------------------------------------------------------------

  describe('incrementDailyCost()', () => {
    it('increments cost in DB via auth service', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        daily_cost_used: 0,
      });
      auth.incrementDailyCost('+1234567890', 'whatsapp', 2.0);
      // Read directly from DB to verify
      const row = db
        .prepare('SELECT daily_cost_used FROM access_control WHERE user_id = ? AND channel = ?')
        .get('+1234567890', 'whatsapp') as { daily_cost_used: number } | undefined;
      expect(row!.daily_cost_used).toBeCloseTo(2.0);
    });

    it('is a no-op when no entry exists in DB', () => {
      expect(() => auth.incrementDailyCost('+9999999999', 'whatsapp', 1.0)).not.toThrow();
    });

    it('is a no-op when costUsd is 0 or negative', () => {
      setAccess(db, {
        user_id: '+1234567890',
        channel: 'whatsapp',
        role: 'developer',
        daily_cost_used: 0,
      });
      auth.incrementDailyCost('+1234567890', 'whatsapp', 0);
      const row = db
        .prepare('SELECT daily_cost_used FROM access_control WHERE user_id = ? AND channel = ?')
        .get('+1234567890', 'whatsapp') as { daily_cost_used: number } | undefined;
      expect(row!.daily_cost_used).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Whitelist checks (pre-ACL layer)
  // -------------------------------------------------------------------------

  describe('isAuthorized()', () => {
    it('returns true for a whitelisted number', () => {
      expect(auth.isAuthorized('+1234567890')).toBe(true);
    });

    it('returns false for a non-whitelisted number', () => {
      expect(auth.isAuthorized('+9999999999')).toBe(false);
    });

    it('normalizes number formats (@c.us suffix)', () => {
      expect(auth.isAuthorized('1234567890@c.us')).toBe(true);
    });

    it('returns true when whitelist is empty (open access)', () => {
      const openAuth = makeAuth({ whitelist: [] });
      expect(openAuth.isAuthorized('+9999999999')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Prefix and command filter
  // -------------------------------------------------------------------------

  describe('hasPrefix() and stripPrefix()', () => {
    it('detects configured prefix', () => {
      expect(auth.hasPrefix('/ai hello')).toBe(true);
    });

    it('returns false when prefix is absent', () => {
      expect(auth.hasPrefix('hello')).toBe(false);
    });

    it('strips prefix from message', () => {
      expect(auth.stripPrefix('/ai fix the bug')).toBe('fix the bug');
    });
  });
});
