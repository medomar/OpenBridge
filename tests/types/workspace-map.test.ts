import { describe, it, expect } from 'vitest';
import {
  WorkspaceMapSchema,
  APIEndpointSchema,
  EndpointAuthSchema,
  HttpMethodSchema,
  ParameterSchema,
  MapSourceSchema,
} from '../../src/types/workspace-map.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeMinimalEndpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ep-1',
    name: 'Test endpoint',
    method: 'GET',
    path: '/test',
    ...overrides,
  };
}

function makeMinimalMap(overrides: Record<string, unknown> = {}) {
  return {
    version: '1.0',
    name: 'test-api',
    baseUrl: 'https://api.example.com',
    endpoints: [makeMinimalEndpoint()],
    ...overrides,
  };
}

// ── HttpMethodSchema ────────────────────────────────────────────

describe('HttpMethodSchema', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])(
    'accepts valid HTTP method: %s',
    (method) => {
      expect(HttpMethodSchema.parse(method)).toBe(method);
    },
  );

  it('rejects invalid HTTP methods', () => {
    expect(() => HttpMethodSchema.parse('INVALID')).toThrow();
    expect(() => HttpMethodSchema.parse('get')).toThrow();
    expect(() => HttpMethodSchema.parse('')).toThrow();
  });
});

// ── MapSourceSchema ─────────────────────────────────────────────

describe('MapSourceSchema', () => {
  it.each(['manual', 'openapi', 'postman', 'swagger', 'har'])(
    'accepts valid source: %s',
    (source) => {
      expect(MapSourceSchema.parse(source)).toBe(source);
    },
  );

  it('rejects invalid sources', () => {
    expect(() => MapSourceSchema.parse('graphql')).toThrow();
    expect(() => MapSourceSchema.parse('')).toThrow();
  });
});

// ── EndpointAuthSchema ──────────────────────────────────────────

describe('EndpointAuthSchema', () => {
  it('parses none auth', () => {
    expect(EndpointAuthSchema.parse({ type: 'none' })).toEqual({ type: 'none' });
  });

  it('parses bearer auth', () => {
    const result = EndpointAuthSchema.parse({ type: 'bearer', envVar: 'TOKEN' });
    expect(result.type).toBe('bearer');
  });

  it('parses api-key auth with default header', () => {
    const result = EndpointAuthSchema.parse({ type: 'api-key', envVar: 'KEY' });
    expect(result.type).toBe('api-key');
    if (result.type === 'api-key') {
      expect(result.header).toBe('Authorization');
    }
  });

  it('parses api-key auth with custom header and prefix', () => {
    const result = EndpointAuthSchema.parse({
      type: 'api-key',
      header: 'X-Custom',
      prefix: 'Token',
      envVar: 'KEY',
    });
    if (result.type === 'api-key') {
      expect(result.header).toBe('X-Custom');
      expect(result.prefix).toBe('Token');
    }
  });

  it('parses basic auth', () => {
    const result = EndpointAuthSchema.parse({
      type: 'basic',
      usernameEnvVar: 'USER',
      passwordEnvVar: 'PASS',
    });
    expect(result.type).toBe('basic');
  });

  it('parses custom auth with headers', () => {
    const result = EndpointAuthSchema.parse({
      type: 'custom',
      headers: { 'X-Token': 'abc', 'X-Tenant': 'org-1' },
    });
    if (result.type === 'custom') {
      expect(result.headers).toEqual({ 'X-Token': 'abc', 'X-Tenant': 'org-1' });
    }
  });

  it('rejects unknown auth type', () => {
    expect(() => EndpointAuthSchema.parse({ type: 'oauth2' })).toThrow();
  });

  it('rejects bearer auth without envVar', () => {
    expect(() => EndpointAuthSchema.parse({ type: 'bearer' })).toThrow();
  });

  it('rejects basic auth without password', () => {
    expect(() => EndpointAuthSchema.parse({ type: 'basic', usernameEnvVar: 'USER' })).toThrow();
  });
});

// ── ParameterSchema ─────────────────────────────────────────────

describe('ParameterSchema', () => {
  it('parses minimal parameter with defaults', () => {
    const result = ParameterSchema.parse({ name: 'id', in: 'path' });
    expect(result.required).toBe(false);
    expect(result.type).toBe('string');
  });

  it('parses parameter with all fields', () => {
    const result = ParameterSchema.parse({
      name: 'limit',
      in: 'query',
      required: true,
      type: 'number',
      description: 'Page size',
      example: 20,
    });
    expect(result.name).toBe('limit');
    expect(result.required).toBe(true);
    expect(result.type).toBe('number');
  });

  it('accepts header parameters', () => {
    const result = ParameterSchema.parse({ name: 'X-Request-ID', in: 'header' });
    expect(result.in).toBe('header');
  });

  it('rejects invalid "in" value', () => {
    expect(() => ParameterSchema.parse({ name: 'x', in: 'cookie' })).toThrow();
  });

  it('rejects invalid type', () => {
    expect(() => ParameterSchema.parse({ name: 'x', in: 'query', type: 'integer' })).toThrow();
  });
});

// ── FieldSchema (via APIEndpointSchema to avoid z.lazy any return) ───

