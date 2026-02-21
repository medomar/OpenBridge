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
} from './exploration-prompts.js';

// Export MasterManager for lifecycle management
export { MasterManager } from './master-manager.js';
export type { MasterManagerOptions } from './master-manager.js';

// Export Master system prompt generator
export { generateMasterSystemPrompt } from './master-system-prompt.js';
export type { MasterSystemPromptContext } from './master-system-prompt.js';

// Export result parser utilities
export { parseAIResult, parseAIResultWithRetry } from './result-parser.js';
export type { ParseResult, ParseError, ParsedAIResult } from './result-parser.js';

// Export spawn parser for task decomposition protocol
export { parseSpawnMarkers, hasSpawnMarkers } from './spawn-parser.js';
export type { ParsedSpawnMarker, SpawnParseResult, SpawnMarkerBody } from './spawn-parser.js';

// Export ExplorationCoordinator for incremental exploration
export { ExplorationCoordinator } from './exploration-coordinator.js';
export type { ExplorationOptions } from './exploration-coordinator.js';
