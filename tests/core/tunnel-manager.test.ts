import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { TunnelManager, type TunnelAdapter } from '../../src/core/tunnel-manager.js';

// ── Mock child_process.spawn ─────────────────────────────────────────

interface MockChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (signal?: string) => boolean;
}

let spawnCalls: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
let mockChildren: MockChild[] = [];

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn((_signal?: string) => true);
  mockChildren.push(child);
  return child;
}

vi.mock('node:child_process', () => ({
  spawn: (command: string, args: string[], options: Record<string, unknown>) => {
    spawnCalls.push({ command, args, options });
    return createMockChild();
  },
}));

function lastChild(): MockChild {
  const child = mockChildren[mockChildren.length - 1];
  if (!child) throw new Error('No mock child created');
  return child;
}

function registerTestAdapter(toolName: string, args: string[] = []): TunnelAdapter {
  const adapter: TunnelAdapter = {
    toolName,
    buildArgs: () => args,
    parseUrl: (line: string) => {
      if (line.startsWith('https://')) {
        return line;
      }
      return null;
    },
  };
  TunnelManager.registerAdapter(adapter);
  return adapter;
}

beforeEach(() => {
  spawnCalls = [];
  mockChildren = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TunnelManager', () => {
  it('start() spawns with correct args', async () => {
    registerTestAdapter('test-tunnel', ['--port', '3000']);
    const manager = new TunnelManager('test-tunnel');

    const promise = manager.start(3000);
    const child = lastChild();
    child.stdout.emit('data', Buffer.from('https://example.com\n'));

    await promise;

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.command).toBe('test-tunnel');
    expect(spawnCalls[0]!.args).toEqual(['--port', '3000']);
    expect(spawnCalls[0]!.options).toMatchObject({
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });
  });

  it('stop() kills the process', async () => {
    registerTestAdapter('stop-tunnel', ['--port', '4000']);
    const manager = new TunnelManager('stop-tunnel');

    const promise = manager.start(4000);
    const child = lastChild();
    child.stdout.emit('data', Buffer.from('https://example.com\n'));
    await promise;

    manager.stop();

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.getUrl()).toBeNull();
    expect(manager.isActive()).toBe(false);
  });

  it('getUrl() returns null when not started', () => {
    registerTestAdapter('idle-tunnel');
    const manager = new TunnelManager('idle-tunnel');

    expect(manager.getUrl()).toBeNull();
  });

  it('getUrl() returns URL after start', async () => {
    registerTestAdapter('url-tunnel');
    const manager = new TunnelManager('url-tunnel');

    const promise = manager.start(3001);
    const child = lastChild();
    child.stdout.emit('data', Buffer.from('https://example.com\n'));

    const url = await promise;

    expect(url).toBe('https://example.com');
    expect(manager.getUrl()).toBe('https://example.com');
  });

  it('isActive() reflects current state', async () => {
    registerTestAdapter('active-tunnel');
    const manager = new TunnelManager('active-tunnel');

    expect(manager.isActive()).toBe(false);

    const promise = manager.start(3002);
    const child = lastChild();
    child.stdout.emit('data', Buffer.from('https://example.com\n'));
    await promise;

    expect(manager.isActive()).toBe(true);

    manager.stop();
    expect(manager.isActive()).toBe(false);
  });

  it('registers exit handlers on start', async () => {
    const onSpy = vi.spyOn(process, 'on');
    registerTestAdapter('exit-tunnel');
    const manager = new TunnelManager('exit-tunnel');

    const promise = manager.start(3003);
    const child = lastChild();
    child.stdout.emit('data', Buffer.from('https://example.com\n'));
    await promise;

    const exitCall = onSpy.mock.calls.find(([event]) => event === 'exit');
    const sigintCall = onSpy.mock.calls.find(([event]) => event === 'SIGINT');

    expect(exitCall?.[1]).toEqual(expect.any(Function));
    expect(sigintCall?.[1]).toEqual(expect.any(Function));

    const exitHandler = exitCall?.[1] as (() => void) | undefined;
    exitHandler?.();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));

    manager.stop();
  });
});
