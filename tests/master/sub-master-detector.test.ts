import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { detectSubProjects, SUB_PROJECT_MIN_FILES } from '../../src/master/sub-master-detector.js';
import type { SubProjectInfo } from '../../src/master/sub-master-detector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create N placeholder files inside a directory */
async function createFiles(dir: string, count: number, prefix = 'file'): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    await fs.writeFile(path.join(dir, `${prefix}-${i}.txt`), `content ${i}`);
  }
}

/** Write a package.json with optional dependencies */
async function writePackageJson(dir: string, extras: Record<string, unknown> = {}): Promise<void> {
  const pkg = {
    name: path.basename(dir),
    version: '1.0.0',
    ...extras,
  };
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('detectSubProjects', () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = path.join(
      os.tmpdir(),
      'openbridge-smd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    );
    await fs.mkdir(testRoot, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // -------------------------------------------------------------------------
  // Basic detection
  // -------------------------------------------------------------------------

  it('should return empty array for workspace with no sub-projects', async () => {
    // Only root-level files, no sub-directories
    await createFiles(testRoot, 5);
    const results = await detectSubProjects(testRoot);
    expect(results).toEqual([]);
  });

  it('should detect a Node.js sub-project with enough files', async () => {
    const backend = path.join(testRoot, 'backend');
    await fs.mkdir(backend, { recursive: true });
    await writePackageJson(backend);
    await createFiles(backend, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(1);
    expect(results[0]?.name).toBe('backend');
    expect(results[0]?.projectType).toBe('node');
    expect(results[0]?.manifests).toContain('package.json');
  });

  it('should ignore a directory with a manifest but fewer than minimum files', async () => {
    const tiny = path.join(testRoot, 'tiny');
    await fs.mkdir(tiny, { recursive: true });
    await writePackageJson(tiny);
    // Only a handful of files — below threshold
    await createFiles(tiny, 10);

    const results = await detectSubProjects(testRoot);
    expect(results).toEqual([]);
  });

  it('should ignore a directory with enough files but no manifest', async () => {
    const noManifest = path.join(testRoot, 'scripts');
    await createFiles(noManifest, SUB_PROJECT_MIN_FILES + 10);

    const results = await detectSubProjects(testRoot);
    expect(results).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Multiple sub-projects
  // -------------------------------------------------------------------------

  it('should detect multiple sub-projects', async () => {
    const frontend = path.join(testRoot, 'frontend');
    const backend = path.join(testRoot, 'backend');

    await fs.mkdir(frontend, { recursive: true });
    await writePackageJson(frontend, {
      dependencies: { react: '^18.0.0', vite: '^5.0.0' },
    });
    await createFiles(frontend, SUB_PROJECT_MIN_FILES + 5);

    await fs.mkdir(backend, { recursive: true });
    await writePackageJson(backend, {
      dependencies: { express: '^4.0.0' },
    });
    await createFiles(backend, SUB_PROJECT_MIN_FILES + 20);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(2);

    const names = results.map((r) => r.name);
    expect(names).toContain('frontend');
    expect(names).toContain('backend');
  });

  it('should sort results by file count descending', async () => {
    const small = path.join(testRoot, 'small');
    const large = path.join(testRoot, 'large');

    await fs.mkdir(small, { recursive: true });
    await writePackageJson(small);
    await createFiles(small, SUB_PROJECT_MIN_FILES + 5);

    await fs.mkdir(large, { recursive: true });
    await writePackageJson(large);
    await createFiles(large, SUB_PROJECT_MIN_FILES + 50);

    const results = await detectSubProjects(testRoot);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.name).toBe('large');
    expect(results[1]?.name).toBe('small');
  });

  // -------------------------------------------------------------------------
  // Different manifest types
  // -------------------------------------------------------------------------

  it('should detect a Rust (Cargo.toml) sub-project', async () => {
    const crate = path.join(testRoot, 'my-crate');
    await fs.mkdir(crate, { recursive: true });
    await fs.writeFile(path.join(crate, 'Cargo.toml'), '[package]\nname = "my-crate"\n');
    await createFiles(crate, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(1);
    expect(results[0]?.projectType).toBe('rust');
    expect(results[0]?.manifests).toContain('Cargo.toml');
  });

  it('should detect a Go (go.mod) sub-project', async () => {
    const goApp = path.join(testRoot, 'go-app');
    await fs.mkdir(goApp, { recursive: true });
    await fs.writeFile(path.join(goApp, 'go.mod'), 'module example.com/go-app\n\ngo 1.21\n');
    await createFiles(goApp, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(1);
    expect(results[0]?.projectType).toBe('go');
    expect(results[0]?.manifests).toContain('go.mod');
  });

  it('should detect a Java (pom.xml) sub-project', async () => {
    const javaApp = path.join(testRoot, 'java-api');
    await fs.mkdir(javaApp, { recursive: true });
    await fs.writeFile(
      path.join(javaApp, 'pom.xml'),
      '<project><artifactId>java-api</artifactId></project>',
    );
    await createFiles(javaApp, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(1);
    expect(results[0]?.projectType).toBe('java');
    expect(results[0]?.manifests).toContain('pom.xml');
  });

  it('should detect a Python (pyproject.toml) sub-project', async () => {
    const pythonService = path.join(testRoot, 'ml-service');
    await fs.mkdir(pythonService, { recursive: true });
    await fs.writeFile(
      path.join(pythonService, 'pyproject.toml'),
      '[build-system]\nrequires = ["setuptools"]\n',
    );
    await createFiles(pythonService, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(1);
    expect(results[0]?.projectType).toBe('python');
    expect(results[0]?.manifests).toContain('pyproject.toml');
  });

  // -------------------------------------------------------------------------
  // Framework detection
  // -------------------------------------------------------------------------

  it('should detect React + Vite from package.json', async () => {
    const frontend = path.join(testRoot, 'frontend');
    await fs.mkdir(frontend, { recursive: true });
    await writePackageJson(frontend, {
      dependencies: { react: '^18.0.0', 'react-dom': '^18.0.0' },
      devDependencies: { vite: '^5.0.0', typescript: '^5.0.0' },
    });
    await createFiles(frontend, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(1);
    const info = results[0] as SubProjectInfo;
    expect(info.frameworks).toContain('React');
    expect(info.frameworks).toContain('Vite');
    expect(info.frameworks).toContain('TypeScript');
  });

  it('should detect Next.js from package.json', async () => {
    const app = path.join(testRoot, 'nextapp');
    await fs.mkdir(app, { recursive: true });
    await writePackageJson(app, {
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    });
    await createFiles(app, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    const info = results[0] as SubProjectInfo;
    expect(info.frameworks).toContain('Next.js');
    expect(info.frameworks).toContain('React');
  });

  it('should detect Actix-web from Cargo.toml', async () => {
    const rustService = path.join(testRoot, 'rust-service');
    await fs.mkdir(rustService, { recursive: true });
    await fs.writeFile(
      path.join(rustService, 'Cargo.toml'),
      '[package]\nname = "rust-service"\n[dependencies]\nactix-web = "4"\ntokio = "1"\n',
    );
    await createFiles(rustService, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    const info = results[0] as SubProjectInfo;
    expect(info.frameworks).toContain('Rust');
    expect(info.frameworks).toContain('Actix');
    expect(info.frameworks).toContain('Tokio');
  });

  it('should detect Django from Pipfile', async () => {
    const djangoApp = path.join(testRoot, 'django-app');
    await fs.mkdir(djangoApp, { recursive: true });
    await fs.writeFile(path.join(djangoApp, 'Pipfile'), '[packages]\ndjango = "*"\npytest = "*"\n');
    await createFiles(djangoApp, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    const info = results[0] as SubProjectInfo;
    expect(info.frameworks).toContain('Python');
    expect(info.frameworks).toContain('Django');
    expect(info.frameworks).toContain('pytest');
  });

  it('should detect Spring Boot from pom.xml', async () => {
    const springApp = path.join(testRoot, 'spring-api');
    await fs.mkdir(springApp, { recursive: true });
    await fs.writeFile(
      path.join(springApp, 'pom.xml'),
      '<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent></project>',
    );
    await createFiles(springApp, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    const info = results[0] as SubProjectInfo;
    expect(info.frameworks).toContain('Java');
    expect(info.frameworks).toContain('Spring Boot');
  });

  // -------------------------------------------------------------------------
  // Excluded directories
  // -------------------------------------------------------------------------

  it('should ignore node_modules directories', async () => {
    const nodeModules = path.join(testRoot, 'node_modules', 'some-pkg');
    await fs.mkdir(nodeModules, { recursive: true });
    await writePackageJson(nodeModules);
    await createFiles(nodeModules, SUB_PROJECT_MIN_FILES + 5);

    const results = await detectSubProjects(testRoot);
    // node_modules is excluded — should find nothing
    expect(results).toEqual([]);
  });

  it('should ignore .git directory', async () => {
    const gitDir = path.join(testRoot, '.git', 'hooks');
    await fs.mkdir(gitDir, { recursive: true });
    await fs.writeFile(path.join(testRoot, '.git', 'go.mod'), 'module git-internal');
    await createFiles(gitDir, SUB_PROJECT_MIN_FILES + 5);

    const results = await detectSubProjects(testRoot);
    expect(results).toEqual([]);
  });

  it('should ignore .openbridge directory', async () => {
    const dotFolder = path.join(testRoot, '.openbridge');
    await fs.mkdir(dotFolder, { recursive: true });
    await writePackageJson(dotFolder);
    await createFiles(dotFolder, SUB_PROJECT_MIN_FILES + 5);

    const results = await detectSubProjects(testRoot);
    expect(results).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Result shape
  // -------------------------------------------------------------------------

  it('should return correct shape for a detected sub-project', async () => {
    const backend = path.join(testRoot, 'backend');
    await fs.mkdir(backend, { recursive: true });
    await writePackageJson(backend, {
      dependencies: { express: '^4.0.0' },
    });
    await createFiles(backend, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(1);

    const info = results[0] as SubProjectInfo;
    expect(info.path).toBe(backend);
    expect(info.relativePath).toBe('backend');
    expect(info.name).toBe('backend');
    expect(info.fileCount).toBeGreaterThan(SUB_PROJECT_MIN_FILES);
    expect(info.projectType).toBe('node');
    expect(info.manifests).toBeInstanceOf(Array);
    expect(info.frameworks).toBeInstanceOf(Array);
  });

  it('should set fileCount to reflect actual number of files', async () => {
    const proj = path.join(testRoot, 'proj');
    await fs.mkdir(proj, { recursive: true });
    await writePackageJson(proj);
    const extraFiles = 30;
    await createFiles(proj, SUB_PROJECT_MIN_FILES + extraFiles);

    const results = await detectSubProjects(testRoot);
    // +1 for package.json itself
    expect(results[0]?.fileCount).toBe(SUB_PROJECT_MIN_FILES + extraFiles + 1);
  });

  it('should count files in nested subdirectories', async () => {
    const proj = path.join(testRoot, 'proj');
    const nested = path.join(proj, 'src', 'components');
    await fs.mkdir(nested, { recursive: true });
    await writePackageJson(proj);
    await createFiles(nested, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(1);
    // files in nested subdirectory should be counted
    expect(results[0]?.fileCount).toBeGreaterThan(SUB_PROJECT_MIN_FILES);
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('should return empty array for empty workspace', async () => {
    const results = await detectSubProjects(testRoot);
    expect(results).toEqual([]);
  });

  it('should not count workspace root itself as a sub-project', async () => {
    // Put a manifest in the root
    await writePackageJson(testRoot);
    await createFiles(testRoot, SUB_PROJECT_MIN_FILES + 5);

    // Should detect nothing since we only scan top-level directories, not the root
    const results = await detectSubProjects(testRoot);
    expect(results).toEqual([]);
  });

  it('should handle workspace with only files (no subdirectories)', async () => {
    await createFiles(testRoot, 100);
    const results = await detectSubProjects(testRoot);
    expect(results).toEqual([]);
  });

  it('should return empty array gracefully when workspace does not exist', async () => {
    const nonExistent = path.join(testRoot, 'does-not-exist');
    const results = await detectSubProjects(nonExistent);
    expect(results).toEqual([]);
  });

  it('should detect multiple manifest types in the same directory', async () => {
    const polyglot = path.join(testRoot, 'polyglot');
    await fs.mkdir(polyglot, { recursive: true });
    // Has both package.json and pyproject.toml
    await writePackageJson(polyglot);
    await fs.writeFile(path.join(polyglot, 'pyproject.toml'), '[build-system]\n');
    await createFiles(polyglot, SUB_PROJECT_MIN_FILES + 1);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(1);
    const info = results[0] as SubProjectInfo;
    expect(info.manifests).toContain('package.json');
    expect(info.manifests).toContain('pyproject.toml');
  });

  it('should handle dist/build directories without counting their files', async () => {
    const proj = path.join(testRoot, 'proj');
    const dist = path.join(proj, 'dist');
    await fs.mkdir(dist, { recursive: true });
    // Package.json in root of proj
    await writePackageJson(proj);
    // Real source files
    await createFiles(proj, SUB_PROJECT_MIN_FILES + 1);
    // dist files — these should be excluded from count
    await createFiles(dist, 1000);

    const results = await detectSubProjects(testRoot);
    expect(results).toHaveLength(1);
    // dist is excluded — count should not include dist files
    expect(results[0]?.fileCount).toBeLessThan(SUB_PROJECT_MIN_FILES + 1 + 1000);
    // but should be at least the source files
    expect(results[0]?.fileCount).toBeGreaterThan(SUB_PROJECT_MIN_FILES);
  });
});
