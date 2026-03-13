# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 9 | **Fixed:** 4 (177 prior findings archived) | **Last Audit:** 2026-03-13
> **History:** 177 findings fixed across v0.0.1–v0.0.15. All prior archived in [archive/](archive/).

---

## Open Findings

### OB-F178 — Master AI lacks cloud storage skill pack (Google Drive, Dropbox, OneDrive, S3)

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/master/skill-packs/`, `src/master/skill-pack-loader.ts`, `src/master/master-system-prompt.ts`
- **Root Cause / Impact:**
  When a user asks "upload this to Google Drive" or "save this to Dropbox", the Master AI has no skill pack teaching it how to handle cloud storage requests. It either guesses or says it can't do it. Users expect the AI to know how to use available MCP servers or CLI tools (rclone, gdrive, aws s3) for file uploads and share link generation.
- **Fix:** Create a `cloud-storage` built-in skill pack that teaches Master AI to:
  1. Check for cloud storage MCP servers in the available MCP catalog (google-drive, dropbox, onedrive)
  2. Fall back to CLI tools (rclone, gdrive CLI, aws s3, dropbox-cli) via `full-access` workers
  3. Upload files from `.openbridge/generated/` and return shareable links
  4. Add `google-drive` and `dropbox` entries to `mcp-catalog.ts`
  5. Optionally add `[SHARE:gdrive]` / `[SHARE:dropbox]` marker channels to `output-marker-processor.ts`

### OB-F179 — Master AI lacks web deployment skill pack (Vercel, Netlify, Cloudflare Pages)

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/master/skill-packs/`, `src/master/master-system-prompt.ts`, `src/core/github-publisher.ts`
- **Root Cause / Impact:**
  When a user asks "build a website and deploy it" or "put this live on Vercel", the Master AI has no skill pack for real server deployment. GitHub Pages publishing exists but is limited to static HTML. Users expect the AI to deploy to modern platforms (Vercel, Netlify, Cloudflare Pages) and return a live URL.
- **Fix:** Create a `web-deploy` built-in skill pack that teaches Master AI to:
  1. Use `npx vercel --yes`, `npx netlify deploy --prod`, or `npx wrangler pages deploy` via `full-access` workers
  2. Detect which deploy CLIs are available on the machine (extend AI Discovery or check in worker prompt)
  3. Return the live URL to the user in the response
  4. Handle auth tokens via environment variables (VERCEL_TOKEN, NETLIFY_AUTH_TOKEN, etc.)
  5. Support both static sites and framework apps (Next.js, Vite, etc.)

