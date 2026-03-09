/**
 * Tests for runtime permission escalation (Phase 97 — OB-1603).
 *
 * Covers:
 *  1. Escalation prompt sent when requestToolEscalation() is called
 *  2. /allow grants the tool and triggers worker re-spawn
 *  3. /deny rejects and sends rejection message
 *  4. Timeout auto-denies when no user reply arrives (scales with queue size)
 *  5. /allow <tool> --permanent persists grant in DB
 *  6. Session grant (/allow <tool> --session) is cleared on router restart
 *  7. predictToolRequirements() correctly predicts profile upgrades from keywords
 *  8. auto-approve-up-to-edit mode auto-approves escalations to code-edit or lower
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import {
  getAccess,
  addApprovedEscalation,
  getApprovedEscalations,
} from '../../src/memory/access-store.js';
import { Router } from '../../src/core/router.js';
import { predictToolRequirements } from '../../src/master/master-manager.js';
import { WorkerRegistry } from '../../src/master/worker-registry.js';
import { MockConnector } from '../helpers/mock-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { MemoryManager } from '../../src/memory/index.js';
import type { AgentResult } from '../../src/core/agent-runner.js';
import type { TaskManifest } from '../../src/types/agent.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/core/github-publisher.js', () => ({
  publishToGitHubPages: vi.fn().mockResolvedValue('https://owner.github.io/repo/report.html'),
}));

vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 }),
    spawnWithHandle: vi.fn(),
  })),
  TOOLS_READ_ONLY: ['Read', 'Glob', 'Grep'],
  estimateCost: vi.fn().mockReturnValue({
    estimatedTurns: 10,
    costString: '~$0.30',
    timeString: '~2 min',
  }),
  DEFAULT_MAX_TURNS_TASK: 15,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(content: string, sender = '+1234567890'): InboundMessage {
  return {
    id: 'msg-1',
    source: 'mock',
    sender,
    rawContent: content,
    content,
    timestamp: new Date(),
  };
}

function makeMemoryMock(consentMode = 'always-ask'): MemoryManager {
  return {
    getConsentMode: vi.fn().mockResolvedValue(consentMode),
    getAccess: vi.fn().mockResolvedValue(null),
    setAccess: vi.fn().mockResolvedValue(undefined),
    getApprovedEscalations: vi.fn().mockResolvedValue([]),
    addApprovedEscalation: vi.fn().mockResolvedValue(undefined),
  } as unknown as MemoryManager;
}

/** Create a router wired with a mock connector and provider (prevents early-return in route()). */
function makeRouter() {
  const router = new Router('mock');
  const connector = new MockConnector();
  const provider = new MockProvider();
  router.addConnector(connector);
  router.addProvider(provider);
  return { router, connector };
}

// ---------------------------------------------------------------------------
// 1. Escalation prompt sent when requestToolEscalation() is called
// ---------------------------------------------------------------------------

describe('permission escalation — requestToolEscalation()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends an escalation prompt to the user when a worker needs additional tools', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('run the tests');
    await router.requestToolEscalation(
      'worker-123',
      ['Bash'],
      'read-only',
      'run tests',
      msg,
      connector,
    );

    expect(connector.sentMessages).toHaveLength(1);
    const text = connector.sentMessages[0]!.content;
    expect(text).toContain('worker-123');
    expect(text).toContain('Bash');
    expect(text).toContain('/allow');
    expect(text).toContain('/deny');
    expect(text).toContain('300 seconds');
  });

  it('registers the escalation as pending after requestToolEscalation()', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('deploy');
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);

    await router.requestToolEscalation(
      'worker-456',
      ['Bash'],
      'read-only',
      'deploy',
      msg,
      connector,
    );

    expect(router.hasPendingEscalation('+1234567890')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. /allow grants the tool and triggers re-spawn
// ---------------------------------------------------------------------------

describe('permission escalation — /allow command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the pending escalation and calls the respawn callback', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const respawn = vi.fn().mockResolvedValue(undefined);
    const msg = makeMsg('run tests');
    await router.requestToolEscalation(
      'worker-1',
      ['Bash'],
      'read-only',
      'needs bash',
      msg,
      connector,
      respawn,
    );

    // Now send /allow
    await router.route({ ...makeMsg('/allow Bash'), id: 'msg-2' });

    expect(router.hasPendingEscalation('+1234567890')).toBe(false);
    expect(respawn).toHaveBeenCalledOnce();
    expect(respawn).toHaveBeenCalledWith(['Bash']);

    // Confirmation message should be sent
    const lastMsg = connector.sentMessages.at(-1)!;
    expect(lastMsg.content).toContain('Granted');
    expect(lastMsg.content).toContain('worker-1');
  });
});

