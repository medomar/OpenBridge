/**
 * Exploration Prompts — Incremental Multi-Pass Strategy
 *
 * Generates focused prompts for each phase of the incremental exploration workflow.
 * Each prompt is designed to be short (30-90s AI execution time) and produce JSON
 * output matching the corresponding Zod schema.
 *
 * Phase 1: Structure Scan  - List files/dirs, count, detect configs
 * Phase 2: Classification  - Determine project type, frameworks, commands
 * Phase 3: Directory Dives - Explore each significant directory in detail
 * Phase 4: Assembly        - Merge partial results into workspace-map.json
 *
 * All prompts are budget-constrained to PROMPT_CHAR_BUDGET (16K chars) to avoid
 * truncation by agent-runner's MAX_PROMPT_LENGTH (32K). Data payloads are trimmed
 * progressively: reduce indentation → trim arrays → compress JSON.
 */

import type { StructureScan, WorkspaceMap } from '../types/master.js';
import { createLogger } from '../core/logger.js';

const logger = createLogger('exploration-prompts');

/**
 * Maximum character budget for any single exploration prompt.
 * Each phase prompt must fit within this limit to avoid truncation
 * by agent-runner's MAX_PROMPT_LENGTH (32K). Set to 16K to leave
 * headroom for agent-runner overhead and system prompt wrapping.
 */
export const PROMPT_CHAR_BUDGET = 16_000;

/**
 * Trims a JSON data payload to fit within a character budget.
 * Strategy: pretty-print → trim arrays → compact JSON.
 */
function trimPayload(data: Record<string, unknown>, budget: number, arrayField?: string): string {
  let payload = JSON.stringify(data, null, 2);
  if (payload.length <= budget) return payload;

  // Step 1: trim the largest array field if specified
  if (arrayField && Array.isArray(data[arrayField])) {
    const arr = data[arrayField] as unknown[];
    const maxItems = Math.max(20, Math.floor(arr.length / 2));
    const trimmed = {
      ...data,
      [arrayField]: arr.slice(0, maxItems),
      _trimmed:
        arr.length > maxItems
          ? `Showing ${maxItems} of ${arr.length} ${arrayField} (trimmed for prompt size)`
          : undefined,
    };
    payload = JSON.stringify(trimmed, null, 2);
    if (payload.length <= budget) return payload;

    // Step 2: compress (no indentation)
    payload = JSON.stringify(trimmed);
    if (payload.length <= budget) return payload;

    // Step 3: aggressive trim — keep only first 10 items
    const aggressive = {
      ...data,
      [arrayField]: arr.slice(0, 10),
      _trimmed: `Showing 10 of ${arr.length} ${arrayField} (aggressively trimmed)`,
    };
    payload = JSON.stringify(aggressive);
    if (payload.length <= budget) return payload;
  }

  // Final fallback: compact JSON without the array field
  if (arrayField) {
    const withoutArr = {
      ...data,
      [arrayField]: `[${(data[arrayField] as unknown[]).length} items omitted]`,
    };
    return JSON.stringify(withoutArr);
  }
  return JSON.stringify(data);
}

/**
 * Pass 1: Structure Scan
 *
 * Generates a prompt that instructs the AI to scan the workspace structure
 * and return a JSON object matching StructureScanSchema.
 *
 * Expected duration: 60-90s
 * Output: structure-scan.json
 *
 * @param workspacePath - Absolute path to the workspace root
 * @returns Prompt for structure scan
 */
export function generateStructureScanPrompt(workspacePath: string): string {
  return `# Task: Workspace Structure Scan

Scan the workspace at **${workspacePath}** and return a JSON object with its structure.

## Instructions

1. List all **top-level files** (files directly in the workspace root)
2. List all **top-level directories** (directories directly in the workspace root)
3. For each top-level directory, count how many files it contains (recursively, but skip node_modules/.git/dist/.next/build/coverage/target)
4. Identify **configuration files** (package.json, tsconfig.json, requirements.txt, Cargo.toml, .env.example, etc.)
5. List **skipped directories** (node_modules, .git, dist, etc.)
6. Count **total files** in the workspace (excluding skipped directories)
7. Note **asset directories** (images/, assets/, public/, media/, fonts/, data/, icons/, graphics/) and count image/media files (.png, .jpg, .svg, .mp4, .mp3, .ttf, .woff, etc.)

## Skip These Directories

- node_modules
- .git
- dist
- build
- .next
- coverage
- target
- vendor
- __pycache__
- .venv
- venv

## Output Format

Return ONLY valid JSON matching this schema:

\`\`\`json
{
  "workspacePath": "${workspacePath}",
  "topLevelFiles": ["README.md", "package.json", ...],
  "topLevelDirs": ["src", "tests", "docs", ...],
  "directoryCounts": {
    "src": 42,
    "tests": 18,
    "docs": 5
  },
  "configFiles": ["package.json", "tsconfig.json", ...],
  "skippedDirs": ["node_modules", ".git", "dist"],
  "totalFiles": 65,
  "scannedAt": "2026-02-21T...",
  "durationMs": 1200
}
\`\`\`

**IMPORTANT:**
- Return ONLY the JSON object, no explanations or markdown
- Use ISO 8601 format for scannedAt
- durationMs should reflect actual scan time in milliseconds
- Do NOT read file contents in this phase (just list and count)
`;
}

