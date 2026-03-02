import * as nodePath from 'node:path';
import type { MemoryManager, Chunk } from '../memory/index.js';
import { QACacheStore } from '../memory/qa-cache-store.js';
import type { DotFolderManager } from '../master/dotfolder-manager.js';
import type { WorkspaceMap } from '../types/master.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface KnowledgeResult {
  chunks: Chunk[];
  confidence: number;
  sources: string[];
  needsWorker?: boolean;
}

export interface ExtractedEntities {
  filePaths: string[];
  functionNames: string[];
  moduleNames: string[];
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
// Entity extraction
// ---------------------------------------------------------------------------

/**
 * Extract structured entities from a block of text using regex patterns.
 * Finds file paths (src/…/*.ts), function names (function X / const X =),
 * and module names (import … from '…'). Used to enrich stored chunk metadata
 * so that FTS5 searches can surface relevant chunks without re-spawning workers.
 *
 * OB-1363
 */
export function extractEntities(text: string): ExtractedEntities {
  // ── File paths ────────────────────────────────────────────────────────────
  // Match src/… paths with a file extension (e.g. src/core/router.ts)
  const filePathPattern = /\bsrc\/[\w/.-]+\.\w{1,5}\b/g;
  const filePaths = [...new Set(text.match(filePathPattern) ?? [])];

  // ── Function names ────────────────────────────────────────────────────────
  const functionNames = new Set<string>();

  // function foo / async function foo (with optional type-params)
  const funcDeclPattern = /\b(?:async\s+)?function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = funcDeclPattern.exec(text)) !== null) {
    if (m[1]) functionNames.add(m[1]);
  }

  // const foo = (async) (function|arrow)
  const constFuncPattern =
    /\bconst\s+(\w+)\s*(?::\s*[\w<>[\]|&, ]+\s*)?=\s*(?:async\s+)?(?:function|\()/g;
  while ((m = constFuncPattern.exec(text)) !== null) {
    if (m[1]) functionNames.add(m[1]);
  }

  // ── Module names ──────────────────────────────────────────────────────────
  const moduleNames = new Set<string>();
  // import … from 'module' / import type … from "module"
  const importPattern = /\bimport\s+(?:type\s+)?(?:[\s\S]*?)\bfrom\s+['"]([^'"]+)['"]/g;
  while ((m = importPattern.exec(text)) !== null) {
    if (m[1]) moduleNames.add(m[1]);
  }

  return {
    filePaths,
    functionNames: [...functionNames],
    moduleNames: [...moduleNames],
  };
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
  private qaCache: QACacheStore | null = null;

  constructor(memoryManager: MemoryManager, dotFolderManager: DotFolderManager) {
    this.memoryManager = memoryManager;
    this.dotFolderManager = dotFolderManager;
  }

  private getQACache(): QACacheStore | null {
    if (this.qaCache) return this.qaCache;
    const db = this.memoryManager.getDb();
    if (!db) return null;
    this.qaCache = new QACacheStore(db);
    return this.qaCache;
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
   * Compute confidence score (0.0–1.0) based on chunk count and source diversity.
   *
   * OB-1338:
   * - Chunk count component: 0 chunks → 0.0, 5+ chunks → 0.8 (linear).
   * - Source diversity bonus: +0.1 per additional source type beyond first,
   *   capped at +0.2 (so 3 sources gives the full bonus).
   * - Total is capped at 1.0.
   */
  private computeConfidence(chunkCount: number, sourceCount: number): number {
    // Chunk count component: scales linearly from 0 (0 chunks) to 0.8 (5+ chunks)
    const countComponent = Math.min(chunkCount / 5, 1) * 0.8;

    // Diversity bonus: +0.1 per additional source beyond the first, max +0.2
    const diversityBonus = Math.min(Math.max(sourceCount - 1, 0) * 0.1, 0.2);

    return Math.min(countComponent + diversityBonus, 1.0);
  }

  /**
   * Format a {@link KnowledgeResult} into a concise context string suitable
   * for injection into a system prompt.
   *
   * OB-1339: Produces a "Relevant Knowledge" header followed by source-grouped
   * sections (FTS5 chunks, workspace-map entries, dir-dive summaries) and a
   * confidence percentage footer. Output is hard-truncated to 4000 characters.
   */
  formatKnowledgeContext(result: KnowledgeResult): string {
    if (result.chunks.length === 0) {
      return '';
    }

    const lines: string[] = ['## Relevant Knowledge'];

    // Assign each chunk to its source group based on the chunk's category /
    // scope heuristic.  Chunks carry no explicit source tag, so we infer:
    //   • FTS5 chunks  → any category (they come from the DB, scope is a path)
    //   • workspace-map chunks → category === 'structure' AND scope ends in a
    //     filename (single path segment after the last slash)
    //   • dir-dive chunks → category === 'structure' AND scope is a dir path
    //
    // For simplicity we use the order in which sources were populated: the
    // first `result.sources.length` groups are valid; within each group we
    // include up to 5 chunks.

    const fts5Chunks: Chunk[] = [];
    const mapChunks: Chunk[] = [];
    const diveChunks: Chunk[] = [];

    for (const chunk of result.chunks) {
      // Workspace-map synthetic chunks have a single-line content like
      // "path/to/file.ts (type): purpose"
      if (
        chunk.category === 'structure' &&
        /^[^\n]+ \(\w+\): .+$/.test(chunk.content) &&
        chunk.content.split('\n').length === 1
      ) {
        mapChunks.push(chunk);
      } else if (
        chunk.category === 'structure' &&
        chunk.content.includes('\n') &&
        !chunk.scope.match(/\.\w{1,5}$/)
      ) {
        // Dir-dive chunks are multi-line and scope is a directory path
        diveChunks.push(chunk);
      } else {
        fts5Chunks.push(chunk);
      }
    }

    // FTS5 section
    if (result.sources.includes('fts5') && fts5Chunks.length > 0) {
      lines.push('\n### Code Chunks');
      for (const chunk of fts5Chunks.slice(0, 5)) {
        lines.push(`\n**${chunk.scope}** (${chunk.category}):\n${chunk.content.trim()}`);
      }
    }

    // Workspace-map section
    if (result.sources.includes('workspace-map') && mapChunks.length > 0) {
      lines.push('\n### Key Files');
      for (const chunk of mapChunks.slice(0, 5)) {
        lines.push(`- ${chunk.content.trim()}`);
      }
    }

    // Dir-dive section
    if (result.sources.includes('dir-dive') && diveChunks.length > 0) {
      lines.push('\n### Directory Summaries');
      for (const chunk of diveChunks.slice(0, 3)) {
        lines.push(`\n${chunk.content.trim()}`);
      }
    }

    // Confidence footer
    const pct = Math.round(result.confidence * 100);
    lines.push(`\n*Confidence: ${pct}%*`);

    const full = lines.join('\n');
    // Hard-truncate to 4000 chars
    if (full.length <= 4000) return full;
    return full.slice(0, 3997) + '...';
  }

  /**
   * Suggest target files for a focused read-only worker when RAG confidence
   * is low.  Applies three heuristics in priority order:
   *  1. Explicit file references found in the question (highest weight)
   *  2. Key files whose basename or purpose matches question keywords
   *  3. Files under directories whose name or purpose matches question keywords
   *
   * Returns up to 10 file paths, de-duplicated and ordered by relevance score.
   *
   * OB-1352
   */
  suggestTargetFiles(question: string, workspaceMap: WorkspaceMap): string[] {
    // ── Build term sets ───────────────────────────────────────────────────────
    // Explicit file references like "router.ts", "src/core/router.ts"
    const fileRefPattern = /\b[\w/.-]+\.\w{1,5}\b/g;
    const explicitRefs = (question.match(fileRefPattern) ?? []).map((r) => r.toLowerCase());

    // Module terms: non-stop-words >= 3 chars
    const moduleTerms = question
      .toLowerCase()
      .split(/[\s.,!?;:'"()[\]{}]+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));

    // Score map: filePath → cumulative score
    const scores = new Map<string, number>();
    const addScore = (path: string, points: number): void => {
      scores.set(path, (scores.get(path) ?? 0) + points);
    };

    // ── Heuristic 1: explicit file references ─────────────────────────────────
    for (const kf of workspaceMap.keyFiles) {
      const kfLower = kf.path.toLowerCase();
      for (const ref of explicitRefs) {
        if (kfLower.endsWith(ref) || kfLower.includes(ref)) {
          addScore(kf.path, 10);
          break;
        }
      }
    }
    for (const ep of workspaceMap.entryPoints) {
      const epLower = ep.toLowerCase();
      for (const ref of explicitRefs) {
        if (epLower.endsWith(ref) || epLower.includes(ref)) {
          addScore(ep, 10);
          break;
        }
      }
    }

    // ── Heuristic 2: key files matching question keywords ─────────────────────
    for (const kf of workspaceMap.keyFiles) {
      const kfLower = kf.path.toLowerCase();
      const baseName = nodePath.basename(kfLower);
      const baseNoExt = baseName.replace(/\.[^.]+$/, '');
      const purposeLower = kf.purpose.toLowerCase();
      for (const term of moduleTerms) {
        if (baseNoExt === term) {
          addScore(kf.path, 6); // exact basename match
        } else if (baseNoExt.includes(term) || kfLower.includes(term)) {
          addScore(kf.path, 3); // partial path match
        }
        if (purposeLower.includes(term)) {
          addScore(kf.path, 2); // purpose text match
        }
      }
    }

    // ── Heuristic 3: directories matching keywords → their key files ──────────
    for (const dir of Object.values(workspaceMap.structure)) {
      const dirPathLower = dir.path.toLowerCase();
      const dirNameLower = nodePath.basename(dirPathLower);
      const purposeLower = dir.purpose.toLowerCase();

      const dirMatch = moduleTerms.some(
        (t) => dirNameLower.includes(t) || purposeLower.includes(t),
      );
      if (!dirMatch) continue;

      // Promote key files that live under the matching directory
      for (const kf of workspaceMap.keyFiles) {
        const kfLower = kf.path.toLowerCase();
        if (kfLower.startsWith(dirPathLower + '/') || kfLower.includes('/' + dirPathLower + '/')) {
          addScore(kf.path, 4);
        }
      }
      // Promote entry points that reference the matching directory
      for (const ep of workspaceMap.entryPoints) {
        if (ep.toLowerCase().includes(dirPathLower)) {
          addScore(ep, 4);
        }
      }
    }

    // ── Sort, de-duplicate, limit to 10 ──────────────────────────────────────
    return [...scores.entries()]
      .filter(([, score]) => score > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([path]) => path);
  }

  /**
   * Store a worker's read result as a new chunk in the workspace knowledge
   * base. The chunk is tagged with source `'worker-read'` via `source_hash`
   * and embeds the originating question and file paths as a metadata header so
   * future FTS5 searches can surface the answer without re-spawning a worker.
   *
   * OB-1359
   */
  async storeWorkerResult(
    workerOutput: string,
    question: string,
    filePaths: string[],
  ): Promise<void> {
    if (!workerOutput.trim()) return;

    const entities = extractEntities(workerOutput);
    const allFilePaths = [...new Set([...filePaths, ...entities.filePaths])];

    const metaLines: string[] = [];
    if (question) metaLines.push(`Q: ${question}`);
    if (allFilePaths.length > 0) metaLines.push(`Files: ${allFilePaths.join(', ')}`);
    if (entities.functionNames.length > 0) {
      metaLines.push(`Functions: ${entities.functionNames.slice(0, 10).join(', ')}`);
    }
    if (entities.moduleNames.length > 0) {
      metaLines.push(`Modules: ${entities.moduleNames.slice(0, 10).join(', ')}`);
    }

    const content =
      metaLines.length > 0 ? `${metaLines.join('\n')}\n---\n${workerOutput}` : workerOutput;

    const scope = filePaths[0] ?? entities.filePaths[0] ?? 'worker-read';

    await this.memoryManager.storeChunks([
      {
        scope,
        category: 'patterns',
        content,
        source_hash: 'worker-read',
      },
    ]);
  }

  /**
   * Query the local knowledge store for information relevant to the given
   * question.  Returns a {@link KnowledgeResult} with matched chunks, a
   * confidence score, and the source types that contributed results.
   *
   * OB-1335: FTS5 chunk search — searches workspace_chunks via FTS5 MATCH and
   * returns up to 10 results ordered by BM25 rank score.
   * OB-1336: workspace map key-file matching.
   * OB-1337: dir-dive JSON loading.
   * OB-1338: confidence scoring + needsWorker flag.
   */
  async query(question: string): Promise<KnowledgeResult> {
    // --- Q&A cache check (OB-1362) ---
    const qaCache = this.getQACache();
    if (qaCache) {
      const [entry] = qaCache.findSimilar(question, 1);
      if (entry !== undefined) {
        const ageMs = entry.created_at
          ? Date.now() - new Date(entry.created_at).getTime()
          : Infinity;
        const withinTtl = ageMs <= 24 * 60 * 60 * 1000;
        if (entry.confidence >= 0.7 && withinTtl && entry.id !== undefined) {
          qaCache.incrementAccess(entry.id);
          return {
            chunks: [{ scope: 'qa-cache', category: 'patterns', content: entry.answer }],
            confidence: entry.confidence,
            sources: ['qa-cache'],
            needsWorker: false,
          };
        }
      }
    }

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

    // --- Confidence scoring (OB-1338) ---
    result.confidence = this.computeConfidence(result.chunks.length, result.sources.length);
    if (result.confidence < 0.3) {
      result.needsWorker = true;
    }

    return result;
  }
}
