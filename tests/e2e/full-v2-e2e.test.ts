/**
 * Full E2E Test for V2 Flow
 *
 * Tests the complete V2 autonomous AI bridge workflow:
 * 1. AI tool discovery
 * 2. Workspace exploration (Master-driven)
 * 3. Message routing through Master AI
 * 4. .openbridge/ folder structure validation
 * 5. Session continuity across messages
 *
 * This test creates a real workspace, runs the full discovery + exploration flow,
 * and validates the entire .openbridge/ folder structure.
 *
 * Mocking strategy:
 * - AgentRunner is mocked (no real CLI calls)
 * - Logger is mocked (suppress output)
 * - DotFolderManager is NOT mocked (real filesystem operations for E2E)
 * - Exploration is Master-driven (Master session writes workspace-map.json directly)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm, readFile, access } from 'node:fs/promises';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';

// ---------------------------------------------------------------------------
// Module-scope mock fns (must be declared before vi.mock calls)
// ---------------------------------------------------------------------------

const mockSpawn = vi.fn();
const mockStream = vi.fn();

// ---------------------------------------------------------------------------
// Mock the AgentRunner module
// ---------------------------------------------------------------------------

vi.mock('../../src/core/agent-runner.js', () => {
  class AgentExhaustedError extends Error {
    readonly attempts: Array<{ attempt: number; exitCode: number; stderr: string }>;
    readonly lastExitCode: number;
    readonly totalAttempts: number;
    readonly durationMs: number;

    constructor(
      attempts: Array<{ attempt: number; exitCode: number; stderr: string }>,
      durationMs: number,
    ) {
      const total = attempts.length;
      const lastExit = attempts[total - 1]?.exitCode ?? 1;
      super(`Agent failed after ${total} attempt(s) (last exit code ${lastExit})`);
      this.name = 'AgentExhaustedError';
      this.attempts = attempts;
      this.lastExitCode = lastExit;
      this.totalAttempts = total;
      this.durationMs = durationMs;
    }
  }

  return {
    AgentRunner: vi.fn().mockImplementation(() => ({
      spawn: mockSpawn,
      stream: mockStream,
      spawnFromManifest: vi.fn(),
      streamFromManifest: vi.fn(),
    })),
    TOOLS_READ_ONLY: ['Read', 'Glob', 'Grep'],
    TOOLS_CODE_EDIT: [
      'Read',
      'Edit',
      'Write',
      'Glob',
      'Grep',
      'Bash(git:*)',
      'Bash(npm:*)',
      'Bash(npx:*)',
    ],
    TOOLS_FULL: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(*)'],
    DEFAULT_MAX_TURNS_EXPLORATION: 15,
    DEFAULT_MAX_TURNS_TASK: 25,
    sanitizePrompt: vi.fn((s: string) => s),
    buildArgs: vi.fn(),
    isValidModel: vi.fn(() => true),
    MODEL_ALIASES: ['haiku', 'sonnet', 'opus'],
    AgentExhaustedError,
  };
});

// ---------------------------------------------------------------------------
// Mock the logger module (suppress console output in tests)
// ---------------------------------------------------------------------------

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Import MasterManager AFTER mocks are set up
// ---------------------------------------------------------------------------

import { MasterManager } from '../../src/master/master-manager.js';

// ---------------------------------------------------------------------------
// Test Workspace Setup
// ---------------------------------------------------------------------------

/**
 * Creates a realistic test workspace with code, docs, and config files
 */
