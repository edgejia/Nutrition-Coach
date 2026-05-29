---
phase: 68-structured-tool-results-and-release-proof-gate
plan: 01
subsystem: testing
tags: [node-test, orchestrator, tool-results, red-first]

requires:
  - phase: 67-correction-targeting-and-backend-clarification-rendering
    provides: backend-rendered correction clarification and controlled find_meals replies
provides:
  - Red-first unit coverage for typed ToolExecutionResult clarification facts
  - Red-first unit coverage for historical terminal renderer ownership and no second LLM pass
  - Source guard against serialized clarification parsing in orchestrator index
affects: [phase-68, tool-results, orchestrator]

tech-stack:
  added: []
  patterns:
    - Red-first Node node:test assertions against future ToolExecutionResult.clarification contract
    - Orchestrator source-scan guard strips comments before matching forbidden parsing terms

key-files:
  created:
    - .planning/phases/68-structured-tool-results-and-release-proof-gate/68-01-SUMMARY.md
  modified:
    - tests/unit/tools.test.ts
    - tests/unit/orchestrator.test.ts

key-decisions:
  - "Plan 68-01 stayed red-first: no production files were edited, and failing assertions are the expected handoff to Plan 68-02."
  - "The test contract names the typed tool-result fact boundary ToolExecutionResult.clarification."

patterns-established:
  - "Red-first tool-result tests assert renderer-ready facts instead of JSON.parse(result.result) for clarification behavior."
  - "Terminal historical clarification tests prove no queued second LLM response is consumed."

requirements-completed: [TARGET-03, PROOF-01]

duration: 5m
completed: 2026-05-29
---

# Phase 68 Plan 01: Red-First Structured Tool Result Tests Summary

**Typed clarification fact and terminal renderer red tests now lock the Phase 68 implementation target without changing production code.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-29T16:07:43Z
- **Completed:** 2026-05-29T16:12:41Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added red-first `executeTool()` assertions for `find_meals`, historical `log_food`, historical `get_daily_summary needs_clarification`, and `get_daily_summary multiple_targets`.
- Replaced the multi-target summary clarification proof with typed fact and renderer `controlledReply` expectations instead of `JSON.parse(result.result)`.
- Added orchestrator red tests proving historical clarification should be renderer-owned, no-mutation, and terminal after one LLM tool-call round.
- Added a comment-stripped source guard preventing serialized clarification parsing terms from returning to `server/orchestrator/index.ts`.

## Task Commits

1. **Task 1: Add red-first typed clarification fact tests** - `4176d5a` (test)
2. **Task 2: Add red-first terminal renderer and source-guard tests** - `0743f15` (test)

## Files Created/Modified

- `tests/unit/tools.test.ts` - Adds red-first typed clarification fact assertions and multi-target carry-forward safety coverage.
- `tests/unit/orchestrator.test.ts` - Adds terminal renderer/no-second-LLM tests and an orchestrator source guard.
- `.planning/phases/68-structured-tool-results-and-release-proof-gate/68-01-SUMMARY.md` - Execution summary and red verification record.

## Decisions Made

- Used `clarification` as the future `ToolExecutionResult` field name for the narrow typed fact boundary.
- Kept all production files untouched; Plan 68-02 owns implementation and green behavior.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts` - **expected fail**: 5 failures for missing `ToolExecutionResult.clarification` and missing historical `controlledReply`.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` - **expected fail**: 3 failures because historical clarification still consumes a second LLM response.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/orchestrator.test.ts` - **expected fail**: 8 total red failures matching the two gaps above.
- `yarn tsc --noEmit` - **passed**.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Expected red failures remain by design:

- `ToolExecutionResult.clarification` does not exist yet.
- Historical `log_food` and `get_daily_summary` clarification paths still feed serialized tool results into a second LLM round.

## Known Stubs

None. Stub scan found only existing empty test arrays used as fixtures and call collectors.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 68-02 can implement the production structured result union, renderer helpers, and terminal historical `controlledReply` mapping against the committed red tests.

## Self-Check: PASSED

- Found summary file: `.planning/phases/68-structured-tool-results-and-release-proof-gate/68-01-SUMMARY.md`.
- Found task commits: `4176d5a`, `0743f15`.
- Confirmed no production files were modified by Plan 68-01 task commits.

---
*Phase: 68-structured-tool-results-and-release-proof-gate*
*Completed: 2026-05-29*
