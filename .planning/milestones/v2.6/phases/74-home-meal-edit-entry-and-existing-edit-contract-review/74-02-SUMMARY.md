---
phase: 74-home-meal-edit-entry-and-existing-edit-contract-review
plan: 02
subsystem: client-api-testing
tags: [meal-edit, meal-revisions, grouped-lock, react, fastify, sqlite]

requires:
  - phase: 74-01
    provides: Home row Meal Edit entry with origin "home"
  - phase: 62-04
    provides: client expectedMealRevisionId writes and stale Meal Edit recovery
  - phase: 62-05
    provides: grouped direct PATCH lock and stale-before-grouped route precedence
provides:
  - Home-origin Meal Edit back label copy
  - source proof for expected meal revision writes, shared refresh, stale blocking, and grouped lock
  - Fastify/SQLite proof for revision conflict bodies and grouped direct-edit lock side effects
affects: [phase-74, phase-75, meal-edit, grouped-meal-edit]

tech-stack:
  added: []
  patterns:
    - source-contract tests for Meal Edit authority boundaries
    - route integration tests with summary and publish side-effect counters

key-files:
  created:
    - .planning/phases/74-home-meal-edit-entry-and-existing-edit-contract-review/74-02-SUMMARY.md
  modified:
    - client/src/components/MealEditScreen.tsx
    - tests/unit/meal-edit-screen.test.ts
    - tests/integration/meals-api.test.ts

key-decisions:
  - "Home-origin Meal Edit uses the explicit 返回首頁 back label while preserving Chat and History labels."
  - "Grouped direct PATCH remains locked behind MEAL_REQUIRES_GROUPED_UPDATE until Phase 75."
  - "Server route and service code were left unchanged because the existing revision and grouped-lock contract passed integration proof."

patterns-established:
  - "Meal Edit back-label source contracts cover each secondary-screen origin explicitly."
  - "Grouped direct-edit lock tests assert no summary recompute, no realtime publish, and no row mutation side effects."

requirements-completed: [EDIT-BASE-01]

duration: 3m 24s
completed: 2026-06-02T15:22:44Z
---

# Phase 74 Plan 02: Meal Edit Contract Revalidation Summary

**Home-origin Meal Edit now says `返回首頁`, while single-item revision writes and grouped direct-edit locks remain proven by source and Fastify/SQLite tests.**

## Performance

- **Duration:** 3m 24s
- **Started:** 2026-06-02T15:19:20Z
- **Completed:** 2026-06-02T15:22:44Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added the explicit Home-origin back label branch in `MealEditScreen`.
- Strengthened Meal Edit source contracts for Home/Chat/History labels while preserving expected revision writes, shared refresh, stale blocking, and grouped lock assertions.
- Tightened grouped direct PATCH integration proof to show fresh grouped edits return `MEAL_REQUIRES_GROUPED_UPDATE` without summary fields, summary recompute, realtime publish, or row mutation.

## Task Commits

1. **Task 1 RED: Home back label source contract** - `8d93d11` (test)
2. **Task 1 GREEN: Home-origin Meal Edit back label** - `c5cb51e` (feat)
3. **Task 2: Grouped direct edit lock revalidation** - `6233b7f` (test)

**Plan metadata:** skipped because `.planning/` is gitignored in this repo; the GSD commit helper refused to add ignored planning files and no force-staging was performed.

## Files Created/Modified

- `client/src/components/MealEditScreen.tsx` - Adds `origin === "home" ? "返回首頁"` to the existing back-label branch.
- `tests/unit/meal-edit-screen.test.ts` - Adds Home/Chat/History label source assertions and keeps existing revision, refresh, stale, and grouped-lock contracts.
- `tests/integration/meals-api.test.ts` - Extends grouped direct PATCH rejection proof with no-summary/no-publish counters and unchanged grouped row assertions.
- `.planning/phases/74-home-meal-edit-entry-and-existing-edit-contract-review/74-02-SUMMARY.md` - Execution summary and verification record.

## Decisions Made

- Followed D-05 by using the explicit `返回首頁` label for Home-origin Meal Edit.
- Kept server route/service code unchanged; integration proof confirmed the existing authoritative revision and grouped-lock behavior.
- Kept Phase 75 grouped CRUD behavior out of scope.

## Deviations from Plan

None - plan executed exactly as written.

## TDD Gate Compliance

- Task 1 RED failed as intended before implementation on the missing `origin === "home" ? "返回首頁"` branch.
- Task 2 was a revalidation/proof task. The strengthened integration assertions passed against existing server behavior, so no production GREEN commit was needed.

## Verification

- RED expected failure: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-refresh.test.ts` failed before implementation on the missing Home-origin back-label branch.
- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-refresh.test.ts`
- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts`
- PASS: `yarn tsc --noEmit`
- PASS: `yarn test:unit`

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Stub-pattern scan found only existing validation checks, test-local arrays, and the existing image placeholder UI copy; no incomplete plan stubs were introduced.

## Threat Flags

None. The plan changed one existing UI label branch and tests for existing route behavior only; no new network endpoint, auth path, file access pattern, schema change, or trust-boundary surface was introduced.

## Next Phase Readiness

EDIT-BASE-01 is revalidated for Phase 74. Phase 75 can plan grouped direct CRUD against an unchanged baseline where single-item writes require `expectedMealRevisionId`, stale conflicts fail before grouped-shape validation, and fresh grouped direct PATCH remains locked.

## Self-Check: PASSED

- FOUND: `client/src/components/MealEditScreen.tsx`
- FOUND: `tests/unit/meal-edit-screen.test.ts`
- FOUND: `tests/integration/meals-api.test.ts`
- FOUND: `.planning/phases/74-home-meal-edit-entry-and-existing-edit-contract-review/74-02-SUMMARY.md`
- FOUND commits: `8d93d11`, `c5cb51e`, `6233b7f`
- No tracked file deletions in task commits.

---
*Phase: 74-home-meal-edit-entry-and-existing-edit-contract-review*
*Completed: 2026-06-02T15:22:44Z*
