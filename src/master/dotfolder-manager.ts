import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  AgentsRegistry,
  ExplorationLogEntry,
  TaskRecord,
  ExplorationState,
  StructureScan,
  Classification,
  DirectoryDiveResult,
  MasterSession,
  LearningEntry,
  LearningsRegistry,
  WorkspaceAnalysisMarker,
  ClassificationCache,
  WorkspaceMap,
  PromptManifest,
  PromptTemplate,
} from '../types/master.js';
import {
  AgentsRegistrySchema,
  TaskRecordSchema,
  ExplorationStateSchema,
  StructureScanSchema,
  ClassificationSchema,
  DirectoryDiveResultSchema,
  MasterSessionSchema,
  LearningEntrySchema,
  LearningsRegistrySchema,
  WorkspaceAnalysisMarkerSchema,
  ClassificationCacheSchema,
  WorkspaceMapSchema,
  PromptManifestSchema,
  PromptTemplateSchema,
} from '../types/master.js';
import type { ToolProfile, ProfilesRegistry, BatchState, WorkerSummary } from '../types/agent.js';
import { ToolProfileSchema, ProfilesRegistrySchema, BatchStateSchema } from '../types/agent.js';
import type { WorkersRegistry } from './worker-registry.js';
import { WorkersRegistrySchema } from './worker-registry.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('dotfolder-manager');

/**
 * Manages the .openbridge/ folder inside the target workspace.
 * This folder contains:
 * - openbridge.db — SQLite database (primary storage for all runtime data)
 * - generated/ — AI-generated output files
 * - agents.json — discovered AI tools + roles (legacy fallback; DB is primary)
 */
