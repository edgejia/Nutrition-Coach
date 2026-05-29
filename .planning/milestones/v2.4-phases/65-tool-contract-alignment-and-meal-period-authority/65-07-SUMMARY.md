---
phase: 65-tool-contract-alignment-and-meal-period-authority
plan: 07
subsystem: client
tags: [ui-labels, meal-period, accessibility, source-contract-tests]

requires:
  - phase: 65-06
    provides: Client MealPeriod DTO normalization and edit payload preservation
provides:
  - Home meal label and badge helpers that prefer explicit mealPeriod over loggedAt fallback
  - History, Day Detail, and Summary Detail row metadata using resolved meal-period labels
  - Accessibility labels on touched meal-row actions aligned with resolved meal labels
affects: [phase-65, meal-period, client-ui, history, summary-detail]

tech-stack:
  added: []
  patterns:
    - Shared UI label helpers accept explicit MealPeriod first and loggedAt fallback second
    - Source-contract unit tests lock UI projections without changing visual layout

key-files:
  created:
    - .planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-07-SUMMARY.md
  modified:
    - client/src/components/HomeScreen.tsx
    - client/src/components/HistoryScreen.tsx
    - client/src/components/HistoryDayDetailScreen.tsx
    - client/src/components/SummaryDetailScreen.tsx
    - tests/unit/home-dashboard-contract.test.ts
    - tests/unit/history-screen-contract.test.ts
    - tests/unit/history-day-detail-screen.test.ts
    - tests/unit/summary-detail-screen.test.ts

key-decisions:
  - "UI meal labels resolve explicit mealPeriod before loggedAt fallback; fallback remains display-only for missing or invalid authority."
  - "Touched row accessibility labels reuse the same resolver so visible and assistive labels do not diverge."

patterns-established:
  - "Call getDisplayMealLabel(meal.mealPeriod, meal.loggedAt) for meal-row display metadata."
  - "Call getMealBadge(meal.mealPeriod, meal.loggedAt) for Home badges."

requirements-completed: [INTENT-02]

duration: 4m 44s
completed: 2026-05-27
---

# Phase 65 Plan 07: UI Meal-Period Label Preference Summary

**Meal-row UI labels now display explicit mealPeriod authority before legacy loggedAt inference across Home, History, Day Detail, and Summary Detail.**

## Performance

- **Duration:** 4m 44s
- **Started:** 2026-05-27T14:05:20Z
- **Completed:** 2026-05-27T14:10:04Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Updated Home label and badge helpers to accept `mealPeriod` first, mapping `late_night` to `宵夜` and badge `N`.
- Preserved legacy `loggedAt` fallback labels, including snack `點心` and badge `S`, when explicit authority is absent or invalid.
- Updated History, Day Detail, and Summary Detail metadata to render `HH:mm · {resolvedLabel}`.
- Updated touched row action accessibility labels to include the resolved meal label before the food name.
- Added unit/source-contract proof for explicit authority preference, fallback behavior, and no new meal-period controls.

## Task Commits

1. **Task 1 RED: Add failing Home helper contract tests** - `4f6d29d` (test)
2. **Task 1 GREEN: Prefer explicit mealPeriod in Home rows** - `dbfd9b1` (feat)
3. **Task 2 RED: Add failing detail meal label tests** - `451ec74` (test)
4. **Task 2 GREEN: Resolve meal labels on history/detail rows** - `97cd9f8` (feat)

**Plan metadata:** committed after summary creation.

## Files Created/Modified

