import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { WorkspaceMapSchema } from '../types/workspace-map.js';
import type {
  WorkspaceMap,
  APIEndpoint,
  MapSource,
  EndpointAuth,
  HttpMethod,
} from '../types/workspace-map.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('workspace-scanner');

// ── Scanner Result ───────────────────────────────────────────────

export interface ScanResult {
  success: boolean;
  map?: WorkspaceMap;
  error?: string;
  sourceFile: string;
}

// ── OpenAPI Types (minimal subset for parsing) ───────────────────

interface OpenAPISpec {
  openapi?: string;
  swagger?: string;
  info: { title: string; description?: string; version: string };
  servers?: Array<{ url: string }>;
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths: Record<string, Record<string, OpenAPIOperation>>;
  securityDefinitions?: Record<string, OpenAPISecurityDef>;
  components?: { securitySchemes?: Record<string, OpenAPISecurityDef> };
  security?: Array<Record<string, string[]>>;
}

interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenAPIParameter[];
  requestBody?: {
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
  responses?: Record<
    string,
    { description?: string; content?: Record<string, { schema?: Record<string, unknown> }> }
  >;
}

interface OpenAPIParameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: { type?: string };
  type?: string;
  description?: string;
}

interface OpenAPISecurityDef {
  type: string;
  scheme?: string;
  in?: string;
  name?: string;
}

// ── Postman Types (minimal subset for parsing) ───────────────────

interface PostmanCollection {
  info: { name: string; description?: string; schema?: string };
  item: PostmanItem[];
  auth?: PostmanAuth;
  variable?: Array<{ key: string; value: string }>;
}

interface PostmanItem {
  name: string;
  request?: PostmanRequest;
  item?: PostmanItem[];
  description?: string;
}

interface PostmanRequest {
  method: string;
  url: PostmanUrl | string;
  header?: Array<{ key: string; value: string }>;
  body?: { mode?: string; raw?: string };
  auth?: PostmanAuth;
  description?: string;
}

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  path?: string[];
  query?: Array<{ key: string; value: string; disabled?: boolean }>;
}

interface PostmanAuth {
  type: string;
  bearer?: Array<{ key: string; value: string }>;
  apikey?: Array<{ key: string; value: string }>;
  basic?: Array<{ key: string; value: string }>;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Scan a workspace directory for API map files.
 * Supports: openbridge.map.json, OpenAPI/Swagger specs, Postman collections.
 */
export async function scanWorkspace(
  workspacePath: string,
  mapFile = 'openbridge.map.json',
): Promise<ScanResult> {
  const filePath = join(workspacePath, mapFile);

  logger.info({ workspacePath, mapFile }, 'Scanning workspace for API map');

  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    const source = detectSource(parsed, mapFile);
    logger.info({ source, filePath }, 'Detected map source type');

    let map: WorkspaceMap;
    switch (source) {
      case 'openapi':
      case 'swagger':
        map = parseOpenAPISpec(parsed as OpenAPISpec, source, filePath);
        break;
      case 'postman':
        map = parsePostmanCollection(parsed as PostmanCollection, filePath);
        break;
      default:
        map = parseWorkspaceMap(parsed, filePath);
        break;
    }

    logger.info(
      { name: map.name, endpoints: map.endpoints.length, source: map.source },
      'Workspace map loaded successfully',
    );

    return { success: true, map, sourceFile: filePath };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ error: message, filePath }, 'Failed to scan workspace');
    return { success: false, error: message, sourceFile: filePath };
  }
}

/**
 * Parse and validate a raw JSON object as a workspace map (openbridge.map.json).
 */
export function parseWorkspaceMap(raw: unknown, sourceFile?: string): WorkspaceMap {
  const map = WorkspaceMapSchema.parse(raw);
  if (sourceFile && !map.metadata.sourceFile) {
    map.metadata.sourceFile = sourceFile;
  }
  return map;
}

/**
 * Parse an OpenAPI 3.x or Swagger 2.x spec into a WorkspaceMap.
 */
