---
phase: 67-correction-targeting-and-backend-clarification-rendering
reviewed: 2026-05-29T07:27:12Z
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
  critical: 0
  warning: 2
  info: 0
  total: 2
status: issues_found
---

# Phase 67: Code Review Report

**Reviewed:** 2026-05-29T07:27:12Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Reviewed the correction targeting service, orchestrator tool contracts, backend-owned receipt renderers, system prompt guidance, and neighboring unit/integration coverage. The prior critical TARGET-01 findings are resolved by 67-07. Two advisory warnings remain outside the 67-07 gap-closure scope.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: RESOLVED - Explicit historical correction lookup is capped before date scoping

**File:** `server/services/meal-correction.ts:568`

**Issue:** Previously, `loadActiveCandidates()` loaded only the newest 20 active meals before explicit date scoping, so older explicit-date targets could be dropped before ranking.

**Resolution:** 67-07 resolves the target date before loading candidates and passes `targetDateKey` into `loadActiveCandidates()`, which filters headers by date before applying the newest cap. `tests/unit/meal-correction.test.ts` now includes a regression with one 2026-04-18 target meal plus 21 newer active meals.

```ts
const dateResolution = resolveFindMealsTargetDateKey(query, action, options);
const candidates = await loadActiveCandidates(deviceId, {
  targetDateKey: dateResolution.status === "resolved" ? dateResolution.targetDateKey : undefined,
});
```

### CR-02: RESOLVED - Unmatched Latin food names can fall through to period-only targeting

**File:** `server/services/meal-correction.ts:344`

**Issue:** Previously, `hasLikelyFoodReference()` only recognized a fixed set of Chinese food characters, so unmatched Latin food labels could fall through to period-only targeting.

**Resolution:** 67-07 adds residual evidence stripping for date, period, action, nutrient, unit, and numeric text, then treats remaining Latin tokens such as `burger` as food evidence. The new regression proves `把今天午餐 burger 改成 500 卡` does not resolve an unrelated lunch.

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

_Reviewed: 2026-05-29T07:27:12Z_
_Reviewer: Codex execute-phase advisory review refresh_
_Depth: standard_
