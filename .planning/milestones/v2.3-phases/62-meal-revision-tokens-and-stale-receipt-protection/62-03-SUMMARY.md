---
phase: 62-meal-revision-tokens-and-stale-receipt-protection
plan: 03
subsystem: orchestrator
tags: [meal-revisions, chat-tools, optimistic-concurrency, sqlite, node-test]

requires:
  - phase: 62-01
    provides: Direct transaction expected-revision checks and stable revision conflict errors
  - phase: 62-02
    provides: Public mealRevisionId projection on edit-capable read and receipt surfaces
provides:
  - Resolver-owned `{ mealId, mealRevisionId }` tool session targets for chat corrections
  - Required `expectedMealRevisionId` pass-through for chat/tool update and delete mutations
  - Stale chat/tool update and delete fail-closed proof without mutation receipts, summaryOutcome, or publish side effects
affects: [phase-62, phase-62-04, stale-receipt-protection, chat-correction-tools]

tech-stack:
  added: []
  patterns:
    - Tool-session resolved target object: `{ mealId, mealRevisionId }`
    - MealRevisionPreconditionError mapped to stable controlled tool failure codes

key-files:
  created:
    - .planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-03-SUMMARY.md
  modified:
    - server/services/meal-correction.ts
    - server/orchestrator/tools.ts
    - server/orchestrator/index.ts
    - tests/unit/meal-correction.test.ts
    - tests/unit/tools.test.ts
    - tests/integration/chat-meal-correction.integration.test.ts

key-decisions:
  - "Chat correction tools use `resolvedMealTargets` objects instead of id-only state plus a revision side map."
  - "Meal correction update/delete services no longer synthesize current expected revisions when callers omit `expectedMealRevisionId`."
  - "Tool stale conflicts surface stable `MEAL_REVISION_STALE` / `MEAL_REVISION_REQUIRED` codes as controlled failures without success-style mutation receipts."

patterns-established:
  - "After `find_meals`, only resolver-owned `{ mealId, mealRevisionId }` state authorizes `update_meal` or `delete_meal`."
  - "Stale tool mutation attempts stop before transaction revision creation, summary recompute, and realtime publish."

requirements-completed: [FRESH-02]

duration: 7 min
completed: 2026-05-17
---

# Phase 62 Plan 03: Chat Tool Expected Revision Threading Summary

**Chat meal correction tools now mutate only through backend-resolved meal revision targets and stale tool writes fail closed.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-17T12:29:27Z
- **Completed:** 2026-05-17T12:36:13Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added RED coverage proving `find_meals` must store both meal id and current revision id, id-only tool state is rejected, and stale update/delete races produce no mutation receipt, no `summaryOutcome`, and no publish side effect.
- Replaced `resolvedMealIds` / revision-map tool state with `resolvedMealTargets: [{ mealId, mealRevisionId }]`.
- Removed the meal-correction fallback that previously loaded the current revision when callers omitted `expectedMealRevisionId`.
- Mapped transaction revision precondition errors to stable controlled tool failures.

## Task Commits

1. **Task 1: Prove chat/tool resolved revision preconditions** - `7830466` (test)
2. **Task 2: Implement resolver-owned revision identity for chat tools** - `cfdd043` (feat)

## Files Created/Modified

- `server/services/meal-correction.ts` - Adds top-level resolved `mealRevisionId` and requires provided expected revisions for update/delete mutation calls.
- `server/orchestrator/tools.ts` - Stores resolved target objects, rejects id-only state, passes resolver-owned expected revisions, and maps stale revision errors to controlled failures.
- `server/orchestrator/index.ts` - Initializes the new tool session state shape.
- `tests/unit/meal-correction.test.ts` - Proves resolved revision identity and missing expected revision fail-closed service behavior.
- `tests/unit/tools.test.ts` - Proves resolved target storage, id-only rejection, successful expected revision pass-through, and stable stale code projection.
- `tests/integration/chat-meal-correction.integration.test.ts` - Proves stale update/delete races after target resolution do not mutate, recompute summary, publish, or emit success-style receipts.

## Decisions Made

- Used a single resolved target object array instead of preserving id-only compatibility.
- Kept the LLM-facing `update_meal` / `delete_meal` args unchanged; the model still supplies only meal id, while backend resolver state supplies revision authority.
- Kept stale tool failures metadata-only by surfacing stable codes through the controlled tool failure path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Controlled missing-target failures instead of throwing TypeError**
- **Found during:** Task 2 targeted verification
- **Issue:** A legacy/id-only tool session object without `resolvedMealTargets` threw a `TypeError` from the helper instead of returning the expected controlled tool failure.
- **Fix:** Treated absent `resolvedMealTargets` as unresolved target state.
- **Files modified:** `server/orchestrator/tools.ts`
- **Verification:** Targeted `node scripts/run-node-with-tz.mjs --import tsx --test ...` suite passed.
- **Committed in:** `cfdd043`

---

**Total deviations:** 1 auto-fixed (1 Rule 1)
**Impact on plan:** The fix preserves the planned fail-closed behavior and avoids leaking an implementation exception into the tool path.

## Issues Encountered

- `yarn test:unit` and `yarn test:integration` left generated diffs under `tests/harness/artifacts/image-log-failure/latest/*`. Those artifact files were already dirty at executor start and were intentionally excluded from this plan's commits.

## User Setup Required

None - no external service configuration required.

## Verification

- RED expected failure: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-meal-correction.integration.test.ts` failed before implementation on missing top-level resolved revision identity, missing `resolvedMealTargets`, id-only tool mutation acceptance, and service fallback to current revisions.
- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-meal-correction.integration.test.ts`
- PASS: `yarn tsc --noEmit`
- PASS: `yarn test:unit`
- PASS: `yarn test:integration`

## Known Stubs

None. Stub-pattern scan found only normal test-local arrays, existing empty string accumulation, optional contexts, and nullable checks; no UI-facing placeholders or unwired mock data were introduced.

## Threat Flags

None. The changed trust boundary is the planned LLM tool args -> orchestrator -> meal correction service -> transaction service path. No new endpoint, auth path, file access pattern, schema change, raw payload logging, or sensitive proof surface was added.

## Next Phase Readiness

Ready for `62-04` to wire client edit payloads and stale conflict recovery against the server-side expected revision authority now present in direct and chat/tool mutation paths.

## Self-Check: PASSED

- FOUND: `server/services/meal-correction.ts`
- FOUND: `server/orchestrator/tools.ts`
- FOUND: `server/orchestrator/index.ts`
- FOUND: `tests/unit/meal-correction.test.ts`
- FOUND: `tests/unit/tools.test.ts`
- FOUND: `tests/integration/chat-meal-correction.integration.test.ts`
- FOUND: `.planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-03-SUMMARY.md`
- FOUND commits: `7830466`, `cfdd043`
- No tracked file deletions in task commits.

---
*Phase: 62-meal-revision-tokens-and-stale-receipt-protection*
*Completed: 2026-05-17*