describe('FieldSchema (tested through APIEndpointSchema)', () => {
  it('accepts endpoint with simple field schema in requestBody', () => {
    const result = APIEndpointSchema.parse({
      ...makeMinimalEndpoint({ method: 'POST' }),
      requestBody: {
        contentType: 'application/json',
        schema: { name: { type: 'string', required: true } },
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(result.requestBody?.schema?.['name']?.type).toBe('string');
  });

  it('accepts endpoint with nested object field schema', () => {
    const result = APIEndpointSchema.parse({
      ...makeMinimalEndpoint({ method: 'POST' }),
      requestBody: {
        contentType: 'application/json',
        schema: {
          address: {
            type: 'object',
            properties: {
              street: { type: 'string' },
              zip: { type: 'number' },
            },
          },
        },
      },
    });
    expect(result.requestBody?.schema).toBeDefined();
  });

  it('accepts endpoint with array field schema with items', () => {
    const result = APIEndpointSchema.parse({
      ...makeMinimalEndpoint({ method: 'POST' }),
      requestBody: {
        contentType: 'application/json',
        schema: {
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    });
    expect(result.requestBody?.schema).toBeDefined();
  });

  it('accepts deeply nested recursive field schema', () => {
    expect(() =>
      APIEndpointSchema.parse({
        ...makeMinimalEndpoint({ method: 'POST' }),
        requestBody: {
          contentType: 'application/json',
          schema: {
            nested: {
              type: 'object',
              properties: {
                deep: {
                  type: 'object',
                  properties: {
                    items: { type: 'array', items: { type: 'number' } },
                  },
                },
              },
            },
          },
        },
      }),
    ).not.toThrow();
  });

  it('rejects invalid field type in schema', () => {
    expect(() =>
      APIEndpointSchema.parse({
        ...makeMinimalEndpoint({ method: 'POST' }),
        requestBody: {
          contentType: 'application/json',
          schema: { name: { type: 'integer' } },
        },
      }),
    ).toThrow();
  });
});

// ── APIEndpointSchema ───────────────────────────────────────────

describe('APIEndpointSchema', () => {
  it('parses minimal endpoint with defaults', () => {
    const result = APIEndpointSchema.parse(makeMinimalEndpoint());
    expect(result.parameters).toEqual([]);
    expect(result.headers).toEqual({});
    expect(result.tags).toEqual([]);
    expect(result.auth).toBeUndefined();
    expect(result.requestBody).toBeUndefined();
    expect(result.response).toBeUndefined();
  });

  it('parses endpoint with requestBody and response', () => {
    const result = APIEndpointSchema.parse({
      ...makeMinimalEndpoint({ method: 'POST' }),
      requestBody: {
        contentType: 'application/json',
        schema: { name: { type: 'string', required: true } },
        example: { name: 'Widget' },
      },
      response: {
        contentType: 'application/json',
        schema: { id: { type: 'string' } },
      },
    });
    expect(result.requestBody?.contentType).toBe('application/json');
    expect(result.response?.contentType).toBe('application/json');
  });

  it('parses endpoint with baseUrl override', () => {
    const result = APIEndpointSchema.parse(
      makeMinimalEndpoint({ baseUrl: 'https://other.example.com' }),
    );
    expect(result.baseUrl).toBe('https://other.example.com');
  });

  it('rejects endpoint with empty id', () => {
    expect(() => APIEndpointSchema.parse(makeMinimalEndpoint({ id: '' }))).toThrow();
  });

  it('rejects endpoint with empty name', () => {
    expect(() => APIEndpointSchema.parse(makeMinimalEndpoint({ name: '' }))).toThrow();
  });

  it('rejects endpoint with empty path', () => {
    expect(() => APIEndpointSchema.parse(makeMinimalEndpoint({ path: '' }))).toThrow();
  });

  it('rejects endpoint with invalid baseUrl', () => {
    expect(() => APIEndpointSchema.parse(makeMinimalEndpoint({ baseUrl: 'not-a-url' }))).toThrow();
  });
});

// ── WorkspaceMapSchema ──────────────────────────────────────────

describe('WorkspaceMapSchema', () => {
  it('parses minimal valid map with defaults', () => {
    const result = WorkspaceMapSchema.parse(makeMinimalMap());
    expect(result.auth).toEqual({ type: 'none' });
    expect(result.source).toBe('manual');
    expect(result.headers).toEqual({});
    expect(result.metadata).toEqual({});
  });

  it('rejects map with no endpoints', () => {
    expect(() => WorkspaceMapSchema.parse(makeMinimalMap({ endpoints: [] }))).toThrow();
  });

  it('rejects map with invalid version', () => {
    expect(() => WorkspaceMapSchema.parse(makeMinimalMap({ version: '2.0' }))).toThrow();
  });

  it('rejects map with invalid baseUrl', () => {
    expect(() => WorkspaceMapSchema.parse(makeMinimalMap({ baseUrl: 'not-a-url' }))).toThrow();
  });

  it('rejects map with empty name', () => {
    expect(() => WorkspaceMapSchema.parse(makeMinimalMap({ name: '' }))).toThrow();
  });

  it('parses map with all optional fields', () => {
    const result = WorkspaceMapSchema.parse(
      makeMinimalMap({
        description: 'A full map',
        auth: { type: 'bearer', envVar: 'TOKEN' },
        source: 'openapi',
        headers: { 'X-Version': '2' },
        metadata: {
          generatedAt: '2026-02-20',
          generatedBy: 'test',
          sourceFile: '/path/to/spec.json',
        },
      }),
    );
    expect(result.description).toBe('A full map');
    expect(result.auth.type).toBe('bearer');
    expect(result.source).toBe('openapi');
    expect(result.metadata.generatedBy).toBe('test');
  });

  it('parses map with multiple endpoints', () => {
    const result = WorkspaceMapSchema.parse(
      makeMinimalMap({
        endpoints: [
          makeMinimalEndpoint({ id: 'ep-1' }),
          makeMinimalEndpoint({ id: 'ep-2', method: 'POST', path: '/test2' }),
          makeMinimalEndpoint({ id: 'ep-3', method: 'DELETE', path: '/test/:id' }),
        ],
      }),
    );
    expect(result.endpoints).toHaveLength(3);
  });
});
