---
phase: 61-committed-mutation-outcome-and-summary-contract
plan: 01
subsystem: services
tags: [summary-outcome, meal-correction, sqlite, node-test]

requires:
  - phase: 60-goal-proposal-authority-and-rejected-goal-copy
    provides: backend-rendered mutation authority and v2.3 integrity constraints
provides:
  - Shared SummaryOutcome union for fresh, recovered, and unavailable post-commit summary availability
  - Update/delete service results that preserve committed facts across degraded summary recompute
  - Focused unit proof for helper recovery and meal-correction degraded outcomes
affects: [phase-61, mutation-outcomes, direct-meal-routes, chat-tools]

tech-stack:
  added: []
  patterns:
    - Shared post-commit summary recompute/recovery helper
    - Compatibility dailySummary projection from summaryOutcome only

key-files:
  created:
    - server/services/summary-outcome.ts
    - tests/unit/summary-outcome.test.ts
  modified:
    - server/services/meal-correction.ts
    - server/orchestrator/tools.ts
    - tests/unit/meal-correction.test.ts

key-decisions:
  - "Represent post-commit summary availability as summaryOutcome rather than mutation success."
  - "Expose recovered summaries explicitly with reason recompute_failed."
  - "Keep publish failure out of summaryOutcome; publish remains metadata-only observability."

patterns-established:
  - "buildSummaryOutcomeAfterMealCommit first attempts summaryService.getDailySummary, then recovers from persisted meals, then returns unavailable."
  - "dailySummary compatibility fields are derived only from dailySummaryFromOutcome(summaryOutcome)."

requirements-completed: [MUT-01, MUT-02, MUT-03, MUT-04]

duration: 4 min
completed: 2026-05-17
---

# Phase 61 Plan 01: Shared Summary Outcome Helper and Service Foundation Summary

**Shared post-commit SummaryOutcome contract with update/delete committed-facts preservation during summary recompute degradation**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-17T07:03:54Z
- **Completed:** 2026-05-17T07:07:24Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Added `SummaryOutcome` with exact `fresh`, `recovered`, and `unavailable` statuses plus `dailySummaryFromOutcome`, `buildLocalMidpointDate`, and `buildSummaryOutcomeAfterMealCommit`.
- Updated `createMealCorrectionService` so update/delete commit facts first and return `summaryOutcome`; `dailySummary` remains a compatibility projection only when summary availability is fresh or recovered.
- Added RED/GREEN unit proof for helper behavior and real SQLite update/delete degraded-summary outcomes.

## Task Commits

1. **Task 1: Wave 0 summary outcome contract tests** - `a8dbaa0` (test)
2. **Task 2: Implement shared summary outcome helper and service adoption** - `f4b4e78` (feat)

## Files Created/Modified

- `server/services/summary-outcome.ts` - Shared summary availability union and recompute/recovery helper.
- `server/services/meal-correction.ts` - Update/delete service results now preserve committed facts with `summaryOutcome`.
- `server/orchestrator/tools.ts` - Minimal result type boundary update so update/delete tool results can carry optional `dailySummary` after service adoption.
- `tests/unit/summary-outcome.test.ts` - Helper coverage for fresh, recovered, unavailable, projection, and no `publish_failed` outcome.
- `tests/unit/meal-correction.test.ts` - Real SQLite update/delete degraded-summary assertions.

## Decisions Made

- Followed the plan's locked D-01 through D-04 and D-13 through D-18 decisions.
- Used optional dependency injection on `createMealCorrectionService` for summary/recovery failure tests while preserving default runtime wiring.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated orchestrator tool result type boundary**
- **Found during:** Task 2 (Implement shared summary outcome helper and service adoption)
- **Issue:** `yarn tsc --noEmit` failed because `server/orchestrator/tools.ts` still required update/delete service results to contain a non-optional `dailySummary`.
- **Fix:** Added `SummaryOutcome` to update/delete result types and made `dailySummary` optional to match the committed-facts-first service contract.
- **Files modified:** `server/orchestrator/tools.ts`
- **Verification:** `yarn tsc --noEmit`
- **Committed in:** `f4b4e78`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required to keep the service contract type-safe after making `dailySummary` unavailable when recovery fails. No schema, route, client, or receipt behavior was expanded.

## Issues Encountered

- `yarn test:unit` regenerated `tests/harness/artifacts/image-log-failure/latest/*` timestamp/evidence noise. Those generated files were restored and not included.

## User Setup Required

None - no external service configuration required.

## Verification

- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/summary-outcome.test.ts tests/unit/meal-correction.test.ts`
- PASS: `yarn tsc --noEmit`
- PASS: `yarn test:unit`
- PASS: `yarn test:integration`

## Known Stubs

None. Stub scan found only normal empty initialization/reset patterns in existing code, not UI-facing placeholders or unwired mock data.

## Next Phase Readiness

Ready for `61-02` and `61-05` to propagate `summaryOutcome` into chat mutation effects, direct route responses, and downstream consumers.

## Self-Check: PASSED

- FOUND: `server/services/summary-outcome.ts`
- FOUND: `server/services/meal-correction.ts`
- FOUND: `server/orchestrator/tools.ts`
- FOUND: `tests/unit/summary-outcome.test.ts`
- FOUND: `tests/unit/meal-correction.test.ts`
- FOUND commits: `a8dbaa0`, `f4b4e78`
- No tracked file deletions in task commits.

---
*Phase: 61-committed-mutation-outcome-and-summary-contract*
*Completed: 2026-05-17*
