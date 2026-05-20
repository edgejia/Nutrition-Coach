---
phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
plan: 01
subsystem: realtime
tags: [sse, fastify, daily-summary, guest-session, realtime]

requires:
  - phase: 62-meal-revision-tokens-and-stale-receipt-protection
    provides: meal revision and affected-date mutation context
provides:
  - Backend `daily_summary` SSE envelope type with `summary`, `affectedDate`, and `source`
  - Authenticated initial `/api/sse` frame shaped as `source: "initial"`
  - Integration proof that initial envelope metadata matches `summary.date`
affects: [phase-63, realtime, client-sse-parser, meal-freshness]

tech-stack:
  added: []
  patterns:
    - Route-owned SSE envelope metadata with publisher-owned fan-out
    - TDD RED/GREEN integration proof for SSE frame contracts

key-files:
  created:
    - .planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-01-SUMMARY.md
  modified:
    - server/realtime/publisher.ts
    - server/routes/sse.ts
    - tests/integration/sse.test.ts

key-decisions:
  - "Initial /api/sse daily_summary frames now use the strict Phase 63 envelope with affectedDate derived from summary.date."
  - "RealtimePublisher remains fan-out only and temporarily accepts raw DailySummary payloads for unmigrated mutation call sites until 63-02."

patterns-established:
  - "DailySummarySSEPayload: server routes supply summary/date/source metadata; publisher only serializes and fans out."
  - "Initial SSE envelope proof: integration tests parse the first daily_summary frame and assert exact top-level envelope keys."

requirements-completed: [REAL-01, REAL-03]

duration: 4min
completed: 2026-05-18
---

# Phase 63 Plan 01: Backend Initial `daily_summary` Envelope Summary

**Authenticated initial SSE snapshots now emit `{ summary, affectedDate, source: "initial" }` while the publisher stays a fan-out-only transport boundary.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-05-18T07:41:45Z
- **Completed:** 2026-05-18T07:45:43Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added a failing integration assertion for the first `/api/sse` `daily_summary` frame, proving the old raw payload was insufficient.
- Exported `DailySummarySSESource` and `DailySummarySSEPayload` from `server/realtime/publisher.ts` without adding reads, logs, route knowledge, or dependencies.
- Updated the authenticated initial SSE route to emit `affectedDate: summary.date` and `source: "initial"` while preserving cookie-backed `resolveGuestSession` ownership.

## Task Commits

1. **Task 1: Prove initial SSE frame uses the strict envelope** - `36a81dc` (test)
2. **Task 2: Implement fan-out-only initial `daily_summary` envelope** - `d1cdf06` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `tests/integration/sse.test.ts` - Added strict envelope assertion for the initial EventSource `daily_summary` frame.
- `server/realtime/publisher.ts` - Added the shared server envelope types and widened `publishDailySummary` to accept raw or enveloped payloads.
- `server/routes/sse.ts` - Wrapped the authenticated initial summary frame with `summary`, `affectedDate`, and `source`.
- `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-01-SUMMARY.md` - Execution summary and verification record.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/sse.test.ts` - PASS after implementation, 7/7 tests.
- `yarn tsc --noEmit` - PASS.
- `yarn test:integration` - FAIL outside the declared plan files: `tests/harness/scenarios/meal-delete-consistency.ts` still parses the initial `daily_summary` frame as raw `DailySummary` during `subscribe_summary`. The plan-required targeted SSE integration test and TypeScript gate pass; the harness consumer should be migrated when downstream Phase 63 SSE consumers are updated.

## Decisions Made

- Kept `source` as only `"initial" | "meal_mutation"` and did not add summaryOutcome, changed ids, revision ids, high-watermark fields, schemas, or dependencies.
- Preserved raw `DailySummary` publish compatibility so chat and direct meal mutation call sites remain type-checkable until 63-02 migrates them.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The RED test initially left an SSE connection open on assertion failure. The test cleanup now cancels the reader and aborts the controller in `finally`, so RED failures report the actual envelope mismatch.
- The broader integration gate surfaced an undeclared harness consumer of the old raw initial SSE payload. It was not changed in this plan to keep writes scoped to declared files.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

63-02 can migrate chat/direct mutation publishers to `source: "meal_mutation"` envelopes using the exported server type. 63-03 and later consumer-facing work should account for remaining test and harness readers that still assume raw `daily_summary` data.

## Self-Check: PASSED

- Created summary file exists.
- Planned source and test files exist.
- Task commits `36a81dc` and `d1cdf06` exist in git history.

---
*Phase: 63-sse-meal-row-freshness-and-affected-date-invalidation*
*Completed: 2026-05-18*
