import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  scanWorkspace,
  parseWorkspaceMap,
  parseOpenAPISpec,
  parsePostmanCollection,
  detectSource,
} from '../../src/knowledge/workspace-scanner.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Test Fixtures ────────────────────────────────────────────────

const validMapJson = {
  version: '1.0',
  name: 'test-api',
  description: 'A test API',
  baseUrl: 'https://api.example.com',
  auth: { type: 'bearer', envVar: 'API_TOKEN' },
  source: 'manual',
  headers: { 'Content-Type': 'application/json' },
  endpoints: [
    {
      id: 'list-products',
      name: 'List Products',
      description: 'Get all products',
      method: 'GET',
      path: '/products',
      parameters: [{ name: 'page', in: 'query', required: false, type: 'number' }],
      headers: {},
      tags: ['products'],
    },
    {
      id: 'create-product',
      name: 'Create Product',
      method: 'POST',
      path: '/products',
      parameters: [],
      headers: {},
      tags: ['products'],
      requestBody: {
        contentType: 'application/json',
        example: { name: 'Widget', price: 9.99 },
      },
    },
  ],
  metadata: {},
};

const openapi3Spec = {
  openapi: '3.0.3',
  info: { title: 'Pet Store', description: 'A sample pet store', version: '1.0.0' },
  servers: [{ url: 'https://petstore.example.com/v1' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        tags: ['pets'],
        parameters: [{ name: 'limit', in: 'query', required: false, schema: { type: 'integer' } }],
        responses: {
          '200': {
            description: 'A list of pets',
            content: { 'application/json': { schema: { type: 'array' } } },
          },
        },
      },
      post: {
        operationId: 'createPet',
        summary: 'Create a pet',
        tags: ['pets'],
        requestBody: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' } } },
            },
          },
        },
        responses: {
          '201': { description: 'Created' },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        operationId: 'getPet',
        summary: 'Get a pet by ID',
        tags: ['pets'],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'A pet',
            content: { 'application/json': { schema: { type: 'object' } } },
          },
        },
      },
    },
  },
};

const swagger2Spec = {
  swagger: '2.0',
  info: { title: 'Legacy API', version: '1.0.0' },
  host: 'api.legacy.com',
  basePath: '/v2',
  schemes: ['https'],
  securityDefinitions: {
    apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' },
  },
  security: [{ apiKey: [] }],
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        summary: 'List items',
        parameters: [{ name: 'q', in: 'query', type: 'string', description: 'Search query' }],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
};

const postmanCollection = {
  info: {
    name: 'My API Collection',
    description: 'Test collection',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{apiToken}}' }],
  },
  variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
  item: [
    {
      name: 'Users',
      item: [
        {
          name: 'Get Users',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.example.com/users?page=1',
              protocol: 'https',
              host: ['api', 'example', 'com'],
              path: ['users'],
              query: [{ key: 'page', value: '1' }],
            },
            header: [{ key: 'Accept', value: 'application/json' }],
          },
        },
        {
          name: 'Create User',
          request: {
            method: 'POST',
            url: {
              raw: 'https://api.example.com/users',
              protocol: 'https',
              host: ['api', 'example', 'com'],
              path: ['users'],
            },
            header: [],
            body: {
              mode: 'raw',
              raw: '{"name": "John", "email": "john@example.com"}',
            },
          },
        },
      ],
    },
    {
      name: 'Get Health',
      request: {
        method: 'GET',
        url: 'https://api.example.com/health',
      },
    },
  ],
};

// ── detectSource ─────────────────────────────────────────────────

describe('detectSource', () => {
  it('should detect OpenAPI 3.x spec', () => {
    expect(detectSource(openapi3Spec, 'openapi.json')).toBe('openapi');
  });

  it('should detect Swagger 2.x spec', () => {
    expect(detectSource(swagger2Spec, 'swagger.json')).toBe('swagger');
  });

  it('should detect Postman collection by schema URL', () => {
    expect(detectSource(postmanCollection, 'collection.json')).toBe('postman');
  });

  it('should detect Postman collection by structure', () => {
    const minimal = { info: { name: 'Test' }, item: [] };
    expect(detectSource(minimal, 'api.json')).toBe('postman');
  });

  it('should default to manual for workspace map JSON', () => {
    expect(detectSource(validMapJson, 'openbridge.map.json')).toBe('manual');
  });

  it('should default to manual for non-object inputs', () => {
    expect(detectSource(null, 'file.json')).toBe('manual');
    expect(detectSource('string', 'file.json')).toBe('manual');
  });
});

