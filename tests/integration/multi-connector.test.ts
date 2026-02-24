/**
 * Integration tests for multi-connector startup (OB-322).
 *
 * Verifies that 3+ connectors can start simultaneously, that each
 * connector receives only its own responses, and that one connector
 * failing to initialize does not block the others.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bridge } from '../../src/core/bridge.js';
import { MockProvider } from '../helpers/mock-provider.js';
import type { AppConfig } from '../../src/types/config.js';
import type { Connector, ConnectorEvents } from '../../src/types/connector.js';
import type { InboundMessage, OutboundMessage } from '../../src/types/message.js';

// ---------------------------------------------------------------------------
// Named mock connector — like MockConnector but with a configurable name
// ---------------------------------------------------------------------------

class NamedMockConnector implements Connector {
  readonly name: string;
  readonly sentMessages: OutboundMessage[] = [];
  private connected = false;
  private readonly listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  constructor(name: string) {
    this.name = name;
  }

  async initialize(): Promise<void> {
    this.connected = true;
    this.emit('ready');
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    this.sentMessages.push(message);
  }

  on<E extends keyof ConnectorEvents>(event: E, listener: ConnectorEvents[E]): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(listener as (...args: unknown[]) => void);
  }

  async shutdown(): Promise<void> {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  simulateMessage(message: InboundMessage): void {
    this.emit('message', message);
  }

  private emit(event: string, ...args: unknown[]): void {
    const handlers = this.listeners[event];
    if (handlers) {
      for (const handler of handlers) {
        handler(...args);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Config fixture for 3 connectors
// ---------------------------------------------------------------------------

function threeConnectorConfig(): AppConfig {
  return {
    defaultProvider: 'mock',
    connectors: [
      { type: 'connector-a', enabled: true, options: {} },
      { type: 'connector-b', enabled: true, options: {} },
      { type: 'connector-c', enabled: true, options: {} },
    ],
    providers: [{ type: 'mock', enabled: true, options: {} }],
    auth: {
      whitelist: ['+1234567890'],
      prefix: '/ai',
      rateLimit: { enabled: false, windowMs: 60000, maxMessages: 5 },
    },
    queue: { maxRetries: 0, retryDelayMs: 1 },
    audit: { enabled: false, logPath: 'audit.log' },
    logLevel: 'info',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Multi-connector startup (OB-322)', () => {
  let connectorA: NamedMockConnector;
  let connectorB: NamedMockConnector;
  let connectorC: NamedMockConnector;
  let provider: MockProvider;
  let bridge: Bridge;

  beforeEach(() => {
    vi.clearAllMocks();

    connectorA = new NamedMockConnector('connector-a');
    connectorB = new NamedMockConnector('connector-b');
    connectorC = new NamedMockConnector('connector-c');
    provider = new MockProvider();

    bridge = new Bridge(threeConnectorConfig());
    bridge.getRegistry().registerConnector('connector-a', () => connectorA);
    bridge.getRegistry().registerConnector('connector-b', () => connectorB);
    bridge.getRegistry().registerConnector('connector-c', () => connectorC);
    bridge.getRegistry().registerProvider('mock', () => provider);
  });

  it('initializes all 3 connectors in parallel', async () => {
    const initA = vi.spyOn(connectorA, 'initialize');
    const initB = vi.spyOn(connectorB, 'initialize');
    const initC = vi.spyOn(connectorC, 'initialize');

    await bridge.start();

    expect(initA).toHaveBeenCalledOnce();
    expect(initB).toHaveBeenCalledOnce();
    expect(initC).toHaveBeenCalledOnce();

    expect(connectorA.isConnected()).toBe(true);
    expect(connectorB.isConnected()).toBe(true);
    expect(connectorC.isConnected()).toBe(true);
  });

  it('routes response back only to the originating connector', async () => {
    provider.setResponse({ content: 'hello from AI' });

    await bridge.start();

    // Send message from connector-b only
    connectorB.simulateMessage({
      id: 'msg-b',
      source: 'connector-b',
      sender: '+1234567890',
      rawContent: '/ai hello',
      content: 'hello',
      timestamp: new Date(),
    });

    await new Promise((r) => setTimeout(r, 50));

    // connector-b got the ack + response
    expect(connectorB.sentMessages).toHaveLength(2);
    expect(connectorB.sentMessages[0]?.content).toBe('Working on it...');
    expect(connectorB.sentMessages[1]?.content).toBe('hello from AI');

    // Other connectors received nothing
    expect(connectorA.sentMessages).toHaveLength(0);
    expect(connectorC.sentMessages).toHaveLength(0);
  });

  it('routes messages from different connectors to the correct originating connector', async () => {
    provider.setResponse({ content: 'response' });

    await bridge.start();

    connectorA.simulateMessage({
      id: 'msg-a',
      source: 'connector-a',
      sender: '+1234567890',
      rawContent: '/ai from A',
      content: 'from A',
      timestamp: new Date(),
    });

    connectorC.simulateMessage({
      id: 'msg-c',
      source: 'connector-c',
      sender: '+1234567890',
      rawContent: '/ai from C',
      content: 'from C',
      timestamp: new Date(),
    });

    await new Promise((r) => setTimeout(r, 100));

    // connector-a got ack + response
    expect(connectorA.sentMessages.length).toBeGreaterThanOrEqual(2);
    const aContents = connectorA.sentMessages.map((m) => m.content);
    expect(aContents).toContain('Working on it...');
    expect(aContents).toContain('response');

    // connector-c got ack + response
    expect(connectorC.sentMessages.length).toBeGreaterThanOrEqual(2);
    const cContents = connectorC.sentMessages.map((m) => m.content);
    expect(cContents).toContain('Working on it...');
    expect(cContents).toContain('response');

    // connector-b received nothing (no message sent from it)
    expect(connectorB.sentMessages).toHaveLength(0);
  });

  it('continues startup when one connector fails to initialize', async () => {
    // Make connector-b fail on initialize
    vi.spyOn(connectorB, 'initialize').mockRejectedValueOnce(
      new Error('Simulated connector-b init failure'),
    );

    // Should not throw — bridge uses Promise.allSettled
    await expect(bridge.start()).resolves.not.toThrow();

    // connector-a and connector-c still started
    expect(connectorA.isConnected()).toBe(true);
    expect(connectorC.isConnected()).toBe(true);
  });

  it('shuts down all 3 connectors on bridge.stop()', async () => {
    await bridge.start();

    const shutA = vi.spyOn(connectorA, 'shutdown');
    const shutB = vi.spyOn(connectorB, 'shutdown');
    const shutC = vi.spyOn(connectorC, 'shutdown');

    await bridge.stop();

    expect(shutA).toHaveBeenCalledOnce();
    expect(shutB).toHaveBeenCalledOnce();
    expect(shutC).toHaveBeenCalledOnce();
  });
});
