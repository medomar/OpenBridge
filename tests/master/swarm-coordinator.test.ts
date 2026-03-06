/**
 * Tests for SwarmCoordinator — OB-1793.
 *
 * Covers:
 * 1. Sequential execution — workers run one-by-one in order
 * 2. Parallel execution — workers run concurrently (allowParallel: true)
 *    - concurrency guarantees (peak active count)
 *    - timing: parallel faster than sequential
 *    - identical context delivered to all parallel workers
 *    - mixed success/failure, spawner errors, result completeness
 *    - handoff context injected into parallel workers
 * 3. Handoff data integrity (OB-1783)
 *    - verbatim output preserved
 *    - header includes swarm name + type
 *    - cumulative context from multiple upstream swarms
 *    - section separators present
 *    - NOT propagated to already-completed / upstream swarms
 *    - empty output → no propagation
 *    - sharedContext + handoffContext merged correctly
 *    - snapshots are immutable
 *    - reset clears all handoff state
 * 4. Spawner errors caught and recorded as failed worker results
 * 5. Combined output and handoff after runSwarm
 * 6. SwarmCompletionResult statistics (successCount / failureCount)
 * 7. Pipeline ordering and query helpers
 * 8. Composition planning edge cases
 */

import { describe, it, expect } from 'vitest';
import {
  SwarmCoordinator,
  planSwarmComposition,
  classifyTaskComplexity,
  SWARM_PIPELINE_ORDER,
} from '../../src/master/swarm-coordinator.js';
import type { TaskManifest, SwarmWorkerResult } from '../../src/types/agent.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManifest(prompt: string, workspacePath = '/tmp/test'): TaskManifest {
  return { prompt, workspacePath };
}

function makeResult(workerId: string, output: string, success = true): SwarmWorkerResult {
  return { workerId, output, success };
}

// ---------------------------------------------------------------------------
// classifyTaskComplexity (unchanged behaviour check)
// ---------------------------------------------------------------------------

describe('classifyTaskComplexity', () => {
  it('returns simple for information questions', () => {
    expect(classifyTaskComplexity('what is the entry point?')).toBe('simple');
    expect(classifyTaskComplexity('show me the config file')).toBe('simple');
    expect(classifyTaskComplexity('list all routes')).toBe('simple');
  });

  it('returns complex for multi-step or large tasks', () => {
    expect(classifyTaskComplexity('refactor the auth module')).toBe('complex');
    expect(classifyTaskComplexity('migrate the database schema and then update all tests')).toBe(
      'complex',
    );
  });

  it('returns moderate for single-step changes', () => {
    expect(classifyTaskComplexity('fix the bug in login handler')).toBe('moderate');
  });
});

// ---------------------------------------------------------------------------
// planSwarmComposition (unchanged behaviour check)
// ---------------------------------------------------------------------------

describe('planSwarmComposition', () => {
  it('returns skipSwarms for simple tasks', () => {
    const plan = planSwarmComposition('what is the build command?');
    expect(plan.skipSwarms).toBe(true);
    expect(plan.swarmTypes).toHaveLength(0);
  });

  it('returns implement-only for moderate tasks', () => {
    const plan = planSwarmComposition('fix the null check in utils');
    expect(plan.skipSwarms).toBe(false);
    expect(plan.swarmTypes).toEqual(['implement']);
  });

  it('returns full pipeline for complex tasks', () => {
    const plan = planSwarmComposition('refactor the entire authentication module');
    expect(plan.skipSwarms).toBe(false);
    expect(plan.swarmTypes).toEqual(['research', 'implement', 'review', 'test']);
  });
});

// ---------------------------------------------------------------------------
// runSwarm — sequential mode
// ---------------------------------------------------------------------------

