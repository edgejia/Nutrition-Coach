---
phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
plan: 05
subsystem: realtime
tags: [sse, history, client, zustand, latest-wins]

requires:
  - phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
    provides: historical affected-date invalidation through recordMealMutation from plan 63-04
provides:
  - Matching open History Day Detail refresh on lastMealMutation affectedDate
  - Source-contract proof for Day Detail exact-date invalidation and no freshness UI
  - Source-contract proof preserving History selected-day/current-week refresh gates
affects: [phase-63, realtime, history, day-detail, client-state]

tech-stack:
  added: []
  patterns:
    - Component-local latest-token snapshot loader for historical detail refreshes
    - Source-contract tests guarding visible historical invalidation boundaries

key-files:
  created:
    - .planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-05-SUMMARY.md
  modified:
    - client/src/components/HistoryDayDetailScreen.tsx
    - tests/unit/history-day-detail-source-contract.test.ts
    - tests/unit/history-screen-contract.test.ts

key-decisions:
  - "History Day Detail observes lastMealMutation directly and refetches only when affectedDate exactly matches dateKey."
  - "Day Detail refreshes reuse getHistoryDaySnapshot(dateKey); historical SSE summaries remain validation/invalidation signals, not surface data."
  - "History screen gating remains selected-day/current-week only; tab presence alone is not a refresh trigger."

patterns-established:
  - "Historical visible refresh: match affectedDate to visible surface, refetch through existing history APIs, and suppress stale in-flight results with a token."
  - "Source contracts reject current-day summary/meal-row APIs and new stale/freshness UI in historical detail refresh code."

requirements-completed: [REAL-03]

duration: 2m 43s
completed: 2026-05-18
---

# Phase 63 Plan 05: Historical Visible-Surface Refresh Summary

**Open historical Day Detail views now refetch only for matching affected-date meal mutations, while History keeps selected-day/current-week gating.**

## Performance

- **Duration:** 2m 43s
- **Started:** 2026-05-18T08:13:21Z
- **Completed:** 2026-05-18T08:16:04Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added RED source-contract coverage requiring Day Detail to observe `lastMealMutation`, match `affectedDate === dateKey`, use the history snapshot endpoint, preserve cancellation, and reject today summary/meal-row APIs.
- Wired `HistoryDayDetailScreen` to refresh through `getHistoryDaySnapshot(dateKey)` only when `lastMealMutation.affectedDate` matches the open detail date.
- Added a component-local latest token so older initial or invalidation fetches cannot overwrite newer visible-date refresh results.
- Preserved existing History selected-day/current-week invalidation behavior and added contract proof that History tab presence alone does not refresh.

## Task Commits

1. **Task 1: Add source-contract proof for historical visible refresh boundaries** - `117e42c` (test)
2. **Task 2: Wire matching Day Detail refresh through `lastMealMutation`** - `46149da` (feat)
3. **Task 3: Run Phase 63 client and integration closure checks** - `51b47fc` (chore, empty verification commit)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `client/src/components/HistoryDayDetailScreen.tsx` - Selects `lastMealMutation`, uses a shared latest-token `loadSnapshot` helper, and refetches the open detail only for matching affected dates.
- `tests/unit/history-day-detail-source-contract.test.ts` - Guards exact-date mutation matching, snapshot-source refresh, cancellation, no today state actions, and no new stale/freshness UI.
- `tests/unit/history-screen-contract.test.ts` - Guards selected-day/current-week-only History invalidation and rejects active-History-tab refresh shortcuts.
- `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-05-SUMMARY.md` - Execution summary and verification record.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-day-detail-source-contract.test.ts tests/unit/history-screen-contract.test.ts` - RED failed before implementation on missing `lastMealMutation` selector in Day Detail.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-day-detail-source-contract.test.ts tests/unit/history-screen-contract.test.ts` - PASS after implementation, 20/20 tests.
- `yarn tsc --noEmit` - PASS.
- `yarn test:unit` - PASS, 799/799 tests.
- `yarn test:integration` - FAIL, 299/303 tests passed. The four failures match the pre-existing Phase 63 deferred harness-consumer migration: `meal-delete-consistency` subscribe/step assertions and `text-log` summary assertions still parse the strict `daily_summary` envelope as a raw `DailySummary`.

## Decisions Made

- Used a per-component monotonic token rather than AbortController because the requirement is latest-write suppression; no network cancellation primitive is needed for this narrow component.
- Kept Day Detail loading/error/empty copy unchanged and reused the existing snapshot endpoint as the sole data source.
- Did not change `HistoryScreen.tsx`; its existing selected-day/current-week invalidation already matched D-30 and D-31, so the plan added source-contract proof only.

## Deviations from Plan

### Auto-fixed Issues

None - implementation followed the planned behavior.

---

**Total deviations:** 0 auto-fixed.
**Impact on plan:** No behavior outside the declared files was added.

## Issues Encountered

- `yarn test:integration` still fails on the known deferred Phase 63 harness-consumer migration already recorded in `deferred-items.md`: `meal-delete-consistency` and `text-log` parse `daily_summary` SSE payloads as raw summaries instead of strict envelopes. This was not caused by Plan 05 and was left out of scope per the existing deferral.

## Known Stubs

None. Stub-pattern scan found only test assertions for legitimate nullable History display state.

## Threat Flags

None. The plan added no new endpoints, auth paths, file access patterns, schema changes, or external trust boundaries; it only consumes the existing `lastMealMutation` store signal and existing history snapshot API.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 63 client historical invalidation behavior is implemented and locally proven by targeted contracts, TypeScript, and unit gates. Phase 64 should address or explicitly carry forward the known integration harness envelope-consumer migration before treating the full integration suite as green.

## Self-Check: PASSED

- Summary file exists.
- Planned Day Detail and source-contract files exist.
- Task commits `117e42c`, `46149da`, and `51b47fc` exist in git history.

---
*Phase: 63-sse-meal-row-freshness-and-affected-date-invalidation*
*Completed: 2026-05-18*
