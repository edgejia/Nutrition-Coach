---
phase: 62
slug: meal-revision-tokens-and-stale-receipt-protection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-17
---

# Phase 62 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` with `tsx` |
| **Config file** | `package.json`, `scripts/run-node-with-tz.mjs`, `tsconfig.json` |
| **Quick run command** | `node scripts/run-node-with-tz.mjs --import tsx --test <targeted test files>` |
| **Full suite command** | `yarn test` |
| **Estimated runtime** | Targeted tests: under 60 seconds; full suite: project-dependent |

---

## Sampling Rate

- **After every task commit:** Run `yarn tsc --noEmit` plus the targeted `node scripts/run-node-with-tz.mjs --import tsx --test ...` command for edited boundaries.
- **After every plan wave:** Run `yarn test:unit` and `yarn test:integration` when backend and client surfaces are both touched.
- **Before `$gsd-verify-work`:** Run `yarn tsc --noEmit`, `yarn test`, and `yarn release:check`.
- **Max feedback latency:** Prefer targeted feedback under 60 seconds before broader gates.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 62-01-01 | 01 | 1 | FRESH-01, FRESH-02 | T-62-01 / T-62-02 | Direct route and transaction tests prove current revisions succeed while missing/stale `expectedMealRevisionId` fails before revision insert or summary/publish side effects. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-transactions.test.ts tests/unit/food-logging.test.ts tests/integration/meals-api.test.ts` | yes | pending |
| 62-01-02 | 01 | 1 | FRESH-01, FRESH-02 | T-62-01 / T-62-03 | Transaction preconditions and direct route conflict bodies use `MEAL_REVISION_REQUIRED` / `MEAL_REVISION_STALE` and keep creation/logging outside expected revision enforcement. | source + integration | `yarn tsc --noEmit && node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-transactions.test.ts tests/unit/food-logging.test.ts tests/integration/meals-api.test.ts` | yes | pending |
| 62-02-01 | 02 | 1 | FRESH-01 | T-62-04 / T-62-05 | Server read/receipt tests prove edit-capable DTOs expose public `mealRevisionId` without leaking internal `currentRevisionId`. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-history.test.ts tests/unit/chat.test.ts tests/integration/day-snapshot-api.test.ts tests/integration/history-api.test.ts tests/integration/history-search-api.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | yes | pending |
| 62-02-02 | 02 | 1 | FRESH-01 | T-62-04 / T-62-05 | Meal history, history query, day snapshot, chat JSON/SSE, and restored chat receipt projections carry `mealRevisionId` only when edit-capable. | source + integration | `yarn tsc --noEmit && node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-history.test.ts tests/unit/chat.test.ts tests/integration/day-snapshot-api.test.ts tests/integration/history-api.test.ts tests/integration/history-search-api.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | yes | pending |
| 62-03-01 | 03 | 2 | FRESH-02 | T-62-01 / T-62-02 / T-62-06 | Chat/tool tests prove resolver-owned `{ mealId, mealRevisionId }` supplies `expectedMealRevisionId` and stale tool writes fail closed. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-meal-correction.integration.test.ts` | yes | pending |
| 62-03-02 | 03 | 2 | FRESH-02 | T-62-01 / T-62-02 / T-62-06 | `find_meals`, `update_meal`, and `delete_meal` use backend resolver state for revision authority; the model cannot invent or bypass the token. | source + integration | `yarn tsc --noEmit && node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-meal-correction.integration.test.ts` | yes | pending |
| 62-04-01 | 04 | 3 | FRESH-01, FRESH-03 | T-62-06 / T-62-07 | Client tests prove DTO normalization, edit payload builders, API request bodies, stale error preservation, receipt gating, and stale editor blocking. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/store.test.ts tests/unit/meal-edit-screen.test.ts tests/unit/chat-bubble-contract.test.ts` | yes | pending |
| 62-04-02 | 04 | 3 | FRESH-01, FRESH-03 | T-62-06 / T-62-07 | Client implementation sends `expectedMealRevisionId`, shows UI-SPEC stale copy, refreshes/invalidates affected rows, and keeps receipts without `mealRevisionId` display-only. | source + unit | `yarn tsc --noEmit && node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/store.test.ts tests/unit/meal-edit-screen.test.ts tests/unit/chat-bubble-contract.test.ts` | yes | pending |
| 62-04-03 | 04 | 3 | FRESH-01, FRESH-02, FRESH-03 | T-62-01 / T-62-02 / T-62-06 / T-62-07 | Phase closure proves all targeted backend, chat, client, unit, integration, and release gates pass without Phase 63 SSE scope. | full gate | `yarn tsc --noEmit && yarn test:unit && yarn test:integration && yarn release:check` | yes | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] Extend `tests/unit/meal-transactions.test.ts` for missing/stale expected revision update and delete rejection with no extra revision rows.
- [ ] Extend `tests/integration/meals-api.test.ts` for direct route missing/stale `409` response shape and no summary/publish side effects.
- [ ] Extend chat/tool tests to prove resolved update/delete paths carry expected revision identity and stale writes fail closed.
- [ ] Extend client API, edit-payload, meal-edit-screen, and store tests for DTO normalization, request bodies, stale guidance, and row refresh/invalidation.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | FRESH-01, FRESH-02, FRESH-03 | All Phase 62 behaviors are expected to have automated coverage. | N/A |

---

## Validation Sign-Off

- [ ] All tasks have automated verify commands or Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify.
- [ ] Wave 0 covers all missing references.
- [ ] No watch-mode flags.
- [ ] Feedback latency target is under 60 seconds for targeted gates.
- [ ] `nyquist_compliant: true` set in frontmatter after plan-checker and execution verification confirm coverage.

**Approval:** pending