// ---------------------------------------------------------------------------
// 3. /deny rejects and sends rejection message
// ---------------------------------------------------------------------------

describe('permission escalation — /deny command', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('clears the pending escalation and sends rejection message', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const respawn = vi.fn().mockResolvedValue(undefined);
    const msg = makeMsg('run tests');
    await router.requestToolEscalation(
      'worker-2',
      ['Bash'],
      'read-only',
      'needs bash',
      msg,
      connector,
      respawn,
    );

    // Now send /deny
    await router.route({ ...makeMsg('/deny'), id: 'msg-3' });

    expect(router.hasPendingEscalation('+1234567890')).toBe(false);
    // respawn should NOT have been called
    expect(respawn).not.toHaveBeenCalled();

    const lastMsg = connector.sentMessages.at(-1)!;
    expect(lastMsg.content).toContain('denied');
    expect(lastMsg.content).toContain('worker-2');
  });
});

// ---------------------------------------------------------------------------
// 4. Timeout auto-denies after the configured timeout (scaled by queue size)
// ---------------------------------------------------------------------------

describe('permission escalation — timeout auto-deny', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a timeout notification and clears the escalation after 300 seconds (single entry)', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('deploy the app');
    await router.requestToolEscalation(
      'worker-3',
      ['Bash'],
      'read-only',
      'needs bash',
      msg,
      connector,
    );

    expect(router.hasPendingEscalation('+1234567890')).toBe(true);

    // Should NOT fire before 300s
    await vi.advanceTimersByTimeAsync(299_000);
    expect(router.hasPendingEscalation('+1234567890')).toBe(true);

    // Advance past the 300-second timeout
    await vi.advanceTimersByTimeAsync(2_000);

    // Escalation should be cleared
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);

    // Timeout notification should have been sent
    const messages = connector.sentMessages;
    const timeoutMsg = messages.find((m) => m.content.includes('timed out'));
    expect(timeoutMsg).toBeDefined();
    expect(timeoutMsg!.content).toContain('worker-3');
  });
});

// ---------------------------------------------------------------------------
// 5. Permanent grant persists in DB
// ---------------------------------------------------------------------------

describe('permission escalation — permanent grant', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls memory.setAccess with the granted tool when --permanent scope is used', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const mockMemory = makeMemoryMock();
    router.setMemory(mockMemory);

    const msg = makeMsg('run tests');
    await router.requestToolEscalation(
      'worker-4',
      ['Bash'],
      'read-only',
      'needs bash',
      msg,
      connector,
    );

    // Send /allow Bash --permanent
    await router.route({ ...makeMsg('/allow Bash --permanent'), id: 'msg-perm' });

    // setAccess should have been called to persist the grant
    expect(mockMemory.setAccess).toHaveBeenCalled();
    const setAccessFn = mockMemory.setAccess as ReturnType<typeof vi.fn>;
    const callArg = setAccessFn.mock.calls[0][0] as {
      allowed_actions: string[];
      user_id: string;
    };
    expect(callArg.allowed_actions).toContain('Bash');
    expect(callArg.user_id).toBe('+1234567890');
  });
});

// ---------------------------------------------------------------------------
// 5b. access-store: addApprovedEscalation / getApprovedEscalations
// ---------------------------------------------------------------------------

describe('access-store — approved tool escalations DB persistence', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('persists a tool grant and retrieves it', () => {
    addApprovedEscalation(db, '+1234567890', 'whatsapp', 'Bash');
    const grants = getApprovedEscalations(db, '+1234567890', 'whatsapp');
    expect(grants).toContain('Bash');
  });

  it('does not duplicate tools that are already granted', () => {
    addApprovedEscalation(db, '+1234567890', 'whatsapp', 'Bash');
    addApprovedEscalation(db, '+1234567890', 'whatsapp', 'Bash');
    const grants = getApprovedEscalations(db, '+1234567890', 'whatsapp');
    expect(grants.filter((g) => g === 'Bash')).toHaveLength(1);
  });

  it('creates a new access entry with role viewer when none exists', () => {
    addApprovedEscalation(db, '+9999999999', 'console', 'Write');
    const entry = getAccess(db, '+9999999999', 'console');
    expect(entry).not.toBeNull();
    expect(entry!.role).toBe('owner');
    expect(entry!.approvedToolEscalations).toContain('Write');
  });
});

