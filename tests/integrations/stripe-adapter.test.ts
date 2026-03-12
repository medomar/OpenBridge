import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mock stubs (must be declared before vi.mock factory runs) ────────

const {
  mockBalanceRetrieve,
  mockPaymentLinksCreate,
  mockWebhookEndpointsCreate,
  mockConstructEvent,
} = vi.hoisted(() => ({
  mockBalanceRetrieve: vi.fn(),
  mockPaymentLinksCreate: vi.fn(),
  mockWebhookEndpointsCreate: vi.fn(),
  mockConstructEvent: vi.fn(),
}));

// ── Stripe SDK mock ──────────────────────────────────────────────────────────

vi.mock('stripe', () => {
  const MockStripe = vi.fn().mockImplementation(() => ({
    balance: { retrieve: mockBalanceRetrieve },
    paymentLinks: { create: mockPaymentLinksCreate },
    webhookEndpoints: { create: mockWebhookEndpointsCreate },
  }));

  (MockStripe as unknown as { webhooks: { constructEvent: typeof mockConstructEvent } }).webhooks =
    { constructEvent: mockConstructEvent };

  return { default: MockStripe };
});

// ── Module under test ────────────────────────────────────────────────────────

import { StripeAdapter } from '../../src/integrations/adapters/stripe-adapter.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeAdapter(): StripeAdapter {
  return new StripeAdapter();
}

