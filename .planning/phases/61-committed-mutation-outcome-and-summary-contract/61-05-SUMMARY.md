---
phase: 61-committed-mutation-outcome-and-summary-contract
plan: 05
subsystem: api
tags: [summary-outcome, direct-meal-routes, fastify, sqlite, node-test]

requires:
  - phase: 61-committed-mutation-outcome-and-summary-contract
    provides: Shared SummaryOutcome helper and meal service committed-facts foundation from 61-01
provides:
  - Direct PATCH meal responses with committed facts plus summaryOutcome
  - Direct DELETE meal responses with affectedDate, deletedMealId, and summaryOutcome
  - Metadata-only non-fatal summary publish handling for direct meal routes
affects: [phase-61, direct-meal-routes, client-direct-mutation-consumers]

tech-stack:
  added: []
  patterns:
    - Direct route post-commit summaryOutcome projection
    - Non-fatal route-side daily summary publish wrapper

key-files:
  created:
    - .planning/phases/61-committed-mutation-outcome-and-summary-contract/61-05-SUMMARY.md
  modified:
    - server/routes/meals.ts
    - tests/integration/meals-api.test.ts

key-decisions:
  - "Direct PATCH and DELETE meal route responses now expose summaryOutcome as summary freshness, not mutation success."
  - "Top-level dailySummary remains a compatibility field derived only from fresh or recovered summaryOutcome."
  - "Direct route publish failures are warn-logged as metadata-only and do not enter response bodies."

patterns-established:
  - "Direct meal routes call buildSummaryOutcomeAfterMealCommit after SQLite commit and before response projection."
  - "publishDailySummarySafe logs event, affectedDate, and summaryStatus only; it does not log deviceId, raw user text, provider bodies, image data, session material, or DB snapshots."

requirements-completed: [MUT-04]

duration: 7 min
completed: 2026-05-17
---

# Phase 61 Plan 05: Direct PATCH/DELETE SummaryOutcome Route Contract Summary

**Direct meal PATCH and DELETE routes now return committed mutation facts with explicit summary freshness outcomes when post-commit summary refresh degrades**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-17T07:14:00Z
- **Completed:** 2026-05-17T07:20:45Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added Fastify integration proof for direct `PATCH` and `DELETE` committed responses across fresh, recovered, unavailable, publish-failure, unauthorized, foreign-device, validation, grouped-conflict, and historical affected-date paths.
- Updated `server/routes/meals.ts` so committed direct route mutations return HTTP 200 with `summaryOutcome`; `dailySummary` appears only when projected from fresh or recovered outcomes.
- Added `deletedMealId` to direct delete responses and wrapped direct-route `publishDailySummary` so publish failures are metadata-only logs outside the public body.

## Task Commits

1. **Task 1: Add direct PATCH/DELETE degraded-summary integration tests** - `928a406` (test)
2. **Task 2: Implement direct route summaryOutcome projection** - `b0f9da7` (feat)

## Files Created/Modified

- `tests/integration/meals-api.test.ts` - Added direct route contract coverage for degraded summary outcomes, publish failure isolation, signed-cookie auth, and delete committed facts.
- `server/routes/meals.ts` - Direct `PATCH`/`DELETE` now use the shared summary outcome helper, compatibility daily summary projection, and non-fatal publish logging.
- `.planning/phases/61-committed-mutation-outcome-and-summary-contract/61-05-SUMMARY.md` - Execution summary and self-check.

## Decisions Made

- Followed D-05, D-07, D-19, and D-21 from the phase context.
- Kept direct route behavior route-owned instead of moving transport projection into services.
- Logged publish failure without exception message content to keep direct route logs metadata-only.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `yarn test:integration` regenerated timestamp/evidence noise under `tests/harness/artifacts/image-log-failure/latest/*`; those generated files were restored and not included.

## User Setup Required

None - no external service configuration required.

## Verification

- RED expected failure: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` failed before route implementation because direct responses omitted `summaryOutcome`/`deletedMealId`, degraded recompute returned 500, and publish failure propagated.
- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts`
- PASS: `yarn tsc --noEmit`
- PASS: `yarn test:integration`

## Known Stubs

None. Stub scan found only normal null/empty comparisons and test-local arrays, not UI-facing placeholders or unwired mock data.

## Threat Flags

None. The response/log surface changed exactly within the plan threat model, and publish logs are limited to event name, affected date, and summary status metadata.

## Next Phase Readiness

Ready for `61-06` to update client direct mutation parsing and consumption. Direct route responses now provide the public `summaryOutcome` contract required by MUT-04.

## Self-Check: PASSED

- FOUND: `server/routes/meals.ts`
- FOUND: `tests/integration/meals-api.test.ts`
- FOUND: `.planning/phases/61-committed-mutation-outcome-and-summary-contract/61-05-SUMMARY.md`
- FOUND commits: `928a406`, `b0f9da7`
- No tracked file deletions in task commits.

---
*Phase: 61-committed-mutation-outcome-and-summary-contract*
*Completed: 2026-05-17*
