// TODO: Implement WorkflowEngine
// - loadWorkflows() from SQLite
// - executeWorkflow(id: string, triggerData?: unknown)
// - enableWorkflow(id) / disableWorkflow(id)
// - Run steps sequentially, passing output to next step (n8n data flow pattern)
// - Track run in workflow_runs table
// - Handle errors per step

export interface WorkflowEngine {
  loadWorkflows(): Promise<void>;
  executeWorkflow(id: string, triggerData?: unknown): Promise<void>;
  enableWorkflow(id: string): Promise<void>;
  disableWorkflow(id: string): Promise<void>;
}
