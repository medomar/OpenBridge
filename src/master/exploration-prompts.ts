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
 */

import type { StructureScan, WorkspaceMap } from '../types/master.js';

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
  return `# Task: Project Classification

Classify the project at **${workspacePath}** based on the structure scan results below.

## Structure Scan Results

\`\`\`json
${JSON.stringify(structureScan, null, 2)}
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
- Focus on files that matter (skip boilerplate)
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
  return `# Task: Generate Workspace Summary

Create a concise, human-readable summary of this workspace based on the exploration results below.

## Workspace Path

${workspacePath}

## Exploration Results

\`\`\`json
${JSON.stringify(partialMap, null, 2)}
\`\`\`

## Instructions

Write a **2-3 sentence summary** that describes:
1. What this workspace is (the project's main purpose)
2. Key technologies/frameworks used
3. Any notable characteristics (architecture, deployment, special features)

## Summary Style Guidelines

**For Code Projects:**
- Technical, concise, developer-focused
- Example: "Node.js TypeScript project using Express and Prisma for a REST API. Configured with ESLint, Vitest, and Docker for containerized deployment."

**For Business Workspaces:**
- Plain language, non-technical
- Example: "Cafe business files including daily sales reports, supplier invoices, inventory spreadsheets, and staff schedules. Data stored primarily in Excel and CSV format."

**For Mixed Workspaces:**
- Balanced — technical for code, plain language for business data
- Example: "E-commerce platform codebase (Node.js + React) with attached business data folders containing product catalogs, customer lists, and order CSVs."

## Output Format

Return ONLY a JSON object with a single "summary" field:

\`\`\`json
{
  "summary": "Your 2-3 sentence summary here."
}
\`\`\`

**IMPORTANT:**
- Return ONLY the JSON object with the summary field
- Do NOT repeat information already in the exploration results
- Keep it concise (2-3 sentences maximum)
- Adapt tone based on project type (code vs business)
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
  return `# Task: Incremental Workspace Map Update

The workspace at **${workspacePath}** has changed since the last exploration.

## What Changed

${changesSummary}

### Modified/Added Files (${changedFiles.length}):
${changedFiles.length > 0 ? changedFiles.map((f) => `- ${f}`).join('\n') : '(none)'}

### Deleted Files (${deletedFiles.length}):
${deletedFiles.length > 0 ? deletedFiles.map((f) => `- ${f}`).join('\n') : '(none)'}

## Current Workspace Map

\`\`\`json
${JSON.stringify(currentMap, null, 2)}
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