// ── parseWorkspaceMap ────────────────────────────────────────────

describe('parseWorkspaceMap', () => {
  it('should parse a valid openbridge.map.json', () => {
    const map = parseWorkspaceMap(validMapJson);
    expect(map.name).toBe('test-api');
    expect(map.baseUrl).toBe('https://api.example.com');
    expect(map.endpoints).toHaveLength(2);
    expect(map.source).toBe('manual');
    expect(map.auth.type).toBe('bearer');
  });

  it('should set sourceFile in metadata', () => {
    const map = parseWorkspaceMap(validMapJson, '/path/to/map.json');
    expect(map.metadata.sourceFile).toBe('/path/to/map.json');
  });

  it('should throw on invalid map (no endpoints)', () => {
    expect(() => parseWorkspaceMap({ ...validMapJson, endpoints: [] })).toThrow();
  });

  it('should throw on invalid map (missing baseUrl)', () => {
    const { baseUrl: _baseUrl, ...noBaseUrl } = validMapJson;
    expect(() => parseWorkspaceMap(noBaseUrl)).toThrow();
  });

  it('should throw on invalid map (bad version)', () => {
    expect(() => parseWorkspaceMap({ ...validMapJson, version: '2.0' })).toThrow();
  });
});

// ── parseOpenAPISpec ─────────────────────────────────────────────

