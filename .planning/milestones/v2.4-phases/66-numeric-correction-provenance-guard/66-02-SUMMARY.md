---
phase: 66-numeric-correction-provenance-guard
plan: 02
subsystem: backend
tags: [turn-state, renderer-copy, numeric-correction, node-test, tdd]

requires:
  - phase: 66-numeric-correction-provenance-guard
    provides: current-turn meal numeric authority helper and nested items[] authorization proof
provides:
  - Turn-state-backed backend-owned meal numeric correction proposal storage
  - Renderer-owned Traditional Chinese proposal, blocked, cancel, clarification, and ambiguity copy
  - Unit proof for same-kind replacement, cross-kind coexistence, expiry, and no-internal-leak copy
affects: [phase-66, update_meal, meal_numeric_correction_proposal, mutation-receipts]

tech-stack:
  added: []
  patterns:
    - Turn-state per-device/per-kind proposal state using the Phase 60 goal proposal precedent
    - Renderer-owned meal numeric correction copy with explicit before/after affected fields

key-files:
  created:
    - server/services/meal-numeric-proposals.ts
    - tests/unit/meal-numeric-proposals.test.ts
  modified:
    - server/orchestrator/mutation-receipts.ts
    - tests/unit/mutation-receipts.test.ts

key-decisions:
  - "Meal numeric correction proposals use a distinct meal_numeric_correction_proposal turn-state kind, so meal proposals replace only same-kind meal proposals and can coexist with goal proposals."
  - "Meal numeric proposal payloads carry exactly one backend-computed update shape: either updateInput or items, plus meal id, expected revision, affected before/after fields, operator, createdAt, and expiresAt."
  - "Meal numeric blocked, clarification, cancel, and ambiguity copy is renderer-owned Traditional Chinese and excludes internal tool/state/proposal identifiers."

patterns-established:
  - "createMealNumericProposalService mirrors createGoalProposalService while adding exact update-shape validation and expiry metadata inside the stored payload."
  - "renderMealNumericProposalCopy lists every affected field with kcal/g units and before/after values, using item names or an explicit meal label for the target meal."

requirements-completed: [CORR-01, CORR-02, CORR-03]

duration: 4m 49s
completed: 2026-05-28
---

# Phase 66 Plan 02: Meal Numeric Proposal State and Copy Summary

**Turn-state-backed meal numeric correction proposals with renderer-owned before/after approval and no-update guidance copy**

## Performance

- **Duration:** 4m 49s
- **Started:** 2026-05-28T07:42:51Z
- **Completed:** 2026-05-28T07:47:40Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `createMealNumericProposalService` with `MEAL_NUMERIC_PROPOSAL_KIND`, 30-minute TTL, per-device same-kind upsert semantics, explicit expiry metadata, and clear/get helpers.
- Proved meal numeric proposals can store either backend-computed patch values or grouped replacement items, replace only same-kind state, expire, clear, and coexist with active `goal_proposal` state.
- Added renderer-owned meal numeric proposal, authority failure, clarification, cancel, and cross-kind ambiguity copy that shows concrete before/after values without leaking internal identifiers.

## Task Commits

1. **Task 1: Add proposal state lifecycle proof** - `4879935` (test)
2. **Task 2: Implement proposal service and renderer copy** - `a475bf0` (feat)

## Files Created/Modified

- `server/services/meal-numeric-proposals.ts` - Turn-state-backed meal numeric correction proposal service, payload types, TTL, and exact update-shape validation.
- `server/orchestrator/mutation-receipts.ts` - Renderer helpers for meal numeric proposal, blocked, clarification, cancel, and proposal-kind ambiguity copy.
- `tests/unit/meal-numeric-proposals.test.ts` - Real-SQLite lifecycle proof for storage, replacement, expiry, clearing, and goal proposal coexistence.
- `tests/unit/mutation-receipts.test.ts` - Renderer copy proof for target labels, affected fields, before/after values, no formulas, no-update wording, and forbidden internal terms.

## Decisions Made

- Meal numeric proposals intentionally use their own `meal_numeric_correction_proposal` turn-state kind rather than sharing or clearing goal proposal state.
- The stored meal proposal payload includes `expiresAt` in addition to turn-state row expiry so later approval paths can render or inspect proposal freshness without reconstructing TTL.
- The service rejects payloads that provide both `updateInput` and `items`, or neither, because approval must commit exactly one backend-computed mutation shape.
- Proposal copy can disclose another active proposal kind but asks for a kind-specific phrase so a bare approval does not silently choose between goal and meal proposals.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Task 1 RED verification failed as expected because `server/services/meal-numeric-proposals.ts` did not exist yet.
- A stub scan matched optional renderer parameter defaults (`= {}`) in `mutation-receipts.ts`; these are normal API defaults, not UI stubs or placeholder data.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-numeric-proposals.test.ts` - RED failed before implementation with missing module, as expected for Task 1.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-numeric-proposals.test.ts tests/unit/mutation-receipts.test.ts` - PASS, 25 tests.
- `yarn tsc --noEmit` - PASS.
- `yarn test:integration` - PASS, 313 tests.
- `yarn test:unit` - PASS, 862 tests.
- Source assertions - PASS: service exports distinct kind, uses `turnStateService.putState/getState/clearState`, and meal proposal tests/service do not use LLM tool arguments or assistant prose as proposal value sources.

## Known Stubs

None.

## Threat Flags

None - new turn-state and renderer-copy surfaces are covered by the plan threat model.

## Authentication Gates

None.

## Next Phase Readiness

Plan 66-03 can wire `update_meal` enforcement and deterministic proposal creation into the tool boundary using the stored meal id, exact expected revision, affected before/after fields, and renderer copy helpers created here.

## Self-Check: PASSED

- Created files exist: `server/services/meal-numeric-proposals.ts`, `tests/unit/meal-numeric-proposals.test.ts`.
- Modified files contain expected exports: `renderMealNumericProposalCopy`, `renderMealNumericAuthorityFailureCopy`, `renderMealNumericClarificationCopy`, `renderMealNumericCancelCopy`, and `renderProposalKindAmbiguityCopy`.
- Task commits exist: `4879935`, `a475bf0`.
- No tracked file deletions were introduced by task commits.

---
*Phase: 66-numeric-correction-provenance-guard*
*Completed: 2026-05-28*
