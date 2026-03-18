import type { OpenAPIV3 } from 'openapi-types';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('curl-parser');

// ── Parsed cURL representation ───────────────────────────────────────────────

/** Parsed representation of a single cURL command. */
interface ParsedCurl {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  basicAuth?: { user: string; password: string };
  cookies?: string;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert one or more cURL commands to an OpenAPI 3.0 specification.
 *
 * Supported cURL flags:
 *  - `-X`, `--request`   — HTTP method
 *  - `-H`, `--header`    — Headers (e.g. `-H "Authorization: Bearer ..."`)
 *  - `-d`, `--data`, `--data-raw`, `--data-binary` — Request body
 *  - `-u`, `--user`      — Basic auth (user:password)
 *  - `-b`, `--cookie`    — Cookies
 *  - Multi-line cURL with backslash continuation is joined before parsing
 *
 * @param curls  Array of raw cURL command strings
 * @returns OpenAPI 3.0 document
 */
export function curlsToOpenAPI(curls: string[]): OpenAPIV3.Document {
  const parsed = curls.map(parseSingleCurl);

  // Derive common base URL
  const baseUrl = deriveBaseUrl(parsed);

  const spec: OpenAPIV3.Document = {
    openapi: '3.0.3',
    info: {
      title: 'Converted from cURL',
      version: '1.0.0',
    },
    paths: {},
  };

  if (baseUrl) {
    spec.servers = [{ url: baseUrl }];
  }

  // Track security schemes we need to add
  let hasBearerAuth = false;
  let hasBasicAuth = false;
  let hasApiKey = false;
  let apiKeyName = '';
  let apiKeyIn: 'header' | 'query' = 'header';

  for (const curl of parsed) {
    const { path, queryParams } = extractPath(curl.url, baseUrl);
    if (!path) continue;

    const method = curl.method.toLowerCase();

    const paths = spec.paths as Record<string, Record<string, unknown>>;
    if (!paths[path]) paths[path] = {};
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- paths[path] is set above but TS can't narrow indexed access
    const pathItem = paths[path] as Record<string, unknown>;

    // Don't overwrite if same method already exists on this path
    if (pathItem[method]) continue;

    const operation: OpenAPIV3.OperationObject = {
      summary: `${curl.method} ${path}`,
      operationId: generateOperationId(method, path),
      responses: {
        '200': { description: 'Successful response' },
      },
    };

    // Parameters: path variables
    const parameters: OpenAPIV3.ParameterObject[] = [];
    const pathVarMatches = path.matchAll(/\{(\w+)\}/g);
    for (const m of pathVarMatches) {
      parameters.push({
        name: m[1]!,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
    }

    // Parameters: query params
    for (const [name] of queryParams) {
      parameters.push({
        name,
        in: 'query',
        schema: { type: 'string' },
      });
    }

    // Parameters: custom headers (skip common ones)
    const skipHeaders = new Set([
      'content-type',
      'accept',
      'authorization',
      'user-agent',
      'host',
      'connection',
      'cache-control',
      'cookie',
    ]);
    for (const [name] of Object.entries(curl.headers)) {
      if (skipHeaders.has(name.toLowerCase())) continue;
      parameters.push({
        name,
        in: 'header',
        schema: { type: 'string' },
      });
    }

    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    // Request body
    if (curl.body && ['post', 'put', 'patch'].includes(method)) {
      const contentType = findHeaderValue(curl.headers, 'content-type');
      operation.requestBody = buildRequestBody(curl.body, contentType);
    }

    // Security detection
    const security: Record<string, string[]>[] = [];
    const authHeader = findHeaderValue(curl.headers, 'authorization');
    if (authHeader) {
      if (authHeader.toLowerCase().startsWith('bearer ')) {
        hasBearerAuth = true;
        security.push({ bearerAuth: [] });
      } else if (authHeader.toLowerCase().startsWith('basic ')) {
        hasBasicAuth = true;
        security.push({ basicAuth: [] });
      }
    }

    // API key header detection (common patterns)
    for (const [name, value] of Object.entries(curl.headers)) {
      const lower = name.toLowerCase();
      if (lower.includes('api-key') || lower.includes('apikey') || lower.includes('x-api-key')) {
        if (value) {
          hasApiKey = true;
          apiKeyName = name;
          apiKeyIn = 'header';
          security.push({ apiKeyAuth: [] });
          break;
        }
      }
    }

    // Basic auth from -u flag
    if (curl.basicAuth) {
      hasBasicAuth = true;
      security.push({ basicAuth: [] });
    }

    if (security.length > 0) {
      operation.security = security;
    }

    pathItem[method] = operation;
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
    securitySchemes['apiKeyAuth'] = {
      type: 'apiKey',
      name: apiKeyName,
      in: apiKeyIn,
    };
  }
  if (Object.keys(securitySchemes).length > 0) {
    spec.components = { securitySchemes };
  }

  logger.info(
    { curlCount: curls.length, pathCount: Object.keys(spec.paths ?? {}).length },
    'cURL commands converted to OpenAPI',
  );

  return spec;
}

/**
 * Split a raw input string containing one or more cURL commands into individual commands.
 * Handles backslash line continuation and separates commands by lines starting with `curl `.
 */
export function splitCurlCommands(input: string): string[] {
  // Join backslash-continued lines first
  const joined = input.replace(/\\\s*\n\s*/g, ' ');

  // Split by lines that start with `curl ` (case-insensitive)
  const commands: string[] = [];
  const lines = joined.split('\n');
  let current = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^curl\s+/i.test(trimmed)) {
      if (current) {
        commands.push(current.trim());
      }
      current = trimmed;
    } else if (current) {
      // Continuation of previous command (shouldn't happen after join, but safety)
      current += ' ' + trimmed;
    }
  }

  if (current) {
    commands.push(current.trim());
  }

  return commands;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse a single cURL command string into a structured representation.
 * Handles common cURL flags: -X, -H, -d, --data-raw, -u, -b.
 */
function parseSingleCurl(raw: string): ParsedCurl {
  // Join backslash-continued lines
  const input = raw.replace(/\\\s*\n\s*/g, ' ').trim();

  // Tokenize respecting quoted strings
  const tokens = tokenize(input);

  let method = '';
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let basicAuth: { user: string; password: string } | undefined;
  let cookies: string | undefined;
  let url = '';

  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i]!;

    if (token === 'curl') {
      i++;
      continue;
    }

    // Method: -X or --request
    if (token === '-X' || token === '--request') {
      method = (tokens[++i] ?? 'GET').toUpperCase();
      i++;
      continue;
    }

    // Header: -H or --header
    if (token === '-H' || token === '--header') {
      const headerStr = tokens[++i] ?? '';
      const colonIdx = headerStr.indexOf(':');
      if (colonIdx > 0) {
        const name = headerStr.slice(0, colonIdx).trim();
        const value = headerStr.slice(colonIdx + 1).trim();
        headers[name] = value;
      }
      i++;
      continue;
    }

    // Body: -d, --data, --data-raw, --data-binary
    if (
      token === '-d' ||
      token === '--data' ||
      token === '--data-raw' ||
      token === '--data-binary'
    ) {
      body = tokens[++i] ?? '';
      i++;
      continue;
    }

    // Basic auth: -u or --user
    if (token === '-u' || token === '--user') {
      const authStr = tokens[++i] ?? '';
      const colonIdx = authStr.indexOf(':');
      if (colonIdx > 0) {
        basicAuth = {
          user: authStr.slice(0, colonIdx),
          password: authStr.slice(colonIdx + 1),
        };
      }
      i++;
      continue;
    }

    // Cookies: -b or --cookie
    if (token === '-b' || token === '--cookie') {
      cookies = tokens[++i] ?? '';
      i++;
      continue;
    }

    // Skip flags we don't care about that take a value
    if (
      token === '-o' ||
      token === '--output' ||
      token === '-A' ||
      token === '--user-agent' ||
      token === '--connect-timeout' ||
      token === '--max-time' ||
      token === '-e' ||
      token === '--referer'
    ) {
      i += 2; // skip flag + value
      continue;
    }

    // Skip boolean flags
    if (
      token === '-s' ||
      token === '--silent' ||
      token === '-S' ||
      token === '--show-error' ||
      token === '-v' ||
      token === '--verbose' ||
      token === '-k' ||
      token === '--insecure' ||
      token === '-L' ||
      token === '--location' ||
      token === '-i' ||
      token === '--include' ||
      token === '--compressed'
    ) {
      i++;
      continue;
    }

    // Skip unknown flags (single dash + letter combos like -sS)
    if (token.startsWith('-') && !token.startsWith('http')) {
      // If it looks like a combined short flag (e.g. -sS), skip it
      if (/^-[a-zA-Z]+$/.test(token)) {
        i++;
        continue;
      }
      // Unknown long flag — might take a value, skip conservatively
      i++;
      continue;
    }

    // Anything else that looks like a URL
    if (token.startsWith('http://') || token.startsWith('https://') || token.includes('://')) {
      url = token;
    } else if (!url && token.includes('/') && !token.startsWith('-')) {
      // Relative URL or domain/path
      url = token;
    }

    i++;
  }