describe('parseOpenAPISpec', () => {
  it('should parse OpenAPI 3.x spec into WorkspaceMap', () => {
    const map = parseOpenAPISpec(openapi3Spec, 'openapi');
    expect(map.name).toBe('Pet Store');
    expect(map.description).toBe('A sample pet store');
    expect(map.baseUrl).toBe('https://petstore.example.com/v1');
    expect(map.source).toBe('openapi');
    expect(map.auth.type).toBe('bearer');
    expect(map.endpoints).toHaveLength(3);
  });

  it('should convert OpenAPI path params {id} to :id format', () => {
    const map = parseOpenAPISpec(openapi3Spec, 'openapi');
    const getPet = map.endpoints.find((e) => e.id === 'getPet');
    expect(getPet?.path).toBe('/pets/:petId');
  });

  it('should extract query parameters with correct types', () => {
    const map = parseOpenAPISpec(openapi3Spec, 'openapi');
    const listPets = map.endpoints.find((e) => e.id === 'listPets');
    expect(listPets?.parameters).toHaveLength(1);
    expect(listPets?.parameters[0]?.name).toBe('limit');
    expect(listPets?.parameters[0]?.in).toBe('query');
    expect(listPets?.parameters[0]?.type).toBe('number');
  });

  it('should extract request body with raw schema as example', () => {
    const map = parseOpenAPISpec(openapi3Spec, 'openapi');
    const createPet = map.endpoints.find((e) => e.id === 'createPet');
    expect(createPet?.requestBody).toBeDefined();
    expect(createPet?.requestBody?.contentType).toBe('application/json');
    expect(createPet?.requestBody?.example).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
    });
  });

  it('should extract response with raw schema as example', () => {
    const map = parseOpenAPISpec(openapi3Spec, 'openapi');
    const listPets = map.endpoints.find((e) => e.id === 'listPets');
    expect(listPets?.response).toBeDefined();
    expect(listPets?.response?.contentType).toBe('application/json');
    expect(listPets?.response?.example).toEqual({ type: 'array' });
  });

  it('should parse Swagger 2.x spec', () => {
    const map = parseOpenAPISpec(swagger2Spec, 'swagger');
    expect(map.name).toBe('Legacy API');
    expect(map.baseUrl).toBe('https://api.legacy.com/v2');
    expect(map.source).toBe('swagger');
    expect(map.auth.type).toBe('api-key');
    expect(map.endpoints).toHaveLength(1);
  });

  it('should extract tags from operations', () => {
    const map = parseOpenAPISpec(openapi3Spec, 'openapi');
    const listPets = map.endpoints.find((e) => e.id === 'listPets');
    expect(listPets?.tags).toEqual(['pets']);
  });

  it('should set metadata with generatedBy', () => {
    const map = parseOpenAPISpec(openapi3Spec, 'openapi', '/path/to/spec.json');
    expect(map.metadata.generatedBy).toBe('openbridge-scanner');
    expect(map.metadata.sourceFile).toBe('/path/to/spec.json');
    expect(map.metadata.generatedAt).toBeDefined();
  });

  it('should throw when spec has no valid endpoints', () => {
    const emptySpec = { ...openapi3Spec, paths: {} };
    expect(() => parseOpenAPISpec(emptySpec, 'openapi')).toThrow('no valid endpoints');
  });

  it('should fallback to http://localhost when no server URL', () => {
    const noServer = { ...openapi3Spec, servers: undefined };
    const map = parseOpenAPISpec(noServer as typeof openapi3Spec, 'openapi');
    expect(map.baseUrl).toBe('http://localhost');
  });

  it('should handle relative server URLs', () => {
    const relativeServer = { ...openapi3Spec, servers: [{ url: '/api/v1' }] };
    const map = parseOpenAPISpec(relativeServer, 'openapi');
    expect(map.baseUrl).toBe('http://localhost/api/v1');
  });

  it('should handle basic auth security scheme', () => {
    const basicAuth = {
      ...openapi3Spec,
      components: {
        securitySchemes: {
          basic: { type: 'http', scheme: 'basic' },
        },
      },
      security: [{ basic: [] }],
    };
    const map = parseOpenAPISpec(basicAuth, 'openapi');
    expect(map.auth.type).toBe('basic');
  });

  it('should handle oauth2 security scheme', () => {
    const oauth = {
      ...openapi3Spec,
      components: {
        securitySchemes: {
          oauth: { type: 'oauth2' },
        },
      },
      security: [{ oauth: [] }],
    };
    const map = parseOpenAPISpec(oauth, 'openapi');
    expect(map.auth.type).toBe('bearer');
  });

  it('should handle no security schemes', () => {
    const noSecurity = {
      ...openapi3Spec,
      components: undefined,
      security: undefined,
    };
    const map = parseOpenAPISpec(noSecurity as typeof openapi3Spec, 'openapi');
    expect(map.auth.type).toBe('none');
  });

  it('should generate endpoint IDs when operationId is missing', () => {
    const noOpId = {
      ...openapi3Spec,
      paths: {
        '/items': {
          get: { summary: 'List items', responses: { '200': { description: 'OK' } } },
        },
      },
    };
    const map = parseOpenAPISpec(noOpId, 'openapi');
    expect(map.endpoints[0]?.id).toMatch(/^endpoint-/);
  });
});

// ── parsePostmanCollection ───────────────────────────────────────