### OB-F180 — Master AI lacks spreadsheet read/write skill pack (Excel, CSV, Google Sheets)

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/master/skill-packs/spreadsheet-builder.ts`, `src/master/skill-pack-loader.ts`
- **Root Cause / Impact:**
  The existing `spreadsheet-builder` skill only generates new XLSX files. When a user asks "read this Excel file and summarize the data" or "update column B in my spreadsheet", the Master AI cannot read existing spreadsheet contents or modify cells in-place. This is a common business user request, especially for non-code workspaces.
- **Fix:** Create a `spreadsheet-handler` built-in skill pack (or extend `spreadsheet-builder`) that teaches Master AI to:
  1. Read existing `.xlsx`, `.xls`, `.csv` files using Node.js packages (`exceljs` or `xlsx`/SheetJS) or Python (`openpyxl`, `pandas`) via `full-access` workers
  2. Extract cell data, sheet names, formulas, and formatting
  3. Modify existing cells, add rows/columns, apply formulas
  4. Write back to the same file or create a new output file
  5. Handle Google Sheets via MCP server if configured
  6. Support common operations: filter, sort, pivot, aggregate, chart data extraction

### OB-F181 — Master AI lacks file conversion skill pack (PDF↔text, DOCX↔PDF, format transforms)

- **Severity:** 🟢 Low
- **Status:** ✅ Fixed
- **Key Files:** `src/master/skill-packs/`, `src/core/html-renderer.ts`
- **Root Cause / Impact:**
  When a user asks "convert this PDF to text" or "turn this Markdown into a DOCX", the Master AI has no skill pack for file format conversion. The HTML renderer handles SVG→PNG, but general-purpose format conversion is not covered. Users working with business documents frequently need format transforms.
- **Fix:** Create a `file-converter` built-in skill pack that teaches Master AI to:
  1. Use `pandoc` (if installed) for document format conversions (MD→DOCX, DOCX→PDF, HTML→PDF, etc.)
  2. Use `libreoffice --headless` for office document conversions
  3. Use Node.js packages (`pdf-parse`, `mammoth`, `docx`) via workers for programmatic conversion
  4. Extract text from PDFs, images (OCR via `tesseract` if available)
  5. Detect available conversion tools on the machine and choose the best one

### OB-F182 — Workers cannot execute destructive file operations (rm, rmdir) — permission prompts unreachable

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/core/agent-runner.ts`, `src/master/worker-orchestrator.ts`
- **Root Cause / Impact:**
  When a user asks Master AI to delete files or directories (e.g., `rm -rf` a folder), the Master spawns a worker with a tool profile (`code-edit` or `full-access`). Two problems prevent this from working:
  1. **`code-edit` profile lacks `rm`**: The `TOOLS_CODE_EDIT` list only includes `Bash(git:*)`, `Bash(npm:*)`, `Bash(npx:*)` — no `Bash(rm:*)` or `Bash(mv:*)`. The worker's Claude CLI process is restricted and cannot run `rm`.
  2. **`stdin: 'ignore'` blocks permission prompts**: Even with `full-access` profile (`Bash(*)`), if Claude CLI encounters a tool not pre-approved by `--allowedTools`, it prompts for interactive permission on stdin. Since workers run with `stdio: ['ignore', 'pipe', 'pipe']` (line 724), the permission prompt never reaches the messaging user. The worker either hangs until timeout or silently fails.
     The net effect is that destructive file operations requested through any messaging channel (WebChat, WhatsApp, Telegram, Discord) silently fail — the worker tells the user it needs permission, but there's no mechanism to relay that prompt back through the channel.
- **Fix:** Several options (pick one or combine):
  1. **Add `Bash(rm:*)` and `Bash(mv:*)` to `TOOLS_CODE_EDIT`** — simplest, but broadens the attack surface for code-edit workers
  2. **Create a `file-management` tool profile** that includes `Bash(rm:*)`, `Bash(mv:*)`, `Bash(cp:*)`, `Bash(mkdir:*)` and have Master select it for file operations
  3. **Implement permission relay**: When a worker's stdout contains a Claude CLI permission prompt pattern, intercept it in AgentRunner, relay the question back to the user through the messaging channel, wait for their response, and pipe it to the worker's stdin (requires changing `stdin` from `'ignore'` to `'pipe'`)
  4. **Auto-approve within workspace**: For operations scoped to the configured `workspacePath`, pre-approve destructive tools so no interactive prompt is needed

