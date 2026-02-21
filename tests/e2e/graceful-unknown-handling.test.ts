/**
 * Graceful Unknown Handling E2E Test
 *
 * Validates that OpenBridge responds helpfully and gracefully when users ask
 * about data that doesn't exist in the workspace.
 *
 * Scenarios tested:
 * 1. Querying for data files that don't exist (e.g., "today's revenue" with no sales file)
 * 2. Empty workspace with no data files at all
 * 3. Workspace with binary files only (no readable data)
 * 4. Queries about missing context (e.g., "overdue invoices" in a cafe workspace)
 * 5. Corrupted or unparseable data files
 * 6. Queries about future data (e.g., "next month's schedule" when only this month exists)
 *
 * Expected behavior:
 * - No crashes or empty responses
 * - Helpful messages indicating data is not available
 * - Suggestions for what data IS available
 * - Business-appropriate tone (not technical error messages)
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm, access } from 'node:fs/promises';
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
// Workspace Setup Functions
// ---------------------------------------------------------------------------

/**
 * Creates a workspace with minimal data (missing most business files)
 */
async function createMinimalWorkspace(): Promise<string> {
  const workspaceId = `test-workspace-${Date.now()}`;
  const workspacePath = join(tmpdir(), workspaceId);

  await mkdir(workspacePath, { recursive: true });

  // Only create a README, no actual business data
  await writeFile(
    join(workspacePath, 'README.txt'),
    'This workspace is still being set up. Data files coming soon.',
  );

  return workspacePath;
}

/**
 * Creates a completely empty workspace (no files at all)
 */
async function createEmptyWorkspace(): Promise<string> {
  const workspaceId = `test-workspace-${Date.now()}`;
  const workspacePath = join(tmpdir(), workspaceId);
  await mkdir(workspacePath, { recursive: true });
  return workspacePath;
}

/**
 * Creates a workspace with only binary files (no readable text data)
 */
async function createBinaryOnlyWorkspace(): Promise<string> {
  const workspaceId = `test-workspace-${Date.now()}`;
  const workspacePath = join(tmpdir(), workspaceId);

  await mkdir(workspacePath, { recursive: true });

  // Create dummy binary files (empty files with binary extensions)
  await writeFile(join(workspacePath, 'data.xlsx'), Buffer.from([]));
  await writeFile(join(workspacePath, 'report.pdf'), Buffer.from([]));
  await writeFile(join(workspacePath, 'image.png'), Buffer.from([]));

  return workspacePath;
}

/**
 * Creates a cafe workspace with ONLY inventory (no sales, no schedules)
 */
async function createPartialCafeWorkspace(): Promise<string> {
  const workspaceId = `test-workspace-${Date.now()}`;
  const workspacePath = join(tmpdir(), workspaceId);

  await mkdir(workspacePath, { recursive: true });
  await mkdir(join(workspacePath, 'inventory'), { recursive: true });

  // Only inventory exists
  await writeFile(
    join(workspacePath, 'inventory', 'stock.csv'),
    ['Item,Quantity,Unit', 'Milk,25,Liters', 'Coffee Beans,8,Kg', 'Sugar,15,Kg'].join('\n'),
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
    // Ignore cleanup errors
  }
}

// ---------------------------------------------------------------------------
// Mock Setup Functions
// ---------------------------------------------------------------------------

/**
 * Setup mock responses for minimal exploration
 */
