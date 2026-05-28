---
phase: 67
slug: correction-targeting-and-backend-clarification-rendering
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-29
---

# Phase 67 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` under Node v24.14.0 |
| **Config file** | none - package scripts run Node test directly |
| **Quick task-level command pattern** | `node scripts/run-node-with-tz.mjs --import tsx --test <single touched test file>` |
| **Broad Phase 67 command** | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-meal-correction.integration.test.ts` |
| **Full suite command** | `yarn test` |
| **Estimated runtime** | <30 seconds for task-level single-file checks; ~60 seconds for broad Phase 67 command; full suite varies |

---

## Sampling Rate

- **After every task commit:** Run the narrowest touched-test command from the Per-Task Verification Map. For TypeScript production edits, run `yarn tsc --noEmit` after the narrow test is green or before committing the task.
- **After every plan wave:** Run `yarn test:unit` after service/orchestrator unit changes and `yarn test:integration` after route/service behavior changes.
- **Before `$gsd-verify-work`:** `yarn tsc --noEmit`, targeted Phase 67 unit/integration command, `yarn test:unit`, and `yarn test:integration` must be green.
- **Max feedback latency:** <30 seconds for task-level feedback loops where a single touched test file can isolate the behavior. Broad Phase 67, unit, integration, and typecheck gates are reserved for wave/final checks.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 67-01-01 | 01 | 0 | TARGET-01 | T-67-01 | Resolver does not mutate or retarget across device/action scope while tests are red-first; D-30 single-date no-safe-target tests cover same-date recovery list and no-meals copy. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` | yes | pending |
| 67-02-01 | 02 | 1 | TARGET-01 | T-67-01 / T-67-02 | Explicit date scope, label evidence, explicit persisted period, inferred period fallback, allowed recent-reference tie-breaks, and D-30 date-scoped recovery are enforced by backend ranking. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` | yes | pending |
| 67-03-01 | 03 | 2 | TARGET-02 | T-67-03 | Clarification options are stable, numbered, backend-derived, and D-30 recovery/no-meals outputs are renderer-owned. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/mutation-receipts.test.ts` then `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts` | yes | pending |
| 67-04-01 | 04 | 3 | TARGET-02 | T-67-03 / T-67-04 | `find_meals` clarification/not-found output is renderer-owned terminal copy that the model cannot paraphrase or turn into success copy. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` then `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/system-prompt.test.ts` | yes | pending |
| 67-05-01 | 05 | 4 | TARGET-01, TARGET-02 | T-67-02 / T-67-04 | Fastify chat path proves stable numbered backend copy, no mutation, no `summaryOutcome`, no publish, and no raw correction echo. | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-meal-correction.integration.test.ts` | yes | pending |
| 67-06-01 | 06 | 5 | TARGET-01, TARGET-02 | T-67-01 / T-67-02 / T-67-03 / T-67-04 | Final TypeScript and unit/integration gates prove the phase contract without changing promotion branches. | typecheck + unit + integration | `yarn tsc --noEmit && yarn test:unit && yarn test:integration` | yes | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/meal-correction.test.ts` - red-first cases for explicit period over inferred period, period plus `那餐` with newer non-matching meal, invalid number re-show, label-set clarification ordering, unmatched food label no-fallback behavior, and D-30 clear single-date no-safe-target recovery: same-date meals -> numbered list, no meals -> no-meals copy, no cross-date nearest candidates.
- [ ] `tests/unit/orchestrator.test.ts` - red-first renderer-owned terminal clarification case where the LLM attempts to paraphrase or echo raw target text after `find_meals`.
- [ ] `tests/unit/tools.test.ts` - red-first controlled `find_meals` result proof if the renderer contract is added at the tool boundary.
- [ ] `tests/integration/chat-meal-correction.integration.test.ts` - red-first Fastify proof for stable numbered backend copy, no mutation, no `summaryOutcome`, no publish, and no raw correction echo.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| none | TARGET-01, TARGET-02 | All phase behaviors have automated unit or integration proof surfaces. | N/A |

---

## Validation Sign-Off

- [ ] All tasks have automated verify commands or Wave 0 dependencies.
- [ ] Sampling continuity: no 3 consecutive implementation tasks without automated verify.
- [ ] Wave 0 covers all missing references.
- [ ] No watch-mode flags.
- [ ] Feedback latency <30s for task-level single-file checks; broad gates are reserved for wave/final checks.
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 proof is in place.

**Approval:** pending
