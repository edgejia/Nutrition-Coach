---
status: complete
phase: 62-meal-revision-tokens-and-stale-receipt-protection
source:
  - 62-01-SUMMARY.md
  - 62-02-SUMMARY.md
  - 62-03-SUMMARY.md
  - 62-04-SUMMARY.md
  - 62-05-SUMMARY.md
started: 2026-05-18T00:32:47+08:00
updated: 2026-05-18T00:32:47+08:00
---

## Current Test

[testing complete]

## Tests

### 1. Current Receipts Remain Editable
expected: Current meal rows, day snapshots, history rows, and active chat receipts carry meal revision identity only when they can safely start an edit. Receipts without complete identity stay display-only.
result: pass
evidence: `yarn test:unit` passed DTO, chat receipt, edit payload, and chat bubble assertions for `mealRevisionId` projection and display-only stale/deleted receipts.

### 2. Stale Direct Edits Fail Closed
expected: If an older Meal Edit or Summary Detail delete request submits a stale `expectedMealRevisionId`, the server returns a stable stale revision conflict before writing a new revision, recomputing summaries, or publishing realtime updates.
result: pass
evidence: `tests/integration/meals-api.test.ts` passed missing/stale direct PATCH and DELETE coverage, stale single-to-current-grouped ordering, guard-after-race behavior, and deleted-target stale conflict assertions.

### 3. Stale Chat Corrections Fail Closed
expected: Chat update/delete tools use the backend-resolved meal revision from `find_meals`. If that target is updated or deleted before mutation, the tool fails closed without success receipts, summary outcomes, or publish side effects.
result: pass
evidence: `tests/unit/tools.test.ts`, `tests/unit/meal-correction.test.ts`, and `tests/integration/chat-meal-correction.integration.test.ts` passed resolver-owned target, id-only rejection, stale update/delete, and deleted update-target coverage.

### 4. Stale Conflict UI Gives Deterministic Recovery
expected: The client preserves typed `MEAL_REVISION_REQUIRED` / `MEAL_REVISION_STALE` metadata, shows deterministic Traditional Chinese stale guidance, blocks stale editor reuse, redacts stale receipt identity, and records affected-date invalidation.
result: pass
evidence: `yarn test:unit` passed API conflict metadata, store redaction/mutation recording, Meal Edit stale copy/blocking, and Summary Detail typed conflict source-contract tests.

### 5. Committed Same-Day Mutations Refresh Rows Without dailySummary
expected: Successful same-day edit/delete commits refresh visible meal rows even when summary recovery is unavailable and no top-level `dailySummary` is returned. Follow-up refresh failure does not turn an already committed write into a mutation failure.
result: pass
evidence: `tests/unit/meal-edit-refresh.test.ts`, `tests/unit/meal-edit-screen.test.ts`, and `tests/unit/summary-detail-screen.test.ts` passed affectedDate-keyed row refresh and post-commit refresh-failure containment checks.

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

None.

## Gates Run

- `yarn tsc --noEmit` - PASS.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/unit/meal-edit-screen.test.ts tests/unit/summary-detail-screen.test.ts` - PASS: 65 tests.
- `yarn test:unit` - PASS: 783 tests after gap-closure patches.
- `yarn test:integration` - PASS: 303 tests.
- `yarn test` - PASS: 1086 tests.
- `gsd-code-review` - PASS: `62-REVIEW.md` clean, 0 findings.
- `gsd-verifier` - PASS: `62-VERIFICATION.md` status passed, 8/8 must-haves.
- `gsd-secure-phase` - PASS: `62-SECURITY.md` threats_open 0, 31/31 threats closed.
- `gsd-validate-phase` - PASS: `62-VALIDATION.md` Nyquist compliant, 0 gaps remaining.
