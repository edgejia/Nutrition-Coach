---
phase: 67-correction-targeting-and-backend-clarification-rendering
plan: 03
subsystem: orchestrator
tags: [meal-correction, renderer-owned-copy, find-meals, node-test, tool-boundary]

requires:
  - phase: 67-02
    provides: evidence-tier resolver results and exact rendered-option candidate state
provides:
  - Backend-owned correction target clarification renderers with stable numbered options
  - Date-scoped correction target recovery and no-meals-for-date copy
  - Terminal renderer-owned controlled replies for non-resolved `find_meals` outcomes
affects: [phase-67, TARGET-02, correction-targeting, backend-clarification-rendering]

tech-stack:
  added: []
  patterns: [typed renderer helpers over MealCorrectionCandidate, controlled ToolExecutionResult guard replies]

key-files:
  created:
    - .planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-03-SUMMARY.md
  modified:
    - server/orchestrator/mutation-receipts.ts
    - server/orchestrator/tools.ts
    - tests/unit/mutation-receipts.test.ts

key-decisions:
  - "Correction target clarification copy is rendered from typed `MealCorrectionCandidate` facts, not model/user correction text."
  - "Non-resolved `find_meals` results now return `controlledReply.reason = meal_target_clarification` with `success: false`, `executed: false`, and no resolved target seeding."
  - "Plan 67-03 leaves generic structured tool-result transport for Phase 68 and keeps the change scoped to `find_meals` adaptation."

patterns-established:
  - "Use mutation-receipts renderer helpers for correction target options, same-date recovery, and no-meals copy."
  - "Map guarded `find_meals` ambiguity at the tool boundary before the orchestrator loop can ask the model to rewrite it."

requirements-completed: [TARGET-02]

duration: 4min
completed: 2026-05-29
---

# Phase 67 Plan 03: Backend Correction Clarification Rendering Summary

**`find_meals` ambiguity now terminates with backend-rendered numbered correction target copy instead of model-authored clarification text.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-28T20:11:32Z
- **Completed:** 2026-05-28T20:15:36Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added correction target renderer helpers that format up to five numbered options with date, local time, backend meal label, and explicit-only meal-period labels.
- Added same-date recovery and explicit no-meals-for-date renderer copy, with tests proving off-date candidates, calories/macros, internal terms, raw correction text, and success-style wording stay out.
- Updated `executeTool()` so every non-resolved `find_meals` result becomes a guarded renderer-owned controlled reply while resolved results still seed exactly one `{ mealId, mealRevisionId }` target.

## Task Commits

1. **Task 1 RED: Add failing correction target renderer tests** - `9ae4dfb` (test)
2. **Task 1 GREEN: Add backend correction target clarification renderers** - `a329224` (feat)
3. **Task 2 GREEN: Map unresolved find_meals results to controlled replies** - `7999cd9` (feat)

_Note: Task 2 used the pre-existing red tests from Phase 67 Plan 01; no additional RED commit was needed in this plan._

## Files Created/Modified

- `server/orchestrator/mutation-receipts.ts` - Added typed correction target clarification, same-date recovery, and no-meals copy helpers.
- `server/orchestrator/tools.ts` - Added `meal_target_clarification` controlled reply mapping for non-resolved `find_meals` results.
- `tests/unit/mutation-receipts.test.ts` - Added renderer tests for stable options, explicit-only period labels, scoped recovery, no raw echo, and no internal/success wording.

## Decisions Made

- Used the existing `MealCorrectionCandidate` service type as the renderer input contract so copy is based on backend facts.
- Kept no-meals date extraction inside the `find_meals` adapter as a temporary Plan 67 bridge; Phase 68 still owns broader structured result plumbing.
- Treated same-date candidate lists as recovery copy at the tool boundary, which preserves scoped numbered options without introducing a new generic transport.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Task 1 renderer tests were initially green before this plan because no renderer tests existed yet; added the required RED test commit before implementing helpers.
- Task 2 red coverage already existed from Wave 0 and failed on missing controlled reply fields, so the task proceeded directly to the GREEN implementation.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/mutation-receipts.test.ts` - passed, 24/24.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts` - passed, 42/42.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/mutation-receipts.test.ts tests/unit/tools.test.ts` - passed, 66/66.
- `node scripts/run-node-with-tz.mjs --import tsx --test --test-name-pattern "correction target clarification renderers|Phase 67 D-30/D-32|date-specific no-meals" tests/unit/mutation-receipts.test.ts tests/unit/tools.test.ts` - passed, 6/6.
- `yarn test:unit` - passed, 892/892.
- `yarn tsc --noEmit` - passed.

## Acceptance Criteria

- Renderer helpers are exported from `mutation-receipts.ts` and use typed `MealCorrectionCandidate` inputs.
- Option output includes stable `1.` / `2.` numbering, date, local time, backend label, and explicit-only meal-period labels.
- D-30 same-date recovery includes only same-date numbered options and `請直接回覆編號`; no-meals copy names the date and has no off-date numbered candidates.
- Non-resolved `find_meals` results return `controlledReply.source === "renderer"`, `success: false`, `executed: false`, `failureReason: "guard"`, and clear `resolvedMealTargets`.
- Resolved `find_meals` behavior still seeds exactly one resolver-owned `{ mealId, mealRevisionId }` target.

## Known Stubs

None. Stub-pattern scan found no new hardcoded UI-flowing empty values, placeholders, TODO/FIXME markers, or mock data sources in modified files.

## Threat Flags

None. The plan modified existing renderer/tool boundaries only and introduced no new network endpoints, auth paths, file access patterns, or schema changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 67-04 can consume terminal renderer-owned `find_meals` clarification results at the orchestrator/route level without relying on model paraphrase or raw correction echo.

## Self-Check: PASSED

- Found `server/orchestrator/mutation-receipts.ts`, `server/orchestrator/tools.ts`, and `tests/unit/mutation-receipts.test.ts` on disk.
- Found task commits `9ae4dfb`, `a329224`, and `7999cd9` in git history.
- Verified no tracked files were deleted by task commits.

---
*Phase: 67-correction-targeting-and-backend-clarification-rendering*
*Completed: 2026-05-29*
