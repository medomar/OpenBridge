import type { OpenAPIV3 } from 'openapi-types';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('postman-parser');

// ── Postman Collection v2.1 types ────────────────────────────────────────────

/** Postman key-value pair (used for headers, query params, form data). */
interface PostmanKeyValue {
  key: string;
  value?: string;
  description?: string;
  disabled?: boolean;
  type?: string;
}

/** Postman URL object. */
interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  path?: string[];
  query?: PostmanKeyValue[];
  variable?: PostmanKeyValue[];
}

/** Postman request body. */
interface PostmanBody {
  mode?: 'raw' | 'urlencoded' | 'formdata' | 'file' | 'graphql';
  raw?: string;
  urlencoded?: PostmanKeyValue[];
  formdata?: PostmanKeyValue[];
  options?: { raw?: { language?: string } };
}

/** Postman request object. */
interface PostmanRequest {
  method?: string;
  header?: PostmanKeyValue[];
  body?: PostmanBody;
  url?: PostmanUrl | string;
  description?: string;
  auth?: PostmanAuth;
}

/** Postman response example. */
interface PostmanResponse {
  name?: string;
  status?: string;
  code?: number;
  header?: PostmanKeyValue[];
  body?: string;
  _postman_previewlanguage?: string;
}

/** Postman auth definition. */
interface PostmanAuth {
  type?: string;
  bearer?: PostmanKeyValue[];
  apikey?: PostmanKeyValue[];
  basic?: PostmanKeyValue[];
}

/** Postman collection item (request or folder). */
interface PostmanItem {
  name?: string;
  description?: string;
  request?: PostmanRequest;
  response?: PostmanResponse[];
  item?: PostmanItem[];
  auth?: PostmanAuth;
}

/** Postman variable definition. */
interface PostmanVariable {
  key?: string;
  value?: string;
  description?: string;
  type?: string;
}

/** Postman Collection v2.1 top-level structure. */
export interface PostmanCollection {
  info?: {
    name?: string;
    description?: string;
    schema?: string;
    version?: string;
  };
  item?: PostmanItem[];
  variable?: PostmanVariable[];
  auth?: PostmanAuth;
}

/** Variable values provided by the user for {{placeholder}} substitution. */
export type VariableMap = Record<string, string>;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a Postman Collection v2.1 JSON object to an OpenAPI 3.0 specification.
 *
 * - Extracts requests (method, URL, headers, body) from items and nested folders.
 * - Maps folder structure to OpenAPI tags.
 * - Converts auth settings to OpenAPI security schemes.
 * - Converts example responses to OpenAPI response definitions.
 * - Replaces `{{variable}}` placeholders with values from `variables` map;
 *   unresolved variables are left as-is in the path (e.g. `{baseUrl}`).
 *
 * @param collection  Parsed Postman Collection v2.1 JSON
 * @param variables   Optional map of variable values for `{{placeholder}}` substitution
 * @returns OpenAPI 3.0 document ready for swagger-parser validation
 */
