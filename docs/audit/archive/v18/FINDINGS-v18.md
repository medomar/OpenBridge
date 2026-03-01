# OpenBridge — Archived Findings (V18)

> **Archived:** 2026-03-01 | **Contains:** OB-F46, OB-F47, OB-F48

---

## OB-F46 — Voice transcription requires local Whisper install (no API fallback) ✅ Fixed

**Discovered:** 2026-02-28 | **Fixed:** 2026-02-28 | **Component:** `src/core/voice-transcriber.ts`

**Problem:** Voice message transcription required users to install an external binary (openai-whisper or whisper-cpp). No API-based fallback using the OpenAI Whisper API.

**Resolution:** Phase 70 — Added OpenAI Whisper API fallback using `OPENAI_API_KEY` (same key Codex uses). Fallback chain: API → Local CLI → user message. Prerequisites documented.

---

## OB-F47 — No desktop installer or guided setup for non-developers ✅ Fixed

**Discovered:** 2026-02-28 | **Fixed:** 2026-03-01 | **Component:** `src/cli/`, `desktop/`, packaging

**Problem:** OpenBridge required developer-level knowledge to install and run. No .exe/.dmg, no dependency wizard, no GUI.

**Resolution:** 3-phase implementation across Phases 71–73:

- **Phase 71** — Enhanced Setup Wizard CLI: OS detection, prerequisite checks, AI tool auto-installer, API key walkthrough, health check (23 tasks)
- **Phase 72** — Standalone Binary Packaging: pkg-based cross-platform binaries (.exe, .dmg, Linux), NSIS/create-dmg installers, auto-update (25 tasks)
- **Phase 73** — Electron Desktop App: React GUI with setup wizard, live dashboard, settings panel, system tray, native installers, auto-updater (37 tasks)

---

## OB-F48 — Master AI answers from stale context, not live knowledge (no RAG) — Deferred

**Discovered:** 2026-02-28 | **Component:** `src/master/master-manager.ts`, `src/memory/`, `src/master/dotfolder-manager.ts`

**Problem:** Master AI answers codebase questions from a narrow slice of available knowledge (workspace map + memory.md + last 20 messages). Never queries the chunk store, exploration JSONs, or workspace map key files.

**Status:** Deferred to future version. Planned implementation in Phases 74–77 (Knowledge Retriever, Context Injection, Targeted Reader, Chunk Enrichment). Full design spec preserved in [FUTURE.md](../FUTURE.md).
