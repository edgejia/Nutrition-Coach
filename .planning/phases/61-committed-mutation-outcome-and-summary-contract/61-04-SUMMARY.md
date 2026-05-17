---
phase: 61-committed-mutation-outcome-and-summary-contract
plan: 04
subsystem: api
tags: [summary-outcome, chat-json, chat-sse, fastify, node-test]

requires:
  - phase: 61-committed-mutation-outcome-and-summary-contract
    provides: Shared SummaryOutcome helper and chat tool/orchestrator summaryOutcome propagation from 61-01 through 61-03
provides:
  - Chat JSON responses carrying summaryOutcome for committed log, update, and delete meal mutations
  - Chat SSE done and stopped terminal payloads carrying summaryOutcome for committed meal mutations
  - Integration proof that unavailable summary outcomes omit top-level dailySummary while preserving committed facts
affects: [phase-61, chat-json, chat-stream, client-chat-consumers]

tech-stack:
  added: []
  patterns:
    - Route payloads project summaryOutcome independently from compatibility dailySummary
    - Meal correction service uses composition-root summary and food logging dependencies for shared post-commit recovery policy

key-files:
  created:
    - .planning/phases/61-committed-mutation-outcome-and-summary-contract/61-04-SUMMARY.md
  modified:
    - server/app.ts
    - server/routes/chat.ts
    - tests/integration/chat-api.test.ts
    - tests/integration/chat-streaming.test.ts

key-decisions:
  - "Chat JSON and SSE terminal payloads now expose summaryOutcome whenever the orchestrator result includes a committed meal mutation outcome."
  - "Top-level dailySummary remains a compatibility projection and is omitted when summaryOutcome is unavailable."
  - "publishSummarySafe remains metadata-only and still receives only usable dailySummary values."

patterns-established:
  - "Chat route terminal payloads include summaryOutcome with the same conditional spread style used for loggedMeal, dailySummary, dailyTargets, and affectedDate."
  - "Integration degraded-summary fixtures override the composition-root summary and food logging services so update/delete service recovery behavior is exercised through real Fastify requests."

requirements-completed: [MUT-01, MUT-02, MUT-03]

duration: 5 min
completed: 2026-05-17
---

# Phase 61 Plan 04: Chat JSON/SSE Response Projection and Integration Proof Summary

**Chat JSON and SSE terminal payloads now expose committed meal mutation facts with explicit summaryOutcome when summary refresh is unavailable**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-17T07:30:30Z
- **Completed:** 2026-05-17T07:34:55Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added integration proof for JSON log/update/delete responses and SSE done/stopped terminal payloads carrying `summaryOutcome`.
- Updated `server/routes/chat.ts` so JSON, SSE `done`, SSE `stopped`, and fallback terminal payloads include `summaryOutcome` while preserving compatibility `dailySummary` behavior.
- Removed the JSON route invariant that treated `didLogMeal` without `dailySummary` as an error; `summaryOutcome.status === "unavailable"` is now valid.
- Kept publish failure out of response bodies and `summaryOutcome`, with tests asserting no `publish_failed` response status or reason.

## Task Commits

1. **Task 1: Add chat JSON and SSE response parity tests** - `9772f35` (test)
2. **Task 2: Project summaryOutcome from chat route results** - `5b6d9d3` (feat)

## Files Created/Modified

- `tests/integration/chat-api.test.ts` - Adds JSON log/update/delete degraded-summary assertions and publish-failure isolation proof.
- `tests/integration/chat-streaming.test.ts` - Adds SSE done/stopped terminal payload assertions for degraded committed meal mutations.
- `server/routes/chat.ts` - Projects `summaryOutcome` from `OrchestratorResult` into JSON and SSE terminal payloads without changing publish failure semantics.
- `server/app.ts` - Wires `mealCorrectionService` with the composition-root `summaryService` and `foodLoggingService` instances.
- `.planning/phases/61-committed-mutation-outcome-and-summary-contract/61-04-SUMMARY.md` - Execution summary and self-check.

## Decisions Made

- Followed D-05, D-07, D-11, and D-21 from the phase context.
- Kept `/api/sse daily_summary` freshness out of scope per D-06.
- Kept route projection surgical: `summaryOutcome` is emitted only when present on the orchestrator result, and `dailySummary` remains controlled by the existing usable-summary field.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Wired meal correction service through composition-root dependencies**
- **Found during:** Task 2 (Project summaryOutcome from chat route results)
- **Issue:** Update/delete degraded-summary integration tests could not exercise recompute/recovery failure through existing service hooks because `mealCorrectionService` owned separate `summaryService` and `foodLoggingService` instances.
- **Fix:** Constructed `mealCorrectionService` with the existing composition-root `summaryService` and `foodLoggingService` instances.
- **Files modified:** `server/app.ts`
- **Verification:** `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts`; `yarn tsc --noEmit`; `yarn test:integration`
- **Committed in:** `5b6d9d3`

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The DI adjustment was required for route-level degraded-summary proof and follows the existing service injection pattern. Runtime behavior remains equivalent except shared service instances now enforce one summary recovery policy.

## Issues Encountered

- `yarn test:integration` regenerated timestamp/evidence noise under `tests/harness/artifacts/image-log-failure/latest/*`; those generated files were restored and not included.

## User Setup Required

None - no external service configuration required.

## Verification

- RED expected failure: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` failed before production edits with 8 missing `summaryOutcome` assertions.
- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts`
- PASS: `yarn tsc --noEmit`
- PASS: `yarn test:integration`

## Known Stubs

None. Stub scan found only normal empty string/array initialization, nullable guards, and test-local fixtures; no UI-facing placeholders or unwired mock data were introduced.

## Threat Flags

None. The changed surface is the planned chat JSON/SSE response projection. No new endpoint, auth path, file access pattern, schema change, raw payload logging, publish status coupling, or routine trace privacy expansion was introduced.

## Next Phase Readiness

Ready for `61-06` to update client parsing and direct mutation consumption. Chat responses now provide the same public `summaryOutcome` contract as the direct meal routes.

## Self-Check: PASSED

- FOUND: `server/routes/chat.ts`
- FOUND: `server/app.ts`
- FOUND: `tests/integration/chat-api.test.ts`
- FOUND: `tests/integration/chat-streaming.test.ts`
- FOUND commits: `9772f35`, `5b6d9d3`
- No tracked file deletions in task commits.

---
*Phase: 61-committed-mutation-outcome-and-summary-contract*
*Completed: 2026-05-17*
