/**
 * Unit tests for MasterManager RAG retry and workspace-map fallback (OB-1571, OB-F207).
 *
 * Tests:
 * 1. RAG retry: when raw Arabizi/Darija query returns 0 chunks, the English description
 *    from the AI classifier (classification.ragQuery) is used for a retry.
 * 2. Workspace-map fallback: when both RAG attempts and targeted reader return nothing,
 *    a workspace overview summary is injected so workers get basic project context.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasterManager } from '../../src/master/master-manager.js';
import type { ClassificationResult } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';
import type { AgentResult, SpawnOptions } from '../../src/core/agent-runner.js';
import { DotFolderManager } from '../../src/master/dotfolder-manager.js';
import type { KnowledgeResult } from '../../src/core/knowledge-retriever.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ── Mock AgentRunner ─────────────────────────────────────────────────────────

const mockSpawn = vi.fn();
const mockSpawnWithHandle = vi.fn();

vi.mock('../../src/core/agent-runner.js', () => {
  const profiles: Record<string, string[]> = {
    'read-only': ['Read', 'Glob', 'Grep'],
    'code-edit': [
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(git:*)',
      'Bash(npm:*)',
      'Bash(npx:*)',
    ],
    'full-access': ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
  };

  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: mockSpawn,
      stream: vi.fn(),
      spawnWithHandle: mockSpawnWithHandle,
      spawnWithStreamingHandle: mockSpawnWithHandle,
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
          timeout: manifest.timeout,
          retries: manifest.retries,
          retryDelay: manifest.retryDelay,
        },
        cleanup: async () => {},
      });
    },
  };
});

// ── Mock logger ──────────────────────────────────────────────────────────────

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const masterTool: DiscoveredTool = {
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  available: true,
  role: 'master',
  capabilities: ['general'],
};

function getSpawnCallOpts(callIndex: number): SpawnOptions | undefined {
  return mockSpawn.mock.calls[callIndex]?.[0] as SpawnOptions | undefined;
}

function makeMessage(content: string): InboundMessage {
  return {
    id: 'msg-rag-test-' + Date.now(),
    content,
    rawContent: '/ai ' + content,
    sender: '+1234567890',
    source: 'whatsapp',
    timestamp: new Date(),
  };
}

// Zero-results RAG response (low confidence)
const EMPTY_RAG_RESULT: KnowledgeResult = {
  chunks: [],
  confidence: 0,
  sources: [],
};

// Non-empty RAG response (high confidence)
function makeRagResult(chunkContent: string): KnowledgeResult {
  return {
    chunks: [{ id: '1', scope: 'code', category: 'function', content: chunkContent, metadata: {} }],
    confidence: 0.85,
    sources: ['src/suppliers.ts'],
  };
}

// ── Suite: RAG retry with classifier description (OB-1569, OB-1571) ──────────

describe('MasterManager — RAG retry with classifier English description (OB-1571)', () => {
  let testWorkspace: string;
  let manager: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawnWithHandle.mockReset();
    mockSpawnWithHandle.mockImplementation((opts: SpawnOptions) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    testWorkspace = path.join(os.tmpdir(), 'test-rag-retry-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    const dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();

    manager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    await manager.start();
  });

  afterEach(async () => {
    await manager.shutdown();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('retries RAG with English ragQuery when Arabizi query returns 0 chunks', async () => {
    const arabiziQuery = 'ta3tini les fournisseurs b9adech khasarna';
    const englishDescription =
      'Data analysis query requiring supplier aggregation and profit calculation';

    // Force quick-answer classification with a ragQuery (from AI classifier)
    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue({
      class: 'quick-answer',
      maxTurns: 5,
      timeout: 210_000,
      reason: `AI classifier: ${englishDescription}`,
      ragQuery: englishDescription,
    } as ClassificationResult);

    // Mock the master spawn to return a simple response
    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'Here are the supplier profit figures.',
      stderr: '',
      retryCount: 0,
      durationMs: 200,
    } as AgentResult);

    // Mock knowledgeRetriever: first call (arabizi) returns 0 chunks, retry (english) returns 3 chunks
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce(EMPTY_RAG_RESULT) // first call: raw arabizi → 0 chunks
      .mockResolvedValueOnce(makeRagResult('supplier profit data: 5000 DZD')); // retry: english → 1 chunk

    const mockFormatKnowledgeContext = vi.fn().mockReturnValue('Supplier profit data: 5000 DZD');
    const mockSuggestTargetFiles = vi.fn().mockReturnValue([]);

    manager.setKnowledgeRetriever({
      query: mockQuery,
      formatKnowledgeContext: mockFormatKnowledgeContext,
      suggestTargetFiles: mockSuggestTargetFiles,
      storeWorkerResult: vi.fn().mockResolvedValue(undefined),
      queryWithIndex: vi.fn().mockResolvedValue(EMPTY_RAG_RESULT),
    } as unknown as Parameters<typeof manager.setKnowledgeRetriever>[0]);

    await manager.processMessage(makeMessage(arabiziQuery));

    // Verify query was called twice: once for arabizi, once for the English retry
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenNthCalledWith(1, arabiziQuery);
    expect(mockQuery).toHaveBeenNthCalledWith(2, englishDescription);

    // Verify formatKnowledgeContext was called with the retry result (high-confidence)
    expect(mockFormatKnowledgeContext).toHaveBeenCalledTimes(1);
    const ragArg = mockFormatKnowledgeContext.mock.calls[0]?.[0] as KnowledgeResult | undefined;
    expect(ragArg?.confidence).toBe(0.85);
    expect(ragArg?.chunks.some((c) => c.content === 'supplier profit data: 5000 DZD')).toBe(true);

    // Verify master spawn received the knowledge context in systemPrompt
    const masterCall = getSpawnCallOpts(0);
    expect(masterCall).toBeDefined();
    expect(masterCall?.systemPrompt).toContain('Pre-fetched Knowledge');
    expect(masterCall?.systemPrompt).toContain('Supplier profit data');
  });

  it('does NOT retry when original RAG query returns chunks (ragQuery is ignored)', async () => {
    const query = 'what is the product list?';

    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue({
      class: 'quick-answer',
      maxTurns: 5,
      timeout: 210_000,
      reason: 'AI classifier: query about product listing',
      ragQuery: 'query about product listing',
    } as ClassificationResult);

    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'Product list response.',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    } as AgentResult);

    const mockQuery = vi.fn().mockResolvedValue(makeRagResult('product catalog data'));
    const mockFormatKnowledgeContext = vi.fn().mockReturnValue('Product catalog data found');
    const mockSuggestTargetFiles = vi.fn().mockReturnValue([]);

    manager.setKnowledgeRetriever({
      query: mockQuery,
      formatKnowledgeContext: mockFormatKnowledgeContext,
      suggestTargetFiles: mockSuggestTargetFiles,
      storeWorkerResult: vi.fn().mockResolvedValue(undefined),
      queryWithIndex: vi.fn().mockResolvedValue(EMPTY_RAG_RESULT),
    } as unknown as Parameters<typeof manager.setKnowledgeRetriever>[0]);

    await manager.processMessage(makeMessage(query));

    // Only one query call — no retry needed since first call returns chunks
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(query);
  });

  it('populates knowledgeContext from retry result in master systemPrompt', async () => {
    const arabiziContent = 'b9adech el stock dyal les produits';
    const englishDesc = 'Query about current product stock levels and inventory count';

    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue({
      class: 'tool-use',
      maxTurns: 15,
      timeout: 510_000,
      reason: `AI classifier: ${englishDesc}`,
      ragQuery: englishDesc,
    } as ClassificationResult);

    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'Stock analysis complete.',
      stderr: '',
      retryCount: 0,
      durationMs: 300,
    } as AgentResult);

    const retryChunkContent = 'stock levels: 200 units remaining in warehouse';
    const mockQuery = vi
      .fn()
      .mockResolvedValueOnce(EMPTY_RAG_RESULT)
      .mockResolvedValueOnce(makeRagResult(retryChunkContent));

    const formattedContext = `## Retrieved Knowledge\n\n${retryChunkContent}`;
    const mockFormatKnowledgeContext = vi.fn().mockReturnValue(formattedContext);
    const mockSuggestTargetFiles = vi.fn().mockReturnValue([]);

    manager.setKnowledgeRetriever({
      query: mockQuery,
      formatKnowledgeContext: mockFormatKnowledgeContext,
      suggestTargetFiles: mockSuggestTargetFiles,
      storeWorkerResult: vi.fn().mockResolvedValue(undefined),
      queryWithIndex: vi.fn().mockResolvedValue(EMPTY_RAG_RESULT),
    } as unknown as Parameters<typeof manager.setKnowledgeRetriever>[0]);

    await manager.processMessage(makeMessage(arabiziContent));

    // Master spawn systemPrompt must contain the RAG context from the retry
    const masterCall = getSpawnCallOpts(0);
    expect(masterCall?.systemPrompt).toContain('stock levels: 200 units remaining in warehouse');
  });
});

// ── Suite: Workspace-map summary fallback (OB-1570, OB-1571) ─────────────────

describe('MasterManager — workspace-map summary fallback (OB-1571)', () => {
  let testWorkspace: string;
  let manager: MasterManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSpawnWithHandle.mockReset();
    mockSpawnWithHandle.mockImplementation((opts: SpawnOptions) => ({
      promise: mockSpawn(opts) as Promise<AgentResult>,
      pid: 12345,
      abort: vi.fn(),
    }));

    testWorkspace = path.join(os.tmpdir(), 'test-rag-fallback-' + Date.now());
    await fs.mkdir(testWorkspace, { recursive: true });

    const dotFolderManager = new DotFolderManager(testWorkspace);
    await dotFolderManager.initialize();

    manager = new MasterManager({
      workspacePath: testWorkspace,
      masterTool,
      discoveredTools: [masterTool],
      skipAutoExploration: true,
    });

    await manager.start();
  });

  afterEach(async () => {
    await manager.shutdown();
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it('injects workspace-map fallback when RAG and targeted reader both fail', async () => {
    // Spy on dotFolder readWorkspaceMap to return a mock workspace map
    const mockWorkspaceMap = {
      workspacePath: testWorkspace,
      projectName: 'test-project',
      projectType: 'node',
      structure: { src: {}, lib: {}, tests: {} },
      keyFiles: [{ path: 'src/index.ts' }, { path: 'src/core.ts' }, { path: 'package.json' }],
      frameworks: ['express'],
      entryPoints: ['src/index.ts'],
      commands: { build: 'npm run build', test: 'npm test' },
      dependencies: ['express', 'zod'],
      summary: 'A Node.js API project',
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
    };

    vi.spyOn(DotFolderManager.prototype, 'readWorkspaceMap').mockResolvedValue(
      mockWorkspaceMap as unknown as Awaited<ReturnType<DotFolderManager['readWorkspaceMap']>>,
    );

    // Force quick-answer classification — no ragQuery (keyword fallback)
    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue({
      class: 'quick-answer',
      maxTurns: 5,
      timeout: 210_000,
      reason: 'keyword: quick-answer',
      ragQuery: undefined,
    } as ClassificationResult);

    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'I found the answer.',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    } as AgentResult);

    // Mock knowledgeRetriever: all queries return 0 chunks (low confidence)
    const mockQuery = vi.fn().mockResolvedValue(EMPTY_RAG_RESULT);
    const mockSuggestTargetFiles = vi.fn().mockReturnValue([]); // no target files → no targeted reader

    manager.setKnowledgeRetriever({
      query: mockQuery,
      formatKnowledgeContext: vi.fn().mockReturnValue(''),
      suggestTargetFiles: mockSuggestTargetFiles,
      storeWorkerResult: vi.fn().mockResolvedValue(undefined),
      queryWithIndex: vi.fn().mockResolvedValue(EMPTY_RAG_RESULT),
    } as unknown as Parameters<typeof manager.setKnowledgeRetriever>[0]);

    await manager.processMessage(makeMessage('what does this project do?'));

    // Master spawn systemPrompt must contain the workspace-map fallback summary
    const masterCall = getSpawnCallOpts(0);
    expect(masterCall).toBeDefined();
    expect(masterCall?.systemPrompt).toContain('Workspace Overview (fallback)');
    expect(masterCall?.systemPrompt).toContain('node');
  });

  it('does NOT inject workspace-map fallback when workspace map is unavailable', async () => {
    // readWorkspaceMap returns null — no fallback possible
    vi.spyOn(DotFolderManager.prototype, 'readWorkspaceMap').mockResolvedValue(null);

    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue({
      class: 'quick-answer',
      maxTurns: 5,
      timeout: 210_000,
      reason: 'keyword: quick-answer',
      ragQuery: undefined,
    } as ClassificationResult);

    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'Response without RAG context.',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    } as AgentResult);

    const mockQuery = vi.fn().mockResolvedValue(EMPTY_RAG_RESULT);
    const mockSuggestTargetFiles = vi.fn().mockReturnValue([]);

    manager.setKnowledgeRetriever({
      query: mockQuery,
      formatKnowledgeContext: vi.fn().mockReturnValue(''),
      suggestTargetFiles: mockSuggestTargetFiles,
      storeWorkerResult: vi.fn().mockResolvedValue(undefined),
      queryWithIndex: vi.fn().mockResolvedValue(EMPTY_RAG_RESULT),
    } as unknown as Parameters<typeof manager.setKnowledgeRetriever>[0]);

    await manager.processMessage(makeMessage('how does authentication work?'));

    // systemPrompt must NOT contain workspace overview when map is unavailable
    const masterCall = getSpawnCallOpts(0);
    expect(masterCall?.systemPrompt ?? '').not.toContain('Workspace Overview (fallback)');
  });

  it('workspace-map fallback contains projectType and keyFiles', async () => {
    const mockWorkspaceMap = {
      workspacePath: testWorkspace,
      projectName: 'my-app',
      projectType: 'typescript',
      structure: { src: {}, dist: {} },
      keyFiles: [
        { path: 'src/index.ts' },
        { path: 'src/auth.ts' },
        { path: 'src/api.ts' },
        { path: 'tsconfig.json' },
      ],
      frameworks: ['fastify'],
      entryPoints: ['src/index.ts'],
      commands: {},
      dependencies: [],
      summary: 'TypeScript API',
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
    };

    vi.spyOn(DotFolderManager.prototype, 'readWorkspaceMap').mockResolvedValue(
      mockWorkspaceMap as unknown as Awaited<ReturnType<DotFolderManager['readWorkspaceMap']>>,
    );

    vi.spyOn(MasterManager.prototype, 'classifyTask').mockResolvedValue({
      class: 'quick-answer',
      maxTurns: 5,
      timeout: 210_000,
      reason: 'keyword: quick-answer',
      ragQuery: undefined,
    } as ClassificationResult);

    mockSpawn.mockResolvedValue({
      exitCode: 0,
      stdout: 'Done.',
      stderr: '',
      retryCount: 0,
      durationMs: 100,
    } as AgentResult);

    manager.setKnowledgeRetriever({
      query: vi.fn().mockResolvedValue(EMPTY_RAG_RESULT),
      formatKnowledgeContext: vi.fn().mockReturnValue(''),
      suggestTargetFiles: vi.fn().mockReturnValue([]),
      storeWorkerResult: vi.fn().mockResolvedValue(undefined),
      queryWithIndex: vi.fn().mockResolvedValue(EMPTY_RAG_RESULT),
    } as unknown as Parameters<typeof manager.setKnowledgeRetriever>[0]);

    await manager.processMessage(makeMessage('how does the auth module work?'));

    const masterCall = getSpawnCallOpts(0);
    const systemPrompt = masterCall?.systemPrompt ?? '';

    // The fallback includes the projectType and key file paths
    expect(systemPrompt).toContain('Workspace Overview (fallback)');
    expect(systemPrompt).toContain('typescript');
    expect(systemPrompt).toContain('src/index.ts');
  });
});
