/**
 * NgrokAdapter — TunnelAdapter for ngrok.
 *
 * Spawns: ngrok http {port} [--authtoken <token>] [--subdomain <name>]
 * URL detection: Parses "Forwarding https://..." from stdout, or queries the
 * ngrok local API at http://127.0.0.1:4040/api/tunnels (whichever resolves first).
 *
 * Auth token:
 *   - Pass via TunnelConfig.authToken (takes precedence)
 *   - OR set the NGROK_AUTHTOKEN environment variable (ngrok picks it up automatically)
 *   - Free accounts work without a token for basic tunnels
 *
 * Auto-registers with TunnelManager when this module is imported.
 */

import type { TunnelAdapter, TunnelConfig } from './tunnel-manager.js';
import { TunnelManager } from './tunnel-manager.js';

/** Regex to match ngrok v3 domain (ngrok-free.app) */
const NGROK_V3_URL_RE = /https:\/\/[a-zA-Z0-9-]+\.ngrok-free\.app/;

/** Regex to match ngrok v2 / paid custom domains (ngrok.io or ngrok.app) */
const NGROK_LEGACY_URL_RE = /https:\/\/[a-zA-Z0-9-]+\.ngrok(?:\.io|\.app)/;

interface NgrokTunnel {
  public_url: string;
  proto: string;
}

interface NgrokTunnelsResponse {
  tunnels: NgrokTunnel[];
}

export class NgrokAdapter implements TunnelAdapter {
  readonly toolName = 'ngrok';

  /**
   * Build CLI args for an ngrok HTTP tunnel.
   * Produces: ngrok http {port} [--authtoken <token>] [--subdomain <name>]
   *
   * Auth token is optional for free tunnels. If provided via config, it is
   * passed explicitly so the adapter works without a global ngrok auth setup.
   * Subdomain requires a paid ngrok plan.
   */
  buildArgs(port: number, config?: TunnelConfig): string[] {
    const args: string[] = ['http', String(port)];
    if (config?.authToken) {
      args.push('--authtoken', config.authToken);
    }
    if (config?.subdomain) {
      args.push('--subdomain', config.subdomain);
    }
    return args;
  }

  /**
   * Extract the public HTTPS URL from one line of ngrok stdout/stderr.
   *
   * ngrok v2 / v3 announce the tunnel URL in a Forwarding line:
   *   Forwarding                    https://abc123.ngrok-free.app -> http://localhost:3001
   *   Forwarding                    https://abc123.ngrok.io -> http://localhost:3001
   *
   * Returns the URL string if found, null otherwise.
   */
  parseUrl(line: string): string | null {
    const matchV3 = NGROK_V3_URL_RE.exec(line);
    if (matchV3 !== null) return matchV3[0];

    const matchLegacy = NGROK_LEGACY_URL_RE.exec(line);
    return matchLegacy !== null ? matchLegacy[0] : null;
  }

  /**
   * Query the ngrok local API at http://127.0.0.1:4040/api/tunnels for the
   * public HTTPS URL. ngrok exposes this API server while running.
   *
   * This is polled in parallel with stdout parsing by TunnelManager.
   * Returns the HTTPS tunnel URL, or null if the API is not yet available.
   */
  async fetchUrl(_port: number): Promise<string | null> {
    try {
      const response = await fetch('http://127.0.0.1:4040/api/tunnels');
      if (!response.ok) return null;
      const data = (await response.json()) as NgrokTunnelsResponse;
      const httpsTunnel = data.tunnels.find((t) => t.proto === 'https');
      return httpsTunnel?.public_url ?? null;
    } catch {
      // API not available yet (ngrok still starting) — return null to continue polling
      return null;
    }
  }
}

// Auto-register when this module is imported
TunnelManager.registerAdapter(new NgrokAdapter());
