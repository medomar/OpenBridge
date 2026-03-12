import nodeCron, { type ScheduledTask, type TaskOptions } from 'node-cron';
import { createLogger } from '../core/logger.js';
import type { Workflow } from '../types/workflow.js';
import type { WorkflowEngine } from './engine.js';

const logger = createLogger('workflow-scheduler');

export interface WorkflowScheduler {
  scheduleWorkflow(workflow: Workflow): Promise<void>;
  unscheduleWorkflow(id: string): Promise<void>;
  unscheduleAll(): Promise<void>;
}

export function createWorkflowScheduler(engine: WorkflowEngine): WorkflowScheduler {
  const jobs = new Map<string, ScheduledTask>();

  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for consistency
    async scheduleWorkflow(workflow: Workflow): Promise<void> {
      if (workflow.trigger.type !== 'schedule') {
        return;
      }

      const cronExpr = workflow.trigger.cron;
      if (!cronExpr) {
        logger.warn({ workflowId: workflow.id }, 'Schedule trigger missing cron expression');
        return;
      }

      if (!nodeCron.validate(cronExpr)) {
        logger.warn(
          { workflowId: workflow.id, cron: cronExpr },
          'Invalid cron expression — skipping schedule',
        );
        return;
      }

      // Cancel any existing job for this workflow before scheduling a new one
      const existing = jobs.get(workflow.id);
      if (existing) {
        void existing.stop();
        jobs.delete(workflow.id);
      }

      const options: TaskOptions = {};
      if (workflow.trigger.timezone) {
        options.timezone = workflow.trigger.timezone;
      }

      const task = nodeCron.schedule(
        cronExpr,
        () => {
          logger.info({ workflowId: workflow.id }, 'Cron trigger fired — executing workflow');
          void engine
            .executeWorkflow(workflow.id, { triggered_by: 'schedule', cron: cronExpr })
            .catch((err: unknown) => {
              logger.error(
                {
                  workflowId: workflow.id,
                  error: err instanceof Error ? err.message : String(err),
                },
                'Workflow execution failed on cron trigger',
              );
            });
        },
        options,
      );

      jobs.set(workflow.id, task);
      logger.info({ workflowId: workflow.id, cron: cronExpr }, 'Workflow scheduled');
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for consistency
    async unscheduleWorkflow(id: string): Promise<void> {
      const task = jobs.get(id);
      if (task) {
        void task.stop();
        jobs.delete(id);
        logger.info({ workflowId: id }, 'Workflow unscheduled');
      }
    },

    // eslint-disable-next-line @typescript-eslint/require-await -- interface is async for consistency
    async unscheduleAll(): Promise<void> {
      for (const [id, task] of jobs) {
        void task.stop();
        logger.debug({ workflowId: id }, 'Unscheduled workflow');
      }
      jobs.clear();
      logger.info('All workflows unscheduled');
    },
  };
}