### OB-F183 — Interactive tool approval relay via Agent SDK (permission prompts through messaging channels)

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/core/agent-runner.ts`, `src/core/cli-adapter.ts`, `src/core/adapter-registry.ts`, `src/core/adapters/`, `src/core/router.ts`, `src/connectors/webchat/`
- **Root Cause / Impact:**
  OpenBridge spawns workers as CLI subprocesses (`claude -p`) with `stdin: 'ignore'`. When Claude CLI needs user permission for a tool call (e.g., `rm -rf`, writing to a sensitive file), the interactive prompt goes nowhere — the user never sees it. This blocks all interactive tool approval workflows through messaging channels (WebChat, WhatsApp, Telegram, Discord). Users expect the same approve/deny UX they get in VS Code's terminal, but delivered through their messaging channel.

  The CLI's `--output-format stream-json` does NOT expose permission events in its streaming protocol, so intercepting stdout is not viable. However, the **Claude Agent SDK** provides a `canUseTool` callback that gives full programmatic control over every tool approval decision — this is the correct integration point.

- **Fix:** Migrate from CLI subprocess spawning to Agent SDK for workers that need interactive approval. Three components:

  **1. New SDK Adapter (`src/core/adapters/claude-sdk.ts`)**
  Create an Agent SDK-based adapter alongside the existing CLI adapter. Uses `query()` from `@anthropic-ai/claude-agent-sdk` instead of `child_process.spawn('claude', ...)`. The `canUseTool` callback replaces `--allowedTools` with fine-grained per-tool-call control:

  ```typescript
  canUseTool: async (toolName: string, input: Record<string, any>) => {
    // Relay to messaging channel, await user response
    const approved = await relayPermissionToUser({
      toolName, // "Bash", "Write", "Edit", etc.
      input, // { command: "rm -rf ...", description: "..." }
      userId,
      channel, // "webchat" | "whatsapp" | "telegram"
    });
    return approved
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'User denied via messaging channel' };
  };
  ```

  **2. Permission relay protocol**
  When `canUseTool` fires:
  - Format a user-friendly message: _"The AI wants to run `rm -rf ./cafe-reservations/`. Allow? Reply YES or NO"_
  - Send through the connector (WebChat shows approve/deny buttons, WhatsApp/Telegram get text prompts)
  - `await` the user's response (with configurable timeout, default 60s)
  - Return `{ behavior: "allow" }` or `{ behavior: "deny" }` to the SDK
  - Auto-deny on timeout with message to user

  **3. WebChat UI permission component**
  Add a permission prompt widget to the WebChat UI (already has WebSocket infrastructure):
  - Show tool name, command/file path, and description
  - "Allow" / "Deny" buttons (styled like VS Code's permission popup)
  - Auto-deny countdown timer (60s)
  - For WhatsApp/Telegram: text-based prompt with YES/NO reply detection

  **Migration path (non-breaking):**
  - Register the SDK adapter as a second adapter in `adapter-registry.ts`
  - Use SDK adapter when user trust level is `ask` (interactive approval via `/trust ask`)
  - Fall back to CLI adapter with pre-approved `--allowedTools` when trust is `auto` (`/trust auto`)
  - Master AI continues to work unchanged — adapter selection is transparent

  **Wire the existing `/trust` levels:**
  | `/trust` level | Adapter | Behavior |
  |---|---|---|
  | `ask` (default) | SDK adapter | Every tool call relayed for approval |
  | `edit` | SDK adapter | Auto-approve reads/edits, prompt for Bash/Write |
  | `auto` | CLI adapter | Pre-approved `--allowedTools`, no prompts |

  **Dependencies:** `@anthropic-ai/claude-agent-sdk` npm package

### OB-F184 — No document intelligence layer — OpenBridge cannot read business files (PDF, Excel, DOCX, images)

- **Severity:** 🔴 Critical
- **Status:** ✅ Fixed
- **Key Files:** `src/connectors/whatsapp/`, `src/connectors/telegram/`, `src/master/classification-engine.ts`
- **Root Cause / Impact:**
  When a business user sends a PDF invoice, Excel spreadsheet, or scanned receipt via WhatsApp/Telegram, OpenBridge has no processing pipeline to extract structured data from these files. Connectors receive the file as an attachment but the Master AI can only see the filename — it cannot read the contents. This is the #1 blocker for business adoption: every business runs on documents, and an AI bridge that cannot read them is unusable for non-developer users.
- **Fix:** Create `src/intelligence/` module with:
  1. MIME-type detection router (`document-processor.ts`) using `file-type` npm package
  2. Per-format processors: PDF (`pdf-parse` + `tesseract.js` OCR), Excel (`xlsx`/SheetJS), CSV, Word (`mammoth`), Image (AI vision + OCR), Email (`mailparser`), JSON/XML
  3. AI-powered entity extraction via worker (`entity-extractor.ts`) — extracts people, amounts, dates, products from raw text
  4. Document storage in SQLite (`document-store.ts`) with FTS5 indexing
  5. Wire into WhatsApp/Telegram file reception handlers

### OB-F185 — No DocType engine — OpenBridge cannot create or manage structured business data

- **Severity:** 🔴 Critical
- **Status:** Open
- **Key Files:** `src/memory/database.ts`, `src/master/master-system-prompt.ts`, `src/master/classification-engine.ts`
- **Root Cause / Impact:**
  When a user says "I need to track my invoices" or "create a customer record", OpenBridge has no mechanism to create structured business entities. There is no dynamic schema system, no auto-numbering, no state machine for document lifecycle (draft → sent → paid), no computed fields, and no auto-generated REST API or web forms. Users must manually build database schemas or use external tools. ERPs like Frappe solve this with DocTypes — ONE definition creates a table, API, form, PDF template, and state machine automatically.
- **Fix:** Create a DocType engine (`src/intelligence/`) inspired by Frappe DocType + Twenty CRM + Odoo:
  1. Metadata tables: `doctypes`, `doctype_fields`, `doctype_states`, `doctype_transitions`, `doctype_hooks`, `doctype_relations`, `dt_series`
  2. Dynamic `CREATE TABLE` from metadata (`table-builder.ts`)
  3. Auto-numbering via `dt_series` (Frappe `naming_series` pattern)
  4. State machine engine with role-based transition validation
  5. Lifecycle hook executor (generate_number, generate_pdf, send_notification, create_payment_link)
  6. SQLite `GENERATED` columns for computed fields + cross-table triggers (Odoo `@api.depends`)
  7. REST API auto-generation on file-server
  8. HTML form/list view auto-generation

### OB-F186 — No integration hub — OpenBridge cannot connect to external business services (Stripe, Google Drive, databases)

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/core/file-server.ts`, `src/core/email-sender.ts`, `src/master/master-system-prompt.ts`
- **Root Cause / Impact:**
  Business users need to connect Stripe for payments, Google Drive for file storage, their own databases, and arbitrary REST APIs. OpenBridge has MCP server support for Claude workers but no native integration framework for business services. MCP is AI-tool-specific; business integrations need a higher-level abstraction with credential management, webhook handling, and capability discovery that the Master AI can reason about. Without this, users cannot "connect Stripe" or "sync with my backend" via conversation.
