---
phase: 61
slug: committed-mutation-outcome-and-summary-contract
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-17
---

# Phase 61 - Validation Strategy

> Per-phase validation contract for committed mutation outcomes when post-commit summary refresh degrades.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` on Node v24.14.0, executed through `tsx` |
| **Config file** | none dedicated; scripts live in `package.json`, tests use `scripts/run-node-with-tz.mjs` |
| **Quick run command** | `node scripts/run-node-with-tz.mjs --import tsx --test <targeted test file>` |
| **Full suite command** | `yarn test` |
| **Estimated runtime** | ~120 seconds for targeted route/tool suites; full runtime depends on release gate load |

---

## Sampling Rate

- **After every task commit:** Run `yarn tsc --noEmit` plus the targeted `node scripts/run-node-with-tz.mjs --import tsx --test <file>` command for edited tests.
- **After every plan wave:** Run `yarn test:unit` and `yarn test:integration` when backend route/service/orchestrator behavior changed.
- **Before `$gsd-verify-work`:** `yarn tsc --noEmit && yarn test && yarn release:check` must pass.
- **Max feedback latency:** 180 seconds for targeted feedback before falling back to full suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 61-01-01 | 01 | 0 | MUT-01, MUT-02, MUT-03, MUT-04 | T-61-01 | Summary outcome helper never logs raw user, tool, provider, image, session, or DB payload data. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/summary-outcome.test.ts` | no, Wave 0 if helper gets new unit file | pending |
| 61-02-01 | 02 | 1 | MUT-01 | T-61-02 | `log_food` returns committed facts and `summaryOutcome.recovered` or `summaryOutcome.unavailable` after SQLite commit when summary recompute/recovery degrades. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | yes | pending |
| 61-03-01 | 03 | 1 | MUT-02 | T-61-02 | `update_meal` returns committed update receipt and does not convert post-commit summary failure into mutation failure. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-streaming.test.ts` | yes | pending |
| 61-04-01 | 04 | 1 | MUT-03 | T-61-02 | `delete_meal` returns committed delete receipt and does not convert post-commit summary failure into mutation failure. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-streaming.test.ts` | yes | pending |
| 61-05-01 | 05 | 2 | MUT-04 | T-61-03 | Direct `PATCH` and `DELETE` keep HTTP 200 after committed mutation and expose body-level `summaryOutcome` for degraded summary availability. | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` | yes | pending |
| 61-06-01 | 06 | 2 | MUT-04 | T-61-04 | Client HTTP parsing treats missing top-level `dailySummary` with committed `summaryOutcome.unavailable` as summary unavailable, not mutation failure. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/meal-edit-screen.test.ts` | yes | pending |

---

## Wave 0 Requirements

- [ ] Add or extend helper-focused coverage for `SummaryOutcome` projection and recovery status shape, either in `tests/unit/summary-outcome.test.ts` or an existing focused unit file.
- [ ] Add deterministic summary recompute failure and recovery failure fixtures before changing direct route assertions.
- [ ] Confirm tests assert that top-level `dailySummary` exists only when `summaryOutcome.status` is `fresh` or `recovered`.
- [ ] Confirm tests assert publish failure is metadata-only and does not appear as a `summaryOutcome` status or reason.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | MUT-01, MUT-02, MUT-03, MUT-04 | Existing Node/Fastify/SQLite tests can cover the phase behaviors. | All phase behaviors have automated verification. |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target < 180s for targeted checks.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-17
