/**
 * Master AI Module
 *
 * Manages the Master AI lifecycle, workspace exploration, and knowledge storage.
 * The Master AI autonomously explores workspaces, stores knowledge in .openbridge/,
 * and provides intelligent responses based on workspace understanding.
 */

// Export DotFolderManager for .openbridge/ folder operations
export { DotFolderManager } from './dotfolder-manager.js';

// Export exploration prompt generators (legacy monolithic)
export {
  generateExplorationPrompt,
  generateReExplorationPrompt,
  SAMPLE_WORKSPACE_MAP,
} from './exploration-prompt.js';

// Export incremental exploration prompt generators
export {
  generateStructureScanPrompt,
  generateClassificationPrompt,
  generateDirectoryDivePrompt,
  generateSummaryPrompt,
  generateIncrementalExplorationPrompt,
} from './exploration-prompts.js';

// Export workspace change tracker for incremental exploration
export { WorkspaceChangeTracker } from './workspace-change-tracker.js';
export type { WorkspaceChanges } from './workspace-change-tracker.js';

// Export MasterManager for lifecycle management
export { MasterManager } from './master-manager.js';
export type {
  MasterManagerOptions,
  ClassificationResult,
  ProgressReporter,
} from './master-manager.js';

// Export Master system prompt generator
export { generateMasterSystemPrompt } from './master-system-prompt.js';
export type { MasterSystemPromptContext } from './master-system-prompt.js';

// Export result parser utilities
export { parseAIResult, parseAIResultWithRetry } from './result-parser.js';
export type { ParseResult, ParseError, ParsedAIResult } from './result-parser.js';

// Export spawn parser for task decomposition protocol
export { parseSpawnMarkers, hasSpawnMarkers } from './spawn-parser.js';
export type { ParsedSpawnMarker, SpawnParseResult, SpawnMarkerBody } from './spawn-parser.js';

// Export worker result formatter for structured result injection
export {
  formatWorkerResult,
  formatWorkerError,
  buildWorkerFeedbackPrompt,
  formatWorkerBatch,
} from './worker-result-formatter.js';
export type { WorkerResultMeta } from './worker-result-formatter.js';

// Export ExplorationCoordinator for incremental exploration
export { ExplorationCoordinator } from './exploration-coordinator.js';
export type { ExplorationOptions } from './exploration-coordinator.js';

// Export WorkerRegistry for worker orchestration
export { WorkerRegistry, DEFAULT_MAX_CONCURRENT_WORKERS } from './worker-registry.js';
export type { WorkerRecord, WorkerStatus, WorkersRegistry } from './worker-registry.js';

// Export sub-master detector for hierarchical workspace management (OB-753)
export { detectSubProjects, SUB_PROJECT_MIN_FILES } from './sub-master-detector.js';
export type { SubProjectInfo, ProjectType } from './sub-master-detector.js';

// Export sub-master manager for lifecycle management of sub-project masters (OB-754)
export { SubMasterManager } from './sub-master-manager.js';
export type { SubMasterRecord, SubMasterStatus } from './sub-master-manager.js';
