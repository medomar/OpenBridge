import type { OpenAPIV3 } from 'openapi-types';
import { AgentRunner, TOOLS_READ_ONLY } from '../../core/agent-runner.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('doc-parser');

// ── Extraction prompt ────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are an API documentation parser. Extract ALL API endpoints from the documentation below.

For each endpoint, return a JSON object with these fields:
- method: HTTP method (GET, POST, PUT, PATCH, DELETE)
- path: URL path template (e.g. "/users/{id}")
- summary: Brief description of what the endpoint does
- description: Longer description if available
- parameters: Array of { name, in ("path"|"query"|"header"), required (boolean), type ("string"|"number"|"integer"|"boolean"), description }
- requestBody: { contentType, properties: { [name]: { type, description, required } } } or null
- responseDescription: Brief description of the response
- auth: Authentication requirement if mentioned (e.g. "Bearer token", "API key", "Basic auth") or null
- tags: Array of category/group names if the docs organize endpoints into sections

IMPORTANT:
- Return ONLY a JSON array of endpoint objects. No markdown, no explanations.
- If the documentation mentions a base URL, include it as the first element: { "baseUrl": "https://..." }
- Use OpenAPI path parameter syntax: {paramName} not :paramName
- Infer types from examples when not explicitly stated
- If no endpoints are found, return an empty array: []

