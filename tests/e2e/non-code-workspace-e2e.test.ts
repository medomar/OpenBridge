/**
 * Non-Code Workspace E2E Test
 *
 * Validates OpenBridge functionality for business use cases beyond code.
 * Tests a cafe scenario with inventory spreadsheets, sales data, and staff schedules.
 *
 * Verifies:
 * 1. Exploration works on non-code workspaces (CSVs, text, markdown)
 * 2. Business-style questions get accurate responses
 * 3. Response tone is non-technical and business-appropriate
 * 4. No crashes or empty responses when querying available data
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdir, writeFile, rm, readFile, access } from 'node:fs/promises';
import { MasterManager } from '../../src/master/master-manager.js';
import type { DiscoveredTool } from '../../src/types/discovery.js';
import type { InboundMessage } from '../../src/types/message.js';

// Mock the AgentRunner class used by MasterManager, ExplorationCoordinator, and DelegationCoordinator
const mockSpawn = vi.fn();
const mockStream = vi.fn();
vi.mock('../../src/core/agent-runner.js', () => ({
  AgentRunner: vi.fn().mockImplementation(() => ({
    spawn: mockSpawn,
    stream: mockStream,
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
  AgentExhaustedError: class AgentExhaustedError extends Error {},
}));

vi.mock('../../src/core/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Test Workspace Setup: Cafe Business Files
// ---------------------------------------------------------------------------

/**
 * Creates a realistic cafe workspace with inventory, sales, and schedules
 */
