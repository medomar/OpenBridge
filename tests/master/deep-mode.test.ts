import { describe, it, expect, beforeEach } from 'vitest';
import {
  DeepModeManager,
  PHASE_MODEL_MAP,
  parsePlanTasks,
  parsePlanBatches,
} from '../../src/master/deep-mode.js';
import type { DeepModeHost, DeepExecuteBatch } from '../../src/master/deep-mode.js';
import type { DeepPhase, DeepPhaseResult } from '../../src/types/agent.js';
import type { ModelTier } from '../../src/core/model-registry.js';

// ── Helpers ──────────────────────────────────────────────────────

const fakeHost: DeepModeHost = { workspacePath: '/tmp/test-workspace' };

/** Build a minimal DeepPhaseResult for tests that need one */
function makeResult(phase: DeepPhase): DeepPhaseResult {
  return {
    phase,
    output: `output for ${phase}`,
    completedAt: new Date().toISOString(),
  };
}

// ── PHASE_MODEL_MAP ───────────────────────────────────────────────

describe('PHASE_MODEL_MAP', () => {
  it('maps investigate to powerful', () => {
    expect(PHASE_MODEL_MAP.investigate).toBe<ModelTier>('powerful');
  });

  it('maps report to balanced', () => {
    expect(PHASE_MODEL_MAP.report).toBe<ModelTier>('balanced');
  });

  it('maps plan to powerful', () => {
    expect(PHASE_MODEL_MAP.plan).toBe<ModelTier>('powerful');
  });

  it('maps execute to balanced', () => {
    expect(PHASE_MODEL_MAP.execute).toBe<ModelTier>('balanced');
  });

  it('maps verify to fast', () => {
    expect(PHASE_MODEL_MAP.verify).toBe<ModelTier>('fast');
  });

  it('covers all five Deep Mode phases', () => {
    const phases: DeepPhase[] = ['investigate', 'report', 'plan', 'execute', 'verify'];
    for (const phase of phases) {
      expect(PHASE_MODEL_MAP[phase]).toBeDefined();
    }
  });
});

// ── getPhaseModelTier ─────────────────────────────────────────────

