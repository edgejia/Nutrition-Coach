---
phase: 66-numeric-correction-provenance-guard
plan: 03
subsystem: backend
tags: [orchestrator, meal-correction, numeric-authority, node-test, tdd]

requires:
  - phase: 66-01
    provides: Numeric correction authority helper and renderer copy
  - phase: 66-02
    provides: Meal numeric proposal persistence service
provides:
  - Tool-boundary numeric authority checks before update_meal writes
  - Backend-computed meal numeric correction proposal tool
  - Current persisted meal facts and preview methods on meal correction service
affects: [phase-66, orchestrator-tools, meal-correction, mutation-receipts]

tech-stack:
  added: []
  patterns:
    - Authorize changed numeric meal fields at the tool boundary before persistence
    - Keep LLM proposal args to resolved identity, affected fields, and locked operator intent
    - Compute before/after proposal values from persisted meal revisions

key-files:
  created: []
  modified:
    - server/orchestrator/tools.ts
    - server/services/meal-correction.ts
    - tests/unit/tools.test.ts
    - tests/unit/meal-correction.test.ts
    - tests/unit/orchestrator-registry.test.ts
    - tests/unit/orchestrator.test.ts
    - tests/integration/chat-api.test.ts
    - tests/integration/chat-meal-correction.integration.test.ts
    - tests/integration/chat-streaming.test.ts

key-decisions:
  - "update_meal loads persisted meal facts and authorizes only changed numeric values before writes."
  - "propose_meal_numeric_correction accepts field/operator intent only; backend code computes proposal values from persisted facts."
  - "Success-path chat fixtures now include explicit current-turn numeric evidence because model-estimated meal numbers are blocked."

patterns-established:
  - "Meal numeric writes must pass authorizeMealNumericUpdate before mealCorrectionService.updateMeal."
  - "Numeric proposal copy is renderer-owned and backed by stored proposal state."

requirements-completed: [CORR-01, CORR-02, CORR-03]

duration: 13min
completed: 2026-05-28T08:06:08Z
---

# Phase 66 Plan 03: Numeric Correction Tool Authority Summary

**Tool-boundary meal numeric authority with persisted-fact proposal previews and renderer-owned blocked/proposal copy**

## Performance

- **Duration:** 13 min
- **Started:** 2026-05-28T07:53:13Z
- **Completed:** 2026-05-28T08:06:08Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Added failing TDD coverage proving direct numeric edits need current-turn evidence, vague/model-estimated edits are blocked, `items[]` cannot bypass provenance, and backend proposals are non-mutating.
- Added `loadCurrentMealFacts` and `previewMealNumericCorrection` to the meal correction service so tools can read persisted current revision facts and compute locked relative adjustments without trusting LLM numbers.
- Wired `update_meal` through `authorizeMealNumericUpdate` before `mealCorrectionService.updateMeal`, with renderer-owned controlled replies for blocked numeric writes.
- Added `propose_meal_numeric_correction` with a narrow schema and metadata-only summaries; proposal values are computed from persisted meal facts and stored through `mealNumericProposalService.putLatest`.

## Task Commits

1. **Task 1: Add tool-boundary authority proof** - `cfe42db` (test)
2. **Task 2: Enforce update_meal authority and add proposal tool** - `656a69a` (feat)

## Files Created/Modified

- `server/orchestrator/tools.ts` - Enforces numeric authority before `update_meal` writes, registers proposal tool, returns controlled renderer data, and redacts tool summaries.
- `server/services/meal-correction.ts` - Loads current persisted meal facts and computes locked numeric preview updates from those facts.
- `tests/unit/tools.test.ts` - Proves explicit direct edits, blocked vague edits, blocked `items[]` bypasses, and stored backend proposals.
- `tests/unit/meal-correction.test.ts` - Proves current-facts loading, stale/foreign preconditions, and preview computation.
- `tests/unit/orchestrator-registry.test.ts` - Locks the public tool registry with `propose_meal_numeric_correction`.
- `tests/unit/orchestrator.test.ts` - Keeps unavailable-summary update receipt coverage grounded in explicit current-turn numbers.
- `tests/integration/chat-api.test.ts` - Updates direct numeric update success fixture with explicit user evidence.
- `tests/integration/chat-meal-correction.integration.test.ts` - Updates meal correction success fixtures with explicit current-turn numeric evidence.
- `tests/integration/chat-streaming.test.ts` - Updates streaming update success fixture with explicit user evidence.