export function parseOpenAPISpec(
  spec: OpenAPISpec,
  source: 'openapi' | 'swagger',
  sourceFile?: string,
): WorkspaceMap {
  const baseUrl = resolveOpenAPIBaseUrl(spec);
  const auth = resolveOpenAPIAuth(spec);
  const endpoints = extractOpenAPIEndpoints(spec);

  if (endpoints.length === 0) {
    throw new Error('OpenAPI spec contains no valid endpoints');
  }

  const map: WorkspaceMap = WorkspaceMapSchema.parse({
    version: '1.0' as const,
    name: spec.info.title,
    description: spec.info.description,
    baseUrl,
    auth,
    source,
    headers: {},
    endpoints,
    metadata: {
      generatedAt: new Date().toISOString(),
      generatedBy: 'openbridge-scanner',
      sourceFile,
    },
  });

  return map;
}

/**
 * Parse a Postman Collection v2.x into a WorkspaceMap.
 */
export function parsePostmanCollection(
  collection: PostmanCollection,
  sourceFile?: string,
): WorkspaceMap {
  const auth = resolvePostmanAuth(collection.auth);
  const endpoints = extractPostmanEndpoints(collection.item, []);
  const baseUrl = inferPostmanBaseUrl(collection);

  if (endpoints.length === 0) {
    throw new Error('Postman collection contains no valid requests');
  }

  const map: WorkspaceMap = WorkspaceMapSchema.parse({
    version: '1.0' as const,
    name: collection.info.name,
    description: collection.info.description,
    baseUrl,
    auth,
    source: 'postman' as MapSource,
    headers: {},
    endpoints,
    metadata: {
      generatedAt: new Date().toISOString(),
      generatedBy: 'openbridge-scanner',
      sourceFile,
    },
  });

  return map;
}

/**
 * Detect the source type from a parsed JSON object and filename.
 */
export function detectSource(parsed: unknown, filename: string): MapSource {
  if (typeof parsed !== 'object' || parsed === null) {
    return 'manual';
  }

  const obj = parsed as Record<string, unknown>;

  // OpenAPI 3.x
  if (typeof obj['openapi'] === 'string' && obj['openapi'].startsWith('3.')) {
    return 'openapi';
  }

  // Swagger 2.x
  if (typeof obj['swagger'] === 'string' && obj['swagger'].startsWith('2.')) {
    return 'swagger';
  }

  // Postman Collection v2.x
  if (
    typeof obj['info'] === 'object' &&
    obj['info'] !== null &&
    'schema' in (obj['info'] as Record<string, unknown>) &&
    typeof (obj['info'] as Record<string, unknown>)['schema'] === 'string' &&
    ((obj['info'] as Record<string, unknown>)['schema'] as string).includes('postman')
  ) {
    return 'postman';
  }

  // Postman by structure (item array + info.name)
  if (Array.isArray(obj['item']) && typeof obj['info'] === 'object') {
    return 'postman';
  }

  // Check file extension hints
  const ext = extname(filename).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    // YAML files with paths → likely OpenAPI (we only support JSON input, but detect intent)
    if ('paths' in obj) return 'openapi';
  }

  return 'manual';
}

// ── OpenAPI Helpers ──────────────────────────────────────────────

function resolveOpenAPIBaseUrl(spec: OpenAPISpec): string {
  // OpenAPI 3.x: use first server URL
  if (spec.servers && spec.servers.length > 0 && spec.servers[0]?.url) {
    const url = spec.servers[0].url;
    // Handle relative URLs
    if (url.startsWith('/')) {
      return `http://localhost${url}`;
    }
    return url;
  }

  // Swagger 2.x: reconstruct from host + basePath + schemes
  if (spec.host) {
    const scheme = spec.schemes?.[0] ?? 'https';
    const basePath = spec.basePath ?? '';
    return `${scheme}://${spec.host}${basePath}`;
  }

  return 'http://localhost';
}

function resolveOpenAPIAuth(spec: OpenAPISpec): EndpointAuth {
  // OpenAPI 3.x security schemes
  const schemes = spec.components?.securitySchemes ?? spec.securityDefinitions;
  if (!schemes) return { type: 'none' };

  // Use the first global security requirement
  const globalSecurity = spec.security;
  if (globalSecurity && globalSecurity.length > 0) {
    const firstReq = globalSecurity[0];
    if (firstReq) {
      const schemeName = Object.keys(firstReq)[0];
      if (schemeName && schemes[schemeName]) {
        return mapOpenAPISecurityToAuth(schemes[schemeName]);
      }
    }
  }

  // Fallback: use the first security scheme defined
  const firstScheme = Object.values(schemes)[0];
  if (firstScheme) {
    return mapOpenAPISecurityToAuth(firstScheme);
  }

  return { type: 'none' };
}

