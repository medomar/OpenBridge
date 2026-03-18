import { randomUUID } from 'node:crypto';
import { createLogger } from '../core/logger.js';
import type { Workflow, WorkflowRun, WorkflowStep, StepResult } from '../types/workflow.js';
import type { WorkflowStore } from './workflow-store.js';

const logger = createLogger('workflow-engine');

// ---------------------------------------------------------------------------
// WorkflowEngine interface
// ---------------------------------------------------------------------------

export interface WorkflowEngine {
  loadWorkflows(): Promise<void>;
  executeWorkflow(id: string, triggerData?: unknown): Promise<void>;
  enableWorkflow(id: string): Promise<void>;
  disableWorkflow(id: string): Promise<void>;
  getLoadedWorkflows(): Map<string, Workflow>;
}

// ---------------------------------------------------------------------------
// Step executor — runs a single step, returns its output
// ---------------------------------------------------------------------------

function executeStep(step: WorkflowStep, input: StepResult): StepResult {
  const config = step.config;

  switch (step.type) {
    case 'query': {
      // Query step: pass config + input through as JSON
      return {
        json: { ...input.json, query: config['query'] ?? config['sql'] ?? null, step: step.id },
        files: input.files,
      };
    }

    case 'transform': {
      // Transform step: apply field mappings from config
      const mappings = (config['mappings'] ?? {}) as Record<string, string>;
      const transformed: Record<string, unknown> = { ...input.json };
      for (const [target, source] of Object.entries(mappings)) {
        transformed[target] = input.json[source] ?? null;
      }
      return { json: transformed, files: input.files };
    }

    case 'condition': {
      // Condition step: evaluate a simple field check
      const field = config['field'] as string | undefined;
      const operator = (config['operator'] as string) ?? 'equals';
      const value = config['value'];

      let matched = false;
      if (field) {
        const actual = input.json[field];
        switch (operator) {
          case 'equals':
            matched = actual === value;
            break;
          case 'not_equals':
            matched = actual !== value;
            break;
          case 'exists':
            matched = actual !== undefined && actual !== null;
            break;
          case 'gt':
            matched = typeof actual === 'number' && typeof value === 'number' && actual > value;
            break;
          case 'lt':
            matched = typeof actual === 'number' && typeof value === 'number' && actual < value;
            break;
          default:
            matched = actual === value;
        }
      }
      return { json: { ...input.json, _condition_matched: matched }, files: input.files };
    }

    case 'send':
    case 'integration':
    case 'approval':
    case 'ai':
    case 'generate': {
      // These step types require external integrations (messaging, AI runner, etc.)
      // For now, pass through input with step metadata attached
      return {
        json: { ...input.json, _step_type: step.type, _step_id: step.id, _step_config: config },
        files: input.files,
      };
    }

    default:
      return input;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWorkflowEngine(store: WorkflowStore): WorkflowEngine {
  const loaded = new Map<string, Workflow>();

  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for future DB async support
    async loadWorkflows(): Promise<void> {
      loaded.clear();
      const workflows = store.listWorkflows(true);
      for (const wf of workflows) {
        loaded.set(wf.id, wf);
      }
      logger.info({ count: loaded.size }, 'Loaded active workflows');
    },

    getLoadedWorkflows(): Map<string, Workflow> {
      return loaded;
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for future async step support
    async executeWorkflow(id: string, triggerData?: unknown): Promise<void> {
      const workflow = loaded.get(id) ?? store.getWorkflow(id);
      if (!workflow) {
        logger.warn({ workflowId: id }, 'Workflow not found');
        return;
      }

      const runId = randomUUID();
      const now = new Date().toISOString();
      const run: WorkflowRun = {
        id: runId,
        workflow_id: id,
        status: 'running',
        trigger_data: triggerData != null ? (triggerData as Record<string, unknown>) : undefined,
        current_step: 0,
        started_at: now,
      };

      store.createRun(run);
      logger.info({ workflowId: id, runId }, 'Workflow run started');

      let currentOutput: StepResult = {
        json: triggerData != null ? (triggerData as Record<string, unknown>) : {},
      };

      const steps = [...workflow.steps].sort((a, b) => a.sort_order - b.sort_order);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        store.updateRun(runId, { current_step: i, status: 'running' });

        try {
          logger.debug(
            { workflowId: id, runId, stepId: step.id, stepType: step.type },
            'Executing step',
          );
          currentOutput = executeStep(step, currentOutput);
          store.updateRun(runId, { last_output: currentOutput });
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error(
            { workflowId: id, runId, stepId: step.id, error: errorMsg },
            'Step execution failed',
          );

          if (step.continue_on_error) {
            // Attach error info to output and continue
            currentOutput = {
              json: { ...currentOutput.json, _step_error: errorMsg, _failed_step: step.id },
              files: currentOutput.files,
            };
            store.updateRun(runId, { last_output: currentOutput });
            continue;
          }

          // Mark run as failed and update workflow error count
          store.updateRun(runId, {
            status: 'failed',
            error: `Step "${step.name}" (${step.id}) failed: ${errorMsg}`,
            completed_at: new Date().toISOString(),
          });
          store.updateWorkflow(id, {
            error_count: (workflow.error_count ?? 0) + 1,
            last_run_at: new Date().toISOString(),
          });
          logger.error({ workflowId: id, runId }, 'Workflow run failed');
          return;
        }
      }

      // All steps completed successfully
      const completedAt = new Date().toISOString();
      store.updateRun(runId, {
        status: 'completed',
        last_output: currentOutput,
        completed_at: completedAt,
      });
      store.updateWorkflow(id, {
        run_count: (workflow.run_count ?? 0) + 1,
        last_run_at: completedAt,
      });
      logger.info({ workflowId: id, runId }, 'Workflow run completed');
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for future async support
    async enableWorkflow(id: string): Promise<void> {
      store.updateWorkflow(id, { status: 'active' });
      const wf = store.getWorkflow(id);
      if (wf) {
        loaded.set(id, wf);
        logger.info({ workflowId: id }, 'Workflow enabled');
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for future async support
    async disableWorkflow(id: string): Promise<void> {
      store.updateWorkflow(id, { status: 'inactive' });
      loaded.delete(id);
      logger.info({ workflowId: id }, 'Workflow disabled');
    },
  };
}
