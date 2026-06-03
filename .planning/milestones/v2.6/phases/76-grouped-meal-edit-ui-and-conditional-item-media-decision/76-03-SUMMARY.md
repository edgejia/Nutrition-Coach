---
phase: 76-grouped-meal-edit-ui-and-conditional-item-media-decision
plan: 03
subsystem: api
tags: [fastify, sqlite, meals-api, grouped-meals, meal-history, media-deferral]
requires:
  - phase: 75-grouped-meal-direct-crud-contract
    provides: Strict grouped items[] direct PATCH contract and ordered revision item persistence
  - phase: 76-grouped-meal-edit-ui-and-conditional-item-media-decision
    provides: Grouped Meal Edit UI and media-free client item DTO contracts from Plans 01 and 02
provides:
  - GET /api/meals grouped item detail projection through the existing signed guest-session read path
  - Media-free flat public item rows with name, position, calories, protein, carbs, and fat
  - Integration proof that whole-meal image identity remains meal-level while item rows carry no media evidence
affects: [phase-76, phase-77, grouped-meal-edit-ui, meal-read-dto]
tech-stack:
  added: []
  patterns: [Service-owned revision item projection, route-owned narrow DTO spread, Fastify SQLite integration proof]
key-files:
  created:
    - .planning/phases/76-grouped-meal-edit-ui-and-conditional-item-media-decision/76-03-SUMMARY.md
  modified:
    - tests/integration/meals-api.test.ts
    - server/services/meal-history.ts
    - server/routes/meals.ts
key-decisions:
  - "Grouped item details reuse the existing authorized GET /api/meals path instead of adding a separate edit-detail endpoint."
  - "MealHistoryEntry projects flat public item rows while keeping item media, crop, thumbnail, asset, and evidence fields out of the DTO."
  - "Whole-meal image identity remains on imageAssetId/imageUrl at the meal row level."
patterns-established:
  - "Meal history service groups current revision items by revision id and orders public item rows by persisted zero-based position."
  - "Meal route DTOs conditionally spread service-provided items[] without changing resolveGuestSession() ownership or grouped PATCH parsing."
requirements-completed: [GROUP-UI-01, GROUP-UI-03, MEDIA-DECISION-01]
duration: 4m
completed: 2026-06-03
---

# Phase 76 Plan 03: Grouped Meal Read DTO Summary

**Authorized meal reads now return ordered, media-free grouped item details through the existing `/api/meals` DTO path.**

## Performance

- **Duration:** 4m
- **Started:** 2026-06-03T14:25:05Z
- **Completed:** 2026-06-03T14:28:25Z
- **Tasks:** 2
- **Files modified:** 3 code/test files plus this summary

## Accomplishments

- Tightened `tests/integration/meals-api.test.ts` so grouped `GET /api/meals` rows must include ordered flat `items[]`, meal-level image fields, aggregate nutrition, and `itemCount`.
- Extended `MealHistoryEntry` with optional media-free `items[]` projected from `meal_revision_items.position` and public `name` fields.
- Added `items` to the existing authorized `/api/meals` row DTO when available, preserving `resolveGuestSession()` ownership and the existing grouped PATCH parser/response behavior.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add grouped /api/meals projection proof** - `3e1b735` (test)
2. **Task 2: Expose media-free grouped item details on the existing meal read path** - `cc567f2` (feat)

**Plan metadata:** pending final docs commit.

## Files Created/Modified

- `tests/integration/meals-api.test.ts` - Added grouped read-path proof for ordered item details, meal-level image identity, and no item-level media/evidence fields.
- `server/services/meal-history.ts` - Added `MealHistoryItem` and projects current revision items ordered by revision id and position.
- `server/routes/meals.ts` - Spreads service-provided `items[]` into the existing signed-session `/api/meals` DTO.
- `.planning/phases/76-grouped-meal-edit-ui-and-conditional-item-media-decision/76-03-SUMMARY.md` - Records execution outcome and verification state.

## Decisions Made

- Kept grouped edit read authority on `GET /api/meals`; no new endpoint, schema migration, package, or item media persistence was introduced.
- Exposed only flat item text/nutrition facts and position; whole-meal media remains represented by `imageAssetId` and `imageUrl` on the meal row.
- Left grouped PATCH validation, stale revision handling, summaryOutcome, and realtime publish behavior unchanged.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The Task 1 red run failed only on the newly required `items[]` projection, then Task 2 made the same targeted test green.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` - expected red after Task 1: 29 pass, 1 fail limited to missing grouped `items[]`.
- `yarn tsc --noEmit` - passed after Task 1 test-only change.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` - passed after Task 2, 30 tests.
- `yarn test:integration` - passed, 354 tests.
- `yarn tsc --noEmit` - passed.

## Known Stubs

None. Stub-pattern scan hits were existing test-local capture arrays and intentional parser/null branches; no unresolved UI or DTO data stubs were introduced.

## Threat Flags

None. The only trust-boundary change is the planned `/api/meals` DTO projection under the existing signed guest-session boundary, with item rows narrowed by integration assertions.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 76 is ready for closure and Phase 77 can rely on Home and post-commit refreshes receiving grouped item details from the existing authoritative meal read path.

## Self-Check: PASSED

- Summary file exists: FOUND.
- Key files exist: FOUND `tests/integration/meals-api.test.ts`, `server/services/meal-history.ts`, `server/routes/meals.ts`.
- Task commit `3e1b735` exists: FOUND.
- Task commit `cc567f2` exists: FOUND.
- No tracked file deletions were introduced by task commits.

---
*Phase: 76-grouped-meal-edit-ui-and-conditional-item-media-decision*
*Completed: 2026-06-03*
