---
phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
plan: 02
subsystem: realtime
tags: [sse, fastify, daily-summary, meal-mutations, affected-date]

requires:
  - phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
    provides: initial daily_summary SSE envelope from plan 63-01
provides:
  - Chat and direct meal mutation `daily_summary` events shaped as `{ summary, affectedDate, source: "meal_mutation" }`
  - Same-day and historical mutation publish coverage for chat JSON, chat SSE, direct PATCH, and direct DELETE paths
  - Final envelope-only `RealtimePublisher.publishDailySummary` signature
affects: [phase-63, realtime, harness-consumers, client-sse-parser]

tech-stack:
  added: []
  patterns:
    - Route-owned mutation SSE metadata with publisher-owned fan-out
    - TDD RED tests for direct and chat mutation envelope contracts

key-files:
  created:
    - .planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-02-SUMMARY.md
    - .planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/deferred-items.md
  modified:
    - server/routes/chat.ts
    - server/routes/meals.ts
    - server/realtime/publisher.ts
    - tests/integration/chat-api.test.ts
    - tests/integration/meals-api.test.ts
    - tests/harness/scenarios/boundary-contracts.ts

key-decisions:
  - "Meal mutation routes now publish strict affected-date envelopes and no longer suppress historical mutation summaries with a today-only gate."
  - "Chat same-day mutation publish derives the affected date from the summary date when the orchestrator omits explicit affectedDate for current-day log_food results."
  - "Publisher compatibility for raw DailySummary payloads was removed after chat, meals, and the stale-publisher harness source migrated."

patterns-established:
  - "Mutation publish helper guard: publish only when a usable DailySummary exists and summary.date matches the affected date."
  - "Chat SSE ordering proof: terminal done remains observable before non-fatal daily_summary fan-out."

requirements-completed: [REAL-01, REAL-03]

duration: 7min
completed: 2026-05-18
---

# Phase 63 Plan 02: Mutation `daily_summary` Affected-Date Emission Summary

**Committed meal mutations now publish strict same-day and historical `daily_summary` envelopes with route-owned `affectedDate` and `source: "meal_mutation"` metadata.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-05-18T07:54:34Z
- **Completed:** 2026-05-18T08:01:28Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Added RED integration coverage proving direct PATCH/DELETE and chat JSON/SSE mutation paths need strict mutation envelopes instead of raw `DailySummary`.
- Removed today-only publish gates from chat and direct meal routes while preserving summary-unavailable, date-mismatch, stale revision, and non-fatal publish behavior.
- Narrowed `RealtimePublisher.publishDailySummary` to `DailySummarySSEPayload` after migrating all compile-time call sites needed by this plan.

## Task Commits

1. **Task 1: Prove direct meal mutation affected-date envelopes** - `243980d` (test)
2. **Task 2: Prove chat mutation affected-date envelopes and terminal ordering** - `5a03481` (test)
3. **Task 3: Implement route-level affected-date publish helpers and finalize publisher signature** - `c391db4` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `tests/integration/meals-api.test.ts` - Added direct same-day PATCH/DELETE envelope assertions, historical DELETE SSE envelope proof, and unavailable-summary no-publish assertions.
- `tests/integration/chat-api.test.ts` - Added chat JSON same-day/historical publish envelope assertions and extended the stream ordering test to validate the mutation envelope.
- `server/routes/meals.ts` - Publishes `source: "meal_mutation"` envelopes for direct same-day and historical mutations when `dailySummary.date === affectedDate`.
- `server/routes/chat.ts` - Publishes mutation envelopes after terminal SSE frames or before JSON return, with same-day fallback from `dailySummary.date` when explicit `affectedDate` is absent.
- `server/realtime/publisher.ts` - Removed raw `DailySummary` compatibility from `publishDailySummary`.
- `tests/harness/scenarios/boundary-contracts.ts` - Updated the stale-publisher harness source to call the narrowed publisher signature.
- `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/deferred-items.md` - Logged out-of-scope harness consumer migrations surfaced by the broad integration gate.
- `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-02-SUMMARY.md` - Execution summary and verification record.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` - RED failed as expected before implementation: raw same-day payloads lacked `source`, and historical direct delete emitted no `daily_summary`.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts` - RED failed as expected before implementation: raw same-day payloads lacked `source`, historical chat mutation published nothing, and stream envelope assertion failed.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts tests/integration/chat-api.test.ts` - PASS after implementation, 98/98 tests.
- `yarn tsc --noEmit` - PASS after updating the stale-publisher harness source for the narrowed publisher signature.
- `yarn verify:harness -- boundary-contracts` - PASS, 14/14 steps.
- `yarn test:integration` - FAIL outside this plan's declared route/test scope: `meal-delete-consistency` and `text-log` harness integration consumers still parse `daily_summary` SSE payloads as raw `DailySummary` instead of the Phase 63 envelope. Logged in `deferred-items.md`.

## Decisions Made

- Used `dailySummary.date` as the same-day affected-date fallback in `server/routes/chat.ts` because current-day `log_food` results omit explicit `affectedDate`, while historical results already provide it.
- Kept `source: "meal_mutation"` as a guardrail only and did not add `summaryOutcome`, meal ids, revision ids, or high-watermark fields to mutation SSE payloads.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated stale-publisher harness source for narrowed publisher signature**
- **Found during:** Task 3 (implementation verification)
- **Issue:** `yarn tsc --noEmit` failed because `tests/harness/scenarios/boundary-contracts.ts` still called `publishDailySummary(deviceId, summary)` after the publisher became envelope-only.
- **Fix:** Wrapped the fixture summary as `{ summary, affectedDate: summary.date, source: "meal_mutation" }`.
- **Files modified:** `tests/harness/scenarios/boundary-contracts.ts`
- **Verification:** `yarn tsc --noEmit` PASS; `yarn verify:harness -- boundary-contracts` PASS.
- **Committed in:** `c391db4`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** The fix was required to finalize the publisher signature without leaving TypeScript broken. No route behavior or public API shape beyond the planned envelope migration was added.

## Issues Encountered

- The broader `yarn test:integration` gate still has out-of-scope harness consumer failures in `meal-delete-consistency` and `text-log`. These are downstream consumers of the Phase 63 SSE envelope and are logged in `deferred-items.md`; targeted route integration and TypeScript gates pass.

## Known Stubs

None. Stub-pattern scan found only normal local arrays/null state in tests and route internals, not user-facing placeholders or unwired data.

## Threat Flags

None. The touched route helpers implement the plan's existing trust-boundary mitigations and do not add new endpoints, auth paths, file access, or schema changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Client and harness consumers should now treat both initial and mutation `daily_summary` events as envelopes. Downstream Phase 63 consumer work should include migrating the remaining raw-summary harness readers tracked in `deferred-items.md`.

## Self-Check: PASSED

- Created summary file exists.
- Deferred items file exists.
- Planned source and test files exist.
- Task commits `243980d`, `5a03481`, and `c391db4` exist in git history.

---
*Phase: 63-sse-meal-row-freshness-and-affected-date-invalidation*
*Completed: 2026-05-18*