  // Infer method from body presence
  if (!method) {
    method = body ? 'POST' : 'GET';
  }

  return { method, url, headers, body, basicAuth, cookies };
}

/**
 * Tokenize a shell-like string, respecting single and double quotes.
 * Strips surrounding quotes from tokens.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    // Skip whitespace
    while (i < len && /\s/.test(input[i]!)) i++;
    if (i >= len) break;

    const ch = input[i]!;

    if (ch === '"' || ch === "'") {
      // Quoted string
      const quote = ch;
      i++; // skip opening quote
      let token = '';
      while (i < len && input[i] !== quote) {
        if (input[i] === '\\' && quote === '"' && i + 1 < len) {
          // Escape handling for double quotes
          i++;
          token += input[i];
        } else {
          token += input[i];
        }
        i++;
      }
      if (i < len) i++; // skip closing quote
      tokens.push(token);
    } else {
      // Unquoted token
      let token = '';
      while (i < len && !/\s/.test(input[i]!)) {
        token += input[i];
        i++;
      }
      tokens.push(token);
    }
  }

  return tokens;
}

/** Derive the common base URL from a set of parsed cURL commands. */
function deriveBaseUrl(curls: ParsedCurl[]): string {
  const urls = curls.map((c) => c.url).filter(Boolean);
  if (urls.length === 0) return '';

  try {
    const parsedUrls = urls.map((u) => new URL(u));
    // Use the origin of the first URL
    const origin = parsedUrls[0]!.origin;

    // Check if all share the same origin
    const allSameOrigin = parsedUrls.every((u) => u.origin === origin);
    if (allSameOrigin) return origin;

    // Fall back to first URL's origin
    return origin;
  } catch {
    // If URLs can't be parsed (relative, etc.), try to extract protocol+host manually
    const match = urls[0]!.match(/^(https?:\/\/[^/]+)/);
    return match?.[1] ?? '';
  }
}

