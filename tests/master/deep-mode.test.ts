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
