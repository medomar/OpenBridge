import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLogger } from '../core/logger.js';
import type { BusinessIntegration } from '../types/integration.js';

const logger = createLogger('webhook-router');

export type WebhookHandler = (payload: Record<string, unknown>) => Promise<void>;

/** Registry key for a webhook handler: `<integration>/<event>` */
type RouteKey = string;

/** Entry stored for a registered route */
interface RouteEntry {
  handler: WebhookHandler;
  integration: string;
  event: string;
}

/**
 * WebhookRouter — incoming webhook dispatcher for business integration events.
 *
 * Usage:
 *   const router = new WebhookRouter();
 *   router.registerRoute('stripe', 'payment.succeeded', async (payload) => { ... });
 *   // Handle a raw HTTP request (call from FileServer or a standalone HTTP server):
 *   await router.handleHttpRequest(req, res);
 */
export class WebhookRouter {
  private readonly routes = new Map<RouteKey, RouteEntry>();

  /** Map from integration name → registered integration (for signature verification) */
  private readonly integrations = new Map<string, BusinessIntegration>();

  private static routeKey(integration: string, event: string): RouteKey {
    return `${integration}/${event}`;
  }

  /**
   * Register an integration adapter so the router can call `subscribe` and
   * verify signatures (if supported).
   */
  registerIntegration(integration: BusinessIntegration): void {
    this.integrations.set(integration.name, integration);
    logger.debug({ integration: integration.name }, 'Integration registered with webhook router');
  }

  /**
   * Register a webhook handler for a specific integration/event pair.
   * If an integration adapter with a `subscribe` method is already registered,
   * this wires it up as well.
   */
  registerRoute(integration: string, event: string, handler: WebhookHandler): void {
    const key = WebhookRouter.routeKey(integration, event);
    this.routes.set(key, { handler, integration, event });
    logger.info({ integration, event }, 'Webhook route registered');

    // Wire the integration's subscribe() if available
    const adapter = this.integrations.get(integration);
    if (adapter?.subscribe) {
      adapter.subscribe(event, async (eventPayload) => {
        await this.dispatch(integration, event, eventPayload);
      });
    }
  }

  /**
   * Deregister all routes for a specific integration and call
   * `unregisterWebhook()` on the adapter if present.
   */
  async deregisterIntegration(integrationName: string): Promise<void> {
    for (const key of this.routes.keys()) {
      if (key.startsWith(`${integrationName}/`)) {
        this.routes.delete(key);
      }
    }

    const adapter = this.integrations.get(integrationName);
    if (adapter?.unregisterWebhook) {
      await adapter.unregisterWebhook().catch((err: unknown) => {
        logger.warn({ integration: integrationName, err }, 'unregisterWebhook failed');
      });
    }

    this.integrations.delete(integrationName);
    logger.info({ integration: integrationName }, 'Webhook routes deregistered');
  }

  /**
   * Dispatch a parsed payload to all registered handlers for the given
   * integration/event pair.  Logs the event regardless of whether a handler
   * exists.
   */
  async dispatch(
    integration: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const key = WebhookRouter.routeKey(integration, event);
    logger.info({ integration, event }, 'Webhook event received');

    const entry = this.routes.get(key);
    if (!entry) {
      logger.warn({ integration, event }, 'No handler registered for webhook event — ignored');
      return;
    }

    try {
      await entry.handler(payload);
      logger.debug({ integration, event }, 'Webhook handler completed');
    } catch (err) {
      logger.error({ integration, event, err }, 'Webhook handler threw an error');
      throw err;
    }
  }

  /**
   * Verify a webhook signature for a given integration.
   *
   * This is a best-effort, integration-agnostic check.  Concrete adapters that
   * need cryptographic verification (e.g. Stripe's `stripe.webhooks.constructEvent`)
   * should override this by calling `router.registerSignatureVerifier(name, fn)`.
   *
   * Returns `true` when no verifier is registered (allow-by-default) so that
   * integrations without signatures still work.
   */
  verifySignature(integration: string, signature: string, payload: string): boolean {
    const verifier = this.signatureVerifiers.get(integration);
    if (!verifier) {
      return true; // no verifier registered — allow
    }
    try {
      return verifier(signature, payload);
    } catch (err) {
      logger.warn({ integration, err }, 'Signature verification threw — treating as invalid');
      return false;
    }
  }

  /** Map from integration name → custom signature verifier function */
  private readonly signatureVerifiers = new Map<
    string,
    (signature: string, payload: string) => boolean
  >();

  /** Register a custom signature verifier for an integration. */
  registerSignatureVerifier(
    integration: string,
    verifier: (signature: string, payload: string) => boolean,
  ): void {
    this.signatureVerifiers.set(integration, verifier);
  }

  /**
   * Handle an incoming HTTP request for a webhook endpoint.
   *
   * Expected URL pattern: `POST /webhook/:integration/:event`
   *
   * Returns `true` when the request was handled (caller should not write a
   * further response), `false` when the URL did not match the webhook pattern.
   */
  async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? '';
    const match = /^\/webhook\/([^/]+)\/([^/?]+)/.exec(url);
    if (!match) return false;
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return true;
    }

    const integration = decodeURIComponent(match[1] ?? '');
    const event = decodeURIComponent(match[2] ?? '');

    // Collect request body
    let rawBody = '';
    try {
      rawBody = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
      });
    } catch (err) {
      logger.error({ integration, event, err }, 'Failed to read webhook request body');
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to read request body' }));
      return true;
    }

    // Signature verification
    const signature = (req.headers['x-webhook-signature'] as string | undefined) ?? '';
    if (!this.verifySignature(integration, signature, rawBody)) {
      logger.warn({ integration, event }, 'Webhook signature verification failed');
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid signature' }));
      return true;
    }

    // Parse payload
    let payload: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      payload =
        parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { data: parsed };
    } catch {
      payload = { raw: rawBody };
    }

    // Dispatch (errors are caught internally and logged; we always return 200)
    try {
      await this.dispatch(integration, event, payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Handler error' }));
    }

    return true;
  }
}
