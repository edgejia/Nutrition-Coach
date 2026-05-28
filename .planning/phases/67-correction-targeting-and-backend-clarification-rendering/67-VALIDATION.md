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
| **Quick run command** | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-meal-correction.integration.test.ts` |
| **Full suite command** | `yarn test` |
| **Estimated runtime** | ~60 seconds targeted; full suite varies |

---

## Sampling Rate

- **After every task commit:** Run the targeted command for touched tests plus `yarn tsc --noEmit` for TypeScript edits.
- **After every plan wave:** Run `yarn test:unit` after service/orchestrator unit changes and `yarn test:integration` after route/service behavior changes.
- **Before `$gsd-verify-work`:** `yarn tsc --noEmit`, targeted Phase 67 unit/integration command, `yarn test:unit`, and `yarn test:integration` must be green.
- **Max feedback latency:** 120 seconds for targeted checks during execution.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 67-01-01 | 01 | 0 | TARGET-01 | T-67-01 | Resolver does not mutate or retarget across device/action scope while tests are red-first. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` | yes | pending |
| 67-02-01 | 02 | 1 | TARGET-01 | T-67-01 / T-67-02 | Explicit date scope, label evidence, explicit persisted period, inferred period fallback, and allowed recent-reference tie-breaks are enforced by backend ranking. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` | yes | pending |
| 67-03-01 | 03 | 2 | TARGET-02 | T-67-03 | Clarification options are stable, numbered, backend-derived, and store the same option set used by pending selection. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts` | yes | pending |
| 67-04-01 | 04 | 3 | TARGET-02 | T-67-03 / T-67-04 | `find_meals` clarification/not-found output is renderer-owned terminal copy that the model cannot paraphrase or turn into success copy. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts tests/unit/tools.test.ts` | yes | pending |
| 67-05-01 | 05 | 4 | TARGET-01, TARGET-02 | T-67-02 / T-67-04 | Fastify chat path proves stable numbered backend copy, no mutation, no `summaryOutcome`, no publish, and no raw correction echo. | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-meal-correction.integration.test.ts` | yes | pending |
| 67-06-01 | 06 | 5 | TARGET-01, TARGET-02 | T-67-01 / T-67-02 / T-67-03 / T-67-04 | Final TypeScript and unit/integration gates prove the phase contract without changing promotion branches. | typecheck + unit + integration | `yarn tsc --noEmit && yarn test:unit && yarn test:integration` | yes | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/meal-correction.test.ts` - red-first cases for explicit period over inferred period, period plus `那餐` with newer non-matching meal, invalid number re-show, label-set clarification ordering, and unmatched food label no-fallback behavior.
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
- [ ] Feedback latency < 120s for targeted checks.
- [ ] `nyquist_compliant: true` set in frontmatter after Wave 0 proof is in place.

**Approval:** pending