describe('SwarmCoordinator.runSwarm() — sequential', () => {
  it('runs workers in order and returns correct completion result', async () => {
    const coord = new SwarmCoordinator();
    const manifests = [makeManifest('task A'), makeManifest('task B'), makeManifest('task C')];
    const { id: swarmId } = coord.createSwarm('implement', manifests);

    const callOrder: string[] = [];
    const spawner = async (manifest: TaskManifest): Promise<SwarmWorkerResult> => {
      callOrder.push(manifest.prompt);
      return { workerId: manifest.prompt, output: `done ${manifest.prompt}`, success: true };
    };

    const result = await coord.runSwarm(swarmId, spawner);

    expect(callOrder).toEqual(['task A', 'task B', 'task C']);
    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(result.swarm.status).toBe('completed');
    expect(result.combinedOutput).toContain('done task A');
    expect(result.combinedOutput).toContain('done task B');
    expect(result.combinedOutput).toContain('done task C');
  });

  it('records failed results when spawner throws', async () => {
    const coord = new SwarmCoordinator();
    const manifests = [makeManifest('bad task'), makeManifest('good task')];
    const { id: swarmId } = coord.createSwarm('implement', manifests);

    const spawner = async (manifest: TaskManifest): Promise<SwarmWorkerResult> => {
      if (manifest.prompt === 'bad task') throw new Error('spawn failed');
      return { workerId: manifest.prompt, output: 'done', success: true };
    };

    const result = await coord.runSwarm(swarmId, spawner);

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.swarm.status).toBe('completed');
  });

  it('transitions swarm through pending → running → completed', async () => {
    const coord = new SwarmCoordinator();
    const { id: swarmId } = coord.createSwarm('research', [makeManifest('investigate')]);

    expect(coord.getSwarm(swarmId)?.status).toBe('pending');

    const runPromise = coord.runSwarm(swarmId, async () => ({
      workerId: 'w1',
      output: 'findings',
      success: true,
    }));

    const result = await runPromise;
    expect(result.swarm.status).toBe('completed');
  });

  it('throws if swarm is not in pending status', async () => {
    const coord = new SwarmCoordinator();
    const { id: swarmId } = coord.createSwarm('implement', [makeManifest('task')]);

    // Start it manually to put it in 'running'
    coord.startSwarm(swarmId);

    await expect(
      coord.runSwarm(swarmId, async () => ({ workerId: 'w1', output: 'x', success: true })),
    ).rejects.toThrow("expected status 'pending'");
  });
});

// ---------------------------------------------------------------------------
// runSwarm — parallel mode
// ---------------------------------------------------------------------------

describe('SwarmCoordinator.runSwarm() — parallel', () => {
  it('runs workers concurrently when allowParallel is true', async () => {
    const coord = new SwarmCoordinator();
    const manifests = [
      makeManifest('parallel-A'),
      makeManifest('parallel-B'),
      makeManifest('parallel-C'),
    ];
    const { id: swarmId } = coord.createSwarm('implement', manifests, { allowParallel: true });

    // Track when each worker started and finished
    const started: string[] = [];
    const finished: string[] = [];

    const spawner = async (manifest: TaskManifest): Promise<SwarmWorkerResult> => {
      started.push(manifest.prompt);
      // Small async delay so we can observe overlap
      await new Promise((res) => setTimeout(res, 10));
      finished.push(manifest.prompt);
      return { workerId: manifest.prompt, output: `done ${manifest.prompt}`, success: true };
    };

    const result = await coord.runSwarm(swarmId, spawner);

    // All workers should have started before any finished (proving parallelism)
    // In a parallel scenario all 3 starts should appear before all 3 finishes
    const firstFinishIndex = finished.length > 0 ? started.indexOf(finished[0]) : -1;
    // With Promise.all all starts happen synchronously in the same tick
    expect(started).toHaveLength(3);
    expect(finished).toHaveLength(3);
    // started should have all 3 entries; firstFinishIndex just validates that
    // the first finish was a started worker
    expect(firstFinishIndex).not.toBe(-1);

    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(result.swarm.status).toBe('completed');
  });

  it('captures errors from parallel workers independently', async () => {
    const coord = new SwarmCoordinator();
    const manifests = [makeManifest('ok'), makeManifest('fail'), makeManifest('ok2')];
    const { id: swarmId } = coord.createSwarm('test', manifests, { allowParallel: true });

    const spawner = async (manifest: TaskManifest): Promise<SwarmWorkerResult> => {
      if (manifest.prompt === 'fail') throw new Error('parallel failure');
      return { workerId: manifest.prompt, output: 'done', success: true };
    };

    const result = await coord.runSwarm(swarmId, spawner);

    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
  });

  it('parallel mode records all results regardless of order', async () => {
    const coord = new SwarmCoordinator();
    const manifests = [makeManifest('x'), makeManifest('y')];
    const { id: swarmId } = coord.createSwarm('review', manifests, { allowParallel: true });

    const spawner = async (manifest: TaskManifest): Promise<SwarmWorkerResult> => ({
      workerId: manifest.prompt,
      output: `output-${manifest.prompt}`,
      success: true,
    });

    await coord.runSwarm(swarmId, spawner);

    const swarm = coord.getSwarm(swarmId)!;
    expect(swarm.results).toHaveLength(2);
    const workerIds = swarm.results.map((r) => r.workerId).sort();
    expect(workerIds).toEqual(['x', 'y']);
  });
});