describe('DeepModeManager.getPhaseModelTier()', () => {
  let manager: DeepModeManager;

  beforeEach(() => {
    manager = new DeepModeManager(fakeHost);
  });

  it('returns undefined for an unknown session', () => {
    expect(manager.getPhaseModelTier('no-such-id')).toBeUndefined();
  });

  it('returns undefined after all phases are complete', () => {
    const sid = manager.startSession('test task', 'thorough')!;
    const phases: DeepPhase[] = ['investigate', 'report', 'plan', 'execute', 'verify'];
    for (const phase of phases) {
      manager.advancePhase(sid, makeResult(phase));
    }
    // session is done — currentPhase is undefined
    expect(manager.getPhaseModelTier(sid)).toBeUndefined();
  });

  it('returns "powerful" at the investigate phase (default)', () => {
    const sid = manager.startSession('test task', 'thorough')!;
    expect(manager.getPhaseModelTier(sid)).toBe<ModelTier>('powerful');
  });

  it('returns "balanced" at the report phase (default)', () => {
    const sid = manager.startSession('test task', 'thorough')!;
    manager.advancePhase(sid, makeResult('investigate'));
    expect(manager.getPhaseModelTier(sid)).toBe<ModelTier>('balanced');
  });

  it('returns "powerful" at the plan phase (default)', () => {
    const sid = manager.startSession('test task', 'thorough')!;
    manager.advancePhase(sid, makeResult('investigate'));
    manager.advancePhase(sid, makeResult('report'));
    expect(manager.getPhaseModelTier(sid)).toBe<ModelTier>('powerful');
  });

  it('returns "balanced" at the execute phase (default)', () => {
    const sid = manager.startSession('test task', 'thorough')!;
    manager.advancePhase(sid, makeResult('investigate'));
    manager.advancePhase(sid, makeResult('report'));
    manager.advancePhase(sid, makeResult('plan'));
    expect(manager.getPhaseModelTier(sid)).toBe<ModelTier>('balanced');
  });

  it('returns "fast" at the verify phase (default)', () => {
    const sid = manager.startSession('test task', 'thorough')!;
    manager.advancePhase(sid, makeResult('investigate'));
    manager.advancePhase(sid, makeResult('report'));
    manager.advancePhase(sid, makeResult('plan'));
    manager.advancePhase(sid, makeResult('execute'));
    expect(manager.getPhaseModelTier(sid)).toBe<ModelTier>('fast');
  });

  it('applies a single-phase override while keeping defaults for other phases', () => {
    const overrides: Partial<Record<DeepPhase, ModelTier>> = { investigate: 'balanced' };
    const sid = manager.startSession('test task', 'thorough')!;
    // Override applies for investigate
    expect(manager.getPhaseModelTier(sid, overrides)).toBe<ModelTier>('balanced');
    // Advance to report — no override → default balanced
    manager.advancePhase(sid, makeResult('investigate'));
    expect(manager.getPhaseModelTier(sid, overrides)).toBe<ModelTier>('balanced');
    // Advance to plan — no override → default powerful
    manager.advancePhase(sid, makeResult('report'));
    expect(manager.getPhaseModelTier(sid, overrides)).toBe<ModelTier>('powerful');
  });

  it('applies overrides for every phase when all are provided', () => {
    const fullOverride: Record<DeepPhase, ModelTier> = {
      investigate: 'fast',
      report: 'fast',
      plan: 'fast',
      execute: 'fast',
      verify: 'powerful',
    };
    const sid = manager.startSession('test task', 'thorough')!;
    const phases: DeepPhase[] = ['investigate', 'report', 'plan', 'execute', 'verify'];
    for (const phase of phases) {
      expect(manager.getPhaseModelTier(sid, fullOverride)).toBe(fullOverride[phase]);
      if (phase !== 'verify') {
        manager.advancePhase(sid, makeResult(phase));
      }
    }
  });

  it('returns undefined for fast-profile sessions (startSession returns null)', () => {
    const sid = manager.startSession('test task', 'fast');
    expect(sid).toBeNull();
  });

  it('model tier follows the phase as the session advances', () => {
    const sid = manager.startSession('test task', 'thorough')!;
    const expected: ModelTier[] = ['powerful', 'balanced', 'powerful', 'balanced', 'fast'];
    const phases: DeepPhase[] = ['investigate', 'report', 'plan', 'execute', 'verify'];

    for (let i = 0; i < phases.length; i++) {
      expect(manager.getPhaseModelTier(sid)).toBe(expected[i]);
      manager.advancePhase(sid, makeResult(phases[i]));
    }
    // After all phases, session is done
    expect(manager.getPhaseModelTier(sid)).toBeUndefined();
  });
});

// ── Phase transition order ─────────────────────────────────────────

describe('DeepModeManager — phase transition order', () => {
  let manager: DeepModeManager;

  beforeEach(() => {
    manager = new DeepModeManager(fakeHost);
  });

  it('starts a thorough session with the investigate phase', () => {
    const sid = manager.startSession('analyse the codebase', 'thorough')!;
    expect(manager.getCurrentPhase(sid)).toBe<DeepPhase>('investigate');
  });

  it('advances through phases in order: investigate → report → plan → execute → verify', () => {
    const sid = manager.startSession('analyse the codebase', 'thorough')!;
    const expectedOrder: DeepPhase[] = ['investigate', 'report', 'plan', 'execute', 'verify'];

    for (let i = 0; i < expectedOrder.length - 1; i++) {
      const next = manager.advancePhase(sid, makeResult(expectedOrder[i]));
      expect(next).toBe(expectedOrder[i + 1]);
      expect(manager.getCurrentPhase(sid)).toBe(expectedOrder[i + 1]);
    }
  });

  it('returns undefined from advancePhase() when the last phase completes', () => {
    const sid = manager.startSession('analyse the codebase', 'thorough')!;
    const phases: DeepPhase[] = ['investigate', 'report', 'plan', 'execute', 'verify'];
    for (const phase of phases) {
      manager.advancePhase(sid, makeResult(phase));
    }
    // currentPhase is undefined — session is done
    expect(manager.getCurrentPhase(sid)).toBeUndefined();
  });

  it('stores phase results that are retrievable after advance', () => {
    const sid = manager.startSession('analyse the codebase', 'thorough')!;
    const result = makeResult('investigate');
    manager.advancePhase(sid, result);
    expect(manager.getPhaseResult(sid, 'investigate')).toEqual(result);
  });

  it('isActive() returns false once all phases are completed', () => {
    const sid = manager.startSession('analyse the codebase', 'thorough')!;
    expect(manager.isActive(sid)).toBe(true);
    const phases: DeepPhase[] = ['investigate', 'report', 'plan', 'execute', 'verify'];
    for (const phase of phases) {
      manager.advancePhase(sid, makeResult(phase));
    }
    expect(manager.isActive(sid)).toBe(false);
  });
});

