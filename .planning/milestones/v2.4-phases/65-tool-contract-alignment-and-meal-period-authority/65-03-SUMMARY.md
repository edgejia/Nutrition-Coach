---
phase: 65-tool-contract-alignment-and-meal-period-authority
plan: 03
subsystem: orchestrator
tags: [log-food, tool-contract, protein-sources, meal-period, node-test]

requires:
  - phase: 65-01
    provides: Nullable mealPeriod persistence and service propagation
  - phase: 65-02
    provides: Verified additive nullable meal_period migration
provides:
  - Optional log_food protein_sources JSON schema aligned with Zod runtime
  - Conditional protein_sources prompt contract for credible anchors only
  - Source-text explicit mealPeriod persistence and loggedMeal receipt projection
affects: [phase-65, log-food, meal-period, chat-receipts]

tech-stack:
  added: []
  patterns:
    - LLM tool args remain parse-time evidence while backend-normalized facts own receipts
    - Source-text explicit meal-period authority is passed beside loggedAt without changing midpoint behavior

key-files:
  created:
    - .planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-03-SUMMARY.md
  modified:
    - server/orchestrator/tools.ts
    - server/orchestrator/system-prompt.ts
    - tests/unit/tool-contract.test.ts
    - tests/unit/system-prompt.test.ts
    - tests/unit/tools.test.ts
    - tests/integration/orchestrator.test.ts

key-decisions:
  - "protein_sources is optional parse-time evidence in both JSON schema and Zod runtime."
  - "log_food persists mealPeriod only from explicit source text, while raw meal_period remains historical loggedAt evidence."
  - "loggedMeal receipts project non-null backend mealPeriod authority without inventing values for time-of-day words."

patterns-established:
  - "Receipt identity projection can include optional authority fields only when the persisted backend result is non-null."
  - "Tool contract tests should cover LLM-facing JSON schema separately from Zod execution."

requirements-completed: [TOOL-01, TOOL-02, TOOL-03, INTENT-01]

duration: 8min
completed: 2026-05-27
---

# Phase 65 Plan 03: Tool Contract Alignment and Meal-Period Authority Summary

**log_food now treats protein_sources as optional evidence and persists explicit source-text mealPeriod authority without trusting raw model meal_period.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-27T13:04:22Z
- **Completed:** 2026-05-27T13:12:17Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Removed `protein_sources` from the LLM-facing `log_food` JSON schema required list while keeping the top-level property documented.
- Updated prompt guidance so `protein_sources` is supplied only when credible protein-source anchors exist and may be omitted otherwise.
- Preserved trusted-protein normalization behavior for counted anchors, trace exclusions, weak sources, and unsupported positive protein.
- Derived persisted `mealPeriod` from `extractExplicitMealPeriodFromSourceText(context.currentUserMessage)` and passed it into food logging only when explicit authority exists.
- Projected non-null backend `mealPeriod` through `loggedMeal` receipts while keeping raw `args.meal_period` limited to historical `loggedAt` midpoint placement.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Optional protein_sources contract tests** - `d8eba9c` (test)
2. **Task 1 GREEN: Align optional protein_sources schema and prompt** - `bf5a61a` (feat)
3. **Task 2 RED: Source-text mealPeriod authority tests** - `7d4fa98` (test)
4. **Task 2 GREEN: Persist source-text mealPeriod authority** - `1e4c20b` (feat)

## Files Created/Modified

- `server/orchestrator/tools.ts` - Removes `protein_sources` JSON-schema requiredness, derives source-text `mealPeriod`, passes it to `logGroupedMeal`, and projects non-null mealPeriod receipts.
- `server/orchestrator/system-prompt.ts` - Rewords `protein_sources` guidance as conditional credible-anchor evidence.
- `tests/unit/tool-contract.test.ts` - Adds JSON-schema proof that `protein_sources` is optional.
- `tests/unit/system-prompt.test.ts` - Adds prompt proof and updates prompt snapshots for conditional evidence wording.
- `tests/unit/tools.test.ts` - Adds source-text mealPeriod persistence, raw meal_period conflict, time-of-day non-authority, and midpoint regression proof.
- `tests/integration/orchestrator.test.ts` - Adds end-to-end orchestrator receipt projection proof for source-text lunch over raw breakfast.

## Decisions Made

- Kept `protein_sources` as a documented top-level property, but not a required one, because the Zod executor already accepts omission and backend normalization owns trusted protein.
- Left `args.meal_period` in historical `loggedAt` construction only; it is not assigned to persisted `mealPeriod`.
- Omitted `mealPeriod` from receipt projection when the persisted service result is `null`, so `中午` and other time-of-day words do not create explicit authority.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Omitted undefined mealPeriod from service input**
- **Found during:** Task 2 GREEN verification
- **Issue:** The first implementation passed `mealPeriod: undefined` to `logGroupedMeal`, changing an existing unit test's exact service input shape even when no explicit authority existed.
- **Fix:** Changed the call to spread `mealPeriod` only when source-text extraction returns a real authority value.
- **Files modified:** `server/orchestrator/tools.ts`
- **Verification:** `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/integration/orchestrator.test.ts && yarn tsc --noEmit`
- **Committed in:** `1e4c20b`

---

**Total deviations:** 1 auto-fixed (Rule 1: 1)
**Impact on plan:** The fix preserved the existing service-call contract while keeping the new explicit-authority behavior. No scope expansion.

## Issues Encountered

- The task-level source assertion for raw `args.meal_period` needed interpretation: the raw value still legitimately feeds historical `loggedAt` midpoint construction, but persisted `mealPeriod` is sourced only from `extractExplicitMealPeriodFromSourceText`.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tool-contract.test.ts tests/unit/system-prompt.test.ts tests/unit/protein-trust.test.ts tests/unit/tools.test.ts` - RED failed on the new Task 1 schema/prompt assertions, then PASS after implementation.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/integration/orchestrator.test.ts` - RED failed on missing `loggedMeal.mealPeriod`, then PASS after implementation.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tool-contract.test.ts tests/unit/system-prompt.test.ts tests/unit/protein-trust.test.ts tests/unit/tools.test.ts tests/integration/orchestrator.test.ts` - PASS, 98 tests.
- `yarn test:unit` - PASS, 823 tests.
- `yarn tsc --noEmit` - PASS.

## Threat Flags

None - the changed model-args trust boundary and receipt projection surface were already covered by T-65-07, T-65-08, T-65-09, and T-65-10.

## Next Phase Readiness

Phase 65 Plan 04 can project persisted explicit mealPeriod into current-day, day snapshot, and historical meal row DTOs. Plan 05 can build on loggedMeal receipt projection already carrying non-null backend authority.

## Self-Check: PASSED

- Summary file created at `.planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-03-SUMMARY.md`.
- Key modified files exist: `server/orchestrator/tools.ts`, `server/orchestrator/system-prompt.ts`, `tests/unit/tools.test.ts`, `tests/integration/orchestrator.test.ts`.
- Task commits present: `d8eba9c`, `bf5a61a`, `7d4fa98`, `1e4c20b`.
- No tracked file deletions were introduced by task commits.

---
*Phase: 65-tool-contract-alignment-and-meal-period-authority*
*Completed: 2026-05-27*
