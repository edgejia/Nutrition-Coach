---
phase: 59-authoritative-summary-facts-and-sse-proof
plan: 02
subsystem: orchestrator
tags: [summary-history, deterministic-renderer, persisted-facts, node-test]

requires:
  - phase: 59-authoritative-summary-facts-and-sse-proof
    provides: Shared deterministic summary/history renderer from plan 59-01
provides:
  - Orchestrator plain summary/history replies composed from persisted facts
  - Renderer-owned final reply trace metadata for summary/history plain replies
  - Unit regressions for unsafe model facts, safe advice, and empty-day semantics
affects: [phase-59, orchestrator, summary-history, route-final-reply]

tech-stack:
  added: []
  patterns:
    - Summary/history get_daily_summary plain replies route through composeSummaryHistoryReply
    - No-mutation guard remains exported as defense-in-depth

key-files:
  created: []
  modified:
    - server/orchestrator/index.ts
    - tests/unit/orchestrator.test.ts

key-decisions:
  - "Plain orchestrator replies after get_daily_summary are renderer-owned when summaryHistoryFacts are available."
  - "SummaryHistoryFacts remains re-exported from the orchestrator module to preserve existing route type imports."

patterns-established:
  - "Orchestrator summary/history finalReplySource is renderer and finalReplyShape is plain_text when the shared composer is used."
  - "Existing guardNoMutationLoggingClaim stays available for non-summary-history fallback defense."

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04]

duration: 3min
completed: 2026-05-17
---

# Phase 59 Plan 02: Orchestrator Summary/History Composer Wiring Summary

**Orchestrator plain summary/history replies now use persisted meal facts through the shared renderer composer**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-16T16:39:58Z
- **Completed:** 2026-05-16T16:42:28Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added failing orchestrator regressions proving `get_daily_summary` replies use persisted `豆腐飯 520 kcal` and `鮭魚飯 380 kcal` instead of unsafe model text such as `牛肉飯`.
- Wired `server/orchestrator/index.ts` to call `composeSummaryHistoryReply()` for plain `response.content` when `summaryHistoryFacts` are present.
- Marked renderer-owned summary/history plain replies with `finalReplySource: "renderer"` and `finalReplyShape: "plain_text"`.
- Preserved `guardNoMutationLoggingClaim()` as an exported defense-in-depth guard for non-renderer fallback paths.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add orchestrator unit coverage for renderer-owned summary replies** - `0a9840a` (test)
2. **Task 2: Compose orchestrator summary/history plain replies from persisted facts** - `a643b62` (feat)

## Files Created/Modified

- `server/orchestrator/index.ts` - Imports/re-exports the shared summary/history type, composes summary/history plain replies from persisted facts, and marks renderer metadata.
- `tests/unit/orchestrator.test.ts` - Adds RED regressions and updates older summary/history expectations to the renderer-owned deterministic output.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` - RED failed before implementation with four new renderer-owned summary/history assertions.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts tests/unit/summary-history-renderer.test.ts` - passed after implementation.
- `yarn tsc --noEmit` - passed after preserving the `SummaryHistoryFacts` re-export.
- `yarn test:unit` - passed, 717 tests.

## Decisions Made

- Summary/history plain replies are composed whenever `summaryHistoryFacts` exist, replacing model-authored fact text with deterministic persisted facts while treating model text only as optional advice.
- The orchestrator module continues to re-export `SummaryHistoryFacts` so downstream route imports do not need to change in this plan.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Preserved `SummaryHistoryFacts` export compatibility**
- **Found during:** Task 2 (Compose orchestrator summary/history plain replies from persisted facts)
- **Issue:** Moving the type source to `summary-history-renderer.ts` made `yarn tsc --noEmit` fail because `server/routes/chat.ts` still imports `SummaryHistoryFacts` from `server/orchestrator/index.ts`.
- **Fix:** Re-exported `SummaryHistoryFacts` from `server/orchestrator/index.ts` without touching route files.
- **Files modified:** `server/orchestrator/index.ts`
- **Verification:** `yarn tsc --noEmit` passed.
- **Committed in:** `a643b62`

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Compatibility-only fix required for TypeScript correctness; no route, service, schema, migration, staging, or main promotion files were modified.

## Issues Encountered

The expected RED gate failed on the new tests. During GREEN, older tests still expected model-preserved or no-mutation fallback copy after `get_daily_summary`; those assertions were updated to the new deterministic renderer contract.

## Known Stubs

None. Stub-pattern scan found only existing initialized arrays/strings used as normal runtime or test state.

## Threat Flags

None - the plan modified the existing orchestrator final-reply trust boundary already covered by the plan threat model and did not add endpoints, auth paths, file access, or schema surfaces.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03 can wire JSON, drained-stream, and live SSE route paths to the same renderer/composer contract, with `SummaryHistoryFacts` still available from the orchestrator module for existing route imports.

## TDD Gate Compliance

- RED commit: `0a9840a`
- GREEN commit: `a643b62`
- REFACTOR commit: not needed

## Self-Check

PASSED

- Found modified files: `server/orchestrator/index.ts`, `tests/unit/orchestrator.test.ts`.
- Found summary file: `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-02-SUMMARY.md`.
- Found task commits: `0a9840a`, `a643b62`.

---
*Phase: 59-authoritative-summary-facts-and-sse-proof*
*Completed: 2026-05-17*
