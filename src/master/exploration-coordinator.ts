/**
 * Exploration Coordinator — Incremental Multi-Pass Strategy
 *
 * Orchestrates the 5-phase incremental exploration workflow:
 * 1. Structure Scan  (90s) — List files/dirs, count, detect configs
 * 2. Classification  (90s) — Determine project type, frameworks, commands
 * 3. Directory Dives (90s/dir) — Explore each significant directory in batches of 3
 * 4. Assembly        (60s) — Merge partial results into workspace-map.json
 * 5. Finalization    (no AI) — Create agents.json, git commit, log entry
 *
 * Each pass is checkpointed to disk via exploration-state.json, making the
 * exploration fully resumable on restart. If interrupted at any point, the
 * coordinator resumes from the last completed phase.
 */

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
import type {
  ExplorationState,
  StructureScan,
  Classification,
  DirectoryDiveResult,
  WorkspaceMap,
  AgentsRegistry,
  ExplorationSummary,
} from '../types/master.js';
import type { DiscoveredTool } from '../types/discovery.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('exploration-coordinator');

const PHASE_TIMEOUT = 300_000; // 5 minutes per phase (large workspaces need more time)
const DIRECTORY_DIVE_TIMEOUT = 180_000; // 3 minutes per directory dive
const MAX_RETRIES = 3;
const BATCH_SIZE = 3; // Process 3 directories in parallel

export interface ExplorationOptions {
  /** Absolute path to the workspace */
  workspacePath: string;
  /** The Master AI tool being used */
  masterTool: DiscoveredTool;
  /** All discovered AI tools (for agents.json) */
  discoveredTools: DiscoveredTool[];
}

/**
 * Main orchestrator for incremental exploration
 */
export class ExplorationCoordinator {
  private readonly workspacePath: string;
  private readonly masterTool: DiscoveredTool;
  private readonly discoveredTools: DiscoveredTool[];
  private readonly dotFolder: DotFolderManager;
  private readonly agentRunner: AgentRunner;

  constructor(options: ExplorationOptions) {
    this.workspacePath = options.workspacePath;
    this.masterTool = options.masterTool;
    this.discoveredTools = options.discoveredTools;
    this.dotFolder = new DotFolderManager(this.workspacePath);
    this.agentRunner = new AgentRunner();
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

    // Load or create exploration state
    let state = await this.dotFolder.readExplorationState();

    if (!state) {
      logger.info('No existing exploration state found, creating fresh state');
      state = this.createInitialState();
      await this.dotFolder.writeExplorationState(state);
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
      await this.dotFolder.writeExplorationState(state);
    }

    try {
      // Execute each phase sequentially
      await this.executePhase1StructureScan(state);
      await this.executePhase2Classification(state);
      await this.executePhase3DirectoryDives(state);
      await this.executePhase4Assembly(state);
      await this.executePhase5Finalization(state);

      // Mark as completed
      state.status = 'completed';
      state.completedAt = new Date().toISOString();
      await this.dotFolder.writeExplorationState(state);

      logger.info(
        {
          totalCalls: state.totalCalls,
          totalAITimeMs: state.totalAITimeMs,
          duration: Date.now() - new Date(state.startedAt).getTime(),
        },
        'Exploration completed successfully',
      );

      return this.buildSummary(state);
    } catch (error) {
      logger.error({ err: error }, 'Exploration failed');
      state.status = 'failed';
      state.error = String(error);
      await this.dotFolder.writeExplorationState(state);
      throw error;
    }
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
    await this.dotFolder.writeExplorationState(state);

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
      throw new Error(`Structure scan failed with exit code ${result.exitCode}: ${result.stderr}`);
    }

    const parsed = parseAIResult<StructureScan>(result.stdout, 'structure scan');
    if (!parsed.success) {
      throw new Error(`Failed to parse structure scan result: ${parsed.error}`);
    }

    await this.dotFolder.writeStructureScan(parsed.data);
    state.phases.structure_scan = 'completed';
    await this.dotFolder.writeExplorationState(state);

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
    await this.dotFolder.writeExplorationState(state);

    const structureScan = await this.dotFolder.readStructureScan();
    if (!structureScan) {
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
      throw new Error(`Classification failed with exit code ${result.exitCode}: ${result.stderr}`);
    }

    const parsed = parseAIResult<Classification>(result.stdout, 'classification');
    if (!parsed.success) {
      throw new Error(`Failed to parse classification result: ${parsed.error}`);
    }

