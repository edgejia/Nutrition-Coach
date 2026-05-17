---
phase: 62-meal-revision-tokens-and-stale-receipt-protection
plan: 02
subsystem: api
tags: [fastify, sqlite, chat, history, sse, meal-revisions]

requires:
  - phase: 62-01
    provides: Direct meal mutation expected-revision preconditions and public revision conflict errors
provides:
  - Public `mealRevisionId` on edit-capable history and day snapshot meal DTOs
  - Public `mealRevisionId` on chat JSON, SSE terminal, and current-active restored chat receipts
  - Regression coverage proving stale/deleted restored receipts remain display-only
affects: [phase-62, phase-62-03, phase-62-04, stale-receipt-protection]

tech-stack:
  added: []
  patterns:
    - Project storage `currentRevisionId` as public read-side `mealRevisionId`
    - Keep restored chat receipt edit identity atomic: `mealId`, `dateKey`, and `mealRevisionId` together only for current-active receipts

key-files:
  created:
    - .planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-02-SUMMARY.md
  modified:
    - server/services/history-query.ts
    - server/services/chat.ts
    - server/routes/day-snapshot.ts
    - server/routes/chat.ts
    - tests/unit/meal-history.test.ts
    - tests/unit/chat.test.ts
    - tests/unit/summary.test.ts
    - tests/integration/day-snapshot-api.test.ts
    - tests/integration/history-api.test.ts
    - tests/integration/history-search-api.test.ts
    - tests/integration/chat-api.test.ts
    - tests/integration/chat-streaming.test.ts

key-decisions:
  - "Server read and chat receipt DTOs expose public `mealRevisionId` while keeping internal `currentRevisionId` hidden."
  - "Restored chat receipts expose edit identity only when the persisted receipt revision is still the current active meal revision."

patterns-established:
  - "Read DTO projection: use public `mealRevisionId` for read/edit identity; keep write precondition naming for later `expectedMealRevisionId` inputs."
  - "Chat receipt projection: stale or deleted receipts omit `mealId`, `dateKey`, and `mealRevisionId` together."

requirements-completed: [FRESH-01]

duration: 5min
completed: 2026-05-17
---

# Phase 62 Plan 02: Server Read DTO and Chat Receipt Revision Identity Projection Summary

**Public meal revision identity now flows through edit-capable server read DTOs and chat receipts without exposing internal revision pointers.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-17T12:20:44Z
- **Completed:** 2026-05-17T12:25:35Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments

- Added regression coverage for `mealRevisionId` on meal history, day snapshot, history day/search DTOs, chat JSON receipts, chat SSE terminal receipts, and `/api/chat/history` restored receipts.
- Projected public `mealRevisionId` through `HistoryMealDto`, `/api/day-snapshot`, current-active restored chat receipts, and `projectLoggedMealReceipt`.
- Preserved display-only stale/deleted chat receipt behavior by omitting `mealId`, `dateKey`, and `mealRevisionId` together unless the receipt is current-active.

## Task Commits

1. **Task 1: Prove public revision identity on read DTOs and receipts** - `72c196b` (test)
2. **Task 2: Project `mealRevisionId` through server read and receipt surfaces** - `022c6fb` (feat)
3. **Deviation fix: Align summary delete fixture with revision precondition** - `8a5c256` (test)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `server/services/history-query.ts` - Adds public `mealRevisionId` to history day/search meal DTO projection.
- `server/services/chat.ts` - Adds `mealRevisionId` only to current-active restored chat receipts.
- `server/routes/day-snapshot.ts` - Passes through `mealRevisionId` on day snapshot meal rows.
- `server/routes/chat.ts` - Preserves `mealRevisionId` in JSON, SSE `done`/`stopped`, and history receipt projection.
- `tests/unit/meal-history.test.ts` - Proves meal history entries expose `mealRevisionId` and hide `currentRevisionId`.
- `tests/unit/chat.test.ts` - Proves current-active restored receipts include edit identity and stale/deleted receipts stay display-only.
- `tests/unit/summary.test.ts` - Aligns an existing delete fixture with the Phase 62 expected-revision contract.
- `tests/integration/day-snapshot-api.test.ts` - Proves `/api/day-snapshot` meal rows include public revision identity.
- `tests/integration/history-api.test.ts` - Proves `/api/history/meals` and `/api/history/days/:date` include public revision identity.
- `tests/integration/history-search-api.test.ts` - Proves `/api/history/search` parent meal DTOs include public revision identity.
- `tests/integration/chat-api.test.ts` - Proves JSON and restored history loggedMeal receipts include `mealRevisionId`.
- `tests/integration/chat-streaming.test.ts` - Proves SSE terminal loggedMeal receipts include `mealRevisionId` without disrupting terminal payload behavior.

## Decisions Made

- Followed the plan's naming boundary: public read identity is `mealRevisionId`; internal `currentRevisionId` remains hidden from serialized responses.
- Kept restored chat receipt edit identity atomic, so stale/deleted receipts omit all edit-opening fields instead of partially exposing stale identity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Aligned an existing summary unit test with Phase 62 revision preconditions**
- **Found during:** Overall verification after Task 2
- **Issue:** `tests/unit/summary.test.ts` still called `deleteMeal` without the `expectedMealRevisionId` argument introduced by completed Plan 62-01, causing `yarn test:unit` to fail with `MEAL_REVISION_REQUIRED`.
- **Fix:** Passed the current logged meal `mealRevisionId` into the delete fixture.
- **Files modified:** `tests/unit/summary.test.ts`
- **Verification:** `yarn test:unit`
- **Committed in:** `8a5c256`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** The fix was test-only and aligned existing coverage with the committed 62-01 public contract; no source scope expanded.

## Issues Encountered

- Initial targeted RED verification also exposed stale test fixtures that had not yet been updated for the committed 62-01 precondition contract. Those were corrected in the Task 1 RED commit so the failing tests represented the intended missing read projections.
- `yarn test:integration` regenerated tracked harness artifacts under `tests/harness/artifacts/image-log-failure/latest/`; those generated diffs were restored because this plan did not modify harness evidence.

## Known Stubs

None. Stub-pattern scan found only existing empty-array/string/null control-flow initializers and no placeholder UI/data stubs introduced by this plan.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-history.test.ts tests/unit/chat.test.ts tests/integration/day-snapshot-api.test.ts tests/integration/history-api.test.ts tests/integration/history-search-api.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts`
- `yarn tsc --noEmit`
- `yarn test:integration`
- `yarn test:unit`

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 62-03 can now thread `expectedMealRevisionId` through chat/tool update and delete flows using the public `mealRevisionId` exposed here.

## Self-Check: PASSED

- Verified all created/modified files exist.
- Verified task and deviation commits exist: `72c196b`, `022c6fb`, `8a5c256`.
- No tracked file deletions were introduced by task commits.

---
*Phase: 62-meal-revision-tokens-and-stale-receipt-protection*
*Completed: 2026-05-17*
