/**
 * Exploration Coordinator — Multi-Agent Workspace Exploration
 *
 * Provides a 5-phase incremental exploration workflow with parallel workers:
 * 1. Structure Scan  (90s) — List files/dirs, count, detect configs
 * 2. Classification  (90s) — Determine project type, frameworks, commands
 * 3. Directory Dives (90s/dir) — Explore significant directories in parallel batches
 * 4. Assembly        (60s) — Merge partial results into workspace-map.json
 * 5. Finalization    (no AI) — Create agents.json, git commit, log entry
 *
 * Each pass is checkpointed to disk via exploration-state.json, making the
 * exploration fully resumable on restart. If interrupted at any point, the
 * coordinator resumes from the last completed phase.
 *
 * Batch size for directory dives adapts to project complexity:
 * - Small projects (<100 files): batch of 2
 * - Medium projects (100–500 files): batch of 3
 * - Large projects (500+ files): batch of 5
 *
 * **Usage:** Called by MasterManager during initial exploration and available
 * for programmatic use (testing, scripts).
 */

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DotFolderManager } from './dotfolder-manager.js';
import {
  generateStructureScanPrompt,
  generateClassificationPrompt,
  generateDirectoryDivePrompt,
  generateSummaryPrompt,
} from './exploration-prompts.js';
import { parseAIResult } from './result-parser.js';
import {
  AgentRunner,
  TOOLS_READ_ONLY,
  DEFAULT_MAX_TURNS_EXPLORATION,
} from '../core/agent-runner.js';
import type { CLIAdapter } from '../core/cli-adapter.js';
import {
  ExplorationStateSchema,
  StructureScanSchema,
  ClassificationSchema,
  DirectoryDiveResultSchema,
  WorkspaceMapSchema,
  type ExplorationState,
  type StructureScan,
  type Classification,
  type DirectoryDiveResult,
  type WorkspaceMap,
  type AgentsRegistry,
  type ExplorationSummary,
} from '../types/master.js';
import type { DiscoveredTool } from '../types/discovery.js';
import { createLogger } from '../core/logger.js';
import type { MemoryManager } from '../memory/index.js';
import type { Chunk } from '../memory/chunk-store.js';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const logger = createLogger('exploration-coordinator');

// Validation schemas for AI output — the coordinator overrides timestamps and durations after
// parsing (AI-generated datetimes often fail strict .datetime() validation), so those fields
// are made optional with defaults here to validate structure without false datetime failures.
// Cast to z.ZodType<T> because .optional().default() changes the _input type to `T | undefined`
// while the _output type remains T — the cast is safe since output shapes are identical.
const StructureScanAISchema = StructureScanSchema.extend({
  scannedAt: z.string().optional().default(''),
  durationMs: z.number().int().nonnegative().optional().default(0),
}) as z.ZodType<StructureScan>;

const ClassificationAISchema = ClassificationSchema.extend({
  classifiedAt: z.string().optional().default(''),
  durationMs: z.number().int().nonnegative().optional().default(0),
}) as z.ZodType<Classification>;

const DirectoryDiveResultAISchema = DirectoryDiveResultSchema.extend({
  exploredAt: z.string().optional().default(''),
  durationMs: z.number().int().nonnegative().optional().default(0),
}) as z.ZodType<DirectoryDiveResult>;

const PHASE_TIMEOUT = 300_000; // 5 minutes per phase (large workspaces need more time)
const DIRECTORY_DIVE_TIMEOUT = 180_000; // 3 minutes per directory dive
const MAX_DIRECTORY_DIVE_TIMEOUT = 600_000; // 10 minutes max per directory dive
const MAX_RETRIES = 3;

/** Directories with more files than this threshold are split into subdirectories. */
const FILE_COUNT_THRESHOLD = 25;

/** Directories that should never be explored (matches structure scan skip list). */
const SKIPPED_SUBDIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  '.next',
  'build',
  'coverage',
  'target',
  '.cache',
  '.openbridge',
  '__pycache__',
  '.tox',
  '.venv',
  'venv',
  '.mypy_cache',
  '.pytest_cache',
]);

/**
 * Progress callback for exploration phases.
 * Fired at the start and completion of each phase, and after each directory dive batch.
 */
export type ExplorationProgressCallback = (event: {
  phase: 'structure_scan' | 'classification' | 'directory_dives' | 'assembly' | 'finalization';
  status: 'starting' | 'completed';
  detail?: string;
  directoryProgress?: { completed: number; total: number; currentDir?: string };
}) => Promise<void>;

export interface ExplorationOptions {
  /** Absolute path to the workspace */
  workspacePath: string;
  /** The Master AI tool being used */
  masterTool: DiscoveredTool;
  /** All discovered AI tools (for agents.json) */
  discoveredTools: DiscoveredTool[];
  /** Optional callback for progress reporting */
  onProgress?: ExplorationProgressCallback;
  /** Override batch size for directory dives (default: auto-detected from project size) */
  batchSize?: number;
  /** Optional MemoryManager for storing exploration results as searchable chunks */
  memory?: MemoryManager;
  /**
   * Optional agent_activity.id for the explorer agent running this exploration.
   * When provided (and memory is set), exploration phases and directory dives are
   * tracked in the exploration_progress table for the "status" command.
   */
  explorationId?: string;
  /** CLI adapter for spawning worker agents (defaults to ClaudeAdapter) */
  adapter?: CLIAdapter;
}

/**
 * Multi-agent workspace exploration coordinator.
 *
 * Called by MasterManager during initial workspace exploration.
 * Also available for programmatic use and testing.
 */
export class ExplorationCoordinator {
  private readonly workspacePath: string;
  private readonly masterTool: DiscoveredTool;
  private readonly discoveredTools: DiscoveredTool[];
  private readonly dotFolder: DotFolderManager;
  private readonly agentRunner: AgentRunner;
  private readonly onProgress?: ExplorationProgressCallback;
  private readonly batchSizeOverride?: number;
  private readonly memory?: MemoryManager;
  private explorationId?: string;
  /** Maps directory path → exploration_progress row id for the directory-dive phase. */
  private readonly dirProgressIds = new Map<string, number>();
  /** Set to true if any storeExplorationChunks() call fails — checked at end of explore(). */
  private memoryWriteFailed = false;

