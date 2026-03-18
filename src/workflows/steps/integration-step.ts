import { z } from 'zod/v3';
import { createLogger } from '../../core/logger.js';
import type { IntegrationHub } from '../../integrations/hub.js';
import type { StepResult } from '../../types/workflow.js';

const logger = createLogger('integration-step');

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

export const IntegrationConfigSchema = z
  .object({
    /** Name of the registered integration to call (e.g. "stripe", "google-drive") */
    integration: z.string().min(1),
    /** Operation name to invoke (e.g. "create_payment_link", "list_files") */
    operation: z.string().min(1),
    /**
     * Parameters to pass to the operation.
     * String values support Mustache-style `{{field}}` substitution
     * using the incoming StepResult json data.
     */
    params: z.record(z.unknown()).default({}),
    /**
     * Whether to call `query()` (read, default) or `execute()` (write).
     * Defaults to "query" for safety — set to "execute" for write operations.
     */
    method: z.enum(['query', 'execute']).default('query'),
  })
  .strict();

export type IntegrationStepConfig = z.infer<typeof IntegrationConfigSchema>;

// ---------------------------------------------------------------------------
// Template rendering (mirrors send-step pattern)
// ---------------------------------------------------------------------------

function resolveField(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined) return '';
    if (typeof current === 'object' && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current)) {
      const idx = Number(part);
      current = isNaN(idx) ? undefined : current[idx];
    } else {
      return '';
    }
  }
  return current ?? '';
}

/**
 * Recursively template all string values in a params object using
 * Mustache-style `{{field}}` substitution with data from the incoming step.
 */
function templateParams(
  params: Record<string, unknown>,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      result[key] = value.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
        const resolved = resolveField(data, path.trim());
        if (resolved === null || resolved === undefined) return '';
        if (typeof resolved === 'object') return JSON.stringify(resolved);
        return String(resolved as string | number | boolean);
      });
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = templateParams(value as Record<string, unknown>, data);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Step executor
// ---------------------------------------------------------------------------

/**
 * Execute an integration step: call IntegrationHub's `query()` or `execute()`
 * with the specified operation and parameters, templated with input data.
 *
 * @param hub    - IntegrationHub instance with registered adapters
 * @param config - Step configuration (integration, operation, params, method)
 * @param input  - Incoming data envelope from the previous step
 * @returns A StepResult with the integration response merged into json
 */
export async function executeIntegrationStep(
  hub: IntegrationHub,
  config: {
    integration: string;
    operation: string;
    params?: Record<string, unknown>;
    method?: 'query' | 'execute';
  },
  input: StepResult,
): Promise<StepResult> {
  const parsed = IntegrationConfigSchema.parse(config);
  const { integration: integrationName, operation, method } = parsed;

  // Template params with input data
  const resolvedParams = templateParams(parsed.params, input.json);

  logger.debug(
    { integration: integrationName, operation, method, paramKeys: Object.keys(resolvedParams) },
    'Executing integration step',
  );

  let integrationResult: unknown;
  try {
    const adapter = hub.get(integrationName);
    if (method === 'execute') {
      integrationResult = await adapter.execute(operation, resolvedParams);
    } else {
      integrationResult = await adapter.query(operation, resolvedParams);
    }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { integration: integrationName, operation, method, error: errorMsg },
      'Integration step failed',
    );
    throw err;
  }

  logger.info({ integration: integrationName, operation, method }, 'Integration step completed');

  // Normalize result to an object for json merging
  const resultData: Record<string, unknown> =
    integrationResult !== null &&
    integrationResult !== undefined &&
    typeof integrationResult === 'object' &&
    !Array.isArray(integrationResult)
      ? (integrationResult as Record<string, unknown>)
      : { _integration_result: integrationResult };

  return {
    json: {
      ...input.json,
      ...resultData,
      _integration_name: integrationName,
      _integration_operation: operation,
    },
    files: input.files,
  };
}