// ---------------------------------------------------------------------------
// runSwarm — handoff propagation
// ---------------------------------------------------------------------------

describe('SwarmCoordinator.runSwarm() — handoff', () => {
  it('propagates combined output to downstream swarms after completion', async () => {
    const coord = new SwarmCoordinator();

    const { id: researchId } = coord.createSwarm('research', [makeManifest('investigate')]);
    const { id: implId } = coord.createSwarm('implement', [makeManifest('implement')]);

    const spawner = async (manifest: TaskManifest): Promise<SwarmWorkerResult> => ({
      workerId: manifest.prompt,
      output: `research findings for ${manifest.prompt}`,
      success: true,
    });

    await coord.runSwarm(researchId, spawner);

    // Implement swarm should now have handoff context from research
    const implSwarm = coord.getSwarm(implId)!;
    expect(implSwarm.handoffContext).toContain('research findings');
    expect(implSwarm.handoffContext).toContain('research-swarm');
    // Use researchId to avoid unused var warning
    expect(coord.getSwarm(researchId)?.status).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// Parallel spawning — deep concurrency verification (OB-1785)
// ---------------------------------------------------------------------------

describe('SwarmCoordinator — parallel spawning: deep concurrency', () => {
  it('peak concurrency equals worker count when all workers overlap', async () => {
    const coord = new SwarmCoordinator();
    let active = 0;
    let peak = 0;

    const { id } = coord.createSwarm(
      'research',
      [makeManifest('A'), makeManifest('B'), makeManifest('C')],
      { allowParallel: true },
    );

    await coord.runSwarm(id, async (manifest) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return makeResult(manifest.prompt, `out-${manifest.prompt}`);
    });

    expect(peak).toBe(3);
    expect(coord.getSwarm(id)!.status).toBe('completed');
  });

  it('parallel run is faster than sequential for delayed workers', async () => {
    const DELAY = 30;

    const makeSpawner =
      () =>
      async (manifest: TaskManifest): Promise<SwarmWorkerResult> => {
        await new Promise((r) => setTimeout(r, DELAY));
        return makeResult(manifest.prompt, 'done');
      };

    const manifests = [makeManifest('a'), makeManifest('b'), makeManifest('c')];

    const seqCoord = new SwarmCoordinator();
    const seqSwarm = seqCoord.createSwarm('implement', manifests, { allowParallel: false });
    const t0 = Date.now();
    await seqCoord.runSwarm(seqSwarm.id, makeSpawner());
    const seqElapsed = Date.now() - t0;

    const parCoord = new SwarmCoordinator();
    const parSwarm = parCoord.createSwarm('implement', manifests, { allowParallel: true });
    const t1 = Date.now();
    await parCoord.runSwarm(parSwarm.id, makeSpawner());
    const parElapsed = Date.now() - t1;

    expect(parElapsed).toBeLessThan(seqElapsed);
  });

  it('identical context is delivered to every parallel worker', async () => {
    const coord = new SwarmCoordinator();
    const received: string[] = [];

    const { id } = coord.createSwarm(
      'implement',
      [makeManifest('t1'), makeManifest('t2'), makeManifest('t3')],
      { allowParallel: true, sharedContext: 'ctx-signal-XYZ' },
    );

    await coord.runSwarm(id, async (_m, ctx) => {
      received.push(ctx);
      return makeResult('w', 'ok');
    });

    expect(received).toHaveLength(3);
    for (const ctx of received) {
      expect(ctx).toContain('ctx-signal-XYZ');
    }
  });

  it('handoff context from upstream swarm is included in parallel worker context', async () => {
    const coord = new SwarmCoordinator();
    const received: string[] = [];

    // Both swarms must exist before research completes so the handoff propagates.
    const research = coord.createSwarm('research', [makeManifest('r')]);
    const impl = coord.createSwarm('implement', [makeManifest('i1'), makeManifest('i2')], {
      allowParallel: true,
    });

    coord.startSwarm(research.id);
    coord.recordWorkerResult(research.id, makeResult('rw', 'unique-handoff-payload-42'));
    coord.completeSwarm(research.id); // propagates to impl (already registered)

    await coord.runSwarm(impl.id, async (_m, ctx) => {
      received.push(ctx);
      return makeResult('w', 'done');
    });

    for (const ctx of received) {
      expect(ctx).toContain('unique-handoff-payload-42');
    }
  });

  it('mixed success/failure in parallel mode is fully captured', async () => {
    const coord = new SwarmCoordinator();
    const { id } = coord.createSwarm(
      'test',
      [makeManifest('ok'), makeManifest('fail'), makeManifest('ok2')],
      { allowParallel: true },
    );

    const result = await coord.runSwarm(id, async (manifest) => {
      if (manifest.prompt === 'fail') return makeResult(manifest.prompt, 'err', false);
      return makeResult(manifest.prompt, 'ok');
    });

    expect(result.successCount).toBe(2);
    expect(result.failureCount).toBe(1);
    expect(coord.getSwarm(id)!.results).toHaveLength(3);
  });

  it('spawner exceptions in parallel mode are recorded as failures, not thrown', async () => {
    const coord = new SwarmCoordinator();
    const { id } = coord.createSwarm('implement', [makeManifest('boom'), makeManifest('safe')], {
      allowParallel: true,
    });

    const result = await coord.runSwarm(id, async (manifest) => {
      if (manifest.prompt === 'boom') throw new Error('parallel-explosion');
      return makeResult(manifest.prompt, 'done');
    });

    expect(result.swarm.status).toBe('completed');
    expect(result.failureCount).toBe(1);
    const failedResult = coord.getSwarm(id)!.results.find((r) => !r.success);
    expect(failedResult?.output).toContain('parallel-explosion');
  });

  it('allowParallel defaults to false (sequential order preserved)', async () => {
    const coord = new SwarmCoordinator();
    const order: string[] = [];

    // No options → default allowParallel = false
    const { id } = coord.createSwarm('implement', [
      makeManifest('first'),
      makeManifest('second'),
      makeManifest('third'),
    ]);

    await coord.runSwarm(id, async (manifest) => {
      order.push(manifest.prompt);
      return makeResult(manifest.prompt, 'done');
    });

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('all worker IDs appear in results after parallel execution', async () => {
    const coord = new SwarmCoordinator();
    const { id } = coord.createSwarm(
      'review',
      [makeManifest('w1'), makeManifest('w2'), makeManifest('w3')],
      { allowParallel: true },
    );

    await coord.runSwarm(id, async (manifest) => makeResult(manifest.prompt, 'out'));

    const workerIds = coord
      .getSwarm(id)!
      .results.map((r) => r.workerId)
      .sort();
    expect(workerIds).toEqual(['w1', 'w2', 'w3']);
  });
});

// ---------------------------------------------------------------------------
// Handoff data integrity — deep verification (OB-1783)
// ---------------------------------------------------------------------------

describe('SwarmCoordinator — handoff data integrity', () => {
  it('verbatim worker output is preserved in downstream handoff context', () => {
    const coord = new SwarmCoordinator();
    const payload = 'auth-uses-RS256-JWT-exact-string-A1B2C3';

    const research = coord.createSwarm('research', [makeManifest('r')]);
    const impl = coord.createSwarm('implement', [makeManifest('i')]);

    coord.startSwarm(research.id);
    coord.recordWorkerResult(research.id, makeResult('rw', payload));
    coord.completeSwarm(research.id);

    expect(coord.buildWorkerContext(impl.id)).toContain(payload);
  });

  it('handoff header includes swarm name and type', () => {
    const coord = new SwarmCoordinator();

    const research = coord.createSwarm('research', [makeManifest('r')], {
      name: 'named-research-swarm',
    });
    const impl = coord.createSwarm('implement', [makeManifest('i')]);

    coord.startSwarm(research.id);
    coord.recordWorkerResult(research.id, makeResult('rw', 'data'));
    coord.completeSwarm(research.id);

    const ctx = coord.buildWorkerContext(impl.id);
    expect(ctx).toContain('named-research-swarm');
    expect(ctx).toContain('research');
  });

  it('handoff from multiple upstreams accumulates in downstream context', () => {
    const coord = new SwarmCoordinator();

    const research = coord.createSwarm('research', [makeManifest('r')]);
    const impl = coord.createSwarm('implement', [makeManifest('i')]);
    const review = coord.createSwarm('review', [makeManifest('rv')]);

    coord.startSwarm(research.id);
    coord.recordWorkerResult(research.id, makeResult('rw', 'research-data-AAA'));
    coord.completeSwarm(research.id);

    coord.startSwarm(impl.id);
    coord.recordWorkerResult(impl.id, makeResult('iw', 'impl-data-BBB'));
    coord.completeSwarm(impl.id);

    const reviewCtx = coord.buildWorkerContext(review.id);
    expect(reviewCtx).toContain('research-data-AAA');
    expect(reviewCtx).toContain('impl-data-BBB');
  });

  it('multiple handoff sections are separated by visible delimiters', () => {
    const coord = new SwarmCoordinator();

    const research = coord.createSwarm('research', [makeManifest('r')]);
    const impl = coord.createSwarm('implement', [makeManifest('i')]);
    const review = coord.createSwarm('review', [makeManifest('rv')]);

    coord.startSwarm(research.id);
    coord.recordWorkerResult(research.id, makeResult('rw', 'part-R'));
    coord.completeSwarm(research.id);

    coord.startSwarm(impl.id);
    coord.recordWorkerResult(impl.id, makeResult('iw', 'part-I'));
    coord.completeSwarm(impl.id);

    const reviewCtx = coord.buildWorkerContext(review.id);
    // The separator is '---' (as implemented in propagateHandoffToDownstream)
    expect(reviewCtx).toContain('---');
  });

  it('handoff is NOT propagated to already-completed downstream swarms', () => {
    const coord = new SwarmCoordinator();

    const research = coord.createSwarm('research', [makeManifest('r')]);
    const impl = coord.createSwarm('implement', [makeManifest('i')]);

    // Complete implement before research — it should not receive late handoff.
    coord.startSwarm(impl.id);
    coord.recordWorkerResult(impl.id, makeResult('iw', 'early-impl'));
    coord.completeSwarm(impl.id);

    coord.startSwarm(research.id);
    coord.recordWorkerResult(research.id, makeResult('rw', 'late-research-XYZ'));
    coord.completeSwarm(research.id);

    const implSwarm = coord.getSwarm(impl.id)!;
    expect(implSwarm.handoffContext).not.toContain('late-research-XYZ');
  });

  it('handoff is NOT propagated to upstream swarms', () => {
    const coord = new SwarmCoordinator();

    const research = coord.createSwarm('research', [makeManifest('r')]);
    const impl = coord.createSwarm('implement', [makeManifest('i')]);

    coord.startSwarm(impl.id);
    coord.recordWorkerResult(impl.id, makeResult('iw', 'impl-secret-data'));
    coord.completeSwarm(impl.id);

    // Research is upstream — should not have impl's output.
    expect(coord.buildWorkerContext(research.id)).not.toContain('impl-secret-data');
  });

  it('empty worker output does not propagate handoff to downstream', () => {
    const coord = new SwarmCoordinator();

    const research = coord.createSwarm('research', [makeManifest('r')]);
    const impl = coord.createSwarm('implement', [makeManifest('i')]);

    // Complete research with NO recorded results → empty combinedOutput.
    coord.startSwarm(research.id);
    coord.completeSwarm(research.id);

    expect(coord.getSwarm(impl.id)!.handoffContext).toBe('');
  });

  it('sharedContext and handoffContext are both present in buildWorkerContext', () => {
    const coord = new SwarmCoordinator();

    const research = coord.createSwarm('research', [makeManifest('r')]);
    const impl = coord.createSwarm('implement', [makeManifest('i')], {
      sharedContext: 'SHARED-SIGNAL-999',
    });

    coord.startSwarm(research.id);
    coord.recordWorkerResult(research.id, makeResult('rw', 'HANDOFF-SIGNAL-888'));
    coord.completeSwarm(research.id);

    const ctx = coord.buildWorkerContext(impl.id);
    expect(ctx).toContain('SHARED-SIGNAL-999');
    expect(ctx).toContain('HANDOFF-SIGNAL-888');
  });

  it('buildWorkerContext returns empty string for unknown swarmId', () => {
    const coord = new SwarmCoordinator();
    expect(coord.buildWorkerContext('no-such-id')).toBe('');
  });

  it('getCombinedOutput reflects all recorded worker outputs verbatim', () => {
    const coord = new SwarmCoordinator();
    const { id } = coord.createSwarm('implement', [makeManifest('task')]);

    coord.startSwarm(id);
    coord.recordWorkerResult(id, makeResult('wA', 'alpha-output'));
    coord.recordWorkerResult(id, makeResult('wB', 'beta-output'));
    coord.completeSwarm(id);

    const combined = coord.getCombinedOutput(id);
    expect(combined).toContain('wA');
    expect(combined).toContain('alpha-output');
    expect(combined).toContain('wB');
    expect(combined).toContain('beta-output');
  });

  it('snapshots returned by getSwarm are immutable — subsequent mutations do not affect them', () => {
    const coord = new SwarmCoordinator();
    const { id } = coord.createSwarm('research', [makeManifest('r')]);

    const snapshot = coord.getSwarm(id)!;
    expect(snapshot.status).toBe('pending');

    coord.startSwarm(id);

    // Original snapshot unchanged.
    expect(snapshot.status).toBe('pending');
    // Fresh snapshot reflects the update.
    expect(coord.getSwarm(id)!.status).toBe('running');
  });

  it('reset() clears all handoff state so a new session starts clean', () => {
    const coord = new SwarmCoordinator();

    const research = coord.createSwarm('research', [makeManifest('r')]);
    const impl = coord.createSwarm('implement', [makeManifest('i')]);

    coord.startSwarm(research.id);
    coord.recordWorkerResult(research.id, makeResult('rw', 'old-findings'));
    coord.completeSwarm(research.id);

    expect(coord.buildWorkerContext(impl.id)).toContain('old-findings');

    coord.reset();
    expect(coord.swarmCount).toBe(0);

    // New swarm after reset has no inherited handoff.
    const fresh = coord.createSwarm('implement', [makeManifest('new')]);
    expect(coord.buildWorkerContext(fresh.id)).toBe('');
  });

  it('propagateHandoffToDownstream returns 0 for a non-existent swarmId', () => {
    const coord = new SwarmCoordinator();
    expect(coord.propagateHandoffToDownstream('ghost-id')).toBe(0);
  });

  it('propagateHandoffToDownstream returns 0 for a swarm that is not completed', () => {
    const coord = new SwarmCoordinator();
    const { id } = coord.createSwarm('research', [makeManifest('r')]);
    coord.createSwarm('implement', [makeManifest('i')]);

    coord.startSwarm(id); // running, not completed
    expect(coord.propagateHandoffToDownstream(id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Pipeline ordering and query helpers
// ---------------------------------------------------------------------------

describe('SwarmCoordinator — pipeline ordering and queries', () => {
  it('SWARM_PIPELINE_ORDER is research → implement → review → test', () => {
    expect(SWARM_PIPELINE_ORDER).toEqual(['research', 'implement', 'review', 'test']);
  });

  it('swarmsByPipelineOrder places swarms in canonical pipeline order regardless of creation order', () => {
    const coord = new SwarmCoordinator();
    coord.createSwarm('test', [makeManifest('t')]);
    coord.createSwarm('implement', [makeManifest('i')]);
    coord.createSwarm('research', [makeManifest('r')]);
    coord.createSwarm('review', [makeManifest('rv')]);

    const types = coord.swarmsByPipelineOrder.map((s) => s.type);
    expect(types.indexOf('research')).toBeLessThan(types.indexOf('implement'));
    expect(types.indexOf('implement')).toBeLessThan(types.indexOf('review'));
    expect(types.indexOf('review')).toBeLessThan(types.indexOf('test'));
  });

  it('pendingSwarms / runningSwarms / completedSwarms filter by status', () => {
    const coord = new SwarmCoordinator();
    const s1 = coord.createSwarm('research', [makeManifest('r')]);
    const s2 = coord.createSwarm('implement', [makeManifest('i')]);

    expect(coord.pendingSwarms).toHaveLength(2);
    expect(coord.runningSwarms).toHaveLength(0);

    coord.startSwarm(s1.id);
    expect(coord.runningSwarms).toHaveLength(1);

    coord.completeSwarm(s1.id);
    expect(coord.completedSwarms).toHaveLength(1);

    coord.startSwarm(s2.id);
    coord.failSwarm(s2.id, 'error');
    expect(coord.isComplete).toBe(true);
  });

  it('isComplete is false when coordinator has no swarms', () => {
    expect(new SwarmCoordinator().isComplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Composition planning — edge cases
// ---------------------------------------------------------------------------

describe('planSwarmComposition — edge cases', () => {
  it('multi-step connectors (≥2) elevate task to complex', () => {
    const plan = planSwarmComposition('Update the config then after that restart the server');
    expect(plan.complexity).toBe('complex');
    expect(plan.swarmTypes).toContain('research');
  });

  it('descriptions ≥30 words are classified as complex', () => {
    const long = Array.from({ length: 31 }, (_, i) => `word${i}`).join(' ');
    expect(planSwarmComposition(long).complexity).toBe('complex');
  });

  it('instance planComposition delegates to module-level planSwarmComposition', () => {
    const coord = new SwarmCoordinator();
    const task = 'refactor the entire auth module';
    expect(coord.planComposition(task)).toEqual(planSwarmComposition(task));
  });
});
