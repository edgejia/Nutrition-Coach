---
phase: 67-correction-targeting-and-backend-clarification-rendering
reviewed: 2026-05-28T20:52:05Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - server/services/meal-correction.ts
  - server/orchestrator/mutation-receipts.ts
  - server/orchestrator/tools.ts
  - server/orchestrator/index.ts
  - server/orchestrator/system-prompt.ts
  - tests/unit/meal-correction.test.ts
  - tests/unit/tools.test.ts
  - tests/unit/orchestrator.test.ts
  - tests/unit/mutation-receipts.test.ts
  - tests/unit/system-prompt.test.ts
  - tests/integration/chat-meal-correction.integration.test.ts
findings:
  critical: 2
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 67: Code Review Report

**Reviewed:** 2026-05-28T20:52:05Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Reviewed the correction targeting service, orchestrator tool contracts, backend-owned receipt renderers, system prompt guidance, and neighboring unit/integration coverage. The main risks are incorrect meal targeting for explicit historical dates and unmatched Latin food labels, plus one renderer path that drops invalid-selection guidance before it reaches chat users.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: BLOCKER - Explicit historical correction lookup is capped before date scoping

**File:** `server/services/meal-correction.ts:568`

**Issue:** `loadActiveCandidates()` always loads only the newest 20 active meals (`headers.slice(-limit).reverse()` at line 584), and `findMeals()` applies the explicit date scope later in `resolveByEvidenceTier()` at lines 454-456. Once a device has more than 20 newer meals, an explicit request like "delete 3/25 beef noodles" reports that 2026-03-25 has no meals even when the target meal exists. I reproduced this with one 2026-03-25 meal plus 20 newer meals; the service returned `needs_clarification` with the no-meals copy.

**Fix:** Resolve the target date before loading candidates and query date-scoped candidates from SQLite for explicit dates, or pass `targetDateKey` into candidate loading and apply the cap only after date scoping. Add a regression test with an older explicit-date meal plus more than 20 newer meals.

```ts
const dateResolution = resolveFindMealsTargetDateKey(query, action, options);
const candidates = await loadActiveCandidates(deviceId, {
  targetDateKey: dateResolution.status === "resolved" ? dateResolution.targetDateKey : undefined,
});
```

### CR-02: BLOCKER - Unmatched Latin food names can fall through to period-only targeting

**File:** `server/services/meal-correction.ts:344`

**Issue:** `hasLikelyFoodReference()` only recognizes a fixed set of Chinese food characters. If the user includes an unmatched Latin food label with a meal period, for example "把今天午餐 burger 改成 500 卡", `labelMatches` is empty, `hasLikelyFoodReference()` returns false, and the code proceeds to period matching at lines 490-499. That resolves the unrelated lunch meal instead of asking for clarification. I reproduced this with a single lunch `蛋餅`; the service resolved that meal for the unmatched `burger` query.

**Fix:** Treat non-command Latin/CJK target residue as food evidence after stripping dates, periods, verbs, and numbers, then block weak period/recent fallback when that evidence has no label match.

```ts
const residualTarget = normalizeText(extractTargetEvidenceText(query))
  .replace(/* known date/period/action/numeric tokens */, "");
if (/[a-z][a-z-]{1,}/i.test(residualTarget) || hasLikelyFoodReference(query)) {
  return { status: "needs_clarification", candidates: [], rememberResolved: false };
}
```

## Warnings

### WR-01: WARNING - Invalid selection copy loses the valid-number guidance

**File:** `server/orchestrator/tools.ts:1962`

**Issue:** `meal-correction.ts` builds an invalid-selection prompt with the valid numbers appended, but `renderFindMealsControlledReply()` ignores `result.prompt` whenever candidates are present and share one date. The chat-facing response is re-rendered as "YYYY-MM-DD 有幾筆餐點..." without "有效編號是 1 或 2", so users who picked `3` get the same options again with no explanation that `3` was invalid.

**Fix:** Preserve `result.prompt` for invalid selections, or add an explicit invalid-selection flag to `FindMealsClarificationResult` and pass it through the backend renderer. Strengthen the route test at `tests/integration/chat-meal-correction.integration.test.ts:1216` to assert the valid-number copy appears.

### WR-02: WARNING - Successful log reply helper cannot catch missing uncertainty copy

**File:** `tests/unit/orchestrator.test.ts:59`

**Issue:** `assertSuccessfulLogReplyShape()` has identical assertions in the `expectsUncertainty === true` and `false` branches; both reject uncertainty wording and ranges. Tests that pass `expectsUncertainty: true` therefore do not verify the behavior they claim and can false-pass if uncertainty copy disappears.

**Fix:** Make the true branch assert the expected uncertainty marker or remove the option if successful log replies are no longer supposed to show uncertainty.

```ts
if (opts.expectsUncertainty) {
  assert.match(reply, /(區間|主要誤差|份量|可再補份量修正)/);
} else {
  assert.doesNotMatch(reply, /(區間|主要誤差|份量|可再補份量修正)/);
}
```

---

_Reviewed: 2026-05-28T20:52:05Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