export class DotFolderManager {
  private readonly workspacePath: string;
  private readonly dotFolderPath: string;
  private readonly tasksPath: string;
  private readonly explorationPath: string;
  private readonly explorationDirsPath: string;
  private readonly promptsPath: string;
  private readonly contextPath: string;
  private workspaceMapWarned = false;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.dotFolderPath = path.join(workspacePath, '.openbridge');
    this.tasksPath = path.join(this.dotFolderPath, 'tasks');
    this.explorationPath = path.join(this.dotFolderPath, 'exploration');
    this.explorationDirsPath = path.join(this.explorationPath, 'dirs');
    this.promptsPath = path.join(this.dotFolderPath, 'prompts');
    this.contextPath = path.join(this.dotFolderPath, 'context');
  }

  /**
   * Get the path to the .openbridge folder
   */
  public getDotFolderPath(): string {
    return this.dotFolderPath;
  }

  /**
   * Get the path to the workspace-map.json file
   */
  public getMapPath(): string {
    return path.join(this.dotFolderPath, 'workspace-map.json');
  }

  /**
   * Read workspace map from .openbridge/workspace-map.json.
   * Returns null if the file doesn't exist or is invalid.
   */
  public async readWorkspaceMap(): Promise<WorkspaceMap | null> {
    const mapPath = this.getMapPath();

    // Check existence before reading to avoid ENOENT spam on first run
    try {
      await fs.access(mapPath);
    } catch {
      // File does not exist — expected on first run
      if (!this.workspaceMapWarned) {
        this.workspaceMapWarned = true;
        logger.warn(
          { path: mapPath },
          'workspace-map.json not found — exploration may not have run yet',
        );
      } else {
        logger.debug({ path: mapPath }, 'workspace-map.json not found');
      }
      return null;
    }

    try {
      const content = await fs.readFile(mapPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return WorkspaceMapSchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: mapPath }, 'Failed to read workspace-map.json');
      return null;
    }
  }

  /**
   * Write workspace map to .openbridge/workspace-map.json as a JSON safety net.
   * Primary storage is the DB (via memory.storeChunks); this is the fallback.
   */
  public async writeWorkspaceMap(map: WorkspaceMap): Promise<void> {
    const validated = WorkspaceMapSchema.parse(map);
    await fs.mkdir(this.dotFolderPath, { recursive: true });
    await fs.writeFile(this.getMapPath(), JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Get the path to the agents.json file
   */
  public getAgentsPath(): string {
    return path.join(this.dotFolderPath, 'agents.json');
  }

  /**
   * Get the path to the exploration.log file
   */
  public getLogPath(): string {
    return path.join(this.dotFolderPath, 'exploration.log');
  }

  /**
   * Check if .openbridge folder exists
   */
  public async exists(): Promise<boolean> {
    try {
      await fs.access(this.dotFolderPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create .openbridge folder structure
   * Creates:
   * - .openbridge/
   * - .openbridge/generated/
   */
  public async createFolder(): Promise<void> {
    await fs.mkdir(this.dotFolderPath, { recursive: true });
    await fs.mkdir(path.join(this.dotFolderPath, 'generated'), { recursive: true });
  }

  /**
   * Get the path to the analysis-marker.json file
   */
  public getAnalysisMarkerPath(): string {
    return path.join(this.dotFolderPath, 'analysis-marker.json');
  }

  /**
   * Read the workspace analysis marker from .openbridge/analysis-marker.json.
   * Returns null if the file doesn't exist or is invalid.
   */
  public async readAnalysisMarker(): Promise<WorkspaceAnalysisMarker | null> {
    const markerPath = this.getAnalysisMarkerPath();
    try {
      const content = await fs.readFile(markerPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return WorkspaceAnalysisMarkerSchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: markerPath }, 'Failed to read analysis-marker.json');
      return null;
    }
  }

  /**
   * Write the workspace analysis marker to .openbridge/analysis-marker.json.
   * Called after every successful exploration (full or incremental).
   */
  public async writeAnalysisMarker(marker: WorkspaceAnalysisMarker): Promise<void> {
    const validated = WorkspaceAnalysisMarkerSchema.parse(marker);
    const markerPath = this.getAnalysisMarkerPath();
    await fs.writeFile(markerPath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Read agents registry from agents.json
   */
  public async readAgents(): Promise<AgentsRegistry | null> {
    const agentsPath = this.getAgentsPath();

    try {
      const content = await fs.readFile(agentsPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return AgentsRegistrySchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: agentsPath }, 'Failed to read agents.json');
      return null;
    }
  }

  /**
   * Write agents registry to agents.json
   */
  public async writeAgents(registry: AgentsRegistry): Promise<void> {
    // Validate before writing
    const validated = AgentsRegistrySchema.parse(registry);

    const agentsPath = this.getAgentsPath();
    await fs.writeFile(agentsPath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Append an entry to exploration.log
   * @deprecated Flat-file logging removed. Use memory.logExploration() instead.
   * This method is kept for call-site compatibility during the memory migration.
   */
  public async appendLog(_entry: ExplorationLogEntry): Promise<void> {
    // No-op: exploration log is now written to the DB via memory.logExploration().
    // The flat-file exploration.log is no longer written.
  }

  /**
   * Read all tasks
   */
  public async readAllTasks(): Promise<TaskRecord[]> {
    try {
      const files = await fs.readdir(this.tasksPath);
      const taskFiles = files.filter((file) => file.endsWith('.json'));

      const tasks: TaskRecord[] = [];
      for (const file of taskFiles) {
        const taskPath = path.join(this.tasksPath, file);
        const content = await fs.readFile(taskPath, 'utf-8');
        const data = JSON.parse(content) as unknown;
        tasks.push(TaskRecordSchema.parse(data));
      }

      return tasks;
    } catch {
      return [];
    }
  }

  /**
   * No-op: exploration directories are no longer created on disk.
   * Exploration state is stored in the SQLite DB via MemoryManager.
   * @deprecated OB-813 — exploration subdirs removed; DB is the primary store.
   */
  public async createExplorationDir(): Promise<void> {}

  /**
   * Read exploration state from exploration-state.json
   */
  public async readExplorationState(): Promise<ExplorationState | null> {
    const statePath = path.join(this.explorationPath, 'exploration-state.json');

    try {
      const content = await fs.readFile(statePath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return ExplorationStateSchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: statePath }, 'Failed to read exploration-state.json');
      return null;
    }
  }

  /**
   * Write exploration state to exploration-state.json
   */
  public async writeExplorationState(state: ExplorationState): Promise<void> {
    // Validate before writing
    const validated = ExplorationStateSchema.parse(state);

    await fs.mkdir(this.explorationPath, { recursive: true });
    const statePath = path.join(this.explorationPath, 'exploration-state.json');
    await fs.writeFile(statePath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Read structure scan from structure-scan.json
   */
  public async readStructureScan(): Promise<StructureScan | null> {
    const scanPath = path.join(this.explorationPath, 'structure-scan.json');

    try {
      const content = await fs.readFile(scanPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return StructureScanSchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: scanPath }, 'Failed to read structure-scan.json');
      return null;
    }
  }

  /**
   * Write structure scan to structure-scan.json
   */
  public async writeStructureScan(scan: StructureScan): Promise<void> {
    // Validate before writing
    const validated = StructureScanSchema.parse(scan);

    await fs.mkdir(this.explorationPath, { recursive: true });
    const scanPath = path.join(this.explorationPath, 'structure-scan.json');
    await fs.writeFile(scanPath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Read classification from classification.json
   */
  public async readClassification(): Promise<Classification | null> {
    const classificationPath = path.join(this.explorationPath, 'classification.json');

    try {
      const content = await fs.readFile(classificationPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return ClassificationSchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: classificationPath }, 'Failed to read classification.json');
      return null;
    }
  }

  /**
   * Write classification to classification.json
   */
  public async writeClassification(classification: Classification): Promise<void> {
    // Validate before writing
    const validated = ClassificationSchema.parse(classification);

    await fs.mkdir(this.explorationPath, { recursive: true });
    const classificationPath = path.join(this.explorationPath, 'classification.json');
    await fs.writeFile(classificationPath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Read directory dive result from exploration/dirs/{dirName}.json
   */
  public async readDirectoryDive(dirName: string): Promise<DirectoryDiveResult | null> {
    const divePath = path.join(this.explorationDirsPath, `${dirName}.json`);

    try {
      const content = await fs.readFile(divePath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return DirectoryDiveResultSchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: divePath }, 'Failed to read directory dive result');
      return null;
    }
  }

  /**
   * Write directory dive result to exploration/dirs/{dirName}.json
   */
  public async writeDirectoryDive(dirName: string, dive: DirectoryDiveResult): Promise<void> {
    // Validate before writing
    const validated = DirectoryDiveResultSchema.parse(dive);

    await fs.mkdir(this.explorationDirsPath, { recursive: true });
    const divePath = path.join(this.explorationDirsPath, `${dirName}.json`);
    await fs.writeFile(divePath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Get the path to the profiles.json file
   */
  public getProfilesPath(): string {
    return path.join(this.dotFolderPath, 'profiles.json');
  }

  /**
   * Read custom profiles registry from profiles.json
   */
  public async readProfiles(): Promise<ProfilesRegistry | null> {
    const profilesPath = this.getProfilesPath();

    try {
      const content = await fs.readFile(profilesPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return ProfilesRegistrySchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: profilesPath }, 'Failed to read profiles.json');
      return null;
    }
  }

  /**
   * Write custom profiles registry to profiles.json
   */
  public async writeProfiles(registry: ProfilesRegistry): Promise<void> {
    const validated = ProfilesRegistrySchema.parse(registry);
    const profilesPath = this.getProfilesPath();
    await fs.writeFile(profilesPath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Add or update a custom profile in the registry.
   * Creates profiles.json if it doesn't exist.
   */
  public async addProfile(profile: ToolProfile): Promise<void> {
    ToolProfileSchema.parse(profile);

    const existing = await this.readProfiles();
    const registry: ProfilesRegistry = existing ?? {
      profiles: {},
      updatedAt: new Date().toISOString(),
    };

    registry.profiles[profile.name] = profile;
    registry.updatedAt = new Date().toISOString();

    await this.writeProfiles(registry);
  }

  /**
   * Remove a custom profile from the registry.
   * Returns true if the profile was found and removed, false otherwise.
   */
  public async removeProfile(profileName: string): Promise<boolean> {
    const existing = await this.readProfiles();
    if (!existing || !(profileName in existing.profiles)) {
      return false;
    }

    delete existing.profiles[profileName];
    existing.updatedAt = new Date().toISOString();

    await this.writeProfiles(existing);
    return true;
  }

  /**
   * Get a single custom profile by name.
   * Returns null if the profile doesn't exist.
   */
  public async getProfile(profileName: string): Promise<ToolProfile | null> {
    const registry = await this.readProfiles();
    if (!registry) return null;
    return registry.profiles[profileName] ?? null;
  }

  /**
   * Get the path to the master-session.json file
   */
  public getMasterSessionPath(): string {
    return path.join(this.dotFolderPath, 'master-session.json');
  }

  /**
   * Read the persistent Master session info from master-session.json
   */
  public async readMasterSession(): Promise<MasterSession | null> {
    const sessionPath = this.getMasterSessionPath();

    try {
      const content = await fs.readFile(sessionPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return MasterSessionSchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: sessionPath }, 'Failed to read master-session.json');
      return null;
    }
  }

  /**
   * Write the persistent Master session info to master-session.json
   */
  public async writeMasterSession(session: MasterSession): Promise<void> {
    const validated = MasterSessionSchema.parse(session);
    const sessionPath = this.getMasterSessionPath();
    await fs.writeFile(sessionPath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Get the path to the prompts directory
   */
  public getPromptsPath(): string {
    return this.promptsPath;
  }

  /**
   * Get the path to the master system prompt file
   */
  public getSystemPromptPath(): string {
    return path.join(this.promptsPath, 'master-system.md');
  }

  /**
   * Read the master system prompt from .openbridge/prompts/master-system.md
   */
  public async readSystemPrompt(): Promise<string | null> {
    try {
      return await fs.readFile(this.getSystemPromptPath(), 'utf-8');
    } catch (err) {
      logger.warn({ err, path: this.getSystemPromptPath() }, 'Failed to read master-system.md');
      return null;
    }
  }

  /**
   * Write the master system prompt to .openbridge/prompts/master-system.md.
   * Creates the prompts directory if it doesn't exist.
   */
  public async writeSystemPrompt(content: string): Promise<void> {
    await fs.mkdir(this.promptsPath, { recursive: true });
    await fs.writeFile(this.getSystemPromptPath(), content, 'utf-8');
  }

  /**
   * Get the path to the workers.json file
   */
  public getWorkersPath(): string {
    return path.join(this.dotFolderPath, 'workers.json');
  }

  /**
   * Read workers registry from workers.json
   */
  public async readWorkers(): Promise<WorkersRegistry | null> {
    const workersPath = this.getWorkersPath();

    try {
      const content = await fs.readFile(workersPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return WorkersRegistrySchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: workersPath }, 'Failed to read workers.json');
      return null;
    }
  }

  /**
   * Write workers registry to workers.json
   */
  public async writeWorkers(registry: WorkersRegistry): Promise<void> {
    const validated = WorkersRegistrySchema.parse(registry);
    const workersPath = this.getWorkersPath();
    await fs.writeFile(workersPath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Read the content of a prompt template file from .openbridge/prompts/<filename>.
   */
  public async readPromptTemplate(filename: string): Promise<string> {
    return fs.readFile(path.join(this.promptsPath, filename), 'utf-8');
  }

  /**
   * Get the path to the learnings.json file
   */
  public getLearningsPath(): string {
    return path.join(this.dotFolderPath, 'learnings.json');
  }

  /**
   * Read the learnings registry from .openbridge/learnings.json
   */
  public async readLearnings(): Promise<LearningsRegistry | null> {
    const learningsPath = this.getLearningsPath();

    try {
      const content = await fs.readFile(learningsPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return LearningsRegistrySchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: learningsPath }, 'Failed to read learnings.json');
      return null;
    }
  }

  /**
   * Write the learnings registry to .openbridge/learnings.json
   */
  public async writeLearnings(registry: LearningsRegistry): Promise<void> {
    const validated = LearningsRegistrySchema.parse(registry);
    const learningsPath = this.getLearningsPath();
    await fs.writeFile(learningsPath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Append a new learning entry to the learnings registry.
   * Creates learnings.json if it doesn't exist.
   */
  public async appendLearning(entry: LearningEntry): Promise<void> {
    LearningEntrySchema.parse(entry);

    const existing = await this.readLearnings();
    const now = new Date().toISOString();
    const registry: LearningsRegistry = existing ?? {
      entries: [],
      createdAt: now,
      updatedAt: now,
      schemaVersion: '1.0.0',
    };

    registry.entries.push(entry);
    registry.updatedAt = now;

    await this.writeLearnings(registry);
  }

  /**
   * Get all learning entries for a specific task type.
   * Useful for analyzing patterns in task execution.
   */
  public async getLearningsByTaskType(taskType: string): Promise<LearningEntry[]> {
    const registry = await this.readLearnings();
    if (!registry) return [];

    return registry.entries.filter((entry) => entry.taskType === taskType);
  }

  /**
   * Get all learning entries for a specific model.
   * Useful for analyzing model performance patterns.
   */
  public async getLearningsByModel(model: string): Promise<LearningEntry[]> {
    const registry = await this.readLearnings();
    if (!registry) return [];

    return registry.entries.filter((entry) => entry.modelUsed === model);
  }

  /**
   * Get all learning entries for a specific profile.
   * Useful for analyzing profile effectiveness.
   */
  public async getLearningsByProfile(profile: string): Promise<LearningEntry[]> {
    const registry = await this.readLearnings();
    if (!registry) return [];

    return registry.entries.filter((entry) => entry.profileUsed === profile);
  }

  /**
   * Get all failed learning entries.
   * Useful for identifying problem areas and patterns.
   */
  public async getFailedLearnings(): Promise<LearningEntry[]> {
    const registry = await this.readLearnings();
    if (!registry) return [];

    return registry.entries.filter((entry) => !entry.success);
  }

  /**
   * Get learning statistics for a specific task type.
   * Returns success rate, average duration, total count, etc.
   */
  public async getTaskTypeStats(taskType: string): Promise<{
    totalCount: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    avgDurationMs: number;
    avgRetryCount: number;
  } | null> {
    const entries = await this.getLearningsByTaskType(taskType);
    if (entries.length === 0) return null;

    const successCount = entries.filter((e) => e.success).length;
    const failureCount = entries.length - successCount;
    const successRate = successCount / entries.length;
    const avgDurationMs = entries.reduce((sum, e) => sum + e.durationMs, 0) / entries.length;
    const avgRetryCount = entries.reduce((sum, e) => sum + e.retryCount, 0) / entries.length;

    return {
      totalCount: entries.length,
      successCount,
      failureCount,
      successRate,
      avgDurationMs,
      avgRetryCount,
    };
  }

  /**
   * Get learning statistics for a specific model.
   * Returns success rate, average duration, total count, etc.
   */
  public async getModelStats(model: string): Promise<{
    totalCount: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    avgDurationMs: number;
    avgRetryCount: number;
  } | null> {
    const entries = await this.getLearningsByModel(model);
    if (entries.length === 0) return null;

    const successCount = entries.filter((e) => e.success).length;
    const failureCount = entries.length - successCount;
    const successRate = successCount / entries.length;
    const avgDurationMs = entries.reduce((sum, e) => sum + e.durationMs, 0) / entries.length;
    const avgRetryCount = entries.reduce((sum, e) => sum + e.retryCount, 0) / entries.length;

    return {
      totalCount: entries.length,
      successCount,
      failureCount,
      successRate,
      avgDurationMs,
      avgRetryCount,
    };
  }

  /**
   * Initialize .openbridge folder if it doesn't exist
   */
  public async initialize(): Promise<void> {
    const folderExists = await this.exists();

    if (!folderExists) {
      await this.createFolder();
    }

    await fs.mkdir(this.contextPath, { recursive: true });
  }

  // ── Classification Cache ──────────────────────────────────────

  /**
   * Get the path to the classifications.json file
   */
  public getClassificationsPath(): string {
    return path.join(this.dotFolderPath, 'classifications.json');
  }

  /**
   * Read the classification cache from .openbridge/classifications.json.
   * Returns null if the file does not exist or cannot be parsed.
   */
  public async readClassifications(): Promise<ClassificationCache | null> {
    const classificationsPath = this.getClassificationsPath();
    try {
      const content = await fs.readFile(classificationsPath, 'utf-8');
      return ClassificationCacheSchema.parse(JSON.parse(content));
    } catch (err) {
      logger.warn({ err, path: classificationsPath }, 'Failed to read classifications.json');
      return null;
    }
  }

  /**
   * Write the classification cache to .openbridge/classifications.json.
   */
  public async writeClassifications(cache: ClassificationCache): Promise<void> {
    const validated = ClassificationCacheSchema.parse(cache);
    const classificationsPath = this.getClassificationsPath();
    await fs.writeFile(classificationsPath, JSON.stringify(validated, null, 2), 'utf-8');
  }

  // ── Prompt Library ───────────────────────────────────────────

  /**
   * Get the path to the prompt manifest file.
   */
  private getPromptManifestPath(): string {
    return path.join(this.promptsPath, 'manifest.json');
  }

  /**
   * Read the prompt manifest from .openbridge/prompts/manifest.json.
   * Returns null if the file does not exist or cannot be parsed.
   */
  public async readPromptManifest(): Promise<PromptManifest | null> {
    try {
      const content = await fs.readFile(this.getPromptManifestPath(), 'utf-8');
      const data = JSON.parse(content) as unknown;
      return PromptManifestSchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: this.getPromptManifestPath() }, 'Failed to read manifest.json');
      return null;
    }
  }

  /**
   * Write the prompt manifest to .openbridge/prompts/manifest.json.
   * Creates the prompts directory if it does not exist.
   */
  public async writePromptManifest(manifest: PromptManifest): Promise<void> {
    const validated = PromptManifestSchema.parse(manifest);
    await fs.mkdir(this.promptsPath, { recursive: true });
    await fs.writeFile(this.getPromptManifestPath(), JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Write a prompt template file to .openbridge/prompts/<filename> and update the manifest.
   * Preserves `createdAt` when overwriting an existing entry.
   * Sets `previousVersion` and `previousSuccessRate` when overwriting.
   */
  public async writePromptTemplate(
    filename: string,
    content: string,
    metadata: Omit<PromptTemplate, 'filePath' | 'createdAt' | 'updatedAt'>,
  ): Promise<void> {
    await fs.mkdir(this.promptsPath, { recursive: true });

    const filePath = path.join(this.promptsPath, filename);
    let previousFileContent: string | undefined;
    try {
      previousFileContent = await fs.readFile(filePath, 'utf-8');
    } catch {
      // File does not exist yet — first-time write, no previous version
      previousFileContent = undefined;
    }

    await fs.writeFile(filePath, content, 'utf-8');

    const now = new Date().toISOString();
    const existing = await this.readPromptManifest();

    const existingEntry = existing?.prompts[metadata.id];
    const createdAt = existingEntry?.createdAt ?? now;

    const entry: PromptTemplate = PromptTemplateSchema.parse({
      ...metadata,
      filePath: filename,
      createdAt,
      updatedAt: now,
      previousVersion: previousFileContent,
      previousSuccessRate: existingEntry?.successRate,
    });

    const manifest: PromptManifest = existing ?? {
      prompts: {},
      createdAt: now,
      updatedAt: now,
      schemaVersion: '1.0.0',
    };

    manifest.prompts[metadata.id] = entry;
    manifest.updatedAt = now;

    await this.writePromptManifest(manifest);
  }

  /**
   * Get a single prompt template by ID.
   * Returns null if the manifest does not exist or the ID is not found.
   */
  public async getPromptTemplate(id: string): Promise<PromptTemplate | null> {
    const manifest = await this.readPromptManifest();
    if (!manifest) return null;
    return manifest.prompts[id] ?? null;
  }

  /**
   * Record a prompt usage result — increments `usageCount`, conditionally `successCount`,
   * recalculates `successRate`, and updates `lastUsedAt`.
   * No-op if the prompt ID is not found in the manifest.
   */
  public async recordPromptUsage(id: string, success: boolean): Promise<void> {
    const manifest = await this.readPromptManifest();
    if (!manifest) return;

    const entry = manifest.prompts[id];
    if (!entry) return;

    entry.usageCount += 1;
    if (success) entry.successCount += 1;
    entry.successRate = entry.successCount / entry.usageCount;
    entry.lastUsedAt = new Date().toISOString();

    manifest.updatedAt = new Date().toISOString();
    await this.writePromptManifest(manifest);
  }

  /**
   * Return all prompts where `usageCount >= 3` AND `successRate < threshold`.
   */
  public async getLowPerformingPrompts(threshold: number): Promise<PromptTemplate[]> {
    const manifest = await this.readPromptManifest();
    if (!manifest) return [];

    return Object.values(manifest.prompts).filter(
      (p) => p.usageCount >= 3 && (p.successRate ?? 0) < threshold,
    );
  }

  /**
   * Reset usage stats for a prompt — zeros `usageCount`, `successCount`, `successRate`.
   * Preserves `previousSuccessRate` from the current `successRate` before zeroing.
   * No-op if the prompt ID is not found in the manifest.
   */
  public async resetPromptStats(id: string): Promise<void> {
    const manifest = await this.readPromptManifest();
    if (!manifest) return;

    const entry = manifest.prompts[id];
    if (!entry) return;

    entry.previousSuccessRate = entry.successRate;
    entry.successRate = 0;
    entry.usageCount = 0;
    entry.successCount = 0;

    manifest.updatedAt = new Date().toISOString();
    await this.writePromptManifest(manifest);
  }

  // ── Memory File ───────────────────────────────────────────────

  /**
   * Get the path to the memory file.
   */
  public getMemoryFilePath(): string {
    return path.join(this.contextPath, 'memory.md');
  }

  /**
   * Returns true if memory.md is missing or was last modified more than
   * `maxAgeMs` milliseconds ago (default: 24 hours).
   * Used on startup to decide whether to regenerate from SQLite data (OB-1617).
   */
  public async isMemoryStale(maxAgeMs = 24 * 60 * 60 * 1000): Promise<boolean> {
    try {
      const stat = await fs.stat(this.getMemoryFilePath());
      return Date.now() - stat.mtimeMs > maxAgeMs;
    } catch {
      // File does not exist
      return true;
    }
  }

  /**
   * Read the Master's curated memory from `.openbridge/context/memory.md`.
   * Returns null if the file does not exist.
   */
  public async readMemoryFile(): Promise<string | null> {
    try {
      return await fs.readFile(this.getMemoryFilePath(), 'utf-8');
    } catch (err) {
      logger.warn({ err, path: this.getMemoryFilePath() }, 'Failed to read memory.md');
      return null;
    }
  }

  /**
   * Write the Master's curated memory to `.openbridge/context/memory.md`.
   * Validates that content is at most 200 lines — throws if exceeded.
   */
  public async writeMemoryFile(content: string): Promise<void> {
    const lines = content.split('\n');
    if (lines.length > 200) {
      throw new Error(
        `memory.md exceeds 200-line limit (${lines.length} lines). Trim content before writing.`,
      );
    }
    await fs.mkdir(this.contextPath, { recursive: true });
    await fs.writeFile(this.getMemoryFilePath(), content, 'utf-8');
  }

  /**
   * Fallback: directly write memory.md from conversation history when the
   * Master AI's write attempt fails or produces no output (OB-1616).
   * Generates a concise summary from `messages` and writes it to memory.md.
   */
  public async writeMemoryFallback(
    messages: ReadonlyArray<{ role: string; content: string; created_at?: string }>,
  ): Promise<void> {
    const now = new Date().toISOString();
    const lines: string[] = [
      '# Memory (auto-generated fallback)',
      `> Generated: ${now.slice(0, 16).replace('T', ' ')}`,
      '',
      '## Recent Conversation Summary',
      '',
    ];

    for (const msg of messages) {
      const ts = msg.created_at ? msg.created_at.slice(0, 16).replace('T', ' ') : '';
      const role = msg.role.charAt(0).toUpperCase() + msg.role.slice(1);
      const snippet = msg.content.length > 200 ? msg.content.slice(0, 200) + '\u2026' : msg.content;
      lines.push(`- [${ts}] **${role}:** ${snippet}`);
      if (lines.length >= 198) break;
    }

    if (messages.length === 0) {
      lines.push('_No recent messages._');
    }

    const content = lines.join('\n');
    await this.writeMemoryFile(content);
  }

  /**
   * Append `learned` items from worker summaries to the `## Worker Learnings` section
   * of `memory.md`. New items are deduplicated against existing content using
   * normalized substring matching. Respects the 200-line file limit.
   *
   * Called after every worker batch completes (OB-1636).
   */
  public async appendLearnedToMemory(workerSummaries: WorkerSummary[]): Promise<void> {
    // Collect non-empty learned strings from the batch
    const newLearned = workerSummaries.map((s) => s.learned.trim()).filter((l) => l.length > 0);

    if (newLearned.length === 0) return;

    // Read existing memory content (create minimal stub if missing)
    const existing = (await this.readMemoryFile()) ?? '# Memory\n';

    // Normalize a string for dedup comparison (lowercase, collapse whitespace)
    const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

    const existingNorm = normalize(existing);

    // Filter out entries already present in memory
    const toAdd = newLearned.filter((item) => !existingNorm.includes(normalize(item)));

    if (toAdd.length === 0) return;

    const lines = existing.split('\n');

    // Find or insert the "## Worker Learnings" section
    const sectionHeader = '## Worker Learnings';
    let sectionIdx = lines.findIndex((l) => l.trim() === sectionHeader);

    if (sectionIdx === -1) {
      // Append new section at end of file
      if (lines[lines.length - 1] !== '') lines.push('');
      lines.push(sectionHeader);
      lines.push('');
      sectionIdx = lines.length - 2;
    }

    // Find the insertion point: just after the section header (and any blank line)
    let insertAt = sectionIdx + 1;
    if (insertAt < lines.length && lines[insertAt] === '') insertAt++;

    // Insert new bullet items at the top of the section
    const now = new Date().toISOString().slice(0, 10);
    const bullets = toAdd.map((item) => `- [${now}] ${item}`);
    lines.splice(insertAt, 0, ...bullets);

    // Enforce 200-line limit: trim the oldest items from the Worker Learnings section
    if (lines.length > 200) {
      const excess = lines.length - 200;
      // Find the end of the Worker Learnings section
      let endIdx = sectionIdx + 1;
      while (endIdx < lines.length && !/^#{1,3}\s/.test(lines[endIdx]!)) endIdx++;
      // Remove the oldest items (those furthest from the header) first
      const removeFrom = Math.max(sectionIdx + 1, endIdx - excess);
      lines.splice(removeFrom, excess);
    }

    await this.writeMemoryFile(lines.join('\n'));
  }

  // ── Dir-Dive Enumeration ───────────────────────────────────────

  /**
   * List all available directory dive results in `.openbridge/exploration/dirs/`.
   * Returns an array of `{ dirPath, resultPath }` for each `*.json` file found.
   * Returns an empty array if the directory does not exist.
   *
   * OB-1337 / OB-1340: used by KnowledgeRetriever.query() for dir-dive JSON loading.
   */
  public async listDirDiveResults(): Promise<Array<{ dirPath: string; resultPath: string }>> {
    try {
      const entries = await fs.readdir(this.explorationDirsPath, { withFileTypes: true });
      return entries
        .filter((e) => e.isFile() && e.name.endsWith('.json'))
        .map((e) => ({
          dirPath: e.name.replace(/\.json$/, ''),
          resultPath: path.join(this.explorationDirsPath, e.name),
        }));
    } catch {
      return [];
    }
  }

  // ── Batch State ────────────────────────────────────────────────

  /**
   * Get the path to the batch-state.json file.
   */
  public getBatchStatePath(): string {
    return path.join(this.dotFolderPath, 'batch-state.json');
  }

  /**
   * Read the active batch state from `.openbridge/batch-state.json`.
   * Returns null if the file does not exist or cannot be parsed.
   */
  public async readBatchState(): Promise<BatchState | null> {
    try {
      const content = await fs.readFile(this.getBatchStatePath(), 'utf-8');
      const data = JSON.parse(content) as unknown;
      return BatchStateSchema.parse(data);
    } catch (err) {
      logger.warn({ err, path: this.getBatchStatePath() }, 'Failed to read batch-state.json');
      return null;
    }
  }

  /**
   * Persist the current batch state to `.openbridge/batch-state.json`.
   */
  public async writeBatchState(state: BatchState): Promise<void> {
    const validated = BatchStateSchema.parse(state);
    await fs.writeFile(this.getBatchStatePath(), JSON.stringify(validated, null, 2), 'utf-8');
  }

  /**
   * Delete `.openbridge/batch-state.json`.
   * No-op if the file does not exist.
   */
  public async deleteBatchState(): Promise<void> {
    try {
      await fs.unlink(this.getBatchStatePath());
    } catch {
      // File may not exist — ignore
    }
  }

  // ── Industry Templates ──────────────────────────────────────────

  /**
   * Get the path to the industry-templates directory.
   */
  public getIndustryTemplatesPath(): string {
    return path.join(this.dotFolderPath, 'industry-templates');
  }

  /**
   * List available industry templates from `.openbridge/industry-templates/`.
   * Reads each sub-directory's manifest.json to extract metadata.
   * Returns an empty array when the directory does not exist or no valid manifests are found.
   *
   * OB-1466
   */
  public async listAvailableTemplates(): Promise<
    Array<{ id: string; name: string; doctypeCount: number; workflowCount: number }>
  > {
    const templatesDir = this.getIndustryTemplatesPath();
    try {
      const entries = await fs.readdir(templatesDir, { withFileTypes: true });
      const results: Array<{
        id: string;
        name: string;
        doctypeCount: number;
        workflowCount: number;
      }> = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(templatesDir, entry.name, 'manifest.json');
        try {
          const content = await fs.readFile(manifestPath, 'utf-8');
          const data = JSON.parse(content) as {
            id?: string;
            name?: string;
            doctypes?: unknown[];
            workflows?: unknown[];
          };
          results.push({
            id: typeof data.id === 'string' ? data.id : entry.name,
            name: typeof data.name === 'string' ? data.name : entry.name,
            doctypeCount: Array.isArray(data.doctypes) ? data.doctypes.length : 0,
            workflowCount: Array.isArray(data.workflows) ? data.workflows.length : 0,
          });
        } catch {
          // Skip directories with missing or malformed manifest.json
        }
      }

      return results;
    } catch {
      return [];
    }
  }
}
