---
phase: 65-tool-contract-alignment-and-meal-period-authority
plan: 04
subsystem: api
tags: [fastify, sqlite, meal-period, history, integration-tests]

requires:
  - phase: 65-01
    provides: Nullable persisted mealPeriod authority and service-layer meal history projection
  - phase: 65-03
    provides: Source-text-backed explicit mealPeriod persistence from log_food
provides:
  - Explicit-only mealPeriod projection for current-day meal rows
  - Explicit-only mealPeriod projection for day snapshot rows
  - Explicit-only mealPeriod projection for history list, search, and day detail rows
  - Integration proof that legacy/no-authority rows do not expose inferred public mealPeriod
affects: [phase-65, backend-api, meal-history, history-query, client-dtos]

tech-stack:
  added: []
  patterns:
    - Conditional public DTO projection for explicit persisted mealPeriod authority
    - Service-owned history projection with route pass-through

key-files:
  created:
    - .planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-04-SUMMARY.md
  modified:
    - server/routes/meals.ts
    - server/routes/day-snapshot.ts
    - server/services/history-query.ts
    - tests/integration/meals-api.test.ts
    - tests/integration/day-snapshot-api.test.ts
    - tests/integration/history-api.test.ts

key-decisions:
  - "Public route DTOs project mealPeriod only from persisted explicit enum values; legacy/no-authority rows omit the field instead of deriving from loggedAt."
  - "History routes remain pass-through; history-query owns mealPeriod selection, normalization, and DTO projection."

patterns-established:
  - "Use conditional object spreads for explicit-only mealPeriod route DTOs so absent authority remains distinguishable."
  - "Normalize persisted mealPeriod at history projection time before exposing public DTO fields."

requirements-completed: [INTENT-02]

duration: 5min
completed: 2026-05-27
---

# Phase 65 Plan 04: Backend Meal-Period Projection Summary

**Current-day, day snapshot, and history meal-row APIs now expose persisted explicit mealPeriod authority without inferring public values from loggedAt.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-27T13:19:04Z
- **Completed:** 2026-05-27T13:24:10Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments

- Added RED/GREEN integration coverage for `/api/meals`, `/api/day-snapshot`, `/api/history/meals`, `/api/history/search`, and `/api/history/days/:date`.
- Projected explicit `mealPeriod` through current-day and day snapshot route DTOs while preserving cookie-backed guest-session ownership.
- Projected explicit `mealPeriod` through `HistoryMealDto` from `history-query`, including list, search, and day detail paths.
- Proved legacy breakfast-hour rows with no persisted period do not expose inferred public `mealPeriod`.
- Proved ordinary direct `PATCH /api/meals/:id` preserves and returns an existing explicit `mealPeriod` while revision preconditions remain active.

## Task Commits

1. **Task 1 RED: Add failing mealPeriod route projection tests** - `2874a8f` (test)
2. **Task 1 GREEN: Project explicit mealPeriod in meal routes** - `7e7d09f` (feat)
3. **Task 2 RED: Add failing history mealPeriod projection test** - `bd45c65` (test)
4. **Task 2 GREEN: Project explicit mealPeriod in history DTOs** - `43000ef` (feat)

**Plan metadata:** committed after summary creation.

## Files Created/Modified

- `server/routes/meals.ts` - Adds explicit-only `mealPeriod` projection to `GET /api/meals` rows and direct PATCH response rows.
- `server/routes/day-snapshot.ts` - Adds explicit-only `mealPeriod` projection to day snapshot meal rows.
- `server/services/history-query.ts` - Adds optional `HistoryMealDto.mealPeriod`, selects persisted meal period in list/search headers, and normalizes before DTO projection.
- `tests/integration/meals-api.test.ts` - Covers explicit lunch projection, legacy absence, and PATCH preservation.
- `tests/integration/day-snapshot-api.test.ts` - Covers explicit lunch projection and legacy absence for selected-day rows.
- `tests/integration/history-api.test.ts` - Covers history list, search, and day detail explicit projection without legacy inference.
- `.planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-04-SUMMARY.md` - Captures execution outcome.

## Decisions Made

- Public DTOs omit `mealPeriod` for legacy/no-authority rows rather than returning an inferred or fallback value.
- History route code remains unchanged because `history-query` owns the DTO contract and all history routes return those service DTOs directly.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Verification

- RED Task 1: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts tests/integration/day-snapshot-api.test.ts` - FAIL as expected on missing explicit `mealPeriod`.
- GREEN Task 1: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts tests/integration/day-snapshot-api.test.ts && yarn tsc --noEmit` - PASS.
- RED Task 2: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/history-api.test.ts` - FAIL as expected on missing explicit `mealPeriod`.
- GREEN Task 2: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/history-api.test.ts && yarn tsc --noEmit` - PASS.
- Final targeted: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts tests/integration/day-snapshot-api.test.ts tests/integration/history-api.test.ts` - PASS, 36 tests.
- Final TypeScript: `yarn tsc --noEmit` - PASS.
- AGENTS route/service gate: `yarn test:integration` - PASS, 311 tests.
- Source check: `rg -n "resolveGuestSession|headers\\[\\\"x-device-id\\\"\\]|query.*deviceId|mealPeriod" server/routes/meals.ts server/routes/day-snapshot.ts ...` - PASS; routes still derive ownership from `resolveGuestSession` and no raw device-id access was introduced.
- Source check: `rg -n "interface HistoryMealDto|mealPeriod\\??: MealPeriod|inferredMealPeriod|mealTransactions\\.mealPeriod|normalizeMealPeriod" server/services/history-query.ts tests/integration/history-api.test.ts` - PASS; optional public `MealPeriod` exists and no `inferredMealPeriod` was introduced.

## Threat Flags

None - the storage-to-DTO and cookie-backed route ownership surfaces were covered by T-65-11, T-65-12, and T-65-13.

## Next Phase Readiness

Phase 65 Plan 05 can project `mealPeriod` through chat JSON/SSE and restored logged-meal receipts using the same explicit-only authority contract. Phase 65 Plan 08 can consume persisted explicit period facts from backend rows without relying on public inferred values.

## Self-Check: PASSED

- Summary file created at `.planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-04-SUMMARY.md`.
- Key modified files exist: `server/routes/meals.ts`, `server/routes/day-snapshot.ts`, `server/services/history-query.ts`, `tests/integration/meals-api.test.ts`, `tests/integration/day-snapshot-api.test.ts`, `tests/integration/history-api.test.ts`.
- Task commits present: `2874a8f`, `7e7d09f`, `bd45c65`, `43000ef`.
- No tracked file deletions were introduced by task commits.

---
*Phase: 65-tool-contract-alignment-and-meal-period-authority*
*Completed: 2026-05-27*