  constructor(options: ExplorationOptions) {
    this.workspacePath = options.workspacePath;
    this.masterTool = options.masterTool;
    this.discoveredTools = options.discoveredTools;
    this.dotFolder = new DotFolderManager(this.workspacePath);
    this.agentRunner = new AgentRunner(options.adapter);
    this.onProgress = options.onProgress;
    this.batchSizeOverride = options.batchSize;
    this.memory = options.memory;
    this.explorationId = options.explorationId;
  }

  /**
   * Write exploration state to the DB (via MemoryManager) if available,
   * otherwise fall back to the dot-folder JSON file.
   */
  private async writeExplorationState(state: ExplorationState): Promise<void> {
    if (this.memory) {
      await this.memory.upsertExplorationState(state);
    } else {
      await this.dotFolder.writeExplorationState(state);
    }
  }

  /**
   * Read exploration state from the DB (via MemoryManager) if available.
   * Falls back to the dot-folder JSON file for one-time migration when the
   * DB entry does not yet exist.
   */
  private async readExplorationStateFromStore(): Promise<ExplorationState | null> {
    if (!this.memory) {
      return this.dotFolder.readExplorationState();
    }
    const raw = await this.memory.getExplorationState();
    if (raw !== null) {
      try {
        return ExplorationStateSchema.parse(JSON.parse(raw));
      } catch {
        // Corrupt DB entry — fall through to JSON migration fallback
      }
    }
    // Migration fallback: read from JSON file once (first run after upgrade)
    return this.dotFolder.readExplorationState();
  }

  /**
   * Write structure scan to the DB (via MemoryManager) if available,
   * otherwise fall back to the dot-folder JSON file.
   */
  private async writeStructureScanToStore(scan: StructureScan): Promise<void> {
    if (this.memory) {
      await this.memory.upsertStructureScan(scan);
    } else {
      await this.dotFolder.writeStructureScan(scan);
    }
  }

  /**
   * Read structure scan from the DB (via MemoryManager) if available.
   * Falls back to the dot-folder JSON file for one-time migration.
   */
  private async readStructureScanFromStore(): Promise<StructureScan | null> {
    if (!this.memory) {
      return this.dotFolder.readStructureScan();
    }
    const raw = await this.memory.getStructureScan();
    if (raw !== null) {
      try {
        return StructureScanSchema.parse(JSON.parse(raw));
      } catch {
        // Corrupt DB entry — fall through to JSON migration fallback
      }
    }
    return this.dotFolder.readStructureScan();
  }

  /**
   * Write classification to the DB (via MemoryManager) if available,
   * otherwise fall back to the dot-folder JSON file.
   */
  private async writeClassificationToStore(classification: Classification): Promise<void> {
    if (this.memory) {
      await this.memory.upsertClassification(classification);
    } else {
      await this.dotFolder.writeClassification(classification);
    }
  }

  /**
   * Read classification from the DB (via MemoryManager) if available.
   * Falls back to the dot-folder JSON file for one-time migration.
   */
  private async readClassificationFromStore(): Promise<Classification | null> {
    if (!this.memory) {
      return this.dotFolder.readClassification();
    }
    const raw = await this.memory.getClassification();
    if (raw !== null) {
      try {
        return ClassificationSchema.parse(JSON.parse(raw));
      } catch {
        // Corrupt DB entry — fall through to JSON migration fallback
      }
    }
    return this.dotFolder.readClassification();
  }

  /**
   * Write a directory dive result to the DB (via MemoryManager) if available,
   * otherwise fall back to the dot-folder JSON file.
   */
  private async writeDirectoryDiveToStore(
    dirName: string,
    dive: DirectoryDiveResult,
  ): Promise<void> {
    if (this.memory) {
      await this.memory.upsertDirectoryDive(dirName, dive);
    } else {
      await this.dotFolder.writeDirectoryDive(dirName, dive);
    }
  }

  /**
   * Read a directory dive result from the DB (via MemoryManager) if available.
   * Falls back to the dot-folder JSON file for one-time migration.
   */
  private async readDirectoryDiveFromStore(dirName: string): Promise<DirectoryDiveResult | null> {
    if (!this.memory) {
      return this.dotFolder.readDirectoryDive(dirName);
    }
    const raw = await this.memory.getDirectoryDive(dirName);
    if (raw !== null) {
      try {
        return DirectoryDiveResultSchema.parse(JSON.parse(raw));
      } catch {
        // Corrupt DB entry — fall through to JSON migration fallback
      }
    }
    return this.dotFolder.readDirectoryDive(dirName);
  }

