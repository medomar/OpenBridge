import { access } from 'node:fs/promises';
import type { WorkspaceConfig } from '../../types/config.js';
import type { WorkspaceMap } from '../../types/workspace-map.js';
import { scanWorkspace } from '../knowledge/workspace-scanner.js';
import { resolveTilde } from '../../providers/claude-code/claude-code-config.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('workspace-manager');

export interface WorkspaceParseResult {
  workspace: string | undefined;
  content: string;
}

export class WorkspaceManager {
  private readonly workspaces = new Map<string, string>();
  private readonly workspaceMaps = new Map<string, WorkspaceMap>();
  private readonly defaultWorkspace: string | undefined;

  constructor(workspaces: WorkspaceConfig[], defaultWorkspace?: string) {
    for (const ws of workspaces) {
      this.workspaces.set(ws.name, resolveTilde(ws.path));
    }
    this.defaultWorkspace = defaultWorkspace;

    logger.info(
      { workspaceCount: this.workspaces.size, defaultWorkspace },
      'Workspace manager initialized',
    );
  }

  get enabled(): boolean {
    return this.workspaces.size > 0;
  }

  /** Validate all workspace paths exist on disk */
  async validatePaths(): Promise<void> {
    for (const [name, wsPath] of this.workspaces) {
      await access(wsPath).catch(() => {
        throw new Error(`Workspace "${name}" path does not exist or is not accessible: ${wsPath}`);
      });
    }
  }

  /**
   * Load workspace maps for all configured workspaces.
   * Scans each workspace directory for an `openbridge.map.json` (or OpenAPI/Postman spec).
   * Workspaces without a map file are silently skipped — they remain usable but without API knowledge.
   */
  async loadMaps(): Promise<void> {
    for (const [name, wsPath] of this.workspaces) {
      const result = await scanWorkspace(wsPath);
      if (result.success && result.map) {
        this.workspaceMaps.set(name, result.map);
        logger.info(
          { workspace: name, endpoints: result.map.endpoints.length, source: result.map.source },
          'Workspace map loaded',
        );
      } else {
        logger.debug(
          { workspace: name, error: result.error },
          'No workspace map found (workspace will operate without API knowledge)',
        );
      }
    }
  }

  /** Get the workspace map for a named workspace, or undefined if none loaded. */
  getMap(name: string): WorkspaceMap | undefined {
    return this.workspaceMaps.get(name);
  }

  /** Resolve a workspace name and return its map. Falls back to defaultWorkspace if name is undefined. */
  resolveMap(name: string | undefined): WorkspaceMap | undefined {
    const resolvedName = name ?? this.defaultWorkspace;
    if (!resolvedName) return undefined;
    return this.workspaceMaps.get(resolvedName);
  }

  /** Get all loaded workspace maps as a name→map record. */
  getAllMaps(): ReadonlyMap<string, WorkspaceMap> {
    return this.workspaceMaps;
  }

  /**
   * Parse workspace selector from message content.
   * Supports `@workspace-name command` syntax.
   * Returns the workspace name (or undefined) and the remaining content.
   */
  parseWorkspace(content: string): WorkspaceParseResult {
    const trimmed = content.trimStart();
    const match = /^@([\w-]+)\s+(.*)$/s.exec(trimmed);

    if (match && this.workspaces.has(match[1]!)) {
      return { workspace: match[1], content: match[2]!.trimStart() };
    }

    return { workspace: undefined, content: trimmed };
  }

  /** Resolve a workspace name to its path. Falls back to defaultWorkspace if name is undefined. */
  resolve(name: string | undefined): string | undefined {
    if (name) {
      return this.workspaces.get(name);
    }
    if (this.defaultWorkspace) {
      return this.workspaces.get(this.defaultWorkspace);
    }
    return undefined;
  }

  /** Get the default workspace name */
  get defaultName(): string | undefined {
    return this.defaultWorkspace;
  }

  /** List all available workspace names */
  listWorkspaces(): Array<{ name: string; path: string }> {
    return Array.from(this.workspaces.entries()).map(([name, path]) => ({ name, path }));
  }

  /** Format workspace list as a user-friendly string */
  formatList(): string {
    const entries = this.listWorkspaces();
    if (entries.length === 0) return 'No workspaces configured.';

    const lines = entries.map(
      ({ name, path }) =>
        `• *${name}*${name === this.defaultWorkspace ? ' (default)' : ''} → ${path}`,
    );
    return `Available workspaces:\n${lines.join('\n')}\n\nUse @workspace-name before your command to switch.`;
  }
}
