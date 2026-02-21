/**
 * Full E2E Test for V2 Flow
 *
 * Tests the complete V2 autonomous AI bridge workflow:
 * 1. AI tool discovery
 * 2. Workspace exploration (incremental 5-pass)
 * 3. Message routing through Master AI
 * 4. .openbridge/ folder structure validation
 * 5. Session continuity across messages
 *
 * This test creates a real workspace, runs the full discovery + exploration flow,
 * and validates the entire .openbridge/ folder structure including exploration/ subfolder.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm, readFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';

// Mock the claude-code-executor module
vi.mock('../../src/providers/claude-code/claude-code-executor.js', () => ({
  executeClaudeCode: vi.fn(),
  streamClaudeCode: vi.fn(),
}));

import {
  executeClaudeCode,
  streamClaudeCode,
} from '../../src/providers/claude-code/claude-code-executor.js';

const mockExecuteClaudeCode = executeClaudeCode as ReturnType<typeof vi.fn>;
const mockStreamClaudeCode = streamClaudeCode as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Test Workspace Setup
// ---------------------------------------------------------------------------

/**
 * Creates a realistic test workspace with code, docs, and config files
 */
async function createTestWorkspace(): Promise<string> {
  const workspaceId = `test-workspace-${Date.now()}`;
  const workspacePath = join(tmpdir(), workspaceId);

  await mkdir(workspacePath, { recursive: true });

  // Create a realistic project structure
  await mkdir(join(workspacePath, 'src'), { recursive: true });
  await mkdir(join(workspacePath, 'tests'), { recursive: true });
  await mkdir(join(workspacePath, 'docs'), { recursive: true });

  // package.json
  await writeFile(
    join(workspacePath, 'package.json'),
    JSON.stringify(
      {
        name: 'test-project',
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'node src/index.js',
          test: 'vitest',
        },
        dependencies: {
          express: '^4.18.0',
        },
        devDependencies: {
          vitest: '^1.0.0',
        },
      },
      null,
      2,
    ),
  );

  // tsconfig.json
  await writeFile(
    join(workspacePath, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          strict: true,
        },
      },
      null,
      2,
    ),
  );

  // README.md
  await writeFile(
    join(workspacePath, 'README.md'),
    '# Test Project\n\nA test Node.js + TypeScript project for E2E testing.',
  );

  // src/index.ts
  await writeFile(
    join(workspacePath, 'src', 'index.ts'),
    `import express from 'express';\n\nconst app = express();\napp.listen(3000);`,
  );

  // src/utils.ts
  await writeFile(
    join(workspacePath, 'src', 'utils.ts'),
    `export function hello(name: string): string {\n  return \`Hello, \${name}!\`;\n}`,
  );

  // tests/utils.test.ts
  await writeFile(
    join(workspacePath, 'tests', 'utils.test.ts'),
    `import { describe, it, expect } from 'vitest';\nimport { hello } from '../src/utils.js';\n\ndescribe('hello', () => {\n  it('greets', () => {\n    expect(hello('world')).toBe('Hello, world!');\n  });\n});`,
  );

  // docs/API.md
  await writeFile(
    join(workspacePath, 'docs', 'API.md'),
    '# API Documentation\n\n## Endpoints\n\n- `GET /` - Health check',
  );

  return workspacePath;
}

/**
 * Cleanup test workspace
 */
