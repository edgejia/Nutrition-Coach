---
phase: 66-numeric-correction-provenance-guard
reviewed: 2026-05-28T08:40:47Z
depth: standard
files_reviewed: 22
files_reviewed_list:
  - server/app.ts
  - server/orchestrator/index.ts
  - server/orchestrator/meal-numeric-authority.ts
  - server/orchestrator/mutation-receipts.ts
  - server/orchestrator/source-text-guard.ts
  - server/orchestrator/system-prompt.ts
  - server/orchestrator/tools.ts
  - server/services/meal-correction.ts
  - server/services/meal-numeric-proposals.ts
  - tests/integration/chat-api.test.ts
  - tests/integration/chat-goal-update.integration.test.ts
  - tests/integration/chat-meal-correction.integration.test.ts
  - tests/integration/chat-streaming.test.ts
  - tests/unit/meal-correction.test.ts
  - tests/unit/meal-numeric-authority.test.ts
  - tests/unit/meal-numeric-proposals.test.ts
  - tests/unit/mutation-receipts.test.ts
  - tests/unit/orchestrator-registry.test.ts
  - tests/unit/orchestrator.test.ts
  - tests/unit/source-text-guard.test.ts
  - tests/unit/system-prompt.test.ts
  - tests/unit/tools.test.ts
findings:
  critical: 2
  warning: 1
  info: 0
  total: 3
status: issues_found
---

# Phase 66: Code Review Report

**Reviewed:** 2026-05-28T08:40:47Z
**Depth:** standard
**Files Reviewed:** 22
**Status:** issues_found

## Summary

Reviewed the numeric meal-correction provenance guard, proposal storage, orchestrator short-circuit paths, renderer copy, and the associated unit/integration coverage. The implementation has two blocking correctness defects in the state and source-authority boundaries, plus one explicit-value parsing gap that should be fixed with focused regression coverage.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Stored Meal Proposal Approval Leaves A Stale Pending Meal Selection

**File:** `server/orchestrator/index.ts:800`

**Issue:** The meal-proposal approval path applies the stored proposal by calling `deps.mealCorrectionService.updateMeal(...)` directly, clears only `mealNumericProposalService`, and returns. It bypasses the normal `update_meal` tool cleanup in `server/orchestrator/tools.ts:1515`, so the `meal_target_selection` turn-state row created by the earlier `find_meals` resolution remains active with the old `mealRevisionId`. A natural follow-up such as "再改成 22g" can then resolve through that stale pending selection and fail the revision precondition for up to 15 minutes, even though the user is continuing from the just-updated meal.

**Fix:**
```ts
const updated = await deps.mealCorrectionService.updateMeal(
  deviceId,
  activeMealProposal.mealId,
  buildMealNumericProposalUpdateInput(activeMealProposal),
  activeMealProposal.expectedMealRevisionId,
);
await deps.mealCorrectionService.clearPendingSelection(deviceId);
await deps.mealNumericProposalService?.clear(deviceId);
```

Add an integration regression that creates a meal proposal through `find_meals`, approves it, then sends a follow-up correction and asserts it does not reuse the stale revision.

### CR-02: Negated Numeric Values Are Treated As Authorized Meal Targets

**File:** `server/orchestrator/meal-numeric-authority.ts:106`

**Issue:** `extractMealNumericEvidence()` authorizes every number in the text segment after a field label until the next field label. It does not distinguish final target values from negated or rejected values. For example, "蛋白質不是 30g，改成 28g" authorizes both `30` and `28`, so an `update_meal` call setting `protein: 30` would pass the guard even though the user explicitly rejected 30. This breaks the provenance guard's core contract and can commit incorrect meal nutrition values.

**Fix:**
```ts
// Sketch: only accept numbers in positive target clauses, and reject negated spans.
const TARGET_VALUE_RE = /(?:改成|改為|改到|變成|換成|調成)\s*(\d+(?:\.\d+)?|[一二兩三四五六七八九十百千]+)/g;
const NEGATED_VALUE_RE = /(?:不是|不要|別|非)\s*(\d+(?:\.\d+)?|[一二兩三四五六七八九十百千]+)/g;
```

Implement this with the existing Chinese-numeral normalizer rather than ad hoc string comparison, and add tests for "不是 30g，改成 28g" and "不要 500 卡，改 450 卡".

## Warnings

### WR-01: Bare Chinese Numerals After Common Target Verbs Are Rejected

**File:** `server/orchestrator/meal-numeric-authority.ts:112`

**Issue:** The meal-specific evidence extractor only adds a bare Chinese digit when it is the first character of the field segment. That handles "脂肪五", but common explicit target phrasing such as "脂肪改成五" or "蛋白質改為八" is rejected because `compact[0]` is the verb character, not the digit. The unit test claims bare Chinese digits are supported, but it only covers the narrow no-verb form.

**Fix:** Scan the whole field segment for bare Chinese digits after target-setting verbs, or extend `normalizeNumericSourceText()` with a context-aware option for bare nutrition values. Add unit tests for `脂肪改成五` and `蛋白質改為八`.

---

_Reviewed: 2026-05-28T08:40:47Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
