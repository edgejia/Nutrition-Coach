---
phase: 75-grouped-meal-direct-crud-contract
plan: 01
subsystem: api-testing
tags: [fastify, sqlite, meals-api, grouped-meals, red-contracts]

requires:
  - phase: 74-02
    provides: grouped direct PATCH lock and revision/side-effect baseline
  - phase: 75-CONTEXT
    provides: grouped direct CRUD route-shape decisions D-01 through D-32
provides:
  - Red-first Fastify/SQLite grouped PATCH success contracts
  - Invalid grouped write body contracts with simple 400 responses
  - Side-effect suppression proof for malformed grouped writes
affects: [phase-75, grouped-meal-edit, meals-api, meal-revisions]

tech-stack:
  added: []
  patterns:
    - app.inject route contract tests over real in-memory SQLite
    - red-first grouped items[] full-list replacement coverage
    - summary/publish side-effect spies for mutation boundaries

key-files:
  created:
    - .planning/phases/75-grouped-meal-direct-crud-contract/75-01-SUMMARY.md
  modified:
    - tests/integration/meals-api.test.ts

key-decisions:
  - "Plan 01 stayed red-first and changed only integration tests; production grouped CRUD remains for Plan 02."
  - "GROUP-EDIT requirements were not marked complete because this plan pins the contract but does not implement the server behavior."

patterns-established:
  - "Grouped direct writes are tested as full-list items[] replacement with public { name, position, calories, protein, carbs, fat } rows."
  - "Malformed grouped writes assert the existing simple { error: \"Invalid meal update\" } route style and no summary or realtime side effects."

requirements-completed: []

duration: 5m 50s
completed: 2026-06-03T09:50:32Z
---

# Phase 75 Plan 01: Red Grouped PATCH Contract Summary

**Fastify/SQLite red contracts now pin grouped meal full-list replacement and strict malformed grouped write behavior before route implementation.**

## Performance

- **Duration:** 5m 50s
- **Started:** 2026-06-03T09:44:42Z
- **Completed:** 2026-06-03T09:50:32Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added grouped `PATCH /api/meals/:id` success contracts for one-to-many add, many-to-one delete-by-omission, and many-to-many update/reorder.
- Asserted successful grouped replacement keeps the existing direct PATCH shape: `affectedDate`, `summaryOutcome`, optional `dailySummary`, aggregate `meal`, changed revision, and `meal_mutation` publish envelope.
- Added strict invalid grouped write coverage for empty lists, mixed scalar/items bodies, aliases, nested nutrition, extra keys, blank names, bad nutrition, missing nutrition, and wrong positions.
- Proved malformed grouped writes expect simple 400 bodies and no summary recompute, realtime publish, or revision advancement.

## Task Commits

1. **Task 1: Add red grouped replacement success contracts** - `cf567f0` (test)
2. **Task 2: Add red invalid grouped body contracts** - `47ff66c` (test)

**Plan metadata:** closeout commit attempted through the GSD helper. `.planning/` is gitignored in this repo, so ignored planning files are not force-staged.

## Files Created/Modified

- `tests/integration/meals-api.test.ts` - Adds red grouped PATCH success and invalid-body contract coverage.
- `.planning/phases/75-grouped-meal-direct-crud-contract/75-01-SUMMARY.md` - Execution summary and verification record.

## Decisions Made

- Kept Plan 01 red-first: no production route, service, schema, client, package, or chat persistence files were modified.
- Left `GROUP-EDIT-01` through `GROUP-EDIT-04` active in requirements because this plan provides contract coverage only; implementation and final proof are owned by later Phase 75 plans.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added explicit test-local types for invalid grouped cases**
- **Found during:** Task 2
- **Issue:** `yarn tsc --noEmit` could not infer the table-driven invalid-body loop cleanly and reported TS7022 on local test variables.
- **Fix:** Added explicit `InvalidGroupedBodyCase`, meal, and inject-response annotations inside the new test.
- **Files modified:** `tests/integration/meals-api.test.ts`
- **Verification:** `yarn tsc --noEmit` passed after the fix.
- **Committed in:** `47ff66c`

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking).
**Impact on plan:** Test-only typing fix; no scope expansion and no production code touched.

## Verification

- Expected red: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts`
  - Task 1 result: failed only the three newly added grouped replacement success assertions, all current `400 !== 200`.
  - Task 2 result: failed only the new grouped contract assertions: the same three success cases plus the mixed scalar/items invalid-body case, current `409 !== 400`.
- PASS: `yarn tsc --noEmit`

## Issues Encountered

- Current route rejects valid grouped `items[]` payloads as invalid scalar PATCH bodies. This is the intended Plan 02 handoff.
- Current route treats a complete scalar body plus `items[]` against a grouped meal as the existing grouped-lock 409. Plan 02 must reject mixed shapes before mutation guard side effects with `{ error: "Invalid meal update" }`.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Stub scan found only test-local accumulator arrays such as `publishedPayloads: unknown[] = []`; no placeholder UI/data stubs were introduced.

## Threat Flags

None. This plan added test coverage only and introduced no new network endpoint, auth path, file access pattern, schema change, package, or production trust-boundary surface.

## Next Phase Readiness

Plan 02 can now implement the strict grouped route parser and direct PATCH branch against explicit red contracts for full-list replacement, response shape, validation failure style, and side-effect suppression.

## Self-Check: PASSED

- FOUND: `tests/integration/meals-api.test.ts`
- FOUND: `.planning/phases/75-grouped-meal-direct-crud-contract/75-01-SUMMARY.md`
- FOUND commits: `cf567f0`, `47ff66c`
- No tracked file deletions in task commits.
- No production files were modified by Plan 01 task commits.

---
*Phase: 75-grouped-meal-direct-crud-contract*
*Completed: 2026-06-03T09:50:32Z*
