import * as nodePath from 'node:path';
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
   * Search directory dive JSONs for content relevant to the question.
   * Returns synthetic Chunk objects for matching dives.
   *
   * OB-1337: dir-dive JSON loading — scans exploration/dirs/*.json for
   * directory dive results whose path, key files, or insights match the
   * question search terms.
   */
  private async searchDirDives(
    question: string,
    dives: Array<{ dirPath: string; resultPath: string }>,
  ): Promise<Chunk[]> {
    const searchTerms = this.buildSearchQuery(question).split(/\s+/).filter(Boolean);
    if (searchTerms.length === 0) return [];

    const questionLower = question.toLowerCase();
    const chunks: Chunk[] = [];

    for (const { dirPath } of dives) {
      const dive = await this.dotFolderManager.readDirectoryDive(dirPath);
      if (!dive) continue;

      const diveLower = dive.path.toLowerCase();
      const purposeLower = dive.purpose.toLowerCase();

      // Directory path or purpose matches a search term, or question explicitly references the dir
      const dirMatches =
        questionLower.includes(diveLower) ||
        searchTerms.some((t) => diveLower.includes(t) || purposeLower.includes(t));

      // Key files in this dive relevant to the question
      const relevantFiles = dive.keyFiles.filter((kf) => {
        const kfLower = kf.path.toLowerCase();
        const kfPurposeLower = kf.purpose.toLowerCase();
        return searchTerms.some((t) => kfLower.includes(t) || kfPurposeLower.includes(t));
      });

      // Insights in this dive relevant to the question
      const relevantInsights = dive.insights.filter((insight) =>
        searchTerms.some((t) => insight.toLowerCase().includes(t)),
      );

      if (!dirMatches && relevantFiles.length === 0 && relevantInsights.length === 0) continue;

      // Build a compact content string for this dive
      const lines: string[] = [`${dive.path}: ${dive.purpose}`];
      for (const kf of relevantFiles.slice(0, 5)) {
        lines.push(`  ${kf.path} (${kf.type}): ${kf.purpose}`);
      }
      for (const insight of relevantInsights.slice(0, 3)) {
        lines.push(`  ${insight}`);
      }

      chunks.push({
        scope: dive.path,
        category: 'structure' as const,
        content: lines.join('\n'),
      });
    }

    return chunks;
  }

  /**
   * Match workspace map key files against terms extracted from the question.
   * Returns synthetic Chunk objects for each matched file.
   *
   * OB-1336: workspace map key-file matching — scans keyFiles for filenames or
   * module names mentioned in the question.
   */
  private matchKeyFiles(
    question: string,
    keyFiles: Array<{ path: string; type: string; purpose: string }>,
  ): Chunk[] {
    // Extract explicit file references like "router.ts", "auth.js"
    const fileRefPattern = /\b[\w-]+\.\w{1,5}\b/g;
    const explicitRefs = (question.match(fileRefPattern) ?? []).map((r) => r.toLowerCase());

    // Extract module-name terms (non-stop-words, >= 3 chars)
    const moduleTerms = question
      .toLowerCase()
      .split(/[\s.,!?;:'"()[\]{}]+/)
      .filter((term) => term.length >= 3 && !STOP_WORDS.has(term));

    return keyFiles
      .filter((kf) => {
        const kfLower = kf.path.toLowerCase();
        const baseName = nodePath.basename(kfLower);
        const baseNoExt = baseName.replace(/\.[^.]+$/, '');

        // Explicit file reference match (e.g., "router.ts" in question matches path)
        if (explicitRefs.some((ref) => kfLower.includes(ref))) return true;

        // Module name match (e.g., "router" matches basename "router.ts")
        if (moduleTerms.some((term) => baseNoExt === term || baseNoExt.includes(term))) return true;

        return false;
      })
      .map((kf) => ({
        scope: kf.path,
        category: 'structure' as const,
        content: `${kf.path} (${kf.type}): ${kf.purpose}`,
      }));
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

    // --- Workspace map key-file matching (OB-1336) ---
    const workspaceMap = await this.dotFolderManager.readWorkspaceMap();
    if (workspaceMap && workspaceMap.keyFiles.length > 0) {
      const mapChunks = this.matchKeyFiles(question, workspaceMap.keyFiles);
      if (mapChunks.length > 0) {
        result.chunks.push(...mapChunks);
        result.sources.push('workspace-map');
      }
    }

    // --- Dir-dive JSON loading (OB-1337) ---
    const dirDives = await this.dotFolderManager.listDirDiveResults();
    if (dirDives.length > 0) {
      const diveChunks = await this.searchDirDives(question, dirDives);
      if (diveChunks.length > 0) {
        result.chunks.push(...diveChunks);
        result.sources.push('dir-dive');
      }
    }

    return result;
  }
}