describe('parsePostmanCollection', () => {
  it('should parse Postman collection into WorkspaceMap', () => {
    const map = parsePostmanCollection(postmanCollection);
    expect(map.name).toBe('My API Collection');
    expect(map.source).toBe('postman');
    expect(map.auth.type).toBe('bearer');
    expect(map.endpoints).toHaveLength(3);
  });

  it('should extract endpoints from nested folders', () => {
    const map = parsePostmanCollection(postmanCollection);
    const getUsers = map.endpoints.find((e) => e.name === 'Get Users');
    expect(getUsers).toBeDefined();
    expect(getUsers?.method).toBe('GET');
    expect(getUsers?.path).toBe('/users');
    expect(getUsers?.tags).toEqual(['Users']);
  });

  it('should extract query parameters from URL', () => {
    const map = parsePostmanCollection(postmanCollection);
    const getUsers = map.endpoints.find((e) => e.name === 'Get Users');
    expect(getUsers?.parameters).toHaveLength(1);
    expect(getUsers?.parameters[0]?.name).toBe('page');
  });

  it('should extract request headers', () => {
    const map = parsePostmanCollection(postmanCollection);
    const getUsers = map.endpoints.find((e) => e.name === 'Get Users');
    expect(getUsers?.headers).toEqual({ Accept: 'application/json' });
  });

  it('should parse JSON request body as example', () => {
    const map = parsePostmanCollection(postmanCollection);
    const createUser = map.endpoints.find((e) => e.name === 'Create User');
    expect(createUser?.requestBody).toBeDefined();
    expect(createUser?.requestBody?.contentType).toBe('application/json');
    expect(createUser?.requestBody?.example).toEqual({ name: 'John', email: 'john@example.com' });
  });

  it('should handle string URLs in requests', () => {
    const map = parsePostmanCollection(postmanCollection);
    const health = map.endpoints.find((e) => e.name === 'Get Health');
    expect(health).toBeDefined();
    expect(health?.path).toBe('/health');
  });

  it('should infer base URL from first request', () => {
    const map = parsePostmanCollection(postmanCollection);
    expect(map.baseUrl).toBe('https://api.example.com');
  });

  it('should handle API key auth', () => {
    const apiKeyCollection = {
      ...postmanCollection,
      auth: {
        type: 'apikey',
        apikey: [
          { key: 'key', value: 'X-Custom-Key' },
          { key: 'value', value: '{{apiKey}}' },
        ],
      },
    };
    const map = parsePostmanCollection(apiKeyCollection);
    expect(map.auth.type).toBe('api-key');
  });

  it('should handle basic auth', () => {
    const basicCollection = {
      ...postmanCollection,
      auth: { type: 'basic', basic: [{ key: 'username', value: 'user' }] },
    };
    const map = parsePostmanCollection(basicCollection);
    expect(map.auth.type).toBe('basic');
  });

  it('should handle no auth', () => {
    const noAuthCollection = { ...postmanCollection, auth: undefined };
    const map = parsePostmanCollection(noAuthCollection);
    expect(map.auth.type).toBe('none');
  });

  it('should set metadata', () => {
    const map = parsePostmanCollection(postmanCollection, '/path/to/collection.json');
    expect(map.metadata.generatedBy).toBe('openbridge-scanner');
    expect(map.metadata.sourceFile).toBe('/path/to/collection.json');
  });

  it('should throw when collection has no requests', () => {
    const empty = { ...postmanCollection, item: [] };
    expect(() => parsePostmanCollection(empty)).toThrow('no valid requests');
  });

  it('should fallback base URL to variable when no requests have URLs', () => {
    const varOnly = {
      ...postmanCollection,
      item: [
        {
          name: 'Test',
          request: {
            method: 'GET',
            url: { path: ['test'] },
          },
        },
      ],
    };
    const map = parsePostmanCollection(varOnly);
    expect(map.baseUrl).toBe('https://api.example.com');
  });
});

// ── scanWorkspace (integration) ──────────────────────────────────

describe('scanWorkspace', () => {
  it('should scan and load an openbridge.map.json file', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(validMapJson));

    const result = await scanWorkspace('/workspace');
    expect(result.success).toBe(true);
    expect(result.map).toBeDefined();
    expect(result.map?.name).toBe('test-api');
    expect(result.map?.endpoints).toHaveLength(2);
    expect(result.sourceFile).toBe('/workspace/openbridge.map.json');
  });

  it('should auto-detect and parse OpenAPI spec', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(openapi3Spec));

    const result = await scanWorkspace('/workspace', 'api-spec.json');
    expect(result.success).toBe(true);
    expect(result.map?.name).toBe('Pet Store');
    expect(result.map?.source).toBe('openapi');
  });

  it('should auto-detect and parse Postman collection', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(postmanCollection));

    const result = await scanWorkspace('/workspace', 'collection.json');
    expect(result.success).toBe(true);
    expect(result.map?.name).toBe('My API Collection');
    expect(result.map?.source).toBe('postman');
  });

  it('should return error when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

    const result = await scanWorkspace('/workspace');
    expect(result.success).toBe(false);
    expect(result.error).toContain('ENOENT');
  });

  it('should return error when JSON is invalid', async () => {
    mockReadFile.mockResolvedValue('{ invalid json');

    const result = await scanWorkspace('/workspace');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should return error when map validation fails', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '1.0', name: 'test' }));

    const result = await scanWorkspace('/workspace');
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should use custom map filename', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify(validMapJson));

    const result = await scanWorkspace('/workspace', 'custom-map.json');
    expect(result.success).toBe(true);
    expect(result.sourceFile).toBe('/workspace/custom-map.json');
    expect(mockReadFile).toHaveBeenCalledWith('/workspace/custom-map.json', 'utf-8');
  });
});
