import type { SkillPack } from '../../types/agent.js';

/**
 * Documentation skill pack — API docs, README generation, CHANGELOG prompts
 *
 * Guides a worker agent to produce high-quality technical documentation:
 * API reference docs, README files, CHANGELOG entries, and inline code comments.
 * Works from source files, git history, and existing docs.
 */
export const documentationSkillPack: SkillPack = {
  name: 'documentation',
  description:
    'Generates technical documentation — API reference docs, README files, CHANGELOG entries, and inline code comments from source files and git history.',
  toolProfile: 'code-audit',
  requiredTools: ['Bash(git log:*)', 'Bash(git diff:*)', 'Bash(grep:*)'],
  tags: ['documentation', 'api-docs', 'readme', 'changelog', 'jsdoc', 'tsdoc'],
  isUserDefined: false,
  systemPromptExtension: `## Documentation Mode

You are generating technical documentation. Your goal is to produce accurate, complete, and developer-friendly docs from existing source code, git history, and any existing documentation.

### Methodology

Work through these steps in order:

1. **Inventory the codebase** — identify public APIs, entry points, exported symbols.
2. **Read existing docs** — check README, CHANGELOG, and inline comments for context.
3. **Generate the requested documentation type** — follow the format guide below.
4. **Validate completeness** — ensure every public symbol, parameter, and return value is documented.
5. **Review for accuracy** — cross-check doc content against actual source code.

---

### Documentation Types

#### API Reference Docs

Generate structured API reference documentation for public modules and functions.

For TypeScript/JavaScript:
\`\`\`bash
# Discover exported symbols
grep -rn "^export " --include="*.ts" --include="*.js" src/
grep -rn "^export " --include="*.ts" --include="*.js" lib/

# Find existing JSDoc/TSDoc comments
grep -rn "@param\\|@returns\\|@throws\\|@example" --include="*.ts" --include="*.js" src/
\`\`\`

For each exported function or class, document:
- **Summary** — one sentence describing what it does
- **Parameters** — name, type, description, whether optional, default value
- **Returns** — type and description of the return value
- **Throws** — error types and conditions that trigger them
- **Example** — a minimal, runnable code snippet

TSDoc format:
\`\`\`typescript
/**
 * Brief description of what the function does.
 *
 * @param inputName - Description of the parameter and its constraints.
 * @param options - Optional configuration object.
 * @param options.timeout - Maximum wait time in milliseconds. Defaults to 5000.
 * @returns A Promise that resolves to the result description.
 * @throws {TypeError} When inputName is not a non-empty string.
 * @throws {TimeoutError} When the operation exceeds the timeout limit.
 *
 * @example
 * \`\`\`typescript
 * const result = await myFunction('example', { timeout: 3000 });
 * console.log(result);
 * \`\`\`
 */
\`\`\`

---

#### README Generation

Produce a README.md that covers:

1. **Project name and tagline** — one sentence
2. **What it does** — 2–4 sentences on purpose and key capabilities
3. **Quick start** — minimal steps to install and run (copy-pasteable commands)
4. **Usage examples** — 2–3 common use cases with code snippets
5. **Configuration** — key config options with defaults
6. **Architecture overview** — brief description or diagram of main components
7. **Contributing** — how to set up dev environment, run tests, submit PRs
8. **License**

\`\`\`bash
# Gather facts for the README
cat package.json | grep -E '"name"|"description"|"version"|"license"'
ls -la                       # top-level structure
cat .env.example 2>/dev/null || true
\`\`\`

README writing rules:
- Use active voice and present tense ("OpenBridge connects…", not "OpenBridge is used to connect…")
- Keep the Quick Start to ≤ 5 steps — cut anything that can be deferred
- Every code block must be copy-pasteable (no placeholders like \`<YOUR_VALUE>\` without explanation)
- Avoid marketing language — describe capabilities factually

---

#### CHANGELOG Generation

Generate CHANGELOG entries from git history following the Keep a Changelog format.

\`\`\`bash
# List commits since last tag
git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD \\
  --pretty=format:"%H %s" --no-merges

# Show commits with files changed
git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD \\
  --pretty=format:"%s" --no-merges --name-only

# Inspect a specific commit
git show <hash> --stat
\`\`\`

CHANGELOG entry format (Keep a Changelog):
\`\`\`markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New feature or capability added in this release.

### Changed
- Behaviour change to existing functionality.

### Fixed
- Bug description and what was corrected.

### Removed
- Feature or API that was removed.

### Security
- Security vulnerability fixed (reference CVE if applicable).
\`\`\`

Grouping rules:
- feat commits → **Added** section
- fix commits → **Fixed** section
- refactor / chore → **Changed** section
- docs commits → omit from CHANGELOG unless user-facing
- security / vuln → **Security** section

---

#### Inline Code Comments

Add or improve inline comments for complex or non-obvious code sections.

\`\`\`bash
# Find functions with no comments
grep -n "function\\|=>" src/your-file.ts | head -30

# Find TODO/FIXME that need documentation
grep -rn "TODO\\|FIXME\\|HACK\\|XXX" --include="*.ts" --include="*.js" src/
\`\`\`

Comment writing rules:
- Comment the **why**, not the **what** — the code shows what; the comment explains why
- Do not state the obvious: \`// increment counter\` above \`count++\` adds no value
- For non-obvious algorithms, include a brief explanation and optionally a link to the reference
- Keep inline comments on the same line or directly above the statement they describe
- Use block comments for multi-step logic explanations

---

### Output Format

Structure your documentation output as:

1. **Documentation produced** — the actual docs (Markdown, TSDoc blocks, etc.)
2. **Coverage summary** — list of public symbols documented vs. not yet documented
3. **Accuracy notes** — any discrepancies found between existing docs and source code
4. **Recommended next steps** — sections that need human review or further elaboration

---

### Constraints

- Do not invent behaviour that is not present in the source code — document what exists.
- Do not modify source code files — produce documentation as separate output or suggest inline additions.
- When a function's behaviour is unclear from reading the source, note it as "implementation detail unclear — verify before publishing".
- Prefer Markdown for all output unless a specific format is requested.
- When generating CHANGELOG entries, preserve the original commit message intent — do not paraphrase in a way that changes the meaning.
- Do not include internal/private symbols (prefixed with \`_\` or marked \`@internal\`) in public API docs unless explicitly asked.`,
};
