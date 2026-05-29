---
phase: 65
slug: tool-contract-alignment-and-meal-period-authority
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-27
---

# Phase 65 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` with `node:assert/strict` |
| Config file | None; package scripts call `node scripts/run-node-with-tz.mjs --import tsx --test ...` |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test <targeted files>` |
| Full suite command | `yarn test`; closeout gate `yarn release:check` |
| Estimated runtime | Targeted files: under 60 seconds; full suite/release gate depends on environment |

---

## Sampling Rate

- After every task commit: run the narrowest targeted test command for edited paths plus `yarn tsc --noEmit` after any TypeScript edit.
- After every plan wave: run `yarn test:unit`; add `yarn test:integration` when routes, services, orchestrator flows, or DTO contracts changed.
- Before `$gsd-verify-work`: run `yarn tsc --noEmit` and `yarn release:check`.
- Max feedback latency: use targeted single-file test commands inside plans before broad suite gates.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 65-TBD-TOOL-01 | TBD | TBD | TOOL-01 | T65-01 | JSON schema no longer requires `protein_sources`; Zod still accepts omission. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/tool-contract.test.ts tests/unit/system-prompt.test.ts` | yes | green |
| 65-TBD-TOOL-02 | TBD | TBD | TOOL-02 | T65-02 | Trusted-protein counted/excluded/weak-source behavior remains backend-owned. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/protein-trust.test.ts` | yes | green |
| 65-TBD-TOOL-03 | TBD | TBD | TOOL-03 | T65-03 | Text/image logging receipts still expose committed facts and `summaryOutcome` without raw model mutation authority. | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts tests/integration/orchestrator.test.ts` | yes | green |
| 65-TBD-INTENT-01 | TBD | TBD | INTENT-01 | T65-04 | Source-text-backed meal-period words persist as explicit authority while `loggedAt` date/time semantics remain intact. | unit/integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/meal-transactions.test.ts tests/integration/chat-api.test.ts` | yes | green |
| 65-TBD-INTENT-02 | TBD | TBD | INTENT-02 | T65-05 | Meal row, history, receipt, update, and edit payload DTOs project explicit `mealPeriod` and omit it for legacy rows. | unit/integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/home-dashboard-contract.test.ts tests/unit/history-screen-contract.test.ts tests/unit/history-day-detail-screen.test.ts tests/unit/summary-detail-screen.test.ts tests/unit/meal-edit-payload.test.ts tests/integration/meals-api.test.ts tests/integration/day-snapshot-api.test.ts tests/integration/history-api.test.ts` | yes | green |
| 65-TBD-INTENT-03 | TBD | TBD | INTENT-03 | T65-06 | Correction candidates expose effective `mealPeriod` plus `mealPeriodSource` without changing Phase 67 ranking policy. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` | yes | green |

---

## Wave 0 Requirements

- [ ] Plans must identify the generated Drizzle migration and schema verification path for nullable `meal_period`.
- [ ] Plans must add or extend focused tests for explicit `mealPeriod` write/read, ordinary edit preservation, and legacy null fallback.
- [ ] Plans must add or extend focused client helper tests proving `mealPeriod` label preference over `loggedAt` and fallback when missing.
- [ ] Plans must include metadata-only proof language; tests and artifacts must not persist raw prompts, user text, assistant final text, tool raw payloads, image data, session material, or database snapshots.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None expected | TOOL-01, TOOL-02, TOOL-03, INTENT-01, INTENT-02, INTENT-03 | Phase behavior is suitable for unit/integration proof. | All phase behaviors must have automated assertions. |

---

## Validation Sign-Off

- [x] All requirements have an automated verification target.
- [x] Sampling continuity: no 3 consecutive tasks should proceed without automated verification.
- [x] Wave 0 gaps are identified for migration, persistence, DTO, UI helper, and candidate-source proof.
- [x] No watch-mode flags are used.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** complete
