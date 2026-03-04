/**
 * Tests for runtime permission escalation (Phase 97 — OB-1603).
 *
 * Covers:
 *  1. Escalation prompt sent when requestToolEscalation() is called
 *  2. /allow grants the tool and triggers worker re-spawn
 *  3. /deny rejects and sends rejection message
 *  4. Timeout (60s) auto-denies when no user reply arrives
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
import { MockConnector } from '../helpers/mock-connector.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { MemoryManager } from '../../src/memory/index.js';

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
    expect(text).toContain('60 seconds');
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
// 4. Timeout auto-denies after 60 seconds
// ---------------------------------------------------------------------------

describe('permission escalation — timeout auto-deny', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a timeout notification and clears the escalation after 60 seconds', async () => {
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

    // Advance time past the 60-second timeout
    await vi.advanceTimersByTimeAsync(61_000);

    // Escalation should be cleared
    expect(router.hasPendingEscalation('+1234567890')).toBe(false);

    // Timeout notification should have been sent (last sent message)
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
    expect(entry!.role).toBe('viewer');
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