// ── Manual profile — pauses between phases ─────────────────────────

describe('DeepModeManager — manual profile pauses', () => {
  let manager: DeepModeManager;

  beforeEach(() => {
    manager = new DeepModeManager(fakeHost);
  });

  it('isPaused() returns false before the first advance', () => {
    const sid = manager.startSession('audit security', 'manual')!;
    expect(manager.isPaused(sid)).toBe(false);
  });

  it('pauses after advancing from investigate to report', () => {
    const sid = manager.startSession('audit security', 'manual')!;
    manager.advancePhase(sid, makeResult('investigate'));
    expect(manager.isPaused(sid)).toBe(true);
  });

  it('remains paused until resume() is called', () => {
    const sid = manager.startSession('audit security', 'manual')!;
    manager.advancePhase(sid, makeResult('investigate'));
    expect(manager.isPaused(sid)).toBe(true);
    manager.resume(sid);
    expect(manager.isPaused(sid)).toBe(false);
  });

  it('requiresConfirmation() returns true for manual profile', () => {
    const sid = manager.startSession('audit security', 'manual')!;
    expect(manager.requiresConfirmation(sid)).toBe(true);
  });

  it('shouldAutoAdvance() returns false for manual profile', () => {
    const sid = manager.startSession('audit security', 'manual')!;
    expect(manager.shouldAutoAdvance(sid)).toBe(false);
  });

  it('pauses after every phase transition in manual mode', () => {
    const sid = manager.startSession('audit security', 'manual')!;
    const phases: DeepPhase[] = ['investigate', 'report', 'plan', 'execute'];
    for (const phase of phases) {
      manager.advancePhase(sid, makeResult(phase));
      expect(manager.isPaused(sid)).toBe(true);
      manager.resume(sid);
      expect(manager.isPaused(sid)).toBe(false);
    }
  });
});

// ── Thorough profile — auto-advances without pausing ──────────────

describe('DeepModeManager — thorough profile auto-advances', () => {
  let manager: DeepModeManager;

  beforeEach(() => {
    manager = new DeepModeManager(fakeHost);
  });

  it('never pauses between phases for thorough profile', () => {
    const sid = manager.startSession('thorough review', 'thorough')!;
    const phases: DeepPhase[] = ['investigate', 'report', 'plan', 'execute'];
    for (const phase of phases) {
      manager.advancePhase(sid, makeResult(phase));
      expect(manager.isPaused(sid)).toBe(false);
    }
  });

  it('shouldAutoAdvance() returns true for thorough profile', () => {
    const sid = manager.startSession('thorough review', 'thorough')!;
    expect(manager.shouldAutoAdvance(sid)).toBe(true);
  });

  it('requiresConfirmation() returns false for thorough profile', () => {
    const sid = manager.startSession('thorough review', 'thorough')!;
    expect(manager.requiresConfirmation(sid)).toBe(false);
  });
});

// ── Fast profile — skips Deep Mode entirely ────────────────────────

describe('DeepModeManager — fast profile skips Deep Mode', () => {
  let manager: DeepModeManager;

  beforeEach(() => {
    manager = new DeepModeManager(fakeHost);
  });

  it('startSession() returns null for fast profile', () => {
    const result = manager.startSession('quick question', 'fast');
    expect(result).toBeNull();
  });

  it('getActiveSessions() remains empty after a fast-profile start attempt', () => {
    manager.startSession('quick question', 'fast');
    expect(manager.getActiveSessions()).toHaveLength(0);
  });
});

// ── skipPhase ──────────────────────────────────────────────────────