  /**
   * Get the current git commit hash for use as source_hash in chunks.
   * Returns an empty string if git is unavailable or there are no commits.
   */
  private getSourceHash(): string {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: this.workspacePath,
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
    } catch {
      return '';
    }
  }

  /**
   * Split a long text into chunks of at most `maxChars` characters.
   * Prefers splitting on newline boundaries to keep content coherent.
   * ~500 tokens ≈ 2000 characters (assuming 4 chars/token average).
   */
  private splitIntoChunks(text: string, maxChars = 2000): string[] {
    if (text.length <= maxChars) return text.trim() ? [text] : [];

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + maxChars;
      if (end >= text.length) {
        const slice = text.slice(start).trim();
        if (slice) chunks.push(slice);
        break;
      }
      // Prefer splitting at a newline boundary
      const lastNewline = text.lastIndexOf('\n', end);
      if (lastNewline > start) {
        end = lastNewline + 1;
      }
      const slice = text.slice(start, end).trim();
      if (slice) chunks.push(slice);
      start = end;
    }

    return chunks;
  }

  /**
   * Convert exploration result data to text chunks and store in MemoryManager.
   * Falls back silently (logs a debug warning) if memory is unavailable or fails.
   */
  private async storeExplorationChunks(
    scope: string,
    category: Chunk['category'],
    data: unknown,
  ): Promise<void> {
    if (!this.memory) return;

    try {
      const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
      const sourceHash = this.getSourceHash();
      const textChunks = this.splitIntoChunks(text);

      if (textChunks.length === 0) return;

      const chunks: Chunk[] = textChunks.map((content) => ({
        scope,
        category,
        content,
        source_hash: sourceHash || undefined,
      }));

      await this.memory.deleteChunksByScope(scope);
      await this.memory.storeChunks(chunks);
      logger.debug(
        { scope, category, chunkCount: chunks.length },
        'Stored exploration chunks in memory',
      );
    } catch (err) {
      logger.warn({ err, scope, category }, 'Failed to store exploration chunks — continuing');
      this.memoryWriteFailed = true;
    }
  }

  /**
   * Calculate optimal batch size based on project complexity.
   * Small projects get fewer parallel workers, large projects get more.
   */
  private calculateBatchSize(structureScan: StructureScan): number {
    if (this.batchSizeOverride) return this.batchSizeOverride;

    const totalFiles = structureScan.totalFiles;
    const dirCount = structureScan.topLevelDirs.length;

    if (totalFiles < 100 && dirCount <= 5) return 2; // Small project
    if (totalFiles < 500 && dirCount <= 15) return 3; // Medium project
    return 5; // Large project — maximize parallelism
  }

  /**
   * Expand large directories into their immediate subdirectories.
   *
   * For each top-level directory whose file count exceeds `FILE_COUNT_THRESHOLD`,
   * read its immediate children, filter out skipped dirs, and return a mapping
   * of parent → sub-paths.  The sub-paths replace the parent in the dive list
   * so each gets its own worker with a manageable scope.
   *
   * Mutates `structureScan.splitDirs` with the mapping and updates
   * `structureScan.directoryCounts` with estimated file counts for subdirs.
   */
  async expandLargeDirectories(structureScan: StructureScan): Promise<string[]> {
    const expandedDirs: string[] = [];

    for (const dir of structureScan.topLevelDirs) {
      const fileCount = structureScan.directoryCounts[dir] ?? 0;

      if (fileCount <= FILE_COUNT_THRESHOLD) {
        // Small enough — keep as single dive target
        expandedDirs.push(dir);
        continue;
      }

      // Large directory — read immediate subdirectories
      const fullDirPath = path.join(this.workspacePath, dir);
      try {
        const entries = await readdir(fullDirPath, { withFileTypes: true });
        const subDirs: string[] = [];

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (SKIPPED_SUBDIRS.has(entry.name)) continue;
          if (entry.name.startsWith('.')) continue; // skip hidden dirs

          const subPath = `${dir}/${entry.name}`;
          subDirs.push(subPath);

          // Estimate file count for the subdirectory via stat
          try {
            const subFullPath = path.join(fullDirPath, entry.name);
            const subEntries = await readdir(subFullPath, { withFileTypes: true });
            const subFileCount =
              subEntries.filter((e) => e.isFile()).length +
              subEntries.filter((e) => e.isDirectory() && !SKIPPED_SUBDIRS.has(e.name)).length * 5;
            structureScan.directoryCounts[subPath] = subFileCount;
          } catch {
            // If we can't read it, give it a default estimate
            structureScan.directoryCounts[subPath] = 10;
          }
        }

        if (subDirs.length > 0) {
          structureScan.splitDirs[dir] = subDirs;
          expandedDirs.push(...subDirs);
          logger.info(
            { dir, fileCount, subDirs: subDirs.length },
            'Large directory split into subdirectories for exploration',
          );
        } else {
          // No valid subdirs found — keep original
          expandedDirs.push(dir);
        }
      } catch (err) {
        logger.warn({ err, dir }, 'Failed to read directory for splitting — keeping original');
        expandedDirs.push(dir);
      }
    }

    return expandedDirs;
  }

  /**
   * Calculate a per-directory timeout based on its file count.
   * Floors at DIRECTORY_DIVE_TIMEOUT (3 min), caps at MAX_DIRECTORY_DIVE_TIMEOUT (10 min).
   */
  calculateDiveTimeout(dirFileCount: number): number {
    return Math.max(
      DIRECTORY_DIVE_TIMEOUT,
      Math.min(MAX_DIRECTORY_DIVE_TIMEOUT, dirFileCount * 4000),
    );
  }

  /**
   * Main entry point: Execute the 5-phase exploration workflow
   *
   * This method loads/creates exploration-state.json, skips completed phases,
   * runs each pass via AgentRunner.spawn(), parses results with result-parser,
   * and checkpoints after each pass.
   *
   * If exploration is already complete, returns the existing summary.
   * If interrupted mid-exploration, resumes from the last checkpoint.
   *
   * @returns ExplorationSummary with completion details
   */
  public async explore(): Promise<ExplorationSummary> {
    logger.info({ workspacePath: this.workspacePath }, 'Starting incremental exploration');

    // Ensure .openbridge/ and exploration/ directories exist
    await this.dotFolder.initialize();
    await this.dotFolder.createExplorationDir();

    // Auto-register an agent_activity row so exploration_progress rows have a
    // valid FK parent.  Only needed when the caller did not supply explorationId.
    if (this.memory && !this.explorationId) {
      const id = randomUUID();
      try {
        await this.memory.insertActivity({
          id,
          type: 'explorer',
          status: 'running',
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        this.explorationId = id;
      } catch {
        // exploration_progress tracking unavailable — continue without it
      }
    }

    // Load or create exploration state
    let state = await this.readExplorationStateFromStore();

    if (!state) {
      logger.info('No existing exploration state found, creating fresh state');
      state = this.createInitialState();
      await this.writeExplorationState(state);
    }

    // If exploration is already complete, return summary
    if (state.status === 'completed') {
      logger.info('Exploration already completed, returning cached summary');
      return this.buildSummary(state);
    }

    // If exploration failed previously, reset to allow retry
    if (state.status === 'failed') {
      logger.info('Previous exploration failed, resetting to retry');
      state = this.createInitialState();
      await this.writeExplorationState(state);
    }

    try {
      // Execute each phase sequentially with progress reporting
      await this.emitProgress('structure_scan', 'starting');
      await this.executePhase1StructureScan(state);
      await this.emitProgress('structure_scan', 'completed');

      await this.emitProgress('classification', 'starting');
      await this.executePhase2Classification(state);
      await this.emitProgress('classification', 'completed');

      await this.emitProgress('directory_dives', 'starting');
      await this.executePhase3DirectoryDives(state);
      await this.emitProgress('directory_dives', 'completed');

      await this.emitProgress('assembly', 'starting');
      await this.executePhase4Assembly(state);
      await this.emitProgress('assembly', 'completed');

      await this.emitProgress('finalization', 'starting');
      await this.executePhase5Finalization(state);
      await this.emitProgress('finalization', 'completed');

      // Mark as completed
      state.status = 'completed';
      state.completedAt = new Date().toISOString();
      await this.writeExplorationState(state);

      logger.info(
        {
          totalCalls: state.totalCalls,
          totalAITimeMs: state.totalAITimeMs,
          duration: Date.now() - new Date(state.startedAt).getTime(),
        },
        'Exploration completed successfully',
      );

      if (this.memoryWriteFailed) {
        logger.error(
          'Exploration completed but memory writes failed — results may be incomplete. JSON fallback on disk was used.',
        );
      }

      return this.buildSummary(state);
    } catch (error) {
      logger.error({ err: error }, 'Exploration failed');
      state.status = 'failed';
      state.error = String(error);
      await this.writeExplorationState(state);
      throw error;
    }
  }

  /**
   * Re-explore only the directories that have stale chunks in the MemoryManager.
   *
   * Called after workspace changes have been detected and the affected scopes
   * have been marked stale via `memory.markStale(changedScopes)`. This avoids
   * a full 5-phase re-exploration when only a subset of directories changed.
   *
   * Flow:
   * 1. Query the DB for scopes with stale=1 chunks.
   * 2. Filter to directory scopes (skip '.' root which belongs to structure/assembly passes).
   * 3. Run directory dives in parallel batches (reusing executeSingleDirectoryDive).
   * 4. Delete all stale chunks so the DB reflects only the fresh data.
   *
   * Falls back gracefully (logs a warning) if:
   * - No MemoryManager is configured.
   * - No classification exists (needed for context in dive prompts).
   * - Individual directory dives fail (those scopes remain stale until next run).
   */
  public async reexploreStaleDirs(): Promise<void> {
    if (!this.memory) {
      logger.debug('reexploreStaleDirs: no MemoryManager — skipping');
      return;
    }

    const staleScopes = await this.memory.getStaleScopes();
    if (staleScopes.length === 0) {
      logger.info('No stale directory scopes — skipping partial re-exploration');
      return;
    }

    logger.info({ staleScopes }, 'Partial re-exploration: found stale scopes');

    // Track the overall stale-reexplore phase in exploration_progress
    let parentRowId = 0;
    if (this.memory && this.explorationId) {
      try {
        parentRowId = await this.memory.insertExplorationProgress({
          exploration_id: this.explorationId,
          phase: 'stale-reexplore',
          target: null,
          status: 'in_progress',
          progress_pct: 0,
          files_processed: 0,
          files_total: null,
          started_at: new Date().toISOString(),
        });
      } catch {
        // ignore — progress tracking is best-effort
      }
    }

    // Classification is required for the dive prompts (project type + frameworks)
    const classification = await this.readClassificationFromStore();
    if (!classification) {
      logger.warn('No classification found for partial re-exploration — skipping');
      await this.failPhaseRow(parentRowId);
      return;
    }

    const context = {
      projectType: classification.projectType,
      frameworks: classification.frameworks,
    };

    // Load (or create) an exploration state so executeSingleDirectoryDive can
    // update counters (totalCalls, totalAITimeMs) without throwing.
    let state = await this.readExplorationStateFromStore();
    if (!state) {
      state = this.createInitialState();
    }

    // Only re-explore real directory scopes; '.' is the root scope handled by
    // the structure-scan and assembly phases, not directory dives.
    const dirScopes = staleScopes.filter((s) => s !== '.');

    const batchSize = 3;
    for (let i = 0; i < dirScopes.length; i += batchSize) {
      const batch = dirScopes.slice(i, i + batchSize);
      await Promise.allSettled(
        batch.map(async (scope) => {
          // Insert a per-directory progress row
          let dirRowId = 0;
          if (this.memory && this.explorationId) {
            try {
              dirRowId = await this.memory.insertExplorationProgress({
                exploration_id: this.explorationId,
                phase: 'directory-dive',
                target: scope,
                status: 'in_progress',
                progress_pct: 0,
                files_processed: 0,
                files_total: null,
                started_at: new Date().toISOString(),
              });
            } catch {
              // ignore — progress tracking is best-effort
            }
          }

          try {
            await this.executeSingleDirectoryDive(scope, context, state);
            logger.info({ scope }, 'Stale scope successfully re-explored');
            await this.completePhaseRow(dirRowId);
          } catch (err) {
            logger.warn({ err, scope }, 'Failed to re-explore stale scope — continuing');
            await this.failPhaseRow(dirRowId);
          }
        }),
      );
    }

    // Delete stale chunks now that fresh replacements are stored.
    try {
      await this.memory.deleteStaleChunks();
      logger.info('Stale chunks deleted — incremental chunk refresh complete');
    } catch (err) {
      logger.warn({ err }, 'Failed to delete stale chunks after re-exploration');
    }

    // Mark the parent stale-reexplore phase as completed
    await this.completePhaseRow(parentRowId);
  }

  /**
   * Phase 1: Structure Scan
   * Lists top-level files/dirs, counts files per directory, detects config files
   */
  private async executePhase1StructureScan(state: ExplorationState): Promise<void> {
    if (state.phases.structure_scan === 'completed') {
      logger.info('Phase 1 (Structure Scan) already completed, skipping');
      return;
    }

    logger.info('Starting Phase 1: Structure Scan');
    state.currentPhase = 'structure_scan';
    state.phases.structure_scan = 'in_progress';
    await this.writeExplorationState(state);

    const phase1RowId = await this.insertPhaseRow('structure');
    const prompt = generateStructureScanPrompt(this.workspacePath);
    const startTime = Date.now();

    const result = await this.agentRunner.spawn({
      prompt,
      workspacePath: this.workspacePath,
      timeout: PHASE_TIMEOUT,
      allowedTools: [...TOOLS_READ_ONLY],
      maxTurns: DEFAULT_MAX_TURNS_EXPLORATION,
      retries: 0,
    });

    const elapsed = Date.now() - startTime;
    state.totalCalls++;
    state.totalAITimeMs += elapsed;

    if (result.exitCode !== 0) {
      await this.failPhaseRow(phase1RowId);
      throw new Error(`Structure scan failed with exit code ${result.exitCode}: ${result.stderr}`);
    }

    const parsed = parseAIResult<StructureScan>(
      result.stdout,
      'structure scan',
      StructureScanAISchema,
    );
    if (!parsed.success) {
      await this.failPhaseRow(phase1RowId);
      throw new Error(`Failed to parse structure scan result: ${parsed.error}`);
    }

    // Override scannedAt with a proper ISO 8601 datetime — AI-generated values
    // often fail Zod's strict .datetime() validation
    parsed.data.scannedAt = new Date().toISOString();
    parsed.data.durationMs = elapsed;

    await this.writeStructureScanToStore(parsed.data);
    await this.storeExplorationChunks('.', 'structure', parsed.data);
    state.phases.structure_scan = 'completed';
    await this.writeExplorationState(state);
    await this.completePhaseRow(phase1RowId);

    logger.info({ elapsed, method: parsed.method }, 'Phase 1 completed');
  }

  /**
   * Phase 2: Classification
   * Reads config files, determines project type, frameworks, commands, dependencies
   */
  private async executePhase2Classification(state: ExplorationState): Promise<void> {
    if (state.phases.classification === 'completed') {
      logger.info('Phase 2 (Classification) already completed, skipping');
      return;
    }

    logger.info('Starting Phase 2: Classification');
    state.currentPhase = 'classification';
    state.phases.classification = 'in_progress';
    await this.writeExplorationState(state);

    const phase2RowId = await this.insertPhaseRow('classification');
    const structureScan = await this.readStructureScanFromStore();
    if (!structureScan) {
      await this.failPhaseRow(phase2RowId);
      throw new Error('Structure scan result not found (Phase 1 incomplete)');
    }

    const prompt = generateClassificationPrompt(this.workspacePath, structureScan);
    const startTime = Date.now();

    const result = await this.agentRunner.spawn({
      prompt,
      workspacePath: this.workspacePath,
      timeout: PHASE_TIMEOUT,
      allowedTools: [...TOOLS_READ_ONLY],
      maxTurns: DEFAULT_MAX_TURNS_EXPLORATION,
      retries: 0,
    });

    const elapsed = Date.now() - startTime;
    state.totalCalls++;
    state.totalAITimeMs += elapsed;

    if (result.exitCode !== 0) {
      await this.failPhaseRow(phase2RowId);
      throw new Error(`Classification failed with exit code ${result.exitCode}: ${result.stderr}`);
    }

    const parsed = parseAIResult<Classification>(
      result.stdout,
      'classification',
      ClassificationAISchema,
    );
    if (!parsed.success) {
      await this.failPhaseRow(phase2RowId);
      throw new Error(`Failed to parse classification result: ${parsed.error}`);
    }

    // Override classifiedAt with a proper ISO 8601 datetime — AI-generated values
    // often fail Zod's strict .datetime() validation
    parsed.data.classifiedAt = new Date().toISOString();
    parsed.data.durationMs = elapsed;

    await this.writeClassificationToStore(parsed.data);
    await this.storeExplorationChunks('.', 'config', parsed.data);
    state.phases.classification = 'completed';
    await this.writeExplorationState(state);
    await this.completePhaseRow(phase2RowId);

    logger.info({ elapsed, method: parsed.method }, 'Phase 2 completed');
  }

  /**
   * Phase 3: Directory Dives
   * Explores each significant directory in batches of 3 with automatic retries
   */
  private async executePhase3DirectoryDives(state: ExplorationState): Promise<void> {
    if (state.phases.directory_dives === 'completed') {
      logger.info('Phase 3 (Directory Dives) already completed, skipping');
      return;
    }

    logger.info('Starting Phase 3: Directory Dives');
    state.currentPhase = 'directory_dives';
    state.phases.directory_dives = 'in_progress';
    await this.writeExplorationState(state);

    const structureScan = await this.readStructureScanFromStore();
    const classification = await this.readClassificationFromStore();

    if (!structureScan || !classification) {
      throw new Error('Structure scan or classification not found (Phases 1-2 incomplete)');
    }

    // Identify significant directories (exclude root, include dirs with files > 0)
    // Then expand large directories into subdirectories to avoid timeout (OB-F26)
    const significantDirs = await this.expandLargeDirectories(structureScan);

    // Persist splitDirs so incremental explore can use 2-level scopes
    if (Object.keys(structureScan.splitDirs).length > 0) {
      await this.writeStructureScanToStore(structureScan);
      logger.info(
        { splitDirs: structureScan.splitDirs },
        'Structure scan updated with split directories',
      );
    }

    // Initialize directory dive tracking if not already present
    if (state.directoryDives.length === 0) {
      state.directoryDives = significantDirs.map((dir) => ({
        path: dir,
        status: 'pending' as const,
        attempts: 0,
        fileCount: structureScan.directoryCounts[dir] ?? 0,
      }));
      await this.writeExplorationState(state);
    }

    // Insert exploration_progress rows for each directory (status=pending).
    // Already-tracked dirs (from a resumed run) are skipped via the map check.
    if (this.memory && this.explorationId) {
      for (const dir of significantDirs) {
        if (this.dirProgressIds.has(dir)) continue; // already inserted this run
        const filesTotal = structureScan.directoryCounts[dir] ?? null;
        try {
          const rowId = await this.memory.insertExplorationProgress({
            exploration_id: this.explorationId,
            phase: 'directory-dive',
            target: dir,
            status: 'pending',
            progress_pct: 0,
            files_processed: 0,
            files_total: filesTotal,
            started_at: null,
          });
          this.dirProgressIds.set(dir, rowId);
        } catch {
          // ignore — progress tracking is best-effort
        }
      }
    }

    const context = {
      projectType: classification.projectType,
      frameworks: classification.frameworks,
    };

    // Adaptive batch size based on project complexity
    const batchSize = this.calculateBatchSize(structureScan);
    logger.info(
      { batchSize, totalFiles: structureScan.totalFiles, dirs: significantDirs.length },
      'Adaptive batch size calculated',
    );

    // Process directories in parallel batches
    const pendingDives = state.directoryDives.filter((dive) => dive.status !== 'completed');
    const totalDirs = state.directoryDives.length;
    let completedSoFar = state.directoryDives.filter((d) => d.status === 'completed').length;

    for (let i = 0; i < pendingDives.length; i += batchSize) {
      const batch = pendingDives.slice(i, i + batchSize);
      logger.info(
        { batchStart: i, batchSize: batch.length, totalDirs },
        'Processing directory batch',
      );

      const results = await Promise.allSettled(
        batch.map((dive) => this.executeSingleDirectoryDive(dive.path, context, state)),
      );

      // Update state based on results
      results.forEach((result, idx) => {
        const dive = batch[idx];
        if (!dive) return;

        const diveState = state.directoryDives.find((d) => d.path === dive.path);
        if (!diveState) return;

        if (result.status === 'fulfilled') {
          diveState.status = 'completed';
          diveState.outputFile = `dirs/${dive.path}.json`;
          completedSoFar++;
        } else {
          diveState.attempts++;
          if (diveState.attempts >= MAX_RETRIES) {
            diveState.status = 'failed';
            diveState.error = String(result.reason);
            completedSoFar++; // Count failed as "done" for progress
            // Mark the exploration_progress row as failed
            const rowId = this.dirProgressIds.get(dive.path) ?? 0;
            if (rowId > 0 && this.memory) {
              this.memory
                .updateExplorationProgressById(rowId, {
                  status: 'failed',
                  completed_at: new Date().toISOString(),
                })
                .catch(() => {
                  // ignore — progress tracking is best-effort
                });
            }
            logger.warn(
              { path: dive.path, error: result.reason },
              'Directory dive failed after retries',
            );
          } else {
            diveState.status = 'pending';
            logger.info(
              { path: dive.path, attempts: diveState.attempts },
              'Directory dive failed, will retry',
            );
          }
        }
      });

      await this.writeExplorationState(state);

      // Emit per-batch directory progress
      await this.emitProgress('directory_dives', 'starting', undefined, {
        completed: completedSoFar,
        total: totalDirs,
        currentDir: batch[batch.length - 1]?.path,
      });
    }

    // Check if all dives completed or failed
    const incompleteDives = state.directoryDives.filter(
      (dive) => dive.status !== 'completed' && dive.status !== 'failed',
    );

    if (incompleteDives.length > 0) {
      throw new Error(`Directory dives incomplete: ${incompleteDives.length} pending`);
    }

    state.phases.directory_dives = 'completed';
    await this.writeExplorationState(state);

    logger.info('Phase 3 completed');
  }

  /**
   * Execute a single directory dive with retry logic
   */
  private async executeSingleDirectoryDive(
    dirPath: string,
    context: { projectType: string; frameworks: string[] },
    state: ExplorationState,
  ): Promise<void> {
    // Mark this directory as in_progress in exploration_progress
    const progressRowId = this.dirProgressIds.get(dirPath) ?? 0;
    if (progressRowId > 0 && this.memory) {
      try {
        await this.memory.updateExplorationProgressById(progressRowId, {
          status: 'in_progress',
          started_at: new Date().toISOString(),
        });
      } catch {
        // ignore — progress tracking is best-effort
      }
    }

    const prompt = generateDirectoryDivePrompt(this.workspacePath, dirPath, context);
    const startTime = Date.now();

    // Scale timeout based on directory file count (OB-F26 / OB-943)
    const dirFileCount = state.directoryDives.find((d) => d.path === dirPath)?.fileCount ?? 0;
    const diveTimeout =
      dirFileCount > 0 ? this.calculateDiveTimeout(dirFileCount) : DIRECTORY_DIVE_TIMEOUT;

    const result = await this.agentRunner.spawn({
      prompt,
      workspacePath: this.workspacePath,
      timeout: diveTimeout,
      allowedTools: [...TOOLS_READ_ONLY],
      maxTurns: DEFAULT_MAX_TURNS_EXPLORATION,
      retries: 0,
    });

    const elapsed = Date.now() - startTime;
    state.totalCalls++;
    state.totalAITimeMs += elapsed;

    if (result.exitCode !== 0) {
      throw new Error(
        `Directory dive for ${dirPath} failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }

    const parsed = parseAIResult<DirectoryDiveResult>(
      result.stdout,
      `directory dive: ${dirPath}`,
      DirectoryDiveResultAISchema,
    );
    if (!parsed.success) {
      throw new Error(`Failed to parse directory dive result for ${dirPath}: ${parsed.error}`);
    }

    // Override exploredAt with a proper ISO 8601 datetime — AI-generated values
    // often fail Zod's strict .datetime() validation
    parsed.data.exploredAt = new Date().toISOString();
    parsed.data.durationMs = elapsed;

    // Sanitize directory name for filename (replace / with -)
    const safeDirName = dirPath.replace(/\//g, '-');
    await this.writeDirectoryDiveToStore(safeDirName, parsed.data);
    await this.storeExplorationChunks(dirPath, 'patterns', parsed.data);

    // Mark this directory as completed in exploration_progress
    if (progressRowId > 0 && this.memory) {
      try {
        await this.memory.updateExplorationProgressById(progressRowId, {
          status: 'completed',
          progress_pct: 100,
          files_processed: parsed.data.fileCount,
          completed_at: new Date().toISOString(),
        });
      } catch {
        // ignore — progress tracking is best-effort
      }
    }

    logger.info({ dirPath, elapsed, method: parsed.method }, 'Directory dive completed');
  }

  /**
   * Phase 4: Assembly
   * Merges partial results into workspace-map.json and generates summary
   */
  private async executePhase4Assembly(state: ExplorationState): Promise<void> {
    if (state.phases.assembly === 'completed') {
      logger.info('Phase 4 (Assembly) already completed, skipping');
      return;
    }

    logger.info('Starting Phase 4: Assembly');
    state.currentPhase = 'assembly';
    state.phases.assembly = 'in_progress';
    await this.writeExplorationState(state);

    const phase4RowId = await this.insertPhaseRow('assembly');
    const structureScan = await this.readStructureScanFromStore();
    const classification = await this.readClassificationFromStore();

    if (!structureScan || !classification) {
      await this.failPhaseRow(phase4RowId);
      throw new Error('Structure scan or classification not found');
    }

    // Read all directory dive results
    const completedDives = state.directoryDives.filter((dive) => dive.status === 'completed');
    const diveResults: DirectoryDiveResult[] = [];

    for (const dive of completedDives) {
      const safeDirName = dive.path.replace(/\//g, '-');
      const result = await this.readDirectoryDiveFromStore(safeDirName);
      if (result) {
        diveResults.push(result);
      }
    }

    // Mechanically assemble partial workspace map
    const structure: Record<string, { path: string; purpose: string; fileCount?: number }> = {};
    const keyFiles: Array<{ path: string; type: string; purpose: string }> = [];

    for (const dive of diveResults) {
      structure[dive.path] = {
        path: dive.path,
        purpose: dive.purpose,
        fileCount: dive.fileCount,
      };

      // Add key files from this directory
      keyFiles.push(...dive.keyFiles);
    }

    const partialMap = {
      projectType: classification.projectType,
      projectName: classification.projectName,
      frameworks: classification.frameworks,
      structure,
      keyFiles,
      commands: classification.commands,
    };

    // Generate summary via AI
    const prompt = generateSummaryPrompt(this.workspacePath, partialMap);
    const startTime = Date.now();

    const result = await this.agentRunner.spawn({
      prompt,
      workspacePath: this.workspacePath,
      timeout: PHASE_TIMEOUT,
      allowedTools: [...TOOLS_READ_ONLY],
      maxTurns: DEFAULT_MAX_TURNS_EXPLORATION,
      retries: 0,
    });

    const elapsed = Date.now() - startTime;
    state.totalCalls++;
    state.totalAITimeMs += elapsed;

    if (result.exitCode !== 0) {
      await this.failPhaseRow(phase4RowId);
      throw new Error(
        `Summary generation failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }

    const parsed = parseAIResult<{ summary: string }>(result.stdout, 'summary generation');
    if (!parsed.success) {
      await this.failPhaseRow(phase4RowId);
      throw new Error(`Failed to parse summary result: ${parsed.error}`);
    }

    // Assemble final workspace map
    const workspaceMap: WorkspaceMap = {
      workspacePath: this.workspacePath,
      projectName: classification.projectName,
      projectType: classification.projectType,
      frameworks: classification.frameworks,
      structure,
      keyFiles,
      entryPoints: [], // Can be extracted from keyFiles or left empty
      commands: classification.commands,
      dependencies: classification.dependencies,
      summary: parsed.data.summary,
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
    };

    // Write workspace map to DB (primary) and JSON file (safety net fallback).
    if (this.memory) {
      await this.memory.storeChunks([
        {
          scope: '_workspace_map',
          category: 'structure',
          content: JSON.stringify(workspaceMap),
        },
      ]);
    } else {
      logger.warn('Memory not available — workspace map will only be saved to JSON fallback');
    }
    // Always write JSON fallback so workspace-map.json exists on disk regardless of memory state.
    try {
      await this.dotFolder.writeWorkspaceMap(workspaceMap);
    } catch (err) {
      logger.warn({ err }, 'Failed to write workspace-map.json JSON fallback');
    }
    await this.storeExplorationChunks('.', 'structure', workspaceMap);
    state.phases.assembly = 'completed';
    await this.writeExplorationState(state);
    await this.completePhaseRow(phase4RowId);

    logger.info({ elapsed, method: parsed.method }, 'Phase 4 completed');
  }

  /**
   * Phase 5: Finalization
   * Creates agents.json, commits to git, writes log entry (no AI calls)
   */
  private async executePhase5Finalization(state: ExplorationState): Promise<void> {
    if (state.phases.finalization === 'completed') {
      logger.info('Phase 5 (Finalization) already completed, skipping');
      return;
    }

    logger.info('Starting Phase 5: Finalization');
    state.currentPhase = 'finalization';
    state.phases.finalization = 'in_progress';
    await this.writeExplorationState(state);

    // Create agents.json
    const agentsRegistry: AgentsRegistry = {
      master: {
        name: this.masterTool.name,
        path: this.masterTool.path,
        version: this.masterTool.version || 'unknown',
        role: 'master',
      },
      specialists: this.discoveredTools
        .filter((tool) => tool.name !== this.masterTool.name)
        .map((tool) => ({
          name: tool.name,
          path: tool.path,
          version: tool.version || 'unknown',
          role: 'specialist' as const,
          capabilities: tool.capabilities || [],
        })),
      updatedAt: new Date().toISOString(),
    };

    if (this.memory) {
      await this.memory.setSystemConfig('agents', JSON.stringify(agentsRegistry));
    } else {
      await this.dotFolder.writeAgents(agentsRegistry);
    }

    // Log entry
    if (this.memory) {
      await this.memory.logExploration(
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Incremental exploration completed successfully',
          data: {
            totalCalls: state.totalCalls,
            totalAITimeMs: state.totalAITimeMs,
            phases: state.phases,
            directoriesExplored: state.directoryDives.filter((d) => d.status === 'completed')
              .length,
          },
        },
        this.explorationId,
      );
    } else {
      await this.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Incremental exploration completed successfully',
        data: {
          totalCalls: state.totalCalls,
          totalAITimeMs: state.totalAITimeMs,
          phases: state.phases,
          directoriesExplored: state.directoryDives.filter((d) => d.status === 'completed').length,
        },
      });
    }

    state.phases.finalization = 'completed';
    await this.writeExplorationState(state);

    logger.info('Phase 5 completed');
  }

  /**
   * Create initial exploration state
   */
  private createInitialState(): ExplorationState {
    return {
      currentPhase: 'structure_scan',
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      phases: {
        structure_scan: 'pending',
        classification: 'pending',
        directory_dives: 'pending',
        assembly: 'pending',
        finalization: 'pending',
      },
      directoryDives: [],
      totalCalls: 0,
      totalAITimeMs: 0,
    };
  }

  /**
   * Build ExplorationSummary from final state
   */
  private async buildSummary(state: ExplorationState): Promise<ExplorationSummary> {
    // Read workspace map from DB (OB-810: JSON fallback removed).
    let map: WorkspaceMap | null = null;
    if (this.memory) {
      try {
        const chunks = await this.memory.getChunksByScope('_workspace_map', 'structure');
        if (chunks.length > 0 && chunks[0]?.content) {
          map = WorkspaceMapSchema.parse(JSON.parse(chunks[0].content));
        }
      } catch {
        // ignore — map not yet stored
      }
    }
    const classification = await this.readClassificationFromStore();

    return {
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      status:
        state.status === 'completed'
          ? 'completed'
          : state.status === 'failed'
            ? 'failed'
            : 'in_progress',
      filesScanned: 0, // Not tracked in incremental flow
      directoriesExplored: state.directoryDives.filter((d) => d.status === 'completed').length,
      projectType: classification?.projectType ?? map?.projectType,
      frameworks: classification?.frameworks ?? map?.frameworks ?? [],
      insights: classification?.insights ?? [],
      mapPath: undefined, // workspace-map.json removed; map is stored in DB (OB-810)
      gitInitialized: true,
      error: state.error,
    };
  }

  /**
   * Insert an exploration_progress row for a non-directory phase.
   * Returns the row id (0 if tracking is unavailable or fails).
   */
  private async insertPhaseRow(phase: string, filesTotal?: number): Promise<number> {
    if (!this.memory || !this.explorationId) return 0;
    try {
      return await this.memory.insertExplorationProgress({
        exploration_id: this.explorationId,
        phase,
        target: null,
        status: 'in_progress',
        progress_pct: 0,
        files_processed: 0,
        files_total: filesTotal ?? null,
        started_at: new Date().toISOString(),
      });
    } catch {
      return 0;
    }
  }

  /**
   * Mark an exploration_progress row as completed with 100% progress.
   * No-ops if id is 0 or tracking is unavailable.
   */
  private async completePhaseRow(id: number): Promise<void> {
    if (!this.memory || id === 0) return;
    try {
      await this.memory.updateExplorationProgressById(id, {
        status: 'completed',
        progress_pct: 100,
        completed_at: new Date().toISOString(),
      });
    } catch {
      // ignore — progress tracking is best-effort
    }
  }

  /**
   * Mark an exploration_progress row as failed.
   * No-ops if id is 0 or tracking is unavailable.
   */
  private async failPhaseRow(id: number): Promise<void> {
    if (!this.memory || id === 0) return;
    try {
      await this.memory.updateExplorationProgressById(id, {
        status: 'failed',
        completed_at: new Date().toISOString(),
      });
    } catch {
      // ignore — progress tracking is best-effort
    }
  }

  /**
   * Emit a progress event via the onProgress callback (if provided).
   */
  private async emitProgress(
    phase: 'structure_scan' | 'classification' | 'directory_dives' | 'assembly' | 'finalization',
    status: 'starting' | 'completed',
    detail?: string,
    directoryProgress?: { completed: number; total: number; currentDir?: string },
  ): Promise<void> {
    if (!this.onProgress) return;
    try {
      await this.onProgress({ phase, status, detail, directoryProgress });
    } catch (err) {
      logger.warn({ err, phase, status }, 'Progress callback failed');
    }
  }

  /**
   * Get current exploration progress
   * Returns phase-by-phase completion status and overall percentage
   */
  public async getProgress(): Promise<{
    currentPhase: string;
    phases: Record<string, 'pending' | 'in_progress' | 'completed' | 'failed'>;
    completionPercent: number;
    directoriesTotal: number;
    directoriesCompleted: number;
    directoriesFailed: number;
    totalCalls: number;
    totalAITimeMs: number;
  } | null> {
    const state = await this.readExplorationStateFromStore();
    if (!state) {
      return null;
    }

    // Calculate completion percentage
    const phaseWeights = {
      structure_scan: 15,
      classification: 15,
      directory_dives: 50,
      assembly: 15,
      finalization: 5,
    };

    let completedWeight = 0;
    for (const [phase, status] of Object.entries(state.phases)) {
      if (status === 'completed') {
        completedWeight += phaseWeights[phase as keyof typeof phaseWeights] ?? 0;
      }
    }

    // For directory_dives, calculate partial completion
    if (state.phases.directory_dives === 'in_progress' && state.directoryDives.length > 0) {
      const completedDives = state.directoryDives.filter((d) => d.status === 'completed').length;
      const totalDives = state.directoryDives.length;
      const diveProgressPercent = completedDives / totalDives;
      completedWeight +=
        phaseWeights.directory_dives * diveProgressPercent - phaseWeights.directory_dives;
    }

    const completionPercent = Math.round(completedWeight);

    return {
      currentPhase: state.currentPhase,
      phases: state.phases,
      completionPercent,
      directoriesTotal: state.directoryDives.length,
      directoriesCompleted: state.directoryDives.filter((d) => d.status === 'completed').length,
      directoriesFailed: state.directoryDives.filter((d) => d.status === 'failed').length,
      totalCalls: state.totalCalls,
      totalAITimeMs: state.totalAITimeMs,
    };
  }
}
