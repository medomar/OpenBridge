import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  getActivePrompt,
  createPromptVersion,
  recordPromptOutcome,
  getUnderperformingPrompts,
} from '../../src/memory/prompt-store.js';

describe('prompt-store.ts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  describe('getActivePrompt', () => {
    it('returns null when no active prompt exists for the name', () => {
      const result = getActivePrompt(db, 'nonexistent-prompt');
      expect(result).toBeNull();
    });

    it('returns the active prompt after creation', () => {
      createPromptVersion(db, 'my-prompt', 'You are a helpful assistant.');
      const result = getActivePrompt(db, 'my-prompt');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my-prompt');
      expect(result!.content).toBe('You are a helpful assistant.');
    });

    it('returns the highest active version', () => {
      createPromptVersion(db, 'versioned-prompt', 'Version 1 content');
      createPromptVersion(db, 'versioned-prompt', 'Version 2 content');
      const result = getActivePrompt(db, 'versioned-prompt');
      expect(result!.version).toBe(2);
      expect(result!.content).toBe('Version 2 content');
    });

    it('returned record has active = true', () => {
      createPromptVersion(db, 'active-check', 'content here');
      const result = getActivePrompt(db, 'active-check');
      expect(result!.active).toBe(true);
    });
  });

  describe('createPromptVersion', () => {
    it('creates version 1 for a brand-new prompt', () => {
      createPromptVersion(db, 'brand-new', 'initial content');
      const result = getActivePrompt(db, 'brand-new');
      expect(result!.version).toBe(1);
    });

    it('increments version on each call', () => {
      createPromptVersion(db, 'multi', 'v1');
      createPromptVersion(db, 'multi', 'v2');
      createPromptVersion(db, 'multi', 'v3');
      const result = getActivePrompt(db, 'multi');
      expect(result!.version).toBe(3);
    });

    it('deactivates previous versions when creating a new one', () => {
      createPromptVersion(db, 'deactivate-test', 'version 1');
      createPromptVersion(db, 'deactivate-test', 'version 2');

      const rows = db
        .prepare('SELECT version, active FROM prompts WHERE name = ? ORDER BY version')
        .all('deactivate-test') as { version: number; active: number }[];

      expect(rows).toHaveLength(2);
      expect(rows[0].active).toBe(0); // v1 deactivated
      expect(rows[1].active).toBe(1); // v2 active
    });

    it('sets initial effectiveness to 0.5', () => {
      createPromptVersion(db, 'eff-test', 'content');
      const result = getActivePrompt(db, 'eff-test');
      expect(result!.effectiveness).toBe(0.5);
    });
  });

  describe('recordPromptOutcome', () => {
    beforeEach(() => {
      createPromptVersion(db, 'outcome-prompt', 'test content');
    });

    it('increments usage_count on every call', () => {
      recordPromptOutcome(db, 'outcome-prompt', true);
      recordPromptOutcome(db, 'outcome-prompt', false);
      const result = getActivePrompt(db, 'outcome-prompt');
      expect(result!.usage_count).toBe(2);
    });

    it('increments success_count only on success', () => {
      recordPromptOutcome(db, 'outcome-prompt', true);
      recordPromptOutcome(db, 'outcome-prompt', true);
      recordPromptOutcome(db, 'outcome-prompt', false);
      const result = getActivePrompt(db, 'outcome-prompt');
      expect(result!.success_count).toBe(2);
    });

    it('recalculates effectiveness after outcomes', () => {
      recordPromptOutcome(db, 'outcome-prompt', true);
      recordPromptOutcome(db, 'outcome-prompt', true);
      recordPromptOutcome(db, 'outcome-prompt', false);
      const result = getActivePrompt(db, 'outcome-prompt');
      // effectiveness = success_count / usage_count = 2/3
      expect(result!.effectiveness).toBeCloseTo(2 / 3, 2);
    });

    it('is a no-op (no error) when prompt does not exist', () => {
      // Should not throw
      expect(() => recordPromptOutcome(db, 'nonexistent-prompt', true)).not.toThrow();
    });
  });

  describe('getUnderperformingPrompts', () => {
    it('returns prompts below the threshold', () => {
      createPromptVersion(db, 'bad-prompt', 'bad content');
      // Force low effectiveness via direct DB manipulation
      db.prepare('UPDATE prompts SET effectiveness = 0.3 WHERE name = ?').run('bad-prompt');

      const results = getUnderperformingPrompts(db, 0.7);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBe('bad-prompt');
    });

    it('does not return prompts above the threshold', () => {
      createPromptVersion(db, 'good-prompt', 'good content');
      db.prepare('UPDATE prompts SET effectiveness = 0.9 WHERE name = ?').run('good-prompt');

      const results = getUnderperformingPrompts(db, 0.7);
      expect(results.every((r) => r.name !== 'good-prompt')).toBe(true);
    });

    it('uses default threshold of 0.7', () => {
      createPromptVersion(db, 'borderline', 'content');
      db.prepare('UPDATE prompts SET effectiveness = 0.65 WHERE name = ?').run('borderline');

      const results = getUnderperformingPrompts(db); // default 0.7
      expect(results.some((r) => r.name === 'borderline')).toBe(true);
    });

    it('returns only active prompts', () => {
      createPromptVersion(db, 'inactive', 'v1 content');
      createPromptVersion(db, 'inactive', 'v2 content'); // deactivates v1
      // Force v2 effectiveness above threshold
      db.prepare('UPDATE prompts SET effectiveness = 0.9 WHERE name = ? AND active = 1').run(
        'inactive',
      );

      const results = getUnderperformingPrompts(db, 0.7);
      expect(results.every((r) => r.active === true)).toBe(true);
    });
  });
});
