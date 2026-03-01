import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { ConsoleConnector } from '../../../src/connectors/console/console-connector.js';
import type { InboundMessage } from '../../../src/types/message.js';

// Mock readline to avoid real stdin/stdout interaction
vi.mock('node:readline', () => {
  const emitter = new EventEmitter();
  const mockRl = Object.assign(emitter, {
    prompt: vi.fn(),
    close: vi.fn(() => {
      emitter.emit('close');
    }),
  });

  return {
    createInterface: vi.fn(() => mockRl),
    __mockRl: mockRl,
  };
});

// Suppress logger output
vi.mock('../../../src/core/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

async function getMockRl() {
  const mod = await import('node:readline');
  return (
    mod as unknown as {
      __mockRl: EventEmitter & {
        prompt: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      };
    }
  ).__mockRl;
}

describe('ConsoleConnector', () => {
  let connector: ConsoleConnector;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    connector = new ConsoleConnector({});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(async () => {
    stdoutSpy.mockRestore();
    if (connector.isConnected()) {
      await connector.shutdown();
    }
  });

  it('should have name "console"', () => {
    expect(connector.name).toBe('console');
  });

  it('should start disconnected', () => {
    expect(connector.isConnected()).toBe(false);
  });

  it('should connect on initialize and emit ready', async () => {
    const readyHandler = vi.fn();
    connector.on('ready', readyHandler);

    await connector.initialize();

    expect(connector.isConnected()).toBe(true);
    expect(readyHandler).toHaveBeenCalledOnce();
  });

  it('should accept custom config via Zod schema', () => {
    const custom = new ConsoleConnector({ userId: 'test-user', prompt: '$ ' });
    expect(custom.name).toBe('console');
  });

  it('should emit message events on stdin input', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();

    const mockRl = await getMockRl();
    mockRl.emit('line', 'hello world');

    expect(messageHandler).toHaveBeenCalledOnce();
    const msg = messageHandler.mock.calls[0]![0] as InboundMessage;
    expect(msg.source).toBe('console');
    expect(msg.rawContent).toBe('hello world');
    expect(msg.content).toBe('hello world');
    expect(msg.sender).toBe('console-user');
    expect(msg.id).toBe('console-1');
  });

  it('should ignore empty lines', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();

    const mockRl = await getMockRl();
    mockRl.emit('line', '');
    mockRl.emit('line', '   ');

    expect(messageHandler).not.toHaveBeenCalled();
  });

  it('should increment message IDs', async () => {
    const messageHandler = vi.fn();
    connector.on('message', messageHandler);

    await connector.initialize();

    const mockRl = await getMockRl();
    mockRl.emit('line', 'first');
    mockRl.emit('line', 'second');

    expect(messageHandler).toHaveBeenCalledTimes(2);
    expect((messageHandler.mock.calls[0]![0] as InboundMessage).id).toBe('console-1');
    expect((messageHandler.mock.calls[1]![0] as InboundMessage).id).toBe('console-2');
  });

  it('should write outbound messages to stdout', async () => {
    await connector.initialize();

    await connector.sendMessage({
      target: 'console',
      recipient: 'console-user',
      content: 'Hello from AI',
    });

    expect(stdoutSpy).toHaveBeenCalledWith('\nHello from AI\n');
  });

  it('should throw when sending while disconnected', async () => {
    await expect(
      connector.sendMessage({
        target: 'console',
        recipient: 'console-user',
        content: 'test',
      }),
    ).rejects.toThrow('Console connector is not connected');
  });

  it('should send typing indicator to stdout', async () => {
    await connector.initialize();
    await connector.sendTypingIndicator('console-user');
    expect(stdoutSpy).toHaveBeenCalledWith('...\n');
  });

  it('should silently skip typing indicator when disconnected', async () => {
    await connector.sendTypingIndicator('console-user');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('should overwrite the current line for progress events', async () => {
    await connector.initialize();
    await connector.sendProgress({ type: 'classifying' }, 'console-user');
    expect(stdoutSpy).toHaveBeenCalledWith('\r[Analyzing request...]');
  });

  it('should overwrite line for spawning progress event', async () => {
    await connector.initialize();
    await connector.sendProgress({ type: 'spawning', workerCount: 3 }, 'console-user');
    expect(stdoutSpy).toHaveBeenCalledWith('\r[Spawning 3 workers...]');
  });

  it('should clear the status line on complete', async () => {
    await connector.initialize();
    await connector.sendProgress({ type: 'complete' }, 'console-user');
    expect(stdoutSpy).toHaveBeenCalledWith('\r\x1b[K');
  });

  it('should silently skip progress when disconnected', async () => {
    await connector.sendProgress({ type: 'classifying' }, 'console-user');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('should format worker-turn-progress event with workerId, turns, and lastAction', async () => {
    await connector.initialize();
    await connector.sendProgress(
      {
        type: 'worker-turn-progress',
        workerId: 'worker-abc-123-xyz',
        turnsUsed: 3,
        turnsMax: 25,
        lastAction: 'Reading src/index.ts',
      },
      'console-user',
    );
    // workerId is sliced to 8 chars: 'worker-abc-123-xyz'.slice(0,8) = 'worker-a'
    expect(stdoutSpy).toHaveBeenCalledWith(
      '\r[Worker worker-a — turn 3/25 (Reading src/index.ts)]',
    );
  });

  it('should format worker-turn-progress event without lastAction', async () => {
    await connector.initialize();
    await connector.sendProgress(
      {
        type: 'worker-turn-progress',
        workerId: 'worker-abc-123-xyz',
        turnsUsed: 5,
        turnsMax: 15,
      },
      'console-user',
    );
    // workerId is sliced to 8 chars: 'worker-abc-123-xyz'.slice(0,8) = 'worker-a'
    expect(stdoutSpy).toHaveBeenCalledWith('\r[Worker worker-a — turn 5/15]');
  });

  it('should emit disconnected when stdin closes', async () => {
    const disconnectedHandler = vi.fn();
    connector.on('disconnected', disconnectedHandler);

    await connector.initialize();

    const mockRl = await getMockRl();
    mockRl.emit('close');

    expect(disconnectedHandler).toHaveBeenCalledWith('stdin closed');
    expect(connector.isConnected()).toBe(false);
  });

  it('should disconnect on shutdown', async () => {
    await connector.initialize();
    expect(connector.isConnected()).toBe(true);

    await connector.shutdown();
    expect(connector.isConnected()).toBe(false);
  });
});
