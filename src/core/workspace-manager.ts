import { access } from 'node:fs/promises';
import type { WorkspaceConfig } from '../types/config.js';
import { resolveTilde } from '../providers/claude-code/claude-code-config.js';
import { createLogger } from './logger.js';

const logger = createLogger('workspace-manager');

export interface WorkspaceParseResult {
  workspace: string | undefined;
  content: string;
}

export class WorkspaceManager {
  private readonly workspaces = new Map<string, string>();
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
