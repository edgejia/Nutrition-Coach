---
phase: 65-tool-contract-alignment-and-meal-period-authority
plan: 08
subsystem: services
tags: [meal-correction, meal-period, sqlite, node-test]

requires:
  - phase: 65-02
    provides: Nullable meal_transactions.meal_period with enum CHECK
  - phase: 65-01
    provides: Explicit mealPeriod persistence and normalization helper
provides:
  - MealCorrectionCandidate.mealPeriodSource provenance
  - Explicit-first correction candidate mealPeriod projection
  - Unit proof for explicit and inferred candidate period authority
affects: [phase-65, phase-67, correction-targeting]

tech-stack:
  added: []
  patterns:
    - Correction candidates carry effective facts plus explicit/inferred provenance
    - Persisted explicit mealPeriod wins before loggedAt fallback

key-files:
  created:
    - .planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-08-SUMMARY.md
  modified:
    - server/services/meal-correction.ts
    - tests/unit/meal-correction.test.ts

key-decisions:
  - "Correction candidates keep mealPeriod as the effective compatibility field and add mealPeriodSource for provenance."
  - "Explicit persisted mealPeriod is selected from meal_transactions and normalized before falling back to loggedAt inference."

patterns-established:
  - "Candidate fact projection may expose an inferred fallback only when tagged mealPeriodSource: inferred."

requirements-completed: [INTENT-03]

duration: 2m 41s
completed: 2026-05-27
---

# Phase 65 Plan 08: Correction Candidate Meal-Period Source Summary

**Correction candidates now expose effective meal period facts with explicit/inferred provenance for the Phase 67 scorer handoff.**

## Performance

- **Duration:** 2m 41s
- **Started:** 2026-05-27T13:29:57Z
- **Completed:** 2026-05-27T13:32:38Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Added `MealCorrectionCandidate.mealPeriodSource` with domain values `explicit` and `inferred`.
- Loaded persisted `meal_transactions.meal_period` for active correction candidates.
- Projected candidate `mealPeriod` from explicit persisted authority before falling back to `inferMealPeriod(loggedAt)`.
- Added unit regressions for explicit lunch at a breakfast-hour timestamp and legacy/no-authority breakfast-hour fallback.

## Task Commits

1. **Task 1 RED: Add failing meal period source candidate tests** - `41dd577` (test)
2. **Task 1 GREEN: Expose meal period source on correction candidates** - `69fc50c` (feat)

**Plan metadata:** committed after summary creation.

## Files Created/Modified

- `server/services/meal-correction.ts` - Selects persisted mealPeriod, projects explicit-first effective mealPeriod, and emits `mealPeriodSource`.
- `tests/unit/meal-correction.test.ts` - Covers explicit candidate authority and inferred legacy fallback.
- `.planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-08-SUMMARY.md` - Captures execution outcome.

## Decisions Made

- Kept ranking, tie-breaking, food-label precedence, pending selection behavior, and clarification copy unchanged; only the candidate fact projection changed.
- Used the existing `normalizeMealPeriod` helper so invalid/null persisted values cannot masquerade as explicit candidate authority.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Verification

- RED: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` - FAIL as expected on explicit lunch resolving as `not_found` and missing `mealPeriodSource`.
- GREEN targeted: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` - PASS, 22 tests.
- TypeScript: `yarn tsc --noEmit` - PASS.
- AGENTS service-edit gate: `yarn test:integration` - PASS, 311 tests.
- Acceptance source check: `rg -n "mealPeriodSource|mealTransactions\\.mealPeriod|normalizeMealPeriod|scoreCandidate|buildClarificationPrompt|matchesCandidateLabel|labelMatched" server/services/meal-correction.ts tests/unit/meal-correction.test.ts` - PASS; source/projection fields are present and ranking/clarification functions were inspected.

## Threat Flags

None - the stored meal facts to correction candidate facts boundary was covered by T-65-23 through T-65-25.

## Next Phase Readiness

INTENT-03 is now ready for Phase 67 to consume persisted explicit meal-period evidence without treating loggedAt fallback as equal authority. Remaining Phase 65 projection/UI plans can continue without needing candidate-ranking policy changes.

## Self-Check: PASSED

- Summary file created at `.planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-08-SUMMARY.md`.
- Key modified files exist: `server/services/meal-correction.ts`, `tests/unit/meal-correction.test.ts`.
- Task commits present: `41dd577`, `69fc50c`.
- No tracked file deletions were introduced by task commits.

---
*Phase: 65-tool-contract-alignment-and-meal-period-authority*
*Completed: 2026-05-27*
