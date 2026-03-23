/**
 * Unit tests for src/intelligence/pdf-generator.ts
 *
 * Strategy:
 * - Template definition tests (fields, QR, branding) call the pure builder
 *   functions directly — no pdfmake needed.
 * - generatePdf() tests mock pdfmake so we can verify file creation and size
 *   without requiring the real fonts/binary on disk.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TDocumentDefinitions } from '../../src/intelligence/pdf-generator.js';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_RECORD = {
  invoiceNumber: 'INV-001',
  date: '2026-03-12',
  dueDate: '2026-04-12',
  customerName: 'Acme Corp',
  customerEmail: 'billing@acme.com',
  customerAddress: '123 Main St, Springfield',
  notes: 'Payment due within 30 days.',
  paymentLink: 'https://pay.example.com/inv-001',
  taxRate: 0.1,
  currency: 'USD',
};

const SAMPLE_ITEMS = [
  { description: 'Consulting — March 2026', quantity: 10, unitPrice: 200 },
  { description: 'Hosting fee', quantity: 1, unitPrice: 50 },
];

const SAMPLE_BRANDING = {
  companyName: 'OpenBridge Ltd',
  companyAddress: '1 Bridge St, London',
  companyEmail: 'hello@openbridge.dev',
  primaryColor: '#1a73e8',
};

// A minimal 1×1 PNG encoded as base64 for logo tests
const MINIMAL_PNG_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ---------------------------------------------------------------------------
// 1. Invoice template — definition structure
// ---------------------------------------------------------------------------

describe('buildInvoiceDefinition', () => {
  let buildInvoiceDefinition: (
    invoice: typeof SAMPLE_RECORD,
    items: typeof SAMPLE_ITEMS,
    branding: typeof SAMPLE_BRANDING,
  ) => TDocumentDefinitions;

  beforeEach(async () => {
    const mod = await import('../../src/intelligence/templates/invoice-template.js');
    buildInvoiceDefinition = mod.buildInvoiceDefinition as typeof buildInvoiceDefinition;
  });

  it('includes invoice number in content', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).toContain('INV-001');
  });

  it('includes customer name in content', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).toContain('Acme Corp');
  });

  it('includes invoice date', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).toContain('2026-03-12');
  });

  it('includes due date when provided', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).toContain('2026-04-12');
  });

  it('includes company name from branding', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).toContain('OpenBridge Ltd');
  });

  it('includes all line item descriptions', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).toContain('Consulting — March 2026');
    expect(json).toContain('Hosting fee');
  });

  it('computes correct grand total (subtotal + tax)', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    // subtotal = 10*200 + 1*50 = 2050; tax = 10% = 205; total = 2255
    const json = JSON.stringify(def);
    // Formatted by Intl.NumberFormat — "$2,255.00"
    expect(json).toContain('2,255.00');
  });

  it('includes notes when provided', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).toContain('Payment due within 30 days.');
  });

  it('includes payment link in content', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).toContain('https://pay.example.com/inv-001');
  });

  it('uses primary color from branding', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).toContain('#1a73e8');
  });

  it('has pageSize set to A4', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    expect(def.pageSize).toBe('A4');
  });

  it('has a styles dictionary with expected keys', () => {
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    expect(def.styles).toBeDefined();
    expect(def.styles).toHaveProperty('companyName');
    expect(def.styles).toHaveProperty('tableHeader');
    expect(def.styles).toHaveProperty('invoiceTitle');
  });

  it('omits due date when not provided', () => {
    const record = { ...SAMPLE_RECORD, dueDate: undefined };
    const def = buildInvoiceDefinition(record, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).not.toContain('2026-04-12');
  });

  it('omits tax rows when taxRate is not set', () => {
    const record = { ...SAMPLE_RECORD, taxRate: undefined };
    const def = buildInvoiceDefinition(record, SAMPLE_ITEMS, SAMPLE_BRANDING);
    const json = JSON.stringify(def);
    expect(json).not.toContain('Tax');
    // grand total equals subtotal
    expect(json).toContain('2,050.00');
  });
});

// ---------------------------------------------------------------------------
// 2. Branding logo — included in images dictionary when logoDataUri provided
// ---------------------------------------------------------------------------

describe('buildInvoiceDefinition — branding logo', () => {
  it('includes logo data URI in images dictionary when logoDataUri is set', async () => {
    const { buildInvoiceDefinition } =
      await import('../../src/intelligence/templates/invoice-template.js');
    const branding = { ...SAMPLE_BRANDING, logoDataUri: MINIMAL_PNG_DATA_URI };
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, branding);

    expect(def.images).toBeDefined();
    expect(def.images?.['companyLogo']).toBe(MINIMAL_PNG_DATA_URI);
  });

  it('omits images dictionary when no logo provided', async () => {
    const { buildInvoiceDefinition } =
      await import('../../src/intelligence/templates/invoice-template.js');
    const def = buildInvoiceDefinition(SAMPLE_RECORD, SAMPLE_ITEMS, SAMPLE_BRANDING);
    // Either undefined or an empty object — no companyLogo key
    const hasLogo = def.images != null && 'companyLogo' in def.images;
    expect(hasLogo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. generateQrDataUrl — produces a valid data URL
// ---------------------------------------------------------------------------

describe('generateQrDataUrl', () => {
  it('returns a base64 PNG data URL for a given text', async () => {
    const { generateQrDataUrl } = await import('../../src/intelligence/pdf-generator.js');
    const dataUrl = await generateQrDataUrl('https://pay.example.com/test');
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    // Non-trivial base64 content
    const base64Part = dataUrl.split(',')[1];
    expect(base64Part.length).toBeGreaterThan(100);
  });

  it('encodes different texts into different QR codes', async () => {
    const { generateQrDataUrl } = await import('../../src/intelligence/pdf-generator.js');
    const [a, b] = await Promise.all([
      generateQrDataUrl('https://example.com/a'),
      generateQrDataUrl('https://example.com/b'),
    ]);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// 4. generatePdf() — file creation, path returned, file size
// ---------------------------------------------------------------------------

describe('generatePdf', () => {
  let tmpDir: string;
  let generatePdf: (def: TDocumentDefinitions, workspacePath: string) => Promise<string>;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ob-pdf-test-'));

    // Mock pdfmake so the test does not require fonts on disk
    vi.doMock('pdfmake', () => {
      const instance = {
        addFonts: vi.fn(),
        createPdf: vi.fn(() => ({
          write: vi.fn(async (outPath: string) => {
            // Write a realistic minimal PDF stub (PDF header + body)
            const stub = Buffer.alloc(1024, 0x20); // 1 KB of spaces as stand-in
            stub.write('%PDF-1.4\n%%EOF\n', 0, 'ascii');
            await fs.writeFile(outPath, stub);
          }),
        })),
      };
      return { default: instance };
    });

    vi.resetModules();
    const mod = await import('../../src/intelligence/pdf-generator.js');
    generatePdf = mod.generatePdf;
  });

  afterEach(async () => {
    vi.doUnmock('pdfmake');
    vi.resetModules();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns an absolute path inside <workspacePath>/.openbridge/generated/', async () => {
    const def = { content: [{ text: 'Hello PDF' }] };
    const result = await generatePdf(def, tmpDir);

    expect(path.isAbsolute(result)).toBe(true);
    expect(result).toContain(path.join('.openbridge', 'generated'));
    expect(result).toMatch(/\.pdf$/);
  });

  it('creates the PDF file at the returned path', async () => {
    const def = { content: [{ text: 'Hello PDF' }] };
    const result = await generatePdf(def, tmpDir);

    const stat = await fs.stat(result);
    expect(stat.isFile()).toBe(true);
  });

  it('creates the output directory automatically when it does not exist', async () => {
    const nested = path.join(tmpDir, 'new-workspace');
    const def = { content: [{ text: 'Test' }] };
    const result = await generatePdf(def, nested);

    const stat = await fs.stat(result);
    expect(stat.isFile()).toBe(true);
  });

  it('file size is reasonable (< 500 KB for a basic document)', async () => {
    const def = { content: [{ text: 'Invoice content' }] };
    const result = await generatePdf(def, tmpDir);

    const stat = await fs.stat(result);
    expect(stat.size).toBeLessThan(500 * 1024);
  });

  it('generates a unique filename for each call', async () => {
    const def = { content: [{ text: 'PDF' }] };
    const [p1, p2] = await Promise.all([generatePdf(def, tmpDir), generatePdf(def, tmpDir)]);
    expect(p1).not.toBe(p2);
  });
});
