import { describe, it, expect, beforeEach } from 'vitest';
import { DeepModeManager, PHASE_MODEL_MAP } from '../../src/master/deep-mode.js';
import type { DeepModeHost } from '../../src/master/deep-mode.js';
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
