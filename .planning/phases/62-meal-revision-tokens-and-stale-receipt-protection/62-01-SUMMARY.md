---
phase: 62-meal-revision-tokens-and-stale-receipt-protection
plan: 01
subsystem: api
tags: [meal-revisions, optimistic-concurrency, fastify, sqlite, node-test]

requires:
  - phase: 61-committed-mutation-outcome-and-summary-contract
    provides: Direct meal routes already separate committed mutation facts from summary freshness outcomes.
provides:
  - Direct `/api/meals` rows and successful direct update responses expose `mealRevisionId`.
  - Direct `PATCH` and `DELETE` require `expectedMealRevisionId` and fail closed with stable `409` revision errors.
  - Transaction-service missing/stale revision checks run before update/delete revision inserts.
  - Same-turn chat correction paths carry resolver-owned revision identity into update/delete writes.
affects: [phase-62, direct-meal-routes, meal-transaction-service, chat-meal-correction, client-stale-conflict]

tech-stack:
  added: []
  patterns:
    - Transaction-service optimistic concurrency guard
    - Route-owned stable 409 conflict projection
    - Tool-session resolved meal revision handoff

key-files:
  created:
    - .planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-01-SUMMARY.md
  modified:
    - server/services/meal-transactions.ts
    - server/services/food-logging.ts
    - server/services/meal-history.ts
    - server/services/meal-correction.ts
    - server/routes/meals.ts
    - server/orchestrator/index.ts
    - server/orchestrator/tools.ts
    - tests/unit/meal-transactions.test.ts
    - tests/unit/food-logging.test.ts
    - tests/integration/meals-api.test.ts
    - tests/integration/history-api.test.ts
    - tests/integration/history-search-api.test.ts
    - tests/integration/history-trends-api.test.ts
    - tests/integration/sse.test.ts
    - tests/harness/scenarios/meal-delete-consistency.ts

key-decisions:
  - "Direct meal revision conflicts use the route-owned 409 family with `MEAL_REVISION_REQUIRED` and `MEAL_REVISION_STALE`."
  - "The transaction service owns expected-revision comparison before any update/delete revision insert."
  - "Resolved chat/tool meal targets now carry current revision identity so the stricter transaction boundary does not break existing correction flows."

patterns-established:
  - "MealRevisionPreconditionError carries only stable metadata: error code, mealId, affectedDate, and currentMealRevisionId."
  - "Direct route conflict catch branches return before summary recompute, dailySummary projection, or realtime publish."
  - "Direct service and harness callers that mutate existing meals must pass the current `mealRevisionId` as `expectedMealRevisionId`."

requirements-completed: [FRESH-01, FRESH-02]

duration: 9 min
completed: 2026-05-17
---

# Phase 62 Plan 01: Direct Transaction Preconditions and Meal Route Conflict Contract Summary

**Direct meal update/delete writes now use revision preconditions and stable stale-conflict responses before summary or realtime side effects**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-17T12:09:37Z
- **Completed:** 2026-05-17T12:18:09Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments

- Added RED unit and Fastify integration coverage proving current expected revisions succeed while missing/stale direct update/delete requests fail without mutation, summary recompute, or publish.
- Added `MealRevisionPreconditionError` and transaction-service compare-before-write checks for update and soft delete.
- Projected `mealRevisionId` on direct `/api/meals` rows and successful direct update response meals, and mapped conflicts to minimal `409` bodies.
- Threaded resolver-owned revision identity through same-turn chat correction tool state so the new transaction boundary remains compatible with existing correction flows.

## Task Commits

1. **Task 1: Prove direct expected revision success and fail-closed conflicts** - `570cbfa` (test)
2. **Task 2: Implement transaction preconditions and direct route conflict bodies** - `b82ef94` (feat)

## Files Created/Modified

- `server/services/meal-transactions.ts` - Added typed revision precondition errors and update/delete expected-revision guards before revision writes.
- `server/services/food-logging.ts` - Threaded `expectedMealRevisionId` through compatibility update/delete only.
- `server/routes/meals.ts` - Parsed expected revision inputs, projected `mealRevisionId`, and returned stable 409 conflict bodies before summary/publish work.
- `server/services/meal-history.ts` - Included current revision identity for `/api/meals` route rows.
- `server/services/meal-correction.ts`, `server/orchestrator/index.ts`, `server/orchestrator/tools.ts` - Carried resolved meal revision identity through chat/tool correction writes.
- `tests/unit/meal-transactions.test.ts`, `tests/unit/food-logging.test.ts`, `tests/integration/meals-api.test.ts` - Added direct stale-revision proof.
- `tests/integration/history-api.test.ts`, `tests/integration/history-search-api.test.ts`, `tests/integration/history-trends-api.test.ts`, `tests/integration/sse.test.ts`, `tests/harness/scenarios/meal-delete-consistency.ts` - Updated integration setup/direct delete callers for the stricter existing-meal mutation contract.

