---
phase: 68-structured-tool-results-and-release-proof-gate
reviewed: 2026-05-29T16:57:41Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - server/orchestrator/tools.ts
  - server/orchestrator/mutation-receipts.ts
  - tests/unit/tools.test.ts
  - tests/unit/orchestrator.test.ts
  - tests/unit/mutation-receipts.test.ts
  - tests/integration/chat-api.test.ts
  - tests/integration/chat-streaming.test.ts
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 68: Code Review Report

**Reviewed:** 2026-05-29T16:57:41Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the Phase 68 orchestrator tool-result boundary, mutation receipt renderers, unit coverage, and JSON/SSE route proof. The structured meal-target clarification facts can diverge from the rendered numbered options, which makes the new `ToolExecutionResult.clarification` contract unsafe for clients or future routing logic that relies on `optionNumber`.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01 [BLOCKER]: Structured clarification option numbers can point at different meals than the rendered prompt

**File:** `server/orchestrator/tools.ts:2064`

**Issue:** `renderFindMealsControlledReply()` renders meal-target options from `result.candidates` in service order, but `buildMealTargetClarificationFact()` copies those same candidates and re-sorts them by `loggedAt` ascending before assigning `optionNumber`. The meal-correction service commonly narrows candidates newest-first before building pending rendered options, so the user-visible prompt can say `1. newer meal` while `clarification.candidates[0]` says option `1` is the older meal. Any consumer that uses the structured facts to present options or resolve a follow-up can select or display the wrong meal.

**Fix:**
```ts
function buildMealTargetClarificationFact(
  result: Exclude<FindMealsResult, { status: "resolved" }>,
  prompt: string,
): ToolClarificationFact {
  return {
    kind: "meal_target",
    status: result.status,
    action: result.action,
    prompt,
    candidates: result.status === "needs_clarification"
      ? result.candidates.slice(0, 5).map(projectMealTargetCandidateFact)
      : [],
  };
}
```

Add a regression test that asserts each rendered `1.`, `2.`, etc. line has the same `dateKey`, `displayTime`, and `displayLabel` as the corresponding `clarification.candidates[n]`.

---

_Reviewed: 2026-05-29T16:57:41Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
