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
 * Exploration uses ExplorationCoordinator which calls spawn() for each phase:
 * 1. Structure Scan — returns StructureScan JSON
 * 2. Classification — returns Classification JSON
 * 3. Directory Dives — returns DirectoryDiveResult JSON per directory
 * 4. Assembly — returns { summary } JSON
 *
 * Message processing uses spawn() for Master session calls and stream() for streaming.
 */
function setupMockExplorationResponses(workspacePath: string) {
  // Phase responses for ExplorationCoordinator
  const structureScan = {
    workspacePath,
    topLevelFiles: ['package.json', 'tsconfig.json', 'README.md'],
    topLevelDirs: ['src', 'tests', 'docs'],
    directoryCounts: { src: 2, tests: 1, docs: 1 },
    configFiles: ['package.json', 'tsconfig.json'],
    skippedDirs: ['node_modules', '.git'],
    totalFiles: 7,
    scannedAt: new Date().toISOString(),
    durationMs: 100,
  };

  const classification = {
    projectType: 'nodejs-typescript',
    projectName: 'test-project',
    frameworks: ['express', 'vitest'],
    commands: { dev: 'npm run dev', test: 'npm run test' },
    dependencies: [
      { name: 'express', version: '^4.18.0', type: 'runtime' },
      { name: 'vitest', version: '^1.0.0', type: 'dev' },
    ],
    insights: ['TypeScript project with strict mode', 'Uses Vitest for testing'],
    classifiedAt: new Date().toISOString(),
    durationMs: 100,
  };

  const directoryDive = {
    path: 'src',
    purpose: 'Application source code',
    keyFiles: [
      { path: 'src/index.ts', type: 'entry', purpose: 'Express server entry point' },
      { path: 'src/utils.ts', type: 'module', purpose: 'Utility functions' },
    ],
    subdirectories: [],
    fileCount: 2,
    insights: ['Uses ESM imports'],
    exploredAt: new Date().toISOString(),
    durationMs: 100,
  };

  const summaryResult = {
    summary:
      'A Node.js + TypeScript project using Express. Includes source code in src/, tests in tests/, and API docs.',
  };

  // Coordinator calls spawn() with prompts containing phase-specific title lines.
  // IMPORTANT: Match on the unique title (# Task: ...) to avoid false matches,
  // since later phases embed earlier results in their prompt text.
  mockSpawn.mockImplementation(async (opts: { prompt?: string }) => {
    const prompt = opts.prompt ?? '';

    // Phase 4: Summary (check BEFORE classification — summary prompt is unambiguous)
    if (prompt.includes('# Task: Generate Workspace Summary')) {
      return {
        stdout: JSON.stringify(summaryResult),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    // Phase 3: Directory Dive (check BEFORE structure scan — title is unambiguous)
    if (prompt.includes('# Task: Directory Exploration')) {
      // Return a dive result with the path from the prompt
      const dirMatch = prompt.match(/# Task: Directory Exploration — (\w+)/);
      const dirPath = dirMatch?.[1] ?? 'src';
      return {
        stdout: JSON.stringify({ ...directoryDive, path: dirPath }),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    // Phase 2: Classification (check BEFORE structure scan — classification prompt
    // embeds "Structure Scan Results" text, so a naive check would match Phase 1)
    if (prompt.includes('# Task: Project Classification')) {
      return {
        stdout: JSON.stringify(classification),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    // Phase 1: Structure Scan
    if (prompt.includes('# Task: Workspace Structure Scan')) {
      return {
        stdout: JSON.stringify(structureScan),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    // Fallback for any other spawn calls (e.g., processMessage, classification)
    return {
      stdout: JSON.stringify({ success: true }),
      stderr: '',
      exitCode: 0,
      retryCount: 0,
      durationMs: 100,
    };
  });

  // Mock streaming for message processing (stream() is an async generator)
  mockStream.mockImplementation(async function* () {
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

    // workspace-map.json is no longer written to disk (OB-810): it is stored in DB only
    // (requires MemoryManager to retrieve). Verify via the in-memory exploration summary instead.
    const explorationSummary = masterManager.getExplorationSummary();
    expect(explorationSummary).toBeDefined();
    expect(explorationSummary?.status).toBe('completed');

    // Verify agents.json (written mechanically by MasterManager)
    const agentsPath = join(dotFolderPath, 'agents.json');
    await expect(access(agentsPath)).resolves.toBeUndefined();

    const agentsContent = await readFile(agentsPath, 'utf-8');
    const agents = JSON.parse(agentsContent) as {
      master: { name: string };
    };
    expect(agents.master).toBeDefined();
    expect(agents.master.name).toBe('claude');

    // exploration.log is no longer written to disk (OB-802): logging goes to DB via memory.logExploration()

    // Verify coordinator used spawn() for multi-agent exploration (not stream())
    expect(mockSpawn).toHaveBeenCalled();
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

    // Two stream calls for user messages (exploration uses spawn via coordinator)
    expect(mockStream).toHaveBeenCalledTimes(2);
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
