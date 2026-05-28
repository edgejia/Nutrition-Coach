---
phase: 67-correction-targeting-and-backend-clarification-rendering
verified: "2026-05-28T20:56:44Z"
status: gaps_found
score: "10/12 must-haves verified"
overrides_applied: 0
gaps:
  - truth: "Explicit date scope filters candidates before ranking."
    status: failed
    reason: "loadActiveCandidates loads only the newest 20 active meals before resolveByEvidenceTier applies targetDateKey, so an explicit historical-date correction can miss an existing older meal."
    artifacts:
      - path: "server/services/meal-correction.ts"
        issue: "Lines 568-584 cap newest meals before lines 454-456 filter by explicit target date."
      - path: "tests/unit/meal-correction.test.ts"
        issue: "Existing explicit-date tests cover a newer matching candidate but not the >20 newer meals cap boundary."
    missing:
      - "Resolve date scope before candidate loading or pass targetDateKey into candidate loading and cap after date filtering."
      - "Add a regression test with one explicit historical-date meal plus more than 20 newer meals."
  - truth: "Food/item-label evidence outranks meal-period and recency evidence."
    status: failed
    reason: "Unmatched Latin food labels are not treated as food evidence, allowing period-only matching to resolve an unrelated meal."
    artifacts:
      - path: "server/services/meal-correction.ts"
        issue: "hasLikelyFoodReference only recognizes a fixed Chinese food-character set, then resolveByEvidenceTier falls through to meal-period matching."
      - path: "tests/unit/meal-correction.test.ts"
        issue: "Chinese unmatched-label coverage exists, but no Latin-label regression such as burger prevents period fallback."
    missing:
      - "Treat residual Latin/CJK target terms as food evidence after stripping dates, periods, verbs, nutrients, and numeric tokens."
      - "Block weak period/recent fallback when food evidence exists but no candidate label matches."
---

# Phase 67: Correction Targeting and Backend Clarification Rendering Verification Report

**Phase Goal:** Ambiguous correction requests surface the right candidate set and use stable backend-rendered clarification copy.  
**Verified:** 2026-05-28T20:56:44Z  
**Status:** gaps_found  
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | `那餐` / `那筆` style correction requests prefer current-turn and today-recency evidence before older historical candidates. | VERIFIED | `resolveByEvidenceTier()` uses scoped candidates and recent-reference resolution for ambiguous references; tests cover today lunch targeting over newer non-matching meals in `tests/unit/meal-correction.test.ts`. |
| 2 | Explicit date scope filters candidates before ranking. | FAILED | `findMeals()` calls `loadActiveCandidates(deviceId)` before date resolution; `loadActiveCandidates()` uses `headers.slice(-limit).reverse()` with limit 20, then `resolveByEvidenceTier()` filters by `targetDateKey`. Existing older explicit-date meals can be absent before date scoping runs. |
| 3 | Food/item-label evidence outranks meal-period and recency evidence. | FAILED | Chinese label cases pass, but `hasLikelyFoodReference()` only recognizes a fixed Chinese-food regex. A query such as `把今天午餐 burger 改成 500 卡` can fall through to period matching and resolve an unrelated lunch. |
| 4 | Explicit persisted mealPeriod outranks inferred loggedAt period, while inferred period remains a fallback. | VERIFIED | `resolveByEvidenceTier()` separates `mealPeriodSource === "explicit"` before inferred period candidates; unit tests assert explicit lunch wins over inferred lunch. |
| 5 | Auto-resolve occurs only when the strongest applicable evidence level has exactly one candidate, except allowed recent-reference tie-breaks. | VERIFIED | `chooseUniqueOrClarify()` clarifies multiple strongest-tier candidates unless `allowRecentTieBreak && hasRecentReference(query)`. |
| 6 | Clear single-date no-safe-target recovery is scoped to that date or says that date has no meals. | VERIFIED with gap boundary | Same-date recovery and no-meals copy exist, but the explicit-date cap bug in truth 2 can incorrectly produce no-meals copy for an older date with a meal beyond the newest-20 cap. |
| 7 | Multi-candidate correction clarification is backend-rendered with stable numbered options. | VERIFIED | `renderCorrectionTargetClarificationCopy()` and same-date renderer produce numbered options from backend candidates; `executeTool()` maps non-resolved `find_meals` to `controlledReply.source === "renderer"`. |
| 8 | Clarification labels come from backend meal/item facts or generic `餐點`, not raw correction text. | VERIFIED | Renderer formats `candidate.foodName` and does not accept raw user correction text; orchestrator test asserts raw text such as `中午雞腿便當` is not echoed. |
| 9 | Non-resolved `find_meals` results terminate as renderer-owned controlled replies before any mutator can run. | VERIFIED | `server/orchestrator/tools.ts` returns guarded controlled replies for non-resolved `find_meals`; `server/orchestrator/index.ts` returns immediately on `controlledReply` with no second final answer. |
| 10 | Stale or deleted selected options fail closed with no mutation, no `summaryOutcome`, and no `daily_summary` publish. | VERIFIED | Pending selection revalidation compares current `mealRevisionId`; integration tests assert no mutation/publish for stale paths. |
| 11 | Mixed option-plus-numeric follow-up separates target resolution from numeric mutation authority. | VERIFIED | Route tests assert `2，蛋白質改合理一點` does not mutate while explicit numeric authority can proceed through the mutator path. |
| 12 | Phase 67 local validation gates are recorded green. | VERIFIED | `67-VALIDATION.md` marks Wave 0 and per-task verification green; orchestrator observed `yarn test` passed with 1230 tests and 0 failures. |

