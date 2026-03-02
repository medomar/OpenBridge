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
 * Task: Code Audit
 *
 * Runs test suites, linters, and type checkers; reports findings with severity,
 * file, line, description, and fix suggestion.
 */
export const TASK_CODE_AUDIT: SeedPrompt = {
  id: 'task-code-audit',
  filename: 'task-code-audit.md',
  category: 'task',
  version: '1.0.0',
  description:
    'Runs tests, linter, and type checker; reports findings with severity, location, and fix suggestions',
  content: `# Task: Code Audit

Perform a code audit on the workspace at **{{workspacePath}}**.

## Step 1 — Run Verification Commands

Run each command in order and capture its output:

1. \`npm test\` — run the full test suite
2. \`npm run lint\` — check for linting errors
3. \`npm run typecheck\` — check for TypeScript type errors

If a command is not available (missing from package.json scripts), skip it and note it as "not configured".

## Step 2 — Analyse Failures

For each failing test:
1. Read the test file to understand what is being tested
2. Read the source file under test to find the root cause
3. Note the file path, line number, error message, and likely fix

For each lint error:
1. Note the rule name, file path, line number, and description
2. Determine the fix (auto-fixable, minor refactor, or design change)

For each type error:
1. Note the file path, line number, error message (e.g. TS2345)
2. Determine the fix

## Step 3 — Report Findings

Report every finding using the format below.  Use **severity levels**:
- \`critical\` — test failure or type error that breaks the build
- \`high\` — lint error that blocks CI or indicates a likely runtime bug
- \`medium\` — lint warning or non-critical type issue
- \`low\` — style issue or informational note

\`\`\`json
{
  "summary": {
    "testsPassed": 42,
    "testsFailed": 3,
    "testsSkipped": 1,
    "lintErrors": 2,
    "lintWarnings": 4,
    "typeErrors": 1,
    "commandsRun": ["npm test", "npm run lint", "npm run typecheck"],
    "commandsSkipped": []
  },
  "findings": [
    {
      "severity": "critical",
      "category": "test",
      "file": "src/core/router.ts",
      "line": 142,
      "description": "Test 'routes /history to handler' fails — handler returns undefined instead of OutboundMessage",
      "fixSuggestion": "Return a valid OutboundMessage object from the /history branch (line 142)"
    },
    {
      "severity": "high",
      "category": "lint",
      "file": "src/master/master-manager.ts",
      "line": 307,
      "description": "@typescript-eslint/no-floating-promises — promise not awaited",
      "fixSuggestion": "Add await before the call, or explicitly void it with \`void someCall()\`"
    },
    {
      "severity": "medium",
      "category": "typecheck",
      "file": "src/memory/chunk-store.ts",
      "line": 88,
      "description": "TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'",
      "fixSuggestion": "Add a null-check guard before passing the value, or widen the parameter type"
    }
  ],
  "auditedAt": "2026-02-22T12:00:00.000Z"
}
\`\`\`

## Rules

- Run commands with a reasonable timeout (5 minutes per command).
- Do NOT modify any files — this is a read-and-report audit only.
- If all commands pass with zero errors, report an empty findings array and set a clear summary.
- Report test pass/fail counts even when all tests pass.
- Return ONLY the JSON object — no extra markdown, no preamble.
`,
};

/**
 * Task: Targeted Read
 *
 * Reads specific files and answers a focused question with bullet-point findings.
 * Used by the targeted reader path when RAG confidence is low (< 0.3).
 */
export const TASK_TARGETED_READ: SeedPrompt = {
  id: 'task-targeted-read',
  filename: 'task-targeted-read.md',
  category: 'task',
  version: '1.0.0',
  description:
    'Reads specified files, extracts relevant information, and summarizes findings in 3-5 bullet points with file paths and line numbers',
  content: `# Task: Targeted File Read

Read the specified files and answer the following question.

## Files to Read

{{filePaths}}

## Question

{{question}}

## Instructions

1. Read each file listed above in full.
2. Identify the sections most relevant to the question.
3. Extract the key information that directly answers the question.
4. Summarize your findings in **3–5 bullet points**.

## Output Format

Respond with a short preamble (1 sentence) and then your bullet-point findings.

Each bullet must include:
- The **file path** and **line number(s)** where the information was found
- A concise description of what was found

Example:

Here is what I found in the specified files:

- \`src/core/router.ts:142\` — The \`/history\` command handler returns the last 20 messages from the conversation store.
- \`src/memory/conversation-store.ts:88\` — \`getRecentMessages()\` accepts a \`limit\` parameter (default 20) and returns messages ordered by timestamp descending.
- \`src/types/message.ts:34\` — \`OutboundMessage\` requires \`to\`, \`content\`, and \`messageId\` fields; \`content\` must be a non-empty string.

## Rules

- Read **only** the listed files — do not read additional files unless a listed file imports something critical.
- Do NOT modify any files — this is a read-only task.
- If a file does not exist, note it as missing and continue with the remaining files.
- If none of the files contain relevant information, say so explicitly.
- Keep your response concise — 3–5 bullets is the target.
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
  TASK_CODE_AUDIT,
  TASK_TARGETED_READ,
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
