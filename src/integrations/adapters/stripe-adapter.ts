import Stripe from 'stripe';
import { createLogger } from '../../core/logger.js';
import type {
  BusinessIntegration,
  EventHandler,
  HealthStatus,
  IntegrationCapability,
  IntegrationConfig,
} from '../../types/integration.js';

const logger = createLogger('stripe-adapter');

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
    this.eventHandlers.clear();
    logger.info('Stripe adapter shut down');
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