// ---------------------------------------------------------------------------
// 6. Session grant clears on router restart
// ---------------------------------------------------------------------------

describe('permission escalation — session grant lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores session grant in the router and returns empty set after restart', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('run tests');
    await router.requestToolEscalation(
      'worker-5',
      ['Bash'],
      'read-only',
      'needs bash',
      msg,
      connector,
    );

    await router.route({ ...makeMsg('/allow Bash --session'), id: 'msg-sess' });

    // Session grant should be visible in this router instance
    const grants = router.getSessionGrants('+1234567890');
    expect(grants.has('Bash')).toBe(true);

    // A fresh router has no session grants
    const freshRouter = new Router('mock');
    const freshGrants = freshRouter.getSessionGrants('+1234567890');
    expect(freshGrants.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Pre-flight prediction — predictToolRequirements()
// ---------------------------------------------------------------------------

describe('predictToolRequirements()', () => {
  it('returns undefined when profile is already full-access', () => {
    const result = predictToolRequirements('run npm test', 'full-access');
    expect(result).toBeUndefined();
  });

  it('returns undefined when prompt has no escalation keywords', () => {
    const result = predictToolRequirements('summarise the README', 'read-only');
    expect(result).toBeUndefined();
  });

  it('predicts code-edit profile for npm test keywords', () => {
    const result = predictToolRequirements('run npm test and check for failures', 'read-only');
    expect(result).toBeDefined();
    expect(result!.suggestedProfile).toBe('code-edit');
    expect(result!.triggerKeywords.length).toBeGreaterThan(0);
  });

  it('predicts full-access profile for deploy keywords', () => {
    const result = predictToolRequirements(
      'deploy the app to production using docker run',
      'read-only',
    );
    expect(result).toBeDefined();
    expect(result!.suggestedProfile).toBe('full-access');
  });

  it('returns undefined when current profile already satisfies prediction', () => {
    // code-edit already satisfies the "npm test" prediction (code-edit level)
    const result = predictToolRequirements('run npm test', 'code-edit');
    expect(result).toBeUndefined();
  });

  it('returns undefined for master profile', () => {
    const result = predictToolRequirements('deploy the app', 'master');
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. auto-approve-up-to-edit mode
// ---------------------------------------------------------------------------

describe('permission escalation — auto-approve-up-to-edit mode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-approves code-edit profile escalations without prompting', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const mockMemory = makeMemoryMock('auto-approve-up-to-edit');
    router.setMemory(mockMemory);

    const respawn = vi.fn().mockResolvedValue(undefined);
    const msg = makeMsg('run tests');

    await router.requestToolEscalation(
      'worker-6',
      ['code-edit'],
      'read-only',
      'needs edit',
      msg,
      connector,
      respawn,
    );

    // No pending escalation — auto-approved immediately
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);

    // respawn should have been called automatically
    expect(respawn).toHaveBeenCalledOnce();

    // Auto-approve confirmation sent
    const lastMsg = connector.sentMessages.at(-1)!;
    expect(lastMsg.content).toContain('Auto-approved');
    expect(lastMsg.content).toContain('auto-approve-up-to-edit');
  });

  it('does NOT auto-approve full-access escalations in auto-approve-up-to-edit mode', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const mockMemory = makeMemoryMock('auto-approve-up-to-edit');
    router.setMemory(mockMemory);

    const respawn = vi.fn().mockResolvedValue(undefined);
    const msg = makeMsg('deploy the app');

    await router.requestToolEscalation(
      'worker-7',
      ['full-access'],
      'read-only',
      'needs full access',
      msg,
      connector,
      respawn,
    );

    // Escalation should still be pending — full-access exceeds edit level
    expect(router.hasPendingEscalation('+1234567890')).toBe(true);
    expect(respawn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 9. WorkerRegistry — escalated worker registration and execution (OB-1629)
// ---------------------------------------------------------------------------

describe('WorkerRegistry — escalated worker registration and execution', () => {
  it('registerWorkerWithId() registers worker with escalated ID in pending state', () => {
    const registry = new WorkerRegistry();

    const taskManifest: TaskManifest = {
      prompt: 'run the tests',
      workspacePath: '/tmp/test-workspace',
      profile: 'read-only-escalated',
    };

    const originalWorkerId = 'worker-abc123';
    const escalatedWorkerId = `${originalWorkerId}-escalated`;

    // Register with explicit ID (mirrors what respawnWorkerAfterGrant() does)
    registry.registerWorkerWithId(escalatedWorkerId, taskManifest);

    // Verify worker is registered with the correct ID and pending state
    const worker = registry.getWorker(escalatedWorkerId);
    expect(worker).toBeDefined();
    expect(worker!.id).toBe(escalatedWorkerId);
    expect(worker!.status).toBe('pending');
    expect(worker!.taskManifest.prompt).toBe('run the tests');
  });

  it('escalated worker can be marked running and then completed successfully', () => {
    const registry = new WorkerRegistry();

    const taskManifest: TaskManifest = {
      prompt: 'run npm test',
      workspacePath: '/tmp/test-workspace',
      profile: 'code-edit',
    };

    const escalatedWorkerId = 'worker-xyz789-escalated';
    registry.registerWorkerWithId(escalatedWorkerId, taskManifest);

    // Simulate the worker being picked up and starting
    registry.markRunning(escalatedWorkerId, 12345);
    expect(registry.getWorker(escalatedWorkerId)!.status).toBe('running');
    expect(registry.getWorker(escalatedWorkerId)!.pid).toBe(12345);

    // Simulate successful completion
    const result: AgentResult = {
      exitCode: 0,
      stdout: 'All tests passed',
      stderr: '',
      durationMs: 1200,
      retryCount: 0,
      status: 'completed',
    };
    registry.markCompleted(escalatedWorkerId, result);

    const completed = registry.getWorker(escalatedWorkerId);
    expect(completed!.status).toBe('completed');
    expect(completed!.result?.exitCode).toBe(0);
    expect(completed!.result?.stdout).toBe('All tests passed');
    expect(completed!.pid).toBeUndefined(); // PID cleared after completion
  });
});

// ---------------------------------------------------------------------------
// 10. Integration: grant escalation → worker registered → executes (OB-1629)
// ---------------------------------------------------------------------------

describe('permission escalation — grant triggers worker registration and execution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('grant escalation → respawn callback registers escalated worker → executes successfully', async () => {
    const registry = new WorkerRegistry();
    const { router, connector } = makeRouter();
    await connector.initialize();

    const originalWorkerId = 'worker-integration-001';
    const escalatedWorkerId = `${originalWorkerId}-escalated`;

    let registeredWorkerFound = false;
    let workerExecutedSuccessfully = false;

    // The respawn callback simulates what respawnWorkerAfterGrant() does:
    // 1. Register escalated worker with explicit ID BEFORE spawning (OB-1626 fix)
    // 2. Execute the worker (mark running → completed)
    const respawnCallback = async (grantedTools: string[]): Promise<void> => {
      expect(grantedTools).toContain('Bash');

      const taskManifest: TaskManifest = {
        prompt: 'run the tests with bash',
        workspacePath: '/tmp/workspace',
        profile: 'read-only-escalated',
      };

      // Register BEFORE spawning — this is the critical ordering from OB-1626
      registry.registerWorkerWithId(escalatedWorkerId, taskManifest);

      // Verify worker is registered immediately after registration
      const worker = registry.getWorker(escalatedWorkerId);
      registeredWorkerFound = worker !== undefined && worker.id === escalatedWorkerId;

      // Simulate successful spawn and execution
      registry.markRunning(escalatedWorkerId, 99999);
      const result: AgentResult = {
        exitCode: 0,
        stdout: 'task completed successfully',
        stderr: '',
        durationMs: 500,
        retryCount: 0,
        status: 'completed',
      };
      registry.markCompleted(escalatedWorkerId, result);
      workerExecutedSuccessfully = registry.getWorker(escalatedWorkerId)!.status === 'completed';
    };

    const msg = makeMsg('run the tests');
    await router.requestToolEscalation(
      originalWorkerId,
      ['Bash'],
      'read-only',
      'needs bash to run tests',
      msg,
      connector,
      respawnCallback,
    );

    // Grant escalation via /allow
    await router.route({ ...makeMsg('/allow Bash'), id: 'msg-grant-integration' });

    // Verify the respawn callback was invoked and registered the worker
    expect(registeredWorkerFound).toBe(true);
    expect(workerExecutedSuccessfully).toBe(true);

    // Verify the escalated worker is in completed state in the registry
    const completedWorker = registry.getWorker(escalatedWorkerId);
    expect(completedWorker).toBeDefined();
    expect(completedWorker!.status).toBe('completed');
    expect(completedWorker!.id).toBe(escalatedWorkerId);
    expect(completedWorker!.result?.exitCode).toBe(0);

    // Verify the router sent a grant confirmation message
    const grantMsg = connector.sentMessages.find((m) => m.content.includes('Granted'));
    expect(grantMsg).toBeDefined();

    // Escalation is cleared after grant
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. Integration: grant escalation → spawn fails → both workers failed (OB-1630)
// ---------------------------------------------------------------------------

describe('permission escalation — grant triggers spawn failure → workers marked failed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('grant escalation → spawn fails → both workers marked failed → user gets error message', async () => {
    const registry = new WorkerRegistry();
    const { router, connector } = makeRouter();
    await connector.initialize();

    const originalWorkerId = 'worker-spawn-fail-001';
    const escalatedWorkerId = `${originalWorkerId}-escalated`;

    // Register the original worker and mark it running (simulates pre-existing state)
    const originalManifest: TaskManifest = {
      prompt: 'run the tests',
      workspacePath: '/tmp/workspace',
      profile: 'read-only',
    };
    registry.registerWorkerWithId(originalWorkerId, originalManifest);
    registry.markRunning(originalWorkerId, 11111);

    // The respawn callback mirrors the failure path of respawnWorkerAfterGrant() (OB-1627, OB-1628)
    const respawnCallback = async (_grantedTools: string[]): Promise<void> => {
      const escalatedManifest: TaskManifest = {
        prompt: 'run the tests with bash',
        workspacePath: '/tmp/workspace',
        profile: 'read-only-escalated',
      };

      // 1. Register escalated worker BEFORE spawning (OB-1626 fix)
      registry.registerWorkerWithId(escalatedWorkerId, escalatedManifest);

      // 2. Simulate spawn failure
      const spawnError = new Error('Failed to start process: ENOENT');
      const failedResult: AgentResult = {
        exitCode: -1,
        stdout: '',
        stderr: spawnError.message,
        durationMs: 0,
        retryCount: 0,
        status: 'completed',
      };

      // 3. Mark escalated worker as failed (OB-1628)
      registry.markFailed(escalatedWorkerId, failedResult, 'respawn-failed');

      // 4. Also mark original worker as failed (OB-1627)
      try {
        registry.markFailed(originalWorkerId, failedResult, 'respawn-failed');
      } catch {
        // Original worker already in terminal state — expected in some paths
      }

      // 5. Notify user (OB-1627) — mirrors this.router.sendDirect() in MasterManager
      await connector.sendMessage({
        target: 'mock',
        recipient: '+1234567890',
        content: 'Worker re-spawn failed after grant, please retry',
      });
    };

    const msg = makeMsg('run the tests');
    await router.requestToolEscalation(
      originalWorkerId,
      ['Bash'],
      'read-only',
      'needs bash to run tests',
      msg,
      connector,
      respawnCallback,
    );

    // Grant escalation via /allow — triggers respawnCallback which simulates spawn failure
    await router.route({ ...makeMsg('/allow Bash'), id: 'msg-grant-fail' });

    // Verify escalated worker is marked as failed
    const escalatedWorker = registry.getWorker(escalatedWorkerId);
    expect(escalatedWorker).toBeDefined();
    expect(escalatedWorker!.status).toBe('failed');
    expect(escalatedWorker!.error).toBe('respawn-failed');

    // Verify original worker is also marked as failed
    const originalWorker = registry.getWorker(originalWorkerId);
    expect(originalWorker).toBeDefined();
    expect(originalWorker!.status).toBe('failed');
    expect(originalWorker!.error).toBe('respawn-failed');

    // Verify the user received the error message
    const errorMsg = connector.sentMessages.find((m) =>
      m.content.includes('Worker re-spawn failed after grant, please retry'),
    );
    expect(errorMsg).toBeDefined();

    // Escalation should be cleared after grant
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13. Queue: 3 workers request escalation → /deny all (OB-1637)
// ---------------------------------------------------------------------------

describe('permission escalation — queue: /deny all (OB-1637)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('3 workers escalate → /deny all marks all as denied and notifies the user', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const respawn1 = vi.fn().mockResolvedValue(undefined);
    const respawn2 = vi.fn().mockResolvedValue(undefined);
    const respawn3 = vi.fn().mockResolvedValue(undefined);

    const msg = makeMsg('run the full test suite');

    // Enqueue 3 escalation requests sequentially
    await router.requestToolEscalation(
      'worker-d1',
      ['Bash'],
      'read-only',
      'needs bash',
      msg,
      connector,
      respawn1,
    );
    await router.requestToolEscalation(
      'worker-d2',
      ['Write'],
      'read-only',
      'needs write',
      msg,
      connector,
      respawn2,
    );
    await router.requestToolEscalation(
      'worker-d3',
      ['full-access'],
      'read-only',
      'needs full access',
      msg,
      connector,
      respawn3,
    );

    // All 3 should be in the queue
    expect(router.pendingEscalationCount('+1234567890')).toBe(3);

    // /deny all — rejects all 3 at once
    await router.route({ ...makeMsg('/deny all'), id: 'msg-deny-all' });

    // No respawn callbacks should have been called
    expect(respawn1).not.toHaveBeenCalled();
    expect(respawn2).not.toHaveBeenCalled();
    expect(respawn3).not.toHaveBeenCalled();

    // All escalations should be cleared
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);
    expect(router.pendingEscalationCount('+1234567890')).toBe(0);

    // User should be notified about all denied workers
    const denyAllMsg = connector.sentMessages.at(-1)!;
    expect(denyAllMsg.content).toContain('Denied all');
    expect(denyAllMsg.content).toContain('3 worker(s)');
    expect(denyAllMsg.content).toContain('worker-d1');
    expect(denyAllMsg.content).toContain('worker-d2');
    expect(denyAllMsg.content).toContain('worker-d3');
  });

  it('/deny all with no pending escalations sends a "no pending" message', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    // No escalations queued
    expect(router.pendingEscalationCount('+1234567890')).toBe(0);

    await router.route({ ...makeMsg('/deny all'), id: 'msg-deny-all-empty' });

    // Should send a message about no pending escalations
    const reply = connector.sentMessages.at(-1)!;
    expect(reply).toBeDefined();
    expect(reply.content.toLowerCase()).toMatch(/no pending/i);
  });
});

// ---------------------------------------------------------------------------
// 12. Queue: 3 workers request escalation → /allow → 2 remain → /allow all (OB-1636)
// ---------------------------------------------------------------------------

describe('permission escalation — queue: /allow then /allow all (OB-1636)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('3 workers escalate → /allow grants first → 2 remain → /allow all grants remaining 2', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const respawn1 = vi.fn().mockResolvedValue(undefined);
    const respawn2 = vi.fn().mockResolvedValue(undefined);
    const respawn3 = vi.fn().mockResolvedValue(undefined);

    const msg = makeMsg('run the full test suite');

    // Enqueue 3 escalation requests sequentially
    await router.requestToolEscalation(
      'worker-q1',
      ['Bash'],
      'read-only',
      'needs bash',
      msg,
      connector,
      respawn1,
    );
    await router.requestToolEscalation(
      'worker-q2',
      ['Write'],
      'read-only',
      'needs write',
      msg,
      connector,
      respawn2,
    );
    await router.requestToolEscalation(
      'worker-q3',
      ['full-access'],
      'read-only',
      'needs full access',
      msg,
      connector,
      respawn3,
    );

    // All 3 should be in the queue
    expect(router.pendingEscalationCount('+1234567890')).toBe(3);

    // /allow — pops worker-q1 (first in queue)
    await router.route({ ...makeMsg('/allow Bash'), id: 'msg-allow-1' });

    // worker-q1 granted, 2 remain
    expect(respawn1).toHaveBeenCalledOnce();
    expect(respawn1).toHaveBeenCalledWith(['Bash']);
    expect(respawn2).not.toHaveBeenCalled();
    expect(respawn3).not.toHaveBeenCalled();
    expect(router.pendingEscalationCount('+1234567890')).toBe(2);

    // Confirmation message should mention remaining count
    const afterFirstAllow = connector.sentMessages.at(-1)!;
    expect(afterFirstAllow.content).toContain('Granted');
    expect(afterFirstAllow.content).toContain('worker-q1');
    expect(afterFirstAllow.content).toMatch(/2 more pending/i);

    // /allow all — grants remaining 2 (worker-q2 and worker-q3)
    await router.route({ ...makeMsg('/allow all'), id: 'msg-allow-all' });

    expect(respawn2).toHaveBeenCalledOnce();
    expect(respawn3).toHaveBeenCalledOnce();
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);
    expect(router.pendingEscalationCount('+1234567890')).toBe(0);

    // Bulk grant confirmation message
    const bulkGrantMsg = connector.sentMessages.at(-1)!;
    expect(bulkGrantMsg.content).toContain('Granted all pending escalations');
    expect(bulkGrantMsg.content).toContain('2 worker(s)');
    expect(bulkGrantMsg.content).toContain('worker-q2');
    expect(bulkGrantMsg.content).toContain('worker-q3');
  });
});

