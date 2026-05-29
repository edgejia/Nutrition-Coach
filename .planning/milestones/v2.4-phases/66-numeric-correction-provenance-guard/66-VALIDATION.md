---
phase: 66
slug: numeric-correction-provenance-guard
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-28
---

# Phase 66 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` with `tsx` |
| **Config file** | `package.json` scripts and `scripts/run-node-with-tz.mjs` |
| **Quick run command** | `yarn test:unit` |
| **Full suite command** | `yarn test` |
| **Estimated runtime** | Use existing suite runtime; targeted file runs should be used after each task commit |

---

## Sampling Rate

- **After every task commit:** Run the targeted `node scripts/run-node-with-tz.mjs --import tsx --test <test-file>` command for changed test files, plus `yarn tsc --noEmit` after TypeScript edits.
- **After every plan wave:** Run `yarn test:unit` and `yarn test:integration` for orchestrator, service, or route changes.
- **Before `$gsd-verify-work`:** Run `yarn tsc --noEmit`, `yarn test:unit`, and `yarn test:integration`. Use `yarn release:check` only for promotion readiness.
- **Max feedback latency:** Keep task-level checks scoped to the edited files before broader wave gates.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 66-W0-01 | TBD | 0 | CORR-01 | T-66-01 | Explicit current-turn numeric evidence authorizes only the matching numeric meal fields, including `items[]`. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/source-text-guard.test.ts` | yes | green |
| 66-W0-02 | TBD | 0 | CORR-01 | T-66-02 | Backend-owned proposal state is single-use, same-kind replaceable, revision-scoped, and never LLM-originated. | unit | `yarn test:unit` | yes | green |
| 66-W0-03 | TBD | 0 | CORR-02 | T-66-03 | Vague non-computable correction requests return renderer-owned clarification and no meal mutation. | integration | `yarn test:integration` | yes | green |
| 66-W0-04 | TBD | 0 | CORR-03 | T-66-04 | Blocked or stale correction attempts create no revision, publish no `daily_summary`, and produce no success-style final copy. | integration | `yarn test:integration` | yes | green |
| 66-W0-05 | TBD | 0 | CORR-01, CORR-03 | T-66-05 | Bare approval fails closed when goal and meal proposals coexist; broad cancel clears active proposal kinds without mutation. | unit + integration | `yarn test:unit && yarn test:integration` | yes | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] Extend or add helper-level tests for Arabic integers, Arabic decimals, common Chinese numeral compounds, bare Chinese digits, unit variants, relative-operator classification, and `items[]` numeric authorization.
- [ ] Add proposal service tests for put/get/clear/expiry/same-kind replacement if a separate `meal-numeric-proposals` service is introduced.
- [ ] Add orchestrator tests for renderer-owned blocked replies, proposal creation, approval, cancel, cross-kind ambiguity, and no second-model-round success rewrite.
- [ ] Add integration tests for vague correction no-mutation side effects and stale proposal approval through the existing meal revision precondition path.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None planned | CORR-01, CORR-02, CORR-03 | Phase 66 behaviors should be covered by unit/integration tests | N/A |

---

## Validation Sign-Off

- [x] All planned behaviors have automated verification paths.
- [x] Sampling continuity avoids three consecutive tasks without an automated check.
- [x] Wave 0 covers missing helper/proposal/cross-kind proof.
- [x] No watch-mode flags.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** complete
