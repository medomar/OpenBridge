/**
 * RAG-specific tests for KnowledgeRetriever and hybridSearch (OB-1574).
 *
 * Covers the behaviours added during the OB-F90 fix sprint:
 *  1. buildSearchQuery preserves 2-char domain terms (api, ui, db, cli)
 *  2. buildSearchQuery falls back to the original query when all tokens are filtered
 *  3. WARN is logged when every token is filtered out (stop words / too short)
 *  4. Zero-chunk scenario — after re-indexing workspace map content, hybridSearch
 *     can find results (validates the OB-1569/OB-1573 pipeline end-to-end)
 *  5. hybridSearch fallback returns recent chunks when the sanitized query is empty
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { KnowledgeRetriever } from '../../src/core/knowledge-retriever.js';
import { hybridSearch } from '../../src/memory/retrieval.js';
import { storeChunks } from '../../src/memory/chunk-store.js';
import { openDatabase, closeDatabase } from '../../src/memory/database.js';
import type { Chunk } from '../../src/memory/chunk-store.js';

// ---------------------------------------------------------------------------
// Module-level mock for the logger so we can assert on warn calls.
// Vitest hoists vi.mock() to the top, so variables prefixed with "mock" are
// accessible inside the factory even though they appear later in source.
// ---------------------------------------------------------------------------

const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: mockLoggerWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
  setLogLevel: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

type MockMemoryManager = {
  searchContext: ReturnType<typeof vi.fn>;
  getDb: ReturnType<typeof vi.fn>;
  storeChunks: ReturnType<typeof vi.fn>;
};

type MockDotFolderManager = {
  readWorkspaceMap: ReturnType<typeof vi.fn>;
  listDirDiveResults: ReturnType<typeof vi.fn>;
  readDirectoryDive: ReturnType<typeof vi.fn>;
};

function makeRetriever(
  memoryManager: MockMemoryManager,
  dotFolderManager: MockDotFolderManager,
): KnowledgeRetriever {
  return new KnowledgeRetriever(memoryManager as never, dotFolderManager as never);
}

function makeMocks(): { memoryManager: MockMemoryManager; dotFolderManager: MockDotFolderManager } {
  return {
    memoryManager: {
      searchContext: vi.fn().mockResolvedValue([]),
      getDb: vi.fn().mockReturnValue(null),
      storeChunks: vi.fn().mockResolvedValue(undefined),
    },
    dotFolderManager: {
      readWorkspaceMap: vi.fn().mockResolvedValue(null),
      listDirDiveResults: vi.fn().mockResolvedValue([]),
      readDirectoryDive: vi.fn(),
    },
  };
}

// ---------------------------------------------------------------------------
// Test 1 — buildSearchQuery preserves 2-char domain terms
// ---------------------------------------------------------------------------

describe('buildSearchQuery — preserves short domain terms', () => {
  let memoryManager: MockMemoryManager;
  let dotFolderManager: MockDotFolderManager;
  let retriever: KnowledgeRetriever;

  beforeEach(() => {
    const mocks = makeMocks();
    memoryManager = mocks.memoryManager;
    dotFolderManager = mocks.dotFolderManager;
    retriever = makeRetriever(memoryManager, dotFolderManager);
  });

  it('keeps 2-char domain terms like "api" and "ui" in the search query', async () => {
    await retriever.query('what is the api and ui');

    // searchContext should have been called — first call uses the built search query
    // (fallback keyword retries may add more calls when the first returns empty)
    expect(memoryManager.searchContext).toHaveBeenCalled();
    const query = memoryManager.searchContext.mock.calls[0]?.[0] as string;
    expect(query).toContain('api');
    expect(query).toContain('ui');
  });

  it('drops single-char tokens while keeping multi-char terms', async () => {
    await retriever.query('db a cli i');

    const query = memoryManager.searchContext.mock.calls[0]?.[0] as string;
    // 'db' and 'cli' are domain terms (length > 1, not stop words) — they must survive
    expect(query).toContain('db');
    expect(query).toContain('cli');
    // single-char 'a' and 'i' should be stripped (but 'a' is also a stop word)
    // After filtering, the tokens that remain are 'db' and 'cli'
    expect(query).not.toMatch(/\ba\b/);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — buildSearchQuery falls back to original query when all tokens filtered
// ---------------------------------------------------------------------------

describe('buildSearchQuery — fallback to original when all tokens are filtered', () => {
  let memoryManager: MockMemoryManager;
  let dotFolderManager: MockDotFolderManager;
  let retriever: KnowledgeRetriever;

  beforeEach(() => {
    const mocks = makeMocks();
    memoryManager = mocks.memoryManager;
    dotFolderManager = mocks.dotFolderManager;
    retriever = makeRetriever(memoryManager, dotFolderManager);
  });

  it('passes the original query to searchContext when all tokens are stop words', async () => {
    const question = 'is it a the';

    await retriever.query(question);

    expect(memoryManager.searchContext).toHaveBeenCalledOnce();
    const callArg = memoryManager.searchContext.mock.calls[0]?.[0] as string;
    // All words are stop words → fallback → original question passed unchanged
    expect(callArg).toBe(question);
  });

  it('passes the original query when every token is a single character', async () => {
    const question = 'a b c';

    await retriever.query(question);

    const callArg = memoryManager.searchContext.mock.calls[0]?.[0] as string;
    // 'a', 'b', 'c' all have length ≤ 1 → filtered → fallback to original
    expect(callArg).toBe(question);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — WARN is logged when all query tokens are filtered out
// ---------------------------------------------------------------------------

describe('buildSearchQuery — WARN logged on empty query', () => {
  let memoryManager: MockMemoryManager;
  let dotFolderManager: MockDotFolderManager;
  let retriever: KnowledgeRetriever;

  beforeEach(() => {
    mockLoggerWarn.mockClear();
    const mocks = makeMocks();
    memoryManager = mocks.memoryManager;
    dotFolderManager = mocks.dotFolderManager;
    retriever = makeRetriever(memoryManager, dotFolderManager);
  });

  it('emits a WARN log when all tokens are stop words', async () => {
    await retriever.query('is it a the');

    expect(mockLoggerWarn).toHaveBeenCalledOnce();
    const [context, message] = mockLoggerWarn.mock.calls[0] as [Record<string, unknown>, string];
    expect(message).toContain('falling back to original query');
    expect(context).toHaveProperty('originalQuestion', 'is it a the');
    expect(context).toHaveProperty('reason');
    expect(context['reason']).toMatch(/stop/i);
  });

  it('does NOT warn when meaningful tokens survive filtering', async () => {
    await retriever.query('how does the router handle messages');

    // 'router', 'handle', 'messages' survive → no warn
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Zero chunks: re-indexing workspace map restores RAG results
// ---------------------------------------------------------------------------

describe('RAG zero-chunk re-indexing pipeline (OB-1569 / OB-1573)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('returns empty results when the chunk store is empty and query is valid', async () => {
    const results = await hybridSearch(db, 'how does router work');
    expect(results).toEqual([]);
  });

  it('finds chunks after workspace map content is indexed into the chunk store', async () => {
    // Simulate the re-indexing that master-manager performs (OB-1569/OB-1573):
    // when chunk store is empty, workspace map content is stored as searchable chunks.
    const workspaceChunks: Chunk[] = [
      {
        scope: '_workspace_key_files',
        category: 'structure',
        content:
          'Key files:\nsrc/core/router.ts (source): Message routing\nsrc/core/auth.ts (source): Authentication',
        source_hash: 'workspace-map-index',
      },
      {
        scope: '_workspace_summary',
        category: 'structure',
        content:
          'Project: myapp\nType: node\nSummary: An AI bridge application with routing and auth',
        source_hash: 'workspace-map-index',
      },
    ];

    // Store chunks — simulating the OB-1569 indexWorkspaceMapAsChunks() call
    storeChunks(db, workspaceChunks);

    // Now hybridSearch should return results for a relevant query
    const results = await hybridSearch(db, 'router message routing');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((c) => c.scope === '_workspace_key_files')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — hybridSearch fallback returns recent chunks when query is empty
// ---------------------------------------------------------------------------

describe('hybridSearch — recentChunksFallback when sanitized query is empty (OB-1572)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDatabase(':memory:');

    // Seed the DB with some chunks so recentChunksFallback has data to return
    storeChunks(db, [
      { scope: 'src/core/router.ts', category: 'patterns', content: 'Router handles routing' },
      { scope: 'src/core/auth.ts', category: 'patterns', content: 'Auth validates users' },
      { scope: 'src/memory/index.ts', category: 'patterns', content: 'Memory manager facade' },
    ]);
  });

  afterEach(() => {
    closeDatabase(db);
  });

  it('returns recent chunks when the query contains only FTS5 special characters', async () => {
    // Query made entirely of FTS5 operators sanitizes to an empty string,
    // triggering the recentChunksFallback path (OB-1572).
    const results = await hybridSearch(db, '*** ??? !!!');

    expect(results.length).toBeGreaterThan(0);
    // Should return chunks ordered by updated_at DESC (most recent first)
    expect(results[0]).toBeDefined();
    expect(results[0]?.scope).toBeDefined();
  });

  it('returns recent chunks when the query is an empty string', async () => {
    const results = await hybridSearch(db, '');

    // Empty string → sanitized to '' → recentChunksFallback → returns seeded chunks
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns up to 20 recent chunks (fallback default limit)', async () => {
    // Seed 25 chunks to exceed the fallback limit
    const extraChunks: Chunk[] = Array.from({ length: 25 }, (_, i) => ({
      scope: `src/module-${i}.ts`,
      category: 'patterns' as const,
      content: `Module ${i} content`,
    }));
    storeChunks(db, extraChunks);

    const results = await hybridSearch(db, '');

    // recentChunksFallback defaults to 20
    expect(results.length).toBeLessThanOrEqual(20);
  });
});
