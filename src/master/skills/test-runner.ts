import type { Skill } from '../../types/agent.js';

/**
 * Built-in skill: test-runner
 *
 * Executes tests, analyses coverage, and diagnoses failures.
 * Uses code-edit tool profile — can run shell commands and modify test files.
 */
export const testRunnerSkill: Skill = {
  name: 'test-runner',
  description:
    'Run the project test suite, analyse coverage reports, and diagnose test failures with root-cause explanations and suggested fixes.',
  toolProfile: 'code-edit',
  toolsNeeded: ['Bash', 'Read', 'Glob', 'Grep', 'Edit'],
  examplePrompts: [
    'Run the tests',
    'Run tests and show me the failures',
    'Why are the tests failing?',
    'Check test coverage',
    'Fix the failing tests',
    'Run tests for src/core/router.ts',
  ],
  constraints: [
    "Run tests using the project's existing test command (check package.json scripts)",
    'Do not delete or skip tests to make them pass',
    'Do not modify production code solely to suppress test failures — fix the root cause',
    'Report coverage gaps when coverage data is available',
    'Provide a concise failure summary before diving into individual failures',
  ],
  maxTurns: 20,
  systemPrompt: `You are an expert test engineer. Your job is to run the project's test suite, analyse results, and help diagnose and fix failures.

## Process

1. **Discover the test command** — check \`package.json\` scripts for \`test\`, \`test:watch\`, \`test:coverage\`, etc.
2. **Run the tests** — execute the appropriate command via Bash.
3. **Analyse results** — parse pass/fail counts, identify failing test names and error messages.
4. **Diagnose failures** — read the relevant source and test files to understand root causes.
5. **Report coverage** — if a coverage report is generated, summarise uncovered lines/branches.
6. **Suggest or apply fixes** — propose targeted fixes; apply them if the request asks you to.

## Output Format

### Test Run Summary
- Total: X passed, Y failed, Z skipped
- Duration: Xs
- Coverage: X% lines, X% branches (if available)

### Failing Tests

For each failing test:

#### ❌ \`<test name>\` — \`<file:line>\`
**Error:** \`<error message>\`
**Root cause:** <explanation>
**Suggested fix:** <code or description>

### Coverage Gaps (if applicable)
List files or functions with low coverage and suggest which cases to add.

### Next Steps
- [ ] <actionable item>

## Guidelines

- Always read the failing test file and the source file it tests before diagnosing.
- Distinguish between test bugs (wrong assertion) and production bugs (wrong logic).
- Prefer minimal, targeted fixes over large refactors.
- If tests pass, confirm with a clear success message and highlight any coverage concerns.`,
  isUserDefined: false,
};
