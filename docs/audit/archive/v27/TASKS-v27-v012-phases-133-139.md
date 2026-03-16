# OpenBridge — Archived Tasks v27 (Phases 133–139)

> **Archived:** 2026-03-16
> **Tasks:** 28 completed (OB-1531 through OB-1559)
> **Version:** v0.1.2 — Claude model budgets, prompt size cap, WebChat session isolation, worker file ops, Codex/Aider model updates, startup log noise, integration tests

## Phase 133 — Claude Model Budgets & Context Windows (OB-F203)

| #       | Task                                                                           | Status  |
| ------- | ------------------------------------------------------------------------------ | ------- |
| OB-1531 | claude-adapter.ts: model-aware getPromptBudget() (Opus/Sonnet 4.6 = 128K/800K) | ✅ Done |
| OB-1532 | claude-sdk.ts: shared budget helper (claude-budget.ts)                         | ✅ Done |
| OB-1533 | model-registry.ts: contextTokens + maxOutputTokens fields                      | ✅ Done |
| OB-1534 | session-compactor.ts: model-aware promptSizeLimit                              | ✅ Done |
| OB-1535 | agent-runner.ts: getMaxPromptLength(model) function                            | ✅ Done |
| OB-1536 | cost-manager.ts: updated Anthropic pricing                                     | ✅ Done |
| OB-1537 | prompt-budget.test.ts: model-specific budget tests                             | ✅ Done |

## Phase 134 — Prompt Size Cap & Silent Rejection Fix (OB-F200)

| #       | Task                                                          | Status  |
| ------- | ------------------------------------------------------------- | ------- |
| OB-1538 | prompt-store.ts: raise cap to 55K, throw on oversize          | ✅ Done |
| OB-1539 | master-manager.ts: pre-flight size validation + file fallback | ✅ Done |
| OB-1540 | master-system-prompt.ts: trimPromptToFit()                    | ✅ Done |
| OB-1541 | Unit tests for prompt size cap fixes                          | ✅ Done |

## Phase 135 — WebChat Session Isolation (OB-F202)

| #       | Task                                                 | Status  |
| ------- | ---------------------------------------------------- | ------- |
| OB-1542 | conversation-store.ts: getSessionHistoryForSender()  | ✅ Done |
| OB-1543 | retrieval.ts: userId filter in searchConversations() | ✅ Done |
| OB-1544 | prompt-context-builder.ts: sender param threading    | ✅ Done |
| OB-1545 | WebChat sender data flow verification                | ✅ Done |
| OB-1546 | Unit tests for WebChat session isolation             | ✅ Done |

## Phase 136 — Worker File Operations & Profile Escalation (OB-F182)

| #       | Task                                                        | Status  |
| ------- | ----------------------------------------------------------- | ------- |
| OB-1547 | agent-runner.ts + agent.ts: add rm/mv/cp/mkdir to code-edit | ✅ Done |
| OB-1548 | worker-orchestrator.ts: auto-escalation to file-management  | ✅ Done |
| OB-1549 | Unit tests for profile escalation                           | ✅ Done |

## Phase 137 — Codex/Aider Model Registry Updates (OB-F204)

| #       | Task                                                        | Status  |
| ------- | ----------------------------------------------------------- | ------- |
| OB-1551 | codex-adapter.ts: 400K budget, model-registry gpt-5.3-codex | ✅ Done |
| OB-1552 | aider-adapter.ts: model-specific budgets, registry updates  | ✅ Done |
| OB-1553 | Unit tests for Codex/Aider budgets + registry tiers         | ✅ Done |

## Phase 138 — Startup Log Noise Cleanup (OB-F201, OB-F199)

| #       | Task                                                           | Status  |
| ------- | -------------------------------------------------------------- | ------- |
| OB-1554 | dotfolder-manager.ts: fs.access() guard for readSystemPrompt() | ✅ Done |
| OB-1555 | dotfolder-manager.ts: remove warning flags, downgrade to debug | ✅ Done |
| OB-1556 | Smoke test: zero WARN on fresh DotFolderManager init           | ✅ Done |

## Phase 139 — Cross-Finding Integration Tests

| #       | Task                                 | Status  |
| ------- | ------------------------------------ | ------- |
| OB-1557 | integration/model-budgets.test.ts    | ✅ Done |
| OB-1558 | integration/prompt-session.test.ts   | ✅ Done |
| OB-1559 | integration/profiles-startup.test.ts | ✅ Done |
