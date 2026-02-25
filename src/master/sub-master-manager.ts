/**
 * Sub-Master Manager
 *
 * Manages the lifecycle of sub-master AI instances for large sub-projects.
 * Each detected sub-project (from sub-master-detector.ts) gets its own:
 *   - Independent SQLite database at {subproject}/.openbridge/openbridge.db
 *   - Scoped exploration run via AgentRunner
 *   - Tracking row in the root DB's sub_masters table via MemoryManager
 *
 * Sub-master DBs are completely independent — they don't share tables with
 * the root DB. The root Master remains the sole owner of user communication.
 * Sub-masters are specialists with deep domain context for their sub-project.
 *
 * OB-754 / OB-812
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase, closeDatabase } from '../memory/database.js';
import { type AgentRunner, TOOLS_READ_ONLY } from '../core/agent-runner.js';
import { generateStructureScanPrompt } from './exploration-prompts.js';
import type { SubProjectInfo } from './sub-master-detector.js';
import type { DiscoveredTool } from '../types/discovery.js';
import { createLogger } from '../core/logger.js';
import type { MemoryManager } from '../memory/index.js';
import type { SubMasterEntry } from '../memory/sub-master-store.js';

const logger = createLogger('sub-master-manager');

/** Default max turns for sub-master exploration */
const SUB_MASTER_EXPLORATION_MAX_TURNS = 15;

/** Sub-master lifecycle status */
export type SubMasterStatus = 'active' | 'stale' | 'disabled';

/** Record representing a tracked sub-master in the root DB */
export interface SubMasterRecord {
  /** UUID assigned at spawn time */
  id: string;
  /** Relative path from root workspace to the sub-project directory */
  path: string;
  /** Human-readable name (sub-project directory name) */
  name: string;
  /** Detected frameworks/languages (from sub-master-detector analysis) */
  capabilities: string[] | null;
  /** Total file count of the sub-project */
  file_count: number | null;
  /** ISO timestamp of last successful exploration sync */
  last_synced_at: string | null;
  /** Current lifecycle status */
  status: SubMasterStatus;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a SubMasterEntry (from the memory store) to a SubMasterRecord
 * (the shape this class exposes to callers).
 *
 * The store uses SubMasterCapabilities (an object with optional `frameworks`,
 * `languages`, `patterns` arrays), while SubMasterRecord uses a flat string[].
 */
function entryToRecord(entry: SubMasterEntry): SubMasterRecord {
  let capabilities: string[] | null = null;
  if (entry.capabilities) {
    if (Array.isArray(entry.capabilities)) {
      // Legacy: stored as a plain array — accept as-is
      capabilities = entry.capabilities as unknown as string[];
    } else {
      // SubMasterCapabilities object — flatten all known fields
      const caps = entry.capabilities;
      const all = [...(caps.frameworks ?? []), ...(caps.languages ?? []), ...(caps.patterns ?? [])];
      capabilities = all.length > 0 ? all : null;
    }
  }
  return {
    id: entry.id,
    path: entry.path,
    name: entry.name,
    capabilities,
    file_count: entry.file_count ?? null,
    last_synced_at: entry.last_synced_at ?? null,
    status: (entry.status ?? 'active') as SubMasterStatus,
  };
}

// ---------------------------------------------------------------------------
// SubMasterManager
// ---------------------------------------------------------------------------

/**
 * Manages lifecycle of sub-master AI instances for large sub-projects.
 *
 * Usage:
 *   const manager = new SubMasterManager(memory, workspacePath, agentRunner, masterTool);
 *   const id = await manager.spawnSubMaster(subProjectInfo);
 *   const record = await manager.getSubMasterStatus(id);
 *   await manager.stopSubMaster(id);
 */
export class SubMasterManager {
  private readonly memory: MemoryManager;
  private readonly rootWorkspacePath: string;
  private readonly agentRunner: AgentRunner;
  private readonly masterTool: DiscoveredTool;

  constructor(
    memory: MemoryManager,
    rootWorkspacePath: string,
    agentRunner: AgentRunner,
    masterTool: DiscoveredTool,
  ) {
    this.memory = memory;
    this.rootWorkspacePath = rootWorkspacePath;
    this.agentRunner = agentRunner;
    this.masterTool = masterTool;
  }

  // -------------------------------------------------------------------------
  // Public lifecycle API
  // -------------------------------------------------------------------------