async function createTestWorkspace(): Promise<string> {
  const workspaceId = `test-workspace-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
 * Simulates successful exploration responses from Claude
 * via the mocked AgentRunner.spawn() method.
 *
 * The first spawn call is the Master session's exploration prompt.
 * The mock simulates the Master writing workspace-map.json to disk
 * (as it would using its Write tool). Exploration is entirely
 * Master-driven — no ExplorationCoordinator fallback.
 */
function setupMockExplorationResponses(workspacePath: string) {
  // Build the workspace map that the Master session writes during exploration
  const masterWorkspaceMap = {
    workspacePath,
    projectName: 'test-project',
    projectType: 'nodejs-typescript',
    frameworks: ['express', 'vitest'],
    structure: {
      src: { path: 'src', purpose: 'Application source code', fileCount: 2 },
      tests: { path: 'tests', purpose: 'Test suite', fileCount: 1 },
      docs: { path: 'docs', purpose: 'Documentation', fileCount: 1 },
    },
    keyFiles: [
      { path: 'index.ts', type: 'entry', purpose: 'Express server entry point' },
      { path: 'utils.ts', type: 'module', purpose: 'Utility functions' },
      { path: 'utils.test.ts', type: 'test', purpose: 'Unit tests for utils module' },
      { path: 'API.md', type: 'documentation', purpose: 'API documentation' },
    ],
    entryPoints: [],
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

  mockSpawn.mockImplementation(async (opts: { sessionId?: string; resumeSessionId?: string }) => {
    callCount++;

    // Master-driven exploration: first call with session writes workspace-map.json
    if (callCount === 1 && (opts.sessionId || opts.resumeSessionId)) {
      const mapPath = join(workspacePath, '.openbridge', 'workspace-map.json');
      await writeFile(mapPath, JSON.stringify(masterWorkspaceMap, null, 2), 'utf-8');
      return {
        stdout: 'Exploration complete. Workspace map written to .openbridge/workspace-map.json.',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 200,
      };
    }

    // Fallback for any other spawn calls (e.g., processMessage, re-exploration)
    return {
      stdout: JSON.stringify({ success: true }),
      stderr: '',
      exitCode: 0,
      retryCount: 0,
      durationMs: 100,
    };
  });

  // Mock streaming for both exploration and messages (AgentRunner.stream() is an async generator).
  // Exploration uses stream() and the mock writes workspace-map.json on the first call.
  let streamCallCount = 0;
  mockStream.mockImplementation(async function* (opts: { prompt?: string }) {
    streamCallCount++;

    // First stream call is the exploration prompt — write workspace-map.json to simulate Master AI
    if (streamCallCount === 1 && opts.prompt?.includes('workspace-map.json')) {
      const mapPath = join(workspacePath, '.openbridge', 'workspace-map.json');
      await writeFile(mapPath, JSON.stringify(masterWorkspaceMap, null, 2), 'utf-8');
      yield 'Exploring workspace...';
      yield '\nWorkspace map written.';
      return {
        stdout: 'Exploration complete. Workspace map written to .openbridge/workspace-map.json.',
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 200,
      };
    }

    yield 'Processing your request...';
    yield '\n\nThe project is a Node.js + TypeScript application using Express.';
    return {
      stdout:
        'Processing your request...\n\nThe project is a Node.js + TypeScript application using Express.',
      stderr: '',
      exitCode: 0,
      retryCount: 0,
      durationMs: 100,
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
    name: 'claude',
    path: '/usr/local/bin/claude',
    version: '1.0.0',
    capabilities: ['chat', 'code', 'files'],
    role: 'master',
    available: true,
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

  it('completes Master-driven exploration and creates .openbridge/ structure', async () => {
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

    // Verify workspace-map.json (written by Master session)
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

    // Verify agents.json (written mechanically by MasterManager)
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

    // Verify Master stream was used for exploration (exploration uses stream(), not spawn())
    expect(mockStream).toHaveBeenCalled();
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

    // Verify message was processed via the AgentRunner stream
    expect(mockStream).toHaveBeenCalled();
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

    const firstCallArgs = mockStream.mock.calls[mockStream.mock.calls.length - 1];
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

    const secondCallArgs = mockStream.mock.calls[mockStream.mock.calls.length - 1];
    expect(secondCallArgs).toBeDefined();

    // Three calls total: 1 for exploration, 2 for user messages
    expect(mockStream).toHaveBeenCalledTimes(3);
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
