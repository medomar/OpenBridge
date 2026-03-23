import { describe, it, expect } from 'vitest';
import {
  postmanToOpenAPI,
  type PostmanCollection,
} from '../../src/integrations/parsers/postman-parser.js';

describe('postman-parser', () => {
  const minimalCollection: PostmanCollection = {
    info: {
      name: 'Test API',
      description: 'A test collection',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: 'Get Users',
        request: {
          method: 'GET',
          url: {
            raw: 'https://api.example.com/users',
            protocol: 'https',
            host: ['api', 'example', 'com'],
            path: ['users'],
          },
        },
      },
    ],
  };

  it('converts a minimal Postman collection to OpenAPI 3.0', () => {
    const spec = postmanToOpenAPI(minimalCollection);

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Test API');
    expect(spec.info.description).toBe('A test collection');
    expect(spec.paths['/users']).toBeDefined();
    expect((spec.paths['/users'] as Record<string, unknown>)['get']).toBeDefined();
  });

  it('extracts method, URL path, and summary from requests', () => {
    const spec = postmanToOpenAPI(minimalCollection);
    const getOp = (spec.paths['/users'] as Record<string, unknown>)['get'] as Record<
      string,
      unknown
    >;

    expect(getOp['summary']).toBe('Get Users');
    expect(getOp['operationId']).toBe('get_users');
  });

  it('maps folder structure to tags', () => {
    const collection: PostmanCollection = {
      info: { name: 'Tagged API', schema: 'postman' },
      item: [
        {
          name: 'Users',
          item: [
            {
              name: 'List Users',
              request: {
                method: 'GET',
                url: { path: ['users'] },
              },
            },
          ],
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);

    expect(spec.tags).toBeDefined();
    expect(spec.tags!.some((t) => t.name === 'Users')).toBe(true);

    const getOp = (spec.paths['/users'] as Record<string, unknown>)['get'] as Record<
      string,
      unknown
    >;
    expect(getOp['tags']).toEqual(['Users']);
  });

  it('converts bearer auth to OpenAPI security scheme', () => {
    const collection: PostmanCollection = {
      info: { name: 'Auth API', schema: 'postman' },
      auth: { type: 'bearer', bearer: [{ key: 'token', value: 'xxx' }] },
      item: [
        {
          name: 'Get Me',
          request: {
            method: 'GET',
            url: { path: ['me'] },
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);

    expect(spec.components?.securitySchemes?.['bearerAuth']).toEqual({
      type: 'http',
      scheme: 'bearer',
    });
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
  });

  it('converts basic auth', () => {
    const collection: PostmanCollection = {
      info: { name: 'Basic Auth API', schema: 'postman' },
      auth: { type: 'basic' },
      item: [],
    };

    const spec = postmanToOpenAPI(collection);

    expect(spec.components?.securitySchemes?.['basicAuth']).toEqual({
      type: 'http',
      scheme: 'basic',
    });
  });

  it('converts apikey auth', () => {
    const collection: PostmanCollection = {
      info: { name: 'API Key API', schema: 'postman' },
      auth: {
        type: 'apikey',
        apikey: [
          { key: 'key', value: 'X-API-Key' },
          { key: 'in', value: 'header' },
        ],
      },
      item: [],
    };

    const spec = postmanToOpenAPI(collection);

    expect(spec.components?.securitySchemes?.['apiKeyAuth']).toEqual({
      type: 'apiKey',
      name: 'X-API-Key',
      in: 'header',
    });
  });

  it('handles POST requests with JSON body', () => {
    const collection: PostmanCollection = {
      info: { name: 'POST API', schema: 'postman' },
      item: [
        {
          name: 'Create User',
          request: {
            method: 'POST',
            url: { path: ['users'] },
            body: {
              mode: 'raw',
              raw: '{"name": "John", "age": 30}',
              options: { raw: { language: 'json' } },
            },
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);
    const postOp = (spec.paths['/users'] as Record<string, unknown>)['post'] as Record<
      string,
      unknown
    >;
    const reqBody = postOp['requestBody'] as Record<string, unknown>;
    const content = reqBody['content'] as Record<string, unknown>;

    expect(content['application/json']).toBeDefined();
  });

  it('handles form-urlencoded body', () => {
    const collection: PostmanCollection = {
      info: { name: 'Form API', schema: 'postman' },
      item: [
        {
          name: 'Submit Form',
          request: {
            method: 'POST',
            url: { path: ['submit'] },
            body: {
              mode: 'urlencoded',
              urlencoded: [
                { key: 'email', value: 'test@example.com' },
                { key: 'password', value: 'secret' },
              ],
            },
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);
    const postOp = (spec.paths['/submit'] as Record<string, unknown>)['post'] as Record<
      string,
      unknown
    >;
    const reqBody = postOp['requestBody'] as Record<string, unknown>;
    const content = reqBody['content'] as Record<string, unknown>;

    expect(content['application/x-www-form-urlencoded']).toBeDefined();
  });

  it('converts example responses', () => {
    const collection: PostmanCollection = {
      info: { name: 'Response API', schema: 'postman' },
      item: [
        {
          name: 'Get Users',
          request: {
            method: 'GET',
            url: { path: ['users'] },
          },
          response: [
            {
              name: 'Success',
              code: 200,
              status: 'OK',
              body: '[{"id": 1, "name": "Alice"}]',
              _postman_previewlanguage: 'json',
            },
            {
              name: 'Not Found',
              code: 404,
              status: 'Not Found',
              body: '{"error": "not found"}',
              _postman_previewlanguage: 'json',
            },
          ],
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);
    const getOp = (spec.paths['/users'] as Record<string, unknown>)['get'] as Record<
      string,
      unknown
    >;
    const responses = getOp['responses'] as Record<string, unknown>;

    expect(responses['200']).toBeDefined();
    expect(responses['404']).toBeDefined();
  });

  it('substitutes {{variables}} from collection variables', () => {
    const collection: PostmanCollection = {
      info: { name: 'Var API', schema: 'postman' },
      variable: [{ key: 'version', value: 'v2' }],
      item: [
        {
          name: 'Get Items',
          request: {
            method: 'GET',
            url: {
              path: ['api', '{{version}}', 'items'],
            },
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);

    expect(spec.paths['/api/v2/items']).toBeDefined();
  });

  it('substitutes {{variables}} from user-provided overrides', () => {
    const collection: PostmanCollection = {
      info: { name: 'Override API', schema: 'postman' },
      variable: [{ key: 'version', value: 'v1' }],
      item: [
        {
          name: 'Get Items',
          request: {
            method: 'GET',
            url: { path: ['api', '{{version}}', 'items'] },
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection, { version: 'v3' });

    expect(spec.paths['/api/v3/items']).toBeDefined();
  });

  it('converts unresolved {{variables}} to OpenAPI {param} syntax', () => {
    const collection: PostmanCollection = {
      info: { name: 'Unresolved API', schema: 'postman' },
      item: [
        {
          name: 'Get Item',
          request: {
            method: 'GET',
            url: { path: ['items', '{{itemId}}'] },
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);

    expect(spec.paths['/items/{itemId}']).toBeDefined();
  });

  it('handles path variables with colon syntax', () => {
    const collection: PostmanCollection = {
      info: { name: 'Colon Var API', schema: 'postman' },
      item: [
        {
          name: 'Get User',
          request: {
            method: 'GET',
            url: {
              path: ['users', ':userId'],
              variable: [{ key: 'userId', description: 'The user ID' }],
            },
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);

    expect(spec.paths['/users/{userId}']).toBeDefined();
    const getOp = (spec.paths['/users/{userId}'] as Record<string, unknown>)['get'] as Record<
      string,
      unknown
    >;
    const params = getOp['parameters'] as Array<Record<string, unknown>>;
    const pathParam = params.find((p) => p['name'] === 'userId');
    expect(pathParam).toBeDefined();
    expect(pathParam!['in']).toBe('path');
    expect(pathParam!['required']).toBe(true);
  });

  it('handles query parameters', () => {
    const collection: PostmanCollection = {
      info: { name: 'Query API', schema: 'postman' },
      item: [
        {
          name: 'Search',
          request: {
            method: 'GET',
            url: {
              path: ['search'],
              query: [
                { key: 'q', value: 'test', description: 'Search query' },
                { key: 'limit', value: '10' },
                { key: 'disabled_param', value: 'x', disabled: true },
              ],
            },
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);
    const getOp = (spec.paths['/search'] as Record<string, unknown>)['get'] as Record<
      string,
      unknown
    >;
    const params = getOp['parameters'] as Array<Record<string, unknown>>;

    expect(params.some((p) => p['name'] === 'q')).toBe(true);
    expect(params.some((p) => p['name'] === 'limit')).toBe(true);
    // Disabled param should be excluded
    expect(params.some((p) => p['name'] === 'disabled_param')).toBe(false);
  });

  it('handles custom headers (skips common ones)', () => {
    const collection: PostmanCollection = {
      info: { name: 'Header API', schema: 'postman' },
      item: [
        {
          name: 'Custom Header Request',
          request: {
            method: 'GET',
            url: { path: ['data'] },
            header: [
              { key: 'X-Custom-Header', value: 'foo' },
              { key: 'Content-Type', value: 'application/json' },
              { key: 'Authorization', value: 'Bearer xxx' },
            ],
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);
    const getOp = (spec.paths['/data'] as Record<string, unknown>)['get'] as Record<
      string,
      unknown
    >;
    const params = getOp['parameters'] as Array<Record<string, unknown>>;

    // Only custom header should be included
    expect(params.some((p) => p['name'] === 'X-Custom-Header')).toBe(true);
    expect(params.some((p) => p['name'] === 'Content-Type')).toBe(false);
    expect(params.some((p) => p['name'] === 'Authorization')).toBe(false);
  });

  it('sets baseUrl server from variables', () => {
    const collection: PostmanCollection = {
      info: { name: 'Server API', schema: 'postman' },
      variable: [{ key: 'baseUrl', value: 'https://api.example.com' }],
      item: [],
    };

    const spec = postmanToOpenAPI(collection);

    expect(spec.servers).toEqual([{ url: 'https://api.example.com' }]);
  });

  it('handles deeply nested folders', () => {
    const collection: PostmanCollection = {
      info: { name: 'Nested API', schema: 'postman' },
      item: [
        {
          name: 'Admin',
          item: [
            {
              name: 'Users',
              item: [
                {
                  name: 'List Admin Users',
                  request: {
                    method: 'GET',
                    url: { path: ['admin', 'users'] },
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);

    expect(spec.tags!.some((t) => t.name === 'Admin')).toBe(true);
    expect(spec.tags!.some((t) => t.name === 'Users')).toBe(true);

    const getOp = (spec.paths['/admin/users'] as Record<string, unknown>)['get'] as Record<
      string,
      unknown
    >;
    // Should use innermost folder as tag
    expect(getOp['tags']).toEqual(['Users']);
  });

  it('handles empty collection gracefully', () => {
    const spec = postmanToOpenAPI({});

    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Converted from Postman');
    expect(spec.paths).toEqual({});
  });

  it('handles formdata with file type', () => {
    const collection: PostmanCollection = {
      info: { name: 'Upload API', schema: 'postman' },
      item: [
        {
          name: 'Upload File',
          request: {
            method: 'POST',
            url: { path: ['upload'] },
            body: {
              mode: 'formdata',
              formdata: [
                { key: 'file', type: 'file' },
                { key: 'description', value: 'A file', type: 'text' },
              ],
            },
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);
    const postOp = (spec.paths['/upload'] as Record<string, unknown>)['post'] as Record<
      string,
      unknown
    >;
    const reqBody = postOp['requestBody'] as Record<string, unknown>;
    const content = reqBody['content'] as Record<
      string,
      Record<string, Record<string, Record<string, unknown>>>
    >;

    expect(content['multipart/form-data']).toBeDefined();
    expect(content['multipart/form-data']!['schema']!['properties']!['file']!['format']).toBe(
      'binary',
    );
  });

  it('handles string URL format', () => {
    const collection: PostmanCollection = {
      info: { name: 'String URL API', schema: 'postman' },
      item: [
        {
          name: 'Get Root',
          request: {
            method: 'GET',
            url: 'https://api.example.com/v1/items' as unknown as undefined,
          },
        },
      ],
    };

    const spec = postmanToOpenAPI(collection);

    expect(spec.paths['/v1/items']).toBeDefined();
  });
});