- **Fix:** Create `src/integrations/` module with:
  1. `BusinessIntegration` interface (initialize, healthCheck, describeCapabilities, query, execute)
  2. `IntegrationHub` registry + lifecycle manager
  3. `credential-store.ts` — AES-256-GCM encrypt-at-rest (n8n pattern), decrypt-on-demand
  4. `webhook-router.ts` — incoming webhook dispatcher on file-server
  5. Adapters: Stripe (payments + webhooks), Google Drive (OAuth + files), Google Sheets, Dropbox, Email (SMTP + IMAP), PostgreSQL/MySQL, OpenAPI auto-adapter (any Swagger spec → capabilities)
  6. Inject integration capabilities into Master AI system prompt

### OB-F187 — No workflow engine — OpenBridge cannot automate recurring business processes

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/core/router.ts`, `src/master/master-manager.ts`
- **Root Cause / Impact:**
  Business processes like "send overdue invoice reminders every morning", "alert me when stock is low", or "generate a weekly sales report" require automated triggers and multi-step pipelines. OpenBridge has no scheduling, no event-driven triggers, and no workflow execution engine. Users must manually ask for each action every time. ERPs like Odoo (`base.automation`), Salesforce (Flows), and n8n (workflow nodes) solve this with workflow engines that run automatically based on time, data changes, or external events.
- **Fix:** Create `src/workflows/` module with:
  1. Workflow schema in SQLite (`workflows`, `workflow_runs`, `workflow_approvals` tables)
  2. `WorkflowEngine` — load, execute, manage workflows
  3. Triggers: schedule (node-cron), webhook, data change (DocType field), message (/command)
  4. Steps: query, transform, condition (if/else), send (WhatsApp/email), integration (external API), approval (human-in-the-loop), AI (spawn worker), generate (PDF/HTML)
  5. n8n-style data flow between steps: `{ json: data, files?: paths }`
  6. Natural language → workflow creation via Master AI

### OB-F188 — No business document generation — OpenBridge cannot produce professional PDFs (invoices, quotes, receipts)

- **Severity:** 🟡 Medium
- **Status:** ✅ Fixed
- **Key Files:** `src/core/html-renderer.ts`, `src/master/skill-packs/`
- **Root Cause / Impact:**
  The existing `document-writer` skill pack can generate DOCX files, but there is no dedicated pipeline for producing professional business PDFs (invoices with line items, QR codes, payment links, branding). The HTML renderer uses Puppeteer for screenshots but not for templated business document generation. Business users who say "generate an invoice for Mohamed" expect a branded PDF with auto-numbering, tax calculations, and a payment link — not a generic DOCX.
- **Fix:** Create a document generation pipeline:
  1. `pdfmake` integration (`intelligence/pdf-generator.ts`) — declarative JSON → PDF, no Chromium needed
  2. Business document templates: invoice, quote, receipt, report (with charts/tables)
  3. QR code generation for payment links (`qrcode` npm package)
  4. Business branding injection (logo, colors from `.openbridge/context/`)
  5. HTML email templates for document delivery
  6. Wire into DocType lifecycle hooks (generate_pdf on state transition)

### OB-F189 — No credential security — API keys and OAuth tokens stored in plaintext or not at all

- **Severity:** 🟠 High
- **Status:** Open
- **Key Files:** `src/core/config.ts`, `src/types/config.ts`
- **Root Cause / Impact:**
  When a user wants to "connect Stripe" or "link Google Drive", they need to provide API keys or complete OAuth flows. Currently there is no secure storage for these credentials. Config.json stores MCP server env vars in plaintext, and there is no encryption layer. If a user sends their Stripe API key via WhatsApp, it would be stored in conversation history in plaintext. n8n solves this with AES-256-GCM encrypt-at-rest — credentials are encrypted in the database and only decrypted momentarily during execution, never logged or passed to AI workers.
- **Fix:** Create `src/integrations/credential-store.ts`:
  1. Generate encryption key on first use, store in `.openbridge/secrets.key` (gitignored, chmod 600)
  2. Encrypt credentials with `crypto.createCipheriv('aes-256-gcm', key, iv)`
  3. Store encrypted blob + IV + auth tag in SQLite `integration_credentials` table
  4. Decrypt only on demand, keep decrypted data in memory only during execution
  5. NEVER log credentials, NEVER pass to AI worker prompts
  6. Warn user to delete messages containing API keys

### OB-F190 — No universal API adapter — users cannot connect arbitrary REST APIs without writing code

- **Severity:** 🟡 Medium
- **Status:** Open
- **Key Files:** `src/integrations/adapters/openapi-adapter.ts`, `src/core/command-handlers.ts`
- **Root Cause / Impact:**
  While OB-F186 covers the integration hub framework and the OpenAPI auto-adapter, there is no support for other common API description formats: Postman collections, cURL commands, plain API documentation (PDF/Markdown). Most business users don't have a Swagger spec — they have a Postman export, a list of cURL examples from their developer, or PDF API docs. Without multi-format parsing, users hit a wall at "connect my API" unless they happen to have OpenAPI/Swagger. Additionally, there is no auto-generation of skill packs from API specs — each connected API needs manual skill pack creation.
- **Fix:** Create a universal API adapter pipeline:
  1. Multi-format input detection: Swagger/OpenAPI, Postman Collection v2.1, cURL commands, plain documentation (PDF/text/URL)
  2. `postman-parser.ts` — convert Postman collections to OpenAPI spec
  3. `curl-parser.ts` — parse cURL commands into OpenAPI spec
  4. `doc-parser.ts` — AI-powered endpoint extraction from any documentation format
  5. `skill-pack-generator.ts` — AI auto-generates skill packs from parsed API specs
  6. Role-based capability tagging (user tags endpoints by role via conversation)
  7. Generic event bridge (WebSocket, SSE, polling, webhook) for real-time notifications
  8. Auto-suggested workflows based on API shape (POST → notifications, GET → reports)

---

## How to Add a Finding

```markdown
### OB-F### — Description here

- **Severity:** 🔴/🟠/🟡/🟢
- **Status:** Open
- **Key Files:** `file.ts`
- **Root Cause / Impact:**
  Why it matters.
- **Fix:** How to fix it.
```

Severity levels: 🔴 Critical | 🟠 High | 🟡 Medium | 🟢 Low

---

## Archive

177 findings fixed across v0.0.1–v0.0.15:
[V0](archive/v0/FINDINGS-v0.md) | [V2](archive/v2/FINDINGS-v2.md) | [V4](archive/v4/FINDINGS-v4.md) | [V5](archive/v5/FINDINGS-v5.md) | [V6](archive/v6/FINDINGS-v6.md) | [V7](archive/v7/FINDINGS-v7.md) | [V8](archive/v8/FINDINGS-v8.md) | [V15](archive/v15/FINDINGS-v15.md) | [V16](archive/v16/FINDINGS-v16.md) | [V17](archive/v17/FINDINGS-v17.md) | [V18](archive/v18/FINDINGS-v18.md) | [V19](archive/v19/FINDINGS-v19.md) | [V21](archive/v21/FINDINGS-v21.md) | [V24](archive/v24/FINDINGS-v24.md)

---
