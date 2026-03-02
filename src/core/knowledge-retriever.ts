import type { MemoryManager, Chunk } from '../memory/index.js';
import type { DotFolderManager } from '../master/dotfolder-manager.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KnowledgeResult {
  chunks: Chunk[];
  confidence: number;
  sources: string[];
  needsWorker?: boolean;
}

// ---------------------------------------------------------------------------
// KnowledgeRetriever
// ---------------------------------------------------------------------------

/**
 * RAG query orchestrator — searches existing knowledge (FTS5 chunks, workspace
 * map, dir-dive JSONs) before spawning workers. Reduces redundant file reads
 * for questions about already-analysed code.
 */
export class KnowledgeRetriever {
  private readonly memoryManager: MemoryManager;
  private readonly dotFolderManager: DotFolderManager;

  constructor(memoryManager: MemoryManager, dotFolderManager: DotFolderManager) {
    this.memoryManager = memoryManager;
    this.dotFolderManager = dotFolderManager;
  }

  /**
   * Query the local knowledge store for information relevant to the given
   * question.  Returns a {@link KnowledgeResult} with matched chunks, a
   * confidence score, and the source types that contributed results.
   *
   * This is the stub implementation — subsequent tasks (OB-1335 through
   * OB-1339) will add FTS5 search, workspace-map matching, dir-dive loading,
   * confidence scoring, and context formatting.
   */
  query(_question: string): Promise<KnowledgeResult> {
    return Promise.resolve({ chunks: [], confidence: 0, sources: [] });
  }
}