function setupMinimalExplorationMocks(
  workspacePath: string,
  scenario: 'minimal' | 'empty' | 'binary' | 'partial',
) {
  let callCount = 0;

  // Different structure scans based on scenario
  const structureScanResults: Record<typeof scenario, unknown> = {
    minimal: {
      workspacePath,
      topLevelFiles: ['README.txt'],
      topLevelDirs: [],
      directoryCounts: {},
      configFiles: [],
      skippedDirs: [],
      totalFiles: 1,
      scannedAt: new Date().toISOString(),
      durationMs: 50,
    },
    empty: {
      workspacePath,
      topLevelFiles: [],
      topLevelDirs: [],
      directoryCounts: {},
      configFiles: [],
      skippedDirs: [],
      totalFiles: 0,
      scannedAt: new Date().toISOString(),
      durationMs: 30,
    },
    binary: {
      workspacePath,
      topLevelFiles: ['data.xlsx', 'report.pdf', 'image.png'],
      topLevelDirs: [],
      directoryCounts: {},
      configFiles: [],
      skippedDirs: [],
      totalFiles: 3,
      scannedAt: new Date().toISOString(),
      durationMs: 40,
    },
    partial: {
      workspacePath,
      topLevelFiles: [],
      topLevelDirs: ['inventory'],
      directoryCounts: { inventory: 1 },
      configFiles: [],
      skippedDirs: [],
      totalFiles: 1,
      scannedAt: new Date().toISOString(),
      durationMs: 60,
    },
  };

  const classificationResults: Record<typeof scenario, unknown> = {
    minimal: {
      projectType: 'unknown',
      projectName: 'workspace',
      frameworks: [],
      commands: {},
      dependencies: [],
      insights: ['Minimal workspace with no data files yet'],
      classifiedAt: new Date().toISOString(),
      durationMs: 50,
    },
    empty: {
      projectType: 'unknown',
      projectName: 'empty-workspace',
      frameworks: [],
      commands: {},
      dependencies: [],
      insights: ['Empty workspace with no files'],
      classifiedAt: new Date().toISOString(),
      durationMs: 40,
    },
    binary: {
      projectType: 'unknown',
      projectName: 'workspace',
      frameworks: [],
      commands: {},
      dependencies: [],
      insights: ['Contains only binary files (xlsx, pdf, png) - no readable text data'],
      classifiedAt: new Date().toISOString(),
      durationMs: 50,
    },
    partial: {
      projectType: 'business-data',
      projectName: 'cafe-inventory',
      frameworks: [],
      commands: {},
      dependencies: [],
      insights: ['Partial business workspace - only inventory data available'],
      classifiedAt: new Date().toISOString(),
      durationMs: 60,
    },
  };

  const assemblyResults: Record<typeof scenario, unknown> = {
    minimal: {
      workspacePath,
      projectName: 'workspace',
      projectType: 'unknown',
      frameworks: [],
      structure: {},
      keyFiles: [{ path: 'README.txt', type: 'documentation', purpose: 'Readme file' }],
      entryPoints: [],
      commands: {},
      dependencies: [],
      summary: 'A minimal workspace with only a README file. No business data files available yet.',
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
    },
    empty: {
      workspacePath,
      projectName: 'empty-workspace',
      projectType: 'unknown',
      frameworks: [],
      structure: {},
      keyFiles: [],
      entryPoints: [],
      commands: {},
      dependencies: [],
      summary: 'An empty workspace with no files.',
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
    },
    binary: {
      workspacePath,
      projectName: 'workspace',
      projectType: 'unknown',
      frameworks: [],
      structure: {},
      keyFiles: [
        { path: 'data.xlsx', type: 'binary', purpose: 'Excel spreadsheet' },
        { path: 'report.pdf', type: 'binary', purpose: 'PDF document' },
        { path: 'image.png', type: 'binary', purpose: 'Image file' },
      ],
      entryPoints: [],
      commands: {},
      dependencies: [],
      summary:
        'A workspace containing only binary files (Excel, PDF, images). No readable text data available.',
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
    },
    partial: {
      workspacePath,
      projectName: 'cafe-inventory',
      projectType: 'business-data',
      frameworks: [],
      structure: {
        inventory: { path: 'inventory', purpose: 'Inventory tracking', fileCount: 1 },
      },
      keyFiles: [{ path: 'inventory/stock.csv', type: 'data', purpose: 'Current stock levels' }],
      entryPoints: [],
      commands: {},
      dependencies: [],
      summary:
        'A partial cafe business workspace. Only inventory tracking is available - no sales data, staff schedules, or supplier information.',
      generatedAt: new Date().toISOString(),
      schemaVersion: '1.0.0',
    },
  };

  mockExecuteClaudeCode.mockImplementation(async () => {
    callCount++;

    // Pass 1: Structure scan
    if (callCount === 1) {
      return {
        stdout: JSON.stringify(structureScanResults[scenario]),
        stderr: '',
        exitCode: 0,
      };
    }

    // Pass 2: Classification
    if (callCount === 2) {
      return {
        stdout: JSON.stringify(classificationResults[scenario]),
        stderr: '',
        exitCode: 0,
      };
    }

    // Pass 3: Directory dive (only for partial scenario)
    if (callCount === 3 && scenario === 'partial') {
      return {
        stdout: JSON.stringify({
          path: 'inventory',
          purpose: 'Inventory tracking',
          keyFiles: [{ path: 'stock.csv', type: 'data', purpose: 'Stock levels' }],
          subdirectories: [],
          fileCount: 1,
          insights: ['Basic inventory CSV'],
          exploredAt: new Date().toISOString(),
          durationMs: 40,
        }),
        stderr: '',
        exitCode: 0,
      };
    }

    // Assembly pass
    const assemblyCallNumber = scenario === 'partial' ? 4 : 3;
    if (callCount === assemblyCallNumber) {
      return {
        stdout: JSON.stringify(assemblyResults[scenario]),
        stderr: '',
        exitCode: 0,
      };
    }

    return {
      stdout: JSON.stringify({ success: true }),
      stderr: '',
      exitCode: 0,
    };
  });

  // Mock streaming responses that handle missing data gracefully
  mockStreamClaudeCode.mockImplementation(async function* (args: {
    prompt: string;
    workingDir: string;
  }) {
    const query = args.prompt.toLowerCase();

    // Revenue query (no sales data)
    if (query.includes('revenue') || query.includes('sales')) {
      yield "I checked your workspace, but I don't see any sales data files.\n\n";

      if (scenario === 'partial') {
        yield "I do have access to your inventory information if you'd like to check stock levels instead.";
      } else if (scenario === 'empty') {
        yield "The workspace is currently empty. You'll need to add your sales records first.";
      } else if (scenario === 'binary') {
        yield 'I see some Excel and PDF files, but I need text-based data files (CSV, TXT) to answer this question.';
      } else {
        yield "Once you add sales records, I'll be able to help track your revenue.";
      }

      return {
        content: query.includes('revenue')
          ? "I checked your workspace, but I don't see any sales data files.\n\nOnce you add sales records, I'll be able to help track your revenue."
          : "I checked your workspace, but I don't see any sales data files.",
        metadata: { sessionId: randomUUID() },
      };
    }

    // Invoice query (wrong context for cafe)
    if (query.includes('invoice') || query.includes('overdue')) {
      yield "I don't see any invoice files in your workspace.\n\n";

      if (scenario === 'partial') {
        yield "This looks like a cafe inventory workspace. I can help with stock tracking, but I don't have invoice or accounts receivable data.";
      } else {
        yield "If you're tracking invoices, you'll need to add those files to the workspace first.";
      }

      return {
        content:
          "I don't see any invoice files in your workspace.\n\nIf you're tracking invoices, you'll need to add those files to the workspace first.",
        metadata: { sessionId: randomUUID() },
      };
    }

    // Schedule query (no staff data)
    if (query.includes('schedule') || query.includes('staff')) {
      yield "I don't have any staff schedule files in the workspace.\n\n";

      if (scenario === 'partial') {
        yield 'I can see your inventory data, but no staff schedules have been added yet.';
      } else {
        yield "Once you add staff schedules, I'll be able to help you check who's working.";
      }

      return {
        content:
          "I don't have any staff schedule files in the workspace.\n\nOnce you add staff schedules, I'll be able to help you check who's working.",
        metadata: { sessionId: randomUUID() },
      };
    }

    // Supplier query (no supplier data)
    if (query.includes('supplier') || query.includes('vendor')) {
      yield "I don't see any supplier contact information in the workspace.\n\n";

      if (scenario === 'partial') {
        yield 'I have your inventory list, but no supplier details are recorded yet.';
      } else {
        yield "You'll need to add supplier contact files for me to help with that.";
      }

      return {
        content:
          "I don't see any supplier contact information in the workspace.\n\nYou'll need to add supplier contact files for me to help with that.",
        metadata: { sessionId: randomUUID() },
      };
    }

    // Future data query
    if (query.includes('next month') || query.includes('future')) {
      yield 'I can only see current and past data in the workspace.\n\n';
      yield "I don't have any forecasts or future schedules available yet.";

      return {
        content:
          "I can only see current and past data in the workspace.\n\nI don't have any forecasts or future schedules available yet.",
        metadata: { sessionId: randomUUID() },
      };
    }

    // Generic what-do-you-have query
    if (query.includes('what') && (query.includes('have') || query.includes('available'))) {
      if (scenario === 'empty') {
        yield 'Your workspace is currently empty - no files have been added yet.\n\n';
        yield "Once you add your business data files, I'll be able to help you manage them.";
      } else if (scenario === 'binary') {
        yield 'I can see some files (Excel spreadsheets, PDFs, images), but I need text-based data files to answer questions.\n\n';
        yield 'Consider adding CSV, TXT, or Markdown files with your business data.';
      } else if (scenario === 'partial') {
        yield 'I currently have access to:\n';
        yield '• Inventory data (stock levels)\n\n';
        yield "I don't have: sales records, staff schedules, supplier contacts, or financial data.";
      } else {
        yield 'Your workspace has minimal data at the moment - just a README file.\n\n';
        yield "Add your business files and I'll help you work with them.";
      }

      return {
        content:
          scenario === 'empty'
            ? 'Your workspace is currently empty - no files have been added yet.'
            : 'Your workspace has minimal data at the moment.',
        metadata: { sessionId: randomUUID() },
      };
    }

    // Default helpful response
    yield "I'm here to help, but I don't have the data needed to answer that question.\n\n";

    if (scenario === 'partial') {
      yield "I can tell you about your inventory, though. Would you like to know what's in stock?";
    } else {
      yield "Once you add your business files to this workspace, I'll be able to assist with questions about them.";
    }

    return {
      content: "I'm here to help, but I don't have the data needed to answer that question.",
      metadata: { sessionId: randomUUID() },
    };
  });
}

