---
phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
reviewed: 2026-05-18T08:31:06Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - client/src/components/HistoryDayDetailScreen.tsx
  - client/src/components/MainLayout.tsx
  - client/src/lib/history-week.ts
  - client/src/sse-summary-coordinator.ts
  - client/src/sse.ts
  - client/src/types.ts
  - server/realtime/publisher.ts
  - server/routes/chat.ts
  - server/routes/meals.ts
  - server/routes/sse.ts
  - tests/harness/scenarios/boundary-contracts.ts
  - tests/integration/chat-api.test.ts
  - tests/integration/meals-api.test.ts
  - tests/integration/sse.test.ts
  - tests/unit/history-day-detail-source-contract.test.ts
  - tests/unit/history-screen-contract.test.ts
  - tests/unit/history-week.test.ts
  - tests/unit/main-layout-sse-contract.test.ts
  - tests/unit/mobile-shell.test.ts
  - tests/unit/sse-client.test.ts
  - tests/unit/sse-summary-coordinator.test.ts
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 63: Code Review Report

**Reviewed:** 2026-05-18T08:31:06Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Reviewed the listed client SSE coordinator, SSE client, affected-date type changes, realtime publisher, chat/meals/SSE routes, integration coverage, and the boundary harness. The prior blocker is fixed: `/api/sse` now subscribes before awaiting the initial summary, and `tests/integration/sse.test.ts` includes a regression that publishes while `getDailySummary()` is still blocked.

One blocker remains: the SSE `daily_summary` payload migration to `{ summary, affectedDate, source }` did not update all deterministic harness consumers. The integration gate currently fails because existing harness scenarios still parse `event: daily_summary` data as a raw `DailySummary`.

## Critical Issues

### CR-01: [BLOCKER] Existing harness scenarios still parse `daily_summary` as the old raw summary shape

**File:** `server/routes/sse.ts:63`

**Issue:** The `/api/sse` route now emits an envelope (`{ summary, affectedDate, source }`) for the initial `daily_summary` event, and `RealtimePublisher.publishDailySummary()` emits the same envelope for mutation pushes. The changed integration tests cover the new envelope, but existing deterministic harness scenarios still parse `JSON.parse(frame.data)` directly as `DailySummary` and then read `.date` / `.mealCount`. That makes the release gate fail even though the new regression for the previous subscription race passes. Running `yarn test:integration --test-name-pattern "subscribes before the initial daily_summary"` still executed the integration suite and failed four tests:

- `tests/integration/meal-delete-consistency.test.ts`: `subscribe_summary` fails because the parsed payload has `summary.mealCount`, not top-level `mealCount`.
- `tests/integration/verification-text.test.ts`: `verify_summary` fails because the post-log SSE payload is the envelope, not a raw summary.

The same stale parsing pattern is visible in direct harness sources such as `tests/harness/scenarios/text-log.ts` and `tests/harness/scenarios/meal-delete-consistency.ts`, and `tests/harness/scenarios/daily-rollover.ts` has the same top-level `date` expectation. This blocks shipping because the repo-native integration/harness proof suite no longer passes after the wire-shape change.

**Fix:**
```ts
type DailySummaryEnvelope = {
  summary?: DailySummary;
  affectedDate?: string;
  source?: "initial" | "meal_mutation";
};

function parseDailySummaryFrame(data: string): DailySummary | undefined {
  const parsed = JSON.parse(data) as DailySummary | DailySummaryEnvelope;
  if ("summary" in parsed && parsed.summary) {
    return parsed.summary;
  }
  return parsed as DailySummary;
}
```

Use that helper in the direct harness SSE readers before asserting `date` or `mealCount`, or update each affected scenario to assert the envelope and then inspect `payload.summary`. Re-run `yarn test:integration` afterward; the current failures are direct evidence that this is not just stale documentation.

---

_Reviewed: 2026-05-18T08:31:06Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
