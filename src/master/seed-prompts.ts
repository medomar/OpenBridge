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
 * Task: Generate Output
 *
 * Generates a file output (HTML report, JSON data export, PDF, etc.) and
 * places it in .openbridge/generated/ so it can be shared via SHARE markers.
 */
export const TASK_GENERATE_OUTPUT: SeedPrompt = {
  id: 'task-generate-output',
  filename: 'task-generate-output.md',
  category: 'task',
  version: '1.0.0',
  description:
    'Generates a file output in .openbridge/generated/ and appends a SHARE marker so the Master can deliver it to the user',
  content: `# Task: Generate Output File

Generate a file based on the user request and write it to the output directory.

## User Request

{{userMessage}}

## Workspace Context

**Project:** {{projectName}}
**Type:** {{projectType}}
**Workspace path:** {{workspacePath}}

## Output Directory

Write all generated files to:
\`{{workspacePath}}/.openbridge/generated/\`

Create the directory if it does not exist.

## Format Selection

Choose the output format that best matches the user request:

| Output type | Format | File extension |
| --- | --- | --- |
| Report, dashboard, or interactive output | HTML | \`.html\` |
| Structured data export | JSON | \`.json\` |
| Tabular data | CSV | \`.csv\` |
| Document / printable report | PDF (or Markdown if PDF tooling unavailable) | \`.pdf\` / \`.md\` |
| Plain text output | Text | \`.txt\` |

If the user specifies a format, use that format exactly.

## Instructions

1. Determine the appropriate output format from the table above (or use the user-specified format).
2. Generate the content based on the user request and workspace context.
3. Write the file to \`{{workspacePath}}/.openbridge/generated/<descriptive-filename>.<ext>\`.
   - Use a short, descriptive filename (e.g., \`test-report.html\`, \`api-audit.json\`, \`summary.md\`).
   - Do NOT overwrite existing files — use a unique name if the file already exists.
4. After writing the file, append a SHARE marker at the very end of your response.

## SHARE Marker

After writing the file, end your response with one of these SHARE markers based on format:

**HTML report → GitHub Pages (public URL):**
\`\`\`
[SHARE:github-pages]{"path":"{{workspacePath}}/.openbridge/generated/<filename>.html"}[/SHARE]
\`\`\`

**PDF, DOC, or binary document → WhatsApp/Telegram attachment:**
\`\`\`
[SHARE:whatsapp]{"path":"{{workspacePath}}/.openbridge/generated/<filename>.pdf"}[/SHARE]
\`\`\`

**JSON, CSV, or data file → WhatsApp/Telegram attachment:**
\`\`\`
[SHARE:whatsapp]{"path":"{{workspacePath}}/.openbridge/generated/<filename>.json"}[/SHARE]
\`\`\`

**Large text or Markdown → WhatsApp/Telegram attachment:**
\`\`\`
[SHARE:whatsapp]{"path":"{{workspacePath}}/.openbridge/generated/<filename>.md"}[/SHARE]
\`\`\`

Replace \`<filename>\` with the actual filename you wrote.
Use the SHARE target that matches the active messaging channel (whatsapp, telegram, github-pages, or email).

## Rules

- Write only to \`.openbridge/generated/\` — do NOT modify workspace source files.
- Always include a SHARE marker at the end of your response so the Master can deliver the file.
- Keep the generated content accurate and relevant to the user request.
- If you cannot determine the correct format, default to HTML (most universally useful).
- If generating HTML, include basic styling so the report is readable in a browser.
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
 * Deep Mode: Investigate Phase
 *
 * Explores the codebase to identify relevant files, patterns, dependencies,
 * and potential issues related to the user's request.
 * All examined files are listed. Findings are numbered and categorized by type.
 */
export const DEEP_INVESTIGATE: SeedPrompt = {
  id: 'deep-investigate',
  filename: 'deep-investigate.md',
  category: 'task',
  version: '1.0.0',
  description:
    'Deep Mode investigation: explore codebase, identify relevant files, patterns, dependencies, and potential issues. List every file examined. Number and categorize all findings.',
  content: `# Deep Mode — Investigate Phase

Thoroughly explore the codebase at **{{workspacePath}}** and identify all issues, patterns, and dependencies relevant to the following request.

## User Request

{{userRequest}}

## Workspace Context

**Project:** {{projectName}}
**Type:** {{projectType}}
**Frameworks:** {{frameworks}}

**Known files and structure:**
{{structure}}

## Instructions

### Step 1 — Identify Relevant Files

Determine which files in the workspace are relevant to the request.  Consider:

- Source files that implement the feature, module, or area in question
- Test files covering that area
- Configuration files (tsconfig.json, eslint.config.js, package.json, etc.)
- Documentation files (README, CHANGELOG, architecture docs)
- Type definitions and shared interfaces
- Any file imported by or importing the affected code

Use glob patterns and grep to locate files. Read each relevant file in full.

### Step 2 — Examine Each File

For every file you read:

1. Note the **file path** and a one-line summary of its purpose.
2. Identify the **relevant sections** (functions, classes, types, configs) related to the request.
3. Note any **issues**: bugs, missing error handling, inconsistencies, deprecated patterns, missing tests.
4. Note any **dependencies**: what this file imports and what imports it.

### Step 3 — Categorize Findings

Group your findings into the following categories:

| Category | Description |
| --- | --- |
| \`bug\` | Logic errors, incorrect behaviour, crashes |
| \`missing-test\` | Untested functionality or missing test cases |
| \`type-error\` | TypeScript type inconsistencies or unsafe casts |
| \`pattern\` | Architectural patterns observed (good or concerning) |
| \`dependency\` | Import graph, circular deps, missing deps |
| \`config\` | Configuration gaps, wrong defaults, missing env vars |
| \`documentation\` | Missing, stale, or incorrect docs/comments |
| \`performance\` | Inefficient algorithms, N+1 queries, unnecessary re-renders |
| \`security\` | Input validation gaps, exposed secrets, unsafe operations |
| \`other\` | Anything that doesn't fit the categories above |

Assign each finding to exactly one category.

### Step 4 — Produce Findings List

Number every finding starting from 1. Each finding must include:

- **Number:** unique integer for reference in subsequent phases
- **Category:** one of the categories above
- **Severity:** \`critical\` | \`high\` | \`medium\` | \`low\` | \`info\`
- **File:** path relative to workspace root, with line number(s) if applicable
- **Title:** short one-line summary (≤ 80 characters)
- **Description:** detailed explanation — what the issue is, why it matters, evidence from the code
- **Suggestion:** concrete recommended next step (read-only; do NOT implement in this phase)

## Output Format

Provide your response in two sections:

### Files Examined

List every file you read, one per line:

\`\`\`
src/core/router.ts          — message routing and command handling
src/types/agent.ts          — agent and task type definitions
tests/core/router.test.ts   — router unit tests
\`\`\`

### Findings

List every finding in the following format:

---

**Finding #1** · \`bug\` · severity: \`high\`
**File:** \`src/core/router.ts:142\`
**Title:** /history handler returns undefined instead of OutboundMessage
**Description:** The \`/history\` branch at line 142 falls through without returning a value. This causes the caller to receive \`undefined\` and crash when trying to access \`.content\`.
**Suggestion:** Return a valid \`OutboundMessage\` object from the \`/history\` branch.

---

**Finding #2** · \`missing-test\` · severity: \`medium\`
**File:** \`src/core/router.ts\`
**Title:** No test coverage for /stop-all command
**Description:** The \`/stop-all\` command is implemented at line 310 but has no corresponding test in \`tests/core/router.test.ts\`.
**Suggestion:** Add a test case that calls \`/stop-all\` and asserts workers are terminated.

---

Continue this pattern for all findings, incrementing the number each time.

## Rules

- **Read only — do NOT modify any files.**
- List every file you examined, even if it contained no findings.
- If a file path does not exist, note it as missing and continue.
- Do not summarise or skip findings — completeness is more important than brevity.
- Reference specific line numbers wherever possible.
- End your response with the Findings section so the report phase can process it.
`,
};

