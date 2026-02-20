import type { WorkspaceMap, APIEndpoint, Parameter } from '../types/workspace-map.js';
import type { ToolDefinition } from '../types/tool.js';

/**
 * Build a tool catalog from a workspace map.
 * Converts each API endpoint into a ToolDefinition that can be provided
 * to an AI provider so it knows what tools are available.
 */
export function buildToolCatalog(map: WorkspaceMap): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  // Built-in tools available regardless of endpoints
  tools.push({
    name: 'list_endpoints',
    description: `List all available API endpoints in the "${map.name}" workspace. Optionally filter by tag.`,
    inputSchema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Optional tag to filter endpoints by' },
      },
    },
  });

  tools.push({
    name: 'describe_endpoint',
    description:
      'Get full details about a specific API endpoint including parameters, request body schema, and response schema.',
    inputSchema: {
      type: 'object',
      properties: {
        endpointId: { type: 'string', description: 'The endpoint ID to describe' },
      },
      required: ['endpointId'],
    },
  });

  // Convert each API endpoint into a tool definition
  for (const endpoint of map.endpoints) {
    tools.push(endpointToTool(endpoint));
  }

  return tools;
}

/**
 * Convert a single API endpoint into a tool definition.
 */
function endpointToTool(endpoint: APIEndpoint): ToolDefinition {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  // Path parameters
  const pathParams = endpoint.parameters.filter((p) => p.in === 'path');
  if (pathParams.length > 0) {
    properties['pathParams'] = {
      type: 'object',
      description: 'URL path parameters',
      properties: paramsToSchema(pathParams),
      required: pathParams.filter((p) => p.required).map((p) => p.name),
    };
    if (pathParams.some((p) => p.required)) {
      required.push('pathParams');
    }
  }

  // Query parameters
  const queryParams = endpoint.parameters.filter((p) => p.in === 'query');
  if (queryParams.length > 0) {
    properties['queryParams'] = {
      type: 'object',
      description: 'URL query parameters',
      properties: paramsToSchema(queryParams),
    };
  }

  // Request body
  if (endpoint.requestBody) {
    const bodyProp: Record<string, unknown> = {
      description: 'Request body',
    };

    if (endpoint.requestBody.schema) {
      bodyProp['type'] = 'object';
      bodyProp['properties'] = endpoint.requestBody.schema;
    }

    properties['body'] = bodyProp;

    // POST/PUT/PATCH usually require a body
    if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
      required.push('body');
    }
  }

  // Additional headers
  properties['headers'] = {
    type: 'object',
    description: 'Additional request headers (optional)',
  };

  const description = [
    `${endpoint.method} ${endpoint.path}`,
    endpoint.description ?? endpoint.name,
  ].join(' — ');

  return {
    name: `api_call:${endpoint.id}`,
    description,
    inputSchema: {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
    },
  };
}

/**
 * Convert endpoint parameters into a JSON Schema properties object.
 */
function paramsToSchema(params: Parameter[]): Record<string, unknown> {
  const schema: Record<string, unknown> = {};
  for (const param of params) {
    const prop: Record<string, unknown> = {
      type: param.type,
    };
    if (param.description) {
      prop['description'] = param.description;
    }
    if (param.example !== undefined) {
      prop['example'] = param.example;
    }
    schema[param.name] = prop;
  }
  return schema;
}
