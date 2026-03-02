// Vitest global setup
// Add shared test configuration, mocks, or utilities here

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

/**
 * Clean up stale test-workspace-* directories that may have been left behind
 * by interrupted test runs. Runs once before all tests.
 */
async function cleanStaleTestWorkspaces(): Promise<void> {
  const dirs = [process.cwd(), os.tmpdir()];
  for (const dir of dirs) {
    try {
      const entries = await fs.readdir(dir);
      const stale = entries.filter((e) => e.startsWith('test-workspace-'));
      for (const entry of stale) {
        try {
          await fs.rm(path.join(dir, entry), { recursive: true, force: true });
        } catch {
          // Ignore individual cleanup errors
        }
      }
    } catch {
      // Ignore if directory can't be read
    }
  }
}

await cleanStaleTestWorkspaces();