/**
 * Pass 2: Classification
 *
 * Generates a prompt that instructs the AI to classify the project type
 * based on structure scan results and config file contents.
 *
 * Expected duration: 60-90s
 * Output: classification.json
 *
 * @param workspacePath - Absolute path to the workspace root
 * @param structureScan - Results from Pass 1 (structure scan)
 * @returns Prompt for project classification
 */
export function generateClassificationPrompt(
  workspacePath: string,
  structureScan: StructureScan,
): string {
  // Template overhead is ~2K chars; leave the rest for data
  const dataBudget = PROMPT_CHAR_BUDGET - 3_000;
  const scanPayload = trimPayload(
    structureScan as unknown as Record<string, unknown>,
    dataBudget,
    'topLevelFiles',
  );
  const promptSize = scanPayload.length + 3_000;
  if (promptSize > PROMPT_CHAR_BUDGET) {
    logger.debug(
      { promptSize, budget: PROMPT_CHAR_BUDGET },
      'Classification prompt exceeds budget after trimming',
    );
  }

  return `# Task: Project Classification

Classify the project at **${workspacePath}** based on the structure scan results below.

## Structure Scan Results

\`\`\`json
${scanPayload}
\`\`\`

## Instructions

1. **Read configuration files** listed in the structure scan (package.json, requirements.txt, etc.)
2. **Determine project type**:
   - Code projects: "node", "python", "rust", "go", "java", "react-app", "api-backend", etc.
   - Business workspaces: "cafe-operations", "legal-docs", "accounting-records", "real-estate-listings", etc.
   - Mixed: "business-app-with-data", "mixed"
3. **Detect frameworks and tools** (React, Express, Django, TypeScript, Vite, etc.)
4. **Extract commands** from package.json scripts, Makefile, etc.
5. **List dependencies** from package.json, requirements.txt, Cargo.toml, etc.
6. **Identify key insights** (build system, testing framework, deployment targets, etc.)

## Classification Heuristics

**Code workspace indicators:**
- Presence of: package.json, requirements.txt, Cargo.toml, go.mod
- Directories: src/, lib/, tests/, components/, api/
- Extensions: .ts, .js, .py, .rs, .go

**Business workspace indicators:**
- Extensions: .xlsx, .csv, .pdf, .docx, .txt, .md (without code configs)
- No build configs or dependency files
- Directories: invoices/, reports/, contracts/, inventory/, sales/

**Asset workspace indicators:**
- Directories: images/, assets/, public/, media/, fonts/, icons/, graphics/
- Extensions: .png, .jpg, .jpeg, .gif, .svg, .webp, .mp4, .mp3, .wav, .ttf, .woff, .woff2
- May coexist with code (design systems, games, media applications)

## Output Format

Return ONLY valid JSON matching this schema:

\`\`\`json
{
  "projectType": "node",
  "projectName": "openbridge",
  "frameworks": ["typescript", "node", "vitest"],
  "commands": {
    "dev": "npm run dev",
    "test": "npm test",
    "build": "npm run build"
  },
  "dependencies": [
    { "name": "typescript", "version": "^5.7.0", "type": "dev" },
    { "name": "pino", "version": "^9.0.0", "type": "runtime" }
  ],
  "insights": [
    "TypeScript project with strict mode enabled",
    "Uses Vitest for testing",
    "ESM-only project (type: module)"
  ],
  "classifiedAt": "2026-02-21T...",
  "durationMs": 1500
}
\`\`\`

**IMPORTANT:**
- Return ONLY the JSON object, no explanations
- Read actual config file contents, don't guess
- Be accurate — if you can't determine something, omit it
- Use ISO 8601 format for classifiedAt
`;
}

