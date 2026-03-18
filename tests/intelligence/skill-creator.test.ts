import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  createSkillFromTask,
  storeSkill,
  getSkillById,
  recordSkillExecution,
  getTopSkills,
  type TaskStep,
} from '../../src/intelligence/skill-creator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE business_skills (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      name                  TEXT    NOT NULL,
      description           TEXT    NOT NULL,
      steps                 TEXT    NOT NULL DEFAULT '[]',
      required_integrations TEXT    NOT NULL DEFAULT '[]',
      required_doc_types    TEXT    NOT NULL DEFAULT '[]',
      created_at            TEXT    NOT NULL,
      version               INTEGER NOT NULL DEFAULT 1,
      usage_count           INTEGER NOT NULL DEFAULT 0,
      success_rate          REAL    NOT NULL DEFAULT 0,
      avg_duration_ms       REAL,
      last_used             TEXT
    );
  `);
  return db;
}

const STEPS: TaskStep[] = [
  {
    index: 0,
    action: 'query orders table',
    integration: 'sqlite',
    docType: 'order',
    success: true,
    durationMs: 100,
  },
  {
    index: 1,
    action: 'compute totals',
    integration: 'sqlite',
    docType: 'order',
    success: true,
    durationMs: 50,
  },
  {
    index: 2,
    action: 'send summary via whatsapp',
    integration: 'whatsapp',
    success: true,
    durationMs: 200,
  },
];

// ---------------------------------------------------------------------------
// createSkillFromTask
// ---------------------------------------------------------------------------

describe('createSkillFromTask', () => {
  it('returns null for fewer than 3 steps', () => {
    expect(createSkillFromTask(STEPS.slice(0, 2))).toBeNull();
  });

  it('returns null if any step failed', () => {
    const failing = STEPS.map((s, i) => (i === 1 ? { ...s, success: false } : s));
    expect(createSkillFromTask(failing)).toBeNull();
  });

  it('extracts a skill from a valid task history', () => {
    const skill = createSkillFromTask(STEPS);
    expect(skill).not.toBeNull();
    expect(skill!.steps).toHaveLength(3);
    expect(skill!.requiredIntegrations).toContain('sqlite');
    expect(skill!.requiredIntegrations).toContain('whatsapp');
    expect(skill!.requiredDocTypes).toContain('order');
  });
});

// ---------------------------------------------------------------------------
// storeSkill + getSkillById — versioning fields
// ---------------------------------------------------------------------------

describe('storeSkill / getSkillById — versioning fields', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  it('stores a skill with default tracking values', () => {
    const skill = createSkillFromTask(STEPS)!;
    const id = storeSkill(db, skill);
    const stored = getSkillById(db, id);
    expect(stored).not.toBeNull();
    expect(stored!.version).toBe(1);
    expect(stored!.usageCount).toBe(0);
    expect(stored!.successRate).toBe(0);
    expect(stored!.avgDurationMs).toBeNull();
    expect(stored!.lastUsed).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recordSkillExecution
// ---------------------------------------------------------------------------

describe('recordSkillExecution', () => {
  let db: Database.Database;
  let skillId: number;

  beforeEach(() => {
    db = makeDb();
    skillId = storeSkill(db, createSkillFromTask(STEPS)!);
  });

  it('returns false for a non-existent skill ID', () => {
    expect(recordSkillExecution(db, 9999, true)).toBe(false);
  });

  it('increments usage_count on execution', () => {
    recordSkillExecution(db, skillId, true, 100);
    const s = getSkillById(db, skillId)!;
    expect(s.usageCount).toBe(1);
  });

  it('sets last_used after execution', () => {
    recordSkillExecution(db, skillId, true);
    const s = getSkillById(db, skillId)!;
    expect(s.lastUsed).not.toBeNull();
  });

  it('computes rolling success_rate correctly', () => {
    recordSkillExecution(db, skillId, true); // 1/1 = 1.0
    recordSkillExecution(db, skillId, false); // 1/2 = 0.5
    recordSkillExecution(db, skillId, true); // 2/3 ≈ 0.667
    const s = getSkillById(db, skillId)!;
    expect(s.usageCount).toBe(3);
    expect(s.successRate).toBeCloseTo(2 / 3, 5);
  });

  it('computes rolling avg_duration_ms correctly', () => {
    recordSkillExecution(db, skillId, true, 100);
    recordSkillExecution(db, skillId, true, 200);
    const s = getSkillById(db, skillId)!;
    expect(s.avgDurationMs).toBeCloseTo(150, 5);
  });

  it('omitting durationMs leaves avg_duration_ms unchanged', () => {
    recordSkillExecution(db, skillId, true, 100);
    recordSkillExecution(db, skillId, true);
    const s = getSkillById(db, skillId)!;
    // avg_duration_ms should still be 100 (second call had no duration)
    expect(s.avgDurationMs).toBeCloseTo(100, 5);
  });
});

// ---------------------------------------------------------------------------
// getTopSkills
// ---------------------------------------------------------------------------

describe('getTopSkills', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  function insertSkill(name: string): number {
    return storeSkill(db, {
      name,
      description: `${name} desc`,
      steps: ['step1', 'step2', 'step3'],
      requiredIntegrations: [],
      requiredDocTypes: [],
      createdAt: new Date().toISOString(),
      version: 1,
      usageCount: 0,
      successRate: 0,
      avgDurationMs: null,
      lastUsed: null,
    });
  }

  it('returns skills sorted by usage × success_rate descending', () => {
    const idA = insertSkill('skill-a');
    const idB = insertSkill('skill-b');
    const idC = insertSkill('skill-c');

    // skill-b: 10 runs, 100% success → score = 10
    for (let i = 0; i < 10; i++) recordSkillExecution(db, idB, true);
    // skill-a: 5 runs, 80% success → score ≈ 4
    for (let i = 0; i < 4; i++) recordSkillExecution(db, idA, true);
    recordSkillExecution(db, idA, false);
    // skill-c: never run → score = 0

    const top = getTopSkills(db, 3);
    expect(top[0].id).toBe(idB);
    expect(top[1].id).toBe(idA);
    expect(top[2].id).toBe(idC);
  });

  it('respects the limit parameter', () => {
    insertSkill('x1');
    insertSkill('x2');
    insertSkill('x3');
    expect(getTopSkills(db, 2)).toHaveLength(2);
  });
});