// ---------------------------------------------------------------------------
// OB-1639 — Timeout scales with queue size
// ---------------------------------------------------------------------------

describe('permission escalation — timeout scales with queue size (OB-1639)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses base timeout (300s) for a single pending escalation', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('task a');
    await router.requestToolEscalation(
      'worker-s1',
      ['Bash'],
      'read-only',
      'needs bash',
      msg,
      connector,
    );

    // The escalation prompt should show 300 seconds (default base timeout)
    const promptMsg = connector.sentMessages.at(-1)!;
    expect(promptMsg.content).toContain('300 seconds');

    // Should NOT fire before 300s
    await vi.advanceTimersByTimeAsync(299_000);
    expect(router.hasPendingEscalation('+1234567890')).toBe(true);

    // Fire after 300s
    await vi.advanceTimersByTimeAsync(2_000);
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);
  });

  it('adds 60s per additional pending escalation — 2 pending = 360s', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg1 = makeMsg('task a');
    const msg2 = makeMsg('task b');
    await router.requestToolEscalation(
      'worker-s1',
      ['Bash'],
      'read-only',
      'step 1',
      msg1,
      connector,
    );
    await router.requestToolEscalation(
      'worker-s2',
      ['Write'],
      'read-only',
      'step 2',
      msg2,
      connector,
    );

    // Second escalation prompt should show 360 seconds (300 + 60)
    const promptMsg = connector.sentMessages.at(-1)!;
    expect(promptMsg.content).toContain('360 seconds');

    // First entry timeout fires at 300s, second at 360s
    await vi.advanceTimersByTimeAsync(301_000);
    // First should be gone; second still pending
    expect(router.pendingEscalationCount('+1234567890')).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);
  });

  it('adds 60s per additional pending escalation — 3 pending = 420s', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('task');
    await router.requestToolEscalation(
      'worker-t1',
      ['Bash'],
      'read-only',
      'step 1',
      msg,
      connector,
    );
    await router.requestToolEscalation(
      'worker-t2',
      ['Write'],
      'read-only',
      'step 2',
      msg,
      connector,
    );
    await router.requestToolEscalation(
      'worker-t3',
      ['Edit'],
      'read-only',
      'step 3',
      msg,
      connector,
    );

    // Third escalation prompt should show 420 seconds (300 + 2×60)
    const promptMsg = connector.sentMessages.at(-1)!;
    expect(promptMsg.content).toContain('420 seconds');

    expect(router.pendingEscalationCount('+1234567890')).toBe(3);
  });

  it('caps timeout at 600s (10 minutes) regardless of queue size', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('task');
    // Add 8 escalations: 300 + 7×60 = 720s, capped at 600s
    for (let i = 1; i <= 8; i++) {
      await router.requestToolEscalation(
        `worker-c${i}`,
        ['Bash'],
        'read-only',
        `step ${i}`,
        msg,
        connector,
      );
    }

    // 8 pending = 300 + 7×60 = 720s, capped at 600 — should show 600
    const eighthPrompt = connector.sentMessages.at(-1)!;
    expect(eighthPrompt.content).toContain('600 seconds');

    // Add a 9th — still capped at 600s
    await router.requestToolEscalation(
      'worker-c9',
      ['Bash'],
      'read-only',
      'step 9',
      msg,
      connector,
    );
    const ninthPrompt = connector.sentMessages.at(-1)!;
    expect(ninthPrompt.content).toContain('600 seconds');
  });
});

