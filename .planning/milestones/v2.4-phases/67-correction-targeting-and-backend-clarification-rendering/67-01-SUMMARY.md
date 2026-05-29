---
phase: 67-correction-targeting-and-backend-clarification-rendering
plan: 01
subsystem: testing
tags: [node-test, fastify, sqlite, meal-correction, renderer-owned-copy]

requires:
  - phase: 66-numeric-correction-provenance-guard
    provides: numeric correction authority and no-mutation route proof
provides:
  - Red-first service coverage for correction target ranking and D-30 scoped recovery
  - Red-first tool/orchestrator coverage for renderer-owned correction clarification
  - Red-first Fastify coverage for no mutation, no summaryOutcome, and no publish on unresolved targets
affects: [phase-67, TARGET-01, TARGET-02, correction-targeting]

tech-stack:
  added: []
  patterns: [Node built-in test with real SQLite and MockLLMProvider]

key-files:
  created:
    - .planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-01-SUMMARY.md
  modified:
    - tests/unit/meal-correction.test.ts
    - tests/unit/tools.test.ts
    - tests/unit/orchestrator.test.ts
    - tests/integration/chat-meal-correction.integration.test.ts

key-decisions:
  - "Phase 67 Wave 0 remains red-first only; no production resolver, tool, orchestrator, or route code was changed."
  - "Renderer-owned correction clarification tests reject raw correction request text, calories/macros in target options, mutation metadata, summaryOutcome, and daily_summary publish on unresolved paths."

patterns-established:
  - "Red-first service tests assert exact Phase 67 decision IDs in test names for downstream implementation traceability."
  - "Route tests use buildApp with real SQLite, MockLLMProvider, and publisher spies for no-publish proof."

requirements-completed: [TARGET-01, TARGET-02]

duration: 7min
completed: 2026-05-29
---

# Phase 67 Plan 01: Red-First Correction Targeting Summary

**Red-first Node test coverage now pins correction target ranking and backend-rendered clarification behavior before Phase 67 production changes.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-28T19:50:10Z
- **Completed:** 2026-05-28T19:56:13Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added service-level red tests for explicit date hard scope, explicit persisted mealPeriod over inferred loggedAt period, label-tier narrowing, unmatched food-label no-fallback behavior, invalid-number recovery, and D-30 single-date recovery/no-meals copy.
- Added tool and orchestrator red tests proving `find_meals` clarification must become renderer-owned terminal output and must not let the LLM or orchestrator echo raw correction text as the target label.
- Added Fastify route red tests proving unresolved or mixed correction paths do not mutate, expose `summaryOutcome`, publish `daily_summary`, or show success-style copy unless target selection and numeric authority both pass.

## Task Commits

1. **Task 1: Add red-first meal-correction resolver ranking cases** - `d396894` (test)
2. **Task 2: Add red-first pending-selection and renderer boundary unit cases** - `9f1b124` (test)
3. **Task 3: Add red-first Fastify route no-mutation proof** - `e4117c2` (test)

## Files Created/Modified

- `tests/unit/meal-correction.test.ts` - Red-first resolver ranking, scoped recovery, and pending invalid-number tests.
- `tests/unit/tools.test.ts` - Red-first `find_meals` controlled renderer reply tests.
- `tests/unit/orchestrator.test.ts` - Red-first one-call renderer-owned clarification test with raw-echo rejection.
- `tests/integration/chat-meal-correction.integration.test.ts` - Red-first route proof for mixed follow-ups, no mutation/no publish, and stable clarification copy.

## Decisions Made

- Kept the plan test-only. Production files were intentionally not edited because Wave 0 exists to fail before implementation plans 67-02 through 67-05.
- Used existing real SQLite service factories, `buildApp`, and `MockLLMProvider`; no DB mocks, new test framework, or package installs were introduced.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` - expected red, 30 passed / 5 failed. Failures are the new Phase 67 assertions for explicit period ranking, label-tier option count, D-30 recovery/no-meals copy, and invalid-number valid-range copy.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/unit/orchestrator.test.ts` - expected red, 123 passed / 8 failed. Failures are the red service assertions plus new renderer-owned `find_meals` and raw-echo orchestrator assertions.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-meal-correction.integration.test.ts` - expected red, 19 passed / 2 failed. Failures are mixed numbered-selection mutation and raw-echo route clarification assertions.
- `yarn tsc --noEmit` - passed.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

The targeted test commands exit non-zero by design because this is a Wave 0 red-first plan. TypeScript compilation passes, confirming the red state is behavioral rather than a compile failure.

## Known Stubs

None. Stub-pattern scan found only ordinary test fixture empty arrays and queue resets; no UI-flowing hardcoded stubs were introduced.

## Threat Flags

None. The plan added test coverage only and introduced no new network endpoints, auth paths, file access patterns, or schema changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 67 implementation plans can now use the failing tests as the target contract for resolver ranking, backend renderer ownership, pending option selection, and no-mutation route behavior.

## Self-Check: PASSED

- Found all modified test files on disk.
- Found task commits `d396894`, `9f1b124`, and `e4117c2` in git history.
- Verified no tracked files were deleted by task commits.

---
*Phase: 67-correction-targeting-and-backend-clarification-rendering*
*Completed: 2026-05-29*