DOCUMENTATION:
`;

// ── Types ────────────────────────────────────────────────────────────────────

/** Endpoint extracted by the AI worker. */
interface ExtractedEndpoint {
  method: string;
  path: string;
  summary?: string;
  description?: string;
  parameters?: Array<{
    name: string;
    in: 'path' | 'query' | 'header';
    required?: boolean;
    type?: string;
    description?: string;
  }>;
  requestBody?: {
    contentType?: string;
    properties?: Record<
      string,
      {
        type?: string;
        description?: string;
        required?: boolean;
      }
    >;
  } | null;
  responseDescription?: string;
  auth?: string | null;
  tags?: string[];
}

/** Base URL element that may appear as the first element in the AI output. */
interface BaseUrlEntry {
  baseUrl: string;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * AI-powered API endpoint extraction from arbitrary documentation.
 *
 * Spawns a `read-only` worker with the documentation content and a structured
 * extraction prompt. The worker analyses the text (plain text, Markdown, HTML,
 * or pre-extracted PDF text) and returns a JSON array of endpoints. This
 * function parses that output into an OpenAPI 3.0 document.
 *
 * @param docContent  Raw documentation text (Markdown, HTML, plain text, etc.)
 * @param workspacePath  Working directory for the AI worker (defaults to cwd)
 * @returns OpenAPI 3.0 document derived from the documentation
 * @throws Error if the AI worker fails or returns no parseable endpoints
 */
export async function docsToOpenAPI(
  docContent: string,
  workspacePath?: string,
): Promise<OpenAPIV3.Document> {
  if (!docContent.trim()) {
    throw new Error('Empty documentation content provided');
  }

  // Truncate extremely long docs to avoid exceeding context limits
  const maxDocLength = 100_000;
  const truncated =
    docContent.length > maxDocLength
      ? docContent.slice(0, maxDocLength) + '\n\n[... documentation truncated ...]'
      : docContent;

  const prompt = EXTRACTION_PROMPT + truncated;

  const runner = new AgentRunner();
  const result = await runner.spawn({
    prompt,
    workspacePath: workspacePath ?? process.cwd(),
    model: 'sonnet',
    allowedTools: [...TOOLS_READ_ONLY],
    maxTurns: 1,
    timeout: 60_000,
    retries: 1,
    retryDelay: 5_000,
  });

  if (result.exitCode !== 0) {
    logger.error(
      { exitCode: result.exitCode, stderr: result.stderr.slice(0, 500) },
      'AI worker failed to extract API endpoints from documentation',
    );
    throw new Error(
      `AI worker exited with code ${result.exitCode}: ${result.stderr.slice(0, 200)}`,
    );
  }

  const output = result.stdout.trim();
  if (!output) {
    throw new Error('AI worker returned empty output — no endpoints extracted');
  }

  // Parse the JSON array from the worker output
  const endpoints = parseWorkerOutput(output);

  if (endpoints.length === 0) {
    logger.warn('AI worker found no API endpoints in the documentation');
  }

  const spec = endpointsToOpenAPI(endpoints);

  logger.info(
    { pathCount: Object.keys(spec.paths ?? {}).length },
    'Documentation parsed into OpenAPI spec',
  );

  return spec;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse the AI worker's stdout into an array of extracted endpoints.
 * Handles JSON wrapped in markdown code fences or with surrounding text.
 */
function parseWorkerOutput(output: string): Array<ExtractedEndpoint | BaseUrlEntry> {
  // Try direct JSON parse first
  const directResult = tryParseJson(output);
  if (directResult) return directResult;

  // Try extracting from markdown code fences
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch?.[1]) {
    const fenceResult = tryParseJson(fenceMatch[1]);
    if (fenceResult) return fenceResult;
  }

  // Try finding the first JSON array in the output
  const arrayMatch = output.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    const arrayResult = tryParseJson(arrayMatch[0]);
    if (arrayResult) return arrayResult;
  }

  logger.warn({ outputSnippet: output.slice(0, 300) }, 'Could not parse worker output as JSON');
  return [];
}

/** Attempt to parse a string as a JSON array of endpoints. */
function tryParseJson(str: string): Array<ExtractedEndpoint | BaseUrlEntry> | null {
  try {
    const parsed: unknown = JSON.parse(str.trim());
    if (Array.isArray(parsed)) {
      return parsed as Array<ExtractedEndpoint | BaseUrlEntry>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Convert extracted endpoints into an OpenAPI 3.0 document. */
function endpointsToOpenAPI(entries: Array<ExtractedEndpoint | BaseUrlEntry>): OpenAPIV3.Document {
  const spec: OpenAPIV3.Document = {
    openapi: '3.0.3',
    info: {
      title: 'Extracted from documentation',
      version: '1.0.0',
    },
    paths: {},
  };

  const tags = new Set<string>();
  let hasBearerAuth = false;
  let hasBasicAuth = false;
  let hasApiKey = false;

  for (const entry of entries) {
    // Handle base URL entry
    if ('baseUrl' in entry && typeof entry.baseUrl === 'string') {
      spec.servers = [{ url: entry.baseUrl }];
      continue;
    }

    const endpoint = entry as ExtractedEndpoint;
    if (!endpoint.method || !endpoint.path) continue;

    const method = endpoint.method.toLowerCase();
    const path = normalizePath(endpoint.path);

    const paths = spec.paths as Record<string, Record<string, unknown>>;
    if (!paths[path]) paths[path] = {};
    const pathItem = paths[path];

    // Skip if method already exists on this path
    if (pathItem[method]) continue;

    const operation: OpenAPIV3.OperationObject = {
      summary: endpoint.summary ?? `${endpoint.method} ${path}`,
      responses: {
        '200': {
          description: endpoint.responseDescription ?? 'Successful response',
        },
      },
    };

    if (endpoint.description) {
      operation.description = endpoint.description;
    }

    operation.operationId = generateOperationId(method, path);

    // Tags
    if (endpoint.tags && endpoint.tags.length > 0) {
      operation.tags = endpoint.tags;
      for (const tag of endpoint.tags) tags.add(tag);
    }

    // Parameters
    const parameters: OpenAPIV3.ParameterObject[] = [];

    // Extract path parameters from the path template
    const pathVarMatches = path.matchAll(/\{(\w+)\}/g);
    const declaredPathParams = new Set<string>();
    for (const m of pathVarMatches) {
      declaredPathParams.add(m[1]!);
    }

    if (endpoint.parameters) {
      for (const param of endpoint.parameters) {
        parameters.push({
          name: param.name,
          in: param.in,
          required: param.in === 'path' ? true : (param.required ?? false),
          schema: mapTypeToSchema(param.type),
          ...(param.description ? { description: param.description } : {}),
        });
        if (param.in === 'path') declaredPathParams.delete(param.name);
      }
    }

    // Add any path params from the template that weren't declared
    for (const paramName of declaredPathParams) {
      parameters.push({
        name: paramName,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
    }

    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    // Request body
    if (
      endpoint.requestBody?.properties &&
      Object.keys(endpoint.requestBody.properties).length > 0
    ) {
      const contentType = endpoint.requestBody.contentType ?? 'application/json';
      const properties: Record<string, OpenAPIV3.SchemaObject> = {};
      const required: string[] = [];

      for (const [name, prop] of Object.entries(endpoint.requestBody.properties)) {
        properties[name] = {
          ...mapTypeToSchema(prop.type),
          ...(prop.description ? { description: prop.description } : {}),
        };
        if (prop.required) required.push(name);
      }

      operation.requestBody = {
        content: {
          [contentType]: {
            schema: {
              type: 'object',
              properties,
              ...(required.length > 0 ? { required } : {}),
            },
          },
        },
      };
    }

    // Auth detection
    if (endpoint.auth) {
      const authLower = endpoint.auth.toLowerCase();
      const security: Record<string, string[]>[] = [];

      if (authLower.includes('bearer')) {
        hasBearerAuth = true;
        security.push({ bearerAuth: [] });
      } else if (authLower.includes('basic')) {
        hasBasicAuth = true;
        security.push({ basicAuth: [] });
      } else if (authLower.includes('api') && authLower.includes('key')) {
        hasApiKey = true;
        security.push({ apiKeyAuth: [] });
      }

      if (security.length > 0) {
        operation.security = security;
      }
    }

    pathItem[method] = operation;
  }

  // Add tags
  if (tags.size > 0) {
    spec.tags = [...tags].map((name) => ({ name }));
  }

  // Add security schemes
  const securitySchemes: Record<string, OpenAPIV3.SecuritySchemeObject> = {};
  if (hasBearerAuth) {
    securitySchemes['bearerAuth'] = { type: 'http', scheme: 'bearer' };
  }
  if (hasBasicAuth) {
    securitySchemes['basicAuth'] = { type: 'http', scheme: 'basic' };
  }
  if (hasApiKey) {
    securitySchemes['apiKeyAuth'] = { type: 'apiKey', name: 'X-API-Key', in: 'header' };
  }
  if (Object.keys(securitySchemes).length > 0) {
    spec.components = { securitySchemes };
  }

  return spec;
}

/** Normalize a path to ensure it starts with / and uses {param} syntax. */
function normalizePath(path: string): string {
  let normalized = path.trim();

  // Convert :param to {param}
  normalized = normalized.replace(/:(\w+)/g, '{$1}');

  // Ensure leading slash
  if (!normalized.startsWith('/')) {
    // Strip protocol+host if present
    const withoutProtocol = normalized.replace(/^https?:\/\/[^/]*/, '');
    normalized = withoutProtocol.startsWith('/') ? withoutProtocol : '/' + withoutProtocol;
  }

  // Remove trailing slash (except root)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Remove query string if present
  const qIdx = normalized.indexOf('?');
  if (qIdx >= 0) {
    normalized = normalized.slice(0, qIdx);
  }

  return normalized;
}

/** Map a loose type string to an OpenAPI SchemaObject. */
function mapTypeToSchema(type: string | undefined): OpenAPIV3.SchemaObject {
  if (!type) return { type: 'string' };
  const lower = type.toLowerCase();
  if (lower === 'integer' || lower === 'int') return { type: 'integer' };
  if (lower === 'number' || lower === 'float' || lower === 'double') return { type: 'number' };
  if (lower === 'boolean' || lower === 'bool') return { type: 'boolean' };
  if (lower === 'array') return { type: 'array', items: {} };
  if (lower === 'object') return { type: 'object' };
  return { type: 'string' };
}

/** Generate a unique operation ID from method + path. */
function generateOperationId(method: string, path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((s) => {
      if (s.startsWith('{') && s.endsWith('}')) {
        return `by_${s.slice(1, -1)}`;
      }
      return s.replace(/[^a-zA-Z0-9]/g, '_');
    });

  return `${method}_${segments.join('_')}`;
}