  /**
   * Spawn a sub-master for a detected sub-project.
   *
   * Steps:
   * 1. Create {subproject}/.openbridge/ directory
   * 2. Initialize an independent SQLite DB with the full schema
   * 3. Register a tracking entry via MemoryManager (sub_masters table)
   * 4. Fire off a read-only structure-scan exploration (non-blocking)
   *
   * If a sub-master for this path already exists (UNIQUE constraint on path),
   * the existing record is updated in place (INSERT OR REPLACE).
   *
   * @returns The ID of the newly registered sub-master
   */
  async spawnSubMaster(subProject: SubProjectInfo): Promise<string> {
    const id = randomUUID();
    const dotFolderPath = path.join(subProject.path, '.openbridge');
    const dbPath = path.join(dotFolderPath, 'openbridge.db');

    logger.info(
      { id, path: subProject.relativePath, name: subProject.name },
      'Spawning sub-master',
    );

    // Create .openbridge/ directory in the sub-project
    await fs.mkdir(dotFolderPath, { recursive: true });

    // Initialize the sub-master's own independent SQLite DB.
    // openDatabase() creates all tables and sets WAL PRAGMAs.
    // Close it immediately — the DB persists on disk; future exploration runs
    // will open it as needed.
    let subDb = null;
    try {
      subDb = openDatabase(dbPath);
      logger.info({ id, dbPath }, 'Sub-master DB initialised');
    } finally {
      if (subDb) {
        closeDatabase(subDb);
      }
    }

    // Build capabilities list: [projectType, ...frameworks]
    const capabilities = [subProject.projectType, ...subProject.frameworks].filter(
      (v): v is string => Boolean(v),
    );

    // Register sub-master via MemoryManager (replaces raw SQL — OB-812)
    const now = new Date().toISOString();
    await this.memory.registerSubMaster({
      id,
      path: subProject.relativePath,
      name: subProject.name,
      capabilities: capabilities.length > 0 ? { frameworks: capabilities } : null,
      file_count: subProject.fileCount,
      last_synced_at: now,
      status: 'active',
    });

    // Fire off exploration asynchronously — don't block the caller
    this.runExploration(id, subProject, dbPath).catch((err: unknown) => {
      logger.error({ id, error: err }, 'Sub-master exploration failed');
      this.memory.updateSubMasterStatus(id, 'stale').catch((e: unknown) => {
        logger.error({ id, error: e }, 'Failed to update sub-master status to stale');
      });
    });

    logger.info({ id, path: subProject.relativePath }, 'Sub-master spawned successfully');
    return id;
  }

  /**
   * Stop / disable a sub-master by ID.
   *
   * Sets status to 'disabled' via MemoryManager.
   * In-flight exploration agents run to completion (no PID tracking in OB-754;
   * process-level lifecycle comes in the delegation layer).
   */
  async stopSubMaster(id: string): Promise<void> {
    logger.info({ id }, 'Stopping sub-master');
    await this.memory.updateSubMasterStatus(id, 'disabled');
  }

  /**
   * Return the current status record for a sub-master by ID.
   * Returns null when no sub-master with that ID is registered.
   */
  async getSubMasterStatus(id: string): Promise<SubMasterRecord | null> {
    const entry = await this.memory.getSubMaster(id);
    return entry ? entryToRecord(entry) : null;
  }

  /**
   * Return all registered sub-masters from the root DB,
   * ordered by file count descending (largest sub-projects first).
   */
  async listSubMasters(): Promise<SubMasterRecord[]> {
    const entries = await this.memory.listSubMasters();
    // Sort by file_count descending (largest first), nulls last
    entries.sort((a, b) => {
      const fc_a = a.file_count ?? -1;
      const fc_b = b.file_count ?? -1;
      return fc_b - fc_a;
    });
    return entries.map(entryToRecord);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Update sub-master status via MemoryManager. */
  private async updateStatus(id: string, status: SubMasterStatus): Promise<void> {
    await this.memory.updateSubMasterStatus(id, status);
  }

  /**
   * Run a read-only structure-scan exploration for the sub-project.
   *
   * Uses AgentRunner with:
   *   - haiku model (cheap, fast for structure scanning)
   *   - TOOLS_READ_ONLY profile (no writes during exploration)
   *   - SUB_MASTER_EXPLORATION_MAX_TURNS turn budget
   *
   * On success: updates last_synced_at and ensures status='active' via MemoryManager.
   * On failure: marks status='stale' so the next startup can retry.
   *
   * The sub-master's own DB path is passed as the log file destination so
   * exploration output is co-located with the sub-master's data.
   */
  private async runExploration(
    id: string,
    subProject: SubProjectInfo,
    dbPath: string,
  ): Promise<void> {
    logger.info({ id, path: subProject.relativePath }, 'Starting sub-master exploration');

    const prompt = generateStructureScanPrompt(subProject.path);
    const logFile = path.join(path.dirname(dbPath), 'exploration.log');

    let exitCode: number;
    try {
      const result = await this.agentRunner.spawn({
        prompt,
        workspacePath: subProject.path,
        model: 'haiku',
        allowedTools: [...TOOLS_READ_ONLY],
        maxTurns: SUB_MASTER_EXPLORATION_MAX_TURNS,
        logFile,
      });
      exitCode = result.exitCode;
    } catch (error) {
      logger.error(
        { id, error, path: subProject.relativePath },
        'Sub-master exploration threw an exception',
      );
      await this.updateStatus(id, 'stale');
      return;
    }

    if (exitCode === 0) {
      // Re-register with updated last_synced_at and status='active' (OB-812)
      const existing = await this.memory.getSubMaster(id);
      const entry: SubMasterEntry = {
        id,
        path: existing?.path ?? subProject.relativePath,
        name: existing?.name ?? subProject.name,
        capabilities: existing?.capabilities ?? null,
        file_count: existing?.file_count ?? subProject.fileCount,
        last_synced_at: new Date().toISOString(),
        status: 'active',
      };
      await this.memory.registerSubMaster(entry);
      logger.info({ id, path: subProject.relativePath }, 'Sub-master exploration completed');
    } else {
      logger.warn(
        { id, exitCode, path: subProject.relativePath },
        'Sub-master exploration exited with non-zero code — marking stale',
      );
      await this.updateStatus(id, 'stale');
    }
  }
}
