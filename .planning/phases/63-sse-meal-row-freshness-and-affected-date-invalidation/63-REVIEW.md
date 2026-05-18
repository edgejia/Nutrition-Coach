---
phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
reviewed: 2026-05-18T08:25:04Z
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

**Reviewed:** 2026-05-18T08:25:04Z
**Depth:** standard
**Files Reviewed:** 21
**Status:** issues_found

## Summary

Reviewed the listed client SSE coordinator, SSE client, affected-date type changes, realtime publisher, chat/meals/SSE routes, integration coverage, and the boundary harness. One blocker remains in the `/api/sse` route: the route has a subscription race that can drop exactly the meal-mutation event this phase depends on for freshness.

## Critical Issues

### CR-01: [BLOCKER] `/api/sse` can miss meal mutations before subscription

**File:** `server/routes/sse.ts:44`

**Issue:** The route writes the initial `daily_summary` frame at lines 44-49 and only subscribes the reply at line 52. Any meal mutation that commits and calls `publishDailySummary()` while `getDailySummary()` is running or while the initial frame is being written publishes to zero subscribers, so the client never receives the affected-date invalidation. The current tests mutate only after reading the initial frame, so they do not cover this blind window. This breaks the phase's core freshness contract: an EventSource connection can look established while missing the first post-connect meal update.

**Fix:**
```ts
let closed = false;
let keepalive: ReturnType<typeof setInterval> | undefined;

const cleanup = () => {
  if (closed) return;
  closed = true;
  if (keepalive) clearInterval(keepalive);
  publisher.unsubscribe(deviceId, reply);
  logSseConnectionState(request.log, { state: "closed" });
};

request.raw.on("close", cleanup);
publisher.subscribe(deviceId, reply);
logSseConnectionState(request.log, { state: "opened" });

try {
  const summary = await summaryService.getDailySummary(deviceId, currentAppDate());
  if (!closed) {
    reply.raw.write(`event: daily_summary\ndata: ${JSON.stringify({
      summary,
      affectedDate: summary.date,
      source: "initial",
    })}\n\n`);
  }
} catch (error) {
  cleanup();
  if (!reply.raw.destroyed) reply.raw.end();
  request.log.error({ event: "sse_initial_summary_failed" }, "SSE initial summary failed");
  return;
}

keepalive = setInterval(() => {
  if (!reply.raw.destroyed) reply.raw.write(": keepalive\n\n");
}, 30000);
```

Also add an integration test that holds `summaryService.getDailySummary()` open, mutates a meal while the connection is pending, then releases the initial summary and asserts the client receives the mutation `daily_summary` envelope.

---

_Reviewed: 2026-05-18T08:25:04Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
