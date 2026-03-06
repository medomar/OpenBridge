/**
 * Tests for orchestration patterns — OB-1792.
 *
 * Covers:
 * 1. Planning gate flow  — shouldBypassPlanning, PlanningGate lifecycle,
 *    performReasoningCheckpoint, buildAnalysisWorkerSpecs (OB-1775–1780)
 * 2. Swarm coordination  — composition planning, handoff propagation,
 *    lifecycle transitions (OB-1782–1785)
 * 3. Test protection     — isTestFile, detectTestFileModification (OB-1786–1788)
 * 4. Iteration caps      — countFixIterations, extractRemainingErrors,
 *    DEFAULT_MAX_FIX_ITERATIONS (OB-1789–1791)
 */

import { describe, it, expect } from 'vitest';

// Planning gate
import {
  shouldBypassPlanning,
  performReasoningCheckpoint,
  PlanningGate,
  MAX_ANALYSIS_WORKERS,
  ANALYSIS_WORKER_MAX_TURNS,
} from '../../src/master/planning-gate.js';

// Swarm coordination
import {
  SwarmCoordinator,
  planSwarmComposition,
  classifyTaskComplexity,
  SWARM_PIPELINE_ORDER,
} from '../../src/master/swarm-coordinator.js';
import type { TaskManifest } from '../../src/types/agent.js';

// Test protection helpers
import {
  isTestFile,
  detectTestFileModification,
} from '../../src/master/worker-result-formatter.js';

// Iteration caps
import {
  countFixIterations,
  extractRemainingErrors,
  DEFAULT_MAX_FIX_ITERATIONS,
  FIX_ITERATION_PATTERNS,
} from '../../src/core/agent-runner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(prompt: string): TaskManifest {
  return { prompt, workspacePath: '/tmp/test' };
}

