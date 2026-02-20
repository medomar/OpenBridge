import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  WorkspaceMap,
  AgentsRegistry,
  ExplorationLogEntry,
  TaskRecord,
} from '../types/master.js';
import {
  WorkspaceMapSchema,
  AgentsRegistrySchema,
  ExplorationLogEntrySchema,
  TaskRecordSchema,
} from '../types/master.js';

const execAsync = promisify(exec);

/**
 * Manages the .openbridge/ folder inside the target workspace.
 * This folder contains:
 * - .git/ — local git repo tracking Master AI changes
 * - workspace-map.json — auto-generated project understanding
 * - exploration.log — timestamped scan history
 * - agents.json — discovered AI tools + roles
 * - tasks/ — task history (one JSON per task)
 */
export class DotFolderManager {
  private readonly workspacePath: string;
  private readonly dotFolderPath: string;
  private readonly tasksPath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.dotFolderPath = path.join(workspacePath, '.openbridge');
    this.tasksPath = path.join(this.dotFolderPath, 'tasks');
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
   * - .openbridge/tasks/
   */
  public async createFolder(): Promise<void> {
    await fs.mkdir(this.dotFolderPath, { recursive: true });
    await fs.mkdir(this.tasksPath, { recursive: true });
  }

  /**
   * Initialize git repository inside .openbridge/
   * This repo tracks all Master AI changes to the workspace knowledge.
   */
  public async initGit(): Promise<void> {
    const gitPath = path.join(this.dotFolderPath, '.git');

    // Check if git repo already exists
    try {
      await fs.access(gitPath);
      return; // Already initialized
    } catch {
      // Not initialized, proceed
    }

    // Initialize git repo
    await execAsync('git init', { cwd: this.dotFolderPath });

    // Create .gitignore to avoid tracking unnecessary files
    const gitignore = `# Ignore node_modules if they somehow end up here
node_modules/

# Ignore OS files
.DS_Store
Thumbs.db
`;
    await fs.writeFile(path.join(this.dotFolderPath, '.gitignore'), gitignore, 'utf-8');

    // Initial commit
    await this.commitChanges('Initial commit: .openbridge folder created');
  }

  /**
   * Commit changes to the .openbridge git repo
   */
  public async commitChanges(message: string): Promise<void> {
    try {
      // Add all changes
      await execAsync('git add -A', { cwd: this.dotFolderPath });

      // Check if there are changes to commit
      const { stdout: status } = await execAsync('git status --porcelain', {
        cwd: this.dotFolderPath,
      });

      if (!status.trim()) {
        // No changes to commit
        return;
      }

      // Commit with message
      await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
        cwd: this.dotFolderPath,
      });
    } catch (error) {
      // If git user is not configured, try to set a default
      if (error instanceof Error && error.message.includes('user.email')) {
        await execAsync('git config user.email "master@openbridge.local"', {
          cwd: this.dotFolderPath,
        });
        await execAsync('git config user.name "OpenBridge Master AI"', {
          cwd: this.dotFolderPath,
        });

        // Retry commit
        await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
          cwd: this.dotFolderPath,
        });
      } else {
        throw error;
      }
    }
  }

  /**
   * Read workspace map from workspace-map.json
   */
  public async readMap(): Promise<WorkspaceMap | null> {
    const mapPath = this.getMapPath();

    try {
      const content = await fs.readFile(mapPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return WorkspaceMapSchema.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * Write workspace map to workspace-map.json
   */
  public async writeMap(map: WorkspaceMap): Promise<void> {
    // Validate before writing
    const validated = WorkspaceMapSchema.parse(map);

    const mapPath = this.getMapPath();
    await fs.writeFile(mapPath, JSON.stringify(validated, null, 2), 'utf-8');
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
   */
  public async appendLog(entry: ExplorationLogEntry): Promise<void> {
    // Validate before appending
    const validated = ExplorationLogEntrySchema.parse(entry);

    const logPath = this.getLogPath();
    const line = JSON.stringify(validated) + '\n';

    await fs.appendFile(logPath, line, 'utf-8');
  }

  /**
   * Read all exploration log entries
   */
  public async readLog(): Promise<ExplorationLogEntry[]> {
    const logPath = this.getLogPath();

    try {
      const content = await fs.readFile(logPath, 'utf-8');
      const lines = content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as unknown);

      return lines.map((line) => ExplorationLogEntrySchema.parse(line));
    } catch {
      return [];
    }
  }

  /**
   * Record a task in tasks/ folder and commit to git
   */
  public async recordTask(task: TaskRecord): Promise<void> {
    // Validate before recording
    const validated = TaskRecordSchema.parse(task);

    const taskPath = path.join(this.tasksPath, `${task.id}.json`);
    await fs.writeFile(taskPath, JSON.stringify(validated, null, 2), 'utf-8');

    // Commit the task to git with conventional commit format
    const commitMessage = `chore(master): record task ${task.id} - ${task.status}`;
    await this.commitChanges(commitMessage);
  }

  /**
   * Read a task by ID
   */
  public async readTask(taskId: string): Promise<TaskRecord | null> {
    const taskPath = path.join(this.tasksPath, `${taskId}.json`);

    try {
      const content = await fs.readFile(taskPath, 'utf-8');
      const data = JSON.parse(content) as unknown;
      return TaskRecordSchema.parse(data);
    } catch {
      return null;
    }
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
   * Initialize .openbridge folder if it doesn't exist
   * Creates folder structure and initializes git repo
   */
  public async initialize(): Promise<void> {
    const folderExists = await this.exists();

    if (!folderExists) {
      await this.createFolder();
      await this.initGit();
    }
  }
}
