---
phase: 62-meal-revision-tokens-and-stale-receipt-protection
plan: 05
subsystem: api-client
tags: [meal-revisions, stale-conflict, fastify, react, node-test]

requires:
  - phase: 62-01
    provides: direct transaction expected-revision enforcement and route-owned stale conflict bodies
  - phase: 62-04
    provides: Meal Edit expected revision writes and stale conflict recovery hooks
provides:
  - direct PATCH preflights expected meal revision freshness before grouped-shape rejection
  - stale single-to-current-grouped direct PATCH regression proof with no summary or publish side effects
  - shared Meal Edit post-commit refresh helper for same-day edit/delete responses without dailySummary
  - targeted and matrix verification for Phase 62 gap closure
affects: [phase-62, phase-63, meal-edit, direct-meal-routes, client-refresh]

tech-stack:
  added: []
  patterns:
    - read-only expected revision service preflight
    - behavior-testable client mutation refresh helper
    - affectedDate-keyed same-day row refresh independent of dailySummary presence

key-files:
  created:
    - client/src/meal-edit-refresh.ts
    - tests/unit/meal-edit-refresh.test.ts
    - .planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-05-SUMMARY.md
  modified:
    - server/services/meal-transactions.ts
    - server/services/food-logging.ts
    - server/routes/meals.ts
    - client/src/components/MealEditScreen.tsx
    - tests/integration/meals-api.test.ts
    - tests/unit/meal-edit-screen.test.ts

key-decisions:
  - "Direct PATCH now checks expected revision freshness before grouped item-count rejection."
  - "Current grouped direct PATCH still returns MEAL_REQUIRES_GROUPED_UPDATE when the expected revision matches."
  - "Meal Edit post-commit row refresh is keyed by affectedDate, while dailySummary updates remain gated to a usable same-day summary."

patterns-established:
  - "Expose read-only revision preflights through foodLoggingService instead of duplicating route SQL."
  - "Move Meal Edit post-commit refresh behavior into a pure helper with explicit store/API dependencies."

requirements-completed: [FRESH-01, FRESH-02, FRESH-03]

duration: 4m 14s
completed: 2026-05-17T13:37:29Z
---

# Phase 62 Plan 05: Gap Closure Summary

**Stale direct PATCH conflicts now beat grouped-shape rejection, and same-day edit/delete commits refresh visible rows even when no dailySummary is returned.**

## Performance

- **Duration:** 4m 14s
- **Started:** 2026-05-17T13:33:15Z
- **Completed:** 2026-05-17T13:37:29Z
- **Tasks:** 3
- **Files modified:** 8 code/test files, 1 summary

## Accomplishments

- Added Fastify integration proof for stale single-item editor revisions after another flow commits the meal as grouped.
- Added a read-only revision preflight reused through `foodLoggingService`, so stale PATCH requests return `MEAL_REVISION_STALE` before grouped route guards, writes, summary recompute, or realtime publish.
- Added a shared `refreshAfterMealMutation` helper and unit proof that same-day edit/delete success responses refresh meals when `dailySummary` is omitted.
- Updated Meal Edit save/delete success paths to use the helper while preserving stale-conflict Traditional Chinese guidance and grouped edit behavior.
- Ran targeted tests, TypeScript, full unit, and full integration gates without staging/main promotion, release checks, dependency installs, or generated harness artifact commits.

## Task Commits

1. **Task 1 RED: stale grouped PATCH precedence regression** - `df5bf9a` (test)
2. **Task 1 GREEN: revision preflight before grouped PATCH guard** - `30cbccb` (feat)
3. **Task 2 RED: same-day refresh regression** - `58e5b0f` (test)
4. **Task 2 GREEN: shared same-day refresh helper** - `285567e` (feat)
5. **Task 3 verification fix: complete summary fixtures** - `66329f8` (test)

## Files Created/Modified