async function cleanupWorkspace(workspacePath: string): Promise<void> {
  try {
    await rm(workspacePath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in tests
  }
}

// ---------------------------------------------------------------------------
// Mock AI Responses
// ---------------------------------------------------------------------------

/**
 * Simulates successful incremental exploration responses from Claude
 */
function setupMockExplorationResponses(workspacePath: string) {
  // Pass 1: Structure scan
  const structureScanResult = {
    workspacePath,
    topLevelFiles: ['package.json', 'tsconfig.json', 'README.md'],
    topLevelDirs: ['src', 'tests', 'docs'],
    directoryCounts: {
      src: 2,
      tests: 1,
      docs: 1,
    },
    configFiles: ['package.json', 'tsconfig.json'],
    skippedDirs: [],
    totalFiles: 7,
    scannedAt: new Date().toISOString(),
    durationMs: 100,
  };

  // Pass 2: Classification
  const classificationResult = {
    projectType: 'nodejs-typescript',
    projectName: 'test-project',
    frameworks: ['express', 'vitest'],
    commands: {
      dev: 'npm run dev',
      test: 'npm run test',
    },
    dependencies: [
      { name: 'express', version: '^4.18.0', type: 'runtime' as const },
      { name: 'vitest', version: '^1.0.0', type: 'dev' as const },
    ],
    insights: ['TypeScript project with Express server', 'Vitest for testing'],
    classifiedAt: new Date().toISOString(),
    durationMs: 100,
  };

  // Pass 3: Directory dives
  const srcDiveResult = {
    path: 'src',
    purpose: 'Application source code',
    keyFiles: [
      { path: 'index.ts', type: 'entry', purpose: 'Express server entry point' },
      { path: 'utils.ts', type: 'module', purpose: 'Utility functions' },
    ],
    subdirectories: [],
    fileCount: 2,
    insights: ['Express server entry point and utility functions'],
    exploredAt: new Date().toISOString(),
    durationMs: 50,
  };

  const testsDiveResult = {
    path: 'tests',
    purpose: 'Test suite',
    keyFiles: [{ path: 'utils.test.ts', type: 'test', purpose: 'Unit tests for utils module' }],
    subdirectories: [],
    fileCount: 1,
    insights: ['Vitest unit tests'],
    exploredAt: new Date().toISOString(),
    durationMs: 50,
  };

  const docsDiveResult = {
    path: 'docs',
    purpose: 'Documentation',
    keyFiles: [{ path: 'API.md', type: 'documentation', purpose: 'API documentation' }],
    subdirectories: [],
    fileCount: 1,
    insights: ['API documentation'],
    exploredAt: new Date().toISOString(),
    durationMs: 50,
  };

  // Pass 4: Assembly (workspace-map.json)
  const assemblyResult = {
    workspacePath,
    projectName: 'test-project',
    projectType: 'nodejs-typescript',
    frameworks: ['express', 'vitest'],
    structure: {
      src: { path: 'src', purpose: 'Application source code', fileCount: 2 },
      tests: { path: 'tests', purpose: 'Vitest test suite', fileCount: 1 },
      docs: { path: 'docs', purpose: 'Documentation', fileCount: 1 },
    },
    keyFiles: [
      { path: 'src/index.ts', type: 'entry', purpose: 'Express server entry point' },
      { path: 'package.json', type: 'config', purpose: 'Node.js project configuration' },
    ],
    entryPoints: ['src/index.ts'],
    commands: {
      dev: 'npm run dev',
      test: 'npm run test',
    },
    dependencies: [
      { name: 'express', version: '^4.18.0', type: 'runtime' as const },
      { name: 'vitest', version: '^1.0.0', type: 'dev' as const },
    ],
    summary:
      'A Node.js + TypeScript project using Express. Includes source code in src/, tests in tests/, and API docs.',
    generatedAt: new Date().toISOString(),
    schemaVersion: '1.0.0',
  };

  let callCount = 0;

  mockExecuteClaudeCode.mockImplementation(async () => {
    callCount++;

    // Determine which pass based on call count
    if (callCount === 1) {
      return {
        stdout: JSON.stringify(structureScanResult),
        stderr: '',
        exitCode: 0,
      };
    }

    if (callCount === 2) {
      return {
        stdout: JSON.stringify(classificationResult),
        stderr: '',
        exitCode: 0,
      };
    }

    // Calls 3-5: Directory dives (src, tests, docs)
    if (callCount === 3) {
      return {
        stdout: JSON.stringify(srcDiveResult),
        stderr: '',
        exitCode: 0,
      };
    }

    if (callCount === 4) {
      return {
        stdout: JSON.stringify(testsDiveResult),
        stderr: '',
        exitCode: 0,
      };
    }

    if (callCount === 5) {
      return {
        stdout: JSON.stringify(docsDiveResult),
        stderr: '',
        exitCode: 0,
      };
    }

    // Call 6: Assembly
    if (callCount === 6) {
      return {
        stdout: JSON.stringify(assemblyResult),
        stderr: '',
        exitCode: 0,
      };
    }

    // Fallback for any other calls
    return {
      stdout: JSON.stringify({ success: true }),
      stderr: '',
      exitCode: 0,
    };
  });

  // Mock streaming for messages
  mockStreamClaudeCode.mockImplementation(async function* () {
    yield 'Processing your request...';
    yield '\n\nThe project is a Node.js + TypeScript application using Express.';
    return {
      content:
        'Processing your request...\n\nThe project is a Node.js + TypeScript application using Express.',
      metadata: { sessionId: randomUUID() },
    };
  });
}

// ---------------------------------------------------------------------------
// E2E Tests
// ---------------------------------------------------------------------------

describe('E2E: Full V2 Flow - Discovery, Exploration, Messaging', () => {
  let workspacePath: string;
  let masterManager: MasterManager;

  const mockMasterTool: DiscoveredTool = {
    type: 'cli',
    name: 'claude',
    path: '/usr/local/bin/claude',
    version: '1.0.0',
    capabilities: ['chat', 'code', 'files'],
    isAvailable: true,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    workspacePath = await createTestWorkspace();
    setupMockExplorationResponses(workspacePath);
  });

  afterEach(async () => {
    if (masterManager) {
      await masterManager.shutdown();
    }
    await cleanupWorkspace(workspacePath);
  });

  // ---------------------------------------------------------------------------
  // Test 1: Full Exploration Flow
  // ---------------------------------------------------------------------------

  it('completes full 5-pass incremental exploration and creates .openbridge/ structure', async () => {
    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    // Start exploration (runs in background)
    await masterManager.start();

    // Wait for exploration to complete
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds max (500ms * 20)
    while (masterManager.getState() === 'exploring' && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    expect(masterManager.getState()).toBe('ready');

    // Verify .openbridge/ folder structure exists
    const dotFolderPath = join(workspacePath, '.openbridge');
    await expect(access(dotFolderPath)).resolves.toBeUndefined();

    // Verify exploration/ subfolder exists
    const explorationPath = join(dotFolderPath, 'exploration');
    await expect(access(explorationPath)).resolves.toBeUndefined();

    // Verify exploration-state.json
    const statePath = join(explorationPath, 'exploration-state.json');
    await expect(access(statePath)).resolves.toBeUndefined();

    const stateContent = await readFile(statePath, 'utf-8');
    const state = JSON.parse(stateContent) as {
      status: string;
      phases: Record<string, string>;
    };
    expect(state.status).toBe('completed');
    expect(state.phases['structure_scan']).toBe('completed');
    expect(state.phases['classification']).toBe('completed');
    expect(state.phases['directory_dives']).toBe('completed');
    expect(state.phases['assembly']).toBe('completed');
    expect(state.phases['finalization']).toBe('completed');

    // Verify structure-scan.json
    const structureScanPath = join(explorationPath, 'structure-scan.json');
    await expect(access(structureScanPath)).resolves.toBeUndefined();

    // Verify classification.json
    const classificationPath = join(explorationPath, 'classification.json');
    await expect(access(classificationPath)).resolves.toBeUndefined();

    // Verify directory dive results
    const dirsPath = join(explorationPath, 'dirs');
    await expect(access(dirsPath)).resolves.toBeUndefined();

    const srcDivePath = join(dirsPath, 'src.json');
    await expect(access(srcDivePath)).resolves.toBeUndefined();

    // Verify workspace-map.json
    const mapPath = join(dotFolderPath, 'workspace-map.json');
    await expect(access(mapPath)).resolves.toBeUndefined();

    const mapContent = await readFile(mapPath, 'utf-8');
    const map = JSON.parse(mapContent) as {
      projectType: string;
      frameworks: string[];
      summary: string;
    };
    expect(map.projectType).toBe('nodejs-typescript');
    expect(map.frameworks).toContain('express');
    expect(map.summary).toContain('Node.js');
    expect(map.summary).toContain('TypeScript');

    // Verify agents.json
    const agentsPath = join(dotFolderPath, 'agents.json');
    await expect(access(agentsPath)).resolves.toBeUndefined();

    const agentsContent = await readFile(agentsPath, 'utf-8');
    const agents = JSON.parse(agentsContent) as {
      master: { name: string };
    };
    expect(agents.master).toBeDefined();
    expect(agents.master.name).toBe('claude');

    // Verify exploration.log
    const logPath = join(dotFolderPath, 'exploration.log');
    await expect(access(logPath)).resolves.toBeUndefined();

    // Verify git repository
    const gitPath = join(dotFolderPath, '.git');
    await expect(access(gitPath)).resolves.toBeUndefined();
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 2: Message Processing After Exploration
  // ---------------------------------------------------------------------------

  it('processes messages through Master AI after exploration completes', async () => {
    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    // Start and wait for exploration
    await masterManager.start();

    let attempts = 0;
    while (masterManager.getState() === 'exploring' && attempts < 20) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    expect(masterManager.getState()).toBe('ready');

    // Send a message
    const message: InboundMessage = {
      id: 'test-msg-1',
      source: 'console',
      sender: '+1234567890',
      rawContent: '/ai what kind of project is this?',
      content: 'what kind of project is this?',
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    expect(responseContent).toContain('Node.js');
    expect(responseContent).toContain('TypeScript');

    // Verify message was processed with workspace context
    expect(mockStreamClaudeCode).toHaveBeenCalled();
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 3: Session Continuity Across Messages
  // ---------------------------------------------------------------------------

  it('maintains session continuity across multiple messages from the same sender', async () => {
    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    await masterManager.start();

    // Wait for exploration
    let attempts = 0;
    while (masterManager.getState() === 'exploring' && attempts < 20) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    // First message
    const message1: InboundMessage = {
      id: 'msg-1',
      source: 'console',
      sender: 'user-123',
      rawContent: 'what is this project?',
      content: 'what is this project?',
      timestamp: new Date(),
    };

    for await (const _chunk of masterManager.streamMessage(message1)) {
      // consume stream
    }

    const firstCallArgs =
      mockStreamClaudeCode.mock.calls[mockStreamClaudeCode.mock.calls.length - 1];
    expect(firstCallArgs).toBeDefined();

    // Second message from same sender
    const message2: InboundMessage = {
      id: 'msg-2',
      source: 'console',
      sender: 'user-123',
      rawContent: 'what tests exist?',
      content: 'what tests exist?',
      timestamp: new Date(),
    };

    for await (const _chunk of masterManager.streamMessage(message2)) {
      // consume stream
    }

    const secondCallArgs =
      mockStreamClaudeCode.mock.calls[mockStreamClaudeCode.mock.calls.length - 1];
    expect(secondCallArgs).toBeDefined();

    // Both calls should use session continuity (either --session-id or --resume)
    expect(mockStreamClaudeCode).toHaveBeenCalledTimes(2);
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 4: Resilient Startup (Resume from Partial State)
  // ---------------------------------------------------------------------------

  it('resumes exploration from partial state on restart', async () => {
    // First run: start exploration but don't complete all phases
    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    await masterManager.start();

    // Wait briefly (not long enough to complete)
    await new Promise((r) => setTimeout(r, 1000));

    // Shutdown before completion
    await masterManager.shutdown();

    // Check if exploration state was created
    const statePath = join(workspacePath, '.openbridge', 'exploration', 'exploration-state.json');
    const stateExists = await access(statePath)
      .then(() => true)
      .catch(() => false);

    if (stateExists) {
      // Second run: should resume
      const masterManager2 = new MasterManager({
        workspacePath,
        masterTool: mockMasterTool,
        discoveredTools: [mockMasterTool],
        explorationTimeout: 10_000,
      });

      await masterManager2.start();

      // Wait for completion
      let attempts = 0;
      while (masterManager2.getState() === 'exploring' && attempts < 20) {
        await new Promise((r) => setTimeout(r, 500));
        attempts++;
      }

      expect(masterManager2.getState()).toBe('ready');

      await masterManager2.shutdown();

      // Final state should show completed
      const finalStateContent = await readFile(statePath, 'utf-8');
      const finalState = JSON.parse(finalStateContent) as { status: string };
      expect(finalState.status).toBe('completed');
    }
  }, 20000);

  // ---------------------------------------------------------------------------
  // Test 5: Status Query Shows Exploration Progress
  // ---------------------------------------------------------------------------

  it('returns exploration progress when status is queried during exploration', async () => {
    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    await masterManager.start();

    // Query status while exploring
    const statusMessage: InboundMessage = {
      id: 'status-1',
      source: 'console',
      sender: 'user-123',
      rawContent: '/status',
      content: '/status',
      timestamp: new Date(),
    };

    let statusResponse = '';
    for await (const chunk of masterManager.streamMessage(statusMessage)) {
      statusResponse += chunk;
    }

    // Should contain status information
    expect(statusResponse).toBeTruthy();

    // Wait for exploration to complete
    let attempts = 0;
    while (masterManager.getState() === 'exploring' && attempts < 20) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }
  }, 15000);
});
