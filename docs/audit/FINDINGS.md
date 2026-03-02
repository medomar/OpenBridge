# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 16 | **Fixed:** 84 | **Last Audit:** 2026-03-02
> **Current focus:** Making OpenBridge effective for finishing the Marketplace projects (frontend, dashboard, backend).
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md) | [V8 archive](archive/v8/FINDINGS-v8.md) | [V15 archive](archive/v15/FINDINGS-v15.md) | [V16 archive](archive/v16/FINDINGS-v16.md) | [V17 archive](archive/v17/FINDINGS-v17.md) | [V18 archive](archive/v18/FINDINGS-v18.md) | [V19 archive](archive/v19/FINDINGS-v19.md) | [V20 archive](archive/v20/TASKS-v20-v009-v011-phases-74-86-deep1.md)

---

## Priority Order

Ordered by impact on the **Marketplace development workflow** — the immediate goal is using OpenBridge to finish the Marketplace frontend, dashboard, and backend services.

### Tier 1 — Must-Fix for Marketplace Development

| #      | Finding                                                  | Severity    | Marketplace Impact                                                                     | Status   |
| ------ | -------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- | -------- |
| OB-F57 | Workers cannot run tests or do deep code analysis        | 🟠 High     | Can't verify Marketplace code — no test/lint/typecheck in workers                      | ✅ Fixed |
| OB-F58 | `explore()` failure is unrecoverable                     | 🟠 High     | Exploration failure on any Marketplace project = Master stuck, must restart            | ✅ Fixed |
| OB-F59 | `parseAIResult()` has no runtime Zod validation          | 🟠 High     | Corrupt exploration data = Master misunderstands Marketplace codebase                  | ✅ Fixed |
| OB-F67 | Secondary workspace .openbridge is corrupted             | 🔴 Critical | Must clean before targeting Marketplace workspace paths                                | ✅ Fixed |
| OB-F66 | .openbridge data stale from early development            | 🟡 Medium   | Stale memory.md + workspace map misleads Master about project state                    | ✅ Fixed |
| OB-F70 | Environment variables leak sensitive secrets to workers  | 🔴 Critical | Marketplace backend has DB_URL, API keys, SMTP creds — all exposed to workers          | ✅ Fixed |
| OB-F76 | Keyword classifier misses execution/delegation keywords  | 🟠 High     | "start execution" classified as tool-use (15 turns) instead of complex-task (25 turns) | ✅ Fixed |
| OB-F77 | SPAWN marker stripping leaves empty/stub response        | 🟠 High     | Master output with SPAWN markers stripped to 29 chars — user gets no useful response   | ✅ Fixed |
| OB-F78 | No warning when response truncated after SPAWN stripping | 🟡 Medium   | Log shows `responseLength: 29` but no flag that original was 500+ chars pre-strip      | ✅ Fixed |

### Tier 2 — Important for Development Workflow (Sprints 1–3)

| #      | Finding                                                     | Severity  | Development Impact                                                      | Status   |
| ------ | ----------------------------------------------------------- | --------- | ----------------------------------------------------------------------- | -------- |
| OB-F68 | Master AI doesn't know how to share generated files         | 🟠 High   | Can't receive test reports, code analysis results, or generated outputs | ✅ Fixed |
| OB-F71 | No user consent before risky/expensive worker operations    | 🟠 High   | Marketplace is production code — need confirmation before file edits    | ✅ Fixed |
| OB-F60 | Phase 3 directory dive retry logic is broken                | 🟠 High   | Marketplace has many directories — failed dives = knowledge gaps        | ✅ Fixed |
| OB-F62 | `reExplore()` doesn't write analysis marker or update cache | 🟡 Medium | Re-exploration loops waste time when switching between projects         | ✅ Fixed |
| OB-F63 | Prompt rollback stores new content as previousVersion       | 🟡 Medium | Bad prompts for Marketplace tasks can't be reverted                     | ✅ Fixed |
| OB-F61 | Progress calculation gives negative percentages             | 🟡 Medium | Confusing progress display during Marketplace exploration               | ✅ Fixed |

### Tier 2b — Platform Completion (Sprint 4 — v0.0.12)

| #      | Finding                                   | Severity    | Sprint 4 Impact                                                           | Status                                               |
| ------ | ----------------------------------------- | ----------- | ------------------------------------------------------------------------- | ---------------------------------------------------- |
| OB-F56 | No multi-phase "deep mode"                | 🟡 Medium   | Enables thorough analysis: investigate → report → plan → execute → verify | Partial (Core + 5 commands done, 20 tasks remaining) |
| OB-F69 | No delivery path for interactive web apps | 🟠 High     | Tunnel + ephemeral app serving makes outputs accessible from anywhere     | Open                                                 |
| OB-F72 | No document visibility controls           | 🟡 Medium   | Completes security boundary — controls what AI can see in workspace       | Open                                                 |
| OB-F73 | WebChat has no authentication             | 🔴 Critical | Required for exposing WebChat beyond localhost (LAN, tunnel, PWA)         | Open                                                 |
| OB-F74 | WebChat UI is inlined HTML string         | 🟠 High     | Blocks all WebChat improvements — must extract before modernization       | Open                                                 |
| OB-F75 | WebChat not accessible from phone         | 🟠 High     | Phone access via LAN/tunnel + PWA makes WebChat a primary interface       | Open                                                 |

