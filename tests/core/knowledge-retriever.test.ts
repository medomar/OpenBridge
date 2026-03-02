import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeRetriever } from '../../src/core/knowledge-retriever.js';
import type { Chunk } from '../../src/memory/chunk-store.js';
import type { WorkspaceMap } from '../../src/types/master.js';

// ---------------------------------------------------------------------------
// Minimal mock types for MemoryManager and DotFolderManager
// ---------------------------------------------------------------------------

type MockMemoryManager = {
  searchContext: ReturnType<typeof vi.fn>;
};

type MockDotFolderManager = {
  readWorkspaceMap: ReturnType<typeof vi.fn>;
  listDirDiveResults: ReturnType<typeof vi.fn>;
  readDirectoryDive: ReturnType<typeof vi.fn>;
};

function makeChunk(
  scope: string,
  content: string,
  category: Chunk['category'] = 'patterns',
): Chunk {
  return { scope, category, content };
}

// ---------------------------------------------------------------------------
// KnowledgeRetriever.query — FTS5 chunk search
// ---------------------------------------------------------------------------

describe('KnowledgeRetriever.query — FTS5 chunk search', () => {
  let memoryManager: MockMemoryManager;
  let dotFolderManager: MockDotFolderManager;
  let retriever: KnowledgeRetriever;

  beforeEach(() => {
    memoryManager = { searchContext: vi.fn() };
    dotFolderManager = {
      readWorkspaceMap: vi.fn(),
      listDirDiveResults: vi.fn(),
      readDirectoryDive: vi.fn(),
    };

    retriever = new KnowledgeRetriever(memoryManager as never, dotFolderManager as never);
  });

  it('returns chunks from FTS5 when matches exist', async () => {
    const ftsChunks: Chunk[] = [
      makeChunk('src/core/router.ts', 'Router handles message routing'),
      makeChunk('src/core/auth.ts', 'Auth validates phone numbers'),
    ];
    memoryManager.searchContext.mockResolvedValue(ftsChunks);
    dotFolderManager.readWorkspaceMap.mockResolvedValue(null);
    dotFolderManager.listDirDiveResults.mockResolvedValue([]);

    const result = await retriever.query('how does router work');

    expect(result.chunks.length).toBe(2);
    expect(result.sources).toContain('fts5');
    expect(result.chunks[0].scope).toBe('src/core/router.ts');
  });

  it('returns no FTS5 chunks when there are no matches', async () => {
    memoryManager.searchContext.mockResolvedValue([]);
    dotFolderManager.readWorkspaceMap.mockResolvedValue(null);
    dotFolderManager.listDirDiveResults.mockResolvedValue([]);

    const result = await retriever.query('authentication flow');

    expect(result.sources).not.toContain('fts5');
  });
});

// ---------------------------------------------------------------------------
// KnowledgeRetriever.query — workspace map matching
// ---------------------------------------------------------------------------

describe('KnowledgeRetriever.query — workspace map key-file matching', () => {
  let memoryManager: MockMemoryManager;
  let dotFolderManager: MockDotFolderManager;
  let retriever: KnowledgeRetriever;

  beforeEach(() => {
    memoryManager = { searchContext: vi.fn().mockResolvedValue([]) };
    dotFolderManager = {
      readWorkspaceMap: vi.fn(),
      listDirDiveResults: vi.fn().mockResolvedValue([]),
      readDirectoryDive: vi.fn(),
    };

    retriever = new KnowledgeRetriever(memoryManager as never, dotFolderManager as never);
  });

  it('returns workspace-map chunks when a file path is mentioned in the question', async () => {
    dotFolderManager.readWorkspaceMap.mockResolvedValue({
      workspacePath: '/workspace',
      projectName: 'myapp',
      projectType: 'node',
      keyFiles: [
        { path: 'src/core/router.ts', type: 'source', purpose: 'Message routing' },
        { path: 'src/core/auth.ts', type: 'source', purpose: 'Authentication' },
      ],
      summary: 'A test project',
      generatedAt: new Date().toISOString(),
    });

    const result = await retriever.query('explain router.ts');

    expect(result.sources).toContain('workspace-map');
    expect(result.chunks.some((c) => c.scope === 'src/core/router.ts')).toBe(true);
  });

  it('does not include workspace-map source when no key files match', async () => {
    dotFolderManager.readWorkspaceMap.mockResolvedValue({
      workspacePath: '/workspace',
      projectName: 'myapp',
      projectType: 'node',
      keyFiles: [{ path: 'src/core/router.ts', type: 'source', purpose: 'Routing' }],
      summary: 'A test project',
      generatedAt: new Date().toISOString(),
    });

    const result = await retriever.query('tell me about the database schema');

    expect(result.sources).not.toContain('workspace-map');
  });
});

