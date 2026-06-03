---
phase: 76-grouped-meal-edit-ui-and-conditional-item-media-decision
plan: 02
subsystem: ui
tags: [meal-edit, grouped-meals, react, sport-ui, validation, media-deferral]
requires:
  - phase: 75-grouped-meal-direct-crud-contract
    provides: Strict grouped items[] direct PATCH contract with revision conflict behavior
  - phase: 76-grouped-meal-edit-ui-and-conditional-item-media-decision
    provides: Plan 01 red/source contracts for grouped editor, transport, stale recovery, and media deferral
provides:
  - Pure grouped draft helper for parsing, totals, validation, dirty detection, and strict update items
  - Scalar/grouped update input union with media-free item DTO source note
  - Grouped Meal Edit item-row UI with add/delete/edit, validation, stale recovery, and refresh-after-save behavior
  - Capability matrix metadata updated from grouped-lock handoff to supported grouped item editing
affects: [phase-76-plan-03, grouped-meal-edit-ui, capability-matrix]
tech-stack:
  added: []
  patterns: [Pure client draft helper, grouped items-only PATCH body, source-contract capability matrix alignment]
key-files:
  created:
    - client/src/meal-edit-grouped-draft.ts
    - tests/unit/meal-edit-grouped-draft.test.ts
    - .planning/phases/76-grouped-meal-edit-ui-and-conditional-item-media-decision/76-02-SUMMARY.md
  modified:
    - client/src/types.ts
    - client/src/components/MealEditScreen.tsx
    - client/src/app.css
    - client/src/contracts/capability-matrix.ts
    - docs/capability-matrix.md
key-decisions:
  - "Grouped draft validation errors are machine-readable data; MealEditScreen owns Traditional Chinese field copy."
  - "Grouped saves submit only expectedMealRevisionId plus complete ordered items[], with no scalar or media write fields."
  - "Capability matrix now treats grouped Meal Edit item editing as supported, while missing item details remain a non-editable unsupported state."
patterns-established:
  - "Grouped Meal Edit builds the write list from visible draft order immediately before updateMeal()."
  - "Grouped row validation opens the first invalid row and blocks network mutation before PATCH."
requirements-completed: [GROUP-UI-01, GROUP-UI-02, GROUP-UI-03, MEDIA-DECISION-01]
duration: 11m33s
completed: 2026-06-03
---

# Phase 76 Plan 02: Grouped Meal Edit UI Summary

**Grouped Meal Edit now has editable item rows, media-free items-only save payloads, validation recovery, and refresh-through-authoritative-store behavior.**

## Performance

- **Duration:** 11m33s
- **Started:** 2026-06-03T14:07:53Z
- **Completed:** 2026-06-03T14:19:26Z
- **Tasks:** 3
- **Files modified:** 8 code/test/docs files plus this summary

## Accomplishments

- Added `client/src/meal-edit-grouped-draft.ts` with pure draft row creation, live totals, validation, dirty detection, and strict media-free grouped update item building.
- Expanded `UpdateMealInput` into scalar and grouped contracts while documenting that `MealItemDetail` remains media-free and whole-meal photos stay meal-level evidence.
- Replaced the old grouped lock in `MealEditScreen` with compact grouped row editing, add/delete controls, final-row delete blocking, dirty discard confirmation, invalid-save recovery, stale conflict recovery, and `refreshAfterMealMutation` success close.
- Updated grouped editor CSS and capability matrix metadata so full unit source scans recognize grouped item editing as a supported Meal Edit capability.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Add grouped draft helper contracts** - `be8a58d` (test)
2. **Task 1 GREEN: Implement grouped draft helper** - `ed4f4ad` (feat)
3. **Task 2: Expand update input typing and preserve media-free item DTO** - `43cd895` (feat)
4. **Task 3: Replace grouped lock with compact grouped editor UI** - `194ba94` (feat)

**Plan metadata:** pending final docs commit.

## Files Created/Modified

