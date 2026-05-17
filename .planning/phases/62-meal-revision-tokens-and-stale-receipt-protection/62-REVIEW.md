---
phase: 62-meal-revision-tokens-and-stale-receipt-protection
reviewed: 2026-05-17T12:59:45Z
depth: standard
files_reviewed: 36
files_reviewed_list:
  - server/services/meal-transactions.ts
  - server/services/food-logging.ts
  - server/routes/meals.ts
  - tests/unit/meal-transactions.test.ts
  - tests/unit/food-logging.test.ts
  - tests/integration/meals-api.test.ts
  - server/services/meal-history.ts
  - server/services/history-query.ts
  - server/services/chat.ts
  - server/routes/day-snapshot.ts
  - server/routes/chat.ts
  - tests/unit/meal-history.test.ts
  - tests/unit/chat.test.ts
  - tests/integration/day-snapshot-api.test.ts
  - tests/integration/history-api.test.ts
  - tests/integration/history-search-api.test.ts
  - tests/integration/chat-api.test.ts
  - tests/integration/chat-streaming.test.ts
  - server/services/meal-correction.ts
  - server/orchestrator/tools.ts
  - server/orchestrator/index.ts
  - tests/unit/meal-correction.test.ts
  - tests/unit/tools.test.ts
  - tests/unit/orchestrator.test.ts
  - tests/integration/chat-meal-correction.integration.test.ts
  - client/src/types.ts
  - client/src/api.ts
  - client/src/meal-edit-payload.ts
  - client/src/store.ts
  - client/src/components/MealEditScreen.tsx
  - client/src/components/MessageBubble.tsx
  - tests/unit/api-client.test.ts
  - tests/unit/meal-edit-payload.test.ts
  - tests/unit/store.test.ts
  - tests/unit/meal-edit-screen.test.ts
  - tests/unit/chat-bubble-contract.test.ts
findings:
  critical: 2
  warning: 0
  info: 0
  total: 2
status: issues_found
---

# Phase 62: Code Review Report

**Reviewed:** 2026-05-17T12:59:45Z
**Depth:** standard
**Files Reviewed:** 36
**Status:** issues_found

## Summary

Reviewed the scoped server, orchestrator, client, and test changes for meal revision tokens and stale receipt protection. The main server revision plumbing is present, but two mutation edge cases still produce incorrect user-visible behavior.

## Critical Issues

### CR-01: Grouped-Meal Guard Masks Stale Revision Conflicts

**Classification:** BLOCKER
**File:** `server/routes/meals.ts:189`
**Issue:** `PATCH /api/meals/:id` checks the current item count before enforcing the submitted `expectedMealRevisionId`. If the editor was opened on a single-item revision and another flow updates that same transaction into a grouped meal before save, this route returns `MEAL_REQUIRES_GROUPED_UPDATE` at lines 193-197 instead of `MEAL_REVISION_STALE`. That bypasses the stale editor handling in `MealEditScreen`, omits `currentMealRevisionId`, and leaves the client on stale state even though the request carried an obsolete revision token. The existing tests cover stale single-item updates and current grouped updates separately, but not the stale-single-to-current-grouped transition.
**Fix:**
```ts
// Enforce the expected revision before any grouped-shape rejection.
const guard = await foodLoggingService.getMealMutationGuard(deviceId, id);
if (!guard) {
  return reply.code(404).send({ error: "Meal not found" });
}
if (guard.currentRevisionId !== update.expectedMealRevisionId) {
  return reply.code(409).send({
    error: update.expectedMealRevisionId ? "MEAL_REVISION_STALE" : "MEAL_REVISION_REQUIRED",
    mealId: id,
    affectedDate: guard.affectedDate,
    currentMealRevisionId: guard.currentRevisionId,
  });
}
if (guard.itemCount > 1) {
  return reply.code(409).send({
    error: "MEAL_REQUIRES_GROUPED_UPDATE",
    message: "Grouped meals must be corrected through chat.",
  });
}
```
Add an integration test where a single-item meal is loaded, then updated into a grouped revision, and a stale direct patch returns `MEAL_REVISION_STALE`.

### CR-02: Successful Today Mutations Do Not Refresh Meals When Summary Recovery Is Unavailable

**Classification:** BLOCKER
**File:** `client/src/components/MealEditScreen.tsx:130`
**Issue:** `refreshAfterMealMutation` returns before fetching `/api/meals` whenever `dailySummary` is missing or not for today. The server now intentionally returns committed mutation facts with `summaryOutcome: { status: "unavailable" }` and no `dailySummary` when recompute and recovery fail, so a successful edit/delete for today's meal can close the editor while the home meal list still shows the stale pre-mutation data. This undercuts the new committed-without-summary path and is not covered by the current source-regex test.
**Fix:**
```ts
async function refreshAfterMealMutation(
  mealId: string,
  affectedDate: string,
  dailySummary?: DailySummary,
) {
  const todayKey = formatLocalDate(new Date());
  redactChatReceiptIdentity(mealId);
  recordMealMutation(affectedDate);
  if (dailySummary?.date === todayKey) {
    setDailySummary(dailySummary);
  }
  if (affectedDate === todayKey) {
    const { meals } = await getMeals({ refreshReason: "meal_mutation" });
    setMeals(meals);
  }
}
```
Add a behavior-level test for a successful today edit/delete response with no `dailySummary` that proves `getMeals({ refreshReason: "meal_mutation" })` still runs.

---

_Reviewed: 2026-05-17T12:59:45Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
