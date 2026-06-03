---
phase: 77-history-loading-stabilization-and-local-proof-gate
plan: 01
subsystem: ui
tags: [react, history, source-contracts, unit-tests, capability-matrix]
requires:
  - phase: 76-grouped-meal-edit-ui-and-conditional-item-media-decision
    provides: Grouped Meal Edit commits and authoritative refresh path
provides:
  - History cold week switches keep target week/date context visible with inline pending day copy
  - Snapshot-backed History timeline rows, Meal Edit payloads, confirmed empty state, Day Detail activation, and error behavior
  - Source contracts for scoped lastMealMutation refresh and History snapshot authority
affects: [HistoryScreen, capability-matrix, phase-77-proof]
tech-stack:
  added: []
  patterns: [source-contract TDD, snapshot-backed UI authority, scoped cache refresh]
key-files:
  created:
    - .planning/phases/77-history-loading-stabilization-and-local-proof-gate/77-01-SUMMARY.md
  modified:
    - tests/unit/history-screen-contract.test.ts
    - client/src/components/HistoryScreen.tsx
    - client/src/contracts/capability-matrix.ts
key-decisions:
  - "History day rows, Meal Edit activation, confirmed empty state, and Day Detail activation now require /api/history/days/:date snapshots."
  - "Cold History week switches use target-week placeholders and inline day pending copy instead of the top-level week loading card."
  - "The new confirmed-empty History Day Detail handler is recorded in the capability matrix as supported read-only History browsing."
patterns-established:
  - "Snapshot authority: trends can support aggregate display, but day snapshot facts unlock rows, empty state, edit identity, and detail activation."
  - "History loading source contracts reject broad cache clears, active-tab gates, stale previous rows, skeleton rows, and top-level cold week loading cards."
requirements-completed: [HIST-UX-01, PROOF-01]
duration: 5m21s
completed: 2026-06-03T18:51:12Z
---

# Phase 77 Plan 01: History Cold-Switch Stabilization Summary

**History cold week switching now keeps target context mounted while snapshot facts remain the only authority for rows, edits, empty days, and Day Detail activation.**

## Performance

- **Duration:** 5m21s
- **Started:** 2026-06-03T18:45:51Z
- **Completed:** 2026-06-03T18:51:12Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added red source contracts for D-01 through D-24 covering cold week-switch pending UI, snapshot-backed timeline authority, and scoped mutation refresh behavior.
- Removed the top-level `載入這週紀錄中...` cold-switch card from History and kept target week/date shell content visible through pending helper output.
- Split History day state into `hasSelectedDaySnapshot`, `selectedDaySnapshotPending`, `confirmedEmptyDay`, `showInlineDayPending`, and `openConfirmedEmptyDayDetail`.
- Kept timeline rows and `buildHistoryMealEditPayload()` sourced only from `snapshot.meals`.
- Added confirmed-empty Day Detail activation only after a loaded empty snapshot.
- Updated the capability matrix source contract so the new empty-day read-only History handler is tracked.

## Task Commits

1. **Task 1: Pin History cold-switch and snapshot-backed source contracts** - `da171f8` (`test`)
2. **Task 2: Implement stable target-context pending and snapshot-backed activation** - `c821dc3` (`feat`)

## Files Created/Modified

- `tests/unit/history-screen-contract.test.ts` - Adds Phase 77 cold-switch, snapshot authority, pending copy, and scoped refresh source contracts.
- `client/src/components/HistoryScreen.tsx` - Removes the disruptive cold week loading card and gates rows, edit payloads, empty state, and Day Detail on selected day snapshots.
- `client/src/contracts/capability-matrix.ts` - Records `openConfirmedEmptyDayDetail` under supported read-only History browsing.

## Decisions Made

- Trends remain display-only aggregate facts for History; `/api/history/days/:date` snapshots are the only authority for row/detail/edit activation.
- The empty History state is interactive only for confirmed empty snapshots, preserving Day Detail as read-only snapshot browsing.
- Capability matrix coverage is required when a new active handler is introduced, even when the handler stays within an existing read-only surface.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Narrowed over-broad red source-contract matcher**
- **Found during:** Task 2
- **Issue:** The Task 1 red contract rejected the legitimate `previousSelectedDateKey` helper argument, not just stale previous-row fallback names.
- **Fix:** Narrowed the rejection to stale previous row/snapshot fallback names.
- **Files modified:** `tests/unit/history-screen-contract.test.ts`
- **Verification:** Targeted source contracts passed.
- **Committed in:** `c821dc3`

**2. [Rule 2 - Missing Critical] Added capability-matrix coverage for new History handler**
- **Found during:** Task 2 verification
- **Issue:** `yarn test:unit` flagged `openConfirmedEmptyDayDetail` as an actionable History handler without matrix coverage.
- **Fix:** Added source and handler matchers to the existing supported-read-only History matrix row.
- **Files modified:** `client/src/contracts/capability-matrix.ts`
- **Verification:** `yarn matrix:check` and `yarn test:unit` passed.
- **Committed in:** `c821dc3`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical contract coverage)
**Impact on plan:** Both fixes tightened the intended contracts without changing architecture or scope.

## Issues Encountered

- Task 1 RED verification failed as expected on the new source contracts while `yarn tsc --noEmit` stayed green.
- Full unit verification initially found the missing capability-matrix matcher for the new confirmed-empty handler; the matrix contract was updated and regenerated with no markdown diff.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts` - RED in Task 1, 16 pass / 3 fail, limited to new History source contracts.
- `yarn tsc --noEmit` - passed after Task 1 test-only edit.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts tests/unit/history-week.test.ts tests/unit/meal-edit-refresh.test.ts` - passed, 34/34.
- `yarn matrix:check` - passed, including generated markdown check.
- `yarn tsc --noEmit` - passed after implementation.
- `yarn test:unit` - passed, 1007/1007.

## Known Stubs

None. Stub scan found only intentional display placeholders such as `--` and existing capability-matrix placeholder metadata.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes were introduced; the new activation path uses the existing `openDayDetail` read-only surface.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can build the synthetic mobile visual proof against the stabilized History UI and source contracts. Plan 03 still owns the broader v2.6 proof matrix, `yarn release:check`, and no-promotion closure language.

## Self-Check

PASSED

- Found summary file: `.planning/phases/77-history-loading-stabilization-and-local-proof-gate/77-01-SUMMARY.md`
- Found task commit: `da171f8`
- Found task commit: `c821dc3`

---
*Phase: 77-history-loading-stabilization-and-local-proof-gate*
*Completed: 2026-06-03*
