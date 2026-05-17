---
phase: 62-meal-revision-tokens-and-stale-receipt-protection
verified: 2026-05-17T16:21:07Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/7
  gaps_closed:
    - "Stale single-item direct PATCH to a now-grouped current meal returns MEAL_REVISION_STALE before grouped-shape rejection and before write, summary, or publish side effects."
    - "Successful same-day edit/delete responses refresh or invalidate visible rows even when summaryOutcome is unavailable and dailySummary is omitted."
    - "Deleted-target races return stable stale revision failures instead of MEAL_NOT_FOUND."
    - "Post-commit refresh failures preserve committed mutation bookkeeping instead of surfacing as mutation failures."
  gaps_remaining: []
  regressions: []
---

# Phase 62: Meal Revision Tokens and Stale Receipt Protection Verification Report

**Phase Goal:** Users cannot overwrite newer meal facts from older chat receipts because every edit-capable receipt carries revision identity and stale writes fail closed.
**Verified:** 2026-05-17T16:21:07Z
**Status:** passed
**Re-verification:** Yes - after 62-05 gap closure through HEAD `6bbc8aa`

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User-facing meal and chat receipt DTOs expose current meal revision identity wherever the receipt can start an edit. | VERIFIED | Direct `/api/meals` rows project `mealRevisionId` in `server/routes/meals.ts:146-164`; history/day/chat surfaces project or preserve it in `server/services/meal-history.ts`, `server/services/history-query.ts`, `server/services/chat.ts`, `server/routes/day-snapshot.ts:44`, and `server/routes/chat.ts:415-469`; client normalizers preserve it in `client/src/api.ts:829-845` and edit payload builders require it in `client/src/meal-edit-payload.ts:60-115`. |
| 2 | User edits from a current receipt can update/delete with the expected revision contract. | VERIFIED | Client writes serialize `expectedMealRevisionId` in `client/src/api.ts:868-894`; `MealEditScreen` passes `payload.mealRevisionId` on save/delete at `client/src/components/MealEditScreen.tsx:185-236`; transaction update/delete compare expected revision before writes in `server/services/meal-transactions.ts:426-495`. |
| 3 | User edits from an older receipt are rejected without mutating the meal or creating a newer revision. | VERIFIED | `MealRevisionPreconditionError` is thrown on missing/stale expected revisions in `server/services/meal-transactions.ts:220-244`; direct route conflict branches return before summary/publish in `server/routes/meals.ts:222-246` and `:290-314`; tests prove no side effects in `tests/integration/meals-api.test.ts:336-491`. |
| 4 | Direct PATCH stale-single-to-current-grouped returns `MEAL_REVISION_STALE` before grouped-shape rejection and before write/summary/publish side effects. | VERIFIED | `server/routes/meals.ts:189-199` calls `getMealMutationGuard` with `expectedMealRevisionId` before grouped item-count rejection, asset validation, update, summary recompute, or publish; the guard asserts revision freshness in `server/services/meal-transactions.ts:294-331`; regression tests at `tests/integration/meals-api.test.ts:493-569` and `:571-657` pass. |
| 5 | Same-day successful edit/delete refreshes or invalidates rows even when `summaryOutcome` is unavailable and `dailySummary` is omitted. | VERIFIED | `client/src/meal-edit-refresh.ts:18-37` always redacts receipt identity, records the affected date, and fetches `getMeals({ refreshReason: "meal_mutation" })` when `affectedDate` is today, independent of `dailySummary`; `MealEditScreen` save/delete call it at `client/src/components/MealEditScreen.tsx:190-206` and `:237-253`; behavior tests pass in `tests/unit/meal-edit-refresh.test.ts:51-116`. |
| 6 | Deleted-target races in direct routes and chat update/delete paths return stale revision failure instead of `MEAL_NOT_FOUND`. | VERIFIED | Transaction lookup intentionally does not filter deleted rows in `server/services/meal-transactions.ts:147-168`; deleted rows then fail through `assertMutableExpectedRevision` with `MEAL_REVISION_STALE` at `:171-185`. Direct route coverage for PATCH and DELETE deleted-target races is in `tests/integration/meals-api.test.ts:659-746`; chat update/delete paths share `updateTransaction`/`softDeleteTransaction` through `server/services/meal-correction.ts:661-721` and tool mappings in `server/orchestrator/tools.ts:1271-1358`; targeted tool/service tests pass. |
| 7 | Post-commit refresh failures do not report committed writes as mutation failures. | VERIFIED | `MealEditScreen` catches refresh-helper failures inside the success path and still records the mutation before navigating back at `client/src/components/MealEditScreen.tsx:190-206` and `:237-253`; `SummaryDetailScreen` uses the same pattern at `client/src/components/SummaryDetailScreen.tsx:516-537`; source-contract tests assert this wiring in `tests/unit/meal-edit-screen.test.ts:81-115`. |
| 8 | Receipts without `mealRevisionId` are display-only, and stale conflict UI shows deterministic Traditional Chinese guidance while blocking stale editor reuse. | VERIFIED | `client/src/meal-edit-payload.ts:84-97` returns `null` for incomplete receipt identity; `MealEditScreen` sets exact stale copy and `staleBlocked` in `client/src/components/MealEditScreen.tsx:143-155`; tests assert copy, stale blocking, and display-only receipts in `tests/unit/meal-edit-screen.test.ts:61-79` and `tests/unit/chat-bubble-contract.test.ts`. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `server/services/meal-transactions.ts` | Authoritative revision preconditions for update/delete and read-only guard | VERIFIED | `assertExpectedMealRevision`, `getMealMutationGuard`, `updateTransaction`, and `softDeleteTransaction` all reuse the same `MealRevisionPreconditionError` contract before writes. |
| `server/services/food-logging.ts` | Route/service wrapper for expected revision guard and update/delete pass-through | VERIFIED | `assertExpectedMealRevision`, `getMealMutationGuard`, `updateMeal`, and `deleteMeal` pass expected revision identity through without adding create/log enforcement. |
| `server/routes/meals.ts` | Direct DTO revision projection and stable `409` conflict bodies before side effects | VERIFIED | Route sends `MealRevisionPreconditionError.code` via `sendMealRevisionConflict`; `gsd-sdk verify.artifacts` flagged a literal `MEAL_REVISION_STALE` pattern absence, but behavior and key-link checks prove the typed error is wired and returned. |
| `server/services/meal-correction.ts` | Chat correction update/delete expected revision pass-through | VERIFIED | Resolver-owned `mealRevisionId` reaches `getCurrentItemsForMutation`, `updateTransaction`, and `softDeleteTransaction`; stale transaction errors stop before summary recompute. |
| `server/orchestrator/tools.ts` | Tool-session resolved target identity for update/delete | VERIFIED | `resolvedMealTargets` stores `{ mealId, mealRevisionId }`; `update_meal`/`delete_meal` reject unresolved/id-only state and pass the resolved revision. |
| `client/src/api.ts` | Client normalization, write serialization, and typed conflict errors | VERIFIED | Preserves `mealRevisionId`, serializes `expectedMealRevisionId`, and throws `MealRevisionConflictError` for stable 409 revision conflicts. |
| `client/src/meal-edit-payload.ts` | Edit payload requires read-side revision identity | VERIFIED | History payloads throw on missing revision; receipt payloads return `null` unless `mealId`, `dateKey`, and `mealRevisionId` are present. |
| `client/src/meal-edit-refresh.ts` | Behavior-testable same-day post-commit row refresh | VERIFIED | Pure helper records/redacts first, sets `dailySummary` only for usable same-day summaries, and refreshes rows by affected date. |
| `client/src/components/MealEditScreen.tsx` | Save/delete expected revision wiring and stale recovery | VERIFIED | Save/delete success paths use the shared helper; stale conflict path blocks reuse and refreshes/invalidate affected rows. |
| `client/src/components/SummaryDetailScreen.tsx` | Direct delete expected revision and post-commit refresh wiring | VERIFIED | Delete receives the full meal row, requires `mealRevisionId`, and uses `refreshAfterMealMutation` for success and conflict recovery. |
| Phase 62 tests | Focused regression proof for stale route ordering, stale races, and client refresh | VERIFIED | Targeted integration/unit commands passed during this verification. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `server/routes/meals.ts` | `server/services/food-logging.ts` | `getMealMutationGuard(deviceId, id, expectedMealRevisionId)` before grouped guard | WIRED | `gsd-sdk verify.key-links` verified this link; route lines 189-199 show the ordering. |
| `server/services/food-logging.ts` | `server/services/meal-transactions.ts` | Shared `MealRevisionPreconditionError` and guard wrappers | WIRED | `foodLoggingService.getMealMutationGuard` delegates to transaction service; transaction service compares against `currentRevisionId`. |
| `server/orchestrator/tools.ts` | `server/services/meal-correction.ts` | Resolver-owned `resolvedTarget.mealRevisionId` | WIRED | Update/delete tools pass backend-resolved expected revisions at `server/orchestrator/tools.ts:1271-1301` and `:1348-1358`. |
| `client/src/components/MealEditScreen.tsx` | `client/src/meal-edit-refresh.ts` | Save/delete success calls | WIRED | Both success paths call `refreshAfterMealMutation` and catch refresh failure without failing the committed mutation path. |
| `client/src/meal-edit-payload.ts` | `client/src/api.ts` | Read `mealRevisionId` converted to write `expectedMealRevisionId` | WIRED | Payload builders require/copy revision identity; API helpers send expected revisions in PATCH/DELETE bodies. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `server/routes/meals.ts` | `meal.mealRevisionId` | `foodLoggingService.getMealsByDate` from `meal_transactions.currentRevisionId` | Yes | VERIFIED |
| `server/routes/meals.ts` | `mutationGuard.currentMealRevisionId` / `itemCount` | SQL join/count in `mealTransactionsService.getMealMutationGuard` | Yes | VERIFIED |
| `server/services/chat.ts` | restored `loggedMeal.mealRevisionId` | `chat_meal_receipts.mealRevisionId` joined to current transaction state | Yes | VERIFIED |
| `server/orchestrator/tools.ts` | `resolvedMealTargets[].mealRevisionId` | `find_meals` result from meal correction resolver | Yes | VERIFIED |
| `client/src/components/MealEditScreen.tsx` | `payload.mealRevisionId` | Payload builders from meal rows/receipts | Yes | VERIFIED |
| `client/src/meal-edit-refresh.ts` | same-day refreshed rows | `getMeals({ refreshReason: "meal_mutation" })` after committed mutation response | Yes | VERIFIED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Direct stale route ordering and deleted-target direct route races | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` | 23/23 tests passed, including stale single-to-grouped, guard-after-race, deleted-target PATCH/DELETE, and no side-effect assertions. | PASS |
| Same-day refresh without `dailySummary` and Meal Edit wiring | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-refresh.test.ts tests/unit/meal-edit-screen.test.ts` | 13/13 tests passed. | PASS |
| Chat/tool expected revision and stale/deleted target handling | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/meal-correction.test.ts` | 53/53 tests passed, including stale update/delete targets and deleted update target stable stale code. | PASS |
| Previously orchestrated broader gates | User/orchestrator reported `yarn tsc --noEmit`, targeted unit/service/tool tests, `yarn test:unit`, `yarn test:integration`, and `yarn test` passed before this verifier. | Not counted as primary evidence; targeted verifier commands above were rerun. | INFO |

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| Probe discovery | `find scripts -path '*/tests/probe-*.sh' -type f` and phase plan/summary grep | No phase-declared or conventional probes found. | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| FRESH-01 | Plans 01, 02, 04, 05 | User-facing meal and chat receipt DTOs carry current meal revision identity for edit-capable receipts. | SATISFIED | Direct/history/day/chat DTOs and client payload builders preserve `mealRevisionId`; missing revision receipts are display-only. |
| FRESH-02 | Plans 01, 03, 05 | User cannot overwrite newer meal facts from an older chat receipt; stale expected revisions are rejected without mutation. | SATISFIED | Direct route and chat/tool update/delete paths pass expected revisions into transaction guards; stale and deleted-target races return stale failures before writes and side effects. |
| FRESH-03 | Plans 04, 05 | User sees deterministic stale-record guidance and the client refreshes or invalidates affected meal rows after stale conflicts. | SATISFIED | Exact Traditional Chinese stale copy and stale blocking are wired; same-day success and stale recovery paths refresh rows by affected date and record mutation invalidation. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---:|---|---|---|
| `client/src/components/MealEditScreen.tsx` | 97 | `placeholder` CSS class/content | INFO | User-facing empty-image state, not an implementation stub. |
| Multiple source/test files | various | empty arrays/null/undefined control-flow defaults | INFO | Normal validation defaults, test collectors, and optional fields; no UI-facing stub data flow found. |
| Phase 62 modified files | n/a | `TBD`, `FIXME`, `XXX` | INFO | None found. |

### Human Verification Required

None. The phase goal is a data-integrity and stale-write contract; targeted code and tests prove the observable behaviors without needing visual or external-service validation.

### Gaps Summary

No blocking gaps remain. The prior `62-VERIFICATION.md` blockers are closed in current code:

1. Stale direct PATCH requests are checked against current revision before grouped-shape rejection and before side effects.
2. Same-day committed edit/delete responses refresh rows even without `dailySummary`.
3. Deleted-target direct and chat/tool races fail stale instead of falling through as missing meals.
4. Post-commit refresh failure is contained inside the success path and still records mutation invalidation.

---

_Verified: 2026-05-17T16:21:07Z_
_Verifier: the agent (gsd-verifier)_