**Score:** 10/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `server/services/meal-correction.ts` | Evidence-tier resolver, pending rendered-option state, stale selection recovery | PRESENT WITH BLOCKING LOGIC GAPS | Substantive and wired, but date cap-before-scope and Latin-label fallback violate TARGET-01. |
| `server/orchestrator/mutation-receipts.ts` | Backend clarification, same-date recovery, and no-meals renderer helpers | VERIFIED | Numbered option and concise label renderers exist. |
| `server/orchestrator/tools.ts` | `find_meals` controlled reply mapping and stale selected-target handling | VERIFIED WITH WARNING | Non-resolved `find_meals` controlled replies are wired; warning: invalid-selection valid-number guidance from service prompt is dropped in same-date renderer path. |
| `server/orchestrator/index.ts` | Controlled reply terminal behavior | VERIFIED | `controlledReply` returns immediately without consuming another LLM final answer. |
| `server/orchestrator/system-prompt.ts` | Support-only model guidance | VERIFIED | Prompt tests cover backend target authority guidance. |
| `tests/unit/meal-correction.test.ts` | Resolver ranking and pending-option unit proof | PARTIAL | Broad tests exist, but missing the two critical regression cases: >20 newer meals with explicit historical date and unmatched Latin food label. |
| `tests/unit/tools.test.ts` | Tool-boundary controlled reply proof | VERIFIED | SDK artifact and key-link checks passed. |
| `tests/unit/orchestrator.test.ts` | Terminal renderer proof | VERIFIED WITH WARNING | Terminal renderer tests exist; advisory review notes unrelated false-pass risk in `assertSuccessfulLogReplyShape()` uncertainty branch. |
| `tests/unit/mutation-receipts.test.ts` | Renderer helper proof | VERIFIED | Renderer coverage exists and is substantive. |
| `tests/unit/system-prompt.test.ts` | Prompt guidance proof | VERIFIED | Prompt assertions exist. |
| `tests/integration/chat-meal-correction.integration.test.ts` | Fastify route proof for stable copy and no mutation/publish | VERIFIED WITH WARNING | Route tests cover stable numbered copy and no mutation/publish; invalid selection does not assert valid-number copy reaches the chat user. |
| `.planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-VALIDATION.md` | Validation status | VERIFIED | Present and marked complete. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `tests/unit/meal-correction.test.ts` | `server/services/meal-correction.ts` | `createMealCorrectionService(db).findMeals(...)` | VERIFIED | SDK key-link check found `findMeals`. |
| `tests/unit/tools.test.ts` | `server/orchestrator/tools.ts` | `executeTool(find_meals)` | VERIFIED | SDK key-link check found `controlledReply`. |
| `tests/integration/chat-meal-correction.integration.test.ts` | `server/routes/chat.ts` | `buildApp(...)` and `app.inject` | VERIFIED | SDK key-link check found `publishDailySummary` route proof. |
| `server/services/meal-correction.ts` | `server/services/turn-state.ts` | pending selection state | VERIFIED | `PENDING_SELECTION_KIND` and rendered options are stored and read. |
| `server/services/meal-correction.ts` | `server/db/schema.ts` | Drizzle candidate query scoped by deviceId | VERIFIED | Manual check confirms `eq(mealTransactions.deviceId, deviceId)` in candidate query; SDK failed only because the plan regex was invalidly escaped. |
| `server/orchestrator/tools.ts` | `server/services/meal-correction.ts` | `FindMealsResult` status/candidates | VERIFIED | SDK key-link check passed. |
| `server/orchestrator/tools.ts` | `server/orchestrator/mutation-receipts.ts` | renderer helpers | VERIFIED | SDK key-link check passed. |
| `server/orchestrator/tools.ts` | `server/orchestrator/index.ts` | `ToolExecutionResult.controlledReply` | VERIFIED | SDK key-link check passed; terminal short-circuit exists. |
| `server/orchestrator/system-prompt.ts` | `server/orchestrator/tools.ts` | prompt instructs `find_meals` before mutation | VERIFIED | SDK key-link check passed. |
| `67-VALIDATION.md` | Phase 67 test files | per-task verification map | VERIFIED | SDK key-link check passed. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `server/services/meal-correction.ts` | `candidates` | SQLite `mealTransactions` + `mealRevisionItems` query | PARTIAL | Real DB data flows, but explicit-date filtering happens after newest-20 cap, so older explicit-date data can be dropped. |
| `server/services/meal-correction.ts` | `labelMatches` / `hasLikelyFoodReference()` | normalized query and candidate labels | PARTIAL | Real candidate labels flow, but unmatched Latin target residue is not recognized as food evidence. |
| `server/orchestrator/tools.ts` | `controlledReply.text` | `FindMealsResult` and mutation receipt renderers | VERIFIED | Non-resolved `find_meals` result is rendered and returned as controlled terminal copy. |
| `server/orchestrator/index.ts` | `controlledReply` | `executeTool()` result | VERIFIED | Controlled reply exits the orchestrator loop before any second LLM final answer. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full test suite | `yarn test` | Observed by orchestrator: 1230 tests, 0 failures | PASS |
| Schema drift | schema drift check | Observed by orchestrator: `drift_detected: false` | PASS |
| Codebase drift | codebase drift check | Observed by orchestrator: non-blocking `warn` for existing unmapped structural paths | WARN |
| Explicit historical date with >20 newer meals | Not run as a command; verified from code path and advisory reproduction | Candidate cap occurs before date scoping | FAIL |
| Unmatched Latin food label with meal period | Not run as a command; verified from code path and advisory reproduction | Latin residue can fall through to period-only target | FAIL |

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| None | N/A | No Phase 67 probes declared and no conventional `scripts/**/tests/probe-*.sh` files found. | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| TARGET-01 | 67-01, 67-02, 67-04, 67-05, 67-06 | Correction target resolution ranks current-turn, today, recency, explicit food label, and persisted meal-period evidence so ambiguous `那餐` requests surface the most relevant candidates without silently choosing unrelated historical meals. | BLOCKED | Two critical review findings are confirmed by code: explicit historical-date candidates can be dropped before date scoping, and unmatched Latin food labels can resolve unrelated period-only meals. |
| TARGET-02 | 67-01, 67-02, 67-03, 67-04, 67-05, 67-06 | Multi-candidate correction clarification is backend-rendered with stable numbered options and concise target labels that do not echo the whole user correction request as a meal name. | SATISFIED WITH WARNINGS | Backend renderers and controlled terminal replies are wired. Warning: invalid-selection valid-number guidance is lost in one renderer path before reaching chat users. |

