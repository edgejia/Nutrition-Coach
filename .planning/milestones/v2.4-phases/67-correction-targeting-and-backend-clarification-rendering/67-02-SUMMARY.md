---
phase: 67-correction-targeting-and-backend-clarification-rendering
plan: 02
subsystem: service
tags: [meal-correction, target-resolution, turn-state, node-test, sqlite]

requires:
  - phase: 67-01
    provides: red-first service, tool, orchestrator, and route tests for Phase 67 correction targeting
provides:
  - Evidence-tier meal correction target resolver in `mealCorrectionService.findMeals()`
  - Historical explicit-date no-safe-target recovery scoped to same-date meals
  - Pending meal target selection state backed by exact rendered options and scope metadata
affects: [phase-67, TARGET-01, TARGET-02, correction-targeting, meal-target-selection]

tech-stack:
  added: []
  patterns: [Drizzle-scoped candidate loading, evidence-tier resolver helpers, rendered-option turn state]

key-files:
  created:
    - .planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-02-SUMMARY.md
  modified:
    - server/services/meal-correction.ts

key-decisions:
  - "Correction target selection now uses locked evidence tiers instead of additive scoring."
  - "Date-scoped no-safe-target recovery is applied to explicit historical dates while today's unmatched likely-food target keeps the existing generic fail-closed clarification behavior."
  - "Pending meal target selections store exact rendered options with action and scope metadata; follow-up replies resolve only against those visible options."

patterns-established:
  - "Use `resolveByEvidenceTier()` as the single authority for update/delete target resolution."
  - "Persist `meal_target_selection` as `renderedOptions` plus scope metadata, not as an unbounded candidate pool."

requirements-completed: [TARGET-01, TARGET-02]

duration: 7min
completed: 2026-05-29
---

# Phase 67 Plan 02: Evidence-Tier Resolver and Rendered Selection Summary

**Meal correction targeting now resolves by explicit evidence tiers and persists only the exact numbered options shown to the user.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-28T20:01:23Z
- **Completed:** 2026-05-28T20:07:47Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Replaced additive target scoring with `resolveByEvidenceTier()`, enforcing explicit date scope, food/item-label authority, explicit persisted meal period before inferred period, and recency only inside allowed tiers.
- Added explicit historical-date recovery for unsafe no-match targets: same-date options are shown when present, and date-specific no-meals copy is returned when absent.
- Changed `meal_target_selection` state to store rendered numbered options with action/scope metadata, then resolve follow-ups only from visible numbers, exact labels, or uniquely shown attributes.

## Task Commits

1. **Task 1: Replace additive scoring with evidence-tier target resolution** - `7125f71` (feat)
2. **Task 2: Persist exact rendered options and tighten pending selection mapping** - `8c29d97` (feat)

## Files Created/Modified

- `server/services/meal-correction.ts` - Evidence-tier resolver, historical date recovery, rendered option formatting, and pending selection mapping.
- `.planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-02-SUMMARY.md` - This execution summary.

## Decisions Made

- Correction resolver authority is tier-based, not additive score based; `scoreCandidate` was removed.
- Explicit persisted `mealPeriod` outranks inferred `loggedAt` period; inferred period remains a fallback tier.
- Today plus unmatched likely food keeps the existing generic clarification behavior instead of listing weak period/date-only options, preserving D-19 no period-only fallback behavior.
- Pending selections keep exact rendered option text and visible attributes, with a compatibility reader for older in-memory candidate-pool payloads.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Accepted mixed numbered follow-up prefixes**
- **Found during:** Task 2 integration verification
- **Issue:** The service accepted bare `2` / `第二個` but not mixed follow-up text such as `2，蛋白質改 28g`, so the target could not resolve before numeric authority checked the update.
- **Fix:** Extended selection parsing to accept shown numeric or ordinal prefixes followed by punctuation and additional mutation details.
- **Files modified:** `server/services/meal-correction.ts`
- **Verification:** `node scripts/run-node-with-tz.mjs --import tsx --test --test-name-pattern "Phase 67 D-39/D-40/D-42" tests/integration/chat-meal-correction.integration.test.ts` passed.
- **Committed in:** `8c29d97`

---

**Total deviations:** 1 auto-fixed missing critical behavior.
**Impact on plan:** The fix is inside the planned service boundary and is required for safe visible-option mapping; no dependency or architectural changes were introduced.

## Issues Encountered

- `yarn test:integration` still has one expected red Wave 0 failure for renderer-owned route copy: `Phase 67 D-28/D-32/D-39 route returns stable backend clarification without raw correction echo...`. The failure is in the later orchestrator/route rendering scope planned for 67-03/67-04, not in the 67-02 service resolver boundary.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` - passed, 35/35.
- `node scripts/run-node-with-tz.mjs --import tsx --test --test-name-pattern "Phase 67 D-01|Phase 67 D-07|Phase 67 D-16|Phase 67 D-18|Phase 67 D-19|Phase 67 D-30" tests/unit/meal-correction.test.ts` - passed, 7/7 after Task 1.
- `node scripts/run-node-with-tz.mjs --import tsx --test --test-name-pattern "Phase 67 D-39/D-40/D-42" tests/integration/chat-meal-correction.integration.test.ts` - passed.
- `yarn tsc --noEmit` - passed.
- `yarn test:integration` - failed only the known out-of-scope Phase 67 renderer-owned-copy red test described above; 327/328 passed.

## Known Stubs

None. Stub-pattern scan found only local test fixture arrays and normal typed accumulator initialization; no UI-flowing hardcoded stubs were introduced.

## Threat Flags

None. The plan modified existing service logic only. Candidate SQL remains Drizzle builder based and scoped by `eq(mealTransactions.deviceId, deviceId)`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 67-03 can now consume service-owned `needs_clarification` results and replace the remaining orchestrator-rendered raw correction echo with backend-controlled renderer copy.

## Self-Check: PASSED

- Found `server/services/meal-correction.ts` on disk.
- Found task commits `7125f71` and `8c29d97` in git history.
- Verified no tracked files were deleted by task commits.
- Confirmed `server/services/meal-correction.ts` no longer contains `scoreCandidate`.

---
*Phase: 67-correction-targeting-and-backend-clarification-rendering*
*Completed: 2026-05-29*
