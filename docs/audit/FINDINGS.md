# OpenBridge — Audit Findings

> **Purpose:** Real issues, gaps, and risks discovered during code audits and real-world testing.
> **This is NOT a task list.** Tasks live in [TASKS.md](TASKS.md). Findings document _what's wrong_ and _why it matters_.
> **Open:** 2 | **Fixed:** 50 | **Last Audit:** 2026-02-28
> **Resolved findings:** [V0 archive](archive/v0/FINDINGS-v0.md) | [V2 archive](archive/v2/FINDINGS-v2.md) | [V4 archive](archive/v4/FINDINGS-v4.md) | [V5 archive](archive/v5/FINDINGS-v5.md) | [V6 archive](archive/v6/FINDINGS-v6.md) | [V7 archive](archive/v7/FINDINGS-v7.md) | [V8 archive](archive/v8/FINDINGS-v8.md) | [V15 archive](archive/v15/FINDINGS-v15.md) | [V16 archive](archive/v16/FINDINGS-v16.md) | [V17 archive](archive/v17/FINDINGS-v17.md)

---

## Priority Order

| #   | Finding                                                           | Severity  | Impact                                                                                  | Status   |
| --- | ----------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------- | -------- |
| 46  | OB-F46 — Voice transcription requires local Whisper install       | 🟡 Medium | Users must install external binary (whisper CLI) for voice messages; no API fallback    | ✅ Fixed |
| 47  | OB-F47 — No desktop installer or guided setup for non-developers  | 🟠 High   | Non-dev users cannot install/run OpenBridge; no .exe/.dmg, no dependency wizard         | Open     |
| 48  | OB-F48 — Master AI answers from stale context, not live knowledge | 🟠 High   | Exploration data (chunks, dir dives, workspace map) underutilized after startup; no RAG | Open     |

---

## Open Findings

### OB-F46 — Voice transcription requires local Whisper install (no API fallback) ✅ Fixed

**Discovered:** 2026-02-28 | **Fixed:** 2026-02-28 | **Component:** `src/core/voice-transcriber.ts`

**Problem:** Voice message transcription currently requires users to install an external binary — either `openai-whisper` (Python, ~1.5 GB with model) or `whisper-cpp` (Homebrew). If not installed, voice messages silently degrade to `"[Voice message — install whisper for auto-transcription]"`. There is no API-based fallback using the OpenAI Whisper API (`POST /v1/audio/transcriptions`), which would require only an API key and zero local installs.

More broadly, OpenBridge has **no dependency installation guide** — users are not informed upfront about optional external tools they may need (Whisper, Chrome/Chromium for WhatsApp Web, ffmpeg for media processing, etc.).

**Root cause:** `voice-transcriber.ts` only supports the local Whisper CLI (`which whisper`). The OpenAI Whisper API was never implemented as an alternative transcription backend. There is no "prerequisites" or "external dependencies" section in the README or docs.

**Impact:**

- Voice messages from WhatsApp and Telegram are unusable without local Whisper install
- Installing Whisper is non-trivial: Python + pip + ~1.5 GB model download, or Homebrew
- Users on systems without Python (or with version conflicts like Python 3.14) get blocked
- The OpenAI Whisper API is cheap ($0.006/min) and requires zero local setup — just an API key
- No documentation tells users what external tools they need before running OpenBridge

**Design decision: Reuse `OPENAI_API_KEY` from Codex — no new config needed.**

Codex already authenticates via `OPENAI_API_KEY` env var (or `codex login` OAuth). The same API key works for the Whisper transcription endpoint. Users who have Codex set up already have everything they need — no separate account, no new config section. The transcriber just checks for `process.env.OPENAI_API_KEY` at runtime.

**Fallback chain (priority order):**

| Priority | Method                                              | Requirement                                           |
| -------- | --------------------------------------------------- | ----------------------------------------------------- |
| 1        | **OpenAI Whisper API** (`/v1/audio/transcriptions`) | `OPENAI_API_KEY` already in env (same one Codex uses) |
| 2        | **Local Whisper CLI**                               | `whisper` binary installed on PATH                    |
| 3        | **Fallback message**                                | Nothing — tells user their options                    |

