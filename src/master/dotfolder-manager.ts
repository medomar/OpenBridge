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
import type { ToolProfile, ProfilesRegistry } from '../types/agent.js';
import { ToolProfileSchema, ProfilesRegistrySchema } from '../types/agent.js';
import type { WorkersRegistry } from './worker-registry.js';
import { WorkersRegistrySchema } from './worker-registry.js';

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

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.dotFolderPath = path.join(workspacePath, '.openbridge');
    this.tasksPath = path.join(this.dotFolderPath, 'tasks');
    this.explorationPath = path.join(this.dotFolderPath, 'exploration');
    this.explorationDirsPath = path.join(this.explorationPath, 'dirs');
    this.promptsPath = path.join(this.dotFolderPath, 'prompts');
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
    try {
      const content = await fs.readFile(this.getMapPath(), 'utf-8');
      const data = JSON.parse(content) as unknown;
      return WorkspaceMapSchema.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Write workspace map to .openbridge/workspace-map.json as a JSON safety net.
   * Primary storage is the DB (via memory.storeChunks); this is the fallback.
   */
  public async writeWorkspaceMap(map: WorkspaceMap): Promise<void> {
    const validated = WorkspaceMapSchema.parse(map);
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    } catch {
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
    await fs.writeFile(path.join(this.promptsPath, filename), content, 'utf-8');

    const now = new Date().toISOString();
    const existing = await this.readPromptManifest();

    const existingEntry = existing?.prompts[metadata.id];
    const createdAt = existingEntry?.createdAt ?? now;

    const entry: PromptTemplate = PromptTemplateSchema.parse({
      ...metadata,
      filePath: filename,
      createdAt,
      updatedAt: now,
      previousVersion: existingEntry ? content : undefined,
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
}