export function postmanToOpenAPI(
  collection: PostmanCollection,
  variables?: VariableMap,
): OpenAPIV3.Document {
  // Build variable map from collection-level variables + user overrides
  const vars: VariableMap = {};
  if (collection.variable) {
    for (const v of collection.variable) {
      if (v.key) {
        vars[v.key] = v.value ?? '';
      }
    }
  }
  if (variables) {
    Object.assign(vars, variables);
  }

  const title = collection.info?.name ?? 'Converted from Postman';
  const description = collection.info?.description ?? '';

  const spec: OpenAPIV3.Document = {
    openapi: '3.0.3',
    info: {
      title,
      description,
      version: collection.info?.version ?? '1.0.0',
    },
    paths: {},
  };

  // Collect tags from folder structure
  const tags = new Set<string>();

  // Process items recursively
  const items = collection.item ?? [];
  for (const item of items) {
    processItem(item, [], spec, vars, tags, collection.auth);
  }

  // Add tags to spec
  if (tags.size > 0) {
    spec.tags = [...tags].map((name) => ({ name }));
  }

  // Add security schemes from collection-level auth
  if (collection.auth) {
    const scheme = convertAuth(collection.auth);
    if (scheme) {
      spec.components = {
        securitySchemes: { [scheme.name]: scheme.scheme },
      };
      spec.security = [{ [scheme.name]: [] }];
    }
  }

  // Derive server URL from variables (e.g. {{baseUrl}})
  if (vars['baseUrl']) {
    spec.servers = [{ url: vars['baseUrl'] }];
  }

  logger.info(
    { title, pathCount: Object.keys(spec.paths ?? {}).length, tagCount: tags.size },
    'Postman collection converted to OpenAPI',
  );

  return spec;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Recursively process a Postman item (folder or request).
 * Folders become tags; requests become path operations.
 */
function processItem(
  item: PostmanItem,
  folderPath: string[],
  spec: OpenAPIV3.Document,
  vars: VariableMap,
  tags: Set<string>,
  collectionAuth?: PostmanAuth,
): void {
  // Folder: has nested items
  if (item.item && item.item.length > 0) {
    const folderName = item.name ?? 'default';
    tags.add(folderName);
    for (const child of item.item) {
      processItem(child, [...folderPath, folderName], spec, vars, tags, collectionAuth);
    }
    return;
  }

  // Request item
  if (!item.request) return;

  const request = item.request;
  const method = (request.method ?? 'GET').toLowerCase();
  const url = resolveUrl(request.url, vars);
  const path = url.path;

  if (!path) return;

  // Initialize path item if needed
  if (!spec.paths) spec.paths = {};
  if (!spec.paths[path]) spec.paths[path] = {};

  const pathItem = spec.paths[path] as OpenAPIV3.PathItemObject;

  // Build the operation
  const operation: OpenAPIV3.OperationObject = {
    summary: item.name ?? `${method.toUpperCase()} ${path}`,
    responses: {},
  };

  // Description
  const desc = item.description ?? request.description;
  if (desc) {
    operation.description = typeof desc === 'string' ? desc : '';
  }

  // Tags from folder hierarchy
  if (folderPath.length > 0) {
    operation.tags = [folderPath[folderPath.length - 1]!];
  }

  // Generate operationId
  operation.operationId = generateOperationId(method, path);

  // Parameters: path variables
  const parameters: OpenAPIV3.ParameterObject[] = [];
  for (const v of url.pathVariables) {
    parameters.push({
      name: v.key,
      in: 'path',
      required: true,
      schema: { type: 'string' },
      ...(v.description ? { description: v.description } : {}),
    });
  }

  // Parameters: query params
  for (const q of url.queryParams) {
    if (q.disabled) continue;
    parameters.push({
      name: q.key,
      in: 'query',
      schema: { type: 'string' },
      ...(q.description ? { description: q.description } : {}),
    });
  }

  // Parameters: headers (skip common ones)
  const skipHeaders = new Set([
    'content-type',
    'accept',
    'authorization',
    'user-agent',
    'host',
    'connection',
    'cache-control',
  ]);
  if (request.header) {
    for (const h of request.header) {
      if (h.disabled) continue;
      if (skipHeaders.has(h.key.toLowerCase())) continue;
      parameters.push({
        name: h.key,
        in: 'header',
        schema: { type: 'string' },
        ...(h.description ? { description: h.description } : {}),
      });
    }
  }

  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  // Request body
  if (request.body && ['post', 'put', 'patch'].includes(method)) {
    operation.requestBody = convertRequestBody(request.body);
  }

  // Responses from examples
  if (item.response && item.response.length > 0) {
    operation.responses = convertResponses(item.response);
  } else {
    operation.responses = {
      '200': { description: 'Successful response' },
    };
  }

  // Auth at item level
  const auth = request.auth ?? item.auth;
  if (auth && auth !== collectionAuth) {
    const scheme = convertAuth(auth);
    if (scheme) {
      if (!spec.components) spec.components = {};
      if (!spec.components.securitySchemes) spec.components.securitySchemes = {};
      spec.components.securitySchemes[scheme.name] = scheme.scheme;
      operation.security = [{ [scheme.name]: [] }];
    }
  }

  // Set the operation on the path item
  (pathItem as Record<string, unknown>)[method] = operation;
}

/** Resolved URL with path template, path variables, and query params. */
interface ResolvedUrl {
  path: string;
  pathVariables: PostmanKeyValue[];
  queryParams: PostmanKeyValue[];
}

/**
 * Resolve a Postman URL (string or object) into an OpenAPI path template.
 * Replaces `{{var}}` with variable values or converts to `{var}` path params.
 * Strips protocol and host to produce a path-only template.
 */
function resolveUrl(url: PostmanUrl | string | undefined, vars: VariableMap): ResolvedUrl {
  if (!url) return { path: '/', pathVariables: [], queryParams: [] };

  if (typeof url === 'string') {
    const resolved = substituteVariables(url, vars);
    const pathOnly = extractPathFromUrl(resolved);
    return { path: pathOnly || '/', pathVariables: [], queryParams: [] };
  }

  // Object URL — build path from parts
  const pathSegments = url.path ?? [];
  const resolvedSegments = pathSegments.map((seg) => {
    // Path variable like :id → {id}
    if (seg.startsWith(':')) {
      return `{${seg.slice(1)}}`;
    }
    return substituteVariables(seg, vars);
  });

  let path = '/' + resolvedSegments.join('/');
  // Clean up double slashes
  path = path.replace(/\/+/g, '/');
  // Remove trailing slash (except root)
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }

  const pathVariables: PostmanKeyValue[] = url.variable ?? [];
  const queryParams: PostmanKeyValue[] = url.query ?? [];

  return { path, pathVariables, queryParams };
}

