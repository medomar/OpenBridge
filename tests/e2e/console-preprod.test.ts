import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InboundMessage } from '../../src/types/message.js';
import { ConsoleConnector } from '../../src/connectors/console/console-connector.js';

/**
 * Console-based preprod testing E2E suite
 *
 * Validates the Console connector as a rapid testing path for all use case categories.
 * No WhatsApp QR dependency, fully scriptable, CI/CD friendly.
 *
 * Test coverage:
 * - Console connector initialization and message handling
 * - Business workspace scenarios (cafe, accounting, law firm)
 * - Session continuity simulation
 * - Graceful handling of missing data queries
 * - Multi-turn conversation flow
 */

// Suppress logger output during tests
vi.mock('../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock readline to avoid real stdin/stdout interaction
// Each test gets a fresh EventEmitter instance
vi.mock('node:readline', async () => {
  const { EventEmitter } = await import('node:events');

  return {
    createInterface: vi.fn(() => {
      const emitter = new EventEmitter();
      const mockRl = Object.assign(emitter, {
        prompt: vi.fn(),
        close: vi.fn(() => {
          emitter.emit('close');
        }),
        _emitter: emitter,
      });
      return mockRl;
    }),
  };
});

async function getMockRl() {
  // Get the mock readline module
  const readlineModule = await import('node:readline');
  const createInterface = (
    readlineModule as unknown as { createInterface: ReturnType<typeof vi.fn> }
  ).createInterface;

  // Get the most recently created instance
  const calls = createInterface.mock.calls;
  if (calls.length === 0) {
    throw new Error('No readline instances created yet');
  }

  // Return the result from the most recent call
  return createInterface.mock.results[createInterface.mock.results.length - 1]!
    .value as NodeJS.EventEmitter & {
    prompt: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
}

describe('Console Preprod Testing Workflow', () => {
  let connector: ConsoleConnector;
  let receivedMessages: InboundMessage[];
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Create a fresh connector instance for each test
    receivedMessages = [];

    connector = new ConsoleConnector({
      userId: 'test-user',
      prompt: '> ',
    });

    // Track messages received by this specific test
    connector.on('message', (msg) => {
      receivedMessages.push(msg);
    });

    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await connector.initialize();
  });

  afterEach(async () => {
    stdoutSpy.mockRestore();
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  describe('Console Connector Basics', () => {
    it('should initialize and be ready for messaging', () => {
      expect(connector.isConnected()).toBe(true);
      expect(connector.name).toBe('console');
    });

    it('should receive messages from stdin and emit events', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', '/ai what is this workspace?');

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]?.content).toBe('/ai what is this workspace?');
      expect(receivedMessages[0]?.sender).toBe('test-user');
      expect(receivedMessages[0]?.source).toBe('console');
    });

    it('should send outbound messages to stdout', async () => {
      await connector.sendMessage({
        target: 'console',
        recipient: 'test-user',
        content: 'This is a test workspace with business files.',
      });

      expect(stdoutSpy).toHaveBeenCalledWith('\nThis is a test workspace with business files.\n');
    });

    it('should display typing indicator', async () => {
      await connector.sendTypingIndicator('test-user');
      expect(stdoutSpy).toHaveBeenCalledWith('...\n');
    });

    it('should ignore empty messages', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', '');
      mockRl.emit('line', '   ');

      expect(receivedMessages).toHaveLength(0);
    });
  });

  describe('Use Case Category: Cafe/Restaurant', () => {
    let testWorkspace: string;

    beforeEach(() => {
      // Create a temporary cafe workspace
      testWorkspace = join(tmpdir(), `test-cafe-${Date.now()}`);
      mkdirSync(testWorkspace, { recursive: true });

      // Create business files
      writeFileSync(
        join(testWorkspace, 'inventory.csv'),
        'item,quantity,unit,reorder_level\nMilk,45,liters,20\nCoffee Beans,12,kg,5\nSugar,30,kg,10\n',
      );

      writeFileSync(
        join(testWorkspace, 'sales-2026-02.csv'),
        'date,item,quantity,revenue\n2026-02-20,Cappuccino,35,175.00\n2026-02-20,Croissant,22,110.00\n2026-02-21,Latte,40,200.00\n',
      );

      writeFileSync(
        join(testWorkspace, 'menu.txt'),
        'Espresso - $3.50\nCappuccino - $5.00\nLatte - $5.00\nCroissant - $5.00\nBagel - $4.00\n',
      );

      writeFileSync(
        join(testWorkspace, 'schedule.csv'),
        'name,day,shift\nAhmed,Monday,Morning\nSara,Monday,Afternoon\nAhmed,Saturday,Morning\n',
      );
    });

    afterEach(() => {
      if (existsSync(testWorkspace)) {
        rmSync(testWorkspace, { recursive: true, force: true });
      }
    });

    it('should handle inventory queries', async () => {
      const mockRl = await getMockRl();

      // Simulate user asking about low stock
      mockRl.emit('line', '/ai what ingredients are running low?');

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]?.content).toContain('ingredients are running low');
      expect(receivedMessages[0]?.sender).toBe('test-user');

      // Verify message format suitable for business context
      expect(receivedMessages[0]?.rawContent).toBe('/ai what ingredients are running low?');
    });

    it('should handle sales queries', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', "/ai what was yesterday's total revenue?");

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]?.content).toContain('revenue');
    });

    it('should handle schedule queries', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', "/ai who's working Saturday morning?");

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]?.content).toContain('Saturday');
    });
  });

  describe('Use Case Category: Accounting', () => {
    it('should handle financial data queries', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', '/ai what invoices are overdue?');

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]?.content).toContain('invoices');
      expect(receivedMessages[0]?.content).toContain('overdue');
    });

    it('should handle expense queries', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', '/ai flag any expenses over $10k');

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]?.content).toContain('expenses');
    });
  });

  describe('Use Case Category: Code Projects', () => {
    it('should handle technical queries with code terminology', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', '/ai what dependencies are outdated?');

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]?.content).toContain('dependencies');
    });

    it('should handle project structure queries', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', '/ai list all files in the src/ directory');

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]?.content).toContain('src');
    });
  });

  describe('Session Continuity Simulation', () => {
    it('should support multi-turn conversations', async () => {
      const mockRl = await getMockRl();

      // First turn
      mockRl.emit('line', '/ai which invoices are overdue?');
      expect(receivedMessages).toHaveLength(1);

      // Second turn (references context from first)
      mockRl.emit('line', '/ai send reminders to those clients');
      expect(receivedMessages).toHaveLength(2);

      // Verify messages are sequential with unique IDs
      expect(receivedMessages[0]?.id).toBe('console-1');
      expect(receivedMessages[1]?.id).toBe('console-2');

      // Verify second message content references first context
      expect(receivedMessages[1]?.content).toContain('those clients');
    });

    it('should maintain user identity across messages', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', '/ai first message');
      mockRl.emit('line', '/ai second message');

      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages[0]?.sender).toBe('test-user');
      expect(receivedMessages[1]?.sender).toBe('test-user');
    });
  });

  describe('Graceful Handling of Missing Data', () => {
    it('should accept queries for data that might not exist', async () => {
      const mockRl = await getMockRl();

      // Query for data that likely doesn't exist in test workspace
      mockRl.emit('line', "/ai what's today's revenue?");

      expect(receivedMessages).toHaveLength(1);
      // Message should be accepted (Master AI will handle gracefully)
      expect(receivedMessages[0]?.content).toContain('revenue');
    });

    it('should accept queries for non-existent files', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', '/ai show me the quarterly report');

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]?.content).toContain('quarterly report');
    });
  });

  describe('Command Prefix Handling', () => {
    it('should preserve prefix in message content for auth layer', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', '/ai what is this workspace?');

      expect(receivedMessages).toHaveLength(1);
      // Connector passes full message (auth layer will strip prefix)
      expect(receivedMessages[0]?.content).toBe('/ai what is this workspace?');
    });

    it('should handle messages without prefix', async () => {
      const mockRl = await getMockRl();

      mockRl.emit('line', 'hello world');

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0]?.content).toBe('hello world');
      // Auth layer will reject this (not connector's job)
    });
  });

  describe('Response Formatting', () => {
    it('should format outbound messages with newlines', async () => {
      await connector.sendMessage({
        target: 'console',
        recipient: 'test-user',
        content: 'Here are your low stock items:\n- Milk (45L)\n- Coffee Beans (12kg)',
      });

      expect(stdoutSpy).toHaveBeenCalledWith(
        '\nHere are your low stock items:\n- Milk (45L)\n- Coffee Beans (12kg)\n',
      );
    });

    it('should display prompt after responses', async () => {
      const mockRl = await getMockRl();

      await connector.sendMessage({
        target: 'console',
        recipient: 'test-user',
        content: 'Response sent',
      });

      expect(mockRl.prompt).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should reject messages when disconnected', async () => {
      await connector.shutdown();

      await expect(
        connector.sendMessage({
          target: 'console',
          recipient: 'test-user',
          content: 'test',
        }),
      ).rejects.toThrow('Console connector is not connected');
    });

    it('should emit disconnected event when stdin closes', async () => {
      const mockRl = await getMockRl();
      let disconnectReason = '';

      connector.on('disconnected', (reason) => {
        disconnectReason = reason;
      });

      mockRl.emit('close');

      expect(disconnectReason).toBe('stdin closed');
      expect(connector.isConnected()).toBe(false);
    });
  });

  describe('Rapid Testing Workflow Validation', () => {
    it('should support fast message iteration (no delays)', async () => {
      const mockRl = await getMockRl();
      const start = Date.now();

      // Send 10 messages rapidly
      for (let i = 0; i < 10; i++) {
        mockRl.emit('line', `/ai query ${i + 1}`);
      }

      const elapsed = Date.now() - start;

      expect(receivedMessages).toHaveLength(10);
      expect(elapsed).toBeLessThan(100); // Should be near-instant
    });

    it('should be CI/CD friendly (no interactive prompts)', async () => {
      // Verify connector doesn't require user interaction
      expect(connector.isConnected()).toBe(true);

      const mockRl = await getMockRl();
      mockRl.emit('line', '/ai automated test query');

      expect(receivedMessages).toHaveLength(1);
      // No user interaction needed - fully scriptable
    });

    it('should support batch testing of multiple use cases', async () => {
      const mockRl = await getMockRl();

      // Software dev query
      mockRl.emit('line', '/ai run the tests');

      // Business query
      mockRl.emit('line', "/ai what was today's revenue?");

      // Data analysis query
      mockRl.emit('line', "/ai summarize this month's expenses");

      expect(receivedMessages).toHaveLength(3);

      // All messages processed sequentially
      expect(receivedMessages[0]?.id).toBe('console-1');
      expect(receivedMessages[1]?.id).toBe('console-2');
      expect(receivedMessages[2]?.id).toBe('console-3');
    });
  });
});
