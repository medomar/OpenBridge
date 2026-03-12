import Stripe from 'stripe';
import { createLogger } from '../../core/logger.js';
import type {
  BusinessIntegration,
  EventHandler,
  HealthStatus,
  IntegrationCapability,
  IntegrationConfig,
} from '../../types/integration.js';
import type { WebhookRouter } from '../webhook-router.js';

const logger = createLogger('stripe-adapter');

/**
 * Details extracted from a `payment_intent.succeeded` event.
 * Passed to the registered `PaymentSucceededHandler` so that external
 * code can update DocType records and notify owners without coupling
 * the adapter to the intelligence layer.
 */
export interface PaymentSucceededDetails {
  /** Stripe PaymentIntent ID (e.g. "pi_xxx") */
  paymentIntentId: string;
  /** Stripe PaymentLink ID if the intent originated from a payment link, else null */
  paymentLinkId: string | null;
  /** Amount charged in the smallest currency unit (e.g. cents for USD) */
  amount: number;
  /** ISO currency code in lowercase (e.g. "usd") */
  currency: string;
  /** PaymentIntent metadata attached at creation time */
  metadata: Record<string, string>;
}

/**
 * Callback invoked when a `payment_intent.succeeded` webhook event is received
 * and its signature has been verified.
 *
 * Implementors should:
 *   1. Find the matching DocType record via `paymentLinkId` or `metadata`
 *   2. Execute the "paid" state transition
 *   3. Notify the record owner via the messaging channel
 */
export type PaymentSucceededHandler = (details: PaymentSucceededDetails) => Promise<void>;

/**
 * Stripe payment integration adapter.
 *
 * Capabilities:
 * - create_payment_link: Create a Stripe Payment Link
 * - create_invoice: Create and optionally finalize a Stripe invoice
 * - list_payments: List recent payment intents
 * - get_balance: Retrieve account balance
 *
 * Credentials expected (from credential store):
 * - apiKey: Stripe secret key (sk_test_... or sk_live_...)
 * - webhookSecret (optional): Webhook endpoint signing secret (whsec_...)
 */
export class StripeAdapter implements BusinessIntegration {
  readonly name = 'stripe';
  readonly type = 'payment' as const;

  private client: Stripe | null = null;
  private webhookSecret: string | null = null;
  private eventHandlers = new Map<string, EventHandler[]>();
  private webhookEndpointId: string | null = null;
  private webhookRouter: WebhookRouter | null = null;
  private paymentSucceededHandler: PaymentSucceededHandler | null = null;

  async initialize(config: IntegrationConfig): Promise<void> {
    const opts = config.options;
    const apiKey = opts['apiKey'] as string | undefined;

    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('Stripe adapter requires an apiKey in config.options');
    }

    this.client = new Stripe(apiKey);
    this.webhookSecret = (opts['webhookSecret'] as string) ?? null;

