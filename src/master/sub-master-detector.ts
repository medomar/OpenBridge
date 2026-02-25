/**
 * Sub-Master Detector
 *
 * Scans the workspace for directories that qualify as independent sub-projects.
 * A sub-project is any directory that:
 *   1. Has its own manifest file (package.json, Cargo.toml, go.mod, pom.xml, etc.)
 *   2. Contains more than SUB_PROJECT_MIN_FILES files
 *   3. Is not the workspace root itself
 *
 * Detection is read-only and purely filesystem-based — no AI calls.
 * Results are returned as a list of SubProjectInfo objects.
 * Lifecycle management (spawning sub-master DBs) is handled by OB-754.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLogger } from '../core/logger.js';

const logger = createLogger('sub-master-detector');

/** Minimum file count for a directory to qualify as a sub-project */
export const SUB_PROJECT_MIN_FILES = 50;

/** Maximum depth to scan for sub-project manifests (1 = immediate children only) */
const MANIFEST_SCAN_DEPTH = 2;

/** Directories to skip entirely during file counting and manifest scanning */
const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  'target',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.openbridge',
  '.cache',
  'out',
  '.gradle',
  '.mvn',
];

/** Manifest files that signal an independent project root */
const MANIFEST_FILES: Record<string, ProjectType> = {
  'package.json': 'node',
  'Cargo.toml': 'rust',
  'go.mod': 'go',
  'pom.xml': 'java',
  'build.gradle': 'java',
  'build.gradle.kts': 'java',
  'pyproject.toml': 'python',
  'setup.py': 'python',
  'setup.cfg': 'python',
  Pipfile: 'python',
  'composer.json': 'php',
  Gemfile: 'ruby',
  'mix.exs': 'elixir',
  'pubspec.yaml': 'dart',
  'CMakeLists.txt': 'cpp',
};

/** Project type inferred from manifest file */
export type ProjectType =
  | 'node'
  | 'rust'
  | 'go'
  | 'java'
  | 'python'
  | 'php'
  | 'ruby'
  | 'elixir'
  | 'dart'
  | 'cpp'
  | 'unknown';

/** Information about a detected sub-project */
export interface SubProjectInfo {
  /** Absolute path to the sub-project directory */
  path: string;
  /** Relative path from workspace root */
  relativePath: string;
  /** Human-readable name (directory name) */
  name: string;
  /** Total file count within the directory */
  fileCount: number;
  /** Primary project type detected from manifest */
  projectType: ProjectType;
  /** All detected manifest files (e.g. ['package.json']) */
  manifests: string[];
  /** Detected frameworks and languages (best-effort from manifest analysis) */
  frameworks: string[];
}

/**
 * Scan the workspace for directories that qualify as independent sub-projects.
 *
 * @param workspacePath Absolute path to the root workspace directory
 * @returns Array of detected sub-projects, sorted by file count descending
 */
export async function detectSubProjects(workspacePath: string): Promise<SubProjectInfo[]> {
  logger.info({ workspacePath }, 'Starting sub-project detection');

  let topLevelDirs: string[] = [];
  try {
    topLevelDirs = await getTopLevelDirectories(workspacePath);
  } catch (error) {
    logger.error({ error, workspacePath }, 'Failed to read workspace root directory');
    return [];
  }

  const results: SubProjectInfo[] = [];

  for (const dirName of topLevelDirs) {
    const dirPath = path.join(workspacePath, dirName);

    try {
      const info = await analyzeDirectory(dirPath, workspacePath, dirName, 0);
      if (info !== null) {
        results.push(info);
      }
    } catch (error) {
      logger.warn({ error, dirPath }, 'Failed to analyze directory for sub-project detection');
    }
  }

  // Sort by file count descending — largest sub-projects first
  results.sort((a, b) => b.fileCount - a.fileCount);

  logger.info(
    { count: results.length, paths: results.map((r) => r.relativePath) },
    'Sub-project detection complete',
  );

  return results;
}

