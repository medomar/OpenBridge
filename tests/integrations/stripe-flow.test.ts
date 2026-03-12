import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

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
import { ensureDocTypeStoreSchema, createDocType } from '../../src/intelligence/doctype-store.js';
import { executeTransition, resetAuditTableFlag } from '../../src/intelligence/state-machine.js';
import { getAuditLog } from '../../src/intelligence/audit-log.js';
import type {
  DocType,
  DocTypeTransition,
  DocTypeState,
  DocTypeHook,
} from '../../src/types/doctype.js';

// ── Constants ────────────────────────────────────────────────────────────────

const INVOICE_DOCTYPE_ID = 'dt_invoice_test';
const INVOICE_TABLE = 'dt_invoice';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const invoiceDocType: DocType = {
  id: INVOICE_DOCTYPE_ID,
  name: 'Invoice',
  label_singular: 'Invoice',
  label_plural: 'Invoices',
  table_name: INVOICE_TABLE,
  source: 'ai-created',
};

const invoiceStates: DocTypeState[] = [
  {
    id: 's1',
    doctype_id: INVOICE_DOCTYPE_ID,
    name: 'draft',
    label: 'Draft',
    color: 'gray',
    is_initial: true,
    is_terminal: false,
    sort_order: 0,
  },
  {
    id: 's2',
    doctype_id: INVOICE_DOCTYPE_ID,
    name: 'sent',
    label: 'Sent',
    color: 'blue',
    is_initial: false,
    is_terminal: false,
    sort_order: 1,
  },
  {
    id: 's3',
    doctype_id: INVOICE_DOCTYPE_ID,
    name: 'paid',
    label: 'Paid',
    color: 'green',
    is_initial: false,
    is_terminal: true,
    sort_order: 2,
  },
];

const invoiceTransitions: DocTypeTransition[] = [
  {
    id: 't1',
    doctype_id: INVOICE_DOCTYPE_ID,
    from_state: 'draft',
    to_state: 'sent',
    action_name: 'send',
    action_label: 'Send Invoice',
  },
  {
    id: 't2',
    doctype_id: INVOICE_DOCTYPE_ID,
    from_state: 'sent',
    to_state: 'paid',
    action_name: 'mark_paid',
    action_label: 'Mark as Paid',
  },
];

