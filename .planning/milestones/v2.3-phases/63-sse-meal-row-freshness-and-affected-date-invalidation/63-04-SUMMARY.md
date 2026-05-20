---
phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
plan: 04
subsystem: realtime
tags: [sse, client, coordinator, zustand, latest-wins]

requires:
  - phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
    provides: strict client daily_summary SSE envelope parsing from plan 63-03
provides:
  - Client SSE summary coordinator for same-day refetch-first summary commits
  - Latest-token guard shared by same-day SSE reconcile and initial meal row loads
  - Historical affected-date invalidation through recordMealMutation
  - MainLayout envelope-aware SSE wiring at both connectSSE call sites
affects: [phase-63, realtime, client-sse-parser, home-summary-freshness]

tech-stack:
  added: []
  patterns:
    - Dependency-injected client coordinator for SSE state orchestration
    - Source-contract guard preventing raw MainLayout daily_summary wiring

key-files:
  created:
    - client/src/sse-summary-coordinator.ts
    - tests/unit/sse-summary-coordinator.test.ts
    - tests/unit/main-layout-sse-contract.test.ts
    - .planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-04-SUMMARY.md
  modified:
    - client/src/components/MainLayout.tsx
    - tests/unit/mobile-shell.test.ts

key-decisions:
  - "MainLayout now routes daily_summary envelopes through createSSESummaryCoordinator instead of raw setDailySummary callbacks."
  - "The SSE coordinator uses one monotonic token family for initial meal loads and same-day SSE reconcile."
  - "Historical non-future events invalidate affected dates through recordMealMutation while future valid dates are ignored."

patterns-established:
  - "SSE refetch-first commit order: setMeals(rows) before setDailySummary(summary), only if the token is still latest."
  - "MainLayout source-contract tests assert envelope-aware connectSSE wiring and coordinator-owned row load commits."

requirements-completed: [REAL-02, REAL-03]

duration: 5m 17s
completed: 2026-05-18
---

# Phase 63 Plan 04: SSE Meal-Row Freshness Coordinator Summary

**Client SSE summaries now reconcile same-day meal rows before committing totals, with latest-token guards covering mutation events and initial row loads.**

## Performance

- **Duration:** 5m 17s
- **Started:** 2026-05-18T08:04:46Z
- **Completed:** 2026-05-18T08:10:03Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added coordinator unit coverage proving same-day refetch-before-summary commits, silent row-refetch failure, latest-wins ordering, initial/reconnect behavior, historical invalidation, and future-date no-op behavior.
- Implemented `createSSESummaryCoordinator` as a pure dependency-injected helper with no React, Zustand hook, EventSource, or UI rendering dependency.
- Rewired `MainLayout` so both SSE subscriptions use `onDailySummaryEnvelope`, and initial/day-rollover row loads commit through the coordinator token guard instead of direct `setMeals(meals)`.

## Task Commits

1. **Task 1: Prove coordinator routing and latest-wins behavior** - `0b22d8b` (test)
2. **Task 2: Implement SSE summary coordinator** - `936d1ad` (feat)
3. **Task 3: Wire coordinator through MainLayout SSE and initial row loading** - `6ae2111` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `client/src/sse-summary-coordinator.ts` - Owns same-day refetch-first reconcile, latest-token guards, historical routing, future ignore, and initial row-load token commits.
- `client/src/components/MainLayout.tsx` - Creates one mounted coordinator, passes `handleSummary` through both `connectSSE` call sites, and routes initial/day-rollover row loads through `runInitialMealsLoad`.
- `tests/unit/sse-summary-coordinator.test.ts` - Behavior proof for same-day reconcile, silent failure, latest-wins races, first initial summary, reconnect initial refetch, historical invalidation, and future ignore.
- `tests/unit/main-layout-sse-contract.test.ts` - Source-contract proof that MainLayout uses envelope-aware coordinator wiring and does not reintroduce raw `onSummary` / `setDailySummary` SSE wiring.
- `tests/unit/mobile-shell.test.ts` - Updated existing MainLayout source contract to expect coordinator-owned initial/day-rollover row loads.
- `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-04-SUMMARY.md` - Execution summary and verification record.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-summary-coordinator.test.ts` - RED failed as expected before implementation: missing `client/src/sse-summary-coordinator.js`.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-summary-coordinator.test.ts` - PASS after coordinator implementation, 8/8 tests.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-summary-coordinator.test.ts tests/unit/main-layout-sse-contract.test.ts` - PASS after MainLayout wiring, 9/9 tests.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/mobile-shell.test.ts tests/unit/sse-summary-coordinator.test.ts tests/unit/main-layout-sse-contract.test.ts` - PASS after source-contract update, 27/27 tests.
- `yarn tsc --noEmit` - PASS.
- `yarn test:unit` - PASS, 796/796 tests.

## Decisions Made

- Used coordinator-local monotonic tokens rather than AbortController cancellation because the requirement is stale-result suppression, not network cancellation.
- Kept direct mutation helper behavior in `client/src/meal-edit-refresh.ts` unchanged to avoid coupling Phase 62 direct mutation success flows to the SSE-only reconcile policy.
- Kept same-day row-refetch failures silent; only existing unauthorized recovery is invoked through the coordinator's optional callback.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated stale MainLayout mobile-shell source contract**
- **Found during:** Task 3 (plan-level `yarn test:unit`)
- **Issue:** `tests/unit/mobile-shell.test.ts` still asserted that MainLayout directly called `getMeals()` and `setMeals(meals)`, which conflicts with the planned coordinator-owned row-load commits.
- **Fix:** Updated the contract to assert `sseSummaryCoordinator.runInitialMealsLoad()` and the day-rollover refresh-reason call instead.
- **Files modified:** `tests/unit/mobile-shell.test.ts`
- **Verification:** Targeted mobile-shell/coordinator contract tests passed; `yarn test:unit` passed.
- **Committed in:** `6ae2111`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** The update was required to keep the existing source-contract suite aligned with the planned MainLayout behavior. No production behavior beyond the plan was added.

## Issues Encountered

- The first `yarn test:unit` run failed only on the stale MainLayout source-contract expectation in `tests/unit/mobile-shell.test.ts`; after the Rule 3 update, the full unit suite passed.

## Known Stubs

None. Stub-pattern scan found only legitimate nullable viewport/test state and existing ChatInput placeholder copy unrelated to this plan.

## Threat Flags

None. The new coordinator triggers existing same-origin `getMeals` calls and Zustand state actions already covered by the plan threat model; it does not add endpoints, auth paths, file access, schemas, or new UI surfaces.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Home/Summary same-day SSE totals now depend on successful latest-token meal-row refetches. Phase 63 Plan 05 can build on the historical `recordMealMutation(affectedDate)` signal for visible historical surface refresh/invalidation.

## Self-Check: PASSED

- Created summary file exists.
- Planned coordinator source and unit/source-contract test files exist.
- Task commits `0b22d8b`, `936d1ad`, and `6ae2111` exist in git history.

---
*Phase: 63-sse-meal-row-freshness-and-affected-date-invalidation*
*Completed: 2026-05-18*