- `client/src/meal-edit-grouped-draft.ts` - Pure grouped draft helper for rows, totals, validation, dirty checks, and update item construction.
- `tests/unit/meal-edit-grouped-draft.test.ts` - Unit coverage for sorted draft rows, totals, validation, duplicate names, at-least-one-item, zero-based positions, and dirty detection.
- `client/src/types.ts` - Added scalar/grouped update input union and media-free item source note.
- `client/src/components/MealEditScreen.tsx` - Added grouped editor state, row components, validation/save/delete/back behavior, unsupported state, and grouped items-only save branch.
- `client/src/app.css` - Added compact grouped editor styling with 44px row/add/delete targets, expanded-row accent, field errors, and unsupported state.
- `client/src/contracts/capability-matrix.ts` - Updated capability metadata from grouped chat handoff to supported grouped item editing.
- `docs/capability-matrix.md` - Regenerated capability matrix docs.

## Decisions Made

- Grouped helper validation returns codes (`required`, `invalid`, `negative`) rather than user-facing copy so `MealEditScreen` remains the UI copy owner.
- Grouped save constructs `groupedItems` before `updateMeal()` and submits exactly `{ expectedMealRevisionId, items }`.
- Unsupported grouped payload copy avoids restoring the old primary “go to chat correction” handoff phrase while still telling the user to reload or return to Chat if details remain unavailable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated stale capability matrix grouped-lock metadata**
- **Found during:** Task 3
- **Issue:** `yarn test:unit` failed because `client/src/contracts/capability-matrix.ts` still expected `sp-meal-edit-grouped-primary`, `goToChatCorrection`, and the old grouped-lock chat handoff.
- **Fix:** Updated the matrix row and regenerated `docs/capability-matrix.md` so grouped item editing is the supported capability and its handlers are source-mapped.
- **Files modified:** `client/src/contracts/capability-matrix.ts`, `docs/capability-matrix.md`
- **Verification:** `yarn matrix:check`, `yarn test:unit`
- **Committed in:** `194ba94`

---

**Total deviations:** 1 auto-fixed blocking issue.
**Impact on plan:** The auto-fix kept source-scan metadata aligned with the new UI capability. No new product scope or runtime boundary was added.

## Issues Encountered

- Initial Task 3 targeted source contracts failed because the grouped write source proof matched through the later scalar `imageAssetId` update branch. Moving `buildGroupedMealUpdateItems()` into a local `groupedItems` constant immediately before grouped `updateMeal()` fixed the source proof without changing behavior.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-grouped-draft.test.ts` - passed, 8 tests.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts` - passed, 91 tests.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-grouped-draft.test.ts tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts` - passed, 112 tests.
- `yarn matrix:check` - passed.
- `yarn tsc --noEmit` - passed.
- `yarn test:unit` - passed, 1005 tests.

## Known Stubs

None. Stub-pattern scan hits were existing CSS placeholder selectors/capability taxonomy plus intentional empty-string/null validation state; none are unresolved UI data stubs.

## Threat Flags

None. The only trust-boundary implementation added is the planned grouped draft to existing `PATCH /api/meals/:id` path with strict `items[]` construction and existing revision/auth recovery.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03 can now wire grouped `items[]` details through the `/api/meals` read path so Home-origin grouped edits reliably open with authoritative item rows after refresh.

---
*Phase: 76-grouped-meal-edit-ui-and-conditional-item-media-decision*
*Completed: 2026-06-03*

## Self-Check: PASSED

- Summary file exists: FOUND.
- Key files exist: FOUND `client/src/meal-edit-grouped-draft.ts`, `tests/unit/meal-edit-grouped-draft.test.ts`, `client/src/types.ts`, `client/src/components/MealEditScreen.tsx`, `client/src/app.css`, `client/src/contracts/capability-matrix.ts`, `docs/capability-matrix.md`.
- Task commit `be8a58d` exists: FOUND.
- Task commit `ed4f4ad` exists: FOUND.
- Task commit `43cd895` exists: FOUND.
- Task commit `194ba94` exists: FOUND.
- No tracked file deletions were introduced by task commits.
