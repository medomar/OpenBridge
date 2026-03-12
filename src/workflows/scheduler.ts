// TODO: Implement scheduler.ts
// - Install node-cron (npm install node-cron)
// - scheduleWorkflow(workflow: Workflow): Schedule cron jobs for schedule-type triggers
// - unscheduleWorkflow(id: string): Cancel a scheduled workflow
// - unscheduleAll(): Cancel all scheduled workflows
// - Store active cron jobs in Map for cleanup
// - Call engine.executeWorkflow() on cron trigger

export interface WorkflowScheduler {
  scheduleWorkflow(workflow: unknown): Promise<void>;
  unscheduleWorkflow(id: string): Promise<void>;
  unscheduleAll(): Promise<void>;
}
