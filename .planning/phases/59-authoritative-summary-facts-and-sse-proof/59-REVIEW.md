---
phase: 59-authoritative-summary-facts-and-sse-proof
reviewed: 2026-05-16T17:02:31Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - server/orchestrator/summary-history-renderer.ts
  - tests/unit/summary-history-renderer.test.ts
  - server/orchestrator/index.ts
  - tests/unit/orchestrator.test.ts
  - server/routes/chat.ts
  - tests/integration/chat-api.test.ts
  - tests/integration/chat-streaming.test.ts
  - tests/integration/verification-image.test.ts
  - tests/harness/sse.ts
  - tests/unit/sse-terminal-proof.test.ts
  - tests/harness/artifacts.ts
  - tests/unit/verification-artifacts.test.ts
  - tests/harness/scenarios/image-log-failure.ts
findings:
  critical: 2
  warning: 0
  info: 0
  total: 2
status: issues_found
---

# Phase 59: Code Review Report

**Reviewed:** 2026-05-16T17:02:31Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Reviewed the Phase 59 summary/history renderer, orchestrator wiring, chat route SSE/JSON normalization, harness SSE proof helpers, artifact redaction, and related unit/integration/harness tests. Two blocking correctness defects remain in the summary/history response path: route-level recomposition drops safe advice that the orchestrator already accepted, and cross-year summary dates are rendered without the year.

## Critical Issues

### CR-01: Route Recomposition Drops Accepted Summary Advice

**Classification:** BLOCKER
**File:** `server/routes/chat.ts:1363`
**Issue:** The JSON direct-result path calls `normalizeRouteFinalReply(..., { composeSummaryHistory: !result.fallbackOutcomeContext })` even when `orchestrator.handleMessage()` already returned a renderer-owned summary/history reply. The orchestrator composes safe advice at `server/orchestrator/index.ts:841`, so a reply such as `今天已記錄 2 餐，共 900 kcal：...\n\n可以保持清淡。` reaches the route as already-authoritative output. The route then treats that whole reply as new model advice; `guardSummaryHistoryAdvice()` sees the deterministic meal/kcal facts in the prefix and drops the advice, leaving only the fact segment. The same double-composition condition exists in the SSE direct-result path at `server/routes/chat.ts:994`. This regresses the Plan 59 safe-advice contract and is not covered by route integration tests.
**Fix:**
```ts
const shouldComposeAtRoute =
  result.finalReplySource !== "renderer" && !result.fallbackOutcomeContext;

const normalizedReply = normalizeRouteFinalReply(
  appendHistoricalDateSuffixIfMissing(replyText, affectedDate),
  didLogMeal,
  jsonDidMutateMeal,
  summaryHistoryFacts,
  { composeSummaryHistory: shouldComposeAtRoute },
).reply;
```
Apply the same guard in the SSE direct-result branch, and add JSON/SSE route regressions where `get_daily_summary` returns safe generic advice like `可以保持清淡，晚餐多補水。`.

### CR-02: Cross-Year Summary Dates Lose The Year

**Classification:** BLOCKER
**File:** `server/orchestrator/summary-history-renderer.ts:33`
**Issue:** `formatSummaryDateLabel()` renders every valid non-today date as `${month}/${day}`. For a summary date like `2025-03-25` while the app date is in 2026, the reply becomes `3/25已記錄...` with no year. That violates the repo's historical-date rule requiring concrete dates for non-today history, and the route will not repair it because `appendHistoricalDateSuffixIfMissing()` sees `3/25` as an existing concrete date and skips adding the year.
**Fix:**
```ts
const year = Number(match[1]);
const month = Number(match[2]);
const day = Number(match[3]);
return year === currentDate.getFullYear()
  ? `${month}/${day}`
  : `${year}/${month}/${day}`;
```
Add a renderer unit test with `currentDate: new Date("2026-05-17T12:00:00")` and `dailySummary.date: "2025-03-25"`, plus a route-level regression if historical summary replies are expected through `/api/chat`.

---

_Reviewed: 2026-05-16T17:02:31Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
