---
phase: 61-committed-mutation-outcome-and-summary-contract
plan: 06
subsystem: client
tags: [summary-outcome, client-transport, direct-meal-mutations, sse, node-test]

requires:
  - phase: 61-committed-mutation-outcome-and-summary-contract
    provides: Direct route and chat JSON/SSE summaryOutcome response projection from 61-04 and 61-05
provides:
  - Client SummaryOutcome DTO and runtime guard for direct HTTP and chat SSE terminal payloads
  - Direct meal edit/delete consumers that preserve committed mutation side effects without requiring dailySummary
  - Final Phase 61 local closure proof with targeted, type, unit, integration, full test, and release gates
affects: [phase-61, client-api, meal-edit, summary-detail, phase-62]

tech-stack:
  added: []
  patterns:
    - Client transport accepts summaryOutcome only through an exact runtime guard
    - Direct mutation UI records committed side effects before optional usable-summary refresh

key-files:
  created:
    - .planning/phases/61-committed-mutation-outcome-and-summary-contract/61-06-SUMMARY.md
  modified:
    - client/src/types.ts
    - client/src/api.ts
    - client/src/components/MealEditScreen.tsx
    - client/src/components/SummaryDetailScreen.tsx
    - tests/unit/api-client.test.ts
    - tests/unit/meal-edit-screen.test.ts

key-decisions:
  - "Client SummaryOutcome matches the Phase 61 public union and is guarded at the transport boundary."
  - "Malformed summaryOutcome payloads are omitted instead of thrown through client parsing."
  - "Direct mutation UI does not add visible degraded-summary copy in Phase 61."
  - "yarn release:check was run as local closure proof only; no staging or main action was performed."

patterns-established:
  - "isSummaryOutcome accepts fresh/recovered only with valid DailySummary, and recovered/unavailable only with reason recompute_failed."
  - "MealEditScreen and SummaryDetailScreen call setDailySummary only when a usable dailySummary exists."

requirements-completed: [MUT-04]

duration: 5 min
completed: 2026-05-17
---

# Phase 61 Plan 06: Client Parsing, Direct Mutation Consumption, and Final Gate Summary

**Client transport now parses summaryOutcome safely and direct meal mutation UI treats missing dailySummary as summary unavailable, not mutation failure**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-17T07:38:09Z
- **Completed:** 2026-05-17T07:43:01Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Added client `SummaryOutcome` DTOs plus `isSummaryOutcome()` runtime validation for direct HTTP and chat SSE terminal payloads.
- Updated direct `updateMeal()` and `deleteMeal()` parsing so committed unavailable outcomes resolve with optional `dailySummary`.
- Updated `MealEditScreen` and `SummaryDetailScreen` to record mutation side effects after HTTP 200 and only call `setDailySummary()` for usable summaries.
- Ran the full Phase 61 closure gate, including `yarn release:check`, without staging or main promotion.

## Task Commits

1. **Task 1: Add client parsing and consumer tests** - `77fec94` (test)
2. **Task 2: Implement client SummaryOutcome DTO parsing and consumers** - `697de49` (feat)
3. **Task 3: Run Phase 61 final verification gate** - `f397f5f` (chore)

## Files Created/Modified

- `client/src/types.ts` - Adds public client `SummaryOutcome`, optional direct mutation `dailySummary`, and direct delete DTO shape.
- `client/src/api.ts` - Adds `isSummaryOutcome()`, normalizes summaryOutcome/dailySummary fields, and threads summaryOutcome through chat `done`/`stopped` callbacks.
- `client/src/components/MealEditScreen.tsx` - Keeps redact, mutation nonce, and navigation behavior when direct update/delete returns no summary.
- `client/src/components/SummaryDetailScreen.tsx` - Guards direct delete summary refresh on `dailySummary?.date`.
- `tests/unit/api-client.test.ts` - Covers direct unavailable outcomes and valid/malformed SSE terminal summaryOutcome parsing.
- `tests/unit/meal-edit-screen.test.ts` - Covers source contracts for direct mutation side effects without visible degraded-summary UI copy.
- `.planning/phases/61-committed-mutation-outcome-and-summary-contract/61-06-SUMMARY.md` - Execution summary and self-check.

## Decisions Made

- Followed D-08 and D-11 by treating `summaryOutcome` as the structured degraded-signal channel and leaving malformed payloads omitted.
- Followed D-12 by not adding a visible stale or degraded summary indicator in client UI.
- Used the existing source-contract test pattern for component behavior because these component tests already verify UI mutation wiring through source assertions.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The RED direct HTTP tests passed at runtime before implementation because the old client returned unvalidated JSON bodies. The RED gate still failed on SSE parsing and component source contracts, and the GREEN implementation made the direct DTO/parser behavior type-safe.
- `yarn test:unit`, `yarn test:integration`, `yarn test`, and `yarn release:check` regenerated timestamp/evidence noise under `tests/harness/artifacts/image-log-failure/latest/*`; those generated files were restored and not included.

## User Setup Required

None - no external service configuration required.

## Verification

- RED expected failure: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/meal-edit-screen.test.ts` failed before implementation on missing SSE `summaryOutcome` projection and direct mutation source contracts.
- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/meal-edit-screen.test.ts`
- PASS: `yarn tsc --noEmit`
- PASS: `yarn test:unit`
- PASS: `yarn test:integration`
- PASS: `yarn test`
- PASS: `yarn release:check`

## Known Stubs

None. Stub scan found only normal empty test arrays, nullable guards, empty string validation, and an existing image-placeholder CSS class used for real empty-image UI, not unwired mock data or placeholder functionality.

## Threat Flags

None. The changed surface is the planned client transport parsing and UI state consumption for already-planned summaryOutcome response fields; no new endpoint, auth path, file access pattern, schema change, raw payload logging, or visible degraded-summary channel was introduced.

## Next Phase Readiness

Phase 61 is complete. Phase 62 can build stale receipt protection on top of client DTOs that now tolerate committed mutation outcomes without requiring a fresh daily summary.

## Self-Check: PASSED

- FOUND: `client/src/types.ts`
- FOUND: `client/src/api.ts`
- FOUND: `client/src/components/MealEditScreen.tsx`
- FOUND: `client/src/components/SummaryDetailScreen.tsx`
- FOUND: `tests/unit/api-client.test.ts`
- FOUND: `tests/unit/meal-edit-screen.test.ts`
- FOUND commits: `77fec94`, `697de49`, `f397f5f`
- No tracked file deletions in task commits.

---
*Phase: 61-committed-mutation-outcome-and-summary-contract*
*Completed: 2026-05-17*
