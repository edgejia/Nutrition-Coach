---
phase: 62-meal-revision-tokens-and-stale-receipt-protection
verified: 2026-05-17T13:05:24Z
status: gaps_found
score: 5/7 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Stale expected revisions return MEAL_REVISION_STALE before other mutation-shape guards and before any write, summary, or publish side effect."
    status: failed
    reason: "PATCH /api/meals/:id checks grouped item count before invoking the expected-revision guarded update path, so a stale single-item editor can receive MEAL_REQUIRES_GROUPED_UPDATE after another flow turns the meal into a grouped meal."
    artifacts:
      - path: "server/routes/meals.ts"
        issue: "Lines 189-197 return MEAL_REQUIRES_GROUPED_UPDATE before foodLoggingService.updateMeal can throw MealRevisionPreconditionError."
      - path: "tests/integration/meals-api.test.ts"
        issue: "Tests cover stale single-item updates and current grouped updates separately, but not the stale-single-to-current-grouped transition."
    missing:
      - "Enforce the expected revision against current transaction state before grouped-shape rejection."
      - "Add integration coverage where an editor opens a single-item revision, another flow commits a grouped revision, and the stale direct PATCH returns MEAL_REVISION_STALE with currentMealRevisionId."
  - truth: "Successful today update/delete commits refresh or invalidate affected meal rows even when summary recovery is unavailable and dailySummary is omitted."
    status: failed
    reason: "MealEditScreen.refreshAfterMealMutation returns before getMeals when dailySummary is missing or not today, so a committed same-day mutation with summaryOutcome unavailable can close the editor while the visible meal list stays stale."
    artifacts:
      - path: "client/src/components/MealEditScreen.tsx"
        issue: "Lines 130-139 return on missing/non-today dailySummary before fetching today's meals by affectedDate."
      - path: "tests/unit/meal-edit-screen.test.ts"
        issue: "The source-contract test asserts the early return pattern instead of proving getMeals runs for successful today mutations without dailySummary."
    missing:
      - "Record/redact mutation side effects, set dailySummary only when usable, and fetch today's meals whenever affectedDate equals today."
      - "Add behavior-level client coverage for a successful today edit/delete response with summaryOutcome unavailable and no dailySummary."
---

# Phase 62: Meal Revision Tokens and Stale Receipt Protection Verification Report

**Phase Goal:** Users cannot overwrite newer meal facts from older chat receipts because every edit-capable receipt carries revision identity and stale writes fail closed.
**Verified:** 2026-05-17T13:05:24Z
**Status:** gaps_found
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User-facing meal and chat receipt DTOs expose current meal revision identity wherever the receipt can start an edit. | VERIFIED | `server/routes/meals.ts:146-164`, `server/routes/day-snapshot.ts:44`, `server/services/history-query.ts:409`, `server/routes/chat.ts:421-491`, `client/src/api.ts:829-845`, and `client/src/meal-edit-payload.ts:60-115` project or preserve public `mealRevisionId`; receipts missing it return `null` edit payloads. |
| 2 | User edits from a current receipt can update/delete with the expected revision contract. | VERIFIED | Client writes serialize `expectedMealRevisionId` in `client/src/api.ts:868-894`; `MealEditScreen.tsx:196-201` and `:230-233` derive it from `payload.mealRevisionId`; transaction guards compare it in `server/services/meal-transactions.ts:191-215` before update/delete writes. |
| 3 | Missing expected revisions fail closed with stable 409 errors and no mutation, summary, or publish side effects. | VERIFIED | `assertExpectedMealRevision` throws `MEAL_REVISION_REQUIRED` before writes at `server/services/meal-transactions.ts:198-205`; `server/routes/meals.ts:225-226` and `:293-294` return conflict bodies before summary recompute; integration assertions at `tests/integration/meals-api.test.ts:361-383` and `:442-456` prove no summary/publish side effects. |
| 4 | Stale expected revisions fail closed with `MEAL_REVISION_STALE` before other mutation-shape guards and before new revisions. | FAILED | Non-grouped stale update/delete is covered, but `server/routes/meals.ts:189-197` returns `MEAL_REQUIRES_GROUPED_UPDATE` before the guarded update call. This masks stale conflicts when the current meal became grouped after a stale editor opened. |
| 5 | Chat/tool update and delete mutations use backend-resolved expected revision identity, and stale tool races fail without success receipts or publish side effects. | VERIFIED | `server/orchestrator/tools.ts:1271-1305` and `:1348-1358` pass `resolvedTarget.mealRevisionId`; `server/services/meal-correction.ts:708-745` and `:760-773` pass it into transaction update/delete; tests assert stale tool failures at `tests/unit/tools.test.ts:1458-1465` and integration race coverage at `tests/integration/chat-meal-correction.integration.test.ts:791-933`. |
| 6 | Receipts without `mealRevisionId` are display-only, and stale conflict UI shows deterministic Traditional Chinese guidance while blocking stale editor reuse. | VERIFIED | `client/src/meal-edit-payload.ts:84-97` fails closed for incomplete receipt identity; `client/src/components/MealEditScreen.tsx:154-166` sets stale copy and `staleBlocked`; tests assert copy and blocked controls in `tests/unit/meal-edit-screen.test.ts:60-78` and display-only receipts in `tests/unit/chat-bubble-contract.test.ts:175-319`. |
| 7 | Successful same-day mutations refresh or invalidate affected rows even when committed outcome has no `dailySummary`. | FAILED | `client/src/components/MealEditScreen.tsx:130-139` returns before `getMeals` when `dailySummary` is absent, while API tests show successful updates can return `summaryOutcome: unavailable` with no `dailySummary` at `tests/unit/api-client.test.ts:822-839`. |

