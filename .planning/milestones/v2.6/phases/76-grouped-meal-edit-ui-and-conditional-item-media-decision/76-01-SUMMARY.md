---
phase: 76-grouped-meal-edit-ui-and-conditional-item-media-decision
plan: 01
subsystem: testing
tags: [meal-edit, grouped-meals, source-contracts, transport, media-deferral]
requires:
  - phase: 75-grouped-meal-direct-crud-contract
    provides: Strict grouped items[] direct PATCH contract and revision conflict behavior
provides:
  - Red Meal Edit source contracts for grouped editor rows, controls, validation, stale recovery, dirty discard, and media deferral
  - Grouped updateMeal transport contracts for items-only PATCH bodies and stale conflict parsing
  - MealItemDetail media-free DTO source assertion
affects: [phase-76-plan-02, phase-76-plan-03, grouped-meal-edit-ui]
tech-stack:
  added: []
  patterns: [Node built-in test source-contract assertions, source-read DTO boundary tests]
key-files:
  created:
    - .planning/phases/76-grouped-meal-edit-ui-and-conditional-item-media-decision/76-01-SUMMARY.md
  modified:
    - tests/unit/meal-edit-screen.test.ts
    - tests/unit/api-client.test.ts
    - tests/unit/meal-edit-payload.test.ts
key-decisions:
  - "Plan 01 stayed red/source-contract only; no production files were changed."
  - "Grouped update transport proof requires an expected-revision items-only PATCH body with no scalar or media over-posting."
  - "MEDIA-DECISION-01 is represented as whole-meal image copy plus media-free MealItemDetail source proof before implementation."
patterns-established:
  - "Grouped UI behavior is pinned through source-read contracts before production MealEditScreen changes."
  - "Client grouped write transport is pinned separately from future type union implementation."
requirements-completed: [GROUP-UI-01, GROUP-UI-02, GROUP-UI-03, MEDIA-DECISION-01]
duration: 3m25s
completed: 2026-06-03
---

# Phase 76 Plan 01: Red Grouped Editor, Transport, and Media-Defer Source Contracts Summary

**Red grouped Meal Edit contracts now pin the future editable item UI, items-only transport, stale recovery, and whole-meal media boundary before production implementation.**

## Performance

- **Duration:** 3m25s
- **Started:** 2026-06-03T14:00:51Z
- **Completed:** 2026-06-03T14:04:16Z
- **Tasks:** 2
- **Files modified:** 3 test files plus this summary

## Accomplishments

- Replaced the old grouped-lock source contract with red grouped editor contracts for `GroupedMealEditor`, row expansion, add/delete controls, invalid-save copy, stale recovery, dirty discard, and whole-meal media copy.
- Added grouped `updateMeal()` transport proof that the client sends exactly `{ expectedMealRevisionId, items }` for grouped writes and preserves `MealRevisionConflictError` parsing for stale grouped saves.
- Added `MealItemDetail` media-free source proof so grouped item rows cannot imply item-level photos, crops, thumbnails, or evidence fields.

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace grouped-lock source contracts with grouped editor contracts** - `e6126a4` (test)
2. **Task 2: Add grouped transport and media-free DTO contracts** - `4455476` (test)

**Plan metadata:** pending final docs commit.

## Files Created/Modified

- `tests/unit/meal-edit-screen.test.ts` - Replaced grouped-lock assertions with red grouped editor, validation, stale recovery, dirty discard, and media deferral source contracts.
- `tests/unit/api-client.test.ts` - Added grouped items-only PATCH proof, grouped stale conflict proof, and future scalar/grouped update input source assertion.
- `tests/unit/meal-edit-payload.test.ts` - Added source proof that `MealItemDetail` remains media-free.
- `.planning/phases/76-grouped-meal-edit-ui-and-conditional-item-media-decision/76-01-SUMMARY.md` - Records execution outcome and verification state.

## Decisions Made

- Plan 01 remained test-only. Production files are intentionally unchanged so Plans 02 and 03 consume red contracts as implementation guidance.
- Grouped transport source proof is split from runtime pass-through proof: the JSON helper already sends grouped input when cast, but `client/src/types.ts` still lacks the future `ScalarUpdateMealInput | GroupedUpdateMealInput` contract.
- Phase 76 requirements are listed in summary frontmatter for traceability, but user-facing requirement checkboxes should remain open until Plans 02 and 03 implement the grouped UI and read-path behavior.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The targeted unit failures are expected red contracts for future plans.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts` - expected red: 10 pass, 3 fail. Failures are limited to newly added grouped editor, invalid-save/dirty-discard source contracts that Plan 02 implements.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts` - expected red: 90 pass, 1 fail. Failure is limited to the future `ScalarUpdateMealInput` / `GroupedUpdateMealInput` source assertion.
- `yarn tsc --noEmit` - passed.

## Known Stubs

None.

## Threat Flags

None - this plan changed test contracts only and introduced no new runtime endpoint, auth path, file access pattern, schema change, or trust-boundary implementation.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can now implement the grouped draft helper, type union, Meal Edit grouped editor UI, validation, save behavior, and source note against the red contracts committed here.

---
*Phase: 76-grouped-meal-edit-ui-and-conditional-item-media-decision*
*Completed: 2026-06-03*

## Self-Check: PASSED

- Summary file exists: FOUND.
- Task commit `e6126a4` exists: FOUND.
- Task commit `4455476` exists: FOUND.
- No tracked file deletions were introduced by task commits.
