---
phase: 59-authoritative-summary-facts-and-sse-proof
plan: 01
subsystem: orchestrator
tags: [summary-history, deterministic-renderer, advice-guard, node-test]

requires:
  - phase: 58-localization-proof-and-release-gate
    provides: v2.2 failure-localization and guard context
provides:
  - Shared deterministic summary/history fact renderer
  - Conservative optional advice guard for summary/history replies
  - Unit contract for persisted-vs-aggregate mismatch behavior
affects: [phase-59, orchestrator, summary-history]

tech-stack:
  added: []
  patterns:
    - Renderer-owned fact segment from persisted meal rows
    - Fail-closed advice isolation before final reply composition

key-files:
  created:
    - server/orchestrator/summary-history-renderer.ts
    - tests/unit/summary-history-renderer.test.ts
  modified: []

key-decisions:
  - "Summary/history visible meal count and kcal total are rendered from persisted meal rows when rows exist."
  - "Optional model advice is dropped wholesale when it contains concrete meal names, kcal, macro attribution, meal count, or day-total claims."

patterns-established:
  - "SummaryHistoryFacts composer: deterministic fact segment plus accepted advice separated by a blank line."
  - "Aggregate DailySummary is treated as date/empty-day context, not as authority over persisted meal-row facts."

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04]

duration: 3min
completed: 2026-05-17
---

# Phase 59 Plan 01: Shared Deterministic Summary/History Renderer Summary

**Persisted-row summary/history fact rendering with fail-closed optional advice isolation**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-16T16:27:16Z
- **Completed:** 2026-05-16T16:29:15Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added a shared backend renderer that deterministically emits summary/history fact text from `SummaryHistoryFacts.meals`.
- Covered the canonical two-meal output exactly: `今天已記錄 2 餐，共 900 kcal：豆腐飯 520 kcal、鮭魚飯 380 kcal。`
- Added fail-closed advice guarding so unsafe model-authored meal names, kcal, macro, meal-count, or day-total claims are dropped instead of partially salvaged.
- Proved aggregate `DailySummary.mealCount` and `DailySummary.totalCalories` cannot override persisted row count or row kcal sum when persisted meals exist.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add failing renderer and advice-guard unit contract** - `99e6de3` (test)
2. **Task 2: Implement shared summary/history renderer** - `4cb6b60` (feat)

## Files Created/Modified

- `server/orchestrator/summary-history-renderer.ts` - New deterministic fact renderer, advice guard, and reply composer.
- `tests/unit/summary-history-renderer.test.ts` - TDD contract for canonical fact text, empty-day semantics, aggregate mismatch handling, and unsafe advice rejection.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/summary-history-renderer.test.ts` - RED failed before implementation with missing module; GREEN passed after implementation.
- `yarn tsc --noEmit` - passed.
- `yarn test:unit` - passed, 707 tests.

## Decisions Made

- Persisted meals win over aggregate summary fields for visible meal count and total kcal whenever persisted rows exist.
- Empty-day output uses summary/history copy with `0 餐` and `0 kcal`, never mutation-failure copy.
- Advice is dropped as a whole when unsafe concrete fact claims appear; no partial salvage is attempted in this module.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The expected RED failure was `ERR_MODULE_NOT_FOUND` before the renderer module existed.

## Known Stubs

None.

## Threat Flags

None - no new endpoint, auth path, file access boundary, or schema surface was introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 02 can import `SummaryHistoryFacts`, `renderSummaryHistoryFacts`, `guardSummaryHistoryAdvice`, and `composeSummaryHistoryReply` from `server/orchestrator/summary-history-renderer.ts` and wire orchestrator final replies to this shared composition boundary.

## Self-Check

PASSED

- Found created files: `server/orchestrator/summary-history-renderer.ts`, `tests/unit/summary-history-renderer.test.ts`, `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-01-SUMMARY.md`.
- Found task commits: `99e6de3`, `4cb6b60`.

---
*Phase: 59-authoritative-summary-facts-and-sse-proof*
*Completed: 2026-05-17*
