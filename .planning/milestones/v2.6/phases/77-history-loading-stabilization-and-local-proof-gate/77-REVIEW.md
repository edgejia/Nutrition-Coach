---
phase: 77-history-loading-stabilization-and-local-proof-gate
reviewed: 2026-06-03T20:35:28Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - client/src/components/HistoryScreen.tsx
  - tests/unit/history-screen-contract.test.ts
  - tests/harness/scenarios/77-history-loading-visual.mjs
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
status: issues_found
---

# Phase 77: Code Review Report

**Reviewed:** 2026-06-03T20:35:28Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed the Plan 77-04 source scope after applying the Nutrition-specific review checks. The `HistoryScreen.tsx` runtime path appears to close GAP-77-UAT-01: selected-day pending copy is gated by the delayed timer, longer cold loads can still show the inline copy, timeline rows remain snapshot-backed, and the page-level week loading card was not reintroduced. The findings are proof-layer defects: two false-pass risks in the tests/harness and one traceability gap in the generated visual manifest.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Fast-click harness can miss stale rows from the immediately previous selected day

**Classification:** WARNING
**File:** `tests/harness/scenarios/77-history-loading-visual.mjs:553`
**Issue:** The fast date-click sampler only flags stale meal rows matching the current-week labels `燕麥優格` and `雞胸飯`. The fast-click path runs after the harness has loaded `2026-04-29`, then clicks `2026-05-01`; if a regression kept the previous selected-day rows (`紫米飯糰` / `鮭魚藜麥碗`) visible under the new `5/1` target date until the fast snapshot resolved, `noStaleCurrentWeekMeals` at lines 572 and 596 would still pass. That leaves a false-pass hole for the requested "no stale rows" contract.
**Fix:**
```js
const priorTargetMealPattern = /紫米飯糰|鮭魚藜麥碗/;
// in each sample
includesPriorSelectedDayStaleMeals:
  priorTargetMealPattern.test(historyText) && !Boolean(state.fastSnapshotResolved),

// in the resolved result
noPriorSelectedDayStaleMeals:
  !samples.some((item) => item.includesPriorSelectedDayStaleMeals),

// after collection
if (!value.noPriorSelectedDayStaleMeals) {
  throw new Error("Phase 77 visual evidence failed: prior selected-day meal labels appeared during fast date click.");
}
```

### WR-02: Source contract does not prove the timeout uses the delay constant or resets on date changes

**Classification:** WARNING
**File:** `tests/unit/history-screen-contract.test.ts:236`
**Issue:** The delayed-pending contract checks that `window.setTimeout` eventually calls `setDelayedInlineDayPending(true)`, then separately checks that `DAY_PENDING_COPY_DELAY_MS` and `selectedDateKey` appear somewhere in the file. An implementation could call `window.setTimeout(..., 0)` or omit `selectedDateKey` from the effect dependencies while still passing this source contract, reopening fast flicker or stale timer behavior.
**Fix:**
```ts
assert.match(
  source,
  /window\.setTimeout\(\(\) => \{[\s\S]*setDelayedInlineDayPending\(true\)[\s\S]*\}, DAY_PENDING_COPY_DELAY_MS\)/,
);
assert.match(
  source,
  /useEffect\(\(\) => \{[\s\S]*inlineDayPendingTimerRef[\s\S]*\}, \[dayError, loadingDay, selectedDateKey, selectedDaySnapshotPending\]\)/,
);
```

### WR-03: Manifest interaction trace omits the fast date click

**Classification:** WARNING
**File:** `tests/harness/scenarios/77-history-loading-visual.mjs:748`
**Issue:** `collectFastPendingCopySamples()` pushes `week-day:fast-2026-05-01` at line 539, but the manifest uses `loadedInspection.interactions`, which is captured before the fast click. The generated manifest therefore lists only `bottom-nav:history` and `week-control:previous`, even though it claims fast-date-click proof. The assertions still run, but the artifact trace is incomplete and less useful for auditing the exact user path that closed GAP-77-UAT-01.
**Fix:**
```js
// include this in collectFastPendingCopySamples() result
interactions: state.interactions ?? [],

// then write the post-fast-click trace
interactions: fastDateClick.interactions,
```

---

_Reviewed: 2026-06-03T20:35:28Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
