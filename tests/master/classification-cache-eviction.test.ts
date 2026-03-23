import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { ClassificationCacheEntry } from '../../src/types/master.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../src/core/agent-runner.js', () => {
  const profiles: Record<string, string[]> = {
    'read-only': ['Read', 'Glob', 'Grep'],
    'code-edit': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(git:*)', 'Bash(npm:*)'],
    'full-access': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  };
  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: vi.fn(),
      stream: vi.fn(),
      spawnWithHandle: vi.fn(),
      spawnWithStreamingHandle: vi.fn(),
    })),
    TOOLS_READ_ONLY: profiles['read-only'],
    TOOLS_CODE_EDIT: profiles['code-edit'],
    TOOLS_FULL: profiles['full-access'],
    DEFAULT_MAX_TURNS_EXPLORATION: 15,
    DEFAULT_MAX_TURNS_TASK: 25,
    DEFAULT_MAX_FIX_ITERATIONS: 3,
    sanitizePrompt: vi.fn((s: string) => s),
    buildArgs: vi.fn(),
    isValidModel: vi.fn(() => true),
    MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
    AgentExhaustedError: class AgentExhaustedError extends Error {},
    resolveProfile: (profileName: string) => profiles[profileName],
    classifyError: (_stderr: string, _exitCode: number): string => 'unknown',
    manifestToSpawnOptions: (manifest: Record<string, unknown>) => {
      const profile = manifest.profile as string | undefined;
      const allowedTools =
        (manifest.allowedTools as string[] | undefined) ??
        (profile ? profiles[profile] : undefined);
      return Promise.resolve({
        spawnOptions: {
          prompt: manifest.prompt,
          workspacePath: manifest.workspacePath,
          model: manifest.model,
          allowedTools,
          maxTurns: manifest.maxTurns,
        },
        cleanup: async () => {},
      });
    },
  };
});

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Helpers ──────────────────────────────────────────────────────────

const MAX_CLASSIFICATION_CACHE_SIZE = 10_000;

const masterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  available: true,
  role: 'master',
  capabilities: ['general'],
};

function makeEntry(key: string, cachedAt: number): ClassificationCacheEntry {
  return {
    normalizedKey: key,
    result: { class: 'quick-answer', maxTurns: 10, reason: 'test' },
    recordedAt: new Date().toISOString(),
    hitCount: 0,
    feedback: [],
    classifierVersion: 'v1',
    cachedAt,
  } as ClassificationCacheEntry;
}

/**
 * Access the private classificationCache map on MasterManager.
 */
function getCache(manager: MasterManager): Map<string, ClassificationCacheEntry> {
  return (
    manager as unknown as {
      classificationEngine: { classificationCache: Map<string, ClassificationCacheEntry> };
    }
  ).classificationEngine.classificationCache;
}

/**
 * Call the private evictClassificationCacheIfNeeded method.
 */
function evict(manager: MasterManager): void {
  (
    manager as unknown as { classificationEngine: { evictClassificationCacheIfNeeded(): void } }
  ).classificationEngine.evictClassificationCacheIfNeeded();
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('classificationCache — LRU eviction (OB-1307)', () => {
  let testWorkspace: string;
  let manager: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    testWorkspace = path.join(os.tmpdir(), `test-cache-eviction-${Date.now()}`);
    await fs.mkdir(testWorkspace, { recursive: true });
    manager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });
  });

  afterEach(async () => {
    await fs.rm(testWorkspace, { recursive: true, force: true }).catch(() => {});
  });

  it('cache does not exceed MAX_CLASSIFICATION_CACHE_SIZE after 15,000 insertions', () => {
    const cache = getCache(manager);
    const TOTAL = 15_000;

    for (let i = 0; i < TOTAL; i++) {
      cache.set(`key-${i}`, makeEntry(`key-${i}`, i));
      evict(manager);
    }

    expect(cache.size).toBeLessThanOrEqual(MAX_CLASSIFICATION_CACHE_SIZE);
  });

  it('evicts oldest entries first when the cache overflows', () => {
    const cache = getCache(manager);
    const TOTAL = 15_000;

    // cachedAt=i, so key-0 is oldest and key-14999 is newest
    for (let i = 0; i < TOTAL; i++) {
      cache.set(`key-${i}`, makeEntry(`key-${i}`, i));
      evict(manager);
    }

    // The very oldest entries must have been evicted
    expect(cache.has('key-0')).toBe(false);
    expect(cache.has('key-1')).toBe(false);
    expect(cache.has('key-999')).toBe(false);

    // The very newest entries must still be present
    expect(cache.has(`key-${TOTAL - 1}`)).toBe(true);
    expect(cache.has(`key-${TOTAL - 2}`)).toBe(true);
  });

  it('entries without cachedAt are treated as oldest and evicted before timestamped entries', () => {
    const cache = getCache(manager);

    // Insert MAX+1 entries: first 100 have no cachedAt (treated as oldest),
    // rest have explicit ascending timestamps
    for (let i = 0; i < 100; i++) {
      // Omit cachedAt to simulate entries without a timestamp (treated as oldest)
      const entry: ClassificationCacheEntry = {
        normalizedKey: `old-${i}`,
        result: { class: 'quick-answer', maxTurns: 10, reason: 'test' },
        recordedAt: new Date().toISOString(),
        hitCount: 0,
        feedback: [],
        classifierVersion: 'v1',
      };
      cache.set(`old-${i}`, entry);
    }
    for (let i = 0; i < MAX_CLASSIFICATION_CACHE_SIZE + 1 - 100; i++) {
      cache.set(`new-${i}`, makeEntry(`new-${i}`, i + 1));
    }
    // Cache now has MAX+1 entries; trigger eviction once
    evict(manager);

    // The 100 entries without cachedAt should be among the first evicted
    // (they sort as cachedAt=0, which is the minimum)
    for (let i = 0; i < 100; i++) {
      expect(cache.has(`old-${i}`)).toBe(false);
    }
  });

  it('a single eviction call removes exactly 20% of MAX_CLASSIFICATION_CACHE_SIZE', () => {
    const cache = getCache(manager);
    const expectedEvictCount = Math.ceil(MAX_CLASSIFICATION_CACHE_SIZE * 0.2); // 2000

    // Fill to exactly MAX+1 so one eviction fires
    for (let i = 0; i < MAX_CLASSIFICATION_CACHE_SIZE + 1; i++) {
      cache.set(`key-${i}`, makeEntry(`key-${i}`, i));
    }
    evict(manager);

    expect(cache.size).toBe(MAX_CLASSIFICATION_CACHE_SIZE + 1 - expectedEvictCount);
  });
});
