/**
 * ExplorationManager — extracted from MasterManager (OB-1280, OB-F158).
 *
 * Handles workspace exploration lifecycle: initial 5-phase exploration,
 * incremental re-exploration on workspace changes, user-triggered
 * re-exploration, progress broadcasting, and post-exploration memory seeding.
 */

import { ExplorationCoordinator } from './exploration-coordinator.js';
import { generateReExplorationPrompt } from './exploration-prompt.js';
import { generateIncrementalExplorationPrompt } from './exploration-prompts.js';
import type { WorkspaceChangeTracker } from './workspace-change-tracker.js';
import type { WorkspaceChanges } from './workspace-change-tracker.js';
import { parseAIResult } from './result-parser.js';
import { detectSubProjects } from './sub-master-detector.js';
import type { SubMasterManager } from './sub-master-manager.js';
import type { AgentRunner, SpawnOptions } from '../core/agent-runner.js';
import { TOOLS_READ_ONLY } from '../core/agent-runner.js';
import type { CLIAdapter } from '../core/cli-adapter.js';
import type { Router } from '../core/router.js';
import type { MemoryManager } from '../memory/index.js';
import type { DotFolderManager } from './dotfolder-manager.js';
import type {
  ExplorationSummary,
  ExplorationState,
  WorkspaceMap,
  WorkspaceAnalysisMarker,
  AgentsRegistry,
  Classification,
  MasterSession,
  MasterState,
} from '../types/master.js';
import { WorkspaceMapSchema } from '../types/master.js';
import type { DiscoveredTool } from '../types/discovery.js';
import type { InboundMessage } from '../types/message.js';
import { createLogger } from '../core/logger.js';
import { randomUUID } from 'node:crypto';

const logger = createLogger('exploration-manager');

const MASTER_MAX_TURNS = 50;

// ---------------------------------------------------------------------------
// Dependencies interface — callbacks + shared references from MasterManager
// ---------------------------------------------------------------------------

/**
 * Optional pre-formatted context sections passed to buildMasterSpawnOptions.
 * Re-declared here to avoid importing from master-manager.ts (circular).
 */
interface MasterContextSections {
  conversationContext?: string | null;
  learnedPatternsContext?: string | null;
  workerNextStepsContext?: string | null;
  knowledgeContext?: string | null;
  targetedReaderContext?: string | null;
  analysisContext?: string | null;
}

export interface ExplorationManagerDeps {
  workspacePath: string;
  masterTool: DiscoveredTool;
  discoveredTools: DiscoveredTool[];
  dotFolder: DotFolderManager;
  changeTracker: WorkspaceChangeTracker;
  agentRunner: AgentRunner;
  explorationTimeout: number;
  adapter?: CLIAdapter;

  // Mutable references from MasterManager
  getMemory: () => MemoryManager | null;
  getRouter: () => Router | null;
  getSubMasterManager: () => SubMasterManager | null;
  getMasterSession: () => MasterSession | null;
  getState: () => MasterState;
  setState: (state: MasterState) => void;

  // Callbacks into MasterManager
  buildMasterSpawnOptions: (
    prompt: string,
    timeout?: number,
    maxTurns?: number,
    contextSections?: MasterContextSections,
    skipWorkspaceContext?: boolean,
  ) => SpawnOptions;
  updateMasterSession: () => Promise<void>;
  processMessage: (message: InboundMessage) => Promise<string>;

  // Store helpers (shared with MasterManager)
  readWorkspaceMapFromStore: () => Promise<WorkspaceMap | null>;
  writeWorkspaceMapToStore: (map: WorkspaceMap) => Promise<void>;
  readAnalysisMarkerFromStore: () => Promise<WorkspaceAnalysisMarker | null>;
  writeAnalysisMarkerToStore: (marker: WorkspaceAnalysisMarker) => Promise<void>;
  readExplorationStateFromStore: () => Promise<ExplorationState | null>;
}

// ---------------------------------------------------------------------------
// ExplorationManager class
// ---------------------------------------------------------------------------

export class ExplorationManager {
  private deps: ExplorationManagerDeps;

  /** Exploration results — project type, frameworks, insights */
  private _explorationSummary: ExplorationSummary | null = null;
  /** Cached workspace map summary for system prompt injection */
  private _workspaceMapSummary: string | null = null;
  /** ISO timestamp of the most recent startup verification */
  private _mapLastVerifiedAt: string | null = null;
  /** Timestamp of last exploration run (throttles re-exploration) */
  private _lastExplorationAt: number | null = null;
  /** Messages queued while exploration is in progress */
  private _pendingMessages: InboundMessage[] = [];

  constructor(deps: ExplorationManagerDeps) {
    this.deps = deps;
  }

  // -------------------------------------------------------------------------
  // Public state accessors
  // -------------------------------------------------------------------------

  get explorationSummary(): ExplorationSummary | null {
    return this._explorationSummary;
  }

  set explorationSummary(value: ExplorationSummary | null) {
    this._explorationSummary = value;
  }

  get workspaceMapSummary(): string | null {
    return this._workspaceMapSummary;
  }

  set workspaceMapSummary(value: string | null) {
    this._workspaceMapSummary = value;
  }

  get mapLastVerifiedAt(): string | null {
    return this._mapLastVerifiedAt;
  }

  set mapLastVerifiedAt(value: string | null) {
    this._mapLastVerifiedAt = value;
  }

  get pendingMessages(): InboundMessage[] {
    return this._pendingMessages;
  }

  set pendingMessages(value: InboundMessage[]) {
    this._pendingMessages = value;
  }

  /** Update mutable dependencies (e.g. when memory becomes available after init). */
  updateDeps(partial: Partial<ExplorationManagerDeps>): void {
    this.deps = { ...this.deps, ...partial };
  }

  // -------------------------------------------------------------------------
  // Primary exploration entry point
  // -------------------------------------------------------------------------

