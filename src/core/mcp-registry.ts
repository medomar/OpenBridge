import type { MCPServer } from '../types/config.js';
import { checkCommandOnPath } from './health.js';

export type McpServerStatus = 'healthy' | 'error' | 'unknown';

export interface McpServerEntry extends MCPServer {
  enabled: boolean;
}

export interface McpServerWithStatus extends McpServerEntry {
  status: McpServerStatus;
}

/**
 * Runtime registry of MCP servers with enable/disable support and health status.
 * Config persistence is handled separately via persistToConfig() (OB-1173).
 */
export class McpRegistry {
  private readonly servers: Map<string, McpServerEntry>;
  // configPath is stored for use by persistToConfig() in OB-1173
  readonly configPath: string;

  constructor(configPath: string, initialServers: MCPServer[]) {
    this.configPath = configPath;
    this.servers = new Map();
    for (const server of initialServers) {
      this.servers.set(server.name, { ...server, enabled: true });
    }
  }

  /**
   * Add a new MCP server to the registry.
   * Throws if a server with the same name already exists.
   */
  addServer(server: MCPServer): void {
    if (this.servers.has(server.name)) {
      throw new Error(`MCP server "${server.name}" already exists`);
    }
    this.servers.set(server.name, { ...server, enabled: true });
  }

  /**
   * Remove an MCP server from the registry by name.
   * Throws if no server with that name is found.
   */
  removeServer(name: string): void {
    if (!this.servers.has(name)) {
      throw new Error(`MCP server "${name}" not found`);
    }
    this.servers.delete(name);
  }

  /**
   * Enable or disable an MCP server by name.
   * Throws if no server with that name is found.
   */
  toggleServer(name: string, enabled: boolean): void {
    const entry = this.servers.get(name);
    if (!entry) {
      throw new Error(`MCP server "${name}" not found`);
    }
    this.servers.set(name, { ...entry, enabled });
  }

  /**
   * List all servers with their enabled state and health status.
   * Status is determined by checking whether the server's command exists on PATH:
   * - 'healthy'  — server enabled and command found on PATH
   * - 'error'    — server enabled but command not found on PATH
   * - 'unknown'  — server is disabled (command not checked)
   */
  listServers(): McpServerWithStatus[] {
    return Array.from(this.servers.values()).map((entry) => {
      let status: McpServerStatus;
      if (!entry.enabled) {
        status = 'unknown';
      } else {
        status = checkCommandOnPath(entry.command) ? 'healthy' : 'error';
      }
      return { ...entry, status };
    });
  }

  /**
   * Get a single server entry by name.
   * Returns undefined if not found.
   */
  getServer(name: string): McpServerEntry | undefined {
    return this.servers.get(name);
  }
}
