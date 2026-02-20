import { readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { WorkspaceMapSchema } from '../../types/workspace-map.js';
import type { WorkspaceMap } from '../../types/workspace-map.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('map-loader');

/** Default filename for workspace map files */
export const DEFAULT_MAP_FILENAME = 'openbridge.map.json';

/**
 * Resolve environment variable references in auth config values.
 * Replaces `${ENV_VAR}` with the value of the environment variable.
 * Throws if a referenced env var is not set.
 */
export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)}/g, (_match, varName: string) => {
    const envValue = process.env[varName];
    if (envValue === undefined) {
      throw new Error(`Environment variable "${varName}" is not set (referenced in workspace map)`);
    }
    return envValue;
  });
}

/**
 * Resolve env var references in all auth-related fields of a workspace map.
 * Returns a new map with resolved values (does not mutate the input).
 */
export function resolveMapEnvVars(map: WorkspaceMap): WorkspaceMap {
  const resolvedAuth = resolveAuthEnvVars(map.auth);
  const resolvedHeaders = resolveHeaderEnvVars(map.headers);
  const resolvedEndpoints = map.endpoints.map((ep) => ({
    ...ep,
    auth: ep.auth ? resolveAuthEnvVars(ep.auth) : ep.auth,
    headers: resolveHeaderEnvVars(ep.headers),
  }));

  return {
    ...map,
    auth: resolvedAuth,
    headers: resolvedHeaders,
    endpoints: resolvedEndpoints,
  };
}

function resolveAuthEnvVars(auth: WorkspaceMap['auth']): WorkspaceMap['auth'] {
  switch (auth.type) {
    case 'api-key':
      return { ...auth, envVar: auth.envVar };
    case 'bearer':
      return { ...auth, envVar: auth.envVar };
    case 'basic':
      return { ...auth, usernameEnvVar: auth.usernameEnvVar, passwordEnvVar: auth.passwordEnvVar };
    case 'custom':
      return {
        ...auth,
        headers: Object.fromEntries(
          Object.entries(auth.headers).map(([k, v]) => [k, resolveEnvVars(v)]),
        ),
      };
    case 'none':
      return auth;
  }
}

function resolveHeaderEnvVars(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, resolveEnvVars(value)]),
  );
}

/**
 * Load and validate a workspace map from an `openbridge.map.json` file.
 *
 * @param workspacePath - Absolute path to the workspace directory
 * @param mapFilename - Map filename (default: `openbridge.map.json`), relative to workspace
 * @returns Parsed and validated WorkspaceMap
 */
export async function loadWorkspaceMap(
  workspacePath: string,
  mapFilename: string = DEFAULT_MAP_FILENAME,
): Promise<WorkspaceMap> {
  const mapPath = isAbsolute(mapFilename) ? mapFilename : join(workspacePath, mapFilename);

  logger.info({ mapPath }, 'Loading workspace map');

  const raw = await readFile(mapPath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  const map = WorkspaceMapSchema.parse(parsed);

  logger.info(
    {
      name: map.name,
      baseUrl: map.baseUrl,
      endpointCount: map.endpoints.length,
      source: map.source,
    },
    'Workspace map loaded successfully',
  );

  return map;
}

/**
 * Load and validate a workspace map, then resolve env var references.
 * Use this when you need the map ready for API execution.
 */
export async function loadAndResolveWorkspaceMap(
  workspacePath: string,
  mapFilename?: string,
): Promise<WorkspaceMap> {
  const map = await loadWorkspaceMap(workspacePath, mapFilename);
  return resolveMapEnvVars(map);
}