function mapOpenAPISecurityToAuth(scheme: OpenAPISecurityDef): EndpointAuth {
  // OAuth2/Bearer
  if (scheme.type === 'http' && scheme.scheme === 'bearer') {
    return { type: 'bearer', envVar: 'API_TOKEN' };
  }

  // API Key
  if (scheme.type === 'apiKey' && scheme.name) {
    return { type: 'api-key', header: scheme.name, envVar: 'API_KEY' };
  }

  // Basic
  if (scheme.type === 'http' && scheme.scheme === 'basic') {
    return { type: 'basic', usernameEnvVar: 'API_USERNAME', passwordEnvVar: 'API_PASSWORD' };
  }

  // OAuth2 (map to bearer token)
  if (scheme.type === 'oauth2') {
    return { type: 'bearer', envVar: 'OAUTH_TOKEN' };
  }

  return { type: 'none' };
}

const VALID_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

function extractOpenAPIEndpoints(spec: OpenAPISpec): APIEndpoint[] {
  const endpoints: APIEndpoint[] = [];
  let idCounter = 1;

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const upperMethod = method.toUpperCase();
      if (!VALID_HTTP_METHODS.has(upperMethod)) continue;

      const id = operation.operationId ?? `endpoint-${idCounter++}`;
      const name = operation.summary ?? operation.operationId ?? `${upperMethod} ${path}`;

      const parameters = (operation.parameters ?? [])
        .filter((p) => ['path', 'query', 'header'].includes(p.in))
        .map((p) => ({
          name: p.name,
          in: p.in as 'path' | 'query' | 'header',
          required: p.required ?? false,
          type: mapOpenAPIParamType(p.schema?.type ?? p.type),
          description: p.description,
        }));

      // Convert OpenAPI path params {id} to :id format
      const normalizedPath = path.replace(/\{(\w+)\}/g, ':$1');

      const endpoint: APIEndpoint = {
        id,
        name,
        description: operation.description,
        method: upperMethod as HttpMethod,
        path: normalizedPath,
        parameters,
        headers: {},
        tags: operation.tags ?? [],
        requestBody: extractOpenAPIRequestBody(operation),
        response: extractOpenAPIResponse(operation),
      };

      endpoints.push(endpoint);
    }
  }

  return endpoints;
}

