---
phase: 75
slug: grouped-meal-direct-crud-contract
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-03
---

# Phase 75 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` through repo scripts |
| **Config file** | `package.json`; timezone wrapper in `scripts/run-node-with-tz.mjs` |
| **Quick run command** | `yarn tsc --noEmit` and `yarn test:integration` |
| **Full suite command** | `yarn test` |
| **Estimated runtime** | Integration/TypeScript gates are the required per-task feedback loop; full suite is the wave/phase gate when touched paths expand beyond the route/service contract. |

---

## Sampling Rate

- **After every task commit:** Run `yarn tsc --noEmit`; run `yarn test:integration` for `server/routes/*.ts` or `server/services/*.ts` edits.
- **After every plan wave:** Run `yarn test` when grouped route behavior and transaction/service tests changed across the wave.
- **Before `$gsd-verify-work`:** `yarn tsc --noEmit` and targeted tests required by changed paths must be green; `yarn release:check` is only required before staging/main promotion.
- **Max feedback latency:** No three consecutive implementation tasks may omit an automated verification command.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 75-01-01 | 01 | 1 | GROUP-EDIT-01 | T-75-01 | Strict grouped write parser rejects malformed or mixed request bodies before mutation. | integration | `yarn test:integration` | yes: `tests/integration/meals-api.test.ts` | pending |
| 75-01-02 | 01 | 1 | GROUP-EDIT-01, GROUP-EDIT-02, GROUP-EDIT-03 | T-75-02 | Valid full-list replacement persists the submitted ordered list under the expected revision without model/chat authority. | integration | `yarn test:integration` | yes: `tests/integration/meals-api.test.ts` | pending |
| 75-02-01 | 02 | 2 | GROUP-EDIT-04 | T-75-03 | Missing/stale revision conflicts return the existing 409 body and do not recompute summary or publish realtime events. | integration | `yarn test:integration` | yes: `tests/integration/meals-api.test.ts` | pending |
| 75-02-02 | 02 | 2 | GROUP-EDIT-04 | T-75-04 | Successful grouped writes preserve affected-date summaryOutcome and meal_mutation publish behavior. | integration | `yarn test:integration` | yes: `tests/integration/meals-api.test.ts` | pending |
| 75-03-01 | 03 | 3 | GROUP-EDIT-01, GROUP-EDIT-02, GROUP-EDIT-03 | T-75-05 | Persisted item order/history/image preservation are proven directly or by focused transaction unit coverage where route assertions cannot observe them. | integration/unit | `yarn test:integration`; `yarn test:unit` if `tests/unit/meal-transactions.test.ts` changes | yes: `tests/unit/meal-transactions.test.ts` | pending |
| 75-03-02 | 03 | 3 | GROUP-EDIT-04 | T-75-06 | Final TypeScript and route/service regression gates remain green before phase execution closes. | type/integration | `yarn tsc --noEmit`; `yarn test:integration` | yes: `package.json` scripts | pending |

---

## Wave 0 Requirements

- [ ] `tests/integration/meals-api.test.ts` - add failing integration coverage for valid grouped replacement, 1-to-many, many-to-one, many-to-many, empty list, wrong positions, invalid item fields, mixed scalar plus `items[]`, stale/missing revisions, image preservation, scalar-on-grouped rejection, and summary/publish side effects.
- [ ] `tests/unit/meal-transactions.test.ts` - add focused transaction tests only if route coverage cannot prove ordered persistence, revision history, or image preservation directly enough.
- [ ] Existing infrastructure covers the phase; do not add Jest, Vitest, new packages, or schema tooling.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | GROUP-EDIT-01 through GROUP-EDIT-04 | Phase 75 is a server contract and should be proven through automated Fastify/SQLite tests. | N/A |

---

## Validation Sign-Off

- [x] All tasks have automated verification or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing references
- [x] No watch-mode flags
- [x] Feedback latency bounded by TypeScript plus integration gates
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending execution
