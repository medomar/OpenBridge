import { readFileSync, writeFileSync } from 'node:fs';
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
  private onChange: ((servers: McpServerWithStatus[]) => void) | null = null;

  constructor(configPath: string, initialServers: MCPServer[]) {
    this.configPath = configPath;
    this.servers = new Map();
    for (const server of initialServers) {
      this.servers.set(server.name, { ...server, enabled: true });
    }
  }

  /**
   * Register a callback to be called after every mutation (add/remove/toggle).
   * Used to broadcast mcp-status WebSocket events to connected clients.
   */
  setOnChange(callback: (servers: McpServerWithStatus[]) => void): void {
    this.onChange = callback;
  }

  private notifyChange(): void {
    if (this.onChange) {
      this.onChange(this.listServers());
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
    this.persistToConfig();
    this.notifyChange();
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
    this.persistToConfig();
    this.notifyChange();
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
    this.persistToConfig();
    this.notifyChange();
  }

  /**
   * Mask all values in an env record for safe API/WebSocket exposure.
   * Shows first 4 chars + '****', or just '****' if value is shorter than 4 chars.
   */
  private maskEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
    if (env === undefined) return undefined;
    const masked: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      masked[key] = value.length >= 4 ? `${value.slice(0, 4)}****` : '****';
    }
    return masked;
  }

  /**
   * List all servers with their enabled state and health status.
   * Status is determined by checking whether the server's command exists on PATH:
   * - 'healthy'  — server enabled and command found on PATH
   * - 'error'    — server enabled but command not found on PATH
   * - 'unknown'  — server is disabled (command not checked)
   *
   * Env var values are masked (first 4 chars + ****) to prevent credential leakage
   * in API responses and WebSocket broadcasts.
   */
  listServers(): McpServerWithStatus[] {
    return Array.from(this.servers.values()).map((entry) => {
      let status: McpServerStatus;
      if (!entry.enabled) {
        status = 'unknown';
      } else {
        status = checkCommandOnPath(entry.command) ? 'healthy' : 'error';
      }
      return { ...entry, env: this.maskEnv(entry.env), status };
    });
  }

  /**
   * Get a single server entry by name.
   * Returns undefined if not found.
   */
  getServer(name: string): McpServerEntry | undefined {
    return this.servers.get(name);
  }

  /**
   * Replace the internal server list with a new set of servers.
   * Used by hot-reload: called from Bridge.onConfigChange() when config.json is updated
   * externally (e.g., by a user or CI pipeline). Does NOT persist to config — the new
   * servers are already on disk; this just synchronises the runtime state.
   */
  reload(servers: MCPServer[]): void {
    this.servers.clear();
    for (const server of servers) {
      this.servers.set(server.name, { ...server, enabled: true });
    }
  }

  /**
   * Persist current server list to config.json.
   * Reads the file, merges mcp.servers from internal state, and writes back.
   * Called after every mutation (addServer, removeServer, toggleServer).
   */
  private persistToConfig(): void {
    let raw: string;
    try {
      raw = readFileSync(this.configPath, 'utf-8');
    } catch (err) {
      throw new Error(
        `McpRegistry: cannot read config file "${this.configPath}": ${(err as Error).message}`,
      );
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      throw new Error(
        `McpRegistry: config file "${this.configPath}" is not valid JSON: ${(err as Error).message}`,
      );
    }

    // Build MCPServer array from internal state, stripping the runtime-only `enabled` field
    const servers: MCPServer[] = Array.from(this.servers.values()).map((entry) => {
      const server: MCPServer = { name: entry.name, command: entry.command };
      if (entry.args !== undefined) server.args = entry.args;
      if (entry.env !== undefined) server.env = entry.env;
      return server;
    });

    // Preserve existing mcp fields (enabled, configPath) and replace servers
    const existingMcp =
      typeof parsed['mcp'] === 'object' && parsed['mcp'] !== null
        ? (parsed['mcp'] as Record<string, unknown>)
        : {};
    parsed['mcp'] = { ...existingMcp, servers };

    writeFileSync(this.configPath, JSON.stringify(parsed, null, 2), 'utf-8');
  }
}