**What needs to change:**

1. **Add OpenAI Whisper API backend** — new transcription path in `voice-transcriber.ts` that calls `https://api.openai.com/v1/audio/transcriptions` with the audio file. Uses `process.env.OPENAI_API_KEY` (same key Codex uses). No new config schema needed.

2. **Prerequisites documentation** — add a "Prerequisites" or "External Dependencies" section to README.md and/or docs listing:
   - **Required:** Node.js >= 22
   - **For WhatsApp:** Chrome/Chromium (bundled by whatsapp-web.js via Puppeteer)
   - **For voice messages (option A):** `OPENAI_API_KEY` env var (same key used by Codex — zero extra setup if Codex is configured)
   - **For voice messages (option B):** Local Whisper binary (`pip install openai-whisper` or `brew install whisper-cpp`) — free, offline
   - **For Telegram:** Bot token from @BotFather
   - **For Discord:** Bot token + application ID from Discord Developer Portal

**Affected files:**

- `src/core/voice-transcriber.ts` — add API-based transcription using `OPENAI_API_KEY` from env
- `README.md` — add prerequisites/dependencies section
- `docs/GETTING_STARTED.md` or `docs/PREREQUISITES.md` — detailed setup guide

---

### OB-F47 — No desktop installer or guided setup for non-developers 🟠 High

**Discovered:** 2026-02-28 | **Component:** `src/cli/`, packaging, UX

**Problem:** OpenBridge currently requires developer-level knowledge to install and run: cloning a git repo, running `npm install`, editing `config.json` by hand, installing AI tools (Claude Code / Codex) via npm, and managing API keys via environment variables. Non-developer users — the majority of potential testers and end users — cannot realistically set up OpenBridge on their Windows PC or Mac without hand-holding.

There is no `.exe` installer for Windows, no `.dmg` for macOS, no dependency auto-installer, and no guided setup flow that walks users through connecting their AI accounts (Anthropic / OpenAI).

**Root cause:** OpenBridge was built developer-first. The existing `npx openbridge init` CLI asks 3 questions (workspace, connector, phone) but does not:

- Check or install prerequisites (Node.js, AI tools)
- Guide users through API key / account setup
- Bundle the runtime into a standalone executable
- Provide a graphical interface for configuration

**Impact:**

- Non-developer friends/testers cannot install or run OpenBridge at all
- Windows users have no path — no `.exe`, no installer, no PowerShell bootstrap
- macOS users need Homebrew + npm knowledge just to get started
- AI tool installation (Claude Code, Codex) requires npm and account setup — undocumented for end users
- First-run experience is intimidating: terminal, JSON editing, env vars
- Severely limits adoption beyond the developer community

**Solution: 3-phase approach from CLI wizard to desktop app**

---

#### Phase 1 — Enhanced Setup Wizard CLI (Low effort)

**Goal:** Make `npx openbridge init` a complete guided installer that handles everything.

**What it does:**

1. **OS detection** — detect Windows/macOS/Linux, adapt instructions and commands accordingly
2. **Prerequisite check** — verify Node.js >= 22 is installed; if not, provide direct download link + instructions per OS
3. **AI tool installer** — detect which AI tools are available (`which claude`, `which codex`):
   - If none found: ask user which they want, then run `npm install -g @anthropic-ai/claude-code` or `npm install -g @openai/codex` automatically
   - If already installed: show version and skip
4. **Account & API key setup** — step-by-step walkthrough:
   - For Claude Code: guide user to `claude auth login` or prompt for API key, explain where to get one (links to console.anthropic.com)
   - For Codex: guide user to `codex login` (OAuth) or prompt for `OPENAI_API_KEY`, explain where to get one (links to platform.openai.com)
   - Validate the key works (quick API health check)
   - Write env vars to `.env` file automatically
5. **Connector setup** — existing 3-question flow (workspace, connector, phone whitelist) with better descriptions and examples
6. **Config generation** — auto-generate `config.json` with validated settings
7. **Health check** — run `openbridge health` at the end to verify everything works
8. **Quick-start summary** — print "You're ready! Run `npm run dev` to start."

**Affected files:**