## Decisions Made

- `update_meal` filters unchanged numeric patch values before authorization so the model can echo current persisted values without turning them into new unauthorized writes.
- The proposal tool rejects raw target nutrition values by schema and only accepts affected fields plus locked operators: half, subtract percent, add amount, and subtract amount.
- Stale, missing, and foreign meal targets continue through the existing Phase 62 revision precondition path by reusing meal correction service current-item loading.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Filtered unchanged numeric patch fields**
- **Found during:** Task 2
- **Issue:** Success-path model payloads can include unchanged persisted macro values alongside the intended changed field, which caused the authority guard to reject unchanged echoes.
- **Fix:** Added unchanged-value filtering before `authorizeMealNumericUpdate` so only actual numeric changes require current-turn evidence.
- **Files modified:** `server/orchestrator/tools.ts`
- **Verification:** Targeted unit tests, full unit suite, integration suite, and TypeScript gate passed.
- **Committed in:** `656a69a`

**2. [Rule 1 - Bug] Grounded success-path chat fixtures in current user evidence**
- **Found during:** Task 2 verification
- **Issue:** Existing success fixtures expected direct numeric meal updates from model-supplied values without explicit current-turn numeric evidence.
- **Fix:** Updated success prompts in unit and integration tests to include the exact numbers being written.
- **Files modified:** `tests/unit/orchestrator.test.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts`, `tests/integration/chat-streaming.test.ts`
- **Verification:** `yarn test:unit`, `yarn test:integration`, and targeted unit tests passed.
- **Committed in:** `656a69a`

**3. [Rule 1 - Bug] Corrected registry expected order**
- **Found during:** Task 2
- **Issue:** Adding `propose_meal_numeric_correction` changed the expected public registry ordering in the unit assertion.
- **Fix:** Updated the registry test expectation to include the new tool in the actual registry order.
- **Files modified:** `tests/unit/orchestrator-registry.test.ts`
- **Verification:** Targeted registry/unit command passed.
- **Committed in:** `656a69a`

---

**Total deviations:** 3 auto-fixed (Rule 1)
**Impact on plan:** All fixes were required to preserve the new authority boundary without weakening the planned behavior.

## Issues Encountered

- The RED gate failed as expected before implementation because the service methods, proposal tool, and guard behavior did not exist.
- Full unit coverage exposed one additional direct-update fixture that needed explicit current-turn numeric evidence after the guard was enabled.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/meal-correction.test.ts tests/unit/orchestrator-registry.test.ts` - passed, 72 tests.
- `yarn tsc --noEmit` - passed.
- `yarn test:unit` - passed, 868 tests.
- `yarn test:integration` - passed, 313 tests.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-meal-correction.integration.test.ts tests/integration/chat-streaming.test.ts` - passed, 144 tests.

## Known Stubs

None.

## Threat Flags

None. New tool and write-boundary surfaces are covered by the plan threat model T-66-09 through T-66-13.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04 can build on a guarded direct-write path and stored backend proposal state. The remaining phase work should consume approved proposals without allowing model-authored numeric target values to bypass this boundary.

## Self-Check: PASSED

- `FOUND: .planning/phases/66-numeric-correction-provenance-guard/66-03-SUMMARY.md`
- `FOUND: cfe42db`
- `FOUND: 656a69a`

---
*Phase: 66-numeric-correction-provenance-guard*
*Completed: 2026-05-28T08:06:08Z*