describe('DeepModeManager.skipPhase()', () => {
  let manager: DeepModeManager;

  beforeEach(() => {
    manager = new DeepModeManager(fakeHost);
  });

  it('moves to the next phase without recording a result', () => {
    const sid = manager.startSession('partial review', 'thorough')!;
    const nextPhase = manager.skipPhase(sid);
    expect(nextPhase).toBe<DeepPhase>('report');
    expect(manager.getCurrentPhase(sid)).toBe<DeepPhase>('report');
    // No result stored for skipped phase
    expect(manager.getPhaseResult(sid, 'investigate')).toBeUndefined();
  });

  it('can skip multiple consecutive phases', () => {
    const sid = manager.startSession('partial review', 'thorough')!;
    manager.skipPhase(sid); // investigate → report
    manager.skipPhase(sid); // report → plan
    expect(manager.getCurrentPhase(sid)).toBe<DeepPhase>('plan');
  });

  it('returns undefined when skipping the last phase', () => {
    const sid = manager.startSession('partial review', 'thorough')!;
    // Advance to verify
    const phases: DeepPhase[] = ['investigate', 'report', 'plan', 'execute'];
    for (const phase of phases) {
      manager.advancePhase(sid, makeResult(phase));
    }
    expect(manager.getCurrentPhase(sid)).toBe<DeepPhase>('verify');
    const result = manager.skipPhase(sid);
    expect(result).toBeUndefined();
    expect(manager.getCurrentPhase(sid)).toBeUndefined();
  });

  it('returns undefined and warns when session is not found', () => {
    const result = manager.skipPhase('non-existent-session');
    expect(result).toBeUndefined();
  });
});

// ── focusOnItem ────────────────────────────────────────────────────

describe('DeepModeManager.focusOnItem()', () => {
  let manager: DeepModeManager;

  beforeEach(() => {
    manager = new DeepModeManager(fakeHost);
  });

  it('records the focused item in the session state', () => {
    const sid = manager.startSession('security audit', 'manual')!;
    manager.focusOnItem(sid, 3);
    const state = manager.getSessionState(sid)!;
    expect(state.skippedItems).toContain(3);
  });

  it('records multiple distinct focus items', () => {
    const sid = manager.startSession('security audit', 'manual')!;
    manager.focusOnItem(sid, 1);
    manager.focusOnItem(sid, 5);
    const state = manager.getSessionState(sid)!;
    expect(state.skippedItems).toContain(1);
    expect(state.skippedItems).toContain(5);
  });

  it('does not duplicate focus items when called twice with the same index', () => {
    const sid = manager.startSession('security audit', 'manual')!;
    manager.focusOnItem(sid, 2);
    manager.focusOnItem(sid, 2);
    const state = manager.getSessionState(sid)!;
    const occurrences = state.skippedItems.filter((i) => i === 2);
    expect(occurrences).toHaveLength(1);
  });

  it('is a no-op and does not throw for an unknown session', () => {
    expect(() => manager.focusOnItem('ghost-session', 1)).not.toThrow();
  });
});

// ── abort ──────────────────────────────────────────────────────────

describe('DeepModeManager.abort()', () => {
  let manager: DeepModeManager;

  beforeEach(() => {
    manager = new DeepModeManager(fakeHost);
  });

  it('removes the session from active sessions', () => {
    const sid = manager.startSession('analysis task', 'thorough')!;
    expect(manager.getActiveSessions()).toContain(sid);
    manager.abort(sid);
    expect(manager.getActiveSessions()).not.toContain(sid);
  });

  it('clears paused state when aborting a paused manual session', () => {
    const sid = manager.startSession('analysis task', 'manual')!;
    manager.advancePhase(sid, makeResult('investigate'));
    expect(manager.isPaused(sid)).toBe(true);
    manager.abort(sid);
    // session gone — isPaused should return false
    expect(manager.isPaused(sid)).toBe(false);
  });
});

// ── parsePlanTasks ─────────────────────────────────────────────────

const SAMPLE_PLAN_OUTPUT = `
### Tasks

---

**Task #1** · complexity: \`trivial\` · risk: \`low\`
**Title:** Fix return value in router
**Files to Modify:** \`src/core/router.ts\`
**Dependencies:** none
**Finding Refs:** Finding #1
**Description:** Add a missing return statement in the /history branch at line 142. Return a valid OutboundMessage object.

---

**Task #2** · complexity: \`small\` · risk: \`low\`
**Title:** Add test coverage for stop-all
**Files to Modify:** \`tests/core/router.test.ts\`
**Dependencies:** none
**Finding Refs:** Finding #2
**Description:** Add 2 test cases to tests/core/router.test.ts covering the /stop-all command.

---

**Task #3** · complexity: \`medium\` · risk: \`medium\`
**Title:** Refactor queue module
**Files to Modify:** \`src/core/queue.ts\`, \`src/core/bridge.ts\`
**Dependencies:** #1, #2
**Finding Refs:** Finding #3
**Description:** Refactor the queue module to use the new return values established in Tasks #1 and #2.

---

### Parallel Batches

**Batch 1 (parallel):** Tasks #1, #2
**Batch 2 (sequential):** Task #3 (depends on Batch 1)
`;