/**
 * Get the list of non-excluded top-level directory names in workspacePath.
 */
async function getTopLevelDirectories(workspacePath: string): Promise<string[]> {
  const entries = await fs.readdir(workspacePath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !EXCLUDED_DIRS.includes(entry.name))
    .map((entry) => entry.name);
}

/**
 * Analyze a directory to determine if it qualifies as a sub-project.
 *
 * @param dirPath    Absolute path to the directory
 * @param rootPath   Absolute workspace root (for computing relativePath)
 * @param name       Directory name
 * @param depth      Current recursion depth (used for nested manifest scanning)
 * @returns SubProjectInfo if this directory qualifies, null otherwise
 */
async function analyzeDirectory(
  dirPath: string,
  rootPath: string,
  name: string,
  depth: number,
): Promise<SubProjectInfo | null> {
  if (depth > MANIFEST_SCAN_DEPTH) return null;

  // Check for manifest files
  const manifests = await detectManifests(dirPath);
  if (manifests.length === 0) return null;

  // Count files recursively
  const fileCount = await countFiles(dirPath);
  if (fileCount <= SUB_PROJECT_MIN_FILES) return null;

  const relativePath = path.relative(rootPath, dirPath);
  const primaryManifest = manifests[0] ?? 'unknown';
  const projectType: ProjectType = MANIFEST_FILES[primaryManifest] ?? 'unknown';
  const frameworks = await detectFrameworks(dirPath, manifests);

  return {
    path: dirPath,
    relativePath,
    name,
    fileCount,
    projectType,
    manifests,
    frameworks,
  };
}

/**
 * Check which manifest files exist in a directory (without recursing).
 */
async function detectManifests(dirPath: string): Promise<string[]> {
  const found: string[] = [];
  for (const manifestName of Object.keys(MANIFEST_FILES)) {
    try {
      await fs.access(path.join(dirPath, manifestName));
      found.push(manifestName);
    } catch {
      // File doesn't exist — continue
    }
  }
  return found;
}

/**
 * Recursively count all files in a directory, excluding EXCLUDED_DIRS.
 * Caps at 100 000 to avoid excessive scanning on huge directories.
 */
async function countFiles(dirPath: string, depth = 0): Promise<number> {
  const MAX_DEPTH = 10;
  const MAX_COUNT = 100_000;

  if (depth > MAX_DEPTH) return 0;

  let count = 0;

  let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    if (count >= MAX_COUNT) break;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.includes(entry.name)) continue;
      count += await countFiles(path.join(dirPath, entry.name), depth + 1);
    } else if (entry.isFile()) {
      count += 1;
    }
  }

  return count;
}

/**
 * Detect frameworks and languages from manifest files in the directory.
 * Returns an array of human-readable labels (e.g. ["TypeScript", "React", "Vite"]).
 * Best-effort only — reads manifest content and looks for common patterns.
 */
async function detectFrameworks(dirPath: string, manifests: string[]): Promise<string[]> {
  const frameworks = new Set<string>();

  for (const manifestFile of manifests) {
    try {
      const content = await fs.readFile(path.join(dirPath, manifestFile), 'utf8');
      extractFrameworksFromManifest(manifestFile, content, frameworks);
    } catch {
      // Cannot read manifest — skip
    }
  }

  return Array.from(frameworks);
}

/**
 * Extract framework/language signals from a manifest file's content.
 * Operates purely on text patterns — no full parsing.
 */