No orphaned Phase 67 requirements were found: REQUIREMENTS.md maps TARGET-01 and TARGET-02 to Phase 67, and both appear in plan frontmatter.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| `server/services/meal-correction.ts` | 584 | `headers.slice(-limit).reverse()` before date scope | BLOCKER | Explicit historical-date requests can miss older existing meals. |
| `server/services/meal-correction.ts` | 344-354 | food-reference detection limited to Chinese food-character regex | BLOCKER | Unmatched Latin food labels can fall through to weak meal-period targeting. |
| `server/orchestrator/tools.ts` | 1962-1971 | renderer ignores invalid-selection `result.prompt` for same-date candidates | WARNING | Chat user gets numbered options again but not the valid-number guidance produced by the service. |
| `tests/unit/orchestrator.test.ts` | 59-64 | identical true/false assertions for `expectsUncertainty` | WARNING | Some tests can false-pass if uncertainty copy disappears. |

### Human Verification Required

None. Phase 67 behaviors are backend/service/orchestrator flows with automated proof surfaces; the blocking gaps are programmatically identifiable.

### Gaps Summary

Phase 67 does not achieve TARGET-01. The implementation has substantive resolver and renderer code, but two target-resolution edge cases remain unsafe:

1. Explicit historical-date correction requests can fail once the target meal is outside the newest 20 active meals, because candidate loading caps before explicit date scoping.
2. Unmatched Latin food labels can be ignored as food evidence, allowing weak meal-period matching to silently choose an unrelated meal.

TARGET-02 is largely achieved for backend-rendered numbered clarification and concise labels, with advisory warnings that should be fixed before closeout but are not the primary blocker for the phase goal.

---

_Verified: 2026-05-28T20:56:44Z_  
_Verifier: the agent (gsd-verifier)_