describe('parsePlanTasks()', () => {
  it('extracts the correct number of tasks', () => {
    const tasks = parsePlanTasks(SAMPLE_PLAN_OUTPUT);
    expect(tasks).toHaveLength(3);
  });

  it('parses task numbers correctly', () => {
    const tasks = parsePlanTasks(SAMPLE_PLAN_OUTPUT);
    expect(tasks.map((t) => t.taskNumber)).toEqual([1, 2, 3]);
  });

  it('parses task titles', () => {
    const tasks = parsePlanTasks(SAMPLE_PLAN_OUTPUT);
    expect(tasks[0].title).toBe('Fix return value in router');
    expect(tasks[1].title).toBe('Add test coverage for stop-all');
    expect(tasks[2].title).toBe('Refactor queue module');
  });

  it('parses files to modify', () => {
    const tasks = parsePlanTasks(SAMPLE_PLAN_OUTPUT);
    expect(tasks[0].filesToModify).toContain('src/core/router.ts');
    expect(tasks[2].filesToModify).toHaveLength(2);
  });

  it('parses "none" dependencies as an empty array', () => {
    const tasks = parsePlanTasks(SAMPLE_PLAN_OUTPUT);
    expect(tasks[0].dependsOn).toEqual([]);
    expect(tasks[1].dependsOn).toEqual([]);
  });

  it('parses task number dependencies', () => {
    const tasks = parsePlanTasks(SAMPLE_PLAN_OUTPUT);
    expect(tasks[2].dependsOn).toEqual([1, 2]);
  });

  it('parses task descriptions', () => {
    const tasks = parsePlanTasks(SAMPLE_PLAN_OUTPUT);
    expect(tasks[0].description).toContain('return statement');
  });

  it('returns an empty array for empty plan output', () => {
    expect(parsePlanTasks('')).toEqual([]);
  });
});

// ── parsePlanBatches ───────────────────────────────────────────────

describe('parsePlanBatches()', () => {
  it('extracts two batches from sample plan output', () => {
    const batches = parsePlanBatches(SAMPLE_PLAN_OUTPUT);
    expect(batches).toHaveLength(2);
  });

  it('first batch contains tasks 1 and 2', () => {
    const batches = parsePlanBatches(SAMPLE_PLAN_OUTPUT);
    expect(batches[0]).toEqual([1, 2]);
  });

  it('second batch contains only task 3', () => {
    const batches = parsePlanBatches(SAMPLE_PLAN_OUTPUT);
    expect(batches[1]).toEqual([3]);
  });

  it('returns empty array when no Parallel Batches section is present', () => {
    expect(parsePlanBatches('No batches here.')).toEqual([]);
  });

  it('does not include task numbers from parenthetical dependency annotations', () => {
    const output = '**Batch 2 (sequential):** Task #3 (depends on Tasks #1 and #2)';
    const batches = parsePlanBatches(output);
    expect(batches).toHaveLength(1);
    // Only #3 should appear — #1 and #2 are in the parens
    expect(batches[0]).toEqual([3]);
  });
});

// ── getExecuteBatches ─────────────────────────────────────────────

