/**
 * Observation Extractor
 *
 * Parses raw worker text output into structured Observation objects.
 * Uses regex patterns and heuristics to extract:
 *  - title:          first meaningful summary line from the output
 *  - narrative:      cleaned summary of what happened
 *  - facts:          discrete facts from bullet points / numbered lists
 *  - concepts:       domain keywords and identifiers referenced
 *  - files_read:     file paths detected in read context
 *  - files_modified: file paths detected in edit/write/create context
 *  - type:           auto-classified from task profile + output content
 */

import type { Observation } from '../memory/observation-store.js';
import type { ObservationType } from '../types/agent.js';

// ---------------------------------------------------------------------------
// Public Input Type
// ---------------------------------------------------------------------------

export interface ExtractionInput {
  /** Raw text output from the worker agent */
  output: string;
  /** Session ID to attach to the produced observation */
  sessionId: string;
  /** Worker ID to attach to the produced observation */
  workerId: string;
  /** Tool profile the worker ran with (e.g. 'read-only', 'code-edit') */
  profile?: string;
  /** Original task prompt sent to the worker (used for type classification) */
  prompt?: string;
}

// ---------------------------------------------------------------------------
// Title Extraction
// ---------------------------------------------------------------------------

/**
 * Extract a one-line title from worker output.
 * Strategy (in order of preference):
 *  1. A line that starts with a common summary verb (e.g., "Fixed …", "Updated …")
 *  2. A markdown heading line (## or #)
 *  3. The first non-empty, non-boilerplate line
 *  4. Fallback: truncated first 80 chars of output
 */