## Decisions Made

- Kept route conflict response bodies minimal and metadata-only: `error`, `mealId`, `affectedDate`, and `currentMealRevisionId`.
- Reused HTTP `409` instead of adding a new status convention.
- Preserved meal creation/logging behavior; no expected revision is accepted or required for create/log paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added direct row revision projection at the meal history source**
- **Found during:** Task 2 verification
- **Issue:** `/api/meals` is backed by `meal-history`; route projection could not expose `mealRevisionId` until the history service returned the current revision id.
- **Fix:** Added `mealRevisionId` to `MealHistoryEntry` from `meal_transactions.currentRevisionId`.
- **Files modified:** `server/services/meal-history.ts`
- **Verification:** Targeted meals API tests and `yarn test:integration` passed.
- **Committed in:** `b82ef94`

**2. [Rule 3 - Blocking] Threaded resolved chat/tool revisions through the stricter transaction boundary**
- **Found during:** Task 2 `yarn test:integration`
- **Issue:** Existing chat correction integration paths share the same transaction service and failed once missing expected revisions were rejected.
- **Fix:** Added candidate `mealRevisionId`, tool-session revision tracking, and expected revision pass-through for update/delete correction tools.
- **Files modified:** `server/services/meal-correction.ts`, `server/orchestrator/index.ts`, `server/orchestrator/tools.ts`
- **Verification:** `yarn test:integration` passed.
- **Committed in:** `b82ef94`

**3. [Rule 3 - Blocking] Updated direct mutation integration fixtures for required expected revisions**
- **Found during:** Task 2 `yarn test:integration`
- **Issue:** Several integration setup paths and the deterministic delete consistency scenario performed direct service or HTTP deletes without the now-required expected revision.
- **Fix:** Passed current `mealRevisionId` as `expectedMealRevisionId` in affected fixtures and scenario requests.
- **Files modified:** `tests/integration/history-api.test.ts`, `tests/integration/history-search-api.test.ts`, `tests/integration/history-trends-api.test.ts`, `tests/integration/sse.test.ts`, `tests/harness/scenarios/meal-delete-consistency.ts`
- **Verification:** `yarn test:integration` passed.
- **Committed in:** `b82ef94`

---

**Total deviations:** 3 auto-fixed (1 Rule 2, 2 Rule 3)
**Impact on plan:** All changes were required by the stricter existing-meal mutation contract; no schema, migration, dependency, or raw logging surface was added.

## Issues Encountered

- `yarn test:integration` regenerated timestamp/evidence noise under `tests/harness/artifacts/image-log-failure/latest/*`; those generated files were restored and not included.

## User Setup Required

None - no external service configuration required.

## Verification

- RED expected failure: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-transactions.test.ts tests/unit/food-logging.test.ts tests/integration/meals-api.test.ts` failed before implementation because direct DTOs omitted `mealRevisionId`, missing expected revisions failed open, and `MealRevisionPreconditionError` did not exist.
- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-transactions.test.ts tests/unit/food-logging.test.ts tests/integration/meals-api.test.ts`
- PASS: `yarn tsc --noEmit`
- PASS: `yarn test:integration`

## Known Stubs

None. Stub scan found only normal test-local arrays, empty strings, and nullable values; no UI-facing placeholders or unwired mock data were introduced.

## Threat Flags

None. The new route response surface matches the plan threat model and contains only stable conflict metadata. No new network endpoint, auth path, file access pattern, schema change, or sensitive logging path was introduced.

## Next Phase Readiness

Ready for `62-02` to extend revision identity across the remaining server read and chat receipt DTOs. Direct routes and the transaction boundary now provide the expected-revision foundation that client stale-conflict handling can rely on in later plans.

## Self-Check: PASSED

- FOUND: `server/services/meal-transactions.ts`
- FOUND: `server/services/food-logging.ts`
- FOUND: `server/routes/meals.ts`
- FOUND: `server/services/meal-history.ts`
- FOUND: `server/services/meal-correction.ts`
- FOUND: `server/orchestrator/tools.ts`
- FOUND: `tests/unit/meal-transactions.test.ts`
- FOUND: `tests/unit/food-logging.test.ts`
- FOUND: `tests/integration/meals-api.test.ts`
- FOUND: `.planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-01-SUMMARY.md`
- FOUND commits: `570cbfa`, `b82ef94`
- No tracked file deletions in task commits.

---
*Phase: 62-meal-revision-tokens-and-stale-receipt-protection*
*Completed: 2026-05-17*