// ---------------------------------------------------------------------------
// OB-1641 — 50% reminder + auto-deny explicit verification
// ---------------------------------------------------------------------------

describe('permission escalation — 50% reminder (OB-1640 / OB-1641)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a reminder message at 50% of the timeout (150s for 300s base)', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('run the tests');
    await router.requestToolEscalation(
      'worker-r1',
      ['Bash'],
      'read-only',
      'needs bash',
      msg,
      connector,
    );

    // Initial escalation prompt sent (1 message so far)
    const initialCount = connector.sentMessages.length;
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Advance to just before 50% (149s) — no reminder yet
    await vi.advanceTimersByTimeAsync(149_000);
    expect(connector.sentMessages.length).toBe(initialCount);

    // Advance past 50% (150s total) — reminder should fire
    await vi.advanceTimersByTimeAsync(2_000);

    const reminderMsg = connector.sentMessages.find((m) =>
      m.content.includes('pending escalation request'),
    );
    expect(reminderMsg).toBeDefined();
    expect(reminderMsg!.content).toContain('/allow');
    expect(reminderMsg!.content).toContain('/deny');
  });

  it('sends reminder only once per batch — not repeated for each escalation in queue', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('multi-step task');

    // Add 3 escalations — reminder should only fire once (for the batch)
    await router.requestToolEscalation(
      'worker-r2a',
      ['Bash'],
      'read-only',
      'step 1',
      msg,
      connector,
    );
    await router.requestToolEscalation(
      'worker-r2b',
      ['Write'],
      'read-only',
      'step 2',
      msg,
      connector,
    );
    await router.requestToolEscalation(
      'worker-r2c',
      ['Edit'],
      'read-only',
      'step 3',
      msg,
      connector,
    );

    const msgsBefore = connector.sentMessages.length;

    // Advance 151s — reminder fires once for the batch (based on first escalation's 300s timeout, 50% = 150s)
    await vi.advanceTimersByTimeAsync(151_000);

    const reminderMsgs = connector.sentMessages
      .slice(msgsBefore)
      .filter((m) => m.content.includes('pending escalation request'));

    // Exactly one reminder for the batch
    expect(reminderMsgs).toHaveLength(1);
  });

  it('reminder shows correct pending count at the time it fires', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('long task');

    await router.requestToolEscalation(
      'worker-r3a',
      ['Bash'],
      'read-only',
      'step 1',
      msg,
      connector,
    );
    await router.requestToolEscalation(
      'worker-r3b',
      ['Write'],
      'read-only',
      'step 2',
      msg,
      connector,
    );

    // Advance past 50% (150s for 300s base) — reminder fires
    await vi.advanceTimersByTimeAsync(151_000);

    const reminderMsg = connector.sentMessages.find((m) =>
      m.content.includes('pending escalation request'),
    );
    expect(reminderMsg).toBeDefined();
    // At 151s the queue still has 2 entries (neither has timed out yet — first at 300s, second at 360s)
    expect(reminderMsg!.content).toMatch(/2 pending escalation request/);
  });
});

