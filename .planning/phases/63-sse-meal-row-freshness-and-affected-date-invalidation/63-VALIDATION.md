---
phase: 63
slug: sse-meal-row-freshness-and-affected-date-invalidation
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-18
---

# Phase 63 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` with `node:assert/strict` |
| **Config file** | `package.json`; no Jest/Vitest config |
| **Quick run command** | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-client.test.ts tests/unit/store.test.ts` plus any new coordinator test |
| **Full suite command** | `yarn test` |
| **Estimated runtime** | ~60-180 seconds for targeted checks; full suite varies |

---

## Sampling Rate

- **After every task commit:** Run the narrow command matching touched files, and run `yarn tsc --noEmit` after any TypeScript edit.
- **After every plan wave:** Run `yarn test:unit` for client parser/coordinator/store work and `yarn test:integration` for route/publisher envelope work.
- **Before `$gsd-verify-work`:** `yarn tsc --noEmit` and `yarn test` must be green.
- **Max feedback latency:** Prefer targeted checks under 3 minutes before broader gates.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 63-01-01 | TBD | 1 | REAL-01 | T-63-01 | Server publishes only authenticated-device `daily_summary` envelopes with `summary`, `affectedDate`, and `source`. | integration | `yarn test:integration` or targeted `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/sse.test.ts tests/integration/meals-api.test.ts tests/integration/chat-api.test.ts` | yes | pending |
| 63-02-01 | TBD | 1 | REAL-03 | T-63-02 | Malformed, invalid-source, impossible-date, future-date, and date-mismatched frames mutate no client state. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-client.test.ts` | yes | pending |
| 63-03-01 | TBD | 2 | REAL-02 | T-63-03 | Same-day SSE summaries commit only after latest-token row refetch succeeds. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-summary-coordinator.test.ts tests/unit/store.test.ts` | no | pending |
| 63-04-01 | TBD | 2 | REAL-03 | T-63-04 | Historical affected-date events never call today's summary commit path and refresh only matching visible historical surfaces. | unit + integration | `yarn test:unit && yarn test:integration` | partial | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/sse-client.test.ts` - strict `daily_summary` envelope parser cases.
- [ ] `tests/unit/sse-summary-coordinator.test.ts` - create if planner extracts coordinator logic.
- [ ] `tests/integration/sse.test.ts` - initial and mutation envelope assertions.
- [ ] `tests/integration/meals-api.test.ts` / `tests/integration/chat-api.test.ts` - affected-date publish assertions for direct and chat mutation paths.
- [ ] History or Day Detail test coverage selected by planner if visible historical refresh wiring is changed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Public beta deployed-domain realtime smoke | REAL-01, REAL-02, REAL-03 | Local EventSource tests prove contracts, but deployed Railway smoke proves same-origin cookies and live SSE behavior. | Follow `docs/deploy/railway-beta.md` only when preparing staging/promotion; not required for local plan execution. |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity avoids long runs without automated verification.
- [x] Wave 0 covers missing references.
- [x] No watch-mode flags.
- [x] Feedback latency target is defined.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-05-18
