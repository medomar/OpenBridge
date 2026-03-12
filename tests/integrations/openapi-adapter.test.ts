import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAPIV3 } from 'openapi-types';

// ── Hoisted mock stubs ──────────────────────────────────────────────────────

const { mockValidate } = vi.hoisted(() => ({
  mockValidate: vi.fn(),
}));

// ── swagger-parser mock ─────────────────────────────────────────────────────

vi.mock('@apidevtools/swagger-parser', () => ({
  default: { validate: mockValidate },
}));

// ── Module under test ───────────────────────────────────────────────────────

import { OpenAPIAdapter } from '../../src/integrations/adapters/openapi-adapter.js';

// ── Minimal OpenAPI 3.0 spec fixture ────────────────────────────────────────

function makeSpec(
  paths: OpenAPIV3.PathsObject = {},
  servers: OpenAPIV3.ServerObject[] = [{ url: 'https://api.example.com' }],
): OpenAPIV3.Document {
  return {
    openapi: '3.0.3',
    info: { title: 'Test API', version: '1.0.0' },
    servers,
    paths,
  };
}

const PET_SPEC = makeSpec({
  '/pets': {
    get: {
      operationId: 'listPets',
      summary: 'List all pets',
      parameters: [
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer' },
        },
      ],
      responses: { '200': { description: 'OK' } },
    },
    post: {
      operationId: 'createPet',
      summary: 'Create a pet',
      requestBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                tag: { type: 'string' },
              },
            },
          },
        },
      },
      responses: { '201': { description: 'Created' } },
    },
  },
  '/pets/{petId}': {
    get: {
      operationId: 'getPet',
      summary: 'Get a pet by ID',
      parameters: [
        {
          name: 'petId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { '200': { description: 'OK' } },
    },
    delete: {
      operationId: 'deletePet',
      summary: 'Delete a pet',
      parameters: [
        {
          name: 'petId',
          in: 'path',
          required: true,
          schema: { type: 'string' },
        },
      ],
      responses: { '204': { description: 'Deleted' } },
    },
  },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAdapter(name = 'test-api'): OpenAPIAdapter {
  return new OpenAPIAdapter(name);
}

async function initializedAdapter(spec: OpenAPIV3.Document = PET_SPEC): Promise<OpenAPIAdapter> {
  const adapter = makeAdapter();
  mockValidate.mockResolvedValueOnce(spec);
  await adapter.initialize({
    options: {
      specJson: JSON.stringify(spec),
      authType: 'bearer',
      authToken: 'tok_test',
    },
  });
  return adapter;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OpenAPIAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ── 1. Capabilities generated from paths ──────────────────────────────────

  describe('capabilities generated from paths', () => {
    it('generates one capability per path+method combination', async () => {
      const adapter = await initializedAdapter();
      const caps = adapter.describeCapabilities();

      // PET_SPEC has: GET /pets, POST /pets, GET /pets/{petId}, DELETE /pets/{petId}
      expect(caps).toHaveLength(4);

      const names = caps.map((c) => c.name);
      expect(names).toContain('listPets');
      expect(names).toContain('createPet');
      expect(names).toContain('getPet');
      expect(names).toContain('deletePet');
    });

    it('uses operationId as capability name when available', async () => {
      const adapter = await initializedAdapter();
      const caps = adapter.describeCapabilities();

      expect(caps.find((c) => c.name === 'listPets')).toBeDefined();
    });

    it('generates name from method+path when operationId is missing', async () => {
      const spec = makeSpec({
        '/items': {
          get: {
            summary: 'List items',
            responses: { '200': { description: 'OK' } },
          },
        },
      });

      mockValidate.mockResolvedValueOnce(spec);
      const adapter = makeAdapter();
      await adapter.initialize({ options: { specJson: '{}' } });

      const caps = adapter.describeCapabilities();
      expect(caps).toHaveLength(1);
      expect(caps[0].name).toBe('get_items');
    });

    it('uses summary as description', async () => {
      const adapter = await initializedAdapter();
      const caps = adapter.describeCapabilities();

      const listPets = caps.find((c) => c.name === 'listPets');
      expect(listPets?.description).toBe('List all pets');
    });
  });

  // ── 2. GET paths = read category ──────────────────────────────────────────

  describe('GET paths = read category', () => {
    it('marks GET operations as read category', async () => {
      const adapter = await initializedAdapter();
      const caps = adapter.describeCapabilities();

      const listPets = caps.find((c) => c.name === 'listPets');
      expect(listPets?.category).toBe('read');

      const getPet = caps.find((c) => c.name === 'getPet');
      expect(getPet?.category).toBe('read');
    });

    it('GET operations do not require approval', async () => {
      const adapter = await initializedAdapter();
      const caps = adapter.describeCapabilities();

      const listPets = caps.find((c) => c.name === 'listPets');
      expect(listPets?.requiresApproval).toBe(false);
    });
  });

  // ── 3. POST paths = write + requiresApproval ─────────────────────────────

  describe('POST/DELETE paths = write + requiresApproval', () => {
    it('marks POST operations as write category', async () => {
      const adapter = await initializedAdapter();
      const caps = adapter.describeCapabilities();

      const createPet = caps.find((c) => c.name === 'createPet');
      expect(createPet?.category).toBe('write');
    });

    it('POST operations require approval', async () => {
      const adapter = await initializedAdapter();
      const caps = adapter.describeCapabilities();

      const createPet = caps.find((c) => c.name === 'createPet');
      expect(createPet?.requiresApproval).toBe(true);
    });

    it('DELETE operations are write + requiresApproval', async () => {
      const adapter = await initializedAdapter();
      const caps = adapter.describeCapabilities();

      const deletePet = caps.find((c) => c.name === 'deletePet');
      expect(deletePet?.category).toBe('write');
      expect(deletePet?.requiresApproval).toBe(true);
    });
  });

  // ── 4. Zod schema generated from parameters ──────────────────────────────

  describe('Zod schema generated from parameters', () => {
    it('rejects query() with missing required path parameter', async () => {
      const adapter = await initializedAdapter();

      // getPet requires petId (string, required) — omitting it should fail Zod validation
      await expect(adapter.query('getPet', {})).rejects.toThrow();
    });

    it('accepts query() with valid required parameter', async () => {
      const adapter = await initializedAdapter();

      const mockResponse = new Response(JSON.stringify({ id: '123', name: 'Fido' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await adapter.query('getPet', { petId: '123' });
      expect(result).toEqual({ id: '123', name: 'Fido' });
    });

    it('accepts optional query parameter', async () => {
      const adapter = await initializedAdapter();

      const mockResponse = new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      // limit is optional — calling without it should work
      await expect(adapter.query('listPets', {})).resolves.toEqual([]);
    });

    it('validates request body properties for POST operations', async () => {
      const adapter = await initializedAdapter();

      const mockResponse = new Response(JSON.stringify({ id: '1', name: 'Rex' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      // createPet requires name (string) — provide it
      const result = await adapter.execute('createPet', { name: 'Rex' });
      expect(result).toEqual({ id: '1', name: 'Rex' });
    });
  });

  // ── 5. query() makes correct HTTP call ────────────────────────────────────

  describe('query() makes correct HTTP call', () => {
    it('calls correct URL with path parameters substituted', async () => {
      const adapter = await initializedAdapter();

      const mockResponse = new Response(JSON.stringify({ id: '42', name: 'Buddy' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      await adapter.query('getPet', { petId: '42' });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.example.com/pets/42');
      expect((options as RequestInit).method).toBe('GET');
    });

    it('appends query parameters for GET requests', async () => {
      const adapter = await initializedAdapter();

      const mockResponse = new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      await adapter.query('listPets', { limit: 10 });

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.example.com/pets?limit=10');
    });

    it('includes auth headers in request', async () => {
      const adapter = await initializedAdapter();

      const mockResponse = new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      await adapter.query('listPets', {});

      const [, options] = fetchSpy.mock.calls[0];
      const headers = (options as RequestInit).headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer tok_test');
    });

    it('sends JSON body for POST requests', async () => {
      const adapter = await initializedAdapter();

      const mockResponse = new Response(JSON.stringify({ id: '1', name: 'Rex' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      await adapter.execute('createPet', { name: 'Rex', tag: 'dog' });

      const [url, options] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.example.com/pets');
      expect((options as RequestInit).method).toBe('POST');
      expect(JSON.parse((options as RequestInit).body as string)).toEqual({
        name: 'Rex',
        tag: 'dog',
      });
      const headers = (options as RequestInit).headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('throws on HTTP error response', async () => {
      const adapter = await initializedAdapter();

      const mockResponse = new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      await expect(adapter.query('getPet', { petId: 'missing' })).rejects.toThrow('HTTP 404');
    });

    it('returns text for non-JSON responses', async () => {
      const adapter = await initializedAdapter();

      const mockResponse = new Response('plain text response', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      });
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(mockResponse);

      const result = await adapter.query('listPets', {});
      expect(result).toBe('plain text response');
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws when neither specUrl nor specJson is provided', async () => {
      const adapter = makeAdapter();
      await expect(adapter.initialize({ options: {} })).rejects.toThrow(
        'OpenAPI adapter requires specUrl or specJson',
      );
    });

    it('throws on invalid spec', async () => {
      mockValidate.mockRejectedValueOnce(new Error('spec parse error'));
      const adapter = makeAdapter();
      await expect(adapter.initialize({ options: { specJson: '{invalid}' } })).rejects.toThrow(
        'OpenAPI spec validation failed',
      );
    });

    it('throws when calling query() before initialize()', async () => {
      const adapter = makeAdapter();
      await expect(adapter.query('listPets', {})).rejects.toThrow('not initialized');
    });

    it('throws for unknown operation', async () => {
      const adapter = await initializedAdapter();
      await expect(adapter.query('nonExistent', {})).rejects.toThrow('Unknown operation');
    });

    it('throws when using query() for a write operation', async () => {
      const adapter = await initializedAdapter();
      await expect(adapter.query('createPet', { name: 'Rex' })).rejects.toThrow('write operation');
    });

    it('throws when using execute() for a read operation', async () => {
      const adapter = await initializedAdapter();
      await expect(adapter.execute('listPets', {})).rejects.toThrow('read operation');
    });
  });
});
