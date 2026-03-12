import type Database from 'better-sqlite3';
import type {
  BusinessIntegration,
  HealthStatus,
  IntegrationConfig,
  IntegrationInfo,
} from '../types/integration.js';
import type { CredentialStore } from './credential-store.js';

interface IntegrationEntry {
  integration: BusinessIntegration;
  connected: boolean;
  healthStatus: HealthStatus['status'];
  credentialStore?: CredentialStore;
}

/**
 * IntegrationHub registry and lifecycle manager.
 * Manages registration, initialization, health checks, and shutdown of business integrations.
 */
export class IntegrationHub {
  private integrations = new Map<string, IntegrationEntry>();
  private db: Database.Database | null = null;
  private credentialStore: CredentialStore | null = null;

  /**
   * Optionally wire in a SQLite DB and CredentialStore for health status persistence.
   */
  setDatabase(db: Database.Database, credentialStore: CredentialStore): void {
    this.db = db;
    this.credentialStore = credentialStore;
  }

  /** Register an integration adapter. Must be called before initialize(). */
  register(integration: BusinessIntegration): void {
    this.integrations.set(integration.name, {
      integration,
      connected: false,
      healthStatus: 'unknown',
    });
  }

  /**
   * Get a registered integration by name.
   * Throws if the integration is not registered.
   */
  get(name: string): BusinessIntegration {
    const entry = this.integrations.get(name);
    if (!entry) {
      throw new Error(`Integration not found: ${name}`);
    }
    return entry.integration;
  }

  /** List summary info for all registered integrations. */
  list(): IntegrationInfo[] {
    return Array.from(this.integrations.entries()).map(([name, entry]) => ({
      name,
      type: entry.integration.type,
      connected: entry.connected,
      healthStatus: entry.healthStatus,
      capabilityCount: entry.integration.describeCapabilities().length,
    }));
  }

  /**
   * Initialize an integration by name.
   * Calls the integration's initialize() method, then updates health_status to 'healthy'
   * in the credentials table on success.
   */
  async initialize(name: string, config: IntegrationConfig): Promise<void> {
    const entry = this.integrations.get(name);
    if (!entry) {
      throw new Error(`Integration not found: ${name}`);
    }

    await entry.integration.initialize(config);
    entry.connected = true;
    entry.healthStatus = 'healthy';

    if (this.db && this.credentialStore) {
      this.credentialStore.updateHealthStatus(this.db, name, 'healthy');
    }
  }

  /**
   * Run a health check on a named integration.
   * Updates health_status in the credentials table after the check.
   */
  async healthCheck(name: string): Promise<HealthStatus> {
    const entry = this.integrations.get(name);
    if (!entry) {
      throw new Error(`Integration not found: ${name}`);
    }

    const result = await entry.integration.healthCheck();
    entry.healthStatus = result.status;

    if (this.db && this.credentialStore) {
      this.credentialStore.updateHealthStatus(this.db, name, result.status);
    }

    return result;
  }

  /** Return the last known health status for an integration, or undefined if not registered. */
  getHealthStatus(name: string): HealthStatus['status'] | undefined {
    return this.integrations.get(name)?.healthStatus;
  }

  /** Shutdown all registered integrations. */
  async shutdown(): Promise<void> {
    const shutdowns = Array.from(this.integrations.values()).map((entry) =>
      entry.integration.shutdown().catch(() => {
        // Ignore individual shutdown errors — best-effort
      }),
    );
    await Promise.all(shutdowns);
  }
}
