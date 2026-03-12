// TODO: Implement workflow-store.ts
// SQLite storage for workflows, runs, and approvals
// - Tables: workflows, workflow_runs, workflow_approvals
// - CRUD: createWorkflow, getWorkflow, listWorkflows, updateWorkflow, deleteWorkflow
// - Run tracking: createRun, updateRun
// - Approval tracking: createApproval, resolveApproval
// - Add migration to src/memory/migration.ts

export interface WorkflowStore {
  createWorkflow(workflow: unknown): Promise<void>;
  getWorkflow(id: string): Promise<unknown>;
  listWorkflows(): Promise<unknown[]>;
  updateWorkflow(id: string, workflow: unknown): Promise<void>;
  deleteWorkflow(id: string): Promise<void>;
  createRun(run: unknown): Promise<void>;
  updateRun(id: string, run: unknown): Promise<void>;
  createApproval(approval: unknown): Promise<void>;
  resolveApproval(id: string, approved: boolean): Promise<void>;
}
