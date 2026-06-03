---
phase: 77
slug: history-loading-stabilization-and-local-proof-gate
status: passed
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-04
---

# Phase 77 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` with `tsx` |
| **Config file** | `package.json` scripts; no separate unit test config |
| **Quick run command** | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts tests/unit/history-week.test.ts tests/unit/meal-edit-refresh.test.ts` |
| **Full suite command** | `yarn release:check` |
| **Estimated runtime** | ~20-90 seconds for focused unit/source contracts; release gate depends on full suite/build runtime |

---

## Sampling Rate

- **After every task commit:** Run the narrow command for touched files; always run `yarn tsc --noEmit` after TypeScript edits.
- **After every plan wave:** Run focused History source/unit tests plus any changed Phase 77 visual evidence script command.
- **Before `$gsd-verify-work`:** Run the representative v2.6 local closure matrix, Phase 77 visual proof, `yarn tsc --noEmit`, and `yarn release:check`.
- **Max feedback latency:** Keep routine task feedback under ~90 seconds where practical; reserve `yarn release:check` for phase closure.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 77-01-01 | 01 | 1 | HIST-UX-01 | T-77-01 | Pending History UI must not expose stale rows or wrong edit identity | source/unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts tests/unit/history-week.test.ts` | yes | green |
| 77-01-02 | 01 | 1 | HIST-UX-01 | T-77-02 | Day Detail and Meal Edit activation remain snapshot-backed | source/unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts` | yes | green |
| 77-02-01 | 02 | 2 | PROOF-01, PROOF-02 | T-77-03 | Visual evidence uses synthetic data and metadata-only manifests | browser/script + artifact review | `node tests/harness/scenarios/77-history-loading-visual.mjs` | yes | green |
| 77-02-02 | 02 | 2 | PROOF-01 | T-77-04 | Representative v2.6 commands prove Home edit, grouped CRUD, grouped Meal Edit, and History loading surfaces | unit/integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/meal-edit-refresh.test.ts`; `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts`; `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-grouped-draft.test.ts tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts`; `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts tests/unit/history-week.test.ts tests/unit/meal-edit-refresh.test.ts` | yes | green |
| 77-03-01 | 03 | 3 | PROOF-03 | T-77-05 | Closure records no-promotion boundary and final local release gate only | static/release | `yarn tsc --noEmit` and `yarn release:check` | yes | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] Update or add source contracts in `tests/unit/history-screen-contract.test.ts` for target-context cold week switches, no top-level `載入這週紀錄中...` card, inline `同步這天紀錄中...`, no stale/skeleton rows, and snapshot-backed empty/detail behavior.
- [x] Add or adapt a Phase 77 synthetic mobile visual evidence script, using the Phase 49 pattern, with delayed cold-week data and metadata-only manifest output.
- [x] Define the Phase 77 closure matrix artifact path and metadata policy before recording final proof.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Screenshot review for cold week switch stability | HIST-UX-01, PROOF-01, PROOF-02 | Source assertions cannot prove the visual layout remains stable on mobile | Review the Phase 77 synthetic mobile screenshots/manifest for target week context, inline pending state, absence of `載入這週紀錄中...`, and metadata-only contents |
| Local closure and no-promotion note | PROOF-03 | Promotion authority is a human workflow boundary | Confirm closure notes say local proof and `yarn release:check` do not authorize staging/main promotion |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity: no 3 consecutive tasks without automated verify.
- [x] Wave 0 covers all missing references.
- [x] No watch-mode flags.
- [x] Feedback latency stays under the per-task target where practical, with `yarn release:check` reserved for closure.
- [x] Set `nyquist_compliant: true` after plans allocate Wave 0 gaps and verification commands.

**Approval:** passed

Promotion authority remains separate: local proof and `yarn release:check` do not authorize staging or main promotion without explicit current-thread approval.
