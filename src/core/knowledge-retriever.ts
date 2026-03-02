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
// Stop words for FTS5 query parsing
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'what',
  'which',
  'who',
  'how',
  'where',
  'when',
  'why',
  'not',
  'no',
  'so',
  'if',
  'as',
  'about',
  'into',
  'through',
  'than',
  'then',
  'there',
  'here',
  'up',
  'out',
  'my',
  'your',
  'their',
]);

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
   * Parse a natural-language question into a cleaned FTS5 search query string.
   * Splits on whitespace, removes stop words and very short tokens (<= 2 chars),
   * and returns the remaining terms joined by spaces for FTS5 MATCH.
   */
  private buildSearchQuery(question: string): string {
    return question
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 2 && !STOP_WORDS.has(term))
      .join(' ');
  }

  /**
   * Query the local knowledge store for information relevant to the given
   * question.  Returns a {@link KnowledgeResult} with matched chunks, a
   * confidence score, and the source types that contributed results.
   *
   * OB-1335: FTS5 chunk search — searches workspace_chunks via FTS5 MATCH and
   * returns up to 10 results ordered by BM25 rank score.
   * Subsequent tasks (OB-1336 through OB-1339) add workspace-map matching,
   * dir-dive loading, confidence scoring, and context formatting.
   */
  async query(question: string): Promise<KnowledgeResult> {
    const result: KnowledgeResult = { chunks: [], confidence: 0, sources: [] };

    // --- FTS5 chunk search (OB-1335) ---
    const searchQuery = this.buildSearchQuery(question);
    if (searchQuery) {
      const fts5Chunks = await this.memoryManager.searchContext(searchQuery, 10);
      if (fts5Chunks.length > 0) {
        result.chunks.push(...fts5Chunks);
        result.sources.push('fts5');
      }
    }

    return result;
  }
}
