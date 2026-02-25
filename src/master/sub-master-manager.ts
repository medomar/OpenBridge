/**
 * Sub-Master Manager
 *
 * Manages the lifecycle of sub-master AI instances for large sub-projects.
 * Each detected sub-project (from sub-master-detector.ts) gets its own:
 *   - Independent SQLite database at {subproject}/.openbridge/openbridge.db
 *   - Scoped exploration run via AgentRunner
 *   - Tracking row in the root DB's sub_masters table
 *
 * Sub-master DBs are completely independent — they don't share tables with
 * the root DB. The root Master remains the sole owner of user communication.
 * Sub-masters are specialists with deep domain context for their sub-project.
 *
 * OB-754
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../memory/database.js';
import { type AgentRunner, TOOLS_READ_ONLY } from '../core/agent-runner.js';
import { generateStructureScanPrompt } from './exploration-prompts.js';
import type { SubProjectInfo } from './sub-master-detector.js';
import type { DiscoveredTool } from '../types/discovery.js';
import { createLogger } from '../core/logger.js';

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
// Internal row shape from SQLite
// ---------------------------------------------------------------------------

interface SubMasterRow {
  id: string;
  path: string;
  name: string;
  capabilities: string | null;
  file_count: number | null;
  last_synced_at: string | null;
  status: string;
}

function rowToRecord(row: SubMasterRow): SubMasterRecord {
  return {
    id: row.id,
    path: row.path,
    name: row.name,
    capabilities: row.capabilities ? (JSON.parse(row.capabilities) as string[]) : null,
    file_count: row.file_count,
    last_synced_at: row.last_synced_at,
    status: (row.status as SubMasterStatus) ?? 'active',
  };
}

// ---------------------------------------------------------------------------
// SubMasterManager
// ---------------------------------------------------------------------------

/**
 * Manages lifecycle of sub-master AI instances for large sub-projects.
 *
 * Usage:
 *   const manager = new SubMasterManager(rootDb, workspacePath, agentRunner, masterTool);
 *   const id = await manager.spawnSubMaster(subProjectInfo);
 *   const record = await manager.getSubMasterStatus(id);
 *   await manager.stopSubMaster(id);
 */
export class SubMasterManager {
  private readonly rootDb: Database.Database;
  private readonly rootWorkspacePath: string;
  private readonly agentRunner: AgentRunner;
  private readonly masterTool: DiscoveredTool;

  constructor(
    rootDb: Database.Database,
    rootWorkspacePath: string,
    agentRunner: AgentRunner,
    masterTool: DiscoveredTool,
  ) {
    this.rootDb = rootDb;
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
   * 3. Insert a tracking row into root DB's sub_masters table
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
    let subDb: Database.Database | null = null;
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

    // Register sub-master in root DB (or update if path already exists)
    const now = new Date().toISOString();
    this.rootDb
      .prepare(
        `INSERT OR REPLACE INTO sub_masters
         (id, path, name, capabilities, file_count, last_synced_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      )
      .run(
        id,
        subProject.relativePath,
        subProject.name,
        JSON.stringify(capabilities),
        subProject.fileCount,
        now,
      );

    // Fire off exploration asynchronously — don't block the caller
    this.runExploration(id, subProject, dbPath).catch((err: unknown) => {
      logger.error({ id, error: err }, 'Sub-master exploration failed');
      this.updateStatus(id, 'stale');
    });

    logger.info({ id, path: subProject.relativePath }, 'Sub-master spawned successfully');
    return id;
  }

  /**
   * Stop / disable a sub-master by ID.
   *
   * Sets status to 'disabled' in the root DB.
   * In-flight exploration agents run to completion (no PID tracking in OB-754;
   * process-level lifecycle comes in the delegation layer).
   */
  stopSubMaster(id: string): Promise<void> {
    logger.info({ id }, 'Stopping sub-master');
    this.updateStatus(id, 'disabled');
    return Promise.resolve();
  }

  /**
   * Return the current status record for a sub-master by ID.
   * Returns null when no sub-master with that ID is registered.
   */
  getSubMasterStatus(id: string): Promise<SubMasterRecord | null> {
    const row = this.rootDb.prepare('SELECT * FROM sub_masters WHERE id = ?').get(id) as
      | SubMasterRow
      | undefined;
    return Promise.resolve(row ? rowToRecord(row) : null);
  }

  /**
   * Return all registered sub-masters from the root DB,
   * ordered by file count descending (largest sub-projects first).
   */
  listSubMasters(): Promise<SubMasterRecord[]> {
    const rows = this.rootDb
      .prepare('SELECT * FROM sub_masters ORDER BY file_count DESC NULLS LAST')
      .all() as SubMasterRow[];
    return Promise.resolve(rows.map(rowToRecord));
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Update sub-master status and last_synced_at in the root DB. */
  private updateStatus(id: string, status: SubMasterStatus): void {
    this.rootDb
      .prepare('UPDATE sub_masters SET status = ?, last_synced_at = ? WHERE id = ?')
      .run(status, new Date().toISOString(), id);
  }

  /**
   * Run a read-only structure-scan exploration for the sub-project.
   *
   * Uses AgentRunner with:
   *   - haiku model (cheap, fast for structure scanning)
   *   - TOOLS_READ_ONLY profile (no writes during exploration)
   *   - SUB_MASTER_EXPLORATION_MAX_TURNS turn budget
   *
   * On success: updates last_synced_at and ensures status='active'.
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
      this.updateStatus(id, 'stale');
      return;
    }

    if (exitCode === 0) {
      this.rootDb
        .prepare('UPDATE sub_masters SET last_synced_at = ?, status = ? WHERE id = ?')
        .run(new Date().toISOString(), 'active', id);
      logger.info({ id, path: subProject.relativePath }, 'Sub-master exploration completed');
    } else {
      logger.warn(
        { id, exitCode, path: subProject.relativePath },
        'Sub-master exploration exited with non-zero code — marking stale',
      );
      this.updateStatus(id, 'stale');
    }
  }
}