/**
 * Deep Mode: Report Phase
 *
 * Takes the raw findings list from the Investigate phase and organizes
 * them into a structured, human-readable report suitable for planning.
 * Sections: Executive Summary, Detailed Findings (numbered, with severity),
 * Files Affected, Dependencies, Recommendations.
 */
export const DEEP_REPORT: SeedPrompt = {
  id: 'deep-report',
  filename: 'deep-report.md',
  category: 'task',
  version: '1.0.0',
  description:
    'Deep Mode reporting: organize investigation findings into Executive Summary, Detailed Findings (numbered with severity), Files Affected, Dependencies, and Recommendations.',
  content: `# Deep Mode — Report Phase

Organize the investigation findings below into a structured report that can be used for planning.

## Original Request

{{userRequest}}

## Investigation Findings

{{investigationFindings}}

## Instructions

Read the investigation findings carefully, then produce a structured report in the following format.

### Section 1 — Executive Summary

Write 3–5 sentences that answer:

1. **What area of the codebase is affected?** (which modules, files, features)
2. **What is the overall health?** (stable, concerning, critical)
3. **What are the top 2–3 most important issues?** (brief, high-level)
4. **What is the recommended next step?** (high-level action)

### Section 2 — Detailed Findings

For each finding from the investigation, produce a numbered entry.

Use the original numbering from the investigation where possible. If the investigation contains duplicate or overlapping findings, merge them and note the merge.

Each entry must include:

| Field | Description |
| --- | --- |
| **Finding #N** | Unique number (carry over from investigation) |
| **Category** | One of: \`bug\`, \`missing-test\`, \`type-error\`, \`pattern\`, \`dependency\`, \`config\`, \`documentation\`, \`performance\`, \`security\`, \`other\` |
| **Severity** | \`critical\` | \`high\` | \`medium\` | \`low\` | \`info\` |
| **Title** | One-line summary (≤ 80 characters) |
| **Description** | 2–4 sentences: what the issue is, why it matters, evidence |
| **Files** | File path(s) with line numbers if applicable |
| **Recommendation** | Concrete action to resolve the finding |

Sort findings within each severity level: critical → high → medium → low → info.

### Section 3 — Files Affected

List every file mentioned in the investigation findings.

For each file, note:
- Whether it has findings against it (and how many)
- A one-line description of the file's purpose
- Whether it needs to be modified to resolve findings

Format:

\`\`\`
src/core/router.ts          — message routing (3 findings — needs modification)
src/types/agent.ts          — agent type definitions (1 finding — needs modification)
tests/core/router.test.ts   — router unit tests (2 findings — needs modification)
src/core/bridge.ts          — main orchestrator (0 findings — referenced only)
\`\`\`

### Section 4 — Dependencies

Describe the dependency relationships between findings.

Identify:
1. **Blocking relationships** — findings that must be resolved before others can be addressed
2. **Parallel groups** — findings that can be resolved independently and simultaneously
3. **Cascade risks** — findings where fixing one may affect others

Format as a short list:

- Finding #1 blocks Finding #3 (same function — fixing #1 changes the function signature that #3 depends on)
- Findings #2, #4, #6 are independent and can be worked in parallel
- Fixing Finding #5 may require re-testing Findings #7 and #8

If there are no dependency relationships, state: "All findings are independent."

### Section 5 — Recommendations

Provide a prioritized list of recommended actions. Order from highest to lowest priority.

Each recommendation must include:
- **Priority** (1 = highest)
- **Action** — what to do (concise imperative sentence)
- **Rationale** — why this should be done first
- **Findings addressed** — which finding numbers this action resolves
- **Estimated complexity** — \`trivial\` (< 30 min) | \`small\` (< 2 h) | \`medium\` (< 1 day) | \`large\` (> 1 day)

Example:

1. **Fix /history handler undefined return** · Findings #1 · complexity: trivial
   Return a valid \`OutboundMessage\` from the \`/history\` branch. This is a crash-path fix that unblocks manual testing.

2. **Add tests for /stop-all command** · Findings #2, #4 · complexity: small
   Add 2 test cases to \`tests/core/router.test.ts\`. Unblocks CI for the router module.

## Output Format

Write your report in **Markdown** using the section headings above. Do NOT output JSON.

Your report should be complete and self-contained — a developer reading it should be able to understand all issues without referring back to the raw investigation output.

## Rules

- **Read only — do NOT modify any files.**
- Preserve all finding numbers from the investigation — do not renumber unless merging duplicates.
- If the investigation findings are empty or minimal, note that in the Executive Summary and produce a minimal report.
- Severity levels must match those in the investigation — do not upgrade or downgrade without justification.
- Keep the Executive Summary concise — 3–5 sentences, no bullet points.
- The Recommendations section is the most important section for the planning phase — make it actionable.
`,
};