function extractTitle(output: string): string {
  const lines = output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // 1. Summary-verb lines
  const summaryVerbs =
    /^(fixed|updated|added|removed|created|modified|refactored|implemented|resolved|found|wrote|completed|changed|extracted|migrated|improved|optimised|optimized|analyzed|analysed)\b/i;
  for (const line of lines) {
    if (summaryVerbs.test(line) && line.length <= 120) {
      return line.replace(/[.!]+$/, '');
    }
  }

  // 2. Markdown headings
  for (const line of lines) {
    const m = line.match(/^#{1,3}\s+(.+)/);
    if (m && m[1] && m[1].length <= 120) {
      return m[1].trim();
    }
  }

  // 3. First non-empty line that isn't a code fence or separator
  for (const line of lines) {
    if (line.startsWith('```') || line.startsWith('---') || line.startsWith('===')) continue;
    if (line.length >= 10 && line.length <= 120) {
      return line.replace(/[.!]+$/, '');
    }
  }

  // 4. Fallback
  return output.slice(0, 80).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Facts Extraction
// ---------------------------------------------------------------------------

/**
 * Extract discrete facts from bullet points, numbered lists, and notable statements.
 * Returns up to 20 fact strings.
 */
function extractFacts(output: string): string[] {
  const facts = new Set<string>();

  for (const line of output.split('\n')) {
    const trimmed = line.trim();

    // Bullet points: - item, * item, • item
    const bulletMatch = trimmed.match(/^[-*•]\s+(.{10,200})/);
    if (bulletMatch && bulletMatch[1]) {
      facts.add(bulletMatch[1].trim());
      continue;
    }

    // Numbered lists: 1. item, 2. item
    const numberedMatch = trimmed.match(/^\d+[.)]\s+(.{10,200})/);
    if (numberedMatch && numberedMatch[1]) {
      facts.add(numberedMatch[1].trim());
      continue;
    }

    // Notable fact keywords on their own line
    if (/^(note:|warning:|error:|result:|summary:|conclusion:|finding:)/i.test(trimmed)) {
      const factText = trimmed.replace(/^[^:]+:\s*/i, '');
      if (factText.length >= 10) facts.add(factText.trim());
    }
  }

  return Array.from(facts).slice(0, 20);
}

// ---------------------------------------------------------------------------
// Concepts Extraction
// ---------------------------------------------------------------------------

/**
 * Extract domain concepts / keywords from worker output.
 * Scans for:
 *  - CamelCase identifiers (function/class names)
 *  - Package names (e.g., `better-sqlite3`, `express`)
 *  - Error names (e.g., `TypeError`, `SqliteError`)
 *  - Quoted technical terms
 */
function extractConcepts(output: string): string[] {
  const concepts = new Set<string>();

  // CamelCase identifiers (at least 2 words joined, ≥6 chars)
  const camelRe = /\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g;
  for (const m of output.matchAll(camelRe)) {
    if (m[1] && m[1].length >= 6 && m[1].length <= 50) concepts.add(m[1]);
  }

  // Error class names: XxxError, XxxException
  const errorRe = /\b([A-Z][A-Za-z]+(?:Error|Exception|Fault|Warning))\b/g;
  for (const m of output.matchAll(errorRe)) {
    if (m[1]) concepts.add(m[1]);
  }

  // npm-style package names in backticks or quotes: `better-sqlite3`
  const packageRe = /[`'"]([a-z][\w-]{2,40})[`'"]/g;
  for (const m of output.matchAll(packageRe)) {
    if (m[1] && /[-]/.test(m[1])) concepts.add(m[1]);
  }

  // Function call patterns: functionName()
  const funcRe = /\b([a-z][A-Za-z0-9]{3,30})\(\)/g;
  for (const m of output.matchAll(funcRe)) {
    if (m[1]) concepts.add(`${m[1]}()`);
  }

  return Array.from(concepts).slice(0, 30);
}

// ---------------------------------------------------------------------------
// File Path Extraction — files_read (OB-1626)
// ---------------------------------------------------------------------------

/**
 * FILE PATH REGEX — matches common relative and absolute path formats:
 *  - src/foo/bar.ts
 *  - ./relative/path.js
 *  - ../parent/path.ts
 *  - /absolute/path/file.ext
 * Minimum: 2 segments or leading dot-slash, must end with a recognisable extension.
 */
const FILE_PATH_RE =
  /(?:^|[\s(["'`])((\.{1,2}\/[\w./-]+|src\/[\w./-]+|tests?\/[\w./-]+|lib\/[\w./-]+|dist\/[\w./-]+|\/[\w./-]{6,}))(?=[\s)"'`]|$)/gm;

const READABLE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'yaml',
  'yml',
  'toml',
  'env',
  'md',
  'txt',
  'html',
  'css',
  'scss',
  'sql',
  'sh',
  'bash',
  'py',
  'rb',
  'go',
  'rs',
  'java',
]);

function hasKnownExtension(p: string): boolean {
  const dot = p.lastIndexOf('.');
  if (dot === -1) return false;
  return READABLE_EXTENSIONS.has(p.slice(dot + 1).toLowerCase());
}

/** Lines that indicate a file was READ (not written) */
const READ_CONTEXT_RE =
  /\b(read|reading|opened?|viewing?|scanned?|checked?|inspected?|loaded?|parsed?|examined?|found in|referenced? in|imported? from|looking at)\b/i;

/**
 * Extract file paths that appear in a read context.
 *
 * Strategy:
 *  1. Lines with explicit read-context keywords (opened, scanned, imported…) → high confidence
 *  2. Neutral lines — file path present but no write-context keyword → treated as read
 *  3. Tool output patterns ("Reading src/…", "Read file: …") → explicit tool signal
 *
 * Lines that match WRITE_CONTEXT_RE are skipped here; those paths belong to
 * extractFilesModified().
 */
export function extractFilesRead(output: string): string[] {
  const paths = new Set<string>();

  for (const line of output.split('\n')) {
    const allPaths = matchFilePaths(line);
    if (allPaths.length === 0) continue;

    // Explicit read context: high confidence
    if (READ_CONTEXT_RE.test(line)) {
      for (const p of allPaths) paths.add(p);
      continue;
    }

    // Neutral lines (no write indicator): file is referenced, treat as read
    if (!WRITE_CONTEXT_RE.test(line)) {
      for (const p of allPaths) paths.add(p);
    }
  }

  // Explicit tool output patterns: "Reading src/…" / "Read file: src/…"
  const readToolRe = /\bread(?:ing)?\s+(?:file\s+)?([./][\w./-]+\.\w+)/gi;
  for (const m of output.matchAll(readToolRe)) {
    if (m[1] && hasKnownExtension(m[1])) paths.add(m[1]);
  }

  return Array.from(paths).slice(0, 50);
}

// ---------------------------------------------------------------------------
// File Path Extraction — files_modified (OB-1627)
// ---------------------------------------------------------------------------

/**
 * Lines that indicate a file was WRITTEN / MODIFIED / CREATED.
 * Covers base, past, progressive, and third-person forms so that
 * "edit", "write", "create", "update", "delete", "remove" (and variants)
 * are all matched regardless of tense.
 */
const WRITE_CONTEXT_RE =
  /\b(edit(?:s?|ed|ing)?|writ(?:e[s]?|ten|ing)|wrote?|creat(?:e[s]?|ed|ing)|modif(?:y|ie[sd]|ying)|updat(?:e[s]?|ed|ing)|delet(?:e[s]?|ed|ing)|remov(?:e[s]?|ed|ing)|overwr(?:ote|itten|iting))\b/i;

/**
 * Claude Code / SDK tool invocation patterns that indicate file modification.
 * Matches: Edit(...), Write(...), NotebookEdit(...), MultiEdit(...)
 */
const TOOL_WRITE_RE =
  /(?:Edit|Write|NotebookEdit|MultiEdit)\s*\(\s*["'`]?([./]?[\w./-]+\.\w+)["'`]?/g;

/**
 * Explicit executor output lines — highest confidence signal.
 * Matches patterns emitted by Claude Code and shell tool wrappers, e.g.:
 *   "Written to src/foo/bar.ts"
 *   "Wrote to src/foo/bar.ts"
 *   "Created file src/foo/bar.ts"
 *   "Saved to src/foo/bar.ts"
 *   "Overwrote src/foo/bar.ts"
 *   "Edit applied to src/foo/bar.ts"
 */
const TOOL_WRITE_OUTPUT_RE =
  /(?:written\s+to|wrote\s+to|created\s+file|saved\s+to|overwrote?|edit\s+applied\s+to)\s*:?\s+([./]?[\w./-]+\.\w+)/gi;

/**
 * Extract file paths that appear in a write/edit/create context.
 *
 * Strategy (in order of confidence):
 *  1. Tool invocation patterns: Edit(...), Write(...), NotebookEdit(...), MultiEdit(...)
 *  2. Explicit executor output lines: "Written to src/...", "Saved to src/...", etc.
 *  3. Lines containing write-context keywords + a recognisable file path
 */
export function extractFilesModified(output: string): string[] {
  const paths = new Set<string>();

  // 1. Tool invocation patterns (most reliable)
  for (const m of output.matchAll(TOOL_WRITE_RE)) {
    if (m[1] && hasKnownExtension(m[1])) paths.add(m[1]);
  }

  // 2. Explicit executor output lines (also very reliable)
  for (const m of output.matchAll(TOOL_WRITE_OUTPUT_RE)) {
    if (m[1] && hasKnownExtension(m[1])) paths.add(m[1]);
  }

  // 3. Lines with write-context keywords + file path
  for (const line of output.split('\n')) {
    const allPaths = matchFilePaths(line);
    if (allPaths.length === 0) continue;

    if (WRITE_CONTEXT_RE.test(line)) {
      for (const p of allPaths) paths.add(p);
    }
  }

  return Array.from(paths).slice(0, 50);
}

/** Shared helper: extract all file-path tokens from a single line */
function matchFilePaths(line: string): string[] {
  const found: string[] = [];
  FILE_PATH_RE.lastIndex = 0;
  for (const m of line.matchAll(FILE_PATH_RE)) {
    const p = m[1];
    if (p && hasKnownExtension(p)) found.push(p);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Type Classification (OB-1628)
// ---------------------------------------------------------------------------

/** Keyword → observation type mapping (first match wins) */
const TYPE_KEYWORDS: Array<{ re: RegExp; type: ObservationType }> = [
  { re: /\b(fix(?:ed|ing)?|bug|bugfix|regression|defect|patch|hotfix|repair)\b/i, type: 'bugfix' },
  {
    re: /\b(test(?:s|ing|ed)?|spec|assert(?:ion)?|coverage|pass(?:ed)?|fail(?:ed)?|vitest|jest|mocha)\b/i,
    type: 'test-result',
  },
  {
    re: /\b(refactor(?:ing|ed)?|rename(?:d)?|reorgani[sz]e|extract(?:ed)?|clean(?:up|ed)?)\b/i,
    type: 'refactor',
  },
  {
    re: /\b(architect(?:ure|ural)?|design(?:\s+pattern)?|schema|structure|layout|module)\b/i,
    type: 'architecture',
  },
  {
    re: /\b(depend(?:ency|encies|s)|package|npm|yarn|pnpm|install(?:ed|ing)?|upgrade)\b/i,
    type: 'dependency',
  },
  {
    re: /\b(config(?:uration|ured|uring)?|settings?|env(?:ironment)?|\.env|tsconfig|eslint)\b/i,
    type: 'config',
  },
  {
    re: /\b(doc(?:ument(?:ation|ed|ing)?|s)?|readme|comment(?:s|ed)?|jsdoc|changelog)\b/i,
    type: 'documentation',
  },
  {
    re: /\b(perf(?:ormance)?|optimi[sz]e(?:d|ation)?|speed|latency|throughput|memory\s+usage|cache)\b/i,
    type: 'performance',
  },
  {
    re: /\b(security|auth(?:entication|orization)?|vuln(?:erability)?|cve|inject(?:ion)?|xss|csrf|sanitize)\b/i,
    type: 'security',
  },
];

/** Profile → default observation type when content signals are absent */
const PROFILE_DEFAULT_TYPE: Record<string, ObservationType> = {
  'read-only': 'investigation',
  'code-audit': 'test-result',
  'code-edit': 'refactor',
  master: 'architecture',
  'full-access': 'investigation',
};

/**
 * Classify observation type from:
 *  1. Output content keywords (first matching rule wins)
 *  2. Task prompt keywords (same rules)
 *  3. Worker tool profile default
 *  4. Hard fallback: 'investigation'
 */
export function classifyObservationType(
  output: string,
  prompt: string | undefined,
  profile: string | undefined,
): ObservationType {
  const combined = `${prompt ?? ''} ${output}`;

  for (const { re, type } of TYPE_KEYWORDS) {
    if (re.test(combined)) return type;
  }

  if (profile && profile in PROFILE_DEFAULT_TYPE) {
    return PROFILE_DEFAULT_TYPE[profile]!;
  }

  return 'investigation';
}

// ---------------------------------------------------------------------------
// Narrative Builder
// ---------------------------------------------------------------------------

/**
 * Build a short narrative (≤500 chars) from worker output.
 * Prefers the first substantial paragraph; falls back to truncated output.
 */
function buildNarrative(output: string): string {
  const paragraphs = output
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 20);

  if (paragraphs.length > 0 && paragraphs[0]) {
    return paragraphs[0].slice(0, 500);
  }

  return output.replace(/\s+/g, ' ').trim().slice(0, 500);
}

// ---------------------------------------------------------------------------
// Main Export
// ---------------------------------------------------------------------------

/**
 * Parse a worker's text output into a structured Observation.
 *
 * All fields are extracted using regex + heuristics — no AI calls.
 * The caller is responsible for persisting the result via MemoryManager.
 *
 * @param input - Worker output + metadata required to build the observation
 * @returns A populated Observation ready for insertion into the store
 */
export function extractObservation(input: ExtractionInput): Observation {
  const { output, sessionId, workerId, profile, prompt } = input;

  return {
    session_id: sessionId,
    worker_id: workerId,
    type: classifyObservationType(output, prompt, profile),
    title: extractTitle(output),
    narrative: buildNarrative(output),
    facts: extractFacts(output),
    concepts: extractConcepts(output),
    files_read: extractFilesRead(output),
    files_modified: extractFilesModified(output),
  };
}
