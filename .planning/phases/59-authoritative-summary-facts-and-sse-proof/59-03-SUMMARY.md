---
phase: 59-authoritative-summary-facts-and-sse-proof
plan: 03
subsystem: api
tags: [summary-history, sse, json-route, deterministic-renderer, integration-test]

requires:
  - phase: 59-authoritative-summary-facts-and-sse-proof
    provides: Shared summary/history renderer from 59-01 and orchestrator plain reply wiring from 59-02
provides:
  - Route-level summary/history composition for JSON drained streams and live SSE
  - Integration proof for JSON response/history, drained stream response/history, and SSE chunks/history
  - 59-04-compatible structured image verification assertions
affects: [phase-59, route-final-reply, summary-history, sse]

tech-stack:
  added: []
  patterns:
    - Route-owned no-mutation summary/history replies normalize through composeSummaryHistoryReply
    - Live SSE summary-context tokens are held until composed text is available

key-files:
  created: []
  modified:
    - server/routes/chat.ts
    - tests/integration/chat-api.test.ts
    - tests/integration/chat-streaming.test.ts
    - tests/integration/verification-image.test.ts

key-decisions:
  - "Route-owned summary/history output composes deterministic facts before finalizeAssistantReply and before visible SSE chunk emission."
  - "Verifier image-log-failure tests assert 59-04 structured evidence instead of raw chunk or fallback text."

patterns-established:
  - "normalizeRouteFinalReply composes summary/history facts first, then keeps guardNoMutationLoggingClaim as defense-in-depth."
  - "Non-SSE drained streams and live SSE share the same route final-reply normalization boundary."

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04]

duration: 6min
completed: 2026-05-17
---

# Phase 59 Plan 03: Route Summary/History Composer Wiring Summary

**JSON drained streams and live SSE now emit and persist deterministic summary/history facts from the shared renderer.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-16T16:45:07Z
- **Completed:** 2026-05-16T16:51:13Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Added JSON route regressions proving persisted `豆腐飯 520 kcal` and `鮭魚飯 380 kcal` produce `今天已記錄 2 餐，共 900 kcal：豆腐飯 520 kcal、鮭魚飯 380 kcal。`.
- Added non-SSE drained stream coverage proving route-owned `streamGenerator` output is composed before `reply.send()` and assistant history persistence.
- Added live SSE coverage proving visible chunks and saved assistant history match composed persisted facts and omit fake `牛肉飯`, `滷肉飯`, and `豆腐飯 900 kcal` claims.
- Wired `server/routes/chat.ts` to use `composeSummaryHistoryReply()` before route-owned output and persistence boundaries.

## Task Commits

1. **Task 1: Add route regressions for JSON and drained-stream summary/history replies** - `e10d2a5` (test)
2. **Task 2: Add live SSE summary/history chunk and history regressions** - `a405520` (test)
3. **Task 3: Apply composer before route response, history, and SSE chunk output** - `4ccede5` (feat)

## Files Created/Modified

- `server/routes/chat.ts` - Imports the shared composer and normalizes route-owned no-mutation summary/history replies before JSON persistence, drained-stream JSON response, live SSE chunks, and SSE history persistence.
- `tests/integration/chat-api.test.ts` - Adds canonical JSON and drained-stream regressions, and updates summary/history assertions to expect deterministic persisted facts.
- `tests/integration/chat-streaming.test.ts` - Adds canonical live SSE chunk/history regression and updates summary-context SSE expectations to deterministic persisted facts.
- `tests/integration/verification-image.test.ts` - Aligns image-log-failure verifier assertions with 59-04 structured evidence.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts` - RED before implementation: drained-stream route test failed with mutation-failure fallback instead of composed persisted facts.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-streaming.test.ts` - RED before implementation: live SSE canonical test failed with mutation-failure fallback instead of composed persisted facts.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` - PASS after implementation, 119 tests.
- `yarn test:integration` - PASS, 278 tests.
- `yarn tsc --noEmit` - PASS.

## Decisions Made

- Kept `guardNoMutationLoggingClaim()` in the route as a post-composition defense-in-depth guard.
- Did not compose route-owned hallucination fallback text; hallucination fallback remains route fallback behavior.
- Restored incidental regenerated `image-log-failure/latest` artifact diffs after full integration because they contained UUID/timestamp/read-count noise only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated image-log-failure verifier assertions for completed 59-04 artifacts**
- **Found during:** Task 3 (Apply composer before route response, history, and SSE chunk output)
- **Issue:** `yarn test:integration` failed because `tests/integration/verification-image.test.ts` still expected raw `liveChunkText` and `fallbackContent`, but completed Plan 59-04 intentionally removed raw persisted chunk/fallback text and kept structured evidence only.
- **Fix:** Updated the verifier assertions to check `liveChunkEvidence`, text lengths, projected reply evidence, and absence of raw text fields.
- **Files modified:** `tests/integration/verification-image.test.ts`
- **Verification:** `yarn test:integration` passed.
- **Committed in:** `4ccede5`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Required to accommodate completed 59-04 and clear the mandated integration gate; no endpoint, schema, auth path, or production/staging behavior changed.

## Issues Encountered

The first full integration run regenerated tracked `image-log-failure/latest` artifacts with UUID, timestamp, latency, and read-count noise. Those generated diffs were restored before committing because Plan 59-03 did not intentionally refresh harness artifacts.

## Known Stubs

None. Stub-pattern scan only found existing runtime/test accumulators and optional nullable asset fields, not placeholder UI/data stubs.

## Threat Flags

None - this plan modified existing chat route trust boundaries already covered by T-59-08 through T-59-11 and did not add endpoints, ownership paths, file access surfaces, or schema changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 05 can use the route integration proof plus 59-04 terminal SSE proof to close the Phase 59 release-gate evidence. No staging or production promotion was performed.

## TDD Gate Compliance

- RED commit for JSON/drained stream route behavior: `e10d2a5`
- RED commit for live SSE route behavior: `a405520`
- GREEN route implementation commit: `4ccede5`
- REFACTOR commit: not needed

## Self-Check

PASSED

- Found modified files: `server/routes/chat.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`, `tests/integration/verification-image.test.ts`.
- Found summary file: `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-03-SUMMARY.md`.
- Found task commits: `e10d2a5`, `a405520`, `4ccede5`.

---
*Phase: 59-authoritative-summary-facts-and-sse-proof*
*Completed: 2026-05-17*