/**
 * Pass 3: Directory Dive
 *
 * Generates a prompt that instructs the AI to explore a single directory
 * in depth and return structured information about its contents.
 *
 * Expected duration: 60-90s per directory
 * Output: dirs/<dirname>.json
 *
 * @param workspacePath - Absolute path to the workspace root
 * @param dirPath - Relative path to the directory being explored
 * @param context - Context from previous passes (project type, frameworks, etc.)
 * @returns Prompt for directory dive
 */
export function generateDirectoryDivePrompt(
  workspacePath: string,
  dirPath: string,
  context: { projectType: string; frameworks: string[] },
): string {
  return `# Task: Directory Exploration — ${dirPath}

Explore the **${dirPath}** directory at **${workspacePath}/${dirPath}** and return structured information about its contents.

## Context

**Project Type:** ${context.projectType}
**Frameworks:** ${context.frameworks.join(', ') || 'none detected'}

## Instructions

1. **Determine the purpose** of this directory (what does it contain? what role does it play?)
2. **Identify key files** in this directory (important files and their purposes)
3. **List subdirectories** and their purposes (if any)
4. **Count files** in this directory (excluding subdirectories)
5. **Extract insights** specific to this directory (patterns, conventions, important details)

## What to Look For

- Entry points (index files, main modules)
- Configuration files specific to this directory
- README or documentation files
- Test files
- Patterns in file naming or organization
- Relationship to other parts of the project

## Output Format

Return ONLY valid JSON matching this schema:

\`\`\`json
{
  "path": "${dirPath}",
  "purpose": "Application source code — main implementation files",
  "keyFiles": [
    {
      "path": "src/index.ts",
      "type": "entry",
      "purpose": "Main entry point for the application"
    },
    {
      "path": "src/core/bridge.ts",
      "type": "core",
      "purpose": "Bridge orchestrator that wires all components together"
    }
  ],
  "subdirectories": [
    {
      "path": "src/core",
      "purpose": "Core bridge engine (router, auth, queue, config)"
    },
    {
      "path": "src/connectors",
      "purpose": "Messaging platform adapters"
    }
  ],
  "fileCount": 8,
  "insights": [
    "Uses ESM imports throughout",
    "Core modules export both types and runtime code",
    "Follows plugin architecture pattern"
  ],
  "exploredAt": "2026-02-21T...",
  "durationMs": 1200
}
\`\`\`

**IMPORTANT:**
- Return ONLY the JSON object, no explanations
- Be specific about file purposes (not generic descriptions)
- Focus on source files and note asset directories (images, fonts, media, data files)
- Use ISO 8601 format for exploredAt
`;
}

/**
 * Pass 4: Summary Assembly
 *
 * Generates a prompt that instructs the AI to create a human-readable
 * summary of the workspace based on all partial exploration results.
 *
 * This pass assembles the final workspace-map.json by merging:
 * - structure-scan.json
 * - classification.json
 * - dirs/*.json (all directory dive results)
 *
 * The AI only needs to generate the "summary" field and any final insights.
 * All other fields are merged mechanically by the coordinator.
 *
 * Expected duration: 30-60s
 * Output: workspace-map.json (summary field only)
 *
 * @param workspacePath - Absolute path to the workspace root
 * @param partialMap - Mechanically assembled partial workspace map (missing summary)
 * @returns Prompt for summary generation
 */
/**
 * Maximum character budget for the summary data payload.
 * Template overhead is ~1.5K, so data budget = PROMPT_CHAR_BUDGET - 2K = 14K.
 * Previous value (28K) exceeded the 16K per-prompt budget on its own.
 */
const SUMMARY_DATA_BUDGET = PROMPT_CHAR_BUDGET - 2_000;

