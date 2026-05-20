---
phase: 61-committed-mutation-outcome-and-summary-contract
reviewed: 2026-05-17T07:49:58Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - client/src/api.ts
  - client/src/components/MealEditScreen.tsx
  - client/src/components/SummaryDetailScreen.tsx
  - client/src/types.ts
  - server/app.ts
  - server/orchestrator/index.ts
  - server/orchestrator/mutation-effects.ts
  - server/orchestrator/mutation-receipts.ts
  - server/orchestrator/tools.ts
  - server/routes/chat.ts
  - server/routes/meals.ts
  - server/services/meal-correction.ts
  - server/services/summary-outcome.ts
  - tests/integration/chat-api.test.ts
  - tests/integration/chat-streaming.test.ts
  - tests/integration/meals-api.test.ts
  - tests/unit/api-client.test.ts
  - tests/unit/meal-correction.test.ts
  - tests/unit/meal-edit-screen.test.ts
  - tests/unit/mutation-receipts.test.ts
  - tests/unit/orchestrator.test.ts
  - tests/unit/summary-outcome.test.ts
  - tests/unit/tools.test.ts
findings:
  critical: 1
  warning: 2
  info: 0
  total: 3
status: issues_found
---

# Phase 61: Code Review Report

**Reviewed:** 2026-05-17T07:49:58Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Reviewed the Phase 61 client, route, service, orchestrator, and test files with the Nutrition Coach review guidance applied. The main correctness gap is that goal updates can be committed in storage but reported to the user as failed when a later non-committing side effect throws. Two additional contract mismatches leave grouped-meal details or tool-call shape guarantees weaker than the new UI and mutation receipt code imply.

## Critical Issues

### CR-01: Committed goal updates can be converted into failed chat outcomes

**Classification:** BLOCKER
**File:** `server/orchestrator/tools.ts:1454`
**Issue:** `update_goals` commits the new targets with `deviceService.updateGoals`, then clears the proposal and publishes the realtime event before returning success. If either post-commit operation throws, the tool call exits as an error even though the goals were already changed. The same committed-success path is then exposed to another post-commit failure in `server/orchestrator/index.ts:1041`, where `summaryService.getDailySummary` is awaited only to populate a goals mutation receipt field that the receipt renderer does not need. In those failure modes the user can receive fallback/error behavior and no `dailyTargets` in `done`, while storage already contains the new targets. This violates the Phase 61 committed mutation outcome contract and differs from the meal route pattern that keeps publish/recompute failures metadata-only after a write.
**Fix:**
```ts
const targets = await deps.deviceService.updateGoals(deviceId, updatePatch);

try {
  await deps.goalProposalService.clear(deviceId);
} catch {
  // Log if a logger is available, but do not overturn the committed target update.
}

const publishedEvents: string[] = [];
try {
  deps.publisher.publishGoalsUpdate(deviceId, targets);
  publishedEvents.push("goals_update");
} catch {
  // Keep publish failure out of the user-visible mutation outcome.
}

return {
  ok: true,
  result: { targets, updatedFields, publishedEvents },
  toolMessage: formatGoalsReceipt(targets),
};
```

Also remove the unnecessary `committedSummary` requirement from goals mutation effects, or recover it best-effort instead of throwing after the target update has committed:

```ts
mutationEffects = {
  kind: "goals",
  affectedDate: formatLocalDate(currentAppDate()),
  committedTargets: dailyTargets,
  targets: dailyTargets,
  updatedFields: updatedFields as Array<keyof DailyTargets>,
};
```

Add integration coverage that forces `publisher.publishGoalsUpdate` and `summaryService.getDailySummary` to throw after `update_goals` and asserts the chat response still includes the committed targets.

## Warnings

### WR-01: `log_food` tool schema requires a field the executor treats as optional

**Classification:** WARNING
**File:** `server/orchestrator/tools.ts:946`
**Issue:** The public tool definition marks `protein_sources` as required, but the zod schema, normalizer, and existing direct executor tests accept ordinary `log_food` calls without that field. This mismatch means local tests can pass while the LLM-facing schema pushes a different contract, especially for text-only foods or grouped meals where no visually identifiable protein source exists.
**Fix:** Make the tool definition match the executor contract and add a schema assertion in `tests/unit/tools.test.ts`.

```ts
protein_sources: {
  type: "array",
  description: "List identifiable protein-bearing ingredients when available; mark uncertain when estimated from an image.",
  items: { /* unchanged */ },
},
additionalProperties: false,
// Do not require protein_sources unless the zod schema also requires it.
```

### WR-02: Grouped meal item details are not returned on the current meals route

**Classification:** WARNING
**File:** `server/routes/meals.ts:121`
**Issue:** `MealEditScreen` now renders grouped item details when `payload.items` is present, and `client/src/types.ts` exposes `MealEntry.items`, but `GET /api/meals` only returns the aggregate display fields and `itemCount`. A grouped meal opened from today's meals therefore shows the grouped lock state without the item-level calories/macros that the UI branch was written to display. The current integration test at `tests/integration/meals-api.test.ts:175` asserts only `itemCount`, so this regression is not covered.
**Fix:** Carry item rows through the meal history service and route DTO, then assert them in the meals API test.

```ts
return {
  id: header.id,
  foodName: display.foodName,
  itemCount: display.itemCount,
  calories: revisionItems.reduce((sum, item) => sum + item.calories, 0),
  protein: revisionItems.reduce((sum, item) => sum + item.protein, 0),
  carbs: revisionItems.reduce((sum, item) => sum + item.carbs, 0),
  fat: revisionItems.reduce((sum, item) => sum + item.fat, 0),
  items: revisionItems.map((item) => ({
    name: item.foodName,
    position: item.position,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
  })),
  imagePath: revision?.imageAssetId ? makeAssetRef(revision.imageAssetId) : null,
  loggedAt: header.loggedAt,
};
```

Then include `items` in the `/api/meals` response and update the grouped-meal integration test to assert the array shape.

---

_Reviewed: 2026-05-17T07:49:58Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