    await this.dotFolder.writeClassification(parsed.data);
    state.phases.classification = 'completed';
    await this.dotFolder.writeExplorationState(state);

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
    await this.dotFolder.writeExplorationState(state);

    const structureScan = await this.dotFolder.readStructureScan();
    const classification = await this.dotFolder.readClassification();

    if (!structureScan || !classification) {
      throw new Error('Structure scan or classification not found (Phases 1-2 incomplete)');
    }

    // Identify significant directories (exclude root, include dirs with files > 0)
    const significantDirs = structureScan.topLevelDirs.filter(
      (dir) => (structureScan.directoryCounts[dir] ?? 0) > 0,
    );

    // Initialize directory dive tracking if not already present
    if (state.directoryDives.length === 0) {
      state.directoryDives = significantDirs.map((dir) => ({
        path: dir,
        status: 'pending',
        attempts: 0,
      }));
      await this.dotFolder.writeExplorationState(state);
    }

    const context = {
      projectType: classification.projectType,
      frameworks: classification.frameworks,
    };

    // Process directories in batches
    const pendingDives = state.directoryDives.filter((dive) => dive.status !== 'completed');

    for (let i = 0; i < pendingDives.length; i += BATCH_SIZE) {
      const batch = pendingDives.slice(i, i + BATCH_SIZE);
      logger.info({ batchStart: i, batchSize: batch.length }, 'Processing directory batch');

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
        } else {
          diveState.attempts++;
          if (diveState.attempts >= MAX_RETRIES) {
            diveState.status = 'failed';
            diveState.error = String(result.reason);
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

      await this.dotFolder.writeExplorationState(state);
    }

    // Check if all dives completed or failed
    const incompleteDives = state.directoryDives.filter(
      (dive) => dive.status !== 'completed' && dive.status !== 'failed',
    );

    if (incompleteDives.length > 0) {
      throw new Error(`Directory dives incomplete: ${incompleteDives.length} pending`);
    }

    state.phases.directory_dives = 'completed';
    await this.dotFolder.writeExplorationState(state);

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
    const prompt = generateDirectoryDivePrompt(this.workspacePath, dirPath, context);
    const startTime = Date.now();

    const result = await this.agentRunner.spawn({
      prompt,
      workspacePath: this.workspacePath,
      timeout: DIRECTORY_DIVE_TIMEOUT,
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

    const parsed = parseAIResult<DirectoryDiveResult>(result.stdout, `directory dive: ${dirPath}`);
    if (!parsed.success) {
      throw new Error(`Failed to parse directory dive result for ${dirPath}: ${parsed.error}`);
    }

    // Sanitize directory name for filename (replace / with -)
    const safeDirName = dirPath.replace(/\//g, '-');
    await this.dotFolder.writeDirectoryDive(safeDirName, parsed.data);

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
    await this.dotFolder.writeExplorationState(state);

    const structureScan = await this.dotFolder.readStructureScan();
    const classification = await this.dotFolder.readClassification();

    if (!structureScan || !classification) {
      throw new Error('Structure scan or classification not found');
    }

    // Read all directory dive results
    const completedDives = state.directoryDives.filter((dive) => dive.status === 'completed');
    const diveResults: DirectoryDiveResult[] = [];

    for (const dive of completedDives) {
      const safeDirName = dive.path.replace(/\//g, '-');
      const result = await this.dotFolder.readDirectoryDive(safeDirName);
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
      throw new Error(
        `Summary generation failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }

    const parsed = parseAIResult<{ summary: string }>(result.stdout, 'summary generation');
    if (!parsed.success) {
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

    await this.dotFolder.writeMap(workspaceMap);
    state.phases.assembly = 'completed';
    await this.dotFolder.writeExplorationState(state);

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
    await this.dotFolder.writeExplorationState(state);

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

    await this.dotFolder.writeAgents(agentsRegistry);

    // Git commit
    await this.dotFolder.commitChanges('feat(master): complete incremental workspace exploration');

    // Log entry
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

    state.phases.finalization = 'completed';
    await this.dotFolder.writeExplorationState(state);

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
    const map = await this.dotFolder.readMap();
    const classification = await this.dotFolder.readClassification();

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
      mapPath: map ? this.dotFolder.getMapPath() : undefined,
      gitInitialized: true,
      error: state.error,
    };
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
    const state = await this.dotFolder.readExplorationState();
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