function mapOpenAPIParamType(type?: string): 'string' | 'number' | 'boolean' {
  if (type === 'integer' || type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  return 'string';
}

function extractOpenAPIRequestBody(
  operation: OpenAPIOperation,
): { contentType: string; example?: unknown } | undefined {
  if (!operation.requestBody?.content) return undefined;

  // Prefer application/json
  const jsonContent = operation.requestBody.content['application/json'];
  if (jsonContent?.schema) {
    return {
      contentType: 'application/json',
      // Store raw OpenAPI schema as example (FieldSchema conversion not possible for raw JSON Schema)
      example: jsonContent.schema,
    };
  }

  // Fallback to first content type
  const [contentType, content] = Object.entries(operation.requestBody.content)[0] ?? [];
  if (contentType && content) {
    return { contentType };
  }

  return undefined;
}

function extractOpenAPIResponse(
  operation: OpenAPIOperation,
): { contentType: string; example?: unknown } | undefined {
  if (!operation.responses) return undefined;

  // Prefer 200, then 201, then first 2xx response
  const successKey =
    Object.keys(operation.responses).find((k) => k === '200') ??
    Object.keys(operation.responses).find((k) => k === '201') ??
    Object.keys(operation.responses).find((k) => k.startsWith('2'));

  if (!successKey) return undefined;

  const response = operation.responses[successKey];
  if (!response?.content) return undefined;

  const jsonContent = response.content['application/json'];
  if (jsonContent?.schema) {
    return {
      contentType: 'application/json',
      example: jsonContent.schema,
    };
  }

  return undefined;
}

// ── Postman Helpers ──────────────────────────────────────────────

function resolvePostmanAuth(auth?: PostmanAuth): EndpointAuth {
  if (!auth) return { type: 'none' };

  switch (auth.type) {
    case 'bearer': {
      return { type: 'bearer', envVar: 'API_TOKEN' };
    }
    case 'apikey': {
      const headerItem = auth.apikey?.find((a) => a.key === 'key');
      return {
        type: 'api-key',
        header: headerItem?.value ?? 'X-API-Key',
        envVar: 'API_KEY',
      };
    }
    case 'basic': {
      return {
        type: 'basic',
        usernameEnvVar: 'API_USERNAME',
        passwordEnvVar: 'API_PASSWORD',
      };
    }
    default:
      return { type: 'none' };
  }
}

function extractPostmanEndpoints(items: PostmanItem[], parentTags: string[]): APIEndpoint[] {
  const endpoints: APIEndpoint[] = [];
  let idCounter = 1;

  for (const item of items) {
    // Folder — recurse with folder name as tag
    if (item.item && !item.request) {
      const folderEndpoints = extractPostmanEndpoints(item.item, [...parentTags, item.name]);
      endpoints.push(...folderEndpoints);
      continue;
    }

    if (!item.request) continue;

    const req = item.request;
    const method = req.method?.toUpperCase();
    if (!method || !VALID_HTTP_METHODS.has(method)) continue;

    const url = resolvePostmanUrl(req.url);
    if (!url.path) continue;

    const id = `pm-${idCounter++}`;
    const parameters = (url.queryParams ?? []).map((q) => ({
      name: q.key,
      in: 'query' as const,
      required: false,
      type: 'string' as const,
      description: undefined,
    }));

    const headers: Record<string, string> = {};
    if (req.header) {
      for (const h of req.header) {
        headers[h.key] = h.value;
      }
    }

    const endpoint: APIEndpoint = {
      id,
      name: item.name,
      description: typeof req.description === 'string' ? req.description : item.description,
      method: method as HttpMethod,
      path: url.path,
      parameters,
      headers,
      tags: parentTags,
      requestBody: extractPostmanRequestBody(req),
    };

    endpoints.push(endpoint);
  }

  return endpoints;
}

function resolvePostmanUrl(url: PostmanUrl | string | undefined): {
  full?: string;
  path?: string;
  queryParams?: Array<{ key: string; value: string }>;
} {
  if (!url) return {};

  if (typeof url === 'string') {
    try {
      const parsed = new URL(url);
      return {
        full: url,
        path: parsed.pathname,
        queryParams: Array.from(parsed.searchParams.entries()).map(([key, value]) => ({
          key,
          value,
        })),
      };
    } catch {
      return { full: url, path: url };
    }
  }

  const path = url.path ? '/' + url.path.join('/') : undefined;
  const queryParams = url.query
    ?.filter((q) => !q.disabled)
    .map((q) => ({ key: q.key, value: q.value }));

  return { full: url.raw, path, queryParams };
}

function extractPostmanRequestBody(
  req: PostmanRequest,
): { contentType: string; example?: unknown } | undefined {
  if (!req.body?.raw) return undefined;

  try {
    const parsed: unknown = JSON.parse(req.body.raw);
    return { contentType: 'application/json', example: parsed };
  } catch {
    return { contentType: 'text/plain', example: req.body.raw };
  }
}

function inferPostmanBaseUrl(collection: PostmanCollection): string {
  // Try to extract base URL from the first request
  const firstItem = findFirstRequest(collection.item);
  if (firstItem?.request?.url) {
    const url = firstItem.request.url;
    if (typeof url === 'string') {
      try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        return 'http://localhost';
      }
    }
    if (url.protocol && url.host) {
      return `${url.protocol}://${url.host.join('.')}`;
    }
  }

  // Check collection variables for a baseUrl
  const baseUrlVar = collection.variable?.find((v) => v.key === 'baseUrl' || v.key === 'base_url');
  if (baseUrlVar?.value) return baseUrlVar.value;

  return 'http://localhost';
}

function findFirstRequest(items: PostmanItem[]): PostmanItem | undefined {
  for (const item of items) {
    if (item.request) return item;
    if (item.item) {
      const found = findFirstRequest(item.item);
      if (found) return found;
    }
  }
  return undefined;
}
