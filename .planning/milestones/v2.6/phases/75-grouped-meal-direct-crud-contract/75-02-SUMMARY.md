---
phase: 75-grouped-meal-direct-crud-contract
plan: 02
subsystem: api
tags: [fastify, sqlite, meals-api, grouped-meals, direct-crud]

requires:
  - phase: 75-01
    provides: red-first grouped PATCH success and invalid-body contracts
provides:
  - Strict grouped PATCH parser for public flat items[] replacement bodies
  - Direct grouped meal full-list replacement through existing revisioned meal update service
  - Existing post-commit summaryOutcome and daily_summary publish behavior for grouped replacements
affects: [phase-75, grouped-meal-edit, meals-api, meal-revisions]

tech-stack:
  added: []
  patterns:
    - route-local parsed body union for scalar versus grouped meal update payloads
    - exact-key grouped item validation before service mutation
    - full-list grouped replacement through existing foodLoggingService.updateMeal()

key-files:
  created:
    - .planning/phases/75-grouped-meal-direct-crud-contract/75-02-SUMMARY.md
  modified:
    - server/routes/meals.ts

key-decisions:
  - "Grouped PATCH bodies are selected by an own items property and have no public discriminator."
  - "Grouped item request rows stay strict and flat: public name maps to persistence foodName, positions must match zero-based array order, and duplicate names are allowed."
  - "Grouped writes bypass the scalar grouped-lock and image validation path, then reuse the same post-commit summaryOutcome and daily_summary publish block as scalar writes."

patterns-established:
  - "Scalar direct meal edits keep their existing mutation guard, image ownership validation, and MEAL_REQUIRES_GROUPED_UPDATE behavior."
  - "Grouped direct meal edits let mealTransactionsService.updateTransaction() own expected revision enforcement and image preservation."

requirements-completed: [GROUP-EDIT-01, GROUP-EDIT-02, GROUP-EDIT-03, GROUP-EDIT-04]

duration: 5 min
completed: 2026-06-03T09:58:56Z
---

# Phase 75 Plan 02: Grouped PATCH Implementation Summary

**Direct meal PATCH now accepts strict grouped items[] full-list replacements through the existing revisioned meal mutation path.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-03T09:54:15Z
- **Completed:** 2026-06-03T09:58:56Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Replaced the scalar-only direct meal PATCH parser with `ScalarMealUpdateBody`, `GroupedMealUpdateBody`, and `ParsedMealUpdateBody`.
- Added `parseGroupedMealItems()` with exact per-item keys, nonempty arrays, trimmed nonblank names, zero-based position checks, and finite nonnegative nutrition validation.
- Wired valid grouped `items[]` payloads through `foodLoggingService.updateMeal()` as full-list replacement while preserving scalar guard behavior.
- Kept summary recompute, `summaryOutcome`, optional `dailySummary`, realtime `meal_mutation` publish, and aggregate response shaping on the existing shared post-commit path.

## Task Commits

1. **Task 1: Add strict grouped parser beside scalar parser** - `e08d51c` (feat)
2. **Task 2: Wire grouped updates through existing post-commit path** - `397b309` (feat)

**Plan metadata:** summary generated locally; metadata commit handled by the GSD helper according to repo ignore rules.

## Files Created/Modified

- `server/routes/meals.ts` - Adds the strict grouped parser and direct grouped update branch.
- `.planning/phases/75-grouped-meal-direct-crud-contract/75-02-SUMMARY.md` - Execution summary and verification record.

## Decisions Made

- Used an internal `kind: "scalar" | "items"` union only after route parsing; no public discriminator was added.
- Treated any own `items` property as the grouped shape selector, so mixed scalar and grouped payloads fail with the existing simple 400 body.
- Let the existing transaction service enforce missing or stale expected revisions for grouped writes, keeping 409 conflict bodies and no-side-effect conflict behavior unchanged.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Narrowed parsed update union before grouped wiring**
- **Found during:** Task 1
- **Issue:** After introducing `ParsedMealUpdateBody`, the existing scalar-only route body used scalar fields without narrowing and `yarn tsc --noEmit` failed.
- **Fix:** Added a temporary scalar-only branch in Task 1, then replaced it with the real grouped branch in Task 2.
- **Files modified:** `server/routes/meals.ts`
- **Verification:** `yarn tsc --noEmit` passed after Task 1 and after Task 2.
- **Committed in:** `e08d51c`, replaced by `397b309`

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking).
**Impact on plan:** No scope expansion. The temporary Task 1 narrowing was removed by the planned Task 2 wiring.

## Verification

- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts`
  - 29 tests passed, including Plan 01 grouped replacement and invalid-body contracts.
- PASS: `yarn tsc --noEmit`
- PASS: `yarn test:integration`
  - 353 integration tests passed.

## Issues Encountered

- The first Task 1 TypeScript run failed because the route had a parsed union before execution-path narrowing. This was fixed before the Task 1 commit and did not leave final behavior behind.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Stub scan found only parser-local accumulator/control values in `server/routes/meals.ts`, not UI/data placeholders or unwired mock data.

## Threat Flags

None. The new parser and mutation path match the plan threat model: exact grouped body validation, signed guest-session ownership, transaction-service revision checks, no grouped image input, and existing summary publish envelope reuse.

## Next Phase Readiness

Plan 03 can add focused transaction-level proof for ordered revision-item persistence and image identity preservation. The route-level grouped PATCH contract is implemented and integration-green.

## Self-Check: PASSED

- FOUND: `server/routes/meals.ts`
- FOUND: `.planning/phases/75-grouped-meal-direct-crud-contract/75-02-SUMMARY.md`
- FOUND commits: `e08d51c`, `397b309`
- No tracked file deletions in task commits.
- The only production source change across Plan 02 task commits is `server/routes/meals.ts`.

---
*Phase: 75-grouped-meal-direct-crud-contract*
*Completed: 2026-06-03T09:58:56Z*