- `client/src/components/HomeScreen.tsx` - Adds explicit-first label and badge helpers, including `宵夜`/`N`, and passes `meal.mealPeriod` from Home rows.
- `client/src/components/HistoryScreen.tsx` - Uses shared label helpers for timeline metadata and edit aria labels.
- `client/src/components/HistoryDayDetailScreen.tsx` - Uses shared label helpers for read-only day detail metadata.
- `client/src/components/SummaryDetailScreen.tsx` - Uses shared label helpers for summary detail metadata and touched row action aria labels.
- `tests/unit/home-dashboard-contract.test.ts` - Proves explicit `mealPeriod` wins over conflicting `loggedAt` and fallback labels remain intact.
- `tests/unit/history-screen-contract.test.ts` - Locks History metadata and edit aria labels to resolved labels.
- `tests/unit/history-day-detail-screen.test.ts` - Locks Day Detail metadata to resolved labels.
- `tests/unit/summary-detail-screen.test.ts` - Renders explicit and fallback labels in Summary Detail and rejects new meal-period controls.
- `.planning/STATE.md` - Records Phase 65 Plan 07 completion context.
- `.planning/ROADMAP.md` - Marks Phase 65 Plan 07 and Phase 65 complete.

## Decisions Made

- Explicit enum authority is preferred for display everywhere touched by this plan; `loggedAt` inference remains only a legacy display fallback.
- Summary Detail delete aria labels also include the resolved meal label, matching the same accessibility principle without adding or changing visible controls.

## Deviations from Plan

None - plan executed as written. The Summary Detail delete aria-label alignment was an accessibility-only extension of the plan's resolved-label rule for touched row actions and did not change UI controls, copy, spacing, color, or layout.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Stub-pattern scan only found existing source-contract wording containing "placeholder" and an existing CSS placeholder class used for loading display, not unwired UI data.

## Verification

- RED Task 1: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts` - FAIL as expected on explicit label/badge preference and source call-shape assertions.
- GREEN Task 1: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts && yarn tsc --noEmit` - PASS, 8 tests and TypeScript green.
- Task 1 source acceptance: `rg -n "getDisplayMealLabel\\(meal\\.mealPeriod, meal\\.loggedAt\\)|getMealBadge\\(meal\\.mealPeriod, meal\\.loggedAt\\)|home-sport-meal-meta|home-sport-meal-row" client/src/components/HomeScreen.tsx tests/unit/home-dashboard-contract.test.ts` - PASS.
- RED Task 2: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts tests/unit/history-day-detail-screen.test.ts tests/unit/summary-detail-screen.test.ts` - FAIL as expected on missing shared helper imports, time-only metadata, and food-only edit aria label.
- GREEN Task 2: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts tests/unit/history-day-detail-screen.test.ts tests/unit/summary-detail-screen.test.ts && yarn tsc --noEmit` - PASS, 28 tests and TypeScript green.
- AGENTS unit-test gate: `yarn test:unit` - PASS, 839 tests.
- Final targeted: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/history-screen-contract.test.ts tests/unit/history-day-detail-screen.test.ts tests/unit/summary-detail-screen.test.ts && yarn tsc --noEmit` - PASS, 36 tests and TypeScript green.

## TDD Gate Compliance

- RED commits present before implementation: `4f6d29d`, `451ec74`.
- GREEN commits present after RED: `dbfd9b1`, `97cd9f8`.
- Refactor step: not needed; GREEN implementation was limited to helper reuse and verified source-contract updates.

## Threat Flags

None - this plan only changed client-side rendering and accessibility labels at the DTO-to-UI boundary already covered by T-65-20 through T-65-22. No new endpoint, auth path, file access, schema, or persistence boundary was introduced.

## Next Phase Readiness

Phase 65 is locally complete. Phase 66 can rely on UI projection treating persisted explicit mealPeriod as higher display authority than loggedAt fallback while preserving legacy fallback behavior for no-authority rows.

## Self-Check: PASSED

- Summary file created at `.planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-07-SUMMARY.md`.
- Key modified files exist: `client/src/components/HomeScreen.tsx`, `client/src/components/HistoryScreen.tsx`, `client/src/components/HistoryDayDetailScreen.tsx`, `client/src/components/SummaryDetailScreen.tsx`, and the four touched unit test files.
- Task commits present: `4f6d29d`, `dbfd9b1`, `451ec74`, `97cd9f8`.
- No tracked file deletions were introduced by task commits.

---
*Phase: 65-tool-contract-alignment-and-meal-period-authority*
*Completed: 2026-05-27*
