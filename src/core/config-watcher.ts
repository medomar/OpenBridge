import { watch, type FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import type { AppConfig } from '../types/config.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

const logger = createLogger('config-watcher');

export type ConfigChangeHandler = (config: AppConfig) => void;

export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private readonly configPath: string;
  private readonly handlers: ConfigChangeHandler[] = [];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;

  constructor(configPath: string, debounceMs = 500) {
    this.configPath = resolve(configPath);
    this.debounceMs = debounceMs;
  }

  /** Register a handler to be called when the config changes */
  onChange(handler: ConfigChangeHandler): void {
    this.handlers.push(handler);
  }

  /** Start watching the config file for changes */
  start(): void {
    if (this.watcher) return;

    logger.info({ path: this.configPath }, 'Watching config file for changes');

    this.watcher = watch(this.configPath, (eventType) => {
      if (eventType === 'change') {
        this.scheduleReload();
      }
    });

    this.watcher.on('error', (error) => {
      logger.error({ error }, 'Config file watcher error');
    });
  }

  /** Stop watching the config file */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
      logger.info('Config file watcher stopped');
    }
  }

  private scheduleReload(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.reload();
    }, this.debounceMs);
  }

  private async reload(): Promise<void> {
    try {
      const config = await loadConfig(this.configPath);

      logger.info('Config file reloaded successfully');

      for (const handler of this.handlers) {
        try {
          handler(config);
        } catch (err) {
          logger.error({ err }, 'Error in config change handler');
        }
      }
    } catch (err) {
      logger.error({ err }, 'Failed to reload config file — keeping current config');
    }
  }

  get isWatching(): boolean {
    return this.watcher !== null;
  }
}