### Tier 2c — Community-Inspired Improvements (v0.0.13)

Improvements identified by analyzing [openclaw/openclaw](https://github.com/openclaw/openclaw) (242K stars) and [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) (32K stars).

| #      | Finding                                                           | Severity  | Improvement Impact                                                                | Inspired By | Status |
| ------ | ----------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- | ----------- | ------ |
| OB-F79 | Memory has no vector search — FTS5 only                           | 🟠 High   | RAG returns keyword matches only, misses semantically similar content             | openclaw    | Open   |
| OB-F80 | No structured observations from worker outputs                    | 🟠 High   | Worker results are free-form text — no typed facts, concepts, or files_touched    | claude-mem  | Open   |
| OB-F81 | Memory retrieval returns full results — no progressive disclosure | 🟡 Medium | Every search loads full content, wastes tokens; no index → filter → detail flow   | claude-mem  | Open   |
| OB-F82 | No content-hash deduplication for workspace chunks                | 🟡 Medium | Duplicate chunks stored during overlapping worker reads and re-exploration        | claude-mem  | Open   |
| OB-F83 | No token economics tracking for exploration ROI                   | 🟡 Medium | Can't measure if exploration cost is worth the retrieval savings                  | claude-mem  | Open   |
| OB-F84 | Master context window has no auto-compaction                      | 🟠 High   | Long Master sessions hit context limits; memory.md is manual, not auto-compacted  | openclaw    | Open   |
| OB-F85 | No self-diagnostic command (`openbridge doctor`)                  | 🟡 Medium | No way to validate config, check AI tools, verify SQLite, test channel health     | openclaw    | Open   |
| OB-F86 | No pairing-based auth for non-phone channels                      | 🟡 Medium | Discord/Telegram users need manual whitelist; no self-service pairing flow        | openclaw    | Open   |
| OB-F87 | No skills directory for reusable capabilities                     | 🟡 Medium | Master rediscovers capabilities each session; no SKILL.md pattern for persistence | openclaw    | Open   |
| OB-F88 | Worker results lack structured summary format                     | 🟡 Medium | No `completed/learned/next_steps` — Master can't track incomplete work            | claude-mem  | Open   |

### Tier 3 — Deferred (not blocking current work)

| #      | Finding                                           | Severity | Notes                                                  | Status   |
| ------ | ------------------------------------------------- | -------- | ------------------------------------------------------ | -------- |
| OB-F64 | `filesScanned` always 0 in exploration summary    | 🟢 Low   | Cosmetic — doesn't affect functionality                | ✅ Fixed |
| OB-F65 | Exploration prompts have no media/asset awareness | 🟢 Low   | Marketplace projects are code-focused, not media-heavy | ✅ Fixed |

### Recently Fixed

| #      | Finding                                                     | Severity    | Impact                                                                                   | Status    |
| ------ | ----------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- | --------- |
| OB-F54 | Complex tasks use same 180s timeout as quick answers        | 🟠 High     | Complex tasks (25 turns) get 7.2s/turn, timeout every time, retry 4x → DLQ               | **Fixed** |
| OB-F55 | Classification escalation over-triggers quick-answer        | 🟡 Medium   | Global success rate escalates every quick-answer to tool-use, wasting budget             | **Fixed** |
| OB-F77 | SPAWN marker stripping leaves empty/stub response           | 🟠 High     | Status message now generated when cleanedOutput < 80 and SPAWN markers found             | **Fixed** |
| OB-F78 | No warning when response truncated after SPAWN stripping    | 🟡 Medium   | debug + warn logs added after SPAWN stripping in both streaming and non-streaming paths  | **Fixed** |
| OB-F61 | Progress calculation gives negative percentages             | 🟡 Medium   | Removed erroneous subtraction — diveProgressPercent \* weight now produces 0%–50% range  | **Fixed** |
| OB-F62 | `reExplore()` doesn't write analysis marker or update cache | 🟡 Medium   | Added `writeAnalysisMarkerToStore()` + `workspaceMapSummary` update after re-exploration | **Fixed** |
| OB-F63 | Prompt rollback stores new content as previousVersion       | 🟡 Medium   | Read old file content before write; store as `previousVersion` — rollback now functional | **Fixed** |
| OB-F57 | Workers cannot run tests or do deep code analysis           | 🟠 High     | Added `code-audit` profile with npm:test, lint, typecheck tool access                    | **Fixed** |
| OB-F58 | `explore()` failure is unrecoverable                        | 🟠 High     | Added `recover()` method to reset state from error to idle + retry exploration           | **Fixed** |
| OB-F59 | `parseAIResult()` has no runtime Zod validation             | 🟠 High     | Added optional `schema` parameter — callers now pass Zod schemas for validation          | **Fixed** |
| OB-F60 | Phase 3 directory dive retry logic is broken                | 🟠 High     | Moved pendingDives computation inside batch loop — failed dives now retried              | **Fixed** |
| OB-F64 | `filesScanned` always 0 in exploration summary              | 🟢 Low      | Propagated totalFiles from structure scan to buildSummary()                              | **Fixed** |
| OB-F65 | Exploration prompts have no media/asset awareness           | 🟢 Low      | Added media/asset categories to all 4 exploration prompts                                | **Fixed** |
| OB-F66 | .openbridge data stale from early development               | 🟡 Medium   | Cleanup script + fresh exploration on primary workspace                                  | **Fixed** |
| OB-F67 | Secondary workspace .openbridge is corrupted                | 🔴 Critical | Deleted corrupted .openbridge/ folder — will regenerate on next use                      | **Fixed** |
| OB-F68 | Master AI doesn't know how to share generated files         | 🟠 High     | SHARE marker docs, connector injection, output routing added to system prompt            | **Fixed** |
| OB-F70 | Environment variables leak sensitive secrets to workers     | 🔴 Critical | ENV_DENY_PATTERNS + sanitizeEnv() wired into all 3 adapters + startup scan               | **Fixed** |
| OB-F71 | No user consent before risky/expensive worker operations    | 🟠 High     | Risk classification, confirmation flow, /confirm, /skip, /audit, cost estimation         | **Fixed** |
| OB-F76 | Keyword classifier misses execution/delegation keywords     | 🟠 High     | Added 9 keywords + regex patterns for delegation phrases                                 | **Fixed** |

---

## Open Findings

### OB-F56 — No multi-phase "deep mode" for complex analysis tasks (Medium)

**Problem:** OpenBridge currently processes all tasks in a single pass: classify → execute → respond. For complex analysis tasks (codebase audits, refactoring plans, security reviews), this produces shallow results compared to a multi-phase approach: investigate → report findings → plan tasks → execute → verify.

Non-developer business users have no way to access the deeper workflow that developers use when working directly with Claude Code (investigate, document findings, brainstorm, create task list, execute, verify).

**Impact:** Users who need thorough analysis get single-pass answers. The system can't pause for user steering between phases ("focus on finding #2", "skip task 3", "use opus for this one").

**Proposed solution — "Deep Mode" execution profiles:**

1. **Execution profiles** — user-configurable per message or per user:
   - `fast`: Current flow (classify → execute → done)
   - `thorough`: Multi-phase (investigate → report → plan → execute → verify)
   - `manual`: Like thorough but pauses at every phase for user approval

2. **Per-phase model selection** — users configure which model tier to use per phase:
   - Investigation: powerful (deep reasoning)
   - Planning: powerful (architecture decisions)
   - Execution: balanced (code writing)
   - Verification: fast (quick checks)

3. **Interactive phase navigation** — users can steer via chat commands:
   - "proceed" / "go" — advance to next phase
   - "focus N" — dig deeper into finding N
   - "skip N" — skip task N
   - "use opus for task 1" — override model for a specific task

4. **Phase state machine** — tracks current phase, allows back/skip/focus navigation

**Scope:** Major feature (v0.6.0+), estimated 30–40 tasks across 3–4 phases.

**Key components needed:**

- Deep mode classifier (detect when task needs multi-phase)
- Phase state machine in `master-manager.ts`
- Interactive commands in `router.ts`
- Phase-aware system prompts per worker role
- User preferences store in SQLite (model prefs, depth settings)
- Progress reporting per phase (extends existing progress events)

**See also:** [ROADMAP.md — Deep Mode](../ROADMAP.md)

---

> **Status:** Partially fixed — core state machine, phase transitions, and 5 interactive commands (/deep, /proceed, /focus, /skip, /phase) are implemented. Remaining: 20 tasks (phase-aware worker prompts, parallel execution, result aggregation, session history, user preferences).

---

### OB-F69 — No delivery path for interactive web apps (High)

**Problem:** When a user asks "create me an interactive website with a database," OpenBridge has no way to:

1. **Serve the app** — file-server only serves static files from `.openbridge/generated/`, no dynamic backend
2. **Expose it to the user's phone** — file-server runs on localhost:3001, unreachable from mobile
3. **Handle user interactions** — no mechanism to receive form submissions, clicks, or data back from the served app
4. **Manage the app lifecycle** — no way to start/stop/monitor ephemeral apps

This is a fundamental capability gap: OpenBridge can generate code but cannot deploy it in a way the user can actually interact with.

**Impact:** Users who want interactive outputs (dashboards, forms, databases, tools) get dead files instead of live apps. Limits OpenBridge to text-only and static-file responses.

**Proposed solution — phased approach:**

**Phase A: Tunnel Integration (~8–10 tasks)**

- Integrate `cloudflared tunnel` or `localtunnel` for exposing local servers
- Auto-detect installed tunnel tools (extend `tool-scanner.ts`)
- New `TunnelManager` in `src/core/tunnel-manager.ts`:
  - `startTunnel(port)` → returns public URL
  - `stopTunnel()`
  - Auto-cleanup on process exit
- Master sends public URL to user via `[SHARE:channel]` or inline message
- File-server gets a public URL → Master can share generated HTML via link

**Phase B: Ephemeral App Server (~10–12 tasks)**

- New `AppServer` in `src/core/app-server.ts`:
  - Worker generates app (HTML + JS + SQLite/JSON backend)
  - Worker writes app to `.openbridge/generated/apps/{app-id}/`
  - AppServer auto-detects `package.json` or `index.html` and starts it
  - Lifecycle: start → monitor → idle timeout → stop
  - Tunnel exposes it → URL sent to user
- Master system prompt updated with `[APP:start]/path/to/app[/APP]` marker
- Router parses `[APP:*]` markers and manages lifecycle

**Phase C: Interaction Relay (~8–10 tasks)**

- WebSocket bridge between served app and OpenBridge
- App includes a client-side SDK (`openbridge-client.js`) injected by AppServer
- User interactions (form submit, button click) relayed back to Master
- Master can respond to interactions (update data, generate new content)
- Enables conversational web apps: user fills form → Master processes → updates page

**Phase D: Smart Output Router (~5–8 tasks)**

- Master auto-classifies output type:
  - Text → direct message
  - Static file → `[SHARE:channel]` attachment
  - Static page → file-server + tunnel → URL
  - Interactive app → ephemeral server + tunnel → URL + lifecycle
- No user intervention needed — Master picks best delivery autonomously

**Key files to create:** `src/core/tunnel-manager.ts`, `src/core/app-server.ts`, `src/core/interaction-relay.ts`
**Key files to modify:** `src/master/master-system-prompt.ts`, `src/core/router.ts`, `src/discovery/tool-scanner.ts`

**Dependencies:** OB-F68 (Master must first learn `[SHARE:*]` markers)

**Scope:** Major feature — ~30–40 tasks across 3–4 phases. Aligns with backlog item OB-124 (Interactive AI views).

---

---

### OB-F72 — No document visibility controls — AI can read entire workspace (Medium)

**Problem:** When OpenBridge targets a workspace, the Master AI and all workers can read every file in that directory tree. There are no controls for:

- Which files/directories are visible to the AI
- Which files are explicitly hidden (secrets, personal docs, credentials)
- Automatic detection of sensitive files (`.env`, `*.pem`, `*.key`, `credentials.json`)
- Redaction of secret patterns before content reaches the AI

The existing `scopes` field in `access-store.ts` checks file paths mentioned in _user messages_ (regex-based), but does NOT restrict what files the AI can actually read via `Read`/`Glob`/`Grep` tools.

**Impact:** Users may have sensitive files in their workspace (API keys in `.env`, SSH keys, personal documents, database dumps) that get read by the AI during exploration or task execution. No warning, no prevention.

**Proposed solution:**

1. **Config-based visibility controls:**

   ```json
   {
     "workspace": {
       "include": ["src/", "docs/", "tests/", "package.json", "tsconfig.json"],
       "exclude": [
         ".env",
         ".env.*",
         "*.pem",
         "*.key",
         "*.p12",
         "*.pfx",
         "credentials.*",
         "secrets/",
         "*.sqlite",
         "*.db",
         "node_modules/",
         ".git/objects/"
       ],
       "autoDetectSecrets": true
     }
   }
   ```

2. **Secret file scanner** — on startup, scan workspace for known sensitive file patterns:
   - `.env`, `.env.local`, `.env.production`
   - `*.pem`, `*.key`, `*.p12`, `id_rsa`, `id_ed25519`
   - `credentials.json`, `service-account.json`
   - `*.sqlite`, `*.db` (non-openbridge databases)
   - Log warning + add to auto-exclude list

3. **Content redaction layer** (optional, advanced):
   - Before sending file content to AI, scan for patterns:
     - API keys: `sk-...`, `AKIA...`, `ghp_...`, `ghs_...`
     - Connection strings: `postgres://`, `mongodb://`, `redis://`
     - Private keys: `-----BEGIN (RSA |EC |)PRIVATE KEY-----`
   - Replace with `[REDACTED:api_key]` placeholder
   - Log redaction events for transparency

4. **Workspace boundary enforcement** — extend `workspace-manager.ts`:
   - `isFileVisible(path)` → checks include/exclude rules
   - Called before all file read operations
   - Workers receive filtered glob results (excluded files removed)

5. **User-facing transparency:**
   - `/scope` command shows current visibility rules
   - `/secrets` command shows detected sensitive files and their status (excluded/allowed)
   - Setup wizard asks about visibility preferences

**Key files:** `src/core/workspace-manager.ts`, `src/types/config.ts`, `src/core/agent-runner.ts`, `src/master/master-system-prompt.ts`, `src/cli/init.ts`

**Scope:** ~15–20 tasks across 2 phases. Medium priority but high user trust impact.

---

### OB-F73 — WebChat has no authentication (Critical)

**Problem:** The WebChat connector serves its HTML UI on `localhost:3000` with zero authentication. There is no login page, no password, no API token, no session cookie. Once the WebChat is exposed beyond localhost (via LAN binding `0.0.0.0` or tunnel integration from OB-F69 Phase 82), **anyone with the URL can send messages to the Master AI**, which can then spawn workers that read/write files, run commands, and access MCP servers.

The phone whitelist in `auth.ts` only applies to WhatsApp, Telegram, and Discord connectors — WebChat bypasses it entirely. The WebChat connector's `parseMessage()` always sets `sender: 'webchat-user'` with no identity verification.

**Impact:** Security vulnerability. Exposing WebChat to LAN or internet without auth gives any network user full control over the Master AI and workspace. A malicious user could exfiltrate code, modify files, or abuse API quotas. This is the #1 blocker for making WebChat accessible from a phone.

**Proposed solution:**

1. **Token-based auth** (simplest) — generate a random token on first startup, display it in console output. WebChat requires `?token=xxx` in the URL or sends token in WebSocket handshake. No token = connection rejected.

2. **Password auth** — `config.json` gets `webchat.password` field. WebChat shows a login screen before the chat UI. Password checked server-side, session stored in a cookie/localStorage.

3. **QR code auth** (mobile-friendly) — similar to WhatsApp Web. When user opens WebChat on phone, show a QR code on the console/Electron app. Scan → authenticated session.

4. **Rate limiting** — even with auth, add per-IP rate limiting to prevent abuse from compromised tokens.

5. **Integration with existing access-store** — authenticated WebChat users get mapped to access control entries (roles, scopes, daily budgets).

**Key files:** `src/connectors/webchat/webchat-connector.ts`, `src/connectors/webchat/webchat-config.ts`, `src/core/auth.ts`

**Scope:** ~10–12 tasks. Critical — must ship before any LAN/tunnel exposure.

**Dependencies:** Must be completed BEFORE OB-F75 (phone access) and OB-F69 Phase 82 (tunnel).

---

### OB-F74 — WebChat UI is an inlined HTML string — blocks all frontend improvements (High)

**Problem:** The entire WebChat frontend — HTML, CSS, and JavaScript — is a single 350-line template string (`CHAT_HTML`) inside `webchat-connector.ts` (lines 38–384). This means:

1. **No component architecture** — everything is in one monolithic string. Adding a sidebar, settings panel, or history view means growing this string to 1000+ lines.
2. **No framework** — vanilla JS with `document.getElementById()` and manual DOM manipulation. State management is scattered global variables.
3. **No build tooling** — no TypeScript, no linting, no formatting on the frontend code. String-embedded JS doesn't get checked by `tsc` or ESLint.
4. **Painful to edit** — template strings require escaping backticks, no IDE support (no syntax highlighting, no autocomplete inside the string).
5. **No theming** — colors are hardcoded hex values. Adding dark mode means duplicating all CSS.
6. **No testing** — frontend logic (markdown parser, WebSocket handler, dashboard updates) cannot be unit tested.
7. **No accessibility** — zero ARIA labels, no keyboard navigation, no screen reader support.

The current markdown renderer is ~40 lines of `string.split()` calls that only handle bold, italic, code blocks, and newlines — no headers, lists, tables, links, or blockquotes.

**Impact:** Every planned WebChat improvement (conversation history, Deep Mode UI, RAG panel, settings, MCP management, slash commands, notifications) is dramatically harder to build inside this architecture. This is the fundamental blocker for WebChat modernization.

**Proposed solution:**

1. **Extract to separate files** — move HTML/CSS/JS out of the TS string into `src/connectors/webchat/ui/` directory
2. **Lightweight framework** — adopt Preact (3KB gzipped) or Alpine.js for reactivity without a full build pipeline
3. **Component structure** — split into components: ChatMessages, InputBar, AgentDashboard, StatusBar, Sidebar (history), Settings
4. **CSS variables** — replace hardcoded colors with CSS custom properties for theming (light/dark)
5. **Proper markdown** — replace the 40-line string splitter with `marked` or `snarkdown` (inlined, no CDN dependency)
6. **Syntax highlighting** — add `highlight.js` core (11KB) for code blocks with copy button
7. **Build step** — simple esbuild/Vite script that bundles `ui/` → single string injected into connector at build time
8. **Keep self-contained** — final output is still a single HTML string served by the connector, but developed as proper files

**Key files:** `src/connectors/webchat/webchat-connector.ts` (lines 38–384), `src/connectors/webchat/ui/` (new directory)

**Scope:** ~12–15 tasks. High priority — unblocks all subsequent WebChat features.

---

### OB-F75 — WebChat not accessible from user's phone (High)

**Problem:** When a user runs OpenBridge on their laptop, the WebChat is only accessible at `http://localhost:3000` — meaning only that same machine can use it. The user cannot open the WebChat from their phone, even on the same WiFi network. This creates a gap where WhatsApp/Telegram/Discord users can message OpenBridge from their phones, but WebChat users cannot.

Three layers of the problem:

1. **Localhost binding** — `webchat-config.ts` defaults to `host: 'localhost'`. This rejects connections from any other device. Changing to `0.0.0.0` allows LAN access but the user must know their machine's IP address.
2. **No internet exposure** — for access outside the local network, a tunnel is needed (covered by OB-F69 Phase 82), but the WebChat itself has no awareness of public URLs and doesn't display them.
3. **No mobile optimization** — the UI works on mobile (max-width 720px) but has small tap targets, no PWA manifest (can't "Add to Home Screen"), no service worker (no offline shell), no touch gestures (swipe for sidebar).

**Impact:** The WebChat is limited to desktop-only use on the machine running OpenBridge. Users who want a phone-based experience must use WhatsApp/Telegram/Discord instead. This undermines the vision of WebChat as a self-hosted, zero-dependency chat interface.

**Proposed solution:**

1. **LAN access** (~3 tasks):
   - Add `host` option to `webchat-config.ts` with `'0.0.0.0'` as recommended value
   - Display LAN URL in console output on startup: `WebChat available at http://192.168.x.x:3000`
   - Auto-detect local IP addresses and show them to the user
   - Show QR code in console with the LAN URL for easy phone scanning

2. **Tunnel-aware WebChat** (~4 tasks, extends OB-F69 Phase 82):
   - When tunnel is active, display public URL in WebChat header
   - Show public URL + QR code in console output
   - Auto-copy tunnel URL to clipboard on startup
   - WebChat UI shows "Share this link" button with the public URL

3. **Mobile PWA** (~8–10 tasks):
   - Add `manifest.json` (app name, icons, theme color, start URL, display: standalone)
   - Add service worker for offline shell (cache HTML/CSS/JS, show "Reconnecting..." when offline)
   - Responsive CSS breakpoints: full-width on mobile, centered on desktop
   - Touch-friendly: 44px minimum tap targets, larger send button, swipe gestures
   - iOS safe area insets (`env(safe-area-inset-bottom)`)
   - "Add to Home Screen" prompt on first mobile visit
   - Viewport meta tag optimization for mobile keyboards

4. **Mobile-specific features** (~5 tasks):
   - Haptic feedback on message send (Vibration API)
   - Pull-to-refresh for reconnection
   - Browser notifications for completed tasks (`Notification.requestPermission()`)
   - Tab title updates: `(3) OpenBridge` for unread messages
   - Sound notification on response arrival (optional, with mute toggle)

**Key files:** `src/connectors/webchat/webchat-connector.ts`, `src/connectors/webchat/webchat-config.ts`, `src/connectors/webchat/ui/` (new, after OB-F74)

**Scope:** ~20–25 tasks across 2 phases. Depends on OB-F73 (auth) and OB-F74 (frontend extraction).

**Dependencies chain:** OB-F74 (extract UI) → OB-F73 (add auth) → OB-F75 (expose + mobile)

**See also:** OB-F69 Phase 82 (tunnel integration), [FUTURE.md — WebChat Modernization](FUTURE.md)

### OB-F79 — Memory has no vector search — FTS5 only (High)

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) — uses `sqlite-vec` for vector embeddings with hybrid search (vector + FTS5 + SQLite filters), MMR (Maximal Marginal Relevance) for result diversity, and temporal decay scoring.

**Problem:** OpenBridge's memory system (`src/memory/retrieval.ts`) uses FTS5 full-text search only. This works for keyword matches but misses semantically related content. When a user asks "how does authentication work?", FTS5 won't find chunks about "login flow", "JWT tokens", or "session management" unless those exact words are stored.

**Impact:** RAG quality is limited to keyword matching. Large codebases with varied terminology produce poor retrieval results. Workers waste turns re-reading files that are already in the chunk store under different words.

**Proposed solution:**

1. Add `sqlite-vec` dependency for vector storage alongside existing FTS5
2. Add embedding provider abstraction — support OpenAI `text-embedding-3-small`, local llama embeddings, or Voyage (user's choice via config)
3. Hybrid search strategy: vector similarity + FTS5 text match + SQLite metadata filters
4. MMR for result diversity — prevent returning 5 chunks from the same file
5. Temporal decay — recent chunks rank higher than stale exploration data
6. Batch embedding operations for efficient chunk processing during exploration
7. Graceful fallback — if no embedding provider configured, fall back to FTS5-only (current behavior)

**Key files:** `src/memory/retrieval.ts`, `src/memory/chunk-store.ts`, `src/memory/database.ts`, `src/types/config.ts`

**Scope:** ~15–18 tasks across 2 phases. Integrates with planned RAG work (OB-F48, Phases 74–77).

---

### OB-F80 — No structured observations from worker outputs (High)

**Inspired by:** [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — runs a dedicated observer agent that creates typed observations with title, subtitle, narrative, facts, concepts, and files_touched from every tool invocation.

**Problem:** When workers complete tasks, their output is free-form text stored in `conversation_messages`. There's no structured extraction of what was learned — no typed records with facts, concepts, files read/modified, or knowledge gained. The Master reads the raw output and manually curates `memory.md`, but this is lossy and inconsistent.

**Impact:** Valuable knowledge from worker sessions is lost or under-utilized. The same questions trigger new workers instead of querying past observations. `memory.md` is the only cross-session continuity mechanism, limited to 200 lines.

**Proposed solution:**

1. Add `observations` table to SQLite schema — columns: `id`, `session_id`, `type` (bugfix, architecture, investigation, etc.), `title`, `narrative`, `facts` (JSON array), `concepts` (JSON array), `files_read` (JSON array), `files_modified` (JSON array), `created_at`
2. Add `observation-extractor.ts` — parses worker results into structured observations using a lightweight AI call (haiku-tier, 1-turn, all tools disabled)
3. Wire extractor into `worker-result-formatter.ts` — extract observations after every worker completes
4. Add FTS5 virtual table for observations with sync triggers
5. Content-hash deduplication (SHA-256 of session_id + title + narrative) with 30s window to prevent duplicates
6. Expose observations in retrieval.ts for RAG queries

**Key files:** `src/memory/observation-store.ts` (new), `src/master/worker-result-formatter.ts`, `src/memory/database.ts`, `src/memory/retrieval.ts`

**Scope:** ~12–15 tasks across 1–2 phases.

---

### OB-F81 — Memory retrieval returns full results — no progressive disclosure (Medium)

**Inspired by:** [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — uses a 3-layer retrieval pattern: `search()` returns compact index (~50-100 tokens/result), `timeline()` provides chronological context, `get_observations()` fetches full details only for filtered IDs. Claims ~10x token savings.

**Problem:** OpenBridge's `retrieval.ts` returns full chunk content for every search result. When the Master queries memory, it gets all matching content upfront — wasteful when only 2 of 20 results are relevant.

**Impact:** Token waste during RAG queries. Master's context window fills with irrelevant retrieved content, reducing space for actual work.

**Proposed solution:**

1. Add `searchIndex()` — returns compact results: `{ id, title, score, snippet(50 chars), source_file }` (~50 tokens each)
2. Add `getDetails(ids: string[])` — returns full content only for selected IDs
3. Wire into Master's retrieval flow: search → filter → fetch details
4. Master system prompt teaches the 2-step retrieval pattern

**Key files:** `src/memory/retrieval.ts`, `src/master/master-system-prompt.ts`

**Scope:** ~6–8 tasks.

---

### OB-F82 — No content-hash deduplication for workspace chunks (Medium)

**Inspired by:** [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — uses SHA-256 content hash with 30-second deduplication window to prevent storing duplicate observations.

**Problem:** When multiple workers read overlapping files, or when re-exploration runs, the same chunk content can be stored multiple times in `workspace_chunks`. There's no deduplication mechanism.

**Impact:** Database bloat. FTS5 search returns duplicate results. Memory retrieval wastes tokens on repeated content.

**Proposed solution:**

1. Add `content_hash` column to `workspace_chunks` table (SHA-256 of `chunk_path + content`)
2. Before INSERT, check for existing chunk with same hash — update timestamp if found, skip insert
3. Add 30-second deduplication window for rapid successive writes
4. Add migration to backfill hashes for existing chunks

**Key files:** `src/memory/chunk-store.ts`, `src/memory/database.ts`, `src/memory/migration.ts`

**Scope:** ~5–6 tasks.

---

### OB-F83 — No token economics tracking for exploration ROI (Medium)

**Inspired by:** [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — tracks `discovery_tokens` (cost of creating each observation) vs `read_tokens` (cost of retrieving it), computing compression ROI.

**Problem:** OpenBridge has no visibility into whether exploration is cost-effective. How many tokens does exploration consume? How many tokens does retrieval save compared to re-reading? Is the Master's exploration strategy efficient?

**Impact:** No data to optimize exploration strategy or justify exploration cost. Can't tell if the Master is over-exploring or under-exploring.

**Proposed solution:**

1. Track `discovery_tokens` per chunk/observation — estimated from worker turn count and model
2. Track `read_tokens` per retrieval — count tokens in returned content
3. Add `token_economics` table: `chunk_id`, `discovery_tokens`, `retrieval_count`, `total_read_tokens`
4. Add `/stats` command showing exploration ROI: "Explored with ~50K tokens, saved ~200K tokens across 15 retrievals (4x ROI)"

**Key files:** `src/memory/chunk-store.ts`, `src/core/router.ts`, `src/memory/database.ts`

**Scope:** ~6–8 tasks.

---

### OB-F84 — Master context window has no auto-compaction (High)

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) — implements session compaction that auto-summarizes conversation history when context window fills, with identifier preservation and retry logic.

**Problem:** The Master AI runs long-lived sessions via `--session-id`. As conversations grow, the context window fills up. Currently, `memory.md` (200 lines, manually curated) is the only continuity mechanism. There's no automatic compaction of the Master's session history — old turns are simply dropped by the model when the window fills.

**Impact:** Long Master sessions lose important context silently. Critical decisions from early in the session are forgotten. The Master may contradict earlier analysis or redo work.

**Proposed solution:**

1. Add `SessionCompactor` in `src/master/session-compactor.ts`
2. Monitor Master session turn count — trigger compaction when approaching limit (e.g., >80% of `--max-turns`)
3. Compaction strategy: summarize old turns into structured summary (identifiers preserved, key decisions kept)
4. Write compaction summary to `memory.md` before starting new session segment
5. Retry on compaction failure — don't lose the session silently
6. Track which identifiers (file paths, function names, finding IDs) must be preserved across compaction

**Key files:** `src/master/session-compactor.ts` (new), `src/master/master-manager.ts`, `src/master/dotfolder-manager.ts`

**Scope:** ~10–12 tasks.

---

### OB-F85 — No self-diagnostic command (`openbridge doctor`) (Medium)

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) — has `openclaw doctor` command that validates DM policies, runs migration checks, and flags misconfigurations.

**Problem:** When OpenBridge has issues (AI tool not found, SQLite corrupt, config invalid, channel not connecting), users have no diagnostic tool. They must read logs manually or ask for help.

**Impact:** Poor DX and user experience. Common issues (missing `claude` binary, wrong Node version, corrupt `openbridge.db`, stale `.openbridge/`) take too long to diagnose.

**Proposed solution:**

1. Add `openbridge doctor` CLI command in `src/cli/doctor.ts`
2. Checks to run:
   - Node.js version >= 22 ✓/✗
   - AI tools detected (claude, codex, aider) ✓/✗ with versions
   - Config file valid (Zod parse) ✓/✗ with specific errors
   - SQLite database healthy (integrity check, schema version, table counts) ✓/✗
   - `.openbridge/` state (stale data, missing files, corrupted entries) ✓/✗
   - Channel connectivity (WhatsApp session, Telegram bot token, Discord bot token) ✓/✗
   - MCP servers reachable ✓/✗
   - Disk space for logs/DB ✓/✗
3. Output: color-coded summary with fix suggestions for each failing check
4. Add `/doctor` chat command that runs the same checks and sends results via the channel

**Key files:** `src/cli/doctor.ts` (new), `src/cli/index.ts`, `src/core/router.ts`

**Scope:** ~8–10 tasks.

---

### OB-F86 — No pairing-based auth for non-phone channels (Medium)

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) — uses DM pairing codes for unknown senders. Unknown user gets a short code, owner approves via CLI, sender is added to local allowlist.

**Problem:** OpenBridge uses phone number whitelisting for auth. This works for WhatsApp but is awkward for Discord (usernames, not phone numbers), Telegram (optional phone), and WebChat (no phone at all). Adding a new user requires editing `config.json` and restarting.

**Impact:** Onboarding new users is manual and requires config file editing. No self-service approval flow for Discord/Telegram users.

**Proposed solution:**

1. When unknown sender messages OpenBridge, generate a 6-digit pairing code
2. Send pairing code back to the unknown sender: "To connect, ask the admin to approve code: 482917"
3. Owner approves via CLI: `openbridge pairing approve 482917` or via chat command: `/approve 482917`
4. Approved sender is added to `access-store.ts` with appropriate role
5. Pairing codes expire after 5 minutes
6. Works alongside existing phone whitelist (not a replacement)

**Key files:** `src/core/auth.ts`, `src/memory/access-store.ts`, `src/cli/access.ts`, `src/core/router.ts`

**Scope:** ~8–10 tasks.

---

### OB-F87 — No skills directory for reusable capabilities (Medium)

**Inspired by:** [openclaw/openclaw](https://github.com/openclaw/openclaw) — has 60+ bundled skills in `skills/` directory with `SKILL.md` files. Master discovers and uses skills autonomously. ClawHub registry for community sharing.

**Problem:** OpenBridge discovers AI tools on the machine (Claude, Codex, etc.) but has no concept of reusable "skills" — structured capability descriptions that the Master can discover, learn, and apply. Every session starts from scratch, relying on exploration and system prompts.

**Impact:** The Master rediscovers how to do common tasks each session. No way for users to share custom capabilities or for the Master to learn and package successful patterns.

**Proposed solution:**

1. Add `.openbridge/skills/` directory with `SKILL.md` pattern
2. Each skill is a directory with `SKILL.md` (description, tools needed, example prompts, constraints)
3. Master reads available skills on startup and includes them in its system prompt
4. Master can create new skills from successful task patterns (extends existing prompt evolution)
5. Built-in skills: `code-review`, `test-runner`, `dependency-audit`, `api-docs-generator`
6. Future: community skill registry (like OpenClaw's ClawHub)

**Key files:** `src/master/skill-manager.ts` (new), `src/master/master-system-prompt.ts`, `src/master/dotfolder-manager.ts`

**Scope:** ~10–12 tasks.

---

### OB-F88 — Worker results lack structured summary format (Medium)

**Inspired by:** [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) — session summaries are structured as: `request`, `investigated`, `learned`, `completed`, `next_steps`, `notes`.

**Problem:** Worker results are formatted as free-text by `worker-result-formatter.ts`. The Master receives unstructured text and must parse it manually. There's no standard format for what was completed, what was learned, or what remains unfinished.

**Impact:** Master can't reliably track incomplete work across workers. No `next_steps` field means the Master doesn't know what a worker left undone. Cross-session continuity depends entirely on manual `memory.md` curation.

**Proposed solution:**

1. Define `WorkerSummary` schema in `src/types/agent.ts`: `{ request, investigated, completed, learned, next_steps, files_modified, files_read }`
2. Update `worker-result-formatter.ts` to extract structured summaries from worker output
3. Store summaries in `agent_activity` table (extend existing schema)
4. Master reads summaries for context injection — particularly `next_steps` for incomplete work
5. `memory.md` auto-updates with `learned` items from worker summaries

**Key files:** `src/master/worker-result-formatter.ts`, `src/types/agent.ts`, `src/memory/activity-store.ts`, `src/master/dotfolder-manager.ts`

**Scope:** ~8–10 tasks.

---