- `src/cli/init.ts` — major enhancement: OS detection, AI tool installation, API key walkthrough, health check
- `src/cli/utils.ts` (new) — shared CLI helpers: `detectOS()`, `checkCommand()`, `installGlobalPackage()`, `validateApiKey()`
- `src/core/health.ts` — expose `runHealthCheck()` for CLI use

**Effort:** ~2–3 days. Low risk — enhances existing code, no new architecture.

---

#### Phase 2 — Standalone Binary Packaging via pkg (Medium effort)

**Goal:** Produce a single `.exe` (Windows) and `.dmg`-wrapped binary (macOS) that bundles Node.js + OpenBridge + all dependencies. Users double-click to run — no npm, no terminal required.

**Approach:** Use [pkg](https://github.com/vercel/pkg) (or the maintained fork [@yao-pkg/pkg](https://github.com/yao-pkg/pkg)) to compile the Node.js project into platform-specific binaries.

**What it does:**

1. **Bundle Node.js runtime** — pkg embeds Node.js inside the binary, so users don't need Node installed
2. **Bundle all dependencies** — `better-sqlite3` (native addon), `whatsapp-web.js`, etc. are included
3. **Cross-platform builds** — CI builds produce:
   - `openbridge-win-x64.exe` (Windows)
   - `openbridge-macos-arm64` + `openbridge-macos-x64` (macOS Apple Silicon + Intel)
   - `openbridge-linux-x64` (Linux)
4. **First-run wizard** — on first launch, the binary runs the Phase 1 enhanced init wizard automatically
5. **macOS .dmg wrapper** — use `create-dmg` or `electron-builder` (dmg-only mode) to wrap the binary in a drag-to-Applications installer
6. **Windows installer** — use NSIS or Inno Setup to wrap the .exe with Start Menu shortcut + uninstaller
7. **Auto-update check** — on startup, check GitHub Releases for newer version and notify user

**Effort:** ~1–2 weeks. Medium risk — native addon bundling requires testing on each platform.

---

#### Phase 3 — Electron Desktop App with GUI (High effort)

**Goal:** A proper desktop application with a graphical setup wizard, configuration UI, live dashboard, and system tray integration. The ultimate non-developer experience.

**Effort:** ~4–8 weeks. High investment but transforms OpenBridge from a dev tool into a consumer product.

---

#### Phase Summary

| Phase | Deliverable                           | Target Users                                 | Effort     | Prerequisite |
| ----- | ------------------------------------- | -------------------------------------------- | ---------- | ------------ |
| 1     | Enhanced `npx openbridge init` wizard | Dev-adjacent users comfortable with terminal | ~2–3 days  | None         |
| 2     | Standalone `.exe` / macOS binary      | Users who can download and double-click      | ~1–2 weeks | Phase 1      |
| 3     | Electron desktop app with full GUI    | Anyone — zero technical knowledge needed     | ~4–8 weeks | Phase 1 + 2  |

**Recommendation:** Ship Phase 1 immediately — it unblocks friends who have basic terminal comfort. Start Phase 2 in parallel for the "just send them a file" experience. Phase 3 is the long-term vision for mass adoption.

---

### OB-F48 — Master AI answers from stale context, not live knowledge (no RAG) 🟠 High

**Discovered:** 2026-02-28 | **Component:** `src/master/master-manager.ts`, `src/memory/`, `src/master/dotfolder-manager.ts`

**Problem:** When users ask codebase questions ("how does auth work?", "what does the router do?"), the Master AI answers from a narrow slice of its available knowledge — workspace map summary + `memory.md` + last 20 messages + FTS5 conversation search. It **never queries the chunk store** (`context_chunks` + FTS5), **never reads per-directory exploration data** (`exploration/dirs/*.json`), and **never matches key files from the workspace map** against the user's question. The exploration system does expensive multi-phase analysis at startup, but most of that knowledge sits unused after the initial map is built.

**What OpenBridge already knows (without spawning anything):**

| Layer                   | What's There                                                                     | How It's Retrieved           |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------- |
| `workspace-map.json`    | Project type, frameworks, directory structure, key files, commands, dependencies | In-memory, instant           |
| `context_chunks` + FTS5 | Summarized workspace knowledge, chunked by scope/category                        | BM25 search, sub-millisecond |
| `conversations` + FTS5  | Full message history, cross-session                                              | BM25 search                  |
| `memory.md`             | Curated cross-session memory (decisions, preferences, state)                     | Loaded on session start      |
| `learnings` table       | Model success rates, avg turns per task type                                     | Direct query                 |
| Exploration JSONs       | Per-directory deep dives: key files, purposes, patterns                          | Disk read                    |

**The gap:** Master currently injects workspace map summary + `memory.md` + last 20 messages + FTS5 conversation search. It **never queries the chunk store or the per-directory exploration data** for the user's question.

**Root cause:** `processMessage()` in `master-manager.ts` uses `buildConversationContext()` which assembles session history, `memory.md`, and cross-session FTS5 conversation search — but never queries `hybridSearch()` on the chunk store, never looks up key files from the workspace map by keyword, and never loads relevant `exploration/dirs/*.json` files. The exploration data has no retrieval path into the message-handling flow.

**Impact:**

- Master AI answers codebase questions from memory/summary alone — often vague or outdated
- Expensive exploration data (5-phase startup, per-directory dives) goes unused after startup
- Users get better answers by spawning workers to re-read files that were already explored
- Compared to tools like Claude Code (which explores files before answering), the Master feels uninformed
- Every user question about the codebase could be answered faster and cheaper by querying existing SQLite data

**Solution: Knowledge-First Retrieval (RAG) — query existing knowledge, spawn workers only for gaps**

Instead of spawning a research worker to re-explore files that were already explored, query the existing knowledge base first, and only spawn targeted workers for the gaps.

**Architecture:**

```
User: "How does auth work?"
         │
         ▼
  ┌─────────────────────┐
  │  1. Classify         │  ← "codebase-question" detected
  └──────┬──────────────┘
         │
         ▼
  ┌─────────────────────┐
  │  2. Knowledge Query  │  ← NEW: Query what we ALREADY know
  │                      │
  │  a) FTS5 chunk search│  → "auth" matches chunks about auth.ts,
  │     on "auth"        │     router command filters, whitelist
  │                      │
  │  b) Workspace map    │  → src/core/auth.ts listed as key file
  │     key file lookup  │     with purpose: "Whitelist auth"
  │                      │
  │  c) Dir dive lookup  │  → exploration/dirs/core.json has
  │     for relevant dir │     auth.ts details + patterns
  │                      │
  │  d) Conversation     │  → Past discussions about auth
  │     FTS5 search      │     (already done today)
  └──────┬──────────────┘
         │ All assembled into rich context
         ▼
  ┌─────────────────────┐
  │  3. Sufficiency Check│  ← Can we answer from this?
  │                      │
  │  YES → Master        │     answers with grounded context
  │  NO  → Spawn worker  │     to read specific files we
  │        (targeted)    │     identified but don't have content for
  └──────┬──────────────┘
         │
         ▼
  ┌─────────────────────┐
  │  4. Master Synthesis │  ← Answer grounded in real knowledge
  └─────────────────────┘
```

**New module: `src/core/knowledge-retriever.ts`**

```typescript
interface KnowledgeResult {
  chunks: ChunkMatch[]; // From context_chunks FTS5
  keyFiles: KeyFileMatch[]; // From workspace-map.json
  dirInsights: DirInsight[]; // From exploration/dirs/*.json
  conversations: ConvMatch[]; // From conversations FTS5
  confidence: 'high' | 'medium' | 'low'; // Can we answer?
  suggestedReads: string[]; // Files to read if confidence is low
}

async function retrieveKnowledge(
  query: string,
  memory: MemoryManager,
  dotfolder: DotfolderManager,
): Promise<KnowledgeResult>;
```

This function:

1. Extracts keywords from the user's question
2. Queries `hybridSearch()` on chunk store (already exists in `src/memory/retrieval.ts`)
3. Matches key files from workspace map by keyword/path
4. Loads relevant `exploration/dirs/*.json` for matched directories
5. Searches conversation history (already exists)
6. Calculates confidence based on match count + relevance scores
7. If confidence is low, identifies which files SHOULD be read (from key files list)

**Integration point: `master-manager.ts` → `processMessage()`**

```typescript
// After classification, before sending to Master:
if (taskClass === 'codebase-question') {
  const knowledge = await this.knowledgeRetriever.retrieve(message.content);

  // Inject into Master context (alongside existing injections)
  conversationContext += formatKnowledgeContext(knowledge);

  if (knowledge.confidence === 'low' && knowledge.suggestedReads.length > 0) {
    // Spawn a TARGETED read worker — not "explore everything",
    // but "read these 3 specific files we know are relevant"
    const readResult = await this.spawnTargetedReader(knowledge.suggestedReads);
    conversationContext += `\n\n## File Contents\n${readResult}`;
  }
}
```

**Targeted reader (when needed):**

Not a general "explore the codebase" worker. A focused reader with `read-only` profile, `fast` model, **5 turns max**. Only spawned when chunk store doesn't have enough detail. Files to read are **already identified** by the knowledge retriever from the exploration data.

**Why this scales across all AI tools:**

| Aspect              | Why It Scales                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| **Multi-AI**        | Knowledge retrieval is pure SQLite — no AI needed. Only synthesis + optional reads use AI tools |
| **Cost**            | Most questions answered from existing data. Workers only for gaps                               |
| **Speed**           | FTS5 query < 1ms. No worker spawn for cached knowledge                                          |
| **Grows with use**  | Every exploration enriches chunks. Every conversation enriches FTS5. Knowledge compounds        |
| **Tool-agnostic**   | Any AI can synthesize from injected context. Any AI can do a targeted file read                 |
| **Offline-capable** | If no AI is available, could still return raw chunk/exploration data                            |

**The missing piece — richer chunks over time:**

Right now, chunks are stored during exploration but are summaries, not full file contents. Over time, enrich them:

- When a worker reads a file → store a chunk with key functions/exports
- When a question gets answered → store the Q&A as a chunk
- When the Master updates `memory.md` → extract entities into chunks

This turns OpenBridge into a **learning system** — every interaction makes the knowledge base richer, making future questions cheaper to answer.

**Implementation phases:**

| Phase                         | What                                                                                            | Tasks     |
| ----------------------------- | ----------------------------------------------------------------------------------------------- | --------- |
| Phase 74: Knowledge Retriever | New `knowledge-retriever.ts`, FTS5 + map + dir-dive queries, confidence scoring                 | ~10 tasks |
| Phase 75: Context Injection   | Wire retriever into `processMessage()`, new `codebase-question` class, format knowledge context | ~8 tasks  |
| Phase 76: Targeted Reader     | Spawn focused read workers for low-confidence gaps, enrich chunks from reads                    | ~6 tasks  |
| Phase 77: Chunk Enrichment    | Store worker read results as chunks, Q&A pair caching, entity extraction                        | ~8 tasks  |

**Affected files:**

- `src/core/knowledge-retriever.ts` (new) — RAG query orchestrator
- `src/master/master-manager.ts` — wire retriever into `processMessage()`, add `codebase-question` task class
- `src/master/master-system-prompt.ts` — update classifier to detect `codebase-question`
- `src/memory/retrieval.ts` — may need new query helpers for key file matching
- `src/master/dotfolder-manager.ts` — expose dir-dive JSON loading API
- `src/memory/chunk-store.ts` — chunk enrichment from worker reads + Q&A pairs

---

Most recent fixes:

- **OB-F43, OB-F44, OB-F45** (WhatsApp/Telegram media + MCP dashboard) — [archived to v17](archive/v17/FINDINGS-v17.md)
- **OB-F41, OB-F42** (Telegram/Discord message too long + live context) — [archived to v16](archive/v16/FINDINGS-v16.md)
- **OB-F38, OB-F39, OB-F40** — [archived to v15](archive/v15/FINDINGS-v15.md)

---

## Severity Guide

| Severity    | Meaning                                               |
| ----------- | ----------------------------------------------------- |
| 🔴 Critical | System broken, data loss risk, security vulnerability |
| 🟠 High     | Core functionality missing or significantly impaired  |
| 🟡 Medium   | Friction, technical debt, or non-blocking gaps        |
| 🟢 Low      | Polish, minor improvements, nice-to-have              |
