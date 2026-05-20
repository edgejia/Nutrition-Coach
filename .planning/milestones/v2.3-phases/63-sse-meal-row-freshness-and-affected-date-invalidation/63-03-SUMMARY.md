---
phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
plan: 03
subsystem: realtime
tags: [sse, client, date-validation, transport-validation, realtime]

requires:
  - phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
    provides: backend initial daily_summary SSE envelope from plan 63-01
provides:
  - Client `DailySummarySSEPayload` and `DailySummarySSESource` transport types
  - Calendar-real `isRealDateKey` validation shared with history date helpers
  - Strict client `daily_summary` SSE envelope validation with silent invalid-frame ignore
  - Legacy raw-summary callback fallback for unmigrated MainLayout call sites
affects: [phase-63, client-sse-parser, sse-summary-coordinator, meal-row-freshness]

tech-stack:
  added: []
  patterns:
    - Transport-level shape guards before app state orchestration
    - Calendar date-key round-trip validation for SSE routing inputs

key-files:
  created:
    - .planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-03-SUMMARY.md
  modified:
    - client/src/types.ts
    - client/src/sse.ts
    - client/src/lib/history-week.ts
    - tests/unit/history-week.test.ts
    - tests/unit/sse-client.test.ts

key-decisions:
  - "Client daily_summary SSE parsing now accepts only the Phase 63 envelope with summary, affectedDate, and source."
  - "Future calendar-real dates pass transport validation and remain coordinator policy, not sse.ts policy."
  - "Legacy onSummary remains a nested-summary fallback until MainLayout moves to the envelope-aware coordinator in 63-04."

patterns-established:
  - "DailySummarySSEPayload client contract: strict envelope type with source literal and affectedDate routing key."
  - "SSE parser boundary: parse, validate, and dispatch only; no meal fetches, store imports, UI signals, or debug callbacks."

requirements-completed: [REAL-01, REAL-03]

duration: 3m 21s
completed: 2026-05-18
---

# Phase 63 Plan 03: Client Strict `daily_summary` Envelope Parsing Summary

**Client SSE transport now accepts only calendar-real `daily_summary` envelopes and silently drops malformed or mismatched frames before state orchestration.**

## Performance

- **Duration:** 3m 21s
- **Started:** 2026-05-18T07:48:38Z
- **Completed:** 2026-05-18T07:51:59Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Added RED unit coverage for `isRealDateKey`, envelope-aware `daily_summary` dispatch, legacy nested-summary fallback, future valid date dispatch, and invalid-frame no-op behavior.
- Added `DailySummarySSESource` / `DailySummarySSEPayload` client types next to the existing summary and goals SSE DTOs.
- Exported `isRealDateKey` from `client/src/lib/history-week.ts` using the same regex and local `Date` round-trip validation as `parseDateKey`.
- Updated `client/src/sse.ts` to catch malformed `daily_summary` JSON, validate summary numbers/source/date keys/date equality, dispatch valid envelopes, and avoid app-state or refetch responsibilities.

## Task Commits

1. **Task 1: Prove date-key and daily_summary envelope validation** - `6e65891` (test)
2. **Task 2: Implement strict SSE envelope parser** - `33ff6e7` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `client/src/types.ts` - Added client SSE envelope source and payload types.
- `client/src/sse.ts` - Added strict `daily_summary` parser guards and envelope-aware callback dispatch with legacy fallback.
- `client/src/lib/history-week.ts` - Added non-throwing calendar-real date-key validator used by SSE parsing.
- `tests/unit/history-week.test.ts` - Added validator proof for valid, malformed, and impossible date keys.
- `tests/unit/sse-client.test.ts` - Added daily_summary envelope, fallback, future-date, malformed JSON, invalid shape, invalid source, non-finite macro, and date-mismatch no-op proof.
- `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-03-SUMMARY.md` - Execution summary and verification record.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-week.test.ts tests/unit/sse-client.test.ts` - PASS after implementation, 18/18 tests.
- `yarn tsc --noEmit` - PASS.
- `yarn test:unit` - PASS, 787/787 tests.
- `rg "getMeals|setMeals|setDailySummary|recordMealMutation|from \"./store|from './store|console\\.|debug|toast|warning|warn" client/src/sse.ts` - PASS, no matches.

## Decisions Made

- Kept `sse.ts` as a validation and dispatch boundary only; no store imports, row fetches, UI copy, logging, or debug signal were added.
- Treated `source` as a literal guardrail only. Freshness and routing remain future coordinator responsibility.
- Allowed calendar-real future dates through transport validation so 63-04 can own product-scope future-date ignore.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- RED failed as expected: `isRealDateKey` was missing, envelope-aware dispatch did not exist, legacy fallback received the raw envelope shape, and malformed `daily_summary` JSON threw from the listener.

## Known Stubs

None. Stub-pattern scan only found legitimate nullable EventSource fields, test arrays, and existing "placeholder" test copy unrelated to this plan.

## Threat Flags

None. The new EventSource transport boundary validation matches the plan threat model mitigations T-63-03-01 through T-63-03-05.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

63-04 can wire MainLayout to `onDailySummaryEnvelope` and implement same-day/historical coordinator routing while preserving the legacy `onSummary` fallback until migration is complete.

## Self-Check: PASSED

- Created summary file exists.
- Planned source and test files exist.
- Task commits `6e65891` and `33ff6e7` exist in git history.

---
*Phase: 63-sse-meal-row-freshness-and-affected-date-invalidation*
*Completed: 2026-05-18*