    // Verify the key works
    try {
      await this.client.balance.retrieve();
    } catch (err) {
      this.client = null;
      throw new Error(
        `Stripe initialization failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    logger.info('Stripe adapter initialized');
  }

  async healthCheck(): Promise<HealthStatus> {
    const checkedAt = new Date().toISOString();

    if (!this.client) {
      return { status: 'unhealthy', message: 'Not initialized', checkedAt, details: {} };
    }

    try {
      const balance = await this.client.balance.retrieve();
      return {
        status: 'healthy',
        message: 'Stripe API reachable',
        checkedAt,
        details: { availableCurrencies: balance.available.map((b) => b.currency) },
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        message: err instanceof Error ? err.message : String(err),
        checkedAt,
        details: {},
      };
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async shutdown(): Promise<void> {
    this.client = null;
    this.webhookSecret = null;
    this.webhookEndpointId = null;
    this.eventHandlers.clear();
    logger.info('Stripe adapter shut down');
  }

  // ── Webhook registration ────────────────────────────────────────

  /**
   * Inject a WebhookRouter so that `registerWebhook()` can create a route
   * for `payment_intent.succeeded` events.
   */
  setWebhookRouter(router: WebhookRouter): void {
    this.webhookRouter = router;
  }

  /**
   * Register a callback that is invoked after a `payment_intent.succeeded`
   * event has been verified.  External callers should use this to update
   * DocType records and notify owners.
   */
  setPaymentSucceededHandler(fn: PaymentSucceededHandler): void {
    this.paymentSucceededHandler = fn;
  }

  /**
   * Create a Stripe webhook endpoint pointing at `endpointUrl` and register
   * the `payment_intent.succeeded` handler in the WebhookRouter.
   *
   * The Stripe-assigned endpoint ID is stored so that `unregisterWebhook()`
   * can delete it later.
   *
   * @param endpointUrl - Publicly reachable URL Stripe should POST to,
   *   e.g. "https://example.com/webhook/stripe/payment_intent.succeeded"
   */
  async registerWebhook(endpointUrl: string): Promise<void> {
    if (!this.client) {
      throw new Error('Stripe adapter not initialized — call initialize() first');
    }

    // Create the webhook endpoint on Stripe's side
    const endpoint = await this.client.webhookEndpoints.create({
      url: endpointUrl,
      enabled_events: ['payment_intent.succeeded'],
    });

    this.webhookEndpointId = endpoint.id;
    logger.info({ endpointId: endpoint.id, url: endpointUrl }, 'Stripe webhook endpoint created');

    // Wire up the route in the WebhookRouter
    if (this.webhookRouter) {
      this.webhookRouter.registerIntegration(this);
      this.webhookRouter.registerRoute('stripe', 'payment_intent.succeeded', async (payload) => {
        await this.handlePaymentSucceededPayload(payload);
      });
      logger.info('Stripe payment_intent.succeeded route registered in WebhookRouter');
    }

    // Subscribe to internal dispatched events as well
    this.subscribe('payment_intent.succeeded', async (event) => {
      await this.handlePaymentSucceededPayload(event);
    });
  }

  /**
   * Delete the Stripe webhook endpoint that was created via `registerWebhook()`.
   * No-op if no endpoint has been registered.
   */
  async unregisterWebhook(): Promise<void> {
    if (!this.client || !this.webhookEndpointId) {
      return;
    }

    try {
      await this.client.webhookEndpoints.del(this.webhookEndpointId);
      logger.info({ endpointId: this.webhookEndpointId }, 'Stripe webhook endpoint deleted');
    } catch (err) {
      logger.warn(
        { endpointId: this.webhookEndpointId, err },
        'Failed to delete Stripe webhook endpoint',
      );
    }

    this.webhookEndpointId = null;
  }

  /**
   * Verify a raw Stripe webhook HTTP request and dispatch the event.
   *
   * Call this from your HTTP handler when the path matches the Stripe webhook
   * URL.  The `stripeSignature` value should come from the `Stripe-Signature`
   * request header.
   *
   * @param rawBody       - Raw (unparsed) request body string
   * @param stripeSignature - Value of the `Stripe-Signature` header
   */
  async handleStripeWebhook(rawBody: string, stripeSignature: string): Promise<void> {
    const event = this.verifyWebhookSignature(rawBody, stripeSignature);
    await this.dispatchWebhookEvent(event);
  }

  describeCapabilities(): IntegrationCapability[] {
    return [
      {
        name: 'create_payment_link',
        description:
          'Create a Stripe Payment Link. Params: amount (number, cents), currency (string, e.g. "usd"), description (string).',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'create_invoice',
        description:
          'Create a Stripe invoice for a customer. Params: customerId (string), items (array of {description, amount, currency}), autoFinalize (boolean, default true).',
        category: 'write',
        requiresApproval: true,
      },
      {
        name: 'list_payments',
        description:
          'List recent payment intents. Params: limit (number, default 10), status (string, optional).',
        category: 'read',
        requiresApproval: false,
      },
      {
        name: 'get_balance',
        description: 'Retrieve the current Stripe account balance. No params required.',
        category: 'read',
        requiresApproval: false,
      },
    ];
  }

  async query(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('Stripe adapter not initialized — call initialize() first');
    }

    switch (operation) {
      case 'list_payments':
        return await this.listPayments(params);
      case 'get_balance':
        return await this.getBalance();
      default:
        throw new Error(`Unknown query operation: ${operation}`);
    }
  }

  async execute(operation: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.client) {
      throw new Error('Stripe adapter not initialized — call initialize() first');
    }

    switch (operation) {
      case 'create_payment_link':
        return await this.createPaymentLink(params);
      case 'create_invoice':
        return await this.createInvoice(params);
      default:
        throw new Error(`Unknown execute operation: ${operation}`);
    }
  }

  // ── Event subscription (for webhook handling) ──────────────────

  subscribe(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
    logger.debug({ event }, 'Stripe event handler subscribed');
  }

  /**
   * Verify a Stripe webhook signature and construct the event.
   * Called by the webhook router when a POST hits /webhook/stripe/:event.
   *
   * @param rawBody - Raw request body as a string
   * @param signature - Stripe-Signature header value
   * @returns The verified Stripe event object
   */
  verifyWebhookSignature(rawBody: string, signature: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw new Error('Webhook secret not configured — cannot verify signature');
    }

    return Stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  /**
   * Dispatch a verified webhook event to all subscribed handlers.
   */
  async dispatchWebhookEvent(event: Stripe.Event): Promise<void> {
    const handlers = this.eventHandlers.get(event.type);
    if (!handlers || handlers.length === 0) {
      logger.debug({ eventType: event.type }, 'No handlers for Stripe event');
      return;
    }

    for (const handler of handlers) {
      try {
        await handler(event as unknown as Record<string, unknown>);
      } catch (err) {
        logger.error({ eventType: event.type, err }, 'Stripe event handler error');
      }
    }
  }

  // ── Internal webhook handlers ──────────────────────────────────

  /**
   * Core handler for `payment_intent.succeeded` payloads.
   * Extracts payment details and calls the injected `PaymentSucceededHandler`
   * so that external code can update DocType records and notify owners.
   */
  private async handlePaymentSucceededPayload(payload: Record<string, unknown>): Promise<void> {
    // Stripe webhook payload structure:
    //   { type, data: { object: PaymentIntent } }
    // The WebhookRouter dispatches the full event object as payload.
    const dataObj =
      payload['data'] !== undefined &&
      typeof payload['data'] === 'object' &&
      payload['data'] !== null
        ? (payload['data'] as Record<string, unknown>)
        : payload;

    const pi =
      dataObj['object'] !== undefined &&
      typeof dataObj['object'] === 'object' &&
      dataObj['object'] !== null
        ? (dataObj['object'] as Record<string, unknown>)
        : dataObj;

    const paymentIntentId = typeof pi['id'] === 'string' ? pi['id'] : '';
    const paymentLinkId = typeof pi['payment_link'] === 'string' ? pi['payment_link'] : null;
    const amount = typeof pi['amount'] === 'number' ? pi['amount'] : 0;
    const currency = typeof pi['currency'] === 'string' ? pi['currency'] : 'usd';
    const metadata =
      pi['metadata'] !== null && typeof pi['metadata'] === 'object'
        ? (pi['metadata'] as Record<string, string>)
        : {};

    logger.info(
      { paymentIntentId, paymentLinkId, amount, currency },
      'payment_intent.succeeded received',
    );

    if (!this.paymentSucceededHandler) {
      logger.debug('No PaymentSucceededHandler registered — skipping DocType transition');
      return;
    }

    try {
      await this.paymentSucceededHandler({
        paymentIntentId,
        paymentLinkId,
        amount,
        currency,
        metadata,
      });
    } catch (err) {
      logger.error({ paymentIntentId, err }, 'PaymentSucceededHandler threw an error');
    }
  }

  // ── Private helpers ────────────────────────────────────────────

  private async createPaymentLink(
    params: Record<string, unknown>,
  ): Promise<{ url: string; id: string }> {
    const amount = params['amount'] as number;
    const currency = (params['currency'] as string) ?? 'usd';
    const description = (params['description'] as string) ?? 'Payment';

    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error('amount must be a positive number (in cents)');
    }

    const link = await this.client!.paymentLinks.create({
      line_items: [
        {
          price_data: {
            currency,
            product_data: { name: description },
            unit_amount: Math.round(amount),
          },
          quantity: 1,
        },
      ],
    });

    logger.info({ linkId: link.id, url: link.url }, 'Payment link created');
    return { url: link.url, id: link.id };
  }

  private async createInvoice(
    params: Record<string, unknown>,
  ): Promise<{ invoiceId: string; invoiceUrl: string | null; status: string }> {
    const customerId = params['customerId'] as string;
    const items = params['items'] as Array<{
      description: string;
      amount: number;
      currency?: string;
    }>;
    const autoFinalize = params['autoFinalize'] !== false;

    if (!customerId || typeof customerId !== 'string') {
      throw new Error('customerId is required');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('items must be a non-empty array');
    }

    const invoice = await this.client!.invoices.create({
      customer: customerId,
      auto_advance: autoFinalize,
    });

    // Add line items
    for (const item of items) {
      await this.client!.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        amount: Math.round(item.amount),
        currency: item.currency ?? 'usd',
        description: item.description,
      });
    }

    // Finalize if requested
    let finalInvoice = invoice;
    if (autoFinalize) {
      finalInvoice = await this.client!.invoices.finalizeInvoice(invoice.id);
    }

    logger.info({ invoiceId: finalInvoice.id }, 'Invoice created');
    return {
      invoiceId: finalInvoice.id,
      invoiceUrl: finalInvoice.hosted_invoice_url ?? null,
      status: finalInvoice.status ?? 'draft',
    };
  }

  private async listPayments(
    params: Record<string, unknown>,
  ): Promise<{ payments: Array<Record<string, unknown>>; hasMore: boolean }> {
    const limit = Math.min((params['limit'] as number) ?? 10, 100);
    const listParams: Stripe.PaymentIntentListParams = { limit };

    if (params['status'] && typeof params['status'] === 'string') {
      listParams.expand = undefined; // clear any defaults
    }

    const result = await this.client!.paymentIntents.list(listParams);

    return {
      payments: result.data.map((pi) => ({
        id: pi.id,
        amount: pi.amount,
        currency: pi.currency,
        status: pi.status,
        description: pi.description,
        created: new Date(pi.created * 1000).toISOString(),
      })),
      hasMore: result.has_more,
    };
  }

  private async getBalance(): Promise<{
    available: Array<{ amount: number; currency: string }>;
    pending: Array<{ amount: number; currency: string }>;
  }> {
    const balance = await this.client!.balance.retrieve();

    return {
      available: balance.available.map((b) => ({ amount: b.amount, currency: b.currency })),
      pending: balance.pending.map((b) => ({ amount: b.amount, currency: b.currency })),
    };
  }
}