async function initializedAdapter(): Promise<StripeAdapter> {
  const adapter = makeAdapter();
  mockBalanceRetrieve.mockResolvedValueOnce({
    available: [{ amount: 10000, currency: 'usd' }],
    pending: [],
  });
  await adapter.initialize({ options: { apiKey: 'sk_test_valid' } });
  return adapter;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('StripeAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. create_payment_link returns URL ────────────────────────────────────

  describe('create_payment_link', () => {
    it('returns url and id from Stripe', async () => {
      const adapter = await initializedAdapter();

      mockPaymentLinksCreate.mockResolvedValueOnce({
        id: 'plink_123',
        url: 'https://buy.stripe.com/test_123',
      });

      const result = (await adapter.execute('create_payment_link', {
        amount: 5000,
        currency: 'usd',
        description: 'Test product',
      })) as { url: string; id: string };

      expect(result.url).toBe('https://buy.stripe.com/test_123');
      expect(result.id).toBe('plink_123');
      expect(mockPaymentLinksCreate).toHaveBeenCalledOnce();

      const callArgs = mockPaymentLinksCreate.mock.calls[0][0] as {
        line_items: Array<{ price_data: { unit_amount: number; currency: string } }>;
      };
      expect(callArgs.line_items[0].price_data.unit_amount).toBe(5000);
      expect(callArgs.line_items[0].price_data.currency).toBe('usd');
    });

    it('throws when amount is zero', async () => {
      const adapter = await initializedAdapter();
      await expect(
        adapter.execute('create_payment_link', { amount: 0, currency: 'usd' }),
      ).rejects.toThrow('amount must be a positive number');
    });
  });

  // ── 2. Webhook signature verification ─────────────────────────────────────

  describe('verifyWebhookSignature', () => {
    it('returns Stripe event when signature is valid', async () => {
      const adapter = makeAdapter();
      mockBalanceRetrieve.mockResolvedValueOnce({ available: [], pending: [] });
      await adapter.initialize({
        options: { apiKey: 'sk_test_valid', webhookSecret: 'whsec_abc' },
      });

      const fakeEvent = {
        id: 'evt_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_1',
            amount: 1000,
            currency: 'usd',
            payment_link: null,
            metadata: {},
          },
        },
      };

      mockConstructEvent.mockReturnValueOnce(fakeEvent);

      const result = adapter.verifyWebhookSignature('raw_body', 'sig_header');
      expect(result).toEqual(fakeEvent);
      expect(mockConstructEvent).toHaveBeenCalledWith('raw_body', 'sig_header', 'whsec_abc');
    });

    it('throws when webhook secret is not configured', async () => {
      const adapter = await initializedAdapter();
      expect(() => adapter.verifyWebhookSignature('raw_body', 'sig')).toThrow(
        'Webhook secret not configured',
      );
    });

    it('propagates Stripe signature errors', async () => {
      const adapter = makeAdapter();
      mockBalanceRetrieve.mockResolvedValueOnce({ available: [], pending: [] });
      await adapter.initialize({
        options: { apiKey: 'sk_test_valid', webhookSecret: 'whsec_abc' },
      });

      mockConstructEvent.mockImplementationOnce(() => {
        throw new Error('No signatures found matching');
      });

      expect(() => adapter.verifyWebhookSignature('tampered_body', 'bad_sig')).toThrow(
        'No signatures found matching',
      );
    });
  });

  // ── 3. payment_intent.succeeded triggers state transition ──────────────────

  describe('payment_intent.succeeded handler', () => {
    it('invokes PaymentSucceededHandler via handleStripeWebhook', async () => {
      const adapter = makeAdapter();
      mockBalanceRetrieve.mockResolvedValueOnce({ available: [], pending: [] });
      await adapter.initialize({
        options: { apiKey: 'sk_test_valid', webhookSecret: 'whsec_abc' },
      });

      mockWebhookEndpointsCreate.mockResolvedValueOnce({ id: 'we_1' });
      await adapter.registerWebhook('https://example.com/webhook/stripe/payment_intent.succeeded');

      const paymentHandler = vi.fn().mockResolvedValue(undefined);
      adapter.setPaymentSucceededHandler(paymentHandler);

      const piObject = {
        id: 'pi_live_456',
        amount: 9900,
        currency: 'usd',
        payment_link: 'plink_xyz',
        metadata: { order_ref: 'ORD-42' },
      };

      const stripeEvent = {
        id: 'evt_2',
        type: 'payment_intent.succeeded',
        data: { object: piObject },
      };

      mockConstructEvent.mockReturnValueOnce(stripeEvent);
      await adapter.handleStripeWebhook('raw_body', 'stripe_sig');

      expect(paymentHandler).toHaveBeenCalledOnce();
      expect(paymentHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentIntentId: 'pi_live_456',
          paymentLinkId: 'plink_xyz',
          amount: 9900,
          currency: 'usd',
          metadata: { order_ref: 'ORD-42' },
        }),
      );
    });

    it('does not crash when no PaymentSucceededHandler is registered', async () => {
      const adapter = makeAdapter();
      mockBalanceRetrieve.mockResolvedValueOnce({ available: [], pending: [] });
      await adapter.initialize({
        options: { apiKey: 'sk_test_valid', webhookSecret: 'whsec_abc' },
      });

      mockWebhookEndpointsCreate.mockResolvedValueOnce({ id: 'we_2' });
      await adapter.registerWebhook('https://example.com/webhook/stripe/payment_intent.succeeded');

      const stripeEvent = {
        id: 'evt_3',
        type: 'payment_intent.succeeded',
        data: {
          object: { id: 'pi_x', amount: 500, currency: 'usd', payment_link: null, metadata: {} },
        },
      };

      mockConstructEvent.mockReturnValueOnce(stripeEvent);
      await expect(adapter.handleStripeWebhook('raw_body', 'sig')).resolves.not.toThrow();
    });
  });

  // ── 4. Invalid API key throws on initialize ───────────────────────────────

  describe('initialize', () => {
    it('throws when apiKey is missing', async () => {
      const adapter = makeAdapter();
      await expect(adapter.initialize({ options: {} })).rejects.toThrow(
        'Stripe adapter requires an apiKey',
      );
    });

    it('throws when Stripe balance check fails (invalid key)', async () => {
      const adapter = makeAdapter();
      mockBalanceRetrieve.mockRejectedValueOnce(new Error('Invalid API Key provided'));

      await expect(adapter.initialize({ options: { apiKey: 'sk_invalid_key' } })).rejects.toThrow(
        'Stripe initialization failed: Invalid API Key provided',
      );
    });

    it('initializes successfully with a valid key', async () => {
      const adapter = makeAdapter();
      mockBalanceRetrieve.mockResolvedValueOnce({ available: [], pending: [] });

      await expect(
        adapter.initialize({ options: { apiKey: 'sk_test_abc' } }),
      ).resolves.not.toThrow();
    });
  });
});