/** Replace `{{variable}}` placeholders with values from the variable map. */
function substituteVariables(input: string, vars: VariableMap): string {
  return input.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (vars[name] !== undefined) {
      return vars[name];
    }
    // Leave as OpenAPI path parameter syntax
    return `{${name}}`;
  });
}

/** Extract the path portion from a full URL string. */
function extractPathFromUrl(url: string): string {
  // Handle {{baseUrl}}/path → already substituted or left as {baseUrl}/path
  // Remove protocol + host
  const withoutProtocol = url.replace(/^https?:\/\/[^/]*/, '');
  if (withoutProtocol.startsWith('/') || withoutProtocol === '') {
    return withoutProtocol || '/';
  }
  // Might be a relative path starting with {baseUrl}
  // Strip the first segment if it looks like a variable
  if (withoutProtocol.startsWith('{')) {
    const slashIdx = withoutProtocol.indexOf('/');
    if (slashIdx >= 0) {
      return withoutProtocol.slice(slashIdx);
    }
    return '/';
  }
  return '/' + withoutProtocol;
}

/** Convert a Postman request body to an OpenAPI RequestBody object. */
function convertRequestBody(body: PostmanBody): OpenAPIV3.RequestBodyObject {
  switch (body.mode) {
    case 'raw': {
      const isJson = body.options?.raw?.language === 'json' || looksLikeJson(body.raw);
      const mediaType = isJson ? 'application/json' : 'text/plain';

      const schema = isJson ? inferJsonSchema(body.raw) : { type: 'string' as const };

      return {
        content: {
          [mediaType]: { schema },
        },
      };
    }

    case 'urlencoded': {
      const properties: Record<string, OpenAPIV3.SchemaObject> = {};
      for (const kv of body.urlencoded ?? []) {
        if (kv.disabled) continue;
        properties[kv.key] = {
          type: 'string',
          ...(kv.description ? { description: kv.description } : {}),
        };
      }
      return {
        content: {
          'application/x-www-form-urlencoded': {
            schema: { type: 'object', properties },
          },
        },
      };
    }

    case 'formdata': {
      const properties: Record<string, OpenAPIV3.SchemaObject> = {};
      for (const kv of body.formdata ?? []) {
        if (kv.disabled) continue;
        if (kv.type === 'file') {
          properties[kv.key] = { type: 'string', format: 'binary' };
        } else {
          properties[kv.key] = {
            type: 'string',
            ...(kv.description ? { description: kv.description } : {}),
          };
        }
      }
      return {
        content: {
          'multipart/form-data': {
            schema: { type: 'object', properties },
          },
        },
      };
    }

    default:
      return {
        content: {
          'application/octet-stream': {
            schema: { type: 'string', format: 'binary' },
          },
        },
      };
  }
}

/** Convert Postman example responses to OpenAPI responses. */
function convertResponses(responses: PostmanResponse[]): Record<string, OpenAPIV3.ResponseObject> {
  const result: Record<string, OpenAPIV3.ResponseObject> = {};

  for (const resp of responses) {
    const code = String(resp.code ?? 200);
    const description = resp.name ?? resp.status ?? 'Response';

    const responseObj: OpenAPIV3.ResponseObject = { description };

    if (resp.body) {
      const isJson = resp._postman_previewlanguage === 'json' || looksLikeJson(resp.body);
      const mediaType = isJson ? 'application/json' : 'text/plain';
      const schema = isJson ? inferJsonSchema(resp.body) : { type: 'string' as const };

      responseObj.content = { [mediaType]: { schema } };
    }

    // Don't overwrite if we already have a response for this code
    // (first example wins)
    if (!result[code]) {
      result[code] = responseObj;
    }
  }

  return result;
}

/** Convert Postman auth to an OpenAPI security scheme. */
function convertAuth(
  auth: PostmanAuth,
): { name: string; scheme: OpenAPIV3.SecuritySchemeObject } | null {
  switch (auth.type) {
    case 'bearer':
      return {
        name: 'bearerAuth',
        scheme: {
          type: 'http',
          scheme: 'bearer',
        },
      };

    case 'basic':
      return {
        name: 'basicAuth',
        scheme: {
          type: 'http',
          scheme: 'basic',
        },
      };

    case 'apikey': {
      const keyEntry = auth.apikey?.find((k) => k.key === 'key');
      const inEntry = auth.apikey?.find((k) => k.key === 'in');
      return {
        name: 'apiKeyAuth',
        scheme: {
          type: 'apiKey',
          name: keyEntry?.value ?? 'api_key',
          in: (inEntry?.value as 'header' | 'query') ?? 'header',
        },
      };
    }

    default:
      return null;
  }
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
  if (value === null || value === undefined) {
    return {};
  }

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