  /**
   * Autonomously explore the workspace and create .openbridge/ folder.
   * This is the Master AI's initialization step.
   */
  async explore(): Promise<void> {
    if (this.deps.getState() === 'exploring') {
      logger.warn('Exploration already in progress');
      return;
    }

    this.deps.setState('exploring');

    logger.info(
      { workspacePath: this.deps.workspacePath },
      'Starting Master-driven workspace exploration',
    );

    try {
      // Initialize .openbridge folder
      await this.deps.dotFolder.initialize();

      // Log exploration start
      const startedAt = new Date().toISOString();
      const memory = this.deps.getMemory();
      if (memory) {
        await memory.logExploration({
          timestamp: startedAt,
          level: 'info',
          message: 'Master-driven workspace exploration started',
          data: {
            masterTool: this.deps.masterTool.name,
            version: this.deps.masterTool.version,
          },
        });
      } else {
        await this.deps.dotFolder.appendLog({
          timestamp: startedAt,
          level: 'info',
          message: 'Master-driven workspace exploration started',
          data: {
            masterTool: this.deps.masterTool.name,
            version: this.deps.masterTool.version,
          },
        });
      }

      // Master-driven exploration via the persistent session
      await this.masterDrivenExplore();

      // Seed memory.md with exploration results before entering ready state (OB-F156, OB-1271).
      await this.writeExplorationSummaryToMemory();

      this.deps.setState('ready');

      // Detect sub-projects after successful exploration (OB-1613)
      try {
        const subProjects = await detectSubProjects(this.deps.workspacePath);
        if (subProjects.length > 0) {
          logger.info(
            { count: subProjects.length, paths: subProjects.map((p) => p.path) },
            'Sub-projects detected after exploration',
          );
          const subMasterManager = this.deps.getSubMasterManager();
          if (subMasterManager) {
            for (const subProject of subProjects) {
              try {
                const id = await subMasterManager.spawnSubMaster(subProject);
                logger.info(
                  { id, path: subProject.relativePath, name: subProject.name },
                  'Sub-master spawned for detected sub-project',
                );
              } catch (spawnErr) {
                logger.warn(
                  { err: spawnErr, path: subProject.relativePath },
                  'Failed to spawn sub-master for sub-project — skipping',
                );
              }
            }
          } else {
            logger.warn(
              { count: subProjects.length },
              'Sub-projects detected but SubMasterManager not available — skipping spawn',
            );
          }
        }
      } catch (err) {
        logger.warn({ err }, 'Sub-project detection failed — skipping');
      }

      // Drain any messages queued while exploration was running
      await this.drainPendingMessages();

      logger.info(
        {
          projectType: this._explorationSummary?.projectType,
          frameworks: this._explorationSummary?.frameworks,
          directoriesExplored: this._explorationSummary?.directoriesExplored,
          status: this._explorationSummary?.status,
        },
        'Workspace exploration completed',
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this._explorationSummary = {
        startedAt: this._explorationSummary?.startedAt ?? new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'failed',
        filesScanned: 0,
        directoriesExplored: 0,
        frameworks: [],
        insights: [],
        gitInitialized: false,
        error: errorMessage,
      };

      // Log exploration failure
      const memory = this.deps.getMemory();
      if (memory) {
        await memory.logExploration({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Workspace exploration failed',
          data: { error: errorMessage },
        });
      } else {
        await this.deps.dotFolder.appendLog({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Workspace exploration failed',
          data: { error: errorMessage },
        });
      }

      this.deps.setState('error');

      logger.error(
        { err: error, workspacePath: this.deps.workspacePath },
        'Workspace exploration failed',
      );

      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Workspace change detection
  // -------------------------------------------------------------------------

  /**
   * Check for workspace changes since the last analysis and decide which
   * exploration path to take.
   * Returns 'no-changes', 'incremental', or 'full-reexplore'.
   */
  async checkWorkspaceChanges(
    existingMap: WorkspaceMap,
  ): Promise<'no-changes' | 'incremental' | 'full-reexplore'> {
    const MIN_EXPLORATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    if (this._lastExplorationAt !== null) {
      const elapsed = Math.floor((Date.now() - this._lastExplorationAt) / 1000);
      if (Date.now() - this._lastExplorationAt < MIN_EXPLORATION_INTERVAL_MS) {
        logger.info(`Skipping re-exploration — last run was ${elapsed}s ago`);
        return 'no-changes';
      }
    }

    const marker = await this.deps.readAnalysisMarkerFromStore();

    // No marker but valid map exists = upgrade from before incremental tracking.
    if (!marker) {
      logger.info('No analysis marker found — writing initial marker for existing map');
      const initialMarker = await this.deps.changeTracker.buildCurrentMarker('full', 0);
      await this.deps.writeAnalysisMarkerToStore(initialMarker);
      this._mapLastVerifiedAt = initialMarker.lastVerifiedAt ?? initialMarker.analyzedAt;
      return 'no-changes';
    }

    const changes = await this.deps.changeTracker.detectChanges(marker);

    logger.info(
      {
        method: changes.method,
        hasChanges: changes.hasChanges,
        changedCount: changes.changedFiles.length,
        deletedCount: changes.deletedFiles.length,
        tooLarge: changes.tooLargeForIncremental,
      },
      `Workspace change detection: ${changes.summary}`,
    );

    if (!changes.hasChanges) {
      const now = new Date().toISOString();
      await this.deps.writeAnalysisMarkerToStore({ ...marker, lastVerifiedAt: now });
      this._mapLastVerifiedAt = now;
      return 'no-changes';
    }

    if (changes.tooLargeForIncremental) {
      this._lastExplorationAt = Date.now();
      return 'full-reexplore';
    }

    // Perform incremental exploration
    this._lastExplorationAt = Date.now();
    await this.incrementalExplore(existingMap, changes);
    return 'incremental';
  }

  // -------------------------------------------------------------------------
  // Multi-agent exploration (5-phase pipeline)
  // -------------------------------------------------------------------------

  /**
   * Multi-agent exploration: delegates to ExplorationCoordinator which runs
   * a 5-phase pipeline with parallel directory dives. Falls back to a
   * single-agent monolithic approach if the coordinator fails.
   */
  private async masterDrivenExplore(): Promise<void> {
    logger.info('Starting multi-agent workspace exploration via ExplorationCoordinator');

    const memory = this.deps.getMemory();
    if (memory) {
      await memory.logExploration({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Starting multi-agent workspace exploration',
        data: { workspacePath: this.deps.workspacePath },
      });
    } else {
      await this.deps.dotFolder.appendLog({
        timestamp: new Date().toISOString(),
        level: 'info',
        message: 'Starting multi-agent workspace exploration',
        data: { workspacePath: this.deps.workspacePath },
      });
    }

    let explorationId: string | undefined;
    try {
      if (memory) {
        explorationId = randomUUID();
        const now = new Date().toISOString();
        await memory.insertActivity({
          id: explorationId,
          type: 'explorer',
          status: 'running',
          task_summary: 'Workspace exploration',
          started_at: now,
          updated_at: now,
        });
      }

      const coordinator = new ExplorationCoordinator({
        workspacePath: this.deps.workspacePath,
        masterTool: this.deps.masterTool,
        discoveredTools: this.deps.discoveredTools,
        adapter: this.deps.adapter,
        onProgress: async (event): Promise<void> => {
          await this.emitExplorationProgress(event);
        },
        memory: memory ?? undefined,
        explorationId,
      });

      const summary = await coordinator.explore();

      // Write agents.json (coordinator writes its own, but ensure consistency)
      await this.writeAgentsRegistry();

      // Load the workspace map into memory for system prompt injection
      await this.loadExplorationSummary();

      // Cache the map summary
      const map = await this.deps.readWorkspaceMapFromStore();
      if (map) {
        this._workspaceMapSummary = this.buildMapSummary(map);
      }

      // Write analysis marker only if exploration produced a valid workspace map
      if (this._explorationSummary?.status === 'completed' && map) {
        const fullMarker = await this.deps.changeTracker.buildCurrentMarker('full', 0);
        await this.deps.writeAnalysisMarkerToStore(fullMarker);
        this._mapLastVerifiedAt = fullMarker.lastVerifiedAt ?? fullMarker.analyzedAt;
      } else {
        logger.warn(
          'Skipping analysis marker update — exploration did not produce a valid workspace map',
        );
      }

      if (memory) {
        await memory.logExploration({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Multi-agent exploration completed',
          data: {
            directoriesExplored: summary.directoriesExplored,
            projectType: summary.projectType,
            frameworks: summary.frameworks,
          },
        });
      } else {
        await this.deps.dotFolder.appendLog({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Multi-agent exploration completed',
          data: {
            directoriesExplored: summary.directoriesExplored,
            projectType: summary.projectType,
            frameworks: summary.frameworks,
          },
        });
      }

      logger.info(
        {
          directoriesExplored: summary.directoriesExplored,
          projectType: summary.projectType,
        },
        'Multi-agent exploration completed successfully',
      );

      if (memory && explorationId) {
        const completedAt = new Date().toISOString();
        await memory.updateActivity(explorationId, {
          status: 'done',
          progress_pct: 100,
          completed_at: completedAt,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        { error: errorMessage },
        'Multi-agent exploration failed, falling back to monolithic exploration',
      );

      if (memory && explorationId) {
        const failedAt = new Date().toISOString();
        await memory.updateActivity(explorationId, {
          status: 'failed',
          completed_at: failedAt,
        });
      }

      if (memory) {
        await memory.logExploration({
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: 'Multi-agent exploration failed, falling back to monolithic exploration',
          data: { error: errorMessage },
        });
      } else {
        await this.deps.dotFolder.appendLog({
          timestamp: new Date().toISOString(),
          level: 'warn',
          message: 'Multi-agent exploration failed, falling back to monolithic exploration',
          data: { error: errorMessage },
        });
      }

      await this.monolithicExplore();
    }
  }

  // -------------------------------------------------------------------------
  // Monolithic fallback exploration
  // -------------------------------------------------------------------------

  /**
   * Fallback: single-agent monolithic exploration via streaming.
   * Used when the multi-agent ExplorationCoordinator fails.
   */
  private async monolithicExplore(): Promise<void> {
    logger.info('Executing monolithic exploration via single agent');

    const explorationPrompt = `Explore the workspace at \`${this.deps.workspacePath}\` and create a comprehensive understanding.

You are in charge of the exploration strategy. Use your tools (Read, Glob, Grep) to understand the project.

Follow the "Workspace Exploration" section in your system prompt for the schema and recommended strategy. Adapt the depth of exploration to the project's size and complexity.

When done, output ONLY the workspace map as a JSON object to stdout — no other text, no markdown fences, just the raw JSON. Do NOT write any files.`;

    const spawnOpts = this.deps.buildMasterSpawnOptions(
      explorationPrompt,
      this.deps.explorationTimeout,
      MASTER_MAX_TURNS,
    );

    const stream = this.deps.agentRunner.stream(spawnOpts);

    // Consume the stream
    let iterResult = await stream.next();
    while (!iterResult.done) {
      iterResult = await stream.next();
    }

    const result = iterResult.value;
    await this.deps.updateMasterSession();

    if (!result || result.exitCode !== 0) {
      const errorMessage = `Monolithic exploration failed with exit code ${result?.exitCode ?? 'unknown'}: ${result?.stderr ?? 'no error details'}`;
      throw new Error(errorMessage);
    }

    // Parse workspace map from stdout and store in memory + JSON fallback (OB-838)
    const parsed = parseAIResult<unknown>(result.stdout, 'monolithic workspace map');
    if (parsed.success) {
      try {
        const map = WorkspaceMapSchema.parse(parsed.data);
        await this.deps.writeWorkspaceMapToStore(map);
        await this.deps.dotFolder.writeWorkspaceMap(map); // JSON safety net
        logger.info({ method: parsed.method }, 'Monolithic workspace map stored in memory');
      } catch (err) {
        logger.warn({ error: String(err) }, 'Monolithic workspace map schema validation failed');
      }
    } else {
      logger.warn(
        { rawOutput: result.stdout.slice(0, 200) },
        'Monolithic exploration: could not extract workspace map from stdout',
      );
    }

    // Write agents.json
    await this.writeAgentsRegistry();

    logger.info('Monolithic exploration completed successfully');

    await this.loadExplorationSummary();

    // Write analysis marker only if exploration produced a valid workspace map
    const monoMap = await this.deps.readWorkspaceMapFromStore();
    if (this._explorationSummary?.status === 'completed' && monoMap) {
      const fullMarker = await this.deps.changeTracker.buildCurrentMarker('full', 0);
      await this.deps.writeAnalysisMarkerToStore(fullMarker);
      this._mapLastVerifiedAt = fullMarker.lastVerifiedAt ?? fullMarker.analyzedAt;
    } else {
      logger.warn(
        'Skipping analysis marker update — monolithic exploration did not produce a valid workspace map',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Incremental exploration
  // -------------------------------------------------------------------------

  /**
   * Perform an incremental exploration: send only the changed files to
   * the Master AI for a targeted map update.
   */
  private async incrementalExplore(
    existingMap: WorkspaceMap,
    changes: WorkspaceChanges,
  ): Promise<void> {
    this.deps.setState('exploring');

    const startedAt = new Date().toISOString();

    logger.info(
      {
        changedFiles: changes.changedFiles.length,
        deletedFiles: changes.deletedFiles.length,
      },
      'Starting incremental workspace exploration',
    );

    const memory = this.deps.getMemory();

    // Create an agent_activity row for this incremental exploration
    let incrementalExplorationId: string | undefined;
    if (memory) {
      try {
        incrementalExplorationId = randomUUID();
        await memory.insertActivity({
          id: incrementalExplorationId,
          type: 'explorer',
          status: 'running',
          task_summary: 'Incremental exploration',
          started_at: startedAt,
          updated_at: startedAt,
        });
      } catch {
        incrementalExplorationId = undefined;
      }
    }

    if (memory) {
      await memory.logExploration({
        timestamp: startedAt,
        level: 'info',
        message: 'Incremental workspace exploration started',
        data: {
          method: changes.method,
          changedCount: changes.changedFiles.length,
          deletedCount: changes.deletedFiles.length,
          summary: changes.summary,
        },
      });
    } else {
      await this.deps.dotFolder.appendLog({
        timestamp: startedAt,
        level: 'info',
        message: 'Incremental workspace exploration started',
        data: {
          method: changes.method,
          changedCount: changes.changedFiles.length,
          deletedCount: changes.deletedFiles.length,
          summary: changes.summary,
        },
      });
    }

    try {
      // Mark affected memory chunks as stale
      if (memory) {
        let splitDirs: Record<string, string[]> | undefined;
        try {
          const rawScan = await memory.getStructureScan();
          if (rawScan) {
            const parsed = JSON.parse(rawScan) as { splitDirs?: Record<string, string[]> };
            if (parsed.splitDirs && Object.keys(parsed.splitDirs).length > 0) {
              splitDirs = parsed.splitDirs;
            }
          }
        } catch {
          // ignore — fall back to 1-level scopes
        }

        const changedScopes = this.deps.changeTracker.extractChangedScopes(
          changes.changedFiles,
          changes.deletedFiles,
          splitDirs,
        );
        if (changedScopes.length > 0) {
          try {
            await memory.markStale(changedScopes);
            logger.info({ changedScopes }, 'Marked stale memory scopes for incremental refresh');
          } catch (err) {
            logger.warn({ err }, 'Failed to mark stale scopes — continuing');
          }
        }
      }

      const prompt = generateIncrementalExplorationPrompt(
        this.deps.workspacePath,
        existingMap,
        changes.changedFiles,
        changes.deletedFiles,
        changes.summary,
      );

      const spawnOpts = this.deps.buildMasterSpawnOptions(
        prompt,
        this.deps.explorationTimeout,
        undefined,
        undefined,
        true, // skipWorkspaceContext — the prompt already contains the workspace map
      );
      // Scale maxTurns to change size — incremental is smaller scope
      spawnOpts.maxTurns = Math.min(
        MASTER_MAX_TURNS,
        Math.max(10, changes.changedFiles.length + 5),
      );

      const result = await this.deps.agentRunner.spawn(spawnOpts);
      await this.deps.updateMasterSession();

      if (result.exitCode !== 0) {
        throw new Error(
          `Incremental exploration failed (exit ${result.exitCode}): ${result.stderr}`,
        );
      }

      // Save the analysis marker with the current workspace state
      const totalChanged = changes.changedFiles.length + changes.deletedFiles.length;
      const newMarker = await this.deps.changeTracker.buildCurrentMarker(
        'incremental',
        totalChanged,
      );
      await this.deps.writeAnalysisMarkerToStore(newMarker);
      this._mapLastVerifiedAt = newMarker.lastVerifiedAt ?? newMarker.analyzedAt;

      // Reload the map into memory
      await this.loadExplorationSummary();

      // Update cached map summary
      const updatedMap = await this.deps.readWorkspaceMapFromStore();
      if (updatedMap) {
        this._workspaceMapSummary = this.buildMapSummary(updatedMap);
      }

      // Re-explore stale directories
      if (memory) {
        const staleExplorationId = randomUUID();
        const staleNow = new Date().toISOString();
        await memory.insertActivity({
          id: staleExplorationId,
          type: 'explorer',
          status: 'running',
          task_summary: 'Stale directory re-exploration',
          started_at: staleNow,
          updated_at: staleNow,
        });
        const coordinator = new ExplorationCoordinator({
          workspacePath: this.deps.workspacePath,
          masterTool: this.deps.masterTool,
          discoveredTools: this.deps.discoveredTools,
          memory,
          explorationId: staleExplorationId,
        });
        try {
          await coordinator.reexploreStaleDirs();
          await memory.updateActivity(staleExplorationId, {
            status: 'done',
            progress_pct: 100,
            completed_at: new Date().toISOString(),
          });
        } catch (err) {
          logger.warn({ err }, 'Stale dir re-exploration failed — continuing');
          await memory.updateActivity(staleExplorationId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
          });
        }
      }

      if (memory) {
        await memory.logExploration({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Incremental exploration completed',
          data: { filesChanged: totalChanged, durationMs: result.durationMs },
        });
      } else {
        await this.deps.dotFolder.appendLog({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Incremental exploration completed',
          data: { filesChanged: totalChanged, durationMs: result.durationMs },
        });
      }

      logger.info(
        { filesChanged: totalChanged, durationMs: result.durationMs },
        'Incremental exploration completed',
      );

      // Mark the incremental exploration activity as done
      if (memory && incrementalExplorationId) {
        try {
          await memory.updateActivity(incrementalExplorationId, {
            status: 'done',
            progress_pct: 100,
            completed_at: new Date().toISOString(),
          });
        } catch {
          // activity tracking is best-effort
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Mark the incremental exploration activity as failed
      if (memory && incrementalExplorationId) {
        try {
          await memory.updateActivity(incrementalExplorationId, {
            status: 'failed',
            completed_at: new Date().toISOString(),
          });
        } catch {
          // activity tracking is best-effort
        }
      }

      if (memory) {
        await memory.logExploration({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Incremental exploration failed — falling back to full re-explore',
          data: { error: errorMessage },
        });
      } else {
        await this.deps.dotFolder.appendLog({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Incremental exploration failed — falling back to full re-explore',
          data: { error: errorMessage },
        });
      }

      logger.warn(
        { error: errorMessage },
        'Incremental exploration failed, falling back to full re-exploration',
      );

      // Fall back to full exploration
      await this.explore();
    }
  }

  // -------------------------------------------------------------------------
  // User-triggered re-exploration
  // -------------------------------------------------------------------------

  /**
   * Re-explore the workspace (e.g., after significant changes).
   * Uses the Master session to drive re-exploration, with a fallback to
   * a standalone AgentRunner call if no session is available.
   */
  async reExplore(): Promise<void> {
    if (this.deps.getState() !== 'ready') {
      logger.warn(
        { currentState: this.deps.getState() },
        'Cannot re-explore: Master not in ready state',
      );
      return;
    }

    const startedAt = new Date().toISOString();
    this.deps.setState('exploring');

    logger.info({ workspacePath: this.deps.workspacePath }, 'Starting workspace re-exploration');

    try {
      const memory = this.deps.getMemory();
      // Log re-exploration start
      if (memory) {
        await memory.logExploration({
          timestamp: startedAt,
          level: 'info',
          message: 'Workspace re-exploration started',
        });
      } else {
        await this.deps.dotFolder.appendLog({
          timestamp: startedAt,
          level: 'info',
          message: 'Workspace re-exploration started',
        });
      }

      if (this.deps.getMasterSession()) {
        // Master-driven re-exploration via session
        const prompt = generateReExplorationPrompt(this.deps.workspacePath);
        const spawnOpts = this.deps.buildMasterSpawnOptions(prompt, this.deps.explorationTimeout);
        const result = await this.deps.agentRunner.spawn(spawnOpts);
        await this.deps.updateMasterSession();

        if (result.exitCode !== 0) {
          throw new Error(
            `Re-exploration failed with exit code ${result.exitCode}: ${result.stderr}`,
          );
        }
      } else {
        // Fallback: standalone re-exploration with read-only tools
        const prompt = generateReExplorationPrompt(this.deps.workspacePath);
        const result = await this.deps.agentRunner.spawn({
          prompt,
          workspacePath: this.deps.workspacePath,
          timeout: this.deps.explorationTimeout,
          allowedTools: [...TOOLS_READ_ONLY],
          retries: 1,
        });

        if (result.exitCode !== 0) {
          throw new Error(
            `Re-exploration failed with exit code ${result.exitCode}: ${result.stderr}`,
          );
        }
      }

      // Update exploration summary from the map
      await this.loadExplorationSummary();

      // Cache the map summary for context injection
      const reExploreMap = await this.deps.readWorkspaceMapFromStore();
      if (reExploreMap) {
        this._workspaceMapSummary = this.buildMapSummary(reExploreMap);
      }

      // Write analysis marker so next startup skips unnecessary re-exploration
      const reExploreMarker = await this.deps.changeTracker.buildCurrentMarker('full', 0);
      await this.deps.writeAnalysisMarkerToStore(reExploreMarker);
      this._mapLastVerifiedAt = reExploreMarker.lastVerifiedAt ?? reExploreMarker.analyzedAt;

      // Log re-exploration completion
      if (memory) {
        await memory.logExploration({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Workspace re-exploration completed',
        });
      } else {
        await this.deps.dotFolder.appendLog({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Workspace re-exploration completed',
        });
      }

      this.deps.setState('ready');

      logger.info('Workspace re-exploration completed');
    } catch (error) {
      logger.error({ err: error }, 'Workspace re-exploration failed');
      this.deps.setState('ready'); // Return to ready state even on failure
      throw error;
    }
  }

  /**
   * Full re-exploration of the workspace using the 5-phase ExplorationCoordinator.
   * Unlike reExplore() which sends a lightweight prompt to the Master session,
   * this method runs the complete structure scan → classification → directory dives
   * → assembly → finalization pipeline with progress tracking in exploration_progress.
   */
  async fullReExplore(): Promise<void> {
    if (this.deps.getState() !== 'ready') {
      logger.warn(
        { currentState: this.deps.getState() },
        'Cannot full re-explore: Master not in ready state',
      );
      return;
    }

    this.deps.setState('exploring');
    const startedAt = new Date().toISOString();

    logger.info(
      { workspacePath: this.deps.workspacePath },
      'Starting full workspace re-exploration (user-triggered)',
    );

    try {
      const memory = this.deps.getMemory();
      if (memory) {
        await memory.logExploration({
          timestamp: startedAt,
          level: 'info',
          message: 'Full workspace re-exploration started (user-triggered)',
        });

        // Clear exploration state so ExplorationCoordinator doesn't skip completed phases
        await memory.upsertExplorationState(null);
      }

      // Clear dotfolder exploration state as well
      try {
        await this.deps.dotFolder.writeExplorationState(null as unknown as ExplorationState);
      } catch {
        // ignore — dotfolder may not exist yet, or null fails Zod validation
      }

      // Run the full 5-phase exploration pipeline
      await this.masterDrivenExplore();

      // Refresh in-memory state
      await this.loadExplorationSummary();
      await this.writeAgentsRegistry();

      this.deps.setState('ready');

      if (memory) {
        await memory.logExploration({
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Full workspace re-exploration completed (user-triggered)',
        });
      }

      logger.info('Full workspace re-exploration completed');
    } catch (error) {
      logger.error({ err: error }, 'Full workspace re-exploration failed');
      this.deps.setState('ready');
      throw error;
    }
  }

  // -------------------------------------------------------------------------
  // Progress broadcasting
  // -------------------------------------------------------------------------

  /**
   * Translate ExplorationCoordinator progress callbacks into ProgressEvents
   * and broadcast them to all connected connectors.
   */
  private async emitExplorationProgress(event: {
    phase: string;
    status: string;
    detail?: string;
    directoryProgress?: { completed: number; total: number; currentDir?: string };
  }): Promise<void> {
    const phaseLabels: Record<string, string> = {
      structure_scan: 'Scanning workspace structure',
      classification: 'Classifying project type',
      directory_dives: 'Exploring directories',
      assembly: 'Assembling workspace map',
      finalization: 'Finalizing exploration',
    };

    const phaseLabel = phaseLabels[event.phase] ?? event.phase;
    const statusSuffix = event.status === 'completed' ? ' (done)' : '...';

    logger.info(`${phaseLabel}${statusSuffix}`);

    // Broadcast to connectors if router is available
    const router = this.deps.getRouter();
    if (router) {
      if (event.directoryProgress) {
        await router.broadcastProgress({
          type: 'exploring-directory',
          directory: event.directoryProgress.currentDir ?? '',
          completed: event.directoryProgress.completed,
          total: event.directoryProgress.total,
        });
      } else {
        await router.broadcastProgress({
          type: 'exploring',
          phase: phaseLabel,
          detail: event.detail,
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Post-exploration memory seeding
  // -------------------------------------------------------------------------

  /**
   * Write a structured exploration summary directly to memory.md after exploration
   * completes (OB-F156, OB-1271). Reads workspace map and classification results
   * and writes a meaningful seed instead of relying on triggerMemoryUpdate() which
   * requires conversation history (completedTaskCount=0 at this point).
   */
  async writeExplorationSummaryToMemory(): Promise<void> {
    const memoryPath = this.deps.dotFolder.getMemoryFilePath();
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

    try {
      const map = await this.deps.readWorkspaceMapFromStore();
      const classification: Classification | null = await this.deps.dotFolder.readClassification();

      if (!map && !classification) {
        logger.warn('writeExplorationSummaryToMemory: no exploration data — skipping');
        return;
      }

      const lines: string[] = ['# Memory', `> Generated: ${now} (post-exploration seed)`, ''];

      // Project overview from workspace map
      if (map) {
        lines.push('## Project Overview', '');
        if (map.projectName) lines.push(`**Project:** ${map.projectName}`);
        if (map.projectType) lines.push(`**Type:** ${map.projectType}`);
        const mapAny = map as Record<string, unknown>;
        if (typeof mapAny['projectPhase'] === 'string') {
          lines.push(`**Phase:** ${mapAny['projectPhase']}`);
        }
        if (typeof mapAny['summary'] === 'string') {
          lines.push('', mapAny['summary']);
        }
        lines.push('');
      } else if (classification) {
        lines.push('## Project Overview', '');
        lines.push(`**Project:** ${classification.projectName}`);
        lines.push(`**Type:** ${classification.projectType}`);
        lines.push('');
      }

      // Frameworks — prefer map, fall back to classification
      const frameworks: string[] = map?.frameworks?.length
        ? map.frameworks
        : (classification?.frameworks ?? []);
      if (frameworks.length > 0) {
        lines.push('## Frameworks & Tech Stack', '');
        for (const f of frameworks) lines.push(`- ${f}`);
        lines.push('');
      }

      // Directory structure
      if (map?.structure && Object.keys(map.structure).length > 0) {
        lines.push('## Directory Structure', '');
        for (const [dir, info] of Object.entries(map.structure)) {
          lines.push(`- **${dir}/**: ${info.purpose}`);
          if (lines.length >= 160) {
            lines.push('- _(truncated — see workspace-map.json for full list)_');
            break;
          }
        }
        lines.push('');
      }

      // Key commands
      const commands: Record<string, string> =
        ((map as Record<string, unknown> | null)?.['commands'] as
          | Record<string, string>
          | undefined) ??
        classification?.commands ??
        {};
      const cmdEntries = Object.entries(commands);
      if (cmdEntries.length > 0) {
        lines.push('## Key Commands', '');
        for (const [name, cmd] of cmdEntries) lines.push(`- **${name}:** \`${cmd}\``);
        lines.push('');
      }

      // Exploration metadata
      if (this._explorationSummary) {
        lines.push('## Exploration Status', '');
        lines.push(`- Status: ${this._explorationSummary.status}`);
        lines.push(`- Directories explored: ${this._explorationSummary.directoriesExplored}`);
        lines.push('');
      }

      lines.push('---');
      lines.push('_Seeded from exploration results. Updated each session._');

      const content = lines.join('\n');
      await this.deps.dotFolder.writeMemoryFile(content);
      logger.info(
        { memoryPath, lineCount: lines.length },
        'Exploration summary written to memory.md',
      );
    } catch (err) {
      logger.warn({ err, memoryPath }, 'writeExplorationSummaryToMemory failed');
    }
  }

  // -------------------------------------------------------------------------
  // Exploration summary loading
  // -------------------------------------------------------------------------

  /**
   * Load exploration summary from the workspace map written by the Master.
   */
  async loadExplorationSummary(): Promise<void> {
    const map = await this.deps.readWorkspaceMapFromStore();
    if (map) {
      this._explorationSummary = {
        startedAt: map.generatedAt,
        completedAt: new Date().toISOString(),
        status: 'completed',
        filesScanned: 0,
        directoriesExplored: Object.keys(map.structure).length,
        projectType: map.projectType,
        frameworks: map.frameworks,
        insights: [],
        mapPath: this.deps.dotFolder.getMapPath(),
        gitInitialized: true,
      };
    } else {
      logger.warn(
        'Exploration completed but workspace map is empty — will re-explore on next startup',
      );
      this._explorationSummary = {
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: 'failed',
        filesScanned: 0,
        directoriesExplored: 0,
        frameworks: [],
        insights: [],
        gitInitialized: true,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Agents registry
  // -------------------------------------------------------------------------

  /**
   * Write the agents registry to system_config (DB) and agents.json (fallback).
   */
  async writeAgentsRegistry(): Promise<void> {
    const registry = this.createAgentsRegistry();
    const memory = this.deps.getMemory();
    if (memory) {
      await memory.setSystemConfig('agents', JSON.stringify(registry));
    } else {
      await this.deps.dotFolder.writeAgents(registry);
    }
  }

  /**
   * Create agents registry from discovered tools.
   */
  createAgentsRegistry(): AgentsRegistry {
    const master = this.deps.masterTool;
    const specialists = this.deps.discoveredTools
      .filter((tool) => tool.role === 'specialist' || tool.role === 'backup')
      .map((tool) => ({
        name: tool.name,
        path: tool.path,
        version: tool.version,
        role: tool.role as 'specialist' | 'backup',
        capabilities: tool.capabilities,
      }));

    return {
      master: {
        name: master.name,
        path: master.path,
        version: master.version,
        role: 'master',
      },
      specialists,
      updatedAt: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Map summary builder
  // -------------------------------------------------------------------------

  /**
   * Build a rich text summary from the workspace map for system prompt injection.
   * Includes project name, type, summary, frameworks, structure, and key files.
   */
  buildMapSummary(map: Record<string, unknown>): string {
    const parts: string[] = [];
    const str = (key: string): string | undefined => {
      const v = map[key];
      return typeof v === 'string' ? v : undefined;
    };

    const name = str('projectName');
    if (name) parts.push(`Project: ${name}`);
    const ptype = str('projectType');
    if (ptype) parts.push(`Type: ${ptype}`);
    const phase = str('projectPhase');
    if (phase) parts.push(`Phase: ${phase}`);
    const summary = str('summary');
    if (summary) parts.push(`\nSummary: ${summary}`);

    const frameworks = map['frameworks'];
    if (Array.isArray(frameworks) && frameworks.length > 0) {
      parts.push(`\nFrameworks: ${frameworks.map(String).join(', ')}`);
    }

    const structure = map['structure'];
    if (structure && typeof structure === 'object' && !Array.isArray(structure)) {
      const dirs = Object.entries(structure as Record<string, unknown>)
        .map(([dirName, info]) => {
          const purpose =
            info && typeof info === 'object' && 'purpose' in info
              ? String((info as Record<string, unknown>)['purpose'])
              : 'unknown';
          return `- ${dirName}/: ${purpose}`;
        })
        .join('\n');
      if (dirs) parts.push(`\nDirectory structure:\n${dirs}`);
    }

    const commands = map['commands'];
    if (commands && typeof commands === 'object' && !Array.isArray(commands)) {
      const cmds = Object.entries(commands as Record<string, unknown>)
        .map(([cmdName, cmd]) => `- ${cmdName}: ${String(cmd)}`)
        .join('\n');
      if (cmds) parts.push(`\nAvailable commands:\n${cmds}`);
    }

    const dependencies = map['dependencies'];
    if (Array.isArray(dependencies) && dependencies.length > 0) {
      const deps = dependencies
        .map((d: unknown) => {
          if (d && typeof d === 'object') {
            const dep = d as Record<string, unknown>;
            const depName = typeof dep['name'] === 'string' ? dep['name'] : '';
            const depPurpose = typeof dep['purpose'] === 'string' ? dep['purpose'] : '';
            return `- ${depName}${depPurpose ? `: ${depPurpose}` : ''}`;
          }
          return `- ${String(d)}`;
        })
        .join('\n');
      parts.push(`\nDependencies:\n${deps}`);
    }

    if (this._explorationSummary?.mapPath) {
      parts.push(`\nFull workspace map: ${this._explorationSummary.mapPath}`);
    }

    return parts.join('\n');
  }

  // -------------------------------------------------------------------------
  // Workspace map indexing
  // -------------------------------------------------------------------------

  /**
   * Index workspace map content as individual searchable FTS5 chunks (OB-1569).
   * Called when the workspace map is reused from cache but the chunk store is
   * empty — ensures FTS5 has something to search on first query.
   */
  async indexWorkspaceMapAsChunks(map: WorkspaceMap): Promise<void> {
    const memory = this.deps.getMemory();
    if (!memory) return;

    const chunks: Array<{
      scope: string;
      category: 'structure' | 'patterns' | 'dependencies' | 'api' | 'config';
      content: string;
      source_hash: string;
    }> = [];

    // Summary chunk — project overview
    const summaryParts: string[] = [`Project: ${map.projectName}`, `Type: ${map.projectType}`];
    if (map.frameworks.length > 0) summaryParts.push(`Frameworks: ${map.frameworks.join(', ')}`);
    if (map.summary) summaryParts.push(`Summary: ${map.summary}`);
    if (map.entryPoints.length > 0)
      summaryParts.push(`Entry points: ${map.entryPoints.join(', ')}`);
    chunks.push({
      scope: '_workspace_summary',
      category: 'structure',
      content: summaryParts.join('\n'),
      source_hash: 'workspace-map-index',
    });

    // Key files chunk
    if (map.keyFiles.length > 0) {
      const fileLines = map.keyFiles.map((f) => `${f.path} (${f.type}): ${f.purpose}`).join('\n');
      chunks.push({
        scope: '_workspace_key_files',
        category: 'structure',
        content: `Key files:\n${fileLines}`,
        source_hash: 'workspace-map-index',
      });
    }

    // Directory structure chunk
    const structureEntries = Object.entries(map.structure);
    if (structureEntries.length > 0) {
      const structureLines = structureEntries
        .map(([dir, info]) => `${info.path ?? dir}/: ${info.purpose}`)
        .join('\n');
      chunks.push({
        scope: '_workspace_structure',
        category: 'structure',
        content: `Directory structure:\n${structureLines}`,
        source_hash: 'workspace-map-index',
      });
    }

    // Commands chunk
    const commandEntries = Object.entries(map.commands);
    if (commandEntries.length > 0) {
      const commandLines = commandEntries.map(([cmdName, cmd]) => `${cmdName}: ${cmd}`).join('\n');
      chunks.push({
        scope: '_workspace_commands',
        category: 'config',
        content: `Available commands:\n${commandLines}`,
        source_hash: 'workspace-map-index',
      });
    }

    // Dependencies chunk (first 50)
    if (map.dependencies.length > 0) {
      const depLines = map.dependencies
        .slice(0, 50)
        .map((d) => `${d.name}${d.version ? `@${d.version}` : ''}${d.type ? ` (${d.type})` : ''}`)
        .join('\n');
      chunks.push({
        scope: '_workspace_deps',
        category: 'dependencies',
        content: `Dependencies:\n${depLines}`,
        source_hash: 'workspace-map-index',
      });
    }

    await memory.storeChunks(chunks);
    logger.info({ chunkCount: chunks.length }, 'Indexed workspace map into FTS5 chunks (OB-1569)');
  }

  // -------------------------------------------------------------------------
  // Pending message drain
  // -------------------------------------------------------------------------

  /**
   * Drain messages that were queued during exploration.
   * Called after state transitions to 'ready'.
   */
  async drainPendingMessages(): Promise<void> {
    if (this._pendingMessages.length === 0) return;

    const messages = [...this._pendingMessages];
    this._pendingMessages = [];

    const total = messages.length;
    logger.info({ count: total }, 'Draining pending messages after exploration');

    let errorCount = 0;
    const failedSenders = new Map<string, string>();

    for (const message of messages) {
      const router = this.deps.getRouter();
      if (router) {
        try {
          await router.route(message);
        } catch (error) {
          errorCount++;
          failedSenders.set(message.sender, message.source);
          logger.error(
            { error, sender: message.sender, content: message.content },
            'Failed to route pending message during exploration drain',
          );
        }
      } else {
        logger.warn(
          { sender: message.sender },
          'No router set — pending message processed but response not delivered',
        );
        try {
          const response = await this.deps.processMessage(message);
          logger.info(
            { sender: message.sender, responseLength: response.length },
            'Pending message processed (no router)',
          );
        } catch (error) {
          errorCount++;
          logger.error(
            { error, sender: message.sender, content: message.content },
            'Failed to process pending message during exploration drain',
          );
        }
      }
    }

    // Notify affected senders if any messages failed to process
    const router = this.deps.getRouter();
    if (errorCount > 0 && router) {
      const notice = `⚠️ ${errorCount} of ${total} queued message${total === 1 ? '' : 's'} failed to process during exploration drain. Please resend your request.`;
      for (const [sender, source] of failedSenders) {
        void router.sendDirect(source, sender, notice);
      }
      logger.warn({ errorCount, total }, 'Notified senders of drain failures');
    }
  }

  // -------------------------------------------------------------------------
  // Workspace context summary
  // -------------------------------------------------------------------------

  /**
   * Build a concise workspace context string from the loaded workspace map.
   * Uses the cached map summary if available (much richer than exploration metadata).
   */
  getWorkspaceContextSummary(): string | null {
    // Prefer the cached full map summary
    if (this._workspaceMapSummary) {
      return this._workspaceMapSummary;
    }

    // Fallback to exploration metadata
    if (!this._explorationSummary) return null;
    const parts: string[] = [];
    if (this._explorationSummary.projectType) {
      parts.push(`Project type: ${this._explorationSummary.projectType}`);
    }
    if (this._explorationSummary.frameworks && this._explorationSummary.frameworks.length > 0) {
      parts.push(`Frameworks: ${this._explorationSummary.frameworks.join(', ')}`);
    }
    if (this._explorationSummary.insights && this._explorationSummary.insights.length > 0) {
      parts.push(
        `Key insights:\n${this._explorationSummary.insights.map((i) => `- ${i}`).join('\n')}`,
      );
    }
    if (this._explorationSummary.mapPath) {
      parts.push(`Full workspace map available at: ${this._explorationSummary.mapPath}`);
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }
}
