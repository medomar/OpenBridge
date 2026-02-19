import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigWatcher } from '../../src/core/config-watcher.js';

const validConfig = {
  connectors: [{ type: 'whatsapp' }],
  providers: [{ type: 'claude-code' }],
  defaultProvider: 'claude-code',
  auth: { whitelist: ['+1234567890'], prefix: '/ai' },
};

describe('ConfigWatcher', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'config-watcher-'));
    configPath = join(tempDir, 'config.json');
    await writeFile(configPath, JSON.stringify(validConfig), 'utf-8');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should start and stop without errors', () => {
    const watcher = new ConfigWatcher(configPath);
    expect(watcher.isWatching).toBe(false);

    watcher.start();
    expect(watcher.isWatching).toBe(true);

    watcher.stop();
    expect(watcher.isWatching).toBe(false);
  });

  it('should not start twice', () => {
    const watcher = new ConfigWatcher(configPath);
    watcher.start();
    watcher.start(); // should be a no-op
    expect(watcher.isWatching).toBe(true);
    watcher.stop();
  });

  it('should call onChange handler when config file changes', async () => {
    const handler = vi.fn();
    const watcher = new ConfigWatcher(configPath, 50);

    watcher.onChange(handler);
    watcher.start();

    const updatedConfig = {
      ...validConfig,
      auth: { ...validConfig.auth, whitelist: ['+9876543210'] },
    };
    await writeFile(configPath, JSON.stringify(updatedConfig), 'utf-8');

    // Wait for debounce + fs event propagation
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(handler).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const calledWith = handler.mock.calls[0]?.[0];
    expect(calledWith).toHaveProperty('auth.whitelist', ['+9876543210']);

    watcher.stop();
  });

  it('should not call handler for invalid config', async () => {
    const handler = vi.fn();
    const watcher = new ConfigWatcher(configPath, 50);

    watcher.onChange(handler);
    watcher.start();

    await writeFile(configPath, '{ invalid json !!!', 'utf-8');

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(handler).not.toHaveBeenCalled();

    watcher.stop();
  });

  it('should debounce rapid changes', async () => {
    const handler = vi.fn();
    const watcher = new ConfigWatcher(configPath, 100);

    watcher.onChange(handler);
    watcher.start();

    // Write multiple rapid changes
    for (let i = 0; i < 5; i++) {
      const updated = {
        ...validConfig,
        auth: { ...validConfig.auth, prefix: `/ai${i}` },
      };
      await writeFile(configPath, JSON.stringify(updated), 'utf-8');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Should only have been called once (or a small number due to debouncing)
    expect(handler.mock.calls.length).toBeLessThanOrEqual(2);

    watcher.stop();
  });

  it('should handle errors in change handlers gracefully', async () => {
    const badHandler = vi.fn(() => {
      throw new Error('handler error');
    });
    const goodHandler = vi.fn();

    const watcher = new ConfigWatcher(configPath, 50);
    watcher.onChange(badHandler);
    watcher.onChange(goodHandler);
    watcher.start();

    const updatedConfig = {
      ...validConfig,
      auth: { ...validConfig.auth, prefix: '/test' },
    };
    await writeFile(configPath, JSON.stringify(updatedConfig), 'utf-8');

    await new Promise((resolve) => setTimeout(resolve, 300));

    // Both handlers should have been called — bad handler throwing should not prevent good handler
    expect(badHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();

    watcher.stop();
  });
});
