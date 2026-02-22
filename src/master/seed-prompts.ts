/**
 * Seed Prompts — Initial Prompt Library Templates
 *
 * This module contains the initial prompt templates that are seeded into
 * .openbridge/prompts/ when the Master AI first initializes.
 *
 * Each prompt template is:
 * - Designed for a specific task type (exploration, execution, verification)
 * - Optimized for JSON output that matches our Zod schemas
 * - Tracked for effectiveness (success rate) in the prompt manifest
 * - Editable by the Master AI for self-improvement
 */

import type { PromptTemplate } from '../types/master.js';

/**
 * Seed prompt metadata (used for manifest initialization)
 */
interface SeedPrompt {
  id: string;
  filename: string;
  content: string;
  description: string;
  category: 'exploration' | 'task' | 'verification' | 'other';
  version: string;
}

/**
 * Exploration: Structure Scan
 *
 * Generates a prompt for scanning workspace structure.
 * Expected output: structure-scan.json matching StructureScanSchema
 */
export const EXPLORATION_STRUCTURE_SCAN: SeedPrompt = {
  id: 'exploration-structure-scan',
  filename: 'exploration-structure-scan.md',
  category: 'exploration',
  version: '1.0.0',
  description: 'Scans workspace structure and returns top-level files/dirs with file counts',
  content: `# Task: Workspace Structure Scan

Scan the workspace at **{{workspacePath}}** and return a JSON object with its structure.

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
  "workspacePath": "{{workspacePath}}",
  "topLevelFiles": ["README.md", "package.json"],
  "topLevelDirs": ["src", "tests", "docs"],
  "directoryCounts": {
    "src": 42,
    "tests": 18,
    "docs": 5
  },
  "configFiles": ["package.json", "tsconfig.json"],
  "skippedDirs": ["node_modules", ".git", "dist"],
  "totalFiles": 65,
  "scannedAt": "2026-02-22T...",
  "durationMs": 1200
}
\`\`\`

**IMPORTANT:**
- Return ONLY the JSON object, no explanations or markdown
- Use ISO 8601 format for scannedAt
- durationMs should reflect actual scan time in milliseconds
- Do NOT read file contents in this phase (just list and count)
`,
};

/**
 * Exploration: Project Classification
 *
 * Classifies the project type and detects frameworks/tools.
 * Expected output: classification.json matching ClassificationSchema
 */
export const EXPLORATION_CLASSIFICATION: SeedPrompt = {
  id: 'exploration-classification',
  filename: 'exploration-classification.md',
  category: 'exploration',
  version: '1.0.0',
  description: 'Classifies project type and detects frameworks, commands, dependencies',
  content: `# Task: Project Classification

Classify the project at **{{workspacePath}}** based on the structure scan results.

## Structure Scan Results

\`\`\`json
{{structureScan}}
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
  "classifiedAt": "2026-02-22T...",
  "durationMs": 1500
}
\`\`\`

**IMPORTANT:**
- Return ONLY the JSON object, no explanations
- Read actual config file contents, don't guess
- Be accurate — if you can't determine something, omit it
- Use ISO 8601 format for classifiedAt
`,
};

/**
 * Task: Execute User Request
 *
 * General purpose prompt for executing user tasks.
 */
export const TASK_EXECUTE: SeedPrompt = {
  id: 'task-execute',
  filename: 'task-execute.md',
  category: 'task',
  version: '1.0.0',
  description: 'Executes a user-requested task with workspace context',
  content: `# Task: Execute User Request

Execute the following user request in the context of the workspace.

## User Request

{{userMessage}}

## Workspace Context

**Project:** {{projectName}}
**Type:** {{projectType}}
**Frameworks:** {{frameworks}}

**Available Commands:**
{{commands}}

**Project Structure:**
{{structure}}

## Instructions

1. Understand what the user is asking for
2. Use the workspace context to inform your approach
3. If the task requires code changes, make them
4. If the task requires running commands, execute them
5. Provide a clear, concise response about what you did

## Available Tools

You have access to the following tools:
{{allowedTools}}

## Response Format

Provide your response in natural language. If you completed the task, explain what you did. If you encountered issues, explain what went wrong and what the user should do.

**Do NOT output JSON unless the user explicitly requested it.**
`,
};

/**
 * Task: Verify Implementation
 *
 * Verifies that a completed task meets requirements.
 */
export const TASK_VERIFY: SeedPrompt = {
  id: 'task-verify',
  filename: 'task-verify.md',
  category: 'verification',
  version: '1.0.0',
  description: 'Verifies that a task implementation meets requirements',
  content: `# Task: Verify Implementation

Verify that the following task was completed successfully.

## Original Task

{{taskDescription}}

## Implementation Notes

{{implementationNotes}}

## Verification Steps

1. Check that all requirements from the original task are met
2. Run tests if applicable (npm test, pytest, cargo test, etc.)
3. Check for errors or warnings
4. Verify that the implementation follows project conventions
5. Confirm that the changes don't break existing functionality

## Output Format

Return a JSON object with verification results:

\`\`\`json
{
  "verified": true,
  "requirementsMet": true,
  "testsPassed": true,
  "errors": [],
  "warnings": ["Minor: unused import in file.ts"],
  "notes": "Implementation looks good. All tests pass.",
  "verifiedAt": "2026-02-22T..."
}
\`\`\`

**IMPORTANT:**
- Return ONLY the JSON object
- Set verified=true only if ALL checks pass
- List any errors or warnings found
- Use ISO 8601 format for verifiedAt
`,
};

/**
 * All seed prompts in order
 */
export const SEED_PROMPTS: SeedPrompt[] = [
  EXPLORATION_STRUCTURE_SCAN,
  EXPLORATION_CLASSIFICATION,
  TASK_EXECUTE,
  TASK_VERIFY,
];

/**
 * Initialize the prompt library by seeding all templates.
 * Creates .openbridge/prompts/ directory and writes all seed prompts.
 */
export async function seedPromptLibrary(dotFolderManager: {
  writePromptTemplate: (
    filename: string,
    content: string,
    metadata: Omit<PromptTemplate, 'filePath' | 'createdAt' | 'updatedAt' | 'lastUsedAt'>,
  ) => Promise<void>;
}): Promise<void> {
  for (const prompt of SEED_PROMPTS) {
    await dotFolderManager.writePromptTemplate(prompt.filename, prompt.content, {
      id: prompt.id,
      description: prompt.description,
      category: prompt.category,
      version: prompt.version,
      usageCount: 0,
      successCount: 0,
      successRate: 0,
    });
  }
}
