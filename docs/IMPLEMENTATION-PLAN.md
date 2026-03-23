# OpenBridge Business Platform — Implementation Plan

> **Goal**: Transform OpenBridge from a developer AI bridge into a universal business AI platform.
> Every pattern below is inspired by production ERPs/CRMs and adapted for AI-first, conversation-driven usage.

---

## Table of Contents

- [Part 1: Architecture Patterns (What We Learn From)](#part-1-architecture-patterns)
- [Part 2: The DocType Engine](#part-2-the-doctype-engine)
- [Part 3: Document Intelligence Layer](#part-3-document-intelligence-layer)
- [Part 4: State Machine & Lifecycle Engine](#part-4-state-machine--lifecycle-engine)
- [Part 5: Computed Fields & Reactive Cascade](#part-5-computed-fields--reactive-cascade)
- [Part 6: Integration Hub](#part-6-integration-hub)
- [Part 7: Workflow Engine](#part-7-workflow-engine)
- [Part 8: Document Generation Pipeline](#part-8-document-generation-pipeline)
- [Part 9: Web Page & App Generation](#part-9-web-page--app-generation)
- [Part 10: Credential Security](#part-10-credential-security)
- [Part 11: Self-Improvement & Skill Learning](#part-11-self-improvement--skill-learning)
- [Part 12: Marketplace Integration](#part-12-marketplace-integration)
- [Part 13: Industry Templates](#part-13-industry-templates)
- [Part 14: Implementation Phases & Task Breakdown](#part-14-implementation-phases--task-breakdown)
- [Part 15: Tech Stack Additions](#part-15-tech-stack-additions)

---

## Part 1: Architecture Patterns

### Pattern Map: ERP/CRM → OpenBridge

Every major feature is inspired by a proven production system. This table is the reference for all implementation decisions.

| Business Need               | Inspiration Source                   | How They Solve It                                                                      | OpenBridge Adaptation                                                     |
| --------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Organized data**          | Frappe DocType                       | ONE JSON definition → DB table + REST API + Web form + PDF + permissions               | AI creates DocType from conversation → SQLite table + API + form          |
| **Auto-numbering**          | Frappe `naming_series` + `tabSeries` | Partitioned counter table, `FOR UPDATE` row lock, zero-padded                          | `dt_series` table in SQLite, per-prefix counters                          |
| **Child records**           | Frappe child tables                  | `parent` / `parentfield` / `parenttype` triple, delete-and-reinsert on save            | Invoice items, project tasks, order lines as child tables                 |
| **Computed fields**         | Odoo `@api.depends`                  | Reactive dependency graph, cascading recomputation, stored vs non-stored               | SQLite `GENERATED` columns + triggers for cross-table cascade             |
| **Unified documents**       | Odoo `account.move`                  | ONE model for invoices + bills + credit notes + payments, discriminated by `move_type` | Single `dt_document` concept with `doc_type` discriminator                |
| **Payment matching**        | Odoo reconciliation engine           | Match debit/credit lines on same account, partial + full reconcile                     | Stripe payment → match to invoice by payment link ID                      |
| **Email from any doc**      | Odoo `mail.thread` mixin             | `_inherit = ['mail.thread']` adds messaging to any model                               | `[SHARE:email]` output markers already exist                              |
| **Auto-actions**            | Odoo `base.automation`               | AOP: monkey-patch `create()`/`write()` to inject trigger checks                        | Workflow triggers on DocType field changes                                |
| **Pipeline stages**         | HubSpot CRM                          | Stages with probability weighting → revenue forecasting                                | Task/order pipelines with weighted metrics                                |
| **Activity timeline**       | HubSpot contact timeline             | Multi-source aggregation via associations, custom timeline events API                  | Knowledge Graph + `conversation_messages` aggregation                     |
| **Dynamic schema**          | Twenty CRM                           | Metadata tables → runtime `ALTER TABLE` → regenerate GraphQL → cache                   | DocType metadata → runtime `CREATE TABLE` → auto-generate API             |
| **Custom objects**          | Twenty CRM                           | `ObjectMetadata` + `FieldMetadata` tables, per-workspace PostgreSQL schema             | `doctypes` + `doctype_fields` metadata tables in SQLite                   |
| **Execution pipeline**      | Salesforce triggers                  | 20-step deterministic order: before-save → validate → save → after-save → commit       | Message → auth → classify → before-hooks → execute → after-hooks → commit |
| **Visual automation**       | Salesforce Flows                     | Interpreter pattern: flow definition = program, runtime = interpreter                  | Workflow definition in SQLite, executed by workflow engine                |
| **Formula fields**          | Salesforce                           | Compiled expressions evaluated at query time, cross-object traversal                   | SQLite `GENERATED` columns + AI-evaluated complex formulas                |
| **Payment gateways**        | Invoice Ninja                        | Strategy pattern: `BasePaymentDriver` → 25+ gateway implementations                    | `BusinessIntegration` interface → Stripe/PayPal/Flouci adapters           |
| **Recurring billing**       | Invoice Ninja                        | Cron job + template clone → new invoice + auto-bill stored payment method              | Workflow scheduler + DocType template instantiation                       |
| **Client portal**           | Invoice Ninja                        | Token-based auth, scoped views (client sees only their records)                        | Generated HTML pages with UUID-based access                               |
| **PDF generation**          | Frappe + Odoo                        | HTML template (Jinja/QWeb) → wkhtmltopdf subprocess → PDF                              | pdfmake (declarative JSON → PDF) + Puppeteer fallback                     |
| **Data flow between steps** | n8n                                  | `{ json: data, binary: files }` structure between pipeline nodes                       | Worker output as structured JSON + file attachments                       |
| **Credential encryption**   | n8n                                  | AES-256-GCM encrypt-at-rest, decrypt-on-demand per node execution                      | Encrypt in SQLite, decrypt only when worker needs it                      |
| **Webhook lifecycle**       | n8n                                  | Register endpoint on activate, unregister on deactivate, persist in DB                 | Integration webhook endpoints on file-server                              |
| **Report generation**       | Odoo QWeb                            | XML template with directives + data context → HTML → wkhtmltopdf → PDF                 | Skill pack + pdfmake/Puppeteer → PDF served via file-server               |

---

## Part 2: The DocType Engine

### What It Is

A DocType is a business entity definition that the Master AI creates when it detects the user needs to track something. ONE definition generates: database table, REST API, web form, list view, PDF template, state machine, FTS5 index, and WhatsApp commands.

**Inspired by**: Frappe DocType (metadata-first), Twenty CRM (runtime schema), NocoDB (dual-database separation)

### How It Works Step by Step

```
User says: "I need to track my invoices"
     │
     ▼
Step 1: INTENT DETECTION (Master AI, existing classification engine)
     Master recognizes: user needs a new business entity
     No existing DocType "Invoice" found
     │
     ▼
Step 2: SCHEMA GENERATION (Master AI spawns worker)
     Worker prompt: "Design an Invoice entity with appropriate fields,
                     lifecycle states, and computed fields for a
                     [detected-industry] business"
     Worker returns DocType JSON definition
     │
     ▼
Step 3: METADATA STORAGE
     INSERT INTO doctypes (name, label, icon, source, ...) VALUES (...)
     INSERT INTO doctype_fields (doctype_id, name, type, ...) VALUES (...) -- per field
     INSERT INTO doctype_states (doctype_id, name, transitions, ...) VALUES (...) -- per state
     INSERT INTO doctype_hooks (doctype_id, event, action, ...) VALUES (...) -- per hook
     │
     ▼
Step 4: TABLE CREATION (dynamic DDL)
     CREATE TABLE dt_invoice (
       id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
       invoice_number TEXT UNIQUE,
       client_id TEXT,
       issue_date TEXT DEFAULT (date('now')),
       due_date TEXT,
       subtotal REAL DEFAULT 0,
       tax_rate REAL DEFAULT 19,
       tax_amount REAL GENERATED ALWAYS AS (subtotal * tax_rate / 100) STORED,
       total REAL GENERATED ALWAYS AS (subtotal + (subtotal * tax_rate / 100)) STORED,
       status TEXT DEFAULT 'draft',
       payment_link TEXT,
       pdf_path TEXT,
       notes TEXT,
       created_at TEXT DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
       created_by TEXT
     );
     CREATE INDEX idx_dt_invoice_status ON dt_invoice(status);
     CREATE INDEX idx_dt_invoice_client ON dt_invoice(client_id);
     │
     ▼
Step 5: CHILD TABLE CREATION (Frappe pattern)
     CREATE TABLE dt_invoice__items (
       id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
       parent_id TEXT NOT NULL REFERENCES dt_invoice(id) ON DELETE CASCADE,
       idx INTEGER NOT NULL,              -- sort order (Frappe pattern)
       description TEXT NOT NULL,
       quantity REAL DEFAULT 1,
       unit_price REAL NOT NULL,
       amount REAL GENERATED ALWAYS AS (quantity * unit_price) STORED,
       UNIQUE(parent_id, idx)
     );
     │
     ▼
Step 6: SERIES TABLE (Frappe naming_series pattern)
     INSERT INTO dt_series (prefix, current_value) VALUES ('INV-2026-', 0);
     │
     ▼
Step 7: FTS5 INDEX
     CREATE VIRTUAL TABLE dt_invoice_fts USING fts5(
       invoice_number, notes, content=dt_invoice, content_rowid=rowid
     );
     -- Triggers to keep FTS5 in sync with data table
     │
     ▼
Step 8: RECOMPUTATION TRIGGERS (Odoo @api.depends pattern)
     CREATE TRIGGER trg_invoice_recompute
     AFTER INSERT ON dt_invoice__items
     BEGIN
       UPDATE dt_invoice SET
         subtotal = (SELECT COALESCE(SUM(amount), 0) FROM dt_invoice__items WHERE parent_id = NEW.parent_id),
         updated_at = datetime('now')
       WHERE id = NEW.parent_id;
     END;
     -- Similar triggers for UPDATE and DELETE on items
     │
     ▼
Step 9: CONFIRMATION
     Master replies: "✓ Invoice tracking is ready.
                      I can now create, send, and track invoices.
                      Try: 'Invoice Mohamed for web design TND 2000'"
```

### Database Schema (Metadata Tables)

```sql
-- DocType definitions (schema registry)
CREATE TABLE doctypes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,           -- "Invoice", "Customer", "Vehicle"
  label_singular TEXT NOT NULL,        -- "Invoice"
  label_plural TEXT NOT NULL,          -- "Invoices"
  icon TEXT,                           -- "📄"
  table_name TEXT NOT NULL UNIQUE,     -- "dt_invoice"
  source TEXT NOT NULL,                -- 'ai-created', 'imported', 'integration', 'template'
  template_id TEXT,                    -- industry template that spawned this
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Field definitions per DocType
CREATE TABLE doctype_fields (
  id TEXT PRIMARY KEY,
  doctype_id TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                  -- "invoice_number", "client_id"
  label TEXT NOT NULL,                 -- "Invoice #", "Client"
  field_type TEXT NOT NULL,            -- 'text', 'number', 'currency', 'date', 'link', 'table', ...
  required INTEGER DEFAULT 0,
  default_value TEXT,                  -- JSON-encoded default
  options TEXT,                        -- JSON array for select/multiselect
  formula TEXT,                        -- Expression for computed fields
  depends_on TEXT,                     -- Conditional visibility expression
  searchable INTEGER DEFAULT 0,       -- Include in FTS5
  sort_order INTEGER NOT NULL,         -- Display order
  link_doctype TEXT,                   -- For 'link' type: target DocType name
  child_doctype TEXT,                  -- For 'table' type: child DocType name
  UNIQUE(doctype_id, name)
);

-- State machine definitions
CREATE TABLE doctype_states (
  id TEXT PRIMARY KEY,
  doctype_id TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                  -- "draft", "sent", "paid", "overdue"
  label TEXT NOT NULL,                 -- "Draft", "Sent", "Paid", "Overdue"
  color TEXT DEFAULT 'gray',           -- UI color hint
  is_initial INTEGER DEFAULT 0,        -- Starting state
  is_terminal INTEGER DEFAULT 0,       -- End state (no transitions out)
  sort_order INTEGER NOT NULL,
  UNIQUE(doctype_id, name)
);

-- State transitions
CREATE TABLE doctype_transitions (
  id TEXT PRIMARY KEY,
  doctype_id TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  action_name TEXT NOT NULL,           -- "send", "mark_paid", "cancel"
  action_label TEXT NOT NULL,          -- "Send Invoice", "Mark as Paid"
  allowed_roles TEXT,                  -- JSON array: ["owner", "admin"]
  condition TEXT,                      -- Expression: "total > 0"
  UNIQUE(doctype_id, from_state, action_name)
);

-- Lifecycle hooks (Odoo base.automation + Salesforce triggers)
CREATE TABLE doctype_hooks (
  id TEXT PRIMARY KEY,
  doctype_id TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
  event TEXT NOT NULL,                 -- 'create', 'update', 'delete', 'transition:{action}'
  action_type TEXT NOT NULL,           -- 'generate_number', 'generate_pdf', 'send_notification',
                                       -- 'create_payment_link', 'update_field', 'run_workflow',
                                       -- 'call_integration', 'spawn_worker'
  action_config TEXT NOT NULL,         -- JSON: hook-specific configuration
  sort_order INTEGER DEFAULT 0,        -- Execution order (Salesforce-inspired deterministic ordering)
  enabled INTEGER DEFAULT 1
);

-- Relations between DocTypes
CREATE TABLE doctype_relations (
  id TEXT PRIMARY KEY,
  from_doctype TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
  to_doctype TEXT NOT NULL REFERENCES doctypes(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,         -- 'has_many', 'belongs_to', 'many_to_many'
  from_field TEXT NOT NULL,            -- Field on source DocType
  to_field TEXT DEFAULT 'id',          -- Field on target DocType
  label TEXT                           -- "Customer's Invoices"
);

-- Auto-numbering (Frappe naming_series pattern)
CREATE TABLE dt_series (
  prefix TEXT PRIMARY KEY,             -- "INV-2026-", "QUO-2026-", "PO-2026-"
  current_value INTEGER DEFAULT 0
);
```

### Auto-Numbering Implementation (Frappe naming_series)

```
How Frappe does it:
  Table: tabSeries
  ┌──────────────┬─────────┐
  │ name (prefix)│ current │
  ├──────────────┼─────────┤
  │ INV-2026-    │ 42      │
  └──────────────┴─────────┘

  On INSERT:
    BEGIN IMMEDIATE;                              -- SQLite equivalent of FOR UPDATE
    SELECT current_value FROM dt_series WHERE prefix = 'INV-2026-';
    UPDATE dt_series SET current_value = current_value + 1 WHERE prefix = 'INV-2026-';
    COMMIT;
    → Result: INV-2026-00043

How OpenBridge does it:
  Same pattern, executed inside the 'create' hook:

  Hook config: {
    "type": "generate_number",
    "pattern": "INV-{YYYY}-{#####}",
    "field": "invoice_number"
  }

  Engine parses pattern:
    "INV-" + year(now) + "-" → prefix = "INV-2026-"
    "#####" → 5-digit zero-padded counter

  Upsert into dt_series, increment, format → "INV-2026-00043"
  Set field on the new record before INSERT
```

### REST API Auto-Generation

```
For each DocType, file-server exposes:

  GET    /api/dt/:doctype                → List records (with pagination, filters, search)
  GET    /api/dt/:doctype/:id            → Get single record (with child tables)
  POST   /api/dt/:doctype                → Create record (runs hooks: generate_number, validate)
  PUT    /api/dt/:doctype/:id            → Update record (runs hooks: recompute, validate)
  DELETE /api/dt/:doctype/:id            → Soft-delete record
  POST   /api/dt/:doctype/:id/transition → Execute state transition (runs transition hooks)
  GET    /api/dt/:doctype/search?q=...   → FTS5 search

All endpoints:
  - Validate fields against DocType schema (Zod generated from metadata)
  - Check state machine rules for transitions
  - Fire lifecycle hooks in deterministic order (Salesforce-inspired)
  - Return structured JSON responses
```

### Web Form Auto-Generation

```
For each DocType, a worker generates an HTML form:

  GET /forms/:doctype/new              → Create form
  GET /forms/:doctype/:id/edit         → Edit form
  GET /forms/:doctype                  → List view (table with search/filter/sort)
  GET /forms/:doctype/:id              → Detail view

The form is generated from field metadata:
  field_type = 'text'       → <input type="text">
  field_type = 'number'     → <input type="number">
  field_type = 'currency'   → <input type="number" step="0.01"> with currency symbol
  field_type = 'date'       → <input type="date">
  field_type = 'select'     → <select> with options from field.options
  field_type = 'link'       → <select> populated from linked DocType
  field_type = 'table'      → Inline editable rows (add/remove)
  field_type = 'longtext'   → <textarea>
  field_type = 'image'      → <input type="file" accept="image/*">
  field_type = 'checkbox'   → <input type="checkbox">

State machine buttons rendered at top:
  Current state: "draft" → Show: [Send Invoice] button
  Current state: "sent"  → Show: [Mark as Paid] [Mark Overdue] buttons
```

---

## Part 3: Document Intelligence Layer

### What It Is

The system that reads ANY file a business throws at it and extracts structured data.

### File Processing Pipeline

```
File arrives (WhatsApp attachment, email, file drop, cloud sync)
     │
     ▼
Step 1: MIME DETECTION
     npm: file-type
     Detect: PDF, XLSX, DOCX, image, email, CSV, JSON, XML
     │
     ▼
Step 2: ROUTE TO PROCESSOR
     ┌──────────────────────────────────────────────┐
     │ PDF   → pdf-parse (text + tables)            │
     │         + Tesseract.js (OCR if scanned)       │
     │ XLSX  → SheetJS/xlsx (sheets, formulas)       │
     │ CSV   → SheetJS/xlsx or csv-parse             │
     │ DOCX  → mammoth.js (text + tables)            │
     │ Image → AI vision (Claude/Gemini multimodal)  │
     │         + Tesseract.js (OCR for text in image) │
     │ Email → mailparser (subject, body, attachments)│
     │ JSON  → native JSON.parse + schema detection   │
     │ XML   → xml2js + schema detection              │
     └──────────────────────────────────────────────┘
     │
     ▼
Step 3: EXTRACT RAW CONTENT
     Result: { rawText, tables[], images[], metadata }
     │
     ▼
Step 4: AI ENTITY EXTRACTION (Master spawns worker)
     Worker prompt: "Analyze this document and extract:
       - Entity type (invoice, receipt, contract, catalog, report...)
       - Key entities (people, companies, products, amounts, dates)
       - Relationships between entities
       - Any tabular data as structured records"

     Worker returns structured JSON:
     {
       "documentType": "supplier_invoice",
       "entities": [
         { "type": "supplier", "name": "Fournisseur ABC", "attributes": { "phone": "..." } },
         { "type": "product", "name": "Flour 50kg", "attributes": { "price": 45, "quantity": 1 } }
       ],
       "relations": [
         { "from": "Fournisseur ABC", "to": "Flour 50kg", "type": "supplied" }
       ],
       "amounts": { "subtotal": 95, "tax": 18.05, "total": 113.05 },
       "dates": { "invoice_date": "2026-03-01", "due_date": "2026-03-31" }
     }
     │
     ▼
Step 5: STORE IN KNOWLEDGE GRAPH
     - Upsert entities into appropriate DocType tables (or create new DocTypes)
     - Create relations in doctype_relations
     - Index text in FTS5
     - Generate embedding for vector search (if configured)
     │
     ▼
Step 6: CONFIRM TO USER
     "✓ Processed supplier invoice from Fournisseur ABC
      Items: Flour 50kg (TND 45), Milk 20L (TND 32), Sugar 5kg (TND 18)
      Total: TND 113.05, due March 31
      ✓ Updated inventory estimates
      ✓ Supplier added to contacts"
```

### Processor Implementations

```
src/intelligence/
├── document-processor.ts         ← Unified entry point (MIME routing)
├── processors/
│   ├── pdf-processor.ts          ← pdf-parse + Tesseract.js OCR fallback
│   ├── excel-processor.ts        ← SheetJS (xlsx) — sheets, formulas, named ranges
│   ├── csv-processor.ts          ← csv-parse or SheetJS
│   ├── word-processor.ts         ← mammoth.js — docx → text/HTML
│   ├── image-processor.ts        ← AI vision + Tesseract.js OCR
│   ├── email-processor.ts        ← mailparser — MIME → structured
│   └── json-xml-processor.ts     ← Native parsers + schema detection
├── entity-extractor.ts           ← AI-powered entity extraction (spawns worker)
├── knowledge-graph.ts            ← Entity/relation storage + query
└── index.ts                      ← Exports
```

---

## Part 4: State Machine & Lifecycle Engine

### What It Is

Every business document has a lifecycle. The state machine enforces valid transitions and fires hooks at each step.

### Execution Pipeline (Salesforce-Inspired)

```
State transition requested (e.g., "send invoice #042")
     │
     ▼
Step 1: LOAD RECORD
     SELECT * FROM dt_invoice WHERE id = ? (includes current status)
     Load DocType metadata (states, transitions, hooks)
     │
     ▼
Step 2: VALIDATE TRANSITION
     Current state: "draft"
     Requested action: "send"
     Check: Is there a transition from "draft" via "send"? → YES → to "sent"
     Check: Does user have allowed role? → YES (owner)
     Check: Does condition pass? → Evaluate "total > 0" → YES (total = 2380)
     │
     ▼
Step 3: BEFORE-HOOKS (Salesforce before-trigger pattern)
     Fire hooks with event = 'transition:send' AND timing = 'before':
     - Validate: all required fields populated
     - Validate: at least one line item exists
     (Can modify in-memory record, no DB write yet)
     │
     ▼
Step 4: EXECUTE TRANSITION
     UPDATE dt_invoice SET status = 'sent', updated_at = datetime('now') WHERE id = ?
     INSERT INTO dt_audit_log (doctype, record_id, event, old_value, new_value, by, at)
       VALUES ('Invoice', ?, 'transition:send', 'draft', 'sent', ?, datetime('now'))
     │
     ▼
Step 5: AFTER-HOOKS (Salesforce after-trigger pattern)
     Fire hooks with event = 'transition:send' AND timing = 'after':

     Hook 1: generate_pdf
       → Spawn worker with document-writer skill pack
       → Generate invoice PDF via pdfmake
       → Save to .openbridge/generated/inv-2026-042.pdf
       → Update record: pdf_path = '...'

     Hook 2: create_payment_link
       → If Stripe connected:
         stripe.paymentLinks.create({ line_items: [...] })
         → Update record: payment_link = 'https://buy.stripe.com/xxx'

     Hook 3: send_to_client
       → Determine delivery channel (WhatsApp + email)
       → Send PDF via WhatsApp connector
       → Send email with PDF attachment via nodemailer
       → Send payment link as interactive button (WhatsApp Business API)

     Hook 4: create_reminder_workflow
       → If not exists: create workflow "Invoice #042 overdue reminder"
         Trigger: schedule, cron: "0 9 * * *" (daily 9am)
         Condition: invoice.due_date < today AND status = 'sent'
         Action: update status to 'overdue' + notify owner
     │
     ▼
Step 6: TRIGGER DEPENDENT WORKFLOWS
     Check: any workflows triggered by "Invoice.status changed to sent"?
     Execute matching workflows
     │
     ▼
Step 7: RESPOND TO USER
     "✓ Invoice #INV-2026-042 sent to Mohamed
      📎 PDF attached
      💳 Payment link: https://buy.stripe.com/xxx
      📧 Email sent to mohamed@example.com
      ⏰ I'll remind you if unpaid after due date"
```

### Hook Types & Their Configs

```
┌────────────────────┬──────────────────────────────────────────────────┐
│ Hook Type          │ Config Example                                    │
├────────────────────┼──────────────────────────────────────────────────┤
│ generate_number    │ { "pattern": "INV-{YYYY}-{#####}",              │
│                    │   "field": "invoice_number" }                    │
├────────────────────┼──────────────────────────────────────────────────┤
│ generate_pdf       │ { "template": "invoice",                        │
│                    │   "output_field": "pdf_path",                    │
│                    │   "skill_pack": "document-writer" }              │
├────────────────────┼──────────────────────────────────────────────────┤
│ create_payment_link│ { "integration": "stripe",                      │
│                    │   "output_field": "payment_link",                │
│                    │   "amount_field": "total",                       │
│                    │   "description_field": "invoice_number" }        │
├────────────────────┼──────────────────────────────────────────────────┤
│ send_notification  │ { "channel": "whatsapp",                        │
│                    │   "recipient_field": "client.phone",             │
│                    │   "template": "Invoice {{invoice_number}} sent.  │
│                    │     Total: TND {{total}}. Pay: {{payment_link}}" │
│                    │   "attachments": ["pdf_path"] }                  │
├────────────────────┼──────────────────────────────────────────────────┤
│ send_email         │ { "to_field": "client.email",                   │
│                    │   "subject": "Invoice {{invoice_number}}",       │
│                    │   "template": "invoice_email",                   │
│                    │   "attachments": ["pdf_path"] }                  │
├────────────────────┼──────────────────────────────────────────────────┤
│ update_field       │ { "field": "sent_at",                           │
│                    │   "value": "now()" }                             │
├────────────────────┼──────────────────────────────────────────────────┤
│ run_workflow       │ { "workflow_id": "...",                          │
│                    │   "params": { "invoice_id": "{{id}}" } }         │
├────────────────────┼──────────────────────────────────────────────────┤
│ call_integration   │ { "integration": "marketplace",                 │
│                    │   "operation": "update_order_status",            │
│                    │   "params": { "orderId": "{{order_id}}" } }      │
├────────────────────┼──────────────────────────────────────────────────┤
│ spawn_worker       │ { "skill_pack": "data-analyst",                 │
│                    │   "prompt": "Analyze impact of invoice {{id}}" } │
└────────────────────┴──────────────────────────────────────────────────┘
```

---

## Part 5: Computed Fields & Reactive Cascade

### What It Is

When a value changes, all dependent values auto-recompute. Like a spreadsheet, but for your business database.

### How Odoo Does It (The @api.depends Pattern)

```
Odoo uses decorators to declare dependency graphs:

  @api.depends('quantity', 'price_unit', 'discount')
  def _compute_amount(self):
      self.price_subtotal = self.quantity * self.price_unit * (1 - self.discount/100)

  @api.depends('line_ids.price_subtotal')    ← cross-model dependency!
  def _compute_total(self):
      self.amount_untaxed = sum(self.line_ids.mapped('price_subtotal'))
      self.amount_tax = self.amount_untaxed * self.tax_rate / 100
      self.amount_total = self.amount_untaxed + self.amount_tax

The ORM walks the dependency DAG and recomputes in correct order.
```

### How OpenBridge Implements It

```sql
-- Level 1: Same-table computed fields (SQLite GENERATED columns)
-- These recompute automatically on every read/write — zero code needed

CREATE TABLE dt_invoice (
  subtotal REAL DEFAULT 0,
  tax_rate REAL DEFAULT 19,
  tax_amount REAL GENERATED ALWAYS AS (subtotal * tax_rate / 100) STORED,
  total REAL GENERATED ALWAYS AS (subtotal + (subtotal * tax_rate / 100)) STORED
);

-- Level 2: Cross-table cascade (SQLite triggers — Odoo @api.depends pattern)
-- When invoice items change → recompute invoice subtotal

CREATE TRIGGER trg_invoice_items_insert
AFTER INSERT ON dt_invoice__items
BEGIN
  UPDATE dt_invoice SET
    subtotal = (SELECT COALESCE(SUM(amount), 0)
                FROM dt_invoice__items
                WHERE parent_id = NEW.parent_id),
    updated_at = datetime('now')
  WHERE id = NEW.parent_id;
END;

CREATE TRIGGER trg_invoice_items_update
AFTER UPDATE OF quantity, unit_price ON dt_invoice__items
BEGIN
  UPDATE dt_invoice SET
    subtotal = (SELECT COALESCE(SUM(amount), 0)
                FROM dt_invoice__items
                WHERE parent_id = NEW.parent_id),
    updated_at = datetime('now')
  WHERE id = NEW.parent_id;
END;

CREATE TRIGGER trg_invoice_items_delete
AFTER DELETE ON dt_invoice__items
BEGIN
  UPDATE dt_invoice SET
    subtotal = (SELECT COALESCE(SUM(amount), 0)
                FROM dt_invoice__items
                WHERE parent_id = OLD.parent_id),
    updated_at = datetime('now')
  WHERE id = OLD.parent_id;
END;

-- Result: Change an item's quantity → item.amount recomputes (GENERATED)
--         → trigger fires → invoice.subtotal recomputes
--         → invoice.tax_amount recomputes (GENERATED)
--         → invoice.total recomputes (GENERATED)
-- ALL AUTOMATIC. No application code.
```

### Cascade Example (Full Flow)

```
User: "Update the hourly rate to TND 200 on invoice 042, line 1"

What happens in SQLite:

  UPDATE dt_invoice__items SET unit_price = 200 WHERE id = 'item_001';

  Automatic cascade:
  1. dt_invoice__items.amount = 3 × 200 = 600      (GENERATED column)
  2. Trigger fires → UPDATE dt_invoice SET subtotal = SUM(items) = 600
  3. dt_invoice.tax_amount = 600 × 0.19 = 114       (GENERATED column)
  4. dt_invoice.total = 600 + 114 = 714              (GENERATED column)

  One UPDATE from the user → four values recomputed automatically.
```

---

## Part 6: Integration Hub

### Architecture

```
src/integrations/
├── hub.ts                        ← IntegrationHub: registry + lifecycle
├── integration.ts                ← BusinessIntegration interface
├── credential-store.ts           ← Encrypted credential storage (n8n pattern)
├── webhook-router.ts             ← Incoming webhook dispatcher
├── adapters/
│   ├── stripe-adapter.ts         ← Stripe: payments, invoices, links, webhooks
│   ├── google-drive-adapter.ts   ← Google Drive: OAuth, files, watch
│   ├── google-sheets-adapter.ts  ← Google Sheets: read/write rows
│   ├── google-calendar-adapter.ts← Google Calendar: events, bookings
│   ├── dropbox-adapter.ts        ← Dropbox: OAuth, files, sync
│   ├── email-adapter.ts          ← Gmail/IMAP: send + read emails
│   ├── database-adapter.ts       ← PostgreSQL/MySQL/MongoDB direct
│   ├── openapi-adapter.ts        ← ANY Swagger/OpenAPI spec → auto-capabilities
│   └── marketplace-adapter.ts    ← YOUR marketplace API (460+ endpoints)
└── index.ts                      ← Exports
```

### Integration Interface

```typescript
interface BusinessIntegration {
  name: string; // "stripe", "google-drive", "marketplace"
  type: 'payment' | 'storage' | 'communication' | 'database' | 'api' | 'calendar';

  // Lifecycle
  initialize(config: IntegrationConfig): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  shutdown(): Promise<void>;

  // Discovery — Master AI reads this to understand capabilities
  describeCapabilities(): IntegrationCapability[];

  // Read (no approval needed)
  query(operation: string, params: Record<string, unknown>): Promise<unknown>;

  // Write (requires human approval unless pre-approved)
  execute(operation: string, params: Record<string, unknown>): Promise<unknown>;

  // Real-time events
  subscribe?(event: string, handler: EventHandler): void;
  registerWebhook?(endpoint: string): Promise<void>;
  unregisterWebhook?(): Promise<void>;
}

interface IntegrationCapability {
  name: string; // "create_payment_link", "list_files", "send_email"
  description: string; // Human-readable for Master AI prompt injection
  category: 'read' | 'write' | 'admin';
  requiresApproval: boolean; // Human-in-the-loop for write ops
  parameters: ZodSchema; // Input validation
}
```

### Stripe Adapter (End-to-End Flow)

```
SETUP:
  User: "Connect Stripe"
  OpenBridge: "Send me your Stripe API key (starts with sk_live_...)"
  User sends key → Encrypted and stored (n8n pattern, see Part 10)
  OpenBridge: "✓ Stripe connected. I can create payment links and invoices."

USAGE:
  User: "Create a payment link for TND 500, web design service"

  Master AI:
    1. Classifies intent: payment link creation
    2. Checks: Stripe integration connected? YES
    3. Calls: stripeAdapter.execute('create_payment_link', {
         amount: 50000,          // Stripe uses cents
         currency: 'tnd',
         description: 'Web Design Service'
       })
    4. Under the hood:
       - Decrypt Stripe API key from credential store
       - const stripe = new Stripe(decryptedKey);
       - const link = await stripe.paymentLinks.create({
           line_items: [{
             price_data: {
               currency: 'tnd',
               unit_amount: 50000,
               product_data: { name: 'Web Design Service' }
             },
             quantity: 1
           }]
         });
       - Return: link.url
    5. Respond: "✓ Payment link: https://buy.stripe.com/xxxxx
                 Share it with your client to collect TND 500."

WEBHOOK:
  Stripe sends POST /webhook/stripe with event: payment_intent.succeeded

  OpenBridge:
    1. Verify webhook signature (stripe.webhooks.constructEvent)
    2. Extract: amount, customer email, payment link ID
    3. Match to invoice in Knowledge Graph (by payment_link field)
    4. Execute state transition: invoice.status → 'paid'
    5. Fire after-hooks: notify owner via WhatsApp
```

### OpenAPI Auto-Adapter (The Universal Connector)

```
User: "Connect to my backend API"
User sends: swagger.json URL or file

OpenBridge:
  1. Parse OpenAPI/Swagger spec (npm: swagger-parser)
  2. For each path + method, generate a capability:

     GET /api/v1/products → {
       name: "list_products",
       description: "List products with optional filters",
       category: "read",
       requiresApproval: false,
       parameters: z.object({
         page: z.number().optional(),
         limit: z.number().optional(),
         category: z.string().optional()
       })
     }

     POST /api/v1/orders → {
       name: "create_order",
       description: "Create a new order",
       category: "write",
       requiresApproval: true,     // All POST/PUT/DELETE = approval needed
       parameters: z.object({
         customerId: z.string(),
         items: z.array(z.object({
           productId: z.string(),
           quantity: z.number()
         }))
       })
     }

  3. Master AI gets capability list injected into system prompt
  4. User asks "how many orders this week?"
     → Master selects "list_orders" capability
     → Adapter calls GET /api/v1/orders?date_gte=2026-03-05
     → Formats response for user
```

---

## Part 7: Workflow Engine

### Architecture

```
src/workflows/
├── engine.ts                     ← WorkflowEngine: load, execute, manage
├── scheduler.ts                  ← Cron scheduler (node-cron)
├── webhook-trigger.ts            ← Webhook trigger registration
├── data-trigger.ts               ← DocType field change detection
├── steps/
│   ├── query-step.ts             ← Read from DocType tables
│   ├── transform-step.ts         ← Filter, aggregate, calculate
│   ├── generate-step.ts          ← Create PDF, HTML, chart
│   ├── send-step.ts              ← WhatsApp, email, webhook
│   ├── integration-step.ts       ← Call external API
│   ├── approval-step.ts          ← Human-in-the-loop
│   ├── condition-step.ts         ← If/else branching
│   └── ai-step.ts                ← Spawn AI worker for analysis
├── types.ts                      ← Workflow, Trigger, Step interfaces
└── index.ts                      ← Exports
```

### Workflow Schema (SQLite)

```sql
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  trigger_type TEXT NOT NULL,        -- 'schedule', 'webhook', 'data', 'message', 'integration'
  trigger_config TEXT NOT NULL,      -- JSON
  steps TEXT NOT NULL,               -- JSON array of steps
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_run TEXT,
  run_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0
);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,              -- 'running', 'completed', 'failed', 'waiting_approval'
  trigger_data TEXT,                 -- JSON: what triggered this run
  step_results TEXT,                 -- JSON: result of each step
  error TEXT,
  duration_ms INTEGER
);

-- Pending approvals (for approval steps)
CREATE TABLE workflow_approvals (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
  step_index INTEGER NOT NULL,
  message TEXT NOT NULL,             -- "Approve PO for TND 2,500?"
  options TEXT NOT NULL,             -- JSON: ["Approve", "Reject", "Modify"]
  sent_to TEXT NOT NULL,             -- Phone number or email
  sent_at TEXT NOT NULL,
  responded_at TEXT,
  response TEXT,                     -- "Approve" or "Reject"
  timeout_at TEXT NOT NULL           -- Auto-reject after this time
);
```

### Trigger Types

```
SCHEDULE TRIGGER (node-cron)
  Config: { "cron": "0 9 * * *", "timezone": "Africa/Tunis" }
  Engine: cron.schedule(config.cron, () => executeWorkflow(id))
  Example: "Every day at 9am → send overdue invoice report"

WEBHOOK TRIGGER (n8n-inspired registration)
  Config: { "integration": "stripe", "event": "payment_intent.succeeded" }
  Engine: Register endpoint POST /webhook/stripe/wf_{id}
          On receive: validate signature → parse event → executeWorkflow(id, eventData)
  Example: "When Stripe payment received → update invoice status"

DATA TRIGGER (Odoo base.automation-inspired)
  Config: { "doctype": "Invoice", "field": "status", "condition": "changed_to:overdue" }
  Engine: After any UPDATE on dt_invoice, check:
          old.status != 'overdue' AND new.status == 'overdue' → fire
  Example: "When invoice becomes overdue → send reminder to client"

MESSAGE TRIGGER
  Config: { "command": "/report", "channel": "any" }
  Engine: Router detects /report command → executeWorkflow(id, messageData)
  Example: "When user says /report → generate weekly summary"

INTEGRATION TRIGGER
  Config: { "integration": "google-drive", "event": "file.created", "folder": "/Invoices" }
  Engine: Google Drive watch webhook → parse change → executeWorkflow(id, fileData)
  Example: "When new file uploaded to Drive/Invoices → process and extract data"
```

### Step Execution (n8n Data Flow Pattern)

```
Each step receives data from previous step:
  { json: Record<string, unknown>, files?: string[] }

Each step returns data for next step:
  { json: Record<string, unknown>, files?: string[] }

Example workflow: "Daily overdue invoice report"

  Step 1: QUERY
    Config: { doctype: "Invoice", filters: { status: "overdue" } }
    Output: { json: { invoices: [{ id: "042", client: "Mohamed", total: 2380, due_date: "2026-03-05" }, ...] } }

  Step 2: TRANSFORM
    Config: { aggregate: { count: "invoices.length", total: "SUM(invoices.total)" } }
    Output: { json: { count: 3, total: 6200, invoices: [...] } }

  Step 3: CONDITION
    Config: { if: "count > 0", then: "next", else: "skip_to_end" }

  Step 4: GENERATE (spawn AI worker)
    Config: { type: "html", skill_pack: "report-generator",
              prompt: "Generate overdue invoice report with {{count}} invoices totaling TND {{total}}" }
    Output: { json: { ... }, files: [".openbridge/generated/overdue-report-2026-03-12.html"] }

  Step 5: SEND
    Config: { channel: "whatsapp", to: "{{owner.phone}}",
              message: "⚠️ {{count}} overdue invoices (TND {{total}}).\nReport: {{file_url}}" }
```

---

## Part 8: Document Generation Pipeline

### PDF Generation (pdfmake — Primary)

```
Why pdfmake over Puppeteer:
  ✓ Declarative JSON input — perfect for AI agents
  ✓ No Chromium dependency — lightweight, fast
  ✓ Runs in pure Node.js — no external process
  ✓ Tables, images, headers/footers built-in
  ✗ Cannot render complex CSS — use Puppeteer for that

Pipeline:
  DocType record → Template selection → Variable substitution
    → pdfmake document definition → PdfPrinter → Write to file
    → Store in .openbridge/generated/ → Serve via file-server

Invoice PDF example (pdfmake document definition):
  {
    content: [
      { image: 'logo.png', width: 150 },
      { text: 'INVOICE #INV-2026-042', style: 'header' },
      { text: 'Date: March 10, 2026' },
      { text: 'Due: March 31, 2026' },
      '\n',
      { text: 'Bill To:', style: 'subheader' },
      { text: 'Mohamed Ben Ali\nmohamad@example.com\n+216 XX XXX XXX' },
      '\n',
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto'],
          body: [
            ['Description', 'Qty', 'Unit Price', 'Amount'],
            ['Web Design Service', '3 hrs', 'TND 200', 'TND 600'],
          ]
        }
      },
      '\n',
      { text: 'Subtotal: TND 600', alignment: 'right' },
      { text: 'Tax (19%): TND 114', alignment: 'right' },
      { text: 'Total: TND 714', style: 'total', alignment: 'right' },
      '\n',
      { qr: 'https://buy.stripe.com/xxxxx', fit: 100 },
      { text: 'Scan to pay', alignment: 'center' }
    ]
  }
```

### HTML Page Generation (Interactive Documents)

```
Pipeline:
  DocType record → Worker with web-designer skill pack
    → AI generates HTML with:
       - Business branding (logo, colors from .openbridge/context/)
       - Document data (invoice details, client info)
       - Interactive elements (Pay Now button → Stripe)
       - Responsive CSS (mobile-friendly)
    → Save to .openbridge/generated/
    → File-server hosts with shareable UUID link
    → Tunnel provides public URL

Existing infrastructure used:
  - file-server.ts: HTTP hosting with UUID links + 24h expiry
  - app-server.ts: Full app hosting for dashboards (ports 3100-3199)
  - interaction-relay.ts: WebSocket for live-updating pages
  - html-renderer.ts: Puppeteer for screenshots/thumbnails
  - output-marker-processor.ts: [SHARE:FILE] routes output to user
```

---

## Part 9: Web Page & App Generation

### What the AI Can Build

| Type                     | How                                        | Hosting                     | Use Case                                      |
| ------------------------ | ------------------------------------------ | --------------------------- | --------------------------------------------- |
| **Invoice payment page** | Worker generates HTML + Stripe button      | file-server (UUID link)     | Send to client to collect payment             |
| **Sales dashboard**      | Worker generates Chart.js HTML             | app-server (port 3100+)     | Owner's business analytics                    |
| **Client portal**        | Worker generates multi-page HTML app       | app-server (port 3100+)     | Clients view their invoices/orders            |
| **Data entry form**      | Auto-generated from DocType schema         | file-server (form endpoint) | Staff enters data via web instead of WhatsApp |
| **Report**               | Worker generates HTML with charts + tables | file-server (UUID link)     | Share weekly/monthly summaries                |
| **Product catalog**      | Worker generates gallery HTML from DocType | file-server or app-server   | Public product listing for sharing            |

### The Existing App Infrastructure (Already Built)

```
app-server.ts:
  - Manages concurrent apps on ports 3100–3199
  - App scaffolding (npm, static, node)
  - Port allocation + health checks
  - Idle timeout + process cleanup
  - Tunnel support for public URLs
  - Per-app authentication tokens

interaction-relay.ts:
  - WebSocket server on port 3099
  - Real-time data push from Master to running apps
  - Token-based auth per app
  - Enables live-updating dashboards

Output markers (already implemented):
  [APP:start]path/to/app[/APP]     → Start app, return URL
  [APP:stop]appId[/APP]            → Stop app
  [APP:update:appId]jsonData[/APP] → Push data to running app
  [SHARE:FILE]path/to/file[/SHARE] → Create shareable link
```

---

## Part 10: Credential Security

### The n8n Pattern (Encrypt-at-Rest, Decrypt-on-Demand)

```
STORING CREDENTIALS:

  User sends Stripe API key via WhatsApp:
    "sk_live_xxxxxxxxxxxxxxxx"

  1. Generate encryption key (one-time, on first integration setup):
     const key = crypto.randomBytes(32);
     // Store in .openbridge/secrets.key (gitignored, chmod 600)

  2. Encrypt the credential:
     const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
     const encrypted = cipher.update(JSON.stringify({ apiKey: "sk_live_xxx" }));
     // Store IV + authTag + encrypted in SQLite

  3. Store in SQLite:
     INSERT INTO integration_credentials (
       integration_name, encrypted_data, iv, auth_tag, created_at
     ) VALUES ('stripe', ?, ?, ?, datetime('now'));

  4. Warn user: "⚠️ Delete the message containing your API key from WhatsApp"


USING CREDENTIALS:

  When a hook or workflow needs Stripe:
    1. Read encrypted blob from SQLite
    2. Decrypt with key from .openbridge/secrets.key
    3. Parse JSON → { apiKey: "sk_live_xxx" }
    4. Create Stripe client: new Stripe(decryptedKey)
    5. Execute operation
    6. Credential exists only in memory during execution
    7. NEVER logged, NEVER passed to AI workers

  AI workers receive RESULTS, not credentials:
    Worker prompt: "Generate invoice PDF for..." (no API keys in prompt)
    Integration calls happen in the OpenBridge process, not in AI workers
```

### SQLite Schema

```sql
CREATE TABLE integration_credentials (
  id TEXT PRIMARY KEY,
  integration_name TEXT NOT NULL UNIQUE,
  encrypted_data BLOB NOT NULL,
  iv BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  auth_type TEXT NOT NULL,             -- 'api_key', 'oauth2', 'basic', 'bearer'
  oauth_refresh_token BLOB,            -- Encrypted, for OAuth2 token refresh
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_used TEXT,
  health_status TEXT DEFAULT 'unknown'  -- 'healthy', 'expired', 'error'
);
```

---

## Part 11: Self-Improvement & Skill Learning

### The Hermes Agent Pattern (Procedural Memory)

```
When OpenBridge successfully completes a complex task:

  Task: "Generate invoice for Mohamed, create payment link, send via email + WhatsApp"

  1. Task completed successfully
  2. Master AI detects: this was a multi-step procedure
  3. Auto-creates a skill:

  {
    "name": "send_invoice_with_payment",
    "description": "Generate PDF invoice, create Stripe payment link, send to client via email and WhatsApp",
    "version": 1,
    "steps": [
      "Look up or create client in Knowledge Graph",
      "Calculate totals with tax using DocType computed fields",
      "Generate PDF via pdfmake (document-writer skill pack)",
      "Create Stripe payment link via integration",
      "Send email with PDF attachment via nodemailer",
      "Send WhatsApp with payment link as interactive button",
      "Update invoice status to 'sent' (triggers after-hooks)",
      "Create overdue reminder workflow if not exists"
    ],
    "requiredIntegrations": ["stripe"],
    "requiredDocTypes": ["Invoice", "Customer"],
    "metrics": {
      "usageCount": 1,
      "successRate": 1.0,
      "avgDurationMs": 12000,
      "lastUsed": "2026-03-12T14:30:00Z"
    }
  }

  Next time user says "Invoice Fatma for TND 300":
    → Master finds "send_invoice_with_payment" skill
    → Executes faster (known procedure)
    → More reliable (tested pattern)
    → Skill version incremented on improvements
```

### Proactive Intelligence (Month 1+)

```
Scheduled workflow: "Business Intelligence Daily" (runs at 9pm)

  Step 1: Query overdue invoices
  Step 2: Query revenue vs last month
  Step 3: Query client activity patterns
  Step 4: AI analysis step:
          "Compare this week's data with last week.
           Identify anomalies, trends, and actionable insights.
           Be specific with numbers."
  Step 5: Send WhatsApp summary to owner

  Example output:
  "📊 Daily Business Update (March 12):

   💰 Revenue today: TND 1,200 (↑15% vs avg)
   📦 Orders: 8 (3 from marketplace, 5 direct)
   ⚠️ 3 overdue invoices (TND 4,200)

   💡 Insight: Client Ahmed hasn't ordered in 28 days
      (his average is 14 days). Consider a follow-up.

   💡 Insight: Flour costs up 12% this month.
      Supplier B offers TND 42/50kg vs your current TND 47.
      Switch to save TND 150/month."
```

---

## Part 12: Marketplace Integration

### Your Marketplace API (460+ Endpoints, 40+ Models)

```
Marketplace adapter maps directly to your NestJS API:

SELLER CAPABILITIES (WhatsApp AI assistant for sellers):
  ┌────────────────────────┬──────────────────────────────────────────┐
  │ Capability             │ API Endpoint                             │
  ├────────────────────────┼──────────────────────────────────────────┤
  │ list_my_products       │ GET /supplier/catalog/products           │
  │ create_product         │ POST /supplier/catalog/products          │
  │ update_product         │ PUT /supplier/catalog/products/:id       │
  │ manage_variants        │ POST /supplier/catalog/products/:id/variants │
  │ set_price              │ POST /supplier/catalog/price-rules       │
  │ check_stock            │ GET /supplier/inventory/stock            │
  │ update_stock           │ PUT /supplier/inventory/stock/:id        │
  │ view_orders            │ GET /company/orders                      │
  │ accept_order           │ POST /company/orders/:id/accept          │
  │ reject_order           │ POST /company/orders/:id/reject          │
  │ update_prep_status     │ POST /company/orders/:id/preparationAction │
  │ check_wallet           │ GET /supplier/wallet                     │
  │ view_settlements       │ GET /supplier/wallet/transactions        │
  │ view_campaigns         │ GET /supplier/campaigns                  │
  │ join_campaign          │ POST /supplier/campaigns/:id/participate │
  │ get_analytics          │ GET /supplier/analytics/sales            │
  └────────────────────────┴──────────────────────────────────────────┘

DELIVERY CAPABILITIES (WhatsApp AI assistant for drivers):
  ┌────────────────────────┬──────────────────────────────────────────┐
  │ available_deliveries   │ GET /delivery/available                  │
  │ claim_delivery         │ POST /delivery/:id/claim                 │
  │ start_pickup           │ POST /delivery/:id/pickup                │
  │ update_location        │ POST /delivery/:id/location              │
  │ complete_delivery      │ POST /delivery/:id/complete              │
  │ submit_proof           │ POST /delivery/:id/proof                 │
  │ check_wallet           │ GET /delivery/wallet                     │
  │ request_settlement     │ POST /delivery/settlement/request        │
  │ view_route             │ GET /delivery/:id/route                  │
  └────────────────────────┴──────────────────────────────────────────┘

ADMIN CAPABILITIES (Telegram AI assistant for admins):
  ┌────────────────────────┬──────────────────────────────────────────┐
  │ validate_order         │ POST /admin/orders/:id/validate          │
  │ manage_companies       │ GET/POST /admin/companies                │
  │ manage_campaigns       │ CRUD /admin/campaigns                    │
  │ delivery_settlement    │ POST /admin/delivery/settlement/:id      │
  │ view_analytics         │ GET /admin/analytics                     │
  │ manage_users           │ GET/POST /admin/users                    │
  │ manage_inventory       │ GET/PUT /admin/inventory                 │
  └────────────────────────┴──────────────────────────────────────────┘

REAL-TIME EVENTS (NATS JetStream → WhatsApp push):
  ┌────────────────────────┬──────────────────────────────────────────┐
  │ order.created          │ → Notify seller: "New order from X"      │
  │ order.status_changed   │ → Notify customer: "Order shipped"       │
  │ inventory.low_stock    │ → Alert seller: "USB cables: 2 left"     │
  │ delivery.assigned      │ → Notify driver: "Delivery available"    │
  │ payment.received       │ → Notify seller: "Payment confirmed"     │
  │ campaign.started       │ → Notify participants: "Sale is live!"   │
  └────────────────────────┴──────────────────────────────────────────┘
```

---

## Part 13: Industry Templates

### Template Structure

```
.openbridge/industry-templates/
├── restaurant/
│   ├── manifest.json              ← Template metadata
│   ├── doctypes/                  ← Pre-built DocType definitions
│   │   ├── menu-item.json
│   │   ├── supplier.json
│   │   ├── inventory-item.json
│   │   ├── daily-sales.json
│   │   └── expense.json
│   ├── workflows/                 ← Pre-built workflows
│   │   ├── low-stock-alert.json
│   │   ├── daily-prep-list.json
│   │   └── weekly-food-cost.json
│   ├── skill-pack.md              ← AI instructions for restaurant operations
│   └── sample-queries.json        ← "What should I prep?" "Food cost analysis"
│
├── car-rental/
│   ├── manifest.json
│   ├── doctypes/
│   │   ├── vehicle.json
│   │   ├── booking.json
│   │   ├── maintenance-log.json
│   │   └── rental-contract.json
│   ├── workflows/
│   │   ├── maintenance-due-alert.json
│   │   ├── booking-confirmation.json
│   │   └── insurance-expiry.json
│   └── skill-pack.md
│
├── marketplace-seller/
│   ├── manifest.json
│   ├── doctypes/
│   │   ├── product-listing.json
│   │   └── supplier-order.json
│   ├── workflows/
│   │   ├── low-stock-reorder.json
│   │   ├── new-order-notification.json
│   │   └── weekly-sales-report.json
│   ├── integrations.json          ← { "required": ["marketplace"] }
│   └── skill-pack.md
│
├── retail/
├── services/
├── construction/
├── logistics/
└── professional/                  ← Law, consulting, accounting
```

### Industry Detection Flow

```
User drops files → Document Intelligence extracts entities →
Master AI analyzes entity types and patterns →

  "I see menu items, food suppliers, and ingredient costs.
   This looks like a restaurant/cafe business."

  → Load restaurant template
  → Create DocTypes: MenuItem, Supplier, InventoryItem, DailySales, Expense
  → Create workflows: low-stock-alert, daily-prep-list, weekly-food-cost
  → Inject restaurant skill pack into Master prompt
  → Ask user: "I've set up restaurant tracking. Want me to import your menu?"
```

---

## Part 14: Implementation Phases & Task Breakdown

### Phase A: Document Intelligence (v0.1.0)

**Goal**: OpenBridge reads any business file.
**Duration estimate**: ~35 tasks

| #   | Task                                           | New File                                          | npm Package           | Priority |
| --- | ---------------------------------------------- | ------------------------------------------------- | --------------------- | -------- |
| A01 | Create `src/intelligence/` directory structure | `intelligence/index.ts`                           | —                     | P0       |
| A02 | MIME type detection router                     | `intelligence/document-processor.ts`              | `file-type`           | P0       |
| A03 | PDF text extraction processor                  | `intelligence/processors/pdf-processor.ts`        | `pdf-parse`           | P0       |
| A04 | PDF OCR fallback (scanned documents)           | Update pdf-processor.ts                           | `tesseract.js`        | P1       |
| A05 | Excel/XLSX processor                           | `intelligence/processors/excel-processor.ts`      | `xlsx` (SheetJS)      | P0       |
| A06 | CSV processor                                  | `intelligence/processors/csv-processor.ts`        | `xlsx` or `csv-parse` | P0       |
| A07 | Word (.docx) processor                         | `intelligence/processors/word-processor.ts`       | `mammoth`             | P1       |
| A08 | Image processor (AI vision)                    | `intelligence/processors/image-processor.ts`      | AI multimodal         | P0       |
| A09 | Image OCR fallback                             | Update image-processor.ts                         | `tesseract.js`        | P1       |
| A10 | Email (.eml) processor                         | `intelligence/processors/email-processor.ts`      | `mailparser`          | P2       |
| A11 | JSON/XML schema detector                       | `intelligence/processors/structured-processor.ts` | native                | P2       |
| A12 | Entity extraction (AI worker)                  | `intelligence/entity-extractor.ts`                | — (uses AgentRunner)  | P0       |
| A13 | ProcessedDocument type definitions             | `types/intelligence.ts`                           | `zod`                 | P0       |
| A14 | WhatsApp file reception handler                | Update whatsapp connector                         | —                     | P0       |
| A15 | Telegram file reception handler                | Update telegram connector                         | —                     | P1       |
| A16 | File processing command handler                | Update command-handlers.ts                        | —                     | P0       |
| A17 | Processed document storage                     | `intelligence/document-store.ts`                  | — (SQLite)            | P0       |
| A18 | Unit tests: PDF processor                      | `tests/intelligence/pdf-processor.test.ts`        | —                     | P0       |
| A19 | Unit tests: Excel processor                    | `tests/intelligence/excel-processor.test.ts`      | —                     | P0       |
| A20 | Unit tests: Image processor                    | `tests/intelligence/image-processor.test.ts`      | —                     | P1       |
| A21 | Integration test: file → extraction → storage  | `tests/intelligence/pipeline.test.ts`             | —                     | P0       |

### Phase B: DocType Engine (v0.1.1)

**Goal**: AI creates structured business data from conversation.
**Duration estimate**: ~40 tasks

| #   | Task                                                 | New File                                   | Priority |
| --- | ---------------------------------------------------- | ------------------------------------------ | -------- |
| B01 | DocType metadata schema (Zod)                        | `types/doctype.ts`                         | P0       |
| B02 | DocType metadata storage (SQLite tables)             | `intelligence/doctype-store.ts`            | P0       |
| B03 | Dynamic table creation from DocType definition       | `intelligence/table-builder.ts`            | P0       |
| B04 | Auto-numbering (naming_series) implementation        | `intelligence/naming-series.ts`            | P0       |
| B05 | Child table support (Frappe parent/parentfield)      | Update table-builder.ts                    | P0       |
| B06 | GENERATED columns for computed fields                | Update table-builder.ts                    | P0       |
| B07 | Cross-table recomputation triggers                   | Update table-builder.ts                    | P1       |
| B08 | State machine engine                                 | `intelligence/state-machine.ts`            | P0       |
| B09 | State transition validation (role + condition)       | Update state-machine.ts                    | P0       |
| B10 | Lifecycle hook executor                              | `intelligence/hook-executor.ts`            | P0       |
| B11 | Hook type: generate_number                           | Update hook-executor.ts                    | P0       |
| B12 | Hook type: update_field                              | Update hook-executor.ts                    | P0       |
| B13 | Hook type: send_notification                         | Update hook-executor.ts                    | P1       |
| B14 | Hook type: generate_pdf                              | Update hook-executor.ts                    | P1       |
| B15 | Hook type: create_payment_link                       | Update hook-executor.ts                    | P2       |
| B16 | Hook type: spawn_worker                              | Update hook-executor.ts                    | P1       |
| B17 | FTS5 index auto-creation for searchable fields       | Update table-builder.ts                    | P0       |
| B18 | REST API auto-generation (CRUD endpoints)            | `intelligence/doctype-api.ts`              | P0       |
| B19 | Web form auto-generation (HTML from fields)          | `intelligence/form-generator.ts`           | P1       |
| B20 | List view auto-generation (HTML table)               | `intelligence/list-generator.ts`           | P1       |
| B21 | DocType relation management                          | `intelligence/relation-manager.ts`         | P1       |
| B22 | Master AI: detect "need to track X" intent           | Update classification-engine.ts            | P0       |
| B23 | Master AI: generate DocType from conversation        | Update worker-orchestrator.ts              | P0       |
| B24 | Master AI: inject DocType capabilities into prompt   | Update prompt-context-builder.ts           | P0       |
| B25 | WhatsApp commands: "list invoices", "create X"       | Update command-handlers.ts                 | P0       |
| B26 | DocType import from file (Excel → DocType)           | `intelligence/doctype-importer.ts`         | P1       |
| B27 | DocType export (records → Excel/CSV)                 | `intelligence/doctype-exporter.ts`         | P2       |
| B28 | Unit tests: table builder                            | `tests/intelligence/table-builder.test.ts` | P0       |
| B29 | Unit tests: state machine                            | `tests/intelligence/state-machine.test.ts` | P0       |
| B30 | Unit tests: hook executor                            | `tests/intelligence/hook-executor.test.ts` | P0       |
| B31 | Unit tests: auto-numbering                           | `tests/intelligence/naming-series.test.ts` | P0       |
| B32 | Integration test: create DocType → CRUD → transition | `tests/intelligence/doctype-e2e.test.ts`   | P0       |

### Phase C: Integration Hub (v0.1.2)

**Goal**: Connect to external systems (Stripe, Drive, Database, any API).
**Duration estimate**: ~35 tasks

| #   | Task                                           | New File                                         | npm Package            | Priority |
| --- | ---------------------------------------------- | ------------------------------------------------ | ---------------------- | -------- |
| C01 | Integration interface + types                  | `types/integration.ts`                           | `zod`                  | P0       |
| C02 | IntegrationHub registry + lifecycle            | `integrations/hub.ts`                            | —                      | P0       |
| C03 | Credential encryption/decryption (n8n pattern) | `integrations/credential-store.ts`               | native `crypto`        | P0       |
| C04 | Webhook router on file-server                  | `integrations/webhook-router.ts`                 | —                      | P0       |
| C05 | Stripe adapter: payment links                  | `integrations/adapters/stripe-adapter.ts`        | `stripe`               | P0       |
| C06 | Stripe adapter: invoices                       | Update stripe-adapter.ts                         | —                      | P1       |
| C07 | Stripe adapter: webhook handler                | Update stripe-adapter.ts                         | —                      | P0       |
| C08 | Google Drive adapter: OAuth + file ops         | `integrations/adapters/google-drive-adapter.ts`  | `googleapis`           | P1       |
| C09 | Google Drive adapter: watch for changes        | Update google-drive-adapter.ts                   | —                      | P2       |
| C10 | Google Sheets adapter: read/write              | `integrations/adapters/google-sheets-adapter.ts` | `google-spreadsheet`   | P1       |
| C11 | Dropbox adapter: OAuth + file ops              | `integrations/adapters/dropbox-adapter.ts`       | `dropbox`              | P2       |
| C12 | Email adapter: send (enhanced)                 | Update email-sender.ts                           | `nodemailer` (exists)  | P0       |
| C13 | Email adapter: read (Gmail/IMAP)               | `integrations/adapters/email-adapter.ts`         | `googleapis` or `imap` | P2       |
| C14 | Database adapter: PostgreSQL                   | `integrations/adapters/database-adapter.ts`      | `pg`                   | P1       |
| C15 | Database adapter: MySQL                        | Update database-adapter.ts                       | `mysql2`               | P2       |
| C16 | OpenAPI auto-adapter                           | `integrations/adapters/openapi-adapter.ts`       | `swagger-parser`       | P0       |
| C17 | Master AI: integration capability injection    | Update master-system-prompt.ts                   | —                      | P0       |
| C18 | Master AI: "connect to X" intent handling      | Update classification-engine.ts                  | —                      | P0       |
| C19 | /connect command handler                       | Update command-handlers.ts                       | —                      | P1       |
| C20 | /integrations command (list status)            | Update command-handlers.ts                       | —                      | P1       |
| C21 | Unit tests: credential store                   | `tests/integrations/credential-store.test.ts`    | —                      | P0       |
| C22 | Unit tests: stripe adapter                     | `tests/integrations/stripe-adapter.test.ts`      | —                      | P0       |
| C23 | Unit tests: openapi adapter                    | `tests/integrations/openapi-adapter.test.ts`     | —                      | P0       |
| C24 | Integration test: Stripe payment flow          | `tests/integrations/stripe-flow.test.ts`         | —                      | P1       |

### Phase D: Workflow Engine (v0.1.3)

**Goal**: Automated triggers, schedules, and pipelines.
**Duration estimate**: ~30 tasks

| #   | Task                                      | New File                                 | npm Package | Priority |
| --- | ----------------------------------------- | ---------------------------------------- | ----------- | -------- |
| D01 | Workflow types + Zod schemas              | `types/workflow.ts`                      | `zod`       | P0       |
| D02 | Workflow storage (SQLite tables)          | `workflows/workflow-store.ts`            | —           | P0       |
| D03 | WorkflowEngine: load + execute            | `workflows/engine.ts`                    | —           | P0       |
| D04 | Schedule trigger (cron)                   | `workflows/triggers/schedule-trigger.ts` | `node-cron` | P0       |
| D05 | Webhook trigger                           | `workflows/triggers/webhook-trigger.ts`  | —           | P0       |
| D06 | Data trigger (DocType field change)       | `workflows/triggers/data-trigger.ts`     | —           | P1       |
| D07 | Message trigger (/command)                | `workflows/triggers/message-trigger.ts`  | —           | P1       |
| D08 | Query step executor                       | `workflows/steps/query-step.ts`          | —           | P0       |
| D09 | Transform step executor                   | `workflows/steps/transform-step.ts`      | —           | P0       |
| D10 | Condition step (if/else)                  | `workflows/steps/condition-step.ts`      | —           | P0       |
| D11 | Send step (WhatsApp/email/webhook)        | `workflows/steps/send-step.ts`           | —           | P0       |
| D12 | Integration step (call external API)      | `workflows/steps/integration-step.ts`    | —           | P1       |
| D13 | Approval step (human-in-the-loop)         | `workflows/steps/approval-step.ts`       | —           | P1       |
| D14 | AI step (spawn worker for analysis)       | `workflows/steps/ai-step.ts`             | —           | P1       |
| D15 | Generate step (PDF/HTML/chart)            | `workflows/steps/generate-step.ts`       | —           | P1       |
| D16 | Natural language → workflow creation      | Update master AI prompts                 | —           | P0       |
| D17 | /workflows command (list/enable/disable)  | Update command-handlers.ts               | —           | P1       |
| D18 | Workflow run history + logging            | Update workflow-store.ts                 | —           | P1       |
| D19 | Unit tests: workflow engine               | `tests/workflows/engine.test.ts`         | —           | P0       |
| D20 | Unit tests: each trigger type             | `tests/workflows/triggers.test.ts`       | —           | P0       |
| D21 | Unit tests: each step type                | `tests/workflows/steps.test.ts`          | —           | P0       |
| D22 | Integration test: schedule → query → send | `tests/workflows/schedule-flow.test.ts`  | —           | P1       |

### Phase E: Document Generation (v0.1.4)

**Goal**: Professional PDFs, invoices, quotes, reports.
**Duration estimate**: ~15 tasks

| #   | Task                                       | New File                                     | npm Package | Priority |
| --- | ------------------------------------------ | -------------------------------------------- | ----------- | -------- |
| E01 | pdfmake integration                        | `intelligence/pdf-generator.ts`              | `pdfmake`   | P0       |
| E02 | Invoice PDF template                       | `intelligence/templates/invoice-template.ts` | —           | P0       |
| E03 | Quote PDF template                         | `intelligence/templates/quote-template.ts`   | —           | P1       |
| E04 | Receipt PDF template                       | `intelligence/templates/receipt-template.ts` | —           | P2       |
| E05 | Report PDF template (charts + tables)      | `intelligence/templates/report-template.ts`  | —           | P1       |
| E06 | Invoice HTML payment page (with Stripe)    | Worker + web-designer skill pack             | —           | P0       |
| E07 | QR code generation for payment links       | Update pdf-generator.ts                      | `qrcode`    | P1       |
| E08 | Business branding injection (logo, colors) | `intelligence/branding.ts`                   | —           | P1       |
| E09 | Email HTML templates for delivery          | `intelligence/templates/email-templates.ts`  | —           | P1       |
| E10 | Unit tests: PDF generation                 | `tests/intelligence/pdf-generator.test.ts`   | —           | P0       |

### Phase F: Marketplace Adapter (v0.1.5)

**Goal**: Sellers and delivery partners use OpenBridge via WhatsApp.
**Duration estimate**: ~25 tasks

| #   | Task                                        | New File                                          | Priority |
| --- | ------------------------------------------- | ------------------------------------------------- | -------- |
| F01 | Marketplace adapter (OpenAPI-based)         | `integrations/adapters/marketplace-adapter.ts`    | P0       |
| F02 | Seller capability mapping (20+ endpoints)   | Update marketplace-adapter.ts                     | P0       |
| F03 | Delivery capability mapping (10+ endpoints) | Update marketplace-adapter.ts                     | P0       |
| F04 | Admin capability mapping (15+ endpoints)    | Update marketplace-adapter.ts                     | P1       |
| F05 | NATS JetStream event bridge                 | `integrations/adapters/marketplace-events.ts`     | P0       |
| F06 | Seller skill pack                           | `.openbridge/skill-packs/marketplace-seller.md`   | P0       |
| F07 | Delivery skill pack                         | `.openbridge/skill-packs/marketplace-delivery.md` | P0       |
| F08 | Role-based capability filtering             | Update marketplace-adapter.ts                     | P0       |
| F09 | Seller onboarding flow (WhatsApp)           | Update master prompts                             | P1       |
| F10 | Order notification workflow (real-time)     | Pre-built workflow template                       | P0       |
| F11 | Low-stock alert workflow                    | Pre-built workflow template                       | P1       |
| F12 | Weekly sales report workflow                | Pre-built workflow template                       | P1       |
| F13 | Integration test: seller flow               | `tests/integrations/marketplace-seller.test.ts`   | P0       |
| F14 | Integration test: delivery flow             | `tests/integrations/marketplace-delivery.test.ts` | P1       |

### Phase G: Industry Templates (v0.1.6)

**Goal**: Instant onboarding for common business types.
**Duration estimate**: ~20 tasks

| #   | Task                                               | Priority |
| --- | -------------------------------------------------- | -------- |
| G01 | Template manifest format (JSON schema)             | P0       |
| G02 | Template loader + applier                          | P0       |
| G03 | Industry detector (AI-based)                       | P0       |
| G04 | Restaurant template (5 DocTypes + 3 workflows)     | P0       |
| G05 | Car rental template (4 DocTypes + 3 workflows)     | P1       |
| G06 | Retail template (4 DocTypes + 3 workflows)         | P1       |
| G07 | Services template (4 DocTypes + 3 workflows)       | P1       |
| G08 | Construction template (4 DocTypes + 3 workflows)   | P2       |
| G09 | Marketplace seller template (uses Phase F adapter) | P0       |
| G10 | Template selection UX (WhatsApp interactive)       | P1       |

### Phase H: Self-Improvement (v0.1.7)

**Goal**: Gets smarter with every interaction.
**Duration estimate**: ~15 tasks

| #   | Task                                         | Priority |
| --- | -------------------------------------------- | -------- |
| H01 | Skill auto-creation from successful tasks    | P0       |
| H02 | Skill versioning + effectiveness tracking    | P0       |
| H03 | Skill storage (SQLite)                       | P0       |
| H04 | Skill discovery by Master AI                 | P0       |
| H05 | Proactive insights (daily analysis workflow) | P1       |
| H06 | Query caching for common questions           | P1       |
| H07 | User preference modeling per sender          | P2       |
| H08 | Client activity pattern detection            | P2       |

---

## Part 15: Tech Stack Additions

### New npm Packages (by phase)

| Phase | Package              | Purpose                            | Size                        |
| ----- | -------------------- | ---------------------------------- | --------------------------- |
| A     | `file-type`          | MIME detection from buffer         | ~50KB                       |
| A     | `pdf-parse`          | PDF text extraction                | ~200KB                      |
| A     | `tesseract.js`       | Local OCR (WASM)                   | ~15MB (WASM + trained data) |
| A     | `xlsx` (SheetJS)     | Excel/CSV parser                   | ~1MB                        |
| A     | `mammoth`            | Word (.docx) → text/HTML           | ~300KB                      |
| A     | `mailparser`         | Email MIME parser                  | ~200KB                      |
| C     | `stripe`             | Stripe API SDK                     | ~500KB                      |
| C     | `googleapis`         | Google Drive/Sheets/Calendar/Gmail | ~2MB                        |
| C     | `google-spreadsheet` | Google Sheets helper               | ~100KB                      |
| C     | `dropbox`            | Dropbox API SDK                    | ~300KB                      |
| C     | `swagger-parser`     | OpenAPI spec parser                | ~200KB                      |
| C     | `pg`                 | PostgreSQL client                  | ~200KB                      |
| D     | `node-cron`          | Cron scheduler                     | ~20KB                       |
| E     | `pdfmake`            | Declarative PDF generation         | ~1MB                        |
| E     | `qrcode`             | QR code generation                 | ~100KB                      |

### Existing Packages Already Used

| Package          | Already In            | Purpose           |
| ---------------- | --------------------- | ----------------- |
| `nodemailer`     | email-sender.ts       | SMTP email        |
| `better-sqlite3` | memory/database.ts    | SQLite            |
| `zod`            | types/\*.ts           | Schema validation |
| `pino`           | core/logger.ts        | Logging           |
| `puppeteer`      | core/html-renderer.ts | HTML → image/PDF  |

### Directory Structure (New Additions)

```
src/
├── intelligence/                    ← NEW: Document Intelligence + DocType Engine
│   ├── index.ts
│   ├── document-processor.ts        ← MIME routing → processor
│   ├── processors/
│   │   ├── pdf-processor.ts
│   │   ├── excel-processor.ts
│   │   ├── csv-processor.ts
│   │   ├── word-processor.ts
│   │   ├── image-processor.ts
│   │   ├── email-processor.ts
│   │   └── structured-processor.ts
│   ├── entity-extractor.ts          ← AI-powered extraction
│   ├── document-store.ts            ← Processed document storage
│   ├── doctype-store.ts             ← DocType metadata CRUD
│   ├── table-builder.ts             ← Dynamic CREATE TABLE
│   ├── naming-series.ts             ← Auto-numbering (Frappe pattern)
│   ├── state-machine.ts             ← Lifecycle transitions
│   ├── hook-executor.ts             ← Before/after hook execution
│   ├── doctype-api.ts               ← Auto-generated REST endpoints
│   ├── form-generator.ts            ← Auto-generated HTML forms
│   ├── list-generator.ts            ← Auto-generated list views
│   ├── relation-manager.ts          ← Inter-DocType relations
│   ├── doctype-importer.ts          ← File → DocType import
│   ├── doctype-exporter.ts          ← DocType → File export
│   ├── knowledge-graph.ts           ← Entity/relation query layer
│   ├── pdf-generator.ts             ← pdfmake integration
│   ├── branding.ts                  ← Logo, colors, business info
│   └── templates/
│       ├── invoice-template.ts
│       ├── quote-template.ts
│       ├── receipt-template.ts
│       ├── report-template.ts
│       └── email-templates.ts
├── integrations/                    ← NEW: External system connections
│   ├── index.ts
│   ├── hub.ts                       ← IntegrationHub registry
│   ├── integration.ts               ← BusinessIntegration interface
│   ├── credential-store.ts          ← Encrypted credential management
│   ├── webhook-router.ts            ← Incoming webhook dispatcher
│   └── adapters/
│       ├── stripe-adapter.ts
│       ├── google-drive-adapter.ts
│       ├── google-sheets-adapter.ts
│       ├── google-calendar-adapter.ts
│       ├── dropbox-adapter.ts
│       ├── email-adapter.ts
│       ├── database-adapter.ts
│       ├── openapi-adapter.ts
│       └── marketplace-adapter.ts
├── workflows/                       ← NEW: Automation engine
│   ├── index.ts
│   ├── engine.ts                    ← WorkflowEngine
│   ├── workflow-store.ts            ← SQLite storage
│   ├── scheduler.ts                 ← Cron scheduler
│   ├── types.ts                     ← Workflow/Trigger/Step types
│   ├── triggers/
│   │   ├── schedule-trigger.ts
│   │   ├── webhook-trigger.ts
│   │   ├── data-trigger.ts
│   │   └── message-trigger.ts
│   └── steps/
│       ├── query-step.ts
│       ├── transform-step.ts
│       ├── condition-step.ts
│       ├── send-step.ts
│       ├── integration-step.ts
│       ├── approval-step.ts
│       ├── ai-step.ts
│       └── generate-step.ts
└── (existing directories unchanged)
```

---

## Quick Reference: Phase Summary

| Phase | Version | What Ships                                            | Task Count | Dependencies |
| ----- | ------- | ----------------------------------------------------- | ---------- | ------------ |
| **A** | v0.1.0  | Read any file (PDF, Excel, Image, Email)              | ~21        | None         |
| **B** | v0.1.1  | DocType engine (AI-created business data)             | ~35        | Phase A      |
| **C** | v0.1.2  | Integrations (Stripe, Drive, any API)                 | ~24        | Phase B      |
| **D** | v0.1.3  | Workflow engine (triggers, schedules, pipelines)      | ~22        | Phase B, C   |
| **E** | v0.1.4  | Document generation (PDF invoices, HTML pages)        | ~10        | Phase B, C   |
| **F** | v0.1.5  | Marketplace adapter (sellers + drivers via WhatsApp)  | ~14        | Phase C      |
| **G** | v0.1.6  | Industry templates (restaurant, rental, retail...)    | ~10        | Phase B, D   |
| **H** | v0.1.7  | Self-improvement (skill learning, proactive insights) | ~8         | Phase D      |
|       |         | **Total**                                             | **~144**   |              |

---

_This document is the implementation blueprint. Each phase builds on the previous. Start with Phase A (read any file) — everything else depends on being able to understand business data._
