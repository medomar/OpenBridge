/**
 * Master AI Module
 *
 * Manages the Master AI lifecycle, workspace exploration, and knowledge storage.
 * The Master AI autonomously explores workspaces, stores knowledge in .openbridge/,
 * and provides intelligent responses based on workspace understanding.
 */

// Export DotFolderManager for .openbridge/ folder operations
export { DotFolderManager } from './dotfolder-manager.js';

// Export exploration prompt generators
export {
  generateExplorationPrompt,
  generateReExplorationPrompt,
  SAMPLE_WORKSPACE_MAP,
} from './exploration-prompt.js';

// Note: MasterManager will be added here once OB-078 is complete
