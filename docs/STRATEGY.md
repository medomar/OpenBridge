# OpenBridge Business Strategy

> **Vision**: OpenBridge becomes the universal AI bridge between any business and the AI world.
> Drop your files, connect your tools, talk to your business via WhatsApp.

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [The Solution](#2-the-solution)
3. [Real-World Business Cases](#3-real-world-business-cases)
4. [Architecture: From Code Tool to Business Platform](#4-architecture-from-code-tool-to-business-platform)
5. [Document Intelligence Layer](#5-document-intelligence-layer)
6. [Business Knowledge Graph](#6-business-knowledge-graph)
7. [Integration Framework (ERP/CRM/Custom)](#7-integration-framework-erpcrmcustom)
8. [Marketplace Integration (Your API Project)](#8-marketplace-integration-your-api-project)
9. [Inspired by the Best](#9-inspired-by-the-best)
10. [Industry Templates](#10-industry-templates)
11. [The Onboarding Flow](#11-the-onboarding-flow)
12. [Implementation Roadmap](#12-implementation-roadmap)
13. [Competitive Moat](#13-competitive-moat)

---

## 1. The Problem

Every business has data scattered everywhere:

- **Spreadsheets** nobody maintains (inventory, pricing, contacts)
- **PDFs** sitting in folders (invoices, contracts, permits)
- **Images** on phones (product photos, receipts, site photos)
- **Emails** with important info buried in threads
- **ERPs/CRMs** that employees hate using
- **WhatsApp groups** where real decisions happen

The gap: **AI exists, but no business knows how to plug it into their actual workflow.**

Big companies hire consultants. Small businesses get nothing.

OpenBridge closes this gap. **Zero technical knowledge required. Talk to your business via WhatsApp.**

---

## 2. The Solution

### What OpenBridge Does (The Business Pitch)

```
Business Owner                    OpenBridge                         AI World
┌──────────────┐            ┌───────────────────┐            ┌──────────────────┐
│              │            │                   │            │                  │
│ "How much    │  WhatsApp  │  Understands your  │  Workers   │ Claude, Codex,   │
│  chicken do  │ ────────►  │  business from     │ ────────►  │ Gemini, Ollama   │
│  we need     │            │  YOUR files        │            │                  │
│  for Friday?"│  ◄──────── │  YOUR tools        │  ◄──────── │ Read your data   │
│              │   Answer   │  YOUR workflows    │   Results  │ Run your queries │
└──────────────┘            └───────────────────┘            └──────────────────┘
```

### The Three Promises

1. **You bring your data** — Any format: Excel, PDF, images, databases, emails, invoices
2. **You keep your tools** — OpenBridge connects to YOUR ERP, CRM, backend, or spreadsheet
3. **You talk naturally** — WhatsApp, Telegram, Discord, email — the channels you already use

---

## 3. Real-World Business Cases

### Case 1: Marketplace Seller (YOUR marketplace)

**Persona**: Ahmed sells electronics on your marketplace platform.

**Current pain**:

- Manually updates inventory in the marketplace dashboard
- Copies product descriptions from supplier catalog (PDF)
- Misses orders because he's in WhatsApp, not the dashboard
- Doesn't know which products are profitable vs just busy

**With OpenBridge**:

```
Ahmed (WhatsApp): "Add this product" [attaches supplier PDF page]
OpenBridge: ✓ Extracted: Samsung Galaxy A55, specs, price TND 899
            ✓ Created listing on marketplace (draft)
            ✓ Set initial price at TND 1049 (17% margin, market avg)
            → Approve and publish? [Yes/No]

Ahmed: "How are my sales this week?"
OpenBridge: 📊 This week: 23 orders, TND 4,200 revenue
            Top seller: iPhone 15 case (8 units)
            ⚠️ Low stock: USB-C cables (2 left, avg 5/week)
            💡 Suggestion: Reorder 20 cables from Supplier B (cheapest)

Ahmed: "Send reorder to supplier"
OpenBridge: ✓ Generated PO for 20x USB-C cables @ TND 8.50
            ✓ Sent to Supplier B via email
            ✓ Expected delivery: Tuesday
```

**Integration points with YOUR marketplace API**:

- `POST /supplier/catalog/products` — create products
- `GET /company/orders` — fetch orders
- `GET /supplier/wallet` — check earnings
- `PUT /supplier/catalog/products/{id}/variants` — update inventory
- `POST /supplier/catalog/price-rules` — dynamic pricing
- NATS events: `order.created`, `inventory.low_stock` → WhatsApp alerts

---

### Case 2: Restaurant / Cafe

**Persona**: Fatma runs a cafe in Tunis.

**Her data**: Menu (PDF), supplier invoices (photos), daily sales (paper/Excel), staff schedule (WhatsApp group)

**With OpenBridge**:

```
Fatma: [sends photo of supplier invoice]
OpenBridge: ✓ Scanned: 50kg flour (TND 45), 20L milk (TND 32), 5kg sugar (TND 18)
            ✓ Updated inventory: flour now 68kg, milk 24L, sugar 12kg
            ✓ Cost this month: TND 2,340 (↑12% vs last month — milk prices up)

Fatma: "What should I prep for Friday?"
OpenBridge: Based on last 4 Fridays:
            - 40 cappuccinos (need 8L milk ✓)
            - 25 croissants (need 3kg flour ✓, 1kg butter ⚠️ only 0.5kg left)
            - 15 sandwiches (need 2kg chicken ✓)
            → Order 1kg butter before Thursday

Fatma: "Which menu items lose money?"
OpenBridge: 🔴 Chocolate fondant: costs TND 4.20, sells TND 5.00 (16% margin)
            🔴 Fresh juice: costs TND 3.80, sells TND 4.50 (16% margin)
            🟢 Espresso: costs TND 0.40, sells TND 3.00 (87% margin)
            💡 Raise fondant to TND 6.50 or remove? Juice to TND 5.50?
```

---

### Case 3: Car Rental Company

**Persona**: Karim runs 30 cars in Sousse.

**His data**: Fleet spreadsheet (Excel), booking records (custom app), maintenance log (notebook), insurance (PDF)

**With OpenBridge**:

```
Karim: [sends fleet Excel file]
OpenBridge: ✓ Loaded 30 vehicles. Analysis:
            - 4 cars overdue for service (>10,000km since last)
            - 2 insurance policies expire this month
            - Average utilization: 68% (industry avg: 75%)
            - Most profitable: Clio (TND 89/day, 82% booked)
            - Least profitable: Mercedes (TND 200/day, 31% booked)

Karim: "Customer wants a car for next week, 5 days"
OpenBridge: Available next week (Mon-Fri):
            1. Clio - TND 445/5 days
            2. Polo - TND 395/5 days
            3. Megane - TND 525/5 days
            → Book which one? I'll generate the contract.

Karim: "Book the Polo, customer is Sami Ben Ali +216 XX XXX XXX"
OpenBridge: ✓ Booking confirmed: Polo, Mon-Fri
            ✓ Contract generated (PDF attached)
            ✓ SMS sent to Sami with pickup details
            ✓ Car marked unavailable in fleet sheet
```

---

### Case 4: Delivery Partner (YOUR marketplace)

**Persona**: Youssef does deliveries for your marketplace.

**With OpenBridge**:

```
Youssef (WhatsApp): "What deliveries are available?"
OpenBridge: 📦 3 deliveries near you (La Marsa):
            1. Order #4521 → Carthage (2.3km) — TND 5.50
            2. Order #4518 → Sidi Bou Said (3.1km) — TND 7.00
            3. Order #4525 → Le Bardo (8.2km) — TND 12.00
            → Claim which?

Youssef: "Take 1 and 2"
OpenBridge: ✓ Claimed Order #4521 — pickup at Store "TechZone" (20min window)
            ✓ Claimed Order #4518 — pickup at Store "ModeShop"
            📍 Optimized route: TechZone → Carthage → ModeShop → Sidi Bou Said
            Estimated time: 45min, earnings: TND 12.50

Youssef: "Delivered 4521" [sends photo]
OpenBridge: ✓ Order #4521 marked delivered. Proof uploaded.
            ✓ TND 5.50 added to your wallet (balance: TND 234.00)
            ✓ Customer notified.
```

**Integration with YOUR marketplace API**:

- `GET /delivery/available` — browse assignments
- `POST /delivery/{id}/claim` — accept delivery
- `POST /delivery/{id}/pickup` — mark picked up
- `POST /delivery/{id}/complete` — proof + complete
- `GET /delivery/wallet` — wallet balance
- NATS events: `delivery.new_assignment` → WhatsApp push

---

### Case 5: Law Firm / Consultancy

**Persona**: Maître Leila, independent lawyer.

```
Leila: [sends 40-page contract PDF]
OpenBridge: ✓ Analyzed contract. Key findings:
            - Type: Commercial lease agreement
            - Duration: 3 years, renewable
            - Monthly rent: TND 2,500 + 19% VAT
            - ⚠️ Clause 12.3: Landlord can terminate with 30 days notice (unusual, standard is 90)
            - ⚠️ Clause 8.1: Tenant responsible for structural repairs (abnormal)
            - No arbitration clause (recommend adding)

Leila: "Draft a counter-proposal for clauses 12.3 and 8.1"
OpenBridge: ✓ Draft attached (Word document)
            Changes: termination notice → 90 days, structural repairs → landlord
            Tone: firm but collaborative
```

---

### Case 6: Construction / Trades

**Persona**: Nabil, building contractor.

```
Nabil: [sends project blueprint PDF + material list Excel]
OpenBridge: ✓ Project: Villa in Hammamet, 250m²
            ✓ Material estimate: TND 185,000
            ✓ vs your list: you're missing 200m² electrical conduit (~TND 1,200)
            ✓ Cheapest supplier combo: Supplier A (cement), Supplier C (steel) = TND 172,000
            → Save TND 13,000 vs single-supplier

Nabil: "Track costs for this project"
OpenBridge: [creates project tracker]
            Budget: TND 185,000
            Spent so far: TND 0
            → Send me invoices/receipts as you go, I'll track everything
```

---

## 4. Architecture: From Code Tool to Business Platform

### Current Architecture (v0.0.15 — Developer-Focused)

```
┌─────────────────────────────────────────────┐
│  Channels: WhatsApp, Telegram, Discord...   │
├─────────────────────────────────────────────┤
│  Bridge Core: Router, Auth, Queue           │
├─────────────────────────────────────────────┤
│  AI Discovery: claude, codex, aider         │
├─────────────────────────────────────────────┤
│  Agent Runner: --allowedTools, --max-turns   │
├─────────────────────────────────────────────┤
│  Master AI: Explores CODE, spawns workers   │
├─────────────────────────────────────────────┤
│  Memory: SQLite + FTS5 (code chunks)        │
└─────────────────────────────────────────────┘
```

### Target Architecture (v0.1.0+ — Business Platform)

```
┌──────────────────────────────────────────────────────────────┐
│  Business Channels                                           │
│  WhatsApp · Telegram · Discord · Email · WebChat · SMS       │
├──────────────────────────────────────────────────────────────┤
│  Bridge Core (existing + enhanced)                           │
│  Router · Auth · Queue · Multi-Tenant · Billing              │
├──────────────────────────────────────────────────────────────┤
│  NEW: Document Intelligence Layer                            │
│  ┌──────────┬──────────┬──────────┬──────────┬────────────┐  │
│  │ PDF      │ Excel/   │ Image    │ Email    │ Database   │  │
│  │ Parser   │ CSV      │ OCR +    │ Parser   │ Connector  │  │
│  │ (tables, │ Reader   │ Vision   │ (IMAP,   │ (Postgres, │  │
│  │ text,    │ (sheets, │ (photos, │ Gmail,   │ MySQL,     │  │
│  │ forms)   │ formulas)│ receipts)│ Outlook) │ MongoDB)   │  │
│  └──────────┴──────────┴──────────┴──────────┴────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  NEW: Business Knowledge Graph                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Entities: Customers, Products, Orders, Invoices,     │    │
│  │           Suppliers, Employees, Vehicles, Properties  │    │
│  │ Relations: Customer→Order→Product→Supplier            │    │
│  │ Timeline:  Events, deadlines, milestones              │    │
│  │ Metrics:   Revenue, costs, margins, utilization       │    │
│  │ Storage:   SQLite + FTS5 + sqlite-vec (embeddings)    │    │
│  └──────────────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────────────┤
│  NEW: Integration Framework                                  │
│  ┌─────────────┬─────────────┬─────────────┬─────────────┐  │
│  │ REST API    │ Database    │ File System │ SaaS        │  │
│  │ Adapter     │ Adapter     │ Adapter     │ Adapter     │  │
│  │ (any API)   │ (PG,MySQL)  │ (local,S3)  │ (OAuth)     │  │
│  ├─────────────┴─────────────┴─────────────┴─────────────┤  │
│  │ Pre-built Connectors:                                  │  │
│  │ • YOUR Marketplace API (460+ endpoints)                │  │
│  │ • Odoo / ERPNext / SAP Business One                    │  │
│  │ • QuickBooks / Xero / Wave                             │  │
│  │ • Google Workspace / Microsoft 365                     │  │
│  │ • Stripe / Flouci / payment providers                  │  │
│  │ • Custom backends (any REST/GraphQL API)               │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  AI Layer (existing + enhanced)                              │
│  Master AI · Workers · Skill Packs · Self-Improvement        │
├──────────────────────────────────────────────────────────────┤
│  NEW: Business Workflow Engine                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Triggers:  "When stock < 5 → alert owner"              │  │
│  │ Schedules: "Daily sales summary at 9pm"                │  │
│  │ Approvals: "Draft PO → owner approves → send"          │  │
│  │ Templates: Invoice, Quote, PO, Report, Contract        │  │
│  │ Pipelines: "New order → classify → route → fulfill"    │  │
│  └────────────────────────────────────────────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  Memory (existing + enhanced)                                │
│  SQLite + FTS5 + Vector Search + Knowledge Graph             │
│  Business context · Conversation history · Learned patterns  │
└──────────────────────────────────────────────────────────────┘
```

---

## 5. Document Intelligence Layer

**Goal**: OpenBridge reads ANY file a business throws at it.

### File Type Support Matrix

| File Type              | How We Process         | What We Extract                            | Library/Approach         |
| ---------------------- | ---------------------- | ------------------------------------------ | ------------------------ |
| **PDF**                | Parse + OCR fallback   | Text, tables, forms, images                | pdf-parse + Tesseract.js |
| **Excel/CSV**          | Sheet parser           | Rows, columns, formulas, named ranges      | SheetJS (xlsx)           |
| **Word (.docx)**       | XML parser             | Text, tables, headers, styles              | mammoth.js               |
| **Images**             | Vision AI + OCR        | Text (receipts, invoices), objects, labels | AI vision + Tesseract.js |
| **Email (.eml/.mbox)** | MIME parser            | Subject, body, attachments, contacts       | mailparser               |
| **Video**              | Transcription + frames | Speech text, key frames, descriptions      | Whisper + ffmpeg         |
| **Audio**              | Transcription          | Speech-to-text                             | Whisper                  |
| **JSON/XML**           | Schema detection       | Structure, records, relationships          | Native Node.js           |
| **Database**           | Query interface        | Schema, sample data, statistics            | pg, mysql2, mongodb      |
| **Photos**             | Vision AI              | Product recognition, text, labels          | AI multimodal            |

### Architecture

```typescript
// src/intelligence/document-processor.ts
interface DocumentProcessor {
  /**
   * Process any file and extract structured business data.
   * Returns entities, relations, and raw text for indexing.
   */
  process(file: BusinessFile): Promise<ProcessedDocument>;
}

interface BusinessFile {
  path: string; // Local path or URL
  mimeType: string; // Auto-detected
  source: string; // "upload", "email", "sync", "scan"
  metadata?: Record<string, unknown>;
}

interface ProcessedDocument {
  id: string;
  sourceFile: BusinessFile;
  rawText: string; // For FTS5 indexing
  entities: ExtractedEntity[]; // Customers, products, amounts...
  relations: ExtractedRelation[]; // Customer→Invoice, Product→Supplier
  tables: ExtractedTable[]; // Structured tabular data
  summary: string; // AI-generated summary
  embedding?: number[]; // Vector for semantic search
  confidence: number; // 0-1 extraction confidence
}
```

### How It Works

1. **User sends file** (WhatsApp photo, email attachment, file drop)
2. **MIME detection** → route to correct processor
3. **Extract raw content** (text, tables, images)
4. **AI analysis** → Master worker classifies content, extracts entities
5. **Store in Knowledge Graph** → entities, relations, metrics
6. **Index for search** → FTS5 + vector embeddings
7. **Confirm to user** → "I found 47 products, 12 suppliers, 3 months of invoices"

---

## 6. Business Knowledge Graph

**Goal**: OpenBridge doesn't just store text — it understands your business as structured knowledge.

### Entity Types (Generic — works for any business)

```typescript
// src/intelligence/knowledge-graph.ts

// Universal entity types that apply to ALL businesses
type EntityType =
  // People & Organizations
  | 'customer'
  | 'supplier'
  | 'employee'
  | 'partner'
  | 'contact'
  // Products & Services
  | 'product'
  | 'service'
  | 'category'
  | 'variant'
  // Transactions
  | 'order'
  | 'invoice'
  | 'payment'
  | 'quote'
  | 'purchase_order'
  // Assets
  | 'vehicle'
  | 'property'
  | 'equipment'
  | 'inventory_item'
  // Documents
  | 'contract'
  | 'permit'
  | 'certificate'
  | 'receipt'
  // Operations
  | 'project'
  | 'task'
  | 'appointment'
  | 'delivery'
  // Financial
  | 'expense'
  | 'revenue'
  | 'budget'
  | 'account';

interface BusinessEntity {
  id: string;
  type: EntityType;
  name: string;
  attributes: Record<string, unknown>; // Flexible schema per entity
  source: string; // Which file/system it came from
  confidence: number; // Extraction confidence
  lastUpdated: Date;
  version: number; // Track changes over time
}

interface BusinessRelation {
  id: string;
  fromEntity: string;
  toEntity: string;
  relationType: string; // "purchased", "supplied_by", "assigned_to", "owns"
  attributes?: Record<string, unknown>;
  source: string;
  timestamp?: Date;
}
```

### Why This Matters

With a knowledge graph, the Master AI can answer questions like:

- "Who are my top 5 customers?" → query Customer entities sorted by Order count
- "Which supplier is cheapest for flour?" → query Supplier→Product relations with price attributes
- "Show me all unpaid invoices" → query Invoice entities where status ≠ paid
- "What's my monthly revenue trend?" → aggregate Order/Payment entities by month

**Without the graph**, the AI would have to re-read every file for every question. **With the graph**, answers are instant.

---

## 7. Integration Framework (ERP/CRM/Custom)

**Goal**: OpenBridge connects to ANY system the business already uses — not replace it.

### The Generic Integration Architecture

```
┌──────────────────────────────────────────────────────┐
│                Integration Registry                   │
│  Discovers, configures, and manages all integrations │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ REST Adapter │  │ DB Adapter   │  │ File Sync  │ │
│  │              │  │              │  │ Adapter    │ │
│  │ ANY REST API │  │ PostgreSQL   │  │ Local/S3   │ │
│  │ ANY GraphQL  │  │ MySQL        │  │ Google     │ │
│  │ Webhooks     │  │ MongoDB      │  │ Dropbox    │ │
│  │ OAuth/API Key│  │ SQLite       │  │ OneDrive   │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ Email        │  │ Calendar     │  │ Payment    │ │
│  │ Adapter      │  │ Adapter      │  │ Adapter    │ │
│  │              │  │              │  │            │ │
│  │ IMAP/SMTP    │  │ Google Cal   │  │ Stripe     │ │
│  │ Gmail API    │  │ Outlook Cal  │  │ Flouci     │ │
│  │ Outlook API  │  │ CalDAV       │  │ PayPal     │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
└──────────────────────────────────────────────────────┘
```

### Integration Interface (Plugin Pattern — same as Connector)

```typescript
// src/integrations/integration.ts

interface BusinessIntegration {
  name: string; // "marketplace-api", "odoo", "quickbooks"
  type: IntegrationType; // "rest", "database", "file", "email"

  // Lifecycle
  initialize(config: IntegrationConfig): Promise<void>;
  healthCheck(): Promise<HealthStatus>;
  shutdown(): Promise<void>;

  // Discovery — let AI understand what's available
  describeCapabilities(): IntegrationCapability[];
  describeSchema(): SchemaDescription; // What data is available

  // Read — AI queries business data
  query(request: QueryRequest): Promise<QueryResult>;

  // Write — AI takes actions (with approval)
  execute(action: ActionRequest): Promise<ActionResult>;

  // Events — real-time updates
  subscribe?(event: string, handler: EventHandler): void;
}

interface IntegrationCapability {
  name: string; // "list_orders", "create_product", "send_email"
  description: string; // Human-readable for Master AI
  parameters: ZodSchema; // Input validation
  requiresApproval: boolean; // Human-in-the-loop for write actions
  category: 'read' | 'write' | 'admin';
}
```

### How Custom ERPs Work

**Key insight**: Businesses with custom backends don't need a specific adapter. They need OpenBridge to **discover their API automatically**.

```
Business: "Here's our API documentation" [sends Swagger/OpenAPI JSON]
OpenBridge: ✓ Loaded 85 endpoints from your API
            ✓ Detected: Products (CRUD), Orders (read + status update),
              Customers (read), Invoices (create + send)
            ✓ Authentication: Bearer token (configured)
            → I can now manage your orders, products, and invoices. Try me!
```

```typescript
// src/integrations/adapters/openapi-adapter.ts
// Generic adapter that reads ANY OpenAPI/Swagger spec and generates capabilities
class OpenAPIAdapter implements BusinessIntegration {
  async initialize(config: { specUrl: string; authToken: string }) {
    const spec = await loadOpenAPISpec(config.specUrl);
    this.capabilities = spec.paths.map((path) => ({
      name: operationId(path),
      description: path.summary,
      parameters: zodFromJsonSchema(path.parameters),
      requiresApproval: path.method !== 'GET',
      category: path.method === 'GET' ? 'read' : 'write',
    }));
  }
}
```

### Pre-Built Integration Packs

| Integration               | Priority | Why                                                            |
| ------------------------- | -------- | -------------------------------------------------------------- |
| **Your Marketplace API**  | P0       | Your own product — sellers & delivery partners are first users |
| **Google Workspace**      | P1       | Sheets, Docs, Gmail, Calendar — ubiquitous                     |
| **Odoo**                  | P1       | Most popular open-source ERP (10M+ users)                      |
| **ERPNext**               | P1       | Growing open-source ERP                                        |
| **QuickBooks / Xero**     | P2       | Accounting — every business needs it                           |
| **Stripe / Payment**      | P2       | Universal payment integration                                  |
| **WhatsApp Business API** | P2       | Official API for business messaging                            |
| **Shopify / WooCommerce** | P3       | E-commerce platforms                                           |
| **Custom REST/GraphQL**   | P0       | The generic adapter — works with ANY API                       |
| **Custom Database**       | P1       | Direct DB connection for businesses with no API                |

---

## 8. Marketplace Integration (Your API Project)

### Your Marketplace at a Glance

Your `/Desktop/API` project is a **production-grade marketplace** with:

- **3 apps**: Marketplace (Next.js), Backend (NestJS, 460+ endpoints), Dashboard (Next.js)
- **40+ Prisma models** across 14 business domains
- **5 account types**: Customer, Supplier, Delivery, Platform Worker, Admin
- **Key features**: Multi-vendor orders, 4D status tracking, dynamic pricing (7 rule types), delivery logistics with GPS, wallets, campaigns

### OpenBridge × Marketplace Integration Map

```
┌─────────────────────────────────────────────────────────┐
│                    OpenBridge                             │
│                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  Seller      │    │  Delivery   │    │  Admin       │  │
│  │  Assistant   │    │  Assistant  │    │  Assistant   │  │
│  │  (WhatsApp)  │    │  (WhatsApp) │    │  (Telegram)  │  │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘  │
│         │                  │                   │         │
│  ┌──────▼──────────────────▼───────────────────▼──────┐  │
│  │              Master AI (OpenBridge)                  │  │
│  │  Understands: marketplace schema, seller catalog,   │  │
│  │  order flows, delivery routes, pricing rules        │  │
│  └──────────────────────┬──────────────────────────────┘  │
│                         │                                 │
│  ┌──────────────────────▼──────────────────────────────┐  │
│  │         Marketplace Integration Adapter              │  │
│  │                                                      │  │
│  │  Seller Capabilities:                                │  │
│  │  • list_my_products    → GET /supplier/catalog/...   │  │
│  │  • create_product      → POST /supplier/catalog/...  │  │
│  │  • update_price        → PUT /supplier/.../prices    │  │
│  │  • view_orders         → GET /company/orders         │  │
│  │  • accept_order        → POST /company/orders/.../   │  │
│  │  • check_wallet        → GET /supplier/wallet        │  │
│  │  • view_analytics      → GET /supplier/analytics     │  │
│  │                                                      │  │
│  │  Delivery Capabilities:                              │  │
│  │  • available_deliveries → GET /delivery/available    │  │
│  │  • claim_delivery       → POST /delivery/.../claim   │  │
│  │  • update_location      → POST /delivery/.../gps     │  │
│  │  • complete_delivery    → POST /delivery/.../complete│  │
│  │  • check_wallet         → GET /delivery/wallet       │  │
│  │                                                      │  │
│  │  Admin Capabilities:                                 │  │
│  │  • order_overview       → GET /admin/orders          │  │
│  │  • validate_order       → POST /admin/orders/.../    │  │
│  │  • company_management   → GET/POST /admin/companies  │  │
│  │  • campaign_management  → CRUD /admin/campaigns      │  │
│  │  • delivery_settlement  → POST /admin/delivery/...   │  │
│  │                                                      │  │
│  │  Events (NATS JetStream → WhatsApp push):           │  │
│  │  • order.created        → Notify seller              │  │
│  │  • order.status_changed → Notify customer            │  │
│  │  • inventory.low_stock  → Alert seller               │  │
│  │  • delivery.assigned    → Notify driver              │  │
│  │  • campaign.started     → Notify participants        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Concrete Implementation: Marketplace Adapter

```typescript
// src/integrations/adapters/marketplace-adapter.ts

import type { BusinessIntegration, IntegrationCapability } from '../integration.js';

export class MarketplaceAdapter implements BusinessIntegration {
  name = 'marketplace';
  type = 'rest' as const;

  private baseUrl: string;
  private authToken: string;

  describeCapabilities(): IntegrationCapability[] {
    return [
      // --- Seller capabilities ---
      {
        name: 'list_seller_products',
        description: 'List all products in the seller catalog with prices and stock levels',
        parameters: z.object({ page: z.number().optional(), limit: z.number().optional() }),
        requiresApproval: false,
        category: 'read',
      },
      {
        name: 'create_product',
        description:
          'Create a new product listing from extracted data (name, description, price, images)',
        parameters: z.object({
          name: z.string(),
          description: z.string(),
          price: z.number(),
          categoryId: z.string(),
          images: z.array(z.string()).optional(),
        }),
        requiresApproval: true, // Human approves before publishing
        category: 'write',
      },
      {
        name: 'update_stock',
        description: 'Update inventory stock level for a product variant',
        parameters: z.object({ variantId: z.string(), quantity: z.number() }),
        requiresApproval: true,
        category: 'write',
      },
      // ... 30+ more capabilities mapped to your 460+ endpoints
    ];
  }

  async query(request: QueryRequest): Promise<QueryResult> {
    // Route to the correct marketplace endpoint
    // Return structured data for the Knowledge Graph
  }

  async execute(action: ActionRequest): Promise<ActionResult> {
    // Execute write action against marketplace API
    // Always requires prior approval for non-read actions
  }

  subscribe(event: string, handler: EventHandler): void {
    // Connect to NATS JetStream for real-time events
    // Route events to WhatsApp/Telegram notifications
  }
}
```

---

## 9. Inspired by the Best

### What We Learn From Each

| Source               | Key Pattern                                                      | How OpenBridge Adopts It                                                                                |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Hermes Agent**     | Self-improving skills — agent learns procedures and reuses them  | OpenBridge skill packs become **business procedures** (e.g., "process invoice" skill evolves over time) |
| **Hermes Agent**     | Multi-provider abstraction (200+ models)                         | OpenBridge already has this via adapters; extend to business AI (Ollama for local, Claude for complex)  |
| **Hermes Agent**     | Fuzzy tool repair — auto-fix misnamed tool calls                 | Add to error-classifier.ts for integration API calls                                                    |
| **Hermes Agent**     | Honcho user modeling — remembers who the user is across sessions | OpenBridge learns each business user's role, preferences, common requests                               |
| **Odoo (ERP)**       | Modular architecture — install only what you need                | OpenBridge integration packs: install marketplace-pack, accounting-pack, etc.                           |
| **ERPNext**          | Open-source ERP with community modules                           | OpenBridge community integrations: anyone can build an adapter                                          |
| **n8n / Zapier**     | Visual workflow automation                                       | OpenBridge workflow engine (but conversational, not visual)                                             |
| **Notion AI**        | AI that understands your workspace structure                     | OpenBridge already does this for code; extend to business files                                         |
| **SAP Business One** | Industry-specific templates (retail, manufacturing, services)    | OpenBridge industry templates with pre-built skill packs                                                |
| **Chatwoot**         | Open-source customer engagement via messaging                    | OpenBridge extends beyond customer support to full business operations                                  |
| **Cal.com**          | Open-source scheduling                                           | Integration adapter for appointment/booking businesses                                                  |

### Open-Source Projects to Watch & Learn From

| Project                                                           | What It Does              | What We Take                                |
| ----------------------------------------------------------------- | ------------------------- | ------------------------------------------- |
| **[LangChain](https://github.com/langchain-ai/langchain)**        | LLM application framework | Document loader patterns, chain composition |
| **[LlamaIndex](https://github.com/run-llama/llama_index)**        | Data framework for LLMs   | Knowledge graph patterns, RAG pipeline      |
| **[Hermes Agent](https://github.com/NousResearch/hermes-agent)**  | Self-improving agent      | Skill system, multi-provider, gateway       |
| **[AutoGPT](https://github.com/Significant-Gravitas/AutoGPT)**    | Autonomous AI agent       | Task decomposition, memory patterns         |
| **[Odoo](https://github.com/odoo/odoo)**                          | Open-source ERP           | Module system, business logic patterns      |
| **[ERPNext](https://github.com/frappe/erpnext)**                  | Open-source ERP           | Document model, workflow engine             |
| **[n8n](https://github.com/n8n-io/n8n)**                          | Workflow automation       | Node-based execution, integration patterns  |
| **[Chatwoot](https://github.com/chatwoot/chatwoot)**              | Customer engagement       | Multi-channel messaging, agent assignment   |
| **[Cal.com](https://github.com/calcom/cal.com)**                  | Scheduling                | Booking flows, availability logic           |
| **[Documenso](https://github.com/documenso/documenso)**           | Document signing          | PDF handling, template system               |
| **[Invoice Ninja](https://github.com/invoiceninja/invoiceninja)** | Invoicing                 | Invoice generation, payment tracking        |
| **[Meilisearch](https://github.com/meilisearch/meilisearch)**     | Search engine             | Fast search across business data            |

---

## 10. Industry Templates

**Goal**: When a business onboards, OpenBridge detects their industry and loads relevant knowledge.

### Template Structure

```
.openbridge/
├── industry-templates/
│   ├── restaurant/
│   │   ├── template.json          ← Entity types, common metrics, workflows
│   │   ├── skill-pack.md          ← AI instructions for restaurant operations
│   │   ├── sample-queries.json    ← "What should I prep?" "Food cost analysis"
│   │   └── integrations.json     ← Suggested: POS, delivery platforms, suppliers
│   ├── car-rental/
│   │   ├── template.json
│   │   ├── skill-pack.md
│   │   ├── sample-queries.json
│   │   └── integrations.json
│   ├── marketplace-seller/
│   │   ├── template.json
│   │   ├── skill-pack.md
│   │   └── integrations.json     ← YOUR marketplace API
│   ├── retail/
│   ├── services/
│   ├── construction/
│   ├── logistics/
│   └── professional/              ← Law, consulting, accounting
```

### How Industry Detection Works

```
User drops files → AI analyzes → Detects patterns:

"I see invoices with food items, a menu PDF, and supplier orders
 for dairy and produce. This looks like a restaurant/cafe business."

→ Loads restaurant template
→ Suggests: "I can track your food costs, predict prep needs,
   and alert you on low inventory. Want me to start?"
```

---

## 11. The Onboarding Flow

### Step-by-Step (Business Owner Experience)

```
┌─────────────────────────────────────────────────────┐
│  STEP 1: Connect Channel                             │
│                                                      │
│  npx openbridge init                                 │
│  > Channel? WhatsApp                                 │
│  > Your phone number? +216 XX XXX XXX                │
│  > [QR Code appears — scan with WhatsApp]            │
│  ✓ Connected!                                        │
└─────────────────────────────┬───────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────┐
│  STEP 2: Drop Your Files                             │
│                                                      │
│  Owner (WhatsApp): [sends 15 files]                  │
│  - inventory.xlsx                                    │
│  - supplier_invoices/ (folder of PDFs)               │
│  - product_photos/ (folder of images)                │
│  - customer_contacts.csv                             │
│  - last_year_sales.xlsx                              │
│                                                      │
│  OpenBridge: "Processing 15 files..."                │
│  OpenBridge: "I'm learning your business..."         │
└─────────────────────────────┬───────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────┐
│  STEP 3: Business Profile (AI-Generated)             │
│                                                      │
│  OpenBridge: "Here's what I found:                   │
│                                                      │
│  🏢 Business: Electronics retail                     │
│  📦 Products: 142 items across 8 categories          │
│  👥 Customers: 340 contacts                          │
│  🏭 Suppliers: 7 active suppliers                    │
│  💰 Revenue (last year): TND 245,000                 │
│  📈 Top seller: Phone cases (23% of revenue)         │
│  ⚠️ Issues found:                                    │
│     - 12 products with no photos                     │
│     - 3 suppliers with outdated contact info         │
│     - 15 unpaid invoices (TND 4,200 total)           │
│                                                      │
│  Want me to:                                         │
│  ✓ Set up daily sales summary?                       │
│  ✓ Alert you on low stock?                           │
│  ✓ Track unpaid invoices?                            │
│  ✓ Connect to your marketplace account?"             │
└─────────────────────────────┬───────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────┐
│  STEP 4: Connect Tools (Optional)                    │
│                                                      │
│  OpenBridge: "I detected you might use:              │
│  • Your marketplace seller account                   │
│  • Google Sheets (found .xlsx files)                 │
│  • Gmail (found email references in docs)            │
│                                                      │
│  Connect any of these for real-time sync?"           │
│                                                      │
│  Owner: "Connect marketplace"                        │
│  OpenBridge: "Enter your marketplace API token:      │
│              [or scan QR from dashboard]"             │
│  ✓ Connected! I can now manage your listings."       │
└─────────────────────────────┬───────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────┐
│  STEP 5: Ready — Talk to Your Business               │
│                                                      │
│  Owner can now ask anything via WhatsApp:            │
│  "How are sales today?"                              │
│  "Reorder from Supplier B"                           │
│  "Create a listing for this product" [photo]         │
│  "Send invoice to Customer X"                        │
│  "What's my profit this month?"                      │
│  "Schedule delivery for tomorrow 3pm"                │
└─────────────────────────────────────────────────────┘
```

---

## 12. Implementation Roadmap

### Phase A: Document Intelligence (v0.1.0) — Foundation

**Goal**: OpenBridge reads any business file.

| #   | Task                   | Details                                              |
| --- | ---------------------- | ---------------------------------------------------- |
| A1  | PDF processor          | pdf-parse + Tesseract.js OCR fallback                |
| A2  | Excel/CSV processor    | SheetJS — sheets, formulas, named ranges             |
| A3  | Image processor        | AI vision (Claude/Gemini multimodal) + OCR           |
| A4  | Email processor        | mailparser for .eml/.mbox                            |
| A5  | Document processor     | mammoth.js for .docx                                 |
| A6  | Unified file router    | MIME detection → correct processor                   |
| A7  | Entity extractor       | AI-powered: find customers, products, amounts, dates |
| A8  | WhatsApp file handling | Receive & process files sent via WhatsApp            |

**Deliverable**: Send any file via WhatsApp → OpenBridge reads, summarizes, extracts entities.

---

### Phase B: Business Knowledge Graph (v0.1.1) — Brain

**Goal**: Structured business knowledge, not just text chunks.

| #   | Task                   | Details                                            |
| --- | ---------------------- | -------------------------------------------------- |
| B1  | Entity schema          | Generic entity types (customer, product, order...) |
| B2  | Relation schema        | Entity-to-entity links with types                  |
| B3  | SQLite storage         | Extend openbridge.db with entity/relation tables   |
| B4  | FTS5 + vector indexing | Search across all business entities                |
| B5  | Entity merge/dedup     | Same customer from different files → one entity    |
| B6  | Timeline/history       | Track entity changes over time                     |
| B7  | Metrics engine         | Computed metrics (revenue, margins, trends)        |
| B8  | Master AI integration  | Master queries knowledge graph for answers         |

**Deliverable**: "Who are my top customers?" → instant structured answer.

---

### Phase C: Integration Framework (v0.1.2) — Connections

**Goal**: Connect to any external system.

| #   | Task                  | Details                                                |
| --- | --------------------- | ------------------------------------------------------ |
| C1  | Integration interface | BusinessIntegration plugin contract                    |
| C2  | REST adapter          | Generic HTTP client with auth (Bearer, OAuth, API key) |
| C3  | OpenAPI auto-adapter  | Read Swagger/OpenAPI spec → auto-generate capabilities |
| C4  | Database adapter      | Direct PostgreSQL/MySQL/MongoDB query interface        |
| C5  | Webhook receiver      | Receive events from external systems                   |
| C6  | Approval flow         | Human-in-the-loop for write actions                    |
| C7  | Integration registry  | Discover, configure, health-check integrations         |
| C8  | Rate limiting         | Per-integration request throttling                     |

**Deliverable**: Point OpenBridge at any API spec → it understands and can use it.

---

### Phase D: Marketplace Adapter (v0.1.3) — Your Product

**Goal**: Your marketplace sellers and delivery partners use OpenBridge via WhatsApp.

| #   | Task                     | Details                                            |
| --- | ------------------------ | -------------------------------------------------- |
| D1  | Marketplace REST adapter | Map all 460+ endpoints to capabilities             |
| D2  | Seller skill pack        | Product management, pricing, order fulfillment     |
| D3  | Delivery skill pack      | Assignment, tracking, settlement                   |
| D4  | Admin skill pack         | Order validation, company management               |
| D5  | NATS event bridge        | JetStream → WhatsApp/Telegram notifications        |
| D6  | Role-based access        | Seller sees seller endpoints, driver sees delivery |
| D7  | Onboarding flow          | New seller → WhatsApp → guided setup               |
| D8  | Analytics queries        | Sales reports, top products, revenue trends        |

**Deliverable**: Sellers manage their store via WhatsApp. Drivers manage deliveries via WhatsApp.

---

### Phase E: Industry Templates (v0.1.4) — Scale

**Goal**: Any business type can onboard in minutes.

| #   | Task                 | Details                                                    |
| --- | -------------------- | ---------------------------------------------------------- |
| E1  | Template format      | JSON spec for industry-specific entities/metrics/workflows |
| E2  | Restaurant template  | Menu, inventory, food cost, prep planning                  |
| E3  | Car rental template  | Fleet, bookings, maintenance, contracts                    |
| E4  | Retail template      | Products, inventory, suppliers, sales                      |
| E5  | Services template    | Clients, projects, billing, scheduling                     |
| E6  | Industry detector    | AI analyzes uploaded files → suggests template             |
| E7  | Template marketplace | Community-contributed templates                            |

---

### Phase F: Workflow Engine (v0.1.5) — Automation

**Goal**: Automated triggers, schedules, and pipelines.

| #   | Task                   | Details                                                   |
| --- | ---------------------- | --------------------------------------------------------- |
| F1  | Trigger system         | "When X happens → do Y" (stock low → alert)               |
| F2  | Schedule system        | Cron-like: "Daily summary at 9pm"                         |
| F3  | Approval chains        | "Draft → owner approves → execute"                        |
| F4  | Document templates     | Generate invoices, quotes, POs, reports                   |
| F5  | Pipeline engine        | Multi-step workflows (order → classify → route → fulfill) |
| F6  | Natural language rules | "Alert me if any order is over TND 500"                   |

---

### Phase G: Self-Improvement (v0.1.6) — Intelligence

**Goal**: OpenBridge gets smarter the more you use it.

| #   | Task                     | Details                                                   |
| --- | ------------------------ | --------------------------------------------------------- |
| G1  | Business skill learning  | Hermes-inspired: learn procedures from repeated tasks     |
| G2  | Query optimization       | Track which questions users ask most, pre-compute answers |
| G3  | Integration learning     | Learn API patterns, cache common queries                  |
| G4  | Proactive insights       | "I noticed your flour costs are 20% higher this month"    |
| G5  | User preference modeling | Each user's communication style, preferred detail level   |

---

## 13. Competitive Moat

### Why OpenBridge Wins

| Advantage                    | Details                                                   |
| ---------------------------- | --------------------------------------------------------- |
| **Zero API cost**            | Uses user's own AI tools — no per-request billing         |
| **Zero technical knowledge** | Onboard via WhatsApp, not a dashboard                     |
| **Any file type**            | PDF, Excel, images, emails — not just structured data     |
| **Any integration**          | Custom ERP, global ERP, spreadsheet, or no system at all  |
| **Self-improving**           | Gets smarter with every interaction                       |
| **Open source**              | Community builds industry templates and integrations      |
| **SDK-first**                | Embed into any app, platform, or marketplace (like YOURS) |
| **WhatsApp-native**          | Meets users where they already are                        |
| **Privacy-first**            | Data stays on user's machine, no cloud dependency         |

### The Flywheel

```
More users
    → More industry templates
        → Better AI skills
            → More integrations
                → Attracts more users
                    → Community grows
                        → More templates...
```

### Marketplace Synergy

Your marketplace becomes the **first showcase**:

- Every seller gets OpenBridge as a "virtual assistant"
- Every delivery partner gets WhatsApp-based routing
- Admin gets AI-powered operations
- **This proves the concept** → then offer OpenBridge to ANY business

---

## Summary

OpenBridge evolves from a **developer AI bridge** to a **universal business AI platform**:

1. **Read anything** — Documents, spreadsheets, images, emails, databases
2. **Understand everything** — Build a knowledge graph of the business
3. **Connect everywhere** — ERP, CRM, marketplace, email, payments
4. **Act intelligently** — Answer questions, execute tasks, automate workflows
5. **Improve continuously** — Learn from every interaction

The marketplace is your **proving ground**. The world is the **market**.

---

## 14. The AI That Builds What You Need (ERP-Inspired Adaptive System)

### The Key Insight: OpenBridge IS the ERP

Traditional ERPs (SAP, Odoo, ERPNext) require businesses to adopt **their** system. OpenBridge flips this:

> **OpenBridge doesn't replace your tools — it CREATES the tools you're missing.**

| Traditional ERP              | OpenBridge                      |
| ---------------------------- | ------------------------------- |
| You adapt to the software    | The software adapts to you      |
| Install modules manually     | AI detects what you need        |
| Fixed forms, fixed workflows | AI generates custom pages/forms |
| Requires training            | Talk in natural language        |
| Expensive consultants        | Self-configuring                |
| Months to deploy             | Minutes to start                |

### What "Adaptive" Means (Concrete Examples)

```
Owner: "I need to track my invoices"
OpenBridge: I'll set up invoice tracking for you.
            ✓ Created invoice database (SQLite table)
            ✓ Generated invoice template (your logo, your info)
            ✓ Created web page: https://your-tunnel.openbridge.app/invoices
            → Send me invoice details or photos, I'll handle the rest.

Owner: "Invoice client Mohamed for 3 hours consulting at TND 150/hr"
OpenBridge: ✓ Invoice #INV-2026-001 created
            ✓ Total: TND 450 + 19% VAT = TND 535.50
            ✓ PDF generated (attached)
            ✓ Payment link: https://buy.stripe.com/xxxxx
            → Send to Mohamed via email or WhatsApp? [Email / WhatsApp / Both]

Owner: "Both"
OpenBridge: ✓ Email sent to mohamed@example.com with PDF attachment
            ✓ WhatsApp sent to +216 XX XXX XXX with payment link
            ✓ Tracking: I'll notify you when he pays.

[2 hours later]
OpenBridge: 💰 Mohamed just paid Invoice #INV-2026-001 (TND 535.50)
            ✓ Invoice marked as PAID
            ✓ Revenue updated in your monthly report
```

---

## 15. DocType System (Inspired by Frappe/ERPNext)

### The Pattern: Define Once, Get Everything

Frappe's most powerful pattern: a single JSON definition creates a database table, REST API, web form, and permission rules automatically. OpenBridge adopts this via an **AI-driven DocType system**.

**The difference**: In Frappe, developers write DocType definitions. In OpenBridge, **the AI creates them from conversation**.

### How It Works

```typescript
// src/intelligence/doctype.ts

/**
 * A DocType is a business entity definition that the Master AI creates
 * when it detects the user needs to track something.
 *
 * Inspired by: Frappe DocType, Twenty CRM Custom Objects, NocoDB tables
 */
interface DocType {
  name: string; // "Invoice", "Customer", "Vehicle"
  nameSingular: string; // "Invoice"
  namePlural: string; // "Invoices"
  icon?: string; // "📄"

  // Schema — fields define the database columns AND form layout
  fields: DocTypeField[];

  // Lifecycle — state machine (inspired by Odoo's docstatus)
  states?: StateMachine;

  // Relations — links to other DocTypes
  relations?: DocTypeRelation[];

  // Auto-actions — what happens on state transitions
  hooks?: DocTypeHook[];

  // Source — where this data came from
  source: 'ai-created' | 'imported' | 'integration' | 'user-defined';

  // Template — which industry template spawned this
  templateId?: string;
}

interface DocTypeField {
  name: string; // "client_name", "amount", "due_date"
  label: string; // "Client Name", "Amount", "Due Date"
  type: FieldType; // See below
  required: boolean;
  defaultValue?: unknown;
  options?: string[]; // For select/multiselect
  formula?: string; // Computed field (e.g., "subtotal * 1.19")
  dependsOn?: string; // Conditional visibility
  searchable: boolean; // Include in FTS5 index
}

type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'currency'
  | 'percent'
  | 'date'
  | 'datetime'
  | 'checkbox'
  | 'select'
  | 'multiselect'
  | 'email'
  | 'phone'
  | 'url'
  | 'image'
  | 'file'
  | 'link' // Foreign key to another DocType
  | 'table' // Child table (one-to-many)
  | 'json'
  | 'rating'
  | 'color'
  | 'geolocation';

interface StateMachine {
  initial: string;
  states: {
    [name: string]: {
      label: string;
      color: string; // "gray", "blue", "green", "red"
      transitions: {
        to: string;
        action: string; // "submit", "approve", "cancel", "pay"
        allowedRoles?: string[]; // Who can trigger this
        condition?: string; // Expression that must be true
      }[];
    };
  };
}
```

### Example: AI Creates an Invoice DocType

When a user says "I need to track invoices", the Master AI creates:

```json
{
  "name": "Invoice",
  "nameSingular": "Invoice",
  "namePlural": "Invoices",
  "icon": "📄",
  "fields": [
    {
      "name": "invoice_number",
      "label": "Invoice #",
      "type": "text",
      "required": true,
      "searchable": true
    },
    { "name": "client", "label": "Client", "type": "link", "required": true, "searchable": true },
    {
      "name": "issue_date",
      "label": "Issue Date",
      "type": "date",
      "required": true,
      "defaultValue": "today"
    },
    { "name": "due_date", "label": "Due Date", "type": "date", "required": true },
    { "name": "items", "label": "Line Items", "type": "table", "required": true },
    {
      "name": "subtotal",
      "label": "Subtotal",
      "type": "currency",
      "required": false,
      "formula": "SUM(items.amount)"
    },
    {
      "name": "tax_rate",
      "label": "Tax Rate",
      "type": "percent",
      "required": false,
      "defaultValue": 19
    },
    {
      "name": "tax_amount",
      "label": "Tax",
      "type": "currency",
      "formula": "subtotal * tax_rate / 100"
    },
    { "name": "total", "label": "Total", "type": "currency", "formula": "subtotal + tax_amount" },
    { "name": "notes", "label": "Notes", "type": "longtext", "required": false },
    { "name": "payment_link", "label": "Payment Link", "type": "url", "required": false },
    { "name": "pdf_path", "label": "PDF", "type": "file", "required": false }
  ],
  "states": {
    "initial": "draft",
    "states": {
      "draft": {
        "label": "Draft",
        "color": "gray",
        "transitions": [{ "to": "sent", "action": "send" }]
      },
      "sent": {
        "label": "Sent",
        "color": "blue",
        "transitions": [
          { "to": "paid", "action": "mark_paid" },
          { "to": "overdue", "action": "mark_overdue" }
        ]
      },
      "paid": { "label": "Paid", "color": "green", "transitions": [] },
      "overdue": {
        "label": "Overdue",
        "color": "red",
        "transitions": [
          { "to": "paid", "action": "mark_paid" },
          { "to": "sent", "action": "resend" }
        ]
      }
    }
  },
  "hooks": [
    { "on": "create", "action": "generate_invoice_number", "pattern": "INV-{YYYY}-{SEQ}" },
    { "on": "transition:send", "action": "generate_pdf" },
    { "on": "transition:send", "action": "create_payment_link" },
    { "on": "transition:send", "action": "send_to_client" },
    { "on": "transition:mark_overdue", "action": "send_reminder" }
  ],
  "source": "ai-created"
}
```

### What This Generates (Automatically)

From ONE DocType definition, OpenBridge creates:

| What                  | How                                                 | Inspired By         |
| --------------------- | --------------------------------------------------- | ------------------- |
| **Database table**    | SQLite `CREATE TABLE` with proper types + indexes   | Frappe, NocoDB      |
| **REST API**          | Auto-generated CRUD endpoints on file-server        | Frappe, NocoDB      |
| **Web form**          | HTML page for data entry (served via file-server)   | Frappe, NocoDB      |
| **List view**         | HTML table with search/filter/sort                  | NocoDB              |
| **PDF template**      | pdfmake document definition for printable output    | Invoice Ninja       |
| **State machine**     | Transition logic with role-based access             | Odoo, Frappe        |
| **FTS5 index**        | Full-text search across searchable fields           | OpenBridge existing |
| **WhatsApp commands** | "List invoices", "Create invoice", "Invoice status" | OpenBridge existing |

### The Magic: NocoDB-Inspired Dual Database

```
openbridge.db (metadata):
  doctypes           ← DocType definitions (schema)
  doctype_fields     ← Field definitions
  doctype_states     ← State machine definitions
  doctype_hooks      ← Lifecycle hooks
  doctype_relations  ← Inter-DocType links

openbridge.db (data):
  dt_invoice         ← Actual invoice records
  dt_invoice__items  ← Child table for line items
  dt_customer        ← Customer records
  dt_vehicle         ← Vehicle records (if car rental)
  dt_product         ← Product records (if retail)
```

The AI creates tables dynamically. The user never sees SQL.

---

## 16. Integration Hub (Connect Everything)

### The AI Creates Connections on Demand

```
Owner: "Connect to my Google Drive"
OpenBridge: ✓ Opening Google authorization...
            [Browser opens → user grants access]
            ✓ Connected! I can see 234 files in your Drive.
            ✓ Found folders: Invoices/, Contracts/, Receipts/
            → Want me to sync these into your business data?

Owner: "Connect Stripe so clients can pay"
OpenBridge: ✓ Enter your Stripe API key (starts with sk_live_...)
            [User sends key via WhatsApp]
            ✓ Stripe connected! Account: "Karim's Car Rental"
            ✓ I can now create payment links and track payments.
            ✓ I'll notify you in real-time when payments come in.

Owner: "Connect to my database"
OpenBridge: What type?
            1. PostgreSQL
            2. MySQL
            3. MongoDB
            → Send the connection string (I'll store it securely)

Owner: "postgresql://user:pass@host:5432/mydb"
OpenBridge: ✓ Connected! Found 12 tables:
            customers (3,400 rows), orders (12,000 rows),
            products (450 rows), invoices (2,100 rows)...
            ✓ I've mapped these to your business knowledge.
            → You can now ask me anything about your database.
```

### Integration Architecture

```typescript
// src/integrations/hub.ts

/**
 * IntegrationHub manages all external connections.
 * Each integration is a plugin that follows the same interface.
 * The Master AI decides when to create/use integrations.
 */
interface IntegrationHub {
  // Registry
  register(integration: Integration): void;
  list(): IntegrationStatus[];

  // Lifecycle
  connect(name: string, config: unknown): Promise<void>;
  disconnect(name: string): Promise<void>;
  healthCheck(name: string): Promise<HealthStatus>;

  // Operations (called by Master AI workers)
  execute(name: string, operation: string, params: unknown): Promise<unknown>;

  // Events (real-time updates → push to user)
  onEvent(name: string, event: string, handler: EventHandler): void;
}
```

### Built-in Integrations (Priority Order)

#### Tier 1: File Storage (User's data lives here)

```
┌─────────────────────────────────────────────────┐
│  Google Drive                                    │
│  npm: googleapis                                 │
│  Auth: OAuth 2.0 (browser redirect)              │
│  Capabilities:                                   │
│  • List/search files in any folder               │
│  • Download files → Document Intelligence Layer  │
│  • Upload generated files (invoices, reports)     │
│  • Watch for changes (webhook)                   │
│  • Create/organize folders                       │
├─────────────────────────────────────────────────┤
│  Dropbox                                         │
│  npm: dropbox                                    │
│  Auth: OAuth 2.0 + PKCE                          │
│  Capabilities:                                   │
│  • Same as Drive: list, download, upload, watch  │
│  • Longpoll for real-time change detection       │
├─────────────────────────────────────────────────┤
│  OneDrive / SharePoint                           │
│  npm: @microsoft/microsoft-graph-client          │
│  Auth: OAuth 2.0 (Azure AD)                      │
│  Capabilities:                                   │
│  • Same as Drive: list, download, upload, watch  │
├─────────────────────────────────────────────────┤
│  Local Filesystem                                │
│  Already exists (workspace exploration)          │
│  Enhanced: watch folders for new files           │
└─────────────────────────────────────────────────┘
```

#### Tier 2: Payments & Invoicing

```
┌─────────────────────────────────────────────────┐
│  Stripe                                          │
│  npm: stripe                                     │
│  Auth: API key (sk_live_...)                     │
│                                                  │
│  Key flows:                                      │
│                                                  │
│  1. PAYMENT LINK (simplest — no frontend needed) │
│     const link = await stripe.paymentLinks       │
│       .create({ line_items: [...] });            │
│     → Send link.url via WhatsApp                 │
│                                                  │
│  2. INVOICE (professional, tracks payment)       │
│     const inv = await stripe.invoices            │
│       .create({ customer, auto_advance: true }); │
│     await stripe.invoices.finalizeInvoice(inv.id)│
│     → inv.hosted_invoice_url (Stripe-hosted page)│
│                                                  │
│  3. WEBHOOK (payment notifications)              │
│     POST /webhook/stripe                         │
│     → "Client X paid invoice #001!"              │
│                                                  │
│  4. CHECKOUT SESSION (full e-commerce)           │
│     → Stripe-hosted checkout page                │
│     → Return URL back to OpenBridge              │
├─────────────────────────────────────────────────┤
│  Flouci (Tunisia-specific)                       │
│  npm: custom REST client                         │
│  Auth: API key                                   │
│  → Local payment method for Tunisian businesses  │
├─────────────────────────────────────────────────┤
│  PayPal                                          │
│  npm: @paypal/paypal-server-sdk                  │
│  Auth: OAuth 2.0 (Client ID + Secret)            │
└─────────────────────────────────────────────────┘
```

#### Tier 3: Communication

```
┌─────────────────────────────────────────────────┐
│  Email (SMTP/Gmail)                              │
│  npm: nodemailer (already in OpenBridge!)         │
│  Enhanced:                                       │
│  • HTML email templates for invoices             │
│  • Attachment support (PDF invoices)             │
│  • Read incoming emails (Gmail API or IMAP)      │
│  • Auto-categorize: invoice, PO, inquiry         │
├─────────────────────────────────────────────────┤
│  Google Calendar                                 │
│  npm: googleapis (calendar)                      │
│  • Create/read events                            │
│  • Appointment booking for service businesses    │
│  • Deadline tracking for projects                │
├─────────────────────────────────────────────────┤
│  Google Sheets (lightweight database)            │
│  npm: google-spreadsheet                         │
│  • Read/write rows as business data              │
│  • Use existing sheets as data source            │
│  • Generate reports as new sheets                │
├─────────────────────────────────────────────────┤
│  WhatsApp Business API (production)              │
│  npm: whatsapp (official Meta SDK)               │
│  Enhanced:                                       │
│  • Interactive buttons ("Approve" / "Reject")    │
│  • CTA buttons with payment links                │
│  • Document messages (send PDF inline)           │
│  • Template messages (initiate conversations)    │
└─────────────────────────────────────────────────┘
```

#### Tier 4: Business Systems (ERP/CRM/Custom)

```
┌─────────────────────────────────────────────────┐
│  OpenAPI Auto-Adapter (works with ANY API)       │
│  npm: swagger-parser                             │
│  • Load Swagger/OpenAPI spec                     │
│  • Auto-discover all endpoints                   │
│  • Generate typed capabilities                   │
│  • Master AI understands the API from the spec   │
│                                                  │
│  Works with:                                     │
│  ✓ Your Marketplace API (460+ endpoints)         │
│  ✓ Any custom backend with Swagger docs          │
│  ✓ Odoo REST API                                 │
│  ✓ ERPNext API                                   │
│  ✓ Any SaaS with documented API                  │
├─────────────────────────────────────────────────┤
│  Direct Database Adapter                         │
│  npm: pg (PostgreSQL), mysql2, mongodb           │
│  • Connect to ANY database                       │
│  • Auto-discover schema (tables, columns, types) │
│  • AI generates SQL queries from natural language │
│  • Read-only by default (write requires approval)│
│  • Schema → DocType mapping (auto-import)        │
├─────────────────────────────────────────────────┤
│  Webhook Receiver                                │
│  Built into file-server.ts                       │
│  • POST /webhook/:integration                    │
│  • Verify signatures (Stripe, GitHub, etc.)      │
│  • Route events to Master AI                     │
│  • Push notifications to user via messaging      │
└─────────────────────────────────────────────────┘
```

---

## 17. The AI Creates Web Pages, Apps & Documents

### OpenBridge Already Has the Infrastructure

What already exists in OpenBridge v0.0.15:

| Component             | File                                  | What It Does                                                                           |
| --------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| **File Server**       | `src/core/file-server.ts`             | HTTP server on port 3001, serves generated files with shareable UUID links, 24h expiry |
| **App Server**        | `src/core/app-server.ts`              | Manages concurrent apps on ports 3100-3199, scaffolding, health checks, tunnel support |
| **Interaction Relay** | `src/core/interaction-relay.ts`       | WebSocket server (port 3099) for real-time communication between apps and Master       |
| **HTML Renderer**     | `src/core/html-renderer.ts`           | Puppeteer-based HTML/SVG → PNG/JPEG conversion                                         |
| **Email Sender**      | `src/core/email-sender.ts`            | SMTP with attachments                                                                  |
| **GitHub Publisher**  | `src/core/github-publisher.ts`        | Publishes to GitHub Pages                                                              |
| **Output Markers**    | `src/core/output-marker-processor.ts` | Routes `[SHARE]`, `[VOICE]`, `[APP]` markers from AI output                            |
| **Skill Packs**       | `src/master/skill-packs/`             | DOCX, PPTX, XLSX, HTML, charts, diagrams, slides, art, reports                         |
| **Tunnel Support**    | Config                                | Cloudflared tunnel for public URLs                                                     |

### What We Add: Business-Specific Generation

#### A) Invoice Page Generator

```
User: "Generate an invoice page for client X"

OpenBridge does:
1. Master spawns worker with document-writer skill pack
2. Worker generates HTML invoice page with:
   - Professional layout (your business info, client info)
   - Line items table with subtotals
   - Tax calculation
   - "Pay Now" button → Stripe payment link
   - QR code for mobile payment
3. File-server hosts it at /shared/{uuid}/invoice-001.html
4. Tunnel makes it public: https://xxxx.trycloudflare.com/shared/{uuid}/invoice-001.html
5. URL sent to client via WhatsApp/email

Client opens the link → sees professional invoice → clicks "Pay Now" → Stripe checkout
```

#### B) Dashboard Generator

```
User: "Create a dashboard for my sales"

OpenBridge does:
1. Master queries Knowledge Graph for sales data
2. Spawns worker with chart-generator + web-designer skill packs
3. Worker generates interactive HTML dashboard:
   - Chart.js/D3 charts (revenue by month, top products, etc.)
   - Key metrics cards (total revenue, avg order value, etc.)
   - Interactive filters
   - Auto-refresh via Interaction Relay WebSocket
4. App-server hosts it on port 3100
5. Tunnel provides public URL
6. Owner bookmarks it as their "analytics dashboard"
```

#### C) Client Portal Generator

```
User: "Create a page where my clients can see their invoices"

OpenBridge does:
1. Generates a multi-page HTML app:
   - Login page (simple email + token)
   - Invoice list (filtered by client)
   - Invoice detail with payment status
   - Payment button (Stripe)
2. App-server hosts it
3. Each client gets a unique URL
4. Real-time updates via WebSocket relay
```

#### D) Document Templates (pdfmake + Puppeteer)

```
┌─────────────────────────────────────────────────┐
│  Document Generation Pipeline                    │
│                                                  │
│  User request ("invoice Mohamed TND 500")        │
│       │                                          │
│       ▼                                          │
│  Master AI extracts structured data:             │
│  { client: "Mohamed", items: [...], total: 500 } │
│       │                                          │
│       ▼                                          │
│  DocType lookup → "Invoice" schema               │
│       │                                          │
│       ├──── pdfmake ──────► invoice.pdf           │
│       │     (declarative    (professional PDF     │
│       │      JSON → PDF)     with logo, layout)   │
│       │                                          │
│       ├──── HTML template ► invoice.html          │
│       │     (EJS/Handlebars  (web-viewable with   │
│       │      → styled HTML)   "Pay Now" button)   │
│       │                                          │
│       └──── Nodemailer ───► email with PDF        │
│             (SMTP)           attached              │
│                                                  │
│  All outputs stored in .openbridge/generated/    │
│  Served via file-server with shareable links     │
└─────────────────────────────────────────────────┘
```

---

## 18. Workflow Engine (Inspired by n8n + Odoo)

### The AI Creates Automations from Natural Language

```
User: "Remind me when invoices are overdue"
OpenBridge: ✓ Created workflow:
            ⏰ Every day at 9:00 AM
            → Check all invoices where due_date < today AND status = "sent"
            → For each overdue: send WhatsApp reminder to you
            → Auto-update status to "overdue"

User: "When a new order comes in on the marketplace, send me a WhatsApp"
OpenBridge: ✓ Created workflow:
            🔔 Trigger: Marketplace webhook (order.created)
            → Extract: order ID, customer name, total, items
            → Send WhatsApp: "New order #4521 from Ahmed - TND 245"
            → If total > TND 500: also send email to you

User: "Every Monday, send me a sales summary"
OpenBridge: ✓ Created workflow:
            ⏰ Every Monday at 8:00 AM
            → Query: orders from last 7 days
            → Calculate: total revenue, order count, top products
            → Generate: summary report (HTML)
            → Send: WhatsApp message with highlights + link to full report
```

### Workflow Architecture

```typescript
// src/workflows/engine.ts

/**
 * Inspired by n8n's typed node system + Odoo's state machine.
 * But conversational — users create workflows by talking,
 * not by dragging nodes on a canvas.
 */

interface Workflow {
  id: string;
  name: string; // "Invoice overdue reminder"
  description: string; // AI-generated description
  enabled: boolean;
  createdBy: string; // User who created it

  trigger: WorkflowTrigger; // What starts the workflow
  steps: WorkflowStep[]; // What happens next

  // Metadata
  lastRun?: Date;
  runCount: number;
  failureCount: number;
}

// --- Triggers ---

type WorkflowTrigger =
  | ScheduleTrigger // Cron-like: "every day at 9am"
  | WebhookTrigger // External event (Stripe, marketplace, etc.)
  | DataTrigger // "When invoice.status changes to overdue"
  | MessageTrigger // "When user says /report"
  | IntegrationTrigger; // "When new file in Google Drive"

interface ScheduleTrigger {
  type: 'schedule';
  cron: string; // "0 9 * * *" = every day at 9am
  timezone: string; // "Africa/Tunis"
}

interface WebhookTrigger {
  type: 'webhook';
  integration: string; // "marketplace", "stripe"
  event: string; // "order.created", "invoice.paid"
}

interface DataTrigger {
  type: 'data';
  doctype: string; // "Invoice"
  field: string; // "status"
  condition: string; // "changed_to:overdue" or "value_gt:1000"
}

// --- Steps ---

type WorkflowStep =
  | QueryStep // Query DocType data
  | TransformStep // Calculate, filter, aggregate
  | GenerateStep // Create PDF, HTML, chart
  | SendStep // WhatsApp, email, webhook
  | IntegrationStep // Call external API
  | ApprovalStep // Wait for human approval
  | ConditionalStep // If/else branching
  | AIStep; // Ask the Master AI to decide

interface QueryStep {
  type: 'query';
  doctype: string;
  filters: Record<string, unknown>;
  sort?: string;
  limit?: number;
}

interface SendStep {
  type: 'send';
  channel: 'whatsapp' | 'email' | 'telegram' | 'discord' | 'webhook';
  recipient: string; // Phone, email, or webhook URL
  template: string; // Message template with {{variables}}
  attachments?: string[]; // Generated file paths
}

interface ApprovalStep {
  type: 'approval';
  message: string; // "Approve PO for TND 2,500?"
  approvers: string[]; // Phone numbers
  timeout: number; // Minutes before auto-reject
  options: string[]; // ["Approve", "Reject", "Modify"]
}

interface AIStep {
  type: 'ai';
  prompt: string; // "Analyze these sales and write a summary"
  skillPack?: string; // "data-analyst"
  outputVariable: string; // Store result for next step
}
```

### Workflow Storage (SQLite)

```sql
CREATE TABLE workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  trigger_type TEXT NOT NULL,
  trigger_config TEXT NOT NULL,    -- JSON
  steps TEXT NOT NULL,             -- JSON array
  created_by TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_run TEXT,
  run_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0
);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL,           -- 'running', 'completed', 'failed'
  trigger_data TEXT,              -- JSON (what triggered this run)
  step_results TEXT,              -- JSON (result of each step)
  error TEXT,
  FOREIGN KEY (workflow_id) REFERENCES workflows(id)
);
```

### Cron Scheduler (Built-in)

```typescript
// src/workflows/scheduler.ts

/**
 * Simple cron scheduler using node-cron.
 * Loads enabled workflows with schedule triggers on startup.
 * Re-evaluates when workflows are created/updated/deleted.
 */
import cron from 'node-cron';

class WorkflowScheduler {
  private jobs: Map<string, cron.ScheduledTask> = new Map();

  scheduleWorkflow(workflow: Workflow): void {
    if (workflow.trigger.type !== 'schedule') return;

    const job = cron.schedule(
      workflow.trigger.cron,
      async () => {
        await this.engine.executeWorkflow(workflow.id, { trigger: 'schedule' });
      },
      { timezone: workflow.trigger.timezone },
    );

    this.jobs.set(workflow.id, job);
  }
}
```

---

## 19. End-to-End Flow: Invoice Lifecycle

### The Complete Journey (What Actually Happens)

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP 1: User Creates Invoice                                   │
│                                                                  │
│  User (WhatsApp): "Invoice Mohamed for web design, TND 2000"    │
│       │                                                          │
│       ▼                                                          │
│  Master AI:                                                      │
│  1. Classifies intent: "invoice creation"                        │
│  2. Looks up DocType "Invoice" (auto-created on first use)       │
│  3. Looks up DocType "Customer" → finds "Mohamed" (or creates)   │
│  4. Extracts: client=Mohamed, service=Web Design, amount=2000    │
│  5. Calculates: subtotal=2000, VAT(19%)=380, total=2380          │
│  6. Generates invoice number: INV-2026-042                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  STEP 2: Generate Outputs                                        │
│                                                                  │
│  Master spawns 2 workers in parallel:                            │
│                                                                  │
│  Worker A (pdfmake skill):                                       │
│  → Generates invoice.pdf with:                                   │
│    • Your business logo + info (from .openbridge/context/)       │
│    • Client info (from Knowledge Graph)                          │
│    • Line items table                                            │
│    • Total with tax breakdown                                    │
│    • Bank details + payment instructions                         │
│    • QR code for payment link                                    │
│  → Saves to .openbridge/generated/inv-2026-042.pdf              │
│                                                                  │
│  Worker B (web-designer skill):                                  │
│  → Generates invoice.html with:                                  │
│    • Same info as PDF but interactive                            │
│    • "Pay Now" button → Stripe checkout                          │
│    • Responsive design (mobile-friendly)                         │
│  → Saves to .openbridge/generated/inv-2026-042.html             │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  STEP 3: Create Payment Link                                     │
│                                                                  │
│  If Stripe is connected:                                         │
│  → stripe.paymentLinks.create({                                  │
│      line_items: [{ price_data: { unit_amount: 238000,           │
│        currency: 'tnd', product_data: { name: 'Web Design' }    │
│      }, quantity: 1 }]                                           │
│    })                                                            │
│  → Payment link URL embedded in HTML page + QR in PDF            │
│                                                                  │
│  If no Stripe:                                                   │
│  → Invoice shows bank transfer details instead                   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  STEP 4: Deliver to Client                                       │
│                                                                  │
│  User chose: "Send via both email and WhatsApp"                  │
│                                                                  │
│  Email (nodemailer):                                             │
│  → To: mohamed@example.com                                       │
│  → Subject: "Invoice #INV-2026-042 from Your Business"           │
│  → Body: Professional HTML email                                 │
│  → Attachment: inv-2026-042.pdf                                  │
│                                                                  │
│  WhatsApp (connector):                                           │
│  → To: +216 XX XXX XXX                                           │
│  → Message: "Hi Mohamed, here's your invoice for Web Design      │
│     (TND 2,380). Pay online: [payment link]"                     │
│  → Attachment: inv-2026-042.pdf                                  │
│                                                                  │
│  Invoice status: DRAFT → SENT                                    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  STEP 5: Track & Follow Up (Automated)                           │
│                                                                  │
│  Workflow "Invoice overdue reminder" runs daily at 9am:          │
│                                                                  │
│  Day 1-7:   Status = "sent" → waiting                            │
│  Day 8:     due_date passed → status = "overdue"                 │
│             → WhatsApp to owner: "Invoice #042 is overdue"       │
│  Day 10:    → Auto-send reminder to Mohamed:                     │
│             "Friendly reminder: Invoice #INV-2026-042 (TND 2,380)│
│              is due. Pay here: [payment link]"                   │
│                                                                  │
│  Stripe webhook fires (payment.succeeded):                       │
│  → OpenBridge receives webhook at /webhook/stripe                │
│  → Matches to Invoice #042                                       │
│  → Status: OVERDUE → PAID                                        │
│  → WhatsApp to owner: "💰 Mohamed paid Invoice #042 (TND 2,380)"│
│  → Revenue tracked in Knowledge Graph                            │
│  → Monthly report updated automatically                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 20. How OpenBridge Learns & Adapts to ANY Business

### The Self-Configuring Pattern

Unlike traditional ERPs that require consultants, OpenBridge **discovers your business from your data and conversation**.

```
┌──────────────────────────────────────────────────────┐
│  DAY 1: Raw Files                                     │
│                                                       │
│  User drops: invoices.xlsx, clients.csv, receipts/    │
│  OpenBridge: "I see invoice data, client data, and    │
│  expense receipts. Let me organize this..."           │
│                                                       │
│  → Creates DocTypes: Invoice, Customer, Expense       │
│  → Imports data from files into structured tables     │
│  → Detects: "This looks like a services business"     │
│  → Loads services industry template                   │
│  → Suggests workflows: invoice tracking, expense      │
│    reporting, client follow-up                        │
└──────────────────────────────────┬───────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────┐
│  WEEK 1: Learning Patterns                            │
│                                                       │
│  User asks similar questions repeatedly:              │
│  "How much did client X pay this month?"              │
│  "What are my expenses this week?"                    │
│  "Send a quote to new client"                         │
│                                                       │
│  OpenBridge learns:                                   │
│  → Creates "Quote" DocType (user needed it)           │
│  → Creates weekly expense report workflow             │
│  → Caches common client queries for faster response   │
│  → Skill: "generate_quote" learned from first 3 uses │
└──────────────────────────────────┬───────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────┐
│  MONTH 1: Proactive Intelligence                      │
│                                                       │
│  OpenBridge now understands the business well enough  │
│  to be proactive:                                    │
│                                                       │
│  "You have 3 invoices overdue totaling TND 4,500"    │
│  "Client Ahmed hasn't ordered in 45 days (avg: 14)"  │
│  "Your expenses are 23% higher than last month —     │
│   mainly office supplies"                             │
│  "You quoted 5 projects this month, won 2 (40%).     │
│   Your win rate is below your 60% average."           │
└──────────────────────────────────┬───────────────────┘
                                   │
┌──────────────────────────────────▼───────────────────┐
│  MONTH 3: Full Business Operating System              │
│                                                       │
│  DocTypes: Invoice, Quote, Customer, Expense,         │
│  Project, Task, Employee, Supplier, Product           │
│                                                       │
│  Integrations: Stripe, Google Drive, Gmail, Calendar  │
│                                                       │
│  Workflows: 12 active automations                     │
│                                                       │
│  Dashboard: Auto-generated business metrics page      │
│                                                       │
│  Skills learned: 15 business-specific procedures      │
│                                                       │
│  The AI has become a custom ERP — built from YOUR     │
│  actual data, YOUR actual workflows, YOUR language.   │
└──────────────────────────────────────────────────────┘
```

### The Hermes-Inspired Skill Learning System

When OpenBridge performs a complex task successfully, it saves it as a **reusable skill** (inspired by Hermes Agent):

```
Task completed: "Generate invoice for Mohamed, send via email + WhatsApp"

OpenBridge learns → creates skill:
{
  "name": "send_invoice",
  "description": "Generate PDF invoice, create Stripe payment link, send to client via email and WhatsApp",
  "steps": [
    "Extract client info from knowledge graph",
    "Calculate totals with tax",
    "Generate PDF via pdfmake",
    "Create Stripe payment link",
    "Send email with PDF attachment",
    "Send WhatsApp with payment link",
    "Update invoice status to 'sent'",
    "Create overdue reminder workflow"
  ],
  "successRate": 1.0,
  "usageCount": 1,
  "avgDuration": "12s",
  "version": 1
}

Next time: "Invoice Fatma for TND 300"
→ OpenBridge uses the learned "send_invoice" skill
→ Faster, more reliable, consistent format
→ Skill version incremented on improvements
```

---

## 21. Updated Implementation Roadmap

### Phase A: Document Intelligence (v0.1.0) — 4 weeks

_Read any file the business gives you_

| Task                        | Library                      | Already Exists?                    |
| --------------------------- | ---------------------------- | ---------------------------------- |
| PDF parser                  | pdf-parse + Tesseract.js     | No                                 |
| Excel/CSV parser            | SheetJS (xlsx)               | Skill pack only (no native parser) |
| Word (.docx) parser         | mammoth.js                   | Skill pack only                    |
| Image OCR + Vision          | AI multimodal + Tesseract.js | No                                 |
| Email parser                | mailparser                   | No                                 |
| File router (MIME → parser) | file-type                    | No                                 |
| Entity extractor (AI)       | Master AI worker             | Partially (exploration)            |
| WhatsApp file ingestion     | Enhanced connector           | Partially (media handling)         |

### Phase B: DocType System (v0.1.1) — 3 weeks

_Structured business knowledge, auto-created by AI_

| Task                     | Details                                   |
| ------------------------ | ----------------------------------------- |
| DocType schema + storage | SQLite tables for metadata + data         |
| Dynamic table creation   | CREATE TABLE from DocType definition      |
| State machine engine     | Transitions, hooks, role-based access     |
| Auto-CRUD API            | REST endpoints per DocType on file-server |
| Web form generator       | HTML forms from field definitions         |
| List view generator      | HTML table with search/filter/sort        |
| FTS5 indexing            | Searchable fields indexed automatically   |
| WhatsApp commands        | "List invoices", "Create customer"        |

### Phase C: Integration Hub (v0.1.2) — 4 weeks

_Connect to external systems_

| Task                     | Details                                               |
| ------------------------ | ----------------------------------------------------- |
| Integration interface    | Plugin contract                                       |
| Stripe adapter           | Payment links, invoices, webhooks                     |
| Google Drive adapter     | OAuth, list, upload, download, watch                  |
| Dropbox adapter          | OAuth, sync, webhooks                                 |
| Google Sheets adapter    | Read/write spreadsheet as data source                 |
| Email adapter (enhanced) | Gmail API or IMAP for reading + templates for sending |
| OpenAPI auto-adapter     | Load any Swagger spec → auto-generate capabilities    |
| Database adapter         | PostgreSQL, MySQL, MongoDB direct connection          |
| Webhook receiver         | POST /webhook/:integration on file-server             |
| Credential storage       | Encrypted token storage in SQLite                     |

### Phase D: Document Generation (v0.1.3) — 2 weeks

_Generate professional business documents_

| Task                | Details                                      |
| ------------------- | -------------------------------------------- |
| pdfmake integration | Declarative JSON → professional PDF          |
| Invoice template    | Configurable layout with business branding   |
| Quote template      | Similar to invoice with different lifecycle  |
| Receipt template    | Simplified invoice for payments received     |
| Report template     | Charts + tables + narrative                  |
| HTML invoice page   | Interactive with "Pay Now" button            |
| Email templates     | Professional HTML for invoice/quote delivery |

### Phase E: Workflow Engine (v0.1.4) — 3 weeks

_Automated triggers, schedules, and pipelines_

| Task                      | Details                                          |
| ------------------------- | ------------------------------------------------ |
| Workflow schema + storage | SQLite tables                                    |
| Schedule triggers         | node-cron based scheduler                        |
| Webhook triggers          | Route external events to workflows               |
| Data triggers             | DocType field change detection                   |
| Query steps               | Read from DocType tables                         |
| Send steps                | WhatsApp, email, webhook dispatch                |
| Approval steps            | Human-in-the-loop via messaging                  |
| AI steps                  | Spawn worker for AI analysis                     |
| Workflow management       | /workflows list, enable, disable, delete         |
| Natural language creation | "Remind me when invoices are overdue" → workflow |

### Phase F: Marketplace Integration (v0.1.5) — 3 weeks

_Your marketplace as the first showcase_

| Task                            | Details                                       |
| ------------------------------- | --------------------------------------------- |
| Marketplace adapter             | All 460+ endpoints mapped via OpenAPI         |
| Seller assistant                | Product, pricing, order, wallet capabilities  |
| Delivery assistant              | Assignment, tracking, settlement capabilities |
| NATS event bridge               | Real-time → WhatsApp notifications            |
| Role-based capability filtering | Seller sees seller endpoints only             |
| Seller onboarding flow          | WhatsApp-guided marketplace setup             |

### Phase G: Industry Templates (v0.1.6) — 2 weeks

_Instant business type detection + pre-built schemas_

| Task                 | Details                                           |
| -------------------- | ------------------------------------------------- |
| Template format spec | JSON spec for DocTypes + workflows + integrations |
| Restaurant template  | Menu, inventory, food cost, prep planning         |
| Car rental template  | Fleet, bookings, maintenance, contracts           |
| Retail template      | Products, inventory, suppliers, POS               |
| Services template    | Clients, projects, billing, scheduling            |
| Industry detector    | AI analyzes files → suggests template             |
| Template marketplace | Community-contributed templates                   |

### Phase H: Self-Improvement (v0.1.7) — 2 weeks

_Gets smarter with every interaction_

| Task                             | Details                                      |
| -------------------------------- | -------------------------------------------- |
| Skill learning (Hermes-inspired) | Auto-create procedures from successful tasks |
| Skill versioning                 | Track improvements over time                 |
| Proactive insights               | "Your costs are up 20% this month"           |
| Query caching                    | Pre-compute answers for common questions     |
| User preference modeling         | Communication style, detail level per user   |

---

## 22. Tech Stack Additions

| Capability     | Package          | Why This One                                       |
| -------------- | ---------------- | -------------------------------------------------- |
| PDF parsing    | `pdf-parse`      | Lightweight, pure Node, no external deps           |
| OCR            | `tesseract.js`   | Local OCR, no API needed, WASM-based               |
| Excel/CSV      | `xlsx` (SheetJS) | Industry standard, handles all Excel features      |
| Word docs      | `mammoth.js`     | Clean docx → HTML/text conversion                  |
| PDF generation | `pdfmake`        | Declarative JSON → PDF, perfect for AI agents      |
| PDF (complex)  | `puppeteer`      | Already optional dep in OpenBridge                 |
| Payments       | `stripe`         | Official SDK, TypeScript, full API                 |
| Google APIs    | `googleapis`     | Official, covers Drive + Sheets + Gmail + Calendar |
| Dropbox        | `dropbox`        | Official SDK                                       |
| Email (send)   | `nodemailer`     | Already in OpenBridge!                             |
| Email (parse)  | `mailparser`     | Standard MIME parser                               |
| Cron           | `node-cron`      | Lightweight scheduler                              |
| OpenAPI        | `swagger-parser` | Parse any Swagger/OpenAPI spec                     |
| Database       | `pg`, `mysql2`   | Direct DB connections                              |
| File type      | `file-type`      | MIME detection from buffers                        |
| QR codes       | `qrcode`         | Generate payment QR codes                          |

---

## 23. The Competitive Picture

```
┌─────────────────────────────────────────────────────────────────┐
│                     The Market Landscape                         │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Odoo    │  │ Salesforce│  │  n8n     │  │ ChatGPT  │        │
│  │          │  │          │  │          │  │          │        │
│  │ Full ERP │  │ Full CRM │  │ Workflow │  │ General  │        │
│  │ Complex  │  │ Expensive│  │ No AI    │  │ No biz   │        │
│  │ Modules  │  │ Per-seat │  │ Visual   │  │ context  │        │
│  │ Training │  │ Lock-in  │  │ nodes    │  │ No tools │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│                                                                  │
│                    ┌──────────────────┐                          │
│                    │   OpenBridge     │                          │
│                    │                  │                          │
│                    │ • AI-first       │                          │
│                    │ • Self-creating  │                          │
│                    │ • WhatsApp-native│                          │
│                    │ • Zero cost      │                          │
│                    │ • Zero training  │                          │
│                    │ • Open source    │                          │
│                    │ • Your data,     │                          │
│                    │   your machine   │                          │
│                    └──────────────────┘                          │
│                                                                  │
│  OpenBridge isn't competing with ERPs.                           │
│  It's making ERPs unnecessary for 80% of businesses.            │
└─────────────────────────────────────────────────────────────────┘
```

### The One-Liner

> **"OpenBridge is the AI that builds your ERP from your WhatsApp conversations."**