async function createCafeWorkspace(): Promise<string> {
  const workspaceId = `test-workspace-${Date.now()}`;
  const workspacePath = join(tmpdir(), workspaceId);

  await mkdir(workspacePath, { recursive: true });

  // Create business folder structure
  await mkdir(join(workspacePath, 'inventory'), { recursive: true });
  await mkdir(join(workspacePath, 'sales'), { recursive: true });
  await mkdir(join(workspacePath, 'staff'), { recursive: true });
  await mkdir(join(workspacePath, 'suppliers'), { recursive: true });

  // inventory/stock.csv
  await writeFile(
    join(workspacePath, 'inventory', 'stock.csv'),
    [
      'Item,Quantity,Unit,Reorder Level,Supplier',
      'Milk,25,Liters,50,DairyFresh Co',
      'Coffee Beans,8,Kg,10,CoffeePro Imports',
      'Butter,3,Kg,10,DairyFresh Co',
      'Sugar,15,Kg,20,GeneralSupplies Inc',
      'Flour,40,Kg,30,GeneralSupplies Inc',
      'Eggs,120,Pieces,200,LocalFarm Foods',
    ].join('\n'),
  );

  // sales/january-2026.csv
  await writeFile(
    join(workspacePath, 'sales', 'january-2026.csv'),
    [
      'Date,Item,Quantity,Price,Total',
      '2026-01-15,Espresso,45,3.50,157.50',
      '2026-01-15,Cappuccino,38,4.50,171.00',
      '2026-01-15,Croissant,22,2.50,55.00',
      '2026-01-16,Espresso,52,3.50,182.00',
      '2026-01-16,Latte,41,4.50,184.50',
      '2026-01-16,Muffin,18,3.00,54.00',
      '2026-01-17,Espresso,48,3.50,168.00',
      '2026-01-17,Cappuccino,35,4.50,157.50',
    ].join('\n'),
  );

  // sales/february-2026.csv
  await writeFile(
    join(workspacePath, 'sales', 'february-2026.csv'),
    [
      'Date,Item,Quantity,Price,Total',
      '2026-02-10,Espresso,58,3.50,203.00',
      '2026-02-10,Cappuccino,42,4.50,189.00',
      '2026-02-10,Croissant,28,2.50,70.00',
      '2026-02-11,Latte,50,4.50,225.00',
      '2026-02-11,Espresso,55,3.50,192.50',
    ].join('\n'),
  );

  // staff/schedule-week8.txt
  await writeFile(
    join(workspacePath, 'staff', 'schedule-week8.txt'),
    [
      'Cafe Staff Schedule - Week 8 (Feb 17-23, 2026)',
      '',
      'Monday:',
      '  Morning (6am-12pm): Ahmed, Sara',
      '  Afternoon (12pm-6pm): Maria, John',
      '',
      'Tuesday:',
      '  Morning: Sara, John',
      '  Afternoon: Ahmed, Maria',
      '',
      'Wednesday:',
      '  Morning: Ahmed, Maria',
      '  Afternoon: Sara, John',
      '',
      'Thursday:',
      '  Morning: Sara, Ahmed',
      '  Afternoon: John, Maria',
      '',
      'Friday:',
      '  Morning: Maria, John',
      '  Afternoon: Ahmed, Sara',
      '',
      'Saturday:',
      '  All Day (8am-6pm): Ahmed, Sara, Maria',
      '',
      'Sunday:',
      '  Closed',
    ].join('\n'),
  );

  // suppliers/contacts.md
  await writeFile(
    join(workspacePath, 'suppliers', 'contacts.md'),
    [
      '# Supplier Contacts',
      '',
      '## DairyFresh Co',
      '- **Contact:** Omar Hassan',
      '- **Phone:** +20-123-456-789',
      '- **Email:** orders@dairyfresh.eg',
      '- **Products:** Milk, Butter, Cream, Cheese',
      '- **Delivery Days:** Monday, Thursday',
      '',
      '## CoffeePro Imports',
      '- **Contact:** Amina El-Sayed',
      '- **Phone:** +20-987-654-321',
      '- **Email:** supply@coffeepro.eg',
      '- **Products:** Coffee Beans (Arabica, Robusta), Tea',
      '- **Delivery Days:** Tuesday',
      '',
      '## GeneralSupplies Inc',
      '- **Contact:** Youssef Ahmed',
      '- **Phone:** +20-555-123-456',
      '- **Email:** sales@generalsupplies.eg',
      '- **Products:** Sugar, Flour, Spices, Cleaning Supplies',
      '- **Delivery Days:** Wednesday',
      '',
      '## LocalFarm Foods',
      '- **Contact:** Fatima Nour',
      '- **Phone:** +20-444-789-012',
      '- **Email:** farm@localfarm.eg',
      '- **Products:** Eggs, Fresh Produce',
      '- **Delivery Days:** Daily (morning delivery)',
    ].join('\n'),
  );

  // menu.txt
  await writeFile(
    join(workspacePath, 'menu.txt'),
    [
      'Cafe Menu - 2026',
      '',
      'Hot Drinks:',
      '  Espresso - 3.50 EGP',
      '  Cappuccino - 4.50 EGP',
      '  Latte - 4.50 EGP',
      '  Americano - 3.00 EGP',
      '',
      'Pastries:',
      '  Croissant - 2.50 EGP',
      '  Muffin - 3.00 EGP',
      '  Danish - 3.50 EGP',
      '',
      'Lunch Items:',
      '  Sandwich - 8.00 EGP',
      '  Salad - 7.00 EGP',
    ].join('\n'),
  );

  // README.txt (non-technical description)
  await writeFile(
    join(workspacePath, 'README.txt'),
    [
      'Cafe Business Files',
      '',
      'This folder contains all our cafe business data:',
      '- Inventory tracking (stock.csv)',
      '- Sales records by month',
      '- Staff schedules',
      '- Supplier contact information',
      '- Current menu and pricing',
      '',
      'Updated monthly by the cafe manager.',
    ].join('\n'),
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
// Mock AI Responses: Cafe Workspace
// ---------------------------------------------------------------------------

/**
 * Simulates successful incremental exploration responses for cafe workspace
 */
function setupMockCafeExplorationResponses(workspacePath: string) {
  // Pass 1: Structure scan
  const structureScanResult = {
    workspacePath,
    topLevelFiles: ['menu.txt', 'README.txt'],
    topLevelDirs: ['inventory', 'sales', 'staff', 'suppliers'],
    directoryCounts: {
      inventory: 1,
      sales: 2,
      staff: 1,
      suppliers: 1,
    },
    configFiles: [],
    skippedDirs: [],
    totalFiles: 7,
    scannedAt: new Date().toISOString(),
    durationMs: 80,
  };

  // Pass 2: Classification
  const classificationResult = {
    projectType: 'business-data',
    projectName: 'cafe-business-files',
    frameworks: [],
    commands: {},
    dependencies: [],
    insights: [
      'Small business data repository',
      'Contains inventory, sales, staff schedules, and supplier contacts',
      'Data formats: CSV, TXT, Markdown',
      'Cafe/restaurant business context',
    ],
    classifiedAt: new Date().toISOString(),
    durationMs: 90,
  };

  // Pass 3: Directory dives
  const inventoryDiveResult = {
    path: 'inventory',
    purpose: 'Inventory tracking',
    keyFiles: [
      {
        path: 'stock.csv',
        type: 'data',
        purpose: 'Current stock levels with reorder thresholds',
      },
    ],
    subdirectories: [],
    fileCount: 1,
    insights: ['Tracks items like milk, coffee beans, butter with quantities and suppliers'],
    exploredAt: new Date().toISOString(),
    durationMs: 40,
  };

  const salesDiveResult = {
    path: 'sales',
    purpose: 'Sales records',
    keyFiles: [
      { path: 'january-2026.csv', type: 'data', purpose: 'January 2026 sales data' },
      { path: 'february-2026.csv', type: 'data', purpose: 'February 2026 sales data' },
    ],
    subdirectories: [],
    fileCount: 2,
    insights: ['Daily sales records with item quantities and revenue'],
    exploredAt: new Date().toISOString(),
    durationMs: 50,
  };

  const staffDiveResult = {
    path: 'staff',
    purpose: 'Staff schedules',
    keyFiles: [{ path: 'schedule-week8.txt', type: 'data', purpose: 'Week 8 staff schedule' }],
    subdirectories: [],
    fileCount: 1,
    insights: ['Staff shift assignments for the week'],
    exploredAt: new Date().toISOString(),
    durationMs: 40,
  };

  const suppliersDiveResult = {
    path: 'suppliers',
    purpose: 'Supplier contacts',
    keyFiles: [
      { path: 'contacts.md', type: 'documentation', purpose: 'Supplier contact information' },
    ],
    subdirectories: [],
    fileCount: 1,
    insights: ['Contact details for dairy, coffee, and general supplies vendors'],
    exploredAt: new Date().toISOString(),
    durationMs: 40,
  };

  // Pass 4: Assembly (workspace-map.json)
  const assemblyResult = {
    workspacePath,
    projectName: 'cafe-business-files',
    projectType: 'business-data',
    frameworks: [],
    structure: {
      inventory: { path: 'inventory', purpose: 'Inventory tracking', fileCount: 1 },
      sales: { path: 'sales', purpose: 'Sales records', fileCount: 2 },
      staff: { path: 'staff', purpose: 'Staff schedules', fileCount: 1 },
      suppliers: { path: 'suppliers', purpose: 'Supplier contacts', fileCount: 1 },
    },
    keyFiles: [
      { path: 'inventory/stock.csv', type: 'data', purpose: 'Current stock levels' },
      { path: 'sales/january-2026.csv', type: 'data', purpose: 'January sales data' },
      { path: 'sales/february-2026.csv', type: 'data', purpose: 'February sales data' },
      { path: 'staff/schedule-week8.txt', type: 'data', purpose: 'Staff schedule' },
      { path: 'suppliers/contacts.md', type: 'documentation', purpose: 'Supplier contacts' },
      { path: 'menu.txt', type: 'data', purpose: 'Cafe menu and pricing' },
    ],
    entryPoints: [],
    commands: {},
    dependencies: [],
    summary:
      'A cafe business data repository containing inventory tracking, sales records, staff schedules, and supplier information. Uses CSV, text, and markdown formats.',
    generatedAt: new Date().toISOString(),
    schemaVersion: '1.0.0',
  };

  let callCount = 0;

  mockSpawn.mockImplementation(async () => {
    callCount++;

    if (callCount === 1) {
      return {
        stdout: JSON.stringify(structureScanResult),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    if (callCount === 2) {
      return {
        stdout: JSON.stringify(classificationResult),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    // Calls 3-6: Directory dives (inventory, sales, staff, suppliers)
    if (callCount === 3) {
      return {
        stdout: JSON.stringify(inventoryDiveResult),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    if (callCount === 4) {
      return {
        stdout: JSON.stringify(salesDiveResult),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    if (callCount === 5) {
      return {
        stdout: JSON.stringify(staffDiveResult),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    if (callCount === 6) {
      return {
        stdout: JSON.stringify(suppliersDiveResult),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    // Call 7: Assembly (summary generation)
    if (callCount === 7) {
      return {
        stdout: JSON.stringify({ summary: assemblyResult.summary }),
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    // Fallback for any additional spawn calls (e.g. processMessage, re-explore)
    return {
      stdout: JSON.stringify({ success: true }),
      stderr: '',
      exitCode: 0,
      retryCount: 0,
      durationMs: 100,
    };
  });

  // Mock streaming for business-appropriate responses
  mockStream.mockImplementation(function (opts: { prompt: string }) {
    // Detect query type and provide business-appropriate responses
    let content: string;

    if (
      opts.prompt.toLowerCase().includes('low') ||
      opts.prompt.toLowerCase().includes('reorder')
    ) {
      content =
        'Looking at your current inventory...\n\nBased on stock.csv, these items are running low:\n\n' +
        '\u2022 Milk: 25L (reorder level: 50L) - needs restocking\n' +
        '\u2022 Coffee Beans: 8kg (reorder level: 10kg) - almost at threshold\n' +
        '\u2022 Butter: 3kg (reorder level: 10kg) - urgently needs restocking\n\n' +
        'I recommend ordering from your suppliers soon.';
    } else if (
      opts.prompt.toLowerCase().includes('saturday') &&
      opts.prompt.toLowerCase().includes('schedule')
    ) {
      content =
        'Checking the staff schedule...\n\nFor Saturday, you have:\n' +
        'Ahmed, Sara, and Maria scheduled all day (8am-6pm)\n\n' +
        'This is your full team for the busy weekend shift.';
    } else if (
      opts.prompt.toLowerCase().includes('revenue') ||
      opts.prompt.toLowerCase().includes('sales')
    ) {
      content =
        'Looking at your sales data...\n\nFrom the February 2026 records I can see:\n' +
        '\u2022 Feb 10: 462.00 EGP (Espresso, Cappuccino, Croissant)\n' +
        '\u2022 Feb 11: 417.50 EGP (Latte, Espresso)\n\n' +
        'Your sales are looking healthy! Espresso and Latte are your top sellers.';
    } else if (
      opts.prompt.toLowerCase().includes('dairy') ||
      opts.prompt.toLowerCase().includes('supplier')
    ) {
      content =
        'Looking up your supplier contacts...\n\nYour dairy supplier is DairyFresh Co:\n' +
        '\u2022 Contact: Omar Hassan\n' +
        '\u2022 Phone: +20-123-456-789\n' +
        '\u2022 Email: orders@dairyfresh.eg\n' +
        '\u2022 Delivers on: Monday and Thursday\n\n' +
        'They supply milk, butter, cream, and cheese.';
    } else {
      content =
        "I've reviewed your cafe business files.\n\n" +
        'You have inventory tracking, sales records, staff schedules, and supplier contacts all organized in this folder.\n\n' +
        'How can I help you manage your cafe today?';
    }

    // Return an async generator that yields the content as a single chunk,
    // then returns the AgentResult
    async function* generate(): AsyncGenerator<
      string,
      { stdout: string; stderr: string; exitCode: number; retryCount: number; durationMs: number }
    > {
      yield content;
      return {
        stdout: content,
        stderr: '',
        exitCode: 0,
        retryCount: 0,
        durationMs: 100,
      };
    }

    return generate();
  });
}

// ---------------------------------------------------------------------------
// E2E Tests: Non-Code Workspace
// ---------------------------------------------------------------------------

describe('E2E: Non-Code Workspace - Cafe Business Files', () => {
  let workspacePath: string;
  let masterManager: MasterManager;

  const mockMasterTool: DiscoveredTool = {
    name: 'claude',
    path: '/usr/local/bin/claude',
    version: '1.0.0',
    role: 'master',
    capabilities: ['chat', 'code', 'files'],
    available: true,
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    workspacePath = await createCafeWorkspace();
    setupMockCafeExplorationResponses(workspacePath);
  });

  afterEach(async () => {
    if (masterManager) {
      await masterManager.shutdown();
    }
    await cleanupWorkspace(workspacePath);
  });

  // ---------------------------------------------------------------------------
  // Test 1: Exploration Works on Non-Code Workspace
  // ---------------------------------------------------------------------------

  it('successfully explores a non-code workspace and creates .openbridge/ structure', async () => {
    masterManager = new MasterManager({
      workspacePath,
      masterTool: mockMasterTool,
      discoveredTools: [mockMasterTool],
      explorationTimeout: 10_000,
    });

    await masterManager.start();

    // Wait for exploration to complete
    let attempts = 0;
    const maxAttempts = 20;
    while (masterManager.getState() === 'exploring' && attempts < maxAttempts) {
      await new Promise((r) => setTimeout(r, 500));
      attempts++;
    }

    expect(masterManager.getState()).toBe('ready');

    // Verify .openbridge/ folder structure
    const dotFolderPath = join(workspacePath, '.openbridge');
    await expect(access(dotFolderPath)).resolves.toBeUndefined();

    // Verify workspace-map.json
    const mapPath = join(dotFolderPath, 'workspace-map.json');
    await expect(access(mapPath)).resolves.toBeUndefined();

    const mapContent = await readFile(mapPath, 'utf-8');
    const map = JSON.parse(mapContent) as {
      projectType: string;
      summary: string;
      structure: Record<string, unknown>;
    };

    expect(map.projectType).toBe('business-data');
    expect(map.summary).toContain('cafe');
    expect(map.structure).toHaveProperty('inventory');
    expect(map.structure).toHaveProperty('sales');
    expect(map.structure).toHaveProperty('staff');
    expect(map.structure).toHaveProperty('suppliers');
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 2: Business-Style Inventory Query
  // ---------------------------------------------------------------------------

  it('answers inventory questions with accurate business-appropriate responses', async () => {
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

    // Send business-style inventory query
    const message: InboundMessage = {
      id: 'msg-inventory',
      source: 'console',
      sender: '+1234567890',
      rawContent: '/ai what ingredients are running low this week?',
      content: 'what ingredients are running low this week?',
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // Verify response is accurate
    expect(responseContent.toLowerCase()).toContain('milk');
    expect(responseContent.toLowerCase()).toContain('butter');
    expect(responseContent.toLowerCase()).toContain('coffee');

    // Verify response is non-technical (no code terms, business-friendly)
    expect(responseContent.toLowerCase()).not.toContain('undefined');
    expect(responseContent.toLowerCase()).not.toContain('null');
    expect(responseContent.toLowerCase()).not.toContain('error');
    expect(responseContent.toLowerCase()).not.toContain('parse');
    expect(responseContent.toLowerCase()).not.toContain('function');
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 3: Staff Schedule Query
  // ---------------------------------------------------------------------------

  it('answers staff schedule questions accurately', async () => {
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

    // Send schedule query
    const message: InboundMessage = {
      id: 'msg-schedule',
      source: 'console',
      sender: 'owner-456',
      rawContent: "/ai who's scheduled for Saturday?",
      content: "who's scheduled for Saturday?",
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // Verify accurate staff names
    expect(responseContent).toContain('Ahmed');
    expect(responseContent).toContain('Sara');
    expect(responseContent).toContain('Maria');

    // Verify business-appropriate tone
    expect(responseContent.toLowerCase()).toMatch(/saturday|weekend/);
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 4: Sales/Revenue Query
  // ---------------------------------------------------------------------------

  it('provides accurate sales information with business-friendly formatting', async () => {
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

    // Send sales query
    const message: InboundMessage = {
      id: 'msg-sales',
      source: 'console',
      sender: 'owner-789',
      rawContent: '/ai what were the sales this month?',
      content: 'what were the sales this month?',
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // Verify contains sales data
    expect(responseContent.toLowerCase()).toMatch(/sales|revenue/);
    expect(responseContent).toMatch(/\d+/); // Contains numbers

    // Verify non-technical language
    expect(responseContent.toLowerCase()).not.toContain('csv');
    expect(responseContent.toLowerCase()).not.toContain('json');
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 5: Supplier Contact Query
  // ---------------------------------------------------------------------------

  it('retrieves supplier contact information accurately', async () => {
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

    // Send supplier query
    const message: InboundMessage = {
      id: 'msg-supplier',
      source: 'console',
      sender: 'manager-101',
      rawContent: '/ai who is our dairy supplier?',
      content: 'who is our dairy supplier?',
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // Verify accurate supplier info
    expect(responseContent).toContain('DairyFresh');
    expect(responseContent).toContain('Omar Hassan');

    // Should include contact details
    expect(responseContent).toMatch(/\+20|phone|email/i);
  }, 15000);

  // ---------------------------------------------------------------------------
  // Test 6: No Crashes on Available Data
  // ---------------------------------------------------------------------------

  it('handles queries about available data without crashes or empty responses', async () => {
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

    // Send a general query about the business
    const message: InboundMessage = {
      id: 'msg-general',
      source: 'console',
      sender: 'user-999',
      rawContent: '/ai what business data do you have access to?',
      content: 'what business data do you have access to?',
      timestamp: new Date(),
    };

    let responseContent = '';
    for await (const chunk of masterManager.streamMessage(message)) {
      responseContent += chunk;
    }

    // Verify non-empty response
    expect(responseContent.length).toBeGreaterThan(50);

    // Should mention key data types
    expect(responseContent.toLowerCase()).toMatch(/inventory|sales|staff|supplier/);

    // No crashes (test completes)
    expect(responseContent).toBeTruthy();
  }, 15000);
});