function makeWorker(id: string) {
  return { id, prompt: `Worker ${id}`, spawnedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// 1. Planning gate — shouldBypassPlanning
// ---------------------------------------------------------------------------

describe('shouldBypassPlanning', () => {
  it('bypasses for FAQ / read-only questions (no write intent)', () => {
    const r1 = shouldBypassPlanning('What is the entry point of this project?');
    expect(r1.bypass).toBe(true);
    expect(r1.reason).toContain('FAQ');

    const r2 = shouldBypassPlanning('How does the auth module work?');
    expect(r2.bypass).toBe(true);

    const r3 = shouldBypassPlanning('explain the database schema');
    expect(r3.bypass).toBe(true);
  });

  it('does NOT bypass an FAQ that also has write intent (when task is long enough)', () => {
    // Long enough to avoid the short-task bypass (>= 15 words) + has write intent
    const r = shouldBypassPlanning(
      'What is the best way to refactor the authentication module and implement a new token refresh mechanism across all services?',
    );
    expect(r.bypass).toBe(false);
  });

  it('bypasses for single-file edits', () => {
    const r = shouldBypassPlanning('Fix the bug in src/core/router.ts');
    expect(r.bypass).toBe(true);
    expect(r.reason).toContain('single-file');
  });

  it('bypasses for very short tasks (< threshold words)', () => {
    const r = shouldBypassPlanning('run tests');
    expect(r.bypass).toBe(true);
    expect(r.reason).toContain('short task');
  });

  it('bypasses for empty task description', () => {
    const r = shouldBypassPlanning('');
    expect(r.bypass).toBe(true);
  });

  it('requires planning for complex multi-file tasks', () => {
    const r = shouldBypassPlanning(
      'Refactor the authentication module: update src/core/auth.ts, src/core/router.ts, and all related tests to use the new JWT strategy',
    );
    expect(r.bypass).toBe(false);
    expect(r.reason).toContain('planning required');
  });

  it('requires planning when multiple file paths are mentioned', () => {
    const r = shouldBypassPlanning(
      'Update the logging system across src/core/logger.ts and src/index.ts to use structured output',
    );
    expect(r.bypass).toBe(false);
  });

  it('always returns a non-empty reason string', () => {
    const cases = [
      'what is foo?',
      'add a button',
      'fix src/app.ts',
      'massive multi-module refactor across every single file in the project involving migrations and security changes',
    ];
    for (const task of cases) {
      const { reason } = shouldBypassPlanning(task);
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Planning gate — PlanningGate lifecycle
// ---------------------------------------------------------------------------

describe('PlanningGate', () => {
  it('starts in idle status', () => {
    const gate = new PlanningGate();
    expect(gate.status).toBe('idle');
    expect(gate.state).toBeNull();
  });

  it('transitions through analysis → awaiting_confirmation → execution → complete', () => {
    const gate = new PlanningGate();

    // Start analysis
    gate.startAnalysis('Refactor auth module');
    expect(gate.status).toBe('analysis');
    expect(gate.isAnalysisPhase).toBe(true);

    // Register a worker and complete it
    const w1 = makeWorker('w1');
    gate.recordAnalysisWorker(w1);
    expect(gate.totalAnalysisWorkerCount).toBe(1);
    expect(gate.completedAnalysisWorkerCount).toBe(0);
    expect(gate.canCompleteAnalysis).toBe(false);

    gate.completeAnalysisWorker('w1', 'Found auth.ts and related tests');
    expect(gate.completedAnalysisWorkerCount).toBe(1);
    expect(gate.canCompleteAnalysis).toBe(true);

    // Complete analysis
    gate.completeAnalysis('Analysis: auth.ts is the main entry point');
    expect(gate.status).toBe('awaiting_confirmation');
    expect(gate.isAwaitingConfirmation).toBe(true);
    expect(gate.state!.analysisOutput).toBe('Analysis: auth.ts is the main entry point');

    // Confirm approach → execution
    gate.confirmApproach('Extract AuthService from auth.ts');
    expect(gate.status).toBe('execution');
    expect(gate.isExecutionPhase).toBe(true);
    expect(gate.allowsExecution).toBe(true);
    expect(gate.state!.confirmedStrategy).toBe('Extract AuthService from auth.ts');

    // Complete execution
    gate.completeExecution();
    expect(gate.status).toBe('complete');
    expect(gate.isComplete).toBe(true);
  });

  it('bypass() transitions directly to bypassed and sets bypassReason', () => {
    const gate = new PlanningGate();
    gate.bypass('what is foo?', 'read-only FAQ');
    expect(gate.status).toBe('bypassed');
    expect(gate.isBypassed).toBe(true);
    expect(gate.allowsExecution).toBe(true);
    expect(gate.isComplete).toBe(true);
    expect(gate.state!.bypassReason).toBe('read-only FAQ');
  });

  it('enforces MAX_ANALYSIS_WORKERS (OB-1777)', () => {
    const gate = new PlanningGate();
    gate.startAnalysis('complex task');

    for (let i = 0; i < MAX_ANALYSIS_WORKERS; i++) {
      gate.recordAnalysisWorker(makeWorker(`w${i}`));
    }

    expect(() => gate.recordAnalysisWorker(makeWorker('w-extra'))).toThrow(
      /cannot register more than/i,
    );
  });

  it('throws when completeAnalysis() called with pending workers (OB-1777)', () => {
    const gate = new PlanningGate();
    gate.startAnalysis('task');
    gate.recordAnalysisWorker(makeWorker('w1'));
    // Worker w1 not completed

    expect(() => gate.completeAnalysis('partial output')).toThrow(/have not yet returned/i);
  });

  it('throws when methods are called out of sequence', () => {
    const gate = new PlanningGate();

    // Can't confirm before analysis
    expect(() => gate.confirmApproach('strategy')).toThrow(/expected status/i);

    gate.startAnalysis('task');
    // Can't complete execution while still in analysis
    expect(() => gate.completeExecution()).toThrow(/expected status/i);
  });

  it('aggregateWorkerOutputs() combines completed worker outputs', () => {
    const gate = new PlanningGate();
    gate.startAnalysis('task');

    gate.recordAnalysisWorker(makeWorker('w1'));
    gate.recordAnalysisWorker(makeWorker('w2'));
    gate.completeAnalysisWorker('w1', 'First worker findings');
    gate.completeAnalysisWorker('w2', 'Second worker findings');

    const aggregated = gate.aggregateWorkerOutputs();
    expect(aggregated).toContain('Analysis Worker 1');
    expect(aggregated).toContain('First worker findings');
    expect(aggregated).toContain('Analysis Worker 2');
    expect(aggregated).toContain('Second worker findings');
  });

  it('aggregateWorkerOutputs() returns empty string when no workers registered', () => {
    const gate = new PlanningGate();
    expect(gate.aggregateWorkerOutputs()).toBe('');
  });

  it('completeAnalysisWorker() returns false for unknown worker ID', () => {
    const gate = new PlanningGate();
    gate.startAnalysis('task');
    expect(gate.completeAnalysisWorker('does-not-exist', 'output')).toBe(false);
  });

  it('reset() clears state and returns to idle', () => {
    const gate = new PlanningGate();
    gate.startAnalysis('task');
    gate.reset();
    expect(gate.status).toBe('idle');
    expect(gate.state).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Planning gate — buildAnalysisWorkerSpecs
// ---------------------------------------------------------------------------

describe('PlanningGate.buildAnalysisWorkerSpecs', () => {
  it('returns exactly two read-only specs', () => {
    const gate = new PlanningGate();
    const specs = gate.buildAnalysisWorkerSpecs('Refactor the router module');
    expect(specs).toHaveLength(2);
    for (const spec of specs) {
      expect(spec.profile).toBe('read-only');
      expect(spec.maxTurns).toBe(ANALYSIS_WORKER_MAX_TURNS);
      expect(spec.id).toBeTruthy();
      expect(spec.prompt).toBeTruthy();
    }
  });

  it('specs have distinct IDs', () => {
    const gate = new PlanningGate();
    const specs = gate.buildAnalysisWorkerSpecs('task');
    expect(specs[0]!.id).not.toBe(specs[1]!.id);
  });

  it('first spec is investigation, second is risk assessment', () => {
    const gate = new PlanningGate();
    const specs = gate.buildAnalysisWorkerSpecs('Implement new auth strategy');
    expect(specs[0]!.prompt).toContain('investigation worker');
    expect(specs[1]!.prompt).toContain('risk-assessment worker');
  });

  it('embeds the task description in both prompts', () => {
    const gate = new PlanningGate();
    const task = 'Update database migration logic in migration.ts';
    const specs = gate.buildAnalysisWorkerSpecs(task);
    for (const spec of specs) {
      expect(spec.prompt).toContain(task);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Planning gate — performReasoningCheckpoint
// ---------------------------------------------------------------------------

describe('performReasoningCheckpoint', () => {
  it('returns low risk for benign prompts', () => {
    const result = performReasoningCheckpoint('Read the router module and summarise it');
    expect(result.riskLevel).toBe('low');
    expect(result.risks).toHaveLength(0);
  });

  it('detects high risk for destructive delete patterns', () => {
    const result = performReasoningCheckpoint('rm -rf the entire dist directory');
    expect(result.riskLevel).toBe('high');
    expect(result.risks.some((r) => r.level === 'high')).toBe(true);
  });

  it('detects high risk for force/bypass-safety flags', () => {
    // The pattern matches `reset\s+--hard` — `\b` anchors on the word boundary before `reset`
    const result = performReasoningCheckpoint('git reset --hard to discard all local changes');
    expect(result.riskLevel).toBe('high');
    expect(result.risks.some((r) => r.pattern === 'bypass-safety')).toBe(true);
  });

  it('detects medium risk for broad scope', () => {
    const result = performReasoningCheckpoint('Update all files in the entire codebase');
    expect(result.riskLevel).toBe('medium');
    expect(result.risks.some((r) => r.pattern === 'broad-scope')).toBe(true);
  });

  it('detects medium risk for dependency installs', () => {
    const result = performReasoningCheckpoint('npm install lodash and update imports');
    expect(result.riskLevel).toBe('medium');
    expect(result.risks.some((r) => r.pattern === 'dependency-install')).toBe(true);
  });

  it('detects medium risk for security-sensitive tasks', () => {
    const result = performReasoningCheckpoint('Update the authentication token generation logic');
    expect(result.riskLevel).toBe('medium');
    expect(result.risks.some((r) => r.pattern === 'security-sensitive')).toBe(true);
  });

  it('escalates to high when any signal is high', () => {
    const result = performReasoningCheckpoint('npm install and then rm -rf all old node_modules');
    // Both medium (npm install) and high (rm -rf) detected — high wins
    expect(result.riskLevel).toBe('high');
  });

  it('includes the prompt and a timestamp in the result', () => {
    const prompt = 'Analyse the config file';
    const result = performReasoningCheckpoint(prompt);
    expect(result.prompt).toBe(prompt);
    expect(result.performedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// 5. Swarm coordination — classifyTaskComplexity (direct)
// ---------------------------------------------------------------------------

describe('classifyTaskComplexity', () => {
  it('classifies empty input as simple', () => {
    expect(classifyTaskComplexity('')).toBe('simple');
  });

  it('classifies information questions as simple', () => {
    expect(classifyTaskComplexity('what is the auth module?')).toBe('simple');
    expect(classifyTaskComplexity("what's the entry point")).toBe('simple');
    expect(classifyTaskComplexity('show me the config')).toBe('simple');
    expect(classifyTaskComplexity('list all routes')).toBe('simple');
  });

  it('classifies architectural / large-scope tasks as complex', () => {
    expect(classifyTaskComplexity('refactor the entire auth system')).toBe('complex');
    expect(classifyTaskComplexity('migrate the database and update all tests')).toBe('complex');
    expect(classifyTaskComplexity('rewrite the authentication module from scratch')).toBe(
      'complex',
    );
  });

  it('classifies tasks >= 30 words as complex', () => {
    const longTask = Array.from({ length: 31 }, (_, i) => `word${i}`).join(' ');
    expect(classifyTaskComplexity(longTask)).toBe('complex');
  });

  it('classifies single-step fix tasks as moderate', () => {
    expect(classifyTaskComplexity('fix the null pointer bug in login')).toBe('moderate');
    expect(classifyTaskComplexity('add error handling to the save function')).toBe('moderate');
  });
});

// ---------------------------------------------------------------------------
// 6. Swarm coordination — planSwarmComposition
// ---------------------------------------------------------------------------

describe('planSwarmComposition', () => {
  it('returns skipSwarms=true for simple tasks', () => {
    const plan = planSwarmComposition('what is the main file?');
    expect(plan.skipSwarms).toBe(true);
    expect(plan.swarmTypes).toHaveLength(0);
    expect(plan.complexity).toBe('simple');
  });

  it('returns only implement swarm for moderate tasks', () => {
    const plan = planSwarmComposition('fix the validation bug in signup');
    expect(plan.skipSwarms).toBe(false);
    expect(plan.swarmTypes).toEqual(['implement']);
    expect(plan.complexity).toBe('moderate');
  });

  it('returns full pipeline for complex tasks', () => {
    const plan = planSwarmComposition('refactor the authentication system end to end');
    expect(plan.skipSwarms).toBe(false);
    expect(plan.swarmTypes).toEqual(['research', 'implement', 'review', 'test']);
    expect(plan.complexity).toBe('complex');
  });

  it('pipeline order matches SWARM_PIPELINE_ORDER', () => {
    const plan = planSwarmComposition('analyse and rewrite the router module');
    if (!plan.skipSwarms) {
      for (const type of plan.swarmTypes) {
        expect(SWARM_PIPELINE_ORDER).toContain(type);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 7. SwarmCoordinator — lifecycle
// ---------------------------------------------------------------------------

describe('SwarmCoordinator', () => {
  it('createSwarm throws when workers array is empty', () => {
    const coordinator = new SwarmCoordinator();
    expect(() => coordinator.createSwarm('implement', [])).toThrow(/at least one worker/i);
  });

  it('createSwarm returns swarm in pending status', () => {
    const coordinator = new SwarmCoordinator();
    const swarm = coordinator.createSwarm('research', [makeManifest('Investigate auth module')]);
    expect(swarm.status).toBe('pending');
    expect(swarm.type).toBe('research');
    expect(coordinator.swarmCount).toBe(1);
  });

  it('startSwarm transitions pending → running', () => {
    const coordinator = new SwarmCoordinator();
    const swarm = coordinator.createSwarm('implement', [makeManifest('Fix bug')]);
    coordinator.startSwarm(swarm.id);
    expect(coordinator.getSwarm(swarm.id)!.status).toBe('running');
  });

  it('startSwarm throws if swarm is already running', () => {
    const coordinator = new SwarmCoordinator();
    const swarm = coordinator.createSwarm('implement', [makeManifest('task')]);
    coordinator.startSwarm(swarm.id);
    expect(() => coordinator.startSwarm(swarm.id)).toThrow(/expected status 'pending'/i);
  });

  it('completeSwarm transitions running → completed', () => {
    const coordinator = new SwarmCoordinator();
    const swarm = coordinator.createSwarm('implement', [makeManifest('task')]);
    coordinator.startSwarm(swarm.id);
    coordinator.recordWorkerResult(swarm.id, {
      workerId: 'w1',
      output: 'Done',
      success: true,
    });
    const result = coordinator.completeSwarm(swarm.id);
    expect(result.swarm.status).toBe('completed');
    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(0);
  });

  it('failSwarm transitions running → failed', () => {
    const coordinator = new SwarmCoordinator();
    const swarm = coordinator.createSwarm('review', [makeManifest('review task')]);
    coordinator.startSwarm(swarm.id);
    coordinator.failSwarm(swarm.id, 'unexpected error');
    expect(coordinator.getSwarm(swarm.id)!.status).toBe('failed');
  });

  it('isComplete returns false when swarms still pending/running', () => {
    const coordinator = new SwarmCoordinator();
    const swarm = coordinator.createSwarm('implement', [makeManifest('task')]);
    expect(coordinator.isComplete).toBe(false);
    coordinator.startSwarm(swarm.id);
    expect(coordinator.isComplete).toBe(false);
  });

  it('isComplete returns true when all swarms are in terminal state', () => {
    const coordinator = new SwarmCoordinator();
    const s1 = coordinator.createSwarm('research', [makeManifest('research')]);
    const s2 = coordinator.createSwarm('implement', [makeManifest('impl')]);

    coordinator.startSwarm(s1.id);
    coordinator.completeSwarm(s1.id);
    coordinator.startSwarm(s2.id);
    coordinator.failSwarm(s2.id, 'error');

    expect(coordinator.isComplete).toBe(true);
  });

  it('reset() clears all swarms', () => {
    const coordinator = new SwarmCoordinator();
    coordinator.createSwarm('implement', [makeManifest('task')]);
    coordinator.reset();
    expect(coordinator.swarmCount).toBe(0);
    expect(coordinator.isComplete).toBe(false);
  });

  it('getCombinedOutput returns empty string for swarm with no results', () => {
    const coordinator = new SwarmCoordinator();
    const swarm = coordinator.createSwarm('research', [makeManifest('task')]);
    expect(coordinator.getCombinedOutput(swarm.id)).toBe('');
  });

  it('getCombinedOutput returns combined worker outputs', () => {
    const coordinator = new SwarmCoordinator();
    const swarm = coordinator.createSwarm('research', [makeManifest('task')]);
    coordinator.startSwarm(swarm.id);
    coordinator.recordWorkerResult(swarm.id, {
      workerId: 'w1',
      output: 'Finding A',
      success: true,
    });
    coordinator.recordWorkerResult(swarm.id, {
      workerId: 'w2',
      output: 'Finding B',
      success: true,
    });
    const combined = coordinator.getCombinedOutput(swarm.id);
    expect(combined).toContain('Finding A');
    expect(combined).toContain('Finding B');
    expect(combined).toContain('w1');
    expect(combined).toContain('w2');
  });

  it('swarmsByPipelineOrder returns swarms in research → implement → review → test order', () => {
    const coordinator = new SwarmCoordinator();
    coordinator.createSwarm('test', [makeManifest('t')]);
    coordinator.createSwarm('research', [makeManifest('r')]);
    coordinator.createSwarm('review', [makeManifest('rv')]);
    coordinator.createSwarm('implement', [makeManifest('i')]);

    const ordered = coordinator.swarmsByPipelineOrder.map((s) => s.type);
    expect(ordered.indexOf('research')).toBeLessThan(ordered.indexOf('implement'));
    expect(ordered.indexOf('implement')).toBeLessThan(ordered.indexOf('review'));
    expect(ordered.indexOf('review')).toBeLessThan(ordered.indexOf('test'));
  });
});

// ---------------------------------------------------------------------------
// 8. SwarmCoordinator — handoff propagation (OB-1783)
// ---------------------------------------------------------------------------

describe('SwarmCoordinator.propagateHandoffToDownstream', () => {
  it('propagates research output to implement, review, and test swarms', () => {
    const coordinator = new SwarmCoordinator();

    const research = coordinator.createSwarm('research', [makeManifest('r')]);
    const implement = coordinator.createSwarm('implement', [makeManifest('i')]);
    const review = coordinator.createSwarm('review', [makeManifest('rv')]);
    const test = coordinator.createSwarm('test', [makeManifest('t')]);

    // Run and complete the research swarm
    coordinator.startSwarm(research.id);
    coordinator.recordWorkerResult(research.id, {
      workerId: 'rw1',
      output: 'Auth module uses JWT tokens.',
      success: true,
    });
    coordinator.completeSwarm(research.id); // triggers propagateHandoffToDownstream

    // All downstream swarms should have handoff context containing research output
    const implContext = coordinator.buildWorkerContext(implement.id);
    const reviewContext = coordinator.buildWorkerContext(review.id);
    const testContext = coordinator.buildWorkerContext(test.id);

    expect(implContext).toContain('Auth module uses JWT tokens');
    expect(reviewContext).toContain('Auth module uses JWT tokens');
    expect(testContext).toContain('Auth module uses JWT tokens');
  });

  it('does NOT propagate to upstream swarms', () => {
    const coordinator = new SwarmCoordinator();

    const research = coordinator.createSwarm('research', [makeManifest('r')]);
    const implement = coordinator.createSwarm('implement', [makeManifest('i')]);

    // Complete implement first
    coordinator.startSwarm(implement.id);
    coordinator.recordWorkerResult(implement.id, {
      workerId: 'iw1',
      output: 'Implementation complete.',
      success: true,
    });
    coordinator.completeSwarm(implement.id);

    // Research should NOT receive implement's handoff (it's upstream)
    const researchContext = coordinator.buildWorkerContext(research.id);
    expect(researchContext).not.toContain('Implementation complete');
  });

  it('handoff context is cumulative when multiple upstream swarms complete', () => {
    const coordinator = new SwarmCoordinator();

    const research = coordinator.createSwarm('research', [makeManifest('r')]);
    const implement = coordinator.createSwarm('implement', [makeManifest('i')]);
    const review = coordinator.createSwarm('review', [makeManifest('rv')]);

    // Complete research
    coordinator.startSwarm(research.id);
    coordinator.recordWorkerResult(research.id, {
      workerId: 'rw1',
      output: 'Research findings',
      success: true,
    });
    coordinator.completeSwarm(research.id);

    // Complete implement
    coordinator.startSwarm(implement.id);
    coordinator.recordWorkerResult(implement.id, {
      workerId: 'iw1',
      output: 'Implementation findings',
      success: true,
    });
    coordinator.completeSwarm(implement.id);

    // Review should have both research and implement context
    const reviewContext = coordinator.buildWorkerContext(review.id);
    expect(reviewContext).toContain('Research findings');
    expect(reviewContext).toContain('Implementation findings');
  });

  it('propagateHandoffToDownstream returns 0 for non-completed swarm', () => {
    const coordinator = new SwarmCoordinator();
    const swarm = coordinator.createSwarm('research', [makeManifest('r')]);
    coordinator.startSwarm(swarm.id);
    // Not completed yet
    const count = coordinator.propagateHandoffToDownstream(swarm.id);
    expect(count).toBe(0);
  });

  it('propagateHandoffToDownstream returns 0 for unknown swarmId', () => {
    const coordinator = new SwarmCoordinator();
    expect(coordinator.propagateHandoffToDownstream('unknown-id')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 9. SwarmCoordinator — parallel execution (OB-1785)
// ---------------------------------------------------------------------------

describe('SwarmCoordinator.runSwarm — parallel vs sequential', () => {
  it('runs workers sequentially when allowParallel is false', async () => {
    const coordinator = new SwarmCoordinator();
    const order: string[] = [];

    const swarm = coordinator.createSwarm(
      'implement',
      [makeManifest('task1'), makeManifest('task2'), makeManifest('task3')],
      { allowParallel: false },
    );

    await coordinator.runSwarm(swarm.id, async (manifest, _ctx) => {
      order.push(manifest.prompt);
      return { workerId: manifest.prompt, output: `done ${manifest.prompt}`, success: true };
    });

    expect(order).toEqual(['task1', 'task2', 'task3']);
    expect(coordinator.getSwarm(swarm.id)!.status).toBe('completed');
  });

  it('runs workers in parallel when allowParallel is true', async () => {
    const coordinator = new SwarmCoordinator();
    let concurrentCount = 0;
    let maxConcurrent = 0;

    const swarm = coordinator.createSwarm(
      'research',
      [makeManifest('A'), makeManifest('B'), makeManifest('C')],
      { allowParallel: true },
    );

    await coordinator.runSwarm(swarm.id, async (manifest, _ctx) => {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      await new Promise((r) => setTimeout(r, 10));
      concurrentCount--;
      return { workerId: manifest.prompt, output: `done ${manifest.prompt}`, success: true };
    });

    expect(maxConcurrent).toBeGreaterThan(1);
    const completedSwarm = coordinator.getSwarm(swarm.id)!;
    expect(completedSwarm.status).toBe('completed');
    expect(completedSwarm.results).toHaveLength(3);
  });

  it('records spawner errors as failed worker results without throwing', async () => {
    const coordinator = new SwarmCoordinator();
    const swarm = coordinator.createSwarm('implement', [makeManifest('failing-task')], {
      allowParallel: false,
    });

    const result = await coordinator.runSwarm(swarm.id, async () => {
      throw new Error('Spawner exploded');
    });

    expect(result.failureCount).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.swarm.status).toBe('completed');
  });

  it('injects swarm context into spawner calls', async () => {
    const coordinator = new SwarmCoordinator();
    const injectedContexts: string[] = [];

    const swarm = coordinator.createSwarm('implement', [makeManifest('task')], {
      sharedContext: 'Use TypeScript strict mode',
    });

    await coordinator.runSwarm(swarm.id, async (_manifest, ctx) => {
      injectedContexts.push(ctx);
      return { workerId: 'w1', output: 'done', success: true };
    });

    expect(injectedContexts[0]).toContain('Use TypeScript strict mode');
  });
});

// ---------------------------------------------------------------------------
// 10. Test protection — isTestFile / detectTestFileModification (OB-1786–1788)
// ---------------------------------------------------------------------------

describe('test protection helpers', () => {
  describe('isTestFile', () => {
    it('identifies files in tests/ directory as test files', () => {
      expect(isTestFile('tests/core/auth.test.ts')).toBe(true);
      expect(isTestFile('tests/memory/eviction.test.ts')).toBe(true);
    });

    it('identifies files in __tests__/ directory as test files', () => {
      expect(isTestFile('src/__tests__/helper.ts')).toBe(true);
      expect(isTestFile('__tests__/unit.ts')).toBe(true);
    });

    it('identifies *.test.ts, *.spec.ts, *.test.js, *.spec.js files as test files', () => {
      expect(isTestFile('src/core/auth.test.ts')).toBe(true);
      expect(isTestFile('router.spec.js')).toBe(true);
      expect(isTestFile('helper.test.js')).toBe(true);
      expect(isTestFile('eviction.spec.ts')).toBe(true);
    });

    it('does not flag regular source files as test files', () => {
      expect(isTestFile('src/core/auth.ts')).toBe(false);
      expect(isTestFile('src/memory/database.ts')).toBe(false);
      expect(isTestFile('package.json')).toBe(false);
    });

    it('does not flag files with "test" in name that do not match patterns', () => {
      expect(isTestFile('src/core/test-runner.ts')).toBe(false);
      expect(isTestFile('src/utils/testing-helpers.ts')).toBe(false);
    });
  });

  describe('detectTestFileModification', () => {
    it('filters test files from a mixed list', () => {
      const files = [
        'src/core/auth.ts',
        'tests/core/auth.test.ts',
        'src/memory/database.ts',
        'tests/memory/eviction.test.ts',
      ];
      expect(detectTestFileModification(files)).toEqual([
        'tests/core/auth.test.ts',
        'tests/memory/eviction.test.ts',
      ]);
    });

    it('returns empty array when no test files are in the list', () => {
      expect(detectTestFileModification(['src/a.ts', 'src/b.ts'])).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      expect(detectTestFileModification([])).toEqual([]);
    });

    it('returns all files when all are test files', () => {
      const files = ['tests/a.test.ts', 'tests/b.spec.ts'];
      expect(detectTestFileModification(files)).toEqual(files);
    });
  });
});

// ---------------------------------------------------------------------------
// 11. Iteration caps — countFixIterations (OB-1789)
// ---------------------------------------------------------------------------

describe('countFixIterations', () => {
  it('returns 0 for stdout with no fix iteration patterns', () => {
    expect(countFixIterations('All tests passed. Build succeeded.')).toBe(0);
  });

  it('counts npm run lint occurrences', () => {
    const stdout = 'npm run lint\nnpm run lint\n';
    expect(countFixIterations(stdout)).toBe(2);
  });

  it('counts npm run typecheck occurrences', () => {
    const stdout = 'npm run typecheck\nFix attempt 1\nnpm run typecheck\n';
    // 2 typechecks + 1 "Fix attempt" = 3
    expect(countFixIterations(stdout)).toBeGreaterThanOrEqual(2);
  });

  it('counts "Re-running tests" pattern', () => {
    const stdout = 'Re-running tests after fix\nRe-running tests after second fix\n';
    expect(countFixIterations(stdout)).toBe(2);
  });

  it('counts "Fix attempt N" patterns', () => {
    const stdout = 'Fix attempt 1\nFix attempt 2\nFix attempt 3\n';
    expect(countFixIterations(stdout)).toBe(3);
  });

  it('counts vitest run patterns', () => {
    const stdout = 'vitest run --reporter verbose\nvitest run again\n';
    expect(countFixIterations(stdout)).toBe(2);
  });

  it('default cap is 3', () => {
    expect(DEFAULT_MAX_FIX_ITERATIONS).toBe(3);
  });

  it('accumulates across multiple different patterns', () => {
    const stdout = [
      'npm run lint',
      'Attempting to fix eslint error',
      'npm run typecheck',
      'Re-running tests',
    ].join('\n');
    expect(countFixIterations(stdout)).toBeGreaterThanOrEqual(4);
  });

  it('FIX_ITERATION_PATTERNS is a non-empty array of regexes', () => {
    expect(Array.isArray(FIX_ITERATION_PATTERNS)).toBe(true);
    expect(FIX_ITERATION_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of FIX_ITERATION_PATTERNS) {
      expect(pattern).toBeInstanceOf(RegExp);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. Iteration caps — extractRemainingErrors (OB-1790)
// ---------------------------------------------------------------------------

describe('extractRemainingErrors', () => {
  it('returns empty array when no errors present', () => {
    const stdout = 'All tests passed. Build succeeded. 0 errors.';
    expect(extractRemainingErrors(stdout)).toEqual([]);
  });

  it('detects TypeScript errors (error TS####:)', () => {
    const stdout = 'src/core/auth.ts:42:5 - error TS2345: Argument of type ...';
    const errors = extractRemainingErrors(stdout);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('TS2345');
  });

  it('detects FAIL lines from Vitest/Jest', () => {
    const stdout = 'FAIL tests/core/auth.test.ts\n  ● auth › should return 401';
    const errors = extractRemainingErrors(stdout);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('detects test failure symbols (✕ ✗ ×)', () => {
    const stdout = '  ✕ should validate the token\n  ✗ should reject expired tokens';
    const errors = extractRemainingErrors(stdout);
    expect(errors.length).toBe(2);
  });

  it('deduplicates identical error lines', () => {
    const line = 'error TS2345: duplicate error message here';
    const stdout = `${line}\n${line}\n${line}`;
    const errors = extractRemainingErrors(stdout);
    // Deduplicated — should appear only once
    expect(errors.filter((e) => e.includes('TS2345'))).toHaveLength(1);
  });

  it('returns at most 10 errors even with many error lines', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `error TS${2000 + i}: error ${i}`);
    const stdout = lines.join('\n');
    const errors = extractRemainingErrors(stdout);
    expect(errors.length).toBeLessThanOrEqual(10);
  });

  it('scans only the last 3000 chars of very long stdout', () => {
    // Put benign content at the start (> 3000 chars) and errors at the end
    const prefix = 'x'.repeat(4000);
    const tail = 'error TS2304: Cannot find name "foo"';
    const errors = extractRemainingErrors(prefix + '\n' + tail);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain('TS2304');
  });

  it('truncates very long error lines to 200 chars', () => {
    const longLine = 'error TS2345: ' + 'A'.repeat(300);
    const errors = extractRemainingErrors(longLine);
    expect(errors.length).toBe(1);
    expect(errors[0]!.length).toBeLessThanOrEqual(200);
  });
});