// ---------------------------------------------------------------------------
// KnowledgeRetriever.query — confidence scoring
// ---------------------------------------------------------------------------

describe('KnowledgeRetriever.query — confidence scoring', () => {
  let memoryManager: MockMemoryManager;
  let dotFolderManager: MockDotFolderManager;
  let retriever: KnowledgeRetriever;

  beforeEach(() => {
    memoryManager = { searchContext: vi.fn() };
    dotFolderManager = {
      readWorkspaceMap: vi.fn().mockResolvedValue(null),
      listDirDiveResults: vi.fn().mockResolvedValue([]),
      readDirectoryDive: vi.fn(),
    };

    retriever = new KnowledgeRetriever(memoryManager as never, dotFolderManager as never);
  });

  it('returns confidence 0 when no chunks are found', async () => {
    memoryManager.searchContext.mockResolvedValue([]);

    const result = await retriever.query('anything at all');

    expect(result.confidence).toBe(0);
    expect(result.chunks.length).toBe(0);
  });

  it('returns higher confidence when more chunks are found', async () => {
    // 1 chunk
    memoryManager.searchContext.mockResolvedValueOnce([makeChunk('src/a.ts', 'content a')]);
    const resultOne = await retriever.query('auth module');

    // 5 chunks
    memoryManager.searchContext.mockResolvedValueOnce([
      makeChunk('src/a.ts', 'content a'),
      makeChunk('src/b.ts', 'content b'),
      makeChunk('src/c.ts', 'content c'),
      makeChunk('src/d.ts', 'content d'),
      makeChunk('src/e.ts', 'content e'),
    ]);
    const resultFive = await retriever.query('auth module');

    expect(resultFive.confidence).toBeGreaterThan(resultOne.confidence);
  });

  it('sets needsWorker to true when confidence is below 0.3', async () => {
    // 0 chunks → confidence 0, which is < 0.3
    memoryManager.searchContext.mockResolvedValue([]);

    const result = await retriever.query('something obscure');

    expect(result.needsWorker).toBe(true);
  });

  it('does not set needsWorker when confidence is 0.3 or above', async () => {
    // 2 chunks from a single source: confidence = min(2/5,1)*0.8 + 0 = 0.32 ≥ 0.3
    memoryManager.searchContext.mockResolvedValue([
      makeChunk('src/a.ts', 'content a'),
      makeChunk('src/b.ts', 'content b'),
    ]);

    const result = await retriever.query('router module');

    expect(result.confidence).toBeGreaterThanOrEqual(0.3);
    expect(result.needsWorker).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// KnowledgeRetriever.formatKnowledgeContext — truncation and formatting
// ---------------------------------------------------------------------------

describe('KnowledgeRetriever.formatKnowledgeContext', () => {
  let retriever: KnowledgeRetriever;

  beforeEach(() => {
    const memoryManager: MockMemoryManager = { searchContext: vi.fn() };
    const dotFolderManager: MockDotFolderManager = {
      readWorkspaceMap: vi.fn(),
      listDirDiveResults: vi.fn(),
      readDirectoryDive: vi.fn(),
    };
    retriever = new KnowledgeRetriever(memoryManager as never, dotFolderManager as never);
  });

  it('returns empty string when there are no chunks', () => {
    const result = retriever.formatKnowledgeContext({
      chunks: [],
      confidence: 0,
      sources: [],
    });
    expect(result).toBe('');
  });

  it('includes the confidence percentage in the output', () => {
    const chunk = makeChunk('src/core/router.ts', 'Handles all routing');
    const output = retriever.formatKnowledgeContext({
      chunks: [chunk],
      confidence: 0.75,
      sources: ['fts5'],
    });
    expect(output).toContain('75%');
  });

  it('truncates output to 4000 characters', () => {
    // Create a chunk whose content is large enough to push past 4000 chars
    const longContent = 'x'.repeat(5000);
    const chunk = makeChunk('src/big-file.ts', longContent);
    const output = retriever.formatKnowledgeContext({
      chunks: [chunk],
      confidence: 0.8,
      sources: ['fts5'],
    });
    expect(output.length).toBe(4000);
    expect(output.endsWith('...')).toBe(true);
  });

  it('does not truncate when content fits within 4000 characters', () => {
    const chunk = makeChunk('src/core/router.ts', 'Short content');
    const output = retriever.formatKnowledgeContext({
      chunks: [chunk],
      confidence: 0.5,
      sources: ['fts5'],
    });
    expect(output.length).toBeLessThanOrEqual(4000);
    expect(output.endsWith('...')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// KnowledgeRetriever.suggestTargetFiles — targeted reader file suggestion
// OB-1357
// ---------------------------------------------------------------------------

describe('KnowledgeRetriever.suggestTargetFiles', () => {
  let retriever: KnowledgeRetriever;

  const baseWorkspaceMap: WorkspaceMap = {
    workspacePath: '/workspace',
    projectName: 'myapp',
    projectType: 'node',
    frameworks: [],
    structure: {},
    keyFiles: [],
    entryPoints: [],
    commands: {},
    dependencies: [],
    summary: 'A test project',
    generatedAt: new Date().toISOString(),
    schemaVersion: '1.0.0',
  };

  beforeEach(() => {
    const memoryManager = { searchContext: vi.fn() };
    const dotFolderManager = {
      readWorkspaceMap: vi.fn(),
      listDirDiveResults: vi.fn(),
      readDirectoryDive: vi.fn(),
    };
    retriever = new KnowledgeRetriever(memoryManager as never, dotFolderManager as never);
  });

  it('returns file paths matching question keywords', () => {
    const workspaceMap: WorkspaceMap = {
      ...baseWorkspaceMap,
      keyFiles: [
        { path: 'src/core/router.ts', type: 'source', purpose: 'Message routing' },
        { path: 'src/core/auth.ts', type: 'source', purpose: 'Authentication' },
        { path: 'src/core/queue.ts', type: 'source', purpose: 'Queue management' },
      ],
    };

    const files = retriever.suggestTargetFiles('how does router work', workspaceMap);

    expect(files.length).toBeGreaterThan(0);
    expect(files).toContain('src/core/router.ts');
  });

  it('returns empty array when no files match the question', () => {
    const workspaceMap: WorkspaceMap = {
      ...baseWorkspaceMap,
      keyFiles: [{ path: 'src/core/router.ts', type: 'source', purpose: 'Message routing' }],
    };

    // "database migrations" has no overlap with "router" or "message routing"
    const files = retriever.suggestTargetFiles(
      'tell me about database migrations schema',
      workspaceMap,
    );

    expect(files).toEqual([]);
  });

  it('limits results to at most 10 files', () => {
    // Create 15 key files that all match on the "auth" keyword
    const keyFiles = Array.from({ length: 15 }, (_, i) => ({
      path: `src/modules/auth-handler-${i}.ts`,
      type: 'source',
      purpose: 'Authentication handler',
    }));

    const workspaceMap: WorkspaceMap = {
      ...baseWorkspaceMap,
      keyFiles,
    };

    const files = retriever.suggestTargetFiles('auth handler authentication', workspaceMap);

    expect(files.length).toBeLessThanOrEqual(10);
  });

  it('scores explicit file reference higher than keyword match', () => {
    const workspaceMap: WorkspaceMap = {
      ...baseWorkspaceMap,
      keyFiles: [
        { path: 'src/core/router.ts', type: 'source', purpose: 'Message routing' },
        { path: 'src/core/auth.ts', type: 'source', purpose: 'Auth module that routes requests' },
      ],
    };

    // Explicit mention of "router.ts" should score it highest
    const files = retriever.suggestTargetFiles('explain router.ts', workspaceMap);

    expect(files[0]).toBe('src/core/router.ts');
  });
});
