/**
 * CloudflaredAdapter — TunnelAdapter for cloudflared (Cloudflare Tunnel).
 *
 * Spawns: cloudflared tunnel --url localhost:{port}
 * URL format: https://xxx.trycloudflare.com
 *
 * This is the preferred tunnel option — free, no signup required, fast setup.
 * Auto-registers with TunnelManager when this module is imported.
 */

import type { TunnelAdapter, TunnelConfig } from './tunnel-manager.js';
import { TunnelManager } from './tunnel-manager.js';

/** Regex to extract the trycloudflare.com public URL from cloudflared output */
const TRYCLOUDFLARE_URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

export class CloudflaredAdapter implements TunnelAdapter {
  readonly toolName = 'cloudflared';

  /**
   * Build CLI args for a cloudflared quick tunnel.
   * Produces: cloudflared tunnel --url localhost:{port}
   * The subdomain config is not supported for quick tunnels (trycloudflare.com
   * assigns a random subdomain). authToken is ignored — no account required.
   */
  buildArgs(port: number, _config?: TunnelConfig): string[] {
    return ['tunnel', '--url', `localhost:${port}`];
  }

  /**
   * Extract the public URL from one line of cloudflared stdout/stderr.
   *
   * Cloudflared quick tunnel announces its URL in a formatted box:
   *   2024-01-15T10:00:00Z INF |  https://example-word.trycloudflare.com  |
   *
   * Returns the URL string if found, null otherwise.
   */
  parseUrl(line: string): string | null {
    const match = TRYCLOUDFLARE_URL_RE.exec(line);
    return match !== null ? match[0] : null;
  }
}

// Auto-register when this module is imported
TunnelManager.registerAdapter(new CloudflaredAdapter());
