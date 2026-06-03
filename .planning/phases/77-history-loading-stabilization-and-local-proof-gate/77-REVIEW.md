---
phase: 77-history-loading-stabilization-and-local-proof-gate
reviewed: 2026-06-03T19:22:54Z
depth: standard
status: issues_found
reviewed_files:
  count: 4
  list:
    - client/src/components/HistoryScreen.tsx
    - client/src/contracts/capability-matrix.ts
    - tests/unit/history-screen-contract.test.ts
    - tests/harness/scenarios/77-history-loading-visual.mjs
files_reviewed: 4
files_reviewed_list:
  - client/src/components/HistoryScreen.tsx
  - client/src/contracts/capability-matrix.ts
  - tests/unit/history-screen-contract.test.ts
  - tests/harness/scenarios/77-history-loading-visual.mjs
findings:
  critical: 0
  warning: 3
  info: 0
  total: 3
---

# Phase 77: Code Review Report

**Reviewed:** 2026-06-03T19:22:54Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the scoped Phase 77 History source, capability matrix row, source-contract unit test, and synthetic visual harness. The production `HistoryScreen.tsx` change preserves snapshot-backed rows, Meal Edit payloads, confirmed-empty detail activation, and scoped mutation refresh in the reviewed code. The concrete defects are in the capability-matrix contract and the visual proof harness: the matrix still misclassifies an active Meal Edit handoff as read-only History browsing, and the harness can falsely pass pending-row and external-network privacy regressions.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: History capability row classifies an active Meal Edit handoff as read-only

**Classification:** WARNING
**File:** `client/src/contracts/capability-matrix.ts:229`
**Issue:** The History row is declared `supported-read-only` and only lists `openDayDetail` as its store action, but its handler matchers include `onMealOpen(meal)` while `HistoryScreen.tsx:246-247` calls `openMealEdit(buildHistoryMealEditPayload(meal, selectedDateKey), "history")`. That means the matrix now covers the new confirmed-empty Day Detail handler by keeping it in a row that also silently covers an active edit affordance without declaring `openMealEdit` or the Meal Edit route/service contract. Downstream capability checks can treat History as read-only even though meal rows actively hand off to Meal Edit.
**Fix:** Split the concerns into two rows, or update the existing row so its support state and backing contracts match the active handler. The safer shape is:

```ts
{
  surface: "History",
  affordance: "Trend and day browsing",
  sourceMatchers: ["getHistoryTrends", "getHistoryDaySnapshot", "openDayDetail", "openConfirmedEmptyDayDetail", "moveWeek"],
  handlerMatchers: ["onSelect(day.dateKey)", "onTimelineOpen()", "handleTimelineKeyDown", "openConfirmedEmptyDayDetail", "moveWeek"],
  supportState: "supported-read-only",
  storeAction: ["openDayDetail"],
  // ...
},
{
  surface: "History",
  affordance: "Meal Edit handoff",
  sourceMatchers: ["buildHistoryMealEditPayload(meal, selectedDateKey)", "openMealEdit"],
  handlerMatchers: ["onMealOpen(meal)"],
  supportState: "supported",
  storeAction: ["openMealEdit"],
  backendRoute: ["/api/meals/:id"],
  backendService: ["updateMeal"],
  // ...
}
```

### WR-02: Pending visual proof does not fail when meal rows are rendered during loading

**Classification:** WARNING
**File:** `tests/harness/scenarios/77-history-loading-visual.mjs:438`
**Issue:** The harness collects `.sp-history-meal-row` text but never asserts that pending state has zero meal rows. The only pending stale-row check is `includesCurrentWeekStaleMeals` for two synthetic current-week labels at `tests/harness/scenarios/77-history-loading-visual.mjs:449` and `tests/harness/scenarios/77-history-loading-visual.mjs:492`. A regression that renders disabled/skeleton rows, target-week trend-only rows, or stale rows with different labels would still pass while violating the Phase 77 contract that pending cold switches expose no meal row/edit affordances before the selected day snapshot resolves.
**Fix:** Make pending proof assert the row boundary directly:

```js
if (phase === "pending") {
  if (value.mealRows.length !== 0) {
    throw new Error(`Phase 77 visual evidence failed: pending state rendered meal rows: ${value.mealRows.join(", ")}`);
  }
}
```

Also add manifest booleans such as `noPendingMealRows` and, if desired, `noPendingMealEditButtons`.

### WR-03: External-network privacy claim only covers `fetch`, not browser resource requests

**Classification:** WARNING
**File:** `tests/harness/scenarios/77-history-loading-visual.mjs:326`
**Issue:** The visual harness claims that "external and unmocked backend calls must fail the run" at `tests/harness/scenarios/77-history-loading-visual.mjs:686`, but the implementation only overrides `window.fetch`. Browser resource loads such as `<img src="https://...">`, CSS `url(...)`, preloads, or navigation requests are not routed through that override, so a client-bundle change could leak or depend on external resources while this privacy proof still passes.
**Fix:** Enable CDP network monitoring before navigation and fail on non-loopback requests, for example:

```js
await send("Network.enable");
const observedRequests = [];
// Extend cdpSession to surface Network.requestWillBeSent events, push event.request.url
// into observedRequests, and fail after capture if any URL origin differs from server.origin.
```

Alternatively, subscribe to `Network.requestWillBeSent` and collect every request URL, then assert all origins are the loopback server before writing the manifest.

---

_Reviewed: 2026-06-03T19:22:54Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