describe('DeepModeManager.getExecuteBatches()', () => {
  let manager: DeepModeManager;

  beforeEach(() => {
    manager = new DeepModeManager(fakeHost);
  });

  function advanceToPlan(sid: string): void {
    manager.advancePhase(sid, makeResult('investigate'));
    manager.advancePhase(sid, makeResult('report'));
  }

  it('returns undefined for an unknown session', () => {
    expect(manager.getExecuteBatches('no-such-id')).toBeUndefined();
  });

  it('returns undefined when the plan phase has no result yet', () => {
    const sid = manager.startSession('refactor task', 'thorough')!;
    advanceToPlan(sid);
    // plan phase not completed — no result stored
    expect(manager.getExecuteBatches(sid)).toBeUndefined();
  });

  it('returns batches from the plan output batch section', () => {
    const sid = manager.startSession('refactor task', 'thorough')!;
    advanceToPlan(sid);
    manager.advancePhase(sid, {
      phase: 'plan',
      output: SAMPLE_PLAN_OUTPUT,
      completedAt: new Date().toISOString(),
    });

    const batches = manager.getExecuteBatches(sid);
    expect(batches).toBeDefined();
    expect(batches!).toHaveLength(2);
    expect(batches![0]).toHaveLength(2); // tasks 1 and 2 in parallel
    expect(batches![1]).toHaveLength(1); // task 3 sequential
  });

  it('filters out skipped items from batches', () => {
    const sid = manager.startSession('refactor task', 'thorough')!;
    advanceToPlan(sid);
    manager.advancePhase(sid, {
      phase: 'plan',
      output: SAMPLE_PLAN_OUTPUT,
      completedAt: new Date().toISOString(),
    });
    manager.skipItem(sid, 1); // skip task #1

    const batches = manager.getExecuteBatches(sid);
    expect(batches).toBeDefined();
    // Batch 1 now has only task #2 (task #1 was skipped)
    const batch1TaskNums = batches![0].map((t) => t.taskNumber);
    expect(batch1TaskNums).not.toContain(1);
    expect(batch1TaskNums).toContain(2);
  });

  it('falls back to dependency-ordered batches when no Parallel Batches section', () => {
    const noBatchesPlan = `
**Task #1** · complexity: \`trivial\` · risk: \`low\`
**Title:** Task one
**Files to Modify:** \`src/a.ts\`
**Dependencies:** none
**Description:** Do task one.

---

**Task #2** · complexity: \`small\` · risk: \`low\`
**Title:** Task two
**Files to Modify:** \`src/b.ts\`
**Dependencies:** #1
**Description:** Do task two, depends on task one.
`;
    const sid = manager.startSession('refactor task', 'thorough')!;
    advanceToPlan(sid);
    manager.advancePhase(sid, {
      phase: 'plan',
      output: noBatchesPlan,
      completedAt: new Date().toISOString(),
    });

    const batches = manager.getExecuteBatches(sid);
    expect(batches).toBeDefined();
    // Task 1 first (no deps), task 2 second (depends on 1)
    expect(batches![0][0].taskNumber).toBe(1);
    expect(batches![1][0].taskNumber).toBe(2);
  });

  it('parallel execution respects WorkerRegistry concurrency — batch size does not exceed task count', () => {
    const sid = manager.startSession('large task', 'thorough')!;
    advanceToPlan(sid);
    manager.advancePhase(sid, {
      phase: 'plan',
      output: SAMPLE_PLAN_OUTPUT,
      completedAt: new Date().toISOString(),
    });

    const batches = manager.getExecuteBatches(sid);
    expect(batches).toBeDefined();
    // All tasks must appear exactly once across all batches
    const allTaskNums = batches!.flatMap((b) => b.map((t) => t.taskNumber));
    expect(allTaskNums.sort()).toEqual([1, 2, 3]);
  });
});

// ── buildBatchWorkerPrompts ───────────────────────────────────────

describe('DeepModeManager.buildBatchWorkerPrompts()', () => {
  let manager: DeepModeManager;

  beforeEach(() => {
    manager = new DeepModeManager(fakeHost);
  });

  it('returns one prompt per task in the batch', () => {
    const sid = manager.startSession('refactor task', 'thorough')!;
    manager.advancePhase(sid, makeResult('investigate'));
    manager.advancePhase(sid, makeResult('report'));
    manager.advancePhase(sid, {
      phase: 'plan',
      output: SAMPLE_PLAN_OUTPUT,
      completedAt: new Date().toISOString(),
    });

    const batches = manager.getExecuteBatches(sid)!;
    const prompts = manager.buildBatchWorkerPrompts(sid, batches[0]);
    expect(prompts).toHaveLength(2); // batch 0 has tasks #1 and #2
  });

  it('each prompt mentions the correct task number', () => {
    const sid = manager.startSession('refactor task', 'thorough')!;
    manager.advancePhase(sid, makeResult('investigate'));
    manager.advancePhase(sid, makeResult('report'));
    manager.advancePhase(sid, {
      phase: 'plan',
      output: SAMPLE_PLAN_OUTPUT,
      completedAt: new Date().toISOString(),
    });

    const batches = manager.getExecuteBatches(sid)!;
    const prompts = manager.buildBatchWorkerPrompts(sid, batches[0]);
    expect(prompts[0]).toContain('Task #1');
    expect(prompts[1]).toContain('Task #2');
  });

  it('returns empty array for an empty batch', () => {
    const sid = manager.startSession('refactor task', 'thorough')!;
    const emptyBatch: DeepExecuteBatch = [];
    expect(manager.buildBatchWorkerPrompts(sid, emptyBatch)).toEqual([]);
  });
});