/** Extract path and query parameters from a URL, relative to a base URL. */
function extractPath(
  rawUrl: string,
  baseUrl: string,
): { path: string; queryParams: URLSearchParams } {
  if (!rawUrl) return { path: '/', queryParams: new URLSearchParams() };

  try {
    const parsed = new URL(rawUrl);
    let path = parsed.pathname || '/';

    // Normalize path: remove trailing slash except for root
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }

    return { path, queryParams: parsed.searchParams };
  } catch {
    // Relative URL — strip base if present
    let path = rawUrl;
    if (baseUrl && path.startsWith(baseUrl)) {
      path = path.slice(baseUrl.length);
    }
    if (!path.startsWith('/')) path = '/' + path;

    // Split query string
    const qIdx = path.indexOf('?');
    if (qIdx >= 0) {
      const query = new URLSearchParams(path.slice(qIdx + 1));
      return { path: path.slice(0, qIdx), queryParams: query };
    }

    return { path, queryParams: new URLSearchParams() };
  }
}

/** Build an OpenAPI request body from raw body text and content type. */
function buildRequestBody(body: string, contentType?: string): OpenAPIV3.RequestBodyObject {
  const isJson = contentType?.includes('application/json') || looksLikeJson(body);

  if (isJson) {
    return {
      content: {
        'application/json': {
          schema: inferJsonSchema(body),
        },
      },
    };
  }

  if (contentType?.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(body);
    const properties: Record<string, OpenAPIV3.SchemaObject> = {};
    for (const [key] of params) {
      properties[key] = { type: 'string' };
    }
    return {
      content: {
        'application/x-www-form-urlencoded': {
          schema: { type: 'object', properties },
        },
      },
    };
  }

  // Default: text body
  return {
    content: {
      [contentType ?? 'text/plain']: {
        schema: { type: 'string' },
      },
    },
  };
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

/** Find a header value by name (case-insensitive). */
function findHeaderValue(headers: Record<string, string>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

/** Check if a string looks like JSON. */
function looksLikeJson(str: string | undefined): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  return (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  );
}

/** Infer an OpenAPI schema from a JSON example string. */
function inferJsonSchema(raw: string | undefined): OpenAPIV3.SchemaObject {
  if (!raw) return { type: 'object' };

  try {
    const parsed: unknown = JSON.parse(raw.trim());
    return inferSchemaFromValue(parsed);
  } catch {
    return { type: 'object' };
  }
}

/** Recursively infer an OpenAPI schema from a JavaScript value. */
function inferSchemaFromValue(value: unknown): OpenAPIV3.SchemaObject {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
  }
  if (typeof value === 'boolean') return { type: 'boolean' };

  if (Array.isArray(value)) {
    const items = value.length > 0 ? inferSchemaFromValue(value[0]) : {};
    return { type: 'array', items };
  }

  if (typeof value === 'object') {
    const properties: Record<string, OpenAPIV3.SchemaObject> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      properties[k] = inferSchemaFromValue(v);
    }
    return { type: 'object', properties };
  }

  return {};
}
