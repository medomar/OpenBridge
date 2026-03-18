import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createLogger } from '../../core/logger.js';
import type { Workflow } from '../../types/workflow.js';
import type { WorkflowEngine } from '../engine.js';

const logger = createLogger('webhook-trigger');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WebhookHandler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => Promise<void>;

// ---------------------------------------------------------------------------
// WebhookRouter
// ---------------------------------------------------------------------------

/**
 * Lightweight POST-only router for webhook endpoints.
 *
 * Designed to sit alongside FileServer: plug `router.handle(req, res)` into
 * the same HTTP server's request handler before the file-serving logic runs.
 */
export class WebhookRouter {
  private readonly handlers = new Map<string, WebhookHandler>();

  /** Register an async handler for the given path. */
  register(routePath: string, handler: WebhookHandler): void {
    this.handlers.set(routePath, handler);
    logger.debug({ routePath }, 'Webhook route registered');
  }

  /** Remove the handler for the given path. */
  unregister(routePath: string): void {
    this.handlers.delete(routePath);
    logger.debug({ routePath }, 'Webhook route unregistered');
  }

  /**
   * Attempt to handle an incoming request.
   * Returns `true` if a matching POST handler was found and invoked, `false` otherwise.
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (req.method !== 'POST') return false;

    const url = req.url ?? '/';
    const handler = this.handlers.get(url);
    if (!handler) return false;

    const body = await readBody(req);
    await handler(req, res, body);
    return true;
  }

  /** Returns true when at least one route is registered. */
  hasRoutes(): boolean {
    return this.handlers.size > 0;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Verifies an HMAC-SHA256 signature.
 * Accepts `X-Hub-Signature-256` (GitHub-style) or `X-Webhook-Signature` header
 * formatted as `sha256=<hex>`.
 */
function verifySignature(body: Buffer, secret: string, req: IncomingMessage): boolean {
  const signatureHeader =
    (req.headers['x-hub-signature-256'] as string | undefined) ??
    (req.headers['x-webhook-signature'] as string | undefined);

  if (!signatureHeader) {
    logger.warn('Webhook request missing signature header');
    return false;
  }

  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) {
    logger.warn({ signatureHeader }, 'Unexpected signature format — expected sha256= prefix');
    return false;
  }

  const provided = Buffer.from(signatureHeader.slice(prefix.length), 'hex');
  const expected = Buffer.from(createHmac('sha256', secret).update(body).digest('hex'), 'hex');

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Registers `POST /webhook/workflow/{workflow_id}` on the given router.
 *
 * On each request:
 * 1. If `trigger.webhook_secret` is set, validate the HMAC-SHA256 signature.
 * 2. Parse the JSON body (falls back to `{}` if the body is empty or invalid JSON).
 * 3. Call `engine.executeWorkflow(workflow.id, body)` asynchronously and respond 202 immediately.
 */
export function registerWebhookTrigger(
  workflow: Workflow,
  webhookRouter: WebhookRouter,
  engine: WorkflowEngine,
): void {
  const routePath = `/webhook/workflow/${workflow.id}`;
  const secret = workflow.trigger.webhook_secret;

  // eslint-disable-next-line @typescript-eslint/require-await -- execution is deferred via setImmediate; handler type must be async
  webhookRouter.register(routePath, async (req, res, body) => {
    // Signature validation when a secret is configured
    if (secret) {
      if (!verifySignature(body, secret, req)) {
        logger.warn({ workflowId: workflow.id }, 'Webhook signature validation failed');
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid signature' }));
        return;
      }
    }

    // Parse body — fall back to empty object on invalid JSON
    let parsedBody: Record<string, unknown> = {};
    if (body.length > 0) {
      try {
        parsedBody = JSON.parse(body.toString('utf-8')) as Record<string, unknown>;
      } catch {
        logger.debug(
          { workflowId: workflow.id },
          'Webhook body is not valid JSON — using empty object',
        );
      }
    }

    logger.info({ workflowId: workflow.id, routePath }, 'Webhook trigger fired');

    // Execute asynchronously so we can send 202 immediately
    setImmediate(() => {
      void engine.executeWorkflow(workflow.id, parsedBody).catch((err: unknown) => {
        logger.error(
          {
            workflowId: workflow.id,
            error: err instanceof Error ? err.message : String(err),
          },
          'Webhook-triggered workflow execution failed',
        );
      });
    });

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'accepted', workflow_id: workflow.id }));
  });

  logger.info({ workflowId: workflow.id, routePath }, 'Webhook trigger registered');
}

/**
 * Removes the `POST /webhook/workflow/{workflow_id}` endpoint from the router.
 */
export function unregisterWebhookTrigger(workflow: Workflow, webhookRouter: WebhookRouter): void {
  const routePath = `/webhook/workflow/${workflow.id}`;
  webhookRouter.unregister(routePath);
  logger.info({ workflowId: workflow.id, routePath }, 'Webhook trigger unregistered');
}