function extractFrameworksFromManifest(
  manifestFile: string,
  content: string,
  frameworks: Set<string>,
): void {
  if (manifestFile === 'package.json') {
    extractNodeFrameworks(content, frameworks);
  } else if (manifestFile === 'Cargo.toml') {
    frameworks.add('Rust');
    if (content.includes('actix-web') || content.includes('actix_web')) frameworks.add('Actix');
    if (content.includes('axum')) frameworks.add('Axum');
    if (content.includes('tokio')) frameworks.add('Tokio');
  } else if (manifestFile === 'go.mod') {
    frameworks.add('Go');
    if (content.includes('gin-gonic/gin')) frameworks.add('Gin');
    if (content.includes('labstack/echo')) frameworks.add('Echo');
    if (content.includes('gorilla/mux')) frameworks.add('Gorilla Mux');
  } else if (manifestFile === 'pom.xml' || manifestFile.startsWith('build.gradle')) {
    frameworks.add('Java');
    if (content.includes('spring-boot') || content.includes('spring-framework')) {
      frameworks.add('Spring Boot');
    }
    if (content.includes('micronaut')) frameworks.add('Micronaut');
    if (content.includes('quarkus')) frameworks.add('Quarkus');
  } else if (
    manifestFile === 'pyproject.toml' ||
    manifestFile === 'setup.py' ||
    manifestFile === 'Pipfile'
  ) {
    frameworks.add('Python');
    if (content.includes('fastapi')) frameworks.add('FastAPI');
    if (content.includes('django')) frameworks.add('Django');
    if (content.includes('flask')) frameworks.add('Flask');
    if (content.includes('pytest')) frameworks.add('pytest');
  } else if (manifestFile === 'composer.json') {
    frameworks.add('PHP');
    if (content.includes('laravel')) frameworks.add('Laravel');
    if (content.includes('symfony')) frameworks.add('Symfony');
  } else if (manifestFile === 'Gemfile') {
    frameworks.add('Ruby');
    if (content.includes('rails')) frameworks.add('Rails');
    if (content.includes('sinatra')) frameworks.add('Sinatra');
  }
}

/**
 * Extract framework signals from a package.json content string.
 */
function extractNodeFrameworks(content: string, frameworks: Set<string>): void {
  // Check for TypeScript
  if (content.includes('"typescript"') || content.includes('"ts-node"')) {
    frameworks.add('TypeScript');
  }

  // Frontend frameworks
  if (content.includes('"react"') || content.includes('"react-dom"')) frameworks.add('React');
  if (content.includes('"vue"')) frameworks.add('Vue');
  if (content.includes('"@angular/core"')) frameworks.add('Angular');
  if (content.includes('"svelte"')) frameworks.add('Svelte');
  if (content.includes('"solid-js"')) frameworks.add('SolidJS');

  // Build tools
  if (content.includes('"vite"')) frameworks.add('Vite');
  if (content.includes('"webpack"')) frameworks.add('Webpack');
  if (content.includes('"esbuild"')) frameworks.add('esbuild');
  if (content.includes('"turbopack"')) frameworks.add('Turbopack');

  // Backend frameworks
  if (content.includes('"express"')) frameworks.add('Express');
  if (content.includes('"fastify"')) frameworks.add('Fastify');
  if (content.includes('"hono"')) frameworks.add('Hono');
  if (content.includes('"koa"')) frameworks.add('Koa');
  if (content.includes('"nestjs"') || content.includes('"@nestjs/core"')) frameworks.add('NestJS');

  // Meta-frameworks
  if (content.includes('"next"')) frameworks.add('Next.js');
  if (content.includes('"nuxt"')) frameworks.add('Nuxt');
  if (content.includes('"remix"') || content.includes('"@remix-run"')) frameworks.add('Remix');
  if (content.includes('"@sveltejs/kit"')) frameworks.add('SvelteKit');
  if (content.includes('"astro"')) frameworks.add('Astro');

  // Test frameworks
  if (content.includes('"vitest"')) frameworks.add('Vitest');
  if (content.includes('"jest"')) frameworks.add('Jest');
  if (content.includes('"mocha"')) frameworks.add('Mocha');

  // ORMs and databases
  if (content.includes('"prisma"') || content.includes('"@prisma/client"'))
    frameworks.add('Prisma');
  if (content.includes('"typeorm"')) frameworks.add('TypeORM');
  if (content.includes('"drizzle-orm"')) frameworks.add('Drizzle');

  // If nothing matched, at least mark it as Node.js
  if (frameworks.size === 0) {
    frameworks.add('Node.js');
  }
}