**Score:** 5/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `server/services/meal-transactions.ts` | Authoritative expected revision comparison before update/delete writes | VERIFIED | `MealRevisionPreconditionError` and `assertExpectedMealRevision` exist; checks run before `normalizeItems`, revision id generation, transaction writes, and delete snapshot loading. |
| `server/routes/meals.ts` | Direct DTO revision projection and 409 conflict bodies | PARTIAL | `mealRevisionId` is projected and conflicts are caught, but stale conflict ordering is wrong for current grouped rows. |
| `server/services/food-logging.ts` | Pass-through for expected revisions on update/delete only | VERIFIED | `deleteMeal` and update inputs carry expected revisions; creation/logging paths remain outside expected revision enforcement. |
| `server/services/meal-history.ts`, `server/services/history-query.ts`, `server/services/chat.ts`, `server/routes/day-snapshot.ts`, `server/routes/chat.ts` | Public read/receipt revision identity | VERIFIED | DTO and receipt surfaces expose `mealRevisionId` while stale/deleted restored receipts omit edit identity. |
| `server/services/meal-correction.ts`, `server/orchestrator/tools.ts`, `server/orchestrator/index.ts` | Resolver-owned revision targets for chat tools | VERIFIED | Tool session uses resolved target objects and passes the resolved revision to update/delete services. |
| `client/src/types.ts`, `client/src/api.ts`, `client/src/meal-edit-payload.ts`, `client/src/store.ts`, `client/src/components/MealEditScreen.tsx`, `client/src/components/MessageBubble.tsx` | Client revision payloads, typed conflicts, stale UI recovery | PARTIAL | Revision payload and stale UI pieces exist; success-without-summary row refresh remains broken in `MealEditScreen`. |
| Phase 62 tests | Focused unit/integration proof | PARTIAL | Existing tests cover most paths, but omit the stale-single-to-current-grouped direct PATCH edge and assert the client early-return bug in a source-contract test. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `server/routes/meals.ts` | `server/services/meal-transactions.ts` | `foodLoggingService` update/delete pass-through | PARTIAL | DELETE reaches the guard directly; PATCH has a pre-guard grouped item-count branch that can return before revision comparison. |
| `server/services/meal-transactions.ts` | `meal_transactions.currentRevisionId` | Compare expected revision before `meal_revisions` insert | VERIFIED | `assertExpectedMealRevision` compares expected against `existing.currentRevisionId` before update/delete writes. |
| `server/routes/meals.ts` | summary recompute/publish | Post-commit only | VERIFIED | `MealRevisionPreconditionError` catch branches return before `buildSummaryOutcomeAfterMealCommit`; grouped guard also returns before side effects but with the wrong stale error. |
| `server/orchestrator/tools.ts` | `server/services/meal-correction.ts` | Resolved target identity | VERIFIED | Tool update/delete pass `resolvedTarget.mealRevisionId` as the expected revision. |
| `client/src/meal-edit-payload.ts` | `client/src/api.ts` | `MealEditPayload.mealRevisionId` mapped to `expectedMealRevisionId` | VERIFIED | Save/delete paths send expected revision from payload identity. |
| `client/src/components/MealEditScreen.tsx` | `client/src/store.ts` | stale conflict redaction/invalidation | VERIFIED | Stale conflict path calls `redactChatReceiptIdentity`, `recordMealMutation`, and same-day `getMeals`. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `server/routes/meals.ts` | `meal.mealRevisionId` | `foodLoggingService.getMealsByDate` from `meal_transactions.currentRevisionId` | Yes | VERIFIED |
| `server/services/chat.ts` | restored `loggedMeal.mealRevisionId` | `chat_meal_receipts.mealRevisionId` joined to current transaction state | Yes | VERIFIED |
| `server/orchestrator/tools.ts` | `resolvedMealTargets[].mealRevisionId` | `find_meals` result from meal correction resolver | Yes | VERIFIED |
| `client/src/components/MealEditScreen.tsx` | `payload.mealRevisionId` | `secondaryScreen.payload` created by payload builders from meal rows/receipts | Yes | VERIFIED |
| `client/src/components/MealEditScreen.tsx` | post-commit row refresh | `dailySummary` branch instead of `affectedDate` branch | No | FAILED - missing `dailySummary` disconnects successful mutation row refresh. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| PATCH conflict ordering should reach revision conflict before grouped guard | `rg -n "getMealItemCount|itemCount > 1|foodLoggingService.updateMeal|MealRevisionPreconditionError|sendMealRevisionConflict" server/routes/meals.ts` | Lines show `getMealItemCount` and `itemCount > 1` at 189-193 before `foodLoggingService.updateMeal` at 207 and the revision conflict catch at 225. | FAIL |
| Successful current-day mutation with no dailySummary should still fetch current meals | `rg -n "if \\(!dailySummary|const \\{ meals \\} = await getMeals|setMeals\\(meals\\)" client/src/components/MealEditScreen.tsx` | Line 133 returns when `!dailySummary`; `getMeals` appears only after that guard in `refreshAfterMealMutation`. | FAIL |
| Existing Meal Edit source-contract test quality | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts` | Passed 9/9, but the test at lines 80-85 asserts the early-return pattern instead of behavior-level refresh. | WARNING |

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| Step 7c probe discovery | `find scripts -path '*/tests/probe-*.sh' -type f` and phase probe grep | No phase-declared or conventional probes found. | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| FRESH-01 | Plans 01, 02, 04 | User-facing meal and chat receipt DTOs carry current meal revision identity for edit-capable receipts. | SATISFIED | Server and client DTO paths preserve `mealRevisionId`; missing-revision receipts are display-only. |
| FRESH-02 | Plans 01, 03 | User cannot overwrite newer meal facts from an older chat receipt; stale expected revisions are rejected without mutation. | BLOCKED | Core transaction guard prevents writes, but one stale direct route edge returns grouped-update instead of stale revision, so stale receipt handling can be bypassed for single-to-grouped races. |
| FRESH-03 | Plan 04 | User sees deterministic stale-record guidance and the client refreshes or invalidates affected meal rows after a stale receipt conflict. | BLOCKED | Stale conflict UI exists, but CR-01 can prevent the stale code from reaching it; CR-02 leaves a committed same-day mutation row stale when no `dailySummary` is returned. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| `client/src/components/MealEditScreen.tsx` | 96 | `placeholder` CSS class/content | INFO | User-visible empty-image state, not an implementation stub. |
| `server/orchestrator/index.ts` | 54 | `IMAGE_PLACEHOLDER` constant | INFO | Existing image-message sentinel, not a TODO/stub. |
| Multiple source/test files | various | empty arrays/null returns | INFO | Normal validation defaults, test collectors, and control-flow sentinels; no unreferenced `TBD`, `FIXME`, or `XXX` markers found. |

### Human Verification Required

None for the current verdict. The blocking gaps are directly observable in code and tests.

### Deferred Items

No blocking gap is deferred. Phase 63 covers SSE meal-row freshness metadata, not PATCH stale-versus-grouped ordering or direct mutation refresh after committed responses without `dailySummary`.

### Gaps Summary

The phase is close but not achieved. The transaction-service revision guard exists and most DTO/client plumbing is wired, but two blocker review findings remain true in the codebase:

1. `PATCH /api/meals/:id` can mask a stale revision as `MEAL_REQUIRES_GROUPED_UPDATE` before the expected revision is checked.
2. `MealEditScreen` can close after a successful same-day mutation without refreshing visible meals when summary recovery is unavailable and no `dailySummary` is returned.

These gaps prevent the phase from satisfying the full stale receipt protection and affected-row freshness contract.

---

_Verified: 2026-05-17T13:05:24Z_
_Verifier: the agent (gsd-verifier)_
