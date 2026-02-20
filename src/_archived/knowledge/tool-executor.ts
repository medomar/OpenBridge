import type { WorkspaceMap } from '../../types/workspace-map.js';
import type {
  ToolCall,
  ToolResult,
  ApiCall,
  ListEndpointsCall,
  DescribeEndpointCall,
} from '../../types/tool.js';
import { ToolCallSchema } from '../../types/tool.js';
import { APIExecutor } from './api-executor.js';
import { createLogger } from '../../core/logger.js';

const logger = createLogger('tool-executor');

/**
 * Executes tool calls by routing them to the appropriate handler.
 * api_call → APIExecutor, list_endpoints and describe_endpoint → workspace map queries.
 */
export class ToolExecutor {
  private readonly apiExecutor: APIExecutor;
  private readonly map: WorkspaceMap;

  constructor(map: WorkspaceMap) {
    this.map = map;
    this.apiExecutor = new APIExecutor(map);
  }

  /**
   * Execute a single tool call and return the result.
   */
  async execute(call: ToolCall): Promise<ToolResult> {
    logger.info({ callId: call.id, action: call.action }, 'Executing tool call');

    switch (call.action) {
      case 'api_call':
        return this.executeApiCall(call);
      case 'list_endpoints':
        return this.executeListEndpoints(call);
      case 'describe_endpoint':
        return this.executeDescribeEndpoint(call);
    }
  }

  /**
   * Parse a raw object into a ToolCall, returning a ToolResult error if parsing fails.
   */
  parseToolCall(raw: unknown): { ok: true; call: ToolCall } | { ok: false; result: ToolResult } {
    const parsed = ToolCallSchema.safeParse(raw);
    if (!parsed.success) {
      const callId =
        raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string'
          ? raw.id
          : 'unknown';
      const action =
        raw && typeof raw === 'object' && 'action' in raw && typeof raw.action === 'string'
          ? raw.action
          : 'api_call';
      return {
        ok: false,
        result: {
          ok: false,
          callId,
          action: action as ToolResult['action'],
          error: `Invalid tool call: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
          code: 'INVALID_CALL',
          retryable: false,
        },
      };
    }
    return { ok: true, call: parsed.data };
  }

  /**
   * Parse and execute a raw tool call object in one step.
   */
  async parseAndExecute(raw: unknown): Promise<ToolResult> {
    const parsed = this.parseToolCall(raw);
    if (!parsed.ok) return parsed.result;
    return this.execute(parsed.call);
  }

  // ── Private Handlers ──────────────────────────────────────────

  private async executeApiCall(call: ApiCall): Promise<ToolResult> {
    const result = await this.apiExecutor.execute({
      endpointId: call.endpointId,
      pathParams: call.pathParams,
      queryParams: call.queryParams,
      body: call.body,
      headers: call.headers,
    });

    if (result.ok) {
      return {
        ok: true,
        callId: call.id,
        action: 'api_call',
        data: {
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
          body: result.body,
        },
        durationMs: result.durationMs,
      };
    }

    return {
      ok: false,
      callId: call.id,
      action: 'api_call',
      error: result.error,
      code: mapErrorCode(result.code),
      retryable: result.retryable,
    };
  }

  private executeListEndpoints(call: ListEndpointsCall): ToolResult {
    let endpoints = this.apiExecutor.listEndpoints();

    if (call.tag) {
      const tag = call.tag.toLowerCase();
      endpoints = endpoints.filter((ep) => {
        const full = this.apiExecutor.findEndpoint(ep.id);
        return full?.tags.some((t) => t.toLowerCase() === tag) ?? false;
      });
    }

    return {
      ok: true,
      callId: call.id,
      action: 'list_endpoints',
      data: endpoints,
      durationMs: 0,
    };
  }

  private executeDescribeEndpoint(call: DescribeEndpointCall): ToolResult {
    const endpoint = this.apiExecutor.findEndpoint(call.endpointId);
    if (!endpoint) {
      return {
        ok: false,
        callId: call.id,
        action: 'describe_endpoint',
        error: `Endpoint "${call.endpointId}" not found`,
        code: 'ENDPOINT_NOT_FOUND',
        retryable: false,
      };
    }

    return {
      ok: true,
      callId: call.id,
      action: 'describe_endpoint',
      data: {
        id: endpoint.id,
        name: endpoint.name,
        description: endpoint.description,
        method: endpoint.method,
        path: endpoint.path,
        parameters: endpoint.parameters,
        requestBody: endpoint.requestBody,
        response: endpoint.response,
        tags: endpoint.tags,
      },
      durationMs: 0,
    };
  }
}

/**
 * Map API executor error codes to tool result error codes.
 */
function mapErrorCode(
  code: string,
):
  | 'ENDPOINT_NOT_FOUND'
  | 'AUTH_ERROR'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'PARSE_ERROR' {
  switch (code) {
    case 'ENDPOINT_NOT_FOUND':
      return 'ENDPOINT_NOT_FOUND';
    case 'AUTH_ERROR':
      return 'AUTH_ERROR';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'NETWORK_ERROR':
      return 'NETWORK_ERROR';
    case 'RESPONSE_PARSE_ERROR':
    case 'REQUEST_BUILD_ERROR':
      return 'PARSE_ERROR';
    case 'HTTP_ERROR':
    default:
      return 'HTTP_ERROR';
  }
}