export function generateSummaryPrompt(
  workspacePath: string,
  partialMap: {
    projectType: string;
    projectName: string;
    frameworks: string[];
    structure: Record<string, { path: string; purpose: string; fileCount?: number }>;
    keyFiles: Array<{ path: string; type: string; purpose: string }>;
    commands: Record<string, string>;
  },
): string {
  const dataPayload = trimPayload(
    partialMap as unknown as Record<string, unknown>,
    SUMMARY_DATA_BUDGET,
    'keyFiles',
  );
  const promptSize = dataPayload.length + 2_000;
  if (promptSize > PROMPT_CHAR_BUDGET) {
    logger.debug(
      { promptSize, budget: PROMPT_CHAR_BUDGET },
      'Summary prompt exceeds budget after trimming',
    );
  }

  // IMPORTANT: Output format instructions come FIRST so they survive
  // any prompt truncation by the agent-runner (MAX_PROMPT_LENGTH = 32KB).
  return `# Task: Generate Workspace Summary

## Output Format (CRITICAL — read this first)

Return ONLY a JSON object with a single "summary" field:

\`\`\`json
{
  "summary": "Your 2-3 sentence summary here."
}
\`\`\`

**IMPORTANT:**
- Return ONLY the JSON object with the summary field
- Do NOT include any other text, explanation, or markdown outside the JSON
- Keep it concise (2-3 sentences maximum)
- Adapt tone based on project type (code vs business)

## Instructions

Write a **2-3 sentence summary** that describes:
1. What this workspace is (the project's main purpose)
2. Key technologies/frameworks used
3. Any notable characteristics (architecture, deployment, special features)

## Summary Style Guidelines

**Code Projects:** Technical, concise — e.g. "Node.js TypeScript project using Express and Prisma for a REST API."
**Business Workspaces:** Plain language — e.g. "Cafe business files including sales reports and inventory spreadsheets."
**Mixed:** Balanced — e.g. "E-commerce platform (Node.js + React) with product catalogs and order CSVs."

## Workspace Path

${workspacePath}

## Exploration Results

\`\`\`json
${dataPayload}
\`\`\`
`;
}

/**
 * Pass 3b: Sub-Project Dive (Monorepo)
 *
 * Generates a prompt that instructs the AI to explore a detected sub-project
 * as an independent project — performing both classification and directory
 * exploration in a single pass. This is used instead of the regular directory
 * dive prompt when the workspace is a monorepo and the directory has been
 * identified as an independent sub-project with its own manifest file.
 *
 * Expected duration: 90-120s per sub-project
 * Output: dirs/<sub-project-name>.json
 *
 * @param workspacePath - Absolute path to the workspace root
 * @param subProjectPath - Relative path to the sub-project (e.g. "packages/ui")
 * @param subProjectType - Project type inferred from manifest (e.g. "node", "go")
 * @returns Prompt for sub-project dive
 */
export function generateSubProjectDivePrompt(
  workspacePath: string,
  subProjectPath: string,
  subProjectType: string,
): string {
  return `# Task: Sub-Project Exploration — ${subProjectPath}

Explore the sub-project at **${workspacePath}/${subProjectPath}** as an **independent project** within a monorepo workspace.

## Context

This directory has been identified as an independent sub-project (type: **${subProjectType}**) based on the presence of its own project manifest file. Treat it as a self-contained project — not just a directory within a larger project.

## Instructions

1. **Read the project manifest** (package.json, Cargo.toml, go.mod, etc.) to determine:
   - The sub-project's name
   - Its dependencies and dev dependencies
   - Its build/test/dev commands
   - Its frameworks and tools
2. **Determine the purpose** of this sub-project (what does it do? what role does it play in the monorepo?)
3. **Identify key files** (entry points, configs, main modules)
4. **List subdirectories** and their purposes
5. **Count files** in this sub-project (excluding node_modules, dist, build, etc.)
6. **Extract insights** specific to this sub-project (architecture, patterns, conventions)

## What to Look For

- Entry points (index files, main modules, bin scripts)
- Configuration files (tsconfig.json, .eslintrc, jest.config, etc.)
- README or documentation
- Test files and test configuration
- Relationship to other sub-projects in the monorepo (shared dependencies, cross-references)
- Build output directories

## Output Format

Return ONLY valid JSON matching this schema:

\`\`\`json
{
  "path": "${subProjectPath}",
  "purpose": "Independent ${subProjectType} sub-project — <describe what it does>",
  "keyFiles": [
    {
      "path": "${subProjectPath}/package.json",
      "type": "config",
      "purpose": "Project manifest with dependencies and scripts"
    }
  ],
  "subdirectories": [
    {
      "path": "${subProjectPath}/src",
      "purpose": "Source code"
    }
  ],
  "fileCount": 42,
  "insights": [
    "Independent ${subProjectType} project within the monorepo",
    "Uses <frameworks/tools detected>",
    "Depends on <shared packages if any>"
  ],
  "exploredAt": "2026-02-21T...",
  "durationMs": 1200
}
\`\`\`

**IMPORTANT:**
- Return ONLY the JSON object, no explanations
- Treat this as a standalone project — classify its frameworks and purpose independently
- Note any cross-references to sibling sub-projects in the monorepo
- Use ISO 8601 format for exploredAt
`;
}