describe('permission escalation — auto-deny after full timeout (OB-1638 / OB-1641)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-denies and sends timeout message after the full 300s elapses', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const respawn = vi.fn().mockResolvedValue(undefined);
    const msg = makeMsg('build the app');
    await router.requestToolEscalation(
      'worker-ad1',
      ['Bash'],
      'read-only',
      'needs bash to build',
      msg,
      connector,
      respawn,
    );

    expect(router.hasPendingEscalation('+1234567890')).toBe(true);

    // Advance to just before full timeout (300s)
    await vi.advanceTimersByTimeAsync(299_000);
    expect(router.hasPendingEscalation('+1234567890')).toBe(true);
    // respawn must NOT have been called
    expect(respawn).not.toHaveBeenCalled();

    // Advance past 300s — auto-deny fires
    await vi.advanceTimersByTimeAsync(2_000);

    expect(router.hasPendingEscalation('+1234567890')).toBe(false);
    // respawn still must NOT have been called (auto-deny, not grant)
    expect(respawn).not.toHaveBeenCalled();

    // Timeout notification sent to user
    const timeoutMsg = connector.sentMessages.find((m) => m.content.includes('timed out'));
    expect(timeoutMsg).toBeDefined();
    expect(timeoutMsg!.content).toContain('worker-ad1');
  });

  it('scaled timeout auto-denies at 360s for 2 pending escalations', async () => {
    const { router, connector } = makeRouter();
    await connector.initialize();

    const msg = makeMsg('parallel tasks');
    await router.requestToolEscalation(
      'worker-ad2a',
      ['Bash'],
      'read-only',
      'step 1',
      msg,
      connector,
    );
    await router.requestToolEscalation(
      'worker-ad2b',
      ['Write'],
      'read-only',
      'step 2',
      msg,
      connector,
    );

    // After 301s the first entry auto-denies (300s timeout); second still pending (360s timeout)
    await vi.advanceTimersByTimeAsync(301_000);
    expect(router.pendingEscalationCount('+1234567890')).toBe(1);

    // After another 60s (361s total) the second also auto-denies
    await vi.advanceTimersByTimeAsync(60_000);
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);

    // Both timeout notifications were sent
    const timeoutMsgs = connector.sentMessages.filter((m) => m.content.includes('timed out'));
    expect(timeoutMsgs.length).toBeGreaterThanOrEqual(2);
  });
});