const invoiceHooks: DocTypeHook[] = [
  {
    id: 'h1',
    doctype_id: INVOICE_DOCTYPE_ID,
    event: 'after_transition',
    action_type: 'create_payment_link',
    action_config: { trigger_on_state: 'sent' },
    sort_order: 0,
    enabled: true,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function setupInvoiceSchema(db: Database.Database): void {
  ensureDocTypeStoreSchema(db);

  createDocType(db, {
    doctype: invoiceDocType,
    states: invoiceStates,
    transitions: invoiceTransitions,
    hooks: invoiceHooks,
  });

  // Create the dynamic data table for invoices
  db.exec(`
    CREATE TABLE IF NOT EXISTS "${INVOICE_TABLE}" (
      id          TEXT PRIMARY KEY,
      customer    TEXT NOT NULL,
      total       REAL NOT NULL DEFAULT 0,
      currency    TEXT NOT NULL DEFAULT 'usd',
      status      TEXT NOT NULL DEFAULT 'draft',
      payment_link TEXT,
      owner       TEXT,
      created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at  TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function insertInvoice(
  db: Database.Database,
  id: string,
  customer: string,
  total: number,
  status = 'draft',
  owner = 'user_1',
): void {
  db.prepare(
    `INSERT INTO "${INVOICE_TABLE}" (id, customer, total, status, owner) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, customer, total, status, owner);
}

async function initializedStripeAdapter(): Promise<StripeAdapter> {
  const adapter = new StripeAdapter();
  mockBalanceRetrieve.mockResolvedValueOnce({
    available: [{ amount: 10000, currency: 'usd' }],
    pending: [],
  });
  await adapter.initialize({
    options: { apiKey: 'sk_test_valid', webhookSecret: 'whsec_test_secret' },
  });
  return adapter;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Stripe payment flow (integration)', () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAuditTableFlag();
    db = createTestDb();
    setupInvoiceSchema(db);
  });

  afterEach(() => {
    db.close();
  });

  it('full flow: create invoice → send → payment link hook → webhook → paid → owner notified', async () => {
    // ── Step 1: Create an invoice record in "draft" state ─────────────────
    const invoiceId = 'inv_001';
    insertInvoice(db, invoiceId, 'Acme Corp', 9900, 'draft', 'owner_alice');

    const record = db
      .prepare(`SELECT * FROM "${INVOICE_TABLE}" WHERE id = ?`)
      .get(invoiceId) as Record<string, unknown>;
    expect(record['status']).toBe('draft');

    // ── Step 2: Transition invoice from "draft" → "sent" ──────────────────
    const hookExecutor = vi.fn();
    const notifyOwner = vi.fn();

    const sendResult = await executeTransition({
      db,
      doctype: invoiceDocType,
      tableName: INVOICE_TABLE,
      recordId: invoiceId,
      action: 'send',
      hookExecutor,
    });

    expect(sendResult.success).toBe(true);
    expect(sendResult.fromState).toBe('draft');
    expect(sendResult.toState).toBe('sent');

    // Verify hook executor was called with the after_transition hook
    expect(hookExecutor).toHaveBeenCalled();
    const hookCalls = hookExecutor.mock.calls as Array<[DocTypeHook[], Record<string, unknown>]>;
    const afterHookCall = hookCalls.find(([hooks]) =>
      hooks.some((h) => h.event === 'after_transition'),
    );
    expect(afterHookCall).toBeDefined();
    const firedHook = afterHookCall![0][0];
    expect(firedHook.action_type).toBe('create_payment_link');

    // ── Step 3: Simulate the "create_payment_link" hook firing Stripe ─────
    const adapter = await initializedStripeAdapter();

    mockPaymentLinksCreate.mockResolvedValueOnce({
      id: 'plink_flow_test',
      url: 'https://buy.stripe.com/flow_test',
    });

    const linkResult = (await adapter.execute('create_payment_link', {
      amount: 9900,
      currency: 'usd',
      description: 'Invoice inv_001 - Acme Corp',
    })) as { url: string; id: string };

    expect(linkResult.url).toBe('https://buy.stripe.com/flow_test');
    expect(linkResult.id).toBe('plink_flow_test');

    // Store payment link on the invoice record
    db.prepare(`UPDATE "${INVOICE_TABLE}" SET payment_link = ? WHERE id = ?`).run(
      linkResult.id,
      invoiceId,
    );

    // ── Step 4: Simulate Stripe webhook — payment_intent.succeeded ────────
    mockWebhookEndpointsCreate.mockResolvedValueOnce({ id: 'we_flow' });
    await adapter.registerWebhook('https://example.com/webhook/stripe/payment_intent.succeeded');

    // Wire up the payment succeeded handler to do the DocType transition
    adapter.setPaymentSucceededHandler(async (details) => {
      // Find the invoice by payment link ID
      const inv = db
        .prepare(`SELECT * FROM "${INVOICE_TABLE}" WHERE payment_link = ?`)
        .get(details.paymentLinkId) as Record<string, unknown> | undefined;

      if (!inv) return;

      const transitionResult = await executeTransition({
        db,
        doctype: invoiceDocType,
        tableName: INVOICE_TABLE,
        recordId: inv['id'] as string,
        action: 'mark_paid',
      });

      if (transitionResult.success) {
        // Notify the owner
        notifyOwner({
          owner: inv['owner'],
          invoiceId: inv['id'],
          amount: details.amount,
          currency: details.currency,
        });
      }
    });

    // Construct a realistic Stripe webhook event
    const stripeEvent = {
      id: 'evt_flow_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_flow_999',
          amount: 9900,
          currency: 'usd',
          payment_link: 'plink_flow_test',
          metadata: { invoice_ref: 'inv_001' },
        },
      },
    };

    mockConstructEvent.mockReturnValueOnce(stripeEvent);
    await adapter.handleStripeWebhook('raw_body_flow', 'stripe_sig_flow');

    // ── Step 5: Verify all state changes ──────────────────────────────────
    const finalRecord = db
      .prepare(`SELECT * FROM "${INVOICE_TABLE}" WHERE id = ?`)
      .get(invoiceId) as Record<string, unknown>;

    expect(finalRecord['status']).toBe('paid');
    expect(finalRecord['payment_link']).toBe('plink_flow_test');

    // ── Step 6: Verify owner was notified ─────────────────────────────────
    expect(notifyOwner).toHaveBeenCalledOnce();
    expect(notifyOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'owner_alice',
        invoiceId: 'inv_001',
        amount: 9900,
        currency: 'usd',
      }),
    );

    // ── Step 7: Verify audit trail ────────────────────────────────────────
    const auditLog = getAuditLog(db, 'Invoice', invoiceId);
    expect(auditLog.length).toBe(2);

    // First entry: draft → sent
    expect(auditLog[0].event).toBe('transition');
    expect(auditLog[0].old_value).toBe('draft');
    expect(auditLog[0].new_value).toBe('sent');

    // Second entry: sent → paid
    expect(auditLog[1].event).toBe('transition');
    expect(auditLog[1].old_value).toBe('sent');
    expect(auditLog[1].new_value).toBe('paid');
  });

  it('webhook for unknown payment link does not crash or transition', async () => {
    insertInvoice(db, 'inv_002', 'Other Corp', 5000, 'sent', 'owner_bob');
    db.prepare(`UPDATE "${INVOICE_TABLE}" SET payment_link = ? WHERE id = ?`).run(
      'plink_known',
      'inv_002',
    );

    const adapter = await initializedStripeAdapter();
    mockWebhookEndpointsCreate.mockResolvedValueOnce({ id: 'we_2' });
    await adapter.registerWebhook('https://example.com/webhook/stripe/payment_intent.succeeded');

    const transitionSpy = vi.fn();
    adapter.setPaymentSucceededHandler(async (details) => {
      const inv = db
        .prepare(`SELECT * FROM "${INVOICE_TABLE}" WHERE payment_link = ?`)
        .get(details.paymentLinkId) as Record<string, unknown> | undefined;

      if (!inv) return; // no match — do nothing

      transitionSpy();
    });

    // Webhook with an unknown payment link ID
    const event = {
      id: 'evt_unknown',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_unknown',
          amount: 1000,
          currency: 'usd',
          payment_link: 'plink_nonexistent',
          metadata: {},
        },
      },
    };

    mockConstructEvent.mockReturnValueOnce(event);
    await expect(adapter.handleStripeWebhook('body', 'sig')).resolves.not.toThrow();
    expect(transitionSpy).not.toHaveBeenCalled();

    // Original invoice unchanged
    const inv = db.prepare(`SELECT status FROM "${INVOICE_TABLE}" WHERE id = ?`).get('inv_002') as {
      status: string;
    };
    expect(inv.status).toBe('sent');
  });

  it('invalid transition is rejected — cannot pay a draft invoice directly', async () => {
    insertInvoice(db, 'inv_003', 'Draft Corp', 2000, 'draft');

    const result = await executeTransition({
      db,
      doctype: invoiceDocType,
      tableName: INVOICE_TABLE,
      recordId: 'inv_003',
      action: 'mark_paid',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No transition found');

    // Status unchanged
    const inv = db.prepare(`SELECT status FROM "${INVOICE_TABLE}" WHERE id = ?`).get('inv_003') as {
      status: string;
    };
    expect(inv.status).toBe('draft');
  });

  it('webhook signature verification failure prevents state transition', async () => {
    insertInvoice(db, 'inv_004', 'Secure Corp', 3000, 'sent');
    db.prepare(`UPDATE "${INVOICE_TABLE}" SET payment_link = ? WHERE id = ?`).run(
      'plink_secure',
      'inv_004',
    );

    const adapter = await initializedStripeAdapter();
    mockWebhookEndpointsCreate.mockResolvedValueOnce({ id: 'we_3' });
    await adapter.registerWebhook('https://example.com/webhook/stripe/payment_intent.succeeded');

    const transitionSpy = vi.fn();
    adapter.setPaymentSucceededHandler(async () => {
      transitionSpy();
    });

    // Simulate signature verification failure
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    await expect(adapter.handleStripeWebhook('tampered', 'bad_sig')).rejects.toThrow(
      'No signatures found matching',
    );
    expect(transitionSpy).not.toHaveBeenCalled();

    // Invoice still in "sent" state
    const inv = db.prepare(`SELECT status FROM "${INVOICE_TABLE}" WHERE id = ?`).get('inv_004') as {
      status: string;
    };
    expect(inv.status).toBe('sent');
  });

  it('transition audit records are written for each state change', async () => {
    insertInvoice(db, 'inv_005', 'Audit Corp', 7500, 'draft');

    // draft → sent
    await executeTransition({
      db,
      doctype: invoiceDocType,
      tableName: INVOICE_TABLE,
      recordId: 'inv_005',
      action: 'send',
    });

    // sent → paid
    await executeTransition({
      db,
      doctype: invoiceDocType,
      tableName: INVOICE_TABLE,
      recordId: 'inv_005',
      action: 'mark_paid',
    });

    // Check transition-specific audit table
    const transitionAudit = db
      .prepare(
        'SELECT * FROM doctype_transition_audit WHERE record_id = ? ORDER BY transitioned_at ASC',
      )
      .all('inv_005') as Array<{
      from_state: string;
      to_state: string;
      action: string;
    }>;

    expect(transitionAudit).toHaveLength(2);
    expect(transitionAudit[0].from_state).toBe('draft');
    expect(transitionAudit[0].to_state).toBe('sent');
    expect(transitionAudit[0].action).toBe('send');
    expect(transitionAudit[1].from_state).toBe('sent');
    expect(transitionAudit[1].to_state).toBe('paid');
    expect(transitionAudit[1].action).toBe('mark_paid');
  });
});
