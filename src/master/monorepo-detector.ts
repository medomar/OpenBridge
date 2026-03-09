/**
 * Monorepo Detector
 *
 * Detects whether a workspace is a monorepo by scanning for multiple project
 * manifest files (`package.json`, `.git`, `pom.xml`, `go.mod`, etc.) at
 * depth 1–2 from the workspace root.
 *
 * A workspace is classified as a monorepo when two or more sub-directories
 * at depth 1–2 each contain their own project manifest.  The function is
 * purely filesystem-based — no AI calls, no file-count thresholds.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLogger } from '../core/logger.js';

const logger = createLogger('monorepo-detector');

/** Maximum directory depth to scan for project manifests (root = depth 0). */
const MAX_SCAN_DEPTH = 2;

/** Directories that are never treated as sub-project roots. */
const EXCLUDED_DIRS = new Set([
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
  '.tox',
  '.pytest_cache',
  '.mypy_cache',
]);

/**
 * Manifest files whose presence signals an independent project root,
 * mapped to a human-readable project type string.
 */
const MANIFEST_FILES: Record<string, string> = {
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

/** A detected sub-project within the monorepo. */
export interface MonorepoSubProject {
  /** Relative path from workspace root (e.g. `packages/ui`). */
  path: string;
  /** Project type inferred from the detected manifest (e.g. `node`, `go`). */
  type: string;
}

/** Result returned by {@link detectMonorepoPattern}. */
export interface MonorepoDetectionResult {
  /** `true` when 2+ sub-directories each contain their own project manifest. */
  isMonorepo: boolean;
  /** Detected sub-projects (empty when `isMonorepo` is `false`). */
  subProjects: MonorepoSubProject[];
}

/**
 * Scan `workspacePath` for monorepo indicators at depth 1–2.
 *
 * A workspace is considered a monorepo when at least two sub-directories
 * (at depth 1 or depth 2 inside a non-excluded parent) each contain a
 * recognised project manifest file such as `package.json`, `go.mod`, or
 * `pom.xml`.  A standalone `.git` directory at depth 1 is also treated as a
 * monorepo signal when combined with another manifest-bearing directory.
 *
 * @param workspacePath Absolute path to the root workspace directory.
 * @returns Detection result with `isMonorepo` flag and `subProjects` list.
 */
export async function detectMonorepoPattern(
  workspacePath: string,
): Promise<MonorepoDetectionResult> {
  logger.debug({ workspacePath }, 'Starting monorepo detection');

  const subProjects: MonorepoSubProject[] = [];

  let topLevelEntries: string[] = [];
  try {
    const dirents = await fs.readdir(workspacePath, { withFileTypes: true });
    topLevelEntries = dirents
      .filter((d) => d.isDirectory() && !EXCLUDED_DIRS.has(d.name))
      .map((d) => d.name);
  } catch (err) {
    logger.warn({ err, workspacePath }, 'Failed to read workspace root — returning non-monorepo');
    return { isMonorepo: false, subProjects: [] };
  }

  for (const dirName of topLevelEntries) {
    const dirAbsPath = path.join(workspacePath, dirName);
    const relPath = dirName;

    // Depth 1: check if this directory itself has a manifest
    const depth1Type = await detectManifestType(dirAbsPath);
    if (depth1Type !== null) {
      subProjects.push({ path: relPath, type: depth1Type });
      continue; // treat the whole dir as one sub-project; no need to descend
    }

    // Depth 2: scan immediate children of this directory
    try {
      const childDirents = await fs.readdir(dirAbsPath, { withFileTypes: true });
      for (const child of childDirents) {
        if (!child.isDirectory()) continue;
        if (EXCLUDED_DIRS.has(child.name)) continue;

        const childAbsPath = path.join(dirAbsPath, child.name);
        const childType = await detectManifestType(childAbsPath);
        if (childType !== null) {
          subProjects.push({
            path: `${relPath}/${child.name}`,
            type: childType,
          });
        }
      }
    } catch (err) {
      logger.debug({ err, dir: relPath }, 'Failed to read depth-2 directory — skipping');
    }
  }

  const isMonorepo = subProjects.length >= 2;

  logger.info(
    { isMonorepo, subProjectCount: subProjects.length, paths: subProjects.map((p) => p.path) },
    'Monorepo detection complete',
  );

  return { isMonorepo, subProjects: isMonorepo ? subProjects : [] };
}

/**
 * Return the project type string for the first manifest found in `dirPath`,
 * or `null` if no recognised manifest exists there.
 */
async function detectManifestType(dirPath: string): Promise<string | null> {
  for (const [manifestFile, projectType] of Object.entries(MANIFEST_FILES)) {
    try {
      await fs.access(path.join(dirPath, manifestFile));
      return projectType;
    } catch {
      // file does not exist — try next
    }
  }

  // Also treat a nested .git directory as a monorepo signal (embedded repo)
  try {
    await fs.access(path.join(dirPath, '.git'));
    return 'git-repo';
  } catch {
    // no .git either
  }

  return null;
}

// Export MAX_SCAN_DEPTH for testing
export { MAX_SCAN_DEPTH };