/**
 * Codex-specific worker system prompt prefix.
 *
 * Prepended to all Codex worker prompts to guide file access behavior.
 * Codex workers waste turns on inline bash/Python gymnastics instead of using
 * direct file-reading commands — this prefix steers them toward simple, direct
 * file operations (OB-F91).
 */
export const CODEX_WORKER_PREFIX =
  'Use file reading commands to read files. Do NOT use complex bash/shell scripts for file operations. Use simple, direct commands.\n\n---\n\n';

/**
 * Returns a tool-specific system prompt prefix to prepend to a worker prompt.
 * Returns an empty string for tools that don't need a prefix (e.g., Claude).
 *
 * @param toolName - The name of the AI tool being used (e.g., "codex", "claude")
 */
export function applyToolPromptPrefix(prompt: string, toolName: string): string {
  if (toolName.toLowerCase().includes('codex')) {
    return CODEX_WORKER_PREFIX + prompt;
  }
  return prompt;
}

/**
 * All seed prompts in order
 */
export const SEED_PROMPTS: SeedPrompt[] = [
  EXPLORATION_STRUCTURE_SCAN,
  EXPLORATION_CLASSIFICATION,
  TASK_EXECUTE,
  TASK_VERIFY,
  TASK_CODE_AUDIT,
  TASK_GENERATE_OUTPUT,
  TASK_TARGETED_READ,
  DEEP_INVESTIGATE,
  DEEP_REPORT,
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