- `server/services/meal-transactions.ts` - Added a public read-only expected revision assertion that reuses the existing active transaction lookup and precondition error contract.
- `server/services/food-logging.ts` - Wrapped the transaction preflight for route-level use without adding route SQL.
- `server/routes/meals.ts` - Calls revision preflight before grouped item-count rejection and before asset validation, write, summary, or publish work.
- `client/src/meal-edit-refresh.ts` - New pure helper for post-commit meal mutation refresh behavior.
- `client/src/components/MealEditScreen.tsx` - Save/delete success paths now use the shared helper and refresh same-day rows by `affectedDate`.
- `tests/integration/meals-api.test.ts` - Added stale single-to-current-grouped direct PATCH ordering and no-side-effect proof.
- `tests/unit/meal-edit-refresh.test.ts` - Added behavior-level helper coverage for edit, delete, same-day summary, and historical affected dates.
- `tests/unit/meal-edit-screen.test.ts` - Updated source contract to require helper wiring and reject the old missing-`dailySummary` early return.

## Decisions Made

- Direct PATCH revision freshness is checked before grouped-shape validation so stale conflicts are never masked by `MEAL_REQUIRES_GROUPED_UPDATE`.
- The preflight is service-owned and read-only; it does not normalize items, validate images, insert revisions, or duplicate raw SQL in the route.
- Client row refresh after committed mutations is based on `affectedDate === today`; `setDailySummary` remains limited to responses with a same-day `dailySummary`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Completed DailySummary fixtures in the new helper test**
- **Found during:** Task 3 (`yarn tsc --noEmit`)
- **Issue:** The new unit test used date-only summary objects, but the public `DailySummary` type requires totals and meal count.
- **Fix:** Added a complete `dailySummary(...)` fixture helper in `tests/unit/meal-edit-refresh.test.ts`.
- **Files modified:** `tests/unit/meal-edit-refresh.test.ts`
- **Verification:** Targeted helper/screen tests and `yarn tsc --noEmit` passed.
- **Committed in:** `66329f8`

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking)
**Impact on plan:** The fix was test-only and required for TypeScript correctness. No production behavior, architecture, dependencies, or scope changed.

## Verification

- RED expected failure: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` failed before implementation because stale single-to-current-grouped PATCH returned `MEAL_REQUIRES_GROUPED_UPDATE`.
- RED expected failure: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-refresh.test.ts tests/unit/meal-edit-screen.test.ts` failed before implementation because `client/src/meal-edit-refresh.ts` did not exist and `MealEditScreen` still had the local early return.
- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts`
- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-refresh.test.ts tests/unit/meal-edit-screen.test.ts`
- PASS: `yarn tsc --noEmit`
- PASS: `yarn test:unit`
- PASS: `yarn test:integration`

## Issues Encountered

- Pre-existing generated harness artifact diffs under `tests/harness/artifacts/image-log-failure/latest/` remained dirty throughout execution and were intentionally left untouched and uncommitted.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Stub scan found only ordinary test-local empty arrays, nullable route checks, the existing non-stub image placeholder class/copy, and blank-string validation.

## Threat Flags

None. The plan touched existing route/service/client boundaries only. No new endpoint, auth path, file access pattern, schema change, sensitive logging surface, raw prompt/user text/tool payload/provider body/image/session/database evidence, or generated harness artifact was introduced.

## Next Phase Readiness

Phase 62 gap closure is complete. Phase 63 can build SSE meal-row freshness on top of a direct write contract where stale revisions fail closed and committed same-day edits/deletes refresh visible rows even when summary recovery is unavailable.

## Self-Check: PASSED

- FOUND: `server/services/meal-transactions.ts`
- FOUND: `server/services/food-logging.ts`
- FOUND: `server/routes/meals.ts`
- FOUND: `client/src/components/MealEditScreen.tsx`
- FOUND: `client/src/meal-edit-refresh.ts`
- FOUND: `tests/integration/meals-api.test.ts`
- FOUND: `tests/unit/meal-edit-refresh.test.ts`
- FOUND: `tests/unit/meal-edit-screen.test.ts`
- FOUND: `.planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-05-SUMMARY.md`
- FOUND commits: `df5bf9a`, `30cbccb`, `58e5b0f`, `285567e`, `66329f8`
- No tracked file deletions in task commits.

---
*Phase: 62-meal-revision-tokens-and-stale-receipt-protection*
*Completed: 2026-05-17T13:37:29Z*