/**
 * Incremental Exploration Prompt
 *
 * Instructs the Master AI to update the existing workspace-map.json
 * based on a set of changed/added/deleted files since the last analysis.
 * The AI only reads the changed files and updates the relevant sections.
 *
 * @param workspacePath - Absolute path to the workspace root
 * @param currentMap - The existing workspace map (for context)
 * @param changedFiles - Files that were added or modified
 * @param deletedFiles - Files that were removed
 * @param changesSummary - Human-readable summary of what changed
 * @returns Prompt for incremental map update
 */
export function generateIncrementalExplorationPrompt(
  workspacePath: string,
  currentMap: WorkspaceMap,
  changedFiles: string[],
  deletedFiles: string[],
  changesSummary: string,
): string {
  // Template + instructions are ~2.5K chars. Split remaining budget between
  // file lists (~2K), change summary (~1K), and workspace map (rest).
  const templateOverhead = 3_000;
  const fileListBudget = 2_000;
  const summaryBudget = 1_000;
  const mapBudget = PROMPT_CHAR_BUDGET - templateOverhead - fileListBudget - summaryBudget;

  // Trim file lists if too many
  const maxFiles = 100;
  const trimmedChanged =
    changedFiles.length > maxFiles
      ? [...changedFiles.slice(0, maxFiles), `... and ${changedFiles.length - maxFiles} more files`]
      : changedFiles;
  const trimmedDeleted =
    deletedFiles.length > maxFiles
      ? [...deletedFiles.slice(0, maxFiles), `... and ${deletedFiles.length - maxFiles} more files`]
      : deletedFiles;

  // Trim change summary
  const trimmedSummary =
    changesSummary.length > summaryBudget
      ? changesSummary.slice(0, summaryBudget - 20) + '\n... (truncated)'
      : changesSummary;

  // Build a slim map with only the fields needed for incremental update:
  // structure, keyFiles (trimmed), frameworks, commands, summary, projectType
  const slimMap: Record<string, unknown> = {
    projectType: currentMap.projectType,
    projectName: currentMap.projectName,
    frameworks: currentMap.frameworks,
    commands: currentMap.commands,
    structure: currentMap.structure,
    keyFiles: currentMap.keyFiles,
    summary: currentMap.summary,
  };
  const mapPayload = trimPayload(slimMap, mapBudget, 'keyFiles');

  const promptSize =
    templateOverhead +
    trimmedChanged.join('\n').length +
    trimmedDeleted.join('\n').length +
    trimmedSummary.length +
    mapPayload.length;
  if (promptSize > PROMPT_CHAR_BUDGET) {
    logger.debug(
      { promptSize, budget: PROMPT_CHAR_BUDGET },
      'Incremental exploration prompt exceeds budget after trimming',
    );
  }

  return `# Task: Incremental Workspace Map Update

The workspace at **${workspacePath}** has changed since the last exploration.

## What Changed

${trimmedSummary}

### Modified/Added Files (${changedFiles.length}):
${trimmedChanged.length > 0 ? trimmedChanged.map((f) => `- ${f}`).join('\n') : '(none)'}

### Deleted Files (${deletedFiles.length}):
${trimmedDeleted.length > 0 ? trimmedDeleted.map((f) => `- ${f}`).join('\n') : '(none)'}

## Current Workspace Map

\`\`\`json
${mapPayload}
\`\`\`

## Instructions

1. **Read only the changed/added files** listed above using Read, Glob, and Grep
2. **Update the workspace map** with any new insights from the changed files:
   - If a changed file is in a directory already in \`structure\`, update its \`purpose\` or \`fileCount\` if needed
   - If a changed file introduces a new directory not in \`structure\`, add it
   - If a changed file is a new key file (config, entry point, documentation), add it to \`keyFiles\`
   - If a deleted file was in \`keyFiles\`, remove it
   - If frameworks or dependencies changed (e.g., package.json modified), update \`frameworks\` and \`dependencies\`
   - If commands changed (e.g., package.json scripts modified), update \`commands\`
   - Update \`generatedAt\` to the current timestamp
3. **Do NOT re-explore unchanged files** — trust the existing map for those
4. **Write the updated map** to \`.openbridge/workspace-map.json\` using the Write tool
5. If the changes are trivial (e.g., only whitespace, comments), you may leave the map unchanged but still write it with an updated \`generatedAt\`

## Important Constraints

- Only read files from the changed/added list — do NOT scan the entire workspace
- Do NOT modify any workspace files outside \`.openbridge/\`
- If a changed file is binary or unreadable, skip it
- Keep the existing map structure intact — only modify sections affected by the changes
- Update the \`summary\` field ONLY if the changes significantly alter the project's nature

Work silently. Write the updated map and finish.`;
}