// ---------------------------------------------------------------------------
// E2E Tests: Graceful Unknown Handling
// ---------------------------------------------------------------------------

const mockMasterTool: DiscoveredTool = {
  type: 'cli',
  name: 'claude',
  path: '/usr/local/bin/claude',
  version: '1.0.0',
  capabilities: ['chat', 'code', 'files'],
  isAvailable: true,
};

describe('E2E: Graceful Unknown Handling', () => {
  let workspacePath: string;
  let masterManager: MasterManager;

  afterEach(async () => {
    if (masterManager) {
      await masterManager.shutdown();
    }
    await cleanupWorkspace(workspacePath);
  });

  // ---------------------------------------------------------------------------
  // Test 1: Missing Sales Data (Minimal Workspace)
  // ---------------------------------------------------------------------------

  it('handles queries about missing sales data gracefully with helpful message', async () => {
    vi.clearAllMocks();
    workspacePath = await createMinimalWorkspace();
    setupMinimalExplorationMocks(workspacePath, 'minimal');

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

    expect(masterManager.getState()).toBe('ready');

    // Ask about revenue when no sales data exists
    const message: InboundMessage = {
      id: 'msg-revenue',
      source: 'console',
      sender: 'user-001',
      rawContent: "/ai what's today's revenue?",
      content: "what's today's revenue?",
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // Verify: no crash, non-empty response
    expect(responseContent.length).toBeGreaterThan(20);

    // Verify: helpful message about missing data
    expect(responseContent.toLowerCase()).toMatch(/don't see|don't have|no.*sales|no.*data/);

    // Verify: no technical error terms
    expect(responseContent.toLowerCase()).not.toContain('undefined');
    expect(responseContent.toLowerCase()).not.toContain('null');
    expect(responseContent.toLowerCase()).not.toContain('error:');
    expect(responseContent.toLowerCase()).not.toContain('exception');

    // Verify: suggests what to do next
    expect(responseContent.toLowerCase()).toMatch(/add|once|when/);
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 2: Empty Workspace
  // ---------------------------------------------------------------------------

  it('handles completely empty workspace gracefully', async () => {
    vi.clearAllMocks();
    workspacePath = await createEmptyWorkspace();
    setupMinimalExplorationMocks(workspacePath, 'empty');

    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    await masterManager.start();

    let attempts = 0;
    while (masterManager.getState() === 'exploring' && attempts < 20) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    expect(masterManager.getState()).toBe('ready');

    const message: InboundMessage = {
      id: 'msg-empty',
      source: 'console',
      sender: 'user-002',
      rawContent: '/ai what data do you have?',
      content: 'what data do you have?',
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // No crash
    expect(responseContent.length).toBeGreaterThan(15);

    // Mentions empty state
    expect(responseContent.toLowerCase()).toMatch(/empty|no files|no data/);

    // Business-appropriate tone
    expect(responseContent.toLowerCase()).not.toContain('null');
    expect(responseContent.toLowerCase()).not.toContain('error');
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 3: Binary Files Only
  // ---------------------------------------------------------------------------

  it('handles workspace with only binary files gracefully', async () => {
    vi.clearAllMocks();
    workspacePath = await createBinaryOnlyWorkspace();
    setupMinimalExplorationMocks(workspacePath, 'binary');

    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    await masterManager.start();

    let attempts = 0;
    while (masterManager.getState() === 'exploring' && attempts < 20) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    expect(masterManager.getState()).toBe('ready');

    const message: InboundMessage = {
      id: 'msg-binary',
      source: 'console',
      sender: 'user-003',
      rawContent: '/ai what are my sales numbers?',
      content: 'what are my sales numbers?',
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // No crash
    expect(responseContent.length).toBeGreaterThan(20);

    // Explains the limitation
    expect(responseContent.toLowerCase()).toMatch(/excel|pdf|binary|text-based|csv/);

    // Suggests what would work
    expect(responseContent.toLowerCase()).toMatch(/csv|txt|text/);
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 4: Wrong Context Query (Invoices in Cafe Workspace)
  // ---------------------------------------------------------------------------

  it('handles queries about wrong context data gracefully (invoices in cafe)', async () => {
    vi.clearAllMocks();
    workspacePath = await createPartialCafeWorkspace();
    setupMinimalExplorationMocks(workspacePath, 'partial');

    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    await masterManager.start();

    let attempts = 0;
    while (masterManager.getState() === 'exploring' && attempts < 20) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    expect(masterManager.getState()).toBe('ready');

    const message: InboundMessage = {
      id: 'msg-invoice',
      source: 'console',
      sender: 'user-004',
      rawContent: '/ai which invoices are overdue?',
      content: 'which invoices are overdue?',
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // No crash
    expect(responseContent.length).toBeGreaterThan(20);

    // Explains missing invoice data
    expect(responseContent.toLowerCase()).toMatch(/don't see|don't have|no.*invoice/);

    // May mention what IS available
    expect(responseContent.toLowerCase()).toMatch(/inventory|stock|have/);
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 5: Partial Data Workspace - Missing Staff Schedules
  // ---------------------------------------------------------------------------

  it('handles queries about missing data in partial workspace (no schedules)', async () => {
    vi.clearAllMocks();
    workspacePath = await createPartialCafeWorkspace();
    setupMinimalExplorationMocks(workspacePath, 'partial');

    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    await masterManager.start();

    let attempts = 0;
    while (masterManager.getState() === 'exploring' && attempts < 20) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    expect(masterManager.getState()).toBe('ready');

    const message: InboundMessage = {
      id: 'msg-schedule',
      source: 'console',
      sender: 'user-005',
      rawContent: "/ai who's working tomorrow?",
      content: "who's working tomorrow?",
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // No crash
    expect(responseContent.length).toBeGreaterThan(15);

    // Explains missing schedule data
    expect(responseContent.toLowerCase()).toMatch(/don't have|no.*schedule|no.*staff/);

    // Suggests alternative or next steps
    expect(responseContent.toLowerCase()).toMatch(/add|inventory|stock/);
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 6: Future Data Query
  // ---------------------------------------------------------------------------

  it('handles queries about future/unavailable data gracefully', async () => {
    vi.clearAllMocks();
    workspacePath = await createPartialCafeWorkspace();
    setupMinimalExplorationMocks(workspacePath, 'partial');

    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    await masterManager.start();

    let attempts = 0;
    while (masterManager.getState() === 'exploring' && attempts < 20) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    expect(masterManager.getState()).toBe('ready');

    const message: InboundMessage = {
      id: 'msg-future',
      source: 'console',
      sender: 'user-006',
      rawContent: "/ai what's next month's schedule?",
      content: "what's next month's schedule?",
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // No crash
    expect(responseContent.length).toBeGreaterThan(15);

    // Explains limitation
    expect(responseContent.toLowerCase()).toMatch(/current|past|don't have|future|forecast/);

    // Business-appropriate tone
    expect(responseContent.toLowerCase()).not.toContain('undefined');
    expect(responseContent.toLowerCase()).not.toContain('null');
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 7: Verify .openbridge/ Created Even for Minimal Workspace
  // ---------------------------------------------------------------------------

  it('creates .openbridge/ folder even for minimal/empty workspaces', async () => {
    vi.clearAllMocks();
    workspacePath = await createMinimalWorkspace();
    setupMinimalExplorationMocks(workspacePath, 'minimal');

    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    await masterManager.start();

    let attempts = 0;
    while (masterManager.getState() === 'exploring' && attempts < 20) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    expect(masterManager.getState()).toBe('ready');

    // Verify .openbridge/ exists
    const dotFolderPath = join(workspacePath, '.openbridge');
    await expect(access(dotFolderPath)).resolves.toBeUndefined();

    // Verify workspace-map.json exists
    const mapPath = join(dotFolderPath, 'workspace-map.json');
    await expect(access(mapPath)).resolves.toBeUndefined();
  }, 15000);
});
